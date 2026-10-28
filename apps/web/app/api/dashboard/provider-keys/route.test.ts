import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  assertDashboardWorkspaceAdminAllowed: vi.fn(),
  assertProviderApiKeyWorkspaceGranted: vi.fn(),
  assertWorkspaceFeatureEntitlement: vi.fn(),
  providerApiKeyConnectionFindUnique: vi.fn(),
}));

vi.mock("@reviewrouter/features-audit-log", () => ({
  PrismaAuditLogRepository: class PrismaAuditLogRepository {},
}));

vi.mock("@reviewrouter/features-entitlements", () => ({
  assertWorkspaceFeatureEntitlement: mocks.assertWorkspaceFeatureEntitlement,
  PrismaEntitlementRepository: class PrismaEntitlementRepository {},
}));

vi.mock("../../../../src/server/dashboard-mutations", () => ({
  assertDashboardWorkspaceAdminAllowed:
    mocks.assertDashboardWorkspaceAdminAllowed,
}));

vi.mock("../../../../src/server/prisma", () => ({
  getPrisma: () => ({
    providerApiKeyConnection: {
      findUnique: mocks.providerApiKeyConnectionFindUnique,
    },
  }),
}));

vi.mock("../../../../src/server/provider-api-keys", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/server/provider-api-keys")
  >()),
  assertProviderApiKeyWorkspaceGranted:
    mocks.assertProviderApiKeyWorkspaceGranted,
}));

describe("GET /api/dashboard/provider-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertDashboardWorkspaceAdminAllowed.mockResolvedValue({
      actor: "user:admin",
    });
    mocks.assertProviderApiKeyWorkspaceGranted.mockResolvedValue(undefined);
    mocks.assertWorkspaceFeatureEntitlement.mockResolvedValue(undefined);
  });

  it("reads MiMo connection state without an operator grant", async () => {
    mocks.assertProviderApiKeyWorkspaceGranted.mockRejectedValue(
      new Error("provider_key_workspace_grant_required"),
    );
    mocks.providerApiKeyConnectionFindUnique.mockResolvedValue(null);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/provider-keys?workspace=workspace_1&providerType=mimo",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      providerType: "mimo",
      connected: false,
      keyVersion: null,
      repositories: [],
    });
    expect(mocks.assertProviderApiKeyWorkspaceGranted).not.toHaveBeenCalled();
    expect(mocks.assertWorkspaceFeatureEntitlement).toHaveBeenCalledOnce();
  });

  it("keeps OpenRouter available without an operator grant", async () => {
    mocks.assertProviderApiKeyWorkspaceGranted.mockRejectedValue(
      new Error("provider_key_workspace_grant_required"),
    );
    mocks.providerApiKeyConnectionFindUnique.mockResolvedValue(null);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/provider-keys?workspace=workspace_1&providerType=openrouter",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.assertProviderApiKeyWorkspaceGranted).not.toHaveBeenCalled();
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
  });

  it.each([
    ["dashboard_admin_requires_sign_in", 401],
    ["workspace_admin_forbidden", 403],
  ] as const)("rejects %s before reading state", async (error, status) => {
    mocks.assertDashboardWorkspaceAdminAllowed.mockRejectedValue(
      new Error(error),
    );

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/provider-keys?workspace=workspace_1&providerType=mimo",
      ),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.providerApiKeyConnectionFindUnique).not.toHaveBeenCalled();
    expect(mocks.assertWorkspaceFeatureEntitlement).not.toHaveBeenCalled();
  });

  it("enforces the paid provider-key entitlement before reading state", async () => {
    mocks.assertWorkspaceFeatureEntitlement.mockRejectedValue(
      new Error(
        "entitlement_denied:provider_key_management:feature_not_enabled_for_plan",
      ),
    );

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/provider-keys?workspace=workspace_1&providerType=openrouter",
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error:
        "entitlement_denied:provider_key_management:feature_not_enabled_for_plan",
    });
    expect(mocks.providerApiKeyConnectionFindUnique).not.toHaveBeenCalled();
  });

  it("returns saved repository state without exposing the encrypted or plaintext key", async () => {
    mocks.assertProviderApiKeyWorkspaceGranted.mockRejectedValue(
      new Error("provider_key_workspace_grant_required"),
    );
    mocks.providerApiKeyConnectionFindUnique.mockResolvedValue({
      keyVersion: 1,
      repositoryLinks: [
        {
          status: "applied",
          appliedKeyVersion: 1,
          attemptedKeyVersion: 1,
          reconciliationNeeded: false,
          lastErrorReason: null,
          appliedAt: new Date("2026-09-26T10:00:00.000Z"),
          repository: { id: "repo_1", fullName: "acme/one" },
        },
      ],
    });

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/provider-keys?workspace=workspace_1&providerType=mimo",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      providerType: "mimo",
      connected: true,
      keyVersion: 1,
      repositories: [
        {
          repositoryId: "repo_1",
          repositoryFullName: "acme/one",
          status: "applied",
          appliedKeyVersion: 1,
          attemptedKeyVersion: 1,
          appliedAt: "2026-09-26T10:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|encrypted/i);
    const query = mocks.providerApiKeyConnectionFindUnique.mock.calls[0]?.[0];
    expect(query.select).not.toHaveProperty("encryptedApiKey");
    expect(query.select).not.toHaveProperty(
      "repositoryLinks.select.encryptedApiKey",
    );
  });
});

function nextRequest(url: string) {
  return { nextUrl: new URL(url) } as Parameters<typeof GET>[0];
}
