import type { PrismaClient } from "@reviewrouter/platform-db";
import type {
  GitLabBulkProvisionResult,
  GitLabGroupProject,
} from "@reviewrouter/features-gitlab-integration";

/**
 * Persist one GitLab installation inventory snapshot after provider I/O.
 * This is a Web infrastructure adapter, never part of network provisioning.
 */
export class PrismaGitLabInstallationInventory {
  constructor(private readonly prisma: PrismaClient) {}

  async requestStartedAt(): Promise<Date> {
    // Use one database clock across replicas, not their wall clocks.
    const rows = await this.prisma.$queryRaw<{ requestedAt: Date }[]>`
      SELECT clock_timestamp() AS "requestedAt"
    `;
    const value = rows[0]?.requestedAt;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new Error("gitlab_inventory_database_clock_unavailable");
    }
    return value;
  }

  async record(input: {
    readonly workspaceId: string;
    readonly installedByUserId: string;
    readonly sourceBaseUrl: string;
    readonly namespacePath: string;
    readonly sourceKind: "group" | "project";
    readonly requestStartedAt: Date;
    readonly selectedProjects: readonly GitLabGroupProject[];
    readonly provision: GitLabBulkProvisionResult;
  }): Promise<{ readonly installationId: string }> {
    if (!Number.isFinite(input.requestStartedAt.getTime())) {
      throw new Error("gitlab_inventory_request_time_invalid");
    }
    const installationKey = {
      workspaceId: input.workspaceId,
      sourceBaseUrl: input.sourceBaseUrl,
      namespacePath: input.namespacePath,
    };
    const lockKey = `gitlab-installation-inventory-v1:${JSON.stringify([
      input.workspaceId,
      input.sourceBaseUrl,
      input.namespacePath,
    ])}`;
    const selectedProjectIds = input.selectedProjects.map(
      (project) => project.projectId,
    );
    const successfulProjects = input.selectedProjects.filter((project) =>
      input.provision.results.some(
        (result) =>
          result.projectId === project.projectId &&
          result.status === "fulfilled",
      ),
    );

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT 1 AS "locked"
          FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        const previous = await tx.gitLabInstallation.findUnique({
          where: {
            workspaceId_sourceBaseUrl_namespacePath: installationKey,
          },
          select: { lastInstalledAt: true },
        });
        // Older overlapping requests may finish provider I/O after newer
        // requests. Never overwrite a newer committed installation snapshot.
        if (
          previous?.lastInstalledAt &&
          previous.lastInstalledAt > input.requestStartedAt
        ) {
          throw new Error("gitlab_install_superseded");
        }

        const snapshotAt = new Date();
        const installation = await tx.gitLabInstallation.upsert({
          where: {
            workspaceId_sourceBaseUrl_namespacePath: installationKey,
          },
          update: {
            sourceKind: input.sourceKind,
            status:
              input.provision.succeeded > 0 ? "active" : "permission_error",
            installedByUserId: input.installedByUserId,
            selectedProjects: input.selectedProjects.length,
            installSummary: sanitizeInstallSummary(input.provision),
            lastInstalledAt: input.requestStartedAt,
          },
          create: {
            ...installationKey,
            sourceKind: input.sourceKind,
            status:
              input.provision.succeeded > 0 ? "active" : "permission_error",
            installedByUserId: input.installedByUserId,
            selectedProjects: input.selectedProjects.length,
            installSummary: sanitizeInstallSummary(input.provision),
            lastInstalledAt: input.requestStartedAt,
          },
        });

        await tx.repositoryConnection.updateMany({
          where: {
            workspaceId: input.workspaceId,
            provider: "gitlab",
            gitlabInstallationId: installation.id,
            externalRepositoryId: { notIn: selectedProjectIds },
          },
          data: { selected: false, lastSyncedAt: snapshotAt },
        });

        for (const project of successfulProjects) {
          const key = {
            provider: "gitlab" as const,
            externalRepositoryId: project.projectId,
            sourceBaseUrl: input.sourceBaseUrl,
          };
          const existing = await tx.repositoryConnection.findUnique({
            where: {
              provider_externalRepositoryId_sourceBaseUrl: key,
            },
            select: { id: true, workspaceId: true },
          });
          if (existing && existing.workspaceId !== input.workspaceId) {
            throw new Error("gitlab_repository_already_owned");
          }
          const result = input.provision.results.find(
            (item) =>
              item.projectId === project.projectId &&
              item.status === "fulfilled",
          );
          if (!result || result.status !== "fulfilled") {
            throw new Error("gitlab_inventory_result_missing");
          }
          const fields = {
            gitlabInstallationId: installation.id,
            owner: ownerFromFullName(project.fullName),
            name: project.name,
            fullName: project.fullName,
            defaultBranch: project.defaultBranch ?? "main",
            visibility: project.visibility ?? ("private" as const),
            archived: project.archived,
            selected: true,
            setupStatus: setupStatusForProvisionResult(result.result),
            lastSyncedAt: snapshotAt,
          };
          if (existing) {
            // This update cannot change a repository's owning workspace.
            await tx.repositoryConnection.update({
              where: { id: existing.id },
              data: fields,
            });
          } else {
            // Database global uniqueness also guards noncooperating writers.
            await tx.repositoryConnection.create({
              data: {
                ...key,
                workspaceId: input.workspaceId,
                ...fields,
              },
            });
          }
        }

        return { installationId: installation.id };
      },
      { isolationLevel: "ReadCommitted", timeout: 15_000 },
    );
  }
}

function setupStatusForProvisionResult(result: {
  readonly mode: "ci_config_path" | "setup_merge_request" | "skipped";
}): "configured" | "setup_pr_open" | "needs_attention" {
  if (result.mode === "ci_config_path") return "configured";
  if (result.mode === "setup_merge_request") return "setup_pr_open";
  return "needs_attention";
}

function sanitizeInstallSummary(provision: GitLabBulkProvisionResult) {
  return {
    protocolVersion: provision.protocolVersion,
    requested: provision.requested,
    succeeded: provision.succeeded,
    failed: provision.failed,
    sharedVariablesConfigured: provision.sharedVariablesConfigured,
    results: provision.results,
  };
}

function ownerFromFullName(fullName: string): string {
  const index = fullName.lastIndexOf("/");
  if (index <= 0) return fullName;
  return fullName.slice(0, index);
}
