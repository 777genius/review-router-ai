import type { ReviewPublicationScope } from "./review-publication-attempt";

export type ResolutionThreadScope = ReviewPublicationScope & {
  readonly threadId: string;
};
/** No claim of lifetime negative history: the activation cut bounds our writers. */
export type ResolutionOperationIdentity = Readonly<{
  sourceKind: "canonical_operation" | "legacy_entry";
  operationId: string;
  reviewedHeadSha: string;
  bodyHash: string;
  publicationAttemptId?: string;
  executionId?: string;
  generation?: string;
}>;
export type PendingResolutionFact = ResolutionOperationIdentity &
  Readonly<{
    state: "entered" | "may_have_started" | "effect_unknown";
    enteredAt: string;
  }>;
export type ConfirmedResolutionFact = ResolutionOperationIdentity &
  Readonly<{
    effectId: string;
    observedAt: string;
    latestConfirmed?: ResolutionOperationIdentity &
      Readonly<{ effectId: string; observedAt: string }>;
  }>;
export type ResolutionHistoryBootstrap = Readonly<{
  qualificationSource: "retired_legacy_writers_quarantine.v1";
  executorSetHash: string;
  proofHash: string;
  retiredAt: string;
  activationCut: string;
}>;
export type ResolutionHistoryCut = Readonly<{
  activatedAt: string;
  activationVersion: number;
  writerDigest: string;
  bootstrap?: ResolutionHistoryBootstrap;
}>;
export type ResolutionHistory = Readonly<{
  threadId: string;
  version: number;
  historyCut: ResolutionHistoryCut | null;
  confirmed: ConfirmedResolutionFact | null;
  pending: readonly PendingResolutionFact[];
}>;
export type ResolutionHistoryDecision =
  | Readonly<{
      status: "eligible";
      historyStatus: "no_prior_rr_resolution" | "no_known_resolution_since_cut";
      reasonCodes: readonly string[];
    }>
  | Readonly<{
      status:
        | "own_operation_pending"
        | "own_operation_applied"
        | "already_resolved";
      reasonCodes: readonly string[];
    }>
  | Readonly<{ status: "blocked"; reasonCodes: readonly string[] }>;

export function resolutionOperationIdentity(
  value: ResolutionOperationIdentity,
): ResolutionOperationIdentity {
  return {
    sourceKind: value.sourceKind,
    operationId: value.operationId,
    reviewedHeadSha: value.reviewedHeadSha,
    bodyHash: value.bodyHash,
    ...(value.publicationAttemptId !== undefined
      ? { publicationAttemptId: value.publicationAttemptId }
      : {}),
    ...(value.executionId !== undefined
      ? { executionId: value.executionId }
      : {}),
    ...(value.generation !== undefined ? { generation: value.generation } : {}),
  };
}

/** Own progress is scoped to a single exact operation, never an aggregate watermark. */
export function sameResolutionOperation(
  left: ResolutionOperationIdentity,
  right: ResolutionOperationIdentity,
): boolean {
  return (
    left.sourceKind === "canonical_operation" &&
    right.sourceKind === "canonical_operation" &&
    left.operationId === right.operationId &&
    left.publicationAttemptId === right.publicationAttemptId &&
    left.executionId === right.executionId &&
    left.generation === right.generation &&
    left.reviewedHeadSha === right.reviewedHeadSha &&
    left.bodyHash === right.bodyHash &&
    !!left.publicationAttemptId &&
    !!left.executionId &&
    !!left.generation
  );
}

export function evaluateResolutionHistory(
  input: Readonly<{
    history: ResolutionHistory;
    parentCreatedAt: string;
    isResolved: boolean;
    ownOperation?: ResolutionOperationIdentity;
  }>,
): ResolutionHistoryDecision {
  const { history, ownOperation } = input;
  if (history.confirmed) {
    const own =
      ownOperation &&
      sameResolutionOperation(history.confirmed, ownOperation) &&
      (!history.confirmed.latestConfirmed ||
        sameResolutionOperation(
          history.confirmed.latestConfirmed,
          ownOperation,
        ));
    if (!input.isResolved) {
      return {
        status: "blocked",
        reasonCodes: ["previously_resolved_thread_reopened"],
      };
    }
    return {
      status: own ? "own_operation_applied" : "already_resolved",
      reasonCodes: [],
    };
  }
  if (history.pending.length) {
    if (
      history.pending.some(
        (fact) => !ownOperation || !sameResolutionOperation(fact, ownOperation),
      )
    ) {
      return input.isResolved
        ? { status: "already_resolved", reasonCodes: ["already_resolved"] }
        : { status: "blocked", reasonCodes: ["resolution_effect_unknown"] };
    }
    return {
      status: input.isResolved
        ? "own_operation_applied"
        : "own_operation_pending",
      reasonCodes: [],
    };
  }
  if (input.isResolved)
    return { status: "already_resolved", reasonCodes: ["already_resolved"] };
  if (!history.historyCut)
    return {
      status: "blocked",
      reasonCodes: ["resolution_history_unavailable"],
    };
  const createdAt = Date.parse(input.parentCreatedAt);
  const cutAt = Date.parse(history.historyCut.activatedAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(cutAt)) {
    return { status: "blocked", reasonCodes: ["resolution_history_invalid"] };
  }
  const bootstrap = history.historyCut.bootstrap;
  if (bootstrap) {
    const bootstrapCut = Date.parse(bootstrap.activationCut);
    if (
      bootstrap.qualificationSource !==
        "retired_legacy_writers_quarantine.v1" ||
      !Number.isFinite(bootstrapCut) ||
      bootstrapCut !== cutAt
    )
      return { status: "blocked", reasonCodes: ["resolution_history_invalid"] };
    if (createdAt <= bootstrapCut)
      return {
        status: "blocked",
        reasonCodes: ["untracked_legacy_possibility"],
      };
  }
  return createdAt >= cutAt
    ? {
        status: "eligible",
        historyStatus: "no_prior_rr_resolution",
        reasonCodes: [],
      }
    : {
        status: "eligible",
        historyStatus: "no_known_resolution_since_cut",
        reasonCodes: ["legacy_history_before_cut_unobserved"],
      };
}

export function parseResolutionFacts(
  confirmed: unknown,
  pending: unknown,
): Pick<ResolutionHistory, "confirmed" | "pending"> {
  const fact = (value: unknown): ResolutionOperationIdentity => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("resolution_guard_fact_invalid");
    const item = value as Record<string, unknown>;
    for (const key of ["operationId", "reviewedHeadSha", "bodyHash"]) {
      if (typeof item[key] !== "string" || !item[key])
        throw new Error("resolution_guard_fact_invalid");
    }
    if (
      item.sourceKind !== "canonical_operation" &&
      item.sourceKind !== "legacy_entry"
    )
      throw new Error("resolution_guard_source_invalid");
    if (
      item.sourceKind === "canonical_operation" &&
      ["publicationAttemptId", "executionId", "generation"].some(
        (key) => typeof item[key] !== "string" || !item[key],
      )
    )
      throw new Error("resolution_guard_identity_invalid");
    return resolutionOperationIdentity(
      item as unknown as ResolutionOperationIdentity,
    );
  };
  const confirmedFact =
    confirmed == null
      ? null
      : (() => {
          const identity = fact(confirmed);
          const item = confirmed as Record<string, unknown>;
          if (
            typeof item.effectId !== "string" ||
            !item.effectId ||
            typeof item.observedAt !== "string" ||
            !Number.isFinite(Date.parse(item.observedAt))
          )
            throw new Error("resolution_guard_confirmation_invalid");
          let latestConfirmed: ConfirmedResolutionFact["latestConfirmed"];
          if (item.latestConfirmed !== undefined) {
            const latestIdentity = fact(item.latestConfirmed);
            const latest = item.latestConfirmed as Record<string, unknown>;
            if (
              typeof latest.effectId !== "string" ||
              !latest.effectId ||
              typeof latest.observedAt !== "string" ||
              !Number.isFinite(Date.parse(latest.observedAt))
            )
              throw new Error("resolution_guard_confirmation_invalid");
            latestConfirmed = {
              ...latestIdentity,
              effectId: latest.effectId,
              observedAt: latest.observedAt,
            };
          }
          return {
            ...identity,
            effectId: item.effectId,
            observedAt: item.observedAt,
            ...(latestConfirmed ? { latestConfirmed } : {}),
          };
        })();
  if (pending != null && !Array.isArray(pending))
    throw new Error("resolution_guard_pending_invalid");
  const pendingFacts = ((pending ?? []) as unknown[]).map(
    (value): PendingResolutionFact => {
      const identity = fact(value);
      const item = value as Record<string, unknown>;
      if (
        !["entered", "may_have_started", "effect_unknown"].includes(
          String(item.state),
        ) ||
        typeof item.enteredAt !== "string" ||
        !Number.isFinite(Date.parse(item.enteredAt))
      )
        throw new Error("resolution_guard_pending_invalid");
      return {
        ...identity,
        state: item.state as PendingResolutionFact["state"],
        enteredAt: item.enteredAt,
      };
    },
  );
  return { confirmed: confirmedFact, pending: pendingFacts };
}

export function parseResolutionHistoryBootstrap(
  value: unknown,
  activationCut: string,
): ResolutionHistoryBootstrap | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("resolution_bootstrap_invalid");
  const item = value as Record<string, unknown>;
  if (
    item.qualificationSource !== "retired_legacy_writers_quarantine.v1" ||
    typeof item.executorSetHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.executorSetHash) ||
    typeof item.proofHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(item.proofHash) ||
    typeof item.retiredAt !== "string" ||
    !Number.isFinite(Date.parse(item.retiredAt)) ||
    item.activationCut !== activationCut ||
    Date.parse(item.retiredAt) > Date.parse(activationCut)
  )
    throw new Error("resolution_bootstrap_invalid");
  return {
    qualificationSource: item.qualificationSource,
    executorSetHash: item.executorSetHash,
    proofHash: item.proofHash,
    retiredAt: item.retiredAt,
    activationCut,
  };
}
