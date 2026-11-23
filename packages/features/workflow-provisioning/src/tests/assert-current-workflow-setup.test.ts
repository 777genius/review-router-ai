import { describe, expect, it, vi } from "vitest";
import {
  assertCurrentWorkflowSetup,
  type AssertCurrentWorkflowSetupInput,
} from "../application/use-cases/assert-current-workflow-setup.js";
import type { CurrentWorkflowSetupQueryPort } from "../application/ports/current-workflow-setup-query-port.js";
import type { CurrentWorkflowSetupAttempt } from "../domain/workflow-setup-authority.js";

const current: CurrentWorkflowSetupAttempt = {
  workspaceId: "workspace_1",
  installationId: "installation_1",
  attemptId: "attempt_1",
  revision: 7,
  pullRequestHeadSha: "a".repeat(40),
  branch: "reviewrouter/setup",
  pullRequestUrl: "https://github.com/acme/widget/pull/7",
  workflowPath: ".github/workflows/reviewrouter-review.yml",
  workflowStyle: "reusable",
  actionVersion: "workflow-v1",
};
const input: AssertCurrentWorkflowSetupInput = {
  scope: {
    workspaceId: current.workspaceId,
    repositoryId: "repository_1",
    installationId: current.installationId,
  },
  expectedBaseBranch: "main",
  expectedAttempt: current,
  historicalMergedSetupPullRequest: false,
  verifiedArtifact: {
    workflowPath: current.workflowPath,
    workflowStyle: current.workflowStyle,
    actionVersion: current.actionVersion,
  },
};

function queryFixture() {
  return {
    findEligibleRepository:
      vi.fn<CurrentWorkflowSetupQueryPort["findEligibleRepository"]>()
        .mockResolvedValue({ defaultBranch: "main" }),
    findCurrentAttempt:
      vi.fn<CurrentWorkflowSetupQueryPort["findCurrentAttempt"]>()
        .mockResolvedValue(current),
  };
}

describe("current workflow setup application authority", () => {
  it("waits for the scoped repository read before reading the attempt", async () => {
    const query = queryFixture();
    let releaseRepository!: (
      value: Readonly<{ defaultBranch: string }> | null,
    ) => void;
    const repositoryRead = new Promise<
      Readonly<{ defaultBranch: string }> | null
    >((resolve) => {
      releaseRepository = resolve;
    });
    query.findEligibleRepository.mockReturnValueOnce(repositoryRead);

    const result = assertCurrentWorkflowSetup(input, { query });

    expect(query.findEligibleRepository).toHaveBeenCalledWith(input.scope);
    expect(query.findCurrentAttempt).not.toHaveBeenCalled();
    releaseRepository({ defaultBranch: "main" });
    await expect(result).resolves.toBeUndefined();
    expect(query.findCurrentAttempt).toHaveBeenCalledTimes(1);
    expect(query.findCurrentAttempt).toHaveBeenCalledWith(input.scope.repositoryId);
  });

  it("denies a vanished or ineligible repository after the same two reads", async () => {
    const query = queryFixture();
    query.findEligibleRepository.mockResolvedValueOnce(null);

    await expect(assertCurrentWorkflowSetup(input, { query })).rejects.toThrow(
      "workflow_provisioning_match_not_found",
    );
    expect(query.findCurrentAttempt).toHaveBeenCalledTimes(1);
    expect(query.findCurrentAttempt).toHaveBeenCalledWith(input.scope.repositoryId);
  });

  it("rejects an attempt from another workspace even when the repository exists", async () => {
    const query = queryFixture();
    query.findCurrentAttempt.mockResolvedValueOnce({
      ...current,
      workspaceId: "workspace_2",
    });

    await expect(assertCurrentWorkflowSetup(input, { query })).rejects.toThrow(
      "workflow_provisioning_match_not_found",
    );
  });

  it("re-reads authority and rejects a replacement made during an external probe", async () => {
    const query = queryFixture();
    query.findCurrentAttempt
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({
        ...current,
        attemptId: "attempt_2",
        revision: 8,
      });

    await expect(
      assertCurrentWorkflowSetup(input, { query }),
    ).resolves.toBeUndefined();
    await expect(assertCurrentWorkflowSetup(input, { query })).rejects.toThrow(
      "workflow_provisioning_match_not_found",
    );
    expect(query.findEligibleRepository).toHaveBeenCalledTimes(2);
    expect(query.findCurrentAttempt).toHaveBeenCalledTimes(2);
  });

  it("rejects a newly created attempt when recovery observed no attempt", async () => {
    const query = queryFixture();

    await expect(
      assertCurrentWorkflowSetup(
        { ...input, expectedAttempt: null },
        { query },
      ),
    ).rejects.toThrow("workflow_provisioning_match_not_found");
  });

  it("propagates a repository read failure without starting the second read", async () => {
    const query = queryFixture();
    const failure = new Error("repository_read_failed");
    query.findEligibleRepository.mockRejectedValueOnce(failure);

    await expect(assertCurrentWorkflowSetup(input, { query })).rejects.toBe(
      failure,
    );
    expect(query.findEligibleRepository).toHaveBeenCalledTimes(1);
    expect(query.findCurrentAttempt).not.toHaveBeenCalled();
  });

  it("propagates an attempt read failure without treating it as missing state", async () => {
    const query = queryFixture();
    const failure = new Error("attempt_read_failed");
    query.findCurrentAttempt.mockRejectedValueOnce(failure);

    await expect(assertCurrentWorkflowSetup(input, { query })).rejects.toBe(
      failure,
    );
    expect(query.findEligibleRepository).toHaveBeenCalledTimes(1);
    expect(query.findCurrentAttempt).toHaveBeenCalledTimes(1);
  });
});
