import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceDraftDispatchGate,
  type DraftDispatchRepository,
} from "./review-v2-draft-dispatch-gate";
import {
  ReviewRequestEligibilityStatus,
  type ReviewRequestEligibility,
} from "./review-v2-request-ingress-handler";

const intent = {
  workspaceId: "workspace-1",
  repositoryConnectionId: "repository-1",
  pullRequestNumber: 42,
};
const repository: DraftDispatchRepository = {
  workspaceId: "workspace-1",
  fullName: "acme/widget",
  githubInstallationId: "123",
};
const current = (draft: boolean): ReviewRequestEligibility => ({
  status: ReviewRequestEligibilityStatus.Current,
  state: "open",
  draft,
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  headRepositoryFullName: "acme/widget",
  authorType: "User",
});

function fixture(input: {
  readonly reviewDrafts: boolean;
  readonly repository?: DraftDispatchRepository | null;
  readonly eligibility?: ReviewRequestEligibility;
}) {
  const findGitHubRepository = vi.fn(async () =>
    input.repository === undefined ? repository : input.repository,
  );
  const load = vi.fn(async () => input.eligibility ?? current(false));
  const gate = createWorkspaceDraftDispatchGate({
    reviewDrafts: async (workspaceId) => {
      expect(workspaceId).toBe("workspace-1");
      return input.reviewDrafts;
    },
    findGitHubRepository,
    eligibility: { load },
  });
  return { gate, findGitHubRepository, load };
}

describe("workspace draft dispatch gate", () => {
  it("dispatches without any repository or GitHub read while drafts are reviewed", async () => {
    const { gate, findGitHubRepository, load } = fixture({
      reviewDrafts: true,
      eligibility: current(true),
    });
    await expect(gate(intent)).resolves.toBe(true);
    expect(findGitHubRepository).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    "re-reads GitHub when drafts are off (draft=%s -> dispatch=%s)",
    async (draft, expected) => {
      const { gate, load } = fixture({
        reviewDrafts: false,
        eligibility: current(draft),
      });
      await expect(gate(intent)).resolves.toBe(expected);
      expect(load).toHaveBeenCalledWith({
        githubInstallationId: "123",
        repositoryFullName: "acme/widget",
        pullRequestNumber: 42,
      });
    },
  );

  it("cancels a pull request that no longer exists", async () => {
    const { gate } = fixture({
      reviewDrafts: false,
      eligibility: { status: ReviewRequestEligibilityStatus.Missing },
    });
    await expect(gate(intent)).resolves.toBe(false);
  });

  it("throws instead of cancelling when GitHub eligibility is unavailable", async () => {
    const { gate } = fixture({
      reviewDrafts: false,
      eligibility: { status: ReviewRequestEligibilityStatus.Unavailable },
    });
    await expect(gate(intent)).rejects.toThrow(
      "review_request_eligibility_unavailable",
    );
  });

  it.each([
    ["missing", null],
    ["moved to another workspace", { ...repository, workspaceId: "other" }],
  ])(
    "cancels without a GitHub read when the repository is %s",
    async (_case, found) => {
      const { gate, load } = fixture({
        reviewDrafts: false,
        repository: found,
      });
      await expect(gate(intent)).resolves.toBe(false);
      expect(load).not.toHaveBeenCalled();
    },
  );
});
