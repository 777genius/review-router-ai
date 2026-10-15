import { Prisma, type PrismaClient } from "@prisma/client";
import {
  assertOpaqueReference,
  ProviderAccountError,
} from "@reviewrouter/features-provider-accounts";

// Runtime imports belong only to server actions/RSC. Actor IDs come from a freshly
// authenticated server session; cursors and display flags never grant authority.
export type PersonalSharingPage<T> = {
  readonly items: readonly T[];
  readonly nextAfterId: string | null;
};
export type OwnOrganizationBinding = {
  readonly bindingId: string;
  readonly sourceId: string;
  readonly targetWorkspaceId: string;
  readonly organizationLabel: string | null;
  readonly revision: number;
  readonly state: "active" | "revoked";
  readonly remoteFenceDelivery:
    | "not_required"
    | "remote_pending"
    | "remote_applied";
  readonly canRevoke: boolean;
};
export type EligiblePersonalSharingOrganization = {
  readonly workspaceId: string;
  readonly label: string;
  readonly predecessors?: readonly {
    readonly sourceId: string;
    readonly bindingId: string;
    readonly revision: number;
  }[];
};

function pageSize(value: number | undefined): number {
  const limit = value ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new ProviderAccountError("invalid_input");
  return limit;
}
function page<T>(
  rows: readonly T[],
  limit: number,
  id: (row: T) => string,
): PersonalSharingPage<T> {
  const items = rows.slice(0, limit);
  return {
    items,
    nextAfterId: rows.length > limit ? id(items[items.length - 1]!) : null,
  };
}

export class PrismaPersonalAccountSharingQueries {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertOwnSources(
    actorUserId: string,
    sourceIds: readonly string[],
  ) {
    assertOpaqueReference(actorUserId);
    if (
      !sourceIds.length ||
      sourceIds.length > 100 ||
      new Set(sourceIds).size !== sourceIds.length
    )
      throw new ProviderAccountError("invalid_input");
    sourceIds.forEach(assertOpaqueReference);
    // Never inspect recipients before this own-source filter succeeds in full.
    const sources = await this.prisma.providerAccountConnection.findMany({
      where: {
        id: { in: [...sourceIds] },
        ownerUserId: actorUserId,
        ownerWorkspaceId: null,
      },
      select: { id: true },
    });
    if (sources.length !== sourceIds.length)
      throw new ProviderAccountError("connection_unavailable");
  }

  async listOwnOrgBindings(request: {
    readonly actorUserId: string;
    readonly sourceId: string;
    readonly afterBindingId?: string;
    readonly limit?: number;
  }): Promise<PersonalSharingPage<OwnOrganizationBinding>> {
    const input = {
      actorUserId: request.actorUserId,
      sourceId: request.sourceId,
      afterBindingId: request.afterBindingId,
    };
    const limit = pageSize(request.limit);
    if (input.afterBindingId !== undefined)
      assertOpaqueReference(input.afterBindingId);
    await this.assertOwnSources(input.actorUserId, [input.sourceId]);
    const rows = await this.prisma.$queryRaw<
      OwnOrganizationBinding[]
    >(Prisma.sql`
      SELECT b."id" AS "bindingId", b."connectionId" AS "sourceId",
        b."workspaceId" AS "targetWorkspaceId", b."revision", b."state"::text,
        CASE WHEN w."deletionState" = 'active' AND m."role" IN ('owner', 'admin')
          THEN w."name" ELSE NULL END AS "organizationLabel",
        CASE WHEN b."pendingFenceOperationId" IS NOT NULL THEN 'remote_pending'
          WHEN b."state" = 'revoked' AND b."fenceAckOperationId" IS NOT NULL
            AND b."fenceAckPolicyRevision" = b."policyRevision" THEN 'remote_applied'
          WHEN b."state" = 'revoked' THEN 'remote_pending'
          ELSE 'not_required' END AS "remoteFenceDelivery",
        (b."state" = 'active' AND b."revision" < 2147483647
          AND b."policyRevision" < 2147483647 AND s."metadataRevision" < 2147483647) AS "canRevoke"
      FROM "WorkspaceAccountBinding" b
      JOIN "ProviderAccountConnection" s ON s."id" = b."connectionId"
      JOIN "Workspace" w ON w."id" = b."workspaceId"
      LEFT JOIN "WorkspaceMember" m ON m."workspaceId" = w."id" AND m."userId" = ${input.actorUserId}
      WHERE s."id" = ${input.sourceId} AND s."ownerUserId" = ${input.actorUserId}
        AND s."ownerWorkspaceId" IS NULL AND w."personalOwnerUserId" IS NULL
        ${input.afterBindingId === undefined ? Prisma.empty : Prisma.sql`AND b."id" > ${input.afterBindingId}`}
      ORDER BY b."id" ASC LIMIT ${limit + 1}`);
    return page(rows, limit, (row) => row.bindingId);
  }

  async listEligibleOrganizations(request: {
    readonly actorUserId: string;
    readonly sourceIds: readonly string[];
    readonly afterWorkspaceId?: string;
    readonly limit?: number;
  }): Promise<PersonalSharingPage<EligiblePersonalSharingOrganization>> {
    if (!Array.isArray(request.sourceIds))
      throw new ProviderAccountError("invalid_input");
    const input = {
      actorUserId: request.actorUserId,
      sourceIds: [...request.sourceIds],
      afterWorkspaceId: request.afterWorkspaceId,
    };
    const limit = pageSize(request.limit);
    if (input.afterWorkspaceId !== undefined)
      assertOpaqueReference(input.afterWorkspaceId);
    await this.assertOwnSources(input.actorUserId, input.sourceIds);
    const rows = await this.prisma.workspace.findMany({
      where: {
        personalOwnerUserId: null,
        deletionState: "active",
        members: {
          some: { userId: input.actorUserId, role: { in: ["owner", "admin"] } },
        },
        ...(input.afterWorkspaceId === undefined
          ? {}
          : { id: { gt: input.afterWorkspaceId } }),
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: { id: true, name: true },
    });
    const result = page(rows, limit, (row) => row.id);
    if (!result.items.length) return { items: [], nextAfterId: null };
    // Filter actual issued, unconsumed, acknowledged lineage before pair
    // projection: timestamps/opaque IDs cannot make a consumed ancestor a tail.
    // At most 100 targets x 100 selected sources, with no per-recipient query.
    const predecessors = await this.prisma.$queryRaw<
      {
        workspaceId: string;
        sourceId: string;
        bindingId: string;
        revision: number;
      }[]
    >(Prisma.sql`
      SELECT DISTINCT ON (b."workspaceId", b."connectionId")
        b."workspaceId", b."connectionId" AS "sourceId", b."id" AS "bindingId", b."revision"
      FROM "WorkspaceAccountBinding" b
      JOIN "ProviderAccountConnection" s ON s."id" = b."connectionId"
      JOIN "Workspace" w ON w."id" = b."workspaceId"
      WHERE b."workspaceId" IN (${Prisma.join(result.items.map((row) => row.id))})
        AND b."connectionId" IN (${Prisma.join(input.sourceIds)})
        AND b."state" = 'revoked' AND b."revision" < 2147483647 AND b."pendingFenceOperationId" IS NULL
        AND b."fenceAckPolicyRevision" = b."policyRevision"
        AND s."ownerUserId" = ${input.actorUserId} AND s."ownerWorkspaceId" IS NULL
        AND s."state" = 'active' AND s."pendingSourceOperationId" IS NULL AND s."metadataRevision" < 2147483647
        AND s."authorizationEpochMirror" IS NOT NULL
        AND w."personalOwnerUserId" IS NULL AND w."deletionState" = 'active'
        AND EXISTS (SELECT 1 FROM "WorkspaceMember" m WHERE m."workspaceId" = w."id"
          AND m."userId" = ${input.actorUserId} AND m."role" IN ('owner', 'admin'))
        AND EXISTS (SELECT 1 FROM "PersonalAccountOperation" o WHERE o."action" = 'attach'
          AND o."phase" = 'applied' AND o."sourceId" = s."id"
          AND o."targetWorkspaceId" = b."workspaceId" AND o."resultBindingId" = b."id")
        AND NOT EXISTS (SELECT 1 FROM "PersonalAccountOperation" o WHERE o."action" = 'attach'
          AND o."phase" = 'applied' AND o."predecessorBindingId" = b."id")
        AND NOT EXISTS (SELECT 1 FROM "WorkspaceAccountBinding" active
          WHERE active."workspaceId" = b."workspaceId" AND active."connectionId" = s."id" AND active."state" = 'active')
      ORDER BY b."workspaceId", b."connectionId", b."createdAt" DESC, b."id" DESC`);
    return {
      items: result.items.map((row) => {
        const hints = predecessors
          .filter((binding) => binding.workspaceId === row.id)
          .map(({ sourceId, bindingId, revision }) => ({
            sourceId,
            bindingId,
            revision,
          }));
        return {
          workspaceId: row.id,
          label: row.name,
          ...(hints.length ? { predecessors: hints } : {}),
        };
      }),
      nextAfterId: result.nextAfterId,
    };
  }
}
