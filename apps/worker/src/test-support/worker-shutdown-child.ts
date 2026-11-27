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
  reviewV2Maintenance: async () =>
    ({ failures: [] }) as Awaited<
      ReturnType<WorkerBatchOperations["reviewV2Maintenance"]>
    >,
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
