import { describe, expect, it, vi } from "vitest";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import {
  createContextIssueReader,
  linkedIssueNumbers,
} from "./context-issue-read";
const mocks = vi.hoisted(() => ({ mint: vi.fn(), request: vi.fn() }));
vi.mock("@octokit/app", () => ({
  App: vi.fn().mockImplementation(function () {
    return { octokit: { request: mocks.mint } };
  }),
}));
vi.mock("@octokit/request", () => ({ request: mocks.request }));
const authorization = {
  headSha: "a".repeat(40),
  pullRequestNumber: 7,
} as ReviewRunAuthorization;
function reader() {
  mocks.mint.mockReset().mockResolvedValue({
    data: {
      token: "server-only",
      permissions: { issues: "read", pull_requests: "read" },
    },
  });
  mocks.request.mockReset();
  return createContextIssueReader({
    appId: "1",
    privateKey: "test",
    resolveRepository: async () => ({
      githubInstallationId: "2",
      githubRepositoryId: "3",
      repositoryFullName: "owner/repo",
    }),
  });
}
describe("linked issue App read", () => {
  it("limits references to admitted repository links and local issue numbers", () => {
    expect([
      ...linkedIssueNumbers(
        "Fix #12 https://github.com/owner/repo/issues/13 other/repo#14 https://github.com/other/repo/issues/15",
        "owner/repo",
      ),
    ]).toEqual([12, 13]);
  });
  it("mints only explicit read permissions for the exact repository", async () => {
    await reader().assertAvailable(authorization);
    expect(mocks.mint).toHaveBeenCalledWith(
      "POST /app/installations/{installation_id}/access_tokens",
      expect.objectContaining({
        installation_id: 2,
        repository_ids: [3],
        permissions: { issues: "read", pull_requests: "read" },
      }),
    );
  });
  it("denies unavailable App permission without auto-changing permissions", async () => {
    const r = reader();
    mocks.mint.mockRejectedValueOnce(new Error("private error"));
    await expect(r.assertAvailable(authorization)).rejects.toMatchObject({
      code: "context_github_issues_unavailable",
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("denies unlinked issues and changed PR head before reading issue content", async () => {
    const r = reader();
    mocks.request.mockResolvedValueOnce({
      data: {
        head: { sha: authorization.headSha },
        title: "Fix #12",
        body: "",
      },
    });
    await expect(r.read(authorization, 13)).rejects.toMatchObject({
      code: "context_issue_not_linked",
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    mocks.request.mockReset().mockResolvedValueOnce({
      data: { head: { sha: "b".repeat(40) }, title: "Fix #12", body: "" },
    });
    await expect(r.read(authorization, 12)).rejects.toMatchObject({
      code: "context_revision_changed",
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("bounds untrusted issue and comment text and does not expose the App bearer", async () => {
    const r = reader();
    mocks.request
      .mockResolvedValueOnce({
        data: {
          head: { sha: authorization.headSha },
          title: "Fix #12",
          body: "",
        },
      })
      .mockResolvedValueOnce({
        data: {
          number: 12,
          title: "t".repeat(2000),
          body: "b".repeat(40000),
          html_url: "https://github.com/owner/repo/issues/12",
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            body: "c".repeat(9000),
            html_url: "https://github.com/owner/repo/issues/12#comment",
          },
        ],
      });
    const result = await r.read(authorization, 12);
    expect(result.title.length).toBe(1024);
    expect(result.body.length).toBe(32768);
    expect(result.comments[0]?.body.length).toBe(8192);
    expect(JSON.stringify(result)).not.toContain("server-only");
  });
});
