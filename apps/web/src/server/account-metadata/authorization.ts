import { Prisma, type PrismaClient } from "@prisma/client";

export type Scope = { userId: string; workspaceId?: string };
export type Source = {
  id: string;
  ownerUserId: string | null;
  ownerWorkspaceId: string | null;
  gatewayAccountRef: string;
  profileRef: string | null;
  state: string;
  authorizationEpochMirror: bigint | null;
  pendingSourceOperationId: string | null;
  role: string | null;
  bindingId: string | null;
  bindingRevision: number | null;
};

/** Shared live source resolution; each caller keeps its own display semantics. */
export function createAccountDisplayAuthorization(input: {
  prisma: PrismaClient;
  operatorWorkspaceId?: string;
}) {
  async function resolve(
    scope: Scope,
    connectionIds: readonly string[],
  ): Promise<Source[]> {
    if (!connectionIds.length) return [];
    const tombstone = Prisma.sql`NOT EXISTS (SELECT 1 FROM "PersonalAccountOperation" deleted
      WHERE deleted."sourceId" = s."id" AND deleted."action" = 'delete' AND deleted."phase" = 'applied'
        AND deleted."deleteRemoteRetirementProofRef" IS NOT NULL AND deleted."deleteBindingErasureProofRef" IS NOT NULL
        AND deleted."deleteTransportErasureProofRef" IS NOT NULL AND deleted."deleteNativeErasureProofRef" IS NOT NULL)`;
    const fields = Prisma.sql`s."id", s."ownerUserId", s."ownerWorkspaceId", s."gatewayAccountRef", s."profileRef",
      s."state", s."authorizationEpochMirror", s."pendingSourceOperationId"`;
    const rows = scope.workspaceId
      ? await input.prisma.$queryRaw<Source[]>(Prisma.sql`
        SELECT ${fields}, m."role", b."id" AS "bindingId", b."revision" AS "bindingRevision"
        FROM "ProviderAccountConnection" s
        JOIN "Workspace" w ON w."id" = ${scope.workspaceId}
        JOIN "WorkspaceMember" m ON m."workspaceId" = w."id" AND m."userId" = ${scope.userId}
        LEFT JOIN "WorkspaceAccountBinding" b ON b."connectionId" = s."id" AND b."workspaceId" = w."id" AND b."state" = 'active'
        LEFT JOIN "WorkspaceMember" donor ON donor."workspaceId" = w."id" AND donor."userId" = s."ownerUserId"
        WHERE w."personalOwnerUserId" IS NULL AND w."deletionState" = 'active' AND ${tombstone}
          AND ((s."ownerWorkspaceId" = w."id" AND s."id" IN (${Prisma.join(connectionIds)}) AND m."role" IN ('owner','admin'))
            OR ((b."id" IN (${Prisma.join(connectionIds)}) OR s."id" IN (${Prisma.join(connectionIds)})) AND b."id" IS NOT NULL AND (s."ownerWorkspaceId" = w."id"
              OR (${input.operatorWorkspaceId !== undefined} AND s."ownerWorkspaceId" = ${input.operatorWorkspaceId ?? scope.workspaceId})
              OR (s."ownerWorkspaceId" IS NULL AND s."ownerUserId" IS NOT NULL AND donor."role" IN ('owner','admin')))))
        ORDER BY s."id", b."id"`)
      : await input.prisma.$queryRaw<Source[]>(Prisma.sql`
        SELECT ${fields}, NULL::text AS "role", NULL::text AS "bindingId", NULL::integer AS "bindingRevision"
        FROM "ProviderAccountConnection" s WHERE s."id" IN (${Prisma.join(connectionIds)})
          AND s."ownerUserId" = ${scope.userId} AND s."ownerWorkspaceId" IS NULL AND ${tombstone}`);
    return rows;
  }
  return { resolve };
}

export const equalScope = (left: Scope, right: Scope) =>
  left.userId === right.userId && left.workspaceId === right.workspaceId;
export const owned = (scope: Scope, source: Source) =>
  (source.ownerUserId === scope.userId && source.ownerWorkspaceId === null) ||
  (scope.workspaceId !== undefined &&
    source.ownerWorkspaceId === scope.workspaceId &&
    ["owner", "admin"].includes(source.role ?? ""));
