import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  discoverGitLabSourceProjects: vi.fn(),
  provisionGitLabReviewRouterProjects: vi.fn(),
  getPrisma: vi.fn(),
  requestStartedAt: vi.fn(),
  recordInventory: vi.fn(),
  gatewayOptions: [] as unknown[],
}));

vi.mock("@reviewrouter/features-gitlab-integration", () => ({
  GitLabInstallationGateway: class GitLabInstallationGateway {
    constructor(options: unknown) {
      mocks.gatewayOptions.push(options);
    }
  },
  discoverGitLabSourceProjects: mocks.discoverGitLabSourceProjects,
  provisionGitLabReviewRouterProjects:
    mocks.provisionGitLabReviewRouterProjects,
}));

vi.mock("./prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("./gitlab-installation-inventory", () => ({
  PrismaGitLabInstallationInventory: class {
    requestStartedAt = mocks.requestStartedAt;
    record = mocks.recordInventory;
  },
}));

vi.mock("./workflow-public-api-url", () => ({
  resolveWorkflowPublicApiUrl: () => "https://api.reviewrouter.test",
}));

import { installGitLabConnectProjects } from "./gitlab-connect";

describe("installGitLabConnectProjects", () => {
  beforeEach(() => {
    vi.stubEnv("REVIEW_ROUTER_GITLAB_API_TOKEN", "server-review-token");
    vi.stubEnv("REVIEW_ROUTER_GITLAB_OIDC_AUDIENCE", "reviewrouter-test");
    mocks.gatewayOptions.length = 0;
    mocks.discoverGitLabSourceProjects.mockResolvedValue({
      source: {
        inputPath: "acme/platform",
        resolvedKind: "group",
        baseUrl: "https://gitlab.com",
      },
      parentGroupPath: "acme",
      projects: [
        {
          projectId: "101",
          fullName: "acme/platform/api",
          name: "api",
          defaultBranch: "main",
          webUrl: "https://gitlab.com/acme/platform/api",
          visibility: "private",
          archived: false,
        },
        {
          projectId: "102",
          fullName: "acme/platform/web",
          name: "web",
          defaultBranch: "main",
          webUrl: "https://gitlab.com/acme/platform/web",
          visibility: "private",
          archived: false,
        },
      ],
    });
    mocks.provisionGitLabReviewRouterProjects.mockReset();
    mocks.requestStartedAt.mockReset().mockResolvedValue(
      new Date("2026-10-31T10:00:00.000Z"),
    );
    mocks.recordInventory.mockReset().mockResolvedValue({
      installationId: "gitlab_install_1",
    });
    mocks.getPrisma.mockReturnValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("uses the server review token, records project fallback installs, and deselects removed repositories", async () => {
    mocks.provisionGitLabReviewRouterProjects
      .mockRejectedValueOnce(new Error("gitlab_api_error_403"))
      .mockResolvedValueOnce({
        protocolVersion: 1,
        requested: 1,
        succeeded: 1,
        failed: 0,
        sharedVariablesConfigured: 0,
        results: [
          {
            projectId: "101",
            status: "fulfilled",
            result: {
              mode: "ci_config_path",
              ciConfigPath: ".gitlab/reviewrouter.yml",
              variablesConfigured: 3,
            },
          },
        ],
      });

    await expect(
      installGitLabConnectProjects({
        sourceUrl: "https://gitlab.com/acme/platform",
        token: "user-pat-should-not-be-seeded",
        workspaceId: "workspace_1",
        selectedProjectIds: ["101"],
        installedByUserId: "user_1",
      }),
    ).resolves.toMatchObject({
      installationId: "gitlab_install_1",
      namespacePath: "acme/platform",
      succeeded: 1,
    });

    expect(mocks.gatewayOptions).toHaveLength(2);
    expect(mocks.gatewayOptions).toEqual([
      expect.objectContaining({ token: "user-pat-should-not-be-seeded" }),
      expect.objectContaining({ token: "user-pat-should-not-be-seeded" }),
    ]);
    expect(mocks.provisionGitLabReviewRouterProjects).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        variableTarget: { kind: "group", id: "acme/platform" },
        reviewToken: "server-review-token",
      }),
      expect.any(Object),
    );
    expect(mocks.provisionGitLabReviewRouterProjects).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        variableTarget: { kind: "project", id: "0" },
        reviewToken: "server-review-token",
      }),
      expect.any(Object),
    );
    expect(
      JSON.stringify(mocks.provisionGitLabReviewRouterProjects.mock.calls),
    ).not.toContain("user-pat-should-not-be-seeded");
    expect(mocks.requestStartedAt).toHaveBeenCalledOnce();
    expect(mocks.recordInventory).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        installedByUserId: "user_1",
        sourceBaseUrl: "https://gitlab.com",
        namespacePath: "acme/platform",
        sourceKind: "project",
        requestStartedAt: new Date("2026-10-31T10:00:00.000Z"),
        selectedProjects: [
          expect.objectContaining({ projectId: "101" }),
        ],
        provision: expect.objectContaining({
          succeeded: 1,
          failed: 0,
        }),
      }),
    );
  });

  it("rejects unknown discovery selections before external provisioning or persistence", async () => {
    await expect(
      installGitLabConnectProjects({
        sourceUrl: "https://gitlab.com/acme/platform",
        token: "user-pat",
        workspaceId: "workspace_1",
        selectedProjectIds: ["101", "999"],
        installedByUserId: "user_1",
      }),
    ).rejects.toThrow("gitlab_connect_project_selection_stale");
    expect(mocks.provisionGitLabReviewRouterProjects).not.toHaveBeenCalled();
    expect(mocks.recordInventory).not.toHaveBeenCalled();
  });

  it("fails closed when the server GitLab review token is missing", async () => {
    vi.stubEnv("REVIEW_ROUTER_GITLAB_API_TOKEN", "");

    await expect(
      installGitLabConnectProjects({
        sourceUrl: "https://gitlab.com/acme/platform",
        token: "user-pat",
        workspaceId: "workspace_1",
        selectedProjectIds: ["101"],
        installedByUserId: "user_1",
      }),
    ).rejects.toThrow("gitlab_review_token_missing");
    expect(mocks.provisionGitLabReviewRouterProjects).not.toHaveBeenCalled();
  });
});
