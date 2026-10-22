import type { Logger } from "@reviewrouter/platform-logger";
import type { Clock } from "@reviewrouter/shared";

type MemoryProjectionMaintenanceResult = {
  readonly processed: number;
  readonly deleted: number;
  readonly pending: number;
};

export type MemoryProjectionMaintenanceConfig = {
  readonly intervalMs: number;
  readonly limit: number;
};

export function readMemoryProjectionMaintenanceConfig(
  env: Readonly<Record<string, string | undefined>>,
): MemoryProjectionMaintenanceConfig {
  return {
    intervalMs: readBoundedInteger(
      env.REVIEW_ROUTER_MEMORY_PROJECTION_RECONCILE_INTERVAL_MS,
      30_000,
      86_400_000,
      "memory_projection_reconcile_interval_invalid",
    ),
    limit: readBoundedInteger(
      env.REVIEW_ROUTER_MEMORY_PROJECTION_RECONCILE_BATCH_SIZE,
      10,
      100,
      "memory_projection_reconcile_batch_size_invalid",
    ),
  };
}

/** The adapter owns durable due-time/backoff; this bounds work in the host loop. */
export function createMemoryProjectionMaintenance(
  config: MemoryProjectionMaintenanceConfig,
  dependencies: {
    readonly clock: Clock;
    readonly logger: Pick<Logger, "info" | "warn">;
    readonly reconcile: (input: {
      readonly limit: number;
    }) => Promise<MemoryProjectionMaintenanceResult>;
  },
): () => Promise<void> {
  if (
    !Number.isSafeInteger(config.intervalMs) ||
    config.intervalMs <= 0 ||
    config.intervalMs > 86_400_000
  ) {
    throw new Error("memory_projection_reconcile_interval_invalid");
  }
  if (
    !Number.isSafeInteger(config.limit) ||
    config.limit <= 0 ||
    config.limit > 100
  ) {
    throw new Error("memory_projection_reconcile_batch_size_invalid");
  }
  let nextAttemptAtMs = Number.NEGATIVE_INFINITY;
  let inFlight = false;

  return async () => {
    const nowMs = dependencies.clock.now().getTime();
    if (inFlight || nowMs < nextAttemptAtMs) return;
    nextAttemptAtMs = nowMs + config.intervalMs;
    inFlight = true;
    try {
      const result = await dependencies.reconcile({ limit: config.limit });
      if (result.processed > 0 || result.pending > 0) {
        dependencies.logger.info("ReviewRouter reconciled memory projections", {
          processed: result.processed,
          deleted: result.deleted,
          pending: result.pending,
        });
      }
    } catch {
      // Provider error bodies may contain private text or credentials. Never
      // forward an arbitrary Error.message, even through a generic redactor.
      dependencies.logger.warn(
        "ReviewRouter memory projection maintenance failed",
        {
          errorCode: "memory_projection_maintenance_failed",
        },
      );
    } finally {
      inFlight = false;
    }
  };
}

function readBoundedInteger(
  raw: string | undefined,
  fallback: number,
  maximum: number,
  code: string,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(code);
  }
  return parsed;
}
