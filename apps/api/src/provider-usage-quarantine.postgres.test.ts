import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selectGatewayQuarantineBatch } from "./provider-usage-quarantine";

const adminUrl = process.env.USAGE_REDRIVE_TEST_POSTGRES_ADMIN_URL;
describe.skipIf(!adminUrl)("gateway quarantine replay fairness", () => {
  const name = "TEST_usage_replay_" + randomUUID().replaceAll("-", "");
  const now = new Date();
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let created = false;

  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      throw new Error("disposable_loopback_database_required");
    admin = new PrismaClient({
      adapter: new PrismaPg({ connectionString: adminUrl! }),
    });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = "/" + name;
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url.toString() }),
    });
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "UsageCall" ("callId" text PRIMARY KEY)`,
    );
    await prisma.$executeRawUnsafe(`CREATE TABLE "UsageUnattributedObservation" (
      "sourceInstance" text NOT NULL, "eventId" text NOT NULL, revision int NOT NULL,
      hash text NOT NULL, payload jsonb NOT NULL, "workspaceId" text, "reason" text NOT NULL,
      "observedAt" timestamptz NOT NULL, "receivedAt" timestamptz NOT NULL,
      "nextResolutionAt" timestamptz NOT NULL, "resolvedAt" timestamptz,
      PRIMARY KEY ("sourceInstance", "eventId", revision))`);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (created)
      await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin?.$disconnect();
  });

  it("replays fresh attributable events despite an old unmatched backlog while advancing oldest records", async () => {
    await prisma.$executeRaw`INSERT INTO "UsageUnattributedObservation"
      ("sourceInstance","eventId",revision,hash,payload,reason,"observedAt","receivedAt","nextResolutionAt")
      SELECT 'gateway/test','old-'||n,1,'hash',jsonb_build_object('executionRef','missing','requestRef',n::text),
        'usage_unattributed',${now}::timestamptz - interval '1 hour',${now}::timestamptz - interval '1 hour',${now}::timestamptz - interval '1 hour'
      FROM generate_series(1,120) n`;
    await prisma.$executeRaw`INSERT INTO "UsageCall" ("callId")
      SELECT 'gw-'||encode(sha256(convert_to('exec','UTF8')||decode('00','hex')||convert_to(n::text,'UTF8')),'hex')
      FROM generate_series(1,60) n`;
    await prisma.$executeRaw`INSERT INTO "UsageUnattributedObservation"
      ("sourceInstance","eventId",revision,hash,payload,reason,"observedAt","receivedAt","nextResolutionAt")
      SELECT 'gateway/test','new-'||n,1,'hash',jsonb_build_object('executionRef','exec','requestRef',n::text),
        'usage_unattributed',${now}::timestamptz,${now}::timestamptz,${now}::timestamptz
      FROM generate_series(1,60) n`;
    // A different revision of the same event must remain eligible for fallback.
    await prisma.$executeRaw`INSERT INTO "UsageUnattributedObservation"
      ("sourceInstance","eventId",revision,hash,payload,reason,"observedAt","receivedAt","nextResolutionAt")
      VALUES ('gateway/test','new-1',2,'hash',jsonb_build_object('executionRef','missing','requestRef','different'),
        'usage_unattributed',${now}::timestamptz - interval '1 hour',${now}::timestamptz - interval '1 hour',${now}::timestamptz - interval '1 hour')`;
    await prisma.$executeRaw`INSERT INTO "UsageUnattributedObservation"
      ("sourceInstance","eventId",revision,hash,payload,reason,"observedAt","receivedAt","nextResolutionAt")
      SELECT 'gateway/unmatched','only-'||n,1,'hash',jsonb_build_object('executionRef','missing','requestRef',n::text),
        'usage_unattributed',${now}::timestamptz,${now}::timestamptz,${now}::timestamptz
      FROM generate_series(1,110) n`;
    const rows = await selectGatewayQuarantineBatch(
      prisma,
      "gateway/test",
      now,
    );
    expect(rows).toHaveLength(100);
    expect(
      rows.filter(
        (row) => row.revision === 1 && row.eventId.startsWith("new-"),
      ),
    ).toHaveLength(50);
    expect(rows.filter((row) => row.eventId.startsWith("old-"))).toHaveLength(
      49,
    );
    expect(
      rows.some((row) => row.eventId === "new-1" && row.revision === 2),
    ).toBe(true);
    expect(
      new Set(rows.map((row) => `${row.eventId}:${row.revision}`)).size,
    ).toBe(100);
    const unmatched = await selectGatewayQuarantineBatch(
      prisma,
      "gateway/unmatched",
      now,
    );
    expect(unmatched).toHaveLength(100);
    expect(unmatched.every((row) => row.eventId.startsWith("only-"))).toBe(
      true,
    );
  });
});
