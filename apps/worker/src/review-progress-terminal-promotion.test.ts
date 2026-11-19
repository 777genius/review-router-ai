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

describe("ReviewProgressTerminalPromotion", () => {
  it("promotes a settled review whose hint was lost", async () => {
    const store = fakeStore();
    store.scanPromotionCandidates.mockResolvedValueOnce({
      executionIds: ["execution-lost"],
      nextCursor: null,
    });
    const promotion = new ReviewProgressTerminalPromotion(store, {
      now: () => now,
    });

    await expect(
      promotion.promote([{ executionId: "execution-1", outcome: "succeeded" }]),
    ).resolves.toBe(2);
    expect(store.promoteSettledExecutions).toHaveBeenCalledWith({
      executionIds: ["execution-1", "execution-lost"],
      now,
    });
  });

  it("walks every page and starts the next pass from the first key", async () => {
    const store = fakeStore();
    store.scanPromotionCandidates
      .mockResolvedValueOnce({ executionIds: [], nextCursor: cursor })
      .mockResolvedValueOnce({ executionIds: [], nextCursor: null });
    const promotion = new ReviewProgressTerminalPromotion(
      store,
      { now: () => now },
      2,
    );

    await promotion.promote([]);
    await promotion.promote([]);
    await promotion.promote([]);
    expect(
      store.scanPromotionCandidates.mock.calls.map(([input]) => input),
    ).toEqual([
      { after: null, limit: 2 },
      { after: cursor, limit: 2 },
      { after: null, limit: 2 },
    ]);
  });

  it("still promotes this pass's settlements when the sweep read fails", async () => {
    const store = fakeStore();
    const scanFailure = new Error("scan_unavailable");
    store.scanPromotionCandidates
      .mockRejectedValueOnce(scanFailure)
      .mockResolvedValueOnce({ executionIds: [], nextCursor: null });
    const promotion = new ReviewProgressTerminalPromotion(store, {
      now: () => now,
    });

    await expect(
      promotion.promote([{ executionId: "execution-1", outcome: "failed" }]),
    ).rejects.toBe(scanFailure);
    expect(store.promoteSettledExecutions).toHaveBeenCalledWith({
      executionIds: ["execution-1"],
      now,
    });
    // The failed read did not move the cursor past unseen scopes.
    await promotion.promote([]);
    expect(store.scanPromotionCandidates).toHaveBeenLastCalledWith({
      after: null,
      limit: 100,
    });
  });
});
