import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderSdkGrowthSchemaExecutorSql,
  validateSdkGrowthSchemaExecutorEnvironment,
} from "./execute-sdk-growth-application-schema.mjs";
import {
  sdkGrowthApplicationSchemaContract,
  sdkGrowthDatabaseIdentityDigest,
} from "./sdk-growth-application-schema-checkpoint.mjs";

const head = "a".repeat(40);
const databaseIdentity = {
  systemIdentifier: "7522147049465590841",
  databaseOid: "16384",
  databaseName: "reviewrouter",
  postgresVersion: 170010,
  sessionUser: "reviewrouter",
  currentUser: "reviewrouter",
};
const environment = {
  REVIEW_ROUTER_RELEASE_COMMIT_SHA: head,
  REVIEW_ROUTER_RELEASE_CONFIG_REVISION: head,
  REVIEW_ROUTER_API_SERVICE_REVISION: head,
  REVIEW_ROUTER_WORKER_SERVICE_REVISION: head,
  REVIEW_ROUTER_RELEASE_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
  REVIEW_ROUTER_SDK_GROWTH_DATABASE_IDENTITY:
    sdkGrowthDatabaseIdentityDigest(databaseIdentity),
  REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OPERATION_PHASE: "apply-000105",
  REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED: "0",
  REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
  REVIEW_ROUTER_SCHEMA_OWNER_COORDINATOR_DATABASE_URL:
    "postgresql://reviewrouter:secret@db/reviewrouter",
  REVIEW_ROUTER_RELEASE_MIGRATION_DATABASE_URL:
    "postgresql://reviewrouter_release_migration:secret@db/reviewrouter",
  REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL:
    "postgresql://reviewrouter_sdk_growth_schema_observer:secret@db/reviewrouter",
};
const migrationSql = readFileSync(
  `packages/platform/db/prisma/migrations/${sdkGrowthApplicationSchemaContract.target.migrationName}/migration.sql`,
  "utf8",
);

describe("SDK growth pinned application-schema executor", () => {
  it("requires exact source, service, image, target and restricted-role bindings", () => {
    const result = validateSdkGrowthSchemaExecutorEnvironment(
      environment,
      head,
    );
    expect(result.databaseIdentity).toBe(
      environment.REVIEW_ROUTER_SDK_GROWTH_DATABASE_IDENTITY,
    );
    expect(result.migrationSql).toBe(migrationSql);
    for (const change of [
      { REVIEW_ROUTER_API_SERVICE_REVISION: "c".repeat(40) },
      { REVIEW_ROUTER_WORKER_SERVICE_REVISION: "c".repeat(40) },
      { REVIEW_ROUTER_RELEASE_CONFIG_REVISION: "c".repeat(40) },
      { REVIEW_ROUTER_RELEASE_IMAGE_DIGEST: "latest" },
      { REVIEW_ROUTER_SDK_GROWTH_DATABASE_IDENTITY: "unbound" },
      { REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED: "1" },
    ])
      expect(() =>
        validateSdkGrowthSchemaExecutorEnvironment(
          { ...environment, ...change },
          head,
        ),
      ).toThrow(/binding_rejected|activation_hold_rejected/u);
    expect(() =>
      validateSdkGrowthSchemaExecutorEnvironment(
        {
          ...environment,
          REVIEW_ROUTER_SCHEMA_OWNER_COORDINATOR_DATABASE_URL:
            "postgresql://postgres:secret@db/reviewrouter",
        },
        head,
      ),
    ).toThrow("database_role_rejected");
  });

  it("renders one locked transaction with exact ledger and bounded grants", () => {
    const sql = renderSdkGrowthSchemaExecutorSql({
      databaseIdentity,
      migrationSql,
    });
    expect(sql.match(/^BEGIN;$/gmu)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gmu)).toHaveLength(1);
    expect(sql).toContain("pg_advisory_xact_lock(1381126735,1396983635)");
    expect(sql).toContain(
      sdkGrowthApplicationSchemaContract.predecessor.checksum,
    );
    expect(sql).toContain(sdkGrowthApplicationSchemaContract.target.checksum);
    expect(sql).toContain("sdk_growth_schema_executor_target_ledger_rejected");
    expect(sql).toContain("WITH ADMIN FALSE, INHERIT TRUE, SET TRUE");
    expect(sql).toContain(
      "REVOKE reviewrouter_release_schema_owner FROM reviewrouter",
    );
    expect(sql).toContain("GRANT SELECT,INSERT,UPDATE,DELETE");
    expect(sql).toContain("REVOKE ALL ON TABLE public._prisma_migrations");
    expect(sql).toContain("observer_memberships");
    expect(sql).toContain(
      "has_table_privilege('reviewrouter_sdk_growth_schema_observer',relation_oid",
    );
    expect(sql).toContain(
      "has_column_privilege('reviewrouter_sdk_growth_schema_observer',attribute.attrelid",
    );
    expect(sql.indexOf("has_column_privilege")).toBeLessThan(
      sql.indexOf("-- sdk-growth-executor-before-commit"),
    );
    expect(sql).not.toMatch(/GRANT (?:ALL|CREATE) /u);
    expect(sql.indexOf(migrationSql)).toBeGreaterThan(sql.indexOf("BEGIN;"));
    expect(sql.indexOf(migrationSql)).toBeLessThan(sql.indexOf("COMMIT;"));
  });

  it("keeps mutation credentials protected and activation explicitly on HOLD", () => {
    const workflow = readFileSync(
      ".github/workflows/sdk-growth-application-schema-checkpoint.yml",
      "utf8",
    );
    const trust = workflow.slice(
      workflow.indexOf("  trust-bootstrap:"),
      workflow.indexOf("  checkpoint:"),
    );
    const protectedJob = workflow.slice(workflow.indexOf("  checkpoint:"));
    expect(trust).not.toContain("secrets.");
    expect(workflow).toContain("APPLY_PINNED_SDK_GROWTH_000105");
    expect(protectedJob).toContain(
      "secrets.REVIEW_ROUTER_SCHEMA_OWNER_COORDINATOR_DATABASE_URL",
    );
    expect(protectedJob).toContain(
      "node scripts/execute-sdk-growth-application-schema.mjs",
    );
    const executor = readFileSync(
      "scripts/execute-sdk-growth-application-schema.mjs",
      "utf8",
    );
    expect(executor).toContain('activationStatus: "HOLD"');
    expect(executor).not.toContain('activationStatus: "ACTIVE"');
  });
});
