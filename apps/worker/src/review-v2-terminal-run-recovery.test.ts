import { describe, it, expect, vi } from "vitest";
import { ReviewExecutionLifecycleTransitionStatus } from "@reviewrouter/features-review-executions";
import { ReviewV2TerminalRunRecovery } from "./review-v2-terminal-run-recovery";

describe("terminal workflow recovery", () => {
  const execution = {
    executionId: "execution",
    authorizationId: "auth",
    sourceRunId: "123",
    sourceRunAttempt: "1",
    workspaceId: "workspace",
    repositoryConnectionId: "repo",
    scmRepositoryIdentityId: "scm",
    pullRequestNumber: 1,
  };
  const snapshot = { execution, stream: { version: 4n } };
  const intent = {
    executionId: "execution",
    authorizationId: "auth",
    sourceRunId: "123",
    sourceRunAttempt: "1",
  };
  const clock = { now: () => new Date("2026-11-10T12:00:00Z") };
  it("passes exact attempt and stream fence only after a failed source was observed", async () => {
    const executions = {
      listRevokedRunning: vi.fn().mockResolvedValue([snapshot]),
      failObservedTerminalRunningExecution: vi
        .fn()
        .mockResolvedValue({
          status: ReviewExecutionLifecycleTransitionStatus.Applied,
        }),
    };
    const intents = {
      findBySourceRunIdentity: vi.fn().mockResolvedValue(intent),
    };
    const gateway = {
      isFailedTerminalAttempt: vi.fn().mockResolvedValue(true),
    };
    const recovery = new ReviewV2TerminalRunRecovery(
      executions as never,
      intents as never,
      gateway as never,
      clock,
    );
    expect(await recovery.execute({ limit: 10 })).toMatchObject({
      scanned: 1,
      recovered: 1,
    });
    expect(
      executions.failObservedTerminalRunningExecution,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRunId: "123",
        sourceRunAttempt: "1",
        authorizationId: "auth",
        expectedStreamVersion: 4n,
      }),
    );
  });
  it.each(["live_or_success", "attempt_changed", "authority_changed"] as const)(
    "does not mutate when %s",
    async (reason) => {
      const executions = {
        listRevokedRunning: vi.fn().mockResolvedValue([snapshot]),
        failObservedTerminalRunningExecution: vi
          .fn()
          .mockResolvedValue({
            status:
              ReviewExecutionLifecycleTransitionStatus.ConcurrencyConflict,
          }),
      };
      const intents = {
        findBySourceRunIdentity: vi
          .fn()
          .mockResolvedValue(
            reason === "authority_changed"
              ? { ...intent, authorizationId: "other" }
              : intent,
          ),
      };
      const gateway = {
        isFailedTerminalAttempt:
          reason === "attempt_changed"
            ? vi.fn().mockRejectedValue(new Error("attempt mismatch"))
            : vi.fn().mockResolvedValue(false),
      };
      const recovery = new ReviewV2TerminalRunRecovery(
        executions as never,
        intents as never,
        gateway as never,
        clock,
      );
      await recovery.execute({ limit: 10 });
      expect(
        executions.failObservedTerminalRunningExecution,
      ).not.toHaveBeenCalled();
    },
  );
  it("reports a stream-version race without retrying or modifying the newer execution", async () => {
    const executions = {
      listRevokedRunning: vi.fn().mockResolvedValue([snapshot]),
      failObservedTerminalRunningExecution: vi
        .fn()
        .mockResolvedValue({
          status: ReviewExecutionLifecycleTransitionStatus.ConcurrencyConflict,
        }),
    };
    const recovery = new ReviewV2TerminalRunRecovery(
      executions as never,
      { findBySourceRunIdentity: vi.fn().mockResolvedValue(intent) } as never,
      { isFailedTerminalAttempt: vi.fn().mockResolvedValue(true) } as never,
      clock,
    );
    expect(await recovery.execute({ limit: 10 })).toMatchObject({
      recovered: 0,
      conflicts: 1,
    });
    expect(
      executions.failObservedTerminalRunningExecution,
    ).toHaveBeenCalledTimes(1);
  });
});
