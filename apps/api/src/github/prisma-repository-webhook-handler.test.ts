import { describe, expect, it, vi } from "vitest";
import { PrismaRepositoryWebhookHandler } from "./prisma-repository-webhook-handler";

describe("PrismaRepositoryWebhookHandler", () => {
  it("updates synced repository metadata from repository webhook payloads", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "master",
        fullName: "777genius/example",
        lastSyncedAt: null,
        scmRepositoryIdentityId: "identity_1",
        selected: true,
        installation: { githubInstallationId: 129154876n },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const scmRepositoryIdentity = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
      scmRepositoryIdentity,
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    const result = await handler.handleGitHubRepositoryWebhook({
      deliveryId: "delivery_1",
      eventName: "repository",
      payload: {
        action: "renamed",
        installation: {
          id: 129154876,
          account: { login: "777genius", type: "User" },
          repository_selection: "all",
        },
        repository: {
          id: 123456,
          owner: { login: "777genius" },
          name: "renamed-example",
          full_name: "777genius/renamed-example",
          default_branch: "main",
          visibility: "private",
          private: true,
          archived: true,
          stargazers_count: 9,
          updated_at: "2026-09-14T10:00:00.000Z",
        },
      },
    });

    expect(result).toEqual({
      processed: true,
      repository: "777genius/renamed-example",
      status: "synced",
    });
    expect(repositoryConnection.findUnique).toHaveBeenCalledWith({
      where: { githubRepositoryId: 123456n },
      select: {
        id: true,
        workspaceId: true,
        installationId: true,
        defaultBranch: true,
        fullName: true,
        lastSyncedAt: true,
        selected: true,
        scmRepositoryIdentityId: true,
        installation: { select: { githubInstallationId: true } },
      },
    });
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: {
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        scmRepositoryIdentityId: "identity_1",
        lastSyncedAt: null,
      },
      data: expect.objectContaining({
        owner: "777genius",
        name: "renamed-example",
        fullName: "777genius/renamed-example",
        defaultBranch: "main",
        visibility: "private",
        archived: true,
        stargazersCount: 9,
      }),
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    expect(
      (transaction.$queryRaw.mock.calls[1]![0] as { text: string }).text,
    ).toContain('UPDATE "ScmRepositoryIdentity"');
  });

  it("keeps replayed repository metadata updates idempotent", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "777genius/example",
        scmRepositoryIdentityId: "identity_1",
        selected: true,
        installation: { githubInstallationId: 129154876n },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const scmRepositoryIdentity = { updateMany: vi.fn() };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ version: 2 }]),
      repositoryConnection,
      scmRepositoryIdentity,
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await handler.handleGitHubRepositoryWebhook({
      deliveryId: "delivery_replay",
      eventName: "repository",
      payload: {
        action: "edited",
        installation: {
          id: 129154876,
          account: { login: "777genius", type: "User" },
          repository_selection: "all",
        },
        repository: {
          id: 123456,
          owner: { login: "777genius" },
          name: "example",
          full_name: "777genius/example",
          default_branch: "main",
          visibility: "public",
          private: false,
          archived: false,
        },
      },
    });

    expect(scmRepositoryIdentity.updateMany).not.toHaveBeenCalled();
  });

  it("unselects deleted repositories instead of losing historical state", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "777genius/example",
        scmRepositoryIdentityId: "identity_1",
        selected: true,
        installation: { githubInstallationId: 129154876n },
      }),
      updateMany: vi
        .fn()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 }),
    };
    const scmRepositoryIdentity = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ version: 2 }]),
      repositoryConnection,
      scmRepositoryIdentity,
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    const result = await handler.handleGitHubRepositoryWebhook({
      deliveryId: "delivery_2",
      eventName: "repository",
      payload: {
        action: "deleted",
        installation: {
          id: 129154876,
          account: { login: "777genius", type: "User" },
          repository_selection: "all",
        },
        repository: {
          id: 123456,
          owner: { login: "777genius" },
          name: "example",
          full_name: "777genius/example",
          default_branch: "main",
          visibility: "public",
          private: false,
          archived: false,
        },
      },
    });

    expect(result).toEqual({
      processed: true,
      repository: "777genius/example",
      status: "unselected",
    });
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "repo_1", selected: true },
      data: expect.objectContaining({
        selected: false,
      }),
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_2_replay",
        eventName: "repository",
        payload: {
          action: "deleted",
          installation: {
            id: 129154876,
            account: { login: "777genius", type: "User" },
            repository_selection: "all",
          },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "example",
            full_name: "777genius/example",
            default_branch: "main",
            visibility: "public",
            private: false,
            archived: false,
          },
        },
      }),
    ).resolves.toMatchObject({ processed: true, status: "unselected" });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("serializes transfer lookup by immutable repository ID and CASes the old installation", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_old",
        installationId: "installation_old",
        defaultBranch: "main",
        fullName: "old/example",
        selected: true,
        scmRepositoryIdentityId: "identity_1",
        installation: { githubInstallationId: 111n },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const scmRepositoryIdentity = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const events: string[] = [];
    const transaction = {
      $queryRaw: vi.fn().mockImplementation(async (sql) => {
        const text = sql?.text ?? Array.from(sql ?? []).join("?");
        events.push(
          text.includes('UPDATE "ScmRepositoryIdentity"')
            ? "identity-rotate"
            : "guard",
        );
        return [{ version: 2 }];
      }),
      repositoryConnection: {
        ...repositoryConnection,
        findUnique: vi.fn().mockImplementation(async (...args) => {
          events.push("repository-read");
          return repositoryConnection.findUnique(...args);
        }),
      },
      gitHubInstallation: {
        findUnique: vi.fn().mockImplementation(async () => {
          events.push("destination-read");
          return { id: "installation_new", workspaceId: "workspace_new" };
        }),
      },
      scmRepositoryIdentity,
      workflowProvisioning: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
      },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_transfer",
        eventName: "repository",
        payload: {
          action: "transferred",
          installation: { id: 222 },
          repository: {
            id: 123456,
            owner: { login: "new" },
            name: "example",
            full_name: "new/example",
            default_branch: "main",
            private: true,
            archived: false,
          },
        },
      }),
    ).resolves.toMatchObject({
      processed: true,
      status: "reconnect_reselection_required",
    });
    expect(events).toEqual(["guard", "repository-read", "identity-rotate"]);
    expect(transaction.gitHubInstallation.findUnique).not.toHaveBeenCalled();
    expect(repositoryConnection.updateMany).toHaveBeenCalledOnce();
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "repo_1", selected: true },
      data: { selected: false, lastSyncedAt: expect.any(Date) },
    });
    expect(
      repositoryConnection.updateMany.mock.calls.some(([call]) =>
        Object.keys(call.data).some(
          (key) => key === "workspaceId" || key === "installationId",
        ),
      ),
    ).toBe(false);
  });

  it("fences transfer authority when GitHub reports the old installation ID before destination sync", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_old",
        installationId: "installation_old",
        defaultBranch: "main",
        fullName: "old/example",
        lastSyncedAt: new Date("2026-09-14T09:00:00.000Z"),
        selected: true,
        scmRepositoryIdentityId: "identity_1",
        installation: { githubInstallationId: 111n },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const workflowProvisioning = {
      findUnique: vi.fn().mockResolvedValue({
        id: "provisioning_1",
        attemptId: "attempt_1",
        revision: 3,
        status: "setup_pr_open",
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ version: 3 }]),
      repositoryConnection,
      gitHubInstallation: { findUnique: vi.fn() },
      workflowProvisioning,
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_transfer_before_installation",
        eventName: "repository",
        payload: {
          action: "transferred",
          installation: { id: 111 },
          repository: {
            id: 123456,
            owner: { login: "new" },
            name: "example",
            full_name: "new/example",
            default_branch: "main",
            private: true,
            archived: false,
          },
        },
      }),
    ).resolves.toMatchObject({
      processed: true,
      status: "reconnect_reselection_required",
    });
    expect(transaction.gitHubInstallation.findUnique).not.toHaveBeenCalled();
    expect(workflowProvisioning.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "provisioning_1" }),
      data: expect.objectContaining({
        status: "not_started",
        errorMessage: "repository_transfer_reconnect_reselection_required",
      }),
    });
  });

  it("ignores a delayed rename after newer repository metadata was stored", async () => {
    const lastSyncedAt = new Date("2026-09-14T10:00:00.000Z");
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "new/example",
        lastSyncedAt,
        selected: true,
        scmRepositoryIdentityId: "identity_1",
        installation: { githubInstallationId: 111n },
      }),
      updateMany: vi.fn(),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_delayed_rename",
        eventName: "repository",
        payload: {
          action: "renamed",
          installation: { id: 111 },
          repository: {
            id: 123456,
            owner: { login: "old" },
            name: "example",
            full_name: "old/example",
            default_branch: "main",
            private: false,
            archived: false,
            updated_at: "2026-09-14T09:59:59.000Z",
          },
        },
      }),
    ).resolves.toEqual({
      processed: true,
      repository: "new/example",
      status: "stale_ignored",
    });
    expect(repositoryConnection.updateMany).not.toHaveBeenCalled();
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
  });

  it("applies a legitimate same-second rename after an inventory sync", async () => {
    const lastSyncedAt = new Date("2026-09-14T10:00:00.750Z");
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "777genius/example",
        lastSyncedAt,
        selected: true,
        scmRepositoryIdentityId: "identity_1",
        installation: { githubInstallationId: 111n },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
      scmRepositoryIdentity: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_same_second_rename",
        eventName: "repository",
        payload: {
          action: "renamed",
          installation: { id: 111 },
          changes: { repository: { name: { from: "example" } } },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "renamed-example",
            full_name: "777genius/renamed-example",
            default_branch: "main",
            private: false,
            archived: false,
            updated_at: "2026-09-14T10:00:00.000Z",
          },
        },
      }),
    ).resolves.toEqual({
      processed: true,
      repository: "777genius/renamed-example",
      status: "synced",
    });
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ lastSyncedAt }),
      data: {
        owner: "777genius",
        name: "renamed-example",
        fullName: "777genius/renamed-example",
        lastSyncedAt,
      },
    });
  });

  it("rejects a delayed same-second rename whose preimage no longer matches", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "777genius/newest-example",
        lastSyncedAt: new Date("2026-09-14T10:00:00.750Z"),
        selected: true,
        scmRepositoryIdentityId: "identity_1",
        installation: { githubInstallationId: 111n },
      }),
      updateMany: vi.fn(),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_delayed_same_second_rename",
        eventName: "repository",
        payload: {
          action: "renamed",
          installation: { id: 111 },
          changes: { repository: { name: { from: "example" } } },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "intermediate-example",
            full_name: "777genius/intermediate-example",
            default_branch: "main",
            private: false,
            archived: false,
            updated_at: "2026-09-14T10:00:00.000Z",
          },
        },
      }),
    ).resolves.toEqual({
      processed: true,
      repository: "777genius/newest-example",
      status: "stale_ignored",
    });
    expect(repositoryConnection.updateMany).not.toHaveBeenCalled();
  });

  it("applies a legitimate same-second default-branch edit after an inventory sync", async () => {
    const lastSyncedAt = new Date("2026-09-14T10:00:00.750Z");
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "master",
        fullName: "777genius/example",
        lastSyncedAt,
        selected: true,
        scmRepositoryIdentityId: "identity_1",
        installation: { githubInstallationId: 111n },
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_same_second_default_branch",
        eventName: "repository",
        payload: {
          action: "edited",
          installation: { id: 111 },
          changes: { default_branch: { from: "master" } },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "example",
            full_name: "777genius/example",
            default_branch: "main",
            private: false,
            archived: false,
            updated_at: "2026-09-14T10:00:00.000Z",
          },
        },
      }),
    ).resolves.toEqual({
      processed: true,
      repository: "777genius/example",
      status: "synced",
    });
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ lastSyncedAt }),
      data: {
        defaultBranch: "main",
        lastSyncedAt,
      },
    });
  });

  it("rejects a delayed same-second default-branch edit whose preimage no longer matches", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "trunk",
        fullName: "777genius/example",
        lastSyncedAt: new Date("2026-09-14T10:00:00.750Z"),
        selected: true,
        scmRepositoryIdentityId: "identity_1",
        installation: { githubInstallationId: 111n },
      }),
      updateMany: vi.fn(),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
      gitHubInstallation: { findUnique: vi.fn() },
    };
    const handler = new PrismaRepositoryWebhookHandler({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as never);

    await expect(
      handler.handleGitHubRepositoryWebhook({
        deliveryId: "delivery_delayed_same_second_default_branch",
        eventName: "repository",
        payload: {
          action: "edited",
          installation: { id: 111 },
          changes: { default_branch: { from: "master" } },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "example",
            full_name: "777genius/example",
            default_branch: "main",
            private: false,
            archived: false,
            updated_at: "2026-09-14T10:00:00.000Z",
          },
        },
      }),
    ).resolves.toEqual({
      processed: true,
      repository: "777genius/example",
      status: "stale_ignored",
    });
    expect(repositoryConnection.updateMany).not.toHaveBeenCalled();
  });
});
