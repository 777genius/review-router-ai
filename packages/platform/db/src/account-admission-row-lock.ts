import type { Prisma } from "@prisma/client";

export type AccountAdmissionRowLockIdentifiers = {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly bindingId: string;
};

/**
 * Acquire the C1 account admission locks in the caller's existing transaction.
 * The database routine checks exact linkage and deliberately exposes only a
 * boolean; authorization and active-state checks remain in snapshot capture.
 */
export async function lockAccountAdmission(
  transaction: Prisma.TransactionClient,
  identifiers: AccountAdmissionRowLockIdentifiers,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<readonly { locked: boolean }[]>`
    SELECT public.reviewrouter_lock_account_admission(
      ${identifiers.workspaceId},
      ${identifiers.connectionId},
      ${identifiers.bindingId}
    ) AS locked`;
  return rows.length === 1 && rows[0]?.locked === true;
}
