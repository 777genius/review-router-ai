import { describe, expect, it, vi } from "vitest";
import {
  assertRepositoryVisibleToGitHubApp,
  checkProviderSecretAvailability,
  githubApiStatus,
} from "./dashboard-github-verification";

type SecretCheckInput = Parameters<typeof checkProviderSecretAvailability>[0];
type Repository = SecretCheckInput["repository"];

const repository = {
  owner: "example",
  name: "demo",
  visibility: "private",
  githubRepositoryId: 42n,
} as unknown as Repository;

function createInput(
  request: (route: string, options?: unknown) => Promise<unknown>,
  allowOrganizationSecrets = true,
): SecretCheckInput {
  return {
    repository,
    secretNames: ["REVIEW_ROUTER_PROVIDER_KEY"],
    octokit: { request } as unknown as SecretCheckInput["octokit"],
    allowOrganizationSecrets,
  };
}

function apiError(status: number): Error {
  return Object.assign(new Error("github_api_error"), { status });
}

describe("dashboard GitHub verification", () => {
  it("checks repository secrets without unnecessary organization reads", async () => {
    const request = vi.fn(async () => ({ data: {} }));
    const result = await checkProviderSecretAvailability(createInput(request));
    expect(result).toEqual({ status: "available_repository" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/repos/{owner}/{repo}/actions/secrets/"),
      expect.any(Object),
    );
  });

  it("falls back to an all-visible organization secret after a repository 404", async () => {
    const request = vi.fn(async (route: string) => {
      if (route.includes("/repos/")) throw apiError(404);
      return { data: { visibility: "all" } };
    });
    const result = await checkProviderSecretAvailability(createInput(request));
    expect(result).toEqual({ status: "available_organization" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not read organization secrets when explicitly disabled", async () => {
    const request = vi.fn(async () => {
      throw apiError(404);
    });
    const result = await checkProviderSecretAvailability(
      createInput(request, false),
    );
    expect(result).toEqual({ status: "missing" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects a selected organization secret without repository access", async () => {
    const request = vi.fn(async (route: string) => {
      if (route.includes("/repos/")) throw apiError(404);
      if (route.includes("/repositories"))
        return { data: { repositories: [] } };
      return { data: { visibility: "selected" } };
    });
    const result = await checkProviderSecretAvailability(createInput(request));
    expect(result).toEqual({ status: "not_available_to_repository" });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("preserves the permission-required and unknown failure outcomes", async () => {
    const denied = vi.fn(async () => {
      throw apiError(403);
    });
    const unavailable = vi.fn(async () => {
      throw apiError(503);
    });
    expect(await checkProviderSecretAvailability(createInput(denied))).toEqual({
      status: "permission_required",
    });
    expect(await checkProviderSecretAvailability(createInput(unavailable))).toEqual({
      status: "unknown",
    });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it("maps inaccessible repository responses without hiding unexpected errors", async () => {
    const denied = vi.fn(async () => {
      throw apiError(404);
    });
    await expect(
      assertRepositoryVisibleToGitHubApp({
        octokit: { request: denied } as unknown as SecretCheckInput["octokit"],
        repository,
      }),
    ).rejects.toThrow("repository_not_visible_to_github_app");

    const unexpected = vi.fn(async () => {
      throw apiError(502);
    });
    await expect(
      assertRepositoryVisibleToGitHubApp({
        octokit: { request: unexpected } as unknown as SecretCheckInput["octokit"],
        repository,
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(githubApiStatus(apiError(429))).toBe(429);
    expect(githubApiStatus({ status: "429" })).toBeNull();
  });
});
