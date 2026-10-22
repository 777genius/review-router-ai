import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  RedriveUsageSource,
  type UsageSourceRedriveRequest,
} from "../application/redrive-usage-source";
import { PrismaUsageSourceRedrive } from "../infrastructure/prisma-usage-source-redrive";
import { PrismaUsageReconciliation } from "../infrastructure/prisma-usage-reconciliation";
const adminUrl = process.env.USAGE_REDRIVE_TEST_POSTGRES_ADMIN_URL;
describe.skipIf(!adminUrl)("audited source redrive real PostgreSQL", () => {
  const name = "TEST_usage_redrive_" + randomUUID().replaceAll("-", "");
  const deadAt = new Date("2026-10-22T07:40:14.915Z");
  let admin: PrismaClient,
    prisma: PrismaClient,
    created = false;
  let command: RedriveUsageSource;
  const input = (suffix: string): UsageSourceRedriveRequest => ({
    operationId: "redrive-operation-" + suffix,
    operatorWorkspaceId: "operator",
    actorId: "owner",
    workspaceId: "target",
    sourceInstance: "gateway/" + suffix,
    expectedFence: 8n,
    expectedDeadLetteredAt: deadAt,
    reason: "qualified endpoint activated",
  });
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
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString(), max: 4 }),
    });
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "Workspace"("id" text PRIMARY KEY,"deletionState" text NOT NULL);`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "WorkspaceMember"("workspaceId" text NOT NULL,"userId" text NOT NULL,"role" text NOT NULL,PRIMARY KEY("workspaceId","userId"));`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "UsageSourceCheckpoint"("sourceInstance" text PRIMARY KEY,"workspaceId" text NOT NULL,"cursor" text,"highWaterMark" text,"fence" bigint NOT NULL DEFAULT 0,"leaseOwner" text,"leaseUntil" timestamptz,"coveredFrom" timestamptz NOT NULL,"asOf" timestamptz,"disabledAt" timestamptz,"failureCount" integer NOT NULL DEFAULT 0,"nextAttemptAt" timestamptz,"deadLetteredAt" timestamptz,"lastErrorCode" text);`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "AuditEvent"("id" text PRIMARY KEY,"workspaceId" text NOT NULL,"actor" text NOT NULL,"action" text NOT NULL,"targetType" text NOT NULL,"targetId" text NOT NULL,"metadata" jsonb NOT NULL,"createdAt" timestamptz NOT NULL DEFAULT now());`,
    );
    await prisma.$executeRaw`INSERT INTO "Workspace" VALUES ('operator','active'),('target','active'),('deleting','deleting')`;
    await prisma.$executeRaw`INSERT INTO "WorkspaceMember" VALUES ('operator','owner','owner'),('operator','member','member')`;
    command = new RedriveUsageSource(
      new PrismaUsageSourceRedrive(prisma, "operator"),
    );
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    if (created)
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin?.$disconnect();
  });
  async function seed(q: UsageSourceRedriveRequest, activeLease = false) {
    await prisma.usageSourceCheckpoint.create({
      data: {
        sourceInstance: q.sourceInstance,
        workspaceId: q.workspaceId,
        fence: 8n,
        deadLetteredAt: deadAt,
        failureCount: 8,
        nextAttemptAt: new Date("2099-10-22"),
        lastErrorCode: "native_source_unavailable",
        cursor: "retained-cursor",
        highWaterMark: "retained-high",
        coveredFrom: new Date("2026-10-01"),
        asOf: new Date("2026-10-20"),
        ...(activeLease
          ? { leaseOwner: "other-worker", leaseUntil: new Date("2099-01-01") }
          : {}),
      },
    });
  }
  it("concurrent same-operation redrive commits one audit and normal claim retains exact progress", async () => {
    const q = input("concurrent");
    await seed(q);
    const before = await prisma.usageSourceCheckpoint.findUniqueOrThrow({
      where: { sourceInstance: q.sourceInstance },
    });
    const worker = new PrismaUsageReconciliation(prisma);
    expect(
      await worker.claim({
        sourceInstance: q.sourceInstance,
        workspaceId: q.workspaceId,
        owner: "normal-worker",
        now: new Date(),
        leaseMs: 60000,
        coveredFrom: new Date(),
      }),
    ).toBeNull();
    const results = await Promise.all([command.execute(q), command.execute(q)]);
    expect(results.map((r) => r.status).sort()).toEqual([
      "already_queued",
      "queued",
    ]);
    expect(
      await prisma.auditEvent.count({ where: { targetId: q.sourceInstance } }),
    ).toBe(1);
    expect(
      (
        await prisma.auditEvent.findUniqueOrThrow({
          where: { id: results[0]!.auditId },
        })
      ).metadata,
    ).toMatchObject({ previousLastErrorCode: "native_source_unavailable" });
    const after = await prisma.usageSourceCheckpoint.findUniqueOrThrow({
      where: { sourceInstance: q.sourceInstance },
    });
    expect(after).toMatchObject({
      fence: 9n,
      deadLetteredAt: null,
      nextAttemptAt: null,
      lastErrorCode: null,
      failureCount: 0,
      cursor: before.cursor,
      highWaterMark: before.highWaterMark,
      coveredFrom: before.coveredFrom,
      asOf: before.asOf,
    });
    const lease = await worker.claim({
      sourceInstance: q.sourceInstance,
      workspaceId: q.workspaceId,
      owner: "normal-worker",
      now: new Date(),
      leaseMs: 60000,
      coveredFrom: new Date(),
    });
    expect(lease).toMatchObject({
      fence: 10n,
      cursor: "retained-cursor",
      highWaterMark: "retained-high",
    });
    expect((await command.execute(q)).status).toBe("already_queued");
    await expect(
      command.execute({ ...q, reason: "different operation intent" }),
    ).rejects.toThrow("usage_redrive_identity_conflict");
  });
  it("denies revoked/non-admin operators, inactive target, stale fence and active lease without audit", async () => {
    for (const kind of [
      "member",
      "revoked",
      "deleting",
      "stale",
      "leased",
    ] as const) {
      const q = input(kind);
      if (kind === "deleting") q.workspaceId = "deleting";
      await seed(q, kind === "leased");
      const candidate =
        kind === "member"
          ? { ...q, actorId: "member" }
          : kind === "revoked"
            ? { ...q, actorId: "revoked" }
            : kind === "stale"
              ? { ...q, expectedFence: 7n }
              : q;
      await expect(command.execute(candidate)).rejects.toThrow();
      expect(
        (
          await prisma.usageSourceCheckpoint.findUniqueOrThrow({
            where: { sourceInstance: q.sourceInstance },
          })
        ).fence,
      ).toBe(8n);
      expect(
        await prisma.auditEvent.count({
          where: { targetId: q.sourceInstance },
        }),
      ).toBe(0);
    }
  });
  it("audit failure rolls back queue transition instead of leaving an unaudited reset", async () => {
    const q = input("audit-failure");
    await seed(q);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."targetId"='gateway/audit-failure' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER reject_test_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`,
    );
    await expect(command.execute(q)).rejects.toThrow();
    expect(
      await prisma.usageSourceCheckpoint.findUniqueOrThrow({
        where: { sourceInstance: q.sourceInstance },
      }),
    ).toMatchObject({
      fence: 8n,
      deadLetteredAt: deadAt,
      failureCount: 8,
      cursor: "retained-cursor",
    });
    expect(
      await prisma.auditEvent.count({ where: { targetId: q.sourceInstance } }),
    ).toBe(0);
  });
});
