import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  assertSdkGrowthApplicationSchemaCheckpoint,
  executeSdkGrowthApplicationSchemaCheckpoint,
  observeSdkGrowthApplicationSchemaCheckpoint,
  observeSdkGrowthDatabaseIdentity,
  sdkGrowthApplicationSchemaContract,
  sdkGrowthApplicationSchemaObservationSql,
  sdkGrowthApplicationSchemaObserverGrantSql,
  sdkGrowthApplicationSchemaShape,
  sdkGrowthDatabaseIdentityDigest,
  sdkGrowthFinalizedReportShape,
  sdkGrowthReleaseLoginProbeSql,
  validateSdkGrowthCheckpointEnvironment,
} from "./sdk-growth-application-schema-checkpoint.mjs";
import {
  executeSdkGrowthApplicationSchema,
  renderSdkGrowthSchemaExecutorSql,
} from "./execute-sdk-growth-application-schema.mjs";
import { runSecretSafePostgresCommand } from "./lib/secret-safe-command-boundary.mjs";

const restrictedRole = Object.freeze({
  exists: true,
  login: true,
  inherit: false,
  superuser: false,
  createDatabase: false,
  createRole: false,
  replication: false,
  bypassRls: false,
});
const applied = (checksum: string) => [
  { checksum, finished: true, rolledBack: false, appliedStepsCount: 1 },
];
const privileges = (role: string) => ({
  role,
  select: true,
  insert: true,
  update: true,
  delete: true,
  truncate: false,
  references: false,
  trigger: false,
});
const noPrivileges = Object.freeze({
  select: false,
  insert: false,
  update: false,
  delete: false,
  truncate: false,
  references: false,
  trigger: false,
});

function functionSource(migrationName: string) {
  const source = readFileSync(
    resolve(
      "packages/platform/db/prisma/migrations",
      migrationName,
      "migration.sql",
    ),
    "utf8",
  );
  const match =
    /CREATE FUNCTION sdk_growth_publication_preserve\(\) RETURNS trigger[\s\S]+?AS \$\$([\s\S]+?)\$\$;/u.exec(
      source,
    );
  if (!match?.[1]) throw new Error("test_function_source_missing");
  return match[1];
}

function releaseProbe() {
  return {
    sessionUser: sdkGrowthApplicationSchemaContract.releaseRole,
    currentUser: sdkGrowthApplicationSchemaContract.releaseRole,
    releaseRole: { ...restrictedRole, inherit: true },
    ledgerSelect: true,
    publicationPrivileges: noPrivileges,
  };
}

function commonObservation() {
  return {
    postgresVersion: 170010,
    sessionUser: sdkGrowthApplicationSchemaContract.observerRole,
    currentUser: sdkGrowthApplicationSchemaContract.observerRole,
    observerRole: restrictedRole,
    observerSchemaPrivileges: { usage: true, create: false },
    releaseProbe: releaseProbe(),
    predecessor: applied(
      sdkGrowthApplicationSchemaContract.predecessor.checksum,
    ),
    laterMigrationCount: 0,
    legacyRowCount: 0,
    finalizedReportRowCount: 0,
    triggers: sdkGrowthApplicationSchemaShape.triggers,
    observerGrants: [
      {
        schema: "public",
        table: "SdkGrowthFinalizedReportEvidence",
        privilege: "SELECT",
      },
      {
        schema: "public",
        table: "SdkGrowthPublicationEffect",
        privilege: "SELECT",
      },
      { schema: "public", table: "_prisma_migrations", privilege: "SELECT" },
    ],
    observerTablePrivileges: [
      {
        schema: "public",
        table: "SdkGrowthFinalizedReportEvidence",
        ...noPrivileges,
        select: true,
      },
      {
        schema: "public",
        table: "SdkGrowthPublicationEffect",
        ...noPrivileges,
        select: true,
      },
      {
        schema: "public",
        table: "_prisma_migrations",
        ...noPrivileges,
        select: true,
      },
    ],
    observerColumnWrites: [],
    observerMemberships: [],
  };
}

function preflight() {
  return {
    ...commonObservation(),
    target: [],
    columns: sdkGrowthApplicationSchemaShape.preflightColumns,
    constraints: sdkGrowthApplicationSchemaShape.preflightConstraints,
    indexes: [],
    ownership: {
      tableOwner: "reviewrouter_release_schema_owner",
      functionOwner: "reviewrouter_release_schema_owner",
      functionConfig: ["search_path=pg_catalog, pg_temp"],
      functionSecurityDefiner: false,
      functionVolatility: "v",
      functionSource: functionSource("000103_sdk_growth_authority_custody"),
      publicCanExecute: false,
    },
    runtimeRoles: [],
  };
}

function postflight() {
  return {
    ...commonObservation(),
    target: applied(sdkGrowthApplicationSchemaContract.target.checksum),
    columns: sdkGrowthApplicationSchemaShape.columns,
    constraints: sdkGrowthApplicationSchemaShape.constraints,
    indexes: [sdkGrowthApplicationSchemaShape.index],
    ownership: {
      tableOwner: "reviewrouter_release_schema_owner",
      functionOwner: "reviewrouter_release_schema_owner",
      functionConfig: ["search_path=pg_catalog, pg_temp"],
      functionSecurityDefiner: false,
      functionVolatility: "v",
      functionSource: functionSource(
        sdkGrowthApplicationSchemaContract.target.migrationName,
      ),
      publicCanExecute: false,
    },
    runtimeRoles: [
      privileges("reviewrouter_api"),
      privileges("reviewrouter_worker"),
    ],
  };
}

function logicalIdentity(appliedTarget: boolean) {
  return {
    ...postflight(),
    predecessor: applied(
      sdkGrowthApplicationSchemaContract.logicalIdentity.predecessor.checksum,
    ),
    target: appliedTarget
      ? applied(
          sdkGrowthApplicationSchemaContract.logicalIdentity.target.checksum,
        )
      : [],
    finalizedReportConstraints: [
      ...sdkGrowthFinalizedReportShape.constraints,
      ...(appliedTarget
        ? []
        : [sdkGrowthFinalizedReportShape.digestConstraint]),
    ].sort(),
    finalizedReportColumns: sdkGrowthFinalizedReportShape.columns,
    finalizedReportDigestIndexes: appliedTarget ? 0 : 1,
    finalizedReportConstraintDigest: appliedTarget
      ? sdkGrowthFinalizedReportShape.postflightConstraintDigest
      : sdkGrowthFinalizedReportShape.preflightConstraintDigest,
    finalizedReportTrigger: {
      name: sdkGrowthFinalizedReportShape.immutableTrigger,
      enabled: "O",
      type: 58,
      functionSchema: "public",
      functionName: "sdk_growth_verifier_evidence_preserve",
      functionOid: "16384",
      constraint: false,
      when: null,
      updateColumns: "",
    },
    finalizedReportOwnership: {
      tableOwner: "reviewrouter_release_schema_owner",
      functionOwner: "reviewrouter_release_schema_owner",
      functionOid: "16384",
      functionConfig: ["search_path=pg_catalog, pg_temp"],
      functionSecurityDefiner: false,
      functionVolatility: "v",
      functionSource: readFileSync(
        "packages/platform/db/prisma/migrations/000103_sdk_growth_authority_custody/migration.sql",
        "utf8",
      ).match(
        /CREATE FUNCTION sdk_growth_verifier_evidence_preserve\(\) RETURNS trigger[\s\S]+?AS \$\$([\s\S]+?)\$\$;/u,
      )![1],
      publicCanExecute: false,
    },
  };
}

describe("SDK growth application-schema checkpoint", () => {
  it("keeps credentials behind a credential-free protected-environment bootstrap", () => {
    const workflow = readFileSync(
      ".github/workflows/sdk-growth-application-schema-checkpoint.yml",
      "utf8",
    );
    const trust = workflow.slice(
      workflow.indexOf("  trust-bootstrap:"),
      workflow.indexOf("  checkpoint:"),
    );
    const checkpoint = workflow.slice(workflow.indexOf("  checkpoint:"));
    expect(trust).toContain("// trust-bootstrap-node:start");
    expect(trust).toContain(
      "environment.deployment_branch_policy?.protected_branches !== true",
    );
    expect(trust).toContain("reviewers.reviewers.length < 1");
    expect(trust).toMatch(/permissions:\n\s+actions: read\n\s+contents: read/u);
    expect(trust).not.toContain("secrets.");
    expect(checkpoint).toContain("needs: trust-bootstrap");
    expect(checkpoint).toContain(
      "environment: production-sdk-growth-schema-checkpoint",
    );
    expect(checkpoint).toContain(
      "secrets.REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL",
    );
  });

  it("keeps the historical96/managed92 rehearsal independent", () => {
    const historical = readFileSync(
      "scripts/rehearse-private-pg17-rollout.mjs",
      "utf8",
    );
    expect(historical).not.toContain(
      "sdk-growth-application-schema-checkpoint.mjs",
    );
    expect(historical).not.toContain("sdkGrowthApplicationSchema");
  });

  it("uses separate restricted observer and real release-login contracts", () => {
    const observationSql = sdkGrowthApplicationSchemaObservationSql();
    const releaseSql = sdkGrowthReleaseLoginProbeSql();
    const grants = sdkGrowthApplicationSchemaObserverGrantSql();
    expect(observationSql).toContain("reviewrouter_sdk_growth_schema_observer");
    expect(observationSql).toContain("observerColumnWrites");
    expect(observationSql).toContain("observerMemberships");
    expect(observationSql).toContain("'databaseIdentity'");
    expect(releaseSql).toContain("session_user");
    expect(releaseSql).toContain("publicationPrivileges");
    expect(releaseSql).toContain("'databaseIdentity'");
    expect(grants).toContain(
      'GRANT SELECT ON TABLE public."SdkGrowthPublicationEffect"',
    );
    expect(grants).toContain("GRANT USAGE ON SCHEMA public");
    expect(grants).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|TRUNCATE|ALL)/u);
    expect(observationSql).not.toContain("password");
  });

  it("accepts exact preflight and postflight semantics", () => {
    expect(
      assertSdkGrowthApplicationSchemaCheckpoint(preflight(), {
        phase: "preflight",
      }),
    ).toEqual(preflight());
    expect(
      assertSdkGrowthApplicationSchemaCheckpoint(postflight(), {
        phase: "postflight",
      }),
    ).toEqual(postflight());
  });

  it("accepts exact 000106 states and rejects digest or legacy-row drift", () => {
    expect(
      assertSdkGrowthApplicationSchemaCheckpoint(logicalIdentity(false), {
        phase: "preflight-000106",
      }),
    ).toBeTruthy();
    expect(
      assertSdkGrowthApplicationSchemaCheckpoint(logicalIdentity(true), {
        phase: "postflight-000106",
      }),
    ).toBeTruthy();
    expect(() =>
      assertSdkGrowthApplicationSchemaCheckpoint(
        { ...logicalIdentity(true), finalizedReportDigestIndexes: 1 },
        { phase: "postflight-000106" },
      ),
    ).toThrow("logical_identity_rejected");
    expect(() =>
      assertSdkGrowthApplicationSchemaCheckpoint(
        { ...logicalIdentity(false), finalizedReportRowCount: 1 },
        { phase: "preflight-000106" },
      ),
    ).toThrow("legacy_rows_rejected");
    expect(() =>
      assertSdkGrowthApplicationSchemaCheckpoint(
        {
          ...logicalIdentity(false),
          finalizedReportColumns: sdkGrowthFinalizedReportShape.columns.map(
            (column) =>
              column.name === "grantId" ? { ...column, type: "text" } : column,
          ),
        },
        { phase: "preflight-000106" },
      ),
    ).toThrow("logical_identity_rejected");
    expect(() =>
      assertSdkGrowthApplicationSchemaCheckpoint(
        {
          ...logicalIdentity(true),
          finalizedReportColumns: sdkGrowthFinalizedReportShape.columns.map(
            (column) =>
              column.name === "finalizedReport"
                ? { ...column, notNull: false }
                : column,
          ),
        },
        { phase: "postflight-000106" },
      ),
    ).toThrow("logical_identity_rejected");
    expect(() =>
      assertSdkGrowthApplicationSchemaCheckpoint(
        {
          ...logicalIdentity(false),
          finalizedReportTrigger: {
            ...logicalIdentity(false).finalizedReportTrigger,
            when: "false",
          },
        },
        { phase: "preflight-000106" },
      ),
    ).toThrow("logical_identity_rejected");
    expect(() =>
      assertSdkGrowthApplicationSchemaCheckpoint(
        {
          ...logicalIdentity(true),
          finalizedReportTrigger: {
            ...logicalIdentity(true).finalizedReportTrigger,
            functionOid: "16385",
          },
        },
        { phase: "postflight-000106" },
      ),
    ).toThrow("logical_identity_rejected");
  });

  it.each([
    [
      "disabled immutability trigger",
      () => ({
        ...postflight(),
        triggers: postflight().triggers.map((trigger) =>
          trigger.name === "sdk_growth_publication_immutable"
            ? { ...trigger, enabled: "D" }
            : trigger,
        ),
      }),
    ],
    [
      "column-restricted immutability trigger",
      () => ({
        ...postflight(),
        triggers: postflight().triggers.map((trigger) =>
          trigger.name === "sdk_growth_publication_immutable"
            ? { ...trigger, updateColumns: "10" }
            : trigger,
        ),
      }),
    ],
    [
      "nonunique same-name index",
      () => ({
        ...postflight(),
        indexes: [{ ...sdkGrowthApplicationSchemaShape.index, unique: false }],
      }),
    ],
    [
      "wrong same-name index key",
      () => ({
        ...postflight(),
        indexes: [
          {
            ...sdkGrowthApplicationSchemaShape.index,
            keyColumns: ["intentId"],
          },
        ],
      }),
    ],
    [
      "weakened same-name constraint",
      () => ({
        ...postflight(),
        constraints: postflight().constraints.map((constraint) =>
          constraint.name === "SdkGrowthPublicationEffect_state_check"
            ? { ...constraint, definition: "CHECK (true)" }
            : constraint,
        ),
      }),
    ],
    [
      "observer effective column write privilege",
      () => ({
        ...postflight(),
        observerColumnWrites: [
          {
            schema: "public",
            table: "_prisma_migrations",
            column: "finished_at",
            insert: false,
            update: true,
            references: false,
          },
        ],
      }),
    ],
    [
      "observer inherited or SET ROLE membership",
      () => ({
        ...postflight(),
        observerMemberships: [
          {
            role: "reviewrouter_sdk_growth_schema_writer_probe",
            admin: false,
            inherit: false,
            set: true,
          },
        ],
      }),
    ],
    [
      "observer schema create privilege",
      () => ({
        ...postflight(),
        observerSchemaPrivileges: { usage: true, create: true },
      }),
    ],
  ])("rejects %s", (_name, fixture) => {
    expect(() =>
      assertSdkGrowthApplicationSchemaCheckpoint(fixture(), {
        phase: "postflight",
      }),
    ).toThrow(/semantics|observer_permissions/u);
  });

  it("requires both exact database identities and honest configured flags", () => {
    const head = "a".repeat(40);
    const environment = {
      REVIEW_ROUTER_SDK_GROWTH_SCHEMA_CHECKPOINT_PHASE: "preflight",
      REVIEW_ROUTER_RELEASE_COMMIT_SHA: head,
      REVIEW_ROUTER_RELEASE_MIGRATION_DATABASE_URL:
        "postgresql://reviewrouter_release_migration:secret@db/reviewrouter",
      REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL:
        "postgresql://reviewrouter_sdk_growth_schema_observer:secret@db/reviewrouter",
      REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED: "0",
      REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
    };
    expect(
      validateSdkGrowthCheckpointEnvironment(environment, head).phase,
    ).toBe("preflight");
    expect(() =>
      validateSdkGrowthCheckpointEnvironment(
        {
          ...environment,
          REVIEW_ROUTER_SDK_GROWTH_SCHEMA_CHECKPOINT_PHASE: "postflight",
        },
        head,
      ),
    ).toThrow("database_identity_rejected");
    expect(() =>
      validateSdkGrowthCheckpointEnvironment(
        {
          ...environment,
          REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL:
            "postgresql://reviewrouter_release_migration:secret@db/reviewrouter",
        },
        head,
      ),
    ).toThrow("database_role_rejected");
    const source = readFileSync(
      "scripts/sdk-growth-application-schema-checkpoint.mjs",
      "utf8",
    );
    expect(source).toContain("runSecretSafePostgresCommand");
    expect(source).toContain('deployedRuntimeConfiguration: "unverified"');
    expect(source).not.toContain("args: [configuration.releaseDatabaseUrl");
  });

  it("rejects a mocked database switch between identity-bound catalog probes", () => {
    const identity = {
      systemIdentifier: "7522147049465590841",
      databaseOid: "16384",
      databaseName: "reviewrouter",
      postgresVersion: 170010,
    };
    const switchedIdentity = {
      ...identity,
      databaseOid: "16385",
      databaseName: "proxy_switched",
    };
    const configuration = {
      releaseDatabaseUrl: new URL(
        "postgresql://reviewrouter_release_migration:secret@db/reviewrouter",
      ),
      observerDatabaseUrl: new URL(
        "postgresql://reviewrouter_sdk_growth_schema_observer:secret@db/reviewrouter",
      ),
      expectedDatabaseIdentity: sdkGrowthDatabaseIdentityDigest(identity),
    };
    const probe = (databaseUrl: URL) =>
      databaseUrl.username === sdkGrowthApplicationSchemaContract.releaseRole
        ? {
            ...releaseProbe(),
            databaseIdentity: {
              ...switchedIdentity,
              sessionUser: sdkGrowthApplicationSchemaContract.releaseRole,
              currentUser: sdkGrowthApplicationSchemaContract.releaseRole,
            },
          }
        : {
            databaseIdentity: {
              ...switchedIdentity,
              sessionUser: sdkGrowthApplicationSchemaContract.observerRole,
              currentUser: sdkGrowthApplicationSchemaContract.observerRole,
            },
          };
    expect(() =>
      observeSdkGrowthApplicationSchemaCheckpoint(configuration, probe),
    ).toThrow("sdk_growth_schema_checkpoint_database_target_rejected");
  });
});

const requirePg17 =
  process.env.REVIEW_ROUTER_REQUIRE_SDK_GROWTH_SCHEMA_PG17 === "1";
const describePg17 = requirePg17 ? describe : describe.skip;

describePg17("SDK growth separate disposable PG17 migration rehearsal", () => {
  it("rehearses actual 000104 to 000105 to 000106 with real restricted logins", async () => {
    const token = randomUUID();
    const name = `rr-sdk-schema-${token}`;
    const image =
      "postgres:17.10@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317";
    const root = mkdtempSync(
      join(process.cwd(), ".sdk-growth-schema-rehearsal."),
    );
    let created = false;
    let rehearsalPhase = "container-start";
    let executionError: unknown;
    let cleanupError: Error | undefined;
    const command = (
      executable: string,
      args: string[],
      options: { env?: NodeJS.ProcessEnv; input?: string } = {},
    ) => {
      const result = spawnSync(executable, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        env: options.env ?? process.env,
        input: options.input,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (result.status !== 0 || result.error) {
        const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
          .replaceAll(
            /postgres(?:ql)?:\/\/[^@\s]+@/giu,
            "postgresql://[redacted]@",
          )
          .slice(-4_000);
        throw new Error(
          `sdk_growth_pg17_rehearsal_command_failed:${diagnostic}`,
        );
      }
      return result.stdout.trim();
    };
    const docker = (args: string[]) => command("docker", args);
    try {
      expect(
        docker([
          "context",
          "inspect",
          "--format",
          "{{.Endpoints.docker.Host}}",
        ]),
      ).toMatch(/^unix:\/\//u);
      docker(["image", "inspect", image]);
      docker([
        "create",
        "--pull=never",
        "--name",
        name,
        "--label",
        `reviewrouter.sdk-schema.proof=${token}`,
        "--publish",
        "127.0.0.1::5432",
        "--env",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        image,
      ]);
      created = true;
      docker(["start", name]);
      const port = docker(["port", name, "5432/tcp"]).replace(
        /^127\.0\.0\.1:/u,
        "",
      );
      expect(port).toMatch(/^\d+$/u);
      const adminUrl = `postgresql://postgres:local-test@127.0.0.1:${port}/postgres`;
      let ready = false;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
          runSecretSafePostgresCommand({
            databaseUrl: adminUrl,
            args: ["-XqAt"],
            input: "SELECT 1;",
            timeoutMs: 1_000,
          });
          ready = true;
          break;
        } catch {
          // The uniquely named local container is still starting.
          await new Promise((resolveReady) => setTimeout(resolveReady, 250));
        }
      }
      expect(ready).toBe(true);
      const admin = (sql: string) =>
        runSecretSafePostgresCommand({
          databaseUrl: adminUrl,
          args: ["-XqAt", "-v", "ON_ERROR_STOP=1"],
          input: sql,
          timeoutMs: 30_000,
        });
      const prismaRoot = join(root, "prisma");
      cpSync("packages/platform/db/prisma", prismaRoot, { recursive: true });
      for (const migration of [
        sdkGrowthApplicationSchemaContract.target,
        sdkGrowthApplicationSchemaContract.logicalIdentity.target,
      ])
        rmSync(join(prismaRoot, "migrations", migration.migrationName), {
          recursive: true,
        });
      const fixtureMigrations = readdirSync(join(prismaRoot, "migrations"))
        .filter((name) => /^\d{6}_/u.test(name))
        .sort();
      for (const migration of fixtureMigrations) {
        if (
          migration >
          sdkGrowthApplicationSchemaContract.predecessor.migrationName
        ) {
          rmSync(join(prismaRoot, "migrations", migration), {
            recursive: true,
          });
        }
      }
      const historicalMigrations = readdirSync(join(prismaRoot, "migrations"))
        .filter((name) => /^\d{6}_/u.test(name))
        .sort();
      expect(historicalMigrations.at(-1)).toBe(
        sdkGrowthApplicationSchemaContract.predecessor.migrationName,
      );
      const configPath = join(root, "prisma.config.ts");
      writeFileSync(
        configPath,
        `import { defineConfig } from "prisma/config";\nexport default defineConfig({schema:${JSON.stringify(join(prismaRoot, "schema.prisma"))},migrations:{path:${JSON.stringify(join(prismaRoot, "migrations"))}},datasource:{url:process.env.DATABASE_URL ?? ""}});\n`,
      );
      const migrate = () =>
        command(
          resolve("node_modules/.bin/prisma"),
          ["migrate", "deploy", "--config", configPath],
          { env: { ...process.env, DATABASE_URL: adminUrl } },
        );
      rehearsalPhase = "migrate-through-000104";
      migrate();
      rehearsalPhase = "role-and-owner-setup";
      admin(`CREATE ROLE reviewrouter_release_schema_owner NOLOGIN;
CREATE ROLE reviewrouter LOGIN PASSWORD 'coordinator-test' INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE reviewrouter_release_migration LOGIN PASSWORD 'release-test' INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE reviewrouter_sdk_growth_schema_observer LOGIN PASSWORD 'observer-test' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE reviewrouter_api NOLOGIN;
CREATE ROLE reviewrouter_worker NOLOGIN;
ALTER DATABASE postgres OWNER TO reviewrouter;
ALTER SCHEMA public OWNER TO reviewrouter_release_schema_owner;
ALTER TABLE public._prisma_migrations OWNER TO reviewrouter;
GRANT reviewrouter_release_schema_owner TO reviewrouter
  WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;`);
      const convergeGrants = () =>
        admin(`ALTER TABLE public."SdkGrowthPublicationEffect" OWNER TO reviewrouter_release_schema_owner;
ALTER FUNCTION public.sdk_growth_publication_preserve() OWNER TO reviewrouter_release_schema_owner;
ALTER TABLE public."SdkGrowthFinalizedReportEvidence" OWNER TO reviewrouter_release_schema_owner;
ALTER FUNCTION public.sdk_growth_verifier_evidence_preserve() OWNER TO reviewrouter_release_schema_owner;
REVOKE ALL ON FUNCTION public.sdk_growth_publication_preserve() FROM PUBLIC;
GRANT SELECT ON TABLE public._prisma_migrations TO reviewrouter_release_migration;
${sdkGrowthApplicationSchemaObserverGrantSql()}
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SdkGrowthPublicationEffect" TO reviewrouter_api, reviewrouter_worker;`);
      convergeGrants();
      const head = command("git", ["rev-parse", "HEAD"]);
      const coordinatorDatabaseUrl = `postgresql://reviewrouter:coordinator-test@127.0.0.1:${port}/postgres`;
      const environment = {
        REVIEW_ROUTER_RELEASE_COMMIT_SHA: head,
        REVIEW_ROUTER_RELEASE_CONFIG_REVISION: head,
        REVIEW_ROUTER_API_SERVICE_REVISION: head,
        REVIEW_ROUTER_WORKER_SERVICE_REVISION: head,
        REVIEW_ROUTER_RELEASE_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
        REVIEW_ROUTER_SCHEMA_OWNER_COORDINATOR_DATABASE_URL:
          coordinatorDatabaseUrl,
        REVIEW_ROUTER_RELEASE_MIGRATION_DATABASE_URL: `postgresql://reviewrouter_release_migration:release-test@127.0.0.1:${port}/postgres`,
        REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL: `postgresql://reviewrouter_sdk_growth_schema_observer:observer-test@127.0.0.1:${port}/postgres`,
        REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED: "0",
        REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
      };
      const databaseIdentity = observeSdkGrowthDatabaseIdentity(
        coordinatorDatabaseUrl,
      );
      Object.assign(environment, {
        REVIEW_ROUTER_SDK_GROWTH_DATABASE_IDENTITY: databaseIdentity.digest,
        REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OPERATION_PHASE: "apply-000105",
      });
      const checkpoint = (
        phase:
          | "preflight"
          | "postflight"
          | "preflight-000106"
          | "postflight-000106",
      ) =>
        executeSdkGrowthApplicationSchemaCheckpoint({
          ...environment,
          REVIEW_ROUTER_SDK_GROWTH_SCHEMA_CHECKPOINT_PHASE: phase,
        });
      const observer = (sql: string) =>
        runSecretSafePostgresCommand({
          databaseUrl:
            environment.REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL,
          args: ["-XqAt", "-v", "ON_ERROR_STOP=1"],
          input: sql,
          timeoutMs: 30_000,
        }).stdout.trim();
      rehearsalPhase = "initial-preflight";
      expect(checkpoint("preflight").phase).toBe("preflight");

      rehearsalPhase = "public-column-write-atomic-rollback";
      admin(
        `GRANT UPDATE (checksum) ON TABLE public._prisma_migrations TO PUBLIC;`,
      );
      expect(
        observer(`SELECT has_column_privilege(current_user,
          'public._prisma_migrations','checksum','UPDATE');`),
      ).toBe("t");
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expect(
        admin(`SELECT count(*) FROM public._prisma_migrations
          WHERE migration_name='${sdkGrowthApplicationSchemaContract.target.migrationName}';`).stdout.trim(),
      ).toBe("0");
      expect(
        admin(`SELECT (count(*) FILTER (WHERE attname='providerCorrelation'))::text
          || '|' || (count(*) FILTER (WHERE attname='envelopeDigest'))::text
        FROM pg_attribute
        WHERE attrelid='public."SdkGrowthPublicationEffect"'::regclass
          AND attnum>0 AND NOT attisdropped;`).stdout.trim(),
      ).toBe("1|0");
      admin(
        `REVOKE UPDATE (checksum) ON TABLE public._prisma_migrations FROM PUBLIC;`,
      );
      expect(checkpoint("preflight").phase).toBe("preflight");

      rehearsalPhase = "wrong-predecessor";
      admin(`UPDATE public._prisma_migrations SET checksum='${"0".repeat(64)}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.predecessor.migrationName}';`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      admin(`UPDATE public._prisma_migrations
        SET checksum='${sdkGrowthApplicationSchemaContract.predecessor.checksum}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.predecessor.migrationName}';`);

      rehearsalPhase = "legacy-row";
      admin(`SET session_replication_role=replica;
INSERT INTO public."SdkGrowthPublicationEffect"(
  "custodyId","intentId",state,"claimVersion","createdAt","updatedAt"
) VALUES ('legacy-custody','legacy-intent','pending',0,clock_timestamp(),clock_timestamp());
SET session_replication_role=origin;`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      admin(`SET session_replication_role=replica;
DELETE FROM public."SdkGrowthPublicationEffect" WHERE "custodyId"='legacy-custody';
SET session_replication_role=origin;`);

      rehearsalPhase = "wrong-database";
      const wrongDatabase = `wrong_${token.replaceAll("-", "")}`;
      admin(`CREATE DATABASE ${wrongDatabase} OWNER reviewrouter;`);
      expect(() =>
        executeSdkGrowthApplicationSchema({
          ...environment,
          REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL:
            environment.REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL.replace(
              /\/postgres$/u,
              `/${wrongDatabase}`,
            ),
        }),
      ).toThrow("sdk_growth_schema_executor_database_target_rejected");
      admin(`DROP DATABASE ${wrongDatabase};`);

      rehearsalPhase = "advisory-lock";
      const locker = spawn(
        "docker",
        [
          "exec",
          name,
          "psql",
          "-XqAt",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-c",
          "SELECT pg_advisory_lock(1381126735,1396983635); SELECT pg_sleep(8);",
        ],
        { stdio: "ignore" },
      );
      let lockObserved = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (
          admin(`SELECT count(*) FROM pg_locks WHERE locktype='advisory'
            AND classid=1381126735 AND objid=1396983635 AND granted;`).stdout.trim() ===
          "1"
        ) {
          lockObserved = true;
          break;
        }
        await new Promise((resolveLock) => setTimeout(resolveLock, 100));
      }
      expect(lockObserved).toBe(true);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      await new Promise<void>((resolveLocker, rejectLocker) => {
        locker.once("error", rejectLocker);
        locker.once("exit", (code) =>
          code === 0
            ? resolveLocker()
            : rejectLocker(new Error("sdk_growth_test_locker_failed")),
        );
      });

      rehearsalPhase = "interrupted-transaction";
      const migrationSql = readFileSync(
        join(
          "packages/platform/db/prisma/migrations",
          sdkGrowthApplicationSchemaContract.target.migrationName,
          "migration.sql",
        ),
        "utf8",
      );
      const interrupted = renderSdkGrowthSchemaExecutorSql({
        databaseIdentity,
        migrationSql,
      }).replace(
        "-- sdk-growth-executor-before-commit",
        "DO $$ BEGIN RAISE EXCEPTION 'test interruption'; END $$;",
      );
      expect(() =>
        runSecretSafePostgresCommand({
          databaseUrl: coordinatorDatabaseUrl,
          args: ["-XqAt", "-v", "ON_ERROR_STOP=1"],
          input: interrupted,
          timeoutMs: 30_000,
        }),
      ).toThrow();
      expect(
        admin(`SELECT count(*) FROM public._prisma_migrations
          WHERE migration_name='${sdkGrowthApplicationSchemaContract.target.migrationName}';`).stdout.trim(),
      ).toBe("0");
      expect(checkpoint("preflight").phase).toBe("preflight");

      rehearsalPhase = "apply-and-converge";
      admin(`GRANT UPDATE ("updatedAt") ON TABLE public."SdkGrowthPublicationEffect"
        TO reviewrouter_sdk_growth_schema_observer;
GRANT reviewrouter_release_schema_owner TO reviewrouter_sdk_growth_schema_observer
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY reviewrouter;`);
      rehearsalPhase = "execute-first-apply";
      const execution = executeSdkGrowthApplicationSchema(environment);
      expect(execution.outcome).toBe("applied");
      expect(execution.activationStatus).toBe("HOLD");
      rehearsalPhase = "postflight-after-apply";
      expect(checkpoint("postflight").phase).toBe("postflight");
      rehearsalPhase = "exact-retry";
      expect(executeSdkGrowthApplicationSchema(environment).outcome).toBe(
        "already-committed",
      );

      rehearsalPhase = "wrong-target-checksum";
      admin(`UPDATE public._prisma_migrations SET checksum='${"f".repeat(64)}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.target.migrationName}';`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      admin(`UPDATE public._prisma_migrations
        SET checksum='${sdkGrowthApplicationSchemaContract.target.checksum}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.target.migrationName}';`);

      Object.assign(environment, {
        REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OPERATION_PHASE: "apply-000106",
      });
      rehearsalPhase = "preflight-000106";
      expect(checkpoint("preflight-000106").phase).toBe("preflight-000106");

      const originalDigestConstraintOid = admin(`SELECT oid::text
        FROM pg_constraint
        WHERE conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
          AND conname='SdkGrowthFinalizedReportEvidence_digest_key';`).stdout.trim();
      expect(originalDigestConstraintOid).toMatch(/^[1-9][0-9]*$/u);
      const expectUnapplied000106 = () => {
        expect(
          admin(`SELECT count(*) FROM public._prisma_migrations
            WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.target.migrationName}';`).stdout.trim(),
        ).toBe("0");
        expect(
          admin(`SELECT oid::text FROM pg_constraint
            WHERE conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
              AND conname='SdkGrowthFinalizedReportEvidence_digest_key';`).stdout.trim(),
        ).toBe(originalDigestConstraintOid);
      };

      rehearsalPhase = "000106-grant-id-type-drift";
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "grantId" TYPE text;`);
      expect(() => checkpoint("preflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_logical_identity_rejected",
      );
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expectUnapplied000106();
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "grantId" TYPE varchar(2048);`);
      expect(checkpoint("preflight-000106").phase).toBe("preflight-000106");

      rehearsalPhase = "000106-finalized-report-nullability-drift";
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "finalizedReport" DROP NOT NULL;`);
      expect(() => checkpoint("preflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_logical_identity_rejected",
      );
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expectUnapplied000106();
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "finalizedReport" SET NOT NULL;`);
      expect(checkpoint("preflight-000106").phase).toBe("preflight-000106");

      rehearsalPhase = "000106-conditional-immutability-trigger";
      admin(`DROP TRIGGER sdk_growth_finalized_report_immutable
  ON public."SdkGrowthFinalizedReportEvidence";
CREATE TRIGGER sdk_growth_finalized_report_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public."SdkGrowthFinalizedReportEvidence"
  FOR EACH STATEMENT WHEN (false)
  EXECUTE FUNCTION public.sdk_growth_verifier_evidence_preserve();`);
      expect(() => checkpoint("preflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_logical_identity_rejected",
      );
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expectUnapplied000106();
      admin(`DROP TRIGGER sdk_growth_finalized_report_immutable
  ON public."SdkGrowthFinalizedReportEvidence";
CREATE TRIGGER sdk_growth_finalized_report_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE
  ON public."SdkGrowthFinalizedReportEvidence"
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.sdk_growth_verifier_evidence_preserve();`);
      expect(checkpoint("preflight-000106").phase).toBe("preflight-000106");

      rehearsalPhase = "000106-conditional-publication-trigger";
      admin(`DROP TRIGGER sdk_growth_publication_immutable
  ON public."SdkGrowthPublicationEffect";
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OR DELETE
  ON public."SdkGrowthPublicationEffect"
  FOR EACH ROW
  WHEN (false)
  EXECUTE FUNCTION public.sdk_growth_publication_preserve();`);
      expect(() => checkpoint("preflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_semantics_rejected",
      );
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expectUnapplied000106();
      admin(`DROP TRIGGER sdk_growth_publication_immutable
  ON public."SdkGrowthPublicationEffect";
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OR DELETE
  ON public."SdkGrowthPublicationEffect"
  FOR EACH ROW
  EXECUTE FUNCTION public.sdk_growth_publication_preserve();`);
      expect(checkpoint("preflight-000106").phase).toBe("preflight-000106");

      rehearsalPhase = "000106-partial-publication-outbox-index";
      admin(`DROP INDEX public."SdkGrowthPublicationEffect_outbox_event_key";
CREATE UNIQUE INDEX "SdkGrowthPublicationEffect_outbox_event_key"
  ON public."SdkGrowthPublicationEffect"("outboxEventId")
  WHERE false;`);
      expect(() => checkpoint("preflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_semantics_rejected",
      );
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expectUnapplied000106();
      admin(`DROP INDEX public."SdkGrowthPublicationEffect_outbox_event_key";
CREATE UNIQUE INDEX "SdkGrowthPublicationEffect_outbox_event_key"
  ON public."SdkGrowthPublicationEffect"("outboxEventId");`);
      expect(checkpoint("preflight-000106").phase).toBe("preflight-000106");

      rehearsalPhase = "000106-concurrent-uncommitted-report";
      const reportWriter = spawn(
        "docker",
        [
          "exec",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
          "-c",
          `BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO public."SdkGrowthFinalizedReportEvidence"(
  "reportEvidenceId","evidenceId","repositoryId","runId","runAttempt",
  "verifierRevision",producer,"candidateWritable","reportDigest","finalizedReport",
  "grantId",outcome,coverage,"coveredScopes",phases
) VALUES ('concurrent-legacy-report','missing-evidence','repo','run','1','${"2".repeat(40)}',
  'reviewrouter-verifier',false,'sha256:${"3".repeat(64)}',decode('01','hex'),
  'legacy-grant','passed','complete','[]'::jsonb,'["legacy"]'::jsonb);
SELECT pg_sleep(3);
COMMIT;`,
        ],
        { stdio: "ignore" },
      );
      let reportWriteObserved = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (
          admin(`SELECT count(*) FROM pg_locks
            WHERE relation='public."SdkGrowthFinalizedReportEvidence"'::regclass
              AND mode='RowExclusiveLock' AND granted;`).stdout.trim() === "1"
        ) {
          reportWriteObserved = true;
          break;
        }
        await new Promise((resolveWrite) => setTimeout(resolveWrite, 100));
      }
      expect(reportWriteObserved).toBe(true);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      await new Promise<void>((resolveWriter, rejectWriter) => {
        reportWriter.once("error", rejectWriter);
        reportWriter.once("exit", (code) =>
          code === 0
            ? resolveWriter()
            : rejectWriter(new Error("sdk_growth_test_report_writer_failed")),
        );
      });
      expectUnapplied000106();
      expect(
        admin(`SELECT count(*) FROM public."SdkGrowthFinalizedReportEvidence"
          WHERE "reportEvidenceId"='concurrent-legacy-report';`).stdout.trim(),
      ).toBe("1");
      admin(`SET session_replication_role=replica;
DELETE FROM public."SdkGrowthFinalizedReportEvidence"
  WHERE "reportEvidenceId"='concurrent-legacy-report';
SET session_replication_role=origin;`);
      expect(checkpoint("preflight-000106").phase).toBe("preflight-000106");

      rehearsalPhase = "stale-logical-writer-binding";
      expect(() =>
        executeSdkGrowthApplicationSchema({
          ...environment,
          REVIEW_ROUTER_API_SERVICE_REVISION: "0".repeat(40),
        }),
      ).toThrow("sdk_growth_schema_executor_release_binding_rejected");

      rehearsalPhase = "unfinished-000106-ledger";
      admin(`INSERT INTO public._prisma_migrations(
        id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count
      ) VALUES (gen_random_uuid()::text,
        '${sdkGrowthApplicationSchemaContract.logicalIdentity.target.checksum}',NULL,
        '${sdkGrowthApplicationSchemaContract.logicalIdentity.target.migrationName}',
        NULL,NULL,clock_timestamp(),0);`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      rehearsalPhase = "committed-ledger-missing-000106-catalog";
      admin(`UPDATE public._prisma_migrations
        SET finished_at=clock_timestamp(),applied_steps_count=1
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.target.migrationName}';`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      rehearsalPhase = "duplicate-000106-ledger";
      admin(`INSERT INTO public._prisma_migrations
        SELECT gen_random_uuid()::text,checksum,finished_at,migration_name,logs,
          rolled_back_at,started_at,applied_steps_count
        FROM public._prisma_migrations
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.target.migrationName}';`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      admin(`DELETE FROM public._prisma_migrations
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.target.migrationName}';`);

      rehearsalPhase = "wrong-000106-predecessor";
      admin(`UPDATE public._prisma_migrations SET checksum='${"1".repeat(64)}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.predecessor.migrationName}';`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      admin(`UPDATE public._prisma_migrations
        SET checksum='${sdkGrowthApplicationSchemaContract.logicalIdentity.predecessor.checksum}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.predecessor.migrationName}';`);

      rehearsalPhase = "legacy-finalized-report";
      admin(`SET session_replication_role=replica;
INSERT INTO public."SdkGrowthFinalizedReportEvidence"(
  "reportEvidenceId","evidenceId","repositoryId","runId","runAttempt",
  "verifierRevision",producer,"candidateWritable","reportDigest","finalizedReport",
  "grantId",outcome,coverage,"coveredScopes",phases
) VALUES ('legacy-report','missing-evidence','repo','run','1','${"2".repeat(40)}',
  'reviewrouter-verifier',false,'sha256:${"3".repeat(64)}',decode('01','hex'),
  'legacy-grant','passed','complete','[]'::jsonb,'["legacy"]'::jsonb);
SET session_replication_role=origin;`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      admin(`SET session_replication_role=replica;
DELETE FROM public."SdkGrowthFinalizedReportEvidence"
  WHERE "reportEvidenceId"='legacy-report';
SET session_replication_role=origin;`);

      rehearsalPhase = "execute-000106";
      const logicalExecution = executeSdkGrowthApplicationSchema(environment);
      expect(logicalExecution.outcome).toBe("applied");
      expect(logicalExecution.activationStatus).toBe("HOLD");
      expect(checkpoint("postflight-000106").phase).toBe("postflight-000106");
      expect(executeSdkGrowthApplicationSchema(environment).outcome).toBe(
        "already-committed",
      );
      expect(
        admin(`SELECT count(*) FROM pg_constraint
          WHERE conrelid='public."SdkGrowthFinalizedReportEvidence"'::regclass
            AND conname='SdkGrowthFinalizedReportEvidence_digest_key';`).stdout.trim(),
      ).toBe("0");

      rehearsalPhase = "000106-retry-and-postflight-column-drift";
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "grantId" TYPE text;`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expect(() => checkpoint("postflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_logical_identity_rejected",
      );
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "grantId" TYPE varchar(2048);`);
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "finalizedReport" DROP NOT NULL;`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      expect(() => checkpoint("postflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_logical_identity_rejected",
      );
      admin(`ALTER TABLE public."SdkGrowthFinalizedReportEvidence"
        ALTER COLUMN "finalizedReport" SET NOT NULL;`);
      expect(checkpoint("postflight-000106").phase).toBe("postflight-000106");
      expect(executeSdkGrowthApplicationSchema(environment).outcome).toBe(
        "already-committed",
      );

      rehearsalPhase = "wrong-000106-target-checksum";
      admin(`UPDATE public._prisma_migrations SET checksum='${"f".repeat(64)}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.target.migrationName}';`);
      expect(() => executeSdkGrowthApplicationSchema(environment)).toThrow();
      admin(`UPDATE public._prisma_migrations
        SET checksum='${sdkGrowthApplicationSchemaContract.logicalIdentity.target.checksum}'
        WHERE migration_name='${sdkGrowthApplicationSchemaContract.logicalIdentity.target.migrationName}';`);

      rehearsalPhase = "postflight-negative-probes";
      admin(`DROP TRIGGER sdk_growth_publication_immutable ON public."SdkGrowthPublicationEffect";
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OF "lastEvidence" OR DELETE ON public."SdkGrowthPublicationEffect"
  FOR EACH ROW EXECUTE FUNCTION public.sdk_growth_publication_preserve();`);
      expect(() => checkpoint("postflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_semantics_rejected",
      );
      admin(`DROP TRIGGER sdk_growth_publication_immutable ON public."SdkGrowthPublicationEffect";
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OR DELETE ON public."SdkGrowthPublicationEffect"
  FOR EACH ROW EXECUTE FUNCTION public.sdk_growth_publication_preserve();`);
      expect(checkpoint("postflight-000106").phase).toBe("postflight-000106");

      admin(`GRANT UPDATE (finished_at) ON TABLE public._prisma_migrations
  TO reviewrouter_sdk_growth_schema_observer;`);
      expect(() => checkpoint("postflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_observer_permissions_rejected",
      );
      admin(`REVOKE UPDATE (finished_at) ON TABLE public._prisma_migrations
  FROM reviewrouter_sdk_growth_schema_observer;`);
      expect(checkpoint("postflight-000106").phase).toBe("postflight-000106");

      admin(`CREATE ROLE reviewrouter_sdk_growth_inherited_writer NOLOGIN;
GRANT UPDATE ON TABLE public."SdkGrowthPublicationEffect"
  TO reviewrouter_sdk_growth_inherited_writer;
GRANT reviewrouter_sdk_growth_inherited_writer
  TO reviewrouter_sdk_growth_schema_observer WITH INHERIT TRUE, SET FALSE;`);
      expect(
        observer(
          `SELECT has_table_privilege(current_user,
            'public."SdkGrowthPublicationEffect"','UPDATE');`,
        ),
      ).toBe("t");
      expect(() => checkpoint("postflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_observer_permissions_rejected",
      );
      admin(`REVOKE reviewrouter_sdk_growth_inherited_writer
  FROM reviewrouter_sdk_growth_schema_observer;
DROP OWNED BY reviewrouter_sdk_growth_inherited_writer;
DROP ROLE reviewrouter_sdk_growth_inherited_writer;`);
      expect(checkpoint("postflight-000106").phase).toBe("postflight-000106");

      admin(`CREATE ROLE reviewrouter_sdk_growth_set_role_writer NOLOGIN;
GRANT UPDATE ON TABLE public."SdkGrowthPublicationEffect"
  TO reviewrouter_sdk_growth_set_role_writer;
GRANT reviewrouter_sdk_growth_set_role_writer
  TO reviewrouter_sdk_growth_schema_observer WITH INHERIT FALSE, SET TRUE;`);
      expect(
        observer(`SET ROLE reviewrouter_sdk_growth_set_role_writer;
SELECT has_table_privilege(current_user,
  'public."SdkGrowthPublicationEffect"','UPDATE');`),
      ).toBe("t");
      expect(() => checkpoint("postflight-000106")).toThrow(
        "sdk_growth_schema_checkpoint_observer_permissions_rejected",
      );
      admin(`REVOKE reviewrouter_sdk_growth_set_role_writer
  FROM reviewrouter_sdk_growth_schema_observer;
DROP OWNED BY reviewrouter_sdk_growth_set_role_writer;
DROP ROLE reviewrouter_sdk_growth_set_role_writer;`);
      expect(checkpoint("postflight-000106").phase).toBe("postflight-000106");
    } catch (error) {
      executionError = new Error(
        `sdk_growth_pg17_rehearsal_phase_failed:${rehearsalPhase}`,
        { cause: error },
      );
    } finally {
      const identity = spawnSync(
        "docker",
        [
          "inspect",
          "--format",
          '{{ index .Config.Labels "reviewrouter.sdk-schema.proof" }}',
          name,
        ],
        { encoding: "utf8" },
      );
      if (identity.status === 0 && identity.stdout.trim() === token) {
        const removal = spawnSync(
          "docker",
          ["rm", "--force", "--volumes", name],
          {
            encoding: "utf8",
          },
        );
        if (removal.status !== 0 || removal.error) {
          cleanupError = new Error("sdk_growth_pg17_rehearsal_cleanup_failed");
        }
      } else if (created) {
        cleanupError = new Error(
          "sdk_growth_pg17_rehearsal_cleanup_unresolved",
        );
      }
      rmSync(root, { recursive: true, force: true });
    }
    if (executionError && cleanupError)
      throw new AggregateError(
        [executionError, cleanupError],
        "sdk_growth_pg17_rehearsal_and_cleanup_failed",
      );
    if (executionError) throw executionError;
    if (cleanupError) throw cleanupError;
  }, 180_000);
});
