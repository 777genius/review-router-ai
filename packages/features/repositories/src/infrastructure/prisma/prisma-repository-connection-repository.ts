import { randomUUID } from "node:crypto";
import { workflowProvisioningTransaction } from "@reviewrouter/features-workflow-provisioning/composition";
import {
  acquireCurrentScopeGuards,
  rotateRemovedScmRepositoryIdentityEpoch,
  rotateScmRepositoryIdentityEpoch,
} from "@reviewrouter/platform-db";
import type { PrismaClient, Prisma } from "@prisma/client";
import type {
  GitHubRepositorySnapshot,
  RepositoryConnectionSummary,
} from "../../domain/repository-connection";
import type {
  RepositoryConnectionRepositoryPort,
  RepositoryInventorySyncResult,
} from "../../application/ports/repository-connection-repository-port";

import {
  applyRepositorySyncPolicy,
  type RepositorySyncPolicy,
} from "../../domain/repository-sync-policy";

function toVisibility(value: GitHubRepositorySnapshot["visibility"]) {
  return value;
}

export class PrismaRepositoryConnectionRepository implements RepositoryConnectionRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async beginInstallationInventory(): Promise<bigint> {
    const [row] = await this.prisma.$queryRaw<Array<{ generation: bigint }>>`
      SELECT nextval('"RepositoryInventoryGeneration"') AS generation
    `;
    if (!row) throw new Error("repository_inventory_generation_missing");
    return row.generation;
  }

  async syncInstallationRepositories(input: {
    githubInstallationId: string;
    repositories: readonly GitHubRepositorySnapshot[];
    syncedAt: Date;
    inventoryGeneration: bigint;
    syncPolicy?: RepositorySyncPolicy;
  }): Promise<RepositoryInventorySyncResult> {
    if (input.inventoryGeneration <= 0n)
      throw new Error("repository_inventory_generation_invalid");
    const seenRepositoryIds = input.repositories.map((repository) =>
      BigInt(repository.githubRepositoryId),
    );
    const result = await workflowProvisioningTransaction(
      this.prisma,
      async (tx) => {
        const installation = await lockInstallationInventory(
          tx,
          input.githubInstallationId,
        );
        // Read the entire incoming identity set before quota admission: a transfer
        // must still fence the previous workspace even if it falls outside the cap.
        const previousRows =
          seenRepositoryIds.length === 0
            ? []
            : await tx.repositoryConnection.findMany({
                where: { githubRepositoryId: { in: seenRepositoryIds } },
                select: {
                  id: true,
                  githubRepositoryId: true,
                  workspaceId: true,
                  installationId: true,
                  inventoryGeneration: true,
                  defaultBranch: true,
                  fullName: true,
                  selected: true,
                  scmRepositoryIdentityId: true,
                },
              });
        let reconnectRequired = false;
        for (const previous of previousRows) {
          if (
            previous.workspaceId === installation.workspaceId &&
            previous.installationId === installation.id
          )
            continue;
          await fenceRepositoryForReconnect(tx, {
            repositoryId: previous.id,
            workspaceId: previous.workspaceId,
            wasSelected: previous.selected,
            scmRepositoryIdentityId: previous.scmRepositoryIdentityId,
            fencedAt: input.syncedAt,
            inventoryGeneration:
              previous.inventoryGeneration > input.inventoryGeneration
                ? previous.inventoryGeneration
                : input.inventoryGeneration,
          });
          reconnectRequired = true;
        }
        // Commit transfer revocation before reporting the reconnect requirement.
        if (reconnectRequired) return null;
        const empty = {
          installationId: input.githubInstallationId,
          seen: input.repositories.length,
          upserted: 0,
          unselected: 0,
          skippedDueToLimit: 0,
          synchronizedRepositories: [] as GitHubRepositorySnapshot[],
        };
        // Installation-wide watermark also rejects stale, previously unseen inserts.
        if (installation.inventoryGeneration >= input.inventoryGeneration)
          return empty;
        const previousById = new Map(
          previousRows.flatMap((row) =>
            row.githubRepositoryId === null
              ? []
              : [[row.githubRepositoryId.toString(), row] as const],
          ),
        );
        const admittedIds = new Set(
          previousRows
            .filter((row) => row.selected)
            .flatMap((row) =>
              row.githubRepositoryId === null
                ? []
                : [row.githubRepositoryId.toString()],
            ),
        );
        const selection = applyRepositorySyncPolicy(
          input.repositories,
          input.syncPolicy,
          admittedIds,
        );
        const synchronizedRepositories: GitHubRepositorySnapshot[] = [];
        for (const repository of selection.repositories) {
          const previous = previousById.get(repository.githubRepositoryId);
          if (
            previous &&
            previous.inventoryGeneration >= input.inventoryGeneration
          )
            continue;
          const data = {
            workspaceId: installation.workspaceId,
            provider: "github" as const,
            sourceBaseUrl: "https://github.com",
            externalRepositoryId: repository.githubRepositoryId,
            installationId: installation.id,
            owner: repository.owner,
            name: repository.name,
            fullName: repository.fullName,
            defaultBranch: repository.defaultBranch,
            visibility: toVisibility(repository.visibility),
            archived: repository.archived,
            stargazersCount: repository.stargazersCount,
            selected: true,
            lastSyncedAt: input.syncedAt,
            inventoryGeneration: input.inventoryGeneration,
          };
          await tx.repositoryConnection.upsert({
            where: {
              githubRepositoryId: BigInt(repository.githubRepositoryId),
            },
            update: data,
            create: {
              ...data,
              githubRepositoryId: BigInt(repository.githubRepositoryId),
            },
          });
          if (
            previous?.scmRepositoryIdentityId &&
            (previous.selected === false ||
              previous.fullName !== repository.fullName ||
              previous.defaultBranch !== repository.defaultBranch)
          ) {
            await rotateScmRepositoryIdentityEpoch(tx, {
              scmRepositoryIdentityId: previous.scmRepositoryIdentityId,
              repositoryConnectionId: previous.id,
              currentWorkspaceId: installation.workspaceId,
              boundAt: input.syncedAt,
            });
          }
          synchronizedRepositories.push(repository);
        }
        // Only absence from the full GitHub inventory means removal.
        const removalWhere = {
          installationId: installation.id,
          selected: true,
          inventoryGeneration: { lt: input.inventoryGeneration },
          ...(seenRepositoryIds.length > 0
            ? { githubRepositoryId: { notIn: seenRepositoryIds } }
            : {}),
        } as const;
        const removed = await tx.repositoryConnection.findMany({
          where: removalWhere,
          select: {
            id: true,
            workspaceId: true,
            scmRepositoryIdentityId: true,
          },
        });
        for (const repository of removed) {
          if (repository.scmRepositoryIdentityId) {
            await rotateRemovedScmRepositoryIdentityEpoch(tx, {
              scmRepositoryIdentityId: repository.scmRepositoryIdentityId,
              repositoryConnectionId: repository.id,
              currentWorkspaceId: repository.workspaceId,
              removedAt: input.syncedAt,
            });
          }
        }
        const unselected = await tx.repositoryConnection.updateMany({
          where: removalWhere,
          data: {
            selected: false,
            lastSyncedAt: input.syncedAt,
            inventoryGeneration: input.inventoryGeneration,
          },
        });
        await tx.gitHubInstallation.update({
          where: { id: installation.id },
          data: { inventoryGeneration: input.inventoryGeneration },
        });
        return {
          ...empty,
          upserted: synchronizedRepositories.length,
          unselected: unselected.count,
          skippedDueToLimit: selection.skippedDueToLimit,
          synchronizedRepositories,
        };
      },
    );
    if (result === null)
      throw new Error("repository_transfer_reconnect_reselection_required");
    return result;
  }

  async listWorkspaceRepositories(
    workspaceId: string,
  ): Promise<readonly RepositoryConnectionSummary[]> {
    const repositories = await this.prisma.repositoryConnection.findMany({
      where: { workspaceId },
      orderBy: [{ selected: "desc" }, { fullName: "asc" }],
    });

    return repositories.map((repository) => ({
      id: repository.id,
      workspaceId: repository.workspaceId,
      provider: repository.provider,
      externalRepositoryId: repository.externalRepositoryId,
      sourceBaseUrl: repository.sourceBaseUrl,
      githubRepositoryId:
        repository.githubRepositoryId?.toString() ??
        repository.externalRepositoryId,
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      visibility: repository.visibility,
      archived: repository.archived,
      stargazersCount: repository.stargazersCount,
      selected: repository.selected,
      setupStatus: repository.setupStatus,
      lastSyncedAt: repository.lastSyncedAt,
    }));
  }
}

async function fenceRepositoryForReconnect(
  tx: Prisma.TransactionClient,
  input: Readonly<{
    repositoryId: string;
    workspaceId: string;
    wasSelected: boolean;
    scmRepositoryIdentityId: string | null;
    fencedAt: Date;
    inventoryGeneration: bigint;
  }>,
): Promise<void> {
  if (input.wasSelected && input.scmRepositoryIdentityId) {
    await rotateRemovedScmRepositoryIdentityEpoch(tx, {
      scmRepositoryIdentityId: input.scmRepositoryIdentityId,
      repositoryConnectionId: input.repositoryId,
      currentWorkspaceId: input.workspaceId,
      removedAt: input.fencedAt,
    });
  }
  const revoked = await tx.repositoryConnection.updateMany({
    where: {
      id: input.repositoryId,
      selected: input.wasSelected,
    },
    data: {
      selected: false,
      lastSyncedAt: input.fencedAt,
      inventoryGeneration: input.inventoryGeneration,
    },
  });
  if (revoked.count !== 1) {
    throw new Error("repository_transfer_revocation_failed");
  }
  const current = await tx.workflowProvisioning.findUnique({
    where: { repositoryId: input.repositoryId },
  });
  if (!current) return;
  if (
    !input.wasSelected &&
    current.status === "not_started" &&
    current.errorMessage ===
      "repository_transfer_reconnect_reselection_required" &&
    current.pullRequestUrl === null &&
    current.pullRequestHeadSha === null
  )
    return;
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

/**
 * No stable installation-wide fanout lock exists: inserts have no repository ID
 * yet, transfers can change both workspaces, and trailing unselection targets a
 * predicate. A short global exclusive guard covers that entire old/new union.
 * The inventory admission, writes, removal and installation watermark share one
 * bounded Serializable transaction, before provisioning reads/locks.
 * No network work runs here. This is serialization, not installation admission.
 */
async function lockInstallationInventory(
  tx: Prisma.TransactionClient,
  githubInstallationId: string,
) {
  await acquireCurrentScopeGuards(tx, [{ scope: "global", mode: "exclusive" }]);
  const installation = await tx.gitHubInstallation.findUnique({
    where: { githubInstallationId: BigInt(githubInstallationId) },
    select: { id: true, workspaceId: true, inventoryGeneration: true },
  });
  if (!installation)
    throw new Error(`GitHub installation not found: ${githubInstallationId}`);
  return installation;
}
