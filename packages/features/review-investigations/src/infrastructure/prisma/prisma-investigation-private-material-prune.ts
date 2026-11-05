import {
  Prisma,
  ReviewInvestigationStateV1 as PrismaInvestigationState,
} from "@prisma/client";
import { InvestigationPrivateMaterialPruneFailureCause } from "../../application/ports/investigation-private-material-ports";

/**
 * Internal maintenance SQL/cursor boundary. Pruning's aggregate transitions,
 * CAS writes and transaction scopes remain in PrismaInvestigationStore.
 */
export type ExpiredPrivateMaterialCandidate = Readonly<{
  privateMaterialId: string;
  investigationId: string;
  obligationId: string | null;
  investigationState: PrismaInvestigationState;
  expiresAt: Date;
}>;

export type ExpiredPrivateMaterialCursor = Readonly<{
  privateMaterialId: string;
  expiresAt: Date;
}>;

export enum ExpiredPrivateMaterialCursorRange {
  All = "all",
  After = "after",
  Through = "through",
}

const privateMaterialPruneCheckpointKey = "private_material_prune.v1";

type ExpiredPrivateMaterialGroup = Readonly<{
  investigationId: string;
  investigationState: PrismaInvestigationState;
  privateMaterialIds: readonly string[];
  obligationIds: readonly string[];
}>;

export class PrivateMaterialGroupPruneError extends Error {
  readonly name = "PrivateMaterialGroupPruneError";

  constructor(
    readonly causeCode: InvestigationPrivateMaterialPruneFailureCause,
  ) {
    super("investigation_private_material_group_prune_failed");
  }
}

export function assertPruneLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
    throw new Error("investigation_prune_limit_invalid");
  }
}

export function parseCanonicalCutoff(value: string, code: string): Date {
  const cutoff = new Date(value);
  if (!Number.isFinite(cutoff.getTime()) || cutoff.toISOString() !== value) {
    throw new Error(code);
  }
  return cutoff;
}

export async function findExpiredPrivateMaterialCandidates(
  transaction: Prisma.TransactionClient,
  effectiveCutoff: Date,
  limit: number,
  cursor: ExpiredPrivateMaterialCursor | null,
  range: ExpiredPrivateMaterialCursorRange,
): Promise<readonly ExpiredPrivateMaterialCandidate[]> {
  let cursorPredicate = Prisma.sql``;
  if (range === ExpiredPrivateMaterialCursorRange.After) {
    if (cursor === null) {
      throw new Error("investigation_private_material_cursor_missing");
    }
    cursorPredicate = Prisma.sql`
      AND (material."expiresAt", material."privateMaterialId") >
        (${cursor.expiresAt}, ${cursor.privateMaterialId})
    `;
  } else if (range === ExpiredPrivateMaterialCursorRange.Through) {
    if (cursor === null) {
      throw new Error("investigation_private_material_cursor_missing");
    }
    cursorPredicate = Prisma.sql`
      AND (material."expiresAt", material."privateMaterialId") <=
        (${cursor.expiresAt}, ${cursor.privateMaterialId})
    `;
  }
  return transaction.$queryRaw<ExpiredPrivateMaterialCandidate[]>(Prisma.sql`
    WITH bounded_material AS (
      SELECT
        material."privateMaterialId",
        material."investigationId",
        material."obligationId",
        material."expiresAt"
      FROM "ReviewInvestigationPrivateMaterial" AS material
      WHERE material."expiresAt" <= ${effectiveCutoff}
        ${cursorPredicate}
      ORDER BY material."expiresAt" ASC, material."privateMaterialId" ASC
      LIMIT ${limit}
    )
    SELECT
      material."privateMaterialId",
      material."investigationId",
      material."obligationId",
      material."expiresAt",
      investigation."state" AS "investigationState"
    FROM bounded_material AS material
    INNER JOIN "ReviewInvestigation" AS investigation
      ON investigation."investigationId" = material."investigationId"
    ORDER BY material."expiresAt" ASC, material."privateMaterialId" ASC
  `);
}

export async function lockPrivateMaterialPruneCheckpoint(
  transaction: Prisma.TransactionClient,
): Promise<ExpiredPrivateMaterialCursor | null> {
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "ReviewInvestigationMaintenanceCheckpoint" (
      "checkpointKey", "cursorExpiresAt", "cursorPrivateMaterialId", "updatedAt"
    ) VALUES (${privateMaterialPruneCheckpointKey}, NULL, NULL, clock_timestamp())
    ON CONFLICT ("checkpointKey") DO NOTHING
  `);
  const [row] = await transaction.$queryRaw<
    Array<{
      cursorExpiresAt: Date | null;
      cursorPrivateMaterialId: string | null;
    }>
  >(
    Prisma.sql`
      SELECT "cursorExpiresAt", "cursorPrivateMaterialId"
      FROM "ReviewInvestigationMaintenanceCheckpoint"
      WHERE "checkpointKey" = ${privateMaterialPruneCheckpointKey}
      FOR UPDATE
    `,
  );
  if (!row) {
    throw new Error("investigation_private_material_checkpoint_missing");
  }
  if (
    (row.cursorExpiresAt === null) !==
    (row.cursorPrivateMaterialId === null)
  ) {
    throw new Error("investigation_private_material_checkpoint_corrupt");
  }
  if (row.cursorExpiresAt === null || row.cursorPrivateMaterialId === null) {
    return null;
  }
  return {
    expiresAt: row.cursorExpiresAt,
    privateMaterialId: row.cursorPrivateMaterialId,
  };
}

export async function updatePrivateMaterialPruneCheckpoint(
  transaction: Prisma.TransactionClient,
  cursor: ExpiredPrivateMaterialCursor | null,
  updatedAt: Date,
): Promise<void> {
  const updated = await transaction.$executeRaw(Prisma.sql`
    UPDATE "ReviewInvestigationMaintenanceCheckpoint"
    SET "cursorExpiresAt" = ${cursor?.expiresAt ?? null},
        "cursorPrivateMaterialId" = ${cursor?.privateMaterialId ?? null},
        "updatedAt" = ${updatedAt}
    WHERE "checkpointKey" = ${privateMaterialPruneCheckpointKey}
  `);
  if (updated !== 1) {
    throw new Error("investigation_private_material_checkpoint_update_failed");
  }
}

export function groupPrivateMaterialCandidates(
  candidates: readonly ExpiredPrivateMaterialCandidate[],
): readonly ExpiredPrivateMaterialGroup[] {
  const groups = new Map<
    string,
    {
      investigationState: PrismaInvestigationState;
      privateMaterialIds: string[];
      obligationIds: string[];
    }
  >();
  for (const candidate of candidates) {
    const group = groups.get(candidate.investigationId) ?? {
      investigationState: candidate.investigationState,
      privateMaterialIds: [],
      obligationIds: [],
    };
    group.privateMaterialIds.push(candidate.privateMaterialId);
    if (candidate.obligationId !== null) {
      group.obligationIds.push(candidate.obligationId);
    }
    groups.set(candidate.investigationId, group);
  }
  return [...groups.entries()].map(([investigationId, group]) => ({
    investigationId,
    investigationState: group.investigationState,
    privateMaterialIds: Object.freeze([...group.privateMaterialIds].sort()),
    obligationIds: Object.freeze([...new Set(group.obligationIds)].sort()),
  }));
}

export function isTerminalPrismaInvestigationState(
  state: PrismaInvestigationState,
): boolean {
  switch (state) {
    case PrismaInvestigationState.concluded:
    case PrismaInvestigationState.inconclusive:
    case PrismaInvestigationState.superseded:
    case PrismaInvestigationState.expired:
      return true;
    default:
      return false;
  }
}

export async function deleteExpiredPrivateMaterialGroup(
  transaction: Prisma.TransactionClient,
  group: ExpiredPrivateMaterialGroup,
  effectiveCutoff: Date,
): Promise<number> {
  const deleted =
    await transaction.reviewInvestigationPrivateMaterial.deleteMany({
      where: {
        privateMaterialId: { in: [...group.privateMaterialIds] },
        investigationId: group.investigationId,
        expiresAt: { lte: effectiveCutoff },
      },
    });
  if (deleted.count !== group.privateMaterialIds.length) {
    throw new PrivateMaterialGroupPruneError(
      InvestigationPrivateMaterialPruneFailureCause.ExpiryFenceChanged,
    );
  }
  return deleted.count;
}

