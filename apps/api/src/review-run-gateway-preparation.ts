import * as c from "@agent-teams/account-gateway/contracts";
import {
  createExecutionClient,
  GatewayError,
  type CallOptions,
  type ExecutionClient,
  type NativeResponse,
} from "@agent-teams/account-gateway/http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalJson,
  parseReviewRunGatewayExecutionBinding,
  parseReviewRunRuntimeSnapshot,
  reviewRunGatewayEpochMatches,
  reviewRunGatewayOwnedIdentity,
  type ReviewRunAuthorizationQueryPort,
  type ReviewRunGatewayExecutionBinding,
  type ReviewRunGatewayExecutionBindingPort,
  type ReviewRunRuntimeSnapshotPort,
  type VerifiedScmRunIdentity,
} from "@reviewrouter/features-review-run-control";
import {
  reviewRunGatewayMaxResponseBytes,
  reviewRunGatewayMaxChunkBytes,
  type RunAccessConfig,
  type PreparedRunAccess,
} from "./account-gateway-run-access";

export type ReviewRunGatewayPreparationResult =
  | { readonly status: "denied" | "conflict" }
  | {
      readonly status: "prepared" | "restored";
      readonly binding: ReviewRunGatewayExecutionBinding;
    };

/** Backend-only composition for ONE already authorized owned run. The caller
 * supplies verified identity, never limits/profile/epoch/operation or credentials.
 * No transport/capability is returned through the safe selected-facts result. */
export function createReviewRunGatewayPreparation(input: {
  readonly authorizationId: string;
  readonly allocationId?: string;
  readonly readPreparationOperation?: (
    operationId: string,
    options: CallOptions,
  ) => Promise<c.Operation | undefined>;
  readonly identity: VerifiedScmRunIdentity;
  readonly runAccess: RunAccessConfig;
  readonly authorizations: ReviewRunAuthorizationQueryPort;
  readonly snapshots: ReviewRunRuntimeSnapshotPort;
  readonly bindings: ReviewRunGatewayExecutionBindingPort;
}) {
  const authorizationId = input.authorizationId;
  const allocationId = input.allocationId;
  const identity = reviewRunGatewayOwnedIdentity(input.identity);
  const authorizations = input.authorizations;
  const snapshots = input.snapshots;
  const bindings = input.bindings;
  const prepareAccess = privateRunAccess(input.runAccess);
  let session:
    | {
        readonly client: ExecutionClient;
        readonly admission: c.Admission;
        readonly binding: ReviewRunGatewayExecutionBinding;
        readonly canonical: string;
        attached: boolean;
      }
    | undefined;
  let closed = false;
  let closeReason: c.Close["reason"] | undefined;
  let initialAttempted = false;
  let noExecutionProven = false;
  let inFlight = false;
  let pending: Promise<ReviewRunGatewayPreparationResult> | undefined;

  type ClosePhase =
    | "prepare_wait"
    | "recovery"
    | "remote_close"
    | "binding_cleanup";
  type CloseCategory =
    | "invalid_input"
    | "transport"
    | "invalid_response"
    | "cancelled"
    | "safe_error"
    | "other"
    | "no_capability"
    | "pending"
    | "rejected"
    | "unknown";
  const observedCloseFailures = new Set<string>();
  function observeClose(
    phase: ClosePhase,
    category: CloseCategory,
    detail?: { kind: "operation" | "exception"; value: unknown },
  ) {
    try {
      const key = `${phase}:${category}`;
      if (observedCloseFailures.has(key)) return;
      const fields: Record<string, string | number> = { phase, category };
      if (detail?.kind === "operation") {
        const operation = detail.value as {
          error?: { code?: unknown; effect?: unknown };
        };
        const diagnostic = operation.error;
        const code = c.errorCode.safeParse(diagnostic?.code);
        const effect = c.effectState.safeParse(diagnostic?.effect);
        fields.code = code.success ? code.data : "unknown";
        fields.effect = effect.success ? effect.data : "unknown";
      } else if (
        detail?.kind === "exception" &&
        detail.value instanceof GatewayError
      ) {
        const error = detail.value;
        const diagnostic = error.diagnostic;
        const code = c.errorCode.safeParse(diagnostic?.code);
        const effect = c.effectState.safeParse(diagnostic?.effect);
        fields.code = code.success ? code.data : "unknown";
        fields.effect = effect.success ? effect.data : "unknown";
        const status: unknown = error.httpStatus;
        fields.httpStatus =
          typeof status === "number" &&
          Number.isInteger(status) &&
          status >= 100 &&
          status <= 599
            ? status
            : "unknown";
      }
      console.warn("review_run_gateway_close_diagnostic", fields);
      observedCloseFailures.add(key);
    } catch {
      // Observability cannot alter custody or close behavior.
    }
  }
  function classifyCloseError(error: unknown): CloseCategory {
    try {
      if (error instanceof GatewayError) {
        const code = error.code;
        switch (code) {
          case "invalid_input":
          case "transport":
          case "invalid_response":
          case "cancelled":
          case "safe_error":
            return code;
        }
      }
    } catch {
      // Unexpected error accessors are not safe to log.
    }
    return "other";
  }

  async function run(
    recovery: boolean,
  ): Promise<ReviewRunGatewayPreparationResult> {
    if (inFlight) return { status: "denied" };
    inFlight = true;
    try {
      if (closed || noExecutionProven) return { status: "denied" };
      const authorization =
        await authorizations.findReviewRunAuthorizationById(authorizationId);
      if (
        !authorization ||
        authorization.state !== "active" ||
        !Object.entries(identity).every(
          ([key, value]) => Reflect.get(authorization, key) === value,
        )
      )
        return { status: "denied" };
      const canonical = authorization.runtimeSnapshotCanonicalJson;
      const snapshot = parseReviewRunRuntimeSnapshot(canonical);
      const original =
        snapshot?.snapshotVersion === 4
          ? allocationId === undefined
            ? undefined
            : snapshot.allocations.find(
                (row) => row.allocationId === allocationId,
              )
          : allocationId === undefined
            ? snapshot?.gateway
            : undefined;
      if (
        !canonical ||
        !snapshot ||
        !original?.limits ||
        authorization.maxExpiresAt.toISOString() !== snapshot.deadline
      )
        return { status: "denied" };
      // The SDK is the authoritative Prepare boundary. Parse/copy the COMPLETE
      // pinned intent before awaiting live authority; never read current policy.
      const intent = c.prepare.parse({
        operationId: original.operationId,
        invocationRef: original.invocationId,
        attemptRef: original.attemptId,
        accountRefs: [original.permittedAccountRef],
        subjectRef: original.policySubject,
        policyRevision: original.policyRevision,
        bindingRevision: original.bindingRevision,
        profileId: original.profileRef,
        limits: { ...original.limits },
        deadline: snapshot.deadline,
      });
      Object.freeze(intent.accountRefs);
      Object.freeze(intent.limits);
      Object.freeze(intent);
      const cutoff = Math.min(
        authorization.expiresAt.getTime(),
        Date.parse(intent.deadline),
      );
      const live = () => Date.now() < cutoff;
      if (!live()) return { status: "denied" };
      const owner = {
        authorizationId,
        ...(allocationId === undefined ? {} : { allocationId }),
        identity,
        runtimeSnapshotCanonicalJson: canonical,
      };
      const saved = await bindings.read(owner);
      if (!live() || saved.status !== "live") return { status: "denied" };
      // Ordinary restore is a private SQL read. Reacquiring run access after a
      // lost HTTP/attachment requires the explicit same-operation entry point.
      if (
        saved.binding &&
        !reviewRunGatewayEpochMatches(
          snapshot,
          saved.binding.authorizationEpoch,
          allocationId,
        )
      )
        return { status: "denied" };
      if (saved.binding && (!recovery || session?.attached))
        return { status: "restored", binding: saved.binding };
      if (!recovery && initialAttempted) return { status: "denied" };
      if (
        !(await snapshots.isLive({ snapshot, identity, now: new Date() })) ||
        (snapshot.snapshotVersion === 4 &&
          !(await snapshots.isAllocationLive?.({
            snapshot,
            allocationId: allocationId!,
            identity,
            now: new Date(),
          }))) ||
        !live()
      )
        return { status: "denied" };
      const remaining = cutoff - Date.now();
      if (remaining <= 0) return { status: "denied" };
      const firstAttempt = !initialAttempted && !recovery && !saved.binding;
      initialAttempted = true;
      // One no-retry HTTP call. Never erase an earlier uncertain Prepare.
      let prepared: PreparedRunAccess;
      try {
        prepared = await prepareAccess(intent, {
          signal: AbortSignal.timeout(Math.min(remaining, 2_147_483_647)),
        });
      } catch (error) {
        const refusal =
          error instanceof GatewayError ? error.diagnostic : undefined;
        // Only the matching quota-admission rollback attests no allocation was
        // created. Generic non-dispatch, missing identity and transport failures
        // cannot release an execution capability or justify another Prepare.
        noExecutionProven =
          firstAttempt &&
          !session &&
          error instanceof GatewayError &&
          error.code === "safe_error" &&
          error.httpStatus === 503 &&
          error.effect === "not_dispatched" &&
          error.operationRef === intent.operationId &&
          refusal?.operationRef === intent.operationId &&
          refusal.code === "admission_limited" &&
          refusal.effect === "not_dispatched" &&
          refusal.retry.kind === "after";
        throw error;
      }
      const operation = c.preparationOperation.parse(prepared.operation);
      if (
        operation.state !== "applied" ||
        operation.result?.kind !== "execution" ||
        operation.operationRef !== intent.operationId ||
        operation.result.state !== "active"
      )
        throw new Error("review_run_gateway_result_invalid");
      const selected = operation.result;
      const admission = c.admission.parse(prepared.admission);
      const expectedAdmission = c.admission.parse({
        invocationRef: intent.invocationRef,
        attemptRef: intent.attemptRef,
        accountRef: selected.accountRef,
        authorizationEpoch: selected.authorizationEpoch,
        subjectRef: intent.subjectRef,
        policyRevision: intent.policyRevision,
        bindingRevision: intent.bindingRevision,
        profileId: intent.profileId,
        limits: { ...intent.limits },
        expiresAt: intent.deadline,
      });
      if (
        selected.accountRef !== original.permittedAccountRef ||
        selected.deadline !== intent.deadline ||
        prepared.executionRef !== selected.executionRef ||
        canonicalJson(admission) !== canonicalJson(expectedAdmission)
      )
        throw new Error("review_run_gateway_result_invalid");
      const binding = parseReviewRunGatewayExecutionBinding(
        canonicalJson({
          bindingVersion: 1,
          operationId: intent.operationId,
          executionRef: selected.executionRef,
          accountRef: selected.accountRef,
          authorizationEpoch: selected.authorizationEpoch,
          deadline: intent.deadline,
        }),
      );
      if (
        saved.binding &&
        canonicalJson(saved.binding) !== canonicalJson(binding)
      )
        return { status: "conflict" };
      // Retain the validated capability for exact cleanup even if attachment or
      // authority is lost. It cannot dispatch until the SQL attachment succeeds.
      session = {
        client: prepared.client,
        admission,
        binding,
        canonical,
        attached: false,
      };
      if (
        !reviewRunGatewayEpochMatches(
          snapshot,
          selected.authorizationEpoch,
          allocationId,
        )
      ) {
        // The acquired exact capability is cleanup-only. Retain it for close,
        // but never attach, dispatch or recover another preparation for this pin.
        closed = true;
        return { status: "denied" };
      }
      if (!live() || closed) return { status: "denied" };
      // ExecutionClient and the control credential remain inside backend closures;
      // only this safe projection enters SQL. Attachment loss is caller-recovered.
      const attached = await bindings.attach(owner, binding);
      if (!live() || closed) return { status: "denied" };
      if (attached.status === "attached" || attached.status === "restored") {
        session.attached = true;
        return {
          status: attached.status === "attached" ? "prepared" : "restored",
          binding: attached.binding,
        };
      }
      return { status: attached.status };
    } finally {
      inFlight = false;
    }
  }
  async function currentSession() {
    const current = session;
    if (!current?.attached || closed)
      throw new GatewayError("invalid_input", "not_dispatched");
    const saved = await bindings.read({
      authorizationId,
      ...(allocationId === undefined ? {} : { allocationId }),
      identity,
      runtimeSnapshotCanonicalJson: current.canonical,
    });
    // The actual locked original-binding check is followed by a current row read.
    const authorization =
      await authorizations.findReviewRunAuthorizationById(authorizationId);
    if (
      closed ||
      session !== current ||
      saved.status !== "live" ||
      !saved.binding ||
      canonicalJson(saved.binding) !== canonicalJson(current.binding) ||
      !authorization ||
      authorization.state !== "active" ||
      authorization.runtimeSnapshotCanonicalJson !== current.canonical ||
      !Object.entries(identity).every(
        ([key, value]) => Reflect.get(authorization, key) === value,
      ) ||
      Date.now() >=
        Math.min(
          authorization.expiresAt.getTime(),
          Date.parse(current.binding.deadline),
        )
    )
      throw new GatewayError("invalid_input", "not_dispatched");
    return current;
  }
  function begin(recovery: boolean) {
    // Repeated calls cannot replace the handle observed by close().
    if (inFlight && pending) return pending;
    pending = run(recovery);
    return pending;
  }
  async function recoverForCleanup(
    options: CallOptions = {},
    stale?: NonNullable<typeof session>,
  ): Promise<void> {
    if ((session && session !== stale) || noExecutionProven) return;
    // The legacy snapshot is refreshable only while retaining its exact old
    // capability. An empty legacy session is not proof that no effect exists.
    if (allocationId === undefined && !stale) return;
    initialAttempted = true; // Unknown cleanup never proves absence of a physical effect.
    if (!input.readPreparationOperation || !bindings.readForCleanup) return;
    const authorization =
      await authorizations.findReviewRunAuthorizationById(authorizationId);
    if (
      !authorization ||
      !Object.entries(identity).every(
        ([key, value]) => Reflect.get(authorization, key) === value,
      )
    )
      return;
    const canonical = authorization.runtimeSnapshotCanonicalJson;
    const snapshot = parseReviewRunRuntimeSnapshot(canonical);
    if (
      !canonical ||
      !snapshot ||
      (snapshot.snapshotVersion !== 4 && allocationId !== undefined) ||
      (snapshot.snapshotVersion === 4 && allocationId === undefined) ||
      (stale &&
        Date.now() >=
          Math.min(
            authorization.expiresAt.getTime(),
            Date.parse(snapshot.deadline),
          )) ||
      authorization.maxExpiresAt.toISOString() !== snapshot.deadline
    )
      return;
    const original =
      snapshot.snapshotVersion === 4
        ? snapshot.allocations.find((row) => row.allocationId === allocationId)
        : snapshot.gateway;
    if (!original) return;
    const owner = {
      authorizationId,
      ...(allocationId === undefined ? {} : { allocationId }),
      identity,
      runtimeSnapshotCanonicalJson: canonical,
    };
    const saved = await bindings.readForCleanup(owner);
    if (
      stale &&
      (stale.canonical !== canonical ||
        (saved && canonicalJson(saved) !== canonicalJson(stale.binding)))
    )
      return;
    // Consumer-control proves the ORIGINAL operation before any run-access call.
    // The run-control credential cannot query operations and is never widened.
    const proof = await input.readPreparationOperation(
      original.operationId,
      options,
    );
    if (!proof) return;
    const operation = c.preparationOperation.parse(proof);
    if (
      operation.operationRef !== original.operationId ||
      operation.state !== "applied" ||
      operation.result?.kind !== "execution" ||
      operation.result.accountRef !== original.permittedAccountRef ||
      operation.result.deadline !== snapshot.deadline ||
      (saved && operation.result.executionRef !== saved.executionRef) ||
      (stale && operation.result.executionRef !== stale.binding.executionRef) ||
      (stale &&
        (stale.binding.operationId !== original.operationId ||
          stale.binding.accountRef !== operation.result.accountRef ||
          stale.binding.authorizationEpoch !==
            operation.result.authorizationEpoch ||
          stale.binding.deadline !== operation.result.deadline)) ||
      !reviewRunGatewayEpochMatches(
        snapshot,
        operation.result.authorizationEpoch,
        allocationId,
      )
    )
      return;
    const intent = c.prepare.parse({
      operationId: original.operationId,
      invocationRef: original.invocationId,
      attemptRef: original.attemptId,
      accountRefs: [original.permittedAccountRef],
      subjectRef: original.policySubject,
      policyRevision: original.policyRevision,
      bindingRevision: original.bindingRevision,
      profileId: original.profileRef,
      limits: { ...original.limits },
      deadline: snapshot.deadline,
    });
    const remaining =
      Math.min(
        authorization.expiresAt.getTime(),
        Date.parse(snapshot.deadline),
      ) - Date.now();
    if (stale && (remaining <= 0 || session !== stale)) return;
    const deadlineSignal = stale
      ? AbortSignal.timeout(Math.min(remaining, 2_147_483_647))
      : undefined;
    const prepared = await prepareAccess(
      intent,
      deadlineSignal
        ? {
            ...options,
            signal: options.signal
              ? AbortSignal.any([options.signal, deadlineSignal])
              : deadlineSignal,
          }
        : options,
    );
    const restored = c.preparationOperation.parse(prepared.operation);
    if (
      restored.state !== "applied" ||
      restored.operationRef !== original.operationId ||
      restored.result?.kind !== "execution" ||
      restored.result.executionRef !== operation.result.executionRef ||
      restored.result.accountRef !== operation.result.accountRef ||
      restored.result.authorizationEpoch !==
        operation.result.authorizationEpoch ||
      restored.result.deadline !== snapshot.deadline ||
      prepared.executionRef !== restored.result.executionRef
    )
      return;
    const binding = parseReviewRunGatewayExecutionBinding(
      canonicalJson({
        bindingVersion: 1,
        operationId: original.operationId,
        executionRef: restored.result.executionRef,
        accountRef: restored.result.accountRef,
        authorizationEpoch: restored.result.authorizationEpoch,
        deadline: snapshot.deadline,
      }),
    );
    if (
      (saved && canonicalJson(saved) !== canonicalJson(binding)) ||
      (stale && canonicalJson(stale.binding) !== canonicalJson(binding)) ||
      (stale && stale.canonical !== canonical) ||
      (stale && session !== stale) ||
      (stale &&
        Date.now() >=
          Math.min(
            authorization.expiresAt.getTime(),
            Date.parse(snapshot.deadline),
          ))
    )
      return;
    const admission = c.admission.parse(prepared.admission);
    const expected = c.admission.parse({
      invocationRef: original.invocationId,
      attemptRef: original.attemptId,
      accountRef: binding.accountRef,
      authorizationEpoch: binding.authorizationEpoch,
      subjectRef: original.policySubject,
      policyRevision: original.policyRevision,
      bindingRevision: original.bindingRevision,
      profileId: original.profileRef,
      limits: { ...original.limits },
      expiresAt: snapshot.deadline,
    });
    if (canonicalJson(admission) !== canonicalJson(expected)) return;
    // Cleanup-only: never attach, reopen authority or permit a request.
    session = {
      client: prepared.client,
      admission,
      binding,
      canonical,
      attached: false,
    };
    closed = true;
  }
  return Object.freeze({
    prepare: () => begin(false),
    recoverSameOperation: () => begin(true),
    recoverForCleanup,
    // Private backend capabilities, never part of the preparation result/SQL DTO.
    hasSession: () => session?.attached === true && !closed,
    isPreparing: () => inFlight,
    // Retain uncertain Prepare custody; only no attempt or a matching rollback
    // attestation proves no execution capability needs a remote close.
    canReleaseWithoutRemoteClose: () =>
      closed &&
      !inFlight &&
      (!initialAttempted || noExecutionProven) &&
      !session,
    // Unknown preparation remains owned by its immutable authorization snapshot
    // and by Gateway's deadline/physical cleanup. Only an empty settled local
    // handle can be detached; a retained capability must still be closed.
    canDetachUnknownWithoutCapability: () =>
      closed && !inFlight && initialAttempted && !noExecutionProven && !session,
    usageBinding: () => (session?.attached ? { ...session.binding } : null),
    needsRecovery: () =>
      initialAttempted && !session?.attached && !noExecutionProven,
    request: async (
      requestRef: string,
      bytes: Uint8Array,
      options: CallOptions = {},
      check: () => Promise<void> = async () => {},
    ): Promise<NativeResponse> => {
      const body = new Uint8Array(bytes);
      const requestId = c.reference.parse(requestRef);
      const current = await currentSession();
      await check();
      if (
        closed ||
        session !== current ||
        options.signal?.aborted ||
        Date.now() >= Date.parse(current.binding.deadline)
      )
        throw new GatewayError(
          "cancelled",
          "not_dispatched",
          undefined,
          requestId,
        );
      return current.client.request(
        current.binding.executionRef,
        { requestId, admission: current.admission, body },
        options,
      );
    },
    status: async (
      requestRef: string,
      options: CallOptions = {},
      check: () => Promise<void> = async () => {},
    ) => {
      // Readback is safe after local denial/close as well: exact saved capability,
      // never another permission. The HTTP relay still requires current RR auth.
      const requestId = c.reference.parse(requestRef);
      const current = session;
      if (!current)
        throw new GatewayError(
          "invalid_response",
          "effect_unknown",
          undefined,
          requestId,
        );
      await check();
      const status = await current.client.status(
        current.binding.executionRef,
        requestId,
        options,
      );
      try {
        await check();
      } catch {
        throw new GatewayError(
          "invalid_response",
          "effect_unknown",
          undefined,
          requestId,
        );
      }
      return status;
    },
    close: async (reason: c.Close["reason"], options: CallOptions = {}) => {
      let closePhase: ClosePhase = "prepare_wait";
      try {
        closed = true; // Deny first, including in-flight preparation/dispatch.
        const firstReason = (closeReason ??= reason); // Stable ID retains first intent.
        const preparing = pending;
        if (preparing) {
          // A pressure cleanup must not wait indefinitely for an earlier prepare.
          // Its eventual capability stays retained for exact same-close cleanup.
          await new Promise<void>((resolve, reject) => {
            const finish = (error?: GatewayError) => {
              options.signal?.removeEventListener("abort", aborted);
              if (error) reject(error);
              else resolve();
            };
            const aborted = () =>
              finish(new GatewayError("cancelled", "effect_unknown"));
            if (options.signal?.aborted) {
              aborted();
              return;
            }
            options.signal?.addEventListener("abort", aborted, { once: true });
            void preparing.then(
              () => finish(),
              () => finish(),
            );
          });
        }
        closePhase = "recovery";
        if (!session && !noExecutionProven) await recoverForCleanup(options);
        const current = session;
        if (!current) {
          if (initialAttempted && !noExecutionProven)
            observeClose("recovery", "no_capability");
          return { state: "unknown" as const };
        }
        closePhase = "remote_close";
        const closeIntent = {
          operationId: `rr-close-${createHash("sha256").update(current.binding.operationId).digest("hex")}`,
          reason: firstReason,
        };
        let operation: c.Operation;
        try {
          operation = await current.client.close(
            current.binding.executionRef,
            closeIntent,
            options,
          );
        } catch (error) {
          if (
            !(error instanceof GatewayError) ||
            error.code !== "safe_error" ||
            error.httpStatus !== 401 ||
            error.effect !== "not_dispatched" ||
            error.diagnostic?.code !== "unauthenticated"
          )
            throw error;
          await recoverForCleanup(options, current);
          const refreshed = session;
          if (!refreshed || refreshed === current) throw error;
          operation = await refreshed.client.close(
            refreshed.binding.executionRef,
            closeIntent,
            options,
          );
        }
        const state = operation.state;
        if (state !== "applied") {
          const category: CloseCategory =
            state === "pending" || state === "rejected" || state === "unknown"
              ? state
              : "other";
          observeClose("remote_close", category, {
            kind: "operation",
            value: operation,
          });
        }
        closePhase = "binding_cleanup";
        if (state === "applied")
          await bindings.completeCleanup?.(
            {
              authorizationId,
              ...(allocationId === undefined ? {} : { allocationId }),
              identity,
              runtimeSnapshotCanonicalJson: current.canonical,
            },
            current.binding,
          );
        return operation;
      } catch (error) {
        observeClose(closePhase, classifyCloseError(error), {
          kind: "exception",
          value: error,
        });
        throw error;
      }
    },
  });
}

/** The old run-access adapter fixes bufferBytes at 64KiB. This private handshake
 * uses the SAME v1 schemas/envelope, configuring the existing SDK at the saved
 * approved aggregate output cap while keeping SDK chunks bounded at 1MiB.
 * Unsupported aggregate policies deny before the run-access HTTP call.
 * No control token or execution bearer leaves these closures. */
function privateRunAccess(config: RunAccessConfig) {
  const token = z
    .string()
    .min(16)
    .max(1024)
    .regex(/^[A-Za-z0-9._~-]+$/)
    .parse(config.runControlBearer);
  const timeoutMs = z
    .number()
    .int()
    .min(1)
    .max(3_600_000)
    .parse(config.timeoutMs);
  const captureOrigin = (value: string): URL => {
    if (
      typeof value !== "string" ||
      !/^https?:\/\/[^/?#@\\\s]+\/?$/.test(value)
    )
      throw new Error("review_run_gateway_config_invalid");
    const origin = new URL(value);
    if (
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          ["127.0.0.1", "[::1]", "localhost"].includes(origin.hostname)
        ))
    )
      throw new Error("review_run_gateway_config_invalid");
    return origin;
  };
  const origin = captureOrigin(config.origin);
  const configuredControlOrigin = config.controlOrigin;
  const controlOrigin =
    configuredControlOrigin === undefined
      ? undefined
      : captureOrigin(configuredControlOrigin).origin;
  const envelope = z.strictObject({
    operation: c.preparationOperation,
    bearer: z
      .string()
      .min(16)
      .max(1024)
      .regex(/^[A-Za-z0-9._~-]+$/),
    admission: c.admission,
  });
  return async (
    intent: c.Prepare,
    options: CallOptions,
  ): Promise<PreparedRunAccess> => {
    if (intent.limits.outputBytes > reviewRunGatewayMaxResponseBytes)
      throw new GatewayError(
        "invalid_input",
        "not_dispatched",
        intent.operationId,
      );
    if (options.signal?.aborted)
      throw new GatewayError("cancelled", "not_dispatched", intent.operationId);
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const raw = await new Promise<unknown>((resolve, reject) => {
        const url = new URL("/internal/v1/run-access", origin);
        const request = (
          url.protocol === "https:" ? httpsRequest : httpRequest
        )(
          url,
          {
            method: "POST",
            agent: false,
            signal,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              accept: "application/json",
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.once("close", () => {
              if (!response.complete) reject(new Error());
            });
            response.on("error", reject);
            response.on("aborted", () => reject(new Error()));
            response.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 65_536) {
                response.destroy();
                reject(new Error());
              } else chunks.push(chunk);
            });
            response.on("end", () => {
              try {
                if (
                  !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
                    response.headers["content-type"] ?? "",
                  )
                )
                  throw new Error();
                const parsed: unknown = JSON.parse(
                  new TextDecoder("utf-8", { fatal: true }).decode(
                    Buffer.concat(chunks, size),
                  ),
                );
                if (response.statusCode !== 200) {
                  const failure = c.safeError.safeParse(parsed);
                  if (
                    !response.statusCode ||
                    response.statusCode < 400 ||
                    response.statusCode > 599 ||
                    !failure.success ||
                    (failure.data.operationRef !== undefined &&
                      failure.data.operationRef !== intent.operationId)
                  )
                    throw new Error();
                  // A validated pre-admission refusal is not an uncertain
                  // model dispatch. Preserve the same safe SDK error contract.
                  throw new GatewayError(
                    "safe_error",
                    failure.data.effect,
                    intent.operationId,
                    undefined,
                    failure.data,
                    response.statusCode,
                  );
                }
                resolve(parsed);
              } catch (error) {
                reject(error);
              }
            });
          },
        );
        request.on("error", reject);
        request.end(JSON.stringify(intent));
      });
      const wire = envelope.parse(raw);
      const dataClient = createExecutionClient({
        role: "execution",
        origin: origin.origin,
        token: wire.bearer,
        timeoutMs,
        responseBytes: 65_536,
        bufferBytes: Math.min(
          reviewRunGatewayMaxChunkBytes,
          Math.max(1024, intent.limits.outputBytes),
        ),
      });
      const controlClient =
        controlOrigin === undefined
          ? dataClient
          : createExecutionClient({
              role: "execution",
              origin: controlOrigin,
              token: wire.bearer,
              timeoutMs,
              responseBytes: 65_536,
              bufferBytes: Math.min(
                reviewRunGatewayMaxChunkBytes,
                Math.max(1024, intent.limits.outputBytes),
              ),
            });
      const client: ExecutionClient =
        controlOrigin === undefined
          ? dataClient
          : Object.freeze({
              request: dataClient.request,
              status: controlClient.status,
              close: controlClient.close,
              operation: controlClient.operation,
            });
      // The full tuple/selected result is checked by run() before attachment/use.
      return Object.freeze({
        operation: wire.operation,
        admission: wire.admission,
        executionRef:
          wire.operation.state === "applied" &&
          wire.operation.result?.kind === "execution"
            ? wire.operation.result.executionRef
            : "invalid",
        client,
      });
    } catch (error) {
      if (error instanceof GatewayError) throw error;
      throw new GatewayError(
        signal.aborted ? "cancelled" : "invalid_response",
        "effect_unknown",
        intent.operationId,
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
