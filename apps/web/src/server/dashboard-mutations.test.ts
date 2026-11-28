import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import type { PrismaClient } from "@prisma/client";

// Use the installed server React implementation: the default client export's
// cache is a no-op and cannot detect stale authorization inside an RSC request.
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(import.meta.url);
  return require(
    join(
      dirname(require.resolve("react/package.json")),
      "react.react-server.js",
    ),
  );
});

const mocks = vi.hoisted(() => ({
  assertWorkspaceMutationAllowed: vi.fn(),
  getPrisma: vi.fn(),
  getServerSession: vi.fn(),
  getValidGitHubUserAccessToken: vi.fn(),
  readGitHubUserAuthorizationAuthority: vi.fn(),
  appAuth: vi.fn(),
  octokitRequest: vi.fn(),
  updateRepositoryPermissionCacheFromLiveCheck: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@reviewrouter/features-auth", () => ({
  assertWorkspaceMutationAllowed: mocks.assertWorkspaceMutationAllowed,
  listVisibleWorkspaceScope: vi.fn(),
  PrismaWorkspaceAccessRepository: class PrismaWorkspaceAccessRepository {},
}));

vi.mock("@reviewrouter/platform-config", () => ({
  requireGitHubAppPrivateKey: () => "test-private-key",
}));

vi.mock("@octokit/app", () => ({
  App: class App {
    octokit = { auth: mocks.appAuth };

    getInstallationOctokit() {
      return { request: mocks.octokitRequest };
    }
  },
}));

vi.mock("../auth/auth-env", () => ({
  getAuthEnvironmentStatus: () => ({ configured: true, missing: [] }),
}));

vi.mock("../auth/auth-options", () => ({
  authOptions: {},
}));

vi.mock("./github-user-repository-access", () => ({
  updateRepositoryPermissionCacheFromLiveCheck:
    mocks.updateRepositoryPermissionCacheFromLiveCheck,
}));

vi.mock("./github-user-authorization", () => ({
  getValidGitHubUserAccessToken: mocks.getValidGitHubUserAccessToken,
  readGitHubUserAuthorizationAuthority:
    mocks.readGitHubUserAuthorizationAuthority,
}));

vi.mock("./prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import {
  assertDashboardMutationAllowed,
  assertDashboardRepositoryConfigMutationAllowed,
  assertDashboardRepositoryMutationAllowed,
  assertDashboardRepositoryRecoveryAllowed,
  assertDashboardWorkspaceAdminMutationAllowed,
  createGitHubUserOctokit,
  getDashboardSignedInActor,
  mintFreshGitHubAppRepositorySecretWriteToken,
  repositoryAccessRefreshErrorCode,
} from "./dashboard-mutations";

const repository = {
  id: "repo_1",
  owner: "fin-int",
  name: "tvaity",
  githubRepositoryId: 1001n,
  installation: { githubInstallationId: 101n },
};

describe("dashboard repository mutations", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
    vi.stubEnv("REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS", "1");
    mocks.getServerSession.mockResolvedValue({
      user: {
        sourceProvider: "github",
        externalUserId: "123",
        sourceLogin: "maintainer",
        githubUserId: "123",
        githubLogin: "maintainer",
      },
    });
    mocks.getPrisma.mockReturnValue({
      userExternalIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          user: { id: "user_1", githubUserId: 123n, githubLogin: "maintainer" },
        }),
      },
    });
    mocks.assertWorkspaceMutationAllowed.mockReset().mockRejectedValue(
      new Error("workspace_mutation_forbidden:missing_role"),
    );
    mocks.updateRepositoryPermissionCacheFromLiveCheck.mockResolvedValue(true);
    mocks.readGitHubUserAuthorizationAuthority.mockResolvedValue({
      appSlug: "reviewrouter-test",
      revision: 0,
    });
    mocks.getValidGitHubUserAccessToken.mockResolvedValue({
      status: "ready",
      accessToken: "ghu_user",
      refreshed: false,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("refuses workspace-admin writes before identity or database work when disabled", async () => {
    vi.stubEnv("REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS", "0");

    await expect(
      assertDashboardWorkspaceAdminMutationAllowed("workspace_1"),
    ).rejects.toThrow("dashboard_mutations_disabled");

    expect(mocks.getServerSession).not.toHaveBeenCalled();
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("rejects repo-only mutations when the live collaborator permission no longer allows management", async () => {
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "read",
        role_name: "read",
        user: { id: 123, login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryMutationAllowed("workspace_1", repository),
    ).rejects.toThrow("repository_mutation_forbidden");

    expect(mocks.octokitRequest).toHaveBeenCalledWith(
      "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
      {
        owner: "fin-int",
        repo: "tvaity",
        username: "maintainer",
      },
    );
    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ userId: "user_1" }),
        repositoryId: "repo_1",
        githubInstallationId: 101n,
        permission: "read",
        roleName: "read",
        canManage: false,
      }),
    );
  });

  it.each([null, { appSlug: "reviewrouter-test", revision: 1 }])(
    "refuses a live permission response whose captured authorization changed to %s",
    async (currentAuthority) => {
      mocks.readGitHubUserAuthorizationAuthority
        .mockResolvedValueOnce({ appSlug: "reviewrouter-test", revision: 0 })
        .mockResolvedValueOnce(currentAuthority);
      mocks.octokitRequest.mockResolvedValue({
        data: {
          permission: "admin",
          role_name: "admin",
          user: { id: 123, login: "maintainer" },
        },
      });
      await expect(
        assertDashboardRepositoryMutationAllowed("workspace_1", repository),
      ).rejects.toThrow("repository_mutation_forbidden");
      expect(
        mocks.updateRepositoryPermissionCacheFromLiveCheck,
      ).not.toHaveBeenCalled();
    },
  );

  it("refuses admission when authorization changes immediately before cache publication", async () => {
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "admin",
        role_name: "admin",
        user: { id: 123, login: "maintainer" },
      },
    });
    mocks.updateRepositoryPermissionCacheFromLiveCheck.mockResolvedValueOnce(
      false,
    );
    await expect(
      assertDashboardRepositoryMutationAllowed("workspace_1", repository),
    ).rejects.toThrow("repository_mutation_forbidden");
  });

  it("allows repo-only mutations for live write, maintain, or admin repository roles", async () => {
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "write",
        role_name: "write",
        user: { id: "123", login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryMutationAllowed("workspace_1", repository),
    ).resolves.toMatchObject({
      userId: "user_1",
      githubUserId: "123",
      githubLogin: "maintainer",
      accessSource: {
        source: "repo_manager",
        capability: "repo_manager",
        permission: "write",
        roleName: "write",
      },
    });

    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo_1",
        permission: "write",
        roleName: "write",
        canManage: true,
      }),
    );
  });

  it("rejects direct repository config changes for write-only repo access", async () => {
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "write",
        role_name: "write",
        user: { id: "123", login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryConfigMutationAllowed("workspace_1", repository),
    ).rejects.toThrow("repository_config_mutation_forbidden");

    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo_1",
        permission: "write",
        roleName: "write",
        canManage: true,
      }),
    );
  });

  it("allows direct repository config changes for maintain or admin repo access", async () => {
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "write",
        role_name: "maintain",
        user: { id: "123", login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryConfigMutationAllowed("workspace_1", repository),
    ).resolves.toMatchObject({
      userId: "user_1",
      githubUserId: "123",
      githubLogin: "maintainer",
      accessSource: {
        source: "repo_manager",
        capability: "direct_config",
        permission: "write",
        roleName: "maintain",
      },
    });
  });

  it("allows direct repository config changes for workspace admins without repo checks", async () => {
    mocks.assertWorkspaceMutationAllowed.mockResolvedValue({
      allowed: true,
      reason: "allowed",
    });

    await expect(
      assertDashboardRepositoryConfigMutationAllowed("workspace_1", repository),
    ).resolves.toMatchObject({
      userId: "user_1",
      githubUserId: "123",
      githubLogin: "maintainer",
      accessSource: { source: "workspace_admin" },
    });

    expect(mocks.octokitRequest).not.toHaveBeenCalled();
  });

  it("rejects a collaborator response for a different GitHub user id", async () => {
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "write",
        role_name: "write",
        user: { id: 999, login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryMutationAllowed("workspace_1", repository),
    ).rejects.toThrow("repository_mutation_forbidden");

    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).not.toHaveBeenCalled();
  });

  it("downshifts the repository permission cache when GitHub rejects the live check", async () => {
    const error = new Error("Not Found") as Error & { status: number };
    error.status = 404;
    mocks.octokitRequest.mockRejectedValue(error);

    await expect(
      assertDashboardRepositoryMutationAllowed("workspace_1", repository),
    ).rejects.toThrow("repository_mutation_forbidden");

    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "repo_1",
        permission: "",
        roleName: "",
        canManage: false,
      }),
    );
  });

  it("authorizes recovery from the live permission without mutating the durable cache", async () => {
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "write",
        role_name: "write",
        user: { id: "123", login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryRecoveryAllowed("workspace_1", repository),
    ).resolves.toMatchObject({
      accessSource: {
        source: "repo_manager",
        capability: "repo_manager",
      },
    });

    expect(mocks.octokitRequest).toHaveBeenCalledTimes(1);
    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).not.toHaveBeenCalled();
  });

  it("requires a successful live repository-manager check for a workspace admin", async () => {
    mocks.assertWorkspaceMutationAllowed.mockResolvedValueOnce(undefined);
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "admin",
        role_name: "admin",
        user: { id: "123", login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryRecoveryAllowed("workspace_1", repository),
    ).resolves.toMatchObject({
      accessSource: {
        source: "repo_manager",
        capability: "repo_manager",
        permission: "admin",
      },
    });

    expect(mocks.assertWorkspaceMutationAllowed).not.toHaveBeenCalled();
    expect(mocks.octokitRequest).toHaveBeenCalledTimes(1);
    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).not.toHaveBeenCalled();
  });

  it("rejects a workspace admin whose live repository permission was revoked", async () => {
    mocks.assertWorkspaceMutationAllowed.mockResolvedValueOnce(undefined);
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "read",
        role_name: "read",
        user: { id: "123", login: "maintainer" },
      },
    });

    await expect(
      assertDashboardRepositoryRecoveryAllowed("workspace_1", repository),
    ).rejects.toThrow("repository_mutation_forbidden");

    expect(mocks.assertWorkspaceMutationAllowed).not.toHaveBeenCalled();
    expect(mocks.octokitRequest).toHaveBeenCalledTimes(1);
    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).not.toHaveBeenCalled();
  });

  it("rejects recovery after a failed live permission check without downshifting the durable cache", async () => {
    const error = new Error("Not Found") as Error & { status: number };
    error.status = 404;
    mocks.octokitRequest.mockRejectedValue(error);

    await expect(
      assertDashboardRepositoryRecoveryAllowed("workspace_1", repository),
    ).rejects.toThrow("repository_mutation_forbidden");

    expect(
      mocks.updateRepositoryPermissionCacheFromLiveCheck,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["github_oauth_client_misconfigured", "dashboard_auth_misconfigured"],
    ["github_oauth_refresh_failed", "repository_access_token_refresh_failed"],
    [
      "github_user_token_refresh_reauthorization_required",
      "repository_access_reauthorization_required",
    ],
  ])(
    "preserves the recovery category for %s before a GitHub request",
    async (errorCode, expected) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      mocks.getValidGitHubUserAccessToken.mockResolvedValueOnce({
        status: "refresh_failed",
        errorCode,
      });
      await expect(
        createGitHubUserOctokit({
          userId: "user_1",
          sourceProvider: "github",
          externalUserId: "123",
          sourceLogin: "maintainer",
          githubUserId: "123",
          githubLogin: "maintainer",
          actor: "user:github:maintainer",
        }),
      ).rejects.toThrow(expected);
      expect(
        repositoryAccessRefreshErrorCode({
          status: "token_refresh_failed",
          errorCode,
        }),
      ).toBe(expected);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("creates a GitHub user-token requester for user-triggered repository writes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const octokit = await createGitHubUserOctokit({
      userId: "user_1",
      sourceProvider: "github",
      externalUserId: "123",
      sourceLogin: "maintainer",
      githubUserId: "123",
      githubLogin: "maintainer",
      actor: "user:github:maintainer",
    });

    await expect(
      octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
        owner: "fin-int",
        repo: "tvaity",
        path: ".github/workflows/reviewrouter.yml",
        branch: "reviewrouter/setup",
        message: "chore: add ReviewRouter workflows",
        content: "Y29udGVudA==",
      }),
    ).resolves.toEqual({ data: { ok: true } });

    expect(mocks.getValidGitHubUserAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user_1",
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://api.github.com/repos/fin-int/tvaity/contents/.github/workflows/reviewrouter.yml",
      ),
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer ghu_user",
        }),
        body: JSON.stringify({
          branch: "reviewrouter/setup",
          message: "chore: add ReviewRouter workflows",
          content: "Y29udGVudA==",
        }),
      }),
    );
  });

  it("derives source identity from legacy GitHub-only session fields", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        githubUserId: "123",
        githubLogin: "maintainer",
        githubAvatarUrl: "https://avatars.githubusercontent.com/u/123",
      },
    });

    await expect(getDashboardSignedInActor()).resolves.toMatchObject({
      userId: "user_1",
      sourceProvider: "github",
      externalUserId: "123",
      sourceLogin: "maintainer",
      githubUserId: "123",
      githubLogin: "maintainer",
    });
  });

  it("rereads a supplied transaction identity under an active React server cache", async () => {
    const internals = (
      React as unknown as {
        __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
          A: null | { getCacheForType<T>(factory: () => T): T };
        };
      }
    ).__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const previous = internals.A;
    const cache = new Map<() => unknown, unknown>();
    internals.A = {
      getCacheForType<T>(factory: () => T): T {
        if (!cache.has(factory)) cache.set(factory, factory());
        return cache.get(factory) as T;
      },
    };
    const defaultRead = vi.fn().mockResolvedValue({
      user: { id: "default-user", githubUserId: 123n, githubLogin: "maintainer" },
    });
    const transactionRead = vi.fn().mockResolvedValue({
      user: { id: "transaction-user", githubUserId: 123n, githubLogin: "maintainer" },
    });
    mocks.getPrisma.mockReturnValue({
      userExternalIdentity: { findUnique: defaultRead },
    });
    const transaction = {
      userExternalIdentity: { findUnique: transactionRead },
    } as unknown as Pick<PrismaClient, "userExternalIdentity">;
    try {
      const cachedActor = await getDashboardSignedInActor();
      expect(cachedActor?.userId).toBe("default-user");
      defaultRead.mockResolvedValue(null);
      expect(await getDashboardSignedInActor()).toEqual(cachedActor);
      expect(defaultRead).toHaveBeenCalledOnce();
      expect(mocks.getServerSession).toHaveBeenCalledOnce();

      expect(
        (await getDashboardSignedInActor({ prisma: transaction }))?.userId,
      ).toBe("transaction-user");
      transactionRead.mockResolvedValue(null);
      expect(
        await getDashboardSignedInActor({ prisma: transaction }),
      ).toBeNull();
      expect(transactionRead).toHaveBeenCalledTimes(2);
      expect(defaultRead).toHaveBeenCalledOnce();
    } finally {
      internals.A = previous;
    }
  });

  it("allows a GitLab session to reuse only its linked local user's verified GitHub grant", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        sourceProvider: "gitlab",
        externalUserId: "456",
        sourceLogin: "gitlab-maintainer",
      },
    });
    mocks.octokitRequest.mockResolvedValue({
      data: {
        permission: "write",
        role_name: "write",
        user: { id: 123, login: "maintainer" },
      },
    });
    await expect(
      assertDashboardRepositoryMutationAllowed("workspace_1", repository),
    ).resolves.toMatchObject({
      userId: "user_1",
      sourceProvider: "gitlab",
      githubUserId: "123",
      githubLogin: "maintainer",
      accessSource: { source: "repo_manager" },
    });
    expect(mocks.readGitHubUserAuthorizationAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
    );
  });

  it("does not inherit the legacy GitHub-login administrator override on GitLab", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        sourceProvider: "gitlab",
        externalUserId: "456",
        sourceLogin: "gitlab-maintainer",
      },
    });
    vi.stubEnv("REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS", "maintainer");
    mocks.assertWorkspaceMutationAllowed.mockResolvedValue(undefined);
    await expect(
      assertDashboardMutationAllowed("workspace_1"),
    ).resolves.toMatchObject({
      sourceProvider: "gitlab",
      userId: "user_1",
    });
    expect(mocks.assertWorkspaceMutationAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        githubUserId: "123",
        githubLogin: "maintainer",
        localAdminGithubLogins: [],
      }),
      expect.any(Object),
    );
  });

  it("rejects a GitHub session contradicting the bound user's immutable native identity", async () => {
    mocks.getPrisma.mockReturnValue({
      userExternalIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          user: { id: "user_1", githubUserId: 999n, githubLogin: "other" },
        }),
      },
    });
    await expect(assertDashboardMutationAllowed("workspace_1")).rejects.toThrow(
      "dashboard_mutation_requires_sign_in",
    );
    expect(mocks.assertWorkspaceMutationAllowed).not.toHaveBeenCalled();
  });

  it("rejects contradictory canonical and supplemental GitHub subjects", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: {
        sourceProvider: "github",
        externalUserId: "999",
        sourceLogin: "maintainer",
        githubUserId: "123",
        githubLogin: "maintainer",
      },
    });
    await expect(getDashboardSignedInActor()).resolves.toBeNull();
    await expect(assertDashboardMutationAllowed("workspace_1")).rejects.toThrow(
      "dashboard_mutation_requires_sign_in",
    );
    expect(mocks.assertWorkspaceMutationAllowed).not.toHaveBeenCalled();
  });

  it("does not copy GitLab external ids into GitHub actor fields", async () => {
    mocks.getPrisma.mockReturnValue({
      userExternalIdentity: {
        findUnique: vi.fn().mockResolvedValue({
          user: { id: "user_1", githubUserId: null, githubLogin: null },
        }),
      },
    });
    mocks.getServerSession.mockResolvedValue({
      user: {
        sourceProvider: "gitlab",
        externalUserId: "456",
        sourceLogin: "gitlab-maintainer",
        gitlabUserId: "456",
        gitlabLogin: "gitlab-maintainer",
      },
    });
    mocks.assertWorkspaceMutationAllowed.mockResolvedValue({
      allowed: true,
      reason: "allowed",
    });

    await expect(
      assertDashboardMutationAllowed("workspace_1"),
    ).resolves.toMatchObject({
      userId: "user_1",
      sourceProvider: "gitlab",
      externalUserId: "456",
      sourceLogin: "gitlab-maintainer",
      githubUserId: null,
      githubLogin: null,
      accessSource: { source: "workspace_admin" },
    });
    expect(mocks.assertWorkspaceMutationAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        userId: "user_1",
        githubUserId: "",
        githubLogin: "",
      }),
      expect.any(Object),
    );
  });
});

describe("setup repository secret installation token", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_APP_ID", "12345");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("requests a fresh token for only the target repository and secrets write", async () => {
    mocks.appAuth.mockResolvedValue({
      token: "ghs_repository_secret_write",
      repositoryIds: [1001],
      permissions: { metadata: "read", secrets: "write" },
    });

    await expect(
      mintFreshGitHubAppRepositorySecretWriteToken({
        githubInstallationId: "101",
        githubRepositoryId: "1001",
      }),
    ).resolves.toBe("ghs_repository_secret_write");
    expect(mocks.appAuth).toHaveBeenCalledWith({
      type: "installation",
      installationId: 101,
      repositoryIds: [1001],
      permissions: { secrets: "write" },
      refresh: true,
    });
  });

  it.each([
    [{ repositoryIds: [1001, 1002], permissions: { secrets: "write" } }],
    [{ repositoryIds: [1002], permissions: { secrets: "write" } }],
    [{ repositoryIds: [1001], permissions: { secrets: "read" } }],
    [
      {
        repositoryIds: [1001],
        permissions: { contents: "write", secrets: "write" },
      },
    ],
  ])("rejects a broader or mismatched returned scope %#", async (returned) => {
    mocks.appAuth.mockResolvedValue({
      token: "ghs_invalid_scope",
      ...returned,
    });

    await expect(
      mintFreshGitHubAppRepositorySecretWriteToken({
        githubInstallationId: "101",
        githubRepositoryId: "1001",
      }),
    ).rejects.toThrow(
      /setup_secret_token_(?:repository_scope|permissions)_mismatch/u,
    );
  });
});
