import { randomUUID } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  assertSdkGrowthApplicationSchemaCheckpoint,
  executeSdkGrowthApplicationSchemaCheckpoint,
  sdkGrowthApplicationSchemaContract,
  sdkGrowthApplicationSchemaObservationSql,
  sdkGrowthApplicationSchemaObserverGrantSql,
  sdkGrowthApplicationSchemaShape,
  sdkGrowthReleaseLoginProbeSql,
  validateSdkGrowthCheckpointEnvironment,
} from "./sdk-growth-application-schema-checkpoint.mjs";
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
    triggers: sdkGrowthApplicationSchemaShape.triggers,
    observerGrants: [
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
    expect(releaseSql).toContain("session_user");
    expect(releaseSql).toContain("publicationPrivileges");
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
});

const requirePg17 =
  process.env.REVIEW_ROUTER_REQUIRE_SDK_GROWTH_SCHEMA_PG17 === "1";
const describePg17 = requirePg17 ? describe : describe.skip;

describePg17("SDK growth separate disposable PG17 migration rehearsal", () => {
  it("applies actual migrations through 000104 and then 000105 using real restricted logins", async () => {
    const token = randomUUID();
    const name = `rr-sdk-schema-${token}`;
    const image =
      "postgres:17.10@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317";
    const root = mkdtempSync(
      join(process.cwd(), ".sdk-growth-schema-rehearsal."),
    );
    let created = false;
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
      rmSync(
        join(
          prismaRoot,
          "migrations",
          sdkGrowthApplicationSchemaContract.target.migrationName,
        ),
        { recursive: true },
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
      migrate();
      admin(`CREATE ROLE reviewrouter_release_schema_owner NOLOGIN;
CREATE ROLE reviewrouter_release_migration LOGIN PASSWORD 'release-test' INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE reviewrouter_sdk_growth_schema_observer LOGIN PASSWORD 'observer-test' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE reviewrouter_api NOLOGIN;
CREATE ROLE reviewrouter_worker NOLOGIN;`);
      const convergeGrants = () =>
        admin(`ALTER TABLE public."SdkGrowthPublicationEffect" OWNER TO reviewrouter_release_schema_owner;
ALTER FUNCTION public.sdk_growth_publication_preserve() OWNER TO reviewrouter_release_schema_owner;
REVOKE ALL ON FUNCTION public.sdk_growth_publication_preserve() FROM PUBLIC;
GRANT SELECT ON TABLE public._prisma_migrations TO reviewrouter_release_migration;
${sdkGrowthApplicationSchemaObserverGrantSql()}
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SdkGrowthPublicationEffect" TO reviewrouter_api, reviewrouter_worker;`);
      convergeGrants();
      const head = command("git", ["rev-parse", "HEAD"]);
      const environment = {
        REVIEW_ROUTER_RELEASE_COMMIT_SHA: head,
        REVIEW_ROUTER_RELEASE_MIGRATION_DATABASE_URL: `postgresql://reviewrouter_release_migration:release-test@127.0.0.1:${port}/postgres`,
        REVIEW_ROUTER_SDK_GROWTH_SCHEMA_OBSERVER_DATABASE_URL: `postgresql://reviewrouter_sdk_growth_schema_observer:observer-test@127.0.0.1:${port}/postgres`,
        REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED: "0",
        REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
      };
      const checkpoint = (phase: "preflight" | "postflight") =>
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
      expect(checkpoint("preflight").phase).toBe("preflight");
      cpSync(
        join(
          "packages/platform/db/prisma/migrations",
          sdkGrowthApplicationSchemaContract.target.migrationName,
        ),
        join(
          prismaRoot,
          "migrations",
          sdkGrowthApplicationSchemaContract.target.migrationName,
        ),
        { recursive: true },
      );
      migrate();
      convergeGrants();
      expect(checkpoint("postflight").phase).toBe("postflight");

      admin(`DROP TRIGGER sdk_growth_publication_immutable ON public."SdkGrowthPublicationEffect";
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OF "lastEvidence" OR DELETE ON public."SdkGrowthPublicationEffect"
  FOR EACH ROW EXECUTE FUNCTION public.sdk_growth_publication_preserve();`);
      expect(() => checkpoint("postflight")).toThrow(
        "sdk_growth_schema_checkpoint_semantics_rejected",
      );
      admin(`DROP TRIGGER sdk_growth_publication_immutable ON public."SdkGrowthPublicationEffect";
CREATE TRIGGER sdk_growth_publication_immutable
  BEFORE UPDATE OR DELETE ON public."SdkGrowthPublicationEffect"
  FOR EACH ROW EXECUTE FUNCTION public.sdk_growth_publication_preserve();`);
      expect(checkpoint("postflight").phase).toBe("postflight");

      admin(`GRANT UPDATE (finished_at) ON TABLE public._prisma_migrations
  TO reviewrouter_sdk_growth_schema_observer;`);
      expect(() => checkpoint("postflight")).toThrow(
        "sdk_growth_schema_checkpoint_observer_permissions_rejected",
      );
      admin(`REVOKE UPDATE (finished_at) ON TABLE public._prisma_migrations
  FROM reviewrouter_sdk_growth_schema_observer;`);
      expect(checkpoint("postflight").phase).toBe("postflight");

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
      expect(() => checkpoint("postflight")).toThrow(
        "sdk_growth_schema_checkpoint_observer_permissions_rejected",
      );
      admin(`REVOKE reviewrouter_sdk_growth_inherited_writer
  FROM reviewrouter_sdk_growth_schema_observer;
DROP OWNED BY reviewrouter_sdk_growth_inherited_writer;
DROP ROLE reviewrouter_sdk_growth_inherited_writer;`);
      expect(checkpoint("postflight").phase).toBe("postflight");

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
      expect(() => checkpoint("postflight")).toThrow(
        "sdk_growth_schema_checkpoint_observer_permissions_rejected",
      );
      admin(`REVOKE reviewrouter_sdk_growth_set_role_writer
  FROM reviewrouter_sdk_growth_schema_observer;
DROP OWNED BY reviewrouter_sdk_growth_set_role_writer;
DROP ROLE reviewrouter_sdk_growth_set_role_writer;`);
      expect(checkpoint("postflight").phase).toBe("postflight");
    } catch (error) {
      executionError = error;
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
