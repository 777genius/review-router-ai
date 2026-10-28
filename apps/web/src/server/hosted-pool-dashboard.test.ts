import { describe, expect, it, vi } from "vitest";
import {
  enrollHostedPoolAccount,
  fingerprintCodexAuthJson,
  hostedAccountId,
  hostedPoolId,
  reconnectHostedAccount,
  workspaceId,
  type HostedAccountRepositoryPort,
  type HostedCodexDeviceLoginRecord,
  type HostedPoolAccount,
  type HostedCodexDeviceReconnectTarget,
  type HostedAccountSafeSummary,
  type HostedPoolQueryPort,
} from "@reviewrouter/features-hosted-account-pool";
import {
  changeHostedRepositorySessionSource,
  importHostedPoolAccount,
  isHostedWorkspacePoolSessionReady,
  loadHostedPoolDashboardView,
  pollHostedPoolDeviceLogin,
  startHostedPoolDeviceLogin,
  type HostedPoolDashboardMutationDependencies,
  type HostedPoolDeviceLoginDependencies,
} from "./hosted-pool-dashboard";

function safeAccount(
  overrides: Partial<HostedAccountSafeSummary> = {},
): HostedAccountSafeSummary {
  return {
    id: "account-1" as never,
    label: "Primary",
    priority: 10,
    availability: { status: "healthy" },
    healthVersion: 1,
    authGeneration: 1,
    validatedAt: new Date("2026-08-15T12:00:00.000Z"),
    credentialExpiresAt: null,
    refreshDue: false,
    createdAt: new Date("2026-08-15T12:00:00.000Z"),
    updatedAt: new Date("2026-08-15T12:00:00.000Z"),
    ...overrides,
  };
}

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
      assertReconnectTarget: vi.fn(async () => undefined),
      reconnectAccount: vi.fn(async () => safeAccount()),
      importAccount: vi.fn(async () => safeAccount()),
      setAccountState: vi.fn(async () => undefined),
      removeAccount: vi.fn(async () => undefined),
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
  const pending = new Map<string, HostedCodexDeviceLoginRecord>();
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
        pending.set(record.id, { ...record });
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
              reconnectTarget: row.reconnectTarget,
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
      markTerminal: vi.fn(async (command) => {
        const row = pending.get(command.id);
        if (!row || row.status !== command.expectedStatus) return false;
        pending.set(command.id, {
          ...row,
          status: command.status,
          deviceAuthId: null,
          updatedAt: command.now,
        });
        return true;
      }),
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
        ...mutationDependencies().mutations,
        importAccount: vi.fn(async () => {
          order.push("import");
          return safeAccount();
        }),
        setAccountState: vi.fn(async () => undefined),
        removeAccount: vi.fn(async () => undefined),
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
        ...mutationDependencies().mutations,
        importAccount: vi.fn(async () => {
          throw new Error("credential_enrollment_failed");
        }),
        setAccountState: vi.fn(async () => undefined),
        removeAccount: vi.fn(async () => undefined),
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

  it("returns the enrolled account for an immediate dashboard update", async () => {
    const enrolled = safeAccount({
      id: "account-new" as never,
      label: "New account",
    });
    const dependencies = deviceLoginDependencies({
      mutations: {
        ...mutationDependencies().mutations,
        importAccount: vi.fn(async () => enrolled),
        setAccountState: vi.fn(async () => undefined),
        removeAccount: vi.fn(async () => undefined),
        setRepositorySource: vi.fn(async () => ({
          activation: "pending" as const,
        })),
      },
      deviceAuth: {
        requestUserCode: vi.fn(async () => ({
          deviceAuthId: "device-auth-secret",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.openai.com/codex/device",
          intervalSeconds: 3,
        })),
        pollAuthorization: vi.fn(async () => ({
          status: "authorized" as const,
          authorizationCode: "authorization-code",
          codeVerifier: "code-verifier",
        })),
        exchangeAuthorizationCode: vi.fn(async () => ({
          idToken: "id-token",
          accessToken: "access-token",
          refreshToken: "refresh-token",
        })),
      },
    });
    const started = await startHostedPoolDeviceLogin(
      { workspaceId: "workspace-1", label: "New account", priority: 10 },
      dependencies,
    );

    await expect(
      pollHostedPoolDeviceLogin(
        { workspaceId: "workspace-1", loginId: started.loginId },
        dependencies,
      ),
    ).resolves.toMatchObject({ status: "imported", account: enrolled });
  });

  it("reconnects an explicitly selected paused identity once instead of duplicate import", async () => {
    // Regression: routing this fresh exchange to create rejects the duplicate
    // and terminalizes the flight, without replacing the selected generation.
    const now = new Date("2026-08-15T12:00:00.000Z");
    const pepper = Buffer.alloc(32, 7);
    const claims = Buffer.from(
      JSON.stringify({
        iss: "https://auth.openai.com",
        sub: "fixture-subject",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "fixture-account",
        },
      }),
    ).toString("base64url");
    const tokens = {
      idToken: `e30.${claims}.fixture-signature`,
      accessToken: "fixture-access-token",
      refreshToken: "fixture-refresh-token",
    };
    const initialAuth = Buffer.from(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          id_token: tokens.idToken,
          refresh_token: tokens.refreshToken,
        },
        last_refresh: now.toISOString(),
      }),
    );
    const initial = enrollHostedPoolAccount({
      id: hostedAccountId("selected-account"),
      poolId: hostedPoolId("pool-1"),
      label: "Same display label",
      priority: 10,
      credential: {
        credentialRef: "opaque",
        subjectFingerprint: fingerprintCodexAuthJson(initialAuth, pepper),
        authGeneration: 3,
        validatedAt: now,
        expiresAt: null,
      },
      now,
    });
    const rows: HostedPoolAccount[] = [
      {
        ...initial,
        availability: { status: "paused", reason: "Operator" },
        healthVersion: 9,
      },
    ];
    const accounts: HostedAccountRepositoryPort = {
      findById: async (id) => rows.find((row) => row.id === id) ?? null,
      findBySubjectFingerprint: async (command) =>
        rows.find(
          (row) =>
            row.poolId === command.poolId &&
            row.credential.subjectFingerprint === command.subjectFingerprint,
        ) ?? null,
      listByPoolId: async () => rows,
      replaceCredential: async () => {
        throw new Error("wrong refresh path");
      },
      saveAvailability: async () => {
        throw new Error("must stay paused");
      },
      tombstone: async () => {
        throw new Error("must preserve account");
      },
    };
    const assertTarget = async (
      target: HostedCodexDeviceReconnectTarget & { workspaceId: string },
    ) => {
      const row = rows[0]!;
      if (
        target.workspaceId !== "workspace-1" ||
        target.accountId !== row.id ||
        target.expectedGeneration !== row.credential.authGeneration ||
        target.expectedHealthVersion !== row.healthVersion ||
        row.availability.status !== "paused"
      ) {
        throw new Error("hosted_codex_reconnect_conflict");
      }
    };
    let exchangedBytes: Uint8Array | undefined;
    const commit = vi.fn(
      async (command: {
        expectedGeneration: number;
        expectedHealthVersion: number;
      }) => {
        const row = rows[0]!;
        if (
          row.credential.authGeneration !== command.expectedGeneration ||
          row.healthVersion !== command.expectedHealthVersion
        ) {
          return { status: "stale_generation" };
        }
        rows[0] = {
          ...row,
          credential: {
            ...row.credential,
            authGeneration: command.expectedGeneration + 1,
          },
          healthVersion: command.expectedHealthVersion + 1,
        };
        return {
          status: "accepted",
          generation: command.expectedGeneration + 1,
        };
      },
    );
    let flightNumber = 0;
    const dependencies = deviceLoginDependencies({
      createLoginId: () => `fresh-flight-${++flightNumber}`,
      mutations: {
        ...mutationDependencies().mutations,
        assertReconnectTarget: vi.fn(assertTarget),
        importAccount: vi.fn(async (command) => {
          exchangedBytes = command.authJson;
          if (
            fingerprintCodexAuthJson(command.authJson, pepper) ===
            rows[0]!.credential.subjectFingerprint
          ) {
            throw new Error("hosted_account_subject_already_enrolled");
          }
          throw new Error("unexpected identity");
        }),
        reconnectAccount: vi.fn(async (command) => {
          exchangedBytes = command.authJson;
          await assertTarget(command);
          await reconnectHostedAccount(
            {
              workspaceId: workspaceId(command.workspaceId),
              poolId: hostedPoolId("pool-1"),
              accountId: hostedAccountId(command.accountId),
              expectedGeneration: command.expectedGeneration,
              expectedHealthVersion: command.expectedHealthVersion,
              authJsonBytes: command.authJson,
            },
            {
              accounts,
              validate: (bytes) => ({
                fingerprint: fingerprintCodexAuthJson(bytes, pepper),
                generationHash: "fixture-hash",
              }),
              acquire: async () => "fixture-fence",
              release: async () => undefined,
              commit,
            },
          );
          const row = rows[0]!;
          return safeAccount({
            id: row.id,
            label: row.label,
            authGeneration: row.credential.authGeneration,
            healthVersion: row.healthVersion,
            availability: row.availability,
          });
        }),
      },
      deviceAuth: {
        requestUserCode: vi.fn(async () => ({
          deviceAuthId: "fixture-device",
          userCode: "ABCD-EFGH",
          verificationUrl: "https://auth.openai.com/codex/device",
          intervalSeconds: 3,
        })),
        pollAuthorization: vi.fn(async () => ({
          status: "authorized" as const,
          authorizationCode: "fixture-code",
          codeVerifier: "fixture-verifier",
        })),
        exchangeAuthorizationCode: vi.fn(async () => tokens),
      },
    });
    const create = await startHostedPoolDeviceLogin(
      { workspaceId: "workspace-1", label: initial.label, priority: 10 },
      dependencies,
    );
    await expect(
      pollHostedPoolDeviceLogin(
        { workspaceId: "workspace-1", loginId: create.loginId },
        dependencies,
      ),
    ).rejects.toThrow("hosted_account_subject_already_enrolled");
    expect(exchangedBytes?.every((byte) => byte === 0)).toBe(true);
    const target = {
      accountId: String(initial.id),
      expectedGeneration: 3,
      expectedHealthVersion: 9,
    };
    const reconnect = await startHostedPoolDeviceLogin(
      {
        workspaceId: "workspace-1",
        label: initial.label,
        priority: 10,
        reconnectTarget: target,
      },
      dependencies,
    );
    target.expectedGeneration = 999; // caller mutation cannot retarget persisted intent
    const poll = { workspaceId: "workspace-1", loginId: reconnect.loginId };
    await expect(
      pollHostedPoolDeviceLogin(poll, dependencies),
    ).resolves.toMatchObject({
      status: "imported",
      account: {
        id: initial.id,
        authGeneration: 4,
        healthVersion: 10,
        availability: { status: "paused" },
      },
    });
    await expect(
      pollHostedPoolDeviceLogin(poll, dependencies),
    ).resolves.toMatchObject({ status: "imported" });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(dependencies.mutations.importAccount).toHaveBeenCalledTimes(1);
    expect(dependencies.mutations.reconnectAccount).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.availability.status).toBe("paused");
    expect(exchangedBytes?.every((byte) => byte === 0)).toBe(true);
  });

  it("rejects a reconnect target conflict before requesting a device code", async () => {
    const dependencies = deviceLoginDependencies();
    dependencies.mutations.assertReconnectTarget = vi.fn(async () => {
      throw new Error("hosted_codex_reconnect_conflict");
    });
    await expect(
      startHostedPoolDeviceLogin(
        {
          workspaceId: "workspace-1",
          label: "Primary",
          priority: 10,
          reconnectTarget: {
            accountId: "foreign-or-stale",
            expectedGeneration: 3,
            expectedHealthVersion: 9,
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("hosted_codex_reconnect_conflict");
    expect(dependencies.deviceAuth.requestUserCode).not.toHaveBeenCalled();
  });

  it("rejects an actor change during token exchange before reconnect mutation", async () => {
    const authorize = vi.fn(async () => ({ actor: "user:owner" }));
    const dependencies = deviceLoginDependencies({
      authorizeWorkspaceAdmin: authorize,
    });
    dependencies.deviceAuth.pollAuthorization = vi.fn(async () => ({
      status: "authorized" as const,
      authorizationCode: "fixture-code",
      codeVerifier: "fixture-verifier",
    }));
    dependencies.deviceAuth.exchangeAuthorizationCode = vi.fn(async () => {
      authorize.mockResolvedValue({ actor: "user:different-admin" });
      return {
        idToken: "fixture-id-token",
        accessToken: "fixture-access-token",
        refreshToken: "fixture-refresh-token",
      };
    });
    const started = await startHostedPoolDeviceLogin(
      {
        workspaceId: "workspace-1",
        label: "Primary",
        priority: 10,
        reconnectTarget: {
          accountId: "account-1",
          expectedGeneration: 3,
          expectedHealthVersion: 9,
        },
      },
      dependencies,
    );
    await expect(
      pollHostedPoolDeviceLogin(
        { workspaceId: "workspace-1", loginId: started.loginId },
        dependencies,
      ),
    ).rejects.toThrow("hosted_pool_device_login_forbidden");
    expect(dependencies.mutations.reconnectAccount).not.toHaveBeenCalled();
    expect(dependencies.mutations.importAccount).not.toHaveBeenCalled();
    expect(
      await dependencies.deviceLoginStore.findById(started.loginId as never),
    ).toMatchObject({ status: "failed", deviceAuthId: null });
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
          listRepositoryBindingSummaries: vi.fn(async () => []),
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
      listRepositoryBindingSummaries: vi.fn(async () => []),
    };
    const view = await loadHostedPoolDashboardView({
      workspaceId: "workspace-1",
      repositories: [
        { id: "repo-1", fullName: "acme/private", visibility: "private" },
        { id: "repo-2", fullName: "acme/second", visibility: "public" },
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
    expect(view.repositories[1]).toMatchObject({
      source: "repository_secret",
      bindingVersion: 0,
    });
    expect(
      queries.listRepositoryBindingSummaries,
    ).toHaveBeenCalledExactlyOnceWith(["repo-1", "repo-2"]);
    expect(queries.getRepositoryBindingSummary).not.toHaveBeenCalled();
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
      listRepositoryBindingSummaries: vi.fn(async () => [
        {
          id: "binding-1" as never,
          bindingId: "binding-1" as never,
          repositoryId: "repo-1" as never,
          poolId: "pool-1" as never,
          revision: 3,
          stateVersion: 5,
          status: "active" as const,
          activatedAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
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
      listRepositoryBindingSummaries: vi.fn(async () => [
        {
          id: "binding-1" as never,
          bindingId: "binding-1" as never,
          repositoryId: "repo-1" as never,
          poolId: "pool-1" as never,
          revision: 4,
          stateVersion: 6,
          status: "draining" as const,
          activatedAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
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

  it("marks only an active hosted workspace pool binding as session-ready", () => {
    expect(
      isHostedWorkspacePoolSessionReady({
        source: "hosted_workspace_pool",
        activation: "active",
      }),
    ).toBe(true);
    expect(
      isHostedWorkspacePoolSessionReady({
        source: "hosted_workspace_pool",
        activation: "pending",
      }),
    ).toBe(false);
    expect(
      isHostedWorkspacePoolSessionReady({
        source: "repository_secret",
        activation: "legacy",
      }),
    ).toBe(false);
  });
});
