import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  disposableBefore87HandoffSql,
  disposableFreshDatabasePreflightSql,
  disposableFullChainVerificationSql,
  disposableProvider79HandoffSql,
  disposableProvider79VerificationSql,
  disposableReleaseMigrationRoleSql,
  disposableReleaseMigrationRoleCleanupSql,
  disposableReleasePairPreflightSql,
  disposableRuntimeQualifiedVerificationSql,
  writeDisposableMigrationCatalog,
} from "./disposable-release-role-fixture.mjs";

// This intentionally uses the same superuser identity as CI. The ordinary
// reviewrouter login in the managed recovery fixture cannot model 64/66/98/99.
const required =
  process.env.REVIEW_ROUTER_REQUIRE_SELF_HOSTED_ROLE_FIXTURE_PG17 === "1";
const image =
  "postgres:17.10@sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317";
const boundarySql = readFileSync(
  new URL(
    "../../packages/platform/db/prisma/migrations/000079_remove_account_wide_provider_lane_serialization/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

(required ? describe : describe.skip)(
  "disposable shared-cluster migration identity and owners",
  () => {
    const token = randomUUID();
    const name = `rr-disposable-role-${token}`;
    const label = `reviewrouter.disposable.role=${token}`;
    const files = required
      ? mkdtempSync(join(tmpdir(), "rr-disposable-role-test-"))
      : "";
    const password = randomBytes(36).toString("base64url");
    let port = "";
    let createAttempted = false;
    let setupError: unknown;
    let ownedVolumes: string[] = [];
    const scrub = (s: string) => s.replaceAll(password, "[redacted]");
    function command(
      binary: string,
      args: string[],
      input?: string,
      env?: NodeJS.ProcessEnv,
      timeout = 600_000,
    ) {
      const result = spawnSync(binary, args, {
        input,
        encoding: "utf8",
        cwd: process.cwd(),
        env: env ?? process.env,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
      });
      return {
        status: result.status,
        output: scrub(
          `${result.stdout ?? ""}${result.stderr ?? ""}${result.error?.message ?? ""}`,
        ),
      };
    }
    function checked(
      binary: string,
      args: string[],
      input?: string,
      env?: NodeJS.ProcessEnv,
    ) {
      const result = command(binary, args, input, env);
      if (result.status !== 0)
        throw new Error(`${binary}:${args[0]}:${result.output}`);
      return result.output.trim();
    }
    const docker = (args: string[], input?: string, timeout?: number) =>
      command(
        "docker",
        ["--host", "unix:///var/run/docker.sock", ...args],
        input,
        undefined,
        timeout,
      );
    const dockerChecked = (args: string[], input?: string) =>
      checked(
        "docker",
        ["--host", "unix:///var/run/docker.sock", ...args],
        input,
      );
    function exactContainerNames() {
      return dockerChecked([
        "ps",
        "-a",
        "--no-trunc",
        "--filter",
        `name=^/${name}$`,
        "--format",
        "{{.Names}}",
      ])
        .split("\n")
        .filter(Boolean);
    }
    function ownedContainerMounts() {
      if (
        process.env.REVIEW_ROUTER_DISPOSABLE_ROLE_FAULT === "mount-inspection"
      )
        throw new Error("disposable_pg17_injected_mount_inspection_failure");
      const inspected = JSON.parse(dockerChecked(["inspect", name])) as [
        {
          Name: string;
          Config: { Labels: Record<string, string> };
          Mounts: { Type: string; Name?: string }[];
        },
      ];
      const container = inspected[0];
      if (
        inspected.length !== 1 ||
        container?.Name !== `/${name}` ||
        container.Config.Labels["reviewrouter.disposable.role"] !== token
      ) {
        throw new Error("disposable_pg17_container_identity_invalid");
      }
      return container.Mounts.filter((mount) => mount.Type === "volume")
        .map((mount) => mount.Name)
        .filter((value): value is string => Boolean(value));
    }
    function query(database: string, sql: string) {
      return dockerChecked(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          database,
        ],
        sql,
      );
    }
    function operator(database: string, functionName: string) {
      const output = query(
        database,
        `BEGIN;
      SET LOCAL SESSION AUTHORIZATION reviewrouter_release_migration;
      SELECT session_user || ':' || current_user;
      SELECT public.${functionName}();
      COMMIT;`,
      );
      const [identity, result] = output.split("\n");
      expect(identity).toBe(
        "reviewrouter_release_migration:reviewrouter_release_migration",
      );
      return JSON.parse(result ?? "") as Record<string, unknown>;
    }
    function url(database: string) {
      return `postgresql://postgres@127.0.0.1:${port}/${database}?schema=public`;
    }
    function migrate(database: string, config?: string) {
      const args = ["--filter", "@reviewrouter/platform-db"];
      if (config)
        args.push("exec", "prisma", "migrate", "deploy", "--config", config);
      else args.push("db:migrate:deploy");
      const environment = { ...process.env, DATABASE_URL: url(database) };
      delete environment.REVIEW_ROUTER_DATABASE_URL_FILE;
      const migrationStarted = new Date().toISOString();
      const result = command("pnpm", args, undefined, environment);
      if (result.status !== 0) {
        let ledger = "unavailable";
        try {
          ledger = query(
            database,
            `SELECT migration_name || ':' || checksum || ':' ||
          (finished_at IS NOT NULL)::text || ':' || (rolled_back_at IS NOT NULL)::text
          FROM public._prisma_migrations ORDER BY started_at DESC LIMIT 3`,
          );
        } catch {
          /* the first migration may have failed before the ledger exists */
        }
        const server = docker(["logs", "--since", migrationStarted, name]);
        const firstServerError =
          server.status === 0
            ? server.output
                .split("\n")
                .findIndex((line) => /ERROR:|FATAL:/u.test(line))
            : -1;
        const firstServerDiagnostic =
          firstServerError >= 0
            ? server.output
                .split("\n")
                .slice(firstServerError, firstServerError + 5)
                .join("\n")
            : `unavailable:docker_logs_status=${server.status}`;
        throw new Error(
          `disposable_migrate_failed:${database}:identity=postgres:postgres:ledger=${ledger}:first_server_diagnostic=${firstServerDiagnostic}:cli=${result.output}`,
        );
      }
      return result.output.trim();
    }
    const stockMigrationNames = readdirSync(
      new URL("../../packages/platform/db/prisma/migrations/", import.meta.url),
    )
      .filter((entry) => /^\d{6}_[a-z0-9_]+$/u.test(entry))
      .sort();
    function assertStockLedger(database: string, names: string[]) {
      const expected = names.map((migrationName) => {
        const checksum = createHash("sha256")
          .update(
            readFileSync(
              new URL(
                `../../packages/platform/db/prisma/migrations/${migrationName}/migration.sql`,
                import.meta.url,
              ),
            ),
          )
          .digest("hex");
        return `${migrationName}:${checksum}:true:false`;
      });
      const actual = query(
        database,
        `SELECT migration_name || ':' || checksum || ':' ||
      (finished_at IS NOT NULL)::text || ':' || (rolled_back_at IS NOT NULL)::text
      FROM public._prisma_migrations ORDER BY migration_name, started_at`,
      );
      expect(actual === "" ? [] : actual.split("\n")).toEqual(expected);
    }
    function newDatabase(database: string) {
      query("postgres", `CREATE DATABASE ${database};`);
    }
    function rejectFresh(database: string, expected: string) {
      const result = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          database,
        ],
        disposableFreshDatabasePreflightSql,
      );
      expect(result.status, result.output).not.toBe(0);
      expect(result.output).toContain(expected);
    }
    function rejectDirty(
      database: string,
      change: string,
      observed: string,
      verification: string,
      rejection: string,
    ) {
      const result = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          database,
        ],
        `BEGIN; ${change}
      SELECT ${observed}; ${verification}`,
      );
      expect(result.status, result.output).not.toBe(0);
      expect(result.output).toMatch(/(^|\n)t\n/u);
      expect(result.output).toContain(rejection);
      query(database, verification);
    }
    beforeAll(async () => {
      try {
        dockerChecked(["image", "inspect", image]);
        createAttempted = true;
        dockerChecked([
          "create",
          "--pull=never",
          "--name",
          name,
          "--label",
          label,
          "--publish",
          "127.0.0.1::5432",
          "--env",
          "POSTGRES_HOST_AUTH_METHOD=trust",
          image,
          "postgres",
          "-c",
          "log_error_verbosity=verbose",
          "-c",
          "log_min_error_statement=panic",
        ]);
        if (process.env.REVIEW_ROUTER_DISPOSABLE_ROLE_FAULT === "after-create")
          throw new Error("disposable_pg17_injected_after_create_failure");
        ownedVolumes = ownedContainerMounts();
        expect(ownedVolumes.length).toBeGreaterThan(0);
        dockerChecked(["start", name]);
        if (process.env.REVIEW_ROUTER_DISPOSABLE_ROLE_FAULT === "after-start")
          throw new Error("disposable_pg17_injected_after_start_failure");
        const mapped = dockerChecked(["port", name, "5432/tcp"]);
        const match = mapped.match(/^127\.0\.0\.1:(\d+)$/u);
        if (!match) throw new Error("disposable_pg17_loopback_port_invalid");
        port = match[1]!;
        let finalServerReady = false;
        let lastReadinessFailure = "";
        const readinessDeadline = Date.now() + 45_000;
        for (let i = 0; i < 90 && Date.now() < readinessDeadline; i++) {
          // initdb's temporary postmaster accepts socket connections, but only
          // the final server accepts TCP connections on loopback.
          const result = docker(
            [
              "exec",
              name,
              "psql",
              "-XqAtw",
              "-v",
              "ON_ERROR_STOP=1",
              "-h",
              "127.0.0.1",
              "-U",
              "postgres",
              "-d",
              "postgres",
              "-c",
              "SHOW server_version_num;",
            ],
            undefined,
            Math.min(2_000, Math.max(1, readinessDeadline - Date.now())),
          );
          if (result.status === 0) {
            expect(result.output.trim()).toBe("170010");
            finalServerReady = true;
            break;
          }
          lastReadinessFailure = `status=${result.status}:${result.output.trim()}`;
          if (i < 89)
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Math.min(500, Math.max(0, readinessDeadline - Date.now())),
              ),
            );
        }
        if (!finalServerReady)
          throw new Error(
            `disposable_pg17_final_server_not_ready:${lastReadinessFailure}`,
          );
      } catch (error) {
        setupError = error;
        throw error;
      }
    }, 90_000);
    afterAll(() => {
      const cleanupErrors: unknown[] = [];
      try {
        if (createAttempted) {
          // A successful exact inventory distinguishes absence from Docker daemon
          // failure. Never use a label-wide or name-prefix cleanup sweep.
          const names = exactContainerNames();
          if (names.includes(name)) {
            try {
              ownedVolumes = [
                ...new Set([...ownedVolumes, ...ownedContainerMounts()]),
              ];
            } catch (error) {
              cleanupErrors.push(error);
              try {
                const mounts = JSON.parse(
                  dockerChecked([
                    "inspect",
                    "--format",
                    "{{json .Mounts}}",
                    name,
                  ]),
                ) as { Type: string; Name?: string }[];
                ownedVolumes = [
                  ...new Set([
                    ...ownedVolumes,
                    ...mounts
                      .filter((mount) => mount.Type === "volume")
                      .map((mount) => mount.Name)
                      .filter((value): value is string => Boolean(value)),
                  ]),
                ];
              } catch (fallbackError) {
                cleanupErrors.push(fallbackError);
              }
            }
            // Even if mount parsing failed, verify ownership independently so
            // the created container and its anonymous volumes can be removed.
            const identity = JSON.parse(
              dockerChecked([
                "inspect",
                "--format",
                "{{json .Config.Labels}}",
                name,
              ]),
            ) as Record<string, string>;
            if (identity["reviewrouter.disposable.role"] !== token)
              throw new Error("disposable_pg17_container_identity_invalid");
            dockerChecked(["rm", "--force", "--volumes", name]);
          }
          expect(exactContainerNames()).toEqual([]);
          const remainingVolumes = new Set(
            dockerChecked(["volume", "ls", "--format", "{{.Name}}"])
              .split("\n")
              .filter(Boolean),
          );
          for (const volume of ownedVolumes)
            expect(remainingVolumes.has(volume)).toBe(false);
        }
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        if (files) rmSync(files, { recursive: true, force: true });
      }
      if (cleanupErrors.length)
        throw new AggregateError(
          setupError ? [setupError, ...cleanupErrors] : cleanupErrors,
          "disposable_pg17_cleanup_failed",
        );
    });

    it("runs main 110, diagnoses owner-only 79, then completes fresh 110 with exact canonical handoff", async () => {
      const pre79 = writeDisposableMigrationCatalog("pre79", files);
      const through79 = writeDisposableMigrationCatalog("through79", files);
      const before87 = writeDisposableMigrationCatalog("before87", files);
      expect(
        query(
          "postgres",
          `SELECT pg_catalog.to_regrole('reviewrouter_release_schema_owner') IS NULL
      AND pg_catalog.to_regrole('reviewrouter_release_migration') IS NULL`,
        ),
      ).toBe("t");
      newDatabase("rr_role_main");
      migrate("rr_role_main");
      const stockCount = stockMigrationNames.length;
      assertStockLedger("rr_role_main", stockMigrationNames);
      expect(
        Number(
          query(
            "rr_role_main",
            `SELECT count(*) FROM public._prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
          ),
        ),
      ).toBe(stockCount);
      expect(
        query(
          "rr_role_main",
          `SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name='000110_historical_unknown_scope_barrier' AND finished_at IS NOT NULL`,
        ),
      ).toBe("1");
      expect(
        query(
          "rr_role_main",
          `SELECT pg_catalog.to_regprocedure(
      'public.reviewrouter_provider_scope_concurrency_status()') IS NULL`,
        ),
      ).toBe("t");
      expect(
        query(
          "rr_role_main",
          `SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name LIKE '000079_%' AND finished_at IS NOT NULL`,
        ),
      ).toBe("2");
      expect(
        query(
          "postgres",
          "SELECT to_regrole('reviewrouter_release_migration') IS NULL",
        ),
      ).toBe("t");
      expect(
        query(
          "postgres",
          "SELECT to_regrole('reviewrouter_release_schema_owner') IS NOT NULL",
        ),
      ).toBe("t");
      expect(
        query(
          "rr_role_main",
          `SELECT pg_catalog.has_schema_privilege(
      'reviewrouter_release_schema_owner','public','USAGE')`,
        ),
      ).toBe("t");
      newDatabase("rr_role_missing");
      migrate("rr_role_missing", pre79);
      const pre79Names = stockMigrationNames.filter((name) => name < "000079_");
      assertStockLedger("rr_role_missing", pre79Names);
      const lastPre79 = pre79Names.at(-1)!;
      const checksum = createHash("sha256")
        .update(
          readFileSync(
            new URL(
              `../../packages/platform/db/prisma/migrations/${lastPre79}/migration.sql`,
              import.meta.url,
            ),
          ),
        )
        .digest("hex");
      expect(
        query(
          "rr_role_missing",
          `SELECT checksum FROM public._prisma_migrations
      WHERE migration_name='${lastPre79}' AND finished_at IS NOT NULL`,
        ),
      ).toBe(checksum);
      const first = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
          "-U",
          "postgres",
          "-d",
          "rr_role_missing",
        ],
        boundarySql,
      );
      expect(first.status, first.output).not.toBe(0);
      expect(first.output).toMatch(
        /P0001: provider_scope_concurrency_authority_roles_partial:reviewrouter_release_migration_missing/u,
      );
      expect(
        query("rr_role_missing", "SELECT session_user || ':' || current_user"),
      ).toBe("postgres:postgres");
      expect(
        query(
          "rr_role_missing",
          `SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name LIKE '000079_%'`,
        ),
      ).toBe("0");
      console.info(
        JSON.stringify({
          fixture: "rr_role_missing",
          phase: "owner-only-before-79",
          identity: "postgres:postgres",
          lastAppliedMigration: lastPre79,
          lastAppliedChecksum: checksum,
          attemptedMigration:
            "000079_remove_account_wide_provider_lane_serialization",
          attemptedMigrationChecksum: createHash("sha256")
            .update(boundarySql)
            .digest("hex"),
          sqlstate: "P0001",
          firstDiagnostic:
            "provider_scope_concurrency_authority_roles_partial:reviewrouter_release_migration_missing",
          attemptedMigrationLedgerRows: 0,
        }),
      );

      // These are real restricted cluster identities. Stock migrations may give
      // them narrow read/execute rights, and postflight checks their effective
      // rights instead of silently iterating over an empty role set.
      query(
        "postgres",
        `CREATE ROLE reviewrouter_api LOGIN INHERIT;
      CREATE ROLE reviewrouter_web LOGIN INHERIT;
      CREATE ROLE reviewrouter_worker LOGIN INHERIT;
      CREATE ROLE reviewrouter_comment_token_custody LOGIN INHERIT;
      CREATE ROLE reviewrouter_codex_effect_authority LOGIN INHERIT;`,
      );

      newDatabase("rr_role_test");
      newDatabase("rr_role_provider");
      query("rr_role_test", disposableFreshDatabasePreflightSql);
      query("rr_role_provider", disposableFreshDatabasePreflightSql);
      expect(() =>
        query("rr_role_test", disposableReleasePairPreflightSql),
      ).toThrow("disposable_release_pair_preflight_invalid");
      query("postgres", disposableReleaseMigrationRoleSql(password));
      query("rr_role_test", disposableReleasePairPreflightSql);
      query("rr_role_provider", disposableReleasePairPreflightSql);
      expect(() =>
        query("postgres", disposableReleaseMigrationRoleSql(password)),
      ).toThrow("self_hosted_release_role_already_present");
      migrate("rr_role_test", before87);
      assertStockLedger(
        "rr_role_test",
        stockMigrationNames.filter((name) => name < "000087_"),
      );
      expect(
        query(
          "rr_role_test",
          `SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name='000086_comment_token_custody_r18_remediation' AND finished_at IS NOT NULL`,
        ),
      ).toBe("1");
      const setOnlyGrant = `GRANT reviewrouter_release_schema_owner
      TO reviewrouter_release_migration WITH INHERIT FALSE, SET TRUE;`;
      const setOnlyEdgeObserved = `NOT edge.inherit_option AND edge.set_option AND
      pg_catalog.pg_has_role('reviewrouter_release_migration',
        'reviewrouter_release_schema_owner','SET')
      FROM pg_catalog.pg_auth_members edge
      WHERE edge.roleid='reviewrouter_release_schema_owner'::regrole
        AND edge.member='reviewrouter_release_migration'::regrole`;
      const setOnlyBefore87 = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      ${setOnlyGrant}
      SELECT ${setOnlyEdgeObserved};
      ${disposableBefore87HandoffSql}`,
      );
      expect(setOnlyBefore87.status).not.toBe(0);
      expect(setOnlyBefore87.output).toMatch(/(^|\n)t\n/u);
      expect(setOnlyBefore87.output).toContain(
        "disposable_before87_handoff_invalid",
      );
      expect(
        query(
          "rr_role_test",
          `SELECT pg_catalog.pg_get_userbyid(relowner)
      FROM pg_catalog.pg_class WHERE oid='public."CodexOAuthSecretNamespace"'::regclass`,
        ),
      ).toBe("postgres");
      expect(
        query(
          "postgres",
          `SELECT count(*) FROM pg_catalog.pg_auth_members
      WHERE roleid='reviewrouter_release_schema_owner'::regrole
        AND member='reviewrouter_release_migration'::regrole`,
        ),
      ).toBe("0");
      query("rr_role_test", disposableBefore87HandoffSql);
      migrate("rr_role_test");
      assertStockLedger("rr_role_test", stockMigrationNames);
      query(
        "rr_role_test",
        disposableRuntimeQualifiedVerificationSql("full110"),
      );
      rejectDirty(
        "rr_role_test",
        setOnlyGrant,
        setOnlyEdgeObserved,
        disposableFullChainVerificationSql,
        "disposable_full_chain_verification_failed",
      );
      for (const role of [
        "reviewrouter_api",
        "reviewrouter_web",
        "reviewrouter_worker",
        "reviewrouter_comment_token_custody",
        "reviewrouter_codex_effect_authority",
      ]) {
        expect(
          query(
            "rr_role_test",
            `BEGIN;
        SET LOCAL SESSION AUTHORIZATION ${role};
        SELECT session_user || ':' || current_user;
        SELECT pg_catalog.has_table_privilege(current_user,
          'public."HostedCodexRuntimeGate"','UPDATE') OR
          pg_catalog.has_any_column_privilege(current_user,
            'public."HostedCodexRuntimeGate"','UPDATE') OR
          pg_catalog.has_table_privilege(current_user,
            'public."ReviewProviderScopeConcurrencyControl"','UPDATE') OR
          pg_catalog.has_any_column_privilege(current_user,
            'public."ReviewProviderScopeConcurrencyControl"','UPDATE');
        COMMIT;`,
          ),
        ).toBe(`${role}:${role}\nf`);
      }
      expect(
        query(
          "rr_role_test",
          `BEGIN;
      SET LOCAL SESSION AUTHORIZATION reviewrouter_api;
      SELECT session_user || ':' || current_user;
      SELECT "status" || ':' || "authzEpoch"::text
        FROM public.hosted_historical_lock_runtime_gate();
      COMMIT;`,
        ),
      ).toMatch(/^reviewrouter_api:reviewrouter_api\nclosed:\d+$/u);
      const holder = spawn(
        "docker",
        [
          "--host",
          "unix:///var/run/docker.sock",
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let holderOutput = "";
      holder.stdout.on("data", (chunk: Buffer) => {
        holderOutput += scrub(chunk.toString());
      });
      holder.stderr.on("data", (chunk: Buffer) => {
        holderOutput += scrub(chunk.toString());
      });
      holder.stdin.end(`BEGIN;
      SET LOCAL application_name='rr_disposable_gate_lock_holder';
      SET LOCAL SESSION AUTHORIZATION reviewrouter_api;
      SELECT * FROM public.hosted_historical_lock_runtime_gate();
      SELECT pg_catalog.pg_sleep(10);
      COMMIT;`);
      try {
        let sleeping = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          sleeping =
            query(
              "rr_role_test",
              `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
          WHERE application_name='rr_disposable_gate_lock_holder' AND state='active'
            AND query LIKE '%pg_sleep(10)%')`,
            ) === "t";
          if (sleeping) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(sleeping, holderOutput).toBe(true);
        const blocked = docker(
          [
            "exec",
            "-i",
            name,
            "psql",
            "-XqAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-v",
            "VERBOSITY=verbose",
            "-U",
            "postgres",
            "-d",
            "rr_role_test",
          ],
          `BEGIN;
        SET LOCAL lock_timeout='250ms';
        UPDATE public."HostedCodexRuntimeGate" SET "revision"="revision"+1,
          "authzEpoch"="authzEpoch"+1, "reasonCode"='lock_probe',
          "changedAt"=clock_timestamp() WHERE "id"='global';`,
        );
        expect(blocked.status, blocked.output).not.toBe(0);
        expect(blocked.output).toMatch(/55P03:/u);
      } finally {
        const held = await new Promise<number | null>((resolve) => {
          if (holder.exitCode !== null) resolve(holder.exitCode);
          else holder.once("exit", (code) => resolve(code));
        });
        expect(held, holderOutput).toBe(0);
      }
      const deniedGate = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      SET LOCAL SESSION AUTHORIZATION reviewrouter_api;
      UPDATE public."HostedCodexRuntimeGate" SET "status"='closed';`,
      );
      expect(deniedGate.status).not.toBe(0);
      expect(deniedGate.output).toMatch(/42501:/u);
      expect(
        query(
          "rr_role_test",
          `SELECT "status" FROM public."HostedCodexRuntimeGate"
      WHERE "id"='global'`,
        ),
      ).toBe("closed");
      const closureBefore = query(
        "rr_role_test",
        `SELECT "id" || ':' || "state"::text || ':' ||
      "revision"::text FROM public."HostedCodexRuntimeClosure" ORDER BY "id"`,
      );
      expect(closureBefore).not.toBe("");
      const deniedClosure = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-v",
          "VERBOSITY=verbose",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      SET LOCAL SESSION AUTHORIZATION reviewrouter_api;
      UPDATE public."HostedCodexRuntimeClosure" SET "state"='draining';`,
      );
      expect(deniedClosure.status).not.toBe(0);
      expect(deniedClosure.output).toMatch(/42501:/u);
      expect(
        query(
          "rr_role_test",
          `SELECT "id" || ':' || "state"::text || ':' ||
      "revision"::text FROM public."HostedCodexRuntimeClosure" ORDER BY "id"`,
        ),
      ).toBe(closureBefore);
      for (const role of [
        "reviewrouter_api",
        "reviewrouter_web",
        "reviewrouter_worker",
        "reviewrouter_comment_token_custody",
        "reviewrouter_codex_effect_authority",
      ]) {
        rejectDirty(
          "rr_role_test",
          `ALTER ROLE ${role} RENAME TO ${role}_missing;`,
          `pg_catalog.to_regrole('${role}') IS NULL`,
          disposableRuntimeQualifiedVerificationSql("full110"),
          "disposable_full110_runtime_identity_invalid",
        );
      }
      for (const [routine, condition] of [
        ["hosted_historical_lock_runtime_gate()", "proconfig IS NULL"],
        ["hosted_historical_grant_guard()", "proconfig IS NULL"],
      ]) {
        rejectDirty(
          "rr_role_test",
          `ALTER FUNCTION public.${routine} RESET ALL;`,
          `(${condition}) FROM pg_catalog.pg_proc WHERE oid='public.${routine}'::regprocedure`,
          disposableFullChainVerificationSql,
          "disposable_full_chain_verification_failed",
        );
        rejectDirty(
          "rr_role_test",
          `ALTER FUNCTION public.${routine} SET search_path=public;`,
          `proconfig @> ARRAY['search_path=public'] FROM pg_catalog.pg_proc
          WHERE oid='public.${routine}'::regprocedure`,
          disposableFullChainVerificationSql,
          "disposable_full_chain_verification_failed",
        );
        rejectDirty(
          "rr_role_test",
          `ALTER FUNCTION public.${routine} SECURITY INVOKER;`,
          `NOT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.${routine}'::regprocedure`,
          disposableFullChainVerificationSql,
          "disposable_full_chain_verification_failed",
        );
        rejectDirty(
          "rr_role_test",
          `ALTER FUNCTION public.${routine} OWNER TO postgres;`,
          `pg_catalog.pg_get_userbyid(proowner)='postgres' FROM pg_catalog.pg_proc WHERE oid='public.${routine}'::regprocedure`,
          disposableFullChainVerificationSql,
          "disposable_full_chain_verification_failed",
        );
      }
      for (const relation of [
        "HostedCodexRuntimeGate",
        "ReviewRequestedIntent",
        "RepositoryConnection",
      ]) {
        for (const privilege of ["SELECT", "UPDATE"]) {
          rejectDirty(
            "rr_role_test",
            `REVOKE ${privilege} ON public."${relation}"
          FROM reviewrouter_release_schema_owner;`,
            `NOT pg_catalog.has_table_privilege('reviewrouter_release_schema_owner',
            'public."${relation}"','${privilege}')`,
            disposableFullChainVerificationSql,
            "disposable_full_chain_verification_failed",
          );
        }
      }
      for (const relation of [
        "HostedHistoricalScopePolicy",
        "HostedHistoricalUnknownScope",
        "HostedHistoricalScopeAlias",
        "HostedHistoricalScopeComplete",
      ]) {
        rejectDirty(
          "rr_role_test",
          `REVOKE SELECT ON public."${relation}"
        FROM reviewrouter_release_schema_owner;`,
          `NOT pg_catalog.has_table_privilege('reviewrouter_release_schema_owner',
          'public."${relation}"','SELECT')`,
          disposableFullChainVerificationSql,
          "disposable_full_chain_verification_failed",
        );
      }
      for (const routine of [
        "hosted_historical_set_digest()",
        "hosted_historical_assert_ready()",
        'hosted_historical_assert_grant(public."HostedCodexInvocationGrant")',
      ]) {
        rejectDirty(
          "rr_role_test",
          `REVOKE EXECUTE ON FUNCTION public.${routine}
        FROM reviewrouter_release_schema_owner;`,
          `NOT pg_catalog.has_function_privilege('reviewrouter_release_schema_owner',
          'public.${routine}','EXECUTE')`,
          disposableFullChainVerificationSql,
          "disposable_full_chain_verification_failed",
        );
      }
      rejectDirty(
        "rr_role_test",
        `GRANT EXECUTE ON FUNCTION
      public.hosted_historical_assert_ready() TO PUBLIC;`,
        `pg_catalog.has_function_privilege('reviewrouter_codex_effect_authority',
        'public.hosted_historical_assert_ready()','EXECUTE')`,
        disposableFullChainVerificationSql,
        "disposable_full_chain_verification_failed",
      );
      rejectDirty(
        "rr_role_test",
        `CREATE ROLE rr_historical_execute_capability NOLOGIN;
      GRANT rr_historical_execute_capability TO reviewrouter_codex_effect_authority;
      GRANT EXECUTE ON FUNCTION public.hosted_historical_assert_ready()
        TO rr_historical_execute_capability;`,
        `pg_catalog.has_function_privilege('reviewrouter_codex_effect_authority',
        'public.hosted_historical_assert_ready()','EXECUTE')`,
        disposableFullChainVerificationSql,
        "disposable_full_chain_verification_failed",
      );
      for (const [grant, observed] of [
        [
          `GRANT UPDATE ("state") ON public."HostedCodexRuntimeClosure" TO reviewrouter_api;`,
          `pg_catalog.has_column_privilege('reviewrouter_api',
          'public."HostedCodexRuntimeClosure"','state','UPDATE')`,
        ],
        [
          `GRANT UPDATE ON public."HostedCodexRuntimeClosure" TO PUBLIC;`,
          `pg_catalog.has_table_privilege('reviewrouter_web',
          'public."HostedCodexRuntimeClosure"','UPDATE')`,
        ],
        [
          `CREATE ROLE rr_closure_capability NOLOGIN;
        GRANT rr_closure_capability TO reviewrouter_api;
        GRANT UPDATE ("state") ON public."HostedCodexRuntimeClosure" TO rr_closure_capability;`,
          `pg_catalog.has_column_privilege('reviewrouter_api',
          'public."HostedCodexRuntimeClosure"','state','UPDATE')`,
        ],
      ])
        rejectDirty(
          "rr_role_test",
          grant,
          observed,
          disposableFullChainVerificationSql,
          "disposable_full_chain_verification_failed",
        );
      const gateDirty = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      GRANT UPDATE ("status") ON public."HostedCodexRuntimeGate" TO reviewrouter_release_migration;
      SELECT pg_catalog.has_column_privilege('reviewrouter_release_migration',
        'public."HostedCodexRuntimeGate"','status','UPDATE');
      ${disposableFullChainVerificationSql}`,
      );
      expect(gateDirty.status).not.toBe(0);
      expect(gateDirty.output).toMatch(/(^|\n)t\n/u);
      expect(gateDirty.output).toContain(
        "disposable_full_chain_verification_failed",
      );
      query("rr_role_test", disposableFullChainVerificationSql);
      const inheritedDirty = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      CREATE ROLE rr_disposable_capability NOLOGIN;
      GRANT rr_disposable_capability TO reviewrouter_api;
      GRANT UPDATE ("status") ON public."HostedCodexRuntimeGate" TO rr_disposable_capability;
      SELECT pg_catalog.has_column_privilege('reviewrouter_api',
        'public."HostedCodexRuntimeGate"','status','UPDATE');
      ${disposableFullChainVerificationSql}`,
      );
      expect(inheritedDirty.status).not.toBe(0);
      expect(inheritedDirty.output).toMatch(/(^|\n)t\n/u);
      expect(inheritedDirty.output).toContain(
        "disposable_full_chain_verification_failed",
      );
      expect(
        query(
          "postgres",
          "SELECT to_regrole('rr_disposable_capability') IS NULL",
        ),
      ).toBe("t");
      const strangerDirty = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      CREATE ROLE rr_disposable_stranger NOLOGIN;
      GRANT UPDATE ("mode") ON public."HostedHistoricalScopePolicy" TO rr_disposable_stranger;
      SELECT pg_catalog.has_column_privilege('rr_disposable_stranger',
        'public."HostedHistoricalScopePolicy"','mode','UPDATE');
      ${disposableFullChainVerificationSql}`,
      );
      expect(strangerDirty.status).not.toBe(0);
      expect(strangerDirty.output).toMatch(/(^|\n)t\n/u);
      expect(strangerDirty.output).toContain(
        "disposable_full_chain_verification_failed",
      );
      expect(
        query(
          "postgres",
          "SELECT to_regrole('rr_disposable_stranger') IS NULL",
        ),
      ).toBe("t");
      const ownerProjectionDirty = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      GRANT UPDATE ("mode") ON public."HostedHistoricalScopePolicy"
        TO reviewrouter_release_schema_owner;
      SELECT pg_catalog.has_column_privilege('reviewrouter_release_schema_owner',
        'public."HostedHistoricalScopePolicy"','mode','UPDATE');
      ${disposableFullChainVerificationSql}`,
      );
      expect(ownerProjectionDirty.status).not.toBe(0);
      expect(ownerProjectionDirty.output).toMatch(/(^|\n)t\n/u);
      expect(ownerProjectionDirty.output).toContain(
        "disposable_full_chain_verification_failed",
      );
      const helperDirty = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_test",
        ],
        `BEGIN;
      GRANT EXECUTE ON FUNCTION public.hosted_historical_grant_guard() TO PUBLIC;
      SELECT pg_catalog.has_function_privilege('reviewrouter_web',
        'public.hosted_historical_grant_guard()','EXECUTE');
      ${disposableFullChainVerificationSql}`,
      );
      expect(helperDirty.status).not.toBe(0);
      expect(helperDirty.output).toMatch(/(^|\n)t\n/u);
      expect(helperDirty.output).toContain(
        "disposable_full_chain_verification_failed",
      );
      query("rr_role_test", disposableFullChainVerificationSql);
      expect(
        Number(
          query(
            "rr_role_test",
            `SELECT count(*) FROM public._prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
          ),
        ),
      ).toBe(stockCount);
      expect(
        query(
          "rr_role_test",
          `SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name='000110_historical_unknown_scope_barrier' AND finished_at IS NOT NULL`,
        ),
      ).toBe("1");
      expect(
        query("rr_role_test", `SELECT session_user || ':' || current_user`),
      ).toBe("postgres:postgres");
      migrate("rr_role_provider", pre79);
      assertStockLedger("rr_role_provider", pre79Names);
      // The provider database stops at the bridge; the ordinary database did not.
      expect(
        query(
          "rr_role_provider",
          `SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name LIKE '000079_%'`,
        ),
      ).toBe("0");
      migrate("rr_role_provider", through79);
      assertStockLedger(
        "rr_role_provider",
        stockMigrationNames.filter((name) => name < "000080_"),
      );
      expect(
        query(
          "rr_role_provider",
          `SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name LIKE '000079_%' AND finished_at IS NOT NULL`,
        ),
      ).toBe("2");
      // INHERIT FALSE still leaves SET ROLE authority. The handoff must reject
      // that cluster edge before either provider relation changes owner.
      const setOnlyBeforeHandoff = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_provider",
        ],
        `BEGIN;
      ${setOnlyGrant}
      SELECT ${setOnlyEdgeObserved};
      ${disposableProvider79HandoffSql}`,
      );
      expect(setOnlyBeforeHandoff.status).not.toBe(0);
      expect(setOnlyBeforeHandoff.output).toMatch(/(^|\n)t\n/u);
      expect(setOnlyBeforeHandoff.output).toContain(
        "disposable_provider79_handoff_invalid",
      );
      expect(
        query(
          "rr_role_provider",
          `SELECT pg_catalog.pg_get_userbyid(relowner)
      FROM pg_catalog.pg_class WHERE oid=
        'public."ReviewProviderScopeConcurrencyControl"'::regclass`,
        ),
      ).toBe("postgres");
      expect(
        query(
          "postgres",
          `SELECT count(*) FROM pg_catalog.pg_auth_members
      WHERE roleid='reviewrouter_release_schema_owner'::regrole
        AND member='reviewrouter_release_migration'::regrole`,
        ),
      ).toBe("0");
      const pollutedProviderHandoff = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_provider",
        ],
        `BEGIN;
      GRANT CREATE ON SCHEMA public TO reviewrouter_release_schema_owner;
      SELECT pg_catalog.has_schema_privilege('reviewrouter_release_schema_owner',
        'public','CREATE');
      ${disposableProvider79HandoffSql}`,
      );
      expect(pollutedProviderHandoff.status).not.toBe(0);
      expect(pollutedProviderHandoff.output).toMatch(/(^|\n)t\n/u);
      expect(pollutedProviderHandoff.output).toContain(
        "disposable_provider79_handoff_invalid",
      );
      expect(
        query(
          "rr_role_provider",
          `SELECT pg_catalog.has_schema_privilege(
      'reviewrouter_release_schema_owner','public','CREATE')`,
        ),
      ).toBe("f");
      query("rr_role_provider", disposableProvider79HandoffSql);
      query(
        "rr_role_provider",
        disposableRuntimeQualifiedVerificationSql("provider79"),
      );
      rejectDirty(
        "rr_role_provider",
        setOnlyGrant,
        setOnlyEdgeObserved,
        disposableProvider79VerificationSql,
        "disposable_provider79_verification_failed",
      );
      expect(
        query(
          "postgres",
          `SELECT count(*) FROM pg_catalog.pg_auth_members
      WHERE roleid='reviewrouter_release_schema_owner'::regrole
        AND member='reviewrouter_release_migration'::regrole`,
        ),
      ).toBe("0");
      for (const role of [
        "reviewrouter_api",
        "reviewrouter_web",
        "reviewrouter_worker",
        "reviewrouter_comment_token_custody",
        "reviewrouter_codex_effect_authority",
      ]) {
        expect(
          query(
            "rr_role_provider",
            `BEGIN;
        SET LOCAL SESSION AUTHORIZATION ${role};
        SELECT session_user || ':' || current_user;
        SELECT pg_catalog.has_table_privilege(current_user,
          'public."ReviewProviderScopeConcurrencyControl"','UPDATE') OR
          pg_catalog.has_any_column_privilege(current_user,
            'public."ReviewProviderScopeConcurrencyControl"','UPDATE');
        COMMIT;`,
          ),
        ).toBe(`${role}:${role}\nf`);
      }
      for (const routine of [
        "reviewrouter_provider_scope_concurrency_snapshot()",
        "reviewrouter_provider_scope_concurrency_status()",
        "reviewrouter_provider_scope_concurrency_activate()",
        "reviewrouter_provider_scope_concurrency_close_for_rollback()",
        "reviewrouter_provider_scope_concurrency_verify_rollback()",
      ]) {
        rejectDirty(
          "rr_role_provider",
          `ALTER FUNCTION public.${routine} RESET ALL;`,
          `proconfig IS NULL FROM pg_catalog.pg_proc WHERE oid='public.${routine}'::regprocedure`,
          disposableProvider79VerificationSql,
          "disposable_provider79_verification_failed",
        );
        rejectDirty(
          "rr_role_provider",
          `ALTER FUNCTION public.${routine} SET search_path=public;`,
          `proconfig @> ARRAY['search_path=public'] FROM pg_catalog.pg_proc
          WHERE oid='public.${routine}'::regprocedure`,
          disposableProvider79VerificationSql,
          "disposable_provider79_verification_failed",
        );
        rejectDirty(
          "rr_role_provider",
          `ALTER FUNCTION public.${routine} SECURITY INVOKER;`,
          `NOT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.${routine}'::regprocedure`,
          disposableProvider79VerificationSql,
          "disposable_provider79_verification_failed",
        );
        rejectDirty(
          "rr_role_provider",
          `ALTER FUNCTION public.${routine} OWNER TO postgres;`,
          `pg_catalog.pg_get_userbyid(proowner)='postgres' FROM pg_catalog.pg_proc
          WHERE oid='public.${routine}'::regprocedure`,
          disposableProvider79VerificationSql,
          "disposable_provider79_verification_failed",
        );
      }
      for (const role of [
        "reviewrouter_api",
        "reviewrouter_web",
        "reviewrouter_worker",
        "reviewrouter_comment_token_custody",
        "reviewrouter_codex_effect_authority",
      ]) {
        rejectDirty(
          "rr_role_provider",
          `ALTER ROLE ${role} RENAME TO ${role}_missing;`,
          `pg_catalog.to_regrole('${role}') IS NULL`,
          disposableRuntimeQualifiedVerificationSql("provider79"),
          "disposable_provider79_runtime_identity_invalid",
        );
      }
      rejectDirty(
        "rr_role_provider",
        `CREATE ROLE rr_provider_execute_capability NOLOGIN;
      GRANT rr_provider_execute_capability TO reviewrouter_api;
      GRANT EXECUTE ON FUNCTION public.reviewrouter_provider_scope_concurrency_status()
        TO rr_provider_execute_capability;`,
        `pg_catalog.has_function_privilege('reviewrouter_api',
        'public.reviewrouter_provider_scope_concurrency_status()','EXECUTE')`,
        disposableProvider79VerificationSql,
        "disposable_provider79_verification_failed",
      );
      const snapshotDirty = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "rr_role_provider",
        ],
        `BEGIN;
      GRANT EXECUTE ON FUNCTION public.reviewrouter_provider_scope_concurrency_snapshot() TO PUBLIC;
      SELECT pg_catalog.has_function_privilege('reviewrouter_api',
        'public.reviewrouter_provider_scope_concurrency_snapshot()','EXECUTE');
      ${disposableProvider79VerificationSql}`,
      );
      expect(snapshotDirty.status).not.toBe(0);
      expect(snapshotDirty.output).toMatch(/(^|\n)t\n/u);
      expect(snapshotDirty.output).toContain(
        "disposable_provider79_verification_failed",
      );
      query("rr_role_provider", disposableProvider79VerificationSql);
      expect(
        query(
          "rr_role_provider",
          `SELECT pg_catalog.pg_get_userbyid(proowner) FROM pg_catalog.pg_proc
      WHERE oid='public.reviewrouter_provider_scope_concurrency_status()'::regprocedure`,
        ),
      ).toBe("reviewrouter_release_schema_owner");
      expect(
        query(
          "rr_role_provider",
          `SELECT pg_catalog.has_function_privilege('reviewrouter_release_migration',
      'public.reviewrouter_provider_scope_concurrency_status()', 'EXECUTE') AND NOT
      pg_catalog.has_table_privilege('reviewrouter_release_migration',
      'public."ReviewProviderScopeConcurrencyControl"', 'UPDATE')`,
        ),
      ).toBe("t");
      expect(
        operator(
          "rr_role_provider",
          "reviewrouter_provider_scope_concurrency_status",
        ).activated,
      ).toBe(false);
      expect(
        operator(
          "rr_role_provider",
          "reviewrouter_provider_scope_concurrency_activate",
        ).activated,
      ).toBe(true);
      expect(
        operator(
          "rr_role_provider",
          "reviewrouter_provider_scope_concurrency_close_for_rollback",
        ).activated,
      ).toBe(false);
      const restored = operator(
        "rr_role_provider",
        "reviewrouter_provider_scope_concurrency_verify_rollback",
      );
      expect(
        (restored.legacyProviderVoteIndex as Record<string, unknown>).exact,
      ).toBe(true);
      console.info(
        JSON.stringify({
          fixture: name,
          adminIdentity: "postgres:postgres",
          mainFinishedMigrations: stockCount,
          freshFinishedMigrations: stockCount,
          provider79FinishedMigrations: 2,
          providerRollbackIndexExact: true,
        }),
      );
    }, 600_000);

    it("rejects contaminated target catalogs before construction writes", () => {
      const cases: [string, string][] = [
        ["public", "GRANT CREATE ON SCHEMA public TO PUBLIC"],
        [
          "owner",
          "GRANT CREATE ON SCHEMA public TO reviewrouter_release_schema_owner",
        ],
        [
          "default",
          "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT UPDATE ON TABLES TO PUBLIC",
        ],
        [
          "column",
          `CREATE TABLE public."DirtyGate" (id integer); GRANT UPDATE (id) ON public."DirtyGate" TO reviewrouter_release_schema_owner`,
        ],
      ];
      for (const [suffix, sql] of cases) {
        const database = `rr_role_dirty_${suffix}`;
        newDatabase(database);
        query(database, sql);
        rejectFresh(database, "disposable_fresh_database_catalog_invalid");
        expect(
          query(
            database,
            "SELECT to_regclass('public._prisma_migrations') IS NULL",
          ),
        ).toBe("t");
      }
      newDatabase("rr_role_dirty_writer_schema");
      query(
        "rr_role_dirty_writer_schema",
        "GRANT CREATE ON SCHEMA public TO reviewrouter_certified_fork_writer",
      );
      expect(
        query(
          "rr_role_dirty_writer_schema",
          `SELECT pg_catalog.has_schema_privilege(
      'reviewrouter_certified_fork_writer','public','CREATE')`,
        ),
      ).toBe("t");
      rejectFresh(
        "rr_role_dirty_writer_schema",
        "disposable_fresh_database_catalog_invalid",
      );
      expect(
        query(
          "rr_role_dirty_writer_schema",
          `SELECT pg_catalog.has_schema_privilege(
      'reviewrouter_certified_fork_writer','public','CREATE')`,
        ),
      ).toBe("t");
      expect(
        query(
          "rr_role_dirty_writer_schema",
          "SELECT to_regclass('public._prisma_migrations') IS NULL",
        ),
      ).toBe("t");
      newDatabase("rr_role_dirty_writer_database");
      query(
        "postgres",
        "GRANT CREATE ON DATABASE rr_role_dirty_writer_database TO reviewrouter_certified_fork_writer",
      );
      expect(
        query(
          "rr_role_dirty_writer_database",
          `SELECT pg_catalog.has_database_privilege(
      'reviewrouter_certified_fork_writer',current_database(),'CREATE')`,
        ),
      ).toBe("t");
      rejectFresh(
        "rr_role_dirty_writer_database",
        "disposable_fresh_database_catalog_invalid",
      );
      expect(
        query(
          "rr_role_dirty_writer_database",
          `SELECT pg_catalog.has_database_privilege(
      'reviewrouter_certified_fork_writer',current_database(),'CREATE')`,
        ),
      ).toBe("t");
      expect(
        query(
          "rr_role_dirty_writer_database",
          "SELECT to_regclass('public._prisma_migrations') IS NULL",
        ),
      ).toBe("t");
      newDatabase("rr_role_dirty_fork");
      try {
        query(
          "postgres",
          "ALTER ROLE reviewrouter_certified_fork_owner CONNECTION LIMIT 1",
        );
        rejectFresh(
          "rr_role_dirty_fork",
          "disposable_fresh_database_catalog_invalid",
        );
      } finally {
        query(
          "postgres",
          "ALTER ROLE reviewrouter_certified_fork_owner CONNECTION LIMIT -1",
        );
      }
      try {
        query("postgres", "ALTER ROLE reviewrouter_release_schema_owner LOGIN");
        expect(() =>
          query("postgres", disposableReleaseMigrationRoleSql(password)),
        ).toThrow("self_hosted_release_schema_owner_invalid");
        expect(() =>
          query("rr_role_provider", disposableProvider79VerificationSql),
        ).toThrow("disposable_provider79_verification_failed");
      } finally {
        query(
          "postgres",
          "ALTER ROLE reviewrouter_release_schema_owner NOLOGIN",
        );
      }
      try {
        query(
          "postgres",
          "ALTER ROLE reviewrouter_release_schema_owner CONNECTION LIMIT 1",
        );
        expect(() =>
          query("postgres", disposableReleaseMigrationRoleSql(password)),
        ).toThrow("self_hosted_release_schema_owner_invalid");
        expect(() =>
          query("rr_role_provider", disposableProvider79VerificationSql),
        ).toThrow("disposable_provider79_verification_failed");
      } finally {
        query(
          "postgres",
          "ALTER ROLE reviewrouter_release_schema_owner CONNECTION LIMIT -1",
        );
      }
      query("postgres", "CREATE ROLE rr_disposable_member NOLOGIN");
      try {
        try {
          query(
            "postgres",
            "GRANT reviewrouter_release_schema_owner TO rr_disposable_member",
          );
          expect(() =>
            query("postgres", disposableReleaseMigrationRoleSql(password)),
          ).toThrow("self_hosted_release_schema_owner_invalid");
          expect(() =>
            query("rr_role_provider", disposableProvider79VerificationSql),
          ).toThrow("disposable_provider79_verification_failed");
        } finally {
          query(
            "postgres",
            "REVOKE reviewrouter_release_schema_owner FROM rr_disposable_member RESTRICT",
          );
        }
        try {
          query(
            "postgres",
            "GRANT rr_disposable_member TO reviewrouter_release_schema_owner",
          );
          expect(() =>
            query("postgres", disposableReleaseMigrationRoleSql(password)),
          ).toThrow("self_hosted_release_schema_owner_invalid");
          expect(() =>
            query("rr_role_provider", disposableProvider79VerificationSql),
          ).toThrow("disposable_provider79_verification_failed");
        } finally {
          query(
            "postgres",
            "REVOKE rr_disposable_member FROM reviewrouter_release_schema_owner RESTRICT",
          );
        }
        query("postgres", "CREATE ROLE rr_disposable_other NOLOGIN");
        const memberOid = query(
          "postgres",
          "SELECT oid FROM pg_catalog.pg_roles WHERE rolname='rr_disposable_member'",
        );
        const otherOid = query(
          "postgres",
          "SELECT oid FROM pg_catalog.pg_roles WHERE rolname='rr_disposable_other'",
        );
        try {
          query(
            "postgres",
            `GRANT rr_disposable_member TO reviewrouter_release_schema_owner WITH ADMIN TRUE;
          SET ROLE reviewrouter_release_schema_owner;
          GRANT rr_disposable_member TO rr_disposable_other;
          RESET ROLE;`,
          );
          expect(
            query(
              "postgres",
              `SELECT count(*) FROM pg_catalog.pg_auth_members
          WHERE grantor='reviewrouter_release_schema_owner'::regrole`,
            ),
          ).toBe("1");
          expect(() =>
            query("postgres", disposableReleaseMigrationRoleSql(password)),
          ).toThrow("self_hosted_release_schema_owner_invalid");
          expect(() =>
            query("rr_role_provider", disposableProvider79VerificationSql),
          ).toThrow("disposable_provider79_verification_failed");
        } finally {
          query(
            "postgres",
            `SET ROLE reviewrouter_release_schema_owner;
          REVOKE rr_disposable_member FROM rr_disposable_other RESTRICT;
          RESET ROLE;
          REVOKE rr_disposable_member FROM reviewrouter_release_schema_owner RESTRICT;`,
          );
          try {
            expect(
              query(
                "postgres",
                `SELECT count(*) FROM pg_catalog.pg_auth_members
            WHERE roleid IN (${memberOid},${otherOid})
               OR member IN (${memberOid},${otherOid})
               OR grantor IN (${memberOid},${otherOid},
                 'reviewrouter_release_schema_owner'::regrole)`,
              ),
            ).toBe("0");
          } finally {
            query("postgres", "DROP ROLE rr_disposable_other");
          }
        }
      } finally {
        query("postgres", "DROP ROLE rr_disposable_member");
      }
      expect(
        query(
          "postgres",
          `SELECT count(*) FROM pg_catalog.pg_auth_members
      WHERE roleid=pg_catalog.to_regrole('rr_disposable_member')
         OR member=pg_catalog.to_regrole('rr_disposable_other')
         OR grantor='reviewrouter_release_schema_owner'::regrole`,
        ),
      ).toBe("0");
      expect(
        query(
          "postgres",
          `SELECT pg_catalog.to_regrole('rr_disposable_member') IS NULL
      AND pg_catalog.to_regrole('rr_disposable_other') IS NULL`,
        ),
      ).toBe("t");
      const expiry = docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-XqAt",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        `BEGIN;
      ALTER ROLE reviewrouter_release_schema_owner VALID UNTIL '2030-01-01';
      ${disposableReleaseMigrationRoleSql(password)}`,
      );
      expect(expiry.status).not.toBe(0);
      expect(expiry.output).toContain(
        "self_hosted_release_schema_owner_invalid",
      );
      expect(
        query(
          "postgres",
          `SELECT rolvaliduntil IS NULL FROM pg_catalog.pg_roles
      WHERE rolname='reviewrouter_release_schema_owner'`,
        ),
      ).toBe("t");
      let error = "";
      try {
        query("rr_role_test", disposableReleaseMigrationRoleSql(password));
      } catch (cause) {
        error = String(cause);
      }
      expect(error).toContain("self_hosted_release_role_admin_required");
      expect(error).not.toContain(password);
      expect(
        query(
          "postgres",
          `SELECT (SELECT count(*) FROM pg_catalog.pg_auth_members e
      WHERE e.roleid IN ('reviewrouter_release_schema_owner'::regrole,
        'reviewrouter_release_migration'::regrole)
        OR e.member IN ('reviewrouter_release_schema_owner'::regrole,
          'reviewrouter_release_migration'::regrole)
        OR e.grantor IN ('reviewrouter_release_schema_owner'::regrole,
          'reviewrouter_release_migration'::regrole)) = 0
      AND (SELECT NOT rolcanlogin AND rolvaliduntil IS NULL AND rolconnlimit=-1
        FROM pg_catalog.pg_roles WHERE rolname='reviewrouter_release_schema_owner')
      AND (SELECT rolcanlogin AND rolvaliduntil IS NULL
        FROM pg_catalog.pg_roles WHERE rolname='reviewrouter_release_migration')`,
        ),
      ).toBe("t");
    }, 90_000);

    it("removes only the exact created migration login after its databases are gone", () => {
      const oid = query(
        "postgres",
        `SELECT oid FROM pg_catalog.pg_roles
      WHERE rolname='reviewrouter_release_migration'`,
      );
      expect(oid).toMatch(/^[1-9][0-9]*$/u);
      expect(() =>
        query(
          "postgres",
          disposableReleaseMigrationRoleCleanupSql(String(Number(oid) + 1)),
        ),
      ).toThrow("disposable_release_role_cleanup_invalid");
      expect(() =>
        query("postgres", disposableReleaseMigrationRoleCleanupSql(oid)),
      ).toThrow(); // live database grants must prevent premature cluster cleanup
      expect(
        query(
          "postgres",
          "SELECT to_regrole('reviewrouter_release_migration') IS NOT NULL",
        ),
      ).toBe("t");
      query("postgres", "DROP DATABASE rr_role_test");
      query("postgres", "DROP DATABASE rr_role_provider");
      query("postgres", disposableReleaseMigrationRoleCleanupSql(oid));
      expect(
        query(
          "postgres",
          "SELECT to_regrole('reviewrouter_release_migration') IS NULL",
        ),
      ).toBe("t");
      expect(
        query(
          "postgres",
          "SELECT to_regrole('reviewrouter_release_schema_owner') IS NOT NULL",
        ),
      ).toBe("t");
    }, 90_000);
  },
);
