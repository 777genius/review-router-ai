import { createServer, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { setImmediate } from "node:timers/promises";
import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import type * as c from "@agent-teams/account-gateway/contracts";
import {
  canonicalJson,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  ReviewRunCompanionDispatchFailure,
  type ReviewRunCompanionDispatchAdmission,
  type ReviewRunModelDispatchAdmission,
  type ReviewRunCompanionDispatch,
  type ReviewRunAuthorization,
  type ReviewRunGatewayExecutionBinding,
} from "@reviewrouter/features-review-run-control";
import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
  lifecycleVerificationDescriptorDigestV2,
  type ReviewCompanionDispatchContextV1,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { createReviewRunGatewayPreparation } from "./review-run-gateway-preparation";
import {
  createReviewRunGatewayRelay,
  createReviewRunGatewayTerminalGate,
  prepareReviewRunGatewayResponses,
  registerReviewRunGatewayRelayRoutes,
} from "./review-run-gateway-relay";

const MiB = 1024 * 1024;

function companionReservation(
  role: ReviewRunCompanionDispatch["role"] = "lifecycle_verification",
) {
  const rows = new Map<string, ReviewRunCompanionDispatch>();
  let claims = 0;
  const admission: ReviewRunCompanionDispatchAdmission = {
    async claim(auth, context, providerRequestEnvelopeHash) {
      claims++;
      const existing = rows.get(context.dispatchId);
      if (existing) {
        if (
          existing.providerRequestEnvelopeHash !== providerRequestEnvelopeHash
        )
          throw new ReviewRunCompanionDispatchFailure(
            "companion_dispatch_conflict",
          );
        return {
          status: "restored",
          dispatch: existing,
          notAfter: new Date(Date.now() + 120000),
        };
      }
      if (
        [...rows.values()].some((row) => row.workSlotId === context.workSlotId)
      )
        throw new ReviewRunCompanionDispatchFailure(
          "companion_slot_already_claimed",
        );
      const dispatch: ReviewRunCompanionDispatch = {
        authorizationId: auth.authorizationId,
        dispatchId: context.dispatchId,
        executionId: context.executionId,
        workSlotId: context.workSlotId,
        attemptOrdinal: context.attemptOrdinal,
        leaseId: context.leaseId,
        fencingToken: BigInt(context.fencingToken),
        preparedManifestKey: context.preparedManifestKey,
        providerRequestEnvelopeHash,
        nativeRequestRef: "stored-companion-native-ref",
        role,
        state: "dispatch_may_have_started",
      };
      rows.set(context.dispatchId, dispatch);
      return {
        status: "claimed",
        dispatch,
        notAfter: new Date(Date.now() + 120000),
      };
    },
    async read(_authorizationId, dispatchId) {
      return rows.get(dispatchId) ?? null;
    },
    async settle(_authorizationId, dispatchId, state) {
      const row = rows.get(dispatchId)!;
      if (row.state !== "completed" && row.state !== "not_dispatched")
        rows.set(dispatchId, { ...row, state });
    },
  };
  return { admission, rows, claimCount: () => claims };
}
const companionContext: ReviewCompanionDispatchContextV1 = {
  dispatchId: "companion-dispatch-1",
  executionId: "execution-1",
  workSlotId: "lifecycle-1",
  attemptOrdinal: 1,
  leaseId: "lease-1",
  leaseCapability: "signed-lease",
  fencingToken: "1",
  preparedManifestKey: "a".repeat(64),
};
const companionEnvelope = (model = "gpt-5.6-sol") =>
  Buffer.from(
    JSON.stringify({
      input: "bounded-packet",
      model,
      stream: true,
      store: false,
      service_tier: "default",
      max_output_tokens: 4096,
    }),
  );

it("requires the durable V2 forward for discovery while preserving native tools and its output cap", async () => {
  const state = companionReservation("finding_discovery");
  let forwarded = false;
  const admission = {
    ...state.admission,
    async forward(
      ...args: Parameters<ReviewRunModelDispatchAdmission["forward"]>
    ) {
      if (forwarded)
        throw new ReviewRunCompanionDispatchFailure(
          "model_dispatch_already_forwarded",
        );
      const result = await state.admission.claim(...args);
      if (result.status !== "restored") throw new Error("reservation_required");
      forwarded = true;
      return { ...result, status: "claimed" as const };
    },
  };
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission,
    modelDispatchV2: true,
  });
  const context = {
    ...companionContext,
    workSlotId: "discovery",
    dispatchVersion: 2 as const,
    requestOrdinal: 1,
    routeIdentityHash: "e".repeat(64),
  };
  const bytes = Buffer.from(
    JSON.stringify({
      ...JSON.parse(companionEnvelope().toString()),
      max_output_tokens: 8192,
      tools: [
        {
          type: "function",
          name: "read_file",
          parameters: { type: "object", properties: {} },
        },
      ],
      tool_choice: "auto",
    }),
  );
  const wireHash = createHash("sha256").update(bytes).digest("hex");
  const reserved = await state.admission.claim(
    f.authorization(),
    context,
    wireHash,
  );
  state.rows.set(context.dispatchId, {
    ...reserved.dispatch,
    dispatchVersion: 2,
    requestOrdinal: 1,
    routeIdentityHash: context.routeIdentityHash,
    requestBytes: bytes.byteLength,
    maxOutputTokens: 8192,
  });
  try {
    await expect(
      f.relay.responses("authorization-1", bytes, new AbortController()),
    ).rejects.toMatchObject({ code: "model_dispatch_claim_required" });
    await expect(
      f.relay.responses(
        "authorization-1",
        bytes,
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_claim_required" });
    expect(f.admissions).toHaveLength(0);
    const response = await f.relay.responses(
      "authorization-1",
      bytes,
      new AbortController(),
      undefined,
      context,
    );
    if (response.kind !== "stream") throw new Error("stream_expected");
    const reader = response.body.getReader();
    while (!(await reader.read()).done) {
      /* Fully consume native terminal response. */
    }
    expect(f.requestBodies).toEqual([bytes.toString()]);
    expect(f.requestRefs).toEqual(["stored-companion-native-ref"]);
    await expect(
      f.relay.responses(
        "authorization-1",
        bytes,
        new AbortController(),
        undefined,
        context,
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_already_forwarded" });
    expect(f.admissions).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});

it.each([
  { profileId: "profile-1", model: "gpt-5.6-sol" },
  {
    profileId: "openai-codex-oauth-responses-v1",
    model: "authorized-account-model-not-in-anchor",
  },
])(
  "companion forwards exact hashed bytes with the stored native ref and settles completion for $model",
  async (selection) => {
    const state = companionReservation();
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      undefined,
      {
        admission: state.admission,
      },
      128,
      selection,
      true,
    );
    try {
      const bytes = companionEnvelope(selection.model);
      const response = await f.relay.responses(
        "authorization-1",
        bytes,
        new AbortController(),
        undefined,
        companionContext,
      );
      expect(response.kind).toBe("stream");
      if (response.kind !== "stream") throw new Error("stream_expected");
      const reader = response.body.getReader();
      while (!(await reader.read()).done) {
        /* Consume the bounded native response. */
      }
      expect(f.requestBodies).toEqual([bytes.toString()]);
      expect(f.requestModels).toEqual([selection.model]);
      expect(f.requestRefs).toEqual(["stored-companion-native-ref"]);
      expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
        "completed",
      );
      expect(
        await f.relay.companionDispatch(
          "authorization-1",
          companionContext.dispatchId,
        ),
      ).toMatchObject({
        state: "completed",
        requestRef: "stored-companion-native-ref",
        providerRequestEnvelopeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    } finally {
      await f.relay.shutdown();
    }
  },
);

it("forwards the captured nine-request native grant unchanged through actual prepare and Responses admission", async () => {
  const f = await fixture(32768, 0, 2, 5000, undefined, undefined, 9);
  try {
    const response = await f.relay.responses(
      "authorization-1",
      Buffer.from("{}"),
      new AbortController(),
    );
    expect(f.intents).toHaveLength(1);
    expect(f.intents[0]!.limits.requests).toBe(9);
    expect(f.admissions).toHaveLength(1);
    expect(f.admissions[0]!.limits.requests).toBe(9);
    if (response.kind === "stream") await response.cancel();
  } finally {
    await f.relay.shutdown();
  }
});

it("companion chunks use local authority while phase and EOF status retain full freshness", async () => {
  const state = companionReservation();
  const eof = deferred();
  const f = await fixture(
    32768,
    0,
    2,
    5000,
    async (upstream) => {
      upstream.write(": bounded progress\n\n");
      await eof.promise;
      upstream.end(": bounded tail\n\n");
    },
    { admission: state.admission },
  );
  let response: Awaited<ReturnType<typeof f.relay.responses>> | undefined;
  try {
    response = await f.relay.responses(
      "authorization-1",
      companionEnvelope(),
      new AbortController(),
      undefined,
      companionContext,
    );
    if (response.kind !== "stream") throw new Error("stream_expected");
    const reader = response.body.getReader();
    const beforeChunk = f.authorityChecks.length;
    expect((await reader.read()).done).toBe(false);
    expect(f.authorityChecks.slice(beforeChunk)).toEqual(["local"]);
    const fullBeforeEOF = f.authorityChecks.filter(
      (mode) => mode === "full",
    ).length;
    eof.resolve();
    while (!(await reader.read()).done) {
      // Drain the remaining chunks before checking native EOF settlement.
    }
    expect(
      f.authorityChecks.filter((mode) => mode === "full").length,
    ).toBeGreaterThan(fullBeforeEOF);
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "completed",
    );
  } finally {
    eof.resolve();
    if (response?.kind === "stream") await response.cancel().catch(() => {});
    await f.relay.shutdown();
  }
});

it("companion proven pre-forward refusal records no dispatch without refunding its attempt", async () => {
  const state = companionReservation("pr_description");
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
  });
  try {
    await expect(
      f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({
      code: "pr_description_envelope_bounds_invalid",
      effect: "not_dispatched",
    });
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "not_dispatched",
    );
    await expect(
      f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({
      code: "companion_dispatch_already_claimed",
      effect: "not_dispatched",
    });
    await expect(
      f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        { ...companionContext, dispatchId: "new-id" },
      ),
    ).rejects.toMatchObject({ code: "companion_slot_already_claimed" });
    expect(f.admissions).toHaveLength(0);
    expect(f.intents).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
  const unknown = companionReservation();
  const failedPrepare = await fixture(32768, 0, 2, 5000, undefined, {
    admission: unknown.admission,
  });
  try {
    failedPrepare.setPrepareFailure();
    await expect(
      failedPrepare.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({ effect: "effect_unknown" });
    expect(unknown.rows.get(companionContext.dispatchId)?.state).toBe(
      "dispatch_may_have_started",
    );
    expect(failedPrepare.admissions).toHaveLength(0);
  } finally {
    await failedPrepare.relay.shutdown();
  }
});

it("companion local unpaid admission consumes one reservation and one SDK request across restore", async () => {
  const state = companionReservation();
  const first = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
    unpaid: true,
  });
  try {
    await expect(
      first.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({
      requestRef: "stored-companion-native-ref",
      effect: "not_dispatched",
    });
    expect(first.admissions).toHaveLength(1);
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "not_dispatched",
    );
    // A fresh relay has no process counter, yet the same reservation cannot forward.
    const restored = await fixture(32768, 0, 2, 5000, undefined, {
      admission: state.admission,
      unpaid: true,
    });
    try {
      await expect(
        restored.relay.responses(
          "authorization-1",
          companionEnvelope(),
          new AbortController(),
          undefined,
          companionContext,
        ),
      ).rejects.toMatchObject({
        code: "companion_dispatch_already_claimed",
        requestRef: "stored-companion-native-ref",
      });
      await expect(
        restored.relay.responses(
          "authorization-1",
          companionEnvelope(),
          new AbortController(),
          undefined,
          { ...companionContext, dispatchId: "another-id" },
        ),
      ).rejects.toMatchObject({ code: "companion_slot_already_claimed" });
      expect(restored.admissions).toHaveLength(0);
      expect(restored.intents).toHaveLength(0);
    } finally {
      await restored.relay.shutdown();
    }
  } finally {
    await first.relay.shutdown();
  }
});

it("companion rejects a silently clamped envelope before reservation or SDK dispatch", async () => {
  const state = companionReservation();
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
  });
  try {
    const bytes = Buffer.from(
      companionEnvelope()
        .toString()
        .replace('"max_output_tokens":4096', '"max_output_tokens":8192'),
    );
    await expect(
      f.relay.responses(
        "authorization-1",
        bytes,
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({ code: "envelope_not_normalized" });
    expect(state.claimCount()).toBe(0);
    expect(f.admissions).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

it("companion usage failure after SDK forward stays unknown without a second SDK request", async () => {
  const state = companionReservation();
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
    failUsageOutcome: true,
  });
  try {
    await expect(
      f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({
      effect: "effect_unknown",
      requestRef: "stored-companion-native-ref",
    });
    expect(f.admissions).toHaveLength(1);
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "effect_unknown",
    );
    await expect(
      f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({ code: "companion_dispatch_already_claimed" });
    expect(f.admissions).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});
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
  controlledStream?: (response: ServerResponse) => Promise<void>,
  companionOptions?: {
    admission: ReviewRunCompanionDispatchAdmission &
      Partial<Pick<ReviewRunModelDispatchAdmission, "forward">>;
    unpaid?: boolean;
    failUsageOutcome?: boolean;
    modelDispatchV2?: boolean;
  },
  capturedRequests = 128,
  selection: {
    profileId: string;
    model: string;
    authKind?: "oauth" | "api_key";
  } = { profileId: "profile-1", model: "gpt-5.6-sol" },
  accountModelCatalogEnabled = false,
) {
  const deadline = new Date(Date.now() + 120_000).toISOString();
  const limits = {
    requests: capturedRequests,
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
    profileRef: selection.profileId,
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
        model: selection.model,
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
      ...(companionOptions?.modelDispatchV2
        ? {
            modelDispatchCapability: {
              extensionId: "review-model-dispatch.v2",
              version: 2,
              transport: "account_gateway",
              wireProtocol: "openai-responses",
              outputTokenLimit: "terminal_acceptance",
              routeIdentityHash: "e".repeat(64),
              providerIndex: 0,
              model: selection.model,
              deadline,
              maxRequests: Math.min(32, capturedRequests),
              maxConcurrentRequests: 1,
              maxRequestBytes: 4096,
              maxResponseBytes: outputBytes,
              maxOutputTokens: 32768,
            },
          }
        : {}),
      ...(companionOptions
        ? {
            lifecycleVerificationCapability: {
              extensionId: lifecycleVerificationContract.extensionId,
              descriptorDigest: lifecycleVerificationDescriptorDigest,
              executor: lifecycleVerificationContract.executor,
              modelTransport: "account_gateway",
              providerIndex: 0,
              providerKind: "codex",
              model: selection.model,
              maxDispatches: 2,
              maxPromptBytes: 4096,
              maxResponseBytes: 32768,
              maxOutputTokens: 4096,
              deadlineMs: 60000,
              attemptBudget: 1,
              ...(companionOptions.modelDispatchV2
                ? {
                    extensionId: "lifecycle-verification.v2",
                    version: 2,
                    descriptorDigest: lifecycleVerificationDescriptorDigestV2,
                    routeIdentityHash: "e".repeat(64),
                    protocol: "openai-responses",
                  }
                : {}),
            },
          }
        : {}),
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
  const requestModels: string[] = [];
  const requestBodies: string[] = [];
  const requestRefs: string[] = [];
  const effects: { requestRef: string; effect: c.RequestStatus["effect"] }[] =
    [];
  const authorityChecks: ("full" | "local")[] = [];
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
      requestModels.push((JSON.parse(raw) as { model: string }).model);
      admissions.push(JSON.parse(String(req.headers["x-gateway-admission"])));
      requestBodies.push(raw);
      requestRefs.push(String(req.headers["x-gateway-request-id"]));
      if (companionOptions?.unpaid) {
        res.writeHead(429, { "content-type": "application/json" }).end(
          JSON.stringify({
            code: "admission_limited",
            traceRef: "fixture-trace",
            requestRef: String(req.headers["x-gateway-request-id"]),
            effect: "not_dispatched",
            retry: { kind: "after", milliseconds: 1 },
          }),
        );
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "x-gateway-request-ref": String(req.headers["x-gateway-request-id"]),
      });
      if (controlledStream) {
        await controlledStream(res);
        return;
      }
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
    if (
      companionOptions &&
      req.method === "GET" &&
      req.url?.includes("/requests/")
    ) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          requestRef: req.url.split("/").at(-1),
          effect: "completed",
          status: "completed",
        }),
      );
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
    accountModelCatalogEnabled,
    policy: {
      profiles: [
        {
          profile: {
            profileId: selection.profileId,
            protocol: "openai-responses",
            modelIds: ["gpt-5.6-sol"],
            authKinds: [selection.authKind ?? "oauth"],
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
    checkAuthority: async (auth, freshness) => {
      authorityChecks.push(freshness);
      return !revoked.has(auth.authorizationId);
    },
    confirmAuthority: async (_token, auth) =>
      !revoked.has(auth.authorizationId),
    snapshots,
    bindings,
    ...(companionOptions
      ? { companionDispatches: companionOptions.admission }
      : {}),
    usage: {
      prepare: async () => undefined,
      outcome: async ({ requestRef, effect }) => {
        effects.push({ requestRef, effect });
        if (companionOptions?.failUsageOutcome)
          throw new Error("fixture_usage_write_failed");
      },
    },
  });
  return {
    preparation,
    relay,
    intents,
    admissions,
    requestModels,
    requestBodies,
    requestRefs,
    limits,
    effects,
    authorityChecks,
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
    const pendingOutcomes = Promise.allSettled([first, second]);
    // Resolve is asynchronous; the second admission reaches the same cleanup
    // while its native acknowledgement is deliberately held at the boundary.
    await setImmediate();
    expect(f.nativeCloses).toHaveLength(1);
    gate.release();
    const outcomes = await pendingOutcomes;
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

it("normalizes Codex null reasoning without dropping configured reasoning", () => {
  const prepare = (raw: string) =>
    JSON.parse(
      new TextDecoder().decode(
        prepareReviewRunGatewayResponses(
          new TextEncoder().encode(raw),
          "k3-256k",
          100,
          4096,
          32768,
        ),
      ),
    ) as Record<string, unknown>;
  expect(prepare('{"input":"review","reasoning":null}')).not.toHaveProperty(
    "reasoning",
  );
  expect(prepare('{"input":"review"}')).not.toHaveProperty("reasoning");
  const configured = { effort: "high", summary: "auto" };
  expect(
    prepare(JSON.stringify({ input: "review", reasoning: configured }))
      .reasoning,
  ).toEqual(configured);
  expect(prepare('{"input":"review","reasoning":null}').service_tier).toBe(
    "default",
  );
  expect(() =>
    prepare(
      '{"input":"review","reasoning":null,"reasoning":{"effort":"high"}}',
    ),
  ).toThrow();
});

const sseBytes = (value: string) => new TextEncoder().encode(value);
const concatBytes = (chunks: readonly Uint8Array[]) => Buffer.concat(chunks);
const progressFrame =
  'event: response.output_text.delta\r\ndata: {"delta":"Привіт 🌍"}\r\n\r\n';
const completedFrame =
  'event: response.completed\r\ndata: {"type":"response.completed","response":{"status":"completed"}}\r\n\r\n';

it("streams complete nonterminal frames while retaining fragmented terminal bytes through SDK EOF", () => {
  const gate = createReviewRunGatewayTerminalGate(4096);
  const progress = sseBytes(progressFrame);
  const terminal = sseBytes(
    completedFrame + ": trailing transport frame\r\n\r\n",
  );
  const visible: Uint8Array[] = [];
  // One-byte pushes split both multi-byte UTF-8 and every CRLF boundary.
  for (const byte of progress) visible.push(...gate.push(Uint8Array.of(byte)));
  expect(concatBytes(visible)).toEqual(Buffer.from(progress));
  for (const byte of terminal)
    expect(gate.push(Uint8Array.of(byte))).toEqual([]);
  const final = gate.finish();
  expect(concatBytes(final)).toEqual(Buffer.from(terminal));
  expect(concatBytes([...visible, ...final])).toEqual(
    Buffer.from(
      progressFrame + completedFrame + ": trailing transport frame\r\n\r\n",
    ),
  );
});

it.each([
  'event: response.failed\ndata: {"type":"response.failed"}\n\n',
  'event: response.incomplete\ndata: {"type":"response.incomplete"}\n\n',
  'data: {"type":"response.completed"}\n\n',
  "data: [DONE]\n\n",
])(
  "withholds exact terminal frame %j until the caller confirms EOF",
  (frame) => {
    const gate = createReviewRunGatewayTerminalGate(4096);
    const raw = sseBytes(frame + ": tail\n\n");
    expect(gate.push(raw)).toEqual([]);
    expect(concatBytes(gate.finish())).toEqual(Buffer.from(raw));
  },
);

it("keeps malformed nonterminal bytes intact and never manufactures successful SSE", () => {
  const gate = createReviewRunGatewayTerminalGate(4096);
  const raw = sseBytes(
    'event: response.completed\ndata: {"type":broken}\n\n: partial tail',
  );
  const delivered = [...gate.push(raw), ...gate.finish()];
  expect(concatBytes(delivered)).toEqual(Buffer.from(raw));
  expect(concatBytes(delivered).toString()).not.toContain(
    '"type":"response.completed"',
  );
});

it("bounds incomplete frames and the retained terminal tail without releasing them", () => {
  const incomplete = createReviewRunGatewayTerminalGate(32);
  expect(() => incomplete.push(sseBytes("data: " + "x".repeat(33)))).toThrow();
  const terminal = createReviewRunGatewayTerminalGate(256);
  expect(terminal.push(sseBytes(completedFrame))).toEqual([]);
  expect(() =>
    terminal.push(sseBytes(":" + "x".repeat(256) + "\n\n")),
  ).toThrow();
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function readExactFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expected: string,
) {
  const chunks: Uint8Array[] = [];
  const length = Buffer.byteLength(expected);
  let received = 0;
  while (received < length) {
    const part = await reader.read();
    expect(part.done).toBe(false);
    chunks.push(part.value!);
    received += part.value!.byteLength;
  }
  expect(concatBytes(chunks).toString()).toBe(expected);
}
async function serveRelay(
  relay: ReturnType<typeof createReviewRunGatewayRelay>,
) {
  const app = Fastify();
  await registerReviewRunGatewayRelayRoutes(app, relay);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const request = () =>
    fetch(origin + "/api/action/v2/account-gateway/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer local-authorization-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        input: [],
        stream: true,
        max_output_tokens: 100,
      }),
    });
  return { app, request };
}

it("allows a real client to disconnect on released terminal bytes after SDK completion and start the next tool turn", async () => {
  const allowEOF = deferred();
  const terminalWritten = deferred();
  const upstreamClosures: boolean[] = [];
  let calls = 0;
  const f = await fixture(MiB, 0, 2, 5000, async (response) => {
    response.once("close", () => upstreamClosures.push(response.writableEnded));
    response.write(progressFrame);
    response.write(completedFrame, () => terminalWritten.resolve());
    if (++calls === 1) await allowEOF.promise;
    response.end();
  });
  const http = await serveRelay(f.relay);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const first = await http.request();
    expect(first.status).toBe(200);
    reader = first.body!.getReader();
    await readExactFrame(reader, progressFrame);
    await terminalWritten.promise;
    expect(f.effects.map((row) => row.effect)).toEqual(["dispatch_started"]);
    let terminalReceived = false;
    const terminalRead = readExactFrame(reader, completedFrame).then(() => {
      terminalReceived = true;
    });
    await setImmediate();
    expect(terminalReceived).toBe(false);
    allowEOF.resolve();
    await terminalRead;
    // This is the Codex behavior: close as soon as the terminal frame arrives,
    // without asking the HTTP body reader for its own done=true observation.
    await reader.cancel();
    reader.releaseLock();
    reader = undefined;
    const second = await http.request();
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(progressFrame + completedFrame);
    expect(f.admissions).toHaveLength(2);
    expect(f.effects.map((row) => row.effect)).toEqual([
      "dispatch_started",
      "completed",
      "dispatch_started",
      "completed",
    ]);
    expect(upstreamClosures).toEqual([true, true]);
  } finally {
    allowEOF.resolve();
    await reader?.cancel().catch(() => undefined);
    await http.app.close();
  }
}, 10000);

it("cancels the real SDK request when the client disconnects before upstream EOF", async () => {
  const upstreamClosed = deferred<boolean>();
  const f = await fixture(MiB, 0, 2, 5000, async (response) => {
    response.once("close", () =>
      upstreamClosed.resolve(response.writableEnded),
    );
    response.write(progressFrame);
    response.write(completedFrame);
    await upstreamClosed.promise;
  });
  const http = await serveRelay(f.relay);
  try {
    const response = await http.request();
    const reader = response.body!.getReader();
    await readExactFrame(reader, progressFrame);
    await reader.cancel();
    reader.releaseLock();
    expect(await upstreamClosed.promise).toBe(false);
    expect(f.effects.map((row) => row.effect)).not.toContain("completed");
    expect(f.admissions).toHaveLength(1);
  } finally {
    await http.app.close();
  }
}, 10000);

it("never releases buffered terminal bytes when the real SDK transport fails before EOF", async () => {
  const failTransport = deferred();
  const f = await fixture(MiB, 0, 2, 5000, async (response) => {
    response.write(progressFrame);
    response.write(completedFrame);
    await failTransport.promise;
    response.destroy();
  });
  const http = await serveRelay(f.relay);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await http.request();
    reader = response.body!.getReader();
    await readExactFrame(reader, progressFrame);
    failTransport.resolve();
    await expect(reader.read()).rejects.toBeDefined();
    expect(f.effects.map((row) => row.effect)).not.toContain("completed");
  } finally {
    failTransport.resolve();
    await reader?.cancel().catch(() => undefined);
    await http.app.close();
  }
}, 10000);

// RED if the immutable enrollment anchor rejects an account-catalog model before
// the normal owned-run preparation/native admission path.
it.each([
  ["openai-codex-oauth-responses-v1", "oauth", true],
  ["openrouter-openai-responses-apikey-v1", "api_key", true],
  ["openrouter-openai-responses-apikey-v1", "oauth", false],
  ["profile-1", "oauth", false],
  ["grok-subscription-responses-oauth-v1", "oauth", false],
] as const)(
  "account model %s with %s keeps the authorized Responses path (dynamic=%s)",
  async (profileId, authKind, dynamic) => {
    const model = "authorized-account-model-not-in-anchor";
    const f = await fixture(
      MiB,
      0,
      2,
      5000,
      undefined,
      undefined,
      128,
      { profileId, model, authKind },
      true,
    );
    try {
      const response = f.relay.responses(
        "local-authorization-token",
        new TextEncoder().encode(
          JSON.stringify({
            model,
            input: [],
            stream: true,
            max_output_tokens: 100,
          }),
        ),
        new AbortController(),
      );
      if (!dynamic) {
        await expect(response).rejects.toMatchObject({
          code: "gateway_unavailable",
          effect: "not_dispatched",
        });
        expect(f.intents).toHaveLength(0);
        expect(f.admissions).toHaveLength(0);
        return;
      }
      const result = await response;
      if (result.kind !== "stream") throw new Error("expected_stream");
      for await (const chunk of result.body) {
        void chunk;
        /* Drain the single real HTTP response. */
      }
      expect(f.intents).toHaveLength(1);
      expect(f.intents[0]).toMatchObject({
        accountRefs: ["account-1"],
        profileId,
      });
      expect(f.requestModels).toEqual([model]);
    } finally {
      await f.relay.shutdown();
    }
  },
);

it("revocation while preparing a dynamic Codex model still prevents inference", async () => {
  const model = "authorized-account-model-not-in-anchor";
  const f = await fixture(
    MiB,
    0,
    2,
    5000,
    undefined,
    undefined,
    128,
    { profileId: "openai-codex-oauth-responses-v1", model },
    true,
  );
  const held = f.holdPrepare();
  try {
    const response = f.relay.responses(
      "local-authorization-token",
      new TextEncoder().encode(
        JSON.stringify({
          model,
          input: [],
          stream: true,
          max_output_tokens: 100,
        }),
      ),
      new AbortController(),
    );
    await held.started;
    f.revoke("authorization-1");
    held.release();
    await expect(response).rejects.toMatchObject({
      code: "authorization_denied",
    });
    expect(f.admissions).toHaveLength(0);
    expect(f.requestModels).toHaveLength(0);
  } finally {
    held.release();
    await f.relay.shutdown();
  }
});

it.each([
  { model: "gpt-5.6-sol", allowed: true },
  { model: "authorized-account-model-not-in-anchor", allowed: false },
])(
  "without catalog opt-in the relay admits only configured Codex models: $model",
  async ({ model, allowed }) => {
    const f = await fixture(MiB, 0, 2, 5000, undefined, undefined, 128, {
      profileId: "openai-codex-oauth-responses-v1",
      model,
    });
    try {
      const response = f.relay.responses(
        "local-authorization-token",
        new TextEncoder().encode(
          JSON.stringify({
            model,
            input: [],
            stream: true,
            max_output_tokens: 100,
          }),
        ),
        new AbortController(),
      );
      if (!allowed) {
        await expect(response).rejects.toMatchObject({
          code: "gateway_unavailable",
          effect: "not_dispatched",
        });
        expect(f.intents).toHaveLength(0);
        expect(f.admissions).toHaveLength(0);
        expect(f.requestModels).toHaveLength(0);
        return;
      }
      const result = await response;
      if (result.kind !== "stream") throw new Error("expected_stream");
      for await (const chunk of result.body) void chunk;
      expect(f.intents).toHaveLength(1);
      expect(f.requestModels).toEqual([model]);
    } finally {
      await f.relay.shutdown();
    }
  },
);
