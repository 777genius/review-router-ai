import { estimateUsageCost } from "../domain/estimate-usage-cost";
import { validateUsagePriceSnapshot } from "../domain/usage-price";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  canonicalJson,
  identityKey,
  selectProjection,
  UsageError,
  type UsageErrorCode,
  type UsageFact,
  type UsageIdentity,
  type UsageProjection,
} from "../domain/usage";
import type { UsagePeriodReport } from "../application/report-usage";
import { readPrismaUsagePeriodReport } from "./prisma-usage-report";
import { IngestUsage } from "../application/ingest-usage";
import {
  validateReportQuery,
  type UsageIngestContext,
  type UsageIngestResult,
  type UsageStore,
  type UsageReportReader,
  type UsageReportQuery,
} from "../application/ports";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
type Tombstone = {
  callId: string;
  workspaceId: string;
  identityHash: string;
  lastRevision: number;
  lastHash: string;
};
export class PrismaUsageStore implements UsageStore {
  constructor(private readonly prisma: PrismaClient) {}
  async prepare(
    fact: UsageFact,
    context: UsageIngestContext,
  ): Promise<UsageIdentity> {
    if (
      context.source !== "native" ||
      fact.authority !== "lifecycle" ||
      fact.state !== "prepared"
    )
      throw new UsageError("usage_authority_conflict");
    await new IngestUsage({
      ingest: async () => ({ status: "accepted", hash: "" }),
    }).execute(fact, context);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`call:${fact.identity.callId}`},0))`;
      const workspace = await tx.$queryRaw<
        { deletionState: string }[]
      >`SELECT "deletionState" FROM "Workspace" WHERE "id"=${context.workspaceId} FOR SHARE`;
      if (workspace[0]?.deletionState !== "active")
        throw new UsageError("usage_scope_deleted");
      const rows = await tx.$queryRaw<
        { projection: UsageProjection }[]
      >`SELECT "projection" FROM "UsageCall" WHERE "callId"=${fact.identity.callId}`;
      const existing = rows[0]?.projection;
      if (existing) {
        const normalized = {
          ...fact.identity,
          occurredAt: existing.identity.occurredAt,
        };
        if (
          canonicalJson(normalized) !== canonicalJson(existing.identity) ||
          existing.lifecycle?.sourceInstance !== fact.sourceInstance ||
          existing.lifecycle?.eventId !== fact.eventId
        )
          throw new UsageError("usage_identity_conflict");
        return existing.identity;
      }
      await this.ingestInTransaction(tx, fact, context);
      return fact.identity;
    });
  }
  async ingest(
    fact: UsageFact,
    context: UsageIngestContext,
  ): Promise<UsageIngestResult> {
    // Keep direct adapter callers subject to the same validation and replay policy.
    return new IngestUsage({ ingest: (f, c) => this.persist(f, c) }).execute(
      fact,
      context,
    );
  }
  async ingestInTransaction(
    tx: Prisma.TransactionClient,
    f: UsageFact,
    c: UsageIngestContext,
  ): Promise<UsageIngestResult> {
    return new IngestUsage({
      ingest: (fact, context) => this.persist(fact, context, tx),
    }).execute(f, c);
  }
  private async persist(
    f: UsageFact,
    c: UsageIngestContext,
    transaction?: Prisma.TransactionClient,
  ): Promise<UsageIngestResult> {
    if (c.serverPriceSnapshot !== undefined && c.serverPriceSnapshot !== null)
      validateUsagePriceSnapshot(c.serverPriceSnapshot);
    const hash = digest(canonicalJson(f));
    const identityHash = digest(identityKey(f));
    const i = f.identity;
    const operation = async (tx: Prisma.TransactionClient) => {
      // Locks precede reads and serialize both cross-source call and source-event races.
      const locks = [
        `call:${i.callId}`,
        `event:${canonicalJson([f.sourceInstance, f.eventId])}`,
      ].sort();
      for (const key of locks)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const workspace = await tx.$queryRaw<
        { deletionState: string }[]
      >`SELECT "deletionState" FROM "Workspace" WHERE "id"=${i.workspaceId} FOR SHARE`;
      if (!workspace[0] || workspace[0].deletionState !== "active")
        return { error: "usage_scope_deleted" as const };
      const tombstones = await tx.$queryRaw<
        Tombstone[]
      >`SELECT * FROM "UsageDedupeTombstone" WHERE "sourceInstance"=${f.sourceInstance} AND "eventId"=${f.eventId}`;
      const tombstone = tombstones[0];
      const conflict = async (code: UsageErrorCode) => {
        await tx.$executeRaw`INSERT INTO "UsageIngestionConflict"("id","workspaceId","sourceInstance","eventId","revision","code","incomingHash") VALUES (${randomUUID()},${i.workspaceId},${f.sourceInstance},${f.eventId},${f.revision},${code},${hash})`;
        return { error: code };
      };
      if (
        tombstone &&
        (tombstone.identityHash !== identityHash ||
          tombstone.callId !== i.callId ||
          tombstone.workspaceId !== i.workspaceId)
      )
        return conflict("usage_identity_conflict");
      const duplicate = await tx.$queryRaw<
        { hash: string }[]
      >`SELECT "hash" FROM "UsageSourceFact" WHERE "sourceInstance"=${f.sourceInstance} AND "eventId"=${f.eventId} AND "revision"=${f.revision}`;
      if (duplicate[0])
        return duplicate[0].hash === hash
          ? { status: "duplicate" as const, hash }
          : conflict("usage_hash_conflict");
      if (tombstone && tombstone.lastRevision === f.revision)
        return tombstone.lastHash === hash
          ? { status: "duplicate" as const, hash }
          : conflict("usage_hash_conflict");
      const existing = await tx.$queryRaw<
        { identityHash: string; projection: UsageProjection }[]
      >`SELECT "identityHash","projection" FROM "UsageCall" WHERE "callId"=${i.callId}`;
      if (existing[0] && existing[0].identityHash !== identityHash)
        return conflict("usage_identity_conflict");
      // Retained dedupe records never recreate projections after retention/deletion.
      if (tombstone && !existing[0])
        return { error: "usage_report_expired" as const };
      const previous = await tx.$queryRaw<
        { fact: UsageFact }[]
      >`SELECT "fact" FROM "UsageSourceFact" WHERE "callId"=${i.callId}`;
      const previousSame = previous
        .filter(
          (r) =>
            r.fact.sourceInstance === f.sourceInstance &&
            r.fact.eventId === f.eventId,
        )
        .sort((a, b) => b.fact.revision - a.fact.revision)[0]?.fact;
      if (
        previousSame?.cost &&
        f.cost &&
        previousSame.cost.currency !== f.cost.currency
      )
        return conflict("usage_identity_conflict");
      if (previousSame && previousSame.authority !== f.authority)
        return conflict("usage_identity_conflict");
      if (
        previousSame &&
        ["completed", "failed", "cancelled"].includes(previousSame.state) &&
        f.revision > previousSame.revision &&
        !f.correctionReason
      )
        return conflict("usage_authority_conflict");
      let projection: UsageProjection;
      try {
        projection = selectProjection([...previous.map((r) => r.fact), f]);
      } catch (error) {
        if (error instanceof UsageError) return conflict(error.code);
        throw error;
      }
      const snapshot =
        existing[0]?.projection.priceSnapshot ??
        c.serverPriceSnapshot ??
        (c.source === "native" && f.authority === "lifecycle"
          ? f.priceSnapshot
          : null) ??
        null;
      if (
        existing[0]?.projection.priceSnapshot &&
        c.serverPriceSnapshot &&
        canonicalJson(existing[0].projection.priceSnapshot) !==
          canonicalJson(c.serverPriceSnapshot)
      )
        return conflict("usage_identity_conflict");
      projection = { ...projection, priceSnapshot: snapshot };
      if (projection.usage && projection.usage.cost === null && snapshot)
        projection = {
          ...projection,
          usage: {
            ...projection.usage,
            cost: estimateUsageCost({
              snapshot,
              tokens: projection.usage.tokens,
              provider: projection.usage.actualProvider,
              model: projection.usage.actualModel,
              tier: projection.usage.serviceTier ?? null,
              occurredAt: i.occurredAt,
            }),
          },
        };
      await tx.$executeRaw`INSERT INTO "UsageSourceFact"("sourceInstance","eventId","revision","hash","callId","workspaceId","fact","occurredAt","receivedAt") VALUES (${f.sourceInstance},${f.eventId},${f.revision},${hash},${i.callId},${i.workspaceId},${canonicalJson(f)}::jsonb,${new Date(i.occurredAt)},${c.now})`;
      await tx.$executeRaw`INSERT INTO "UsageCall"("callId","workspaceId","actorId","provider","actualModel","route","bindingId","runId","purpose","occurredAt","identityHash","projection","updatedAt") VALUES (${i.callId},${i.workspaceId},${i.actorId},${i.provider},${projection.usage?.actualModel ?? null},${i.route},${i.bindingId},${i.runId},${i.purpose},${new Date(i.occurredAt)},${identityHash},${canonicalJson(projection)}::jsonb,${c.now}) ON CONFLICT ("callId") DO UPDATE SET "actualModel"=EXCLUDED."actualModel", "projection"=EXCLUDED."projection", "updatedAt"=EXCLUDED."updatedAt"`;
      if (!tombstone || f.revision > tombstone.lastRevision)
        await tx.$executeRaw`INSERT INTO "UsageDedupeTombstone"("sourceInstance","eventId","callId","workspaceId","identityHash","lastRevision","lastHash","lastAcceptedAt","expiresAt") VALUES (${f.sourceInstance},${f.eventId},${i.callId},${i.workspaceId},${identityHash},${f.revision},${hash},${c.now},${new Date(c.now.getTime() + 400 * 86400000)}) ON CONFLICT ("sourceInstance","eventId") DO UPDATE SET "lastRevision"=EXCLUDED."lastRevision","lastHash"=EXCLUDED."lastHash","lastAcceptedAt"=EXCLUDED."lastAcceptedAt","expiresAt"=EXCLUDED."expiresAt"`;
      return { status: "accepted" as const, hash };
    };
    const result = await (transaction
      ? operation(transaction)
      : this.prisma.$transaction(operation));
    if ("error" in result) throw new UsageError(result.error);
    return result;
  }
}
export class PrismaUsageReportReader implements UsageReportReader {
  constructor(private readonly prisma: PrismaClient) {}
  async report(q: UsageReportQuery) {
    validateReportQuery(q);
    return this.prisma.$transaction(
      async (tx) => {
        const report = await readPrismaUsagePeriodReport(tx, q);
        const unattributed = await tx.$queryRaw<
          { count: bigint }[]
        >`SELECT COUNT(*) AS "count" FROM "UsageUnattributedObservation" WHERE "workspaceId"=${q.workspaceId} AND "observedAt">=${q.from} AND "observedAt"<${q.to} AND "resolvedAt" IS NULL`;

        const checkpoints = await tx.$queryRaw<
          {
            sourceInstance: string;
            coveredFrom: Date;
            asOf: Date | null;
            failureCount: number;
            nextAttemptAt: Date | null;
            deadLetteredAt: Date | null;
            lastErrorCode: string | null;
          }[]
        >`SELECT "sourceInstance","coveredFrom","asOf","failureCount","nextAttemptAt","deadLetteredAt","lastErrorCode" FROM "UsageSourceCheckpoint" WHERE "workspaceId"=${q.workspaceId} AND "disabledAt" IS NULL`;
        const coverageFilters = [
          Prisma.sql`"workspaceId"=${q.workspaceId}`,
          Prisma.sql`"issuedAt"<${q.to}`,
          Prisma.sql`"expiresAt">=${q.from}`,
        ];
        if (q.access === "member")
          coverageFilters.push(Prisma.sql`"actorId"=${q.actorId}`);
        if (q.purpose) coverageFilters.push(Prisma.sql`"purpose"=${q.purpose}`);
        if (q.runId) coverageFilters.push(Prisma.sql`"runId"=${q.runId}`);
        if (q.bindingId)
          coverageFilters.push(Prisma.sql`"bindingId"=${q.bindingId}`);
        const coverage = await tx.$queryRaw<
          {
            invocationId: string;
            producerCoverage: UsagePeriodReport["deliveryCoverage"][number]["coverage"];
          }[]
        >(
          Prisma.sql`SELECT "invocationId","producerCoverage" FROM "ProviderUsageGrant" WHERE ${Prisma.join(coverageFilters, " AND ")}`,
        );
        return {
          ...report,
          unattributedCount:
            q.access === "admin" ? Number(unattributed[0]?.count ?? 0n) : null,
          deliveryCoverage: coverage.map((row) => ({
            invocationId: row.invocationId,
            coverage: row.producerCoverage,
          })),
          sources: checkpoints.map((row) => ({
            sourceInstance: row.sourceInstance,
            failureCount: row.failureCount,
            nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
            deadLetteredAt: row.deadLetteredAt?.toISOString() ?? null,
            lastErrorCode: row.lastErrorCode,
            coveredFrom: row.coveredFrom.toISOString(),
            asOf: row.asOf?.toISOString() ?? null,
            lagMs: row.asOf
              ? Math.max(0, Date.now() - row.asOf.getTime())
              : null,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  read(q: UsageReportQuery): Promise<readonly UsageProjection[]> {
    return this.query(q);
  }
  private async query(
    q: UsageReportQuery,
  ): Promise<readonly UsageProjection[]> {
    validateReportQuery(q);
    const filters = [
      Prisma.sql`"workspaceId"=${q.workspaceId}`,
      Prisma.sql`"occurredAt">=${q.from}`,
      Prisma.sql`"occurredAt"<${q.to}`,
    ];
    if (q.access === "member") filters.push(Prisma.sql`"actorId"=${q.actorId}`);
    if (q.route) filters.push(Prisma.sql`"route"=${q.route}`);
    if (q.bindingId) filters.push(Prisma.sql`"bindingId"=${q.bindingId}`);
    if (q.runId) filters.push(Prisma.sql`"runId"=${q.runId}`);
    if (q.purpose) filters.push(Prisma.sql`"purpose"=${q.purpose}`);
    if (q.provider) filters.push(Prisma.sql`"provider"=${q.provider}`);
    if (q.model)
      filters.push(
        Prisma.sql`"projection"->'identity'->>'requestedModel'=${q.model}`,
      );
    if (q.after) filters.push(Prisma.sql`"callId">${q.after}`);
    const rows = await this.prisma.$queryRaw<{ projection: UsageProjection }[]>(
      Prisma.sql`SELECT "projection" FROM "UsageCall" WHERE ${Prisma.join(filters, " AND ")} ORDER BY "callId" LIMIT ${q.limit ?? 100}`,
    );
    return rows.map((r) => r.projection);
  }
}
export class PrismaUsageAttributionReader {
  async readDispatchSnapshot(input: { workspaceId: string; callId: string }) {
    const rows = await this.prisma.$queryRaw<
      { projection: UsageProjection }[]
    >`SELECT "projection" FROM "UsageCall" WHERE "workspaceId"=${input.workspaceId} AND "callId"=${input.callId}`;
    const projection = rows[0]?.projection;
    return projection
      ? {
          priceSnapshot:
            projection.priceSnapshot ??
            projection.lifecycle?.priceSnapshot ??
            null,
          serviceTier: projection.lifecycle?.serviceTier ?? null,
        }
      : null;
  }
  constructor(private readonly prisma: PrismaClient) {}
  async findIdentity(input: { workspaceId: string; callId: string }) {
    const rows = await this.prisma.$queryRaw<
      { projection: UsageProjection }[]
    >`SELECT "projection" FROM "UsageCall" WHERE "workspaceId"=${input.workspaceId} AND "callId"=${input.callId}`;
    return rows[0]?.projection.identity ?? null;
  }
}
