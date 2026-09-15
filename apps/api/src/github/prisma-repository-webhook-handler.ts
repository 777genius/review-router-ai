import type { GitHubRepositoryWebhookEnvelope } from "@reviewrouter/features-github-installations";
import { workflowProvisioningTransaction } from "@reviewrouter/features-workflow-provisioning";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  acquireCurrentScopeGuards,
  rotateRemovedScmRepositoryIdentityEpoch,
  rotateScmRepositoryIdentityEpoch,
} from "@reviewrouter/platform-db";
import type { PrismaClient } from "@reviewrouter/platform-db";

type RepositoryVisibility = "public" | "private" | "internal";

export class PrismaRepositoryWebhookHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async handleGitHubRepositoryWebhook(
    envelope: GitHubRepositoryWebhookEnvelope,
  ): Promise<Record<string, unknown>> {
    const payload = envelope.payload;
    const repository = payload.repository;
    const handled = await workflowProvisioningTransaction(
      this.prisma,
      async (tx) => {
        await acquireCurrentScopeGuards(tx, [
          { scope: "global", mode: "exclusive" },
        ]);
        const existing = await tx.repositoryConnection.findUnique({
          where: { githubRepositoryId: BigInt(repository.id) },
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

        if (!existing) return null;
        const installationChanged =
          existing.installation?.githubInstallationId !==
          BigInt(payload.installation.id);
        const syncedAt = new Date();

        if (installationChanged) {
          await fenceRepositoryAuthority(tx, {
            repositoryId: existing.id,
            workspaceId: existing.workspaceId,
            wasSelected: existing.selected,
            scmRepositoryIdentityId: existing.scmRepositoryIdentityId,
            fencedAt: syncedAt,
          });
          return {
            repository: existing.fullName,
            status: "reconnect_reselection_required",
          };
        }

        if (payload.action === "deleted") {
          const removed = await tx.repositoryConnection.updateMany({
            where: { id: existing.id, selected: true },
            data: {
              selected: false,
              lastSyncedAt: syncedAt,
            },
          });
          if (removed.count === 1 && existing.scmRepositoryIdentityId) {
            await rotateRemovedScmRepositoryIdentityEpoch(tx, {
              scmRepositoryIdentityId: existing.scmRepositoryIdentityId,
              repositoryConnectionId: existing.id,
              currentWorkspaceId: existing.workspaceId,
              removedAt: syncedAt,
            });
          }
          return { repository: existing.fullName, status: "unselected" };
        }

        if (payload.action === "transferred") {
          await fenceRepositoryAuthority(tx, {
            repositoryId: existing.id,
            workspaceId: existing.workspaceId,
            wasSelected: existing.selected,
            scmRepositoryIdentityId: existing.scmRepositoryIdentityId,
            fencedAt: syncedAt,
          });
          return {
            repository: existing.fullName,
            status: "reconnect_reselection_required",
          };
        }
        const metadataTimestamp =
          payload.action === "renamed" || payload.action === "edited"
            ? repository.updated_at
              ? new Date(repository.updated_at)
              : null
            : syncedAt;
        const sameSecondChange =
          metadataTimestamp &&
          existing.lastSyncedAt &&
          startOfSecond(metadataTimestamp) ===
            startOfSecond(existing.lastSyncedAt)
            ? resolveSameSecondRepositoryChange({
                action: payload.action,
                changes: payload.changes,
                repository,
                existing,
              })
            : null;
        if (
          metadataTimestamp === null ||
          (existing.lastSyncedAt !== null &&
            startOfSecond(metadataTimestamp) <
              startOfSecond(existing.lastSyncedAt))
        ) {
          return { repository: existing.fullName, status: "stale_ignored" };
        }
        if (
          existing.lastSyncedAt !== null &&
          startOfSecond(metadataTimestamp) ===
            startOfSecond(existing.lastSyncedAt) &&
          sameSecondChange === null
        ) {
          if (!hasRepositoryMetadataPreimage(payload.action, payload.changes)) {
            return { repository: existing.fullName, status: "stale_ignored" };
          }
          await fenceRepositoryAuthority(tx, {
            repositoryId: existing.id,
            workspaceId: existing.workspaceId,
            wasSelected: existing.selected,
            scmRepositoryIdentityId: existing.scmRepositoryIdentityId,
            fencedAt: syncedAt,
          });
          return {
            repository: existing.fullName,
            status: "reconnect_reselection_required",
          };
        }
        const storedTimestamp =
          existing.lastSyncedAt && metadataTimestamp < existing.lastSyncedAt
            ? existing.lastSyncedAt
            : metadataTimestamp;
        const metadataUpdate =
          sameSecondChange === "renamed"
            ? {
                owner: repository.owner.login,
                name: repository.name,
                fullName: repository.full_name,
                lastSyncedAt: storedTimestamp,
              }
            : sameSecondChange === "default_branch"
              ? {
                  defaultBranch: repository.default_branch!,
                  lastSyncedAt: storedTimestamp,
                }
              : {
                  owner: repository.owner.login,
                  name: repository.name,
                  fullName: repository.full_name,
                  defaultBranch:
                    repository.default_branch ?? existing.defaultBranch,
                  visibility: normalizeRepositoryVisibility(repository),
                  archived: repository.archived,
                  stargazersCount:
                    repository.stargazers_count ??
                    repository.watchers_count ??
                    0,
                  lastSyncedAt: storedTimestamp,
                };
        const updated = await tx.repositoryConnection.updateMany({
          where: {
            id: existing.id,
            workspaceId: existing.workspaceId,
            installationId: existing.installationId,
            scmRepositoryIdentityId: existing.scmRepositoryIdentityId,
            lastSyncedAt: existing.lastSyncedAt,
          },
          data: metadataUpdate,
        });
        if (updated.count !== 1) {
          throw new Error("repository_webhook_binding_cas_failed");
        }
        if (
          existing.fullName !== repository.full_name &&
          existing.scmRepositoryIdentityId
        ) {
          await rotateScmRepositoryIdentityEpoch(tx, {
            scmRepositoryIdentityId: existing.scmRepositoryIdentityId,
            repositoryConnectionId: existing.id,
            currentWorkspaceId: existing.workspaceId,
            boundAt: storedTimestamp,
          });
        }
        return { repository: repository.full_name, status: "synced" };
      },
    );

    return handled
      ? { processed: true, ...handled }
      : {
          processed: false,
          ignored: true,
          reason: "repository_not_synced",
          repository: repository.full_name,
        };
  }
}

type SameSecondRepositoryChange = "renamed" | "default_branch";

function hasRepositoryMetadataPreimage(
  action: string,
  changes: GitHubRepositoryWebhookEnvelope["payload"]["changes"] | undefined,
): boolean {
  return (
    (action === "renamed" && changes?.repository !== undefined) ||
    (action === "edited" && changes?.default_branch !== undefined)
  );
}

function resolveSameSecondRepositoryChange(input: {
  readonly action: string;
  readonly changes:
    | GitHubRepositoryWebhookEnvelope["payload"]["changes"]
    | undefined;
  readonly repository: GitHubRepositoryWebhookEnvelope["payload"]["repository"];
  readonly existing: {
    readonly defaultBranch: string;
    readonly fullName: string;
  };
}): SameSecondRepositoryChange | null {
  if (
    input.action === "renamed" &&
    input.changes &&
    Object.keys(input.changes).length === 1 &&
    input.changes.repository &&
    Object.keys(input.changes.repository).length === 1
  ) {
    const previousName = input.changes.repository.name.from;
    return input.existing.fullName ===
      `${input.repository.owner.login}/${previousName}` &&
      input.repository.full_name ===
        `${input.repository.owner.login}/${input.repository.name}`
      ? "renamed"
      : null;
  }

  if (
    input.action === "edited" &&
    input.changes &&
    Object.keys(input.changes).length === 1 &&
    input.changes.default_branch &&
    input.existing.defaultBranch === input.changes.default_branch.from &&
    input.repository.default_branch !== null &&
    input.repository.default_branch !== undefined &&
    input.repository.default_branch !== input.existing.defaultBranch
  ) {
    return "default_branch";
  }

  // GitHub does not provide a total-order token. In the precision tie, only
  // rename and default-branch preimages are narrow enough for a safe CAS;
  // every other edited field fails closed instead of replacing newer metadata.
  return null;
}

function startOfSecond(value: Date): number {
  return Math.floor(value.getTime() / 1_000) * 1_000;
}

async function fenceRepositoryAuthority(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    repositoryId: string;
    workspaceId: string;
    wasSelected: boolean;
    scmRepositoryIdentityId: string | null;
    fencedAt: Date;
  }>,
): Promise<void> {
  if (input.scmRepositoryIdentityId) {
    await rotateRemovedScmRepositoryIdentityEpoch(tx, {
      scmRepositoryIdentityId: input.scmRepositoryIdentityId,
      repositoryConnectionId: input.repositoryId,
      currentWorkspaceId: input.workspaceId,
      removedAt: input.fencedAt,
    });
  }
  const revoked = await tx.repositoryConnection.updateMany({
    where: { id: input.repositoryId, selected: true },
    data: { selected: false, lastSyncedAt: input.fencedAt },
  });
  if (revoked.count !== (input.wasSelected ? 1 : 0)) {
    throw new Error("repository_transfer_revocation_failed");
  }
  const current = await tx.workflowProvisioning.findUnique({
    where: { repositoryId: input.repositoryId },
  });
  if (!current) return;
  const invalidated = await tx.workflowProvisioning.updateMany({
    where: {
      id: current.id,
      attemptId: current.attemptId,
      revision: current.revision,
      status: current.status,
    },
    data: {
      attemptId: randomUUID(),
      revision: { increment: 1 },
      status: "not_started",
      pullRequestUrl: null,
      pullRequestHeadSha: null,
      errorMessage: "repository_transfer_reconnect_reselection_required",
    },
  });
  if (invalidated.count !== 1) {
    throw new Error("workflow_provisioning_concurrent_transition");
  }
}

function normalizeRepositoryVisibility(repository: {
  readonly visibility?: string | undefined;
  readonly private?: boolean | undefined;
}): RepositoryVisibility {
  if (repository.visibility === "internal") return "internal";
  if (repository.private) return "private";
  return "public";
}
