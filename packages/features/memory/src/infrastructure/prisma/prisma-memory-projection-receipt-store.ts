import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { MemoryIndexOperationError } from "../../application/ports/memory-search-index-port";
import type {
  MemoryProjectionReceipt,
  MemoryProjectionReceiptStore,
  MemoryProjectionRevision,
} from "../projection/memory-projection-receipt-store";

type ReceiptStoreInput<K extends keyof MemoryProjectionReceiptStore> =
  Parameters<MemoryProjectionReceiptStore[K]>[0];
type QueryClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

// A single installation-wide lock protects admission for competing identities.
// No HTTP operation is performed while this transaction lock is held.
const admissionLock = Prisma.sql`SELECT pg_advisory_xact_lock(1802399085, 1)::text`;
const isCurrent = Prisma.sql`EXISTS (
  SELECT 1 FROM "MemoryItem" m WHERE m."id" = p."memoryItemId"
    AND m."workspaceId" = p."workspaceId" AND m."status" = 'active'
    AND (m."expiresAt" IS NULL OR m."expiresAt" > clock_timestamp())
    AND m."bodyVersion" = p."bodyVersion" AND m."bodyHash" = p."bodyHash"
    AND m."scope"::text = p."scope"
    AND m."repositoryId" IS NOT DISTINCT FROM p."repositoryId"
    AND m."userId" IS NOT DISTINCT FROM p."userId"
)`;
const selectReceipt = Prisma.sql`SELECT p.*, ${isCurrent} AS "isCurrent" FROM "MemoryProjectionReceipt" p`;

/** Durable, text-free projection state. Canonical records own all text. */
export class PrismaMemoryProjectionReceiptStore implements MemoryProjectionReceiptStore {
  constructor(private readonly prisma: PrismaClient) {}

  async assertCompatibleIndexIdentity(indexIdentity: string): Promise<void> {
    await this.withAdmission(async (tx) =>
      this.assertIdentity(tx, indexIdentity),
    );
  }

  async retireIndexIdentity(indexIdentity: string): Promise<void> {
    await this.withAdmission(async (tx) => {
      const debt = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "MemoryProjectionReceipt"
        WHERE "indexIdentity" = ${indexIdentity} AND "state" <> 'deleted' LIMIT 1`);
      if (debt.length)
        throw new MemoryIndexOperationError("memory_index_pending");
      await tx.$executeRaw(Prisma.sql`UPDATE "MemoryProjectionReceipt"
        SET "retiredAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "indexIdentity" = ${indexIdentity} AND "retiredAt" IS NULL`);
    });
  }

  async reserve(
    input: ReceiptStoreInput<"reserve">,
  ): Promise<MemoryProjectionReceipt | null> {
    return this.withAdmission(async (tx) => {
      await this.assertIdentity(tx, input.indexIdentity);
      if (!(await this.lockCurrentRevision(tx, input))) return null;
      await tx.$executeRaw(Prisma.sql`INSERT INTO "MemoryProjectionReceipt"
        ("id", "indexIdentity", "workspaceId", "memoryItemId", "repositoryId", "userId", "scope", "bodyVersion", "bodyHash")
        VALUES (${randomUUID()}, ${input.indexIdentity}, ${input.workspaceId}, ${input.memoryItemId},
          ${input.repositoryId}, ${input.userId}, ${input.scope}, ${input.bodyVersion}, ${input.bodyHash})
        ON CONFLICT ("indexIdentity", "workspaceId", "memoryItemId", "bodyVersion", "bodyHash") DO NOTHING`);
      const [receipt] = await tx.$queryRaw<
        MemoryProjectionReceipt[]
      >(Prisma.sql`${selectReceipt}
        WHERE p."indexIdentity" = ${input.indexIdentity} AND p."workspaceId" = ${input.workspaceId}
          AND p."memoryItemId" = ${input.memoryItemId} AND p."bodyVersion" = ${input.bodyVersion}
          AND p."bodyHash" = ${input.bodyHash}`);
      if (!receipt)
        throw new MemoryIndexOperationError("memory_index_conflict");
      if (receipt.state === "deleted")
        throw new MemoryIndexOperationError("memory_index_generation_retired");
      return receipt;
    });
  }

  async admitSend(
    input: ReceiptStoreInput<"admitSend">,
  ): Promise<MemoryProjectionReceipt | null> {
    return this.withAdmission(async (tx) => {
      await this.assertIdentity(tx, input.indexIdentity);
      const receipt = await this.findOne(tx, input);
      if (
        receipt.state === "deleted" ||
        receipt.deleteRequested ||
        !(await this.lockCurrentRevision(tx, receipt))
      )
        return null;
      if (receipt.state === "reserved") {
        await tx.$executeRaw(Prisma.sql`UPDATE "MemoryProjectionReceipt"
          SET "state" = 'sent_unknown', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${receipt.id}`);
      }
      return this.findOne(tx, input);
    });
  }

  async recordAcknowledgement(
    input: ReceiptStoreInput<"recordAcknowledgement">,
  ): Promise<MemoryProjectionReceipt> {
    return this.withAdmission(async (tx) => {
      const receipt = await this.findOne(tx, input);
      if (
        (receipt.remoteDocumentId !== null &&
          receipt.remoteDocumentId !== input.remoteDocumentId) ||
        receipt.state === "reserved"
      ) {
        throw new MemoryIndexOperationError("memory_index_conflict");
      }
      if (receipt.state === "deleted") {
        if (receipt.remoteDocumentId !== input.remoteDocumentId)
          throw new MemoryIndexOperationError("memory_index_conflict");
        return receipt;
      }
      await tx.$executeRaw(Prisma.sql`UPDATE "MemoryProjectionReceipt"
        SET "remoteDocumentId" = ${input.remoteDocumentId},
          "state" = CASE WHEN "state" = 'indexed' THEN 'indexed' ELSE 'accepted' END,
          "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${receipt.id}`);
      return this.findOne(tx, input);
    });
  }

  async markIndexed(
    input: ReceiptStoreInput<"markIndexed">,
  ): Promise<MemoryProjectionReceipt> {
    return this.withAdmission(async (tx) => {
      const receipt = await this.findOne(tx, input);
      if (receipt.remoteDocumentId !== input.remoteDocumentId)
        throw new MemoryIndexOperationError("memory_index_conflict");
      if (
        !receipt.deleteRequested &&
        receipt.state !== "deleted" &&
        (await this.lockCurrentRevision(tx, receipt))
      ) {
        await tx.$executeRaw(Prisma.sql`UPDATE "MemoryProjectionReceipt"
          SET "state" = 'indexed', "lastErrorCode" = NULL, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${receipt.id}`);
      }
      return this.findOne(tx, input);
    });
  }

  async findByReceiptIds(
    input: ReceiptStoreInput<"findByReceiptIds">,
  ): Promise<readonly MemoryProjectionReceipt[]> {
    if (input.receiptIds.length === 0) return [];
    return this.prisma.$queryRaw<
      MemoryProjectionReceipt[]
    >(Prisma.sql`${selectReceipt}
      WHERE p."indexIdentity" = ${input.indexIdentity} AND p."id" IN (${Prisma.join(input.receiptIds)})`);
  }

  async hasCoverage(input: ReceiptStoreInput<"hasCoverage">): Promise<boolean> {
    const scope = input.scope;
    const scopes: Prisma.Sql[] = [];
    if (scope.allowedScopes.includes("workspace"))
      scopes.push(
        Prisma.sql`(m."scope" = 'workspace' AND m."repositoryId" IS NULL AND m."userId" IS NULL)`,
      );
    if (scope.allowedScopes.includes("repository"))
      scopes.push(
        Prisma.sql`(m."scope" = 'repository' AND m."repositoryId" = ${scope.repositoryId} AND m."userId" IS NULL)`,
      );
    if (
      scope.allowedScopes.includes("user_prefs") &&
      scope.includeUserPrefs &&
      scope.userId
    )
      scopes.push(
        Prisma.sql`(m."scope" = 'user_prefs' AND m."repositoryId" IS NULL AND m."userId" = ${scope.userId})`,
      );
    if (scopes.length === 0) return true;
    const [result] = await this.prisma.$queryRaw<
      { covered: boolean }[]
    >(Prisma.sql`
      SELECT NOT EXISTS (
        SELECT 1 FROM "MemoryItem" m WHERE m."workspaceId" = ${scope.workspaceId}
          AND m."status" = 'active' AND (m."expiresAt" IS NULL OR m."expiresAt" > clock_timestamp())
          AND (${Prisma.join(scopes, " OR ")}) AND NOT EXISTS (
            SELECT 1 FROM "MemoryProjectionReceipt" p WHERE p."indexIdentity" = ${input.indexIdentity}
              AND p."workspaceId" = m."workspaceId" AND p."memoryItemId" = m."id"
              AND p."bodyVersion" = m."bodyVersion" AND p."bodyHash" = m."bodyHash"
              AND p."scope" = m."scope"::text
              AND p."repositoryId" IS NOT DISTINCT FROM m."repositoryId"
              AND p."userId" IS NOT DISTINCT FROM m."userId"
              AND p."state" = 'indexed' AND NOT p."deleteRequested" AND p."retiredAt" IS NULL
          )
      ) AS covered`);
    return result?.covered === true;
  }

  async requestDeletion(
    input: ReceiptStoreInput<"requestDeletion">,
  ): Promise<void> {
    await this.withAdmission(async (tx) => {
      await tx.$executeRaw(Prisma.sql`UPDATE "MemoryProjectionReceipt" p
        SET "deleteRequested" = TRUE, "state" = CASE WHEN p."state" = 'reserved' THEN 'deleted' ELSE p."state" END,
          "nextAttemptAt" = CASE WHEN p."deleteRequested" THEN p."nextAttemptAt" ELSE CURRENT_TIMESTAMP END,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE ${deletionFilter(input)} AND p."state" <> 'deleted'`);
    });
  }

  async listForDeletion(
    input: ReceiptStoreInput<"listForDeletion">,
  ): Promise<readonly MemoryProjectionReceipt[]> {
    return this.prisma.$queryRaw<
      MemoryProjectionReceipt[]
    >(Prisma.sql`${selectReceipt}
      WHERE ${deletionFilter(input)} AND p."state" <> 'deleted'
      ORDER BY p."nextAttemptAt", p."sequenceOrdinal" LIMIT ${boundedLimit(input.limit)}`);
  }

  async listDue(
    input: ReceiptStoreInput<"listDue">,
  ): Promise<readonly MemoryProjectionReceipt[]> {
    return this.prisma.$queryRaw<
      MemoryProjectionReceipt[]
    >(Prisma.sql`${selectReceipt}
      WHERE p."indexIdentity" = ${input.indexIdentity} AND p."state" <> 'deleted'
        AND p."nextAttemptAt" <= ${input.now}
        AND (p."state" <> 'indexed' OR p."deleteRequested" OR NOT ${isCurrent})
      ORDER BY p."nextAttemptAt", p."sequenceOrdinal" LIMIT ${boundedLimit(input.limit)}`);
  }

  async listOutstanding(
    input: ReceiptStoreInput<"listOutstanding">,
  ): Promise<readonly MemoryProjectionReceipt[]> {
    return this.prisma.$queryRaw<
      MemoryProjectionReceipt[]
    >(Prisma.sql`${selectReceipt}
      WHERE p."indexIdentity" = ${input.indexIdentity} AND p."state" <> 'deleted'
      ORDER BY p."nextAttemptAt", p."sequenceOrdinal" LIMIT ${boundedLimit(input.limit)}`);
  }

  async markDeleted(input: ReceiptStoreInput<"markDeleted">): Promise<void> {
    await this.withAdmission(async (tx) => {
      const receipt = await this.findOne(tx, input);
      if (receipt.remoteDocumentId !== input.remoteDocumentId)
        throw new MemoryIndexOperationError("memory_index_conflict");
      await tx.$executeRaw(Prisma.sql`UPDATE "MemoryProjectionReceipt"
        SET "state" = 'deleted', "deleteRequested" = TRUE, "lastErrorCode" = NULL, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${receipt.id}`);
    });
  }

  async defer(input: ReceiptStoreInput<"defer">): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`UPDATE "MemoryProjectionReceipt"
      SET "nextAttemptAt" = ${input.nextAttemptAt}, "lastErrorCode" = ${input.reasonCode}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "indexIdentity" = ${input.indexIdentity} AND "id" = ${input.receiptId} AND "state" <> 'deleted'`);
  }

  private async withAdmission<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(admissionLock);
      return operation(tx);
    });
  }

  private async assertIdentity(
    tx: QueryClient,
    indexIdentity: string,
  ): Promise<void> {
    const [conflict] = await tx.$queryRaw<
      { conflict: boolean; retired: boolean }[]
    >(Prisma.sql`
      SELECT EXISTS (SELECT 1 FROM "MemoryProjectionReceipt" WHERE "state" <> 'deleted' AND "indexIdentity" <> ${indexIdentity}) AS conflict,
        EXISTS (SELECT 1 FROM "MemoryProjectionReceipt" WHERE "indexIdentity" = ${indexIdentity} AND "retiredAt" IS NOT NULL) AS retired`);
    if (conflict?.conflict)
      throw new MemoryIndexOperationError("memory_index_identity_conflict");
    if (conflict?.retired)
      throw new MemoryIndexOperationError("memory_index_generation_retired");
  }

  private async lockCurrentRevision(
    tx: QueryClient,
    revision: MemoryProjectionRevision,
  ): Promise<boolean> {
    const items = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT m."id" FROM "MemoryItem" m WHERE m."id" = ${revision.memoryItemId} AND m."workspaceId" = ${revision.workspaceId}
        AND m."status" = 'active'
        AND m."bodyVersion" = ${revision.bodyVersion} AND m."bodyHash" = ${revision.bodyHash}
        AND m."scope"::text = ${revision.scope} AND m."repositoryId" IS NOT DISTINCT FROM ${revision.repositoryId}
        AND m."userId" IS NOT DISTINCT FROM ${revision.userId} FOR UPDATE`);
    if (items.length !== 1) return false;
    // A transaction/statement timestamp or a predicate evaluated before waiting
    // for FOR UPDATE can outlive the TTL. Recheck only after owning the row.
    const [current] = await tx.$queryRaw<{ active: boolean }[]>(Prisma.sql`
      SELECT ("expiresAt" IS NULL OR "expiresAt" > clock_timestamp()) AS active
      FROM "MemoryItem" WHERE "id" = ${revision.memoryItemId}`);
    return current?.active === true;
  }

  private async findOne(
    tx: QueryClient,
    input: ReceiptStoreInput<"admitSend">,
  ): Promise<MemoryProjectionReceipt> {
    const [receipt] = await tx.$queryRaw<
      MemoryProjectionReceipt[]
    >(Prisma.sql`${selectReceipt}
      WHERE p."indexIdentity" = ${input.indexIdentity} AND p."id" = ${input.receiptId}`);
    if (!receipt) throw new MemoryIndexOperationError("memory_index_conflict");
    return receipt;
  }
}

function deletionFilter(
  input: ReceiptStoreInput<"requestDeletion">,
): Prisma.Sql {
  const revision =
    input.target.kind === "revision"
      ? Prisma.sql`AND p."bodyVersion" = ${input.target.bodyVersion} AND p."bodyHash" = ${input.target.bodyHash}`
      : Prisma.empty;
  return Prisma.sql`p."indexIdentity" = ${input.indexIdentity} AND p."workspaceId" = ${input.workspaceId}
    AND p."memoryItemId" = ${input.memoryItemId} ${revision}`;
}

function boundedLimit(limit: number): number {
  return Number.isSafeInteger(limit) ? Math.min(500, Math.max(1, limit)) : 50;
}
