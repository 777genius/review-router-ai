import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedEfExecution } from "@reviewrouter/features-sdk-growth-authority";
import { PrismaSdkGrowthVerifierAssignmentStore } from "./sdk-growth-verifier-producer-identity.js";

const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const suffix = randomUUID().replaceAll("-", "");
const schema = `sdk_verifier_identity_${suffix}`;
const role = `sdk_verifier_reader_${suffix}`;
const candidateRole = `sdk_verifier_candidate_${suffix}`;

type PgClient = {
  connect(): Promise<void>;
  query(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount: number | null }>;
  end(): Promise<void>;
};
type Raw = {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]>;
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
};

function sql(strings: TemplateStringsArray): string {
  return strings.reduce(
    (result, part, index) =>
      result + part + (index < strings.length - 1 ? `$${index + 1}` : ""),
    "",
  );
}

function adapter(connection: PgClient) {
  const raw: Raw = {
    async $queryRaw(strings, ...values) {
      return (await connection.query(sql(strings), values)).rows;
    },
    async $executeRaw(strings, ...values) {
      return (await connection.query(sql(strings), values)).rowCount ?? 0;
    },
  };
  return {
    ...raw,
    async $transaction<T>(operation: (tx: Raw) => Promise<T>) {
      await connection.query("BEGIN");
      try {
        const result = await operation(raw);
        await connection.query("COMMIT");
        return result;
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      }
    },
  };
}

const execution: AuthenticatedEfExecution = {
  tenantId: "disposable-tenant",
  repositoryId: "disposable-repo",
  pullRequest: 17,
  githubRepositoryId: "100",
  installationId: "200",
  subject: "runner",
  runId: "300",
  runAttempt: "1",
  verifierRevision: "1".repeat(40),
  sourceCommit: "2".repeat(40),
  sourceTree: "3".repeat(40),
};

describe.skipIf(!url)("verifier assignment / disposable PostgreSQL", () => {
  let owner: PgClient;
  let peer: PgClient;
  let schemaCreated = false;
  let roleCreated = false;
  let candidateRoleCreated = false;

  beforeAll(async () => {
    const pg = createRequire(import.meta.url)("pg") as {
      Client: new (options: { connectionString: string }) => PgClient;
    };
    owner = new pg.Client({ connectionString: url! });
    peer = new pg.Client({ connectionString: url! });
    await Promise.all([owner.connect(), peer.connect()]);
    await owner.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    await Promise.all([
      owner.query(`SET search_path TO "${schema}"`),
      peer.query(`SET search_path TO "${schema}"`),
    ]);
    // The unshipped lock migration also defines an authority read function.
    // This fixture exercises assignments only, so supply its minimal inputs.
    await owner.query(
      `CREATE TABLE "${schema}"."SdkGrowthCurrentAuthority" ("scopeKey" text PRIMARY KEY, "epoch" bigint NOT NULL)`,
    );
    await owner.query(
      `CREATE TABLE "${schema}"."SdkGrowthBindingVersion" ("scopeKey" text NOT NULL, "epoch" bigint NOT NULL, "binding" jsonb NOT NULL)`,
    );
    await owner.query(
      `CREATE TABLE "${schema}"."SdkGrowthOwnerVersion" ("scopeKey" text NOT NULL, "epoch" bigint NOT NULL, "evidence" jsonb NOT NULL, "provenance" jsonb NOT NULL, "installationActive" boolean NOT NULL, "verifierActive" boolean NOT NULL)`,
    );
    for (const name of [
      "000108_sdk_growth_verifier_assignment",
      "000109_sdk_growth_verifier_assignment_lock",
    ]) {
      const migration = readFileSync(
        new URL(
          `../../../packages/platform/db/prisma/migrations/${name}/migration.sql`,
          import.meta.url,
        ),
        "utf8",
      );
      // The production function uses public; this disposable fixture owns only
      // its private schema and applies the identical SQL there.
      await owner.query(migration.replaceAll("public.", `"${schema}".`));
    }
    await owner.query(`CREATE ROLE "${role}" NOLOGIN`);
    roleCreated = true;
    await owner.query(`CREATE ROLE "${candidateRole}" NOLOGIN`);
    candidateRoleCreated = true;
    await owner.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await owner.query(
      `GRANT SELECT ON "${schema}"."SdkGrowthVerifierAssignment" TO "${role}"`,
    );
    await owner.query(
      `GRANT EXECUTE ON FUNCTION "${schema}".sdk_growth_verifier_assignment_lock(text) TO "${role}"`,
    );
  });

  afterAll(async () => {
    if (schemaCreated) {
      await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      if (roleCreated) await owner.query(`DROP ROLE "${role}"`);
      if (candidateRoleCreated)
        await owner.query(`DROP ROLE "${candidateRole}"`);
    }
    await Promise.allSettled([owner?.end(), peer?.end()]);
  });

  it("permits SELECT-only function locking and retains that lock until custody commit", async () => {
    const store = new PrismaSdkGrowthVerifierAssignmentStore(adapter(owner));
    const row = await store.create(
      execution,
      new Date(Date.now() + 15 * 60_000),
    );
    const privilege = await owner.query(
      `SELECT has_table_privilege($1, '"${schema}"."SdkGrowthVerifierAssignment"', 'UPDATE') AS "canUpdate",
              has_function_privilege($1, '"${schema}".sdk_growth_verifier_assignment_lock(text)', 'EXECUTE') AS "canExecute"`,
      [role],
    );
    expect(privilege.rows[0]).toEqual({ canUpdate: false, canExecute: true });
    const candidatePrivilege = await owner.query(
      `SELECT has_function_privilege($1, '"${schema}".sdk_growth_verifier_assignment_lock(text)', 'EXECUTE') AS "canExecute"`,
      [candidateRole],
    );
    expect(candidatePrivilege.rows[0]).toEqual({ canExecute: false });

    await owner.query("BEGIN");
    try {
      await owner.query(`SET LOCAL ROLE "${role}"`);
      await expect(
        owner.query(
          `SELECT * FROM "${schema}"."SdkGrowthVerifierAssignment" WHERE "assignmentId" = $1 FOR SHARE`,
          [row.assignmentId],
        ),
      ).rejects.toThrow();
    } finally {
      await owner.query("ROLLBACK");
    }

    await owner.query("BEGIN");
    try {
      await owner.query(`SET LOCAL ROLE "${role}"`);
      const locked = await owner.query(
        `SELECT * FROM "${schema}".sdk_growth_verifier_assignment_lock($1)`,
        [row.assignmentId],
      );
      expect(locked.rows).toHaveLength(1);
      await peer.query("BEGIN");
      try {
        await peer.query("SET LOCAL lock_timeout = '200ms'");
        await expect(
          peer.query(
            `UPDATE "SdkGrowthVerifierAssignment" SET "revokedAt" = now() WHERE "assignmentId" = $1`,
            [row.assignmentId],
          ),
        ).rejects.toThrow(/lock timeout/);
      } finally {
        await peer.query("ROLLBACK");
      }
    } finally {
      await owner.query("COMMIT");
    }
    const released = await peer.query(
      `UPDATE "SdkGrowthVerifierAssignment" SET "revokedAt" = now() WHERE "assignmentId" = $1`,
      [row.assignmentId],
    );
    expect(released.rowCount).toBe(1);
  });

  it("replaces concurrent creations in an initially empty scope", async () => {
    const first = new PrismaSdkGrowthVerifierAssignmentStore(adapter(owner));
    const second = new PrismaSdkGrowthVerifierAssignmentStore(adapter(peer));
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    const scopeExecution = { ...execution, pullRequest: 18 };
    const [a, b] = await Promise.all([
      first.create(scopeExecution, expiresAt),
      second.create({ ...scopeExecution, runAttempt: "2" }, expiresAt),
    ]);
    expect(a.jobKey).toBe(b.jobKey);
    const active = await owner.query(
      `SELECT "assignmentId" FROM "SdkGrowthVerifierAssignment" WHERE "jobKey" = $1 AND "revokedAt" IS NULL`,
      [a.jobKey],
    );
    expect(active.rows).toHaveLength(1);
  });
});
