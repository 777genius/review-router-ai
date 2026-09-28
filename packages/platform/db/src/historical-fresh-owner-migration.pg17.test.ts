import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
// pg is a runtime dependency; this package intentionally has no @types/pg.
// @ts-expect-error -- disposable SQL fixture uses the runtime package directly.
import { Client } from "pg";
import { describe, expect, it } from "vitest";

// Regression: stock 000001-000109 reaches 000110 without the release owner;
// an unsafe preexisting owner must fail atomically, while an already managed
// owner must retain its schema ACL and the fresh owner must remain inert.
const adminUrl = process.env.REVIEW_ROUTER_FRESH_OWNER_PG17_ADMIN_URL;
const enabled = adminUrl !== undefined;
const migrations = resolve(import.meta.dirname, "../prisma/migrations");
const migration = readFileSync(
  resolve(migrations, "000110_historical_unknown_scope_barrier/migration.sql"),
  "utf8",
);
const owner = "reviewrouter_release_schema_owner";
const stockRoles = [
  "reviewrouter_certified_fork_owner",
  "reviewrouter_certified_fork_writer",
  "reviewrouter_certified_fork_reader",
  "reviewrouter_certified_fork_fact_owner",
] as const;

function checkedUrl(): URL {
  if (
    !adminUrl ||
    process.env.REVIEW_ROUTER_FRESH_OWNER_DISPOSABLE_CLUSTER !== "1"
  )
    throw new Error("fresh_owner_disposable_cluster_required");
  const url = new URL(adminUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    url.pathname !== "/postgres" ||
    url.hash
  )
    throw new Error("fresh_owner_pg17_maintenance_url_required");
  return url;
}

async function connect(url: URL, database?: string): Promise<Client> {
  const next = new URL(url);
  if (database) next.pathname = `/${database}`;
  const client = new Client({ connectionString: next.toString() });
  await client.connect();
  return client;
}

async function expectOwnerFunctions(client: Client): Promise<void> {
  const result = await client.query<{
    proname: string;
    rolname: string;
    prosecdef: boolean;
    proconfig: string[];
    publicExecute: number;
  }>(`
    SELECT p.proname, r.rolname, p.prosecdef, p.proconfig,
      (SELECT count(*)::integer FROM pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS "publicExecute"
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public' AND p.proname IN
      ('hosted_historical_lock_runtime_gate', 'hosted_historical_grant_guard')
    ORDER BY p.proname`);
  expect(result.rows).toHaveLength(2);
  for (const row of result.rows) {
    expect(row.rolname).toBe(owner);
    expect(row.prosecdef).toBe(true);
    expect(row.proconfig).toEqual(["search_path=pg_catalog, pg_temp"]);
    expect(row.publicExecute).toBe(0);
  }
}

describe.skipIf(!enabled)("000110 fresh owner on disposable PG17", () => {
  it("rejects unsafe roles, preserves managed ACL, and bootstraps an inert owner", async () => {
    const url = checkedUrl();
    const suffix = randomBytes(5).toString("hex");
    const seed = `reviewrouter_fresh_owner_seed_${suffix}`;
    const unsafe = `reviewrouter_fresh_owner_unsafe_${suffix}`;
    const managed = `reviewrouter_fresh_owner_managed_${suffix}`;
    const fresh = `reviewrouter_fresh_owner_fresh_${suffix}`;
    const probe = `rr_fresh_owner_probe_${suffix}`;
    const admin = await connect(url);
    const created: string[] = [];
    let ownsRoles = false;
    try {
      const authority = await admin.query<{
        version: string;
        superuser: boolean;
        sameSession: boolean;
        ownerExists: boolean;
      }>(`
        SELECT current_setting('server_version_num') AS version,
          r.rolsuper AS superuser, current_user = session_user AS "sameSession",
          pg_catalog.to_regrole('reviewrouter_release_schema_owner') IS NOT NULL AS "ownerExists"
        FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`);
      expect(Number(authority.rows[0]?.version)).toBeGreaterThanOrEqual(170000);
      expect(Number(authority.rows[0]?.version)).toBeLessThan(180000);
      expect(authority.rows[0]).toMatchObject({
        superuser: true,
        sameSession: true,
        ownerExists: false,
      });
      const existingStockRoles = await admin.query<{ count: number }>(
        `
        SELECT count(*)::integer AS count FROM pg_catalog.pg_roles
        WHERE rolname = ANY($1::text[])`,
        [stockRoles],
      );
      expect(existingStockRoles.rows[0]?.count).toBe(0);
      ownsRoles = true;
      await admin.query("SET createrole_self_grant = ''");
      await admin.query(`CREATE DATABASE ${seed}`);
      created.push(seed);
      const seedUrl = new URL(url);
      seedUrl.pathname = `/${seed}`;
      // psql -f gives each stock statement its real migration boundary;
      // 000058 includes CREATE INDEX CONCURRENTLY, which a single pg query
      // containing the whole file would incorrectly wrap in a transaction.
      const stockMigrations = readdirSync(migrations)
        .filter((entry) => /^\d{6}_/u.test(entry) && entry < "000110_")
        .sort();
      expect(stockMigrations).toHaveLength(108);
      expect(stockMigrations.at(-1)).toBe(
        "000109_sdk_growth_verifier_assignment_lock",
      );
      for (const name of stockMigrations) {
        const applied = spawnSync(
          "psql",
          [
            "--no-psqlrc",
            "--set",
            "ON_ERROR_STOP=1",
            "--dbname",
            seedUrl.toString(),
            "--file",
            resolve(migrations, name, "migration.sql"),
          ],
          {
            env: process.env,
            encoding: "utf8",
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        if (applied.error || applied.status !== 0)
          throw new Error(
            `fresh_owner_stock_migration_failed:${name}:${applied.error?.message ?? applied.stderr}`,
          );
      }
      expect(
        (await admin.query(`SELECT pg_catalog.to_regrole('${owner}') AS role`))
          .rows[0]?.role,
      ).toBeNull();
      for (const name of [unsafe, managed, fresh]) {
        await admin.query(`CREATE DATABASE ${name} TEMPLATE ${seed}`);
        created.push(name);
      }

      await admin.query(
        `CREATE ROLE ${owner} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      const unsafeDb = await connect(url, unsafe);
      try {
        await expect(unsafeDb.query(migration)).rejects.toThrow(
          "hosted_historical_owner_unsafe_existing_role",
        );
        await unsafeDb.query("ROLLBACK");
        expect(
          (
            await unsafeDb.query(
              "SELECT to_regclass('public.\"HostedHistoricalScopePolicy\"') AS relation",
            )
          ).rows[0]?.relation,
        ).toBeNull();
        await admin.query(`ALTER ROLE ${owner} NOLOGIN`);
        await admin.query(`CREATE ROLE ${probe} LOGIN`);
        await admin.query(`GRANT ${owner} TO ${probe}`);
        await expect(unsafeDb.query(migration)).rejects.toThrow(
          "hosted_historical_owner_unsafe_existing_role",
        );
        await unsafeDb.query("ROLLBACK");
        await admin.query(`REVOKE ${owner} FROM ${probe}`);
        await admin.query(`DROP ROLE ${probe}`);
        await unsafeDb.query("REVOKE USAGE ON SCHEMA public FROM PUBLIC");
        const usable = await unsafeDb.query<{ usable: boolean }>(`
          SELECT pg_catalog.has_schema_privilege(
            'reviewrouter_release_schema_owner', 'public', 'USAGE') AS usable`);
        expect(usable.rows[0]?.usable).toBe(false);
        await expect(unsafeDb.query(migration)).rejects.toThrow(
          "hosted_historical_owner_unsafe_existing_role",
        );
        await unsafeDb.query("ROLLBACK");
      } finally {
        await unsafeDb.end();
      }

      const managedDb = await connect(url, managed);
      try {
        await managedDb.query(`ALTER SCHEMA public OWNER TO ${owner}`);
        await managedDb.query(
          `ALTER TABLE public."CodexOAuthSecretNamespace" OWNER TO ${owner}`,
        );
        const managedContract = `
          SELECT n.nspacl::text AS "schemaAcl", schema_owner.rolname AS "schemaOwner",
            r.rolcanlogin AS "canLogin", r.rolsuper AS superuser,
            r.rolcreatedb AS "createDb", r.rolcreaterole AS "createRole",
            r.rolinherit AS inherits, r.rolreplication AS replication,
            r.rolbypassrls AS "bypassRls", r.rolconnlimit AS "connectionLimit",
            r.rolvaliduntil AS "validUntil",
            (SELECT count(*)::integer FROM pg_catalog.pg_auth_members edge
             WHERE edge.roleid = r.oid OR edge.member = r.oid OR edge.grantor = r.oid) AS memberships,
            (SELECT pg_catalog.pg_get_userbyid(c.relowner)
             FROM pg_catalog.pg_class c
             WHERE c.oid = 'public."CodexOAuthSecretNamespace"'::regclass) AS "existingTableOwner"
          FROM pg_catalog.pg_namespace n
          JOIN pg_catalog.pg_roles schema_owner ON schema_owner.oid = n.nspowner
          JOIN pg_catalog.pg_roles r ON r.rolname = 'reviewrouter_release_schema_owner'
          WHERE n.nspname = 'public'`;
        const before = (await managedDb.query(managedContract)).rows[0];
        await managedDb.query(migration);
        await expectOwnerFunctions(managedDb);
        expect((await managedDb.query(managedContract)).rows[0]).toEqual(
          before,
        );
        expect(before).toMatchObject({
          schemaOwner: owner,
          canLogin: false,
          superuser: false,
          createDb: false,
          createRole: false,
          replication: false,
          bypassRls: false,
          memberships: 0,
          existingTableOwner: owner,
        });
      } finally {
        await managedDb.end();
      }
      await admin.query(`DROP DATABASE ${managed} WITH (FORCE)`);
      created.splice(created.indexOf(managed), 1);
      await admin.query(`DROP DATABASE ${unsafe} WITH (FORCE)`);
      created.splice(created.indexOf(unsafe), 1);
      await admin.query(`DROP ROLE ${owner}`);

      const freshDb = await connect(url, fresh);
      try {
        await admin.query(
          `CREATE ROLE ${probe} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
        await freshDb.query(`SET ROLE ${probe}`);
        await expect(freshDb.query(migration)).rejects.toThrow(
          "hosted_historical_owner_bootstrap_requires_administrator",
        );
        await freshDb.query("ROLLBACK");
        await freshDb.query("RESET ROLE");
        expect(
          (
            await admin.query(
              `SELECT pg_catalog.to_regrole('${owner}') AS role`,
            )
          ).rows[0]?.role,
        ).toBeNull();
        await admin.query(`DROP ROLE ${probe}`);
        await freshDb.query(migration);
        await expectOwnerFunctions(freshDb);
        const result = await freshDb.query<{
          canLogin: boolean;
          superuser: boolean;
          createDb: boolean;
          createRole: boolean;
          inherits: boolean;
          replication: boolean;
          bypassRls: boolean;
          connectionLimit: number;
          validUntil: Date | null;
          memberships: number;
          usage: boolean;
          create: boolean;
        }>(`
          SELECT r.rolcanlogin AS "canLogin", r.rolsuper AS superuser,
            r.rolcreatedb AS "createDb", r.rolcreaterole AS "createRole",
            r.rolinherit AS inherits, r.rolreplication AS replication,
            r.rolbypassrls AS "bypassRls", r.rolconnlimit AS "connectionLimit",
            r.rolvaliduntil AS "validUntil",
            (SELECT count(*)::integer FROM pg_catalog.pg_auth_members edge
             WHERE edge.roleid = r.oid OR edge.member = r.oid OR edge.grantor = r.oid) AS memberships,
            pg_catalog.has_schema_privilege(r.oid, 'public', 'USAGE') AS usage,
            pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE') AS "create"
          FROM pg_catalog.pg_roles r WHERE r.rolname = 'reviewrouter_release_schema_owner'`);
        expect(result.rows[0]).toMatchObject({
          canLogin: false,
          superuser: false,
          createDb: false,
          createRole: false,
          inherits: true,
          replication: false,
          bypassRls: false,
          connectionLimit: -1,
          validUntil: null,
          memberships: 0,
          usage: true,
          create: false,
        });
        await admin.query(`CREATE ROLE ${probe} LOGIN`);
        const restricted = await freshDb.query<{
          canUpdateGate: boolean;
          canSetOwner: boolean;
          canExecuteGateHelper: boolean;
        }>(`
          SELECT pg_catalog.has_table_privilege('${probe}',
              'public."HostedCodexRuntimeGate"', 'UPDATE') AS "canUpdateGate",
            pg_catalog.pg_has_role('${probe}', '${owner}', 'SET') AS "canSetOwner",
            pg_catalog.has_function_privilege('${probe}',
              'public.hosted_historical_lock_runtime_gate()', 'EXECUTE')
              AS "canExecuteGateHelper"`);
        expect(restricted.rows[0]).toEqual({
          canUpdateGate: false,
          canSetOwner: false,
          canExecuteGateHelper: false,
        });
        await admin.query(`DROP ROLE ${probe}`);
      } finally {
        await freshDb.end();
      }
    } finally {
      try {
        for (const name of created.reverse())
          await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        if (ownsRoles) {
          await admin.query(`DROP ROLE IF EXISTS ${probe}`);
          await admin.query(`DROP ROLE IF EXISTS ${owner}`);
          for (const role of stockRoles)
            await admin.query(`DROP ROLE IF EXISTS ${role}`);
        }
      } finally {
        await admin.end();
      }
    }
  }, 300_000);
});
