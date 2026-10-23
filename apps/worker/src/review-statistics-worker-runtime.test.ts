import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { type OutboxEvent } from "@reviewrouter/features-outbox";
import {
  ReviewStatisticsProjectionStatus,
  ReviewStatisticsSettlementState,
  StatisticsCollisionError,
} from "@reviewrouter/features-review-statistics";
import { createReviewStatisticsSettledHandler } from "./review-statistics-worker-runtime";
import { createReviewV2WorkerFeature } from "./review-v2-worker-runtime";

const payload = {
  version: 1,
  executionId: "e",
  workspaceId: "w",
  repositoryConnectionId: "r",
  scmRepositoryIdentityId: "s",
  pullRequestNumber: 1,
  finalizedArtifactId: "f",
  publicationAttemptId: "p",
  projectionHash: "a".repeat(64),
  state: ReviewStatisticsSettlementState.Completed,
  settledAt: "2026-10-23T10:00:00.000Z",
  issues: [],
};
const event = {
  type: "review.statistics.settled",
  version: 1,
  aggregateId: "e",
  workspaceId: "w",
  repositoryId: "r",
  payload,
} as OutboxEvent;
describe("independent statistics worker", () => {
  it("drains even with V2 disabled and no publisher credentials", async () => {
    const disabled = createReviewV2WorkerFeature({ env: {} });
    const project = vi.fn(async () => ReviewStatisticsProjectionStatus.Applied);
    expect(disabled.enabled).toBe(false);
    await createReviewStatisticsSettledHandler({ project }).handle(event);
    expect(project).toHaveBeenCalledWith(payload);
  });
  it("does not acknowledge before projection commits", async () => {
    let commit!: () => void;
    const finished = new Promise<void>((resolve) => {
      commit = resolve;
    });
    let acknowledged = false;
    const pending = createReviewStatisticsSettledHandler({
      project: async () => {
        await finished;
        return ReviewStatisticsProjectionStatus.Applied;
      },
    })
      .handle(event)
      .then(() => {
        acknowledged = true;
      });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    commit();
    await pending;
    expect(acknowledged).toBe(true);
  });
  it("makes immutable collisions and invalid aggregates permanent, while database failures retry", async () => {
    const project = vi.fn(async () => {
      throw new StatisticsCollisionError();
    });
    await expect(
      createReviewStatisticsSettledHandler({ project }).handle(event),
    ).rejects.toMatchObject({ retryable: false });
    await expect(
      createReviewStatisticsSettledHandler({ project }).handle({
        ...event,
        aggregateId: "other",
      }),
    ).rejects.toMatchObject({ retryable: false });
    const transient = new Error("database unavailable");
    await expect(
      createReviewStatisticsSettledHandler({
        project: async () => {
          throw transient;
        },
      }).handle(event),
    ).rejects.toBe(transient);
  });
  it("rejects an outer event belonging to a different tenant or repository", async () => {
    const project = vi.fn(async () => ReviewStatisticsProjectionStatus.Applied);
    const handler = createReviewStatisticsSettledHandler({ project });
    await expect(
      handler.handle({ ...event, workspaceId: "other" }),
    ).rejects.toMatchObject({ retryable: false });
    await expect(
      handler.handle({ ...event, repositoryId: "other" }),
    ).rejects.toMatchObject({ retryable: false });
    expect(project).not.toHaveBeenCalled();
  });
  it("registers both known and available handler outside publisher gates", async () => {
    const source = await readFile(
      new URL("./worker.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("reviewStatisticsHandlerDefinition,");
    expect(source).toContain(
      "createReviewStatisticsSettledHandler(statistics.projector)",
    );
    expect(
      source.indexOf(
        "createReviewStatisticsSettledHandler(statistics.projector)",
      ),
    ).toBeLessThan(source.indexOf("function createOutboxHandlers("));
  });
});
