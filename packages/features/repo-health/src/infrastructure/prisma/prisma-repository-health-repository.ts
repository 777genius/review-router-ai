import type { ActionRunHealthReport, PrismaClient } from "@prisma/client";
import type { RepositoryHealthRepositoryPort } from "../../application/ports/repository-health-repository-port";
import type { RepositoryHealthInput } from "../../domain/repository-health";
import { projectRepositorySetupStatus } from "@reviewrouter/features-workflow-provisioning";

type LatestHealth = Pick<
  ActionRunHealthReport,
  | "repositoryId"
  | "providerHealth"
  | "providerSetupState"
  | "configSource"
  | "findingCriticalCount"
  | "findingMajorCount"
  | "findingMinorCount"
  | "findingInfoCount"
  | "inlineCommentCount"
  | "summaryCommentCount"
  | "skippedReasonCategory"
  | "receivedAt"
>;

export class PrismaRepositoryHealthRepository implements RepositoryHealthRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async listWorkspaceHealthInputs(
    workspaceId: string,
  ): Promise<readonly RepositoryHealthInput[]> {
    const repositories = await this.prisma.repositoryConnection.findMany({
      where: { workspaceId, provider: "github" },
      orderBy: { fullName: "asc" },
      select: {
        id: true,
        owner: true,
        name: true,
        fullName: true,
        defaultBranch: true,
        setupStatus: true,
        provisioning: {
          where: { workspaceId, repository: { workspaceId } },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { status: true },
        },
        installation: {
          select: { githubInstallationId: true },
        },
      },
    });
    const health = await this.latestHealthByRepository(
      workspaceId,
      repositories
        .filter((repository) => repository.installation)
        .map((repository) => repository.id),
    );

    return repositories.flatMap((repository) => {
      if (!repository.installation) return [];
      const latestHealth = health.get(repository.id);
      return [
        {
          repositoryId: repository.id,
          fullName: repository.fullName,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          githubInstallationId:
            repository.installation.githubInstallationId.toString(),
          setupStatus: projectRepositorySetupStatus({
            workflowProvisioningStatus:
              repository.provisioning[0]?.status ?? null,
            legacySetupStatus: repository.setupStatus,
          }),
          expectedActionRef: "",
          latestProviderHealth: latestHealth?.providerHealth ?? null,
          latestProviderSetupState: latestHealth?.providerSetupState ?? null,
          latestActionHealthReceivedAt: latestHealth?.receivedAt ?? null,
          latestActionHealthTelemetry: latestHealth
            ? {
                configSource: latestHealth.configSource,
                findingCounts: {
                  critical: latestHealth.findingCriticalCount,
                  major: latestHealth.findingMajorCount,
                  minor: latestHealth.findingMinorCount,
                  info: latestHealth.findingInfoCount,
                },
                commentCounts: {
                  inline: latestHealth.inlineCommentCount,
                  summary: latestHealth.summaryCommentCount,
                },
                skippedReasonCategory: latestHealth.skippedReasonCategory,
              }
            : null,
        },
      ];
    });
  }

  private async latestHealthByRepository(
    workspaceId: string,
    repositoryIds: readonly string[],
  ) {
    if (repositoryIds.length === 0) return new Map<string, LatestHealth>();
    // Prisma's nested take:1 loads every historical child for multiple parents.
    // Keep the limit inside each repository's indexed database lookup instead.
    const rows = await this.prisma.$queryRaw<LatestHealth[]>`
      SELECT requested."repositoryId", latest.*
      FROM unnest(${repositoryIds}::text[]) AS requested("repositoryId")
      JOIN LATERAL (
        SELECT health."providerHealth", health."providerSetupState",
               health."configSource", health."findingCriticalCount",
               health."findingMajorCount", health."findingMinorCount",
               health."findingInfoCount", health."inlineCommentCount",
               health."summaryCommentCount", health."skippedReasonCategory",
               health."receivedAt"
        FROM "ActionRunHealthReport" AS health
        WHERE health."workspaceId" = ${workspaceId}
          AND health."repositoryId" = requested."repositoryId"
        ORDER BY health."receivedAt" DESC, health."id" DESC
        LIMIT 1
      ) AS latest ON true
    `;
    return new Map(rows.map((row) => [row.repositoryId, row]));
  }
}
