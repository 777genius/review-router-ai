import { createHash, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reviewSkillsRuntimeGrantStatements,
  reviewSkillsRuntimeGateStatements,
  reviewSkillsRuntimeTables,
} from "./review-skills-runtime-grants.js";
import { skillCatalogRuntimeTables } from "./skill-catalog-runtime-grants.js";
import { activationAuthorityProvisioningSql } from "./run-codex-rotating-release-migration.mjs";
import { claimReviewSkillsPostgresFixture } from "../packages/features/review-skills/src/tests/postgres-fixture.js";
import { PrismaReviewSkillsCatalogStore } from "../packages/features/review-skills/src/infrastructure/prisma/prisma-review-skills-catalog-store.js";
import { PortableSkillImportNormalizer } from "../packages/features/review-skills/src/infrastructure/serialization/portable-skill-import-normalizer.js";
import { scanProfile } from "../packages/features/review-skills/src/tests/skill-catalog-fixtures.js";
import { writePrismaOutboxEvent } from "../packages/features/outbox/src/infrastructure/prisma/write-prisma-outbox-event.js";
import {
  PrismaRateLimitStore,
  assertRateLimit,
} from "../packages/features/rate-limits/src/index.js";

const url = process.env.REVIEW_SKILLS_TEST_DATABASE_URL;
if (!url && process.env.REVIEW_SKILLS_REQUIRE_PG === "1")
  throw new Error("review_skills_required_postgresql_missing");
describe.skipIf(!url)("Skills catalog actual runtime roles", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 12),
    workspaceId = `catalog-acl-${tag}`,
    actor = { userId: `catalog-acl-${tag}-user` };
  const roles = ["web", "worker", "api"].map((role) => ({
    role,
    username: `rr_catalog_${tag}_${role}`,
    password: randomUUID(),
  }));
  let owner: Client,
    fixture: PrismaClient,
    web: PrismaClient,
    worker: PrismaClient,
    api: PrismaClient,
    webStore: PrismaReviewSkillsCatalogStore,
    workerStore: PrismaReviewSkillsCatalogStore;
  let candidateId: string, scanId: string;
  beforeAll(async () => {
    owner = await claimReviewSkillsPostgresFixture(url!);
    fixture = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    for (const r of roles) {
      await owner.query(
        `CREATE ROLE "${r.username}" LOGIN PASSWORD '${r.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      );
      await owner.query(
        `GRANT CONNECT ON DATABASE "${new URL(url!).pathname.slice(1)}" TO "${r.username}"`,
      );
      await owner.query(`GRANT USAGE ON SCHEMA public TO "${r.username}"`);
      for (const table of skillCatalogRuntimeTables)
        await owner.query(
          `GRANT SELECT,INSERT,UPDATE,DELETE ON "${table}" TO "${r.username}"`,
        );
    }
    await owner.query(
      `GRANT UPDATE("canonicalText") ON "ReviewSkillImportCandidate" TO "${roles[1]!.username}"`,
    );
    await owner.query(reviewSkillsRuntimeGrantStatements(roles));
    for (const r of roles.filter((r) => r.role !== "api")) {
      await owner.query(
        `GRANT SELECT ON "Workspace","WorkspaceMember","User" TO "${r.username}"`,
      );
      await owner.query(
        `GRANT UPDATE("updatedAt") ON "Workspace" TO "${r.username}"`,
      );
      await owner.query(
        `GRANT UPDATE("userId") ON "WorkspaceMember" TO "${r.username}"`,
      );
    }
    await owner.query(
      `GRANT INSERT ON "AuditEvent" TO "${roles[0]!.username}"`,
    );
    await owner.query(
      `GRANT SELECT ON "RepositoryConnection" TO "${roles[0]!.username}"`,
    );
    await owner.query(
      `GRANT SELECT,INSERT,UPDATE ON "RateLimitBucket","OutboxEvent" TO "${roles[0]!.username}"`,
    );
    const clients = roles.map((role) => {
      const u = new URL(url!);
      u.username = role.username;
      u.password = role.password;
      return new PrismaClient({
        adapter: new PrismaPg({ connectionString: u.toString() }),
      });
    });
    [web, worker, api] = clients as [PrismaClient, PrismaClient, PrismaClient];
    for (let i = 0; i < clients.length; i++)
      expect(
        (
          await clients[i]!.$queryRaw<
            { current_user: string; rolsuper: boolean }[]
          >`SELECT current_user,rolsuper FROM pg_roles WHERE rolname=current_user`
        )[0],
      ).toEqual({ current_user: roles[i]!.username, rolsuper: false });
    await fixture.user.create({ data: { id: actor.userId } });
    await fixture.workspace.create({
      data: {
        id: workspaceId,
        slug: workspaceId,
        name: "Catalog ACL fixture",
        members: { create: { userId: actor.userId, role: "owner" } },
      },
    });
    webStore = new PrismaReviewSkillsCatalogStore(web, {
      admit: async (tx, input) => {
        await assertRateLimit(
          { key: `catalog-acl:${tag}`, limit: 5, windowMs: 3600000 },
          {
            rateLimits: new PrismaRateLimitStore(tx),
            clock: { now: () => input.now },
          },
        );
      },
      enqueue: async (tx, input) => {
        await writePrismaOutboxEvent(tx, {
          type: "catalog.acl",
          version: 1,
          idempotencyKey: `catalog-acl:${tag}:${input.jobId}`,
          workspaceId,
          payload: { jobId: input.jobId },
          occurredAt: input.now,
        });
      },
    });
    workerStore = new PrismaReviewSkillsCatalogStore(worker);
  });
  afterAll(async () => {
    await Promise.all([
      web?.$disconnect(),
      worker?.$disconnect(),
      api?.$disconnect(),
    ]);
    if (fixture) {
      await fixture.reviewSkillScan.deleteMany({
        where: { workspaceId, reuseOfScanId: { not: null } },
      });
      await fixture.reviewSkillScan.deleteMany({ where: { workspaceId } });
      await fixture.reviewSkillImportCandidate.deleteMany({
        where: { workspaceId },
      });
      await fixture.$disconnect();
    }
    for (const role of roles) {
      await owner?.query(`DROP OWNED BY "${role.username}"`);
      await owner?.query(`DROP ROLE "${role.username}"`);
    }
    await owner?.end();
  });
  it("runs stage→admit→claim→report→import using the actual narrow web and worker grants", async () => {
    const raw =
        "---\nname: catalog-acl\ndescription: Review code\n---\nReview the code carefully.",
      normalized = await new PortableSkillImportNormalizer().normalize(raw);
    const candidate = await webStore.stage({
      actor,
      workspaceId,
      resolved: {
        status: "resolved",
        source: {
          repository: "fixture/skills",
          commit: "a".repeat(40),
          path: "",
        },
        rawContent: raw,
        rawDigest: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
        hasResources: false,
      },
      normalized,
    });
    candidateId = candidate.id;
    const scan = await webStore.requestScan({
      actor,
      workspaceId,
      candidateId,
      operationId: randomUUID(),
      mode: "static",
      profile: scanProfile(),
    });
    scanId = scan.id;
    const claim = {
      jobId: scanId,
      claimId: `acl-${tag}`,
      claimVersion: 1n,
      claimUntil: new Date(Date.now() + 240000),
    };
    expect((await workerStore.beginScan(claim, [scanProfile()])).status).toBe(
      "started",
    );
    expect(
      await workerStore.finishScan({
        ...claim,
        report: { verdict: "clear", findings: [] },
        confirmedExit: true,
      }),
    ).toBe(true);
    const imported = await webStore.importCandidate({
      actor,
      workspaceId,
      candidateId,
      scanId,
      mode: "static",
      profile: scanProfile(),
      acknowledgeWarnings: false,
      acknowledgeOmissions: false,
    });
    expect(imported.instructions).toBe(candidate.content.instructions);
    await expect(
      worker.$queryRaw`SELECT "id" FROM "ReviewSkill" LIMIT 1`,
    ).rejects.toThrow();
    await expect(
      worker.$executeRaw`UPDATE "ReviewSkillImportCandidate" SET "instructions"='changed' WHERE "id"=${candidateId}`,
    ).rejects.toThrow();
    await expect(
      web.$executeRaw`UPDATE "ReviewSkillScan" SET "report"='{}'::jsonb WHERE "id"=${scanId}`,
    ).rejects.toThrow();
    await expect(
      web.$executeRaw`DELETE FROM "ReviewSkillImportCandidate" WHERE "id"=${candidateId}`,
    ).rejects.toThrow();
    await expect(
      api.$queryRaw`SELECT "id" FROM "ReviewSkillScan" LIMIT 1`,
    ).rejects.toThrow();
    const permissions = await owner.query(
      "SELECT has_table_privilege($1,'\"ReviewSkillScan\"','INSERT') AS worker_insert,has_column_privilege($1,'\"ReviewSkillImportCandidate\"','canonicalText','UPDATE') AS worker_content",
      [roles[1]!.username],
    );
    expect(permissions.rows[0]).toEqual({
      worker_insert: false,
      worker_content: false,
    });
  });
  it("refuses forged initial reports, execution state and import receipts through the actual web INSERT grant", async () => {
    const original = await web.reviewSkillScan.findUniqueOrThrow({
      where: { id: scanId },
    });
    const initial = {
      ...original,
      profile: original.profile as Prisma.InputJsonValue,
      status: "queued",
      report: Prisma.DbNull,
      startedAt: null,
      completedAt: null,
      claimId: null,
      claimVersion: null,
      claimUntil: null,
      executionDeadlineAt: null,
      slotUntil: null,
    };
    const forgeries: Partial<Prisma.ReviewSkillScanUncheckedCreateInput>[] = [
      {
        status: "completed",
        report: { verdict: "clear", findings: [] },
        completedAt: new Date(),
      },
      { status: "incomplete" },
      { report: { verdict: "clear", findings: [] } },
      { claimId: "forged-claim" },
      { startedAt: new Date() },
    ];
    for (const forged of forgeries) {
      await expect(
        web.reviewSkillScan.create({
          data: {
            ...initial,
            ...forged,
            id: randomUUID(),
            operationId: randomUUID(),
          },
        }),
      ).rejects.toThrow("skill_scan_initial_state_invalid");
    }
    const importedCandidate =
      await web.reviewSkillImportCandidate.findUniqueOrThrow({
        where: { id: candidateId },
      });
    expect(importedCandidate.importedSkillId).not.toBeNull();
    await expect(
      web.reviewSkillImportCandidate.create({
        data: {
          ...importedCandidate,
          id: randomUUID(),
          omittedFields:
            importedCandidate.omittedFields as Prisma.InputJsonValue,
        },
      }),
    ).rejects.toThrow("skill_catalog_initial_receipt_invalid");
  });
  it("the actual activation verifier accepts all narrow Skills grants and rejects widened table, column or function grants", async () => {
    // Exercise the shipped verifier predicates against the eight Skills tables
    // and the one bounded repository-lock function only;
    // unrelated deployment ACLs are outside this disposable feature fixture.
    const full = activationAuthorityProvisioningSql();
    const start = full.indexOf(
      "  WITH runtime_roles(role_name, role_kind) AS (VALUES",
    );
    const tables = full.indexOf("), tables AS (", start);
    const select = full.indexOf("    SELECT jsonb_build_object(", tables);
    const tableGuard = full.indexOf(
      "OR EXISTS (SELECT 1 FROM table_facts WHERE",
      select,
    );
    const columnGuard = full.indexOf(
      "OR EXISTS (\n         SELECT 1 FROM column_facts",
      tableGuard,
    );
    const nextGuard = full.indexOf(
      "OR EXISTS (SELECT 1 FROM sequence_facts",
      columnGuard,
    );
    const functionGuard = full.indexOf(
      "OR EXISTS (SELECT 1 FROM function_facts WHERE",
      nextGuard,
    );
    const afterFunctionGuard = full.indexOf(
      "OR has_database_privilege('public'",
      functionGuard,
    );
    expect(
      [
        start,
        tables,
        select,
        tableGuard,
        columnGuard,
        nextGuard,
        functionGuard,
        afterFunctionGuard,
      ].every((i) => i >= 0),
    ).toBe(true);
    const roleValues = roles
      .map((role, index) => `($${index + 1}::text,'${role.role}'::text)`)
      .join(",");
    const tableNames = [
      ...reviewSkillsRuntimeTables,
      ...skillCatalogRuntimeTables,
    ]
      .map((name) => `'${name}'`)
      .join(",");
    const ctes =
      `WITH runtime_roles(role_name,role_kind) AS (VALUES ${roleValues}${full.slice(tables, select)}`
        .replace(
          "WHERE namespace.nspname='public' AND relation.relkind IN ('r','p','v','m','f')",
          `WHERE namespace.nspname='public' AND relation.relkind IN ('r','p','v','m','f') AND relation.relname IN (${tableNames})`,
        )
        .replace(
          "WHERE namespace.nspname='public'\n    ), table_facts AS (",
          "WHERE namespace.nspname='public' AND routine.proname='rr_review_skills_repository_lock'\n    ), table_facts AS (",
        );
    const predicate =
      full.slice(tableGuard, columnGuard).replace(/^OR /, "") +
      full.slice(columnGuard, nextGuard) +
      full.slice(functionGuard, afterFunctionGuard);
    const valid = async () =>
      (
        await owner.query(
          `${ctes}SELECT NOT (${predicate}) AS valid`,
          roles.map((role) => role.username),
        )
      ).rows[0].valid;
    expect(await valid()).toBe(true);
    for (const statement of [
      `GRANT SELECT ON "ReviewSkillScan" TO "${roles[2]!.username}"`,
      `GRANT UPDATE ON "ReviewSkillScan" TO "${roles[0]!.username}"`,
      `GRANT UPDATE("canonicalText") ON "ReviewSkillImportCandidate" TO "${roles[1]!.username}"`,
      `GRANT SELECT ON "ReviewSkill" TO "${roles[1]!.username}"`,
      `GRANT INSERT ON "ReviewSkillRevision" TO "${roles[2]!.username}"`,
      `GRANT UPDATE("createOperationId") ON "ReviewSkill" TO "${roles[0]!.username}"`,
      `GRANT DELETE ON "ReviewSkill" TO "${roles[0]!.username}"`,
      `GRANT EXECUTE ON FUNCTION public.rr_review_skills_repository_lock(text,text[]) TO "${roles[2]!.username}"`,
    ]) {
      await owner.query("BEGIN");
      try {
        await owner.query(statement);
        expect(await valid()).toBe(false);
      } finally {
        await owner.query("ROLLBACK");
      }
    }
  });
  it("closed runtime gate removes both table and column mutation authority", async () => {
    await owner.query(reviewSkillsRuntimeGateStatements(roles));
    await expect(
      worker.$executeRaw`UPDATE "ReviewSkillScan" SET "status"='incomplete' WHERE "id"=${scanId}`,
    ).rejects.toThrow();
    await expect(
      web.$executeRaw`UPDATE "ReviewSkillImportCandidate" SET "importedAt"=clock_timestamp() WHERE "id"=${candidateId}`,
    ).rejects.toThrow();
    expect(
      (await webStore.loadCandidate({ actor, workspaceId, candidateId })).id,
    ).toBe(candidateId);
  });
});
