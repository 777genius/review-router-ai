import { gatewayProfileAcceptsRequestedModel } from "./review-run-gateway-model-qualification";
import type { UsageIdentity } from "@reviewrouter/features-provider-usage";
import { gatewayUsageReceipt } from "./provider-usage-gateway-relay-receipt";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import * as c from "@agent-teams/account-gateway/contracts";
import { GatewayError } from "@agent-teams/account-gateway/http";
import type { NativeResponse } from "@agent-teams/account-gateway/http";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  getReviewRunReviewer,
  getReviewRunGatewayAllocation,
  reviewRunGatewayOwnedIdentity,
  ReviewRunAuthorizationState,
  ReviewRunCompanionDispatchFailure,
  type ReviewRunCompanionDispatchAdmission,
  type ReviewRunCompanionDispatch,
  type ManageReviewRunAuthorizations,
  type ReviewRunAuthorization,
  type ReviewRunAuthorizationQueryPort,
  type ReviewRunGatewayExecutionBindingPort,
  type ReviewRunRuntimeSnapshotPort,
} from "@reviewrouter/features-review-run-control";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config/review-configuration";
import {
  reviewRunGatewayMaxResponseBytes,
  type RunAccessConfig,
} from "./account-gateway-run-access";
import { createReviewRunGatewayPreparation } from "./review-run-gateway-preparation";
import {
  parseReviewReviewerId,
  reviewerPlanContract,
  lifecycleVerificationContract,
  prDescriptionContract,
  type ReviewCompanionDispatchContextV1,
} from "@reviewrouter/shared";

// Selected production provider path: ReviewRouter -> Account Gateway -> Sub2API.
// Gateway "native" response terminology is not the legacy direct native-v4
// adapter; authorization/fencing still apply and must not be bypassed.

export type ReviewRunGatewayRelayPolicy = {
  readonly profiles: readonly {
    readonly profile: z.infer<typeof c.profile>;
    readonly outputTokens: number;
  }[];
  readonly ingressBytes: number;
  readonly requestTimeoutMs: number;
  readonly waitBudgetMs: number;
  readonly maxWaits: number;
  readonly maxSessions: number;
  readonly maxInFlight: number;
};

// Explicit server configuration; numbers are bounds, not qualification receipts.
const relayPolicy: z.ZodType<ReviewRunGatewayRelayPolicy> = z.strictObject({
  profiles: z
    .array(
      z.strictObject({
        profile: c.profile,
        outputTokens: c.limits.shape.tokens,
      }),
    )
    .min(1)
    .max(128),
  ingressBytes: z.number().int().min(1).max(16_777_216),
  requestTimeoutMs: z.number().int().min(1).max(3_600_000),
  waitBudgetMs: z.number().int().min(0).max(3_600_000),
  maxWaits: z.number().int().min(0).max(128),
  maxSessions: z.number().int().min(1).max(10_000),
  maxInFlight: z.number().int().min(1).max(10_000),
});
export function readReviewRunGatewayRelayPolicy(raw: string) {
  try {
    if (Buffer.byteLength(raw) > 4096) throw new Error();
    return Object.freeze(relayPolicy.parse(JSON.parse(raw)));
  } catch {
    throw new Error("review_run_gateway_relay_policy_invalid");
  }
}
export { gatewayProfileAcceptsRequestedModel } from "./review-run-gateway-model-qualification";
class RelayFailure extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    readonly effect: c.RequestStatus["effect"] = "not_dispatched",
    readonly requestRef?: string,
    readonly dispatch?: ReturnType<typeof companionReadback>,
    readonly failureScope?: "reviewer" | "allocation" | "run",
    readonly concurrencyGroupId?: string,
  ) {
    super(code);
  }
}
type RelayDiagnostic = {
  stage:
    | "resolve"
    | "prepare"
    | "request"
    | "post_request_authority"
    | "stream_reader"
    | "stream_wrap"
    | "http_headers";
  bodyLocked: boolean;
};
type Preparation = ReturnType<typeof createReviewRunGatewayPreparation>;
type Session = {
  readonly key: string;
  readonly authorizationId: string;
  readonly allocationId?: string;
  readonly preparation: Preparation;
  readonly canonical: string;
  readonly identity: string;
  readonly deadline: number;
  readonly aborts: Map<AbortController, string | undefined>;
  readonly closedReviewers: Set<string>;
  readonly timer: ReturnType<typeof setTimeout>;
  closed: boolean;
  closeReason?: c.Close["reason"];
  parentTerminationReason?: c.Close["reason"];
};

/** Backend process memory contains capabilities only. SQL remains the sole run
 * authority/selected facts. Absence NEVER replays inference or auto-recovers. */
export function createReviewRunGatewayRelay(input: {
  readonly policy: ReviewRunGatewayRelayPolicy;
  readonly runAccess: RunAccessConfig;
  readonly readPreparationOperation?: (
    operationId: string,
    options: import("@agent-teams/account-gateway/http").CallOptions,
  ) => Promise<c.Operation | undefined>;
  readonly authorizations: Pick<
    ManageReviewRunAuthorizations,
    | "resolveReviewRunAuthorizationToken"
    | "expireOrRevokeReviewRunAuthorization"
  >;
  readonly queries: ReviewRunAuthorizationQueryPort;
  // Full SCM freshness at phase boundaries; opaque chunks keep every local guard.
  readonly checkAuthority: (
    authorization: ReviewRunAuthorization,
    freshness: "full" | "local",
  ) => Promise<boolean>;
  readonly confirmAuthority: (
    token: string,
    authorization: ReviewRunAuthorization,
  ) => Promise<boolean>;
  readonly snapshots: ReviewRunRuntimeSnapshotPort;
  readonly bindings: ReviewRunGatewayExecutionBindingPort;
  readonly companionDispatches?: ReviewRunCompanionDispatchAdmission;
  /** Persist trusted correlation before dispatch; outcome reporting never replays inference. */
  readonly usage?: {
    prepare(input: {
      authorization: ReviewRunAuthorization;
      executionRef: string;
      requestRef: string;
      occurredAt: string;
      model: string;
      reviewerId?: string;
      role?: ReviewRunCompanionDispatch["role"];
    }): Promise<UsageIdentity | void>;
    ownsRequest?(input: {
      authorizationId: string;
      executionRef: string;
      requestRef: string;
      reviewerId: string;
    }): Promise<boolean>;
    outcome(input: {
      authorizationId: string;
      executionRef: string;
      requestRef: string;
      effect: c.RequestStatus["effect"];
    }): Promise<void>;
  };
}) {
  const policy = Object.freeze(relayPolicy.parse(input.policy));
  if (
    new Set(policy.profiles.map((entry) => entry.profile.profileId)).size !==
    policy.profiles.length
  )
    throw new Error("review_run_gateway_relay_policy_invalid");
  for (const entry of policy.profiles) {
    Object.freeze(entry.profile.modelIds);
    Object.freeze(entry.profile.authKinds);
    Object.freeze(entry.profile);
    Object.freeze(entry);
  }
  Object.freeze(policy.profiles);
  const sessions = new Map<string, Session>();
  let inFlight = 0;
  let cleanupInFlight = 0;
  let closeAuthorityInFlight = 0;
  const closing = new Map<
    string,
    {
      operation: Promise<
        c.Operation | { state: "unknown" } | { state: "applied" }
      >;
      terminate(
        reason: c.Close["reason"],
      ): Promise<ReviewRunAuthorization | null>;
    }
  >();
  let stopping = false;
  let capacityCleanup: Promise<void> | undefined;
  let cleanupCursor = sessions.entries();
  function reserve() {
    if (stopping || inFlight >= policy.maxInFlight)
      throw new RelayFailure("relay_saturated", 503);
    inFlight++;
    let finished = false;
    return () => {
      if (!finished) {
        finished = true;
        inFlight--;
      }
    };
  }
  async function bounded<T>(work: () => Promise<T>) {
    const finish = reserve();
    try {
      return await work();
    } finally {
      finish();
    }
  }
  function selected(auth: ReviewRunAuthorization, reviewerId?: string) {
    const snapshot = parseReviewRunRuntimeSnapshot(
      auth.runtimeSnapshotCanonicalJson,
    );
    if (!snapshot) throw new RelayFailure("gateway_unavailable", 403);
    if (snapshot.snapshotVersion === 4) {
      if (reviewerId === undefined)
        throw new RelayFailure(
          "reviewer_selector_required",
          403,
          "not_dispatched",
          undefined,
          undefined,
          "reviewer",
        );
      let reviewer;
      try {
        reviewer = getReviewRunReviewer(
          snapshot,
          parseReviewReviewerId(reviewerId),
        );
      } catch {
        throw new RelayFailure(
          "reviewer_selector_invalid",
          403,
          "not_dispatched",
          undefined,
          undefined,
          "reviewer",
        );
      }
      if (
        sessions
          .get(`${auth.authorizationId}\0${reviewer.transport.allocationId}`)
          ?.closedReviewers.has(reviewer.reviewerId)
      )
        throw new RelayFailure(
          "reviewer_closed",
          403,
          "not_dispatched",
          undefined,
          undefined,
          "reviewer",
        );
      return {
        snapshot,
        reviewer,
        gateway: getReviewRunGatewayAllocation(
          snapshot,
          reviewer.transport.allocationId,
        ),
        providerIndex: reviewer.providerIndex,
      };
    }
    if (reviewerId !== undefined || !snapshot.gateway)
      throw new RelayFailure("reviewer_selector_invalid", 403);
    return {
      snapshot,
      gateway: snapshot.gateway,
      reviewer: undefined,
      providerIndex: snapshot.gateway.providerIndex,
    };
  }
  async function resolve(
    token: string,
    freshness: "full" | "local" = "full",
    reviewerId?: string,
    parentOnly = false,
  ) {
    const result =
      await input.authorizations.resolveReviewRunAuthorizationToken({ token });
    if (result.status !== "valid")
      throw new RelayFailure(
        "authorization_denied",
        401,
        "not_dispatched",
        undefined,
        undefined,
        "run",
      );
    const auth = result.authorization;
    if (!(await input.checkAuthority(auth, freshness)))
      throw new RelayFailure(
        "authorization_denied",
        401,
        "not_dispatched",
        undefined,
        undefined,
        "run",
      );
    const canonical = auth.runtimeSnapshotCanonicalJson;
    const snapshot = parseReviewRunRuntimeSnapshot(canonical);
    if (
      !canonical ||
      !snapshot ||
      (snapshot.snapshotVersion === 3 && !snapshot.gateway)
    )
      throw new RelayFailure("gateway_unavailable", 403);
    if (!parentOnly) {
      const lane = selected(auth, reviewerId);
      const owned = await input.bindings.read({
        authorizationId: auth.authorizationId,
        ...(lane.reviewer
          ? { allocationId: lane.reviewer.transport.allocationId }
          : {}),
        identity: reviewRunGatewayOwnedIdentity(auth),
        runtimeSnapshotCanonicalJson: canonical,
      });
      if (owned.status !== "live")
        throw new RelayFailure(
          "allocation_authorization_denied",
          401,
          "not_dispatched",
          undefined,
          undefined,
          lane.reviewer ? "allocation" : "run",
          lane.reviewer?.concurrencyGroupId,
        );
    }
    if (!(await input.confirmAuthority(token, auth)))
      throw new RelayFailure(
        "authorization_denied",
        401,
        "not_dispatched",
        undefined,
        undefined,
        "run",
      );
    return auth;
  }
  async function check(
    token: string,
    auth: ReviewRunAuthorization,
    session: Session,
    freshness: "full" | "local" = "full",
    reviewerId?: string,
  ) {
    const current = await resolve(token, freshness, reviewerId);
    if (
      session.closed ||
      stopping ||
      current.authorizationId !== auth.authorizationId ||
      current.runtimeSnapshotCanonicalJson !== session.canonical ||
      canonicalJson(reviewRunGatewayOwnedIdentity(current)) !==
        session.identity ||
      Date.now() >= session.deadline
    )
      throw new RelayFailure("authorization_denied", 401);
  }
  function reclaimCapacity() {
    if (capacityCleanup) return capacityCleanup;
    capacityCleanup = (async () => {
      // Pressure only: one shared, fair batch. Do not turn a POST into a scan of
      // every retained capability or poll/replay an unresolved native operation.
      const budget = Math.min(sessions.size, policy.maxInFlight, 16);
      const deadline = Date.now() + Math.min(policy.requestTimeoutMs, 30_000);
      for (let i = 0; i < budget && sessions.size >= policy.maxSessions; i++) {
        if (Date.now() >= deadline) break;
        let next = cleanupCursor.next();
        if (next.done) {
          cleanupCursor = sessions.entries();
          next = cleanupCursor.next();
        }
        if (next.done) break;
        const [, session] = next.value;
        const authorizationId = session.authorizationId;
        if (closing.has(authorizationId) || session.preparation.isPreparing())
          continue;
        try {
          const row =
            await input.queries.findReviewRunAuthorizationById(authorizationId);
          if (
            !row ||
            row.authorizationId !== authorizationId ||
            row.runtimeSnapshotCanonicalJson !== session.canonical ||
            canonicalJson(reviewRunGatewayOwnedIdentity(row)) !==
              session.identity ||
            row.maxExpiresAt.getTime() !== session.deadline ||
            (row.state !== ReviewRunAuthorizationState.Revoked &&
              row.state !== ReviewRunAuthorizationState.Expired &&
              Date.now() < session.deadline)
          )
            continue;
          // Keep durable deny-first and the exact retained-capability close.
          // Unknown attempted prepares/closes never release a memory slot.
          if (
            Date.now() >= deadline ||
            closing.has(authorizationId) ||
            session.preparation.isPreparing()
          )
            continue;
          await closeRun(
            authorizationId,
            row.state === ReviewRunAuthorizationState.Expired ||
              (row.state === ReviewRunAuthorizationState.Active &&
                Date.now() >= session.deadline)
              ? "deadline"
              : "cancelled",
            deadline,
          );
        } catch {
          // Missing authority/failed read/unknown close cannot justify eviction.
        }
      }
    })().finally(() => {
      capacityCleanup = undefined;
    });
    return capacityCleanup;
  }
  async function sessionFor(
    auth: ReviewRunAuthorization,
    reviewerId?: string,
    cleanupOnly = false,
    allocationId?: string,
  ) {
    const canonical = auth.runtimeSnapshotCanonicalJson;
    const snapshot = parseReviewRunRuntimeSnapshot(canonical);
    if (
      !canonical ||
      !snapshot ||
      auth.maxExpiresAt.toISOString() !== snapshot.deadline
    )
      throw new RelayFailure("gateway_unavailable", 403);
    const selectedId =
      snapshot.snapshotVersion === 4
        ? (allocationId ??
          selected(auth, reviewerId).reviewer?.transport.allocationId)
        : undefined;
    if (
      snapshot.snapshotVersion === 4 &&
      (!selectedId ||
        !snapshot.allocations.some((row) => row.allocationId === selectedId))
    )
      throw new RelayFailure("reviewer_selector_invalid", 403);
    if (
      snapshot.snapshotVersion === 3 &&
      (!snapshot.gateway || allocationId !== undefined)
    )
      throw new RelayFailure("gateway_unavailable", 403);
    const key =
      selectedId === undefined
        ? auth.authorizationId
        : `${auth.authorizationId}\0${selectedId}`;
    const identity = canonicalJson(reviewRunGatewayOwnedIdentity(auth));
    const existing = () => {
      if (
        !cleanupOnly &&
        (closing.has(auth.authorizationId) ||
          [...sessions.values()].some(
            (retained) =>
              retained.authorizationId === auth.authorizationId &&
              retained.closed,
          ))
      )
        throw new RelayFailure("authorization_denied", 401);
      const session = sessions.get(key);
      if (
        session &&
        (session.canonical !== canonical ||
          session.identity !== identity ||
          (!cleanupOnly && session.closed))
      )
        throw new RelayFailure("authorization_denied", 401);
      return session;
    };
    let session = existing();
    if (session) return session;
    if (!stopping && !cleanupOnly && sessions.size >= policy.maxSessions)
      await reclaimCapacity();
    session = existing();
    if (session) return session;
    if ((!cleanupOnly && stopping) || sessions.size >= policy.maxSessions)
      throw new RelayFailure("relay_saturated", 503);
    const deadline = Date.parse(snapshot.deadline);
    if (!cleanupOnly && Date.now() >= deadline)
      throw new RelayFailure("authorization_denied", 401);
    const timer = setTimeout(
      () => {
        if (!cleanupOnly)
          void closeRun(auth.authorizationId, "deadline").catch(() => {});
      },
      cleanupOnly
        ? 2_147_483_647
        : Math.max(1, Math.min(deadline - Date.now(), 2_147_483_647)),
    );
    timer.unref();
    session = {
      key,
      authorizationId: auth.authorizationId,
      ...(selectedId === undefined ? {} : { allocationId: selectedId }),
      canonical,
      identity,
      deadline,
      closed: cleanupOnly,
      aborts: new Map(),
      closedReviewers: new Set(),
      timer,
      preparation: createReviewRunGatewayPreparation({
        authorizationId: auth.authorizationId,
        ...(selectedId === undefined ? {} : { allocationId: selectedId }),
        ...(input.readPreparationOperation
          ? { readPreparationOperation: input.readPreparationOperation }
          : {}),
        identity: auth,
        runAccess: input.runAccess,
        authorizations: input.queries,
        snapshots: input.snapshots,
        bindings: input.bindings,
      }),
    };
    sessions.set(key, session);
    return session;
  }
  function closeRun(
    authorizationId: string,
    reason: c.Close["reason"],
    deadline?: number,
  ): Promise<c.Operation | { state: "unknown" } | { state: "applied" }> {
    const owned = [...sessions.values()].filter(
      (session) => session.authorizationId === authorizationId,
    );
    let parentReason =
      reason === "completed"
        ? owned.find((session) => session.parentTerminationReason !== undefined)
            ?.parentTerminationReason
        : reason;
    // Local cancellation cannot wait for a slow or failed authority write.
    // Retain denied sessions until their exact native cleanup is confirmed.
    for (const session of owned) {
      session.closed = true;
      session.closeReason ??= reason;
      if (parentReason !== undefined)
        session.parentTerminationReason ??= parentReason;
      clearTimeout(session.timer);
      for (const controller of session.aborts.keys()) controller.abort();
    }
    const pending = closing.get(authorizationId);
    if (pending) {
      if (parentReason === undefined) return pending.operation;
      // Cancellation may join normal v4 cleanup, but must still terminate its
      // publication authority. Native cleanup keeps its original operation.
      return Promise.all([
        pending.operation,
        pending.terminate(parentReason),
      ]).then(([operation]) => operation);
    }
    let termination: Promise<ReviewRunAuthorization | null> | undefined;
    const terminate = (terminalReason: c.Close["reason"]) => {
      parentReason ??= terminalReason;
      // A failed write must not let a later completed retry forget cancellation.
      // Native closeReason remains separate because its operation is immutable.
      for (const session of sessions.values())
        if (session.authorizationId === authorizationId)
          session.parentTerminationReason ??= parentReason;
      termination ??= (async () => {
        await input.authorizations.expireOrRevokeReviewRunAuthorization({
          authorizationId,
          state:
            parentReason === "deadline"
              ? ReviewRunAuthorizationState.Expired
              : ReviewRunAuthorizationState.Revoked,
        });
        const auth =
          await input.queries.findReviewRunAuthorizationById(authorizationId);
        if (auth?.state === "active")
          throw new RelayFailure("close_pending", 409, "effect_unknown");
        return auth;
      })();
      return termination;
    };
    const work = (async () => {
      const revokeFirst =
        parentReason !== undefined ||
        owned.some((session) => session.allocationId === undefined);
      let auth = revokeFirst
        ? await terminate(parentReason ?? reason)
        : await input.queries.findReviewRunAuthorizationById(authorizationId);
      const snapshot = parseReviewRunRuntimeSnapshot(
        auth?.runtimeSnapshotCanonicalJson,
      );
      // Only v4 separates resource release from parent publication authority.
      // Legacy completed closes retain their durable revocation semantics.
      if (reason === "completed" && snapshot?.snapshotVersion !== 4)
        auth = await terminate(reason);
      const allocations =
        auth && snapshot?.snapshotVersion === 4
          ? snapshot.allocations
              .map((allocation) => allocation.allocationId)
              // Release already retained capabilities before restoring others.
              .sort(
                (left, right) =>
                  Number(sessions.has(`${authorizationId}\0${right}`)) -
                  Number(sessions.has(`${authorizationId}\0${left}`)),
              )
          : owned.map((session) => session.allocationId);
      if (allocations.length === 0) return { state: "unknown" as const };
      const operations: (c.Operation | { state: "unknown" })[] = [];
      for (const allocationId of allocations) {
        try {
          // Restore and close one allocation at a time. Successful cleanup frees
          // its capability slot before the next recovery, even at capacity.
          const session =
            auth && snapshot?.snapshotVersion === 4
              ? await sessionFor(auth, undefined, true, allocationId)
              : owned[0]!;
          if (parentReason !== undefined)
            session.parentTerminationReason ??= parentReason;
          operations.push(
            await cleanup(
              authorizationId,
              session.closeReason ?? parentReason ?? reason,
              session,
              deadline,
              () => termination,
            ),
          );
        } catch (error) {
          if (allocations.length === 1) throw error;
          operations.push({ state: "unknown" });
        }
      }
      if (operations.length === 1) return operations[0]!;
      return operations.every((operation) => operation.state === "applied")
        ? { state: "applied" as const }
        : { state: "unknown" as const };
    })().finally(async () => {
      try {
        // Keep the shared close registered until a joined cancellation settles.
        if (termination) await termination;
      } finally {
        closing.delete(authorizationId);
      }
    });
    closing.set(authorizationId, { operation: work, terminate });
    return work;
  }
  async function cleanup(
    _authorizationId: string,
    reason: c.Close["reason"],
    session: Session,
    deadline: number | undefined,
    parentTermination: () => Promise<ReviewRunAuthorization | null> | undefined,
  ) {
    if (cleanupInFlight >= policy.maxInFlight)
      throw new RelayFailure("close_pending", 409, "effect_unknown");
    cleanupInFlight++;
    try {
      const remaining =
        deadline === undefined
          ? policy.requestTimeoutMs
          : deadline - Date.now();
      if (remaining <= 0)
        throw new RelayFailure("close_pending", 409, "effect_unknown");
      const operation = await session.preparation.close(reason, {
        signal: AbortSignal.timeout(remaining),
      });
      if (
        operation.state === "applied" ||
        session.preparation.canReleaseWithoutRemoteClose()
      ) {
        // Native release must not discard the only retained cancellation intent
        // while its joined parent write is still pending or has failed.
        const pendingTermination = parentTermination();
        if (pendingTermination) await pendingTermination;
        sessions.delete(session.key);
      }
      return operation;
    } finally {
      cleanupInFlight--;
    }
  }
  async function scopedResponse(
    auth: ReviewRunAuthorization,
    session: Session,
    dispatch: ReviewRunCompanionDispatch,
    body: Uint8Array,
    signal: AbortSignal,
    controller: AbortController,
    fresh: () => Promise<void>,
    localFresh: () => Promise<void>,
    finish: () => void,
    maxResponseBytes: number,
    diagnostic?: RelayDiagnostic,
    beforeForward?: () => Promise<void>,
    reviewerId?: string,
  ): Promise<
    NativeResponse & {
      readonly usageIdentity?: UsageIdentity;
      readonly maxResponseBytes?: number;
    }
  > {
    const requestRef = dispatch.nativeRequestRef;
    const usageBinding = session.preparation.usageBinding();
    const usageIdentity =
      input.usage && usageBinding
        ? await input.usage.prepare({
            authorization: auth,
            executionRef: usageBinding.executionRef,
            requestRef,
            role: dispatch.role,
            ...(reviewerId === undefined ? {} : { reviewerId }),
            occurredAt: new Date().toISOString(),
            model: parseReviewRunRuntimeSnapshot(session.canonical)!
              .lifecycleVerificationCapability!.model,
          })
        : undefined;
    const outcome = async (effect: c.RequestStatus["effect"]) => {
      if (input.usage && usageBinding)
        await input.usage.outcome({
          authorizationId: auth.authorizationId,
          executionRef: usageBinding.executionRef,
          requestRef,
          effect,
        });
    };
    const settle = async (effect: c.RequestStatus["effect"]) => {
      await outcome(effect);
      await input.companionDispatches!.settle(
        auth.authorizationId,
        dispatch.dispatchId,
        effect === "completed"
          ? "completed"
          : effect === "not_dispatched"
            ? "not_dispatched"
            : "effect_unknown",
      );
    };
    const unknown = async () => {
      await input
        .companionDispatches!.settle(
          auth.authorizationId,
          dispatch.dispatchId,
          "effect_unknown",
        )
        .catch(() => {});
      await outcome("effect_unknown").catch(() => {});
    };
    const dispose = () => {
      session.aborts.delete(controller);
      finish();
    };
    let upstream: NativeResponse | undefined;
    try {
      if (diagnostic) diagnostic.stage = "request";
      // Exactly one SDK request per inserted reservation. Never enter the
      // discovery admission_limited wait loop, including positively unpaid calls.
      upstream = await session.preparation.request(
        requestRef,
        body,
        { signal },
        async () => {
          await fresh();
          await beforeForward?.();
        },
      );
      await fresh();
      if (upstream.kind === "status") {
        await settle(upstream.status.effect);
        dispose();
        return upstream;
      }
      await outcome("dispatch_started");
      const stream = upstream;
      const reader = stream.body.getReader();
      let received = 0;
      let completed = false;
      const abort = () => {
        dispose();
        void stream.cancel().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      const cleanup = () => {
        signal.removeEventListener("abort", abort);
        dispose();
      };
      return {
        ...stream,
        ...(usageIdentity ? { usageIdentity } : {}),
        maxResponseBytes,
        body: new ReadableStream<Uint8Array>(
          {
            async pull(target) {
              try {
                const chunk = await reader.read();
                await localFresh();
                if (signal.aborted) throw new Error("companion_cancelled");
                if (chunk.done) {
                  // EOF alone is not native no-dispatch/completion evidence.
                  const status = await session.preparation.status(
                    requestRef,
                    { signal },
                    fresh,
                  );
                  await settle(status.effect);
                  completed = true;
                  cleanup();
                  target.close();
                } else {
                  received += chunk.value.byteLength;
                  if (received > maxResponseBytes)
                    throw new Error("companion_response_too_large");
                  target.enqueue(chunk.value);
                }
              } catch {
                await unknown();
                cleanup();
                await stream.cancel().catch(() => {});
                target.error(
                  new GatewayError(
                    "transport",
                    "effect_unknown",
                    undefined,
                    requestRef,
                  ),
                );
              }
            },
            async cancel() {
              if (!completed) await unknown();
              cleanup();
              await stream.cancel();
            },
          },
          { highWaterMark: 0 },
        ),
        cancel: async () => {
          if (!completed) await unknown();
          cleanup();
          await stream.cancel();
        },
      };
    } catch (error) {
      if (upstream?.kind === "stream") await upstream.cancel().catch(() => {});
      // Only a positively local native no-dispatch proof settles unpaid.
      let failureEffect: c.RequestStatus["effect"] = "effect_unknown";
      if (
        !upstream &&
        error instanceof GatewayError &&
        error.effect === "not_dispatched" &&
        localLimited(error.diagnostic)
      ) {
        try {
          await settle("not_dispatched");
          failureEffect = "not_dispatched";
        } catch {
          await unknown();
        }
      } else await unknown();
      dispose();
      throw new RelayFailure(
        "companion_request_failed",
        502,
        failureEffect,
        requestRef,
      );
    }
  }
  async function responses(
    token: string,
    raw: Uint8Array,
    controller: AbortController,
    diagnostic?: RelayDiagnostic,
    companion?: ReviewCompanionDispatchContextV1,
    reviewerId?: string,
  ): Promise<
    NativeResponse & {
      readonly usageIdentity?: UsageIdentity;
      readonly maxResponseBytes?: number;
    }
  > {
    if (raw.byteLength > policy.ingressBytes)
      throw new RelayFailure("invalid_request", 400);
    const bytes = new Uint8Array(raw); // Capture caller-owned bytes before any await.
    const finish = reserve();
    try {
      const auth = await resolve(token, "full", reviewerId);
      const lane = selected(auth, reviewerId);
      const session = await sessionFor(auth, reviewerId);
      const { snapshot, gateway } = lane;
      if (
        companion &&
        snapshot.snapshotVersion === 4 &&
        reviewerId !== snapshot.primaryReviewerId
      )
        throw new RelayFailure("companion_reviewer_invalid", 403);
      const configuration = parseReviewConfigurationStrict(
        JSON.parse(snapshot.configurationCanonicalJson),
      );
      const provider = configuration.providers[lane.providerIndex];
      if (provider?.authMode !== "codex_account_gateway" || !gateway.limits)
        throw new RelayFailure("gateway_unavailable", 403);
      const qualified = policy.profiles.filter(
        (entry) => entry.profile.profileId === gateway.profileRef,
      );
      if (
        qualified.length !== 1 ||
        qualified[0]!.profile.protocol !== "openai-responses" ||
        !gatewayProfileAcceptsRequestedModel(
          qualified[0]!.profile,
          provider.model,
        ) ||
        gateway.limits.tokens > qualified[0]!.outputTokens
      )
        throw new RelayFailure("gateway_unavailable", 403);
      if (gateway.limits.outputBytes > reviewRunGatewayMaxResponseBytes)
        throw new RelayFailure("gateway_unavailable", 403);
      const capability = snapshot.lifecycleVerificationCapability;
      if (companion && (!capability || !input.companionDispatches))
        throw new RelayFailure("companion_unavailable", 403);
      const body = prepareReviewRunGatewayResponses(
        bytes,
        provider.model,
        companion
          ? Math.min(
              4096,
              gateway.limits.tokens,
              qualified[0]!.outputTokens,
              capability!.maxOutputTokens,
            )
          : gateway.limits.tokens,
        Math.min(
          policy.ingressBytes,
          gateway.limits.requestBytes,
          companion ? capability!.maxPromptBytes : Infinity,
        ),
        qualified[0]!.outputTokens,
      );
      if (companion && !Buffer.from(body).equals(Buffer.from(bytes)))
        throw new RelayFailure("envelope_not_normalized", 400);
      if (companion) {
        const envelope = JSON.parse(new TextDecoder().decode(body)) as Record<
          string,
          unknown
        >;
        if (
          (envelope.tools !== undefined &&
            (!Array.isArray(envelope.tools) || envelope.tools.length !== 0)) ||
          (envelope.tool_choice !== undefined &&
            envelope.tool_choice !== "none")
        )
          throw new RelayFailure("companion_tools_forbidden", 400);
      }
      if (companion && session.deadline - Date.now() < capability!.deadlineMs)
        throw new RelayFailure("verification_deadline", 409);
      const claim = companion
        ? await input.companionDispatches!.claim(
            auth,
            companion,
            createHash("sha256").update(body).digest("hex"),
          )
        : undefined;
      const refuseBeforeForward = async (
        failure: RelayFailure,
      ): Promise<never> => {
        if (claim?.status === "claimed") {
          // This newly reserved native ref has not reached the SDK request
          // call. Keep the one-attempt reservation; only record proven absence.
          try {
            await input.companionDispatches!.settle(
              auth.authorizationId,
              claim.dispatch.dispatchId,
              "not_dispatched",
            );
          } catch {
            throw new RelayFailure(
              "companion_settlement_failed",
              502,
              "effect_unknown",
              claim.dispatch.nativeRequestRef,
            );
          }
          throw new RelayFailure(
            failure.code,
            failure.statusCode,
            "not_dispatched",
            claim.dispatch.nativeRequestRef,
          );
        }
        throw failure;
      };
      if (
        claim?.status === "claimed" &&
        claim.dispatch.role === "pr_description"
      ) {
        const envelope = JSON.parse(new TextDecoder().decode(body)) as Record<
          string,
          unknown
        >;
        if (
          body.byteLength > prDescriptionContract.maxPromptBytes ||
          Number(envelope.max_output_tokens) >
            prDescriptionContract.maxOutputTokens
        )
          return await refuseBeforeForward(
            new RelayFailure("pr_description_envelope_bounds_invalid", 400),
          );
      }
      if (claim?.status === "restored")
        throw new RelayFailure(
          "companion_dispatch_already_claimed",
          409,
          companionEffect(claim.dispatch),
          claim.dispatch.nativeRequestRef,
          companionReadback(claim.dispatch),
        );
      const remaining = Math.min(
        policy.requestTimeoutMs,
        session.deadline - Date.now(),
        companion ? capability!.deadlineMs : Infinity,
        claim ? claim.notAfter.getTime() - Date.now() : Infinity,
      );
      if (remaining <= 0)
        return await refuseBeforeForward(
          new RelayFailure("authorization_denied", 401),
        );
      const requestDeadline = Date.now() + remaining;
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(remaining),
      ]);
      session.aborts.set(controller, reviewerId);
      const fresh = () => check(token, auth, session, "full", reviewerId);
      try {
        if (!session.preparation.hasSession()) {
          if (session.preparation.needsRecovery())
            return await refuseBeforeForward(
              new RelayFailure(
                "same_operation_recovery_required",
                409,
                "effect_unknown",
              ),
            );
          if (diagnostic) diagnostic.stage = "prepare";
          const prepared = await session.preparation.prepare();
          try {
            await fresh();
          } catch (error) {
            if (
              error instanceof RelayFailure &&
              error.effect === "not_dispatched"
            )
              return await refuseBeforeForward(error);
            throw error;
          }
          if (prepared.status === "denied" || prepared.status === "conflict")
            return await refuseBeforeForward(
              new RelayFailure("preparation_denied", 409),
            );
          if (!session.preparation.hasSession())
            return await refuseBeforeForward(
              new RelayFailure(
                "same_operation_recovery_required",
                409,
                "effect_unknown",
              ),
            );
        }
        if (claim) {
          return await scopedResponse(
            auth,
            session,
            claim.dispatch,
            body,
            signal,
            controller,
            fresh,
            () => check(token, auth, session, "local", reviewerId),
            finish,
            Math.min(gateway.limits.outputBytes, capability!.maxResponseBytes),
            diagnostic,
            async () => {
              // Preparation/usage waits must not leave an expired/replaced lease
              // in force. This is a readback of our inserted reservation, never a
              // second owner or permission to dispatch another native ref.
              const current = await input.companionDispatches!.claim(
                auth,
                companion!,
                createHash("sha256").update(body).digest("hex"),
              );
              if (
                current.dispatch.nativeRequestRef !==
                  claim.dispatch.nativeRequestRef ||
                current.dispatch.state !== "dispatch_may_have_started"
              )
                throw new RelayFailure(
                  "companion_dispatch_no_longer_current",
                  409,
                  "effect_unknown",
                  claim.dispatch.nativeRequestRef,
                );
            },
            reviewerId,
          );
        }
        const waitUntil = Math.min(
          Date.now() + policy.waitBudgetMs,
          requestDeadline,
          session.deadline,
        );
        let waits = 0;
        for (;;) {
          let response: NativeResponse;
          let limited: c.SafeError | undefined;
          const requestRef = lane.reviewer
            ? `rr-request-${createHash("sha256").update(lane.reviewer.reviewerId).digest("hex").slice(0, 24)}-${randomUUID()}`
            : `rr-request-${randomUUID()}`;
          const usageBinding = session.preparation.usageBinding();
          let usageIdentity: UsageIdentity | void = undefined;
          if (input.usage && usageBinding) {
            usageIdentity = await input.usage.prepare({
              authorization: auth,
              executionRef: usageBinding.executionRef,
              requestRef,
              occurredAt: new Date().toISOString(),
              model: provider.model,
              ...(reviewerId === undefined ? {} : { reviewerId }),
            });
          }
          const usageOutcome = (effect: c.RequestStatus["effect"]) =>
            input.usage && usageBinding
              ? input.usage
                  .outcome({
                    authorizationId: auth.authorizationId,
                    executionRef: usageBinding.executionRef,
                    requestRef,
                    effect,
                  })
                  .catch(() => {})
              : Promise.resolve();
          try {
            if (diagnostic) diagnostic.stage = "request";
            response = await session.preparation.request(
              requestRef,
              body,
              { signal },
              fresh,
            );
            if (response.kind === "stream") {
              await usageOutcome("dispatch_started");
              try {
                if (diagnostic) diagnostic.stage = "post_request_authority";
                await fresh();
              } catch {
                await response.cancel().catch(() => {});
                throw new RelayFailure(
                  "authorization_denied",
                  401,
                  "effect_unknown",
                  requestRef,
                );
              }
              const upstream = response;
              if (diagnostic) {
                diagnostic.stage = "stream_reader";
                try {
                  diagnostic.bodyLocked = upstream.body.locked === true;
                } catch {
                  /* Observation only. */
                }
              }
              const reader = upstream.body.getReader();
              const abortStream = () => {
                dispose();
                void upstream.cancel().catch(() => {});
              };
              const dispose = () => {
                signal.removeEventListener("abort", abortStream);
                session.aborts.delete(controller);
                finish();
              };
              signal.addEventListener("abort", abortStream, { once: true });
              if (signal.aborted) {
                abortStream();
                throw new GatewayError(
                  "cancelled",
                  "effect_unknown",
                  undefined,
                  requestRef,
                );
              }
              if (diagnostic) diagnostic.stage = "stream_wrap";
              return {
                ...upstream,
                ...(usageIdentity ? { usageIdentity } : {}),
                body: new ReadableStream<Uint8Array>(
                  {
                    async pull(stream) {
                      let phase: "upstream_read" | "authority_recheck" =
                        "upstream_read";
                      try {
                        const chunk = await reader.read();
                        phase = "authority_recheck";
                        // A body chunk/EOF is not a new native admission or
                        // accepted review. Keep local authority live without
                        // withholding opaque bytes on another remote SCM read.
                        await check(token, auth, session, "local", reviewerId);
                        // SDK cancellation can resolve read() with done=true. That
                        // is transport teardown, not successful terminal delivery.
                        if (signal.aborted)
                          throw new GatewayError(
                            "cancelled",
                            "effect_unknown",
                            undefined,
                            requestRef,
                          );
                        if (chunk.done) {
                          await usageOutcome("completed");
                          dispose();
                          stream.close();
                        } else stream.enqueue(chunk.value);
                      } catch (error) {
                        const diagnostic = captureStreamFailureDiagnostic(
                          error,
                          phase,
                          signal.aborted,
                          requestRef,
                        );
                        controller.abort();
                        dispose();
                        await upstream.cancel().catch(() => {});
                        stream.error(
                          new GatewayError(
                            "transport",
                            "effect_unknown",
                            undefined,
                            requestRef,
                          ),
                        );
                        await usageOutcome("effect_unknown");
                        emitStreamFailureDiagnostic(diagnostic);
                      }
                    },
                    async cancel() {
                      await usageOutcome("effect_unknown");
                      controller.abort();
                      dispose();
                      await upstream.cancel();
                    },
                  },
                  { highWaterMark: 0 },
                ),
                cancel: async () => {
                  controller.abort();
                  dispose();
                  await upstream.cancel();
                },
              };
            }
            try {
              if (diagnostic) diagnostic.stage = "post_request_authority";
              await fresh();
            } catch {
              throw new RelayFailure(
                "authorization_denied",
                401,
                response.status.effect,
                requestRef,
              );
            }
            await usageOutcome(response.status.effect);
            if (response.status.status === "failed")
              limited = response.status.error;
            if (
              !localLimited(limited) ||
              response.status.effect !== "not_dispatched"
            ) {
              session.aborts.delete(controller);
              finish();
              return response;
            }
          } catch (error) {
            await usageOutcome(
              error instanceof GatewayError ? error.effect : "effect_unknown",
            );
            if (
              !(error instanceof GatewayError) ||
              error.code !== "safe_error" ||
              !localLimited(error.diagnostic)
            )
              throw error;
            limited = error.diagnostic;
          }
          // Only a fixed-origin LOCAL admission_limited + not_dispatched attestation.
          // Never upstream_failure/429, partial stream, pending status or ambiguity.
          await fresh();
          if (signal.aborted)
            throw new RelayFailure(
              "admission_limited",
              429,
              "not_dispatched",
              requestRef,
            );
          const milliseconds = Math.max(
            1,
            limited?.retry.kind === "after" ? limited.retry.milliseconds : 1,
          );
          if (
            waits++ >= policy.maxWaits ||
            Date.now() + milliseconds >= waitUntil
          )
            throw new RelayFailure(
              "admission_limited",
              429,
              "not_dispatched",
              requestRef,
            );
          try {
            await delay(milliseconds, undefined, { signal });
          } catch {
            throw new RelayFailure(
              "admission_limited",
              429,
              "not_dispatched",
              requestRef,
            );
          }
          await fresh(); // A new ref is confined to this SAME invocation/attempt.
        }
      } catch (error) {
        session.aborts.delete(controller);
        const failure = safeFailure(error);
        if (failure.failureScope || !lane.reviewer) throw error;
        const allocationFailure =
          !session.preparation.hasSession() ||
          /budget|exhaust|epoch|execution_(?:closed|expired|revoked)|account_revoked/.test(
            failure.code,
          );
        throw new RelayFailure(
          failure.code,
          failure.statusCode,
          failure.effect,
          failure.requestRef,
          failure.dispatch,
          allocationFailure ? "allocation" : "reviewer",
          lane.reviewer.concurrencyGroupId,
        );
      }
    } catch (error) {
      finish();
      throw error;
    }
  }
  return Object.freeze({
    policy,
    responses,
    closeRun,
    companionDispatch: (
      token: string,
      dispatchId: string,
      reviewerId?: string,
    ) =>
      bounded(async () => {
        const auth = await resolve(token, "full", reviewerId);
        const lane = selected(auth, reviewerId);
        if (
          lane.snapshot.snapshotVersion === 4 &&
          reviewerId !== lane.snapshot.primaryReviewerId
        )
          throw new RelayFailure("companion_reviewer_invalid", 403);
        const dispatch = await input.companionDispatches?.read(
          auth.authorizationId,
          dispatchId,
        );
        if (!dispatch)
          throw new RelayFailure("companion_dispatch_missing", 404);
        if (
          dispatch.state === "dispatch_may_have_started" ||
          dispatch.state === "effect_unknown"
        ) {
          const session = await sessionFor(auth, reviewerId);
          // A process restart must use the existing explicit same-operation
          // recovery endpoint first. Readback never prepares/replays inference.
          if (session.preparation.hasSession()) {
            const status = await session.preparation.status(
              dispatch.nativeRequestRef,
              { signal: AbortSignal.timeout(policy.requestTimeoutMs) },
              () => check(token, auth, session, "full", reviewerId),
            );
            if (
              status.effect === "completed" ||
              status.effect === "not_dispatched"
            ) {
              await input.companionDispatches!.settle(
                auth.authorizationId,
                dispatch.dispatchId,
                status.effect,
              );
              return companionReadback({ ...dispatch, state: status.effect });
            }
          }
        }
        return companionReadback(dispatch);
      }),
    recoverSameOperation: (token: string, reviewerId?: string) =>
      bounded(async () => {
        const auth = await resolve(token, "full", reviewerId);
        const session = await sessionFor(auth, reviewerId);
        const result = await session.preparation.recoverSameOperation();
        await check(token, auth, session, "full", reviewerId);
        return result;
      }),
    status: (token: string, requestRef: string, reviewerId?: string) =>
      bounded(async () => {
        const auth = await resolve(token, "full", reviewerId);
        const session = await sessionFor(auth, reviewerId);
        if (reviewerId !== undefined) {
          const prefix = `rr-request-${createHash("sha256").update(reviewerId).digest("hex").slice(0, 24)}-`;
          const binding = session.preparation.usageBinding();
          if (
            !requestRef.startsWith(prefix) ||
            (binding &&
              (!input.usage?.ownsRequest ||
                !(await input.usage.ownsRequest({
                  authorizationId: auth.authorizationId,
                  executionRef: binding.executionRef,
                  requestRef,
                  reviewerId,
                }))))
          )
            throw new RelayFailure("request_reviewer_mismatch", 403);
        }
        if (!session.preparation.hasSession())
          throw new RelayFailure(
            "same_operation_recovery_required",
            409,
            "effect_unknown",
            requestRef,
          );
        return await session.preparation.status(
          requestRef,
          { signal: AbortSignal.timeout(policy.requestTimeoutMs) },
          () => check(token, auth, session, "full", reviewerId),
        );
      }),
    close: async (
      token: string,
      reason: c.Close["reason"],
      reviewerId?: string,
    ) => {
      // Cancellation remains available while Responses is occupied, but its
      // authority preflight must not create unbounded SCM/database work.
      if (closeAuthorityInFlight >= policy.maxInFlight)
        throw new RelayFailure("relay_saturated", 503);
      closeAuthorityInFlight++;
      try {
        const auth = await resolve(
          token,
          "full",
          reviewerId,
          reviewerId === undefined,
        );
        if (reviewerId !== undefined) {
          const lane = selected(auth, reviewerId);
          if (lane.reviewer) {
            const session = await sessionFor(auth, reviewerId);
            session.closedReviewers.add(lane.reviewer.reviewerId);
            for (const [controller, owner] of session.aborts)
              if (owner === lane.reviewer.reviewerId) controller.abort();
            return { state: "applied" as const };
          }
        }
        return await closeRun(auth.authorizationId, reason);
      } finally {
        closeAuthorityInFlight--;
      }
    },
    shutdown: async () => {
      stopping = true;
      for (const id of [
        ...new Set(
          [...sessions.values()].map((session) => session.authorizationId),
        ),
      ])
        await closeRun(id, "cancelled").catch(() => {});
    },
  });
}
function localLimited(error: c.SafeError | undefined) {
  return (
    error?.code === "admission_limited" &&
    error.effect === "not_dispatched" &&
    error.retry.kind === "after"
  );
}
function companionEffect(
  dispatch: ReviewRunCompanionDispatch,
): c.RequestStatus["effect"] {
  return dispatch.state === "completed"
    ? "completed"
    : dispatch.state === "not_dispatched"
      ? "not_dispatched"
      : "effect_unknown";
}
function companionReadback(dispatch: ReviewRunCompanionDispatch) {
  return {
    dispatchId: dispatch.dispatchId,
    state: dispatch.state,
    requestRef: dispatch.nativeRequestRef,
    providerRequestEnvelopeHash: dispatch.providerRequestEnvelopeHash,
  };
}
/** No header defaults or partial envelopes: engine children carry none of these
 * parent-only facts and cannot turn ordinary traffic into companion evidence. */
function companionContext(
  request: FastifyRequest,
): ReviewCompanionDispatchContextV1 | undefined {
  const names = lifecycleVerificationContract.dispatchHeaders;
  if (!Object.values(names).some((name) => request.headers[name] !== undefined))
    return undefined;
  const values = Object.fromEntries(
    Object.entries(names).map(([key, name]) => {
      const value = request.headers[name];
      if (
        typeof value !== "string" ||
        value.length === 0 ||
        value.length > (key === "leaseCapability" ? 16384 : 256)
      )
        throw new RelayFailure("companion_headers_invalid", 400);
      return [key, value];
    }),
  );
  if (
    values.attemptOrdinal !== "1" ||
    !/^[1-9][0-9]{0,19}$/.test(values.fencingToken!) ||
    !/^[a-f0-9]{64}$/.test(values.preparedManifestKey!)
  )
    throw new RelayFailure("companion_headers_invalid", 400);
  for (const key of ["dispatchId", "executionId", "workSlotId", "leaseId"])
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(values[key]!))
      throw new RelayFailure("companion_headers_invalid", 400);
  return { ...values, attemptOrdinal: 1 } as ReviewCompanionDispatchContextV1;
}
export type ReviewRunGatewayRelay = ReturnType<
  typeof createReviewRunGatewayRelay
>;
export async function registerReviewRunGatewayRelayRoutes(
  app: FastifyInstance,
  relay: ReviewRunGatewayRelay,
) {
  const activeIngress = new Set<() => void>();
  let stopping = false;
  await app.register(async (scope) => {
    type Reservation = {
      controller: AbortController;
      working: boolean;
      begin: () => void;
      finish: () => void;
    };
    const reservations = new WeakMap<FastifyRequest, Reservation>();
    // Encapsulation retains raw bytes for duplicate-name/UTF-8 validation.
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: relay.policy.ingressBytes },
      (_request, body, done) => done(null, body),
    );
    scope.addHook("onResponse", async (request) => {
      const reservation = reservations.get(request);
      if (reservation && !reservation.working) reservation.finish();
    });
    scope.setErrorHandler((_error, request, reply) => {
      reservations.get(request)?.finish();
      reply
        .code(400)
        .send({ error: { code: "invalid_request", effect: "not_dispatched" } });
    });
    const base = "/api/action/v2/account-gateway";
    scope.post(
      `${base}/responses`,
      {
        bodyLimit: relay.policy.ingressBytes,
        onRequest: async (request, reply) => {
          // Separate from the existing dispatch/status/recovery budget. At most
          // maxInFlight Responses requests may enter the buffer parser, each
          // limited to ingressBytes and requestTimeoutMs to finish reading.
          // Hold the reservation through handler cleanup as well. These are
          // configured ingestion bounds, not measured process-memory caps.
          if (stopping || activeIngress.size >= relay.policy.maxInFlight)
            return reply
              .code(503)
              .header("connection", "close")
              .send({
                error: { code: "relay_saturated", effect: "not_dispatched" },
              });
          const controller = new AbortController();
          let finished = false;
          const cancel = () => {
            // ServerResponse also emits close after normal EOF. Aborting that
            // completed write races pipeline's completion and invents failure.
            if (!reply.raw.writableFinished) controller.abort();
            if (!reservation.working) reservation.finish();
          };
          const stop = () => {
            controller.abort();
            // Terminate the parser's input, not just the outgoing response.
            request.raw.destroy();
            reply.raw.destroy();
            reservation.finish();
          };
          const bodyTimer = setTimeout(stop, relay.policy.requestTimeoutMs);
          const reservation: Reservation = {
            controller,
            working: false,
            begin: () => {
              reservation.working = true;
              clearTimeout(bodyTimer);
            },
            finish: () => {
              if (finished) return;
              finished = true;
              clearTimeout(bodyTimer);
              request.raw.removeListener("aborted", cancel);
              reply.raw.removeListener("close", cancel);
              activeIngress.delete(stop);
            },
          };
          reservations.set(request, reservation);
          activeIngress.add(stop);
          request.raw.once("aborted", cancel);
          reply.raw.once("close", cancel);
          if (request.raw.aborted || reply.raw.destroyed) cancel();
        },
      },
      async (request, reply) => {
        const reservation = reservations.get(request)!;
        reservation.begin();
        const controller = reservation.controller;
        const abort = () => controller.abort();
        // Preserve the existing dispatch/stream timeout after body ingestion.
        const timer = setTimeout(abort, relay.policy.requestTimeoutMs);
        let upstream:
          | (NativeResponse & {
              readonly usageIdentity?: UsageIdentity;
              readonly maxResponseBytes?: number;
            })
          | undefined;
        const diagnostic: RelayDiagnostic = {
          stage: "resolve",
          bodyLocked: false,
        };
        try {
          if (controller.signal.aborted || !Buffer.isBuffer(request.body))
            throw new RelayFailure("invalid_request", 400);
          upstream = await relay.responses(
            authorization(request),
            request.body,
            controller,
            diagnostic,
            companionContext(request),
            reviewerSelector(request),
          );
          if (upstream.kind === "status")
            return reply.code(202).send(upstream.status);
          diagnostic.stage = "http_headers";
          try {
            diagnostic.bodyLocked = upstream.body.locked === true;
          } catch {
            /* Observation only. */
          }
          reply.hijack();
          reply.raw.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            "x-reviewrouter-request-ref": upstream.requestRef,
            ...(upstream.usageIdentity
              ? {
                  "x-reviewrouter-usage-receipt": gatewayUsageReceipt(
                    upstream.usageIdentity,
                  ),
                }
              : {}),
          });
          const reader = upstream.body.getReader();
          const terminalGate = createReviewRunGatewayTerminalGate(
            upstream.maxResponseBytes ?? reviewRunGatewayMaxResponseBytes,
          );
          const source = Readable.from(
            (async function* () {
              try {
                for (;;) {
                  const chunk = await reader.read();
                  if (chunk.done) {
                    for (const bytes of terminalGate.finish()) yield bytes;
                    return;
                  }
                  for (const bytes of terminalGate.push(chunk.value))
                    yield bytes;
                }
              } finally {
                reader.releaseLock();
              }
            })(),
          );
          await pipeline(source, reply.raw, { signal: controller.signal });
        } catch (error) {
          diagnoseUnknown(
            error,
            "responses",
            reply.raw.headersSent,
            diagnostic,
          );
          if (reply.raw.headersSent) reply.raw.destroy();
          else {
            const failure = safeFailure(error);
            reply.code(failure.statusCode).send({
              error: {
                code: failure.code,
                effect: failure.effect,
                ...(failure.failureScope
                  ? { failureScope: failure.failureScope }
                  : {}),
                ...(failure.concurrencyGroupId
                  ? { concurrencyGroupId: failure.concurrencyGroupId }
                  : {}),
                ...(failure.requestRef
                  ? { requestRef: failure.requestRef }
                  : {}),
                ...(failure.dispatch ? { dispatch: failure.dispatch } : {}),
              },
            });
          }
        } finally {
          controller.abort();
          clearTimeout(timer);
          try {
            if (upstream?.kind === "stream")
              await upstream.cancel().catch(() => {});
          } finally {
            reservation.finish();
          }
        }
      },
    );
    scope.get(
      `${base}/companion-dispatch/:dispatchId`,
      async (request, reply) => {
        try {
          const { dispatchId } = request.params as { dispatchId: string };
          return await relay.companionDispatch(
            authorization(request),
            c.reference.parse(dispatchId),
            reviewerSelector(request),
          );
        } catch (error) {
          const failure = safeFailure(error);
          return reply
            .code(failure.statusCode)
            .send({ error: { code: failure.code, effect: failure.effect } });
        }
      },
    );
    scope.get(`${base}/requests/:requestRef`, async (request, reply) => {
      try {
        const { requestRef } = request.params as { requestRef: string };
        return await relay.status(
          authorization(request),
          c.reference.parse(requestRef),
          reviewerSelector(request),
        );
      } catch (error) {
        diagnoseUnknown(error, "status", reply.raw.headersSent);
        const failure = safeFailure(error);
        return reply.code(failure.statusCode).send({
          error: {
            code: failure.code,
            effect: failure.effect,
            ...(failure.failureScope
              ? { failureScope: failure.failureScope }
              : {}),
            ...(failure.concurrencyGroupId
              ? { concurrencyGroupId: failure.concurrencyGroupId }
              : {}),
          },
        });
      }
    });
    scope.post(`${base}/recover`, async (request, reply) => {
      try {
        return await relay.recoverSameOperation(
          authorization(request),
          reviewerSelector(request),
        );
      } catch (error) {
        diagnoseUnknown(error, "recover", reply.raw.headersSent);
        const failure = safeFailure(error);
        return reply.code(failure.statusCode).send({
          error: {
            code: failure.code,
            effect: failure.effect,
            ...(failure.failureScope
              ? { failureScope: failure.failureScope }
              : {}),
            ...(failure.concurrencyGroupId
              ? { concurrencyGroupId: failure.concurrencyGroupId }
              : {}),
          },
        });
      }
    });
    scope.post(`${base}/close`, async (request, reply) => {
      try {
        const body = Buffer.isBuffer(request.body)
          ? JSON.parse(request.body.toString("utf8"))
          : null;
        const { reason } = z
          .strictObject({
            reason: z.enum(["completed", "cancelled", "failed"]),
          })
          .parse(body);
        return await relay.close(
          authorization(request),
          reason,
          reviewerSelector(request),
        );
      } catch (error) {
        diagnoseUnknown(error, "close", reply.raw.headersSent);
        const failure = safeFailure(error);
        return reply.code(failure.statusCode).send({
          error: {
            code: failure.code,
            effect: failure.effect,
            ...(failure.failureScope
              ? { failureScope: failure.failureScope }
              : {}),
            ...(failure.concurrencyGroupId
              ? { concurrencyGroupId: failure.concurrencyGroupId }
              : {}),
          },
        });
      }
    });
  });
  // Cancel before Fastify waits for held response streams to drain.
  app.addHook("preClose", async () => {
    stopping = true;
    for (const stop of activeIngress) stop();
    await relay.shutdown();
  });
}
function authorization(request: FastifyRequest) {
  const header = request.headers.authorization;
  if (
    !header ||
    header.length > 16_384 ||
    !/^Bearer [A-Za-z0-9._~-]+$/.test(header)
  )
    throw new RelayFailure("authorization_denied", 401);
  return header.slice(7);
}
function safeFailure(error: unknown): RelayFailure {
  if (error instanceof RelayFailure) return error;
  if (error instanceof ReviewRunCompanionDispatchFailure)
    return new RelayFailure(error.code, 409);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return new RelayFailure("invalid_request", 400);
  if (error instanceof GatewayError)
    return new RelayFailure(
      error.code === "safe_error"
        ? (error.diagnostic?.code ?? "gateway_error")
        : error.code,
      error.diagnostic?.code === "admission_limited" &&
        error.effect === "not_dispatched"
        ? 429
        : error.effect === "not_dispatched"
          ? 400
          : 502,
      error.effect,
      error.requestRef,
    );
  return new RelayFailure("relay_unknown", 502, "effect_unknown");
}
function captureStreamFailureDiagnostic(
  error: unknown,
  phase: "upstream_read" | "authority_recheck",
  signalAborted: boolean,
  requestRef: string,
) {
  try {
    const object =
      error !== null && typeof error === "object" ? error : undefined;
    const code: unknown = object
      ? Object.getOwnPropertyDescriptor(object, "code")?.value
      : undefined;
    const sdkCode =
      typeof code === "string" &&
      [
        "invalid_input",
        "transport",
        "invalid_response",
        "cancelled",
        "safe_error",
      ].includes(code)
        ? code
        : undefined;
    const status: unknown = object
      ? (Object.getOwnPropertyDescriptor(object, "status")?.value ??
        Object.getOwnPropertyDescriptor(object, "statusCode")?.value)
      : undefined;
    const message: unknown = object
      ? Object.getOwnPropertyDescriptor(object, "message")?.value
      : undefined;
    return {
      event: "review_run_gateway_stream_failure",
      stage: phase,
      signalAborted,
      requestRef,
      rateLimitMessageObserved:
        typeof message === "string" &&
        /API rate limit exceeded|secondary rate limit/i.test(message),
      errorCategory:
        error instanceof TypeError
          ? "TypeError"
          : error instanceof RangeError
            ? "RangeError"
            : error instanceof Error
              ? "Error"
              : "other",
      ...(typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
        ? { httpStatus: status }
        : {}),
      ...(sdkCode === undefined ? {} : { sdkCode }),
    };
  } catch {
    return undefined;
  }
}
function emitStreamFailureDiagnostic(
  diagnostic: ReturnType<typeof captureStreamFailureDiagnostic>,
) {
  if (!diagnostic) return;
  try {
    console.error(diagnostic);
  } catch {
    /* Diagnostics cannot replace stream failure or cleanup. */
  }
}
function diagnoseUnknown(
  error: unknown,
  route: "responses" | "status" | "recover" | "close",
  headersSent: boolean,
  diagnostic?: RelayDiagnostic,
) {
  try {
    if (safeFailure(error).code !== "relay_unknown") return;
    console.error({
      event: "review_run_gateway_relay_unknown",
      route,
      ...(diagnostic
        ? { stage: diagnostic.stage, bodyLocked: diagnostic.bodyLocked }
        : {}),
      errorCategory:
        error instanceof TypeError
          ? "TypeError"
          : error instanceof RangeError
            ? "RangeError"
            : error instanceof Error
              ? "Error"
              : "other",
      localGatewayErrorInstance: error instanceof GatewayError,
      gatewayConstructorNameBoolean:
        error instanceof Error && error.constructor.name === "GatewayError",
      headersSent,
    });
  } catch {
    /* Diagnostics cannot replace the original failure or cleanup. */
  }
}

/** Keep the raw terminal frame private until the same SDK stream has reached
 * EOF and acknowledged closure. Earlier frames remain streamed unchanged. */
export function createReviewRunGatewayTerminalGate(maximumBytes: number) {
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > reviewRunGatewayMaxResponseBytes
  )
    throw new GatewayError("invalid_response", "effect_unknown");
  let pending = Buffer.alloc(0),
    scan = 0,
    line = 0,
    heldBytes = 0,
    finished = false;
  let held: Uint8Array[] | undefined;
  const bounded = (size: number) => {
    if (size > maximumBytes)
      throw new GatewayError("invalid_response", "effect_unknown");
  };
  const terminal = (frame: Uint8Array): boolean => {
    try {
      const data = new TextDecoder("utf-8", { fatal: true })
        .decode(frame)
        .split(/\r\n|\n|\r/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data === "[DONE]") return true;
      const event: unknown = JSON.parse(data);
      return (
        event !== null &&
        typeof event === "object" &&
        !Array.isArray(event) &&
        [
          "response.completed",
          "response.failed",
          "response.incomplete",
          "error",
        ].includes(String((event as Record<string, unknown>).type))
      );
    } catch {
      return false;
    }
  };
  return {
    push(bytes: Uint8Array): readonly Uint8Array[] {
      if (finished)
        throw new GatewayError("invalid_response", "effect_unknown");
      if (bytes.byteLength === 0) return [];
      if (held) {
        bounded(heldBytes + bytes.byteLength);
        // Bound bookkeeping as well as retained bytes for fragmented tails.
        if (held.length >= 64) held = [Buffer.concat(held)];
        held.push(Buffer.from(bytes));
        heldBytes += bytes.byteLength;
        return [];
      }
      bounded(pending.byteLength + bytes.byteLength);
      pending = Buffer.concat([pending, bytes]);
      const ready: Uint8Array[] = [];
      while (scan < pending.length) {
        const byte = pending[scan];
        if (byte !== 10 && byte !== 13) {
          scan++;
          continue;
        }
        // A trailing CR may be the first half of a split CRLF.
        if (byte === 13 && scan + 1 === pending.length) break;
        const width = byte === 13 && pending[scan + 1] === 10 ? 2 : 1;
        if (scan !== line) {
          scan += width;
          line = scan;
          continue;
        }
        const end = scan + width,
          frame = pending.subarray(0, end);
        pending = pending.subarray(end);
        scan = 0;
        line = 0;
        if (terminal(frame)) {
          heldBytes = frame.byteLength + pending.byteLength;
          bounded(heldBytes);
          held = pending.length ? [frame, pending] : [frame];
          pending = Buffer.alloc(0);
          break;
        }
        ready.push(frame);
      }
      return ready;
    },
    finish(): readonly Uint8Array[] {
      if (finished) return [];
      finished = true;
      const ready = held ?? (pending.length ? [pending] : []);
      pending = Buffer.alloc(0);
      held = undefined;
      return ready;
    },
  };
}

/** Decode complete JSON once, retaining user/tool data. Scan BEFORE JSON.parse
 * to reject duplicate decoded keys, critical aliases, deep/unbounded structure. */
export function prepareReviewRunGatewayResponses(
  raw: Uint8Array,
  model: string,
  tokens: number,
  maximum: number,
  qualifiedTokens: number,
) {
  try {
    if (raw.byteLength > maximum) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const critical = new Set([
      "model",
      "stream",
      "store",
      "previous_response_id",
      "service_tier",
      "max_output_tokens",
      "reasoning",
    ]);
    let at = 0;
    const space = () => {
      while (/[\x20\t\r\n]/.test(text[at] ?? "!")) at++;
    };
    function string(): string {
      const start = at++;
      while (at < text.length) {
        const char = text[at++];
        if (char === "\\") at++;
        else if (char === '"')
          return JSON.parse(text.slice(start, at)) as string;
      }
      throw new Error();
    }
    function value(depth: number): void {
      if (depth > 64) throw new Error();
      space();
      if (text[at] === '"') {
        string();
        return;
      }
      if (text[at] === "{" || text[at] === "[") {
        const object = text[at++] === "{";
        const end = object ? "}" : "]";
        const keys = new Set<string>();
        space();
        if (text[at] === end) {
          at++;
          return;
        }
        for (;;) {
          if (object) {
            space();
            if (text[at] !== '"') throw new Error();
            const key = string();
            const normalized = key.normalize("NFKC").toLowerCase();
            if (
              keys.has(key) ||
              (depth === 0 && critical.has(normalized) && normalized !== key)
            )
              throw new Error();
            keys.add(key);
            space();
            if (text[at++] !== ":") throw new Error();
          }
          value(depth + 1);
          space();
          if (text[at] === end) {
            at++;
            return;
          }
          if (text[at++] !== ",") throw new Error();
        }
      }
      const match =
        /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
          text.slice(at),
        );
      if (!match) throw new Error();
      at += match[0].length;
    }
    value(0);
    space();
    if (at !== text.length) throw new Error();
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    const payload = body as Record<string, unknown>;
    if (
      (payload.model !== undefined && payload.model !== model) ||
      (payload.stream !== undefined && payload.stream !== true) ||
      (payload.store !== undefined && payload.store !== false) ||
      (payload.service_tier !== undefined &&
        payload.service_tier !== "default") ||
      "previous_response_id" in payload
    )
      throw new Error();
    const cap = payload.max_output_tokens;
    if (
      cap !== undefined &&
      (typeof cap !== "number" ||
        !Number.isSafeInteger(cap) ||
        cap < 1 ||
        cap > qualifiedTokens)
    )
      throw new Error();
    // Codex serializes an absent optional reasoning value as JSON null.
    // Normalize only that semantic absence; configured reasoning stays intact.
    if (payload.reasoning === null) delete payload.reasoning;
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        ...payload,
        model,
        stream: true,
        store: false,
        service_tier: "default",
        max_output_tokens:
          typeof cap === "number" ? Math.min(cap, tokens) : tokens,
      }),
    );
    if (bytes.byteLength > maximum) throw new Error();
    return bytes;
  } catch {
    throw new RelayFailure("invalid_request", 400);
  }
}

function reviewerSelector(request: FastifyRequest): string | undefined {
  const name = reviewerPlanContract.reviewerIdHeader;
  const value = request.headers[name];
  let count = 0;
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2)
    if (request.raw.rawHeaders[index]!.toLowerCase() === name) count++;
  if (value === undefined && count === 0) return undefined;
  if (count !== 1) throw new RelayFailure("reviewer_selector_invalid", 400);
  try {
    return parseReviewReviewerId(value);
  } catch {
    throw new RelayFailure("reviewer_selector_invalid", 400);
  }
}
