import { describe, expect, it, vi } from "vitest";
import { OctokitSdkGrowthExecutionResolver } from "./octokit-sdk-growth-execution-resolver.js";

const input = {
  installationId: "123",
  githubRepositoryId: "456",
  repositoryFullName: "acme/repo",
  runId: "789",
  runAttempt: "2",
  verifierRevision: "1".repeat(40),
};

function resolver(
  change: Record<string, unknown> = {},
  commitChange: Record<string, unknown> = {},
) {
  const request = vi.fn(async (route: string) => {
    if (route.includes("actions/runs"))
      return {
        data: {
          id: 789,
          run_attempt: 2,
          head_sha: "2".repeat(40),
          repository: { id: 456, full_name: "acme/repo" },
          ...change,
        },
      };
    return {
      data: {
        sha: "2".repeat(40),
        tree: { sha: "3".repeat(40) },
        ...commitChange,
      },
    };
  });
  return {
    request,
    value: new OctokitSdkGrowthExecutionResolver({
      app: { getInstallationOctokit: async () => ({ request }) },
    }),
  };
}

describe("Octokit SDK growth execution resolver", () => {
  it("resolves run, repository, attempt, commit and tree through the installation", async () => {
    const subject = resolver();
    await expect(subject.value.resolve(input)).resolves.toEqual({
      installationId: "123",
      runId: "789",
      runAttempt: "2",
      verifierRevision: "1".repeat(40),
      sourceCommit: "2".repeat(40),
      sourceTree: "3".repeat(40),
    });
    expect(subject.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    { id: 999 },
    { run_attempt: 3 },
    { head_sha: "invalid" },
    { repository: { id: 999, full_name: "acme/repo" } },
    { repository: { id: 456, full_name: "other/repo" } },
  ])("rejects mismatched provider execution %#", async (change) => {
    await expect(resolver(change).value.resolve(input)).resolves.toBeNull();
  });

  it("rejects noncanonical numeric and repository identities before I/O", async () => {
    const subject = resolver();
    await expect(
      subject.value.resolve({ ...input, installationId: "01" }),
    ).rejects.toMatchObject({ code: "wrong-identity" });
    await expect(
      subject.value.resolve({
        ...input,
        repositoryFullName: "acme/repo/extra",
      }),
    ).rejects.toMatchObject({ code: "wrong-identity" });
    expect(subject.request).not.toHaveBeenCalled();
  });

  it.each([
    { sha: "4".repeat(40) },
    { sha: undefined },
    { tree: { sha: "invalid" } },
  ])(
    "rejects commit/tree evidence that does not bind the run head %#",
    async (change) => {
      await expect(
        resolver({}, change).value.resolve(input),
      ).resolves.toBeNull();
    },
  );
});
