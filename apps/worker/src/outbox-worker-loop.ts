import type { ProcessOutboxBatchResult } from "@reviewrouter/features-outbox";
import type { Logger } from "@reviewrouter/platform-logger";
import type { WorkerBatchResult } from "./worker-batch";

export type OutboxWorkerLoopResult = ProcessOutboxBatchResult & {
  readonly iterations: number;
  readonly errors: number;
};

export interface OutboxWorkerBatchProcessorPort {
  processBatch(): Promise<WorkerBatchResult>;
}

export type SleepPort = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;

export type RunOutboxWorkerLoopInput = {
  readonly signal: AbortSignal;
  readonly idleDelayMs: number;
  readonly busyDelayMs: number;
  readonly errorDelayMs: number;
  readonly maxIterations?: number;
};

export async function runOutboxWorkerLoop(
  input: RunOutboxWorkerLoopInput,
  dependencies: {
    readonly processor: OutboxWorkerBatchProcessorPort;
    readonly logger: Logger;
    readonly sleep: SleepPort;
  },
): Promise<OutboxWorkerLoopResult> {
  const total = {
    iterations: 0,
    recoveredStale: 0,
    claimed: 0,
    processed: 0,
    retried: 0,
    deadLettered: 0,
    staleClaims: 0,
    errors: 0,
  } satisfies OutboxWorkerLoopResult;

  while (shouldContinue(input, total.iterations)) {
    total.iterations += 1;
    try {
      const result = await dependencies.processor.processBatch();
      if (result.outbox.status === "completed") {
        const outbox = result.outbox.value;
        total.recoveredStale += outbox.recoveredStale;
        total.claimed += outbox.claimed;
        total.processed += outbox.processed;
        total.retried += outbox.retried;
        total.deadLettered += outbox.deadLettered;
        total.staleClaims += outbox.staleClaims;
      }
      reportWorkerBatch(result, dependencies.logger);
      const failed = workerBatchFailed(result);
      if (failed) total.errors += 1;

      const delayMs = failed
        ? input.errorDelayMs
        : result.outbox.status === "completed" &&
            (result.outbox.value.claimed > 0 ||
              result.outbox.value.recoveredStale > 0)
          ? input.busyDelayMs
          : input.idleDelayMs;
      if (shouldContinue(input, total.iterations)) {
        await dependencies.sleep(delayMs, input.signal);
      }
    } catch (error) {
      total.errors += 1;
      dependencies.logger.error("ReviewRouter worker batch failed", {
        safeErrorSummary: safeWorkerErrorSummary(error),
      });
      if (shouldContinue(input, total.iterations)) {
        await dependencies.sleep(input.errorDelayMs, input.signal);
      }
    }
  }

  return total;
}

/** A one-shot run still finishes independent work, then reports failure to its caller. */
export async function runOutboxWorkerOnce(dependencies: {
  readonly processor: OutboxWorkerBatchProcessorPort;
  readonly logger: Logger;
}): Promise<WorkerBatchResult> {
  const result = await dependencies.processor.processBatch();
  reportWorkerBatch(result, dependencies.logger);
  if (workerBatchFailed(result)) throw new Error("worker_batch_phases_failed");
  return result;
}

function workerBatchFailed(result: WorkerBatchResult): boolean {
  return result.outbox.status === "failed" || result.failures.length > 0;
}

function reportWorkerBatch(result: WorkerBatchResult, logger: Logger): void {
  if (result.outbox.status === "completed") {
    logger.info(
      "ReviewRouter worker processed outbox batch",
      result.outbox.value,
    );
  }
  if (workerBatchFailed(result)) {
    logger.error("ReviewRouter worker phases failed", {
      outboxStatus: result.outbox.status,
      failures: result.failures,
    });
  }
}

export const sleep: SleepPort = (milliseconds, signal) =>
  new Promise((resolve) => {
    if (signal.aborted || milliseconds <= 0) {
      resolve();
      return;
    }

    const finish = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });

export function safeWorkerErrorSummary(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "unknown_worker_error";
  return redactSensitiveText(message).slice(0, 500);
}

function shouldContinue(
  input: RunOutboxWorkerLoopInput,
  iterations: number,
): boolean {
  return (
    !input.signal.aborted &&
    (input.maxIterations === undefined || iterations < input.maxIterations)
  );
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi, "$1<redacted>@")
    .replace(
      /\b(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,
      "<redacted>",
    )
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "<redacted>")
    .replace(/([?&](?:access_)?token=)[^&\s]+/gi, "$1<redacted>");
}
