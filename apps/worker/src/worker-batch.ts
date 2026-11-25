import type { ProcessOutboxBatchResult } from "@reviewrouter/features-outbox";
import type { ReviewV2MaintenanceResult } from "./review-v2-worker-runtime";
import {
  captureWorkerPhase,
  type WorkerPhaseFailure,
  type WorkerPhaseResult,
} from "./worker-phase";

export type WorkerBatchResult = Readonly<{
  outbox: WorkerPhaseResult<ProcessOutboxBatchResult>;
  failures: readonly WorkerPhaseFailure[];
}>;

/** One serial pass of the existing independent worker owners. */
export async function runWorkerBatch(input: {
  readonly sdkGrowthMaintenance: () => Promise<unknown>;
  readonly processOutbox: () => Promise<ProcessOutboxBatchResult>;
  readonly pruneRateLimits: () => Promise<unknown>;
  readonly pruneActionOidcReplayNonces: () => Promise<unknown>;
  readonly pruneReviewSnapshots: () => Promise<unknown>;
  readonly pruneReviewExecutionCheckpoints: () => Promise<unknown>;
  readonly reviewInvestigationMaintenance: () => Promise<unknown>;
  readonly memoryMaintenance: () => Promise<unknown>;
  readonly pruneMemoryUsageTelemetry: () => Promise<unknown>;
  readonly reviewV2Maintenance: () => Promise<ReviewV2MaintenanceResult>;
}): Promise<WorkerBatchResult> {
  const failures: WorkerPhaseFailure[] = [];
  async function run<Value>(phase: string, execute: () => Promise<Value>) {
    const result = await captureWorkerPhase(phase, execute);
    if (result.status === "failed") failures.push(result.failure);
    return result;
  }

  await run("sdk_growth.recovery", input.sdkGrowthMaintenance);
  const outbox = await run("outbox", input.processOutbox);
  await run("rate_limits.retention", input.pruneRateLimits);
  await run("action_oidc.retention", input.pruneActionOidcReplayNonces);
  await run("review_snapshots.retention", input.pruneReviewSnapshots);
  await run(
    "review_checkpoints.retention",
    input.pruneReviewExecutionCheckpoints,
  );
  await run(
    "review_investigations.retention",
    input.reviewInvestigationMaintenance,
  );
  await run("memory.maintenance", input.memoryMaintenance);
  await run("memory_usage.retention", input.pruneMemoryUsageTelemetry);
  const reviewV2 = await run(
    "review_v2.maintenance",
    input.reviewV2Maintenance,
  );
  if (reviewV2.status === "completed")
    failures.push(...reviewV2.value.failures);

  return { outbox, failures };
}
