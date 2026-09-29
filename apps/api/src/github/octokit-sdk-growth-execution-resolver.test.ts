import { describe, expect, it, vi } from "vitest";
import { OctokitSdkGrowthExecutionResolver } from "./octokit-sdk-growth-execution-resolver.js";

const hex = (digit: string) => digit.repeat(40);
const input = {
  installationId: "123",
  githubRepositoryId: "456",
  repositoryFullName: "acme/repo",
  runId: "789",
  runAttempt: "2",
  verifierRevision: hex("1"),
  pullRequest: 42,
  workflowRef: "acme/repo/.github/workflows/verify.yml@refs/heads/main",
};
const pull = () => ({
  number: 42,
  state: "open",
  head: { sha: hex("2"), repo: { id: 456 } },
  base: { sha: hex("3"), ref: "main", repo: { id: 456 } },
});
const run = () => ({
  id: 789,
  run_attempt: 2,
  event: "pull_request",
  head_sha: hex("9"),
  workflow_id: 1234,
  path: ".github/workflows/verify.yml",
  repository: { id: 456, full_name: "acme/repo" },
  pull_requests: [
    { number: 42, head: { sha: hex("2") }, base: { sha: hex("3") } },
  ],
});

function resolver(
  overrides: {
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    run?: Record<string, unknown>;
    afterRun?: Record<string, unknown>;
    compare?: Record<string, unknown>;
    repository?: Record<string, unknown>;
    commit?: Record<string, unknown>;
  } = {},
) {
  let pullReads = 0;
  let runReads = 0;
  const request = vi.fn(
    async (route: string, params?: Record<string, unknown>) => {
      if (route === "GET /repos/{owner}/{repo}")
        return {
          data: { id: 456, full_name: "acme/repo", ...overrides.repository },
        };
      if (route.includes("/pulls/")) {
        pullReads += 1;
        return {
          data: {
            ...pull(),
            ...(pullReads === 1 ? overrides.before : overrides.after),
          },
        };
      }
      if (route.includes("actions/runs")) {
        runReads += 1;
        return {
          data: {
            ...run(),
            ...(runReads === 1 ? overrides.run : overrides.afterRun),
          },
        };
      }
      if (route.includes("/compare/"))
        return {
          data: {
            merge_base_commit: { sha: hex("3") },
            status: "ahead",
            ahead_by: 1,
            ...overrides.compare,
          },
        };
      if (route.includes("/git/commits/")) {
        const commitSha = String(params?.commit_sha);
        return {
          data: {
            sha: commitSha,
            tree: { sha: commitSha === hex("2") ? hex("4") : hex("5") },
            ...overrides.commit,
          },
        };
      }
      throw new Error(`Unexpected route: ${route}`);
    },
  );
  return {
    request,
    value: new OctokitSdkGrowthExecutionResolver({
      app: { getInstallationOctokit: async () => ({ request }) },
    }),
  };
}

describe("Octokit SDK growth PR source binding", () => {
  // Regression: bridge-v1 admission stored the run's synthetic merge SHA;
  // a closed PR must not make that immutable readback unreachable.
  it("resolves historical run SHA/tree without reading the closed PR", async () => {
    const subject = resolver({ before: { state: "closed" } });
    await expect(subject.value.resolveHistorical(input)).resolves.toEqual({
      installationId: input.installationId,
      runId: input.runId,
      runAttempt: input.runAttempt,
      verifierRevision: input.verifierRevision,
      pullRequest: input.pullRequest,
      sourceCommit: hex("9"),
      sourceTree: hex("5"),
    });
    expect(
      subject.request.mock.calls.some(([route]) => route.includes("/pulls/")),
    ).toBe(false);
  });

  it("holds current capture when a closed PR has a deleted fork", async () => {
    const subject = resolver({
      before: {
        state: "closed",
        head: { sha: hex("2"), repo: null },
      },
    });
    await expect(subject.value.resolve(input)).resolves.toBeNull();
    expect(
      subject.request.mock.calls.some(([route]) =>
        route.includes("actions/runs"),
      ),
    ).toBe(false);
  });

  it.each([
    { head: { sha: hex("2") } },
    { base: { sha: hex("3"), ref: "main", repo: null } },
  ])("rejects malformed open PR ownership data %#", async (before) => {
    await expect(
      resolver({ before }).value.resolve(input),
    ).rejects.toMatchObject({
      code: "binding-changed",
    });
  });

  it("accepts an empty closed-run PR list only with the signed PR ref", async () => {
    await expect(
      resolver({ run: { pull_requests: [] } }).value.resolveHistorical(input),
    ).resolves.toMatchObject({ pullRequest: 42, sourceCommit: hex("9") });
  });

  it.each([
    { run_attempt: 3 },
    { pull_requests: [{ number: 99 }] },
    {
      pull_requests: [
        { number: 42, head: { sha: hex("2") }, base: { sha: hex("3") } },
        { number: 99 },
      ],
    },
  ])("holds unrelated or ambiguous historical run %#", async (change) => {
    await expect(
      resolver({ run: change }).value.resolveHistorical(input),
    ).resolves.toBeNull();
  });

  // Regression: a pull_request run's synthetic merge SHA could be mistaken for
  // the source commit even though its PR head is a different Git object.
  it("binds selected PR head, base, direct merge base and their exact trees", async () => {
    const subject = resolver();
    await expect(subject.value.resolve(input)).resolves.toEqual({
      installationId: "123",
      runId: "789",
      runAttempt: "2",
      verifierRevision: hex("1"),
      pullRequest: 42,
      headRepositoryId: "456",
      baseRepositoryId: "456",
      baseRef: "main",
      sourceCommit: hex("2"),
      sourceTree: hex("4"),
      baseCommit: hex("3"),
      baseTree: hex("5"),
      mergeBaseCommit: hex("3"),
      mergeBaseTree: hex("5"),
    });
    expect(
      subject.request.mock.calls.filter(([route]) => route.includes("/pulls/")),
    ).toHaveLength(2);
    expect(
      subject.request.mock.calls.filter(([route]) =>
        route.includes("actions/runs"),
      ),
    ).toHaveLength(2);
  });

  // Regression: a URL selector or stale installation may refer to a different
  // selected repository, and a fork head may not be owned by this installation.
  it.each([
    { repository: { id: 999 } },
    { before: { head: { sha: hex("2"), repo: { id: 999 } } } },
    { before: { base: { sha: hex("3"), ref: "main", repo: { id: 999 } } } },
    { before: { number: 99 } },
  ])("holds wrong repository or PR identity %#", async (change) => {
    await expect(resolver(change).value.resolve(input)).resolves.toBeNull();
  });

  // Regression: a PR force push or base update during capture could combine
  // objects that never belonged to one stable PR revision.
  it.each([
    { after: { head: { sha: hex("a"), repo: { id: 456 } } } },
    { after: { base: { sha: hex("b"), ref: "main", repo: { id: 456 } } } },
    { after: { state: "closed" } },
    { afterRun: { run_attempt: 3 } },
    { afterRun: { workflow_id: 9999 } },
  ])("holds drift after capture %#", async (change) => {
    await expect(resolver(change).value.resolve(input)).resolves.toBeNull();
  });

  // Regression: run association, attempt and event can be stale or represent
  // pull_request_target / merge_group instead of the selected PR run.
  it.each([
    { run: { run_attempt: 3 } },
    { run: { event: "pull_request_target" } },
    { run: { pull_requests: [] } },
    {
      run: {
        pull_requests: [
          { number: 99, head: { sha: hex("2") }, base: { sha: hex("3") } },
        ],
      },
    },
  ])("holds unrelated run %#", async (change) => {
    await expect(resolver(change).value.resolve(input)).resolves.toBeNull();
  });

  // Regression: the singular REST merge_base_commit could hide multiple merge
  // bases in a diverged graph; only direct ancestry is qualified here.
  it("holds a diverged graph with an unproven unique merge base", async () => {
    await expect(
      resolver({
        compare: { merge_base_commit: { sha: hex("8") } },
      }).value.resolve(input),
    ).resolves.toBeNull();
  });

  it.each([
    { merge_base_commit: { sha: hex("2") }, status: "behind", ahead_by: 0 },
    { merge_base_commit: { sha: hex("3") }, status: "identical", ahead_by: 0 },
  ])("holds behind-only or identical PR graph %#", async (compare) => {
    await expect(
      resolver({ compare }).value.resolve(input),
    ).resolves.toBeNull();
  });

  // Regression: a commit lookup with wrong object/tree cannot attest the
  // independently selected source bytes.
  it("holds a commit API response for another object", async () => {
    await expect(
      resolver({ commit: { sha: hex("f") } }).value.resolve(input),
    ).resolves.toBeNull();
  });
});
