import { describe, expect, it } from "vitest";
import { getEventListeners } from "node:events";
import type { Logger } from "@reviewrouter/platform-logger";
import {
  runOutboxWorkerLoop,
  runOutboxWorkerOnce,
  safeWorkerErrorSummary,
  sleep as actualSleep,
  type SleepPort,
} from "./outbox-worker-loop";

class MemoryLogger implements Logger {
  readonly infoMessages: Array<{
    message: string;
    context: Record<string, unknown> | undefined;
  }> = [];
  readonly errorMessages: Array<{
    message: string;
    context: Record<string, unknown> | undefined;
  }> = [];

  info(message: string, context?: Record<string, unknown>): void {
    this.infoMessages.push({ message, context });
  }

  warn(): void {
    // Not used by this test logger.
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.errorMessages.push({ message, context });
  }
}

const result = (claimed: number) => ({
  outbox: {
    status: "completed" as const,
    value: {
      recoveredStale: 0,
      claimed,
      processed: claimed,
      retried: 0,
      deadLettered: 0,
      staleClaims: 0,
    },
  },
  failures: [],
});

describe("outbox worker loop", () => {
  it("does not accumulate abort listeners while a long-lived worker polls", async () => {
    const controller = new AbortController();
    for (let iteration = 0; iteration < 30; iteration += 1) {
      await actualSleep(1, controller.signal);
    }
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    const pending = actualSleep(60_000, controller.signal);
    controller.abort();
    await pending;
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    await actualSleep(60_000, controller.signal);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("uses busy delay after claimed work and idle delay after empty batches", async () => {
    const logger = new MemoryLogger();
    const sleeps: number[] = [];
    const sleep: SleepPort = async (milliseconds) => {
      sleeps.push(milliseconds);
    };
    const batches = [result(2), result(0), result(1)];

    const summary = await runOutboxWorkerLoop(
      {
        signal: new AbortController().signal,
        busyDelayMs: 10,
        idleDelayMs: 100,
        errorDelayMs: 1000,
        maxIterations: 3,
      },
      {
        logger,
        sleep,
        processor: {
          processBatch: async () => batches.shift() ?? result(0),
        },
      },
    );

    expect(summary).toEqual({
      iterations: 3,
      recoveredStale: 0,
      claimed: 3,
      processed: 3,
      retried: 0,
      deadLettered: 0,
      staleClaims: 0,
      errors: 0,
    });
    expect(sleeps).toEqual([10, 100]);
  });

  it("uses busy delay after stale event recovery", async () => {
    const logger = new MemoryLogger();
    const sleeps: number[] = [];
    const batches = [
      {
        outbox: {
          status: "completed" as const,
          value: {
            recoveredStale: 1,
            claimed: 0,
            processed: 0,
            retried: 0,
            deadLettered: 0,
            staleClaims: 0,
          },
        },
        failures: [],
      },
      result(0),
    ];

    const summary = await runOutboxWorkerLoop(
      {
        signal: new AbortController().signal,
        busyDelayMs: 10,
        idleDelayMs: 100,
        errorDelayMs: 1000,
        maxIterations: 2,
      },
      {
        logger,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
        processor: {
          processBatch: async () => batches.shift() ?? result(0),
        },
      },
    );

    expect(summary.recoveredStale).toBe(1);
    expect(sleeps).toEqual([10]);
  });

  it("logs safe errors and continues polling", async () => {
    const logger = new MemoryLogger();
    const sleeps: number[] = [];
    let call = 0;
    const githubToken = "gh" + "p_secret";

    const summary = await runOutboxWorkerLoop(
      {
        signal: new AbortController().signal,
        busyDelayMs: 10,
        idleDelayMs: 100,
        errorDelayMs: 1000,
        maxIterations: 2,
      },
      {
        logger,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
        processor: {
          processBatch: async () => {
            call += 1;
            if (call === 1) {
              throw new Error(
                `failed for postgresql://user:secret@localhost/db?token=abc and ${githubToken}`,
              );
            }
            return result(0);
          },
        },
      },
    );

    expect(summary.errors).toBe(1);
    expect(summary.iterations).toBe(2);
    expect(sleeps).toEqual([1000]);
    expect(logger.errorMessages[0]?.context).toEqual({
      safeErrorSummary:
        "failed for postgresql://<redacted>@localhost/db?token=<redacted> and <redacted>",
    });
  });

  it("redacts common token shapes in worker errors", () => {
    const openAiToken = "s" + "k-secret123456";
    const githubToken = "github" + "_pat_abcdef";

    expect(
      safeWorkerErrorSummary(
        new Error(`token ${openAiToken} and ${githubToken} should not leak`),
      ),
    ).toBe("token <redacted> and <redacted> should not leak");
  });

  it("retains successful outbox counts but uses error pacing for a degraded pass", async () => {
    const logger = new MemoryLogger();
    const delays: number[] = [];
    const degraded = {
      ...result(3),
      failures: [
        { phase: "memory.maintenance", safeErrorSummary: "unavailable" },
      ],
    };
    const batches = [degraded, result(0)];
    const summary = await runOutboxWorkerLoop(
      {
        signal: new AbortController().signal,
        busyDelayMs: 10,
        idleDelayMs: 100,
        errorDelayMs: 1000,
        maxIterations: 2,
      },
      {
        logger,
        sleep: async (delay) => {
          delays.push(delay);
        },
        processor: { processBatch: async () => batches.shift()! },
      },
    );
    expect(summary).toMatchObject({ processed: 3, claimed: 3, errors: 1 });
    expect(delays).toEqual([1000]);
    expect(logger.errorMessages[0]?.context).toEqual({
      outboxStatus: "completed",
      failures: degraded.failures,
    });
  });

  it("does not fabricate outbox success when its phase failed", async () => {
    const logger = new MemoryLogger();
    const failure = {
      phase: "outbox",
      safeErrorSummary: "storage unavailable",
    };
    const delays: number[] = [];
    const summary = await runOutboxWorkerLoop(
      {
        signal: new AbortController().signal,
        busyDelayMs: 10,
        idleDelayMs: 100,
        errorDelayMs: 1000,
        maxIterations: 2,
      },
      {
        logger,
        sleep: async (delay) => {
          delays.push(delay);
        },
        processor: {
          processBatch: async () => ({
            outbox: { status: "failed", failure },
            failures: [failure],
          }),
        },
      },
    );
    expect(summary).toMatchObject({ processed: 0, claimed: 0, errors: 2 });
    expect(logger.infoMessages).toHaveLength(0);
    expect(delays).toEqual([1000]);
    expect(logger.errorMessages).toHaveLength(2);
  });

  it("reports a degraded one-shot pass as failure after preserving actual outbox evidence", async () => {
    const logger = new MemoryLogger();
    const degraded = {
      ...result(2),
      failures: [{ phase: "review_v2.due", safeErrorSummary: "unavailable" }],
    };
    await expect(
      runOutboxWorkerOnce({
        logger,
        processor: { processBatch: async () => degraded },
      }),
    ).rejects.toThrow("worker_batch_phases_failed");
    expect(logger.infoMessages[0]?.context).toMatchObject({
      processed: 2,
      claimed: 2,
    });
    expect(logger.errorMessages[0]?.context).toMatchObject({
      failures: degraded.failures,
    });
  });
});
