import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaRateLimitStore } from "../infrastructure/prisma/prisma-rate-limit-store";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;
describe.skipIf(!adminUrl)(
  "rate limit cleanup concurrency on PostgreSQL",
  () => {
    it("preserves a bucket renewed while DELETE waits on its old expired version", async () => {
      const url = new URL(adminUrl!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
        throw new Error("disposable_loopback_database_required");
      const name = "TEST_rate_cleanup_" + randomUUID().replaceAll("-", "");
      const admin = new Client({ connectionString: url.toString() });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${name}"`);
      url.pathname = "/" + name;
      const writer = new Client({ connectionString: url.toString() });
      url.searchParams.set("application_name", name);
      const prisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url.toString(),
          max: 1,
          connectionTimeoutMillis: 1000,
        }),
      });
      const store = new PrismaRateLimitStore(prisma);
      let cleanup: Promise<unknown> | undefined;
      try {
        await writer.connect();
        await writer.query(
          'CREATE TABLE "RateLimitBucket" ("key" text PRIMARY KEY,"count" int NOT NULL,"limit" int NOT NULL,"windowStart" timestamptz NOT NULL,"windowEndsAt" timestamptz NOT NULL,"createdAt" timestamptz NOT NULL,"updatedAt" timestamptz NOT NULL)',
        );
        const now = new Date();
        await store.consumeFixedWindow({
          key: "bucket",
          limit: 10,
          amount: 1,
          windowStart: new Date(now.getTime() - 60000),
          windowEndsAt: new Date(now.getTime() - 1000),
          now,
        });
        await writer.query("BEGIN");
        await writer.query(
          'UPDATE "RateLimitBucket" SET "count"=7,"windowEndsAt"=$1 WHERE "key"=$2',
          [new Date(now.getTime() + 60000), "bucket"],
        );
        cleanup = store.deleteExpiredBuckets({ expiredBefore: now, limit: 1 });
        let waiting = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          const activity = await admin.query<{ waiting: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting",
            [name],
          );
          if (activity.rows[0]?.waiting) {
            waiting = true;
            break;
          }
          await delay(5);
        }
        expect(waiting).toBe(true);
        await writer.query("COMMIT");
        await expect(cleanup).resolves.toEqual({ deleted: 0 });
        const rows = await writer.query(
          'SELECT "count" FROM "RateLimitBucket" WHERE "key"=$1',
          ["bucket"],
        );
        expect(rows.rows).toEqual([{ count: 7 }]);
      } finally {
        await writer.query("ROLLBACK").catch(() => {});
        await cleanup?.catch(() => {});
        await writer.end();
        await prisma.$disconnect();
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
        await admin.end();
      }
    });
  },
);
