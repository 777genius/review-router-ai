import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSelfHostedDatabasePlan } from "./install-database.ts";

const postgresPassword = Buffer.alloc(32, 11).toString("base64url");
const authorityPassword = Buffer.alloc(32, 29).toString("base64url");
const role = "reviewrouter_codex_effect_authority";
const authorityUrlKey = "REVIEW_ROUTER_CODEX_EFFECT_AUTHORITY_DATABASE_URL";

function environment(): Record<string, string> {
  return {
    POSTGRES_USER: "reviewrouter",
    POSTGRES_DB: "review_router",
    POSTGRES_PASSWORD: postgresPassword,
    DATABASE_URL: `postgresql://reviewrouter:${postgresPassword}@postgres:5432/review_router?schema=public`,
    [authorityUrlKey]: `postgresql://${role}:${authorityPassword}@postgres:5432/review_router?schema=public`,
  };
}

test("stock Compose plan binds the saved role and credential without provisioning release authority", () => {
  const env = environment();
  const plan = buildSelfHostedDatabasePlan(env);
  assert.deepEqual(buildSelfHostedDatabasePlan({ ...env }), plan);
  assert.equal(Object.isFrozen(plan), true);
  assert.match(plan.preMigrationSql, /self_hosted_database_role_prepared/u);
  assert.match(plan.postMigrationSql, /self_hosted_database_role_ready/u);
  assert.match(
    plan.preMigrationSql,
    /NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/u,
  );
  assert.match(
    plan.preMigrationSql,
    /self_hosted_database_fresh_install_required/u,
  );
  assert.match(plan.preMigrationSql, /shobj_description/u);
  assert.match(plan.preMigrationSql, /pg_auth_members/u);
  assert.match(plan.preMigrationSql, /pg_shdepend/u);
  assert.equal(plan.preMigrationSql.match(/CREATE ROLE /gu)?.length, 1);
  assert.doesNotMatch(
    plan.preMigrationSql,
    /\b(?:ALTER ROLE|GRANT|DROP|DELETE|TRUNCATE)\s/gu,
  );
  assert.doesNotMatch(
    plan.postMigrationSql,
    /\b(?:CREATE ROLE|ALTER ROLE|GRANT|COMMENT ON|DROP)\s/gu,
  );
  assert.doesNotMatch(
    JSON.stringify(plan),
    /consumedMigrationEvidence|disposable-release-role|synthetic/iu,
  );
  assert.doesNotMatch(JSON.stringify(plan), new RegExp(postgresPassword, "u"));
});

test("post-migration verification authenticates the actual credential through Compose DNS", () => {
  const { postMigrationSql } = buildSelfHostedDatabasePlan(environment());
  assert.match(postMigrationSql, /has_function_privilege/u);
  assert.match(postMigrationSql, /CodexOAuthDatabaseAuthorityKey/u);
  assert.match(postMigrationSql, /CodexOAuthDatabaseAuthorityReceipt/u);
  assert.match(postMigrationSql, /has_any_column_privilege/u);
  assert(
    postMigrationSql.includes(`\\setenv PGPASSWORD ${authorityPassword}\n`),
  );
  assert.match(
    postMigrationSql,
    /\\connect -reuse-previous=off 'host=postgres port=5432 dbname=review_router user=reviewrouter_codex_effect_authority connect_timeout=10'/u,
  );
  assert.match(postMigrationSql, /\\setenv PGPASSWORD\n/u);
  assert.doesNotMatch(postMigrationSql, /password=/iu);
});

test("local environment fields must identify the exact same dedicated Compose database", () => {
  const changes: ReadonlyArray<Readonly<Record<string, string | undefined>>> = [
    { POSTGRES_USER: "postgres; SELECT 1" },
    { POSTGRES_USER: "reviewrouter_api" },
    { POSTGRES_DB: "postgres" },
    { POSTGRES_DB: "template1" },
    { POSTGRES_DB: "review_router'" },
    { POSTGRES_PASSWORD: "changed" },
    { DATABASE_URL: undefined },
    { [authorityUrlKey]: undefined },
    {
      DATABASE_URL: `postgresql://reviewrouter:${postgresPassword}@external:5432/review_router`,
    },
    {
      DATABASE_URL: `postgresql://reviewrouter:${postgresPassword}@postgres:5433/review_router`,
    },
    {
      DATABASE_URL: `postgresql://reviewrouter:${postgresPassword}@postgres:5432/other`,
    },
    {
      DATABASE_URL: `postgresql://reviewrouter:${postgresPassword}@postgres:5432/review_router?schema=private`,
    },
    {
      DATABASE_URL: `postgresql://reviewrouter:${postgresPassword}@postgres:5432/review_router?schema=public&schema=public`,
    },
    {
      DATABASE_URL: `postgresql://reviewrouter:${postgresPassword}@postgres:5432/review_router?options=-c%20role%3Dpostgres`,
    },
  ];
  for (const change of changes) {
    assert.throws(
      () => buildSelfHostedDatabasePlan({ ...environment(), ...change }),
      { message: "self_hosted_database_configuration_invalid" },
    );
  }
});

test("authority URL cannot substitute another role, database, endpoint or interpolation", () => {
  const invalidUrls = [
    `postgresql://reviewrouter:${authorityPassword}@postgres:5432/review_router`,
    `postgresql://${role}:${authorityPassword}@outside:5432/review_router`,
    `postgresql://${role}:${authorityPassword}@postgres:5433/review_router`,
    `postgresql://${role}:${authorityPassword}@postgres:5432/another_db`,
    `postgresql://${role}:${authorityPassword}@postgres:5432/review_router#fragment`,
    `postgresql://${role}:${authorityPassword}@postgres:5432/review_router?schema=private`,
    `postgresql://${role}:${authorityPassword}@postgres:5432/review_router?host=outside`,
    `postgresql://${role}:${authorityPassword}@postgres:5432/review_router?sslmode=disable`,
    `https://${role}:${authorityPassword}@postgres:5432/review_router`,
    `postgresql://${role}:%not-a-percent-escape@postgres:5432/review_router`,
    `postgresql://${role}:\${GENERATED_PASSWORD}@postgres:5432/review_router`,
  ];
  for (const url of invalidUrls) {
    assert.throws(
      () =>
        buildSelfHostedDatabasePlan({
          ...environment(),
          [authorityUrlKey]: url,
        }),
      { message: "self_hosted_database_configuration_invalid" },
    );
  }
});

test("authority credentials must be independent, sufficiently long and safe for psql input", () => {
  for (const secret of [
    postgresPassword,
    "short",
    "a".repeat(32),
    "A".repeat(42) + "B", // Non-canonical base64url trailing bits.
    authorityPassword + "=",
    authorityPassword + "'",
    authorityPassword + "\n\\! touch foreign",
    authorityPassword + "${HOME}",
  ]) {
    const url = new URL(environment()[authorityUrlKey]!);
    url.password = secret;
    assert.throws(
      () =>
        buildSelfHostedDatabasePlan({
          ...environment(),
          [authorityUrlKey]: url.href,
        }),
      { message: "self_hosted_database_configuration_invalid" },
    );
  }
});

test("equivalent default port and schema syntax retain the same ownership binding", () => {
  const env = environment();
  const original = buildSelfHostedDatabasePlan(env);
  env.DATABASE_URL = env
    .DATABASE_URL!.replace(":5432", "")
    .replace("?schema=public", "");
  env[authorityUrlKey] = env[authorityUrlKey]!.replace(":5432", "");
  assert.deepEqual(buildSelfHostedDatabasePlan(env), original);
});

test("a changed saved credential changes the binding instead of permitting a password reset", () => {
  const env = environment();
  const original = buildSelfHostedDatabasePlan(env);
  const url = new URL(env[authorityUrlKey]!);
  url.password = Buffer.alloc(32, 42).toString("base64url");
  const changed = buildSelfHostedDatabasePlan({
    ...env,
    [authorityUrlKey]: url.href,
  });
  const binding = (sql: string) =>
    sql.match(/effect-authority:v1:([0-9a-f]{64}):/u)?.[1];
  assert(binding(original.preMigrationSql));
  assert.notEqual(
    binding(original.preMigrationSql),
    binding(changed.preMigrationSql),
  );
  assert.doesNotMatch(changed.preMigrationSql, /ALTER ROLE/u);
});
