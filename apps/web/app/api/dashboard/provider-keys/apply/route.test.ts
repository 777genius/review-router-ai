import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  assertDashboardWorkspaceAdminAllowed: vi.fn(),
  assertProviderApiKeyWorkspaceGranted: vi.fn(),
  assertWorkspaceFeatureEntitlement: vi.fn(),
  createProviderApiKeyServiceDependencies: vi.fn(),
  githubSecrets: {
    getRepositoryActionsPublicKey: vi.fn(),
    putEncryptedRepositorySecret: vi.fn(),
  },
}));

vi.mock("../../../../../src/server/dashboard-mutations", () => ({
  assertDashboardWorkspaceAdminAllowed:
    mocks.assertDashboardWorkspaceAdminAllowed,
}));

vi.mock("@reviewrouter/features-entitlements", () => ({
  assertWorkspaceFeatureEntitlement: mocks.assertWorkspaceFeatureEntitlement,
  PrismaEntitlementRepository: class PrismaEntitlementRepository {},
}));

vi.mock("../../../../../src/server/prisma", () => ({
  getPrisma: () => ({}),
}));

vi.mock("../../../../../src/server/provider-api-keys", () => ({
  assertProviderApiKeyWorkspaceGranted:
    mocks.assertProviderApiKeyWorkspaceGranted,
  createProviderApiKeyServiceDependencies:
    mocks.createProviderApiKeyServiceDependencies,
}));

vi.mock("@reviewrouter/platform-config", () => ({
  requireGitHubAppPrivateKey: () => "fake-private-key",
}));

describe("POST /api/dashboard/provider-keys/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_ID = "123";
    process.env.REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY =
      "fake-encryption-key-that-is-at-least-32-chars";
    mocks.assertDashboardWorkspaceAdminAllowed.mockResolvedValue({
      actor: "user:admin",
    });
    mocks.assertProviderApiKeyWorkspaceGranted.mockResolvedValue(undefined);
    mocks.assertWorkspaceFeatureEntitlement.mockResolvedValue(undefined);
    mocks.githubSecrets.getRepositoryActionsPublicKey.mockResolvedValue({
      keyId: "github-key-id",
      key: Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
    });
    mocks.githubSecrets.putEncryptedRepositorySecret.mockResolvedValue({
      status: "accepted",
    });
    mocks.createProviderApiKeyServiceDependencies.mockReturnValue({
      providerApiKeys: {
        findEncryptedApiKey: vi.fn(),
        findConnectedRepositoryIds: vi.fn().mockResolvedValue([]),
        prepareApply: vi.fn().mockResolvedValue({
          operationId: "operation_1",
          keyVersion: 1,
          repositoryIds: ["repo_1"],
        }),
        markRepositoryApplying: vi.fn().mockResolvedValue(true),
        recordRepositoryResult: vi.fn().mockResolvedValue("recorded"),
        markRepositoryReconciliationNeeded: vi.fn(),
        findState: vi.fn(),
      },
      providerApiKeyRepositories: {
        findRepositoryTargets: vi.fn().mockResolvedValue([
          {
            repositoryId: "repo_1",
            repositoryFullName: "acme/one",
            githubInstallationId: "101",
            githubRepositoryId: "201",
            owner: "acme",
            repo: "one",
          },
        ]),
      },
      storageCipher: {
        encrypt: (value: string) => `encrypted:${value}`,
        decrypt: (value: string) => value,
      },
      githubSecrets: mocks.githubSecrets,
      classifyError: () => "github_request_failed",
      lock: {
        withLock: (_key: string, _ttlMs: number, run: () => Promise<unknown>) =>
          run(),
      },
    });
  });

  it("default-denies key storage before service or GitHub dependencies are used", async () => {
    mocks.assertProviderApiKeyWorkspaceGranted.mockRejectedValue(
      new Error("provider_key_workspace_grant_required"),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "provider_key_workspace_grant_required",
    });
    expect(
      mocks.createProviderApiKeyServiceDependencies,
    ).not.toHaveBeenCalled();
    expect(
      mocks.githubSecrets.getRepositoryActionsPublicKey,
    ).not.toHaveBeenCalled();
    expect(
      mocks.githubSecrets.putEncryptedRepositorySecret,
    ).not.toHaveBeenCalled();
  });

  it("keeps OpenRouter batch apply independent of the MiMo pool grant", async () => {
    mocks.assertProviderApiKeyWorkspaceGranted.mockRejectedValue(
      new Error("provider_key_workspace_grant_required"),
    );

    const response = await POST(request("openrouter"));

    expect(response.status).toBe(200);
    expect(mocks.assertProviderApiKeyWorkspaceGranted).not.toHaveBeenCalled();
    expect(mocks.githubSecrets.putEncryptedRepositorySecret).toHaveBeenCalledWith(
      expect.objectContaining({ secretName: "OPENROUTER_API_KEY" }),
    );
  });

  it("rejects the batch before GitHub work when entitlement is denied", async () => {
    mocks.assertWorkspaceFeatureEntitlement.mockRejectedValue(
      new Error(
        "entitlement_denied:provider_key_management:feature_not_enabled_for_plan",
      ),
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error:
        "entitlement_denied:provider_key_management:feature_not_enabled_for_plan",
    });
    expect(
      mocks.createProviderApiKeyServiceDependencies,
    ).not.toHaveBeenCalled();
    expect(
      mocks.githubSecrets.putEncryptedRepositorySecret,
    ).not.toHaveBeenCalled();
  });

  it("returns the per-repository success status for a full batch", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providerType: "mimo",
      results: [
        {
          repositoryId: "repo_1",
          repositoryFullName: "acme/one",
          status: "applied",
          keyVersion: 1,
        },
      ],
    });
    expect(mocks.assertWorkspaceFeatureEntitlement).toHaveBeenCalledWith(
      {
        workspaceId: "workspace_1",
        feature: "provider_key_management",
        actor: "user:admin",
      },
      expect.objectContaining({
        entitlements: expect.anything(),
        auditLog: expect.anything(),
      }),
    );
    expect(
      mocks.githubSecrets.putEncryptedRepositorySecret,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ secretName: "MIMO_TOKEN_PLAN_API_KEY" }),
    );
  });
});

function request(providerType = "mimo"): Request {
  return new Request("http://localhost/api/dashboard/provider-keys/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace_1",
      providerType,
      apiKey: "fake-mimo-token-plan-key",
      repositoryIds: ["repo_1"],
    }),
  });
}
