import { createHash } from "node:crypto";
import {
  OutboxHandlerError,
  type OutboxEvent,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";
import {
  AdvanceReviewCompletionProcessStatus,
  ReviewCompletionProcessCreateStatus,
  ReviewCompletionWakeupKind,
  type RecoverMissingReviewCompletionProcesses,
  type ScanDueReviewCompletionProcesses,
  type WakeReviewCompletionProcess,
} from "@reviewrouter/features-review-processes";
import { ReviewCompletionSchedulerMode } from "@reviewrouter/features-review-processes/composition";
import type { ReviewCompletionWakeupQueryPort } from "./review-v2-context-adapters";
import { safeWorkerErrorSummary } from "./outbox-worker-loop";
import {
  captureWorkerPhase,
  type WorkerPhaseFailure,
  type WorkerPhaseResult,
} from "./worker-phase";

export const reviewV2WorkerEnabledEnv =
  "REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED";
export const reviewExecutionFinalizedEventType = "review.execution.finalized";
export const reviewExecutionFinalizedEventVersion = 2;

export type ReviewV2WorkerFeature = {
  readonly enabled: boolean;
  readonly handlers: readonly OutboxHandler[];
  readonly runMaintenance: () => Promise<ReviewV2MaintenanceResult>;
};

export type ReviewV2MaintenanceResult = {
  /** Failed or blocked owners have unavailable metrics, never successful zeroes. */
  readonly intentsScanned: number | null;
  readonly intentsDispatched: number | null;
  readonly intentsRecovered: number | null;
  readonly intentDispatchFailures: number | null;
  readonly recovered: number | null;
  readonly advanced: number | null;
  readonly publicationProcessed: number | null;
  readonly publicationManualRequired: number | null;
  readonly publicationTerminalUnknown: number | null;
  readonly progressPromoted: number | null;
  readonly progressClaimed: number | null;
  readonly progressPublished: number | null;
  readonly progressDeferred: number | null;
  readonly progressSuppressed: number | null;
  readonly progressFailed: number | null;
  readonly expiredExecutionsScanned: number | null;
  readonly expiredExecutionsRecovered: number | null;
  readonly expiredExecutionConflicts: number | null;
  readonly expiredExecutionFailures: number | null;
  readonly failures: readonly WorkerPhaseFailure[];
  readonly blockedPhases: readonly Readonly<{
    phase: string;
    blockedBy: string;
  }>[];
};

export type ReviewV2IntentMaintenanceRuntime = {
  runMaintenance(): Promise<{
    readonly scanned: number;
    readonly dispatched: number;
    readonly recovered: number;
    readonly failed: number;
  }>;
};

export type ReviewV2ExecutionRecoveryRuntime = {
  execute(input: { readonly limit: number }): Promise<{
    readonly scanned: number;
    readonly recovered: number;
    readonly conflicts: number;
    readonly failures: number;
  }>;
};

export type ReviewV2PublicationMaintenanceRuntime = {
  runMaintenance(): Promise<{
    readonly processed: number;
    readonly manualRequired: number;
    readonly terminalUnknown: number;
    readonly settledExecutionIds: readonly string[];
    readonly progressSettlements: readonly ReviewProgressSettlement[];
    /** Optional to preserve the existing in-memory/adapter contract. */
    readonly itemFailures?: readonly WorkerPhaseFailure[];
  }>;
};

export type ReviewProgressSettlement = Readonly<{
  executionId: string;
  outcome: "succeeded" | "failed" | "superseded";
}>;

export type ReviewV2ProgressMaintenanceRuntime = {
  promoteSettledExecutions(input: {
    readonly settlements: readonly ReviewProgressSettlement[];
  }): Promise<number>;
  runMaintenance(): Promise<{
    readonly claimed: number;
    readonly published: number;
    readonly deferred: number;
    readonly suppressed: number;
    readonly failed: number;
  }>;
};

export type ReviewV2CompletionRuntime = {
  readonly wake: Pick<WakeReviewCompletionProcess, "execute">;
  readonly advance: {
    execute(input: {
      readonly executionId: string;
      readonly ownerIdHash: string;
    }): Promise<{ readonly status: AdvanceReviewCompletionProcessStatus }>;
  };
  readonly schedulers: {
    readonly mode: ReviewCompletionSchedulerMode.Enabled;
    readonly due: Pick<ScanDueReviewCompletionProcesses, "execute">;
    readonly recovery: Pick<
      RecoverMissingReviewCompletionProcesses,
      "scanNextPage"
    >;
  };
};

export function createReviewV2WorkerFeature(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly createEnabledRuntime?: () => {
    readonly runtime: ReviewV2CompletionRuntime;
    readonly wakeups: ReviewCompletionWakeupQueryPort;
    readonly ownerIdHash: string;
    readonly dueLimit: number;
    readonly intents?: ReviewV2IntentMaintenanceRuntime;
    readonly executionRecovery?: ReviewV2ExecutionRecoveryRuntime;
    readonly publication?: ReviewV2PublicationMaintenanceRuntime;
    readonly progress?: ReviewV2ProgressMaintenanceRuntime;
    readonly ingressHandlers?: readonly OutboxHandler[];
  };
}): ReviewV2WorkerFeature {
  if (input.env[reviewV2WorkerEnabledEnv] !== "1") {
    return {
      enabled: false,
      handlers: [],
      runMaintenance: async () => ({
        intentsScanned: 0,
        intentsDispatched: 0,
        intentsRecovered: 0,
        intentDispatchFailures: 0,
        recovered: 0,
        advanced: 0,
        publicationProcessed: 0,
        publicationManualRequired: 0,
        publicationTerminalUnknown: 0,
        progressPromoted: 0,
        progressClaimed: 0,
        progressPublished: 0,
        progressDeferred: 0,
        progressSuppressed: 0,
        progressFailed: 0,
        expiredExecutionsScanned: 0,
        expiredExecutionsRecovered: 0,
        expiredExecutionConflicts: 0,
        expiredExecutionFailures: 0,
        failures: [],
        blockedPhases: [],
      }),
    };
  }
  if (
    input.env.REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED === "1" &&
    input.env.REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED !== "1"
  ) {
    throw new Error("review_v2_ingress_requires_fenced_outbox_takeover");
  }
  if (!input.createEnabledRuntime) {
    throw new Error("review_v2_worker_enabled_composition_missing");
  }
  const enabled = input.createEnabledRuntime();
  return {
    enabled: true,
    handlers: [
      createReviewExecutionFinalizedHandler({
        runtime: enabled.runtime,
        wakeups: enabled.wakeups,
        ownerIdHash: enabled.ownerIdHash,
      }),
      ...(enabled.ingressHandlers ?? []),
    ],
    runMaintenance: () =>
      runReviewV2Maintenance({
        runtime: enabled.runtime,
        ownerIdHash: enabled.ownerIdHash,
        dueLimit: enabled.dueLimit,
        ...(enabled.intents ? { intents: enabled.intents } : {}),
        ...(enabled.executionRecovery
          ? { executionRecovery: enabled.executionRecovery }
          : {}),
        ...(enabled.publication ? { publication: enabled.publication } : {}),
        ...(enabled.progress ? { progress: enabled.progress } : {}),
      }),
  };
}

export function createReviewExecutionFinalizedHandler(input: {
  readonly runtime: Pick<ReviewV2CompletionRuntime, "wake" | "advance">;
  readonly wakeups: ReviewCompletionWakeupQueryPort;
  readonly ownerIdHash: string;
}): OutboxHandler {
  requireOwnerHash(input.ownerIdHash);
  return {
    type: reviewExecutionFinalizedEventType,
    version: reviewExecutionFinalizedEventVersion,
    async handle(event: OutboxEvent) {
      const payload = parseFinalizedEvent(event);
      const facts = await input.wakeups.findFinalizedWakeup(payload);
      if (!facts) {
        throw new OutboxHandlerError(
          "Finalized review execution facts are not readable yet",
          "review_v2_finalized_facts_unavailable",
          true,
        );
      }
      const wake = await input.runtime.wake.execute({
        executionId: facts.executionId,
        finalizedArtifactId: facts.finalizedArtifactId,
        wakeupKind: ReviewCompletionWakeupKind.ExecutionFinalized,
        wakeupAt: facts.finalizedAt,
        retainUntil: facts.retainUntil,
      });
      if (
        wake.status === ReviewCompletionProcessCreateStatus.ArtifactConflict
      ) {
        throw new OutboxHandlerError(
          "Finalized review execution conflicts with the completion process",
          "review_v2_completion_artifact_conflict",
          false,
        );
      }
      await input.runtime.advance.execute({
        executionId: facts.executionId,
        ownerIdHash: input.ownerIdHash,
      });
    },
  };
}

export async function runReviewV2Maintenance(input: {
  readonly runtime: ReviewV2CompletionRuntime;
  readonly ownerIdHash: string;
  readonly dueLimit: number;
  readonly intents?: ReviewV2IntentMaintenanceRuntime;
  readonly executionRecovery?: ReviewV2ExecutionRecoveryRuntime;
  readonly publication?: ReviewV2PublicationMaintenanceRuntime;
  readonly progress?: ReviewV2ProgressMaintenanceRuntime;
}): Promise<ReviewV2MaintenanceResult> {
  requireOwnerHash(input.ownerIdHash);
  if (!Number.isSafeInteger(input.dueLimit) || input.dueLimit <= 0) {
    throw new Error("review_v2_worker_due_limit_invalid");
  }
  const failures: WorkerPhaseFailure[] = [];
  const blockedPhases: Array<{ phase: string; blockedBy: string }> = [];
  async function run<Value>(phase: string, execute: () => Promise<Value>) {
    const result = await captureWorkerPhase(phase, execute);
    if (result.status === "failed") failures.push(result.failure);
    return result;
  }
  const recovery = await run("review_v2.recovery", () =>
    input.runtime.schedulers.recovery.scanNextPage(),
  );
  const executionRecovery = input.executionRecovery
    ? await run("review_v2.execution_recovery", () =>
        input.executionRecovery!.execute({ limit: input.dueLimit }),
      )
    : undefined;
  const intents = input.intents
    ? await run("review_v2.intents", () => input.intents!.runMaintenance())
    : undefined;
  const due = await run("review_v2.due", () =>
    input.runtime.schedulers.due.execute({
      ownerIdHash: input.ownerIdHash,
      limit: input.dueLimit,
    }),
  );
  const publication = input.publication
    ? await run("review_v2.publication", () =>
        input.publication!.runMaintenance(),
      )
    : undefined;
  if (publication?.status === "completed") {
    failures.push(...(publication.value.itemFailures ?? []));
  }
  const publicationWakeups =
    publication?.status === "completed"
      ? await Promise.allSettled(
          [...new Set(publication.value.settledExecutionIds)].map(
            (executionId) =>
              Promise.resolve().then(() =>
                input.runtime.advance.execute({
                  executionId,
                  ownerIdHash: input.ownerIdHash,
                }),
              ),
          ),
        )
      : [];
  for (const wakeup of publicationWakeups) {
    if (wakeup.status === "rejected")
      failures.push({
        phase: "review_v2.publication_wakeup",
        safeErrorSummary: safeWorkerErrorSummary(wakeup.reason),
      });
  }
  const advanced =
    due.status === "failed" ||
    publication?.status === "failed" ||
    (publication?.status === "completed" &&
      (publication.value.itemFailures?.length ?? 0) > 0) ||
    publicationWakeups.some((wakeup) => wakeup.status === "rejected")
      ? null
      : [
          ...due.value,
          ...publicationWakeups.flatMap((wakeup) =>
            wakeup.status === "fulfilled" ? [wakeup.value] : [],
          ),
        ].filter(
          (result) =>
            result.status !== AdvanceReviewCompletionProcessStatus.Busy &&
            result.status !== AdvanceReviewCompletionProcessStatus.Missing &&
            result.status !== AdvanceReviewCompletionProcessStatus.StaleClaim,
        ).length;
  let promotion: WorkerPhaseResult<number> | undefined;
  let progress:
    | WorkerPhaseResult<
        Awaited<
          ReturnType<ReviewV2ProgressMaintenanceRuntime["runMaintenance"]>
        >
      >
    | undefined;
  if (input.progress && publication?.status === "failed") {
    blockedPhases.push(
      {
        phase: "review_v2.progress_promotion",
        blockedBy: "review_v2.publication",
      },
      {
        phase: "review_v2.progress_publication",
        blockedBy: "review_v2.publication",
      },
    );
  } else if (input.progress) {
    if (publication?.status === "completed") {
      promotion = await run("review_v2.progress_promotion", () =>
        input.progress!.promoteSettledExecutions({
          settlements: publication.value.progressSettlements,
        }),
      );
    }
    // The final publication precedes terminal promotion and progress comments.
    // Promotion failure does not prevent already eligible progress from publishing.
    progress = await run("review_v2.progress_publication", () =>
      input.progress!.runMaintenance(),
    );
  }
  const progressBlocked =
    input.progress !== undefined && publication?.status === "failed";
  const completedRecovery = completedPhaseValue(recovery);
  const completedExecutionRecovery = completedPhaseValue(executionRecovery);
  const completedIntents = completedPhaseValue(intents);
  const completedPublication = completedPhaseValue(publication);
  const completedProgress = completedPhaseValue(progress);
  return {
    intentsScanned:
      intents?.status === "failed" ? null : (completedIntents?.scanned ?? 0),
    intentsDispatched:
      intents?.status === "failed" ? null : (completedIntents?.dispatched ?? 0),
    intentsRecovered:
      intents?.status === "failed" ? null : (completedIntents?.recovered ?? 0),
    intentDispatchFailures:
      intents?.status === "failed" ? null : (completedIntents?.failed ?? 0),
    recovered:
      recovery.status === "failed"
        ? null
        : completedRecovery!.createdOrRestored,
    advanced,
    publicationProcessed:
      publication?.status === "failed"
        ? null
        : (completedPublication?.processed ?? 0),
    publicationManualRequired:
      publication?.status === "failed"
        ? null
        : (completedPublication?.manualRequired ?? 0),
    publicationTerminalUnknown:
      publication?.status === "failed"
        ? null
        : (completedPublication?.terminalUnknown ?? 0),
    progressPromoted:
      progressBlocked || promotion?.status === "failed"
        ? null
        : (completedPhaseValue(promotion) ?? 0),
    progressClaimed:
      progressBlocked || progress?.status === "failed"
        ? null
        : (completedProgress?.claimed ?? 0),
    progressPublished:
      progressBlocked || progress?.status === "failed"
        ? null
        : (completedProgress?.published ?? 0),
    progressDeferred:
      progressBlocked || progress?.status === "failed"
        ? null
        : (completedProgress?.deferred ?? 0),
    progressSuppressed:
      progressBlocked || progress?.status === "failed"
        ? null
        : (completedProgress?.suppressed ?? 0),
    progressFailed:
      progressBlocked || progress?.status === "failed"
        ? null
        : (completedProgress?.failed ?? 0),
    expiredExecutionsScanned:
      executionRecovery?.status === "failed"
        ? null
        : (completedExecutionRecovery?.scanned ?? 0),
    expiredExecutionsRecovered:
      executionRecovery?.status === "failed"
        ? null
        : (completedExecutionRecovery?.recovered ?? 0),
    expiredExecutionConflicts:
      executionRecovery?.status === "failed"
        ? null
        : (completedExecutionRecovery?.conflicts ?? 0),
    expiredExecutionFailures:
      executionRecovery?.status === "failed"
        ? null
        : (completedExecutionRecovery?.failures ?? 0),
    failures,
    blockedPhases,
  };
}

function completedPhaseValue<Value>(
  phase: WorkerPhaseResult<Value> | undefined,
): Value | undefined {
  return phase?.status === "completed" ? phase.value : undefined;
}

export function createReviewV2WorkerOwnerId(seed: string): string {
  if (seed.trim().length === 0) {
    throw new Error("review_v2_worker_owner_seed_invalid");
  }
  return createHash("sha256")
    .update(`rr.review-v2-worker-owner.v1\0${seed}`, "utf8")
    .digest("hex");
}

function parseFinalizedEvent(event: OutboxEvent): {
  readonly executionId: string;
  readonly finalizedArtifactId: string;
} {
  if (
    event.type !== reviewExecutionFinalizedEventType ||
    event.version !== reviewExecutionFinalizedEventVersion ||
    !isRecord(event.payload)
  ) {
    throw invalidFinalizedEvent();
  }
  const executionId = event.payload.executionId;
  const finalizedArtifactId = event.payload.artifactId;
  const artifactHash = event.payload.artifactHash;
  const generation = event.payload.generation;
  const reviewRevisionHash = event.payload.reviewRevisionHash;
  const projectionHash = event.payload.projectionHash;
  if (
    typeof executionId !== "string" ||
    executionId.length === 0 ||
    typeof finalizedArtifactId !== "string" ||
    finalizedArtifactId.length === 0 ||
    typeof artifactHash !== "string" ||
    !isSha256(artifactHash) ||
    typeof generation !== "string" ||
    !isPositiveDecimal(generation) ||
    typeof reviewRevisionHash !== "string" ||
    !isSha256(reviewRevisionHash) ||
    typeof projectionHash !== "string" ||
    !isSha256(projectionHash) ||
    event.aggregateId !== executionId
  ) {
    throw invalidFinalizedEvent();
  }
  return { executionId, finalizedArtifactId };
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isPositiveDecimal(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

function invalidFinalizedEvent(): OutboxHandlerError {
  return new OutboxHandlerError(
    "Invalid review.execution.finalized event payload",
    "review_v2_finalized_event_invalid",
    false,
  );
}

function requireOwnerHash(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("review_v2_worker_owner_hash_invalid");
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
