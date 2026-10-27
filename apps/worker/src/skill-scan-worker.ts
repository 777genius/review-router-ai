import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import {
  OutboxHandlerError,
  PrismaOutboxEventRepository,
  processOutboxBatch,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";
import {
  createHttpSkillScanner,
  createPrismaReviewSkillsCatalogWorker,
  readSkillScannerConfig,
} from "@reviewrouter/features-review-skills/composition";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { ConsoleLogger } from "@reviewrouter/platform-logger";
import { SystemClock } from "@reviewrouter/shared";
import { runOutboxWorkerLoop, sleep } from "./outbox-worker-loop.js";

/** Separate lane: the ordinary review/control-plane batch never waits for a scan. */
export async function createSkillScanWorker(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
}) {
  const config = readSkillScannerConfig(input.env);
  if (!config) throw new Error("skill_scan_worker_configuration_required");
  const scanner = createHttpSkillScanner(config);
  const outbox = new PrismaOutboxEventRepository(input.prisma);
  const owner = createHash("sha256").update(randomUUID()).digest("hex");
  let refreshedAt = 0;
  let worker: ReturnType<typeof createPrismaReviewSkillsCatalogWorker> | null =
    null;
  let prunedAt = 0;
  const handler: OutboxHandler = {
    type: "review-skills.scan",
    version: 1,
    async handle(event) {
      const payload = event.payload as { jobId?: unknown } | null;
      if (
        !payload ||
        typeof payload.jobId !== "string" ||
        payload.jobId !== event.aggregateId ||
        !event.claimId ||
        !event.claimVersion ||
        !event.claimUntil ||
        !worker
      )
        throw new OutboxHandlerError(
          "Invalid Skills scan event",
          "invalid_skill_scan_event",
          false,
        );
      const result = await worker.process({
        jobId: payload.jobId,
        claimId: event.claimId,
        claimVersion: event.claimVersion,
        claimUntil: event.claimUntil,
      });
      if (result === "busy")
        throw new OutboxHandlerError(
          "Skills scanner is busy",
          "skill_scan_busy",
          true,
        );
    },
  };
  return {
    async processBatch() {
      if (!worker || Date.now() - refreshedAt > 60000) {
        // No claim is taken if the execution service's current identity is unavailable.
        const profiles = await scanner.loadProfiles();
        worker = createPrismaReviewSkillsCatalogWorker({
          prisma: input.prisma,
          executor: scanner,
          profiles,
        });
        refreshedAt = Date.now();
      }
      const result = await processOutboxBatch(
        {
          limit: 1,
          handlers: [handler],
          claimOwnerHash: owner,
          processingLeaseMs: 240000,
          heartbeatIntervalMs: 30000,
          takeoverEnabled: true,
        },
        { outbox, clock: new SystemClock() },
      );
      if (Date.now() - prunedAt > 60000) {
        await worker.prune(100);
        prunedAt = Date.now();
      }
      return result;
    },
  };
}

async function main() {
  const prisma = createPrismaClient({ poolMax: 4 });
  const signal = new AbortController();
  const stop = () => signal.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    const processor = await createSkillScanWorker({ prisma, env: process.env });
    await runOutboxWorkerLoop(
      {
        signal: signal.signal,
        idleDelayMs: 1000,
        busyDelayMs: 100,
        errorDelayMs: 5000,
      },
      { processor, logger: new ConsoleLogger(), sleep },
    );
  } finally {
    await prisma.$disconnect();
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error("Skills scan worker could not start or continue.");
    process.exitCode = 1;
  });
}
