import { describe, expect, it, vi } from "vitest";
import { OctokitCertifiedForkWorkflowRunResolver } from "./octokit-certified-fork-workflow-run-resolver.js";

describe("certified fork workflow run resolver", () => {
  it("uses a bounded GitHub request and verifies the exact run identity", async () => {
    const request = vi.fn(async () => ({
      data: {
        event: "pull_request_target",
        run_attempt: 2,
        repository: { id: 99 },
        pull_requests: [{ number: 42 }],
      },
    }));
    const resolver = new OctokitCertifiedForkWorkflowRunResolver({
      app: { getInstallationOctokit: () => ({ request }) },
    });
    await expect(
      resolver.resolveWorkflowRunPullRequest({
        repository: {
          githubInstallationId: "7",
          githubRepositoryId: "99",
          fullName: "owner/example",
          owner: "owner",
        },
        githubRunId: "700",
        githubRunAttempt: "2",
        eventName: "pull_request_target",
        expectedPullRequestNumber: 42,
      }),
    ).resolves.toBe(42);
    expect(request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
      expect.objectContaining({ request: { timeout: 15_000 } }),
    );
  });

  it("uses the expected PR when GitHub omits fork run associations", async () => {
    const resolver = new OctokitCertifiedForkWorkflowRunResolver({
      app: {
        getInstallationOctokit: () => ({
          request: vi.fn(async () => ({
            data: {
              event: "pull_request_target",
              run_attempt: 1,
              repository: { id: 99 },
              pull_requests: [],
            },
          })),
        }),
      },
    });

    await expect(
      resolver.resolveWorkflowRunPullRequest({
        repository: {
          githubInstallationId: "7",
          githubRepositoryId: "99",
          fullName: "owner/example",
          owner: "owner",
        },
        githubRunId: "700",
        githubRunAttempt: "1",
        eventName: "pull_request_target",
        expectedPullRequestNumber: 42,
      }),
    ).resolves.toBe(42);
  });
});
