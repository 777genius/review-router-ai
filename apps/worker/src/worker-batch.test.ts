import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerBatchProcessor, runWorkerBatch } from "./worker-batch";
import { createReviewV2WorkerFeature } from "./review-v2-worker-runtime";

const ownerPhases = [
  ["sdkGrowthMaintenance", "sdk_growth.recovery"],
  ["processOutbox", "outbox"],
  ["pruneRateLimits", "rate_limits.retention"],
  ["pruneActionOidcReplayNonces", "action_oidc.retention"],
  ["pruneReviewSnapshots", "review_snapshots.retention"],
  ["pruneReviewExecutionCheckpoints", "review_checkpoints.retention"],
  ["reviewInvestigationMaintenance", "review_investigations.retention"],
  ["memoryMaintenance", "memory.maintenance"],
  ["pruneMemoryUsageTelemetry", "memory_usage.retention"],
  ["reviewV2Maintenance", "review_v2.maintenance"],
] as const;
const actualOutbox = {
  recoveredStale: 1,
  claimed: 3,
  processed: 2,
  retried: 1,
  deadLettered: 0,
  staleClaims: 0,
};

async function fixture(failingOwner?: string) {
  const calls: string[] = [];
  const reviewV2 = await createReviewV2WorkerFeature({
    env: {},
  }).runMaintenance();
  const operation =
    <Value>(owner: string, value: Value) =>
    async () => {
      calls.push(owner);
      if (failingOwner === owner)
        throw Object.assign(
          new Error(
            "dependency postgresql://user:secret@localhost/db?token=private-token failed",
          ),
          { cause: { privateTenantPayload: "must-not-leak" } },
        );
      return value;
    };
  return {
    calls,
    input: {
      sdkGrowthMaintenance: operation("sdkGrowthMaintenance", {
        linked: 1,
        failed: 0,
      }),
      processOutbox: operation("processOutbox", actualOutbox),
      pruneRateLimits: operation("pruneRateLimits", undefined),
      pruneActionOidcReplayNonces: operation(
        "pruneActionOidcReplayNonces",
        undefined,
      ),
      pruneReviewSnapshots: operation("pruneReviewSnapshots", undefined),
      pruneReviewExecutionCheckpoints: operation(
        "pruneReviewExecutionCheckpoints",
        undefined,
      ),
      reviewInvestigationMaintenance: operation(
        "reviewInvestigationMaintenance",
        undefined,
      ),
      memoryMaintenance: operation("memoryMaintenance", undefined),
      pruneMemoryUsageTelemetry: operation(
        "pruneMemoryUsageTelemetry",
        undefined,
      ),
      reviewV2Maintenance: operation("reviewV2Maintenance", reviewV2),
    },
    reviewV2,
  };
}

afterEach(() => vi.useRealTimers());

describe("worker owner scheduling", () => {
  it.each(ownerPhases)(
    "continues every independent owner after %s fails",
    async (owner, phase) => {
      const { input, calls } = await fixture(owner);
      const result = await runWorkerBatch(input);
      expect(calls).toEqual(ownerPhases.map(([name]) => name));
      expect(result.failures).toEqual([
        {
          phase,
          safeErrorSummary:
            "dependency postgresql://<redacted>@localhost/db?token=<redacted> failed",
        },
      ]);
      expect(JSON.stringify(result)).not.toContain("must-not-leak");
      if (owner === "processOutbox") {
        expect(result.outbox).toEqual({
          status: "failed",
          failure: result.failures[0],
        });
        expect(result.outbox).not.toHaveProperty("value");
      } else {
        expect(result.outbox).toEqual({
          status: "completed",
          value: actualOutbox,
        });
      }
    },
  );

  it("starts known owners in composition order and preserves actual results", async () => {
    const { input, calls } = await fixture();
    expect(await runWorkerBatch(input)).toEqual({
      outbox: { status: "completed", value: actualOutbox },
      failures: [],
    });
    expect(calls).toEqual(ownerPhases.map(([name]) => name));
  });

  it("preserves SDK enqueue-before-outbox order in a one-shot and awaits real settlement", async () => {
    const { input, calls } = await fixture();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    input.sdkGrowthMaintenance = async () => {
      calls.push("sdkGrowthMaintenance");
      await pending;
      return { linked: 0, failed: 0 };
    };
    const batch = runWorkerBatch(input);
    expect(calls).toEqual(["sdkGrowthMaintenance"]);
    let finished = false;
    void batch.then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await batch;
    expect(calls).toEqual(ownerPhases.map(([name]) => name));
  });

  it("retains a stuck owner across passes, observes its late failure once and recovers", async () => {
    vi.useFakeTimers();
    const { input, calls } = await fixture();
    const held = deferred<{ linked: number; failed: number }>();
    let attempts = 0;
    input.sdkGrowthMaintenance = async () => {
      attempts += 1;
      return attempts === 1 ? held.promise : { linked: 1, failed: 0 };
    };
    const processor = createWorkerBatchProcessor(input, {
      signal: new AbortController().signal,
      observationMs: 50,
    });
    for (let pass = 0; pass < 2; pass += 1) {
      const pending = processor.processBatch();
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toMatchObject({
        outbox: { status: "completed", value: actualOutbox },
        running: ["sdk_growth.recovery"],
        failures: [],
      });
    }
    expect(attempts).toBe(1);
    expect(calls.filter((value) => value === "processOutbox")).toHaveLength(2);
    held.reject(new Error("late unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    const late = await processor.processBatch();
    expect(late.failures).toEqual([
      { phase: "sdk_growth.recovery", safeErrorSummary: "late unavailable" },
    ]);
    expect(attempts).toBe(1);
    expect(await processor.processBatch()).toMatchObject({ failures: [] });
    expect(attempts).toBe(2);
    expect(await processor.drain()).toEqual({
      outbox: { status: "not_started" },
      failures: [],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds retained settlement observers while healthy owners keep advancing", async () => {
    vi.useFakeTimers();
    const { input, calls } = await fixture();
    const held = deferred<{ linked: number; failed: number }>();
    const execute = vi.fn(() => held.promise);
    input.sdkGrowthMaintenance = execute;
    const processor = createWorkerBatchProcessor(input, {
      signal: new AbortController().signal,
      observationMs: 5,
    });
    const subscriptions = new Map<Promise<unknown>, number>();
    let tracking = false;
    const then = Promise.prototype.then;
    const observe = vi.spyOn(Promise.prototype, "then").mockImplementation(
      function (this: Promise<unknown>, fulfilled, rejected) {
        if (tracking)
          subscriptions.set(this, (subscriptions.get(this) ?? 0) + 1);
        return then.call(this, fulfilled, rejected);
      },
    );
    try {
      for (let pass = 0; pass < 100; pass += 1) {
        // Track subscriptions made by the processor, excluding timer/test I/O.
        tracking = true;
        let pending: ReturnType<typeof processor.processBatch>;
        try {
          pending = processor.processBatch();
        } finally {
          tracking = false;
        }
        await vi.advanceTimersByTimeAsync(5);
        expect(await pending).toMatchObject({
          outbox: { status: "completed", value: actualOutbox },
          running: ["sdk_growth.recovery"],
          failures: [],
        });
      }
      expect(execute).toHaveBeenCalledTimes(1);
      expect(calls.filter((value) => value === "processOutbox")).toHaveLength(
        100,
      );
      expect(Math.max(0, ...subscriptions.values())).toBe(1);
    } finally {
      observe.mockRestore();
      held.resolve({ linked: 0, failed: 0 });
      await processor.drain();
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses one pass budget for multiple stuck owners and drains their actual outcomes", async () => {
    vi.useFakeTimers();
    const { input } = await fixture();
    const sdk = deferred<{ linked: number; failed: number }>();
    const outbox = deferred<typeof actualOutbox>();
    input.sdkGrowthMaintenance = () => sdk.promise;
    input.processOutbox = () => outbox.promise;
    const processor = createWorkerBatchProcessor(input, {
      signal: new AbortController().signal,
      observationMs: 40,
    });
    const pass = processor.processBatch();
    await vi.advanceTimersByTimeAsync(40);
    expect(await pass).toMatchObject({
      outbox: { status: "running" },
      running: ["sdk_growth.recovery", "outbox"],
    });
    let drained = false;
    const stopping = processor.drain().then((result) => {
      drained = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(drained).toBe(false);
    sdk.resolve({ linked: 0, failed: 0 });
    outbox.resolve(actualOutbox);
    expect(await stopping).toEqual({
      outbox: { status: "completed", value: actualOutbox },
      failures: [],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no owner after shutdown and removes its observation listener", async () => {
    const { input, calls } = await fixture();
    const stop = new AbortController();
    stop.abort();
    const processor = createWorkerBatchProcessor(input, {
      signal: stop.signal,
    });
    expect(await processor.processBatch()).toEqual({
      outbox: { status: "not_started" },
      failures: [],
    });
    expect(calls).toEqual([]);
    await processor.drain();
  });

  it("propagates resolved review-v2 degradation into the outer pass", async () => {
    const { input, calls, reviewV2 } = await fixture();
    const failure = { phase: "review_v2.due", safeErrorSummary: "unavailable" };
    input.reviewV2Maintenance = async () => {
      calls.push("reviewV2Maintenance");
      return { ...reviewV2, advanced: null, failures: [failure] };
    };
    expect(await runWorkerBatch(input)).toEqual({
      outbox: { status: "completed", value: actualOutbox },
      failures: [failure],
    });
    expect(calls).toEqual(ownerPhases.map(([name]) => name));
  });
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
