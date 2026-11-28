import { createHash, createHmac, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import {
  beginFencedWebhookDelivery,
  claimVerifiedFencedWebhookDeliveryInTransaction,
  runWebhookFencedDatabaseEffect,
} from "../../packages/features/github-installations/src/infrastructure/prisma/webhook-effect-fence";
import { createGitHubAppWebhookVerifier } from "../../packages/features/github-installations/src/infrastructure/crypto/github-app-webhook-verifier";
import { PrismaWebhookDeliveryRepository } from "../../packages/features/github-installations/src/infrastructure/prisma/prisma-webhook-delivery-repository";
import {
  webhookFencePostgres,
  assertWebhookFenceTestDatabase,
} from "./postgres-fixture";
const test = webhookFencePostgres.enabled ? describe : describe.skip;
test("full migration webhook fencing compatibility", () => {
  const pool = new Pool(webhookFencePostgres.connection);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const role = `webhook_fence_test_${randomBytes(6).toString("hex")}`;
  const createdRoles: string[] = [];
  beforeAll(async () => {
    await assertWebhookFenceTestDatabase(pool);
  });
  afterAll(async () => {
    await prisma.$disconnect();
    try {
      for (const createdRole of createdRoles) {
        await pool.query(`DROP OWNED BY "${createdRole}"`);
        await pool.query(`DROP ROLE "${createdRole}"`);
      }
    } finally {
      await pool.end();
    }
  });
  it("applies every checked-in migration with its exact checksum", async () => {
    const directory = new URL(
      "../../packages/platform/db/prisma/migrations/",
      import.meta.url,
    );
    const expected = readdirSync(directory)
      .filter((name) => /^\d{6}_/u.test(name))
      .sort()
      .map((name) => ({
        name,
        checksum: createHash("sha256")
          .update(readFileSync(new URL(`${name}/migration.sql`, directory)))
          .digest("hex"),
      }));
    const ledger = await pool.query(
      `SELECT migration_name AS name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
    );
    expect(ledger.rows).toEqual(expected);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
        )
      ).rows[0]?.count,
    ).toBe(0);
  });
  it("preserves a pre-migration legacy receipt without granting takeover", async () => {
    const id = "webhook-fence-migration-legacy";
    const legacy = new PrismaWebhookDeliveryRepository(prisma);
    expect(
      (
        await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
          where: { deliveryId: id },
        })
      ).status,
    ).toBe("processing");
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "GitHubWebhookFence" WHERE "deliveryId"=$1',
          [id],
        )
      ).rows[0]?.count,
    ).toBe(0);
    await legacy.markFailed({
      deliveryId: id,
      errorSummary: "synthetic legacy failure",
    });
    expect(
      await legacy.tryStartProcessing({ deliveryId: id, eventName: "push" }),
    ).toBe(true);
    await legacy.markProcessed(id);
    expect(
      (
        await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
          where: { deliveryId: id },
        })
      ).status,
    ).toBe("processed");
  });
  it("enforces migration-only owner, generation and recovery-state constraints", async () => {
    const id = `migration-constraint-${randomBytes(6).toString("hex")}`;
    await prisma.gitHubWebhookDelivery.create({
      data: { deliveryId: id, eventName: "push" },
    });
    for (const [owner, generation] of [
      ["invalid", 1],
      ["a".repeat(64), 0],
    ] as const) {
      await expect(
        pool.query(
          `INSERT INTO "GitHubWebhookFence" ("deliveryId","ownerHash","appIdentityHash",generation,"leaseUntil") VALUES ($1,$2,$3,$4,clock_timestamp()+interval '1 minute')`,
          [id, owner, "d".repeat(64), generation],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    }
    await expect(
      pool.query(
        `INSERT INTO "GitHubWebhookRecoveryIntent" ("appIdentityHash","deliveryGuid","githubDeliveryId","eventName","payloadHash",state) VALUES ($1,$2,1,'push',$3,'accepted')`,
        ["d".repeat(64), id, "e".repeat(64)],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("allows guarded effects under a non-superuser role and rejects legacy overwrites", async () => {
    const password = randomBytes(24).toString("hex");
    await pool.query(
      `CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}'`,
    );
    createdRoles.push(role);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await pool.query(
      `GRANT SELECT, INSERT, UPDATE ON "GitHubWebhookDelivery", "GitHubWebhookFence" TO "${role}"`,
    );
    const configuration = {
      ...webhookFencePostgres.connection,
      user: role,
      password,
    };
    if (configuration.connectionString) {
      const url = new URL(configuration.connectionString);
      url.username = role;
      url.password = password;
      configuration.connectionString = url.href;
    }
    const limitedPool = new Pool(configuration);
    const limited = new PrismaClient({ adapter: new PrismaPg(limitedPool) });
    try {
      const actor = await limitedPool.query(
        "SELECT current_user AS name, rolsuper FROM pg_roles WHERE rolname=current_user",
      );
      expect(actor.rows[0]).toEqual({ name: role, rolsuper: false });
      const id = `role-qualified-${randomBytes(6).toString("hex")}`;
      const claim = await beginFencedWebhookDelivery(
        limited,
        { deliveryId: id, eventName: "push" },
        "a".repeat(64),
        30_000,
        "d".repeat(64),
      );
      await runWebhookFencedDatabaseEffect(
        limited,
        claim,
        async (transaction) => {
          await transaction.gitHubWebhookDelivery.update({
            where: { deliveryId: id },
            data: { status: "processed" },
          });
        },
        "processed",
      );
      await expect(
        limitedPool.query(
          'UPDATE "GitHubWebhookDelivery" SET status=\'failed\' WHERE "deliveryId"=$1',
          [id],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await limited.gitHubWebhookDelivery.findUniqueOrThrow({
            where: { deliveryId: id },
          })
        ).status,
      ).toBe("processed");
    } finally {
      await limited.$disconnect();
      await limitedPool.end();
    }
  });
  it("requires a retained fence read grant for a legacy rollback writer", async () => {
    const legacyRole = `legacy_${role}`;
    await pool.query(
      `CREATE ROLE "${legacyRole}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
    );
    createdRoles.push(legacyRole);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${legacyRole}"`);
    await pool.query(
      `GRANT SELECT, UPDATE ON "GitHubWebhookDelivery" TO "${legacyRole}"`,
    );
    const legacyId = `rollback-legacy-${randomBytes(6).toString("hex")}`;
    const fencedId = `rollback-fenced-${randomBytes(6).toString("hex")}`;
    await prisma.gitHubWebhookDelivery.create({
      data: { deliveryId: legacyId, eventName: "push" },
    });
    await beginFencedWebhookDelivery(
      prisma,
      { deliveryId: fencedId, eventName: "push" },
      "a".repeat(64),
      30_000,
      "d".repeat(64),
    );
    const connection = await pool.connect();
    try {
      await connection.query(`SET ROLE "${legacyRole}"`);
      await expect(
        connection.query(
          'UPDATE "GitHubWebhookDelivery" SET status=\'processed\' WHERE "deliveryId"=$1',
          [legacyId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await connection.query("RESET ROLE");
      await pool.query(
        `GRANT SELECT ON "GitHubWebhookFence" TO "${legacyRole}"`,
      );
      await connection.query(`SET ROLE "${legacyRole}"`);
      expect(
        (
          await connection.query(
            'UPDATE "GitHubWebhookDelivery" SET status=\'processed\' WHERE "deliveryId"=$1',
            [legacyId],
          )
        ).rowCount,
      ).toBe(1);
      await expect(
        connection.query(
          'UPDATE "GitHubWebhookDelivery" SET status=\'failed\' WHERE "deliveryId"=$1',
          [fencedId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      try {
        await connection.query("RESET ROLE");
      } finally {
        connection.release();
      }
    }
  });
  it("uses the migrated receipt-order indexes for actual guarded admission queries", async () => {
    type PlanNode = {
      "Node Type": string;
      "Relation Name"?: string;
      "Index Name"?: string;
      "Actual Rows": number;
      "Actual Loops": number;
      "Rows Removed by Filter"?: number;
      "Rows Removed by Index Recheck"?: number;
      Plans?: PlanNode[];
    };
    const prefix = `receipt-plan-${randomBytes(6).toString("hex")}`;
    const installationId = "900000000001";
    const repositoryIds = ["900000000101", "900000000102"] as const;
    const secret = "synthetic-receipt-plan-secret";
    const verify = createGitHubAppWebhookVerifier({
      appId: "123",
      apiBaseUrl: "https://api.github.com",
      webhookSecret: secret,
    });
    const initialBody = Buffer.from('{"action":"created"}');
    const initialContext = verify({
      rawPayload: initialBody,
      signatureHeader: `sha256=${createHmac("sha256", secret).update(initialBody).digest("hex")}`,
    });
    if (!initialContext) throw new Error("receipt_plan_signature_invalid");
    const appHash = initialContext.appIdentityHash;
    const otherAppHash = "b".repeat(64);
    expect(appHash).not.toBe(otherAppHash);
    const observedPool = new Pool(webhookFencePostgres.connection);
    const observed = new PrismaClient({
      adapter: new PrismaPg(observedPool),
    });
    const floorQueries: Array<{ text: string; values: unknown[] }> = [];
    onTestFinished(async () => {
      try {
        const remaining = await pool.query(
          `SELECT
              (SELECT count(*)::int FROM "GitHubWebhookDelivery" WHERE "deliveryId" LIKE $1) AS deliveries,
              (SELECT count(*)::int FROM "GitHubWebhookFence" WHERE "deliveryId" LIKE $1) AS fences`,
          [`${prefix}%`],
        );
        expect(remaining.rows[0]).toEqual({ deliveries: 0, fences: 0 });
      } finally {
        try {
          await observed.$disconnect();
        } finally {
          await observedPool.end();
        }
      }
    });
    const rollback = new Error("rollback_receipt_plan_fixture");
    try {
      // This transaction also owns the bounded seed, ANALYZE and EXPLAIN work;
      // its fixture budget does not change the receiver's transaction timeout.
      await observed.$transaction(
        async (transaction) => {
          const nativeQueryRaw = transaction.$queryRaw.bind(transaction);
          transaction.$queryRaw = <T = unknown>(
            query: TemplateStringsArray | Prisma.Sql,
            ...values: unknown[]
          ) => {
            // Capture native SQL values without replacing the transaction or its PrismaPromise.
            if (
              "text" in query &&
              /^\s*SELECT\s+GREATEST\s*\(/iu.test(query.text) &&
              query.text.includes('"GitHubWebhookDelivery"') &&
              query.text.includes('AS "receivedAt"')
            )
              floorQueries.push({
                text: query.text,
                values: [...query.values],
              });
            return nativeQueryRaw<T>(query, ...values);
          };
          const indexes = await transaction.$queryRaw<
            Array<{ name: string; valid: boolean; ready: boolean }>
          >`
              SELECT i.relname AS name, x.indisvalid AS valid, x.indisready AS ready
              FROM pg_index x
              JOIN pg_class i ON i.oid = x.indexrelid
              JOIN pg_class t ON t.oid = x.indrelid
              JOIN pg_namespace n ON n.oid = t.relnamespace
              WHERE n.nspname = 'public'
                AND t.relname IN ('GitHubWebhookDelivery', 'GitHubWebhookFence')
            `;
          for (const name of [
            "GitHubWebhookDelivery_installation_receipt_order_idx",
            "GitHubWebhookDelivery_repository_receipt_order_idx",
          ])
            expect(indexes.find((index) => index.name === name)).toEqual({
              name,
              valid: true,
              ready: true,
            });
          const relationIndexes = new Set(indexes.map((index) => index.name));
          const clock = await transaction.$queryRaw<Array<{ nowMs: bigint }>>`
              SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "nowMs"
            `;
          const now = clock[0];
          if (!now) throw new Error("receipt_plan_clock_missing");
          const future = Number(now.nowMs) + 86_400_000;
          const futureIso = new Date(future).toISOString();
          expect(
            await transaction.$executeRaw`
              INSERT INTO "GitHubWebhookDelivery"
                (id, "deliveryId", "eventName", "installationId", "normalizedEvent",
                 status, "receivedAt", "createdAt", "updatedAt")
              SELECT
                ${prefix} || '-noise-' || n,
                ${prefix} || '-noise-' || n,
                CASE
                  WHEN n > 55000 AND n <= 95000 THEN
                    CASE WHEN n % 2 = 0 THEN 'push' ELSE 'pull_request' END
                  WHEN n > 97500 THEN 'repository'
                  WHEN n % 3 = 0 THEN 'installation'
                  WHEN n % 3 = 1 THEN 'installation_repositories'
                  ELSE 'repository'
                END,
                CASE WHEN n > 55000 AND n <= 97500
                  THEN ${BigInt(installationId)}::bigint ELSE 1000000 + n END,
                jsonb_build_object('repositoryId',
                  CASE WHEN n > 97500
                    THEN CASE WHEN n % 2 = 0 THEN ${repositoryIds[0]} ELSE ${repositoryIds[1]} END
                    ELSE (2000000 + n)::text END),
                'processed',
                ${futureIso}::timestamp +
                  CASE WHEN n > 95000 THEN interval '-1 hour' ELSE interval '1 day' END +
                  n * interval '1 millisecond',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              FROM generate_series(1, 100000) AS n
              `,
          ).toBe(100_000);
          expect(
            await transaction.$executeRaw`
              INSERT INTO "GitHubWebhookFence"
                ("deliveryId", "ownerHash", "appIdentityHash", generation, "leaseUntil")
              SELECT "deliveryId", ${"a".repeat(64)}, ${appHash}, 1, clock_timestamp() + interval '1 minute'
              FROM "GitHubWebhookDelivery" WHERE "deliveryId" LIKE ${`${prefix}-noise-%`}
              `,
          ).toBe(100_000);
          const retained = [
            [
              "install-current",
              "installation",
              installationId,
              null,
              20_000,
              appHash,
            ],
            [
              "install-legacy",
              "installation_repositories",
              installationId,
              null,
              30_000,
              null,
            ],
            [
              "install-other",
              "installation",
              installationId,
              null,
              70_000,
              otherAppHash,
            ],
            [
              "repo-current",
              "repository",
              "900000000002",
              repositoryIds[0],
              35_000,
              appHash,
            ],
            [
              "repo-legacy",
              "repository",
              "900000000003",
              repositoryIds[0],
              40_000,
              null,
            ],
            [
              "repo-other",
              "repository",
              "900000000004",
              repositoryIds[0],
              90_000,
              otherAppHash,
            ],
            [
              "repo2-current",
              "repository",
              "900000000005",
              repositoryIds[1],
              55_000,
              appHash,
            ],
            [
              "repo2-legacy",
              "repository",
              "900000000006",
              repositoryIds[1],
              50_000,
              null,
            ],
            [
              "repo2-other",
              "repository",
              "900000000007",
              repositoryIds[1],
              95_000,
              otherAppHash,
            ],
          ] as const;
          expect(
            await transaction.$executeRaw(Prisma.sql`
              WITH retained(delivery_id, event_name, installation_id, repository_id, received_at, app_hash) AS (
                VALUES ${Prisma.join(
                  retained.map(
                    ([
                      name,
                      eventName,
                      installation,
                      repository,
                      offset,
                      app,
                    ]) =>
                      Prisma.sql`(${`${prefix}-${name}`}::text, ${eventName}::text,
                        ${BigInt(installation)}::bigint, ${repository}::text,
                        ${new Date(future + offset).toISOString()}::timestamp, ${app}::text)`,
                  ),
                )}
              ), inserted AS (
                INSERT INTO "GitHubWebhookDelivery"
                  (id, "deliveryId", "eventName", "installationId", "normalizedEvent",
                   status, "receivedAt", "createdAt", "updatedAt")
                SELECT delivery_id, delivery_id, event_name, installation_id,
                  CASE WHEN repository_id IS NULL THEN NULL
                    ELSE jsonb_build_object('repositoryId', repository_id) END,
                  'processed', received_at, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM retained
                RETURNING "deliveryId"
              )
              INSERT INTO "GitHubWebhookFence"
                ("deliveryId", "ownerHash", "appIdentityHash", generation, "leaseUntil")
              SELECT i."deliveryId", ${"a".repeat(64)}, r.app_hash, 1, clock_timestamp() + interval '1 minute'
              FROM inserted i JOIN retained r ON r.delivery_id = i."deliveryId"
              WHERE r.app_hash IS NOT NULL
              `),
          ).toBe(6);
          await transaction.$executeRaw`ANALYZE "GitHubWebhookDelivery"`;
          await transaction.$executeRaw`ANALYZE "GitHubWebhookFence"`;

          const scenarios = [
            {
              eventName: "installation",
              action: "created",
              repositoryId: null,
              offset: 30_000,
            },
            {
              eventName: "repository",
              action: "deleted",
              repositoryId: repositoryIds[0],
              offset: 40_000,
            },
            {
              eventName: "repository",
              action: "deleted",
              repositoryId: repositoryIds[1],
              offset: 55_000,
            },
          ] as const;
          for (const [index, scenario] of scenarios.entries()) {
            const deliveryId = `${prefix}-claim-${index}`;
            const body = Buffer.from(
              JSON.stringify({
                action: scenario.action,
                installation: { id: Number(installationId) },
                ...(scenario.repositoryId
                  ? { repository: { id: Number(scenario.repositoryId) } }
                  : {}),
              }),
            );
            const context = verify({
              rawPayload: body,
              signatureHeader: `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
            });
            if (!context) throw new Error("receipt_plan_signature_invalid");
            const before = floorQueries.length;
            const claim = await claimVerifiedFencedWebhookDeliveryInTransaction(
              transaction,
              context,
              {
                deliveryId,
                eventName: scenario.eventName,
                action: scenario.action,
                installationId,
                payloadHash: context.payloadHash,
                normalizedEvent: scenario.repositoryId
                  ? { repositoryId: scenario.repositoryId }
                  : null,
              },
              "a".repeat(64),
              30_000,
            );
            expect(claim.kind).toBe("claimed");
            const receipt =
              await transaction.gitHubWebhookDelivery.findUniqueOrThrow({
                where: { deliveryId },
                select: { receivedAt: true },
              });
            expect(receipt.receivedAt.toISOString()).toBe(
              new Date(future + scenario.offset + 1).toISOString(),
            );
            expect(floorQueries).toHaveLength(before + 1);
            const captured = floorQueries[before];
            if (!captured) throw new Error("receipt_plan_query_missing");
            const explained = await transaction.$queryRawUnsafe<
              Array<{ "QUERY PLAN": Array<{ Plan: PlanNode }> }>
            >(
              `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${captured.text}`,
              ...captured.values,
            );
            const plan = explained[0]?.["QUERY PLAN"][0]?.Plan;
            if (!plan) throw new Error("receipt_plan_explain_missing");
            const pending = [plan];
            let scanned = 0;
            let scans = 0;
            while (pending.length) {
              const node = pending.pop();
              if (!node) continue;
              pending.push(...(node.Plans ?? []));
              if (
                node["Relation Name"] === "GitHubWebhookDelivery" ||
                node["Relation Name"] === "GitHubWebhookFence" ||
                (node["Index Name"] && relationIndexes.has(node["Index Name"]))
              ) {
                scans++;
                scanned +=
                  (node["Actual Rows"] +
                    (node["Rows Removed by Filter"] ?? 0) +
                    (node["Rows Removed by Index Recheck"] ?? 0)) *
                  node["Actual Loops"];
              }
            }
            expect(scans).toBeGreaterThan(0);
            // Count index work too: BitmapOr/MAX over thousands of matching history
            // must not pass merely because the final aggregate emits one row.
            expect(scanned, JSON.stringify(plan)).toBeLessThan(1_000);
            console.info(
              "webhook_receipt_floor_plan",
              JSON.stringify({
                eventName: scenario.eventName,
                repositoryId: scenario.repositoryId,
                retainedNoiseRows: 100_000,
                scannedRows: scanned,
                plan,
              }),
            );
          }
          throw rollback;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 60_000,
        },
      );
      throw new Error("receipt_plan_fixture_did_not_roll_back");
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 90_000);
});
