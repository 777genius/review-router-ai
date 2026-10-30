import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import type { ReviewPublicationDueWork } from "../application/ports/review-publication-work-feed-port";
import { PrismaReviewPublicationWorkFeed } from "../infrastructure/prisma/prisma-review-publication-work-feed";

const now = new Date("2026-10-30T12:00:00.000Z");
const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;

describe("publication feed input boundary", () => {
  it.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid limit %s without querying persistence",
    async (limit) => {
      const query = vi.fn();
      const feed = new PrismaReviewPublicationWorkFeed({
        $queryRaw: query,
      } as unknown as PrismaClient);
      await expect(feed.scan({ now, limit })).rejects.toThrow(
        "review_publication_work_limit_invalid",
      );
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("returns no work for zero without querying persistence", async () => {
    const query = vi.fn();
    const feed = new PrismaReviewPublicationWorkFeed({
      $queryRaw: query,
    } as unknown as PrismaClient);
    await expect(feed.scan({ now, limit: 0 })).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an invalid scan time without querying persistence", async () => {
    const query = vi.fn();
    const feed = new PrismaReviewPublicationWorkFeed({
      $queryRaw: query,
    } as unknown as PrismaClient);
    await expect(feed.scan({ now: new Date(NaN), limit: 1 })).rejects.toThrow(
      "review_publication_work_time_invalid",
    );
    expect(query).not.toHaveBeenCalled();
  });
});

// This UUID database contains only the three scalar scheduling tables. Its
// missing scope FK deliberately permits historical invalid rows to exercise
// defensive discovery; it is not evidence of a production insertion exploit.
// A separate case below executes the same adapter against the migrated schema.
describe.skipIf(!databaseUrl)("publication work feed on PostgreSQL", () => {
  const name = `TEST_publication_feed_${randomUUID().replaceAll("-", "")}`;
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let feed: PrismaReviewPublicationWorkFeed;
  let created = false;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      throw new Error("disposable_loopback_database_required");
    admin = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 2 });
    // The identifier is generated locally from a fixed prefix and UUID hex.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    prisma = createPrismaClient({ databaseUrl: url.toString(), poolMax: 4 });
    for (const statement of schema) await prisma.$executeRawUnsafe(statement);
    feed = new PrismaReviewPublicationWorkFeed(prisma);
  });

  beforeEach(async () => {
    // Only the test-owned, three-table database is cleared.
    await prisma.$executeRawUnsafe(
      'TRUNCATE "ReviewPublicationOperationV2", "ReviewPublicationAttemptV2", "RepositoryConnection"',
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}"`);
    await admin?.$disconnect();
  });

  it("finds eligible tail work behind more than four times the limit of expired attempts", async () => {
    const limit = 2;
    for (let index = 0; index < limit * 4 + 1; index += 1) {
      await seed(`expired-${index}`, {
        retainOffsetMs: -1,
        dueOffsetMs: -10_000,
      });
    }
    const first = await seed("tail-first", { dueOffsetMs: -2 });
    const second = await seed("tail-second", { dueOffsetMs: -1 });
    expect(await feed.scan({ now, limit })).toEqual([first, second]);
  });

  it("orders eligible work by required, due time, reconcile deadline and operation ID before limiting", async () => {
    const optional = await seed("optional", {
      required: false,
      dueOffsetMs: -10_000,
    });
    const later = await seed("later", { dueOffsetMs: -1 });
    const laterReconcile = await seed("later-reconcile", {
      dueOffsetMs: -2,
      reconcileOffsetMs: 2,
    });
    const lastTie = await seed("z-tie", {
      dueOffsetMs: -2,
      reconcileOffsetMs: 1,
    });
    const firstTie = await seed("a-tie", {
      dueOffsetMs: -2,
      reconcileOffsetMs: 1,
    });
    expect(await feed.scan({ now, limit: 3 })).toEqual([
      firstTie,
      lastTie,
      laterReconcile,
    ]);
    expect(await feed.scan({ now, limit: 10 })).toEqual([
      firstTie,
      lastTie,
      laterReconcile,
      later,
      optional,
    ]);
  });

  it("includes all existing live state combinations and excludes terminal work", async () => {
    const expected: ReviewPublicationDueWork[] = [];
    for (const attemptState of ["pending", "publishing", "reconciling"]) {
      for (const operationState of [
        "planned",
        "in_flight",
        "effect_observed",
        "reconciling",
      ]) {
        expected.push(
          await seed(`${attemptState}-${operationState}`, {
            attemptState,
            operationState,
          }),
        );
      }
    }
    await seed("terminal-attempt", { attemptState: "terminal" });
    await seed("terminal-operation", { operationState: "completed" });
    expect(await feed.scan({ now, limit: 100 })).toEqual(
      expected.sort((a, b) =>
        a.publicationOperationId.localeCompare(b.publicationOperationId),
      ),
    );
  });

  it("includes due equality, excludes retention equality, and keeps expired reconciliation windows discoverable", async () => {
    const due = await seed("due-now", {
      dueOffsetMs: 0,
      retainOffsetMs: 1,
      reconcileOffsetMs: -1,
    });
    await seed("not-due", { dueOffsetMs: 1 });
    await seed("retention-equal", { retainOffsetMs: 0 });
    expect(await feed.scan({ now, limit: 10 })).toEqual([due]);
  });

  it("filters mismatched workspace/SCM identity, missing repositories and unsupported providers before the limit", async () => {
    await seed("wrong-workspace", {
      mismatchWorkspace: true,
      dueOffsetMs: -10_000,
    });
    await seed("wrong-scm", { mismatchScm: true, dueOffsetMs: -10_000 });
    await seed("missing-repository", {
      missingRepository: true,
      dueOffsetMs: -10_000,
    });
    await seed("unsupported-provider", {
      provider: "future_provider",
      dueOffsetMs: -10_000,
    });
    const github = await seed("github", {
      provider: "github",
      dueOffsetMs: -2,
    });
    const gitlab = await seed("gitlab", {
      provider: "gitlab",
      dueOffsetMs: -1,
    });
    expect(await feed.scan({ now, limit: 2 })).toEqual([github, gitlab]);
  });

  it("preserves the maximum of 1000 returned rows", async () => {
    const work = await seed("cap");
    await prisma.$executeRaw`
      INSERT INTO "ReviewPublicationOperationV2"
        ("publicationOperationId", "publicationAttemptId", "state", "required", "nextEligibleAt", "reconcileUntil", "retryCount")
      SELECT 'cap-' || value, ${work.publicationAttemptId}, 'planned'::"ReviewPublicationOperationStateV2", true, ${now}, ${now}, 0
      FROM generate_series(1, 1000) value
    `;
    expect(await feed.scan({ now, limit: 10_000 })).toHaveLength(1_000);
  });

  it("durably defers one retry with CAS despite competing workers", async () => {
    const work = await seed("retry");
    const firstDate = new Date(now.getTime() + 1_000);
    const secondDate = new Date(now.getTime() + 2_000);
    await Promise.all([
      feed.defer({
        work,
        nextEligibleAt: firstDate,
        lastErrorCode: "first'quoted",
      }),
      feed.defer({ work, nextEligibleAt: secondDate, lastErrorCode: "second" }),
    ]);
    const [row] = await readRetry(work);
    expect(row?.retryCount).toBe(1);
    expect([
      { nextEligibleAt: firstDate, lastErrorCode: "first'quoted" },
      { nextEligibleAt: secondDate, lastErrorCode: "second" },
    ]).toContainEqual({
      nextEligibleAt: row?.nextEligibleAt,
      lastErrorCode: row?.lastErrorCode,
    });
    await feed.defer({ work, nextEligibleAt: now, lastErrorCode: "stale" });
    expect(await readRetry(work)).toEqual([row]);
    expect(await feed.scan({ now, limit: 1 })).toEqual([]);
    expect(
      await feed.scan({ now: new Date(now.getTime() + 2_000), limit: 1 }),
    ).toEqual([{ ...work, retryCount: 1 }]);
  });

  it("does not defer the wrong attempt or a terminal operation", async () => {
    const work = await seed("cas-negative");
    const original = await readRetry(work);
    await feed.defer({
      work: { ...work, publicationAttemptId: "wrong-attempt" },
      nextEligibleAt: new Date(now.getTime() + 1_000),
      lastErrorCode: "wrong-attempt",
    });
    expect(await readRetry(work)).toEqual(original);
    await prisma.$executeRaw`UPDATE "ReviewPublicationOperationV2" SET "state" = 'completed' WHERE "publicationOperationId" = ${work.publicationOperationId}`;
    await feed.defer({
      work,
      nextEligibleAt: new Date(now.getTime() + 1_000),
      lastErrorCode: "terminal",
    });
    expect(await readRetry(work)).toEqual(original);
  });

  it("executes scan and a no-op defer against the fully migrated schema and its enum columns", async () => {
    const migrated = new PrismaReviewPublicationWorkFeed(admin);
    const rows = await migrated.scan({ now: new Date(), limit: 1 });
    expect(rows.length).toBeLessThanOrEqual(1);
    const missingId = `publication-feed-missing-${randomUUID()}`;
    await expect(
      migrated.defer({
        work: {
          executionId: missingId,
          publicationAttemptId: missingId,
          publicationOperationId: missingId,
          provider: "github",
          retryCount: 0,
        },
        nextEligibleAt: now,
        lastErrorCode: "compatibility-probe",
      }),
    ).resolves.toBeUndefined();
  });

  async function seed(
    id: string,
    options: {
      provider?: string;
      required?: boolean;
      dueOffsetMs?: number;
      retainOffsetMs?: number;
      reconcileOffsetMs?: number;
      operationState?: string;
      attemptState?: string;
      mismatchWorkspace?: boolean;
      mismatchScm?: boolean;
      missingRepository?: boolean;
    } = {},
  ): Promise<ReviewPublicationDueWork> {
    const repositoryId = `repository-${id}`;
    const attemptId = `attempt-${id}`;
    const operationId = `operation-${id}`;
    const executionId = `execution-${id}`;
    const provider = options.provider ?? "github";
    if (!options.missingRepository)
      await prisma.$executeRaw`
      INSERT INTO "RepositoryConnection" ("id", "workspaceId", "scmRepositoryIdentityId", "provider")
      VALUES (${repositoryId}, 'workspace', 'scm-identity', ${provider})
    `;
    await prisma.$executeRaw`
      INSERT INTO "ReviewPublicationAttemptV2"
        ("publicationAttemptId", "workspaceId", "repositoryConnectionId", "scmRepositoryIdentityId", "executionId", "state", "retainUntil")
      VALUES (${attemptId}, ${options.mismatchWorkspace ? "other-workspace" : "workspace"}, ${repositoryId},
        ${options.mismatchScm ? "other-scm" : "scm-identity"}, ${executionId}, ${options.attemptState ?? "pending"}::"ReviewPublicationAttemptStateV2", ${new Date(now.getTime() + (options.retainOffsetMs ?? 60_000))})
    `;
    await prisma.$executeRaw`
      INSERT INTO "ReviewPublicationOperationV2"
        ("publicationOperationId", "publicationAttemptId", "state", "required", "nextEligibleAt", "reconcileUntil", "retryCount")
      VALUES (${operationId}, ${attemptId}, ${options.operationState ?? "planned"}::"ReviewPublicationOperationStateV2", ${options.required ?? true},
        ${new Date(now.getTime() + (options.dueOffsetMs ?? 0))}, ${new Date(now.getTime() + (options.reconcileOffsetMs ?? 60_000))}, 0)
    `;
    return {
      executionId,
      publicationAttemptId: attemptId,
      publicationOperationId: operationId,
      provider: provider === "gitlab" ? "gitlab" : "github",
      retryCount: 0,
    };
  }

  async function readRetry(work: ReviewPublicationDueWork) {
    return prisma.$queryRaw<
      {
        retryCount: number;
        nextEligibleAt: Date;
        lastErrorCode: string | null;
      }[]
    >`
      SELECT "retryCount", "nextEligibleAt", "lastErrorCode"
      FROM "ReviewPublicationOperationV2" WHERE "publicationOperationId" = ${work.publicationOperationId}
    `;
  }
});

const schema = [
  `CREATE TYPE "ReviewPublicationAttemptStateV2" AS ENUM ('pending', 'publishing', 'reconciling', 'terminal')`,
  `CREATE TYPE "ReviewPublicationOperationStateV2" AS ENUM (
    'planned', 'in_flight', 'effect_observed', 'reconciling', 'completed',
    'superseded_no_effect', 'failed_no_effect', 'stale_compensated', 'stale_visible', 'terminal_unknown'
  )`,
  `CREATE TABLE "RepositoryConnection" (
    "id" text PRIMARY KEY, "workspaceId" text NOT NULL,
    "scmRepositoryIdentityId" text NOT NULL, "provider" text NOT NULL
  )`,
  `CREATE TABLE "ReviewPublicationAttemptV2" (
    "publicationAttemptId" text PRIMARY KEY, "workspaceId" text NOT NULL,
    "repositoryConnectionId" text NOT NULL, "scmRepositoryIdentityId" text NOT NULL,
    "executionId" text NOT NULL, "state" "ReviewPublicationAttemptStateV2" NOT NULL, "retainUntil" timestamp(3) NOT NULL
  )`,
  `CREATE TABLE "ReviewPublicationOperationV2" (
    "publicationOperationId" text PRIMARY KEY, "publicationAttemptId" text NOT NULL,
    "state" "ReviewPublicationOperationStateV2" NOT NULL, "required" boolean NOT NULL, "nextEligibleAt" timestamp(3) NOT NULL,
    "reconcileUntil" timestamp(3) NOT NULL, "retryCount" integer NOT NULL DEFAULT 0, "lastErrorCode" text
  )`,
];
