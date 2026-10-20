import assert from "node:assert/strict";
import { test } from "node:test";
import { checkedDatabaseTarget } from "./database-target.mjs";
import { runAccountLifecyclePostgresTests } from "./postgres-lifecycle";

test(
  "lifecycle actual adapters on the dedicated migrated TEST database",
  {
    skip: process.env.RR_ACCOUNT_LIFECYCLE_MIGRATED_TEST !== "1",
    timeout: 120_000,
  },
  async (t) => {
    assert.equal(process.env.RR_PROVIDER_ACCOUNTS_DISPOSABLE_CLUSTER, "1");
    const target = checkedDatabaseTarget(
      process.env.RR_PROVIDER_ACCOUNTS_PG_TEST_URL ?? "",
    );
    assert.equal(target.database, "rr_gateway_test_c2c_lifecycle_feature");
    assert.equal(target.port, 55644);
    const [{ PrismaClient }, { PrismaPg }] = await Promise.all([
      import("@prisma/client"),
      import("@prisma/adapter-pg"),
    ]);
    const db = new PrismaClient({
      adapter: new PrismaPg(target),
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
    try {
      await runAccountLifecyclePostgresTests(t, db);
    } finally {
      await db.$disconnect();
    }
  },
);
