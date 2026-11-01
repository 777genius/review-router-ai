import { describe, expect, it } from "vitest";
import { runWorkerBatch } from "./worker-batch";
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

  it("keeps serial order and actual results on a healthy pass", async () => {
    const { input, calls } = await fixture();
    expect(await runWorkerBatch(input)).toEqual({
      outbox: { status: "completed", value: actualOutbox },
      failures: [],
    });
    expect(calls).toEqual(ownerPhases.map(([name]) => name));
  });

  it("waits for each owner before starting the next one", async () => {
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
    release();
    await batch;
    expect(calls).toEqual(ownerPhases.map(([name]) => name));
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
