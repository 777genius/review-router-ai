import { describe, expect, it, vi } from "vitest";
import type { HostedPoolQueryPort } from "@reviewrouter/features-hosted-account-pool";
import {
  changeHostedRepositorySessionSource,
  importHostedPoolAccount,
  loadHostedPoolDashboardView,
  pollHostedPoolDeviceLogin,
  startHostedPoolDeviceLogin,
  type HostedPoolDashboardMutationDependencies,
  type HostedPoolDeviceLoginDependencies,
} from "./hosted-pool-dashboard";

function mutationDependencies(
  overrides: Partial<HostedPoolDashboardMutationDependencies> = {},
): HostedPoolDashboardMutationDependencies {
  return {
    featureEnabled: true,
    authorizeWorkspaceAdmin: vi.fn(async () => ({ actor: "user:owner" })),
    assertEntitled: vi.fn(async () => undefined),
    getRepository: vi.fn(async () => ({
      id: "repo-1",
      workspaceId: "workspace-1",
      fullName: "acme/private",
      visibility: "private",
    })),
    mutations: {
      importAccount: vi.fn(async () => undefined),
      setAccountState: vi.fn(async () => undefined),
      setRepositorySource: vi.fn(async () => ({
        activation: "pending" as const,
      })),
    },
    now: () => new Date("2026-08-15T12:00:00.000Z"),
    ...overrides,
  };
}

function deviceLoginDependencies(
  overrides: Partial<HostedPoolDeviceLoginDependencies> = {},
): HostedPoolDeviceLoginDependencies {
  const pending = new Map<
    string,
    {
      actor: string;
      workspaceId: string;
      deviceAuthId: string;
      userCode: string;
      verificationUrl: string;
      expiresAt: Date;
      status: "pending";
    }
  >();
  return {
    ...mutationDependencies(),
    deviceLoginStore: {
      expireStalePending: vi.fn(async () => undefined),
      findPendingByWorkspace: vi.fn(async (workspaceId) => {
        const row = [...pending.values()].find(
          (item) =>
            item.workspaceId === workspaceId && item.status === "pending",
        );
        return row
          ? ({
              id: "login-1" as never,
              workspaceId: workspaceId as never,
              actor: row.actor,
              label: "Primary",
              priority: 10,
              userCode: row.userCode,
              verificationUrl: row.verificationUrl,
              deviceAuthId: row.deviceAuthId,
              status: "pending",
              expiresAt: row.expiresAt,
              createdAt: new Date("2026-08-15T12:00:00.000Z"),
              updatedAt: new Date("2026-08-15T12:00:00.000Z"),
            } as never)
          : null;
      }),
      createPending: vi.fn(async (record) => {
        pending.set(record.id, {
          actor: record.actor,
          workspaceId: record.workspaceId,
          deviceAuthId: record.deviceAuthId ?? "device-auth-secret",
          userCode: record.userCode,
          verificationUrl: record.verificationUrl,
          expiresAt: record.expiresAt,
          status: "pending",
        });
      }),
      findById: vi.fn(async (id) => {
        const row = pending.get(id);
        return row
          ? ({
              id: id as never,
              workspaceId: row.workspaceId as never,
              actor: row.actor,
              label: "Primary",
              priority: 10,
              userCode: row.userCode,
              verificationUrl: row.verificationUrl,
              deviceAuthId: row.deviceAuthId,
              status: row.status,
              expiresAt: row.expiresAt,
              createdAt: new Date("2026-08-15T12:00:00.000Z"),
              updatedAt: new Date("2026-08-15T12:00:00.000Z"),
            } as never)
          : null;
      }),
      markTerminal: vi.fn(async () => true),
    },
    deviceAuth: {
      requestUserCode: vi.fn(async () => ({
        deviceAuthId: "device-auth-secret",
        userCode: "ABCD-EFGH",
        verificationUrl: "https://auth.openai.com/codex/device",
        intervalSeconds: 3,
      })),
      pollAuthorization: vi.fn(async () => ({ status: "pending" as const })),
      exchangeAuthorizationCode: vi.fn(async () => {
        throw new Error("not used");
      }),
    },
    createLoginId: () => "login-1",
    ...overrides,
  };
}

describe("hosted pool dashboard boundary", () => {
  it("authorizes and checks entitlement before forwarding auth bytes", async () => {
    const order: string[] = [];
    const dependencies = mutationDependencies({
      authorizeWorkspaceAdmin: vi.fn(async () => {
        order.push("authorize");
        return { actor: "user:owner" };
      }),
      assertEntitled: vi.fn(async () => {
        order.push("entitlement");
      }),
      mutations: {
        importAccount: vi.fn(async () => {
          order.push("import");
        }),
        setAccountState: vi.fn(async () => undefined),
        setRepositorySource: vi.fn(async () => ({
          activation: "pending" as const,
        })),
      },
    });

    await importHostedPoolAccount(
      {
        workspaceId: "workspace-1",
        label: "Primary",
        priority: 10,
        authJson: async () => {
          order.push("read");
          return new TextEncoder().encode("secret bytes");
        },
      },
      dependencies,
    );
    expect(order).toEqual(["authorize", "entitlement", "read", "import"]);
  });

  it("zeroes uploaded auth bytes when credential enrollment fails", async () => {
    const authJson = new TextEncoder().encode("secret bytes");
    const dependencies = mutationDependencies({
      mutations: {
        importAccount: vi.fn(async () => {
          throw new Error("credential_enrollment_failed");
        }),
        setAccountState: vi.fn(async () => undefined),
        setRepositorySource: vi.fn(async () => ({
          activation: "pending" as const,
        })),
      },
    });

    await expect(
      importHostedPoolAccount(
        {
          workspaceId: "workspace-1",
          label: "Primary",
          priority: 10,
          authJson,
        },
        dependencies,
      ),
    ).rejects.toThrow("credential_enrollment_failed");
    expect(authJson.every((byte) => byte === 0)).toBe(true);
  });

  it("requires a workspace admin before starting device login", async () => {
    const dependencies = deviceLoginDependencies({
      authorizeWorkspaceAdmin: vi.fn(async () => {
        throw new Error("not_workspace_admin");
      }),
    });
    await expect(
      startHostedPoolDeviceLogin(
        { workspaceId: "workspace-1", label: "Primary", priority: 10 },
        dependencies,
      ),
    ).rejects.toThrow("not_workspace_admin");
    expect(dependencies.deviceAuth.requestUserCode).not.toHaveBeenCalled();
  });

  it("keeps device_auth_id off the dashboard poll result", async () => {
    const dependencies = deviceLoginDependencies();
    const started = await startHostedPoolDeviceLogin(
      { workspaceId: "workspace-1", label: "Primary", priority: 10 },
      dependencies,
    );
    expect(started.userCode).toBe("ABCD-EFGH");
    expect(JSON.stringify(started)).not.toMatch(/device-auth-secret|refresh/iu);
    const pending = await pollHostedPoolDeviceLogin(
      { workspaceId: "workspace-1", loginId: started.loginId },
      dependencies,
    );
    expect(pending.status).toBe("pending");
    expect(JSON.stringify(pending)).not.toMatch(/device-auth-secret|refresh/iu);
  });

  it("rejects unknown visibility before a hosted binding mutation", async () => {
    const dependencies = mutationDependencies({
      getRepository: vi.fn(async () => ({
        id: "repo-1",
        workspaceId: "workspace-1",
        fullName: "acme/public",
        visibility: "unknown",
      })),
    });
    await expect(
      changeHostedRepositorySessionSource(
        {
          workspaceId: "workspace-1",
          repositoryId: "repo-1",
          source: "hosted_workspace_pool",
          expectedVersion: 0,
        },
        dependencies,
      ),
    ).rejects.toThrow("hosted_pool_repository_visibility_ineligible");
    expect(dependencies.mutations.setRepositorySource).not.toHaveBeenCalled();
  });

  it.each(["public", "private", "internal"])(
    "allows %s visibility consistently in mutation and read model",
    async (visibility) => {
      const repository = {
        id: "repo-1",
        workspaceId: "workspace-1",
        fullName: "acme/repo",
        visibility,
      };
      const dependencies = mutationDependencies({
        getRepository: vi.fn(async () => repository),
      });
      await expect(
        changeHostedRepositorySessionSource(
          {
            workspaceId: "workspace-1",
            repositoryId: "repo-1",
            source: "hosted_workspace_pool",
            expectedVersion: 0,
          },
          dependencies,
        ),
      ).resolves.toEqual({ activation: "pending" });
      expect(dependencies.mutations.setRepositorySource).toHaveBeenCalledOnce();
      const view = await loadHostedPoolDashboardView({
        workspaceId: "workspace-1",
        repositories: [repository],
        featureEnabled: true,
        entitled: true,
        queries: {
          getDefaultPoolSummary: vi.fn(async () => null),
          listAccountSummaries: vi.fn(async () => []),
          getRepositoryBindingSummary: vi.fn(async () => null),
        },
      });
      expect(view.repositories[0]).toMatchObject({
        eligible: true,
        activation: "legacy",
      });
    },
  );

  it("does not treat public visibility as workspace authorization", async () => {
    const dependencies = mutationDependencies({
      getRepository: vi.fn(async () => ({
        id: "repo-1",
        workspaceId: "other-workspace",
        fullName: "acme/public",
        visibility: "public",
      })),
    });
    await expect(
      changeHostedRepositorySessionSource(
        {
          workspaceId: "workspace-1",
          repositoryId: "repo-1",
          source: "hosted_workspace_pool",
          expectedVersion: 0,
        },
        dependencies,
      ),
    ).rejects.toThrow("repository_not_found");
    expect(dependencies.mutations.setRepositorySource).not.toHaveBeenCalled();
  });

  it("forwards the explicit version and reports pending activation without fallback", async () => {
    const dependencies = mutationDependencies();
    await expect(
      changeHostedRepositorySessionSource(
        {
          workspaceId: "workspace-1",
          repositoryId: "repo-1",
          source: "hosted_workspace_pool",
          expectedVersion: 4,
        },
        dependencies,
      ),
    ).resolves.toEqual({ activation: "pending" });
    expect(dependencies.mutations.setRepositorySource).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 4 }),
    );
  });

  it("treats a missing binding as legacy mode", async () => {
    const queries: HostedPoolQueryPort = {
      getDefaultPoolSummary: vi.fn(async () => null),
      listAccountSummaries: vi.fn(async () => []),
      getRepositoryBindingSummary: vi.fn(async () => null),
    };
    const view = await loadHostedPoolDashboardView({
      workspaceId: "workspace-1",
      repositories: [
        { id: "repo-1", fullName: "acme/private", visibility: "private" },
      ],
      featureEnabled: true,
      entitled: true,
      queries,
    });
    expect(view.repositories[0]).toMatchObject({
      source: "repository_secret",
      bindingVersion: 0,
      activation: "legacy",
    });
  });

  it("never silently falls back when a hosted binding exists but its pool is unavailable", async () => {
    const queries: HostedPoolQueryPort = {
      getDefaultPoolSummary: vi.fn(async () => null),
      listAccountSummaries: vi.fn(async () => []),
      getRepositoryBindingSummary: vi.fn(async () => ({
        id: "binding-1" as never,
        bindingId: "binding-1" as never,
        repositoryId: "repo-1" as never,
        poolId: "pool-1" as never,
        revision: 3,
        stateVersion: 5,
        status: "active" as const,
        activatedAt: new Date(),
        updatedAt: new Date(),
      })),
    };
    const view = await loadHostedPoolDashboardView({
      workspaceId: "workspace-1",
      repositories: [
        { id: "repo-1", fullName: "acme/private", visibility: "private" },
      ],
      featureEnabled: true,
      entitled: true,
      queries,
    });
    expect(view.repositories[0]).toMatchObject({
      source: "hosted_workspace_pool",
      bindingVersion: 3,
      activation: "pending",
    });
  });

  it("shows repository-owned source after an active binding enters draining", async () => {
    const queries: HostedPoolQueryPort = {
      getDefaultPoolSummary: vi.fn(async () => ({
        id: "pool-1" as never,
        workspaceId: "workspace-1" as never,
        revision: 2,
        status: "active" as const,
        isDefault: true as const,
        accountCount: 1,
        healthyAccountCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      listAccountSummaries: vi.fn(async () => []),
      getRepositoryBindingSummary: vi.fn(async () => ({
        id: "binding-1" as never,
        bindingId: "binding-1" as never,
        repositoryId: "repo-1" as never,
        poolId: "pool-1" as never,
        revision: 4,
        stateVersion: 6,
        status: "draining" as const,
        activatedAt: new Date(),
        updatedAt: new Date(),
      })),
    };
    const view = await loadHostedPoolDashboardView({
      workspaceId: "workspace-1",
      repositories: [
        { id: "repo-1", fullName: "acme/private", visibility: "private" },
      ],
      featureEnabled: true,
      entitled: true,
      queries,
    });
    expect(view.repositories[0]).toMatchObject({
      source: "repository_secret",
      bindingId: "binding-1",
      bindingVersion: 4,
      activation: "legacy",
    });
  });
});
