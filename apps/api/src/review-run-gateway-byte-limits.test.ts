import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import type * as c from "@agent-teams/account-gateway/contracts";
import {
  canonicalJson,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  type ReviewRunAuthorization,
  type ReviewRunGatewayExecutionBinding,
} from "@reviewrouter/features-review-run-control";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { createReviewRunGatewayPreparation } from "./review-run-gateway-preparation";
import { createReviewRunGatewayRelay } from "./review-run-gateway-relay";

const MiB = 1024 * 1024;
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(
  outputBytes: number,
  streamBytes = 0,
  maxSessions = 2,
  requestTimeoutMs = 5000,
) {
  const deadline = new Date(Date.now() + 120_000).toISOString();
  const limits = {
    requests: 128,
    concurrency: 1,
    requestBytes: 4096,
    outputBytes,
    tokens: 32768,
  };
  const gateway = {
    providerIndex: 0,
    bindingId: "binding-1",
    connectionId: "connection-1",
    bindingRevision: 1,
    policySubject: "binding-1",
    policyRevision: 1,
    permittedAccountRef: "account-1",
    profileRef: "profile-1",
    invocationId: "invocation-1",
    attemptId: "attempt-1",
    operationId: "operation-1",
    limits,
  };
  const identity = {
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "scm-1",
    pullRequestNumber: 1,
    sourceRunId: "run-1",
    sourceRunAttempt: "1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBaseSha: "b".repeat(40),
    reviewRevisionHash: "c".repeat(64),
    workflowIdentityHash: "d".repeat(64),
    trustDomain: ReviewTrustDomain.TrustedManaged,
  };
  const config = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        fastMode: false,
        agenticContext: true,
        requiredHealthy: true,
        gatewayBindingId: gateway.bindingId,
        gatewayProfileRef: gateway.profileRef,
      },
    ],
    execution: {
      providerLimit: 1,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    },
  });
  const canonical = (id: string) =>
    canonicalJson({
      snapshotVersion: 3,
      configurationSource: "workspace",
      configurationVersion: 1,
      workspaceConfigurationVersion: 1,
      repositoryConfigurationVersion: null,
      effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
      agent: {
        profileRef: "codex-default",
        agentKind: "codex",
        binarySha256: "a".repeat(64),
        packageVersion: "0.147.0",
        modelTransports: ["account_gateway"],
        contextGateway: true,
        cancellation: true,
      },
      agentProfileDigest: "b".repeat(64),
      producer: {
        producerReleaseId: "release-1",
        actionCommitSha: "c".repeat(40),
        runtimeCommitSha: "d".repeat(40),
      },
      configurationCanonicalJson: canonicalJson(config),
      deadline,
      gateway: {
        ...gateway,
        invocationId: `invocation-${id}`,
        attemptId: `attempt-${id}`,
        operationId: `operation-${id}`,
      },
    });
  const revoked = new Set<string>();
  const overrides = new Map<string, Partial<ReviewRunAuthorization>>();
  const lookupFailures = new Set<string>();
  const lookups: string[] = [];
  const authorization = (id = "authorization-1") =>
    ({
      ...identity,
      sourceRunId: `run-${id}`,
      authorizationId: id,
      state: !revoked.has(id)
        ? ReviewRunAuthorizationState.Active
        : ReviewRunAuthorizationState.Revoked,
      expiresAt: new Date(deadline),
      maxExpiresAt: new Date(deadline),
      runtimeSnapshotCanonicalJson: canonical(id),
      ...overrides.get(id),
    }) as ReviewRunAuthorization;
  const savedBindings = new Map<string, ReviewRunGatewayExecutionBinding>();
  const bindings = {
    read: async (owner: { authorizationId: string }) => ({
      status: "live" as const,
      binding: savedBindings.get(owner.authorizationId) ?? null,
    }),
    attach: async (
      owner: { authorizationId: string },
      value: ReviewRunGatewayExecutionBinding,
    ) => {
      savedBindings.set(owner.authorizationId, value);
      return { status: "attached" as const, binding: value };
    },
  };
  const snapshots = { capture: async () => null, isLive: async () => true };
  const nativeExecutions = new Map<string, "active" | "closed">();
  const nativeCloses: string[] = [];
  let closeState: "applied" | "unknown" = "applied";
  let closeGate: Promise<void> | undefined;
  let closeStarted: (() => void) | undefined;
  let prepareGate: Promise<void> | undefined;
  let prepareStarted: (() => void) | undefined;
  let prepareFailure = false;
  const intents: c.Prepare[] = [];
  const admissions: c.Admission[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    if (req.url === "/internal/v1/run-access") {
      const intent = JSON.parse(raw) as c.Prepare;
      intents.push(intent);
      const executionRef = `execution-${intent.operationId}`;
      nativeExecutions.set(executionRef, "active");
      prepareStarted?.();
      await prepareGate;
      if (prepareFailure) {
        res.writeHead(503).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          operation: {
            operationRef: intent.operationId,
            state: "applied",
            result: {
              kind: "execution",
              executionRef,
              accountRef: "account-1",
              authorizationEpoch: 1,
              deadline,
              state: "active",
            },
          },
          bearer: "local-execution-token",
          admission: {
            invocationRef: intent.invocationRef,
            attemptRef: intent.attemptRef,
            accountRef: "account-1",
            authorizationEpoch: 1,
            subjectRef: intent.subjectRef,
            policyRevision: intent.policyRevision,
            bindingRevision: intent.bindingRevision,
            profileId: intent.profileId,
            limits: intent.limits,
            expiresAt: deadline,
          },
        }),
      );
      return;
    }
    const execution = /^\/v1\/executions\/([^/]+)\/(requests|close)$/.exec(
      req.url ?? "",
    );
    if (execution?.[2] === "requests") {
      admissions.push(JSON.parse(String(req.headers["x-gateway-admission"])));
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "x-gateway-request-ref": String(req.headers["x-gateway-request-id"]),
      });
      let remaining = streamBytes;
      while (remaining > 0 && !res.destroyed) {
        const size = Math.min(32768, remaining);
        remaining -= size;
        // Valid SSE comment frames remain small; total raw delivery exceeds
        // 1MiB without building a response-sized buffer in either process.
        const chunk =
          size >= 3
            ? Buffer.from(`:${"x".repeat(size - 3)}\n\n`)
            : Buffer.alloc(size, 120);
        if (!res.write(chunk))
          await new Promise<void>((resolve) => {
            const done = () => {
              res.removeListener("drain", done);
              res.removeListener("close", done);
              res.removeListener("error", done);
              resolve();
            };
            res.once("drain", done);
            res.once("close", done);
            res.once("error", done);
          });
      }
      if (!res.destroyed) res.end();
      return;
    }
    if (execution?.[2] === "close") {
      nativeCloses.push(execution[1]!);
      closeStarted?.();
      await closeGate;
      if (closeState === "applied")
        nativeExecutions.set(execution[1]!, "closed");
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          operationRef: JSON.parse(raw).operationId,
          state: closeState,
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const runAccess = {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    runControlBearer: "local-control-token",
    timeoutMs: 5000,
  };
  const queries = {
    findReviewRunAuthorizationById: async (id: string) => {
      lookups.push(id);
      if (lookupFailures.has(id)) throw Error("authorization_read_failed");
      return authorization(id);
    },
  };
  const preparation = createReviewRunGatewayPreparation({
    authorizationId: "authorization-1",
    identity: authorization(),
    runAccess,
    authorizations: queries as never,
    snapshots,
    bindings,
  });
  const relay = createReviewRunGatewayRelay({
    policy: {
      profiles: [
        {
          profile: {
            profileId: "profile-1",
            protocol: "openai-responses",
            modelIds: ["gpt-5.6-sol"],
            authKinds: ["oauth"],
          },
          outputTokens: 32768,
        },
      ],
      ingressBytes: 4096,
      requestTimeoutMs,
      waitBudgetMs: 0,
      maxWaits: 0,
      maxSessions,
      maxInFlight: 2,
    },
    runAccess,
    authorizations: {
      resolveReviewRunAuthorizationToken: async ({ token }) => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization: authorization(
          token === "local-authorization-token" ? undefined : token,
        ),
      }),
      expireOrRevokeReviewRunAuthorization: async ({
        authorizationId,
        state,
      }) => {
        const current = authorization(authorizationId).state;
        if (current !== ReviewRunAuthorizationState.Active && current !== state)
          throw Error("authorization_terminal_state_conflict");
        revoked.add(authorizationId);
        return {} as never;
      },
    },
    queries: queries as never,
    checkAuthority: async (auth) => !revoked.has(auth.authorizationId),
    confirmAuthority: async (_token, auth) =>
      !revoked.has(auth.authorizationId),
    snapshots,
    bindings,
  });
  return {
    preparation,
    relay,
    intents,
    admissions,
    limits,
    nativeExecutions,
    nativeCloses,
    authorization,
    overrides,
    lookupFailures,
    lookups,
    revoke(id: string) {
      revoked.add(id);
    },
    setCloseState(state: typeof closeState) {
      closeState = state;
    },
    setPrepareFailure() {
      prepareFailure = true;
    },
    holdPrepare() {
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        prepareStarted = resolve;
      });
      prepareGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { started, release };
    },
    holdClose() {
      let release!: () => void;
      const started = new Promise<void>((resolve) => {
        closeStarted = resolve;
      });
      closeGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { started, release };
    },
    async completeExternally(id: string) {
      revoked.add(id);
      const binding = savedBindings.get(id)!;
      const response = await fetch(
        `${runAccess.origin}/v1/executions/${binding.executionRef}/close`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operationId: `external-close-${id}`,
            reason: "completed",
          }),
        },
      );
      expect(await response.json()).toMatchObject({ state: "applied" });
    },
  };
}

it.each([
  [MiB, MiB, true],
  [8 * MiB, MiB + 128, true],
  [8 * MiB, 8 * MiB + 1, false],
] as const)(
  "keeps captured raw SSE budget %i with %i streamed bytes",
  async (cap, bytes, accepted) => {
    const f = await fixture(cap, bytes);
    try {
      const response = await f.relay.responses(
        "local-authorization-token",
        new TextEncoder().encode(
          JSON.stringify({
            model: "gpt-5.6-sol",
            input: [],
            stream: true,
            max_output_tokens: 32768,
          }),
        ),
        new AbortController(),
      );
      if (response.kind !== "stream") throw Error("expected_stream");
      const consume = async () => {
        let received = 0;
        for await (const chunk of response.body) received += chunk.byteLength;
        return received;
      };
      if (accepted) expect(await consume()).toBe(bytes);
      else await expect(consume()).rejects.toBeDefined();
      expect(f.intents).toHaveLength(1);
      expect(f.admissions).toHaveLength(1);
      expect(f.intents[0]?.limits).toEqual(f.limits);
      expect(f.admissions[0]?.limits).toEqual(f.limits);
    } finally {
      await f.relay.shutdown();
    }
  },
  10000,
);

it("rejects unsupported captured output before run-access or inference", async () => {
  const f = await fixture(8 * MiB + 1);
  try {
    await expect(f.preparation.prepare()).rejects.toMatchObject({
      code: "invalid_input",
      effect: "not_dispatched",
    });
    await expect(
      f.relay.responses(
        "local-authorization-token",
        new TextEncoder().encode(
          JSON.stringify({
            model: "gpt-5.6-sol",
            input: [],
            stream: true,
            max_output_tokens: 32768,
          }),
        ),
        new AbortController(),
      ),
    ).rejects.toMatchObject({
      code: "gateway_unavailable",
      statusCode: 403,
      effect: "not_dispatched",
    });
    expect(f.intents).toHaveLength(0);
    expect(f.admissions).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

it("admits a new run after four streamed runs are externally revoked and natively closed", async () => {
  const f = await fixture(MiB, 0, 4);
  try {
    const completed = [1, 2, 3, 4].map((i) => `authorization-${i}`);
    for (const id of completed) {
      expect(await streamRun(f, id)).toBe("stream");
      await f.completeExternally(id);
    }
    expect(completed.map((id) => f.authorization(id).state)).toEqual(
      Array(4).fill("revoked"),
    );
    expect([...f.nativeExecutions.values()]).toEqual(Array(4).fill("closed"));
    expect(f.nativeCloses).toHaveLength(4);
    expect(f.intents).toHaveLength(4);
    expect(f.admissions).toHaveLength(4);
    // The fifth run is valid and has never prepared. Completed streams alone do
    // not inform the relay that another control-plane owner closed these runs.
    expect(f.authorization("authorization-5").state).toBe("active");
    await expect(streamRun(f, "authorization-5")).resolves.toBe("stream");
    expect(f.intents).toHaveLength(5);
    expect(f.admissions).toHaveLength(5);
  } finally {
    await f.relay.shutdown();
  }
});

async function streamRun(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  const body = new TextEncoder().encode(
    JSON.stringify({
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      max_output_tokens: 32768,
    }),
  );
  const response = await f.relay.responses(id, body, new AbortController());
  if (response.kind !== "stream") throw Error("expected_stream");
  for await (const _chunk of response.body) {
    expect(_chunk.byteLength).toBeGreaterThan(0);
  }
  return response.kind;
}

it.each(["active", "different_identity", "read_failure"] as const)(
  "retains a capacity session with %s authority",
  async (mode) => {
    const f = await fixture(MiB, 0, 1);
    try {
      await streamRun(f, "authorization-1");
      if (mode === "active") {
        // A renewable short TTL alone is not the immutable run deadline.
        f.overrides.set("authorization-1", { expiresAt: new Date(0) });
      } else {
        f.revoke("authorization-1");
        if (mode === "different_identity")
          f.overrides.set("authorization-1", { sourceRunId: "another-run" });
        else f.lookupFailures.add("authorization-1");
      }
      await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
        code: "relay_saturated",
        effect: "not_dispatched",
      });
      expect(f.nativeCloses).toHaveLength(0);
      expect(f.intents).toHaveLength(1);
      expect(f.admissions).toHaveLength(1);
    } finally {
      f.lookupFailures.clear();
      await f.relay.shutdown();
    }
  },
);

it("retains an unknown native close and denies the old run without replay", async () => {
  const f = await fixture(MiB, 0, 1);
  try {
    await streamRun(f, "authorization-1");
    f.revoke("authorization-1");
    f.setCloseState("unknown");
    await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
      code: "relay_saturated",
      effect: "not_dispatched",
    });
    expect(f.nativeCloses).toHaveLength(1);
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
    await expect(streamRun(f, "authorization-1")).rejects.toMatchObject({
      code: "authorization_denied",
    });
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});

it("shares one close under concurrent capacity pressure and admits at most one new run", async () => {
  const f = await fixture(MiB, 0, 1);
  let release: (() => void) | undefined;
  try {
    await streamRun(f, "authorization-1");
    f.revoke("authorization-1");
    const gate = f.holdClose();
    release = gate.release;
    const first = streamRun(f, "authorization-2");
    await gate.started;
    const second = streamRun(f, "authorization-3");
    // Resolve is asynchronous; the second admission reaches the same cleanup
    // while its native acknowledgement is deliberately held at the boundary.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.nativeCloses).toHaveLength(1);
    gate.release();
    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toMatchObject([
      { reason: { code: "relay_saturated" } },
    ]);
    expect(f.intents).toHaveLength(2);
    expect(f.admissions).toHaveLength(2);
    expect(f.nativeCloses).toHaveLength(1);
  } finally {
    release?.();
    await f.relay.shutdown();
  }
});

it("bounds a capacity scan and advances fairly past active sessions", async () => {
  const f = await fixture(MiB, 0, 4);
  try {
    for (let i = 1; i <= 4; i++) await streamRun(f, `authorization-${i}`);
    f.revoke("authorization-4");
    f.lookups.length = 0;
    await expect(streamRun(f, "authorization-5")).rejects.toMatchObject({
      code: "relay_saturated",
    });
    expect(f.lookups).toEqual(["authorization-1", "authorization-2"]);
    expect(f.nativeCloses).toHaveLength(0);
    await expect(streamRun(f, "authorization-5")).resolves.toBe("stream");
    expect(f.nativeCloses).toEqual(["execution-operation-authorization-4"]);
    expect(f.intents).toHaveLength(5);
    expect(f.admissions).toHaveLength(5);
  } finally {
    await f.relay.shutdown();
  }
});

it("bounds an unresponsive pressure close without freeing its uncertain slot", async () => {
  const f = await fixture(MiB, 0, 1, 100);
  let release: (() => void) | undefined;
  try {
    await streamRun(f, "authorization-1");
    f.revoke("authorization-1");
    const gate = f.holdClose();
    release = gate.release;
    const started = Date.now();
    await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
      code: "relay_saturated",
      effect: "not_dispatched",
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(f.nativeCloses).toHaveLength(1);
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(1);
  } finally {
    release?.();
    await f.relay.shutdown();
  }
});

it("aborts a pending-prepare close wait while retaining its eventual native capability", async () => {
  const f = await fixture(MiB);
  const gate = f.holdPrepare();
  let prepared: ReturnType<typeof f.preparation.prepare> | undefined;
  try {
    prepared = f.preparation.prepare();
    await gate.started;
    expect(f.preparation.isPreparing()).toBe(true);
    await expect(
      f.preparation.close("cancelled", { signal: AbortSignal.timeout(50) }),
    ).rejects.toMatchObject({ effect: "effect_unknown" });
    expect(f.preparation.isPreparing()).toBe(true);
    expect(f.nativeCloses).toHaveLength(0);
    gate.release();
    await prepared;
    await expect(f.preparation.close("cancelled")).resolves.toMatchObject({
      state: "applied",
    });
    expect(f.nativeCloses).toHaveLength(1);
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(0);
  } finally {
    gate.release();
    await prepared;
    await f.relay.shutdown();
  }
});

it("preserves an expired authorization terminal state during pressure cleanup", async () => {
  const f = await fixture(MiB, 0, 1);
  try {
    await streamRun(f, "authorization-1");
    f.overrides.set("authorization-1", {
      state: ReviewRunAuthorizationState.Expired,
    });
    await expect(streamRun(f, "authorization-2")).resolves.toBe("stream");
    expect(f.nativeCloses).toHaveLength(1);
    expect(f.intents).toHaveLength(2);
  } finally {
    await f.relay.shutdown();
  }
});

it("releases a provably unstarted revoked session after malformed input", async () => {
  const f = await fixture(MiB, 0, 1);
  try {
    await expect(
      f.relay.responses(
        "authorization-1",
        new TextEncoder().encode("{"),
        new AbortController(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    f.revoke("authorization-1");
    expect(f.intents).toHaveLength(0);
    await expect(streamRun(f, "authorization-2")).resolves.toBe("stream");
  } finally {
    await f.relay.shutdown();
  }
});

it("releases an unstarted revoked status session without calling native close", async () => {
  const f = await fixture(MiB, 0, 1);
  try {
    await expect(
      f.relay.status("authorization-1", "request-1"),
    ).rejects.toMatchObject({ code: "same_operation_recovery_required" });
    f.revoke("authorization-1");
    expect(f.intents).toHaveLength(0);
    await expect(streamRun(f, "authorization-2")).resolves.toBe("stream");
    expect(f.intents).toHaveLength(1);
    expect(f.nativeCloses).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

it("retains a lost Prepare result and never retries it during capacity cleanup", async () => {
  const f = await fixture(MiB, 0, 1);
  try {
    f.setPrepareFailure();
    await expect(streamRun(f, "authorization-1")).rejects.toBeDefined();
    f.revoke("authorization-1");
    await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
      code: "relay_saturated",
    });
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(0);
    expect(f.nativeCloses).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

it("does not wait for an already pending explicit close under capacity pressure", async () => {
  const f = await fixture(MiB, 0, 1);
  let release: (() => void) | undefined;
  let closing: ReturnType<typeof f.relay.closeRun> | undefined;
  try {
    await streamRun(f, "authorization-1");
    const gate = f.holdClose();
    release = gate.release;
    closing = f.relay.closeRun("authorization-1", "completed");
    await gate.started;
    const started = Date.now();
    await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
      code: "relay_saturated",
    });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(f.nativeCloses).toHaveLength(1);
    expect(f.intents).toHaveLength(1);
  } finally {
    release?.();
    await closing;
    await f.relay.shutdown();
  }
});
