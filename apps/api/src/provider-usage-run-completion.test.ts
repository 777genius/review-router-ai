import { describe, it, expect, vi } from "vitest";
const source = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@octokit/app", () => ({
  App: class {
    async getInstallationOctokit() {
      return { request: source.request };
    }
  },
}));
import { createProviderUsageRunCompletion } from "./provider-usage-run-completion";
const scope = {
  repositoryId: "123",
  runId: "456",
  runAttempt: 2,
  githubInstallationId: "789",
  repositoryFullName: "test/repository",
};
const resolve = createProviderUsageRunCompletion({
  appId: "1",
  privateKey: "synthetic",
});
describe("App-owned usage completion boundary", () => {
  it("uses completion of the exact run attempt and latest completed job", async () => {
    const early = new Date(Date.now() - 5000).toISOString(),
      late = new Date(Date.now() - 1000).toISOString();
    source.request
      .mockReset()
      .mockResolvedValueOnce({
        data: {
          id: 456,
          repository: { id: 123 },
          run_attempt: 2,
          status: "completed",
        },
      })
      .mockResolvedValueOnce({
        data: {
          total_count: 2,
          jobs: [{ completed_at: early }, { completed_at: late }],
        },
      });
    expect((await resolve(scope))?.toISOString()).toBe(late);
    expect(source.request.mock.calls[0]?.[1]).toMatchObject({
      run_id: 456,
      attempt_number: 2,
    });
  });
  it("refuses another run attempt instead of trusting a name or run ID alone", async () => {
    source.request.mockReset().mockResolvedValueOnce({
      data: {
        id: 456,
        repository: { id: 123 },
        run_attempt: 3,
        status: "completed",
      },
    });
    await expect(resolve(scope)).rejects.toThrow("usage_scope_mismatch");
    expect(source.request).toHaveBeenCalledTimes(1);
  });
  it("does not turn an unfinished run into a closed invocation", async () => {
    source.request.mockReset().mockResolvedValueOnce({
      data: {
        id: 456,
        repository: { id: 123 },
        run_attempt: 2,
        status: "in_progress",
      },
    });
    expect(await resolve(scope)).toBeNull();
    expect(source.request).toHaveBeenCalledTimes(1);
  });
});
