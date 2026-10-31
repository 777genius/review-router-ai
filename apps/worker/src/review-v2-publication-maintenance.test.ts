import { describe, expect, it, vi } from "vitest";
import {
  ReviewPublicationTerminalOutcome,
  type ReviewPublicationDueWork,
} from "@reviewrouter/features-review-publishing/v2";
import {
  ReviewV2PublicationExecutionStatus,
  ReviewV2ScmProvider,
  type ReviewV2PublicationExecutionCommand,
  type ReviewV2PublicationExecutionResult,
} from "./review-v2-publication-ports";
import {
  ReviewV2PublicationMaintenance,
  publicationWorkProvider,
  progressOutcome,
} from "./review-v2-publication-maintenance";

const now = new Date("2026-07-23T12:00:00.000Z");
const ownerIdHash = "e".repeat(64);

function work(id: string): ReviewPublicationDueWork {
  return {
    executionId: `execution-${id}`,
    publicationAttemptId: `attempt-${id}`,
    publicationOperationId: `operation-${id}`,
    provider: "github",
    retryCount: 0,
  };
}

function harness(
  due: readonly ReviewPublicationDueWork[],
  execute: (
    command: ReviewV2PublicationExecutionCommand,
  ) => Promise<ReviewV2PublicationExecutionResult>,
) {
  const scan = vi.fn(async () => due);
  const defer = vi.fn(async () => {});
  const executor = { execute: vi.fn(execute) };
  const maintenance = new ReviewV2PublicationMaintenance(
    { scan, defer },
    executor,
    { now: () => now },
    ownerIdHash,
    { limit: 10, minimumRetryMs: 5_000 },
  );
  return { scan, defer, executor, maintenance };
}

describe("Review V2 publication maintenance", () => {
  it(
    "continues past a throwing executor without inventing its settlement",
    async () => {
      const calls: string[] = [];
      const f = harness([work("1"), work("2"), work("3")], async (command) => {
        calls.push(command.publicationOperationId);
        if (command.publicationOperationId === "operation-2")
          throw new Error("dependency github_pat_private123 unavailable");
        return {
          status: ReviewV2PublicationExecutionStatus.Completed,
          safeReason: "publication_operation_completed",
        };
      });

      await expect(f.maintenance.runMaintenance()).resolves.toEqual({
        processed: 2,
        manualRequired: 0,
        terminalUnknown: 0,
        settledExecutionIds: ["execution-1", "execution-3"],
        progressSettlements: [
          { executionId: "execution-1", outcome: "succeeded" },
          { executionId: "execution-3", outcome: "succeeded" },
        ],
        itemFailures: [
          {
            phase: "review_v2.publication_item",
            safeErrorSummary: "dependency <redacted> unavailable",
          },
        ],
      });
      expect(calls).toEqual(["operation-1", "operation-2", "operation-3"]);
      expect(f.defer).toHaveBeenCalledExactlyOnceWith({
        work: work("2"),
        nextEligibleAt: new Date(now.getTime() + 5_000),
        lastErrorCode: "publication_executor_unexpected_failure",
      });
    },
  );

  it(
    "keeps retry CAS failure visible and still executes the next item",
    async () => {
      const f = harness([work("1"), work("2")], async (command) => ({
        status:
          command.publicationOperationId === "operation-1"
            ? ReviewV2PublicationExecutionStatus.Retryable
            : ReviewV2PublicationExecutionStatus.Completed,
        safeReason: "provider_temporarily_unavailable",
      }));
      f.defer.mockRejectedValueOnce(
        new Error("defer github_pat_private123 unavailable"),
      );

      const result = await f.maintenance.runMaintenance();
      expect(result).toEqual({
        processed: 2,
        manualRequired: 0,
        terminalUnknown: 0,
        settledExecutionIds: ["execution-2"],
        progressSettlements: [
          { executionId: "execution-2", outcome: "succeeded" },
        ],
        itemFailures: [
          {
            phase: "review_v2.publication_defer",
            safeErrorSummary: "defer <redacted> unavailable",
          },
        ],
      });
      expect(f.defer).toHaveBeenCalledExactlyOnceWith({
        work: work("1"),
        nextEligibleAt: new Date(now.getTime() + 5_000),
        lastErrorCode: "provider_temporarily_unavailable",
      });
      expect(f.executor.execute).toHaveBeenCalledTimes(2);
    },
  );

  it(
    "records both an uncertain execution and its failed defer without skipping other work",
    async () => {
      const f = harness([work("1"), work("2")], async (command) => {
        if (command.publicationOperationId === "operation-1")
          throw new Error("gateway_crashed");
        return {
          status: ReviewV2PublicationExecutionStatus.Completed,
          safeReason: "done",
        };
      });
      f.defer.mockRejectedValueOnce(new Error("database unavailable"));
      const result = await f.maintenance.runMaintenance();
      expect(result.processed).toBe(1);
      expect(result.settledExecutionIds).toEqual(["execution-2"]);
      expect(result.itemFailures).toEqual([
        {
          phase: "review_v2.publication_item",
          safeErrorSummary: "gateway_crashed",
        },
        {
          phase: "review_v2.publication_defer",
          safeErrorSummary: "database unavailable",
        },
      ]);
      expect(f.executor.execute).toHaveBeenCalledTimes(2);
    },
  );

  it(
    "preserves highest-risk terminal outcome, deterministic order and defers",
    async () => {
      const due = [
        { ...work("z"), executionId: "execution-shared" },
        { ...work("a"), executionId: "execution-shared" },
        { ...work("b"), executionId: "execution-shared" },
        work("unknown"),
        work("manual"),
      ];
      const f = harness(due, async (command) => {
        switch (command.publicationOperationId) {
          case "operation-z":
            return {
              status: ReviewV2PublicationExecutionStatus.Completed,
              safeReason: "done",
            };
          case "operation-a":
            return {
              status: ReviewV2PublicationExecutionStatus.Terminalized,
              terminalOutcome:
                ReviewPublicationTerminalOutcome.SupersededNoEffect,
              safeReason: "superseded",
            };
          case "operation-b":
            return {
              status: ReviewV2PublicationExecutionStatus.Terminalized,
              terminalOutcome: ReviewPublicationTerminalOutcome.FailedNoEffect,
              safeReason: "failed",
            };
          case "operation-unknown":
            return {
              status: ReviewV2PublicationExecutionStatus.TerminalUnknown,
              safeReason: "unknown",
            };
          default:
            return {
              status: ReviewV2PublicationExecutionStatus.ManualRequired,
              safeReason: "manual",
            };
        }
      });
      const result = await f.maintenance.runMaintenance();
      expect(result).toEqual({
        processed: 5,
        manualRequired: 1,
        terminalUnknown: 1,
        settledExecutionIds: ["execution-shared"],
        progressSettlements: [
          { executionId: "execution-shared", outcome: "failed" },
        ],
        itemFailures: [],
      });
      expect(f.defer).toHaveBeenCalledTimes(2);
      expect(publicationWorkProvider("gitlab")).toBe(ReviewV2ScmProvider.GitLab);
      expect(
        progressOutcome({
          status: ReviewV2PublicationExecutionStatus.TerminalUnknown,
          safeReason: "unknown",
        }),
      ).toBeNull();
    },
  );

  it("keeps a global feed scan failure as a hard phase failure", async () => {
    const f = harness([work("1")], async () => ({
      status: ReviewV2PublicationExecutionStatus.Completed,
      safeReason: "done",
    }));
    f.scan.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(f.maintenance.runMaintenance()).rejects.toThrow(
      "database unavailable",
    );
    expect(f.executor.execute).not.toHaveBeenCalled();
  });
});
