import { createHash, randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  assertRateLimit,
  PrismaRateLimitStore,
} from "@reviewrouter/features-rate-limits";
import { writePrismaOutboxEvent } from "@reviewrouter/features-outbox";
import { PrismaReviewSkillsCatalogStore } from "../infrastructure/prisma/prisma-review-skills-catalog-store.js";
import { processReviewSkillScan } from "../application/process-review-skill-scan.js";
import { PortableSkillImportNormalizer } from "../infrastructure/serialization/portable-skill-import-normalizer.js";
import { claimReviewSkillsPostgresFixture } from "./postgres-fixture.js";
import { scanProfile, nativeReport } from "./skill-catalog-fixtures.js";
import { capturedNativeSkillSpectorReports } from "./skillspector-native-report-fixtures.js";
import type {
  ReviewSkillsCatalogActor,
  ReviewSkillScanProfile,
} from "../application/catalog-contracts.js";
import type { ReviewSkillScanClaim } from "../application/ports/review-skills-catalog-store.js";
import type { ReviewSkillsCatalogTransactionHooks } from "../composition/catalog.js";

const url = process.env.REVIEW_SKILLS_TEST_DATABASE_URL;
if (!url && process.env.REVIEW_SKILLS_REQUIRE_PG === "1")
  throw new Error("review_skills_required_postgresql_missing");
describe.skipIf(!url)(
  "Skills catalog real PostgreSQL admission and execution",
  () => {
    const prefix = `catalog-${randomUUID()}`;
    let prisma: PrismaClient,
      fixture: Client,
      store: PrismaReviewSkillsCatalogStore;
    const normalizer = new PortableSkillImportNormalizer();
    const actors: ReviewSkillsCatalogActor[] = [];
    const hash = (s: string) =>
      `sha256:${createHash("sha256").update(s).digest("hex")}`;
    const enqueue: ReviewSkillsCatalogTransactionHooks["enqueue"] = async (
      tx,
      input,
    ) => {
      await writePrismaOutboxEvent(tx, {
        type: "review-skills.scan",
        version: 1,
        idempotencyKey: `${prefix}:${input.jobId}`,
        workspaceId: input.workspaceId,
        aggregateId: input.jobId,
        payload: { jobId: input.jobId },
        occurredAt: input.now,
        maxAttempts: 20,
      });
    };
    const admit: ReviewSkillsCatalogTransactionHooks["admit"] = async (
      tx,
      input,
    ) => {
      await assertRateLimit(
        {
          key: `${prefix}:actor:${input.actor.userId}`,
          limit: 100,
          windowMs: 3600000,
          amount: input.profile.maxCalls || 1,
        },
        {
          rateLimits: new PrismaRateLimitStore(tx),
          clock: { now: () => input.now },
        },
      );
    };
    async function actor() {
      const n = actors.length,
        userId = `${prefix}-user${n}`,
        workspaceId = `${prefix}-workspace${n}`;
      await prisma.user.create({ data: { id: userId } });
      await prisma.workspace.create({
        data: {
          id: workspaceId,
          slug: workspaceId,
          name: "Catalog fixture",
          members: { create: { userId, role: "owner" } },
        },
      });
      const value = { actor: { userId }, workspaceId };
      actors.push(value);
      return value;
    }
    async function candidate(
      who: ReviewSkillsCatalogActor,
      body = "Review the code for mistakes.",
      hasResources = false,
    ) {
      const raw = `---\nname: catalog-fixture\ndescription: Review code\n---\n${body}`;
      return store.stage({
        ...who,
        resolved: {
          status: "resolved",
          source: {
            repository: "fixture/skills",
            commit: "a".repeat(40),
            path: "",
          },
          rawContent: raw,
          rawDigest: hash(raw),
          hasResources,
        },
        normalized: await normalizer.normalize(raw),
      });
    }
    async function request(
      who: ReviewSkillsCatalogActor,
      candidateId: string,
      profile = scanProfile(),
      operationId = randomUUID(),
    ) {
      return store.requestScan({
        ...who,
        candidateId,
        operationId,
        mode: profile.mode,
        profile,
      });
    }
    function claim(jobId: string): ReviewSkillScanClaim {
      return {
        jobId,
        claimId: `fixture-${randomUUID()}`,
        claimVersion: 1n,
        claimUntil: new Date(Date.now() + 240000),
      };
    }
    async function complete(
      jobId: string,
      profile = scanProfile(),
      verdict: "clear" | "warnings" | "blocked" = "clear",
    ) {
      const term = claim(jobId),
        started = await store.beginScan(term, [profile]);
      expect(started.status).toBe("started");
      expect(
        await store.finishScan({
          ...term,
          report: { verdict, findings: [] },
          confirmedExit: true,
        }),
      ).toBe(true);
      return term;
    }
    beforeAll(async () => {
      fixture = await claimReviewSkillsPostgresFixture(url!);
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url! }),
      });
      store = new PrismaReviewSkillsCatalogStore(prisma, { admit, enqueue });
      expect(
        Number(
          (await fixture.query("SHOW server_version_num")).rows[0]
            .server_version_num,
        ),
      ).toBeGreaterThanOrEqual(170000);
    });
    afterEach(async () => {
      // Only this test's rows. Clear request aliases before physical rows; library
      // creation fixtures remain in this disposable database until it is removed.
      await prisma.reviewSkillScan.deleteMany({
        where: {
          workspaceId: { startsWith: prefix },
          reuseOfScanId: { not: null },
        },
      });
      await prisma.reviewSkillScan.deleteMany({
        where: { workspaceId: { startsWith: prefix } },
      });
      await prisma.reviewSkillImportCandidate.deleteMany({
        where: { workspaceId: { startsWith: prefix } },
      });
    });
    afterAll(async () => {
      await prisma?.$disconnect();
      await fixture?.end();
    });

    it("concurrent identical work creates one physical job/event/charge and durable request receipts", async () => {
      const who = await actor(),
        c = await candidate(who),
        one = randomUUID(),
        two = randomUUID();
      const results = await Promise.all([
        request(who, c.id, scanProfile(), one),
        request(who, c.id, scanProfile(), two),
        request(who, c.id, scanProfile(), one),
      ]);
      expect(results[0]!.id).toBe(results[2]!.id);
      expect(results[0]!.id).not.toBe(results[1]!.id);
      const rows = await prisma.reviewSkillScan.findMany({
        where: { workspaceId: who.workspaceId },
      });
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => !r.reuseOfScanId)).toHaveLength(1);
      expect(
        await prisma.outboxEvent.count({
          where: { workspaceId: who.workspaceId },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.rateLimitBucket.findUnique({
            where: { key: `${prefix}:actor:${who.actor.userId}` },
          })
        )?.count,
      ).toBe(1);
      await expect(
        request(who, c.id, scanProfile("ai"), one),
      ).rejects.toMatchObject({ code: "conflict" });
      await complete(rows.find((r) => !r.reuseOfScanId)!.id);
      for (const result of results)
        expect(
          (await store.loadScan({ ...who, scanId: result.id })).verdict,
        ).toBe("clear");
    });
    it("reuses only exact workspace/profile content and recovers operations while configuration is unavailable", async () => {
      const who = await actor(),
        other = await actor(),
        c = await candidate(who),
        operationId = randomUUID();
      const first = await request(who, c.id, scanProfile(), operationId);
      await complete(first.id);
      const second = await request(who, c.id);
      expect(second.id).not.toBe(first.id);
      expect(
        (await prisma.reviewSkillScan.findUnique({ where: { id: second.id } }))
          ?.reuseOfScanId,
      ).toBe(first.id);
      expect(
        (
          await store.requestScan({
            ...who,
            candidateId: c.id,
            operationId,
            mode: "static",
            profile: null,
          })
        ).id,
      ).toBe(first.id);
      const otherCandidate = await candidate(other);
      const isolated = await request(other, otherCandidate.id);
      expect(
        (
          await prisma.reviewSkillScan.findUnique({
            where: { id: isolated.id },
          })
        )?.reuseOfScanId,
      ).toBeNull();
      const ai = await request(who, c.id, scanProfile("ai"));
      expect(
        (await prisma.reviewSkillScan.findUnique({ where: { id: ai.id } }))
          ?.budgetUnits,
      ).toBe(4);
      await expect(
        store.loadScan({ ...other, scanId: first.id }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        store.loadCandidate({ ...other, candidateId: c.id }),
      ).rejects.toMatchObject({ code: "not_found" });
    });
    it("persists native usage without refunding reserved calls or exposing technical counters to the user", async () => {
      const who = await actor(),
        c = await candidate(who),
        profile = scanProfile("ai"),
        job = await request(who, c.id, profile);
      await processReviewSkillScan(claim(job.id), {
        store,
        profiles: [profile],
        executor: {
          scan: async (execution) => ({
            jobId: execution.jobId,
            attemptId: execution.attemptId,
            contentDigest: execution.contentDigest,
            profileFingerprint: execution.profile.fingerprint,
            scannerBuildId: execution.profile.scannerBuildId,
            executionFinished: true,
            report: capturedNativeSkillSpectorReports.ai,
          }),
        },
      });
      const stored = await prisma.reviewSkillScan.findUniqueOrThrow({
        where: { id: job.id },
      });
      expect(stored.budgetUnits).toBe(4);
      expect(stored.report).toMatchObject({
        verdict: "clear",
        reportedUsage: {
          callsAttempted: 3,
          callsSucceeded: 3,
          inputTokens: 300,
          outputTokens: 30,
          totalTokens: 330,
        },
      });
      const visible = await store.loadScan({ ...who, scanId: job.id });
      expect(visible.verdict).toBe("clear");
      expect(visible).not.toHaveProperty("reportedUsage");
      expect(visible).not.toHaveProperty("budgetUnits");
    });
    it("rolls back all budget scopes, job and outbox when a later admission rule refuses", async () => {
      const who = await actor(),
        c = await candidate(who),
        key1 = `${prefix}:rollback:first`,
        key2 = `${prefix}:rollback:second`;
      const now = new Date();
      await assertRateLimit(
        { key: key2, limit: 1, windowMs: 3600000 },
        {
          rateLimits: new PrismaRateLimitStore(prisma),
          clock: { now: () => now },
        },
      );
      const limited = new PrismaReviewSkillsCatalogStore(prisma, {
        enqueue,
        admit: async (tx, i) => {
          for (const key of [key1, key2])
            await assertRateLimit(
              { key, limit: 1, windowMs: 3600000 },
              {
                rateLimits: new PrismaRateLimitStore(tx),
                clock: { now: () => i.now },
              },
            );
        },
      });
      await expect(
        limited.requestScan({
          ...who,
          candidateId: c.id,
          operationId: randomUUID(),
          mode: "static",
          profile: scanProfile(),
        }),
      ).rejects.toThrow("rate_limit_exceeded");
      expect(
        await prisma.rateLimitBucket.findUnique({ where: { key: key1 } }),
      ).toBeNull();
      expect(
        (await prisma.rateLimitBucket.findUnique({ where: { key: key2 } }))
          ?.count,
      ).toBe(1);
      expect(
        await prisma.reviewSkillScan.count({
          where: { workspaceId: who.workspaceId },
        }),
      ).toBe(0);
      expect(
        await prisma.outboxEvent.count({
          where: { workspaceId: who.workspaceId },
        }),
      ).toBe(0);
    });
    it("rolls back admission when outbox persistence fails", async () => {
      const who = await actor(),
        c = await candidate(who);
      const failing = new PrismaReviewSkillsCatalogStore(prisma, {
        admit,
        enqueue: async () => {
          throw new Error("storage unavailable");
        },
      });
      await expect(
        failing.requestScan({
          ...who,
          candidateId: c.id,
          operationId: randomUUID(),
          mode: "static",
          profile: scanProfile(),
        }),
      ).rejects.toThrow("storage unavailable");
      expect(
        await prisma.reviewSkillScan.count({
          where: { workspaceId: who.workspaceId },
        }),
      ).toBe(0);
      expect(
        await prisma.rateLimitBucket.findUnique({
          where: { key: `${prefix}:actor:${who.actor.userId}` },
        }),
      ).toBeNull();
    });
    it("denies a revoked queued actor before transmission and revoked reads/imports", async () => {
      const who = await actor(),
        c = await candidate(who),
        job = await request(who, c.id);
      let transmissions = 0;
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: who.workspaceId, userId: who.actor.userId },
      });
      expect(
        await processReviewSkillScan(claim(job.id), {
          store,
          profiles: [scanProfile()],
          executor: {
            scan: async () => {
              transmissions++;
              throw new Error("must not transmit");
            },
          },
        }),
      ).toBe("processed");
      expect(transmissions).toBe(0);
      expect(
        (await prisma.reviewSkillScan.findUnique({ where: { id: job.id } }))
          ?.status,
      ).toBe("incomplete");
      await expect(
        store.loadScan({ ...who, scanId: job.id }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        store.importCandidate({
          ...who,
          candidateId: c.id,
          scanId: job.id,
          mode: "static",
          profile: scanProfile(),
          acknowledgeWarnings: true,
          acknowledgeOmissions: true,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    });
    it("holds a global execution slot through uncertain termination and rejects stale completion", async () => {
      const who = await actor(),
        other = await actor(),
        c = await candidate(who),
        d = await candidate(other),
        first = await request(who, c.id),
        second = await request(other, d.id);
      const firstClaim = claim(first.id),
        secondClaim = claim(second.id);
      const starts = await Promise.all([
        store.beginScan(firstClaim, [scanProfile()]),
        store.beginScan(secondClaim, [scanProfile()]),
      ]);
      expect(starts.filter((r) => r.status === "started")).toHaveLength(1);
      expect(starts.filter((r) => r.status === "busy")).toHaveLength(1);
      const active = starts[0]!.status === "started" ? firstClaim : secondClaim,
        waiting = active === firstClaim ? secondClaim : firstClaim;
      expect(
        await store.finishScan({
          ...active,
          claimId: "stale",
          report: { verdict: "clear", findings: [] },
          confirmedExit: true,
        }),
      ).toBe(false);
      expect(
        await store.finishScan({
          ...active,
          report: { verdict: "incomplete", findings: [] },
          confirmedExit: false,
        }),
      ).toBe(true);
      expect(
        (await prisma.reviewSkillScan.findUnique({
          where: { id: active.jobId },
        }))!.slotUntil!.getTime(),
      ).toBeGreaterThan(Date.now());
      expect((await store.beginScan(waiting, [scanProfile()])).status).toBe(
        "busy",
      );
      expect(
        (
          await store.beginScan(
            { ...active, claimId: "redelivery", claimVersion: 2n },
            [scanProfile()],
          )
        ).status,
      ).toBe("finished");
    });
    it("rejects too-short claims and does not transmit a different current profile", async () => {
      const who = await actor(),
        c = await candidate(who),
        job = await request(who, c.id);
      expect(
        (
          await store.beginScan(
            { ...claim(job.id), claimUntil: new Date(Date.now() + 5000) },
            [scanProfile()],
          )
        ).status,
      ).toBe("finished");
      expect(
        (await prisma.reviewSkillScan.findUnique({ where: { id: job.id } }))
          ?.status,
      ).toBe("incomplete");
      const changedCandidate = await candidate(
          who,
          "A different immutable candidate.",
        ),
        changed = await request(who, changedCandidate.id);
      const currentProfile = {
        ...scanProfile(),
        policyVersion: "skill-import-v2",
        fingerprint: `sha256:${"f".repeat(64)}`,
      };
      expect(
        (await store.beginScan(claim(changed.id), [currentProfile])).status,
      ).toBe("finished");
      expect(
        (await prisma.reviewSkillScan.findUnique({ where: { id: changed.id } }))
          ?.status,
      ).toBe("incomplete");
    });
    it("preserves UTC validity and execution deadlines with a non-UTC database session", async () => {
      const nonUtc = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url!,
          options: "-c timezone=Europe/Chisinau",
        }),
      });
      try {
        const shifted = new PrismaReviewSkillsCatalogStore(nonUtc, {
          admit,
          enqueue,
        });
        const who = await actor(),
          raw =
            "---\nname: timezone-fixture\ndescription: Review code\n---\nCheck the code.",
          startedAt = Date.now();
        const c = await shifted.stage({
          ...who,
          resolved: {
            status: "resolved",
            source: {
              repository: "fixture/skills",
              commit: "a".repeat(40),
              path: "",
            },
            rawContent: raw,
            rawDigest: hash(raw),
            hasResources: false,
          },
          normalized: await normalizer.normalize(raw),
        });
        expect(
          new Date(c.expiresAt).getTime() - startedAt,
        ).toBeGreaterThanOrEqual(86400000);
        expect(new Date(c.expiresAt).getTime() - startedAt).toBeLessThan(
          86410000,
        );
        const job = await shifted.requestScan({
            ...who,
            candidateId: c.id,
            operationId: randomUUID(),
            mode: "static",
            profile: scanProfile(),
          }),
          term = claim(job.id);
        const started = await shifted.beginScan(term, [scanProfile()]);
        expect(started.status).toBe("started");
        if (started.status !== "started")
          throw new Error("scan fixture did not start");
        const remaining =
          new Date(started.execution.deadlineAt).getTime() - Date.now();
        expect(remaining).toBeGreaterThan(80000);
        expect(remaining).toBeLessThanOrEqual(90000);
        expect(
          await shifted.finishScan({
            ...term,
            report: { verdict: "clear", findings: [] },
            confirmedExit: true,
          }),
        ).toBe(true);
      } finally {
        await nonUtc.$disconnect();
      }
    });
    it("atomically imports checked exact fields once and replays after expiry", async () => {
      const who = await actor(),
        c = await candidate(who, "Preserve Unicode: Україна.\r\nNext line."),
        job = await request(who, c.id);
      await complete(job.id);
      const input = {
        ...who,
        candidateId: c.id,
        scanId: job.id,
        mode: "static" as const,
        profile: scanProfile(),
        acknowledgeWarnings: false,
        acknowledgeOmissions: false,
      };
      const [first, second] = await Promise.all([
        store.importCandidate(input),
        store.importCandidate(input),
      ]);
      expect(second.skillId).toBe(first.skillId);
      expect(first.instructions).toBe(c.content.instructions);
      expect(
        await prisma.reviewSkill.count({
          where: {
            sourceWorkspaceId: who.workspaceId,
            createOperationId: c.id,
          },
        }),
      ).toBe(1);
      // Owner-only fixture time travel after the real atomic commit. Production
      // identities/expiry are immutable, and their enforcement is tested below.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role=replica",
        );
        await tx.$executeRaw`UPDATE "ReviewSkillImportCandidate" SET "createdAt"=clock_timestamp()-INTERVAL '3 days',"expiresAt"=clock_timestamp()-INTERVAL '1 day' WHERE "id"=${c.id}`;
        await tx.$executeRaw`UPDATE "ReviewSkillScan" SET "expiresAt"=clock_timestamp()-INTERVAL '1 day' WHERE "id"=${job.id}`;
      });
      expect(
        (await store.importCandidate({ ...input, profile: null })).skillId,
      ).toBe(first.skillId);
      await expect(
        store.importCandidate({ ...input, acknowledgeWarnings: true }),
      ).rejects.toMatchObject({ code: "conflict" });
    });
    it("requires warning/resource acknowledgments and refuses blocked or mismatched evidence", async () => {
      const who = await actor(),
        c = await candidate(who, "Review the code.", true),
        job = await request(who, c.id);
      await complete(job.id, scanProfile(), "warnings");
      const input = {
        ...who,
        candidateId: c.id,
        scanId: job.id,
        mode: "static" as const,
        profile: scanProfile(),
        acknowledgeWarnings: false,
        acknowledgeOmissions: false,
      };
      await expect(store.importCandidate(input)).rejects.toMatchObject({
        code: "invalid_input",
      });
      await expect(
        store.importCandidate({ ...input, acknowledgeWarnings: true }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        store.importCandidate({
          ...input,
          acknowledgeWarnings: true,
          acknowledgeOmissions: true,
          mode: "ai",
          profile: scanProfile("ai"),
        }),
      ).rejects.toMatchObject({ code: "incomplete" });
      expect(
        (
          await store.importCandidate({
            ...input,
            acknowledgeWarnings: true,
            acknowledgeOmissions: true,
          })
        ).instructions,
      ).toBe(c.content.instructions);
      const blocked = await candidate(who, "Never use this unsafe content."),
        blockJob = await request(who, blocked.id);
      await complete(blockJob.id, scanProfile(), "blocked");
      await expect(
        store.importCandidate({
          ...input,
          candidateId: blocked.id,
          scanId: blockJob.id,
          acknowledgeWarnings: true,
          acknowledgeOmissions: true,
        }),
      ).rejects.toMatchObject({ code: "incomplete" });
    });
    it("enforces immutable content, request identity, terminal reports and one-hop reuse in the database", async () => {
      const who = await actor(),
        c = await candidate(who),
        job = await request(who, c.id),
        alias = await request(who, c.id);
      await complete(job.id);
      await expect(
        prisma.reviewSkillImportCandidate.update({
          where: { id: c.id },
          data: { instructions: "Changed" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.reviewSkillScan.update({
          where: { id: alias.id },
          data: { reuseOfScanId: alias.id },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.reviewSkillScan.update({
          where: { id: job.id },
          data: {
            report: {
              verdict: "clear",
              findings: [{ explanation: "Changed" }],
            },
          },
        }),
      ).rejects.toThrow();
      const original = await prisma.reviewSkillScan.findUniqueOrThrow({
        where: { id: alias.id },
      });
      await expect(
        prisma.reviewSkillScan.create({
          data: {
            ...original,
            profile: original.profile as Prisma.InputJsonValue,
            report: Prisma.DbNull,
            id: randomUUID(),
            operationId: randomUUID(),
            reuseOfScanId: alias.id,
          },
        }),
      ).rejects.toThrow();
    });
    it("prunes expired request receipts before physical evidence while keeping the imported skill", async () => {
      const who = await actor(),
        c = await candidate(who),
        job = await request(who, c.id),
        alias = await request(who, c.id);
      await complete(job.id);
      const imported = await store.importCandidate({
        ...who,
        candidateId: c.id,
        scanId: alias.id,
        mode: "static",
        profile: scanProfile(),
        acknowledgeWarnings: false,
        acknowledgeOmissions: false,
      });
      // Historical fixture dates; runtime principals cannot mutate expiry.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role=replica",
        );
        await tx.$executeRaw`UPDATE "ReviewSkillImportCandidate" SET "createdAt"=clock_timestamp()-INTERVAL '10 days',"expiresAt"=clock_timestamp()-INTERVAL '9 days' WHERE "id"=${c.id}`;
        await tx.$executeRaw`UPDATE "ReviewSkillScan" SET "createdAt"=clock_timestamp()-INTERVAL '10 days',"expiresAt"=clock_timestamp()-INTERVAL '9 days' WHERE "candidateId"=${c.id}`;
      });
      await store.pruneExpired({ limit: 1 });
      expect(
        await prisma.reviewSkillScan.count({ where: { candidateId: c.id } }),
      ).toBe(1);
      expect(
        await prisma.reviewSkillImportCandidate.count({ where: { id: c.id } }),
      ).toBe(1);
      await store.pruneExpired({ limit: 1 });
      expect(
        await prisma.reviewSkillScan.count({ where: { candidateId: c.id } }),
      ).toBe(0);
      expect(
        await prisma.reviewSkillImportCandidate.count({ where: { id: c.id } }),
      ).toBe(0);
      expect(
        await prisma.reviewSkill.count({ where: { id: imported.skillId } }),
      ).toBe(1);
    });
    it("uses a transaction-safe outbox replay and detects payload conflicts without aborting exact retries", async () => {
      const idempotencyKey = `${prefix}:outbox-replay`,
        event = {
          type: "catalog.fixture",
          version: 1,
          idempotencyKey,
          payload: { one: 1, two: 2 },
          occurredAt: new Date(),
        };
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        expect(await writePrismaOutboxEvent(tx, event)).toEqual({
          created: true,
        });
        expect(
          await writePrismaOutboxEvent(tx, {
            ...event,
            payload: { two: 2, one: 1 },
          }),
        ).toEqual({ created: false });
        expect(await tx.$queryRaw`SELECT 1 AS alive`).toEqual([{ alive: 1 }]);
      });
      await expect(
        prisma.$transaction((tx) =>
          writePrismaOutboxEvent(tx, { ...event, payload: { one: 2, two: 2 } }),
        ),
      ).rejects.toThrow("outbox_idempotency_conflict");
    });
  },
);
