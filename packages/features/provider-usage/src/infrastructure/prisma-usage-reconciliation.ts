import { type PrismaClient } from "@prisma/client";
import { UsageError } from "../domain/usage";
import type { UsageIngestContext, UsageSourcePage } from "../application/ports";
import { PrismaUsageStore } from "./prisma-usage-store";
export interface UsageCheckpointLease {
  sourceInstance: string;
  workspaceId: string;
  owner: string;
  fence: bigint;
  cursor: string | null;
  highWaterMark: string | null;
}
export class PrismaUsageReconciliation {
  constructor(private readonly prisma: PrismaClient) {}
  async claim(input: {
    sourceInstance: string;
    workspaceId: string;
    owner: string;
    now: Date;
    leaseMs: number;
    coveredFrom: Date;
  }): Promise<UsageCheckpointLease | null> {
    if (
      !Number.isSafeInteger(input.leaseMs) ||
      input.leaseMs < 1000 ||
      input.leaseMs > 300000
    )
      throw new Error("usage_invalid_lease");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "UsageSourceCheckpoint"("sourceInstance","workspaceId","coveredFrom") SELECT ${input.sourceInstance},${input.workspaceId},${input.coveredFrom} WHERE EXISTS (SELECT 1 FROM "Workspace" WHERE "id"=${input.workspaceId} AND "deletionState"='active') ON CONFLICT DO NOTHING`;
      const rows = await tx.$queryRaw<
        { cursor: string | null; highWaterMark: string | null; fence: bigint }[]
      >`UPDATE "UsageSourceCheckpoint" SET "fence"="fence"+1,"leaseOwner"=${input.owner},"leaseUntil"=statement_timestamp()+(${input.leaseMs}*INTERVAL '1 millisecond') WHERE "sourceInstance"=${input.sourceInstance} AND "workspaceId"=${input.workspaceId} AND "disabledAt" IS NULL AND "deadLetteredAt" IS NULL AND ("nextAttemptAt" IS NULL OR "nextAttemptAt"<=statement_timestamp()) AND ("leaseUntil" IS NULL OR "leaseUntil"<statement_timestamp()) RETURNING "cursor","highWaterMark","fence"`;
      const row = rows[0];
      return row
        ? {
            sourceInstance: input.sourceInstance,
            workspaceId: input.workspaceId,
            owner: input.owner,
            ...row,
          }
        : null;
    });
  }
  /** Every fact, projection and cursor advance commits together. Stale fences perform no writes. */
  async commitPage(
    lease: UsageCheckpointLease,
    page: UsageSourcePage,
    context: UsageIngestContext,
  ): Promise<void> {
    if (
      page.facts.length > 100 ||
      context.workspaceId !== lease.workspaceId ||
      context.source !== "native" ||
      !page.cursor ||
      !page.highWaterMark
    )
      throw new Error("usage_invalid_source_page");
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { cursor: string | null; highWaterMark: string | null }[]
      >`SELECT "cursor","highWaterMark" FROM "UsageSourceCheckpoint" WHERE "sourceInstance"=${lease.sourceInstance} AND "workspaceId"=${lease.workspaceId} AND "leaseOwner"=${lease.owner} AND "fence"=${lease.fence} AND "leaseUntil">statement_timestamp() AND "disabledAt" IS NULL FOR UPDATE`;
      const row = rows[0];
      if (
        !row ||
        row.cursor !== lease.cursor ||
        (row.highWaterMark !== null && row.highWaterMark !== page.highWaterMark)
      )
        throw new UsageError("usage_checkpoint_stale");
      const store = new PrismaUsageStore(this.prisma);
      for (const fact of page.facts) {
        if (fact.sourceInstance !== lease.sourceInstance)
          throw new UsageError("usage_identity_conflict");
        await store.ingestInTransaction(tx, fact, {
          ...context,
          invocationId: fact.identity.invocationId,
        });
      }
      await tx.$executeRaw`UPDATE "UsageSourceCheckpoint" SET "cursor"=${page.cursor},"highWaterMark"=${page.complete ? null : page.highWaterMark},"asOf"=${context.now},"failureCount"=0,"nextAttemptAt"=NULL,"lastErrorCode"=NULL,"leaseOwner"=NULL,"leaseUntil"=NULL WHERE "sourceInstance"=${lease.sourceInstance} AND "fence"=${lease.fence}`;
    });
  }
  async fail(
    lease: UsageCheckpointLease,
    input: { code: string; now: Date },
  ): Promise<void> {
    if (!/^[a-z0-9_]{1,80}$/.test(input.code))
      throw new Error("usage_invalid_error_code");
    const count = await this.prisma
      .$executeRaw`UPDATE "UsageSourceCheckpoint" SET "failureCount"="failureCount"+1,"lastErrorCode"=${input.code},"nextAttemptAt"=statement_timestamp()+(LEAST(3600,60*power(2,LEAST("failureCount",6))) * INTERVAL '1 second'),"deadLetteredAt"=CASE WHEN "failureCount">=7 THEN statement_timestamp() ELSE NULL END,"leaseOwner"=NULL,"leaseUntil"=NULL WHERE "sourceInstance"=${lease.sourceInstance} AND "workspaceId"=${lease.workspaceId} AND "leaseOwner"=${lease.owner} AND "fence"=${lease.fence} AND "leaseUntil">statement_timestamp() AND "disabledAt" IS NULL`;
    if (count !== 1) throw new UsageError("usage_checkpoint_stale");
  }
  async prune(now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "UsageUnattributedObservation" WHERE "receivedAt"<${new Date(now.getTime() - 35 * 86400000)}`;
      await tx.$executeRaw`DELETE FROM "UsageSourceFact" WHERE "receivedAt"<${new Date(now.getTime() - 90 * 86400000)}`;
      await tx.$executeRaw`DELETE FROM "UsageCall" WHERE "occurredAt"<${new Date(now.getTime() - 365 * 86400000)}`;
      await tx.$executeRaw`DELETE FROM "UsageDedupeTombstone" WHERE "expiresAt"<${now}`;
    });
  }
  /** Called by the existing deletion workflow, under its workspace deletion guard. */
  async deleteWorkspace(workspaceId: string, now: Date): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.$queryRaw<
        { deletionState: string }[]
      >`SELECT "deletionState" FROM "Workspace" WHERE "id"=${workspaceId} FOR UPDATE`;
      if (workspace[0]?.deletionState === "active")
        throw new Error("usage_scope_not_deleting");
      await tx.$executeRaw`UPDATE "ProviderUsageGrant" SET "revokedAt"=${now} WHERE "workspaceId"=${workspaceId}`;
      await tx.$executeRaw`UPDATE "UsageSourceCheckpoint" SET "disabledAt"=${now},"leaseOwner"=NULL,"leaseUntil"=NULL WHERE "workspaceId"=${workspaceId}`;
      await tx.$executeRaw`DELETE FROM "UsageUnattributedObservation" WHERE "workspaceId"=${workspaceId}`;
      await tx.$executeRaw`DELETE FROM "UsageSourceFact" WHERE "workspaceId"=${workspaceId}`;
      await tx.$executeRaw`DELETE FROM "UsageCall" WHERE "workspaceId"=${workspaceId}`;
    });
  }
}
