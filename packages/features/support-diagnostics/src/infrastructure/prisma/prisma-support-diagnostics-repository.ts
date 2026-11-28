import type { ActionRunHealthReport, PrismaClient } from "@prisma/client";
import type { SupportDiagnosticsRepositoryPort } from "../../application/ports/support-diagnostics-repository-port";
import type { SupportDiagnosticsInput } from "../../domain/support-diagnostics";
import { projectRepositorySetupStatus } from "@reviewrouter/features-workflow-provisioning";

type LatestHealth = Pick<
  ActionRunHealthReport,
  | "repositoryId"
  | "providerHealth"
  | "providerSetupState"
  | "findingCriticalCount"
  | "findingMajorCount"
  | "findingMinorCount"
  | "findingInfoCount"
  | "inlineCommentCount"
  | "summaryCommentCount"
>;

export class PrismaSupportDiagnosticsRepository implements SupportDiagnosticsRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async getWorkspaceDiagnosticsInput(
    workspaceId: string,
  ): Promise<SupportDiagnosticsInput | null> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        name: true,
        slug: true,
        installations: {
          select: {
            status: true,
            repositorySelection: true,
          },
        },
        repositories: {
          select: {
            id: true,
            selected: true,
            archived: true,
            setupStatus: true,
            provisioning: {
              where: { workspaceId, repository: { workspaceId } },
              orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { status: true },
            },
          },
        },
        provisioning: {
          where: { workspaceId, repository: { workspaceId } },
          select: { status: true },
        },
        auditEvents: {
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { action: true },
        },
      },
    });
    if (!workspace) {
      return null;
    }

    const [
      outbox,
      memoryItemStatusCounts,
      memoryItemScopeCounts,
      memoryItemIndexStateCounts,
      memorySuggestionStatusCounts,
      memoryUsageEventCount,
      health,
    ] = await Promise.all([
      this.prisma.outboxEvent.groupBy({
        by: ["status"],
        where: { workspaceId },
        _count: { _all: true },
      }),
      // Historical cutover inventory only; never used for current memory reads or runtime.
      this.prisma.memoryItem.groupBy({
        by: ["status"],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.memoryItem.groupBy({
        by: ["scope"],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.memoryItem.groupBy({
        by: ["indexState"],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.memorySuggestion.groupBy({
        by: ["status"],
        where: { workspaceId },
        _count: { _all: true },
      }),
      this.prisma.memoryUsageEvent.count({ where: { workspaceId } }),
      this.latestHealthByRepository(
        workspaceId,
        workspace.repositories.map((repository) => repository.id),
      ),
    ]);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
      installations: workspace.installations.map((installation) => ({
        status: installation.status,
        repositorySelection: installation.repositorySelection,
      })),
      repositories: workspace.repositories.map((repository) => {
        const latestHealth = health.get(repository.id);
        return {
          id: repository.id,
          selected: repository.selected,
          archived: repository.archived,
          setupStatus: projectRepositorySetupStatus({
            workflowProvisioningStatus:
              repository.provisioning[0]?.status ?? null,
            legacySetupStatus: repository.setupStatus,
          }),
          latestProviderSetupState: latestHealth?.providerSetupState ?? null,
          latestProviderHealth: latestHealth?.providerHealth ?? null,
          latestFindingCounts: latestHealth
            ? {
                critical: latestHealth.findingCriticalCount,
                major: latestHealth.findingMajorCount,
                minor: latestHealth.findingMinorCount,
                info: latestHealth.findingInfoCount,
              }
            : null,
          latestCommentCounts: latestHealth
            ? {
                inline: latestHealth.inlineCommentCount,
                summary: latestHealth.summaryCommentCount,
              }
            : null,
        };
      }),
      workflowProvisioning: workspace.provisioning.map((item) => ({
        status: item.status,
      })),
      outboxStatusCounts: toCountMap(outbox, "status"),
      memory: {
        itemStatusCounts: toCountMap(memoryItemStatusCounts, "status"),
        itemScopeCounts: toCountMap(memoryItemScopeCounts, "scope"),
        itemIndexStateCounts: toCountMap(
          memoryItemIndexStateCounts,
          "indexState",
        ),
        suggestionStatusCounts: toCountMap(
          memorySuggestionStatusCounts,
          "status",
        ),
        usageEventCount: memoryUsageEventCount,
      },
      recentAuditActions: workspace.auditEvents.map((event) => event.action),
    };
  }

  private async latestHealthByRepository(
    workspaceId: string,
    repositoryIds: readonly string[],
  ) {
    if (repositoryIds.length === 0) return new Map<string, LatestHealth>();
    const rows = await this.prisma.$queryRaw<LatestHealth[]>`
      SELECT requested."repositoryId", latest.*
      FROM unnest(${repositoryIds}::text[]) AS requested("repositoryId")
      JOIN LATERAL (
        SELECT health."providerSetupState", health."providerHealth",
               health."findingCriticalCount", health."findingMajorCount",
               health."findingMinorCount", health."findingInfoCount",
               health."inlineCommentCount", health."summaryCommentCount"
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

function toCountMap<T extends Record<K, string>, K extends string>(
  rows: readonly (T & { readonly _count: { readonly _all: number } })[],
  key: K,
): Record<string, number> {
  return Object.fromEntries(
    rows.map((row) => [row[key], row._count._all] as const),
  );
}
