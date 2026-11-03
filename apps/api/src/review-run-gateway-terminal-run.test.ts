import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
const github = vi.hoisted(() => ({ request: vi.fn(), installation: vi.fn() }));
vi.mock("@octokit/app", () => ({
  App: class {
    async getInstallationOctokit(id: number) {
      github.installation(id);
      return {
        request: Object.assign(github.request, {
          defaults: () => github.request,
        }),
      };
    }
  },
}));
import { createReviewRunGatewayTerminalRunReader } from "./review-run-gateway-terminal-run";
const authorization = {
  sourceRunId: "456",
  sourceRunAttempt: "2",
  headSha: "a".repeat(40),
} as ReviewRunAuthorization;
const target = {
  githubInstallationId: "789",
  githubRepositoryId: "123",
  repositoryFullName: "test/repository",
};
const signal = new AbortController().signal;
const data = () => ({
  id: 456,
  repository: { id: 123, full_name: "test/repository" },
  run_attempt: 2,
  event: "workflow_dispatch",
  path: ".github/workflows/reviewrouter-review.yml",
  head_sha: "b".repeat(40),
  status: "completed",
  conclusion: "failure",
});
const reader = createReviewRunGatewayTerminalRunReader({
  appId: "1",
  privateKey: "fixture",
  resolveRepository: async () => target,
});
beforeEach(() => {
  github.request.mockReset();
  github.installation.mockReset();
});
describe("retained Gateway source-run terminal proof", () => {
  it("uses App custody and original run attempt; dispatch head is not PR head", async () => {
    github.request.mockResolvedValue({ data: data() });
    await expect(reader(authorization, { signal })).resolves.toBe(true);
    expect(github.installation).toHaveBeenCalledWith(789);
    expect(github.request).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
      {
        owner: "test",
        repo: "repository",
        run_id: 456,
        attempt_number: 2,
        request: { signal, timeout: 5000 },
      },
    );
  });
  it.each([
    { id: 457 },
    { repository: { id: 124, full_name: "test/repository" } },
    { repository: { id: 123, full_name: "another/repository" } },
    { run_attempt: 3 },
    { status: "in_progress", conclusion: null },
    { event: "pull_request" },
    { path: ".github/workflows/unrelated.yml" },
    { conclusion: null },
    { conclusion: "unknown" },
    { conclusion: "success" },
    { conclusion: "neutral" },
    { conclusion: "skipped" },
  ])(
    "does not accept another identity or nonterminal run: %j",
    async (change) => {
      github.request.mockResolvedValue({ data: { ...data(), ...change } });
      await expect(reader(authorization, { signal })).resolves.toBe(false);
    },
  );
  it("retains custody on denied GitHub access", async () => {
    github.request.mockRejectedValue(new Error("fixture permission denied"));
    await expect(reader(authorization, { signal })).rejects.toThrow();
  });
  it("does no remote read for missing scope or cancelled pressure cleanup", async () => {
    const missing = createReviewRunGatewayTerminalRunReader({
      appId: "1",
      privateKey: "fixture",
      resolveRepository: async () => null,
    });
    expect(await missing(authorization, { signal })).toBe(false);
    expect(await reader(authorization, { signal: AbortSignal.abort() })).toBe(
      false,
    );
    expect(github.request).not.toHaveBeenCalled();
  });
});
