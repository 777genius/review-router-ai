import { GatewayError } from "@agent-teams/account-gateway/http";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { setImmediate } from "node:timers/promises";
import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
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
  reviewModelDispatchCapacity128Contract,
  reviewModelDispatchNativeRetryContract,
  reviewModelDispatchHeaders,
  type ReviewCompanionDispatchContextV1,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { createReviewRunGatewayPreparation } from "./review-run-gateway-preparation";
import * as preparationModule from "./review-run-gateway-preparation";
import {
  createReviewRunGatewayRelay,
  createReviewRunGatewayTerminalGate,
  prepareReviewRunGatewayResponses,
  registerReviewRunGatewayRelayRoutes,
  readReviewRunCompanionDispatchContext,
} from "./review-run-gateway-relay";
import {
  createReviewRunHostedModelRoute,
  registerReviewRunHostedModelRoute,
  hostedModelRoutePath,
  hostedModelGrantHeader,
} from "./review-run-hosted-model-route";

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

function modelForwardHeaders(ordinal: number) {
  return {
    authorization: "Bearer local-authorization-token",
    "content-type": "application/json",
    ...Object.fromEntries(
      Object.entries(lifecycleVerificationContract.dispatchHeaders).map(
        ([key, name]) => [
          name,
          String(companionContext[key as keyof typeof companionContext]),
        ],
      ),
    ),
    [reviewModelDispatchHeaders.dispatchVersion]: "2",
    [reviewModelDispatchHeaders.requestOrdinal]: String(ordinal),
    [reviewModelDispatchHeaders.routeIdentityHash]: "e".repeat(64),
    // Caller-supplied policy metadata cannot select a capacity contract.
    "x-reviewrouter-model-capacity-policy":
      reviewModelDispatchCapacity128Contract.capacityPolicy,
  };
}

const forwardingBounds = [
  { capacity128: false, requests: 128, ordinal: 32, allowed: true },
  { capacity128: false, requests: 128, ordinal: 33, allowed: false },
  { capacity128: true, requests: 128, ordinal: 33, allowed: true },
  { capacity128: true, requests: 128, ordinal: 100, allowed: true },
  { capacity128: true, requests: 128, ordinal: 128, allowed: true },
  { capacity128: true, requests: 128, ordinal: 129, allowed: false },
  { capacity128: true, requests: 16, ordinal: 16, allowed: true },
  { capacity128: true, requests: 16, ordinal: 17, allowed: false },
];

it("rejects a native retry proof cancelled during its final authority check", async () => {
  const state = companionReservation("finding_discovery");
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
    retryProof: (requestRef, executionRef) => ({
      kind: "request-retry-proof/v1",
      consumerId: "fixture-consumer",
      executionRef,
      requestRef,
      nonEntryReason: "admission_storage_conflict",
      transportClosed: true,
    }),
  });
  const finalCheckStarted = deferred();
  const releaseFinalCheck = deferred();
  const controller = new AbortController();
  let checks = 0;
  let reading: ReturnType<typeof f.preparation.retryProof> | undefined =
    undefined;
  try {
    await f.preparation.prepare();
    reading = f.preparation.retryProof(
      "cancelled-proof-request",
      { signal: controller.signal },
      async () => {
        if (++checks === 2) {
          finalCheckStarted.resolve();
          await releaseFinalCheck.promise;
        }
      },
    );
    void reading.catch(() => {});
    await Promise.race([
      finalCheckStarted.promise,
      reading.then(() => {
        throw new Error("proof_returned_before_final_check");
      }),
    ]);
    expect(f.retryProofCalls).toHaveLength(1);
    controller.abort();
    releaseFinalCheck.resolve();
    await expect(reading).rejects.toMatchObject({
      code: "cancelled",
      effect: "effect_unknown",
    });
    expect(checks).toBe(2);
    expect(f.retryProofCalls).toHaveLength(1);
    expect(f.requestRefs).toHaveLength(0);
  } finally {
    releaseFinalCheck.resolve();
    await reading?.catch(() => {});
    try {
      await f.preparation.close("cancelled");
    } finally {
      await f.relay.shutdown();
    }
  }
});

it.each(["closeRun", "shutdown"] as const)(
  "denies native retry visibility when %s starts during the final live-authority read",
  async (operation) => {
    const liveReadStarted = deferred();
    const releaseLiveRead = deferred();
    const revokeStarted = deferred();
    const releaseRevoke = deferred();
    let holdLiveRead = false;
    let originalAuthorityAllowed = false;
    const originalFactory = preparationModule.createReviewRunGatewayPreparation;
    const factory = vi
      .spyOn(preparationModule, "createReviewRunGatewayPreparation")
      .mockImplementation((input) => {
        const preparation = originalFactory(input);
        return {
          ...preparation,
          hasLiveNativeRetryAuthority: async () => {
            const allowed = await preparation.hasLiveNativeRetryAuthority();
            if (holdLiveRead) {
              originalAuthorityAllowed = allowed;
              liveReadStarted.resolve();
              await releaseLiveRead.promise;
            }
            return allowed;
          },
        };
      });
    const state = companionReservation("finding_discovery");
    const f = await fixture(32768, 0, 2, 5000, undefined, {
      admission: state.admission,
    });
    const originalRevoke =
      f.authorizations.expireOrRevokeReviewRunAuthorization;
    const revoke = vi
      .spyOn(f.authorizations, "expireOrRevokeReviewRunAuthorization")
      .mockImplementation(async (input) => {
        revokeStarted.resolve();
        await releaseRevoke.promise;
        return originalRevoke(input);
      });
    let reading:
      | ReturnType<typeof f.relay.canReadNativeRetryProof>
      | undefined = undefined;
    let closing: Promise<unknown> | undefined = undefined;
    try {
      await streamRun(f, "authorization-1");
      const { dispatch } = await state.admission.claim(
        f.authorization(),
        companionContext,
        createHash("sha256").update(companionEnvelope()).digest("hex"),
      );
      expect(await f.relay.canReadNativeRetryProof(dispatch)).toBe(true);
      holdLiveRead = true;
      reading = f.relay.canReadNativeRetryProof(dispatch);
      void reading.catch(() => {});
      await Promise.race([
        liveReadStarted.promise,
        reading.then(() => {
          throw new Error("visibility_returned_before_live_read");
        }),
      ]);
      expect(originalAuthorityAllowed).toBe(true);
      closing =
        operation === "closeRun"
          ? f.relay.closeRun("authorization-1", "cancelled")
          : f.relay.shutdown();
      void closing.catch(() => {});
      await Promise.race([
        revokeStarted.promise,
        closing.then(() => {
          throw new Error("close_finished_before_revocation");
        }),
      ]);
      expect(f.authorization().state).toBe("active");
      expect(f.nativeCloses).toHaveLength(0);
      releaseLiveRead.resolve();
      await expect(reading).resolves.toBe(false);
      releaseRevoke.resolve();
      await closing;
    } finally {
      releaseLiveRead.resolve();
      releaseRevoke.resolve();
      await reading?.catch(() => {});
      await closing?.catch(() => {});
      try {
        await f.relay.shutdown();
      } finally {
        revoke.mockRestore();
        factory.mockRestore();
      }
    }
  },
);

it.each([
  { name: "original", enabled: true, invalidProof: undefined, accepted: true },
  {
    name: "legacy capacity",
    enabled: false,
    invalidProof: undefined,
    accepted: false,
  },
  {
    name: "foreign execution",
    enabled: true,
    invalidProof: "executionRef",
    accepted: false,
  },
  {
    name: "foreign request",
    enabled: true,
    invalidProof: "requestRef",
    accepted: false,
  },
  {
    name: "closure absent",
    enabled: true,
    invalidProof: "transportClosed",
    accepted: false,
  },
])(
  "records native rejection before unknown only with exact original proof: $name",
  async ({ enabled, invalidProof, accepted }) => {
    const state = companionReservation("finding_discovery");
    const forward = vi.fn(
      async (
        ...args: Parameters<ReviewRunModelDispatchAdmission["forward"]>
      ) => ({
        ...(await state.admission.claim(...args)),
        status: "claimed" as const,
      }),
    );
    const recordNativeRejection = vi.fn(
      async (_authorizationId: string, dispatchId: string) => {
        const row = state.rows.get(dispatchId)!;
        expect(row.state).toBe("dispatch_may_have_started");
        state.rows.set(dispatchId, {
          ...row,
          state: "not_dispatched",
          nativeRetryProof: {
            kind: "native_rejection_after_forward",
            reason: "admission_storage_conflict",
          },
        });
      },
    );
    const f = await fixture(32768, 0, 2, 5000, undefined, {
      admission: { ...state.admission, forward, recordNativeRejection },
      modelDispatchV2: true,
      modelDispatchCapacity128: true,
      nativeRetry: enabled,
      nativeRejection: true,
      retryProof: (requestRef, executionRef) => ({
        kind: "request-retry-proof/v1",
        consumerId: "fixture-consumer",
        executionRef,
        requestRef,
        nonEntryReason: "admission_storage_conflict",
        transportClosed: true,
        ...(invalidProof
          ? {
              [invalidProof]:
                invalidProof === "transportClosed" ? false : "foreign",
            }
          : {}),
      }),
    });
    const bytes = companionEnvelope();
    const context = {
      ...companionContext,
      dispatchVersion: 2 as const,
      requestOrdinal: 1,
      routeIdentityHash: "e".repeat(64),
    };
    const original = await state.admission.claim(
      f.authorization(),
      context,
      createHash("sha256").update(bytes).digest("hex"),
    );
    state.rows.set(context.dispatchId, {
      ...original.dispatch,
      dispatchVersion: 2,
      requestOrdinal: 1,
      routeIdentityHash: context.routeIdentityHash,
      requestBytes: bytes.byteLength,
      maxOutputTokens: 4096,
    });
    try {
      await expect(
        f.relay.responses(
          "local-authorization-token",
          bytes,
          new AbortController(),
          undefined,
          context,
        ),
      ).rejects.toMatchObject({
        effect: accepted ? "rejected_before_dispatch" : "effect_unknown",
      });
      expect(recordNativeRejection).toHaveBeenCalledTimes(accepted ? 1 : 0);
      expect(state.rows.get(context.dispatchId)?.state).toBe(
        accepted ? "not_dispatched" : "effect_unknown",
      );
      expect(f.retryProofCalls).toHaveLength(enabled ? 1 : 0);
      expect(f.retryProofHeaders).toEqual(
        enabled
          ? [
              {
                authorization: "Bearer local-execution-token",
                capability: "request-retry-proof/v1",
              },
            ]
          : [],
      );
      if (accepted) {
        expect(recordNativeRejection).toHaveBeenCalledWith(
          f.authorization().authorizationId,
          context.dispatchId,
          {
            kind: "request-retry-proof/v1",
            consumerId: "fixture-consumer",
            executionRef: f.retryProofCalls[0]!.executionRef,
            requestRef: original.dispatch.nativeRequestRef,
            nonEntryReason: "admission_storage_conflict",
            transportClosed: true,
          },
        );
        expect(
          await f.relay.canReadNativeRetryProof(
            state.rows.get(context.dispatchId)!,
          ),
        ).toBe(true);
        f.revoke(f.authorization().authorizationId);
        expect(
          await f.relay.canReadNativeRetryProof(
            state.rows.get(context.dispatchId)!,
          ),
        ).toBe(false);
      }
      expect(f.intents).toHaveLength(1);
      expect(f.requestBodies).toEqual([bytes.toString()]);
    } finally {
      await f.relay.shutdown();
    }
  },
);

it.each([
  {
    name: "cached pending with closed non-entry",
    effect: "dispatch_started",
    status: "pending",
    nativeRetry: true,
    role: "finding_discovery",
    proof: "accepted",
  },
  {
    name: "cached pending without a durable closure ACK",
    effect: "dispatch_started",
    status: "pending",
    nativeRetry: true,
    role: "finding_discovery",
    proof: "denied",
  },
  {
    name: "completed status",
    effect: "completed",
    status: "completed",
    nativeRetry: true,
    role: "finding_discovery",
    proof: "unused",
  },
  {
    name: "legacy cached pending",
    effect: "dispatch_started",
    status: "pending",
    nativeRetry: false,
    role: "finding_discovery",
    proof: "unused",
  },
  {
    name: "auxiliary cached pending",
    effect: "dispatch_started",
    status: "pending",
    nativeRetry: true,
    role: "lifecycle_verification",
    proof: "unused",
  },
] as const)(
  "drains native status before the single eligible proof read: $name",
  async ({ effect, status, nativeRetry, role, proof }) => {
    const state = companionReservation(role);
    const events: string[] = [];
    const releaseEof = deferred();
    const eofReadPending = deferred();
    const proofCallStarted = deferred();
    let statusBytes = 0;
    const forward = vi.fn(
      async (
        ...args: Parameters<ReviewRunModelDispatchAdmission["forward"]>
      ) => ({
        ...(await state.admission.claim(...args)),
        status: "claimed" as const,
      }),
    );
    const settle = vi.fn(
      async (
        ...args: Parameters<ReviewRunCompanionDispatchAdmission["settle"]>
      ) => {
        events.push("settle:" + args[2]);
        await state.admission.settle(...args);
      },
    );
    const recordNativeRejection = vi.fn(
      async (_authorizationId: string, dispatchId: string) => {
        expect(events).toEqual(["status-body", "status-eof", "proof"]);
        events.push("attested");
        const row = state.rows.get(dispatchId)!;
        expect(row.state).toBe("dispatch_may_have_started");
        state.rows.set(dispatchId, {
          ...row,
          state: "not_dispatched",
          nativeRetryProof: {
            kind: "native_rejection_after_forward",
            reason: "admission_storage_conflict",
          },
        });
      },
    );
    const f = await fixture(32768, 0, 2, 4000, undefined, {
      admission: {
        ...state.admission,
        forward,
        settle,
        recordNativeRejection,
      },
      modelDispatchV2: true,
      modelDispatchCapacity128: true,
      nativeRetry,
      nativeStatusResponse: async (response, requestRef) => {
        response.writeHead(202, { "content-type": "application/json" });
        const body = JSON.stringify({ requestRef, effect, status });
        statusBytes = Buffer.byteLength(body);
        response.write(body);
        events.push("status-body");
        // The public native handler awaits its close ACK before returning.
        // Sending JSON without EOF must not trigger an early RR proof read.
        await releaseEof.promise;
        events.push("status-eof");
        response.end();
      },
      retryProofStatus: proof === "denied" ? 403 : 200,
      retryProof: (requestRef, executionRef) => {
        events.push("proof");
        return proof === "denied"
          ? {
              code: "forbidden",
              traceRef: "held-closure-fixture",
              requestRef,
              effect: "effect_unknown",
              retry: { kind: "never" },
            }
          : {
              kind: "request-retry-proof/v1",
              consumerId: "fixture-consumer",
              executionRef,
              requestRef,
              nonEntryReason: "admission_storage_conflict",
              transportClosed: true,
            };
      },
    });
    const bytes = companionEnvelope();
    const context = {
      ...companionContext,
      dispatchVersion: 2 as const,
      requestOrdinal: 1,
      routeIdentityHash: "e".repeat(64),
    };
    const original = await state.admission.claim(
      f.authorization(),
      context,
      createHash("sha256").update(bytes).digest("hex"),
    );
    state.rows.set(context.dispatchId, {
      ...original.dispatch,
      dispatchVersion: 2,
      requestOrdinal: 1,
      routeIdentityHash: context.routeIdentityHash,
      requestBytes: bytes.byteLength,
      maxOutputTokens: 4096,
    });
    const originalFetch = globalThis.fetch;
    let clientEofObserved = false;
    const proofInvocations: boolean[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : input);
        const fixtureRequest = url.origin === f.relayInput.runAccess.origin;
        if (fixtureRequest && url.pathname.endsWith("/retry-proof")) {
          proofInvocations.push(clientEofObserved);
          proofCallStarted.resolve();
        }
        const response = await originalFetch(input, init);
        if (
          !fixtureRequest ||
          !url.pathname.endsWith("/requests") ||
          response.status !== 202 ||
          !response.body
        )
          return response;
        const reader = response.body.getReader();
        let consumedBytes = 0;
        const body = new ReadableStream<Uint8Array>(
          {
            async pull(controller) {
              // With no prefetch, this read is driven by the SDK's next read.
              const pendingRead = reader.read();
              if (consumedBytes === statusBytes && consumedBytes > 0)
                eofReadPending.resolve();
              try {
                const { done, value } = await pendingRead;
                if (done) {
                  clientEofObserved = true;
                  controller.close();
                } else {
                  consumedBytes += value.byteLength;
                  controller.enqueue(value);
                }
              } catch (error) {
                controller.error(error);
              }
            },
            cancel: (reason) => reader.cancel(reason),
          },
          { highWaterMark: 0 },
        );
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      });
    const controller = new AbortController();
    const pending = f.relay
      .responses(
        "local-authorization-token",
        bytes,
        controller,
        undefined,
        context,
      )
      .then(
        (response) => ({ kind: "response" as const, response }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
    try {
      await Promise.race([
        eofReadPending.promise,
        proofCallStarted.promise.then(() => {
          throw new Error("native_proof_started_before_eof_read");
        }),
        pending.then(() => {
          throw new Error("native_status_finished_before_eof_read");
        }),
      ]);
      expect(proofInvocations).toEqual([]);
      expect(events).toEqual(["status-body"]);
      expect(f.retryProofCalls).toHaveLength(0);
      expect(recordNativeRejection).not.toHaveBeenCalled();
      expect(settle).not.toHaveBeenCalled();
      expect(f.effects).toEqual([]);
      expect(state.rows.get(context.dispatchId)?.state).toBe(
        "dispatch_may_have_started",
      );
      releaseEof.resolve();
      const result = await pending;
      if (proof === "denied") {
        expect(result.kind).toBe("error");
        if (result.kind === "error")
          expect(result.error).toMatchObject({ effect: "effect_unknown" });
      } else {
        expect(result).toMatchObject({
          kind: "response",
          response: {
            kind: "status",
            status: {
              requestRef: original.dispatch.nativeRequestRef,
              effect,
              status,
            },
          },
        });
      }
      expect(proofInvocations).toEqual(proof === "unused" ? [] : [true]);
      expect(f.retryProofCalls).toHaveLength(proof === "unused" ? 0 : 1);
      expect(f.retryProofHeaders).toEqual(
        proof === "unused"
          ? []
          : [
              {
                authorization: "Bearer local-execution-token",
                capability: "request-retry-proof/v1",
              },
            ],
      );
      expect(recordNativeRejection).toHaveBeenCalledTimes(
        proof === "accepted" ? 1 : 0,
      );
      const settledState =
        effect === "completed" ? "completed" : "effect_unknown";
      expect(state.rows.get(context.dispatchId)?.state).toBe(
        proof === "accepted" ? "not_dispatched" : settledState,
      );
      expect(events).toEqual([
        "status-body",
        "status-eof",
        ...(proof === "unused" ? [] : ["proof"]),
        proof === "accepted" ? "attested" : "settle:" + settledState,
      ]);
      expect(f.effects).toEqual([
        {
          requestRef: original.dispatch.nativeRequestRef,
          effect:
            proof === "accepted"
              ? "rejected_before_dispatch"
              : proof === "denied"
                ? "effect_unknown"
                : effect,
        },
      ]);
      expect(forward).toHaveBeenCalledTimes(1);
      expect(f.intents).toHaveLength(1);
      expect(f.requestBodies).toEqual([bytes.toString()]);
      expect(state.rows.size).toBe(1);
    } finally {
      releaseEof.resolve();
      controller.abort();
      try {
        await pending;
        await f.relay.shutdown();
      } finally {
        fetchMock.mockRestore();
      }
    }
  },
  10_000,
);

it.each([
  { mode: "private", proofDenied: false },
  { mode: "public", proofDenied: false },
  { mode: "private", proofDenied: true },
] as const)(
  "projects HTTP $mode references (proof denied=$proofDenied)",
  async ({ mode, proofDenied }) => {
    const state = companionReservation("finding_discovery");
    const forward = vi.fn(
      async (
        ...args: Parameters<ReviewRunModelDispatchAdmission["forward"]>
      ) => ({
        ...(await state.admission.claim(...args)),
        status: "claimed" as const,
      }),
    );
    const recordNativeRejection = vi.fn(
      async (
        ...args: Parameters<
          ReviewRunModelDispatchAdmission["recordNativeRejection"]
        >
      ) => {
        const row = state.rows.get(args[1])!;
        expect(args[2].requestRef).toBe(row.nativeRequestRef);
        expect(row.state).toBe("dispatch_may_have_started");
        state.rows.set(args[1], {
          ...row,
          state: "not_dispatched",
          nativeRetryProof: {
            kind: "native_rejection_after_forward",
            reason: "admission_storage_conflict",
          },
        });
      },
    );
    const f = await fixture(32768, 0, 2, 5000, undefined, {
      admission: { ...state.admission, forward, recordNativeRejection },
      modelDispatchV2: true,
      modelDispatchCapacity128: true,
      nativeRetry: true,
      ...(mode === "private"
        ? { nativeRejection: true }
        : {
            nativeStatusResponse: async (
              response: ServerResponse,
              requestRef: string,
            ) => {
              response.writeHead(202, { "content-type": "application/json" });
              response.end(
                JSON.stringify({
                  requestRef,
                  effect: "dispatch_started",
                  status: "pending",
                }),
              );
            },
          }),
      retryProofStatus: proofDenied ? 403 : 200,
      retryProof: (requestRef, executionRef) =>
        proofDenied
          ? {
              code: "forbidden",
              traceRef: "denied-native-proof-fixture",
              requestRef,
              effect: "effect_unknown",
              retry: { kind: "never" },
            }
          : {
              kind: "request-retry-proof/v1",
              consumerId: "fixture-consumer",
              executionRef,
              requestRef,
              nonEntryReason: "admission_storage_conflict",
              transportClosed: true,
            },
    });
    const bytes = companionEnvelope();
    const context = {
      ...companionContext,
      dispatchVersion: 2 as const,
      requestOrdinal: 1,
      routeIdentityHash: "e".repeat(64),
    };
    const original = await state.admission.claim(
      f.authorization(),
      context,
      createHash("sha256").update(bytes).digest("hex"),
    );
    state.rows.set(context.dispatchId, {
      ...original.dispatch,
      dispatchVersion: 2,
      requestOrdinal: 1,
      routeIdentityHash: context.routeIdentityHash,
      requestBytes: bytes.byteLength,
      maxOutputTokens: 4096,
    });
    const app = Fastify({ logger: false });
    await registerReviewRunGatewayRelayRoutes(app, f.relay);
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(
        "http://127.0.0.1:" +
          (app.server.address() as AddressInfo).port +
          "/api/action/v2/account-gateway/responses",
        {
          method: "POST",
          headers: {
            ...modelForwardHeaders(1),
            "x-reviewrouter-request-ref": "unowned-client-reference",
          },
          body: bytes,
        },
      );
      const body: unknown = await response.json();
      expect(response.status).toBe(mode === "private" ? 502 : 202);
      expect(response.headers.get("x-reviewrouter-request-ref")).toBe(
        proofDenied ? null : original.dispatch.nativeRequestRef,
      );
      expect(response.headers.get("x-reviewrouter-request-ref")).not.toBe(
        "unowned-client-reference",
      );
      expect(body).toMatchObject(
        mode === "private"
          ? {
              error: {
                code: "companion_request_failed",
                effect: proofDenied
                  ? "effect_unknown"
                  : "rejected_before_dispatch",
                requestRef: original.dispatch.nativeRequestRef,
                cause: "upstream_failure",
              },
            }
          : {
              requestRef: original.dispatch.nativeRequestRef,
              effect: "dispatch_started",
              status: "pending",
            },
      );
      const recorded = state.rows.get(context.dispatchId);
      expect(recorded).toMatchObject({
        state: proofDenied ? "effect_unknown" : "not_dispatched",
        nativeRequestRef: original.dispatch.nativeRequestRef,
      });
      if (proofDenied) expect(recorded).not.toHaveProperty("nativeRetryProof");
      else
        expect(recorded).toHaveProperty("nativeRetryProof", {
          kind: "native_rejection_after_forward",
          reason: "admission_storage_conflict",
        });
      expect(recordNativeRejection).toHaveBeenCalledTimes(proofDenied ? 0 : 1);
      expect(f.retryProofCalls).toHaveLength(1);
      expect(f.retryProofHeaders).toEqual([
        {
          authorization: "Bearer local-execution-token",
          capability: "request-retry-proof/v1",
        },
      ]);
      expect(f.retryProofCalls[0]?.requestRef).toBe(
        original.dispatch.nativeRequestRef,
      );
      expect(forward).toHaveBeenCalledTimes(1);
      expect(f.intents).toHaveLength(1);
      expect(f.requestRefs).toEqual([original.dispatch.nativeRequestRef]);
      expect(f.requestBodies).toEqual([bytes.toString()]);
    } finally {
      await app.close();
      await f.relay.shutdown();
    }
  },
);

it("refuses a successor before preparation when the original Gateway client was lost", async () => {
  const state = companionReservation("finding_discovery");
  const forward = vi.fn(
    async (
      ...args: Parameters<ReviewRunModelDispatchAdmission["forward"]>
    ) => ({
      ...(await state.admission.claim(...args)),
      status: "claimed" as const,
    }),
  );
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: { ...state.admission, forward },
    modelDispatchV2: true,
    modelDispatchCapacity128: true,
    nativeRetry: true,
  });
  const bytes = companionEnvelope();
  const context = {
    ...companionContext,
    dispatchVersion: 2 as const,
    requestOrdinal: 2,
    routeIdentityHash: "e".repeat(64),
  };
  const reserved = await state.admission.claim(
    f.authorization(),
    context,
    createHash("sha256").update(bytes).digest("hex"),
  );
  state.rows.set(context.dispatchId, {
    ...reserved.dispatch,
    dispatchVersion: 2,
    requestOrdinal: 2,
    routeIdentityHash: context.routeIdentityHash,
    requestBytes: bytes.byteLength,
    maxOutputTokens: 4096,
    retryOfDispatchId: `rr-model-${"b".repeat(64)}`,
  });
  try {
    await expect(
      f.relay.responses(
        "local-authorization-token",
        bytes,
        new AbortController(),
        undefined,
        context,
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_retry_denied" });
    expect(forward).not.toHaveBeenCalled();
    expect(f.intents).toHaveLength(0);
    expect(f.requestBodies).toHaveLength(0);
    expect(f.retryProofCalls).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

it.each(forwardingBounds)(
  "HTTP native forwarding uses frozen capacity128=$capacity128 / clamp=$requests / ordinal=$ordinal",
  async ({ capacity128, requests, ordinal, allowed }) => {
    const state = companionReservation("finding_discovery");
    const forward = vi.fn(
      async (
        ...args: Parameters<ReviewRunModelDispatchAdmission["forward"]>
      ) => {
        const result = await state.admission.claim(...args);
        if (result.status !== "restored")
          throw new Error("reservation_required");
        return { ...result, status: "claimed" as const };
      },
    );
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      async (response) => {
        response.end(completedFrame);
      },
      {
        admission: { ...state.admission, forward },
        modelDispatchV2: true,
        modelDispatchCapacity128: capacity128,
      },
      requests,
    );
    const app = Fastify();
    const bytes = companionEnvelope();
    const context = {
      ...companionContext,
      dispatchVersion: 2 as const,
      requestOrdinal: ordinal,
      routeIdentityHash: "e".repeat(64),
    };
    const reserved = await state.admission.claim(
      f.authorization(),
      context,
      createHash("sha256").update(bytes).digest("hex"),
    );
    state.rows.set(context.dispatchId, {
      ...reserved.dispatch,
      dispatchVersion: 2,
      requestOrdinal: ordinal,
      routeIdentityHash: context.routeIdentityHash,
      requestBytes: bytes.byteLength,
      maxOutputTokens: 4096,
    });
    await registerReviewRunGatewayRelayRoutes(app, f.relay);
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(
        `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/action/v2/account-gateway/responses`,
        {
          method: "POST",
          headers: modelForwardHeaders(ordinal),
          body: bytes,
        },
      );
      const body = await response.text();
      expect(response.status, body).toBe(allowed ? 200 : 400);
      if (allowed) expect(body).toBe(completedFrame);
      expect(f.intents).toHaveLength(allowed ? 1 : 0);
      expect(f.admissions).toHaveLength(allowed ? 1 : 0);
      expect(forward).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(f.requestRefs).toEqual(
        allowed ? ["stored-companion-native-ref"] : [],
      );
      if (!allowed)
        expect(JSON.parse(body)).toMatchObject({
          error: {
            code: "model_dispatch_headers_invalid",
            effect: "not_dispatched",
          },
        });
    } finally {
      await app.close();
      await f.relay.shutdown();
    }
  },
);

it.each([
  { capacity128: false, requests: 128, ordinal: 33 },
  { capacity128: true, requests: 128, ordinal: 129 },
  { capacity128: true, requests: 16, ordinal: 17 },
])(
  "direct forwarding rejects out-of-bound ordinal before prepare ($ordinal / $requests / $capacity128)",
  async ({ capacity128, requests, ordinal }) => {
    const state = companionReservation();
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      undefined,
      {
        admission: { ...state.admission, forward: state.admission.claim },
        modelDispatchV2: true,
        modelDispatchCapacity128: capacity128,
      },
      requests,
    );
    try {
      await expect(
        f.relay.responses(
          "authorization-1",
          companionEnvelope(),
          new AbortController(),
          undefined,
          {
            ...companionContext,
            dispatchVersion: 2,
            requestOrdinal: ordinal,
            routeIdentityHash: "e".repeat(64),
          },
        ),
      ).rejects.toMatchObject({ code: "model_dispatch_headers_invalid" });
      expect(f.intents).toHaveLength(0);
      expect(f.admissions).toHaveLength(0);
    } finally {
      await f.relay.shutdown();
    }
  },
);

it("retains the exported parser's default32 and rejects unknown frozen capacity before native prepare", async () => {
  const request = { headers: modelForwardHeaders(33) };
  expect(() => readReviewRunCompanionDispatchContext(request)).toThrow(
    "model_dispatch_headers_invalid",
  );
  const state = companionReservation();
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: { ...state.admission, forward: state.admission.claim },
    modelDispatchV2: true,
    modelDispatchCapacity128: true,
  });
  const canonical = f.authorization().runtimeSnapshotCanonicalJson;
  if (typeof canonical !== "string")
    throw new Error("fixture_snapshot_required");
  const snapshot = JSON.parse(canonical);
  snapshot.modelDispatchCapability.capacityPolicy =
    "unapproved-capacity-policy";
  f.overrides.set("authorization-1", {
    runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
  });
  const app = Fastify();
  await registerReviewRunGatewayRelayRoutes(app, f.relay);
  try {
    const result = await app.inject({
      method: "POST",
      url: "/api/action/v2/account-gateway/responses",
      headers: modelForwardHeaders(33),
      payload: companionEnvelope(),
    });
    expect(result.statusCode).toBe(502);
    expect(f.intents).toHaveLength(0);
    expect(f.admissions).toHaveLength(0);
  } finally {
    await app.close();
    await f.relay.shutdown();
  }
});

it.each(forwardingBounds)(
  "Hosted HTTP parses frozen capacity before grant admission ($capacity128 / $requests / $ordinal)",
  async ({ capacity128, requests, ordinal, allowed }) => {
    const state = companionReservation();
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      undefined,
      {
        admission: state.admission,
        modelDispatchV2: true,
        modelDispatchCapacity128: capacity128,
      },
      requests,
    );
    const canonical = f.authorization().runtimeSnapshotCanonicalJson;
    if (typeof canonical !== "string")
      throw new Error("fixture_snapshot_required");
    const snapshot = JSON.parse(canonical);
    delete snapshot.lifecycleVerificationCapability;
    snapshot.gateway = null;
    snapshot.agent.modelTransports = ["provider_api"];
    snapshot.modelDispatchCapability.transport = "hosted_pool";
    snapshot.modelDispatchCapability.wireProtocol = "codex-responses";
    snapshot.configurationCanonicalJson = canonicalJson(
      parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        providers: [
          {
            ...workspacePolicyFixture.providers[0],
            authMode: "codex_subscription_oauth_hosted_pool",
            model: "gpt-5.6-sol",
          },
        ],
      }),
    );
    snapshot.hosted = {
      grantId: "grant-1",
      invocationId: "invocation-1",
      poolId: "pool-1",
      repositoryBindingId: "binding-1",
      activeAccountId: "account-1",
      reviewRequestId: "request-1",
      providerInvocationKey: "a".repeat(64),
      policyFingerprint: "b".repeat(64),
      model: "gpt-5.6-sol",
      expiresAt: new Date(Date.parse(snapshot.deadline) + 120000).toISOString(),
      bindingRevision: 1,
      runtimeConfigVersion: 1,
      authzEpoch: "1",
      runtimeAuthzEpoch: "1",
    };
    f.overrides.set("authorization-1", {
      runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
    });
    const authority = vi.fn(async () => false);
    const native = vi.fn(async () => {
      throw new Error("unexpected_native_grant");
    });
    const route = createReviewRunHostedModelRoute({
      prisma: {} as never,
      api: {
        authorizations: f.authorizations,
        checkAuthority: authority,
        admission: state.admission,
        reconcileNativeProof: async () => "completed",
      } as never,
      native: {
        authorization: { authorize: native },
        relay: { open: native },
      } as never,
    });
    const app = Fastify();
    await registerReviewRunHostedModelRoute(app, route);
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(
        `http://127.0.0.1:${(app.server.address() as AddressInfo).port}${hostedModelRoutePath}`,
        {
          method: "POST",
          headers: {
            ...modelForwardHeaders(ordinal),
            [hostedModelGrantHeader]: "synthetic-hosted-grant",
          },
          body: companionEnvelope(),
        },
      );
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(allowed ? 409 : 400);
      expect(body).toMatchObject({
        error: {
          code: allowed
            ? "hosted_model_authority_changed"
            : "model_dispatch_headers_invalid",
          effect: "not_dispatched",
        },
      });
      expect(authority).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(native).not.toHaveBeenCalled();
    } finally {
      await app.close();
      await f.relay.shutdown();
    }
  },
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
  { profileId: "profile-1", model: "gpt-5.6-sol", reviewerPlan: false },
  {
    profileId: "openai-codex-oauth-responses-v1",
    model: "authorized-account-model-not-in-anchor",
    reviewerPlan: false,
  },
  {
    profileId: "openai-codex-oauth-responses-v1",
    model: "authorized-account-model-not-in-anchor",
    reviewerPlan: true,
  },
])(
  "companion forwards exact hashed bytes with the stored native ref and settles completion for $model (reviewer plan=$reviewerPlan)",
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
      selection.reviewerPlan
        ? {
            models: [selection.model, "gpt-5.6-sol"],
            profileModelIds: ["gpt-5.6-sol"],
          }
        : undefined,
    );
    const reviewerId = selection.reviewerPlan ? "reviewer-0" : undefined;
    try {
      const bytes = companionEnvelope(selection.model);
      const response = await f.relay.responses(
        "authorization-1",
        bytes,
        new AbortController(),
        undefined,
        companionContext,
        reviewerId,
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
          reviewerId,
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

it("streams lifecycle SSE larger than the result limit while keeping the authorized wire budget", async () => {
  const state = companionReservation();
  const forward = vi.fn(
    async (...args: Parameters<ReviewRunModelDispatchAdmission["forward"]>) => {
      const result = await state.admission.claim(...args);
      if (result.status !== "restored") throw new Error("reservation_required");
      return { ...result, status: "claimed" as const };
    },
  );
  const frame = `data: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", item_id: "rs_" + "a".repeat(40), output_index: 0, summary_index: 0, sequence_number: 1, delta: "x" })}\n\n`;
  const terminal = `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }], usage: { output_tokens: 400 } } })}\n\n`;
  const expected = frame.repeat(300) + terminal;
  expect(Buffer.byteLength(expected)).toBeGreaterThan(32768);
  expect(Buffer.byteLength(expected)).toBeLessThan(65536);
  const f = await fixture(
    65536,
    0,
    2,
    5000,
    async (res) => {
      res.end(expected);
    },
    { admission: { ...state.admission, forward }, modelDispatchV2: true },
  );
  const app = Fastify();
  const bytes = companionEnvelope();
  const context = {
    ...companionContext,
    dispatchVersion: 2 as const,
    requestOrdinal: 1,
    routeIdentityHash: "e".repeat(64),
  };
  const reserved = await state.admission.claim(
    f.authorization(),
    context,
    createHash("sha256").update(bytes).digest("hex"),
  );
  state.rows.set(context.dispatchId, {
    ...reserved.dispatch,
    dispatchVersion: 2,
    requestOrdinal: 1,
    routeIdentityHash: context.routeIdentityHash,
    requestBytes: bytes.byteLength,
    maxOutputTokens: 4096,
  });
  await registerReviewRunGatewayRelayRoutes(app, f.relay);
  await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const response = await fetch(
      `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/action/v2/account-gateway/responses`,
      { method: "POST", headers: modelForwardHeaders(1), body: bytes },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "completed",
    );
    expect(f.requestRefs).toHaveLength(1);
    expect(forward).toHaveBeenCalledTimes(1);
  } finally {
    await app.close();
    await f.relay.shutdown();
  }
});

it("keeps oversized companion streams unknown and logs a safe failure phase", async () => {
  const state = companionReservation();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture(49152, 60000, 2, 5000, undefined, {
    admission: state.admission,
  });
  try {
    const response = await f.relay.responses(
      "authorization-1",
      companionEnvelope(),
      new AbortController(),
      undefined,
      companionContext,
    );
    if (response.kind !== "stream") throw new Error("stream_expected");
    const reader = response.body.getReader();
    await expect(
      (async () => {
        while (!(await reader.read()).done) {
          /* consume */
        }
      })(),
    ).rejects.toMatchObject({ effect: "effect_unknown" });
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "effect_unknown",
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "review_run_companion_stream_failure",
        phase: "upstream_read",
        maxStreamBytes: 49152,
        receivedBytes: expect.any(Number),
      }),
    );
    expect(f.requestRefs).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
    log.mockRestore();
  }
});

it.each([
  { phase: "native_status", loggerThrows: false, statusCase: "sdk" },
  { phase: "native_status", loggerThrows: true, statusCase: "sdk" },
  { phase: "usage_outcome", loggerThrows: false, statusCase: "sdk" },
  { phase: "usage_outcome", loggerThrows: true, statusCase: "sdk" },
  {
    phase: "companion_settlement",
    loggerThrows: false,
    statusCase: "getter",
  },
  { phase: "companion_settlement", loggerThrows: true, statusCase: "getter" },
  { phase: "usage_outcome", loggerThrows: false, statusCase: "invalid_sdk" },
  {
    phase: "usage_outcome",
    loggerThrows: false,
    statusCase: "invalid_status",
  },
] as const)(
  "attributes companion EOF failure to $phase without terminal delivery or replay (logger throws=$loggerThrows, status=$statusCase)",
  async ({ phase, loggerThrows, statusCase }) => {
    const state = companionReservation();
    const eof = deferred();
    const getter = vi.fn(() => {
      throw new Error("secret-getter");
    });
    const failure = Object.defineProperties(
      new TypeError("secret-persistence-message"),
      {
        stack: { value: "secret-stack" },
        code: { get: getter },
        httpStatus:
          statusCase === "getter"
            ? { get: getter }
            : { value: statusCase === "sdk" ? 503 : 200 },
        status: {
          value:
            statusCase === "invalid_status"
              ? 503.5
              : statusCase === "sdk"
                ? 502
                : 503,
        },
        statusCode:
          statusCase === "invalid_status" ? { value: 503 } : { get: getter },
        meta: { value: { detail: "secret-database-detail" } },
      },
    );
    if (phase === "companion_settlement")
      Object.defineProperty(failure, "message", { get: getter });
    const log = vi.spyOn(console, "error").mockImplementation(() => {
      if (loggerThrows) throw new Error("secret-log-sink");
    });
    const requestStatus = vi.fn((requestRef: string) => ({
      statusCode: 503,
      body: {
        code: "upstream_failure",
        traceRef: "secret-trace",
        requestRef,
        effect: "effect_unknown",
        retry: { kind: "readback" },
      },
    }));
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      async (upstream) => {
        upstream.write(progressFrame);
        await eof.promise;
        upstream.end(completedFrame);
      },
      {
        admission: state.admission,
        ...(phase === "native_status" ? { requestStatus } : {}),
      },
    );
    const recordOutcome = f.usage!.outcome;
    const usage = vi
      .spyOn(f.usage!, "outcome")
      .mockImplementation(async (input) => {
        if (phase === "usage_outcome" && input.effect === "completed")
          throw failure;
        return recordOutcome(input);
      });
    const recordSettlement = state.admission.settle;
    const settlement = vi
      .spyOn(state.admission, "settle")
      .mockImplementation(async (authorizationId, dispatchId, effect) => {
        if (phase === "companion_settlement" && effect === "completed")
          throw failure;
        return recordSettlement(authorizationId, dispatchId, effect);
      });
    const http = await serveRelay({
      ...f.relay,
      responses: (token, _raw, controller, diagnostic) =>
        f.relay.responses(
          token,
          companionEnvelope(),
          controller,
          diagnostic,
          companionContext,
        ),
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let appClosed = false;
    try {
      const response = await http.request();
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      await readExactFrame(reader, progressFrame);
      eof.resolve();
      let tail = "";
      await expect(
        (async () => {
          for (;;) {
            const part = await reader!.read();
            if (part.done) return;
            tail += Buffer.from(part.value).toString();
          }
        })(),
      ).rejects.toBeDefined();
      expect(tail).toBe("");
      expect(
        log.mock.calls.filter(
          ([event]) => event?.event === "review_run_companion_stream_failure",
        ),
      ).toEqual([
        [
          {
            event: "review_run_companion_stream_failure",
            phase,
            requestRef: "stored-companion-native-ref",
            receivedBytes: Buffer.byteLength(progressFrame + completedFrame),
            maxStreamBytes: 32768,
            signalAborted: false,
            errorCategory: phase === "native_status" ? "Error" : "TypeError",
            httpStatus: 503,
            ...(phase === "native_status" ? { sdkCode: "safe_error" } : {}),
          },
        ],
      ]);
      expect(
        log.mock.calls.flat().some((value) => value instanceof Error),
      ).toBe(false);
      expect(getter).not.toHaveBeenCalled();
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
      expect(requestStatus).toHaveBeenCalledTimes(
        phase === "native_status" ? 1 : 0,
      );
      expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
        "effect_unknown",
      );
      expect(f.effects.at(-1)?.effect).toBe("effect_unknown");
      await expect(
        f.relay.responses(
          "authorization-1",
          companionEnvelope(),
          new AbortController(),
          undefined,
          companionContext,
        ),
      ).rejects.toMatchObject({ code: "companion_dispatch_already_claimed" });
      expect(f.requestRefs).toEqual(["stored-companion-native-ref"]);
      expect(f.admissions).toHaveLength(1);
      reader.releaseLock();
      reader = undefined;
      await http.app.close();
      appClosed = true;
      expect([...f.nativeExecutions.values()]).toEqual(["closed"]);
    } finally {
      eof.resolve();
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      if (!appClosed) await http.app.close();
      usage.mockRestore();
      settlement.mockRestore();
      log.mockRestore();
    }
  },
);

it.each([
  { phase: "native_status", fail: false },
  { phase: "usage_outcome", fail: false },
  { phase: "companion_settlement", fail: false },
  { phase: "native_status", fail: true },
  { phase: "usage_outcome", fail: true },
  { phase: "companion_settlement", fail: true },
] as const)(
  "keeps EOF settlement authoritative through cancellation at $phase (fails=$fail)",
  async ({ phase, fail }) => {
    const state = companionReservation();
    const settlementStarted = deferred();
    const releaseSettlement = deferred();
    let completedRecorded = false;
    const recordSettlement = state.admission.settle;
    const settlement = vi
      .spyOn(state.admission, "settle")
      .mockImplementation(async (authorizationId, dispatchId, effect) => {
        if (phase === "companion_settlement" && effect === "completed") {
          settlementStarted.resolve();
          await releaseSettlement.promise;
          if (fail) throw new Error("fixture_settlement_failed");
        }
        await recordSettlement(authorizationId, dispatchId, effect);
        if (effect === "completed") completedRecorded = true;
      });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      async (upstream) => {
        upstream.end(progressFrame + completedFrame);
      },
      {
        admission: state.admission,
        ...(phase === "native_status"
          ? {
              requestStatus: async (requestRef: string) => {
                settlementStarted.resolve();
                await releaseSettlement.promise;
                return fail
                  ? {
                      statusCode: 503,
                      body: {
                        code: "upstream_failure",
                        traceRef: "fixture-native-status-failure",
                        requestRef,
                        effect: "effect_unknown",
                        retry: { kind: "readback" },
                      },
                    }
                  : {
                      statusCode: 200,
                      body: {
                        requestRef,
                        effect: "completed",
                        status: "completed",
                      },
                    };
              },
            }
          : {}),
      },
    );
    const recordOutcome = f.usage!.outcome;
    const usage = vi
      .spyOn(f.usage!, "outcome")
      .mockImplementation(async (input) => {
        if (phase === "usage_outcome" && input.effect === "completed") {
          settlementStarted.resolve();
          await releaseSettlement.promise;
          if (fail) throw new Error("fixture_settlement_failed");
        }
        return recordOutcome(input);
      });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let draining: Promise<void> | undefined;
    try {
      const response = await f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
      );
      if (response.kind !== "stream") throw new Error("stream_expected");
      reader = response.body.getReader();
      draining = (async () => {
        while (!(await reader!.read()).done) {
          // Drive EOF until its status read or one settlement write is held.
        }
      })();
      void draining.catch(() => {});
      await Promise.race([
        settlementStarted.promise,
        draining.then(() => {
          throw new Error("stream_ended_before_companion_settlement");
        }),
      ]);
      expect(completedRecorded).toBe(false);
      await reader.cancel();
      await response.cancel();
      await draining;
      expect(completedRecorded).toBe(false);
      expect(f.effects.some(({ effect }) => effect === "effect_unknown")).toBe(
        false,
      );
      expect(
        settlement.mock.calls.some(
          ([, , effect]) => effect === "effect_unknown",
        ),
      ).toBe(false);
      releaseSettlement.resolve();

      await vi.waitFor(() => {
        expect(
          log.mock.calls.filter(
            ([event]) => event?.event === "review_run_companion_stream_failure",
          ),
        ).toEqual([
          [
            {
              event: "review_run_companion_stream_failure",
              phase: fail ? phase : "downstream",
              requestRef: "stored-companion-native-ref",
              receivedBytes: Buffer.byteLength(progressFrame + completedFrame),
              maxStreamBytes: 32768,
              signalAborted: false,
              errorCategory: fail ? "Error" : "TypeError",
              ...(fail && phase === "native_status"
                ? { httpStatus: 503, sdkCode: "safe_error" }
                : {}),
            },
          ],
        ]);
        expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
          fail ? "effect_unknown" : "completed",
        );
        expect(f.effects.at(-1)?.effect).toBe(
          fail ? "effect_unknown" : "completed",
        );
      });
      expect(completedRecorded).toBe(!fail);
      expect(f.effects.map(({ effect }) => effect)).toEqual(
        !fail
          ? ["dispatch_started", "completed"]
          : phase !== "companion_settlement"
            ? ["dispatch_started", "effect_unknown"]
            : ["dispatch_started", "completed", "effect_unknown"],
      );
      expect(settlement.mock.calls.map(([, , effect]) => effect)).toEqual(
        !fail
          ? ["completed"]
          : phase !== "companion_settlement"
            ? ["effect_unknown"]
            : ["completed", "effect_unknown"],
      );
      expect(f.requestRefs).toEqual(["stored-companion-native-ref"]);
      expect(
        log.mock.calls.flat().some((value) => value instanceof Error),
      ).toBe(false);
    } finally {
      releaseSettlement.resolve();
      await reader?.cancel().catch(() => {});
      await draining?.catch(() => {});
      reader?.releaseLock();
      try {
        await f.relay.shutdown();
      } finally {
        usage.mockRestore();
        settlement.mockRestore();
        log.mockRestore();
      }
    }
  },
);

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

it("settles an already claimed dispatch without preparing when its caller aborts during the claim", async () => {
  const state = companionReservation();
  const controller = new AbortController();
  const admission = {
    ...state.admission,
    async claim(
      ...args: Parameters<ReviewRunCompanionDispatchAdmission["claim"]>
    ) {
      const claimed = await state.admission.claim(...args);
      controller.abort();
      return claimed;
    },
  };
  const f = await fixture(32768, 0, 2, 5000, undefined, { admission });
  try {
    await expect(
      f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        controller,
        undefined,
        companionContext,
      ),
    ).rejects.toMatchObject({
      code: "authorization_denied",
      effect: "not_dispatched",
    });
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "not_dispatched",
    );
    expect(f.intents).toHaveLength(0);
    expect(f.admissions).toHaveLength(0);
  } finally {
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
      // The runtime treats admission_limited + not_dispatched as a terminal
      // admission refusal, so the code it acts on must stay generic here.
      code: "companion_request_failed",
      failureCause: "admission_limited",
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

it("preserves confirmed provider quota without replaying the companion request", async () => {
  const state = companionReservation();
  const providerQuota = {
    provider: "openrouter" as const,
    limit: 1000,
    remaining: 0 as const,
    resetAt: "2026-11-04T00:00:00.000Z",
  };
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
    providerQuota,
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
      code: "provider_quota_exhausted",
      statusCode: 502,
      effect: "effect_unknown",
      providerQuota,
    });
    expect(f.requestRefs).toHaveLength(1);
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "effect_unknown",
    );
  } finally {
    await f.relay.shutdown();
  }
});

it.each(["recorded", "not recorded", "record failed", "no recorder"] as const)(
  "returns a reviewer's provider quota only after the relay recorded it (%s)",
  async (outcome) => {
    const recorded = outcome === "recorded";
    const providerQuota = {
      provider: "openrouter" as const,
      limit: 1000,
      remaining: 0 as const,
      resetAt: "2026-11-18T00:00:00.000Z",
    };
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      undefined,
      { admission: companionReservation().admission, providerQuota },
      undefined,
      undefined,
      { models: ["gpt-5.6-sol", "gpt-5.5"], independentAllocations: true },
    );
    const record = vi.fn(async () => {
      if (outcome === "record failed") throw new Error("database_unavailable");
      return recorded;
    });
    if (outcome !== "no recorder")
      Object.assign(f.bindings, { recordProviderQuotaExhausted: record });
    try {
      await expect(
        f.relay.responses(
          "authorization-1",
          Buffer.from("{}"),
          new AbortController(),
          undefined,
          undefined,
          "reviewer-0",
        ),
      ).rejects.toMatchObject({
        code: "provider_quota_exhausted",
        failureScope: "allocation",
        providerQuota: recorded ? providerQuota : undefined,
      });
      if (outcome !== "no recorder")
        expect(record).toHaveBeenCalledWith({
          authorizationId: "authorization-1",
          allocationId: "allocation-0",
        });
    } finally {
      await f.relay.shutdown();
    }
  },
);

it.each([403, 503])(
  "ordinary request logs closed SDK refusal fields for HTTP %s without retrying",
  async (httpStatus) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      undefined,
      undefined,
      128,
      undefined,
      undefined,
      httpStatus,
    );
    const responses = vi.fn(f.relay.responses);
    const http = await serveRelay({ ...f.relay, responses });
    try {
      const response = await http.request();
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "forbidden", effect: "not_dispatched" },
      });
      expect(responses).toHaveBeenCalledTimes(1);
      await expect(responses.mock.results[0]!.value).rejects.toMatchObject({
        code: "safe_error",
        effect: "not_dispatched",
        httpStatus,
        diagnostic: { code: "forbidden" },
      });
      expect(f.requestRefs).toHaveLength(1);
      expect(
        log.mock.calls.map(([event]) => JSON.parse(event as string)),
      ).toEqual([
        {
          event: "review_run_gateway_request_failed",
          stage: "sdk_request",
          sdkCode: "safe_error",
          effect: "not_dispatched",
          diagnosticCode: "forbidden",
          httpStatus,
          requestRef: f.requestRefs[0],
        },
      ]);
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
      expect(f.effects.at(-1)?.effect).toBe("not_dispatched");
    } finally {
      await http.app.close();
      log.mockRestore();
    }
  },
);

it.each([403, 503])(
  "companion returns and logs the closed Gateway cause for HTTP %s without retrying",
  async (httpStatus) => {
    const state = companionReservation();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = await fixture(32768, 0, 2, 5000, undefined, {
      admission: state.admission,
      refusalStatus: httpStatus,
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
        // The code callers act on is unchanged; the Gateway cause rides next to it.
        code: "companion_request_failed",
        failureCause: "forbidden",
        statusCode: 502,
        effect: "effect_unknown",
        requestRef: "stored-companion-native-ref",
      });
      expect(
        log.mock.calls.map(([event]) => [JSON.parse(event as string)]),
      ).toEqual([
        [
          {
            event: "review_run_companion_gateway_request_failed",
            stage: "sdk_request",
            relayCode: "forbidden",
            sdkCode: "safe_error",
            effect: "not_dispatched",
            diagnosticCode: "forbidden",
            httpStatus,
            requestRef: "stored-companion-native-ref",
          },
        ],
      ]);
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
      expect(f.requestRefs).toEqual(["stored-companion-native-ref"]);
      expect(state.rows.size).toBe(1);
      expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
        "effect_unknown",
      );
      expect(f.effects.at(-1)?.effect).toBe("effect_unknown");
    } finally {
      await f.relay.shutdown();
      log.mockRestore();
    }
  },
);

it("companion HTTP refusal carries the closed cause next to the unchanged code", async () => {
  const state = companionReservation();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
    refusalStatus: 403,
  });
  // The route's own body is replaced by the companion envelope and context,
  // so the wire answer of the companion catch is what the Action reads.
  const http = await serveRelay({
    ...f.relay,
    responses: (token, _raw, controller, diagnostic) =>
      f.relay.responses(
        token,
        companionEnvelope(),
        controller,
        diagnostic,
        companionContext,
      ),
  });
  try {
    const response = await http.request();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "companion_request_failed",
        effect: "effect_unknown",
        requestRef: "stored-companion-native-ref",
        cause: "forbidden",
      },
    });
  } finally {
    await http.app.close();
    await f.relay.shutdown();
    log.mockRestore();
  }
});

it("companion distinguishes local authority refusal before the SDK POST", async () => {
  const state = companionReservation();
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
  });
  const resolve = f.authorizations.resolveReviewRunAuthorizationToken;
  const authority = vi.spyOn(
    f.authorizations,
    "resolveReviewRunAuthorizationToken",
  );
  const prepareUsage = f.usage!.prepare;
  const usage = vi
    .spyOn(f.usage!, "prepare")
    .mockImplementation(async (input) => {
      const result = await prepareUsage(input);
      // After the usage wait, let the session read succeed, then revoke at the
      // next token-authority read before any native request can be forwarded.
      authority.mockImplementationOnce(async (input) => {
        f.revoke("authorization-1");
        return resolve(input);
      });
      return result;
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
      code: "companion_request_failed",
      failureCause: "authorization_denied",
      statusCode: 502,
      effect: "effect_unknown",
      requestRef: "stored-companion-native-ref",
    });
    expect(
      log.mock.calls.map(([event]) => JSON.parse(event as string)),
    ).toEqual([
      {
        event: "review_run_companion_gateway_request_failed",
        stage: "local_authority",
        requestRef: "stored-companion-native-ref",
        relayCode: "authorization_denied",
      },
    ]);
    expect(f.intents).toHaveLength(1);
    expect(f.requestRefs).toHaveLength(0);
    expect(state.claimCount()).toBe(1);
    expect(state.rows.size).toBe(1);
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "effect_unknown",
    );
    expect(f.effects.at(-1)?.effect).toBe("effect_unknown");
  } finally {
    usage.mockRestore();
    authority.mockRestore();
    await f.relay.shutdown();
    log.mockRestore();
  }
});

it("companion settles its refusal even when the diagnostic sink throws", async () => {
  const state = companionReservation();
  const log = vi.spyOn(console, "error").mockImplementation(() => {
    throw new Error("sink_failed");
  });
  const f = await fixture(32768, 0, 2, 5000, undefined, {
    admission: state.admission,
    refusalStatus: 403,
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
      code: "companion_request_failed",
      failureCause: "forbidden",
      statusCode: 502,
      effect: "effect_unknown",
    });
    expect(f.requestRefs).toEqual(["stored-companion-native-ref"]);
    expect(state.rows.get(companionContext.dispatchId)?.state).toBe(
      "effect_unknown",
    );
  } finally {
    await f.relay.shutdown();
    log.mockRestore();
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
it("allows NVIDIA relay for an ordinary authorized repository and preserves pre-dispatch denials", async () => {
  const model = "nvidia/nemotron-3.5-super-vl-120b-a12b";
  const selection = {
    profileId: "nvidia-build-chat-apikey-v1",
    model,
    authKind: "api_key" as const,
  };
  const repository = {
    githubRepositoryId: "456",
    repositoryFullName: "customer/private-source",
  };
  for (const failure of [
    null,
    "missing repository",
    "foreign authority",
    "stale allocation",
  ] as const) {
    const f = await fixture(
      32768,
      0,
      2,
      5000,
      undefined,
      undefined,
      128,
      selection,
      { models: [model], independentAllocations: true },
      undefined,
      failure === "missing repository" ? null : repository,
    );
    try {
      if (failure === "foreign authority") f.revoke("authorization-1");
      if (failure === "stale allocation")
        f.revokedAllocations.add("allocation-0");
      const pending = f.relay.responses(
        "authorization-1",
        companionEnvelope(model),
        new AbortController(),
        undefined,
        undefined,
        "reviewer-0",
      );
      if (failure) {
        await expect(pending).rejects.toMatchObject({
          effect: "not_dispatched",
        });
        expect(f.intents).toHaveLength(0);
        expect(f.admissions).toHaveLength(0);
        expect(f.requestBodies).toHaveLength(0);
      } else {
        const response = await pending;
        expect(response.kind).toBe("stream");
        if (response.kind !== "stream") throw new Error("stream_expected");
        const reader = response.body.getReader();
        while (!(await reader.read()).done) {
          // Consume the synthetic native terminal response.
        }
        expect(f.requestBodies).toHaveLength(1);
      }
    } finally {
      await f.relay.shutdown();
    }
  }
});

it("releases NVIDIA relay capacity when repository lookup stalls and caller aborts", async () => {
  const model = "nvidia/nemotron-3.5-super-vl-120b-a12b";
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let reads = 0;
  const f = await fixture(
    32768,
    0,
    2,
    5000,
    undefined,
    undefined,
    128,
    { profileId: "nvidia-build-chat-apikey-v1", model, authKind: "api_key" },
    undefined,
    undefined,
    async () => {
      if (++reads === 1) {
        entered();
        return new Promise<never>(() => {});
      }
      return {
        githubRepositoryId: "1390973362",
        repositoryFullName: "777genius/rr-hosted-pool-e2e-20260927",
      };
    },
  );
  const relay = f.restartRelay(2, 1);
  try {
    const controller = new AbortController();
    const pending = relay.responses(
      "authorization-1",
      companionEnvelope(model),
      controller,
    );
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "authorization_denied",
    });
    const result = await relay.responses(
      "authorization-1",
      companionEnvelope(model),
      new AbortController(),
    );
    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") throw new Error("stream_expected");
    const reader = result.body.getReader();
    while (!(await reader.read()).done) {
      // Consume the synthetic terminal response.
    }
    expect(f.requestBodies).toHaveLength(1);
  } finally {
    await relay.shutdown();
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
      Partial<
        Pick<
          ReviewRunModelDispatchAdmission,
          "forward" | "recordNativeRejection"
        >
      >;
    unpaid?: boolean;
    providerQuota?: {
      provider: "openrouter";
      limit: number;
      remaining: 0;
      resetAt: string;
    };
    refusalStatus?: number;
    requestStatus?: (requestRef: string) =>
      | { statusCode: number; body: unknown }
      | Promise<{ statusCode: number; body: unknown }>;
    failUsageOutcome?: boolean;
    modelDispatchV2?: boolean;
    modelDispatchCapacity128?: boolean;
    nativeRetry?: boolean;
    nativeRejection?: boolean;
    nativeStatusResponse?: (
      response: ServerResponse,
      requestRef: string,
    ) => Promise<void>;
    retryProofStatus?: number;
    retryProof?: (requestRef: string, executionRef: string) => unknown;
  },
  capturedRequests = 128,
  selection: {
    profileId: string;
    model: string;
    authKind?: "oauth" | "api_key";
  } = { profileId: "profile-1", model: "gpt-5.6-sol" },
  multi?: {
    models: readonly string[];
    profileModelIds?: readonly string[];
    independentAllocations?: boolean;
    grantConcurrency?: number;
  },
  nativeRefusalStatus?: number,
  nvidiaRepository?:
    | {
        readonly githubRepositoryId: string;
        readonly repositoryFullName: string;
      }
    | (() => Promise<{
        readonly githubRepositoryId: string;
        readonly repositoryFullName: string;
      } | null>)
    | null,
) {
  const retryProofCalls: { requestRef: string; executionRef: string }[] = [];
  const retryProofHeaders: {
    authorization: string | undefined;
    capability: string | string[] | undefined;
  }[] = [];
  const deadline = new Date(Date.now() + 120_000).toISOString();
  const limits = {
    requests: capturedRequests,
    concurrency: multi?.grantConcurrency ?? 1,
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
    providers: (multi?.models ?? [selection.model]).map((model, index) => ({
      kind: "codex",
      authMode: "codex_account_gateway",
      model,
      reasoningEffort: "high",
      fastMode: false,
      agenticContext: true,
      requiredHealthy: true,
      gatewayBindingId: multi?.independentAllocations
        ? `binding-${index + 1}`
        : gateway.bindingId,
      gatewayProfileRef: gateway.profileRef,
    })),
    execution: {
      providerLimit: multi?.models.length ?? 1,
      providerMaxParallel: multi?.models.length ?? 1,
      inlineMinAgreement: 1,
    },
  });
  const legacySnapshot = (id: string) => ({
    snapshotVersion: 3,
    ...(companionOptions?.modelDispatchV2
      ? {
          modelDispatchCapability: {
            ...(companionOptions.nativeRetry
              ? {
                  retryPolicy:
                    reviewModelDispatchNativeRetryContract.retryPolicy,
                }
              : {}),
            ...(companionOptions.modelDispatchCapacity128
              ? {
                  capacityPolicy:
                    reviewModelDispatchCapacity128Contract.capacityPolicy,
                }
              : {}),
            extensionId: "review-model-dispatch.v2",
            version: 2,
            transport: "account_gateway",
            wireProtocol: "openai-responses",
            outputTokenLimit: "terminal_acceptance",
            routeIdentityHash: "e".repeat(64),
            providerIndex: 0,
            model: selection.model,
            deadline,
            maxRequests: Math.min(
              companionOptions.modelDispatchCapacity128 ? 128 : 32,
              capturedRequests,
            ),
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
  const canonical = (id: string) => {
    const legacy = legacySnapshot(id);
    if (!multi) return canonicalJson(legacy);
    const { agent, agentProfileDigest, gateway: original, ...common } = legacy;
    const reviewers = multi.models.map((model, index) => ({
      reviewerId: `reviewer-${index}`,
      providerIndex: index,
      providerVoteIdentityHash: index.toString(16).padStart(64, "0"),
      required: true,
      transport: {
        kind: "account_gateway",
        allocationId: `allocation-${multi.independentAllocations ? index : 0}`,
      },
      requestedModel: model,
      reasoningEffort: "high",
      agenticContext: true,
      fastMode: false,
      agentProfile: agent,
      agentProfileDigest,
      concurrencyGroupId: `allocation-${multi.independentAllocations ? index : 0}`,
      investigationGrant: null,
    }));
    const { providerIndex: _providerIndex, ...allocation } = original;
    void _providerIndex;
    return canonicalJson({
      ...common,
      snapshotVersion: 4,
      primaryReviewerId: "reviewer-0",
      maxParallelReviewers: multi.models.length,
      inlineMinAgreement: 1,
      reviewers,
      allocations: (multi.independentAllocations
        ? multi.models
        : [multi.models[0]]
      ).map((_, index) => ({
        ...allocation,
        bindingId: multi.independentAllocations
          ? `binding-${index + 1}`
          : allocation.bindingId,
        policySubject: multi.independentAllocations
          ? `binding-${index + 1}`
          : allocation.policySubject,
        allocationId: `allocation-${index}`,
        operationId: `${allocation.operationId}-${index}`,
        invocationId: `${allocation.invocationId}-${index}`,
        attemptId: `${allocation.attemptId}-${index}`,
      })),
    });
  };
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
  const revokedAllocations = new Set<string>();
  const ownerKey = (owner: {
    authorizationId: string;
    allocationId?: string;
  }) =>
    owner.allocationId === undefined
      ? owner.authorizationId
      : `${owner.authorizationId}\0${owner.allocationId}`;
  const bindings = {
    read: async (owner: { authorizationId: string; allocationId?: string }) =>
      revokedAllocations.has(owner.allocationId ?? "")
        ? { status: "denied" as const }
        : {
            status: "live" as const,
            binding: savedBindings.get(ownerKey(owner)) ?? null,
          },
    readForCleanup: async (owner: {
      authorizationId: string;
      allocationId?: string;
    }) => savedBindings.get(ownerKey(owner)) ?? null,
    attach: async (
      owner: { authorizationId: string; allocationId?: string },
      value: ReviewRunGatewayExecutionBinding,
    ) => {
      savedBindings.set(ownerKey(owner), value);
      return { status: "attached" as const, binding: value };
    },
  };
  const snapshots = {
    capture: async () => null,
    isLive: async () => true,
    isAllocationLive: async ({ allocationId }: { allocationId: string }) =>
      !revokedAllocations.has(allocationId),
  };
  const nativeExecutions = new Map<string, "active" | "closed">();
  const nativeCloses: string[] = [];
  const nativeCloseReasons: c.Close["reason"][] = [];
  const nativeCloseOperationIds: string[] = [];
  let closeState: "applied" | "unknown" | "failure" = "applied";
  let closeResponseOverride:
    | ((operationId: string) => { status: number; body: unknown })
    | undefined;
  let closeGate: Promise<void> | undefined;
  let closeStarted: (() => void) | undefined;
  let prepareGate: Promise<void> | undefined;
  let prepareStarted: (() => void) | undefined;
  let prepareFailure = false;
  let prepareRejection:
    | { statusCode: number; body: (intent: c.Prepare) => unknown }
    | undefined;
  const operations = new Map<string, c.Operation>();
  const operationReads: string[] = [];
  let operationReadFailure = false;
  let operationReadHook: (() => void) | undefined;
  const intents: c.Prepare[] = [];
  const admissions: c.Admission[] = [];
  const requestModels: string[] = [];
  const requestBodies: string[] = [];
  const requestRefs: string[] = [];
  const effects: { requestRef: string; effect: c.RequestStatus["effect"] }[] =
    [];
  const requestOwners = new Map<string, string | undefined>();
  const authorityChecks: ("full" | "local")[] = [];
  let heldAuthority:
    | {
        ids: Set<string>;
        entered: Set<string>;
        started: () => void;
        pending: Promise<void>;
      }
    | undefined;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    if (req.url === "/internal/v1/run-access") {
      const intent = JSON.parse(raw) as c.Prepare;
      intents.push(intent);
      if (prepareRejection) {
        res
          .writeHead(prepareRejection.statusCode, {
            "content-type": "application/json",
          })
          .end(JSON.stringify(prepareRejection.body(intent)));
        return;
      }
      const executionRef = `execution-${intent.operationId}`;
      nativeExecutions.set(executionRef, "active");
      operations.set(intent.operationId, {
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
      });
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
    const proofRequest =
      /^\/v1\/executions\/([^/]+)\/requests\/([^/]+)\/retry-proof$/.exec(
        req.url ?? "",
      );
    if (proofRequest && req.method === "GET") {
      const headers = {
        authorization: req.headers.authorization,
        capability: req.headers["x-account-gateway-capability"],
      };
      const executionRef = proofRequest[1]!,
        requestRef = proofRequest[2]!;
      retryProofCalls.push({ executionRef, requestRef });
      retryProofHeaders.push(headers);
      if (
        headers.authorization !== "Bearer local-execution-token" ||
        headers.capability !== "request-retry-proof/v1"
      ) {
        res.writeHead(403, { "content-type": "application/json" }).end(
          JSON.stringify({
            code: "forbidden",
            traceRef: "invalid-proof-headers-fixture",
            requestRef,
            effect: "effect_unknown",
            retry: { kind: "never" },
          }),
        );
        return;
      }
      res
        .writeHead(companionOptions?.retryProofStatus ?? 200, {
          "content-type": "application/json",
        })
        .end(
          JSON.stringify(
            companionOptions?.retryProof?.(requestRef, executionRef),
          ),
        );
      return;
    }
    if (execution?.[2] === "requests") {
      requestModels.push((JSON.parse(raw) as { model: string }).model);
      admissions.push(JSON.parse(String(req.headers["x-gateway-admission"])));
      requestBodies.push(raw);
      requestRefs.push(String(req.headers["x-gateway-request-id"]));
      if (companionOptions?.nativeStatusResponse) {
        await companionOptions.nativeStatusResponse(
          res,
          String(req.headers["x-gateway-request-id"]),
        );
        return;
      }
      if (companionOptions?.nativeRejection) {
        res.writeHead(502, { "content-type": "application/json" }).end(
          JSON.stringify({
            code: "upstream_failure",
            traceRef: "native-rejection-fixture",
            requestRef: String(req.headers["x-gateway-request-id"]),
            effect: "rejected_before_dispatch",
            retry: { kind: "never" },
          }),
        );
        return;
      }
      const refusalStatus =
        companionOptions?.refusalStatus ?? nativeRefusalStatus;
      if (refusalStatus) {
        res
          .writeHead(refusalStatus, {
            "content-type": "application/json",
            "x-private-detail": "secret-header",
          })
          .end(
            JSON.stringify({
              code: "forbidden",
              traceRef: "secret-trace",
              operationRef: "secret-operation",
              requestRef: String(req.headers["x-gateway-request-id"]),
              effect: "not_dispatched",
              retry: { kind: "never" },
            }),
          );
        return;
      }
      if (companionOptions?.providerQuota) {
        res.writeHead(503, { "content-type": "application/json" }).end(
          JSON.stringify({
            code: "upstream_failure",
            traceRef: "quota-fixture-trace",
            requestRef: String(req.headers["x-gateway-request-id"]),
            effect: "effect_unknown",
            retry: { kind: "readback" },
            providerQuota: companionOptions.providerQuota,
          }),
        );
        return;
      }
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
      (companionOptions || multi) &&
      req.method === "GET" &&
      req.url?.includes("/requests/") &&
      requestRefs.includes(req.url.split("/").at(-1)!)
    ) {
      const requestRef = req.url.split("/").at(-1)!;
      const response = await companionOptions?.requestStatus?.(requestRef);
      res
        .writeHead(response?.statusCode ?? 200, {
          "content-type": "application/json",
        })
        .end(
          JSON.stringify(
            response?.body ?? {
              requestRef,
              effect: "completed",
              status: "completed",
            },
          ),
        );
      return;
    }
    if (execution?.[2] === "close") {
      nativeCloses.push(execution[1]!);
      nativeCloseReasons.push(JSON.parse(raw).reason);
      nativeCloseOperationIds.push(JSON.parse(raw).operationId);
      closeStarted?.();
      await closeGate;
      if (closeResponseOverride) {
        const response = closeResponseOverride(JSON.parse(raw).operationId);
        res
          .writeHead(response.status, { "content-type": "application/json" })
          .end(JSON.stringify(response.body));
        return;
      }
      if (closeState === "failure") {
        res.writeHead(503).end();
        return;
      }
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
    findReviewRunAuthorizationById: async (
      id: string,
    ): Promise<ReviewRunAuthorization | null> => {
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
    readPreparationOperation: async (operationId) => {
      operationReads.push(operationId);
      if (operationReadFailure) throw Error("operation_read_failed");
      operationReadHook?.();
      return operations.get(operationId);
    },
  });
  const terminalRuns = new Set<string>();
  const relayInput: Parameters<typeof createReviewRunGatewayRelay>[0] = {
    policy: {
      profiles: [
        {
          profile: {
            profileId: selection.profileId,
            protocol: "openai-responses",
            modelIds: [
              ...(multi?.profileModelIds ??
                multi?.models ?? [
                  selection.profileId === "nvidia-build-chat-apikey-v1"
                    ? selection.model
                    : "gpt-5.6-sol",
                ]),
            ],
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
    isSourceRunTerminal: async (auth) => terminalRuns.has(auth.authorizationId),
    readPreparationOperation: async (operationId) => {
      operationReads.push(operationId);
      if (operationReadFailure) throw Error("operation_read_failed");
      return operations.get(operationId);
    },
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
        overrides.set(authorizationId, {
          ...overrides.get(authorizationId),
          state,
        });
        return {} as never;
      },
    },
    queries: queries as never,
    resolveNvidiaRepository: async () =>
      typeof nvidiaRepository === "function"
        ? nvidiaRepository()
        : (nvidiaRepository ?? null),
    checkAuthority: async (auth, freshness) => {
      authorityChecks.push(freshness);
      const held = heldAuthority;
      if (held?.ids.has(auth.authorizationId)) {
        held.entered.add(auth.authorizationId);
        if (held.entered.size === held.ids.size) held.started();
        await held.pending;
      }
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
      prepare: async ({
        executionRef,
        requestRef,
        reviewerId,
      }: {
        executionRef: string;
        requestRef: string;
        reviewerId?: string;
      }) => {
        requestOwners.set(`${executionRef}\0${requestRef}`, reviewerId);
      },
      ownsRequest: async ({
        executionRef,
        requestRef,
        reviewerId,
      }: {
        executionRef: string;
        requestRef: string;
        reviewerId: string;
      }) => requestOwners.get(`${executionRef}\0${requestRef}`) === reviewerId,
      outcome: async ({ requestRef, effect }) => {
        effects.push({ requestRef, effect });
        if (companionOptions?.failUsageOutcome)
          throw new Error("fixture_usage_write_failed");
      },
    },
  };
  const relay = createReviewRunGatewayRelay(relayInput);
  return {
    preparation,
    queries,
    relayInput,
    bindings,
    rejectPreparation(
      statusCode: number,
      body: (intent: c.Prepare) => unknown,
    ) {
      prepareRejection = { statusCode, body };
    },
    relay,
    terminalRuns,
    authorizations: relayInput.authorizations,
    usage: relayInput.usage,
    restartRelay: (
      maxSessions = relayInput.policy.maxSessions,
      maxInFlight = relayInput.policy.maxInFlight,
    ) =>
      createReviewRunGatewayRelay({
        ...relayInput,
        policy: { ...relayInput.policy, maxSessions, maxInFlight },
      }),
    holdAuthority(ids: readonly string[]) {
      let started!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      heldAuthority = {
        ids: new Set(ids),
        entered: new Set(),
        started,
        pending,
      };
      return {
        started: entered,
        release() {
          heldAuthority = undefined;
          release();
        },
      };
    },
    intents,
    admissions,
    requestModels,
    requestBodies,
    requestRefs,
    retryProofCalls,
    retryProofHeaders,
    limits,
    effects,
    authorityChecks,
    nativeExecutions,
    nativeCloses,
    nativeCloseReasons,
    nativeCloseOperationIds,
    operations,
    operationReads,
    revokedAllocations,
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
    setCloseResponseOverride(value?: typeof closeResponseOverride) {
      closeResponseOverride = value;
    },
    setOperationReadFailure(value = true) {
      operationReadFailure = value;
    },
    setOperationReadHook(value?: () => void) {
      operationReadHook = value;
    },
    setPrepareFailure(value = true) {
      prepareFailure = value;
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

it("preserves a validated run-access admission refusal without claiming a model dispatch", async () => {
  const f = await fixture(8 * MiB);
  f.rejectPreparation(503, (intent) => ({
    code: "admission_limited",
    traceRef: "fixture-trace",
    operationRef: intent.operationId,
    effect: "not_dispatched",
    retry: { kind: "after", milliseconds: 1000 },
  }));
  try {
    await expect(f.preparation.prepare()).rejects.toMatchObject({
      code: "safe_error",
      effect: "not_dispatched",
      httpStatus: 503,
      diagnostic: { code: "admission_limited" },
    });
    expect(f.intents).toHaveLength(1);
    expect(f.nativeExecutions.size).toBe(0);
    expect(f.requestRefs).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

it.each(["foreign-operation", "malformed"])(
  "keeps %s run-access rejection uncertain",
  async (kind) => {
    const f = await fixture(8 * MiB);
    f.rejectPreparation(503, (intent) => ({
      code: "admission_limited",
      traceRef: "fixture-trace",
      operationRef:
        kind === "foreign-operation" ? "another-operation" : intent.operationId,
      effect: "not_dispatched",
      retry: { kind: "after", milliseconds: 1000 },
      ...(kind === "malformed"
        ? { untrustedDetails: "not a safe diagnostic" }
        : {}),
    }));
    try {
      await expect(f.preparation.prepare()).rejects.toMatchObject({
        code: "invalid_response",
        effect: "effect_unknown",
      });
      expect(f.intents).toHaveLength(1);
      expect(f.nativeExecutions.size).toBe(0);
    } finally {
      await f.relay.shutdown();
    }
  },
);

// Regression: a proven pre-Prepare refusal must not permanently consume a relay slot.
it.each([false, true])(
  "releases proven no-execution capacity after v4=%s refusal",
  async (v4) => {
    const f = await fixture(
      MiB,
      0,
      1,
      5000,
      undefined,
      undefined,
      128,
      undefined,
      v4
        ? { models: ["gpt-5.6-sol"], independentAllocations: true }
        : undefined,
    );
    f.rejectPreparation(503, (intent) => ({
      code: "admission_limited",
      traceRef: "fixture-trace",
      operationRef: intent.operationId,
      effect: "not_dispatched",
      retry: { kind: "after", milliseconds: 1000 },
    }));
    try {
      const reviewer = v4 ? "reviewer-0" : undefined;
      await expect(
        streamRun(f, "authorization-1", reviewer),
      ).rejects.toMatchObject({
        code: v4 ? "admission_limited" : "safe_error",
        effect: "not_dispatched",
      });
      f.revoke("authorization-1");
      await expect(
        streamRun(f, "authorization-2", reviewer),
      ).rejects.toMatchObject({
        code: v4 ? "admission_limited" : "safe_error",
        effect: "not_dispatched",
      });
      expect(f.intents).toHaveLength(2);
      expect(f.nativeExecutions.size).toBe(0);
      expect(f.requestRefs).toHaveLength(0);
      expect(f.nativeCloses).toHaveLength(0);
    } finally {
      await f.relay.shutdown();
    }
  },
);

it("retains the no-execution proof across repeated close without preparing again", async () => {
  const f = await fixture(MiB);
  f.rejectPreparation(503, (intent) => ({
    code: "admission_limited",
    traceRef: "fixture-trace",
    operationRef: intent.operationId,
    effect: "not_dispatched",
    retry: { kind: "after", milliseconds: 1000 },
  }));
  try {
    await expect(f.preparation.prepare()).rejects.toMatchObject({
      code: "safe_error",
    });
    expect(f.preparation.needsRecovery()).toBe(false);
    expect(await f.preparation.recoverSameOperation()).toEqual({
      status: "denied",
    });
    for (let i = 0; i < 2; i++) {
      expect(await f.preparation.close("cancelled")).toEqual({
        state: "unknown",
      });
      expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(true);
    }
    expect(f.intents).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});

it.each([
  "missing-operation",
  "foreign-operation",
  "unknown-effect",
  "different-code",
  "no-delay",
  "malformed",
])("retains uncertain cleanup for %s refusal", async (kind) => {
  const f = await fixture(MiB);
  f.rejectPreparation(503, (intent) => ({
    code: kind === "different-code" ? "forbidden" : "admission_limited",
    traceRef: "fixture-trace",
    ...(kind === "missing-operation"
      ? {}
      : {
          operationRef:
            kind === "foreign-operation"
              ? "foreign-operation"
              : intent.operationId,
        }),
    effect: kind === "unknown-effect" ? "effect_unknown" : "not_dispatched",
    retry:
      kind === "no-delay"
        ? { kind: "never" }
        : { kind: "after", milliseconds: 1000 },
    ...(kind === "malformed" ? { untrusted: true } : {}),
  }));
  try {
    await expect(f.preparation.prepare()).rejects.toBeDefined();
    expect(await f.preparation.close("cancelled")).toEqual({
      state: "unknown",
    });
    expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
    expect(f.preparation.needsRecovery()).toBe(true);
    expect(f.intents).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});

it("does not replace an earlier unknown Prepare with a later non-entry refusal", async () => {
  const f = await fixture(MiB);
  try {
    f.setPrepareFailure();
    await expect(f.preparation.prepare()).rejects.toMatchObject({
      effect: "effect_unknown",
    });
    f.rejectPreparation(503, (intent) => ({
      code: "admission_limited",
      traceRef: "fixture-trace",
      operationRef: intent.operationId,
      effect: "not_dispatched",
      retry: { kind: "after", milliseconds: 1000 },
    }));
    await expect(f.preparation.recoverSameOperation()).rejects.toMatchObject({
      effect: "not_dispatched",
    });
    expect(await f.preparation.close("cancelled")).toEqual({
      state: "unknown",
    });
    expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
    expect(f.nativeExecutions.size).toBe(1);
    expect(f.nativeCloses).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

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

it("releases six aborted pre-session authority reservations without dispatching their late results", async () => {
  const f = await fixture(MiB, 0, 16);
  const relay = f.restartRelay(16, 6);
  const ids = Array.from(
    { length: 6 },
    (_, index) => `authorization-${index + 1}`,
  );
  const held = f.holdAuthority(ids);
  const controllers = ids.map(() => new AbortController());
  const body = new TextEncoder().encode(
    JSON.stringify({
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      max_output_tokens: 32768,
    }),
  );
  const attempts = ids.map((id, index) =>
    relay.responses(id, body, controllers[index]!).then(
      (response) => ({ unexpectedResponse: response.kind }),
      (error: unknown) => error,
    ),
  );
  try {
    await held.started;
    await expect(
      relay.responses("authorization-7", body, new AbortController()),
    ).rejects.toMatchObject({ code: "relay_saturated" });
    for (const controller of controllers) controller.abort();
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      Promise.all(attempts),
      new Promise<never>((_resolve, reject) => {
        cancelTimer = setTimeout(
          () => reject(new Error("pre_session_abort_not_settled")),
          1000,
        );
      }),
    ]).finally(() => clearTimeout(cancelTimer));
    expect(settled).toEqual(
      Array.from({ length: 6 }, () =>
        expect.objectContaining({
          code: "authorization_denied",
          effect: "not_dispatched",
        }),
      ),
    );
    expect(f.intents).toHaveLength(0);
    expect(f.admissions).toHaveLength(0);
    await expect(streamRun({ ...f, relay }, "authorization-7")).resolves.toBe(
      "stream",
    );
    expect(f.intents).toHaveLength(1);
    held.release();
    await setImmediate();
    await setImmediate();
    // Late pure authority completion must not create sessions or prepare native
    // capabilities for any of the six already cancelled incoming requests.
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(1);
  } finally {
    held.release();
    await Promise.allSettled(attempts);
    await relay.shutdown();
    await f.relay.shutdown();
  }
});

it("reclaims an active authorization only after its exact source run is terminal and native close applies", async () => {
  const f = await fixture(MiB, 0, 1);
  try {
    await streamRun(f, "authorization-1");
    f.terminalRuns.add("authorization-1");
    // Failed Actions can outlive both renewable and maximum authority TTLs.
    // Native work is still active: terminal SCM alone cannot discard custody.
    f.setCloseState("unknown");
    await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
      code: "relay_saturated",
    });
    expect(f.authorization("authorization-1").state).toBe("revoked");
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
    expect(f.intents).toHaveLength(1);
    expect(f.nativeCloseReasons).toEqual(["cancelled"]);
    f.setCloseState("applied");
    await expect(streamRun(f, "authorization-2")).resolves.toBe("stream");
    expect(f.nativeExecutions.get(f.nativeCloses[0]!)).toBe("closed");
    expect(f.intents).toHaveLength(2);
    expect(f.nativeCloseReasons).toEqual(["cancelled", "cancelled"]);
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

async function streamRun(
  f: Awaited<ReturnType<typeof fixture>>,
  id: string,
  reviewerId?: string,
) {
  const body = new TextEncoder().encode(
    JSON.stringify({
      model: "gpt-5.6-sol",
      input: [],
      stream: true,
      max_output_tokens: 32768,
    }),
  );
  const response = await f.relay.responses(
    id,
    body,
    new AbortController(),
    undefined,
    undefined,
    reviewerId,
  );
  if (response.kind !== "stream") throw Error("expected_stream");
  for await (const _chunk of response.body) {
    expect(_chunk.byteLength).toBeGreaterThan(0);
  }
  return response.kind;
}

const reclaimBatchEvent = "review_run_gateway_relay_reclaim_batch";
// Independent expected vector: extra fields, double counts and sensitive values
// fail at the real relay boundary, without deriving expectations from its code.
function expectReclaimBatch(
  calls: readonly (readonly unknown[])[],
  overrides: Partial<Record<string, number>>,
) {
  const events = calls.filter((call) => call[0] === reclaimBatchEvent);
  expect(events).toEqual([
    [
      reclaimBatchEvent,
      {
        retainedBefore: 1,
        retainedAfter: 1,
        budget: 1,
        visited: 1,
        skippedClosing: 0,
        skippedPreparing: 0,
        rowMissing: 0,
        rowMismatch: 0,
        sourceUnavailable: 0,
        sourceReturnedFalseUnknown: 0,
        confirmationMissing: 0,
        confirmationMismatch: 0,
        deadlineReached: 0,
        cursorEmpty: 0,
        lookupFailed: 0,
        sourceFailed: 0,
        confirmationFailed: 0,
        closeStarted: 0,
        closeReturnedOutcomeUnknown: 0,
        closeFailedCauseUnknown: 0,
        batchAbortedCauseUnknown: 0,
        ...overrides,
      },
    ],
  ]);
}

it.each(["active", "different_identity", "read_failure"] as const)(
  "retains a capacity session with %s authority",
  async (mode) => {
    const f = await fixture(MiB, 0, 1);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      expectReclaimBatch(log.mock.calls, {
        [mode === "active"
          ? "sourceReturnedFalseUnknown"
          : mode === "different_identity"
            ? "rowMismatch"
            : "lookupFailed"]: 1,
      });
    } finally {
      log.mockRestore();
      f.lookupFailures.clear();
      await f.relay.shutdown();
    }
  },
);

it("retains an unknown native close and denies the old run without replay", async () => {
  const f = await fixture(MiB, 0, 1);
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expectReclaimBatch(log.mock.calls, {
      closeStarted: 1,
      closeReturnedOutcomeUnknown: 1,
    });
  } finally {
    log.mockRestore();
    await f.relay.shutdown();
  }
});

it("shares one close under concurrent capacity pressure and admits at most one new run", async () => {
  const f = await fixture(MiB, 0, 1);
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expectReclaimBatch(log.mock.calls, {
      retainedAfter: 0,
      closeStarted: 1,
      closeReturnedOutcomeUnknown: 1,
    });
  } finally {
    log.mockRestore();
    release?.();
    await f.relay.shutdown();
  }
});

// Regressions here would misidentify the failed phase or let instrumentation
// change the existing deny-first and unknown-capability custody decisions.
it.each([
  "source_failure",
  "confirmation_mismatch",
  "parent_write_failure",
] as const)(
  "reclaim diagnostics preserve custody and port order after %s",
  async (mode) => {
    const base = await fixture(MiB, 0, 1);
    const sourceCalls: string[] = [];
    const f = {
      ...base,
      relay: createReviewRunGatewayRelay({
        ...base.relayInput,
        isSourceRunTerminal: async (auth) => {
          sourceCalls.push(auth.authorizationId);
          if (mode === "source_failure")
            throw Error("synthetic_secret_source_failure");
          return true;
        },
      }),
    };
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const query = vi.spyOn(f.queries, "findReviewRunAuthorizationById");
    const write = vi.spyOn(
      f.authorizations,
      "expireOrRevokeReviewRunAuthorization",
    );
    try {
      await streamRun(f, "authorization-1");
      if (mode === "parent_write_failure") {
        f.revoke("authorization-1");
        write.mockRejectedValue(Error("synthetic_secret_parent_write_failure"));
      }
      let reads = 0;
      query.mockImplementation(async (id) => {
        f.lookups.push(id);
        reads++;
        const row = f.authorization(id);
        return mode === "confirmation_mismatch" && reads === 2
          ? { ...row, sourceRunId: "foreign-synthetic-source" }
          : row;
      });
      f.lookups.length = 0;
      await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
        code: "relay_saturated",
        effect: "not_dispatched",
      });
      expectReclaimBatch(
        log.mock.calls,
        mode === "parent_write_failure"
          ? { closeStarted: 1, closeFailedCauseUnknown: 1 }
          : {
              [mode === "source_failure"
                ? "sourceFailed"
                : "confirmationMismatch"]: 1,
            },
      );
      // The current close path rereads the retained owner's authority before
      // termination; a failed parent write follows those two guarded reads.
      expect([...f.lookups]).toEqual(
        Array(
          mode === "parent_write_failure"
            ? 3
            : mode === "confirmation_mismatch"
              ? 2
              : 1,
        ).fill("authorization-1"),
      );
      expect(sourceCalls).toEqual(
        mode === "parent_write_failure" ? [] : ["authorization-1"],
      );
      expect(write).toHaveBeenCalledTimes(
        mode === "parent_write_failure" ? 1 : 0,
      );
      expect(f.nativeCloses).toEqual([]);
      expect([...f.nativeExecutions.values()]).toEqual(["active"]);
      expect(f.intents).toHaveLength(1);
      expect(f.admissions).toHaveLength(1);
    } finally {
      log.mockRestore();
      query.mockRestore();
      write.mockRestore();
      await f.relay.shutdown();
      await base.relay.shutdown();
    }
  },
);

it("throwing reclaim logger preserves HTTP refusal and unknown native custody", async () => {
  const f = await fixture(MiB, 0, 1);
  const app = Fastify();
  await registerReviewRunGatewayRelayRoutes(app, f.relay);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const log = vi.spyOn(console, "warn").mockImplementation((name) => {
    if (name === reclaimBatchEvent)
      throw Error("synthetic_secret_logger_failure");
  });
  try {
    await streamRun(f, "authorization-1");
    f.revoke("authorization-1");
    f.setCloseState("unknown");
    const response = await fetch(
      `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/api/action/v2/account-gateway/responses`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer authorization-2",
          "content-type": "application/json",
          "x-reviewrouter-request-ref": "unowned-client-reference",
        },
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          input: [],
          stream: true,
          max_output_tokens: 32768,
        }),
      },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("x-reviewrouter-request-ref")).toBeNull();
    expect(await response.json()).toMatchObject({
      error: { code: "relay_saturated", effect: "not_dispatched" },
    });
    expectReclaimBatch(log.mock.calls, {
      closeStarted: 1,
      closeReturnedOutcomeUnknown: 1,
    });
    expect(f.nativeCloses).toHaveLength(1);
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(1);
  } finally {
    log.mockRestore();
    await app.close();
    await f.relay.shutdown();
  }
});

it("reclaim finally preserves an original guard exception when its logger also throws", async () => {
  const originalError = Error("synthetic_original_guard_failure");
  const originalFactory = preparationModule.createReviewRunGatewayPreparation;
  let failGuard = false;
  const factory = vi
    .spyOn(preparationModule, "createReviewRunGatewayPreparation")
    .mockImplementation((input) => {
      const preparation = originalFactory(input);
      return {
        ...preparation,
        isPreparing: () => {
          if (failGuard) throw originalError;
          return preparation.isPreparing();
        },
      };
    });
  const f = await fixture(MiB, 0, 1);
  const log = vi.spyOn(console, "warn").mockImplementation((name) => {
    if (name === reclaimBatchEvent)
      throw Error("synthetic_secret_logger_failure");
  });
  try {
    await streamRun(f, "authorization-1");
    f.lookups.length = 0;
    failGuard = true;
    await expect(streamRun(f, "authorization-2")).rejects.toBe(originalError);
    expectReclaimBatch(log.mock.calls, { batchAbortedCauseUnknown: 1 });
    expect(f.lookups).toEqual([]);
    expect(f.nativeCloses).toEqual([]);
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(1);
  } finally {
    failGuard = false;
    log.mockRestore();
    factory.mockRestore();
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

it("releases only an empty unknown v3 handle after durable revocation without retrying Prepare", async () => {
  const f = await fixture(MiB, 0, 1);
  try {
    f.setPrepareFailure();
    await expect(streamRun(f, "authorization-1")).rejects.toBeDefined();
    f.revoke("authorization-1");
    expect(await f.relay.closeRun("authorization-1", "cancelled")).toEqual({
      state: "unknown",
    });
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
    expect(f.nativeCloses).toHaveLength(0);
    expect(f.intents).toHaveLength(1);
    // The old applied execution is not replayed or falsely reported closed.
    expect(await f.relay.closeRun("authorization-1", "cancelled")).toEqual({
      state: "unknown",
    });
    f.setPrepareFailure(false);
    await expect(streamRun(f, "authorization-2")).resolves.toBe("stream");
    expect(f.intents).toHaveLength(2);
    expect(
      f.intents.filter(
        (intent) => intent.operationId === "operation-authorization-1",
      ),
    ).toHaveLength(1);
    expect(f.nativeExecutions.get("execution-operation-authorization-1")).toBe(
      "active",
    );
    expect(f.nativeCloses).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});

it.each(["active", "different_identity", "read_failure"] as const)(
  "does not detach an unknown preparation with %s authority",
  async (mode) => {
    const f = await fixture(MiB, 0, 1);
    try {
      f.setPrepareFailure();
      await expect(streamRun(f, "authorization-1")).rejects.toBeDefined();
      if (mode !== "active") {
        f.revoke("authorization-1");
        if (mode === "different_identity")
          f.overrides.set("authorization-1", { sourceRunId: "another-run" });
        else f.lookupFailures.add("authorization-1");
      }
      await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
        code: "relay_saturated",
      });
      expect(f.intents).toHaveLength(1);
      expect([...f.nativeExecutions.values()]).toEqual(["active"]);
    } finally {
      f.lookupFailures.clear();
      await f.relay.shutdown();
    }
  },
);

it("does not detach an unknown preparation while its HTTP request is still in flight", async () => {
  const f = await fixture(MiB, 0, 1);
  const gate = f.holdPrepare();
  let first: Promise<unknown> | undefined;
  try {
    f.setPrepareFailure();
    first = streamRun(f, "authorization-1").catch(() => undefined);
    await gate.started;
    f.revoke("authorization-1");
    await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
      code: "relay_saturated",
    });
    expect(f.intents).toHaveLength(1);
  } finally {
    gate.release();
    await first;
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

it.each(["pressure", "timer"] as const)(
  "v4 retries a retained completed close through %s without revoking publication authority or replaying inference",
  async (trigger) => {
    const f = await fixture(
      32768,
      0,
      1,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      { models: ["gpt-5.6-sol"], independentAllocations: true },
    );
    const revoke = vi.spyOn(
      f.authorizations,
      "expireOrRevokeReviewRunAuthorization",
    );
    let gate: ReturnType<typeof f.holdClose> | undefined;
    let closing: ReturnType<typeof f.relay.closeRun> | undefined;
    try {
      await streamRun(f, "authorization-1", "reviewer-0");
      f.setCloseState("unknown");
      expect(
        await f.relay.closeRun("authorization-1", "completed"),
      ).toMatchObject({ state: "unknown" });
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(f.terminalRuns.size).toBe(0);
      expect(f.nativeCloses).toHaveLength(1);
      if (trigger === "pressure") {
        await expect(
          streamRun(f, "authorization-2", "reviewer-0"),
        ).rejects.toMatchObject({ code: "relay_saturated" });
        expect(f.nativeCloses).toHaveLength(2);
      } else {
        gate = f.holdClose();
        await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(2), {
          timeout: 2000,
        });
        await gate.started;
        closing = f.relay.closeRun("authorization-1", "completed");
        gate.release();
        await expect(closing).resolves.toMatchObject({ state: "unknown" });
      }
      expect(f.intents).toHaveLength(1);
      expect(f.requestModels).toHaveLength(1);
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(revoke).not.toHaveBeenCalled();
      expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
      f.setCloseState("applied");
      if (trigger === "timer") {
        gate = f.holdClose();
        await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(3), {
          timeout: 4000,
        });
        await gate.started;
        closing = f.relay.closeRun("authorization-1", "completed");
        gate.release();
        await expect(closing).resolves.toMatchObject({ state: "applied" });
      }
      await expect(streamRun(f, "authorization-2", "reviewer-0")).resolves.toBe(
        "stream",
      );
      expect(f.nativeCloseReasons).toEqual([
        "completed",
        "completed",
        "completed",
      ]);
      expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(revoke).not.toHaveBeenCalled();
      expect(f.requestModels).toHaveLength(2);
    } finally {
      gate?.release();
      await closing?.catch(() => {});
      revoke.mockRestore();
      await f.relay.shutdown();
    }
  },
);

it("v4 pressure still reclaims an exact retained close after all automatic retries are spent", async () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const originalFactory = preparationModule.createReviewRunGatewayPreparation;
  let localCloseCalls = 0;
  const factory = vi
    .spyOn(preparationModule, "createReviewRunGatewayPreparation")
    .mockImplementation((input) => {
      const preparation = originalFactory(input);
      return {
        ...preparation,
        close: (...args: Parameters<typeof preparation.close>) => {
          localCloseCalls++;
          return preparation.close(...args);
        },
      };
    });
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol"], independentAllocations: true },
  );
  const revoke = vi.spyOn(
    f.authorizations,
    "expireOrRevokeReviewRunAuthorization",
  );
  let retryClose: ReturnType<typeof f.holdClose> | undefined;
  let closing: ReturnType<typeof f.relay.closeRun> | undefined;
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    f.setCloseState("unknown");
    await f.relay.closeRun("authorization-1", "completed");
    const deadline = f.authorization().maxExpiresAt.getTime();
    for (let expected = 2; expected <= 9; expected++) {
      retryClose = f.holdClose();
      // Search the remaining original window, excluding its deadline close.
      while (localCloseCalls < expected && Date.now() < deadline - 1) {
        await vi.advanceTimersByTimeAsync(
          Math.min(100, deadline - Date.now() - 1),
        );
        await setImmediate();
      }
      expect(Date.now()).toBeLessThan(deadline);
      expect(localCloseCalls).toBe(expected);
      // Freeze fake time during real I/O; a local failure must not leave this
      // arrival wait pending beyond the real-time bound.
      let arrivalTimeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          retryClose.started,
          new Promise<never>((_resolve, reject) => {
            arrivalTimeout = realSetTimeout(
              () => reject(new Error("native_close_request_not_started")),
              2000,
            );
          }),
        ]);
      } finally {
        if (arrivalTimeout !== undefined) realClearTimeout(arrivalTimeout);
      }
      expect(f.nativeCloses).toHaveLength(expected);
      closing = f.relay.closeRun("authorization-1", "completed");
      retryClose.release();
      await expect(closing).resolves.toMatchObject({ state: "unknown" });
    }

    const remaining = f.authorization().maxExpiresAt.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(0);
    // Pass the next uncapped half-remaining retry while staying before expiry.
    // Observe local close starts too: slow HTTP cannot hide an extra attempt.
    await vi.advanceTimersByTimeAsync(Math.floor((remaining * 3) / 4));
    expect(Date.now()).toBeLessThan(f.authorization().maxExpiresAt.getTime());
    expect(localCloseCalls).toBe(9);
    expect(f.nativeCloses).toHaveLength(9);

    await expect(
      streamRun(f, "authorization-2", "reviewer-0"),
    ).rejects.toMatchObject({
      code: "relay_saturated",
      effect: "not_dispatched",
    });
    expect(localCloseCalls).toBe(10);
    expect(f.nativeCloses).toHaveLength(10);
    expect(f.intents).toHaveLength(1);
    expect(f.requestModels).toHaveLength(1);
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);

    f.setCloseState("applied");
    await expect(streamRun(f, "authorization-2", "reviewer-0")).resolves.toBe(
      "stream",
    );
    expect(localCloseCalls).toBe(11);
    expect(f.nativeCloses).toHaveLength(11);
    expect(new Set(f.nativeCloses).size).toBe(1);
    expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
    expect(f.nativeCloseReasons).toEqual(
      Array.from({ length: 11 }, () => "completed"),
    );
    expect(f.intents).toHaveLength(2);
    expect(f.requestModels).toHaveLength(2);
    expect(new Set(f.requestRefs).size).toBe(2);
    expect([...f.nativeExecutions.values()]).toEqual(["closed", "active"]);
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
    expect(revoke).not.toHaveBeenCalled();
  } finally {
    retryClose?.release();
    await closing?.catch(() => {});
    try {
      await f.relay.shutdown();
    } finally {
      factory.mockRestore();
      revoke.mockRestore();
      vi.useRealTimers();
    }
  }
});

it("v4 pressure retains custody when the original native close capability has expired", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol"], independentAllocations: true },
  );
  let deadlineClose: ReturnType<typeof f.holdClose> | undefined;
  let closing: ReturnType<typeof f.relay.closeRun> | undefined;
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    f.setCloseResponseOverride((operationId) => ({
      status: 401,
      body: {
        code: "unauthenticated",
        traceRef: "trace-1",
        operationRef: operationId,
        effect: "not_dispatched",
        retry: { kind: "never" },
      },
    }));
    deadlineClose = f.holdClose();
    await vi.advanceTimersByTimeAsync(
      f.authorization().maxExpiresAt.getTime() - Date.now() + 1,
    );
    // Only the deadline timer can initiate this first held HTTP close.
    await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(1));
    await deadlineClose.started;
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Expired);
    closing = f.relay.closeRun("authorization-1", "deadline");
    const refused = expect(closing).rejects.toMatchObject({
      code: "safe_error",
      httpStatus: 401,
      effect: "not_dispatched",
      diagnostic: { code: "unauthenticated" },
    });
    deadlineClose.release();
    await refused;
    expect(f.nativeCloses).toHaveLength(1);

    // A distinct later authorization is live; refusal must come from retained
    // old custody rather than the second request also having an expired grant.
    const laterDeadline = new Date(Date.now() + 120_000);
    const laterSnapshot = JSON.parse(
      f.authorization("authorization-2").runtimeSnapshotCanonicalJson!,
    );
    f.overrides.set("authorization-2", {
      expiresAt: laterDeadline,
      maxExpiresAt: laterDeadline,
      runtimeSnapshotCanonicalJson: canonicalJson({
        ...laterSnapshot,
        deadline: laterDeadline.toISOString(),
      }),
    });
    await expect(
      streamRun(f, "authorization-2", "reviewer-0"),
    ).rejects.toMatchObject({
      code: "relay_saturated",
      effect: "not_dispatched",
    });
    expect(f.nativeCloses).toHaveLength(2);
    expect(new Set(f.nativeCloses).size).toBe(1);
    expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
    expect(f.nativeCloseReasons).toEqual(["deadline", "deadline"]);
    expect(f.intents).toHaveLength(1);
    expect(f.requestModels).toHaveLength(1);
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
    expect(f.operationReads).toHaveLength(0);
  } finally {
    deadlineClose?.release();
    await closing?.catch(() => {});
    try {
      await f.relay.shutdown();
    } finally {
      vi.useRealTimers();
    }
  }
});

it("v4 bounds automatic close retries and preserves the original deadline fence", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol"], independentAllocations: true },
  );
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    f.setCloseState("unknown");
    await f.relay.closeRun("authorization-1", "completed");
    // Advance in small steps so real loopback I/O can settle between virtual
    // retries; transport keepalive timers are independent of the cleanup budget.
    for (let tick = 0; tick < 1100 && f.nativeCloses.length < 9; tick++) {
      await vi.advanceTimersByTimeAsync(100);
      await setImmediate();
    }
    await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(9));
    for (let tick = 0; tick < 10; tick++) await setImmediate();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.nativeCloses).toHaveLength(9);
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
    expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
    expect(f.nativeCloseReasons).toEqual(
      Array.from({ length: 9 }, () => "completed"),
    );
    expect(f.requestModels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(
      f.authorization().maxExpiresAt.getTime() - Date.now() + 1,
    );
    await vi.waitFor(() =>
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Expired),
    );
    await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(10));
    for (let tick = 0; tick < 10; tick++) await setImmediate();
    const closes = f.nativeCloses.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.nativeCloses).toHaveLength(closes);
    expect(f.requestModels).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
    vi.useRealTimers();
  }
});

it.each(["identity", "snapshot"] as const)(
  "v4 automatic close retry rejects changed retained %s after the authority read",
  async (changed) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const f = await fixture(
      32768,
      0,
      1,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      { models: ["gpt-5.6-sol"], independentAllocations: true },
    );
    let releaseRead: (() => void) | undefined;
    const originalRead = f.queries.findReviewRunAuthorizationById;
    const read = vi.spyOn(f.queries, "findReviewRunAuthorizationById");
    try {
      await streamRun(f, "authorization-1", "reviewer-0");
      f.setCloseState("unknown");
      await f.relay.closeRun("authorization-1", "completed");
      const original = f.authorization();
      const reads = f.lookups.length;
      const held = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      read.mockImplementationOnce(async (id) => {
        await held;
        return originalRead(id);
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.lookups).toHaveLength(reads);
      if (changed === "identity")
        f.overrides.set("authorization-1", { headSha: "e".repeat(40) });
      else {
        const snapshot = JSON.parse(original.runtimeSnapshotCanonicalJson!) as {
          allocations: Array<{ allocationId: string }>;
          reviewers: Array<{ transport: { allocationId: string } }>;
        };
        snapshot.allocations[0]!.allocationId = "replacement-allocation";
        snapshot.reviewers[0]!.transport.allocationId =
          "replacement-allocation";
        f.overrides.set("authorization-1", {
          runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
        });
      }
      releaseRead!();
      await vi.advanceTimersByTimeAsync(0);
      expect(f.lookups.length).toBeGreaterThan(reads);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(f.nativeCloses).toHaveLength(1);
      expect(f.intents).toHaveLength(1);
      expect(f.requestModels).toHaveLength(1);
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
    } finally {
      releaseRead?.();
      read.mockRestore();
      f.overrides.clear();
      await f.relay.shutdown();
      vi.useRealTimers();
    }
  },
);

it("v4 shutdown cancels automatic retry and original deadline timers after an unknown close", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol"], independentAllocations: true },
  );
  const revoke = vi.spyOn(
    f.authorizations,
    "expireOrRevokeReviewRunAuthorization",
  );
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    f.setCloseState("unknown");
    await f.relay.closeRun("authorization-1", "completed");
    await f.relay.shutdown();
    const closes = f.nativeCloses.length;
    const writes = revoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.nativeCloses).toHaveLength(closes);
    expect(revoke).toHaveBeenCalledTimes(writes);
    expect(f.requestModels).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    revoke.mockRestore();
    vi.useRealTimers();
  }
});

it("v4 joined cancellation keeps its authority fence after the first allocation was released", async () => {
  const f = await fixture(
    32768,
    0,
    2,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], independentAllocations: true },
  );
  let first: ReturnType<typeof f.holdClose> | undefined;
  let second: ReturnType<typeof f.holdClose> | undefined;
  let completed: ReturnType<typeof f.relay.closeRun> | undefined;
  let cancelled: ReturnType<typeof f.relay.closeRun> | undefined;
  try {
    for (const reviewerId of ["reviewer-0", "reviewer-1"]) {
      const response = await f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        reviewerId,
      );
      if (response.kind !== "stream") throw new Error("stream_expected");
      for await (const chunk of response.body) {
        expect(chunk.byteLength).toBeGreaterThan(0);
      }
    }
    first = f.holdClose();
    completed = f.relay.closeRun("authorization-1", "completed");
    await first.started;
    second = f.holdClose();
    first.release();
    await second.started;
    cancelled = f.relay.closeRun("authorization-1", "cancelled");
    await vi.waitFor(() =>
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Revoked),
    );
    second.release();
    expect(await Promise.all([completed, cancelled])).toEqual([
      expect.objectContaining({ state: "applied" }),
      expect.objectContaining({ state: "applied" }),
    ]);
    expect(f.nativeCloses).toHaveLength(2);
    expect(new Set(f.nativeCloses).size).toBe(2);
    expect(f.nativeCloseReasons).toEqual(["completed", "completed"]);
    expect(f.requestModels).toHaveLength(2);
  } finally {
    first?.release();
    second?.release();
    await Promise.allSettled([completed, cancelled]);
    await f.relay.shutdown();
  }
});

it("v4 automatic retries preserve a failed parent cancellation and bound concurrent close work", async () => {
  const f = await fixture(
    32768,
    0,
    2,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol"], independentAllocations: true },
  );
  const relay = f.restartRelay(2, 1);
  const revoke = vi.spyOn(
    f.authorizations,
    "expireOrRevokeReviewRunAuthorization",
  );
  let gate: ReturnType<typeof f.holdClose> | undefined;
  let cancelled: ReturnType<typeof relay.closeRun> | undefined;
  try {
    for (const id of ["authorization-1", "authorization-2"]) {
      await streamRun({ ...f, relay }, id, "reviewer-0");
      f.setCloseState("unknown");
      expect(await relay.closeRun(id, "completed")).toMatchObject({
        state: "unknown",
      });
    }
    revoke.mockRejectedValueOnce(new Error("authority_write_failed"));
    await expect(
      relay.closeRun("authorization-1", "cancelled"),
    ).rejects.toThrow("authority_write_failed");
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
    f.setCloseState("applied");
    gate = f.holdClose();
    await gate.started;
    expect(f.nativeCloses).toHaveLength(3);
    await expect(
      streamRun({ ...f, relay }, "authorization-3", "reviewer-0"),
    ).rejects.toMatchObject({ code: "relay_saturated" });
    expect(f.nativeCloses).toHaveLength(3);
    const heldAuthorization =
      f.nativeCloses.at(-1) === `execution-${f.intents[0]!.operationId}`
        ? "authorization-1"
        : "authorization-2";
    cancelled = relay.closeRun(heldAuthorization, "cancelled");
    await vi.waitFor(() =>
      expect(f.authorization(heldAuthorization).state).toBe(
        ReviewRunAuthorizationState.Revoked,
      ),
    );
    gate.release();
    await cancelled;
    await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(4), {
      timeout: 3000,
    });
    expect(f.nativeCloseReasons).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(new Set(f.nativeCloseOperationIds).size).toBe(2);
    expect(f.requestModels).toHaveLength(2);
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Revoked);
    expect(f.authorization("authorization-2").state).toBe(
      heldAuthorization === "authorization-2"
        ? ReviewRunAuthorizationState.Revoked
        : ReviewRunAuthorizationState.Active,
    );
  } finally {
    gate?.release();
    await cancelled;
    revoke.mockRestore();
    await relay.shutdown();
    await f.relay.shutdown();
  }
});

it("legacy completed close revokes the parent and denies further requests", async () => {
  const f = await fixture(MiB);
  try {
    await streamRun(f, "authorization-1");
    await expect(
      f.relay.closeRun("authorization-1", "completed"),
    ).resolves.toMatchObject({ state: "applied" });
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Revoked);
    await expect(streamRun(f, "authorization-1")).rejects.toMatchObject({
      code: "authorization_denied",
      statusCode: 401,
    });
    expect(f.nativeCloses).toHaveLength(1);
    expect(f.nativeCloseReasons).toEqual(["completed"]);
  } finally {
    await f.relay.shutdown();
  }
});

it.each([
  { writeFails: false, independentAllocations: false },
  { writeFails: true, independentAllocations: false },
  { writeFails: true, independentAllocations: true },
])(
  "aborts local work before authority settles: failure=$writeFails, independent=$independentAllocations",
  async ({ writeFails, independentAllocations }) => {
    const finishStream = deferred();
    const persist = deferred();
    const f = await fixture(
      MiB,
      0,
      2,
      5000,
      async (upstream) => {
        upstream.write(": bounded progress\n\n");
        await finishStream.promise;
        upstream.end();
      },
      undefined,
      9,
      undefined,
      independentAllocations
        ? { models: ["gpt-5.6-sol", "gpt-5.5"], independentAllocations: true }
        : undefined,
    );
    const reviewerId = independentAllocations ? "reviewer-0" : undefined;
    const originalRevoke =
      f.authorizations.expireOrRevokeReviewRunAuthorization;
    const revoke = vi
      .spyOn(f.authorizations, "expireOrRevokeReviewRunAuthorization")
      .mockImplementationOnce(async (input) => {
        await persist.promise;
        if (writeFails) throw new Error("authority_write_failed");
        return originalRevoke(input);
      });
    const controller = new AbortController();
    let response: Awaited<ReturnType<typeof f.relay.responses>> | undefined;
    let closing: ReturnType<typeof f.relay.closeRun> | undefined;
    try {
      response = await f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        controller,
        undefined,
        undefined,
        reviewerId,
      );
      expect(response.kind).toBe("stream");
      closing = f.relay.closeRun("authorization-1", "cancelled");
      void closing.catch(() => undefined);
      expect(controller.signal.aborted).toBe(true);
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      await expect(
        streamRun(f, "authorization-1", reviewerId),
      ).rejects.toMatchObject({
        code: "authorization_denied",
        statusCode: 401,
      });
      expect(f.admissions).toHaveLength(1);
      expect(f.nativeCloses).toHaveLength(0);
      persist.resolve();
      if (writeFails) {
        await expect(closing).rejects.toThrow("authority_write_failed");
        expect(f.authorization().state).toBe(
          ReviewRunAuthorizationState.Active,
        );
        for (const deniedReviewer of independentAllocations
          ? ["reviewer-0", "reviewer-1"]
          : [undefined])
          await expect(
            streamRun(f, "authorization-1", deniedReviewer),
          ).rejects.toMatchObject({
            code: "authorization_denied",
            statusCode: 401,
          });
        expect(f.intents).toHaveLength(1);
        expect(f.admissions).toHaveLength(1);
        expect(f.nativeCloses).toHaveLength(0);
        if (independentAllocations) {
          // A normal cleanup retry cannot downgrade the failed cancellation.
          await f.relay.closeRun("authorization-1", "completed");
          expect(f.authorization().state).toBe(
            ReviewRunAuthorizationState.Revoked,
          );
          expect(f.nativeCloses).toHaveLength(1);
          expect(f.nativeCloseReasons).toEqual(["cancelled"]);
          expect(f.intents).toHaveLength(1);
          await expect(
            streamRun(f, "authorization-1", "reviewer-1"),
          ).rejects.toMatchObject({
            code: "authorization_denied",
            statusCode: 401,
          });
        }
      } else {
        await expect(closing).resolves.toMatchObject({ state: "applied" });
        expect(f.authorization().state).toBe(
          ReviewRunAuthorizationState.Revoked,
        );
        expect(f.nativeCloses).toHaveLength(1);
      }
    } finally {
      persist.resolve();
      await closing?.catch(() => undefined);
      revoke.mockRestore();
      finishStream.resolve();
      if (response?.kind === "stream") await response.cancel().catch(() => {});
      await f.relay.shutdown();
    }
  },
);

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

it("v4 joins shared first preparation and overlaps exact models within one captured allowance", async () => {
  const finishStreams = deferred();
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    async (response) => {
      response.write(": bounded progress\n\n");
      await finishStreams.promise;
      response.end(": bounded completed\n\n");
    },
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  const held = f.holdPrepare();
  try {
    const both = Promise.all(
      [0, 1].map((index) =>
        f.relay.responses(
          "authorization-1",
          Buffer.from("{}"),
          new AbortController(),
          undefined,
          undefined,
          `reviewer-${index}`,
        ),
      ),
    );
    await held.started;
    expect(f.intents).toHaveLength(1);
    held.release();
    const responses = await both;
    // Both HTTP responses are live before either controlled provider finishes.
    expect(f.requestModels.sort()).toEqual(["gpt-5.5", "gpt-5.6-sol"]);
    expect(f.intents).toHaveLength(1);
    expect(f.intents[0]!.limits).toMatchObject({ requests: 9, concurrency: 2 });
    expect(
      new Set(f.admissions.map((admission) => admission.invocationRef)).size,
    ).toBe(1);
    expect(new Set(f.requestRefs).size).toBe(2);
    expect(
      f.requestRefs.every((ref) => /^rr-request-[a-f0-9]{24}-/.test(ref)),
    ).toBe(true);
    finishStreams.resolve();
    for (const response of responses)
      if (response.kind === "stream") {
        const reader = response.body.getReader();
        while (!(await reader.read()).done) {
          /* Drain exact paid calls. */
        }
      }
    await f.relay.close("authorization-1", "completed");
    expect(f.nativeCloses).toHaveLength(1);
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
  } finally {
    held.release();
    finishStreams.resolve();
    await f.relay.shutdown();
  }
});

it.each([
  { reason: "cancelled", state: ReviewRunAuthorizationState.Revoked },
  { reason: "deadline", state: ReviewRunAuthorizationState.Expired },
] as const)(
  "v4 $reason terminates authority while joining normal cleanup without a second native close",
  async ({ reason, state }) => {
    const f = await fixture(
      32768,
      0,
      4,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
    );
    const gate = f.holdClose();
    const revoke = vi.spyOn(
      f.authorizations,
      "expireOrRevokeReviewRunAuthorization",
    );
    let completed: ReturnType<typeof f.relay.closeRun> | undefined;
    let terminated: ReturnType<typeof f.relay.closeRun> | undefined;
    try {
      const response = await f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        "reviewer-0",
      );
      if (response.kind !== "stream") throw new Error("stream_expected");
      const reader = response.body.getReader();
      while (!(await reader.read()).done) {
        /* Settle the request before holding the allocation close. */
      }
      completed = f.relay.closeRun("authorization-1", "completed");
      await gate.started;
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(revoke).not.toHaveBeenCalled();
      terminated = f.relay.closeRun("authorization-1", reason);
      await vi.waitFor(() => {
        expect(f.authorization().state).toBe(state);
      });
      expect(revoke).toHaveBeenCalledExactlyOnceWith({
        authorizationId: "authorization-1",
        state,
      });
      expect(f.nativeCloses).toHaveLength(1);
      expect(f.nativeCloseReasons).toEqual(["completed"]);
      gate.release();
      await expect(Promise.all([completed, terminated])).resolves.toEqual([
        expect.objectContaining({ state: "applied" }),
        expect.objectContaining({ state: "applied" }),
      ]);
      expect(f.nativeCloses).toHaveLength(1);
      expect(f.nativeCloseReasons).toEqual(["completed"]);
    } finally {
      gate.release();
      await Promise.allSettled([completed, terminated]);
      revoke.mockRestore();
      await f.relay.shutdown();
    }
  },
);

it("v4 retains failed parent cancellation after native completion until a cleanup retry revokes it", async () => {
  const f = await fixture(
    32768,
    0,
    2,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  const gate = f.holdClose();
  const revoke = vi.spyOn(
    f.authorizations,
    "expireOrRevokeReviewRunAuthorization",
  );
  let completed: ReturnType<typeof f.relay.closeRun> | undefined;
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    completed = f.relay.closeRun("authorization-1", "completed");
    void completed.catch(() => undefined);
    await gate.started;
    revoke.mockRejectedValueOnce(new Error("authority_write_failed"));
    await expect(
      f.relay.closeRun("authorization-1", "cancelled"),
    ).rejects.toThrow("authority_write_failed");
    gate.release();
    await expect(completed).rejects.toThrow("authority_write_failed");
    expect(f.nativeCloses).toHaveLength(1);
    expect(f.nativeCloseReasons).toEqual(["completed"]);
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
    await expect(
      streamRun(f, "authorization-1", "reviewer-1"),
    ).rejects.toMatchObject({ code: "authorization_denied", statusCode: 401 });
    await expect(
      f.relay.closeRun("authorization-1", "completed"),
    ).resolves.toMatchObject({ state: "applied" });
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Revoked);
    expect(f.intents).toHaveLength(1);
    expect(f.admissions).toHaveLength(1);
    expect(f.nativeCloses).toHaveLength(2);
    expect(new Set(f.nativeCloses).size).toBe(1);
    expect(f.nativeCloseReasons).toEqual(["completed", "completed"]);
  } finally {
    gate.release();
    await completed?.catch(() => undefined);
    revoke.mockRestore();
    await f.relay.shutdown();
  }
});

it("v4 rejects missing and foreign reviewers before preparation and keeps a shared sibling alive after local close", async () => {
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  try {
    for (const selector of [undefined, "foreign"])
      await expect(
        f.relay.responses(
          "authorization-1",
          Buffer.from("{}"),
          new AbortController(),
          undefined,
          undefined,
          selector,
        ),
      ).rejects.toMatchObject({ effect: "not_dispatched" });
    expect(f.intents).toHaveLength(0);
    await f.relay.close("authorization-1", "completed", "reviewer-0");
    expect(f.nativeCloses).toHaveLength(0);
    const response = await f.relay.responses(
      "authorization-1",
      Buffer.from("{}"),
      new AbortController(),
      undefined,
      undefined,
      "reviewer-1",
    );
    if (response.kind === "stream") await response.cancel();
    expect(f.requestModels).toEqual(["gpt-5.5"]);
    await expect(
      f.relay.status("authorization-1", f.requestRefs[0]!, "reviewer-0"),
    ).rejects.toMatchObject({ effect: "not_dispatched" });
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
  } finally {
    await f.relay.shutdown();
  }
});

it("v4 reads only the selected reviewer's durable request in a shared execution", async () => {
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  try {
    const response = await f.relay.responses(
      "authorization-1",
      Buffer.from("{}"),
      new AbortController(),
      undefined,
      undefined,
      "reviewer-0",
    );
    if (response.kind !== "stream") throw new Error("stream_expected");
    const reader = response.body.getReader();
    while (!(await reader.read()).done) {
      /* Complete the request before reading its exact persisted status. */
    }
    expect(
      await f.relay.status("authorization-1", f.requestRefs[0]!, "reviewer-0"),
    ).toMatchObject({ effect: "completed" });
    await expect(
      f.relay.status("authorization-1", f.requestRefs[0]!, "reviewer-1"),
    ).rejects.toMatchObject({ code: "request_reviewer_mismatch" });
    expect(f.admissions).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});

it("v4 closing an active reviewer aborts only its stream while a shared sibling completes", async () => {
  const finishStreams = deferred();
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    async (response) => {
      response.write(": bounded progress\n\n");
      await finishStreams.promise;
      response.end(": bounded completed\n\n");
    },
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  const controllers = [new AbortController(), new AbortController()];
  try {
    const responses = await Promise.all(
      controllers.map((controller, index) =>
        f.relay.responses(
          "authorization-1",
          Buffer.from("{}"),
          controller,
          undefined,
          undefined,
          `reviewer-${index}`,
        ),
      ),
    );
    await f.relay.close("authorization-1", "completed", "reviewer-0");
    expect(controllers.map((controller) => controller.signal.aborted)).toEqual([
      true,
      false,
    ]);
    expect(f.nativeCloses).toHaveLength(0);
    finishStreams.resolve();
    const healthy = responses[1]!;
    if (healthy.kind !== "stream") throw new Error("stream_expected");
    const reader = healthy.body.getReader();
    while (!(await reader.read()).done) {
      /* The sibling retains its own stream and shared native allowance. */
    }
    expect(f.effects.at(-1)?.effect).toBe("completed");
    await expect(
      f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        "reviewer-0",
      ),
    ).rejects.toMatchObject({ code: "reviewer_closed" });
    expect(f.admissions).toHaveLength(2);
  } finally {
    finishStreams.resolve();
    await f.relay.shutdown();
  }
});

it("v4 denies one revoked allocation without poisoning a healthy independent reviewer", async () => {
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], independentAllocations: true },
  );
  try {
    f.revokedAllocations.add("allocation-0");
    await expect(
      f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        "reviewer-0",
      ),
    ).rejects.toMatchObject({
      failureScope: "allocation",
      concurrencyGroupId: "allocation-0",
      effect: "not_dispatched",
    });
    const response = await f.relay.responses(
      "authorization-1",
      Buffer.from("{}"),
      new AbortController(),
      undefined,
      undefined,
      "reviewer-1",
    );
    if (response.kind === "stream") await response.cancel();
    expect(f.requestModels).toEqual(["gpt-5.5"]);
    expect(f.intents).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});

it("v4 keeps companion dispatch and readback on the captured primary", async () => {
  const state = companionReservation();
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    undefined,
    { admission: state.admission },
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  try {
    await expect(
      f.relay.responses(
        "authorization-1",
        companionEnvelope(),
        new AbortController(),
        undefined,
        companionContext,
        "reviewer-1",
      ),
    ).rejects.toMatchObject({ code: "companion_reviewer_invalid" });
    await expect(
      f.relay.companionDispatch(
        "authorization-1",
        companionContext.dispatchId,
        "reviewer-1",
      ),
    ).rejects.toMatchObject({ code: "companion_reviewer_invalid" });
    expect(state.claimCount()).toBe(0);
    expect(f.intents).toHaveLength(0);
    const response = await f.relay.responses(
      "authorization-1",
      companionEnvelope(),
      new AbortController(),
      undefined,
      companionContext,
      "reviewer-0",
    );
    if (response.kind !== "stream") throw new Error("stream_expected");
    const reader = response.body.getReader();
    while (!(await reader.read()).done) {
      /* Drain the primary companion before exact readback. */
    }
    expect(
      await f.relay.companionDispatch(
        "authorization-1",
        companionContext.dispatchId,
        "reviewer-0",
      ),
    ).toMatchObject({ state: "completed" });
    expect(state.rows.size).toBe(1);
    expect(f.admissions).toHaveLength(1);
  } finally {
    await f.relay.shutdown();
  }
});

it.each([false, true])(
  "v4 restart cleanup closes every allocation through one session slot with retained session %s",
  async (retainSession) => {
    const f = await fixture(
      32768,
      0,
      4,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      { models: ["gpt-5.6-sol", "gpt-5.5"], independentAllocations: true },
    );
    let restarted: ReturnType<typeof f.restartRelay> | undefined;
    try {
      for (const reviewerId of ["reviewer-0", "reviewer-1"]) {
        const response = await f.relay.responses(
          "authorization-1",
          Buffer.from("{}"),
          new AbortController(),
          undefined,
          undefined,
          reviewerId,
        );
        if (response.kind !== "stream") throw new Error("stream_expected");
        const reader = response.body.getReader();
        while (!(await reader.read()).done) {
          /* Complete both captured allocations before process restart. */
        }
      }
      expect(f.intents).toHaveLength(2);
      restarted = f.restartRelay(1);
      if (retainSession)
        await restarted.recoverSameOperation("authorization-1", "reviewer-1");
      expect(
        await restarted.closeRun("authorization-1", "cancelled"),
      ).toMatchObject({ state: "applied" });
      expect(new Set(f.nativeCloses).size).toBe(2);
      expect(f.nativeCloses).toHaveLength(2);
      expect(f.operationReads).toHaveLength(retainSession ? 1 : 2);
      expect(f.requestModels).toHaveLength(2);
    } finally {
      await restarted?.shutdown();
      await f.relay.shutdown();
    }
  },
);

it("v4 restart cleanup proves the original operation and restores only its exact capability without inference replay", async () => {
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  let restarted: ReturnType<typeof f.restartRelay> | undefined;
  try {
    f.setPrepareFailure();
    await expect(
      f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        "reviewer-0",
      ),
    ).rejects.toMatchObject({
      effect: "effect_unknown",
      failureScope: "allocation",
    });
    expect(f.intents).toHaveLength(1);
    expect(f.requestModels).toHaveLength(0);
    f.setPrepareFailure(false);
    restarted = f.restartRelay();
    expect(
      await restarted.closeRun("authorization-1", "cancelled"),
    ).toMatchObject({ state: "applied" });
    expect(f.operationReads).toEqual([f.intents[0]!.operationId]);
    expect(f.intents).toHaveLength(2);
    expect(new Set(f.intents.map((intent) => intent.operationId)).size).toBe(1);
    expect(f.requestModels).toHaveLength(0);
    expect(f.nativeCloses).toHaveLength(1);
  } finally {
    await restarted?.shutdown();
    await f.relay.shutdown();
  }
});

it("v4 missing original cleanup operation stays unknown and cannot mint a replacement", async () => {
  const f = await fixture(
    32768,
    0,
    4,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  let restarted: ReturnType<typeof f.restartRelay> | undefined;
  try {
    f.setPrepareFailure();
    await expect(
      f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        "reviewer-0",
      ),
    ).rejects.toMatchObject({ effect: "effect_unknown" });
    f.operations.clear();
    f.setPrepareFailure(false);
    restarted = f.restartRelay();
    expect(await restarted.closeRun("authorization-1", "cancelled")).toEqual({
      state: "unknown",
    });
    expect(f.operationReads).toHaveLength(1);
    expect(f.intents).toHaveLength(1);
    expect(f.requestModels).toHaveLength(0);
    expect(f.nativeCloses).toHaveLength(0);
  } finally {
    await restarted?.shutdown();
    await f.relay.shutdown();
  }
});

it("v4 frees an empty unknown handle only after parent revocation without replay", async () => {
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], grantConcurrency: 2 },
  );
  try {
    f.setPrepareFailure();
    await expect(
      streamRun(f, "authorization-1", "reviewer-0"),
    ).rejects.toBeDefined();
    f.operations.clear(); // Readback cannot prove the delayed Prepare's outcome.
    f.revoke("authorization-1");
    expect(await f.relay.closeRun("authorization-1", "cancelled")).toEqual({
      state: "unknown",
    });
    expect(f.intents).toHaveLength(1);
    expect(f.requestModels).toHaveLength(0);
    expect(f.nativeCloses).toHaveLength(0);
    f.setPrepareFailure(false);
    await expect(streamRun(f, "authorization-2", "reviewer-0")).resolves.toBe(
      "stream",
    );
    expect(f.intents).toHaveLength(2);
    expect(
      f.nativeExecutions.get(`execution-${f.intents[0]!.operationId}`),
    ).toBe("active");
  } finally {
    await f.relay.shutdown();
  }
});

it.each(["terminal", "different_identity", "read_failure"] as const)(
  "v4 readback outage detaches only with matching %s authority",
  async (mode) => {
    const f = await fixture(
      32768,
      0,
      1,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      {
        models: ["gpt-5.6-sol", "gpt-5.5"],
        grantConcurrency: 2,
      },
    );
    try {
      f.setPrepareFailure();
      await expect(
        streamRun(f, "authorization-1", "reviewer-0"),
      ).rejects.toBeDefined();
      f.revoke("authorization-1");
      f.setOperationReadFailure();
      if (mode === "different_identity")
        f.overrides.set("authorization-1", { sourceRunId: "another-run" });
      if (mode === "read_failure") f.lookupFailures.add("authorization-1");
      f.setPrepareFailure(false);
      if (mode === "terminal") {
        expect(await f.relay.closeRun("authorization-1", "cancelled")).toEqual({
          state: "unknown",
        });
        await expect(
          streamRun(f, "authorization-2", "reviewer-0"),
        ).resolves.toBe("stream");
        expect(f.intents).toHaveLength(2);
        expect(f.nativeCloses).toHaveLength(0);
      } else {
        await expect(
          streamRun(f, "authorization-2", "reviewer-0"),
        ).rejects.toMatchObject({ code: "relay_saturated" });
        expect(f.intents).toHaveLength(1);
      }
    } finally {
      f.lookupFailures.clear();
      f.setOperationReadFailure(false);
      await f.relay.shutdown();
    }
  },
);

it("v4 never discards a retained capability when native close fails", async () => {
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    {
      models: ["gpt-5.6-sol", "gpt-5.5"],
      grantConcurrency: 2,
    },
  );
  try {
    await expect(streamRun(f, "authorization-1", "reviewer-0")).resolves.toBe(
      "stream",
    );
    f.revoke("authorization-1");
    f.setCloseState("failure");
    await expect(
      streamRun(f, "authorization-2", "reviewer-0"),
    ).rejects.toMatchObject({ code: "relay_saturated" });
    expect(f.intents).toHaveLength(1);
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
  } finally {
    f.setCloseState("applied");
    await f.relay.shutdown();
  }
});
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

it("keeps clean HTTP EOF free of unknown relay diagnostics", async () => {
  const f = await fixture(MiB, 0, 2, 5000, async (response) => {
    response.write(progressFrame);
    response.end(completedFrame);
  });
  const http = await serveRelay(f.relay);
  const closed = deferred<boolean>();
  http.app.server.once("request", (_request, response) => {
    response.once("close", () => closed.resolve(response.writableFinished));
  });
  const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await http.request();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(progressFrame + completedFrame);
    expect(await closed.promise).toBe(true);
    await setImmediate();
    expect(f.effects.map((row) => row.effect)).toEqual([
      "dispatch_started",
      "completed",
    ]);
    expect(
      diagnostics.mock.calls.filter(
        ([diagnostic]) =>
          diagnostic?.event === "review_run_gateway_relay_unknown",
      ),
    ).toEqual([]);
  } finally {
    await http.app.close();
    diagnostics.mockRestore();
  }
});

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
it.each(
  (
    [
      ["openai-codex-oauth-responses-v1", "oauth", true],
      ["openrouter-openai-responses-apikey-v1", "api_key", true],
      ["openrouter-openai-responses-apikey-v1", "oauth", false],
      ["profile-1", "oauth", false],
      ["grok-subscription-responses-oauth-v1", "oauth", false],
    ] as const
  ).flatMap(([profileId, authKind, dynamic]) =>
    [false, true].map((reviewerPlan) => ({
      profileId,
      authKind,
      dynamic,
      reviewerPlan,
    })),
  ),
)(
  "account model $profileId with $authKind keeps the authorized Responses path (dynamic=$dynamic, reviewer plan=$reviewerPlan)",
  async ({ profileId, authKind, dynamic, reviewerPlan }) => {
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
      reviewerPlan
        ? {
            models: [model, "gpt-5.6-sol"],
            profileModelIds: ["gpt-5.6-sol"],
          }
        : undefined,
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
        undefined,
        undefined,
        reviewerPlan ? "reviewer-0" : undefined,
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
  const f = await fixture(MiB, 0, 2, 5000, undefined, undefined, 128, {
    profileId: "openai-codex-oauth-responses-v1",
    model,
  });
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

it.each(["gpt-5.6-sol", "authorized-account-model-not-in-anchor"])(
  "the relay admits anchor and dynamic Codex models without opt-in: %s",
  async (model) => {
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

it.each(["unknown", "http503", "timeout", "binding_failure"] as const)(
  "isolated safe close diagnostics emit finite fields without custody changes: %s",
  async (mode) => {
    const f = await fixture(MiB, 0, 1, 150);
    let release: (() => void) | undefined;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await streamRun(f, "authorization-1");
      const initialRequestRefs = [...f.requestRefs];
      f.revoke("authorization-1");
      if (mode === "unknown") f.setCloseState("unknown");
      if (mode === "http503") f.setCloseState("failure");
      if (mode === "timeout") {
        f.setCloseState("unknown");
        const hold = f.holdClose();
        release = hold.release;
      }
      if (mode === "binding_failure") {
        Object.defineProperty(f.bindings, "completeCleanup", {
          configurable: true,
          value: async () => {
            throw new Error("SECRET_SENTINEL_DO_NOT_LOG");
          },
        });
      }
      await expect(streamRun(f, "authorization-2")).rejects.toMatchObject({
        code: "relay_saturated",
        effect: "not_dispatched",
      });
      expect(f.intents).toHaveLength(1);
      expect(f.requestRefs).toEqual(initialRequestRefs);
      const diagnostics = warn.mock.calls
        .filter(([event]) => event === "review_run_gateway_close_diagnostic")
        .map(([, data]) => data);
      const expected = {
        unknown: {
          phase: "remote_close",
          category: "unknown",
          code: "unknown",
          effect: "unknown",
        },
        http503: {
          phase: "remote_close",
          category: "invalid_response",
          code: "unknown",
          effect: "unknown",
          httpStatus: "unknown",
        },
        timeout: {
          phase: "remote_close",
          category: "cancelled",
          code: "unknown",
          effect: "unknown",
          httpStatus: "unknown",
        },
        binding_failure: { phase: "binding_cleanup", category: "other" },
      } as const;
      expect(diagnostics).toEqual([expected[mode]]);
      const log = JSON.stringify(diagnostics);
      for (const value of [
        "SECRET_SENTINEL_DO_NOT_LOG",
        "local-control-token",
        "local-execution-token",
        "authorization-1",
        "execution-operation-authorization-1",
      ]) {
        expect(log).not.toContain(value);
      }
    } finally {
      release?.();
      Object.defineProperty(f.bindings, "completeCleanup", {
        configurable: true,
        value: async () => {},
      });
      f.setCloseState("applied");
      await f.relay.shutdown();
      warn.mockRestore();
    }
  },
);

it.each(["never_attempted", "proven_no_execution"])(
  "isolated safe close diagnostics do not warn for %s",
  async (scenario) => {
    const f = await fixture(MiB);
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      if (scenario === "proven_no_execution") {
        f.rejectPreparation(503, (intent) => ({
          code: "admission_limited",
          traceRef: "fixture-trace",
          operationRef: intent.operationId,
          effect: "not_dispatched",
          retry: { kind: "after", milliseconds: 1000 },
        }));
        await expect(f.preparation.prepare()).rejects.toMatchObject({
          code: "safe_error",
        });
      }
      expect(await f.preparation.close("cancelled")).toEqual({
        state: "unknown",
      });
      expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(true);
      expect(
        warnings.mock.calls.filter(
          ([message]) => message === "review_run_gateway_close_diagnostic",
        ),
      ).toEqual([]);
      expect(f.nativeCloses).toHaveLength(0);
      expect(f.requestRefs).toHaveLength(0);
    } finally {
      warnings.mockRestore();
      await f.relay.shutdown();
    }
  },
);

it("isolated safe close diagnostics warn when attempted execution remains uncertain", async () => {
  const f = await fixture(MiB);
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
  f.rejectPreparation(503, () => ({
    code: "admission_limited",
    traceRef: "fixture-trace",
    operationRef: "foreign-operation",
    effect: "not_dispatched",
    retry: { kind: "after", milliseconds: 1000 },
  }));
  try {
    await expect(f.preparation.prepare()).rejects.toBeDefined();
    expect(await f.preparation.close("cancelled")).toEqual({
      state: "unknown",
    });
    expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
    expect(
      warnings.mock.calls.filter(
        ([message]) => message === "review_run_gateway_close_diagnostic",
      ),
    ).toEqual([
      [
        "review_run_gateway_close_diagnostic",
        { phase: "recovery", category: "no_capability" },
      ],
    ]);
  } finally {
    warnings.mockRestore();
    await f.relay.shutdown();
  }
});

it("refreshes the exact retained legacy capability after a definite 401 close refusal", async () => {
  const f = await fixture(MiB);
  let calls = 0;
  try {
    await f.preparation.prepare();
    f.setCloseResponseOverride((operationId) => {
      calls++;
      return calls === 1
        ? {
            status: 401,
            body: {
              code: "unauthenticated",
              traceRef: "trace-1",
              operationRef: operationId,
              effect: "not_dispatched",
              retry: { kind: "never" },
            },
          }
        : {
            status: 200,
            body: { operationRef: operationId, state: "applied" },
          };
    });
    expect(await f.preparation.close("cancelled")).toMatchObject({
      state: "applied",
    });
    expect(f.intents).toHaveLength(2);
    expect(f.intents[1]).toEqual(f.intents[0]);
    expect(f.nativeCloseOperationIds).toHaveLength(2);
    expect(f.nativeCloseOperationIds[1]).toBe(f.nativeCloseOperationIds[0]);
    expect(f.operationReads).toHaveLength(1);
    expect(f.preparation.hasSession()).toBe(false);
  } finally {
    f.setCloseResponseOverride();
    await f.relay.shutdown();
  }
});

it("refreshes a retained v4 allocation only for its exact original close", async () => {
  const f = await fixture(MiB, 0, 2, 5000, undefined, undefined, 9, undefined, {
    models: ["gpt-5.6-sol"],
    independentAllocations: true,
  });
  const allocationId = JSON.parse(
    f.authorization().runtimeSnapshotCanonicalJson!,
  ).allocations[0].allocationId as string;
  const preparation = createReviewRunGatewayPreparation({
    authorizationId: "authorization-1",
    allocationId,
    identity: f.authorization(),
    runAccess: f.relayInput.runAccess,
    authorizations: f.queries as never,
    snapshots: f.relayInput.snapshots,
    bindings: f.bindings,
    readPreparationOperation: f.relayInput.readPreparationOperation!,
  });
  let calls = 0;
  try {
    expect(await preparation.prepare()).toMatchObject({ status: "prepared" });
    f.setCloseResponseOverride((operationId) =>
      ++calls === 1
        ? {
            status: 401,
            body: {
              code: "unauthenticated",
              traceRef: "trace-1",
              operationRef: operationId,
              effect: "not_dispatched",
              retry: { kind: "never" },
            },
          }
        : {
            status: 200,
            body: { operationRef: operationId, state: "applied" },
          },
    );
    expect(await preparation.close("cancelled")).toMatchObject({
      state: "applied",
    });
    expect(f.intents[1]).toEqual(f.intents[0]);
    expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
    expect(preparation.hasSession()).toBe(false);
  } finally {
    f.setCloseResponseOverride();
    await f.relay.shutdown();
  }
});

it("retains the original capability when exact preparation proof is unavailable", async () => {
  const f = await fixture(MiB);
  try {
    await f.preparation.prepare();
    f.setOperationReadFailure();
    f.setCloseResponseOverride((operationId) => ({
      status: 401,
      body: {
        code: "unauthenticated",
        traceRef: "trace-1",
        operationRef: operationId,
        effect: "not_dispatched",
        retry: { kind: "never" },
      },
    }));
    await expect(f.preparation.close("cancelled")).rejects.toBeDefined();
    expect(f.intents).toHaveLength(1);
    expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
  } finally {
    f.setOperationReadFailure(false);
    f.setCloseResponseOverride();
    await f.relay.shutdown();
  }
});

it("does not reprepare when the durable binding differs from the retained capability", async () => {
  const f = await fixture(MiB);
  const originalRead = f.bindings.readForCleanup;
  try {
    await f.preparation.prepare();
    vi.spyOn(f.bindings, "readForCleanup").mockImplementation(async (owner) => {
      const value = await originalRead(owner);
      return value ? { ...value, executionRef: "foreign-execution" } : null;
    });
    f.setCloseResponseOverride((operationId) => ({
      status: 401,
      body: {
        code: "unauthenticated",
        traceRef: "trace-1",
        operationRef: operationId,
        effect: "not_dispatched",
        retry: { kind: "never" },
      },
    }));
    await expect(f.preparation.close("cancelled")).rejects.toBeDefined();
    expect(f.intents).toHaveLength(1);
    expect(f.operationReads).toHaveLength(0);
    expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
  } finally {
    vi.restoreAllMocks();
    f.setCloseResponseOverride();
    await f.relay.shutdown();
  }
});

it("joins concurrent stale close retries without changing the close identity", async () => {
  const f = await fixture(MiB);
  let calls = 0;
  try {
    await f.preparation.prepare();
    f.setCloseResponseOverride((operationId) => {
      calls++;
      return calls <= 2
        ? {
            status: 401,
            body: {
              code: "unauthenticated",
              traceRef: "trace-1",
              operationRef: operationId,
              effect: "not_dispatched",
              retry: { kind: "never" },
            },
          }
        : {
            status: 200,
            body: { operationRef: operationId, state: "applied" },
          };
    });
    const outcomes = await Promise.allSettled([
      f.preparation.close("cancelled"),
      f.preparation.close("deadline"),
    ]);
    expect(
      outcomes.some(
        (result) =>
          result.status === "fulfilled" && result.value.state === "applied",
      ),
    ).toBe(true);
    expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
    expect(new Set(f.nativeCloseReasons)).toEqual(new Set(["cancelled"]));
    expect(f.preparation.hasSession()).toBe(false);
  } finally {
    f.setCloseResponseOverride();
    await f.relay.shutdown();
  }
});

it("does not reprepare when the admission expires during operation readback", async () => {
  const f = await fixture(MiB);
  const realNow = Date.now();
  const clock = vi.spyOn(Date, "now");
  try {
    await f.preparation.prepare();
    f.setOperationReadHook(() => clock.mockReturnValue(realNow + 180_000));
    f.setCloseResponseOverride((operationId) => ({
      status: 401,
      body: {
        code: "unauthenticated",
        traceRef: "trace-1",
        operationRef: operationId,
        effect: "not_dispatched",
        retry: { kind: "never" },
      },
    }));
    await expect(f.preparation.close("cancelled")).rejects.toBeDefined();
    expect(f.operationReads).toHaveLength(1);
    expect(f.intents).toHaveLength(1);
    expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
  } finally {
    clock.mockRestore();
    f.setOperationReadHook();
    f.setCloseResponseOverride();
    await f.relay.shutdown();
  }
});

it("isolated safe close diagnostics retry logging after one logger failure", async () => {
  const f = await fixture(MiB);
  const recorded: unknown[] = [];
  let attempts = 0;
  const warn = vi
    .spyOn(console, "warn")
    .mockImplementation((event, details) => {
      if (event !== "review_run_gateway_close_diagnostic") return;
      attempts++;
      if (attempts === 1) throw new Error("synthetic_log_failure");
      recorded.push(details);
    });
  try {
    await f.preparation.prepare();
    f.setCloseState("unknown");
    for (let i = 0; i < 3; i++) {
      expect(await f.preparation.close("cancelled")).toMatchObject({
        state: "unknown",
      });
      expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
    }
    expect(attempts).toBe(2);
    expect(recorded).toEqual([
      {
        phase: "remote_close",
        category: "unknown",
        code: "unknown",
        effect: "unknown",
      },
    ]);
    expect(f.nativeCloses).toHaveLength(3);
    expect(f.requestRefs).toHaveLength(0);
    expect([...f.nativeExecutions.values()]).toEqual(["active"]);
  } finally {
    warn.mockRestore();
    f.setCloseState("applied");
    await f.relay.shutdown();
  }
});

it.each([
  "operation_unknown",
  "operation_rejected",
  "http_safe_error",
  "malformed_operation",
] as const)(
  "isolated safe close diagnostics whitelist Gateway contract fields: %s",
  async (mode) => {
    const f = await fixture(MiB);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentinel = "SECRET_SENTINEL_DO_NOT_LOG";
    try {
      await f.preparation.prepare();
      f.setCloseResponseOverride((operationId) => {
        const operation =
          mode === "operation_unknown" ||
          mode === "operation_rejected" ||
          mode === "malformed_operation";
        const rejected = mode === "operation_rejected";
        const diagnostic = {
          code: mode === "malformed_operation" ? sentinel : "upstream_failure",
          effect: rejected ? "not_dispatched" : "effect_unknown",
          traceRef: sentinel,
          operationRef: operationId,
          requestRef: sentinel,
          retry: { kind: "never" },
        };
        return operation
          ? {
              status: 200,
              body: {
                operationRef: operationId,
                state: rejected ? "rejected" : "unknown",
                error: diagnostic,
              },
            }
          : { status: 503, body: diagnostic };
      });
      if (mode === "http_safe_error" || mode === "malformed_operation") {
        await expect(f.preparation.close("cancelled")).rejects.toBeDefined();
      } else {
        expect(await f.preparation.close("cancelled")).toMatchObject({
          state: mode === "operation_rejected" ? "rejected" : "unknown",
        });
      }
      expect(f.preparation.canReleaseWithoutRemoteClose()).toBe(false);
      expect(f.requestRefs).toHaveLength(0);
      expect([...f.nativeExecutions.values()]).toEqual(["active"]);
      const entries = warn.mock.calls
        .filter(([event]) => event === "review_run_gateway_close_diagnostic")
        .map(([, data]) => data);
      const expected =
        mode === "http_safe_error"
          ? {
              phase: "remote_close",
              category: "safe_error",
              code: "upstream_failure",
              effect: "effect_unknown",
              httpStatus: 503,
            }
          : mode === "malformed_operation"
            ? {
                phase: "remote_close",
                category: "invalid_response",
                code: "unknown",
                effect: "unknown",
                httpStatus: "unknown",
              }
            : {
                phase: "remote_close",
                category:
                  mode === "operation_rejected" ? "rejected" : "unknown",
                code: "upstream_failure",
                effect:
                  mode === "operation_rejected"
                    ? "not_dispatched"
                    : "effect_unknown",
              };
      expect(entries).toEqual([expected]);
      expect(JSON.stringify(entries)).not.toContain(sentinel);
      expect(JSON.stringify(entries)).not.toContain("rr-close-");
    } finally {
      f.setCloseResponseOverride();
      f.setCloseState("applied");
      await f.relay.shutdown();
      warn.mockRestore();
    }
  },
);

it.each([
  {
    code: "SECRET_SENTINEL_DO_NOT_LOG",
    effect: "SECRET_SENTINEL_DO_NOT_LOG",
    httpStatus: 999,
    expectedCode: "unknown",
    expectedEffect: "unknown",
    expectedStatus: "unknown",
  },
  {
    code: "upstream_failure",
    effect: "SECRET_SENTINEL_DO_NOT_LOG",
    httpStatus: -1,
    expectedCode: "upstream_failure",
    expectedEffect: "unknown",
    expectedStatus: "unknown",
  },
  {
    code: "SECRET_SENTINEL_DO_NOT_LOG",
    effect: "effect_unknown",
    httpStatus: "SECRET_SENTINEL_DO_NOT_LOG",
    expectedCode: "unknown",
    expectedEffect: "effect_unknown",
    expectedStatus: "unknown",
  },
] as const)(
  "isolated safe close diagnostics reject malformed injected exception metadata: %#",
  async (scenario) => {
    const f = await fixture(MiB);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sentinel = "SECRET_SENTINEL_DO_NOT_LOG";
    const injected = new GatewayError(
      "safe_error",
      "effect_unknown",
      sentinel,
      sentinel,
      {
        code: scenario.code,
        effect: scenario.effect,
        traceRef: sentinel,
      } as never,
      scenario.httpStatus as number,
    );
    Object.defineProperty(f.bindings, "completeCleanup", {
      configurable: true,
      value: async () => {
        throw injected;
      },
    });
    try {
      await f.preparation.prepare();
      await expect(f.preparation.close("cancelled")).rejects.toBe(injected);
      const entries = warn.mock.calls
        .filter(([event]) => event === "review_run_gateway_close_diagnostic")
        .map(([, data]) => data);
      expect(entries).toEqual([
        {
          phase: "binding_cleanup",
          category: "safe_error",
          code: scenario.expectedCode,
          effect: scenario.expectedEffect,
          httpStatus: scenario.expectedStatus,
        },
      ]);
      expect(JSON.stringify(entries)).not.toContain(sentinel);
      expect(f.requestRefs).toHaveLength(0);
    } finally {
      Object.defineProperty(f.bindings, "completeCleanup", {
        configurable: true,
        value: async () => {},
      });
      await f.relay.shutdown();
      warn.mockRestore();
    }
  },
);

it.each(["pressure", "timer"] as const)(
  "v4 restored completed close recovers through %s without publication revocation or inference replay",
  async (trigger) => {
    const f = await fixture(
      32768,
      0,
      1,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      { models: ["gpt-5.6-sol"], independentAllocations: true },
    );
    const restored = f.restartRelay(1);
    const revoke = vi.spyOn(
      f.authorizations,
      "expireOrRevokeReviewRunAuthorization",
    );
    try {
      await streamRun(f, "authorization-1", "reviewer-0");
      f.setCloseState("unknown");
      expect(
        await restored.closeRun("authorization-1", "completed"),
      ).toMatchObject({ state: "unknown" });
      expect(f.nativeCloses).toHaveLength(1);
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(f.terminalRuns.size).toBe(0);
      f.setCloseState("applied");
      if (trigger === "timer") {
        // Join the automatic close while its native ACK is held, then wait for
        // custody release before the single new admission.
        const gate = f.holdClose();
        try {
          await gate.started;
          const joined = restored.closeRun("authorization-1", "completed");
          gate.release();
          expect(await joined).toMatchObject({ state: "applied" });
        } finally {
          gate.release();
        }
      }
      await expect(
        streamRun({ ...f, relay: restored }, "authorization-2", "reviewer-0"),
      ).resolves.toBe("stream");
      expect(f.nativeCloseReasons).toEqual(["completed", "completed"]);
      expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
      expect(f.requestModels).toHaveLength(2);
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      revoke.mockRestore();
      await restored.shutdown();
      await f.relay.shutdown();
    }
  },
);

it("v4 restored completed close bounds idle retries and retains its original deadline timer", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol"], independentAllocations: true },
  );
  const restored = f.restartRelay(1);
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    // The original process has exited: its in-memory timers cannot perform
    // deadline cleanup for the independently restored process.
    vi.clearAllTimers();
    f.setCloseState("unknown");
    await restored.closeRun("authorization-1", "completed");
    for (let tick = 0; tick < 1100 && f.nativeCloses.length < 9; tick++) {
      await vi.advanceTimersByTimeAsync(100);
      await setImmediate();
    }
    await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(9));
    for (let tick = 0; tick < 10; tick++) await setImmediate();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.nativeCloses).toHaveLength(9);
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
    await vi.advanceTimersByTimeAsync(
      f.authorization().maxExpiresAt.getTime() - Date.now() + 1,
    );
    await vi.waitFor(() =>
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Expired),
    );
    await vi.waitFor(() => expect(f.nativeCloses).toHaveLength(10));
    for (let tick = 0; tick < 10; tick++) await setImmediate();
    const closes = f.nativeCloses.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.nativeCloses).toHaveLength(closes);
    expect(f.nativeCloseReasons).toEqual(
      Array.from({ length: 10 }, () => "completed"),
    );
    expect(new Set(f.nativeCloseOperationIds).size).toBe(1);
    expect(f.requestModels).toHaveLength(1);
  } finally {
    await restored.shutdown();
    await f.relay.shutdown();
    vi.useRealTimers();
  }
});

it.each(["identity", "snapshot", "read_failure"] as const)(
  "v4 restored completed close rejects changed %s during automatic owner validation",
  async (changed) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const f = await fixture(
      32768,
      0,
      1,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      { models: ["gpt-5.6-sol"], independentAllocations: true },
    );
    const restored = f.restartRelay(1);
    const originalRead = f.queries.findReviewRunAuthorizationById;
    const read = vi.spyOn(f.queries, "findReviewRunAuthorizationById");
    const revoke = vi.spyOn(
      f.authorizations,
      "expireOrRevokeReviewRunAuthorization",
    );
    let releaseRead: (() => void) | undefined;
    try {
      await streamRun(f, "authorization-1", "reviewer-0");
      vi.clearAllTimers();
      f.setCloseState("unknown");
      await restored.closeRun("authorization-1", "completed");
      const original = f.authorization();
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      read.mockImplementationOnce(async (id) => {
        entered();
        await held;
        if (changed === "read_failure")
          throw Error("synthetic_restored_owner_read_failure");
        return originalRead(id);
      });
      await vi.advanceTimersByTimeAsync(1000);
      await started;
      if (changed === "identity")
        f.overrides.set("authorization-1", { headSha: "e".repeat(40) });
      if (changed === "snapshot") {
        const snapshot = JSON.parse(original.runtimeSnapshotCanonicalJson!) as {
          allocations: Array<{ allocationId: string }>;
          reviewers: Array<{ transport: { allocationId: string } }>;
        };
        snapshot.allocations[0]!.allocationId = "replacement-allocation";
        snapshot.reviewers[0]!.transport.allocationId =
          "replacement-allocation";
        f.overrides.set("authorization-1", {
          runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
        });
      }
      // Join the in-progress timer close; it must retain custody and reject
      // the changed or unreadable owner before issuing another native close.
      const joined = restored.closeRun("authorization-1", "completed");
      releaseRead!();
      if (changed === "read_failure")
        await expect(joined).rejects.toThrow(
          "synthetic_restored_owner_read_failure",
        );
      else expect(await joined).toMatchObject({ state: "unknown" });
      expect(f.nativeCloses).toHaveLength(1);
      expect(f.requestModels).toHaveLength(1);
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      releaseRead?.();
      read.mockRestore();
      revoke.mockRestore();
      f.overrides.clear();
      await restored.shutdown();
      await f.relay.shutdown();
      vi.useRealTimers();
    }
  },
);

it("v4 restored completed close preserves joined cancellation for later restored allocations", async () => {
  const f = await fixture(
    32768,
    0,
    2,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol", "gpt-5.5"], independentAllocations: true },
  );
  const restored = f.restartRelay(1);
  let gate: ReturnType<typeof f.holdClose> | undefined;
  let completed: ReturnType<typeof restored.closeRun> | undefined;
  let cancelled: ReturnType<typeof restored.closeRun> | undefined;
  try {
    for (const reviewerId of ["reviewer-0", "reviewer-1"]) {
      const response = await f.relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        reviewerId,
      );
      if (response.kind !== "stream") throw Error("stream_expected");
      for await (const chunk of response.body)
        expect(chunk.byteLength).toBeGreaterThan(0);
    }
    gate = f.holdClose();
    completed = restored.closeRun("authorization-1", "completed");
    await gate.started;
    cancelled = restored.closeRun("authorization-1", "cancelled");
    await vi.waitFor(() =>
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Revoked),
    );
    gate.release();
    expect(await Promise.all([completed, cancelled])).toEqual([
      expect.objectContaining({ state: "applied" }),
      expect.objectContaining({ state: "applied" }),
    ]);
    expect(f.nativeCloseReasons).toEqual(["completed", "cancelled"]);
    expect(new Set(f.nativeCloses).size).toBe(2);
    expect(f.requestModels).toHaveLength(2);
  } finally {
    gate?.release();
    await Promise.allSettled([completed, cancelled]);
    await restored.shutdown();
    await f.relay.shutdown();
  }
});

it.each([
  { changed: "identity", alreadyExpired: false },
  { changed: "snapshot", alreadyExpired: false },
  { changed: "identity", alreadyExpired: true },
] as const)(
  "v4 first restored close pins $changed authority before its deadline joins: expired=$alreadyExpired",
  async ({ changed, alreadyExpired }) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const f = await fixture(
      32768,
      0,
      1,
      5000,
      undefined,
      undefined,
      9,
      undefined,
      { models: ["gpt-5.6-sol"], independentAllocations: true },
    );
    const restored = f.restartRelay(1);
    const revoke = vi.spyOn(
      f.authorizations,
      "expireOrRevokeReviewRunAuthorization",
    );
    let gate: ReturnType<typeof f.holdClose> | undefined;
    let completed: ReturnType<typeof restored.closeRun> | undefined;
    try {
      await streamRun(f, "authorization-1", "reviewer-0");
      vi.clearAllTimers();
      const original = f.authorization();
      vi.setSystemTime(
        original.maxExpiresAt.getTime() + (alreadyExpired ? 1 : -10),
      );
      f.setCloseState("unknown");
      gate = f.holdClose();
      completed = restored.closeRun("authorization-1", "completed");
      void completed.catch(() => {});
      await gate.started;
      if (changed === "identity")
        f.overrides.set("authorization-1", { headSha: "e".repeat(40) });
      else {
        const snapshot = JSON.parse(original.runtimeSnapshotCanonicalJson!) as {
          deadline: string;
        };
        snapshot.deadline = new Date(
          Date.parse(snapshot.deadline) - 1,
        ).toISOString();
        f.overrides.set("authorization-1", {
          runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
        });
      }
      await vi.advanceTimersByTimeAsync(
        Math.max(1, original.maxExpiresAt.getTime() - Date.now() + 1),
      );
      const joined = restored.closeRun("authorization-1", "deadline");
      gate.release();
      await Promise.all([completed, joined]);
      expect(revoke).not.toHaveBeenCalled();
      expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Active);
      expect(f.nativeCloses).toHaveLength(1);
      expect(f.requestModels).toHaveLength(1);
    } finally {
      gate?.release();
      await Promise.allSettled([completed]);
      revoke.mockRestore();
      f.overrides.clear();
      await restored.shutdown();
      await f.relay.shutdown();
      vi.useRealTimers();
    }
  },
);

it("v4 restored completed close clears deadline and retry timers at shutdown", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    { models: ["gpt-5.6-sol"], independentAllocations: true },
  );
  const restored = f.restartRelay(1);
  const revoke = vi.spyOn(
    f.authorizations,
    "expireOrRevokeReviewRunAuthorization",
  );
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    vi.clearAllTimers();
    f.setCloseState("unknown");
    await restored.closeRun("authorization-1", "completed");
    await restored.shutdown();
    const closes = f.nativeCloses.length;
    const writes = revoke.mock.calls.length;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.nativeCloses).toHaveLength(closes);
    expect(revoke).toHaveBeenCalledTimes(writes);
    expect(f.requestModels).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    revoke.mockRestore();
    await f.relay.shutdown();
    vi.useRealTimers();
  }
});

it("shutdown clears timers for additional allocations restored during cleanup", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const f = await fixture(
    32768,
    0,
    2,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    {
      models: ["gpt-5.6-sol", "gpt-5.5"],
      independentAllocations: true,
    },
  );
  const restored = f.restartRelay(2);
  try {
    for (const [relay, reviewerId] of [
      [restored, "reviewer-0"],
      [f.relay, "reviewer-1"],
    ] as const) {
      const response = await relay.responses(
        "authorization-1",
        Buffer.from("{}"),
        new AbortController(),
        undefined,
        undefined,
        reviewerId,
      );
      if (response.kind !== "stream") throw Error("stream_expected");
      for await (const chunk of response.body) void chunk;
    }
    vi.clearAllTimers();
    f.setCloseState("unknown");
    await restored.shutdown();
    expect(f.nativeCloses).toHaveLength(2);
    expect(f.requestModels).toHaveLength(2);
    // A request-timeout timer remains in the fixture transport.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.nativeCloses).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await f.relay.shutdown();
    vi.useRealTimers();
  }
});

it("bounds concurrent authorization reads at simultaneous session deadlines", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const f = await fixture(MiB, 0, 8);
  const original = f.queries.findReviewRunAuthorizationById;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let active = 0;
  let peak = 0;
  try {
    for (let i = 0; i < 8; i++) await streamRun(f, `authorization-${i}`);
    vi.spyOn(f.queries, "findReviewRunAuthorizationById").mockImplementation(
      async (id) => {
        active++;
        peak = Math.max(peak, active);
        try {
          await gate;
          return await original(id);
        } finally {
          active--;
        }
      },
    );
    await vi.advanceTimersByTimeAsync(120_001);
    expect(peak).toBe(2);
    expect(f.requestModels).toHaveLength(8);
  } finally {
    release();
    vi.restoreAllMocks();
    await f.relay.shutdown();
    vi.useRealTimers();
  }
});

it("shutdown waits for a close restoring its first session", async () => {
  const f = await fixture(
    32768,
    0,
    1,
    5000,
    undefined,
    undefined,
    9,
    undefined,
    {
      models: ["gpt-5.6-sol"],
      independentAllocations: true,
    },
  );
  const restored = f.restartRelay(1);
  const originalRead = f.queries.findReviewRunAuthorizationById;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await streamRun(f, "authorization-1", "reviewer-0");
    f.setCloseState("unknown");
    vi.spyOn(
      f.queries,
      "findReviewRunAuthorizationById",
    ).mockImplementationOnce(async (id) => {
      entered();
      await held;
      return originalRead(id);
    });
    const close = restored.closeRun("authorization-1", "completed");
    await started;
    let stopped = false;
    const shutdown = restored.shutdown().then(() => {
      stopped = true;
    });
    await setImmediate();
    expect(stopped).toBe(false);
    release();
    await Promise.allSettled([close, shutdown]);
    expect(stopped).toBe(true);
    expect(f.authorization().state).toBe(ReviewRunAuthorizationState.Revoked);
    expect(f.requestModels).toHaveLength(1);
    expect(new Set(f.nativeCloses).size).toBe(1);
  } finally {
    release();
    vi.restoreAllMocks();
    await restored.shutdown();
    await f.relay.shutdown();
  }
});

it("bounds simultaneous closes without retained sessions and reports unknown overflow", async () => {
  const f = await fixture(MiB, 0, 1);
  const restored = f.restartRelay(1, 1);
  const originalRead = f.queries.findReviewRunAuthorizationById;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first: ReturnType<typeof restored.closeRun> | undefined;
  let second: ReturnType<typeof restored.closeRun> | undefined;
  try {
    vi.spyOn(
      f.queries,
      "findReviewRunAuthorizationById",
    ).mockImplementationOnce(async (id) => {
      entered();
      await held;
      return originalRead(id);
    });
    first = restored.closeRun("authorization-1", "completed");
    await started;
    second = restored.closeRun("authorization-2", "completed");
    const outcome = await Promise.race([second, setImmediate("queued")]);
    expect(outcome).toEqual({ state: "unknown" });
  } finally {
    release();
    await Promise.allSettled([first, second]);
    vi.restoreAllMocks();
    await restored.shutdown();
    await f.relay.shutdown();
  }
});

it("drains more retained sessions than cleanup slots during shutdown", async () => {
  const f = await fixture(MiB, 0, 4);
  const ids = Array.from(
    { length: 4 },
    (_, index) => `authorization-${index + 1}`,
  );
  let gate: ReturnType<typeof f.holdClose> | undefined;
  let first: ReturnType<typeof f.relay.closeRun> | undefined;
  let shutdown: ReturnType<typeof f.relay.shutdown> | undefined;
  try {
    for (const id of ids) await streamRun(f, id);
    gate = f.holdClose();
    first = f.relay.closeRun(ids[0]!, "cancelled");
    void first.catch(() => {});
    await gate.started;
    shutdown = f.relay.shutdown();
    await vi.waitFor(() => {
      expect(f.nativeCloses).toHaveLength(f.relay.policy.maxInFlight);
      for (const id of ids)
        expect(f.authorization(id).state).toBe(
          ReviewRunAuthorizationState.Revoked,
        );
    });
    gate.release();
    await Promise.all([first, shutdown]);
    expect(f.nativeCloses).toHaveLength(ids.length);
    expect(new Set(f.nativeCloses)).toEqual(new Set(f.nativeExecutions.keys()));
    expect([...f.nativeExecutions.values()]).toEqual(ids.map(() => "closed"));
  } finally {
    gate?.release();
    await Promise.allSettled([first, shutdown]);
    await f.relay.shutdown();
  }
});
