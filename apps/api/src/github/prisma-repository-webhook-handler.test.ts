import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { GitHubRepositoryWebhookEnvelope } from "@reviewrouter/features-github-installations";
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

  it.each(["created", "deleted", "edited", "renamed", "transferred"])(
    "fences repository authority on an installation mismatch for the %s action",
    async (action) => {
      const repositoryConnection = {
        findUnique: vi.fn().mockResolvedValue({
          id: "repo_1",
          workspaceId: "workspace_1",
          installationId: "installation_1",
          defaultBranch: "main",
          fullName: "777genius/example",
          lastSyncedAt: new Date("2026-09-14T10:00:00.000Z"),
          selected: true,
          scmRepositoryIdentityId: "identity_1",
          installation: { githubInstallationId: 111n },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      };
      const transaction = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ locked: 1 }])
          .mockResolvedValueOnce([{ version: 2 }]),
        repositoryConnection,
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
          deliveryId: `delivery_mismatched_${action}`,
          eventName: "repository",
          payload: {
            action,
            installation: { id: 222 },
            repository: {
              id: 123456,
              owner: { login: "777genius" },
              name: "example",
              full_name: "777genius/example",
              default_branch: "main",
              private: false,
              archived: false,
            },
          },
        }),
      ).resolves.toEqual({
        processed: true,
        repository: "777genius/example",
        status: "reconnect_reselection_required",
      });
      expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
      expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
        where: { id: "repo_1", selected: true },
        data: { selected: false, lastSyncedAt: expect.any(Date) },
      });
    },
  );

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

  it("fences a delayed same-second rename whose preimage no longer matches", async () => {
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
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
      status: "reconnect_reselection_required",
    });
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "repo_1", selected: true },
      data: { selected: false, lastSyncedAt: expect.any(Date) },
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("applies a legitimate same-second default-branch edit after an inventory sync", async () => {
    const lastSyncedAt = new Date("2026-09-14T10:00:00.750Z");
    const events: string[] = [];
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
      updateMany: vi.fn().mockImplementation(async () => {
        events.push("metadata-update");
        return { count: 1 };
      }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockImplementation(async (sql) => {
        const text = sql?.text ?? Array.from(sql ?? []).join("?");
        events.push(
          text.includes('UPDATE "ScmRepositoryIdentity"')
            ? "identity-rotate"
            : "guard",
        );
        return text.includes('UPDATE "ScmRepositoryIdentity"')
          ? [{ version: 2 }]
          : [{ locked: 1 }];
      }),
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
    expect(events).toEqual(["guard", "metadata-update", "identity-rotate"]);
  });

  it("fences a delayed same-second default-branch edit whose preimage no longer matches", async () => {
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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: 1 }]),
      repositoryConnection,
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
      status: "reconnect_reselection_required",
    });
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "repo_1", selected: true },
      data: { selected: false, lastSyncedAt: expect.any(Date) },
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it("ignores a delayed non-rename event after newer repository metadata was stored", async () => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "777genius/example",
        lastSyncedAt: new Date("2026-09-14T10:00:00.000Z"),
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
        deliveryId: "delivery_delayed_archive",
        eventName: "repository",
        payload: {
          action: "archived",
          installation: { id: 111 },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "example",
            full_name: "777genius/example",
            default_branch: "master",
            private: true,
            archived: true,
            updated_at: "2026-09-14T09:59:59.000Z",
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

  it.each([
    ["missing", undefined],
    ["not a timestamp", "not-a-timestamp"],
    ["nonexistent calendar date", "2026-02-30T10:00:00.000Z"],
  ])("ignores %s updated_at", async (_label, updatedAt) => {
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "777genius/example",
        lastSyncedAt: null,
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
        deliveryId: "delivery_invalid_updated_at",
        eventName: "repository",
        payload: {
          action: "archived",
          installation: { id: 111 },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "example",
            full_name: "777genius/example",
            default_branch: "main",
            private: false,
            archived: true,
            updated_at: updatedAt,
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

  it("applies an in-order non-rename metadata event using repository.updated_at", async () => {
    const previousTimestamp = new Date("2026-09-14T10:00:00.000Z");
    const repositoryConnection = {
      findUnique: vi.fn().mockResolvedValue({
        id: "repo_1",
        workspaceId: "workspace_1",
        installationId: "installation_1",
        defaultBranch: "main",
        fullName: "777genius/example",
        lastSyncedAt: previousTimestamp,
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
        deliveryId: "delivery_in_order_archive",
        eventName: "repository",
        payload: {
          action: "archived",
          installation: { id: 111 },
          repository: {
            id: 123456,
            owner: { login: "777genius" },
            name: "example",
            full_name: "777genius/example",
            default_branch: "main",
            visibility: "private",
            private: true,
            archived: true,
            stargazers_count: 12,
            updated_at: "2026-09-14T10:00:01.000Z",
          },
        },
      }),
    ).resolves.toEqual({
      processed: true,
      repository: "777genius/example",
      status: "synced",
    });
    expect(repositoryConnection.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ lastSyncedAt: previousTimestamp }),
      data: expect.objectContaining({
        archived: true,
        stargazersCount: 12,
        lastSyncedAt: new Date("2026-09-14T10:00:01.000Z"),
      }),
    });
  });
});

function fixture(
  repositoryConnection = {
    findUnique: vi.fn().mockResolvedValue({
      id: "repo_1",
      defaultBranch: "master",
      fullName: "old/repo",
      workspaceId: "workspace_1",
      installationId: "installation_1",
      lastSyncedAt: null,
      selected: true,
      scmRepositoryIdentityId: null,
      installation: { githubInstallationId: 123n },
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
) {
  const events: string[] = [];
  const query = vi.fn(async (sql: Prisma.Sql) => {
    events.push("guard");
    expect(sql.text).toContain("pg_advisory_xact_lock(");
    expect(sql.values).toEqual([
      createHash("sha256")
        .update("review-current-scope-v1\0global")
        .digest("hex"),
    ]);
    return [{ locked: 1 }];
  });
  const prisma = {
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      events.push("begin");
      const value = await work({
        $queryRaw: query,
        repositoryConnection: {
          findUnique: async (...args: unknown[]) => {
            events.push("read");
            return repositoryConnection.findUnique(...args);
          },
          updateMany: async (...args: unknown[]) => {
            events.push("write");
            return repositoryConnection.updateMany(...args);
          },
        },
      });
      events.push("commit");
      return value;
    }),
  };
  return {
    handler: new PrismaRepositoryWebhookHandler(prisma as never),
    events,
    query,
    repositoryConnection,
    prisma,
  };
}
function envelope(action: string): GitHubRepositoryWebhookEnvelope {
  return {
    deliveryId: "delivery",
    eventName: "repository",
    payload: {
      action,
      installation: {
        id: 123,
        account: { login: "test", type: "Organization" },
        repository_selection: "all",
      },
      repository: {
        id: 456,
        owner: { login: "new" },
        name: "repo",
        full_name: "new/repo",
        archived: false,
        updated_at: "2026-09-14T10:00:00.000Z",
      },
    },
  };
}
describe("repository webhook guard boundaries", () => {
  it.each(["deleted", "renamed"])(
    "%s missing repository remains an ignored no-op",
    async (action) => {
      const f = fixture();
      f.repositoryConnection.findUnique.mockResolvedValue(null);
      expect(
        await f.handler.handleGitHubRepositoryWebhook(envelope(action)),
      ).toEqual({
        processed: false,
        ignored: true,
        reason: "repository_not_synced",
        repository: "new/repo",
      });
      expect(f.events).toEqual(["begin", "guard", "read", "commit"]);
      expect(f.repositoryConnection.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(["deleted", "renamed"])(
    "%s failed guard prevents discovery and mutation",
    async (action) => {
      const f = fixture();
      f.query.mockRejectedValue(new Error("guard failed"));
      await expect(
        f.handler.handleGitHubRepositoryWebhook(envelope(action)),
      ).rejects.toThrow("guard failed");
      expect(f.repositoryConnection.findUnique).not.toHaveBeenCalled();
      expect(f.repositoryConnection.updateMany).not.toHaveBeenCalled();
    },
  );
  it.each(["deleted", "renamed"])(
    "%s replay uses a fresh guarded transaction",
    async (action) => {
      const f = fixture();
      let committed = await f.repositoryConnection.findUnique();
      f.repositoryConnection.findUnique.mockClear();
      f.repositoryConnection.findUnique.mockImplementation(async () => ({
        ...committed,
      }));
      f.repositoryConnection.updateMany.mockImplementation(
        async ({ where, data }) => {
          if (where.selected === true && !committed.selected)
            return { count: 0 };
          committed = { ...committed, ...data };
          return { count: 1 };
        },
      );
      expect(
        await f.handler.handleGitHubRepositoryWebhook(envelope(action)),
      ).toEqual({
        processed: true,
        repository: action === "deleted" ? "old/repo" : "new/repo",
        status: action === "deleted" ? "unselected" : "synced",
      });
      const afterFirst = { ...committed };
      expect(
        await f.handler.handleGitHubRepositoryWebhook(envelope(action)),
      ).toEqual({
        processed: true,
        repository: afterFirst.fullName,
        status: action === "deleted" ? "unselected" : "stale_ignored",
      });
      expect(committed).toEqual(afterFirst);
      expect(f.events).toEqual([
        "begin",
        "guard",
        "read",
        "write",
        "commit",
        "begin",
        "guard",
        "read",
        ...(action === "deleted" ? ["write"] : []),
        "commit",
      ]);
      expect(f.query).toHaveBeenCalledTimes(2);
      expect(f.repositoryConnection.findUnique).toHaveBeenCalledTimes(2);
      expect(f.repositoryConnection.updateMany).toHaveBeenCalledTimes(
        action === "deleted" ? 2 : 1,
      );
      expect(f.prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "Serializable",
      });
      if (action === "deleted") {
        expect(
          f.repositoryConnection.updateMany.mock.calls[0]?.[0].data,
        ).toEqual({
          selected: false,
          lastSyncedAt: expect.any(Date),
        });
      } else {
        expect(
          f.repositoryConnection.updateMany.mock.calls[0]?.[0].data,
        ).toEqual({
          owner: "new",
          name: "repo",
          fullName: "new/repo",
          defaultBranch: "master",
          visibility: "public",
          archived: false,
          stargazersCount: 0,
          lastSyncedAt: new Date("2026-09-14T10:00:00.000Z"),
        });
      }
    },
  );
  it.each([
    [
      { visibility: "internal", private: true, watchers_count: 7 },
      "internal",
      7,
    ],
    [{ private: true, stargazers_count: 0, watchers_count: 7 }, "private", 0],
  ] as const)(
    "preserves metadata normalization %j",
    async (fields, visibility, stars) => {
      const f = fixture();
      const input = envelope("edited");
      await f.handler.handleGitHubRepositoryWebhook({
        ...input,
        payload: {
          ...input.payload,
          repository: { ...input.payload.repository, ...fields },
        },
      });
      expect(f.repositoryConnection.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: "repo_1" }),
        data: expect.objectContaining({ visibility, stargazersCount: stars }),
      });
    },
  );
});
