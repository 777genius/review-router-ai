import { Prisma, type PrismaClient } from "@prisma/client";
import {
  assertExclusivePublicationIntent,
  assertExclusivePublicationBinding,
  type ExclusiveTestPublicationIntent,
  type ExclusiveTestPublicationBinding,
  type ExclusiveTestPublicationRecord,
} from "../../domain/exclusive-test-publication";
import {
  exclusivePublicationHash,
  exclusivePublicationOperations,
  exclusivePublicationPlanHash,
} from "../exclusive-test-publication-hash";
import type { ExclusiveTestPublicationPort } from "../../application/ports/exclusive-test-publication-port";
type Db = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
type Row = ExclusiveTestPublicationRecord;

export async function lockExclusivePublicationExecution(
  db: Db,
  executionId: string,
): Promise<void> {
  // Select only an adapter-supported scalar; the FROM function still acquires
  // the exact transaction lock, without returning PostgreSQL's void type.
  await db.$queryRaw(
    Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`exclusive-publication:${executionId}`}, 0))`,
  );
}
export async function readExclusivePublication(
  db: Db,
  attemptId: string,
): Promise<ExclusiveTestPublicationRecord | null> {
  const rows = await db.$queryRaw<Row[]>(
    Prisma.sql`SELECT "intent", "binding", "closedAt", ARRAY(SELECT d."publicationOperationId" FROM "ExclusiveTestPublicationDispatchV2" d WHERE d."publicationAttemptId" = x."publicationAttemptId") AS "consumedOperations" FROM "ExclusiveTestPublicationV2" x WHERE "publicationAttemptId" = ${attemptId}`,
  );
  return rows[0] ?? null;
}
export async function readExclusivePublicationExecution(
  db: Db,
  executionId: string,
): Promise<ExclusiveTestPublicationRecord | null> {
  const rows = await db.$queryRaw<Row[]>(
    Prisma.sql`SELECT "intent", "binding", "closedAt", ARRAY(SELECT d."publicationOperationId" FROM "ExclusiveTestPublicationDispatchV2" d WHERE d."publicationAttemptId" = x."publicationAttemptId") AS "consumedOperations" FROM "ExclusiveTestPublicationV2" x WHERE "executionId" = ${executionId}`,
  );
  return rows[0] ?? null;
}

/** A trusted adapter must authenticate approval and measured artifact/permit
 * before invoking this store. JSON alone is not authentication. */
export class PrismaExclusiveTestPublication implements ExclusiveTestPublicationPort {
  constructor(private readonly prisma: PrismaClient) {}
  async admitIntent(intent: ExclusiveTestPublicationIntent): Promise<void> {
    assertExclusivePublicationIntent(intent);
    await this.prisma.$transaction(
      async (db) => {
        await lockExclusivePublicationExecution(db, intent.executionId);
        const previous = await readExclusivePublicationExecution(
          db,
          intent.executionId,
        );
        if (previous) {
          if (
            exclusivePublicationHash(previous.intent) !==
            exclusivePublicationHash(intent)
          )
            throw new Error("exclusive_publication_intent_conflict");
          // A restart is NOT a second provider admission, even before binding.
          throw new Error("exclusive_publication_intent_already_admitted");
        }
        const existing = await db.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT "publicationAttemptId" AS id FROM "ReviewPublicationAttemptV2" WHERE "executionId" = ${intent.executionId}`,
        );
        if (existing.length)
          throw new Error("exclusive_publication_already_queued");
        await db.$executeRaw(
          Prisma.sql`INSERT INTO "ExclusiveTestPublicationV2" ("executionId", "publicationIntentId", "approvalHash", "intent", "expiresAt") VALUES (${intent.executionId}, ${intent.publicationIntentId}, ${intent.approvalHash}, ${JSON.stringify(intent)}::jsonb, ${new Date(intent.expiresAt)})`,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async bind(
    binding: ExclusiveTestPublicationBinding,
    operations: Parameters<ExclusiveTestPublicationPort["bind"]>[1],
  ): Promise<void> {
    assertExclusivePublicationBinding(binding);
    if (
      exclusivePublicationHash(exclusivePublicationOperations(operations)) !==
        exclusivePublicationHash(binding.operations) ||
      exclusivePublicationPlanHash(operations) !== binding.planHash
    ) {
      throw new Error("exclusive_publication_complete_plan_required");
    }
    await this.prisma.$transaction(
      async (db) => {
        await lockExclusivePublicationExecution(db, binding.intent.executionId);
        const previous = await readExclusivePublicationExecution(
          db,
          binding.intent.executionId,
        );
        if (
          !previous ||
          exclusivePublicationHash(previous.intent) !==
            exclusivePublicationHash(binding.intent)
        )
          throw new Error("exclusive_publication_intent_missing");
        if (previous.binding) {
          if (
            exclusivePublicationHash(previous.binding) !==
            exclusivePublicationHash(binding)
          )
            throw new Error("exclusive_publication_binding_conflict");
          return;
        }
        const existing = await db.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT "publicationAttemptId" AS id FROM "ReviewPublicationAttemptV2" WHERE "executionId" = ${binding.intent.executionId}`,
        );
        if (existing.length)
          throw new Error("exclusive_publication_already_queued");
        const count = await db.$executeRaw(
          Prisma.sql`UPDATE "ExclusiveTestPublicationV2" SET "publicationAttemptId" = ${binding.publicationAttemptId}, "binding" = ${JSON.stringify(binding)}::jsonb WHERE "executionId" = ${binding.intent.executionId} AND "binding" IS NULL AND "expiresAt" > clock_timestamp()`,
        );
        if (count !== 1)
          throw new Error("exclusive_publication_binding_denied");
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async findByAttempt(id: string) {
    return readExclusivePublication(this.prisma, id);
  }
  async closeUnknown(binding: ExclusiveTestPublicationBinding): Promise<void> {
    assertExclusivePublicationBinding(binding);
    await this.prisma.$transaction(async (db) => {
      await db.$queryRaw(
        Prisma.sql`SELECT "publicationAttemptId" FROM "ReviewPublicationAttemptV2" WHERE "publicationAttemptId" = ${binding.publicationAttemptId} FOR UPDATE`,
      );
      await db.$executeRaw(
        Prisma.sql`UPDATE "ExclusiveTestPublicationV2" SET "closedAt" = clock_timestamp() WHERE "publicationAttemptId" = ${binding.publicationAttemptId} AND "binding" = ${JSON.stringify(binding)}::jsonb AND "closedAt" IS NULL`,
      );
    });
  }
  async excludedAttempts(ids: readonly string[]): Promise<ReadonlySet<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.$queryRaw<
      { publicationAttemptId: string }[]
    >(
      Prisma.sql`SELECT "publicationAttemptId" FROM "ExclusiveTestPublicationV2" WHERE "publicationAttemptId" IN (${Prisma.join(ids)})`,
    );
    return new Set(rows.map((row) => row.publicationAttemptId));
  }
  async consume(
    input: Parameters<ExclusiveTestPublicationPort["consume"]>[0],
  ): Promise<boolean> {
    assertExclusivePublicationBinding(input.binding);
    // Deliberately no serializable retry: a lost COMMIT response fences SEND.
    return this.prisma.$transaction(
      async (db) => {
        const [attempt] = await db.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT "publicationAttemptId" AS id FROM "ReviewPublicationAttemptV2" WHERE "publicationAttemptId" = ${input.binding.publicationAttemptId} FOR UPDATE`,
        );
        if (!attempt) return false;
        const count =
          await db.$executeRaw(Prisma.sql`INSERT INTO "ExclusiveTestPublicationDispatchV2" ("publicationAttemptId", "publicationOperationId", "operationAttemptId", "consumedAt")
        SELECT x."publicationAttemptId", ${input.publicationOperationId}, ${input.operationAttemptId}, clock_timestamp()
        FROM "ExclusiveTestPublicationV2" x, "ReviewPublicationAttemptV2" a, "ReviewPublicationClaimTermV2" c, "ReviewPublicationOperationAttemptV2" o
        WHERE x."publicationAttemptId" = ${input.binding.publicationAttemptId} AND x."binding" = ${JSON.stringify(input.binding)}::jsonb
          AND x."closedAt" IS NULL AND x."expiresAt" > clock_timestamp()
          AND a."publicationAttemptId" = x."publicationAttemptId" AND a."executionId" = x."executionId" AND a."activeClaimId" = c."claimId" AND a."state" <> 'terminal'
          AND c."claimId" = ${input.claimId} AND c."publicationAttemptId" = a."publicationAttemptId" AND c."ownerIdHash" = ${input.binding.intent.ownerIdHash}
          AND c."fencingToken" = ${input.claimFencingToken} AND c."state" = 'active' AND c."expiresAt" > clock_timestamp()
          AND o."operationAttemptId" = ${input.operationAttemptId} AND o."operationCapabilityId" = ${input.operationCapabilityId}
          AND o."publicationOperationId" = ${input.publicationOperationId} AND o."publicationAttemptId" = a."publicationAttemptId"
          AND o."claimId" = c."claimId" AND o."claimFencingToken" = c."fencingToken" AND o."state" = 'active'
          AND o."effectReportUntil" > clock_timestamp()
        ON CONFLICT ("publicationAttemptId", "publicationOperationId") DO NOTHING`);
        return count === 1;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
