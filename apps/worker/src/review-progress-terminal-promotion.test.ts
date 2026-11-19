import { describe, expect, it, vi } from "vitest";
import {
  ReviewProgressTerminalPromotion,
  type ReviewProgressPromotionStore,
} from "./review-progress-terminal-promotion";

const now = new Date("2026-08-12T12:00:00.000Z");
const cursor = {
  workspaceId: "workspace-1",
  repositoryConnectionId: "repository-1",
  scmRepositoryIdentityId: "identity-1",
  pullRequestNumber: 2,
};

function fakeStore() {
  return {
    scanPromotionCandidates: vi.fn<
      ReviewProgressPromotionStore["scanPromotionCandidates"]
    >(async () => ({ executionIds: [], nextCursor: null })),
    promoteSettledExecutions: vi.fn<
      ReviewProgressPromotionStore["promoteSettledExecutions"]
    >(async ({ executionIds }) => executionIds.length),
  };
}

function promotion(
  store: ReturnType<typeof fakeStore>,
  options: { pageSize?: number } = {},
) {
  const logger = { warn: vi.fn() };
  return {
    logger,
    promotion: new ReviewProgressTerminalPromotion(
      store,
      { now: () => now },
      { ...options, logger },
    ),
  };
}

describe("ReviewProgressTerminalPromotion", () => {
  it("promotes a settled review whose hint was lost", async () => {
    const store = fakeStore();
    store.scanPromotionCandidates.mockResolvedValueOnce({
      executionIds: ["execution-lost", "execution-1"],
      nextCursor: null,
    });

    await expect(
      promotion(store).promotion.promote([
        { executionId: "execution-1", outcome: "succeeded" },
      ]),
    ).resolves.toBe(2);
    expect(
      store.promoteSettledExecutions.mock.calls.map(([input]) => input),
    ).toEqual([
      { executionIds: ["execution-lost"], now },
      { executionIds: ["execution-1"], now },
    ]);
  });

  it("walks every page and starts the next pass from the first key", async () => {
    const store = fakeStore();
    store.scanPromotionCandidates
      .mockResolvedValueOnce({ executionIds: [], nextCursor: cursor })
      .mockResolvedValueOnce({ executionIds: [], nextCursor: null });
    const { promotion: sweep } = promotion(store, { pageSize: 2 });

    await sweep.promote([]);
    await sweep.promote([]);
    await sweep.promote([]);
    expect(
      store.scanPromotionCandidates.mock.calls.map(([input]) => input),
    ).toEqual([
      { after: null, limit: 2 },
      { after: cursor, limit: 2 },
      { after: null, limit: 2 },
    ]);
  });

  it("still promotes this pass's settlements and keeps its place when the sweep read fails", async () => {
    const store = fakeStore();
    const scanFailure = new Error("scan_unavailable");
    store.scanPromotionCandidates
      .mockResolvedValueOnce({ executionIds: [], nextCursor: cursor })
      .mockRejectedValueOnce(scanFailure);
    const { promotion: sweep } = promotion(store);

    await sweep.promote([]);
    await expect(
      sweep.promote([{ executionId: "execution-1", outcome: "failed" }]),
    ).rejects.toBe(scanFailure);
    expect(store.promoteSettledExecutions).toHaveBeenLastCalledWith({
      executionIds: ["execution-1"],
      now,
    });
    await sweep.promote([]);
    expect(store.scanPromotionCandidates).toHaveBeenLastCalledWith({
      after: cursor,
      limit: 100,
    });
  });

  it("logs a swept candidate that cannot be promoted instead of failing every pass", async () => {
    const store = fakeStore();
    store.scanPromotionCandidates.mockResolvedValue({
      executionIds: ["execution-poison", "execution-ok"],
      nextCursor: null,
    });
    store.promoteSettledExecutions.mockImplementation(
      async ({ executionIds }) => {
        if (executionIds.includes("execution-poison"))
          throw new Error("review_progress_snapshot_invalid");
        return executionIds.length;
      },
    );
    const { promotion: sweep, logger } = promotion(store);

    await expect(sweep.promote([])).resolves.toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Review progress sweep could not promote a review",
      {
        executionId: "execution-poison",
        safeErrorSummary: "review_progress_snapshot_invalid",
      },
    );

    // The same failure from this pass's own settlement still fails the phase.
    await expect(
      sweep.promote([{ executionId: "execution-poison", outcome: "failed" }]),
    ).rejects.toThrow("review_progress_snapshot_invalid");
  });
});
