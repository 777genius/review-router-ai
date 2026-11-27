import { registerWorkerShutdown } from "../worker-shutdown.js";
import {
  createWorkerBatchProcessor,
  type WorkerBatchOperations,
} from "../worker-batch.js";
import { runOutboxWorkerLoop, sleep } from "../outbox-worker-loop.js";

const send = (message: Record<string, unknown>) => process.send?.(message);
let release!: () => void;
const held = new Promise<void>((resolve) => {
  release = resolve;
});
const shutdown = registerWorkerShutdown((signal) =>
  send({ type: "stopping", signal }),
);
process.on("message", (message) => {
  if (message === "release") release();
  if (message === "probe") setTimeout(() => send({ type: "alive" }), 25);
});
let claims = 0;
const noop = async () => undefined;
const operations: WorkerBatchOperations = {
  sdkGrowthMaintenance: noop,
  async processOutbox() {
    claims += 1;
    send({ type: "claimed", claims });
    await held;
    send({ type: "settled", claims });
    return {
      recoveredStale: 0,
      claimed: 1,
      processed: 1,
      retried: 0,
      deadLettered: 0,
      staleClaims: 0,
    };
  },
  pruneRateLimits: noop,
  pruneActionOidcReplayNonces: noop,
  pruneReviewSnapshots: noop,
  pruneReviewExecutionCheckpoints: noop,
  reviewInvestigationMaintenance: noop,
  memoryMaintenance: noop,
  pruneMemoryUsageTelemetry: noop,
  // This fixture isolates the real host lifecycle, not the V2 application.
  reviewV2Maintenance: async () => ({
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
const logger = { info() {}, warn() {}, error() {} };
try {
  const summary = await runOutboxWorkerLoop(
    {
      signal: shutdown.signal,
      idleDelayMs: 10,
      busyDelayMs: 10,
      errorDelayMs: 10,
    },
    {
      processor: createWorkerBatchProcessor(operations, {
        signal: shutdown.signal,
        observationMs: 20,
      }),
      logger,
      sleep,
    },
  );
  // Represents the host-owned resource close after the actual loop drain.
  send({ type: "disconnected", claims, processed: summary.processed });
} finally {
  shutdown.dispose();
  process.disconnect?.();
}
