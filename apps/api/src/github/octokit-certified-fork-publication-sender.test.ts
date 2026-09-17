import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  certifiedForkReviewPromptContextHash,
  parseCertifiedForkReviewModelOutput,
  parseCertifiedForkReviewPromptPacket,
  parseCertifiedForkReviewBinding,
} from "@reviewrouter/features-action-control-plane";
import {
  sendCertifiedForkPublication,
  type DurablePublicationAuthorization,
  type PublicationAppClient,
  type PublicationConfirmation,
  type PublicationIdentity,
  type PublicationIntent,
  type PublicationObservation,
  type PublicationRequest,
  type PublicationSenderDependencies,
} from "./octokit-certified-fork-publication-sender.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const keys = generateKeyPairSync("ed25519");
const binding = parseCertifiedForkReviewBinding({
  sourceRepository: "contributor/fork",
  sourceRepositoryId: "20",
  baseRepository: "owner/project",
  baseRepositoryId: "10",
  pullRequestNumber: 7,
  reviewHeadSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  trustDomain: "fork",
});
const packet = parseCertifiedForkReviewPromptPacket({
  protocolVersion: 1,
  binding,
  contextHash: certifiedForkReviewPromptContextHash({ binding, files: [] }),
  files: [],
});
function request(): PublicationRequest {
  return {
    commandId: "command-1",
    commandHash: digest("command"),
    familyKey: digest("family"),
    reviewHash: digest("review"),
    effectKey: digest("effect"),
    providerInstanceId: "provider-1",
    githubInstallationId: "123",
    binding,
    packet,
    output: parseCertifiedForkReviewModelOutput(
      {
        protocolVersion: 1,
        summaryMarkdown: "The result is useful.",
        findings: [],
      },
      [],
    ),
  };
}
type RawComment = {
  id: number;
  body: string;
  user: { id: number; type: string; login?: string };
};
type Call = { route: string; params: Record<string, unknown> };
const ok = (data: unknown, status = 200, link?: string) => ({
  data,
  status,
  headers: link === undefined ? {} : { link },
});
const foreign = (id: number): RawComment => ({
  id,
  body: "foreign content",
  user: { id: 800, type: "Bot", login: "our-app[bot]" },
});

/** Test-only committed store model. Fresh dependency instances share rows,
 * never a process lock. The real retained-proof implementation is deliberately
 * not supplied/wired by this change. Retry authorization is simulated ONLY by
 * an independent authenticated-evidence producer closing the previous attempt.
 */
class DurableFake implements DurablePublicationAuthorization {
  rows = new Map<
    string,
    {
      identity: PublicationIdentity;
      intent: PublicationIntent;
      confirmed: PublicationConfirmation | null;
      closedNoEffect: boolean;
    }
  >();
  observations: PublicationObservation[] = [];
  reserves: Parameters<DurablePublicationAuthorization["reserve"]>[0][] = [];
  events: string[];
  failReserve = false;
  failRetain = false;
  suppressConfirmation = false;
  nextAttempt = 0;
  constructor(events: string[]) {
    this.events = events;
  }
  async reserve(
    input: Parameters<DurablePublicationAuthorization["reserve"]>[0],
  ) {
    this.events.push("reserve");
    this.reserves.push(input);
    const prior = this.rows.get(input.identity.commandId);
    if (prior) {
      if (JSON.stringify(prior.identity) !== JSON.stringify(input.identity))
        return { kind: "refused" } as const;
      if (prior.confirmed)
        return { kind: "confirmed", confirmation: prior.confirmed } as const;
      if (!prior.closedNoEffect) return { kind: "pending" } as const;
    }
    const intent: PublicationIntent = {
      identity: input.identity,
      receipt: prior?.intent.receipt ?? {
        ownerHash: digest("original-principal"),
        commandId: input.identity.commandId,
        commandHash: input.identity.commandHash,
        reviewHash: input.identity.reviewHash,
        version: "2",
      },
      attemptId: `attempt-${++this.nextAttempt}`,
      target: input.target,
    };
    this.rows.set(input.identity.commandId, {
      identity: input.identity,
      intent,
      confirmed: null,
      closedNoEffect: false,
    });
    if (this.failReserve) throw new Error("Authorization: secret-token");
    return { kind: "dispatch", intent } as const;
  }
  async retain(intent: PublicationIntent, observation: PublicationObservation) {
    this.events.push("retain");
    this.observations.push(observation);
    const row = this.rows.get(intent.identity.commandId)!;
    expect(intent).toEqual(row.intent);
    if (observation.kind === "observed" && !this.suppressConfirmation) {
      row.confirmed = {
        identity: row.identity,
        receipt: row.intent.receipt,
        commentId: observation.commentId,
      };
    }
    if (this.failRetain) throw new Error("model-text secret-token");
    return row.confirmed;
  }
  // This helper stands in for independent proof custody, NOT listing absence.
  authenticatedNoEffect(commandId: string) {
    this.rows.get(commandId)!.closedNoEffect = true;
  }
  authenticatedRecovery(commandId: string, commentId: string) {
    const row = this.rows.get(commandId)!;
    row.confirmed = {
      identity: row.identity,
      receipt: row.intent.receipt,
      commentId,
    };
  }
}
function fixture() {
  const events: string[] = [];
  const calls: Call[] = [];
  const appCalls: Call[] = [];
  const installationCalls: Call[] = [];
  const issues: RawComment[] = [];
  const reviews: RawComment[] = [];
  const durable = new DurableFake(events);
  let guardCount = 0;
  let nextId = 900;
  const state = {
    wrongApp: false,
    wrongInstallation: false,
    wrongInstallationApp: false,
    wrongBot: false,
    staleAt: 0,
    mutationMode: "success" as
      | "success"
      | "timeout"
      | "lost-ack"
      | "malformed"
      | "wrong-author"
      | "wrong-id",
    pageOverride: undefined as
      | undefined
      | ((kind: string, page: number) => ReturnType<typeof ok> | undefined),
    beforeMutation: undefined as undefined | (() => void),
    duringGuard: undefined as undefined | ((count: number) => void),
    beforeTargetRead: undefined as undefined | (() => void),
  };
  const appClient: PublicationAppClient = {
    async request(route, params = {}) {
      calls.push({ route, params });
      appCalls.push({ route, params });
      if (route === "GET /app")
        return ok({ id: state.wrongApp ? 99 : 42, slug: "our-app" });
      if (route === "GET /app/installations/{installation_id}") {
        expect(params).toEqual({ installation_id: 123 });
        return ok({
          id: state.wrongInstallation ? 321 : 123,
          app_id: state.wrongInstallationApp ? 99 : 42,
        });
      }
      throw new Error(`unexpected App route ${route}`);
    },
  };
  const client: PublicationAppClient = {
    async request(route, params = {}) {
      calls.push({ route, params });
      installationCalls.push({ route, params });
      if (route === "GET /users/{username}")
        return ok({ id: state.wrongBot ? 99 : 777, type: "Bot" });
      if (route.startsWith("GET") && route.endsWith("/comments")) {
        const kind = route.includes("/issues/") ? "issue" : "review";
        const page = Number(params.page);
        events.push(`${kind}:${page}`);
        const overridden = state.pageOverride?.(kind, page);
        if (overridden) return overridden;
        const all = kind === "issue" ? issues : reviews;
        const data = all.slice((page - 1) * 100, page * 100);
        return ok(data);
      }
      if (route.startsWith("GET") && route.endsWith("/{comment_id}")) {
        state.beforeTargetRead?.();
        return ok(issues.find((c) => String(c.id) === params.comment_id));
      }
      if (route.startsWith("POST") || route.startsWith("PATCH")) {
        events.push("mutation");
        expect(durable.rows.size).toBeGreaterThan(0);
        state.beforeMutation?.();
        if (state.mutationMode === "timeout")
          throw new Error("timeout secret-token");
        const comment = {
          id: route.startsWith("PATCH") ? Number(params.comment_id) : ++nextId,
          body: params.body as string,
          user: { id: 777, type: "Bot" },
        };
        if (route.startsWith("PATCH"))
          issues.splice(
            issues.findIndex((c) => c.id === comment.id),
            1,
            comment,
          );
        else issues.push(comment);
        if (state.mutationMode === "lost-ack")
          throw new Error("Authorization: secret-token model-text");
        if (state.mutationMode === "malformed")
          return ok({ message: "secret-token" }, 201);
        if (state.mutationMode === "wrong-author")
          return ok({ ...comment, user: { id: 99, type: "Bot" } }, 201);
        if (state.mutationMode === "wrong-id")
          return ok({ ...comment, id: 9999 });
        return ok(comment, route.startsWith("POST") ? 201 : 200);
      }
      throw new Error(`unexpected fake route ${route}`);
    },
  };
  const deps: PublicationSenderDependencies = {
    app: {
      octokit: appClient,
      async getInstallationOctokit(id) {
        expect(id).toBe(123);
        return client;
      },
    },
    appId: "42",
    appSlug: "our-app",
    botId: "777",
    markerPublicKey: keys.publicKey,
    async signMarker(payload) {
      events.push("sign");
      return sign(null, payload, keys.privateKey);
    },
    currentness: {
      async assertBindingCurrent(input) {
        expect(input).toEqual({ githubInstallationId: "123", binding });
        events.push("guard");
        guardCount++;
        state.duringGuard?.(guardCount);
        if (state.staleAt === guardCount) throw new Error("stale token secret");
      },
    },
    authorization: durable,
  };
  return {
    deps,
    durable,
    state,
    calls,
    appCalls,
    installationCalls,
    client,
    events,
    issues,
    reviews,
    send: (input = request(), signal?: AbortSignal) =>
      sendCertifiedForkPublication(deps, input, signal),
    mutations: () => calls.filter((c) => /^(POST|PATCH|DELETE)/u.test(c.route)),
  };
}
function changedRequest(): PublicationRequest {
  return {
    ...request(),
    commandId: "command-2",
    commandHash: digest("command-2"),
    output: parseCertifiedForkReviewModelOutput(
      { protocolVersion: 1, summaryMarkdown: "Updated result", findings: [] },
      [],
    ),
  };
}
function resign(comment: RawComment, edit: (payload: any) => void) {
  const match = /:v1:([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+) -->$/u.exec(
    comment.body,
  )!;
  const payload = JSON.parse(Buffer.from(match[1]!, "base64url").toString());
  edit(payload);
  const encoded = Buffer.from(JSON.stringify(payload));
  comment.body = comment.body.replace(
    match[0],
    `:v1:${encoded.toString("base64url")}.${sign(null, encoded, keys.privateKey).toString("base64url")} -->`,
  );
}

describe("unused certified-fork publication sender", () => {
  it("looks up the exact installation through the App-authenticated endpoint only", async () => {
    const f = fixture();
    const acquire = vi.spyOn(f.deps.app, "getInstallationOctokit");
    expect(await f.send()).toEqual({ kind: "confirmed", commentId: "901" });
    expect(f.appCalls).toEqual([
      { route: "GET /app", params: {} },
      {
        route: "GET /app/installations/{installation_id}",
        params: { installation_id: 123 },
      },
    ]);
    expect(acquire).toHaveBeenCalledExactlyOnceWith(123);
    expect(
      f.installationCalls.some((c) => c.route.includes("/installation")),
    ).toBe(false);
    expect(f.calls.some((c) => c.route === "GET /installation")).toBe(false);
    expect(f.installationCalls).toContainEqual(f.mutations()[0]);
  });

  it("creates an App-owned signed comment after committed intent and fresh guards", async () => {
    const f = fixture();
    expect(await f.send()).toEqual({ kind: "confirmed", commentId: "901" });
    expect(f.mutations()).toHaveLength(1);
    expect(f.events).toEqual([
      "guard",
      "issue:1",
      "review:1",
      "guard",
      "reserve",
      "sign",
      "guard",
      "mutation",
      "retain",
    ]);
    expect(f.issues[0]!.body).toContain("<!-- reviewrouter-certified-fork:v1:");
    expect(f.durable.observations[0]).toMatchObject({
      kind: "observed",
      commentId: "901",
    });
    expect(f.mutations()[0]!.params.request).toMatchObject({
      retries: 0,
      timeout: 15_000,
    });
  });

  it("updates only the exact owned summary, leaving foreign comments intact", async () => {
    const f = fixture();
    await f.send();
    f.issues.unshift(foreign(88));
    const untouched = structuredClone(f.issues[0]);
    expect(await f.send(changedRequest())).toEqual({
      kind: "confirmed",
      commentId: "901",
    });
    expect(f.mutations().map((c) => c.route.split(" ")[0])).toEqual([
      "POST",
      "PATCH",
    ]);
    expect(f.issues[0]).toEqual(untouched);
    expect(f.issues[1]!.body).toContain("Updated result");
    expect(f.durable.reserves[1]!.target).toMatchObject({
      kind: "issue",
      id: "901",
    });
  });

  it.each([
    "wrongApp",
    "wrongInstallation",
    "wrongInstallationApp",
    "wrongBot",
  ] as const)("rejects %s before authorization", async (key) => {
    const f = fixture();
    f.state[key] = true;
    expect(await f.send()).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(0);
    expect(f.durable.reserves).toHaveLength(0);
  });

  it("a bot-looking login never authorizes ownership", async () => {
    const f = fixture();
    await f.send();
    const stolen = {
      ...f.issues[0]!,
      id: 89,
      user: { id: 800, type: "Bot", login: "our-app[bot]" },
    };
    f.issues.splice(0, 1, stolen);
    expect(await f.send(changedRequest())).toEqual({
      kind: "confirmed",
      commentId: "902",
    });
    expect(f.mutations()[1]!.route).toMatch(/^POST/u);
    expect(f.issues[0]).toEqual(stolen);
  });

  it("an unsigned App comment remains foreign", async () => {
    const f = fixture();
    f.issues.push({ id: 5, body: "unsigned", user: { id: 777, type: "Bot" } });
    expect(await f.send()).toMatchObject({ kind: "confirmed" });
    expect(f.issues[0]!.body).toBe("unsigned");
    expect(f.mutations()[0]!.route).toMatch(/^POST/u);
  });

  it.each(["signature", "body", "duplicate", "malformed"])(
    "fails closed on owned marker %s tampering",
    async (mode) => {
      const f = fixture();
      await f.send();
      const c = f.issues[0]!;
      if (mode === "signature")
        c.body = c.body.replace(
          /\.([A-Za-z0-9_-]+) -->$/u,
          `.${"A".repeat(86)} -->`,
        );
      if (mode === "body") c.body = `injected${c.body}`;
      if (mode === "duplicate") c.body += c.body;
      if (mode === "malformed")
        c.body = "<!-- reviewrouter-certified-fork:v1:bad -->";
      expect(await f.send(changedRequest())).toEqual({ kind: "refused" });
      expect(f.mutations()).toHaveLength(1);
    },
  );

  it("rejects a valid signature from an unconfigured key", async () => {
    const f = fixture();
    await f.send();
    f.deps.markerPublicKey = generateKeyPairSync("ed25519").publicKey;
    expect(await f.send(changedRequest())).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(1);
  });

  it.each([
    "baseRepositoryId",
    "sourceRepositoryId",
    "pullRequestNumber",
    "baseSha",
    "reviewHeadSha",
  ] as const)(
    "does not adopt a signed marker with another %s",
    async (field) => {
      const f = fixture();
      await f.send();
      resign(f.issues[0]!, (p) => {
        p.identity.binding[field] = field.endsWith("Sha")
          ? "c".repeat(40)
          : field === "pullRequestNumber"
            ? 99
            : "99";
      });
      expect(await f.send(changedRequest())).toMatchObject({
        kind: "confirmed",
      });
      expect(f.mutations()[1]!.route).toMatch(/^POST/u);
    },
  );

  it.each([
    "providerInstanceId",
    "installationId",
    "reviewHash",
    "effectKey",
    "contextHash",
  ])("does not adopt another signed %s scope", async (field) => {
    const f = fixture();
    await f.send();
    resign(f.issues[0]!, (p) => {
      p.identity[field] =
        field === "installationId"
          ? "456"
          : field === "providerInstanceId"
            ? "other"
            : digest("other");
      if (field === "reviewHash") p.receipt.reviewHash = p.identity.reviewHash;
    });
    expect(await f.send(changedRequest())).toMatchObject({ kind: "confirmed" });
    expect(f.mutations()[1]!.route).toMatch(/^POST/u);
  });

  it("inventories all issue and review pages including exact-full terminal pages", async () => {
    const f = fixture();
    f.issues.push(...Array.from({ length: 200 }, (_, i) => foreign(i + 1)));
    f.reviews.push(...Array.from({ length: 100 }, (_, i) => foreign(i + 1)));
    expect(await f.send()).toMatchObject({ kind: "confirmed" });
    expect(f.events.filter((e) => e.includes(":"))).toEqual([
      "issue:1",
      "issue:2",
      "issue:3",
      "review:1",
      "review:2",
    ]);
    expect(f.durable.reserves[0]!.inventory).toHaveLength(300);
  });

  it("finds an owned target beyond the first page", async () => {
    const f = fixture();
    await f.send();
    f.issues.unshift(...Array.from({ length: 100 }, (_, i) => foreign(i + 1)));
    expect(await f.send(changedRequest())).toMatchObject({
      kind: "confirmed",
      commentId: "901",
    });
    expect(f.mutations()[1]!.route).toMatch(/^PATCH/u);
  });

  it("rejects duplicate owned markers across pages", async () => {
    const f = fixture();
    await f.send();
    f.issues.push(...Array.from({ length: 99 }, (_, i) => foreign(i + 1)), {
      ...f.issues[0]!,
      id: 999,
    });
    expect(await f.send(changedRequest())).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(1);
  });

  it("a matching review-comment marker prevents a summary duplicate", async () => {
    const f = fixture();
    await f.send();
    f.reviews.push(f.issues.pop()!);
    expect(await f.send(changedRequest())).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(1);
  });

  it.each([
    "missing",
    "repeat",
    "short-next",
    "skipped",
    "foreign-url",
    "malformed-link",
  ])("fails closed on %s pagination", async (mode) => {
    const f = fixture();
    f.issues.push(...Array.from({ length: 100 }, (_, i) => foreign(i + 1)));
    f.state.pageOverride = (kind, page) => {
      if (kind !== "issue") return undefined;
      if (mode === "missing" && page === 2) return ok(undefined);
      if (mode === "repeat" && page === 2) return ok([foreign(1)]);
      if (page !== 1) return undefined;
      const root =
        "https://api.github.com/repos/owner/project/issues/7/comments";
      if (mode === "short-next")
        return ok([], 200, `<${root}?per_page=100&page=2>; rel="next"`);
      if (mode === "skipped")
        return ok(f.issues, 200, `<${root}?per_page=100&page=3>; rel="next"`);
      if (mode === "foreign-url")
        return ok(
          f.issues,
          200,
          '<https://evil.test/?per_page=100&page=2>; rel="next"',
        );
      if (mode === "malformed-link")
        return ok(f.issues, 200, "next page secret-token");
      return undefined;
    };
    expect(await f.send()).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(0);
    expect(f.durable.reserves).toHaveLength(0);
  });

  it("accepts valid next/last links without following caller-supplied URLs", async () => {
    const f = fixture();
    f.issues.push(...Array.from({ length: 101 }, (_, i) => foreign(i + 1)));
    f.state.pageOverride = (kind, page) =>
      kind === "issue" && page === 1
        ? ok(
            f.issues.slice(0, 100),
            200,
            '<https://api.github.com/repos/owner/project/issues/7/comments?per_page=100&page=2>; rel="next", <https://api.github.com/repos/owner/project/issues/7/comments?per_page=100&page=2>; rel="last"',
          )
        : undefined;
    expect(await f.send()).toMatchObject({ kind: "confirmed" });
    expect(f.calls.every((c) => !c.route.includes("https:"))).toBe(true);
  });

  it("fails closed when the review inventory is unavailable", async () => {
    const f = fixture();
    f.state.pageOverride = (kind) =>
      kind === "review" ? ok({ message: "private" }, 403) : undefined;
    expect(await f.send()).toEqual({ kind: "refused" });
    expect(f.durable.reserves).toHaveLength(0);
  });

  it.each([1, 2, 3])(
    "checks fresh currentness at boundary %s",
    async (count) => {
      const f = fixture();
      f.state.staleAt = count;
      expect(await f.send()).toEqual({
        kind: count === 3 ? "reconciliation-required" : "refused",
      });
      expect(f.mutations()).toHaveLength(0);
      if (count === 3)
        expect(f.durable.observations).toEqual([{ kind: "not-dispatched" }]);
    },
  );

  it("rechecks target ownership after reservation", async () => {
    const f = fixture();
    await f.send();
    f.state.beforeTargetRead = () => {
      f.issues[0]!.user.id = 800;
    };
    expect(await f.send(changedRequest())).toEqual({
      kind: "reconciliation-required",
    });
    expect(f.mutations()).toHaveLength(1);
  });

  it("rechecks target content after reservation", async () => {
    const f = fixture();
    await f.send();
    f.state.beforeTargetRead = () => {
      f.issues[0]!.body += "changed";
    };
    expect(await f.send(changedRequest())).toEqual({
      kind: "reconciliation-required",
    });
    expect(f.mutations()).toHaveLength(1);
  });

  it("duplicates recover the original receipt without dispatch across sender instances", async () => {
    const f = fixture();
    await f.send();
    const original = structuredClone(
      f.durable.rows.get("command-1")!.intent.receipt,
    );
    const freshDeps = { ...f.deps, authorization: f.durable };
    expect(await sendCertifiedForkPublication(freshDeps, request())).toEqual({
      kind: "confirmed",
      commentId: "901",
    });
    expect(f.durable.rows.get("command-1")!.confirmed!.receipt).toEqual(
      original,
    );
    expect(f.mutations()).toHaveLength(1);
  });

  it("rejects conflicting output under the same command even if the comment vanished", async () => {
    const f = fixture();
    await f.send();
    f.issues.length = 0;
    expect(
      await f.send({ ...request(), output: changedRequest().output }),
    ).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(1);
  });

  it("rejects conflicting output discovered in a same-command owned marker", async () => {
    const f = fixture();
    await f.send();
    expect(
      await f.send({ ...request(), output: changedRequest().output }),
    ).toEqual({ kind: "refused" });
    expect(f.durable.reserves).toHaveLength(1);
  });

  it("pre-cancellation has no I/O", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(await f.send(request(), controller.signal)).toEqual({
      kind: "refused",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("cancellation after durable reservation retains non-dispatch without authorizing retry", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.state.duringGuard = (count) => {
      if (count === 3) controller.abort();
    };
    expect(await f.send(request(), controller.signal)).toEqual({
      kind: "reconciliation-required",
    });
    expect(f.mutations()).toHaveLength(0);
    expect(f.durable.observations).toEqual([{ kind: "not-dispatched" }]);
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(0);
  });

  it("cancellation during send treats even a good HTTP ACK as uncertain", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.state.beforeMutation = () => controller.abort();
    expect(await f.send(request(), controller.signal)).toEqual({
      kind: "reconciliation-required",
    });
    expect(f.durable.observations).toEqual([{ kind: "uncertain" }]);
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(1);
  });

  it.each(["timeout", "lost-ack", "malformed", "wrong-author"] as const)(
    "%s requires reconciliation with no automatic or subsequent blind retry",
    async (mode) => {
      const f = fixture();
      f.state.mutationMode = mode;
      expect(await f.send()).toEqual({ kind: "reconciliation-required" });
      expect(f.durable.observations).toEqual([{ kind: "uncertain" }]);
      f.state.mutationMode = "success";
      expect(await f.send()).toEqual({ kind: "reconciliation-required" });
      expect(f.mutations()).toHaveLength(1);
    },
  );

  it("authenticated definitive no-effect closes the old attempt before an explicit retry", async () => {
    const f = fixture();
    f.state.mutationMode = "timeout";
    await f.send();
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(1);
    f.durable.authenticatedNoEffect("command-1");
    f.state.mutationMode = "success";
    expect(await f.send()).toEqual({ kind: "confirmed", commentId: "901" });
    expect(f.durable.rows.get("command-1")!.intent.attemptId).toBe("attempt-2");
    expect(f.mutations()).toHaveLength(2);
  });

  it("an ambiguous successful remote write recovers original receipt through authenticated evidence", async () => {
    const f = fixture();
    f.state.mutationMode = "lost-ack";
    await f.send();
    const original = f.durable.rows.get("command-1")!.intent.receipt;
    f.durable.authenticatedRecovery("command-1", "901");
    expect(await f.send()).toEqual({ kind: "confirmed", commentId: "901" });
    expect(f.durable.rows.get("command-1")!.confirmed!.receipt).toEqual(
      original,
    );
    expect(f.mutations()).toHaveLength(1);
  });

  it("lost durable reservation ACK never dispatches or authorizes another attempt", async () => {
    const f = fixture();
    f.durable.failReserve = true;
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    f.durable.failReserve = false;
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(0);
  });

  it("HTTP success alone is insufficient without authenticated retention", async () => {
    const f = fixture();
    f.durable.suppressConfirmation = true;
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(1);
  });

  it("lost retention ACK recovers from the committed original outcome", async () => {
    const f = fixture();
    f.durable.failRetain = true;
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    f.durable.failRetain = false;
    expect(await f.send()).toEqual({ kind: "confirmed", commentId: "901" });
    expect(f.mutations()).toHaveLength(1);
  });

  it("redacts arbitrary credential/body/model errors", async () => {
    const f = fixture();
    f.state.mutationMode = "lost-ack";
    f.durable.failRetain = true;
    const result = await f.send({
      ...request(),
      output: {
        protocolVersion: 1,
        summaryMarkdown: "model-text secret-token",
        findings: [],
      },
    });
    expect(JSON.stringify(result)).toBe('{"kind":"reconciliation-required"}');
    expect(JSON.stringify(f.durable.observations)).not.toContain(
      "secret-token",
    );
  });

  it("does not sign until the durable command is authorized", async () => {
    const f = fixture();
    f.deps.authorization = {
      ...f.durable,
      reserve: async () => ({ kind: "refused" }),
      retain: f.durable.retain.bind(f.durable),
    };
    expect(await f.send()).toEqual({ kind: "refused" });
    expect(f.events).not.toContain("sign");
    expect(f.mutations()).toHaveLength(0);
  });

  it("rejects a mismatched durable intent before remote mutation", async () => {
    const f = fixture();
    const reserve = f.durable.reserve.bind(f.durable);
    f.durable.reserve = async (input) => {
      const result = await reserve(input);
      if (result.kind === "dispatch")
        return {
          ...result,
          intent: {
            ...result.intent,
            identity: {
              ...result.intent.identity,
              outputHash: digest("wrong"),
            },
          },
        };
      return result;
    };
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(0);
  });

  it("rejects a mismatched original command receipt", async () => {
    const f = fixture();
    const reserve = f.durable.reserve.bind(f.durable);
    f.durable.reserve = async (input) => {
      const result = await reserve(input);
      if (result.kind === "dispatch")
        return {
          ...result,
          intent: {
            ...result.intent,
            receipt: { ...result.intent.receipt, commandHash: digest("wrong") },
          },
        };
      return result;
    };
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(0);
  });

  it("rejects an invalid signature from the signer after intent persistence", async () => {
    const f = fixture();
    f.deps.signMarker = async () => Buffer.alloc(64);
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(0);
  });

  it("escapes model-supplied ownership marker delimiters", async () => {
    const f = fixture();
    expect(
      await f.send({
        ...request(),
        output: {
          protocolVersion: 1,
          summaryMarkdown: "<!-- reviewrouter-certified-fork:v1:fake -->",
          findings: [],
        },
      }),
    ).toMatchObject({ kind: "confirmed" });
    expect(
      f.issues[0]!.body.match(/<!-- reviewrouter-certified-fork/gu),
    ).toHaveLength(1);
  });

  it("fails closed on a packet/binding mismatch", async () => {
    const f = fixture();
    expect(
      await f.send({
        ...request(),
        binding: { ...binding, pullRequestNumber: 8 },
      }),
    ).toEqual({ kind: "refused" });
    expect(f.calls).toHaveLength(0);
  });

  it("concurrent invocations consume one durable dispatch reservation", async () => {
    const f = fixture();
    const results = await Promise.all([f.send(), f.send()]);
    expect(results.map((r) => r.kind).sort()).toEqual([
      "confirmed",
      "reconciliation-required",
    ]);
    expect(f.mutations()).toHaveLength(1);
  });
  it("blocks a transparent transport retry, including auth-hook retries", async () => {
    const f = fixture();
    const transport = vi.fn(
      async () => new Response("unauthorized", { status: 401 }),
    );
    vi.stubGlobal("fetch", transport);
    const original = f.client.request.bind(f.client);
    f.client.request = async (route, params) => {
      if (route.startsWith("POST")) {
        const options = params!.request as { fetch: typeof fetch };
        await options.fetch(
          "https://api.github.com/repos/owner/project/issues/7/comments",
          { method: "POST" },
        );
        await options.fetch(
          "https://api.github.com/repos/owner/project/issues/7/comments",
          { method: "POST" },
        );
        throw new Error("unreachable");
      }
      return original(route, params);
    };
    try {
      expect(await f.send()).toEqual({ kind: "reconciliation-required" });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]).toEqual([
        "https://api.github.com/repos/owner/project/issues/7/comments",
        { method: "POST", redirect: "error" },
      ]);
      expect(f.durable.observations).toEqual([{ kind: "uncertain" }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects a short terminal page before an advertised last page", async () => {
    const f = fixture();
    f.state.pageOverride = (kind) =>
      kind === "issue"
        ? ok(
            [],
            200,
            '<https://api.github.com/repos/owner/project/issues/7/comments?per_page=100&page=3>; rel="last"',
          )
        : undefined;
    expect(await f.send()).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(0);
  });

  it("stops an unbounded inventory without authorizing publication", async () => {
    const f = fixture();
    f.state.pageOverride = (_kind, page) =>
      ok(Array.from({ length: 100 }, (_, i) => foreign(page * 100 + i)));
    expect(await f.send()).toEqual({ kind: "refused" });
    expect(f.durable.reserves).toHaveLength(0);
    expect(f.events.filter((e) => e.startsWith("issue:"))).toHaveLength(100);
  });

  it.each(["markerVersion", "appId", "botId"])(
    "rejects signed but invalid %s",
    async (field) => {
      const f = fixture();
      await f.send();
      resign(f.issues[0]!, (payload) => {
        payload.identity[field] = field === "markerVersion" ? 2 : "99";
      });
      expect(await f.send(changedRequest())).toEqual({ kind: "refused" });
      expect(f.mutations()).toHaveLength(1);
    },
  );

  it("rejects mismatched receipt ownership returned by retention", async () => {
    const f = fixture();
    const retain = f.durable.retain.bind(f.durable);
    f.durable.retain = async (intent, observation) => {
      const confirmation = await retain(intent, observation);
      return confirmation
        ? {
            ...confirmation,
            receipt: {
              ...confirmation.receipt,
              ownerHash: digest("new-owner"),
            },
          }
        : null;
    };
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.durable.observations).toHaveLength(1);
  });

  it("rejects confirmation for another comment", async () => {
    const f = fixture();
    const retain = f.durable.retain.bind(f.durable);
    f.durable.retain = async (intent, observation) => {
      const confirmation = await retain(intent, observation);
      return confirmation ? { ...confirmation, commentId: "9999" } : null;
    };
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.mutations()).toHaveLength(1);
  });

  it("retention errors are not automatically retried", async () => {
    const f = fixture();
    f.durable.failRetain = true;
    expect(await f.send()).toEqual({ kind: "reconciliation-required" });
    expect(f.durable.observations).toHaveLength(1);
  });

  it("rejects a malformed update ACK without another update", async () => {
    const f = fixture();
    await f.send();
    f.state.mutationMode = "wrong-id";
    expect(await f.send(changedRequest())).toEqual({
      kind: "reconciliation-required",
    });
    expect(await f.send(changedRequest())).toEqual({
      kind: "reconciliation-required",
    });
    expect(f.mutations()).toHaveLength(2);
  });
  it("captures parsed input before asynchronous discovery can mutate the caller's container", async () => {
    const f = fixture();
    const input = { ...request() };
    f.state.duringGuard = (count) => {
      if (count === 1) {
        input.commandId = "changed-command";
        input.output = changedRequest().output;
        input.binding = { ...binding, pullRequestNumber: 99 };
      }
    };
    expect(await f.send(input)).toMatchObject({ kind: "confirmed" });
    expect(f.durable.reserves[0]!.identity.commandId).toBe("command-1");
    expect(f.durable.reserves[0]!.identity.binding.pullRequestNumber).toBe(7);
    expect(f.issues[0]!.body).toContain("The result is useful.");
  });

  it("an advertised next page cannot be silently replaced with an empty page", async () => {
    const f = fixture();
    f.state.pageOverride = (kind, page) => {
      if (kind !== "issue") return undefined;
      return page === 1
        ? ok(
            Array.from({ length: 100 }, (_, i) => foreign(i + 1)),
            200,
            '<https://api.github.com/repos/owner/project/issues/7/comments?per_page=100&page=2>; rel="next"',
          )
        : ok([]);
    };
    expect(await f.send()).toEqual({ kind: "refused" });
    expect(f.durable.reserves).toHaveLength(0);
  });

  it("rejects conflicting original command preimages even after the comment disappears", async () => {
    const f = fixture();
    await f.send();
    f.issues.length = 0;
    expect(
      await f.send({ ...request(), commandHash: digest("different-preimage") }),
    ).toEqual({ kind: "refused" });
    expect(f.mutations()).toHaveLength(1);
  });

  it("cancellation during discovery never reserves an intent", async () => {
    const f = fixture();
    const controller = new AbortController();
    f.state.pageOverride = (kind) => {
      if (kind === "issue") controller.abort();
      return undefined;
    };
    expect(await f.send(request(), controller.signal)).toEqual({
      kind: "refused",
    });
    expect(f.durable.reserves).toHaveLength(0);
    expect(f.mutations()).toHaveLength(0);
  });
});
