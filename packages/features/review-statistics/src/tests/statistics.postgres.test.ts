import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import {
  StatisticsAccessError,
  StatisticsCollisionError,
  StatisticsSeverity,
  StatisticsUncoveredSource,
  StatisticsValidationError,
} from "../domain/statistics";
import { ReviewStatisticsProjectionStatus } from "../application/ports";
import { PrismaReviewStatisticsReader } from "../infrastructure/prisma-statistics-reader";
import { PrismaReviewStatisticsProjector } from "../infrastructure/prisma-statistics-projector";
import {
  PrismaReviewStatisticsOutboxWriter,
  activateReviewStatisticsCapture,
} from "../infrastructure/prisma-statistics-outbox";
import { event } from "./fixture";
const adminUrl = process.env.STATISTICS_TEST_POSTGRES_ADMIN_URL;
describe.skipIf(!adminUrl)("review statistics real PostgreSQL", () => {
  const name = "TEST_statistics_" + randomUUID().replaceAll("-", "");
  let admin: PrismaClient,
    prisma: PrismaClient,
    projector: PrismaReviewStatisticsProjector,
    reader: PrismaReviewStatisticsReader;
  const writer = new PrismaReviewStatisticsOutboxWriter(),
    now = new Date("2026-10-23T12:00:00.000Z");
  let created = false;
  const queries: { query: string; params: string }[] = [];
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error("disposable_loopback_database_required");
    admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: adminUrl! }),
    });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = "/" + name;
    const loggedPrisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString(), max: 8 }),
      log: [{ emit: "event", level: "query" }],
    });
    loggedPrisma.$on("query", (event) =>
      queries.push({ query: event.query, params: event.params }),
    );
    prisma = loggedPrisma;
    const statements = [
      `CREATE TYPE "ReviewMutationModeV2" AS ENUM ('v1_open','v1_draining','v2_active','paused')`,
      `CREATE TYPE "WorkflowProvisioningStatus" AS ENUM ('not_started','setup_pr_open','configured','failed')`,
      `CREATE TABLE "Workspace"("id" text PRIMARY KEY,"personalOwnerUserId" text,"deletionState" text NOT NULL DEFAULT 'active',"createdAt" timestamp(3) NOT NULL)`,
      `CREATE TABLE "WorkspaceMember"("workspaceId" text,"userId" text,PRIMARY KEY("workspaceId","userId"))`,
      `CREATE TABLE "RepositoryConnection"("id" text PRIMARY KEY,"workspaceId" text REFERENCES "Workspace"("id") ON DELETE CASCADE,"scmRepositoryIdentityId" text,"provider" text DEFAULT 'github',"sourceBaseUrl" text DEFAULT 'https://github.com',"externalRepositoryId" text NOT NULL DEFAULT 'repo-external',"fullName" text NOT NULL,"selected" boolean DEFAULT true,"archived" boolean DEFAULT false,UNIQUE("id","workspaceId"))`,
      `CREATE TABLE "ScmRepositoryIdentity"("scmRepositoryIdentityId" text PRIMARY KEY,"currentWorkspaceId" text,"currentRepositoryConnectionId" text,"provider" text DEFAULT 'github',"normalizedSourceBaseUrl" text DEFAULT 'https://github.com',"externalRepositoryId" text NOT NULL DEFAULT 'repo-external')`,
      `CREATE TABLE "ReviewMutationAuthority"("scmRepositoryIdentityId" text,"laneKind" text,"mode" "ReviewMutationModeV2","activatedAt" timestamp(3))`,
      `CREATE TABLE "HostedCodexRepositoryBinding"("id" text,"workspaceId" text,"repositoryConnectionId" text,"status" text)`,
      `CREATE TABLE "WorkflowProvisioning"("repositoryId" text,"workspaceId" text,"status" "WorkflowProvisioningStatus","workflowPath" text)`,
      `CREATE TABLE "OutboxEvent"("id" text PRIMARY KEY,"type" text,"version" integer,"idempotencyKey" text UNIQUE,"workspaceId" text,"repositoryId" text,"aggregateId" text,"payload" jsonb,"status" text,"attempts" integer,"maxAttempts" integer,"occurredAt" timestamp(3),"createdAt" timestamp(3),"updatedAt" timestamp(3))`,
      `CREATE TABLE "TestCompletion"("id" text PRIMARY KEY,"state" text)`,
    ];
    for (const sql of statements) await prisma.$executeRawUnsafe(sql);
    const migration = await readFile(
      new URL(
        "../../../../platform/db/prisma/migrations/000144_review_statistics/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    for (const sql of migration
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await prisma.$executeRawUnsafe(sql);
    projector = new PrismaReviewStatisticsProjector(prisma);
    reader = new PrismaReviewStatisticsReader(prisma, { now: () => now });
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    if (created)
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin?.$disconnect();
  });
  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM "Workspace"`;
    for (const table of [
      "WorkspaceMember",
      "ScmRepositoryIdentity",
      "ReviewMutationAuthority",
      "HostedCodexRepositoryBinding",
      "WorkflowProvisioning",
      "OutboxEvent",
      "ReviewStatisticsCoverage",
      "TestCompletion",
    ])
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}"`);
    await prisma.$executeRaw`INSERT INTO "Workspace" ("id","personalOwnerUserId","createdAt") VALUES ('work',NULL,'2026-01-01'),('other',NULL,'2026-01-01'),('personal','owner','2026-01-01')`;
    await prisma.$executeRaw`INSERT INTO "WorkspaceMember" VALUES ('work','member'),('other','other-member'),('personal','intruder')`;
    await prisma.$executeRaw`INSERT INTO "RepositoryConnection" ("id","workspaceId","scmRepositoryIdentityId","fullName") VALUES ('repo','work','scm','org/repo'),('other-repo','other','other-scm','secret/repo')`;
    await prisma.$executeRaw`INSERT INTO "ScmRepositoryIdentity" ("scmRepositoryIdentityId","currentWorkspaceId","currentRepositoryConnectionId") VALUES ('scm','work','repo'),('other-scm','other','other-repo')`;
    await prisma.$executeRaw`INSERT INTO "ReviewMutationAuthority" VALUES ('scm','hosted_reviewrouter_app','v2_active','2026-01-01'),('other-scm','hosted_reviewrouter_app','v2_active','2026-01-01')`;
    await prisma.$executeRaw`INSERT INTO "WorkflowProvisioning" VALUES ('repo','work','configured','.github/workflows/reviewrouter-review.yml'),('other-repo','other','configured','.github/workflows/reviewrouter-review.yml')`;
    await prisma.$executeRaw`INSERT INTO "ReviewStatisticsCoverage" VALUES ('capture_v1','2026-01-01')`;
  });
  it("commits one immutable review and lineage under concurrent delivery and preserves earliest metadata", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => projector.project(event())),
    );
    expect(
      results.filter((r) => r === ReviewStatisticsProjectionStatus.Applied),
    ).toHaveLength(1);
    await projector.project(
      event({
        executionId: "earlier",
        settledAt: "2026-10-22T11:00:00.000Z",
        issues: [
          {
            lineageId: "lineage",
            severity: StatisticsSeverity.Minor,
            title: "Earlier title",
          },
        ],
      }),
    );
    await expect(
      projector.project(event({ publicationAttemptId: "collision" })),
    ).rejects.toThrow(StatisticsCollisionError);
    const report = await reader.readReport({
      actorId: "member",
      workspaceId: "work",
      filter: { days: 7, severity: "all" },
    });
    expect(report.totals).toEqual({
      reviews: 2,
      pullRequestsReviewed: 1,
      issuesCaught: 1,
      repositoriesWithIssues: 1,
    });
    expect(report.daily.reduce((n, d) => n + d.pullRequestsReviewed, 0)).toBe(
      2,
    );
    const issues = await reader.readIssues({
      actorId: "member",
      workspaceId: "work",
      from: report.period.from,
      to: report.period.to,
      severity: "all",
    });
    expect(issues.items[0]).toMatchObject({
      scmRepositoryIdentityId: "scm",
      title: "Earlier title",
      severity: "minor",
      caughtAt: "2026-10-22T11:00:00.000Z",
    });
  });
  it("counts empty successes and real reruns, excludes the upper UTC boundary, and needs no operational evidence", async () => {
    await projector.project(
      event({
        executionId: "empty",
        settledAt: "2026-10-17T00:00:00.000Z",
        issues: [],
      }),
    );
    await projector.project(
      event({
        executionId: "rerun",
        settledAt: "2026-10-18T00:00:00.000Z",
        issues: [],
      }),
    );
    await projector.project(
      event({
        executionId: "outside",
        settledAt: now.toISOString(),
        issues: [],
      }),
    );
    // This database has no operational execution, artifact or snapshot tables.
    const report = await reader.readReport({
      actorId: "member",
      workspaceId: "work",
      filter: { days: 7, severity: "all" },
    });
    expect(report.totals).toEqual({
      reviews: 2,
      pullRequestsReviewed: 1,
      issuesCaught: 0,
      repositoriesWithIssues: 0,
    });
    expect(report.daily[0]?.reviews).toBe(1);
    expect(report.daily[1]?.reviews).toBe(1);
    expect(report.daily[6]?.reviews).toBe(0);
    expect(report.previousTotals?.reviews).toBe(0);
    await prisma.$executeRaw`UPDATE "Workspace" SET "deletionState"='deleting' WHERE "id"='work'`;
    await expect(
      reader.readReport({
        actorId: "member",
        workspaceId: "work",
        filter: { days: 7, severity: "all" },
      }),
    ).rejects.toThrow(StatisticsAccessError);
  });
  it("uses the execution ID tie-breaker for earliest metadata independently of delivery order", async () => {
    await projector.project(
      event({
        executionId: "z-execution",
        issues: [
          {
            lineageId: "lineage",
            title: "Later tuple",
            severity: StatisticsSeverity.Major,
          },
        ],
      }),
    );
    await projector.project(
      event({
        executionId: "a-execution",
        issues: [
          {
            lineageId: "lineage",
            title: "Earlier tuple",
            severity: StatisticsSeverity.Unknown,
          },
        ],
      }),
    );
    const issue = await reader.readIssues({
      actorId: "member",
      workspaceId: "work",
      from: "2026-10-17T00:00:00.000Z",
      to: now.toISOString(),
      severity: "all",
    });
    expect(issue.items[0]?.title).toBe("Earlier tuple");
    expect(issue.items[0]?.severity).toBe("unknown");
  });
  it("keeps tenant scope and owner-only personal authorization, and rechecks revocation", async () => {
    await projector.project(event());
    for (const [actorId, workspaceId] of [
      ["member", "other"],
      ["intruder", "personal"],
    ])
      await expect(
        reader.readReport({
          actorId: actorId!,
          workspaceId: workspaceId!,
          filter: { days: 7, severity: "all" },
        }),
      ).rejects.toThrow(StatisticsAccessError);
    expect(
      (
        await reader.readReport({
          actorId: "owner",
          workspaceId: "personal",
          filter: { days: 7, severity: "all" },
        })
      ).totals.reviews,
    ).toBe(0);
    await prisma.$executeRaw`DELETE FROM "WorkspaceMember" WHERE "userId"='member'`;
    await expect(
      reader.readIssues({
        actorId: "member",
        workspaceId: "work",
        from: "2026-10-17T00:00:00.000Z",
        to: now.toISOString(),
        severity: "all",
      }),
    ).rejects.toThrow(StatisticsAccessError);
  });
  it("rolls back capture with its owner's transaction, deduplicates content and activates only once", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "TestCompletion" VALUES ('one','completed')`;
        await writer.write(tx, event());
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.$queryRaw`SELECT * FROM "OutboxEvent"`).toEqual([]);
    expect(await prisma.$queryRaw`SELECT * FROM "TestCompletion"`).toEqual([]);
    await prisma.$transaction(async (tx) => {
      await writer.write(tx, event());
      await writer.write(tx, event());
    });
    expect(
      await prisma.$queryRaw<unknown[]>`SELECT * FROM "OutboxEvent"`,
    ).toHaveLength(1);
    await expect(
      prisma.$transaction((tx) =>
        writer.write(tx, event({ projectionHash: "b".repeat(64) })),
      ),
    ).rejects.toThrow(StatisticsCollisionError);
    await prisma.$executeRaw`DELETE FROM "ReviewStatisticsCoverage"`;
    await expect(
      prisma.$transaction((tx) =>
        writer.write(tx, event({ executionId: "not-active" })),
      ),
    ).rejects.toThrow("statistics_capture_not_activated");
    const first = await activateReviewStatisticsCapture(prisma);
    expect(await activateReviewStatisticsCapture(prisma)).toEqual(first);
  });
  it("does not resurrect deleted connection history or resolve delayed events through a replacement", async () => {
    await projector.project(event());
    await prisma.$executeRaw`DELETE FROM "RepositoryConnection" WHERE "id"='repo'`;
    expect(
      await prisma.$queryRaw<
        unknown[]
      >`SELECT * FROM "ReviewStatisticsReviewFact"`,
    ).toHaveLength(0);
    expect(
      await prisma.$queryRaw<
        unknown[]
      >`SELECT * FROM "ReviewStatisticsIssueFact"`,
    ).toHaveLength(0);
    await prisma.$executeRaw`INSERT INTO "RepositoryConnection" ("id","workspaceId","scmRepositoryIdentityId","fullName") VALUES ('replacement','other','scm','moved/repo')`;
    expect(await projector.project(event({ executionId: "delayed" }))).toBe(
      ReviewStatisticsProjectionStatus.DeletedRepository,
    );
    expect(
      (
        await reader.readReport({
          actorId: "other-member",
          workspaceId: "other",
          filter: { days: 7, severity: "all" },
        })
      ).totals.reviews,
    ).toBe(0);
  });
  it("rejects a different nonnull SCM binding without writing facts", async () => {
    await prisma.$executeRaw`UPDATE "RepositoryConnection" SET "scmRepositoryIdentityId"='replacement-scm' WHERE "id"='repo'`;
    await expect(projector.project(event())).rejects.toThrow(
      StatisticsCollisionError,
    );
    expect(
      await prisma.$queryRaw`SELECT * FROM "ReviewStatisticsReviewFact"`,
    ).toEqual([]);
    expect(
      await prisma.$queryRaw`SELECT * FROM "ReviewStatisticsIssueFact"`,
    ).toEqual([]);
  });
  it("drains accepted settlement after normal unbind using durable original identity", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "ScmRepositoryIdentity" SET "currentWorkspaceId"=NULL,"currentRepositoryConnectionId"=NULL WHERE "scmRepositoryIdentityId"='scm'`;
      await tx.$executeRaw`UPDATE "RepositoryConnection" SET "scmRepositoryIdentityId"=NULL,"fullName"='org/renamed',"sourceBaseUrl"='https://GITHUB.com///' WHERE "id"='repo'`;
    });
    expect(await projector.project(event())).toBe(
      ReviewStatisticsProjectionStatus.Applied,
    );
    expect(await projector.project(event())).toBe(
      ReviewStatisticsProjectionStatus.Duplicate,
    );
    const report = await reader.readReport({
      actorId: "member",
      workspaceId: "work",
      filter: { days: 7, severity: "all" },
    });
    expect(report.totals).toMatchObject({ reviews: 1, issuesCaught: 1 });
    expect(report.topRepositoriesByReviews[0]?.fullName).toBe("org/renamed");
    expect(report.topRepositoriesByReviews[0]?.url).toBe(
      "https://github.com/org/renamed",
    );
    expect(report.coverage.currentComplete).toBe(false);
    const issues = await reader.readIssues({
      actorId: "member",
      workspaceId: "work",
      from: report.period.from,
      to: report.period.to,
      severity: "all",
    });
    expect(issues.items[0]).toMatchObject({
      repositoryId: "repo",
      scmRepositoryIdentityId: "scm",
    });
    // An unbound connection changed to another immutable SCM tuple is unsafe.
    await prisma.$executeRaw`UPDATE "RepositoryConnection" SET "externalRepositoryId"='other-external' WHERE "id"='repo'`;
    await expect(
      projector.project(event({ executionId: "wrong-target" })),
    ).rejects.toThrow(StatisticsCollisionError);
    expect(
      await prisma.$queryRaw<
        unknown[]
      >`SELECT * FROM "ReviewStatisticsReviewFact"`,
    ).toHaveLength(1);
  });
  it("keeps the earliest event's original connection across reordered reconnect delivery", async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "RepositoryConnection" SET "scmRepositoryIdentityId"=NULL WHERE "id"='repo'`;
      // The registry compares normalized URLs; a retained old connection is not
      // an instruction to follow the canonical identity's new current binding.
      await tx.$executeRaw`INSERT INTO "RepositoryConnection" ("id","workspaceId","scmRepositoryIdentityId","sourceBaseUrl","fullName") VALUES ('reconnected','work','scm','https://github.com/','org/reconnected')`;
      await tx.$executeRaw`UPDATE "ScmRepositoryIdentity" SET "currentRepositoryConnectionId"='reconnected' WHERE "scmRepositoryIdentityId"='scm'`;
    });
    const earlier = event({
        executionId: "earlier-original-review",
        settledAt: "2026-10-22T11:00:00.000Z",
        issues: [
          {
            lineageId: "lineage",
            severity: StatisticsSeverity.Major,
            title: "Original issue",
          },
        ],
      }),
      later = event({
        executionId: "newer-connection-review",
        repositoryConnectionId: "reconnected",
        issues: [
          {
            lineageId: "lineage",
            severity: StatisticsSeverity.Minor,
            title: "Later issue",
          },
        ],
      });
    for (const order of [
      [later, earlier],
      [earlier, later],
    ]) {
      await prisma.$executeRaw`DELETE FROM "ReviewStatisticsIssueFact"`;
      await prisma.$executeRaw`DELETE FROM "ReviewStatisticsReviewFact"`;
      for (const settlement of order) await projector.project(settlement);
      const rows = await prisma.$queryRaw<
        {
          repositoryConnectionId: string;
          sourceExecutionId: string;
          caughtAt: Date;
          title: string;
        }[]
      >`SELECT "repositoryConnectionId","sourceExecutionId","caughtAt","title" FROM "ReviewStatisticsIssueFact"`;
      expect(rows).toEqual([
        {
          repositoryConnectionId: "repo",
          sourceExecutionId: earlier.executionId,
          caughtAt: new Date(earlier.settledAt),
          title: "Original issue",
        },
      ]);
    }
    await prisma.$executeRaw`DELETE FROM "RepositoryConnection" WHERE "id"='reconnected'`;
    expect(
      await prisma.$queryRaw<
        unknown[]
      >`SELECT * FROM "ReviewStatisticsIssueFact"`,
    ).toHaveLength(1);
  });
  it("uses bounded severity/repository keyset pages and rejects mismatched cursors", async () => {
    await projector.project(
      event({
        issues: Array.from({ length: 31 }, (_, i) => ({
          lineageId: `issue-${i}`,
          severity:
            i === 30 ? StatisticsSeverity.Unknown : StatisticsSeverity.Major,
          title: `Issue ${i}`,
        })),
      }),
    );
    // Persisted IDs are bounded text; continuation must round-trip an opaque
    // schema-valid ID rather than assuming the projector's current hash format.
    await prisma.$executeRaw`UPDATE "ReviewStatisticsIssueFact" SET "id"='opaque-browser-issue-' || "id" WHERE "workspaceId"='work'`;
    const report = await reader.readReport({
      actorId: "member",
      workspaceId: "work",
      filter: { days: 7, severity: StatisticsSeverity.Major },
    });
    const input = {
      actorId: "member",
      workspaceId: "work",
      from: report.period.from,
      to: report.period.to,
      severity: StatisticsSeverity.Major,
    };
    const first = await reader.readIssues(input);
    expect(first.items).toHaveLength(25);
    expect(first.nextCursor).not.toBeNull();
    expect(
      first.items.every((issue) =>
        issue.id.startsWith("opaque-browser-issue-"),
      ),
    ).toBe(true);
    const second = await reader.readIssues({
      ...input,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(5);
    expect(
      new Set([...first.items, ...second.items].map((i) => i.id)).size,
    ).toBe(30);
    await expect(
      reader.readIssues({
        ...input,
        severity: "all",
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow(StatisticsValidationError);
    await expect(
      reader.readIssues({ ...input, repositoryId: "other-repo" }),
    ).rejects.toThrow(StatisticsValidationError);
    const validCursor = JSON.parse(
      Buffer.from(first.nextCursor!, "base64url").toString("utf8"),
    );
    for (const invalidId of ["", "\u0000", "x".repeat(257), 42]) {
      const cursor = Buffer.from(
        JSON.stringify({ ...validCursor, id: invalidId }),
      ).toString("base64url");
      await expect(reader.readIssues({ ...input, cursor })).rejects.toThrow(
        StatisticsValidationError,
      );
    }
    const invalidTimestamp = Buffer.from(
      JSON.stringify({
        ...validCursor,
        at: "2026-02-30T12:00:00.000Z",
      }),
    ).toString("base64url");
    await expect(
      reader.readIssues({ ...input, cursor: invalidTimestamp }),
    ).rejects.toThrow(StatisticsValidationError);
    expect(report.totals.issuesCaught).toBe(31);
    expect(report.topRepositoriesByIssues[0]?.count).toBe(30);
  });
  it("keeps known older-repository activity visible when a newer source activates", async () => {
    await projector.project(event({ settledAt: "2026-10-18T11:00:00.000Z" }));
    await prisma.$executeRaw`INSERT INTO "RepositoryConnection" ("id","workspaceId","scmRepositoryIdentityId","fullName") VALUES ('new-repo','work','new-scm','org/new-repo')`;
    await prisma.$executeRaw`INSERT INTO "ScmRepositoryIdentity" ("scmRepositoryIdentityId","currentWorkspaceId","currentRepositoryConnectionId") VALUES ('new-scm','work','new-repo')`;
    await prisma.$executeRaw`INSERT INTO "ReviewMutationAuthority" VALUES ('new-scm','hosted_reviewrouter_app','v2_active','2026-10-22T10:00:00.000Z')`;
    await prisma.$executeRaw`INSERT INTO "WorkflowProvisioning" VALUES ('new-repo','work','configured','.github/workflows/reviewrouter-review.yml')`;
    const report = await reader.readReport({
      actorId: "member",
      workspaceId: "work",
      filter: { days: 7, severity: "all" },
    });
    expect(report.coverage.availableSince).toBe("2026-01-01T00:00:00.000Z");
    expect(report.coverage.currentComplete).toBe(false);
    expect(report.previousTotals).toBeNull();
    expect(report.daily.find((day) => day.day === "2026-10-18")).toMatchObject({
      coverage: "partial",
      reviews: 1,
      issues: { major: 1 },
    });
    expect(report.daily.find((day) => day.day === "2026-10-23")?.coverage).toBe(
      "complete",
    );
  });
  it("distinguishes activation absence/boundary and unsupported sources even when counts are zero", async () => {
    await prisma.$executeRaw`UPDATE "ReviewStatisticsCoverage" SET "activatedAt"='2026-10-20T10:00:00.000Z'`;
    const read = () =>
      reader.readReport({
        actorId: "member",
        workspaceId: "work",
        filter: { days: 7, severity: "all" },
      });
    let report = await read();
    expect(report.previousTotals).toBeNull();
    expect(report.daily.find((d) => d.day === "2026-10-20")?.coverage).toBe(
      "partial",
    );
    expect(report.daily[0]?.coverage).toBe("unavailable");
    await prisma.$executeRaw`INSERT INTO "HostedCodexRepositoryBinding" VALUES ('hosted','work','repo','active')`;
    report = await read();
    expect(report.coverage.uncoveredSources).toContain(
      StatisticsUncoveredSource.HostedCertifiedFork,
    );
    // Selection/archive changes do not erase historical source uncertainty.
    await prisma.$executeRaw`UPDATE "RepositoryConnection" SET "selected"=false,"archived"=true WHERE "id"='repo'`;
    report = await read();
    expect(report.coverage.uncoveredSources).toContain(
      StatisticsUncoveredSource.HostedCertifiedFork,
    );
    expect(report.coverage.currentComplete).toBe(false);
    await prisma.$executeRaw`UPDATE "HostedCodexRepositoryBinding" SET "status"='tombstoned' WHERE "id"='hosted'`;
    report = await read();
    expect(report.coverage.uncoveredSources).toContain(
      StatisticsUncoveredSource.HostedCertifiedFork,
    );
    expect(report.coverage.previousComplete).toBe(false);

    await prisma.$executeRaw`DELETE FROM "ReviewStatisticsCoverage"`;
    report = await read();
    expect(report.coverage.availableSince).toBeNull();
    expect(report.daily.every((d) => d.coverage === "unavailable")).toBe(true);
  });
  it.skipIf(process.env.STATISTICS_TEST_VOLUME !== "1")(
    "qualifies exact reader SQL with 100000 reviews and 100000 issues plus unrelated tenant facts",
    async () => {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReviewStatisticsReviewFact" ("executionId","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","settledAt","payloadHash") SELECT 'volume-review-'||n,'work','repo','scm',n%1000+1,timestamp '2026-10-20 12:00:00'+(n%100)*interval '1 millisecond',repeat('a',64) FROM generate_series(1,100000) n`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReviewStatisticsIssueFact" ("id","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","lineageId","severity","title","caughtAt","sourceExecutionId") SELECT lpad(to_hex(n),64,'0'),'work','repo','scm',n%1000+1,'volume-lineage-'||n,(ARRAY['critical','major','minor','unknown'])[n%4+1],'Volume issue '||n,timestamp '2026-10-20 12:00:00'+(n%100)*interval '1 millisecond','volume-review-'||n FROM generate_series(1,100000) n`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReviewStatisticsReviewFact" ("executionId","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","settledAt","payloadHash") SELECT 'other-review-'||n,'other','other-repo','other-scm',n,timestamp '2026-10-20',repeat('b',64) FROM generate_series(1,1000) n`,
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ReviewStatisticsIssueFact" ("id","workspaceId","repositoryConnectionId","scmRepositoryIdentityId","pullRequestNumber","lineageId","severity","title","caughtAt","sourceExecutionId") SELECT lpad(to_hex(n+1000000),64,'0'),'other','other-repo','other-scm',n,'other-lineage-'||n,'major','Other issue',timestamp '2026-10-20','other-review-'||n FROM generate_series(1,1000) n`,
      );
      await prisma.$executeRawUnsafe(`ANALYZE "ReviewStatisticsReviewFact"`);
      await prisma.$executeRawUnsafe(`ANALYZE "ReviewStatisticsIssueFact"`);
      queries.length = 0;
      const start = performance.now();
      const report = await reader.readReport({
        actorId: "member",
        workspaceId: "work",
        filter: { days: 7, severity: StatisticsSeverity.Major },
      });
      const reportMs = performance.now() - start;
      expect(report.totals).toEqual({
        reviews: 100000,
        pullRequestsReviewed: 1000,
        issuesCaught: 100000,
        repositoriesWithIssues: 1,
      });
      expect(report.topRepositoriesByIssues[0]?.count).toBe(25000);
      const issueInput = {
        actorId: "member",
        workspaceId: "work",
        from: report.period.from,
        to: report.period.to,
        severity: StatisticsSeverity.Major,
        repositoryId: "repo",
      };
      const pageStart = performance.now(),
        page = await reader.readIssues(issueInput),
        pageMs = performance.now() - pageStart;
      const nextStart = performance.now(),
        next = await reader.readIssues({
          ...issueInput,
          cursor: page.nextCursor!,
        }),
        continuationMs = performance.now() - nextStart;
      expect(page.items).toHaveLength(25);
      expect(next.items).toHaveLength(25);
      expect(
        new Set([...page.items, ...next.items].map((i) => i.id)).size,
      ).toBe(50);
      const exactQueries = queries.filter(
        (q) =>
          q.query.trimStart().startsWith("SELECT") &&
          /"ReviewStatistics(?:Review|Issue)Fact"/u.test(q.query),
      );
      const plans = [];
      for (const query of exactQueries) {
        const plan = await prisma.$queryRawUnsafe(
          "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query.query,
          ...JSON.parse(query.params),
        );
        plans.push({ ...query, plan });
      }
      await mkdir("tmp/statistics-e2e", { recursive: true });
      const result = {
        postgresVersion: (
          await prisma.$queryRawUnsafe<{ server_version: string }[]>(
            "SHOW server_version",
          )
        )[0]?.server_version,
        tenantReviews: 100000,
        tenantIssues: 100000,
        unrelatedTenantReviews: 1000,
        unrelatedTenantIssues: 1000,
        reportMs,
        pageMs,
        continuationMs,
        plans,
      };
      await writeFile(
        "tmp/statistics-e2e/data-volume.json",
        JSON.stringify(result, null, 2),
      );
      process.stdout.write(
        JSON.stringify({
          statisticsVolume: {
            reportMs,
            pageMs,
            continuationMs,
            exactPlans: plans.length,
          },
        }) + "\n",
      );
    },
    90000,
  );
});
