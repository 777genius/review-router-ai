import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PrismaActionControlPlaneRepository } from "../../../action-control-plane/src/infrastructure/prisma/prisma-action-control-plane-repository";
import { switchRepositoryConfigurationAuthMode } from "../../../workflow-provisioning/src/infrastructure/prisma/prisma-hosted-pool-configuration";
import {
  parseReviewConfigurationStrict,
  PrismaReviewConfigurationRepository,
  resolveReviewConfiguration,
  safeDefaultReviewConfiguration,
  saveReviewConfiguration,
} from "../index";

const enabled = process.env.RR_REVIEW_CONFIG_GATEWAY_PG_TEST === "1";

// Same boundary as the provider-accounts PG suite: an explicitly disposable
// empty loopback DB/cluster, no ambient DATABASE_URL, password, pgpass or SSL.
function disposableTarget(raw: string) {
  const url = new URL(raw);
  const port = url.port ? Number(url.port) : 5432;
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^rr_gateway_test_c2b_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    !/^[a-zA-Z0-9_]+$/.test(url.username) ||
    url.password ||
    url.search ||
    url.hash ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("review_config_disposable_loopback_database_required");
  }
  return {
    host: url.hostname === "[::1]" ? "::1" : url.hostname,
    port,
    user: url.username,
    database: url.pathname.slice(1),
    password: () => "",
    ssl: false,
    max: 8,
    options: "-c search_path=public",
    application_name: "rr_gateway_config_c2b_test",
    client_encoding: "UTF8",
  };
}

// Detects persistence/adapter loss, parent workspace substitution, SQL bypass,
// stale CAS overwrites and selection of revoked/fenced/foreign/personal bindings.
// This proves product configuration only, never live gateway execution admission.
describe.skipIf(!enabled)(
  "C2b actual migrated PostgreSQL configuration",
  () => {
    it("backfills legacy rows and enforces safe scoped versioned selections", async () => {
      expect(process.env.RR_REVIEW_CONFIG_GATEWAY_DISPOSABLE_CLUSTER).toBe("1");
      const target = disposableTarget(
        process.env.RR_REVIEW_CONFIG_GATEWAY_PG_TEST_URL ?? "",
      );
      const [{ Client }, { PrismaClient }, { PrismaPg }] = await Promise.all([
        import("pg"),
        import("@prisma/client"),
        import("@prisma/adapter-pg"),
      ]);
      const sql = new Client(target);
      await sql.connect();
      let prisma: InstanceType<typeof PrismaClient> | undefined;
      let refetched: InstanceType<typeof PrismaClient> | undefined;
      try {
        const empty = await sql.query<{ nonempty: boolean }>(`
        SELECT EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          UNION ALL
          SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          UNION ALL
          SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
          UNION ALL
          SELECT 1 FROM pg_namespace n WHERE n.nspname !~ '^pg_'
            AND n.nspname NOT IN ('information_schema', 'public')
        ) AS nonempty`);
        expect(empty.rows[0]?.nonempty).toBe(false);
        const migrations = new URL(
          "../../../../platform/db/prisma/migrations/",
          import.meta.url,
        );
        const names = (await readdir(migrations))
          .filter((name) => /^\d{6}_/.test(name))
          .sort();
        expect(names.at(-1)).toBe(
          "000119_review_configuration_gateway_binding",
        );
        let legacyBefore: unknown;
        for (const name of names) {
          if (name === "000119_review_configuration_gateway_binding") {
            // Real pre-119 data detects destructive backfill or parent-scope guessing.
            await sql.query(`
            INSERT INTO "Workspace" ("id", "slug", "name", "updatedAt") VALUES
              ('c2b-w', 'c2b-w', 'Synthetic W', now()), ('c2b-x', 'c2b-x', 'Synthetic X', now());
            INSERT INTO "ReviewConfiguration" ("id", "workspaceId", "targetKey", "updatedAt")
              VALUES ('c2b-legacy-config', 'c2b-w', 'workspace:default', now());
            INSERT INTO "ReviewConfigurationVersion" ("id", "configurationId", "version", "schemaVersion",
              "providerKind", "providerAuthMode", "model", "reasoningEffort", "failOnSeverity",
              "inlineMaxComments", "targetTokensPerBatch") VALUES
              ('c2b-legacy-version', 'c2b-legacy-config', 1, 2, 'codex',
               'codex_subscription_oauth_rotating', 'gpt-5.6-sol', 'high', 'critical', 50, 50000);
            INSERT INTO "ReviewConfigurationVersionProvider" ("id", "configurationVersionId", "order",
              "providerKind", "providerAuthMode", "model", "reasoningEffort", "requiredHealthy") VALUES
              ('c2b-legacy-provider', 'c2b-legacy-version', 0, 'codex',
               'codex_subscription_oauth_rotating', 'gpt-5.6-sol', 'high', true);`);
            legacyBefore = (
              await sql.query(`
            SELECT (SELECT to_jsonb(v) FROM "ReviewConfigurationVersion" v
                    WHERE v."id" = 'c2b-legacy-version') AS v,
                   (SELECT to_jsonb(p) FROM "ReviewConfigurationVersionProvider" p
                    WHERE p."id" = 'c2b-legacy-provider') AS p`)
            ).rows;
          }
          // Match the existing account PG convention: psql runs statements singly,
          // including historical CONCURRENTLY and enum migrations outside implicit transactions.
          const applied = spawnSync(
            "psql",
            [
              "-X",
              "--no-password",
              "-v",
              "ON_ERROR_STOP=1",
              "-h",
              target.host,
              "-p",
              String(target.port),
              "-U",
              target.user,
              "-d",
              target.database,
            ],
            {
              input: await readFile(
                new URL(`${name}/migration.sql`, migrations),
                "utf8",
              ),
              encoding: "utf8",
              timeout: 60_000,
              env: {
                PATH: process.env.PATH,
                PGPASSFILE: "/dev/null",
                PGSSLMODE: "disable",
                PGOPTIONS: "-c search_path=public",
              },
            },
          );
          expect(
            applied.error,
            "psql required for historical migrations",
          ).toBeUndefined();
          expect(
            applied.status,
            `migration ${name} failed: ${applied.stderr}`,
          ).toBe(0);
        }
        const legacyAfter = await sql.query(`
        SELECT (SELECT to_jsonb(v) - 'workspaceId' - 'gatewayBindingId' - 'gatewayProfileRef'
                FROM "ReviewConfigurationVersion" v WHERE v."id" = 'c2b-legacy-version') AS v,
               (SELECT to_jsonb(p) - 'workspaceId' - 'gatewayBindingId' - 'gatewayProfileRef'
                FROM "ReviewConfigurationVersionProvider" p WHERE p."id" = 'c2b-legacy-provider') AS p`);
        expect(legacyAfter.rows).toEqual(legacyBefore);
        for (const table of [
          "ReviewConfigurationVersion",
          "ReviewConfigurationVersionProvider",
        ] as const) {
          const rows = (
            await sql.query(
              `SELECT "workspaceId", "gatewayBindingId", "gatewayProfileRef" FROM "${table}"`,
            )
          ).rows;
          expect(rows).toEqual([
            {
              workspaceId: "c2b-w",
              gatewayBindingId: null,
              gatewayProfileRef: null,
            },
          ]);
        }

        prisma = new PrismaClient({
          adapter: new PrismaPg(target),
          transactionOptions: { maxWait: 10_000, timeout: 20_000 },
        });
        const configs = new PrismaReviewConfigurationRepository(prisma);
        const workspace = { scope: "workspace", workspaceId: "c2b-w" } as const;
        await prisma.repositoryConnection.create({
          data: {
            id: "c2b-repo",
            workspaceId: workspace.workspaceId,
            externalRepositoryId: "c2b-repo",
            owner: "synthetic",
            name: "repo",
            fullName: "synthetic/repo",
            defaultBranch: "main",
            visibility: "private",
          },
        });
        const repository = {
          ...workspace,
          scope: "repository",
          repositoryId: "c2b-repo",
        } as const;
        const deps = { configurations: configs };
        // A gateway opt-in must preserve clearing a legacy repository override.
        await configs.saveNextVersion({
          target: repository,
          config: safeDefaultReviewConfiguration,
          expectedVersion: null,
        });
        expect(await configs.deleteTarget(repository)).toBe(true);
        expect(await configs.findLatest(repository)).toBeNull();
        expect(
          (
            await resolveReviewConfiguration(
              { scope: "workspace", workspaceId: "c2b-x" },
              deps,
            )
          ).config,
        ).toEqual(safeDefaultReviewConfiguration);
        expect(
          (await resolveReviewConfiguration(repository, deps)).source,
        ).toBe("workspace");

        async function binding(
          id: string,
          workspaceId = "c2b-w",
          profileRef = "profile-mimo",
          ownerUserId?: string,
        ) {
          await prisma!.providerAccountConnection.create({
            data: {
              id: `${id}-connection`,
              ...(ownerUserId
                ? { ownerUserId }
                : { ownerWorkspaceId: workspaceId }),
              gatewayAccountRef: `${id}-account`,
              profileRef,
              displayName: "Synthetic account",
              state: "active",
            },
          });
          await prisma!.workspaceAccountBinding.create({
            data: {
              id,
              workspaceId,
              connectionId: `${id}-connection`,
              state: "active",
            },
          });
        }
        await binding("c2b-first");
        await binding("c2b-second", "c2b-w", "profile-openrouter");
        await binding("c2b-foreign", "c2b-x");
        const provider = (
          gatewayBindingId = "c2b-first",
          gatewayProfileRef = "profile-mimo",
          model = "mimo-v2-pro",
        ) => ({
          kind: "codex",
          authMode: "codex_account_gateway",
          model,
          gatewayBindingId,
          gatewayProfileRef,
          reasoningEffort: "high",
          agenticContext: false,
          fastMode: true,
        });
        const configFor = (selected: unknown) =>
          parseReviewConfigurationStrict({
            schemaVersion: 2,
            providers: [selected],
            blockingPolicy: {},
            limits: {},
          });
        const config = parseReviewConfigurationStrict({
          schemaVersion: 2,
          providers: [
            provider(),
            provider("c2b-second", "profile-openrouter", "openai/gpt-5.6-sol"),
          ],
          execution: { providerMaxParallel: 2 },
          blockingPolicy: {},
          limits: {},
        });
        const savedDefault = await saveReviewConfiguration(
          { target: workspace, config, expectedVersion: 1 },
          deps,
        );
        expect(savedDefault.version).toBe(2);
        expect(savedDefault.config).toEqual(config);
        expect(
          (await resolveReviewConfiguration(repository, deps)).config,
        ).toEqual(config);
        const override = configFor(
          provider("c2b-second", "profile-openrouter", "openai/gpt-5.6-sol"),
        );
        const saved = await saveReviewConfiguration(
          { target: repository, config: override, expectedVersion: null },
          deps,
        );
        expect(
          (await resolveReviewConfiguration(repository, deps)).source,
        ).toBe("repository");
        expect((await configs.findLatest(repository))?.config).toEqual(
          override,
        );
        // Old-pool provisioning must not convert a pinned gateway selection.
        expect(
          await prisma.$transaction((transaction) =>
            switchRepositoryConfigurationAuthMode({
              transaction,
              workspaceId: "c2b-w",
              repositoryId: "c2b-repo",
              authMode: "codex_subscription_oauth_hosted_pool",
            }),
          ),
        ).toBe(false);
        expect(await configs.findLatest(repository)).toEqual(saved);
        // The existing CI configuration reader must preserve the saved gateway
        // references instead of stripping them during DTO reconstruction.
        const runtimeConfig = await new PrismaActionControlPlaneRepository(
          prisma,
        ).findRuntimeReviewConfiguration({
          workspaceId: "c2b-w",
          repositoryId: "c2b-repo",
        });
        expect(runtimeConfig).toEqual({
          source: "repository",
          version: saved.version,
          config: override,
        });

        expect(
          await configs.findLatestForRepositories({
            workspaceId: "c2b-w",
            repositoryIds: ["c2b-repo"],
          }),
        ).toEqual([{ repositoryId: "c2b-repo", config: saved }]);
        const firstVersion =
          await prisma.reviewConfigurationVersion.findFirstOrThrow({
            where: {
              configuration: { workspaceId: "c2b-w", repositoryId: "c2b-repo" },
            },
            include: { providers: { orderBy: { order: "asc" } } },
          });
        expect(firstVersion.gatewayBindingId).toBe("c2b-second");
        expect(firstVersion.gatewayProfileRef).toBe("profile-openrouter");
        expect(
          firstVersion.providers.map((p) => [
            p.workspaceId,
            p.gatewayBindingId,
            p.gatewayProfileRef,
          ]),
        ).toEqual([["c2b-w", "c2b-second", "profile-openrouter"]]);
        const defaultVersion =
          await prisma.reviewConfigurationVersion.findFirstOrThrow({
            where: { configurationId: "c2b-legacy-config", version: 2 },
            include: { providers: { orderBy: { order: "asc" } } },
          });
        expect(
          defaultVersion.providers.map((p) => [
            p.gatewayBindingId,
            p.gatewayProfileRef,
          ]),
        ).toEqual([
          ["c2b-first", "profile-mimo"],
          ["c2b-second", "profile-openrouter"],
        ]);
        expect(defaultVersion.gatewayBindingId).toBe(
          defaultVersion.providers[0]?.gatewayBindingId,
        );

        await prisma.$disconnect();
        refetched = new PrismaClient({
          adapter: new PrismaPg(target),
          transactionOptions: { maxWait: 10_000, timeout: 20_000 },
        });
        prisma = refetched;
        const fresh = new PrismaReviewConfigurationRepository(refetched);
        expect(await fresh.findLatest(repository)).toEqual(saved);
        expect((await fresh.findLatest(workspace))?.config).toEqual(config);
        const next = await fresh.saveNextVersion({
          target: repository,
          config,
          expectedVersion: 1,
        });
        expect(next.version).toBe(2);
        await expect(
          fresh.saveNextVersion({
            target: repository,
            config: override,
            expectedVersion: 1,
          }),
        ).rejects.toMatchObject({
          code: "review_configuration_write_conflict",
        });
        expect(await fresh.findLatest(repository)).toEqual(next);
        expect(
          await refetched.reviewConfigurationVersion.findUniqueOrThrow({
            where: { id: firstVersion.id },
            include: { providers: { orderBy: { order: "asc" } } },
          }),
        ).toEqual(firstVersion);

        // Real SQL INSERTs, not Prisma validation, must fail with the intended FK/CHECK.
        for (const table of [
          "ReviewConfigurationVersion",
          "ReviewConfigurationVersionProvider",
        ] as const) {
          const templateId =
            table === "ReviewConfigurationVersion"
              ? firstVersion.id
              : firstVersion.providers[0]!.id;
          let ordinal = 1000;
          async function deniedInsert(
            patch: Record<string, unknown>,
            code: string,
          ) {
            ordinal += 1;
            const overrides = {
              id: `c2b-denied-${ordinal}`,
              version: ordinal,
              order: ordinal,
              ...patch,
            };
            await expect(
              sql.query(
                `INSERT INTO "${table}" SELECT
            (jsonb_populate_record(NULL::"${table}", to_jsonb(base) || $2::jsonb)).*
            FROM "${table}" base WHERE base."id" = $1`,
                [templateId, JSON.stringify(overrides)],
              ),
            ).rejects.toMatchObject({ code });
          }
          await deniedInsert({ gatewayBindingId: "c2b-foreign" }, "23503");
          await deniedInsert(
            { workspaceId: "c2b-x", gatewayBindingId: "c2b-foreign" },
            "23503",
          );
          await deniedInsert(
            { gatewayBindingId: null, gatewayProfileRef: null },
            "23514",
          );
          await deniedInsert({ gatewayBindingId: null }, "23514");
          await deniedInsert({ gatewayProfileRef: null }, "23514");
          await deniedInsert({ gatewayProfileRef: "" }, "23514");
          await deniedInsert(
            { gatewayProfileRef: "https://private.example" },
            "23514",
          );
          await deniedInsert({ gatewayProfileRef: "p".repeat(161) }, "23514");
          await deniedInsert({ providerKind: "claude" }, "23514");
          await deniedInsert(
            { providerAuthMode: "codex_subscription_oauth_rotating" },
            "23514",
          );
          await deniedInsert({ providerAuthMode: "unknown_gateway" }, "23514");
        }
        // Detects a forged root parent assigning W's actual repository to workspace X,
        // even before it has versions that could otherwise enforce the parent scope.
        await expect(
          sql.query(`INSERT INTO "ReviewConfiguration"
        ("id", "workspaceId", "repositoryId", "targetKey", "updatedAt") VALUES
        ('c2b-forged-parent', 'c2b-x', 'c2b-repo', 'repo:c2b-repo', now())`),
        ).rejects.toMatchObject({ code: "23503" });
        expect(
          await refetched.reviewConfiguration.findUnique({
            where: { id: "c2b-forged-parent" },
          }),
        ).toBeNull();
        await expect(
          sql.query(
            `DELETE FROM "WorkspaceAccountBinding" WHERE "id" = 'c2b-first'`,
          ),
        ).rejects.toMatchObject({ code: "23503" });
        await expect(
          sql.query(`UPDATE "ReviewConfiguration" SET "workspaceId" = 'c2b-x'
        WHERE "id" = 'c2b-legacy-config'`),
        ).rejects.toMatchObject({ code: "23503" });

        // Eligibility is checked live in the same save transaction; denied saves leave no version.
        const refused = async (
          selected: unknown,
          message = "review_configuration_gateway_binding_unavailable",
        ) => {
          await expect(
            fresh.saveNextVersion({
              target: repository,
              config: configFor(selected),
              expectedVersion: 2,
            }),
          ).rejects.toThrow(message);
          expect(await fresh.findLatest(repository)).toEqual(next);
        };
        await refused(provider("c2b-missing"));
        await refused(provider("c2b-foreign"));
        // A scoped binding alone cannot authorize a connection owned by another workspace.
        await refetched.workspaceAccountBinding.create({
          data: {
            id: "c2b-foreign-owner",
            workspaceId: "c2b-w",
            connectionId: "c2b-foreign-connection",
            state: "active",
          },
        });
        await refused(provider("c2b-foreign-owner"));
        await refused(
          provider("c2b-first", "profile-mismatch"),
          "review_configuration_gateway_profile_mismatch",
        );
        await binding("c2b-revoked");
        await sql.query(`UPDATE "WorkspaceAccountBinding" SET "state" = 'revoked', "revision" = 2,
        "policyRevision" = 2, "pendingFenceOperationId" = 'c2b-revoke-intent',
        "pendingFencePolicySubject" = "id", "pendingFencePolicyRevision" = 2 WHERE "id" = 'c2b-revoked'`);
        await refused(provider("c2b-revoked"));
        await sql.query(`UPDATE "WorkspaceAccountBinding" SET "state" = 'active', "revision" = 3,
        "policyRevision" = 3 WHERE "id" = 'c2b-revoked'`);
        await refused(provider("c2b-revoked")); // Active rebind must still deny while the fence is pending.
        await sql.query(`UPDATE "WorkspaceAccountBinding" SET "pendingFenceOperationId" = NULL,
        "pendingFencePolicySubject" = NULL, "pendingFencePolicyRevision" = NULL,
        "fenceAckOperationId" = 'c2b-revoke-intent', "fenceAckPolicyRevision" = 2 WHERE "id" = 'c2b-revoked'`);
        const afterAck = await fresh.saveNextVersion({
          target: repository,
          config: configFor(provider("c2b-revoked")),
          expectedVersion: 2,
        });
        expect(afterAck.version).toBe(3); // ACK2 clears retained intent without inventing ACK3.
        await sql.query(`UPDATE "WorkspaceAccountBinding" SET "state" = 'revoked', "revision" = 4,
        "policyRevision" = 4, "pendingFenceOperationId" = 'c2b-revoke-again',
        "pendingFencePolicySubject" = "id", "pendingFencePolicyRevision" = 4 WHERE "id" = 'c2b-revoked';
        UPDATE "WorkspaceAccountBinding" SET "pendingFenceOperationId" = NULL,
        "pendingFencePolicySubject" = NULL, "pendingFencePolicyRevision" = NULL,
        "fenceAckOperationId" = 'c2b-revoke-again', "fenceAckPolicyRevision" = 4 WHERE "id" = 'c2b-revoked'`);
        await expect(
          fresh.saveNextVersion({
            target: repository,
            config: configFor(provider("c2b-revoked")),
            expectedVersion: 3,
          }),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        for (const state of [
          "disabled",
          "quarantined",
          "pending",
          "unknown",
        ] as const) {
          await refetched.providerAccountConnection.update({
            where: { id: "c2b-first-connection" },
            data: { state, metadataRevision: { increment: 1 } },
          });
          await expect(
            fresh.saveNextVersion({
              target: repository,
              config: configFor(provider()),
              expectedVersion: 3,
            }),
          ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        }
        // Disabled mirror/history remains readable; previous snapshots are never rewritten.
        expect((await fresh.findLatest(workspace))?.config).toEqual(config);
        expect(
          await refetched.reviewConfigurationVersion.findUniqueOrThrow({
            where: { id: firstVersion.id },
            include: { providers: { orderBy: { order: "asc" } } },
          }),
        ).toEqual(firstVersion);
        expect(await fresh.findLatest(repository)).toEqual(afterAck);
        expect(
          await refetched.reviewConfigurationVersion.count({
            where: { configurationId: firstVersion.configurationId },
          }),
        ).toBe(3);

        await refetched.user.create({ data: { id: "c2b-user" } });
        // These are DB fixtures only; they cannot become C2b personal/sharing selection.
        await binding("c2b-user-owned", "c2b-w", "profile-mimo", "c2b-user");
        await expect(
          fresh.saveNextVersion({
            target: repository,
            config: configFor(provider("c2b-user-owned")),
            expectedVersion: 3,
          }),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        await refetched.workspace.create({
          data: {
            id: "c2b-personal",
            slug: "c2b-personal",
            name: "Synthetic personal",
            personalOwnerUserId: "c2b-user",
          },
        });
        await binding("c2b-personal-binding", "c2b-personal");
        await expect(
          fresh.saveNextVersion({
            target: { scope: "workspace", workspaceId: "c2b-personal" },
            config: configFor(provider("c2b-personal-binding")),
            expectedVersion: null,
          }),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        expect(
          await fresh.findLatest({
            scope: "workspace",
            workspaceId: "c2b-personal",
          }),
        ).toBeNull();
      } finally {
        await refetched?.$disconnect();
        if (prisma !== refetched) await prisma?.$disconnect();
        await sql.end();
      }
    }, 240_000);
  },
);
