import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type * as C from "../../application/catalog-contracts.js";
import type {
  ResolvedCatalogSource,
  ReviewSkillScanClaim,
  ReviewSkillScanReport,
  ReviewSkillsCatalogStore,
} from "../../application/ports/review-skills-catalog-store.js";
import { validateReviewSkillContent } from "../../application/create-review-skills-service.js";
import { validateCatalogSelection } from "../../application/create-review-skills-catalog-service.js";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode as Code,
} from "../../domain/errors.js";
import {
  PrismaReviewSkillsStore,
  requireReviewSkillsMember,
} from "./prisma-review-skills-store.js";
import type { ReviewSkillsCatalogTransactionHooks } from "./catalog-transaction-hooks.js";
import { canonicalSkillScanText } from "../serialization/canonical-skill-text.js";

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "$queryRaw" | "$executeRaw">;
type Arg<K extends keyof C.ReviewSkillsCatalogService> = Parameters<
  C.ReviewSkillsCatalogService[K]
>[0];
type CandidateRow = {
  id: string;
  workspaceId: string;
  actorUserId: string;
  name: string;
  description: string;
  instructions: string;
  canonicalText: string;
  contentDigest: string;
  sourceRepository: string;
  sourceCommit: string;
  sourcePath: string;
  sourceDigest: string;
  omittedFields: string[];
  hasResources: boolean;
  createdAt: Date;
  expiresAt: Date;
  importedSkillId: string | null;
  importedScanId: string | null;
  importIntentDigest: string | null;
  importedAt: Date | null;
};
type ScanRow = {
  id: string;
  workspaceId: string;
  actorUserId: string;
  candidateId: string;
  operationId: string;
  requestDigest: string;
  contentDigest: string;
  mode: C.ReviewSkillScanMode;
  profile: C.ReviewSkillScanProfile;
  profileFingerprint: string;
  reuseOfScanId: string | null;
  status: C.ReviewSkillScan["status"];
  report: ReviewSkillScanReport | null;
  budgetUnits: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date;
  claimId: string | null;
  claimVersion: bigint | null;
  claimUntil: Date | null;
  executionDeadlineAt: Date | null;
  slotUntil: Date | null;
};
const day = 86_400_000;
const queueLifetimeMs = 10 * 60_000;
const terminationMarginMs = 10_000;
const digest = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const q = <T>(reader: Reader, statement: Prisma.Sql) =>
  reader.$queryRaw<readonly T[]>(statement);
const timestamp = (value: Date) =>
  Prisma.sql`${value.toISOString()}::timestamptz`;
// PrismaPg normalizes raw timestamptz values without retaining their UTC offset.
// Project these fixed columns as UTC timestamps so leases and expiry do not
// depend on the connection's TimeZone. Parameters likewise retain an explicit
// UTC offset. No user input enters these SQL fragments.
const candidateColumns = Prisma.raw(
  [
    ...[
      "id",
      "workspaceId",
      "actorUserId",
      "name",
      "description",
      "instructions",
      "canonicalText",
      "contentDigest",
      "sourceRepository",
      "sourceCommit",
      "sourcePath",
      "sourceDigest",
      "omittedFields",
      "hasResources",
      "importedSkillId",
      "importedScanId",
      "importIntentDigest",
    ].map((column) => `"${column}"`),
    ...["createdAt", "expiresAt", "importedAt"].map(
      (column) => `"${column}" AT TIME ZONE 'UTC' AS "${column}"`,
    ),
  ].join(","),
);
const scanColumns = Prisma.raw(
  [
    ...[
      "id",
      "workspaceId",
      "actorUserId",
      "candidateId",
      "operationId",
      "requestDigest",
      "contentDigest",
      "mode",
      "profile",
      "profileFingerprint",
      "reuseOfScanId",
      "status",
      "report",
      "budgetUnits",
      "claimId",
      "claimVersion",
    ].map((column) => `"${column}"`),
    ...[
      "createdAt",
      "startedAt",
      "completedAt",
      "expiresAt",
      "claimUntil",
      "executionDeadlineAt",
      "slotUntil",
    ].map((column) => `"${column}" AT TIME ZONE 'UTC' AS "${column}"`),
  ].join(","),
);
function fail(
  code: Code,
  details: Readonly<Record<string, string | number>> = {},
): never {
  throw new ReviewSkillsError(code, details);
}
const json = (value: unknown) => JSON.stringify(value);
const sameProfile = (
  left: C.ReviewSkillScanProfile,
  right: C.ReviewSkillScanProfile,
) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(
    ([key, value]) => right[key as keyof C.ReviewSkillScanProfile] === value,
  );
async function now(reader: Reader): Promise<Date> {
  const rows = await q<{ now: Date }>(
    reader,
    Prisma.sql`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "now"`,
  );
  return rows[0]!.now;
}
async function lockCapacity(reader: Reader) {
  // One bounded feature-wide admission/claim section; no network runs under it.
  await reader.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('review-skills-scan-capacity-v1',0))`;
}
function candidateView(
  row: CandidateRow,
): Omit<C.ReviewSkillImportCandidate, "aiAvailable"> {
  return {
    id: row.id,
    content: {
      name: row.name,
      description: row.description,
      instructions: row.instructions,
    },
    source: {
      repository: row.sourceRepository,
      commit: row.sourceCommit,
      path: row.sourcePath,
    },
    omittedFields: row.omittedFields,
    hasResources: row.hasResources,
    expiresAt: row.expiresAt.toISOString(),
  };
}
function profileValid(profile: C.ReviewSkillScanProfile): boolean {
  if (
    !profile ||
    !["static", "ai"].includes(profile.mode) ||
    !/^sha256:[a-f0-9]{64}$/.test(profile.fingerprint) ||
    profile.scannerVersion !== "2.13.1" ||
    !profile.profileId ||
    !profile.scannerBuildId ||
    !profile.policyVersion
  )
    return false;
  const ai = profile.mode === "ai";
  return (
    Number.isInteger(profile.maxDurationMs) &&
    profile.maxDurationMs > 0 &&
    profile.maxDurationMs <= (ai ? 180_000 : 90_000) &&
    Number.isInteger(profile.maxCalls) &&
    (ai
      ? profile.maxCalls > 0 &&
        profile.maxCalls <= 4 &&
        typeof profile.model === "string" &&
        profile.model.length > 0
      : profile.maxCalls === 0 && profile.model === null) &&
    Number.isInteger(profile.maxInputBytes) &&
    profile.maxInputBytes > 0 &&
    profile.maxInputBytes <= 131072 &&
    Number.isInteger(profile.maxOutputTokens) &&
    (ai
      ? profile.maxOutputTokens > 0 && profile.maxOutputTokens <= 2048
      : profile.maxOutputTokens === 0)
  );
}
function visibleScan(
  request: ScanRow,
  effective: ScanRow,
  at: Date,
): C.ReviewSkillScan {
  const expiredExecution =
    effective.status === "running" &&
    (!effective.claimUntil || effective.claimUntil <= at);
  const expiredQueue =
    effective.status === "queued" &&
    effective.createdAt.getTime() + queueLifetimeMs <= at.getTime();
  const status =
    expiredExecution || expiredQueue ? "incomplete" : effective.status;
  return {
    id: request.id,
    candidateId: request.candidateId,
    mode: request.mode,
    status,
    verdict:
      status === "incomplete"
        ? "incomplete"
        : (effective.report?.verdict ?? null),
    findings: effective.report?.findings ?? [],
    expiresAt: effective.expiresAt.toISOString(),
  };
}

export class PrismaReviewSkillsCatalogStore implements ReviewSkillsCatalogStore {
  private readonly skills: PrismaReviewSkillsStore;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hooks?: ReviewSkillsCatalogTransactionHooks,
  ) {
    this.skills = new PrismaReviewSkillsStore(prisma);
  }
  async authorize(input: C.ReviewSkillsCatalogActor) {
    await requireReviewSkillsMember(
      this.prisma,
      input.workspaceId,
      input.actor,
    );
  }
  private async candidate(
    reader: Reader,
    input: C.ReviewSkillsCatalogActor & { candidateId: string },
    lock = false,
  ) {
    const row = (
      await q<CandidateRow>(
        reader,
        Prisma.sql`SELECT ${candidateColumns} FROM "ReviewSkillImportCandidate" WHERE "id"=${input.candidateId} AND "workspaceId"=${input.workspaceId} AND "actorUserId"=${input.actor.userId} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
      )
    )[0];
    return row ?? fail(Code.NotFound);
  }
  private async scan(
    reader: Reader,
    input: C.ReviewSkillsCatalogActor & { scanId: string },
  ) {
    const row = (
      await q<ScanRow>(
        reader,
        Prisma.sql`SELECT ${scanColumns} FROM "ReviewSkillScan" WHERE "id"=${input.scanId} AND "workspaceId"=${input.workspaceId} AND "actorUserId"=${input.actor.userId}`,
      )
    )[0];
    if (!row) fail(Code.NotFound);
    const effective = row.reuseOfScanId
      ? (
          await q<ScanRow>(
            reader,
            Prisma.sql`SELECT ${scanColumns} FROM "ReviewSkillScan" WHERE "id"=${row.reuseOfScanId} AND "workspaceId"=${row.workspaceId} AND "contentDigest"=${row.contentDigest} AND "profileFingerprint"=${row.profileFingerprint} AND "reuseOfScanId" IS NULL`,
          )
        )[0]
      : row;
    if (!effective) fail(Code.Unavailable);
    return { request: row, effective };
  }
  async stage(
    input: C.ReviewSkillsCatalogActor & {
      resolved: ResolvedCatalogSource;
      normalized: C.ReviewSkillNormalizedImport;
    },
  ) {
    const content = validateReviewSkillContent(input.normalized.content);
    const canonicalText = input.normalized.canonicalText;
    const { source, rawContent, hasResources } = input.resolved;
    validateCatalogSelection({ ...source });
    const rawDigest = input.resolved.rawDigest.startsWith("sha256:")
      ? input.resolved.rawDigest
      : `sha256:${input.resolved.rawDigest}`;
    if (
      new TextEncoder().encode(rawContent).byteLength > 65536 ||
      rawDigest !== digest(rawContent) ||
      typeof canonicalText !== "string" ||
      canonicalText !== canonicalSkillScanText(content) ||
      new TextEncoder().encode(canonicalText).byteLength > 65536 ||
      !canonicalText.trim() ||
      canonicalText.includes("\0") ||
      typeof hasResources !== "boolean" ||
      !Array.isArray(input.normalized.omittedFields) ||
      input.normalized.omittedFields.length > 20 ||
      input.normalized.omittedFields.some(
        (value) => typeof value !== "string" || value.length > 100,
      )
    )
      fail(Code.InvalidInput);
    return this.skills.transaction([input.workspaceId], async (tx) => {
      await requireReviewSkillsMember(
        tx,
        input.workspaceId,
        input.actor,
        false,
        true,
      );
      const id = randomUUID(),
        at = await now(tx),
        expiresAt = new Date(at.getTime() + day);
      const rows = await q<CandidateRow>(
        tx,
        Prisma.sql`INSERT INTO "ReviewSkillImportCandidate" ("id","workspaceId","actorUserId","name","description","instructions","canonicalText","contentDigest","sourceRepository","sourceCommit","sourcePath","sourceDigest","omittedFields","hasResources","createdAt","expiresAt") VALUES (${id},${input.workspaceId},${input.actor.userId},${content.name},${content.description},${content.instructions},${canonicalText},${digest(canonicalText)},${source.repository},${source.commit},${source.path},${rawDigest},${json(input.normalized.omittedFields)}::jsonb,${hasResources},${timestamp(at)},${timestamp(expiresAt)}) RETURNING ${candidateColumns}`,
      );
      return candidateView(rows[0]!);
    });
  }
  async loadCandidate(input: Arg<"loadCandidate">) {
    await this.authorize(input);
    return candidateView(await this.candidate(this.prisma, input));
  }
  async requestScan(
    input: Arg<"requestScan"> & { profile: C.ReviewSkillScanProfile | null },
  ) {
    return this.skills.transaction([input.workspaceId], async (tx) => {
      await requireReviewSkillsMember(
        tx,
        input.workspaceId,
        input.actor,
        false,
        true,
      );
      await lockCapacity(tx);
      const candidate = await this.candidate(tx, input),
        at = await now(tx);
      const requestDigest = digest(json([input.candidateId, input.mode]));
      const prior = (
        await q<ScanRow>(
          tx,
          Prisma.sql`SELECT ${scanColumns} FROM "ReviewSkillScan" WHERE "workspaceId"=${input.workspaceId} AND "actorUserId"=${input.actor.userId} AND "operationId"=${input.operationId}`,
        )
      )[0];
      if (prior) {
        if (prior.requestDigest !== requestDigest) fail(Code.Conflict);
        const result = await this.scan(tx, { ...input, scanId: prior.id });
        return visibleScan(result.request, result.effective, at);
      }
      const profile = input.profile,
        hooks = this.hooks;
      if (
        !profile ||
        !hooks ||
        !profileValid(profile) ||
        input.mode !== profile.mode
      )
        fail(Code.Unavailable);
      if (candidate.expiresAt <= at) fail(Code.Unavailable);
      const reusable = (
        await q<ScanRow>(
          tx,
          Prisma.sql`SELECT ${scanColumns} FROM "ReviewSkillScan" WHERE "workspaceId"=${input.workspaceId} AND "contentDigest"=${candidate.contentDigest} AND "profileFingerprint"=${profile.fingerprint} AND "reuseOfScanId" IS NULL AND "expiresAt">${timestamp(at)} AND (("status"='completed' AND "report"->>'verdict' IN ('clear','warnings','blocked')) OR ("status"='queued' AND "createdAt">${timestamp(new Date(at.getTime() - queueLifetimeMs))}) OR ("status"='running' AND "claimUntil">${timestamp(at)})) ORDER BY "createdAt" DESC LIMIT 1`,
        )
      )[0];
      if (!reusable) {
        const queued = (
          await q<{ total: bigint; workspace: bigint; actor: bigint }>(
            tx,
            Prisma.sql`SELECT count(*) AS "total",count(*) FILTER (WHERE "workspaceId"=${input.workspaceId}) AS "workspace",count(*) FILTER (WHERE "actorUserId"=${input.actor.userId}) AS "actor" FROM "ReviewSkillScan" WHERE "reuseOfScanId" IS NULL AND "status"='queued' AND "createdAt">${timestamp(new Date(at.getTime() - queueLifetimeMs))}`,
          )
        )[0]!;
        if (queued.total >= 64n || queued.workspace >= 8n || queued.actor >= 4n)
          fail(Code.RateLimited, { retryAfterSeconds: 30 });
        await hooks.admit(tx, {
          actor: input.actor,
          workspaceId: input.workspaceId,
          profile,
          now: at,
        });
      }
      const id = randomUUID(),
        expiresAt = reusable?.expiresAt ?? new Date(at.getTime() + day);
      const rows = await q<ScanRow>(
        tx,
        Prisma.sql`INSERT INTO "ReviewSkillScan" ("id","workspaceId","actorUserId","candidateId","operationId","requestDigest","contentDigest","mode","profile","profileFingerprint","reuseOfScanId","status","budgetUnits","createdAt","expiresAt") VALUES (${id},${input.workspaceId},${input.actor.userId},${candidate.id},${input.operationId},${requestDigest},${candidate.contentDigest},${input.mode},${json(profile)}::jsonb,${profile.fingerprint},${reusable?.id ?? null},'queued',${reusable ? 0 : profile.maxCalls},${timestamp(at)},${timestamp(expiresAt)}) RETURNING ${scanColumns}`,
      );
      if (!reusable)
        await hooks.enqueue(tx, {
          jobId: id,
          workspaceId: input.workspaceId,
          now: at,
        });
      return visibleScan(rows[0]!, reusable ?? rows[0]!, at);
    });
  }
  async loadScan(input: Arg<"loadScan">) {
    await this.authorize(input);
    const result = await this.scan(this.prisma, input);
    return visibleScan(
      result.request,
      result.effective,
      await now(this.prisma),
    );
  }
  async importCandidate(
    input: Arg<"importCandidate"> & {
      profile: C.ReviewSkillScanProfile | null;
    },
  ) {
    return this.skills.transaction([input.workspaceId], async (tx) => {
      await requireReviewSkillsMember(
        tx,
        input.workspaceId,
        input.actor,
        false,
        true,
      );
      const candidate = await this.candidate(tx, input, true);
      const intent = digest(
        json([
          input.scanId,
          input.mode,
          input.acknowledgeWarnings,
          input.acknowledgeOmissions,
        ]),
      );
      if (candidate.importedSkillId) {
        if (candidate.importIntentDigest !== intent) fail(Code.Conflict);
        return this.skills.loadSkillInTransaction(tx, {
          actor: input.actor,
          workspaceId: input.workspaceId,
          skillId: candidate.importedSkillId,
        });
      }
      const { request, effective } = await this.scan(tx, {
          ...input,
          scanId: input.scanId,
        }),
        at = await now(tx);
      if (
        !input.profile ||
        request.candidateId !== candidate.id ||
        request.mode !== input.mode ||
        request.profileFingerprint !== input.profile.fingerprint ||
        request.contentDigest !== candidate.contentDigest ||
        candidate.expiresAt <= at ||
        effective.expiresAt <= at ||
        effective.status !== "completed" ||
        !effective.report ||
        !["clear", "warnings"].includes(effective.report.verdict)
      )
        fail(Code.Incomplete);
      if (effective.report.verdict === "warnings" && !input.acknowledgeWarnings)
        fail(Code.InvalidInput);
      if (
        (candidate.omittedFields.length > 0 || candidate.hasResources) &&
        !input.acknowledgeOmissions
      )
        fail(Code.InvalidInput);
      const content = validateReviewSkillContent({
        name: candidate.name,
        description: candidate.description,
        instructions: candidate.instructions,
      });
      const created = await this.skills.createSkillInTransaction(tx, {
        actor: input.actor,
        workspaceId: input.workspaceId,
        createOperationId: candidate.id,
        content,
      });
      await tx.$executeRaw`UPDATE "ReviewSkillImportCandidate" SET "importedSkillId"=${created.skillId},"importedScanId"=${request.id},"importIntentDigest"=${intent},"importedAt"=${timestamp(at)} WHERE "id"=${candidate.id} AND "importedSkillId" IS NULL`;
      return created;
    });
  }
  async beginScan(
    claim: ReviewSkillScanClaim,
    profiles: readonly C.ReviewSkillScanProfile[],
  ) {
    const initial = (
      await q<ScanRow>(
        this.prisma,
        Prisma.sql`SELECT ${scanColumns} FROM "ReviewSkillScan" WHERE "id"=${claim.jobId} AND "reuseOfScanId" IS NULL`,
      )
    )[0];
    if (!initial) return { status: "finished" as const };
    // The standard fence precedes feature capacity/job locks everywhere.
    return this.skills.transaction(
      [initial.workspaceId],
      async (tx) => {
        await lockCapacity(tx);
        const row = (
          await q<ScanRow>(
            tx,
            Prisma.sql`SELECT ${scanColumns} FROM "ReviewSkillScan" WHERE "id"=${claim.jobId} FOR UPDATE`,
          )
        )[0]!;
        const at = await now(tx);
        if (row.status === "completed" || row.status === "incomplete")
          return { status: "finished" as const };
        if (row.status === "running") {
          // No second physical attempt, even if this is an outbox redelivery.
          if (row.claimUntil && row.claimUntil > at)
            return { status: "busy" as const };
          await tx.$executeRaw`UPDATE "ReviewSkillScan" SET "status"='incomplete',"report"=${json({ verdict: "incomplete", findings: [] })}::jsonb,"completedAt"=${timestamp(at)} WHERE "id"=${row.id} AND "status"='running'`;
          return { status: "finished" as const };
        }
        const selected = profiles.find(
          (profile) =>
            profile.fingerprint === row.profileFingerprint &&
            profile.mode === row.mode,
        );
        let authorized = true;
        try {
          await requireReviewSkillsMember(
            tx,
            row.workspaceId,
            { userId: row.actorUserId },
            false,
            true,
          );
        } catch (error) {
          if (
            error instanceof ReviewSkillsError &&
            error.code === Code.Forbidden
          )
            authorized = false;
          else throw error;
        }
        const candidate = (
          await q<CandidateRow>(
            tx,
            Prisma.sql`SELECT ${candidateColumns} FROM "ReviewSkillImportCandidate" WHERE "id"=${row.candidateId} AND "workspaceId"=${row.workspaceId} AND "actorUserId"=${row.actorUserId}`,
          )
        )[0];
        if (
          !authorized ||
          !candidate ||
          candidate.expiresAt <= at ||
          row.createdAt.getTime() + queueLifetimeMs <= at.getTime() ||
          !selected ||
          !profileValid(selected) ||
          !sameProfile(selected, row.profile) ||
          claim.claimUntil.getTime() <=
            at.getTime() + selected.maxDurationMs + terminationMarginMs ||
          candidate.contentDigest !== row.contentDigest ||
          digest(candidate.canonicalText) !== row.contentDigest
        ) {
          await tx.$executeRaw`UPDATE "ReviewSkillScan" SET "status"='incomplete',"report"=${json({ verdict: "incomplete", findings: [] })}::jsonb,"completedAt"=${timestamp(at)} WHERE "id"=${row.id}`;
          return { status: "finished" as const };
        }
        const active = (
          await q<{ total: bigint; workspace: bigint; actor: bigint }>(
            tx,
            Prisma.sql`SELECT count(*) AS "total",count(*) FILTER (WHERE "workspaceId"=${row.workspaceId}) AS "workspace",count(*) FILTER (WHERE "actorUserId"=${row.actorUserId}) AS "actor" FROM "ReviewSkillScan" WHERE "reuseOfScanId" IS NULL AND "slotUntil">${timestamp(at)}`,
          )
        )[0]!;
        if (active.total >= 1n || active.workspace >= 1n || active.actor >= 1n)
          return { status: "busy" as const };
        const deadline = new Date(at.getTime() + selected.maxDurationMs),
          slotUntil = new Date(deadline.getTime() + terminationMarginMs);
        await tx.$executeRaw`UPDATE "ReviewSkillScan" SET "status"='running',"startedAt"=${timestamp(at)},"claimId"=${claim.claimId},"claimVersion"=${claim.claimVersion},"claimUntil"=${timestamp(claim.claimUntil)},"executionDeadlineAt"=${timestamp(deadline)},"slotUntil"=${timestamp(slotUntil)} WHERE "id"=${row.id} AND "status"='queued'`;
        return {
          status: "started" as const,
          execution: {
            jobId: row.id,
            attemptId: claim.claimId,
            canonicalText: candidate.canonicalText,
            contentDigest: candidate.contentDigest,
            profile: selected,
            deadlineAt: deadline.toISOString(),
          },
        };
      },
      false,
    );
  }
  async finishScan(
    input: ReviewSkillScanClaim & {
      report: ReviewSkillScanReport;
      confirmedExit: boolean;
    },
  ) {
    const report = json(input.report);
    if (Buffer.byteLength(report) > 96 * 1024) fail(Code.InvalidInput);
    const rows = await q<{ id: string }>(
      this.prisma,
      Prisma.sql`UPDATE "ReviewSkillScan" SET "status"=${input.report.verdict === "incomplete" ? "incomplete" : "completed"},"report"=${report}::jsonb,"completedAt"=clock_timestamp(),"slotUntil"=CASE WHEN ${input.confirmedExit} THEN clock_timestamp() ELSE "slotUntil" END WHERE "id"=${input.jobId} AND "reuseOfScanId" IS NULL AND "status"='running' AND "claimId"=${input.claimId} AND "claimVersion"=${input.claimVersion} AND "claimUntil">clock_timestamp() RETURNING "id"`,
    );
    return rows.length === 1;
  }
  async pruneExpired(input: { limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000)
      fail(Code.InvalidInput);
    return this.prisma.$transaction(async (tx) => {
      await lockCapacity(tx);
      const at = await now(tx),
        before = new Date(at.getTime() - 7 * day);
      // Reconcile abandoned attempts without retrying external execution.
      await tx.$executeRaw`UPDATE "ReviewSkillScan" SET "status"='incomplete',"report"=${json({ verdict: "incomplete", findings: [] })}::jsonb,"completedAt"=${timestamp(at)} WHERE "id" IN (SELECT "id" FROM "ReviewSkillScan" WHERE "reuseOfScanId" IS NULL AND (("status"='running' AND "claimUntil"<=${timestamp(at)}) OR ("status"='queued' AND "createdAt"<=${timestamp(new Date(at.getTime() - queueLifetimeMs))})) ORDER BY "createdAt" LIMIT ${input.limit})`;
      const scans = await q<{ id: string }>(
        tx,
        Prisma.sql`DELETE FROM "ReviewSkillScan" WHERE "id" IN (SELECT s."id" FROM "ReviewSkillScan" s WHERE s."expiresAt"<${timestamp(before)} AND (s."slotUntil" IS NULL OR s."slotUntil"<=${timestamp(at)}) AND NOT EXISTS(SELECT 1 FROM "ReviewSkillScan" alias WHERE alias."reuseOfScanId"=s."id") AND (s."reuseOfScanId" IS NOT NULL OR s."status" IN ('completed','incomplete')) ORDER BY s."expiresAt" LIMIT ${input.limit}) RETURNING "id"`,
      );
      const candidates = await q<{ id: string }>(
        tx,
        Prisma.sql`DELETE FROM "ReviewSkillImportCandidate" WHERE "id" IN (SELECT c."id" FROM "ReviewSkillImportCandidate" c WHERE c."expiresAt"<${timestamp(before)} AND NOT EXISTS(SELECT 1 FROM "ReviewSkillScan" s WHERE s."candidateId"=c."id") ORDER BY c."expiresAt" LIMIT ${input.limit}) RETURNING "id"`,
      );
      return { deleted: scans.length + candidates.length };
    });
  }
}
