import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  acquireCurrentScopeGuards,
  CURRENT_SCOPE_GUARD_NAMESPACE,
  planCurrentScopeGuards,
  type CurrentScopeGuard,
} from "./current-scope-guards";

const heldEpochs = new WeakMap<object, Promise<void>>();

/** WIP: only retry a known-rolled-back DB-only transaction. */
export async function runScopeEpochSerializableTransaction<T>(
  prisma: PrismaClient,
  scopes: readonly CurrentScopeGuard[],
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (transaction) => {
          await acquireCurrentScopeGuardsWithEpoch(transaction, scopes);
          return work(transaction);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (attempt >= 2 || !isSerializationFailure(error)) throw error;
    }
  }
}

function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2010" || !error.meta) return false;
  const adapter = error.meta.driverAdapterError;
  if (!adapter || typeof adapter !== "object" || !("cause" in adapter))
    return false;
  const cause = adapter.cause;
  return (
    !!cause &&
    typeof cause === "object" &&
    "kind" in cause &&
    cause.kind === "TransactionWriteConflict" &&
    "originalCode" in cause &&
    cause.originalCode === "40001"
  );
}

/**
 * Experimental only. This does not establish freshness until *every* relevant
 * authority writer uses the same epoch protocol and mixed-version rollout is
 * fenced. No production caller should enable takeover based on this helper.
 */
export async function acquireCurrentScopeGuardsWithEpoch(
  transaction: Prisma.TransactionClient,
  scopes: readonly CurrentScopeGuard[],
): Promise<void> {
  // Complete the full advisory hierarchy before taking any epoch row locks.
  // The existing guard rejects additions/upgrades to a held scope set.
  await acquireCurrentScopeGuards(transaction, scopes);
  const existing = heldEpochs.get(transaction);
  if (existing) return existing;
  const pending = acquireEpochs(transaction, scopes);
  heldEpochs.set(transaction, pending);
  return pending;
}

async function acquireEpochs(
  transaction: Prisma.TransactionClient,
  scopes: readonly CurrentScopeGuard[],
): Promise<void> {
  for (const lock of planCurrentScopeGuards(scopes)) {
    const keyHash = createHash("sha256")
      .update(CURRENT_SCOPE_GUARD_NAMESPACE)
      .update("\0")
      .update(lock.key)
      .digest("hex");
    // Ordinary readers must not issue an INSERT against an existing ancestor:
    // on PostgreSQL SSI, even ON CONFLICT DO NOTHING can conflict across
    // otherwise independent workspace transactions.
    let found = await transaction.$queryRaw<
      Array<{ revision: bigint }>
    >(Prisma.sql`
      SELECT "revision" FROM "CurrentScopeEpoch"
      WHERE "keyHash" = ${keyHash} FOR SHARE
    `);
    if (found.length === 0) {
      // Initialization races fail/retry under SSI rather than using an older
      // authority snapshot. No raw workspace/repository IDs are persisted.
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "CurrentScopeEpoch" ("keyHash") VALUES (${keyHash})
        ON CONFLICT ("keyHash") DO NOTHING
      `);
      found = await transaction.$queryRaw<
        Array<{ revision: bigint }>
      >(Prisma.sql`
        SELECT "revision" FROM "CurrentScopeEpoch"
        WHERE "keyHash" = ${keyHash} FOR SHARE
      `);
    }
    if (found.length !== 1) throw new Error("current_scope_epoch_missing");
    if (lock.mode === "exclusive") {
      const changed = await transaction.$executeRaw(Prisma.sql`
        UPDATE "CurrentScopeEpoch" SET "revision" = "revision" + 1
        WHERE "keyHash" = ${keyHash}
      `);
      if (changed !== 1) throw new Error("current_scope_epoch_missing");
    }
  }
}
