import type { ProcessOutboxBatchResult } from "@reviewrouter/features-outbox";
import type { ReviewV2MaintenanceResult } from "./review-v2-worker-runtime";
import {
  captureWorkerPhase,
  type WorkerPhaseFailure,
  type WorkerPhaseResult,
} from "./worker-phase";

export type WorkerBatchResult = Readonly<{
  outbox:
    | WorkerPhaseResult<ProcessOutboxBatchResult>
    | Readonly<{ status: "running" | "not_started" }>;
  failures: readonly WorkerPhaseFailure[];
  running?: readonly string[];
}>;

export type WorkerBatchOperations = {
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
};

/** The fixed outer owners are independent; V2 keeps its internal sequencing. */
export function createWorkerBatchProcessor(
  input: WorkerBatchOperations,
  options: Readonly<{ signal: AbortSignal; observationMs?: number }>,
) {
  const observationMs = options.observationMs ?? 1_000;
  if (!Number.isSafeInteger(observationMs) || observationMs < 1)
    throw new Error("worker_observation_budget_invalid");
  let onSettlement: (() => void) | undefined;
  function retain<Value>(name: string, execute: () => Promise<Value>) {
    return retainOwner(name, execute, () => onSettlement?.());
  }
  const sdk = retain("sdk_growth.recovery", input.sdkGrowthMaintenance);
  const outbox = retain("outbox", input.processOutbox);
  const reviewV2 = retain("review_v2.maintenance", input.reviewV2Maintenance);
  // There is no configurable registry or dynamically growing work queue here.
  const owners = [
    sdk,
    outbox,
    retain("rate_limits.retention", input.pruneRateLimits),
    retain("action_oidc.retention", input.pruneActionOidcReplayNonces),
    retain("review_snapshots.retention", input.pruneReviewSnapshots),
    retain(
      "review_checkpoints.retention",
      input.pruneReviewExecutionCheckpoints,
    ),
    retain(
      "review_investigations.retention",
      input.reviewInvestigationMaintenance,
    ),
    retain("memory.maintenance", input.memoryMaintenance),
    retain("memory_usage.retention", input.pruneMemoryUsageTelemetry),
    reviewV2,
  ];
  let stopped = false;
  let observing: Promise<WorkerBatchResult> | undefined;
  let draining: Promise<WorkerBatchResult> | undefined;

  function collect(): WorkerBatchResult {
    const outboxResult = outbox.result();
    const v2Result = reviewV2.result();
    const failures: WorkerPhaseFailure[] = [];
    const running: string[] = [];
    for (const owner of owners) {
      const result = owner.consume();
      if (result?.status === "failed") failures.push(result.failure);
      if (owner.running()) running.push(owner.name);
    }
    if (v2Result?.status === "completed")
      failures.push(...v2Result.value.failures);
    return {
      outbox: outboxResult ?? {
        status: outbox.running() ? "running" : "not_started",
      },
      failures,
      ...(running.length > 0 ? { running } : {}),
    };
  }

  async function observe(
    waitForSettlement: boolean,
  ): Promise<WorkerBatchResult> {
    for (const owner of owners) {
      if (stopped || options.signal.aborted) break;
      owner.start();
      // Preserve one-shot sequencing: SDK recovery can enqueue the outbox
      // work this invocation is expected to drain. Continuous passes may
      // observe already durable work while that recovery is still pending.
      if (waitForSettlement) await owner.pending();
    }
    if (!waitForSettlement) {
      // A stuck owner must not retain another promise reaction on every pass.
      // Its constant notification reads only the current, removable observer.
      const pending = new Promise<void>((resolve) => {
        onSettlement = () => {
          if (owners.every((owner) => !owner.running())) resolve();
        };
        onSettlement();
      });
      try {
        await observeUntilBudget(pending, observationMs, options.signal);
      } finally {
        onSettlement = undefined;
      }
    }
    return collect();
  }

  return {
    processBatch(): Promise<WorkerBatchResult> {
      if (draining)
        return draining.then(() => ({
          outbox: { status: "not_started" },
          failures: [],
        }));
      observing ??= observe(false).finally(() => {
        observing = undefined;
      });
      return observing;
    },
    /** Only the one-shot host waits for every actual settlement. */
    async processOnce(): Promise<WorkerBatchResult> {
      if (observing || draining) throw new Error("worker_once_already_running");
      observing = observe(true);
      try {
        return await observing;
      } finally {
        observing = undefined;
      }
    },
    drain(): Promise<WorkerBatchResult> {
      stopped = true;
      draining ??= (async () => {
        // Preserve the pass's consumer if a caller races observation and drain.
        await observing;
        await Promise.all(owners.map((owner) => owner.pending()));
        return collect();
      })();
      return draining;
    },
  };
}

/** One-shot execution owns every started operation through actual settlement. */
export async function runWorkerBatch(
  input: WorkerBatchOperations,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<WorkerBatchResult> {
  const processor = createWorkerBatchProcessor(input, {
    signal: options.signal ?? new AbortController().signal,
  });
  return processor.processOnce();
}

function retainOwner<Value>(
  name: string,
  execute: () => Promise<Value>,
  notifySettlement: () => void,
) {
  let pending: Promise<void> | undefined;
  let settled: WorkerPhaseResult<Value> | undefined;
  return {
    name,
    start() {
      if (pending || settled) return;
      pending = captureWorkerPhase(name, execute).then((result) => {
        settled = result;
        pending = undefined;
        notifySettlement();
      });
    },
    pending: () => pending,
    running: () => pending !== undefined,
    result: () => settled,
    consume() {
      const result = settled;
      settled = undefined;
      return result;
    },
  };
}

/** This bounds observation only. The owned promises remain in their slots. */
async function observeUntilBudget(
  pending: Promise<unknown>,
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish!: () => void;
  const interrupted = new Promise<void>((resolve) => {
    finish = resolve;
    timer = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
  try {
    await Promise.race([pending, interrupted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", finish);
  }
}
