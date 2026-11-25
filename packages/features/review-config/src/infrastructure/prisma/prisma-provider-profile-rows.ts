import type {
  Prisma,
  PrismaClient,
  WorkspaceProviderProfile as WorkspaceProviderProfileRow,
} from "@prisma/client";
import {
  providerCredentialSourceFromStorage,
  ProviderProfileError,
  type WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";

export type ProviderProfileReader = Pick<
  PrismaClient | Prisma.TransactionClient,
  "workspaceProviderProfile"
>;

export function toProviderProfile(
  row: WorkspaceProviderProfileRow,
): WorkspaceProviderProfile {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    credential: providerCredentialSourceFromStorage(row),
    model: row.model,
    label: row.label,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Profiles of one workspace by ID, archived ones included so a resolver can
 * tell an archived reference apart from a usable one. A row that does not
 * rebuild into a credential source is left out and reads as unavailable.
 */
export async function readProviderProfiles(
  reader: ProviderProfileReader,
  workspaceId: string,
  profileIds: readonly string[],
): Promise<ReadonlyMap<string, WorkspaceProviderProfile>> {
  const ids = [...new Set(profileIds)];
  if (ids.length === 0) return new Map();
  const rows = await reader.workspaceProviderProfile.findMany({
    where: { workspaceId, id: { in: ids } },
    orderBy: { id: "asc" },
  });
  return new Map(
    rows.flatMap((row) => {
      try {
        return [[row.id, toProviderProfile(row)] as const];
      } catch (error) {
        if (error instanceof ProviderProfileError) return [];
        throw error;
      }
    }),
  );
}
