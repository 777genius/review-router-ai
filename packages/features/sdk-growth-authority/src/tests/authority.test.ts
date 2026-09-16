import { afterEach, describe, expect, it, vi } from "vitest";
import { SdkGrowthAuthority } from "../index.js";
import type { AuthorityPorts, CurrentAuthoritySnapshotPort } from "../index.js";
import type {
  Binding,
  Completion,
  Grant,
  Identity,
  OwnerEvidence,
  PublicationIntent,
} from "../domain/contracts.js";
import {
  parseIdentity,
  parseBinding,
  parseCompletion,
  parseGrant,
  parseOwnerEvidence,
  parseReceipt,
  parseRequest,
} from "../domain/validation.js";
import { AuthorityError } from "../domain/contracts.js";
import {
  InMemoryCurrentAuthoritySnapshot,
  InMemoryReceiptRepository,
} from "../testing/index.js";

const digest = (char = "a") => `sha256:${char.repeat(64)}`;
function fixture() {
  const identity: Identity = {
    tenantId: "tenant",
    repositoryId: "repo",
    subject: "runner",
  };
  const request = {
    version: 1 as const,
    requestId: "run-1",
    repositoryId: "repo",
    pullRequest: 42,
  };
  const binding: Binding = {
    repositoryId: "repo",
    pullRequest: 42,
    head: "1".repeat(40),
    base: "2".repeat(40),
    mergeBase: "3".repeat(40),
    verifierId: "trusted-verifier",
    verifierDigest: digest(),
    policyDigest: digest(),
    toolDigest: digest(),
    artifactDigest: digest(),
    lockDigest: digest(),
    historyDigest: digest(),
    scopeDigest: digest(),
    scopes: ["one", "two"],
  };
  const owner: OwnerEvidence = {
    version: 1,
    evidenceId: "approval-1",
    tenantId: "tenant",
    ownerSubject: "owner",
    binding,
    scopes: ["one", "two"],
    decision: "approved",
    sourceDigest: digest(),
    issuedAt: 10,
    expiresAt: 10_000,
    revoked: false,
  };
  const state = {
    now: 100,
    binding: structuredClone(binding) as Binding | null,
    owner: structuredClone(owner) as OwnerEvidence | null,
  };
  const intents = new Map<string, PublicationIntent>();
  const receipts = new InMemoryReceiptRepository();
  const ports: AuthorityPorts = {
    currentAuthority: {
      resolve: async () => {
        if (!state.binding) return null;
        if (!state.owner) throw new AuthorityError("owner-evidence");
        return structuredClone({
          binding: state.binding,
          ownerEvidence: state.owner,
        });
      },
    },
    receipts,
    clock: { now: () => state.now },
    publication: {
      enqueue: async (intent, budget) => {
        budget.assertActive();
        intents.set(intent.intentId, intent);
      },
    },
  };
  const authority = new SdkGrowthAuthority(ports, 1000);
  const completion = (grant: Grant): Completion => ({
    version: 1,
    grantId: grant.grantId,
    fence: grant.fence,
    binding: grant.binding,
    coveredScopes: ["one", "two"],
    coverage: "complete",
    outcome: "passed",
    reportDigest: digest(),
  });
  return {
    identity,
    request,
    binding,
    owner,
    state,
    intents,
    ports,
    authority,
    completion,
  };
}
const rejects = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

describe("RR-1 authority conformance", () => {
  it("derives bindings, issues bounded grants, admits exact coverage and retains one publication intent", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    expect(grant.binding).toEqual(f.binding);
    expect(grant.expiresAt).toBe(1100);
    const receipt = await f.authority.complete(f.identity, f.completion(grant));
    expect(receipt).toMatchObject({
      admitted: true,
      reason: "admitted",
      fence: 1,
      completedAt: 100,
    });
    expect(parseGrant(grant)).toEqual(grant);
    expect(parseReceipt(receipt)).toEqual(receipt);
    await f.authority.dispatch(f.identity, f.request);
    await f.authority.dispatch(f.identity, f.request);
    expect([...f.intents.values()]).toEqual([
      { version: 1, intentId: receipt.receiptId, receipt },
    ]);
    expect(await f.authority.currentReceipt(f.identity, f.request)).toEqual(
      receipt,
    );
  });

  it("returns identical replay across concurrency and service reconstruction", async () => {
    const f = fixture();
    const grants = await Promise.all(
      Array.from({ length: 10 }, () =>
        f.authority.request(f.identity, f.request),
      ),
    );
    expect(
      grants.every(
        (grant) => JSON.stringify(grant) === JSON.stringify(grants[0]),
      ),
    ).toBe(true);
    const grant = grants[0]!;
    const completions = await Promise.all(
      Array.from({ length: 10 }, () =>
        f.authority.complete(f.identity, f.completion(grant)),
      ),
    );
    expect(
      completions.every(
        (receipt) => JSON.stringify(receipt) === JSON.stringify(completions[0]),
      ),
    ).toBe(true);
    const reconstructed = new SdkGrowthAuthority(f.ports, 500);
    f.state.now = 20_000;
    expect(await reconstructed.request(f.identity, f.request)).toEqual(grant);
    expect(
      await reconstructed.complete(f.identity, f.completion(grant)),
    ).toEqual(completions[0]);
    await rejects(
      reconstructed.currentReceipt(f.identity, f.request),
      "expired",
    );
    await rejects(reconstructed.dispatch(f.identity, f.request), "expired");
  });

  it("treats object key order as identical but conflicts on any changed completion body", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    const body = f.completion(grant);
    const receipt = await f.authority.complete(f.identity, body);
    const reordered = Object.fromEntries(Object.entries(body).reverse());
    expect(await f.authority.complete(f.identity, reordered)).toEqual(receipt);
    for (const change of [
      { reportDigest: digest("b") },
      { outcome: "failed" },
      { coverage: "partial" },
      { coveredScopes: ["one"] },
      { fence: 2 },
    ]) {
      await rejects(
        f.authority.complete(f.identity, { ...body, ...change }),
        "conflict",
      );
    }
  });

  it.each(["subject", "tenantId", "repositoryId"] as const)(
    "rejects wrong %s without leaking or consuming a grant",
    async (field) => {
      const f = fixture();
      const grant = await f.authority.request(f.identity, f.request);
      const wrong = { ...f.identity, [field]: "wrong" };
      await expect(
        f.authority.complete(wrong, f.completion(grant)),
      ).rejects.toBeDefined();
      await expect(f.authority.revoke(wrong, f.request)).rejects.toBeDefined();
      await expect(
        f.authority.currentReceipt(wrong, f.request),
      ).rejects.toBeDefined();
      expect(
        (await f.authority.complete(f.identity, f.completion(grant))).admitted,
      ).toBe(true);
    },
  );

  it("rejects a different subject requesting an already issued request ID", async () => {
    const f = fixture();
    await f.authority.request(f.identity, f.request);
    await rejects(
      f.authority.request({ ...f.identity, subject: "other" }, f.request),
      "wrong-identity",
    );
  });

  it.each([
    {
      coverage: "partial",
      coveredScopes: ["one", "two"],
      outcome: "passed",
      reason: "incomplete",
    },
    {
      coverage: "unavailable",
      coveredScopes: [],
      outcome: "passed",
      reason: "incomplete",
    },
    {
      coverage: "complete",
      coveredScopes: ["one"],
      outcome: "passed",
      reason: "incomplete",
    },
    {
      coverage: "complete",
      coveredScopes: ["one", "three", "two"],
      outcome: "passed",
      reason: "incomplete",
    },
    {
      coverage: "complete",
      coveredScopes: ["one", "two"],
      outcome: "failed",
      reason: "failed",
    },
  ])(
    "never admits $coverage / $outcome / $coveredScopes",
    async ({ reason, ...change }) => {
      const f = fixture();
      const grant = await f.authority.request(f.identity, f.request);
      const receipt = await f.authority.complete(f.identity, {
        ...f.completion(grant),
        ...change,
      });
      expect(receipt).toMatchObject({ admitted: false, reason });
      await rejects(
        f.authority.complete(f.identity, f.completion(grant)),
        "conflict",
      );
    },
  );

  it.each([
    "head",
    "base",
    "mergeBase",
    "verifierId",
    "verifierDigest",
    "policyDigest",
    "toolDigest",
    "artifactDigest",
    "lockDigest",
    "historyDigest",
    "scopeDigest",
    "scopes",
    "repositoryId",
    "pullRequest",
  ] as const)("rejects changed server %s on completion", async (key) => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    const value =
      key === "scopes"
        ? ["different"]
        : key === "pullRequest"
          ? 43
          : ["head", "base", "mergeBase"].includes(key)
            ? "4".repeat(40)
            : key.endsWith("Digest")
              ? digest("b")
              : "different";
    f.state.binding = { ...f.binding, [key]: value };
    await rejects(
      f.authority.complete(f.identity, f.completion(grant)),
      "binding-changed",
    );
    f.state.binding = f.binding;
    expect(
      (await f.authority.complete(f.identity, f.completion(grant))).admitted,
    ).toBe(true);
  });

  describe.each(["request", "complete", "currentReceipt", "dispatch"] as const)(
    "%s authority snapshot race",
    (operation) => {
      it.each([
        "head",
        "policyDigest",
        "missing",
        "revoked",
        "replacement",
        "restored",
      ] as const)(
        "rejects %s changes during snapshot resolution without consuming authority",
        async (change) => {
          const f = fixture();
          const grant =
            operation === "request"
              ? null
              : await f.authority.request(f.identity, f.request);
          if (operation !== "complete" && grant)
            await f.authority.complete(f.identity, f.completion(grant));
          let entered!: () => void;
          let release!: () => void;
          const snapshotEntered = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const snapshotReleased = new Promise<void>((resolve) => {
            release = resolve;
          });
          const original = { binding: f.binding, ownerEvidence: f.owner };
          const adapter = new InMemoryCurrentAuthoritySnapshot(
            original,
            async () => {
              entered();
              await snapshotReleased;
            },
          );
          const snapshotPort: CurrentAuthoritySnapshotPort = adapter;
          f.ports.currentAuthority.resolve =
            snapshotPort.resolve.bind(snapshotPort);
          const invoke = () =>
            operation === "complete"
              ? f.authority.complete(f.identity, f.completion(grant!))
              : f.authority[operation](f.identity, f.request);
          const rejected = rejects(invoke(), "binding-changed");
          await snapshotEntered;
          adapter.replace(
            change === "missing"
              ? null
              : {
                  binding:
                    change === "head" || change === "policyDigest"
                      ? {
                          ...f.binding,
                          [change]:
                            change === "head" ? "4".repeat(40) : digest("b"),
                        }
                      : f.binding,
                  ownerEvidence:
                    change === "revoked" || change === "restored"
                      ? { ...f.owner, revoked: true }
                      : change === "replacement"
                        ? { ...f.owner, evidenceId: "replacement" }
                        : f.owner,
                },
          );
          if (change === "restored") adapter.replace(original);
          release();
          await rejected;
          expect(f.intents.size).toBe(0);
          if (operation === "complete") {
            await rejects(
              f.authority.currentReceipt(f.identity, f.request),
              "not-found",
            );
            await rejects(
              f.authority.dispatch(f.identity, f.request),
              "not-found",
            );
          }
          adapter.replace(original);
          const result = await invoke();
          if (operation === "request") {
            expect((result as Grant).fence).toBe(1);
            await f.authority.complete(
              f.identity,
              f.completion(result as Grant),
            );
          }
          if (operation !== "dispatch")
            await f.authority.dispatch(f.identity, f.request);
          expect(f.intents.size).toBe(1);
        },
      );
    },
  );

  describe.each(["request", "complete", "currentReceipt", "dispatch"] as const)(
    "%s unavailable snapshot",
    (operation) => {
      it.each(["missing", "unavailable"])(
        "fails closed for %s and retries",
        async (failure) => {
          const f = fixture();
          const grant =
            operation === "request"
              ? null
              : await f.authority.request(f.identity, f.request);
          if (grant && operation !== "complete")
            await f.authority.complete(f.identity, f.completion(grant));
          const resolve = f.ports.currentAuthority.resolve;
          f.ports.currentAuthority.resolve = async () => {
            if (failure === "unavailable") throw new Error("unavailable");
            return null;
          };
          const invoke = () =>
            operation === "complete"
              ? f.authority.complete(f.identity, f.completion(grant!))
              : f.authority[operation](f.identity, f.request);
          await expect(invoke()).rejects.toBeDefined();
          expect(f.intents.size).toBe(0);
          f.ports.currentAuthority.resolve = resolve;
          const result = await invoke();
          if (operation === "request") {
            expect((result as Grant).fence).toBe(1);
            await f.authority.complete(
              f.identity,
              f.completion(result as Grant),
            );
          }
          if (operation !== "dispatch")
            await f.authority.dispatch(f.identity, f.request);
          expect(f.intents.size).toBe(1);
        },
      );
    },
  );

  it("rejects caller-supplied binding changes and stale fences", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    await rejects(
      f.authority.complete(f.identity, {
        ...f.completion(grant),
        binding: { ...grant.binding, toolDigest: digest("b") },
      }),
      "binding-changed",
    );
    await rejects(
      f.authority.complete(f.identity, { ...f.completion(grant), fence: 9 }),
      "fenced",
    );
    const newer = await f.authority.request(f.identity, {
      ...f.request,
      requestId: "run-2",
    });
    expect(newer.fence).toBe(2);
    await rejects(
      f.authority.complete(f.identity, f.completion(grant)),
      "fenced",
    );
    await f.authority.revoke(f.identity, f.request);
    expect(
      (await f.authority.complete(f.identity, f.completion(newer))).admitted,
    ).toBe(true);
  });

  it("serializes competing grants and admits only the newest fence", async () => {
    const f = fixture();
    const grants = await Promise.all(
      ["a", "b", "c"].map((requestId) =>
        f.authority.request(f.identity, { ...f.request, requestId }),
      ),
    );
    const results = await Promise.allSettled(
      grants.map((grant) =>
        f.authority.complete(f.identity, f.completion(grant)),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
      "fulfilled",
    ]);
  });

  it.each([1100, 1101, 99])(
    "fails closed at expiry and clock rollback: %s",
    async (now) => {
      const f = fixture();
      const grant = await f.authority.request(f.identity, f.request);
      f.state.now = now;
      await rejects(
        f.authority.complete(f.identity, f.completion(grant)),
        "expired",
      );
    },
  );

  it("bounds expiry by owner evidence and checks time after slow reads", async () => {
    const f = fixture();
    f.state.owner = { ...f.owner, expiresAt: 200 };
    const grant = await f.authority.request(f.identity, f.request);
    expect(grant.expiresAt).toBe(200);
    const resolve = f.ports.currentAuthority.resolve;
    f.ports.currentAuthority.resolve = async (...args) => {
      f.state.now = 200;
      return resolve(...args);
    };
    await rejects(
      f.authority.complete(f.identity, f.completion(grant)),
      "owner-evidence",
    );
  });

  it.each([
    { revoked: true },
    { decision: "rejected" },
    { scopes: ["one"] },
    { tenantId: "other" },
    { issuedAt: 101 },
    { expiresAt: 100 },
  ])(
    "requires current exact authenticated owner evidence %j",
    async (change) => {
      const f = fixture();
      f.state.owner = { ...f.owner, ...change } as OwnerEvidence;
      await rejects(
        f.authority.request(f.identity, f.request),
        "owner-evidence",
      );
      f.state.owner = f.owner;
      const grant = await f.authority.request(f.identity, f.request);
      f.state.owner = { ...f.owner, ...change } as OwnerEvidence;
      await rejects(
        f.authority.complete(f.identity, f.completion(grant)),
        "owner-evidence",
      );
    },
  );

  it("cannot substitute a new owner approval or missing authority", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    f.state.owner = { ...f.owner, evidenceId: "replacement" };
    await rejects(
      f.authority.complete(f.identity, f.completion(grant)),
      "owner-evidence",
    );
    f.state.owner = null;
    await rejects(
      f.authority.complete(f.identity, f.completion(grant)),
      "owner-evidence",
    );
    f.state.binding = null;
    await rejects(
      f.authority.complete(f.identity, f.completion(grant)),
      "binding-changed",
    );
  });

  it("retains historical replay after revocation but denies current authority and dispatch", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    const receipt = await f.authority.complete(f.identity, f.completion(grant));
    await f.authority.revoke(f.identity, f.request);
    await f.authority.revoke(f.identity, f.request);
    expect(await f.authority.complete(f.identity, f.completion(grant))).toEqual(
      receipt,
    );
    expect(await f.authority.request(f.identity, f.request)).toEqual(grant);
    await rejects(f.authority.currentReceipt(f.identity, f.request), "revoked");
    await rejects(f.authority.dispatch(f.identity, f.request), "revoked");
    expect(f.intents.size).toBe(0);
  });

  it("does not dispatch a receipt after a canonical revision change", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    await f.authority.complete(f.identity, f.completion(grant));
    f.state.binding = { ...f.binding, head: "4".repeat(40) };
    await rejects(
      f.authority.dispatch(f.identity, f.request),
      "binding-changed",
    );
    await rejects(
      f.authority.currentReceipt(f.identity, f.request),
      "binding-changed",
    );
  });

  it("retains completion across failed outbox handoff and retries with the same idempotency key", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    const receipt = await f.authority.complete(f.identity, f.completion(grant));
    const enqueue = f.ports.publication.enqueue;
    f.ports.publication.enqueue = async (intent, budget) => {
      await enqueue(intent, budget);
      throw new Error("lost acknowledgement");
    };
    await expect(f.authority.dispatch(f.identity, f.request)).rejects.toThrow(
      "lost acknowledgement",
    );
    f.ports.publication.enqueue = enqueue;
    await f.authority.dispatch(f.identity, f.request);
    expect(f.intents.size).toBe(1);
    expect(await f.authority.complete(f.identity, f.completion(grant))).toEqual(
      receipt,
    );
  });

  it("does not persist mutations through returned references or failed transactions", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    (grant.binding.scopes as string[]).push("tampered");
    expect(
      (await f.authority.request(f.identity, f.request)).binding.scopes,
    ).toEqual(["one", "two"]);
    const scope = { tenantId: "tenant", repositoryId: "repo", pullRequest: 42 };
    await expect(
      f.ports.receipts.transact(scope, { requestId: "request" }, async (ledger) => {
        ledger.fence = 99;
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    const next = await f.authority.request(f.identity, {
      ...f.request,
      requestId: "next",
    });
    expect(next.fence).toBe(2);
  });
});

it("rejects revocation before completion without consuming a receipt", async () => {
  const f = fixture();
  const grant = await f.authority.request(f.identity, f.request);
  await f.authority.revoke(f.identity, f.request);
  await rejects(
    f.authority.complete(f.identity, f.completion(grant)),
    "revoked",
  );
  await rejects(f.authority.dispatch(f.identity, f.request), "not-found");
  expect(f.intents.size).toBe(0);
});

describe("closed contracts", () => {
  it("rejects extra keys, unknown versions, malformed identifiers and noncanonical sets", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    const receipt = await f.authority.complete(f.identity, f.completion(grant));
    for (const [parse, value] of [
      [parseRequest, f.request],
      [parseGrant, grant],
      [parseOwnerEvidence, f.owner],
      [parseCompletion, f.completion(grant)],
      [parseReceipt, receipt],
    ] as const) {
      expect(() => parse({ ...value, source: "untrusted" })).toThrow(
        "invalid-contract",
      );
      expect(() => parse({ ...value, version: 2 })).toThrow("invalid-contract");
      expect(() => parse(null)).toThrow("invalid-contract");
    }
    for (const change of [
      { head: "not-a-sha" },
      { policyDigest: "sha256:A".repeat(64) },
      { scopes: ["two", "one"] },
      { scopes: ["one", "one"] },
      { scopes: [] },
    ]) {
      expect(() =>
        parseCompletion({
          ...f.completion(grant),
          binding: { ...f.binding, ...change },
        }),
      ).toThrow("invalid-contract");
    }
    expect(() => parseRequest({ ...f.request, pullRequest: 1.5 })).toThrow(
      "invalid-contract",
    );
    expect(() =>
      parseRequest({ ...f.request, requestId: "../escape" }),
    ).toThrow("invalid-contract");
    await rejects(
      f.authority.request(f.identity, { ...f.request, binding: f.binding }),
      "invalid-contract",
    );
  });
});

describe("detached validation snapshot", () => {
  it("clones the entire nested graph exactly once", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      const parsed = parseGrant(grant);
      expect(clone).toHaveBeenCalledTimes(1);
      expect(parsed).toBe(clone.mock.results[0]?.value);
      expect(parsed).not.toBe(grant);
    } finally {
      clone.mockRestore();
    }
  });

  it("rejects getters without invoking them across every public parser", async () => {
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    const receipt = await f.authority.complete(f.identity, f.completion(grant));
    const cases: [(value: unknown) => unknown, object, string, unknown][] = [
      [parseIdentity, f.identity, "subject", "runner"],
      [parseRequest, f.request, "pullRequest", 42],
      [parseBinding, f.binding, "head", f.binding.head],
      [parseOwnerEvidence, f.owner, "revoked", false],
      [parseCompletion, f.completion(grant), "fence", 1],
      [parseGrant, grant, "fence", 1],
      [parseReceipt, receipt, "admitted", true],
    ];
    for (const [parse, original, key, valid] of cases) {
      let reads = 0;
      const input = {
        ...original,
        get [key]() {
          return ++reads === 1 ? valid : null;
        },
      };
      expect(() => parse(input)).toThrow("invalid-contract");
      expect(reads).toBe(0);
      const invalid = {
        ...original,
        get [key]() {
          return null;
        },
      };
      expect(() => parse(invalid)).toThrow(
        new AuthorityError("invalid-contract"),
      );
      const throwing = {
        ...original,
        get [key]() {
          throw new Error("getter");
        },
      };
      expect(() => parse(throwing)).toThrow(
        new AuthorityError("invalid-contract"),
      );
      expect(() => parse({ ...original, [key]: () => {} })).toThrow(
        new AuthorityError("invalid-contract"),
      );
    }
  });

  it.each([
    "symbol",
    "hidden",
    "prototype",
    "accessor",
    "array-accessor",
    "array-extra",
    "sparse",
    "cycle",
  ] as const)("rejects nested source shape: %s", (shape) => {
    const f = fixture();
    const input = structuredClone(f.owner);
    const getter = vi.fn(() => "one");
    switch (shape) {
      case "symbol":
        Object.defineProperty(input.binding, Symbol("extra"), { value: true });
        break;
      case "hidden":
        Object.defineProperty(input.binding, "extra", { value: true });
        break;
      case "prototype":
        Object.setPrototypeOf(input.binding, { custom: true });
        break;
      case "accessor":
        Object.defineProperty(input.binding, "head", { get: getter });
        break;
      case "array-accessor":
        Object.defineProperty(input.scopes, "0", { get: getter });
        break;
      case "array-extra":
        Object.assign(input.scopes, { extra: true });
        break;
      case "sparse":
        Object.assign(input, { scopes: new Array(2) });
        break;
      case "cycle":
        Object.assign(input.binding, { scopes: [input] });
        break;
    }
    expect(() => parseOwnerEvidence(input)).toThrow("invalid-contract");
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects nested mutations during cloning and never returns caller aliases", () => {
    const f = fixture();
    const input = {
      ...f.owner,
      get binding() {
        return {
          ...f.binding,
          get scopes() {
            return ["two", "one"];
          },
        };
      },
    };
    expect(() => parseOwnerEvidence(input)).toThrow(
      new AuthorityError("invalid-contract"),
    );
    const mutable = structuredClone(f.owner);
    const output = parseOwnerEvidence(mutable);
    Object.assign(mutable.binding, { head: "bad" });
    expect(output.binding.head).toBe(f.binding.head);
    expect(output.binding).not.toBe(mutable.binding);
    expect(output.scopes).not.toBe(mutable.scopes);
    expect(() => parseRequest(new Proxy(f.request, {}))).toThrow(
      new AuthorityError("invalid-contract"),
    );
  });

  it("validates nested fields after later getters mutate already captured source objects", () => {
    const f = fixture();
    const binding = structuredClone(f.binding);
    const input = {
      ...f.owner,
      binding,
      get revoked() {
        Object.assign(binding, { head: "invalid" });
        return false;
      },
    };
    expect(() => parseOwnerEvidence(input)).toThrow("invalid-contract");
    expect(binding.head).toBe(f.binding.head);
  });
});

describe("bounded transaction I/O", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["request", "complete", "currentReceipt", "dispatch"] as const)(
    "times out %s resolution, releases the scope, and ignores late resolution",
    async (method) => {
      vi.useFakeTimers();
      const f = fixture();
      const grant = await f.authority.request(f.identity, f.request);
      if (method === "currentReceipt" || method === "dispatch")
        await f.authority.complete(f.identity, f.completion(grant));
      const original = f.ports.currentAuthority.resolve;
      let finish!: (value: Awaited<ReturnType<typeof original>>) => void;
      let signal!: AbortSignal;
      f.ports.currentAuthority.resolve = (_identity, _request, budget) => {
        signal = budget.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      };
      const body =
        method === "complete"
          ? f.completion(grant)
          : {
              ...f.request,
              requestId: method === "request" ? "run-2" : "run-1",
            };
      const pending = f.authority[method](f.identity, body);
      const rejected = expect(pending).rejects.toMatchObject({
        code: "io-timeout",
        effect: "none",
      });
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
      expect(signal.aborted).toBe(true);
      f.ports.currentAuthority.resolve = original;
      const next = await f.authority.request(f.identity, {
        ...f.request,
        requestId: "run-3",
      });
      expect(next.fence).toBe(2);
      finish({ binding: f.binding, ownerEvidence: f.owner });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.intents.size).toBe(0);
      if (method === "request" || method === "complete")
        await rejects(
          f.authority.complete(f.identity, f.completion(grant)),
          "fenced",
        );
      else
        await rejects(
          f.authority.currentReceipt(f.identity, f.request),
          "fenced",
        );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["before", "after"] as const)(
    "allows late enqueue %s retry without duplicate effects or ledger mutation",
    async (order) => {
      vi.useFakeTimers();
      const f = fixture();
      const grant = await f.authority.request(f.identity, f.request);
      await f.authority.complete(f.identity, f.completion(grant));
      const scope = {
        tenantId: "tenant",
        repositoryId: "repo",
        pullRequest: 42,
      };
      const ledger = () =>
        f.ports.receipts.transact(scope, async (draft) => draft);
      const before = await ledger();
      let release!: () => void;
      const paused = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ids: string[] = [];
      let late!: Promise<void>;
      let signal!: AbortSignal;
      const commit = (intent: PublicationIntent) => {
        if (!f.intents.has(intent.intentId))
          f.intents.set(intent.intentId, structuredClone(intent));
      };
      f.ports.publication.enqueue = (intent, budget) => {
        ids.push(intent.intentId);
        signal = budget.signal;
        late = paused.then(() => {
          commit(intent);
          // Even a retained adapter argument cannot change the ledger.
          Object.assign(intent.receipt, { admitted: false });
        });
        return late;
      };
      const rejected = expect(
        f.authority.dispatch(f.identity, f.request),
      ).rejects.toMatchObject({ code: "io-timeout", effect: "unknown" });
      await vi.advanceTimersByTimeAsync(5_000);
      await rejected;
      expect(signal.aborted).toBe(true);
      expect(await ledger()).toEqual(before); // Scope is released while enqueue waits.
      f.ports.publication.enqueue = async (intent) => {
        ids.push(intent.intentId);
        commit(intent);
      };
      if (order === "before") {
        release();
        await late;
        expect(await ledger()).toEqual(before); // No late dispatched/receipt changes.
      }
      await f.authority.dispatch(f.identity, f.request);
      const dispatched = await ledger();
      expect(dispatched.records[0]?.dispatched).toBe(true);
      release();
      await late;
      expect(await ledger()).toEqual(dispatched);
      await f.authority.dispatch(f.identity, f.request);
      expect(ids).toEqual([
        before.records[0]!.intent!.intentId,
        before.records[0]!.intent!.intentId,
      ]);
      expect(f.intents.size).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("retries an effect committed before timeout with a lost acknowledgement", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    await f.authority.complete(f.identity, f.completion(grant));
    const enqueue = f.ports.publication.enqueue;
    let finish!: () => void;
    f.ports.publication.enqueue = async (intent, budget) => {
      await enqueue(intent, budget);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    };
    const rejected = rejects(
      f.authority.dispatch(f.identity, f.request),
      "io-timeout",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(f.intents.size).toBe(1);
    f.ports.publication.enqueue = enqueue;
    await f.authority.dispatch(f.identity, f.request);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.intents.size).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 1.5, NaN, Infinity, 60_001])(
    "rejects invalid I/O timeout %s",
    (timeout) => {
      expect(
        () => new SdkGrowthAuthority(fixture().ports, 1000, timeout),
      ).toThrow(new AuthorityError("invalid-contract"));
    },
  );

  it("cleans up synchronous port failures and honors a configured timeout", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const authority = new SdkGrowthAuthority(f.ports, 1000, 10);
    f.ports.currentAuthority.resolve = () => {
      throw new Error("unavailable");
    };
    await expect(authority.request(f.identity, f.request)).rejects.toThrow(
      "unavailable",
    );
    expect(vi.getTimerCount()).toBe(0);
    f.ports.currentAuthority.resolve = () => new Promise(() => {});
    const rejected = rejects(
      authority.request(f.identity, f.request),
      "io-timeout",
    );
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects expired budgets even before the timer callback runs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const f = fixture();
    const grant = await f.authority.request(f.identity, f.request);
    await f.authority.complete(f.identity, f.completion(grant));
    f.ports.publication.enqueue = async (intent, budget) => {
      vi.spyOn(performance, "now").mockReturnValue(6_000);
      budget.assertActive();
      f.intents.set(intent.intentId, intent);
    };
    await rejects(f.authority.dispatch(f.identity, f.request), "io-timeout");
    expect(f.intents.size).toBe(0);
    vi.restoreAllMocks();
    expect(vi.getTimerCount()).toBe(0);
  });
});
