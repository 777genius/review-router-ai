import { createHash } from "node:crypto";
import { canonicalJson } from "../domain/review-configuration";
import {
  selectionsFor,
  systemPolicyWriteFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "./current-policy-fixture";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PrismaActionControlPlaneRepository } from "../../../action-control-plane/src/infrastructure/prisma/prisma-action-control-plane-repository";
import { switchRepositoryConfigurationAuthMode } from "../../../workflow-provisioning/src/infrastructure/prisma/prisma-hosted-pool-configuration";
import {
  parseRepositoryReviewPolicy,
  parseReviewConfigurationStrict,
  PrismaReviewConfigurationRepository,
  PrismaReviewConfigurationTransactionRepository,
  PrismaReviewPolicyHeadReader,
  resolveEffectiveReviewConfigurations,
  resolveReviewConfiguration,
  saveReviewConfiguration,
  type RepositoryReviewPolicy,
} from "../index";

const enabled = process.env.RR_REVIEW_CONFIG_GATEWAY_PG_TEST === "1";

// Same boundary as the provider-accounts PG suite: an explicitly disposable
// empty loopback DB/cluster, no ambient DATABASE_URL, URL password, pgpass or SSL.
// The primary qualifier supplies PGPASSWORD server-side; never put it in the URL.
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
    password: () => process.env.PGPASSWORD ?? "",
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
        // Replay every current migration, including durable review history.
        expect(names).toHaveLength(155);
        expect(names.slice(-18)).toEqual([
          "000136_review_skills",
          "000137_review_skills_capture",
          "000138_pr_description",
          "000139_review_context_tools",
          "000140_personal_oauth_method",
          "000141_memory_search_projections",
          "000142_memory_knowledge_authority",
          "000142_optional_gateway_reasoning",
          "000143_memory_maintenance_fence",
          "000143_workspace_draft_review_setting",
          "000144_review_statistics",
          "000145_workspace_provider_profiles",
          "000146_drop_review_configuration_projection",
          "000147_review_skills_mutation_identity",
          "000148_lifecycle_verification",
          "000149_api_key_repository_secret_profiles",
          "000150_skills_catalog_security",
          "000151_review_history",
        ]);
        let legacyBefore: unknown;
        let legacyBefore146: unknown;
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
          if (name === "000146_drop_review_configuration_projection") {
            // Through 145 the legacy rows kept every value.
            const legacy145 = await sql.query(`
            SELECT (SELECT to_jsonb(v) - 'workspaceId' - 'gatewayBindingId' - 'gatewayProfileRef'
                      - 'operationId' - 'operationIntentHash' - 'policyJson' - 'operationSnapshotJson'
                    FROM "ReviewConfigurationVersion" v WHERE v."id" = 'c2b-legacy-version') AS v,
                   (SELECT to_jsonb(p) - 'workspaceId' - 'gatewayBindingId' - 'gatewayProfileRef'
                    FROM "ReviewConfigurationVersionProvider" p WHERE p."id" = 'c2b-legacy-provider') AS p`);
            expect(legacy145.rows).toEqual(legacyBefore);
            legacyBefore146 = (
              await sql.query(`
              SELECT to_jsonb(v) - 'providerKind' - 'providerAuthMode' - 'model' - 'reasoningEffort'
                       - 'failOnSeverity' - 'inlineMaxComments' - 'targetTokensPerBatch' AS v
              FROM "ReviewConfigurationVersion" v WHERE v."id" = 'c2b-legacy-version'`)
            ).rows;
          }
          if (name === "000145_workspace_provider_profiles") {
            // A configured repository of the 144 schema keeps every value.
            await sql.query(`
            INSERT INTO "RepositoryConnection" ("id", "workspaceId", "externalRepositoryId",
              "owner", "name", "fullName", "defaultBranch", "visibility", "updatedAt") VALUES
              ('c2b-pre145-repo', 'c2b-x', 'c2b-pre145-repo', 'synthetic', 'pre145',
               'synthetic/pre145', 'main', 'private', now());
            INSERT INTO "WorkflowProvisioning" ("id", "attemptId", "workspaceId", "repositoryId",
              "status", "branch", "workflowPath", "actionVersion", "updatedAt") VALUES
              ('c2b-pre145-provisioning', 'c2b-pre145-attempt', 'c2b-x', 'c2b-pre145-repo',
               'configured', 'reviewrouter/setup', '.github/workflows/reviewrouter-review.yml',
               'v1', now());`);
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
                PGPASSWORD: process.env.PGPASSWORD,
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
        // 000146 drops only the projection: the rest of a legacy version stays.
        expect(
          (
            await sql.query(`
            SELECT to_jsonb(v) AS v FROM "ReviewConfigurationVersion" v
            WHERE v."id" = 'c2b-legacy-version'`)
          ).rows,
        ).toEqual(legacyBefore146);
        // 000145 keeps existing rows: unknown transports, Access rights off.
        expect(
          (
            await sql.query(`
            SELECT p."status", p."attemptWorkflowRequirement", p."installedWorkflowRequirement",
                   w."providerManagementAdminOnly"
            FROM "WorkflowProvisioning" p JOIN "Workspace" w ON w."id" = p."workspaceId"
            WHERE p."id" = 'c2b-pre145-provisioning'`)
          ).rows,
        ).toEqual([
          {
            status: "configured",
            attemptWorkflowRequirement: null,
            installedWorkflowRequirement: null,
            providerManagementAdminOnly: false,
          },
        ]);
        // 000146: no schema 1-3 projection column and no provider rows table.
        expect(
          (
            await sql.query(`
            SELECT "column_name" FROM information_schema.columns
            WHERE "table_schema" = 'public' AND "table_name" = 'ReviewConfigurationVersion'
              AND "column_name" IN ('providerKind', 'providerAuthMode', 'model',
                'reasoningEffort', 'failOnSeverity', 'inlineMaxComments', 'targetTokensPerBatch')`)
          ).rows,
        ).toEqual([]);
        expect(
          (
            await sql.query(
              `SELECT to_regclass('public."ReviewConfigurationVersionProvider"') AS t`,
            )
          ).rows,
        ).toEqual([{ t: null }]);
        // The Gateway references that stay keep their pairing and guard.
        for (const values of [
          `NULL, 'rr-profile'`,
          `'c2b-missing-binding', NULL`,
          `NULL, 'sk-live-secret'`,
        ])
          await expect(
            sql.query(
              `INSERT INTO "ReviewConfigurationVersion" ("id", "configurationId", "workspaceId", "version", "schemaVersion", "gatewayBindingId", "gatewayProfileRef") VALUES ('c2b-ref-guard', 'c2b-legacy-config', 'c2b-w', 99, 4, ${values})`,
            ),
          ).rejects.toMatchObject({ code: "23514" });
        expect(
          (
            await sql.query(
              `SELECT "workspaceId", "gatewayBindingId", "gatewayProfileRef" FROM "ReviewConfigurationVersion"`,
            )
          ).rows,
        ).toEqual([
          {
            workspaceId: "c2b-w",
            gatewayBindingId: null,
            gatewayProfileRef: null,
          },
        ]);

        prisma = new PrismaClient({
          adapter: new PrismaPg(target),
          transactionOptions: { maxWait: 10_000, timeout: 20_000 },
        });
        const configs = new PrismaReviewConfigurationRepository(
          prisma,
          undefined,
          false,
          undefined,
        );
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
        // Historical rows remain evidence, never an executable policy/default.
        expect(await configs.findLatest(workspace)).toBeNull();
        const legacyRuntime = new PrismaActionControlPlaneRepository(prisma);
        await expect(
          legacyRuntime.findRuntimeReviewConfiguration({
            workspaceId: "c2b-w",
            repositoryId: "c2b-repo",
          }),
        ).rejects.toThrow("review_policy_resave_required");
        expect(
          await legacyRuntime.findRuntimeReviewConfiguration({
            workspaceId: "c2b-x",
            repositoryId: "c2b-repo",
          }),
        ).toBeNull();
        expect(
          (
            await prisma.reviewConfigurationVersion.findUniqueOrThrow({
              where: { id: "c2b-legacy-version" },
            })
          ).policyJson,
        ).toBeNull();
        expect(
          await resolveReviewConfiguration(
            { scope: "workspace", workspaceId: "c2b-x" },
            deps,
          ),
        ).toBeNull();
        expect(await resolveReviewConfiguration(repository, deps)).toBeNull();

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
            ...workspacePolicyFixture,
            providers: [selected],
          });
        // System writes store each provider row as a profile that the write
        // finds or creates by its identity, in the document's transaction.
        const profileCount = () => prisma!.workspaceProviderProfile.count();
        const config = parseReviewConfigurationStrict({
          ...workspacePolicyFixture,
          providers: [
            provider(),
            provider("c2b-second", "profile-openrouter", "openai/gpt-5.6-sol"),
          ],
          execution: {
            providerLimit: 2,
            providerMaxParallel: 2,
            inlineMinAgreement: 1,
          },
        });
        const savedDefault = await saveReviewConfiguration(
          {
            target: workspace,
            expectedVersion: 1,
            ...systemPolicyWriteFixture(config, workspace),
          },
          deps,
        );
        expect(savedDefault.version).toBe(2);
        expect(savedDefault.config).toEqual(config);
        // Each provider row became one system profile (no creator) of W that
        // names the binding and account profile; the document only selects it.
        const defaultProfiles = await prisma.workspaceProviderProfile.findMany({
          where: { workspaceId: "c2b-w" },
          orderBy: { gatewayBindingId: "asc" },
        });
        expect(
          defaultProfiles.map((profile) => [
            profile.createdByUserId,
            profile.credentialKind,
            profile.authMode,
            profile.gatewayBindingId,
            profile.gatewayProfileRef,
            profile.model,
          ]),
        ).toEqual([
          [
            null,
            "gateway_binding",
            "codex_account_gateway",
            "c2b-first",
            "profile-mimo",
            "mimo-v2-pro",
          ],
          [
            null,
            "gateway_binding",
            "codex_account_gateway",
            "c2b-second",
            "profile-openrouter",
            "openai/gpt-5.6-sol",
          ],
        ]);
        expect(savedDefault.selections.map((s) => s.profileId)).toEqual(
          defaultProfiles.map((profile) => profile.id),
        );
        // Nullable SQL projections must preserve omission in authoritative policy
        // JSON and runtime env without rewriting legacy high/xhigh rows.
        await prisma.workspace.create({
          data: {
            id: "c2b-no-reason",
            slug: "c2b-no-reason",
            name: "No reasoning fixture",
          },
        });
        await binding(
          "c2b-no-reason-binding",
          "c2b-no-reason",
          "kimi-code-global-responses-apikey-v1",
        );
        const noReasonTarget = {
          scope: "workspace" as const,
          workspaceId: "c2b-no-reason",
        };
        const noReasonPolicy = configFor({
          ...provider(
            "c2b-no-reason-binding",
            "kimi-code-global-responses-apikey-v1",
            "k3-256k",
          ),
          reasoningEffort: undefined,
          fastMode: false,
        });
        const noReasonSaved = await saveReviewConfiguration(
          {
            target: noReasonTarget,
            expectedVersion: null,
            ...systemPolicyWriteFixture(noReasonPolicy, noReasonTarget),
          },
          deps,
        );
        expect(
          (await configs.findLatest(noReasonTarget))?.config.providers[0],
        ).not.toHaveProperty("reasoningEffort");
        expect(noReasonSaved.config.providers[0]).not.toHaveProperty(
          "reasoningEffort",
        );
        // Schema 4 writes only the document, and the selection keeps the
        // omission.
        const noReasonRows = await sql.query(
          `SELECT v."schemaVersion", v."policyJson"
           FROM "ReviewConfigurationVersion" v WHERE v."workspaceId" = 'c2b-no-reason'`,
        );
        expect(noReasonRows.rows).toHaveLength(1);
        expect(noReasonRows.rows[0]).toMatchObject({ schemaVersion: 4 });
        const noReasonSelection = JSON.parse(noReasonRows.rows[0].policyJson)
          .providers[0];
        expect(noReasonSelection).not.toHaveProperty("reasoningEffort");
        expect(noReasonSelection.profileId).toBe(
          noReasonSaved.selections[0]?.profileId,
        );

        // A retired repository head is not equivalent to no override, even with a valid workspace.
        await prisma.repositoryConnection.create({
          data: {
            id: "c2b-opaque-repo",
            workspaceId: "c2b-w",
            externalRepositoryId: "c2b-opaque-repo",
            owner: "synthetic",
            name: "opaque-repo",
            fullName: "synthetic/opaque-repo",
            defaultBranch: "main",
            visibility: "private",
          },
        });
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ReviewConfiguration" ("id", "workspaceId", "repositoryId", "targetKey", "updatedAt") VALUES ('c2b-opaque-config', 'c2b-w', 'c2b-opaque-repo', 'repo:c2b-opaque-repo', now())`,
        );
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ReviewConfigurationVersion" ("id", "configurationId", "workspaceId", "version", "schemaVersion") VALUES ('c2b-opaque-version', 'c2b-opaque-config', 'c2b-w', 1, 2)`,
        );
        const opaqueTarget = { ...repository, repositoryId: "c2b-opaque-repo" };
        const opaqueRuntimeTarget = {
          workspaceId: "c2b-w",
          repositoryId: "c2b-opaque-repo",
        };
        expect(await configs.findLatest(opaqueTarget)).toBeNull();
        await expect(
          legacyRuntime.findRuntimeReviewConfiguration(opaqueRuntimeTarget),
        ).rejects.toThrow("review_policy_resave_required");
        await expect(
          saveReviewConfiguration(
            {
              target: opaqueTarget,
              policy: { schemaVersion: 4 },
              expectedVersion: 0,
            },
            deps,
          ),
        ).rejects.toThrow();
        const replacement = await saveReviewConfiguration(
          {
            target: opaqueTarget,
            policy: {
              schemaVersion: 4,
              limits: { inlineMaxComments: 0 },
              investigationRollout: { productionEffectsEnabled: false },
            },
            expectedVersion: 1,
          },
          deps,
        );
        expect(replacement.version).toBe(2);
        expect(replacement.config.limits.inlineMaxComments).toBe(0);
        expect(
          replacement.config.investigationRollout.productionEffectsEnabled,
        ).toBe(false);
        const historyBeforeStaleReset =
          await prisma.reviewConfigurationVersion.findMany({
            where: { configurationId: "c2b-opaque-config" },
            orderBy: { version: "asc" },
          });
        await expect(
          configs.deleteTarget(opaqueTarget, 1),
        ).rejects.toMatchObject({
          code: "review_configuration_write_conflict",
        });
        expect(await configs.findLatest(opaqueTarget)).toEqual(replacement);
        expect(
          await prisma.reviewConfigurationVersion.findMany({
            where: { configurationId: "c2b-opaque-config" },
            orderBy: { version: "asc" },
          }),
        ).toEqual(historyBeforeStaleReset);
        // The existing clear path must also recover directly from a retired head.
        await prisma.$executeRawUnsafe(
          `INSERT INTO "ReviewConfigurationVersion" ("id", "configurationId", "workspaceId", "version", "schemaVersion") VALUES ('c2b-opaque-version-3', 'c2b-opaque-config', 'c2b-w', 3, 2)`,
        );
        await expect(
          legacyRuntime.findRuntimeReviewConfiguration(opaqueRuntimeTarget),
        ).rejects.toThrow("review_policy_resave_required");
        const legacyHistory = await prisma.reviewConfigurationVersion.findMany({
          where: { configurationId: "c2b-opaque-config" },
          orderBy: { version: "asc" },
        });
        expect(await configs.deleteTarget(opaqueTarget, 3)).toBe(true);
        expect(await configs.deleteTarget(opaqueTarget, null)).toBe(false);
        expect(
          await prisma.reviewConfigurationVersion.findMany({
            where: { configurationId: "c2b-opaque-config" },
            orderBy: { version: "asc" },
          }),
        ).toEqual(legacyHistory);
        expect(
          await legacyRuntime.findRuntimeReviewConfiguration(
            opaqueRuntimeTarget,
          ),
        ).toMatchObject({
          source: "workspace",
          workspaceVersion: 2,
          repositoryVersion: null,
          config,
        });
        const afterReset = await saveReviewConfiguration(
          {
            target: opaqueTarget,
            policy: { schemaVersion: 4 },
            expectedVersion: null,
          },
          deps,
        );
        expect(afterReset.version).toBe(4);
        expect(await configs.deleteTarget(opaqueTarget, 4)).toBe(true);
        expect(
          (await resolveReviewConfiguration(repository, deps))!.config,
        ).toEqual(config);
        const override = configFor(
          provider("c2b-second", "profile-openrouter", "openai/gpt-5.6-sol"),
        );
        const profilesBeforeOverride = await profileCount();
        const saved = await saveReviewConfiguration(
          {
            target: repository,
            expectedVersion: null,
            ...systemPolicyWriteFixture(override, repository),
          },
          deps,
        );
        // The override's provider is the default's second profile, found by
        // identity rather than created again.
        expect(await profileCount()).toBe(profilesBeforeOverride);
        expect(saved.selections.map((s) => s.profileId)).toEqual([
          defaultProfiles[1]!.id,
        ]);
        expect(
          (await resolveReviewConfiguration(repository, deps))!.source,
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
          workspaceVersion: 2,
          repositoryVersion: saved.version,
          effectivePolicyDigest: `sha256:${createHash("sha256").update(canonicalJson(override)).digest("hex")}`,
          config: override,
        });

        expect(
          (
            await resolveEffectiveReviewConfigurations(
              { workspaceId: "c2b-w", repositoryIds: ["c2b-repo"] },
              { policyHeads: new PrismaReviewPolicyHeadReader(prisma) },
            )
          ).repositories.get("c2b-repo"),
        ).toEqual({ status: "ready", ...saved });
        const firstVersion =
          await prisma.reviewConfigurationVersion.findFirstOrThrow({
            where: {
              configuration: { workspaceId: "c2b-w", repositoryId: "c2b-repo" },
            },
          });
        // Schema 4 versions carry no binding projection; the stored document
        // selects the profile, and the profile row names the binding.
        expect(firstVersion).toMatchObject({
          workspaceId: "c2b-w",
          schemaVersion: 4,
          gatewayBindingId: null,
          gatewayProfileRef: null,
        });
        expect(
          JSON.parse(firstVersion.policyJson!).providers.map(
            (selection: { readonly profileId: string }) => selection.profileId,
          ),
        ).toEqual([defaultProfiles[1]!.id]);
        const defaultVersion =
          await prisma.reviewConfigurationVersion.findFirstOrThrow({
            where: { configurationId: "c2b-legacy-config", version: 2 },
          });
        expect(defaultVersion).toMatchObject({
          workspaceId: "c2b-w",
          schemaVersion: 4,
          gatewayBindingId: null,
        });
        expect(
          JSON.parse(defaultVersion.policyJson!).providers.map(
            (selection: { readonly profileId: string }) => selection.profileId,
          ),
        ).toEqual(defaultProfiles.map((profile) => profile.id));

        await prisma.$disconnect();
        refetched = new PrismaClient({
          adapter: new PrismaPg(target),
          transactionOptions: { maxWait: 10_000, timeout: 20_000 },
        });
        prisma = refetched;
        const fresh = new PrismaReviewConfigurationRepository(
          refetched,
          undefined,
          false,
          undefined,
        );
        expect(await fresh.findLatest(repository)).toEqual(saved);
        expect((await fresh.findLatest(workspace))?.config).toEqual(config);
        const next = await fresh.saveNextVersion({
          target: repository,
          expectedVersion: 1,
          ...systemPolicyWriteFixture(config, repository),
        });
        expect(next.version).toBe(2);
        await expect(
          fresh.saveNextVersion({
            target: repository,
            expectedVersion: 1,
            ...systemPolicyWriteFixture(override, repository),
          }),
        ).rejects.toMatchObject({
          code: "review_configuration_write_conflict",
        });
        expect(await fresh.findLatest(repository)).toEqual(next);
        expect(
          await refetched.reviewConfigurationVersion.findUniqueOrThrow({
            where: { id: firstVersion.id },
          }),
        ).toEqual(firstVersion);

        // Real SQL INSERTs, not Prisma validation, must fail with the intended
        // FK/CHECK. The profile row is what names a binding in schema 4.
        const templateProfileId = defaultProfiles[0]!.id;
        let ordinal = 1000;
        async function deniedInsert(
          patch: Record<string, unknown>,
          code: string,
        ) {
          ordinal += 1;
          const overrides = {
            id: `c2b-denied-${ordinal}`,
            identityKey: `c2b-denied-${ordinal}`,
            ...patch,
          };
          await expect(
            sql.query(
              `INSERT INTO "WorkspaceProviderProfile" SELECT
            (jsonb_populate_record(NULL::"WorkspaceProviderProfile", to_jsonb(base) || $2::jsonb)).*
            FROM "WorkspaceProviderProfile" base WHERE base."id" = $1`,
              [templateProfileId, JSON.stringify(overrides)],
            ),
          ).rejects.toMatchObject({ code });
        }
        // A binding of another workspace, or this binding from another one.
        await deniedInsert({ gatewayBindingId: "c2b-foreign" }, "23503");
        await deniedInsert({ workspaceId: "c2b-x" }, "23503");
        // Exactly the credential kind's reference.
        await deniedInsert(
          { gatewayBindingId: null, gatewayProfileRef: null },
          "23514",
        );
        await deniedInsert({ gatewayBindingId: null }, "23514");
        await deniedInsert({ gatewayProfileRef: null }, "23514");
        await deniedInsert({ repositoryId: "c2b-repo" }, "23514");
        // Each credential kind delivers only its own auth modes.
        await deniedInsert(
          { authMode: "codex_subscription_oauth_rotating" },
          "23514",
        );
        await deniedInsert({ authMode: "unknown_gateway" }, "23514");
        await deniedInsert({ credentialKind: "hosted_pool" }, "23514");
        await deniedInsert(
          { credentialKind: "user_ci_secret", authMode: "claude_code_oauth" },
          "23514",
        );
        // Names only, never credentials; archive releases the identity.
        await deniedInsert({ gatewayProfileRef: "sk-live-secret" }, "23514");
        await deniedInsert({ label: "ghp_secret" }, "23514");
        await deniedInsert({ identityKey: null }, "23514");
        await deniedInsert(
          { identityKey: defaultProfiles[0]!.identityKey },
          "23505",
        );
        // The credential source is fixed once created.
        await expect(
          sql.query(
            `UPDATE "WorkspaceProviderProfile" SET "gatewayBindingId" = 'c2b-second' WHERE "id" = $1`,
            [templateProfileId],
          ),
        ).rejects.toMatchObject({ code: "23514" });
        expect(
          await refetched.workspaceProviderProfile.findUniqueOrThrow({
            where: { id: templateProfileId },
          }),
        ).toEqual(defaultProfiles[0]);
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

        // Eligibility is checked live in the same save transaction; denied
        // saves leave neither a version nor a profile.
        const refused = async (
          selected: unknown,
          message = "review_configuration_gateway_binding_unavailable",
        ) => {
          const profilesBefore = await profileCount();
          await expect(
            fresh.saveNextVersion({
              target: repository,
              expectedVersion: 2,
              ...systemPolicyWriteFixture(configFor(selected), repository),
            }),
          ).rejects.toThrow(message);
          expect(await fresh.findLatest(repository)).toEqual(next);
          expect(await profileCount()).toBe(profilesBefore);
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
          expectedVersion: 2,
          ...systemPolicyWriteFixture(
            configFor(provider("c2b-revoked")),
            repository,
          ),
        });
        expect(afterAck.version).toBe(3); // ACK2 clears retained intent without inventing ACK3.
        await sql.query(`UPDATE "WorkspaceAccountBinding" SET "state" = 'revoked', "revision" = 4,
        "policyRevision" = 4, "pendingFenceOperationId" = 'c2b-revoke-again',
        "pendingFencePolicySubject" = "id", "pendingFencePolicyRevision" = 4 WHERE "id" = 'c2b-revoked';
        UPDATE "WorkspaceAccountBinding" SET "pendingFenceOperationId" = NULL,
        "pendingFencePolicySubject" = NULL, "pendingFencePolicyRevision" = NULL,
        "fenceAckOperationId" = 'c2b-revoke-again', "fenceAckPolicyRevision" = 4 WHERE "id" = 'c2b-revoked'`);
        // A stored profile of a revoked binding is refused on every new save.
        await expect(
          fresh.saveNextVersion({
            target: repository,
            expectedVersion: 3,
            ...systemPolicyWriteFixture(
              configFor(provider("c2b-revoked")),
              repository,
            ),
          }),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        await expect(
          fresh.saveNextVersion({
            target: repository,
            expectedVersion: 3,
            policy: afterAck.policy as RepositoryReviewPolicy,
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
              expectedVersion: 3,
              ...systemPolicyWriteFixture(configFor(provider()), repository),
            }),
          ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        }
        // Disabled mirror/history remains readable; previous snapshots are never rewritten.
        expect((await fresh.findLatest(workspace))?.config).toEqual(config);
        expect(
          await refetched.reviewConfigurationVersion.findUniqueOrThrow({
            where: { id: firstVersion.id },
          }),
        ).toEqual(firstVersion);
        expect(await fresh.findLatest(repository)).toEqual(afterAck);
        expect(
          await refetched.reviewConfigurationVersion.count({
            where: { configurationId: firstVersion.configurationId },
          }),
        ).toBe(3);

        await refetched.user.create({ data: { id: "c2b-user" } });
        await refetched.workspace.create({
          data: {
            id: "c2b-personal",
            slug: "c2b-personal",
            name: "Synthetic personal",
            personalOwnerUserId: "c2b-user",
          },
        });
        // These are DB fixtures only; they cannot become C2b personal/sharing selection.
        await binding("c2b-user-owned", "c2b-w", "profile-mimo", "c2b-user");
        const profilesBeforePersonal = await profileCount();
        await expect(
          fresh.saveNextVersion({
            target: repository,
            expectedVersion: 3,
            ...systemPolicyWriteFixture(
              configFor(provider("c2b-user-owned")),
              repository,
            ),
          }),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        await binding("c2b-personal-binding", "c2b-personal");
        const personalTarget = {
          scope: "workspace" as const,
          workspaceId: "c2b-personal",
        };
        await expect(
          fresh.saveNextVersion({
            target: personalTarget,
            expectedVersion: null,
            ...systemPolicyWriteFixture(
              configFor(provider("c2b-personal-binding")),
              personalTarget,
            ),
          }),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        expect(await profileCount()).toBe(profilesBeforePersonal);
        expect(
          await fresh.findLatest({
            scope: "workspace",
            workspaceId: "c2b-personal",
          }),
        ).toBeNull();

        // Clearing an override deactivates it and retains its history: reads
        // and CI fall back to the workspace document, a stale CAS cannot
        // reactivate it, and the next save continues the version sequence.
        await refetched.repositoryConnection.create({
          data: {
            id: "c2b-cleared-repo",
            workspaceId: "c2b-w",
            externalRepositoryId: "c2b-cleared-repo",
            owner: "synthetic",
            name: "cleared",
            fullName: "synthetic/cleared",
            defaultBranch: "main",
            visibility: "private",
          },
        });
        const clearedTarget = {
          ...repository,
          repositoryId: "c2b-cleared-repo",
        };
        const freshDeps = { configurations: fresh };
        const original = await fresh.saveNextVersion({
          target: clearedTarget,
          expectedVersion: null,
          ...systemPolicyWriteFixture(override, clearedTarget),
        });
        expect(original.version).toBe(1);
        const retainedHistory = () =>
          refetched!.reviewConfigurationVersion.findMany({
            where: {
              configuration: {
                workspaceId: "c2b-w",
                repositoryId: clearedTarget.repositoryId,
              },
            },
            orderBy: { version: "asc" },
          });
        const originalHistory = await retainedHistory();
        expect(originalHistory).toHaveLength(1);
        const runtimeConfigs = new PrismaActionControlPlaneRepository(
          refetched,
        );
        const runtimeTarget = {
          workspaceId: "c2b-w",
          repositoryId: clearedTarget.repositoryId,
        };
        expect(
          await runtimeConfigs.findRuntimeReviewConfiguration(runtimeTarget),
        ).toEqual({
          source: "repository",
          version: 1,
          workspaceVersion: 2,
          repositoryVersion: 1,
          effectivePolicyDigest: `sha256:${createHash("sha256").update(canonicalJson(override)).digest("hex")}`,
          config: override,
        });
        const expectCleared = async (expectedHistory = originalHistory) => {
          expect(await fresh.findLatest(clearedTarget)).toMatchObject({
            source: "workspace",
            version: 2,
            config,
          });
          expect(
            (
              await resolveEffectiveReviewConfigurations(
                {
                  workspaceId: "c2b-w",
                  repositoryIds: [clearedTarget.repositoryId],
                },
                { policyHeads: new PrismaReviewPolicyHeadReader(refetched!) },
              )
            ).repositories.get(clearedTarget.repositoryId),
          ).toMatchObject({
            status: "ready",
            source: "workspace",
            repositoryVersion: null,
          });
          expect(
            await resolveReviewConfiguration(clearedTarget, freshDeps),
          ).toMatchObject({ source: "workspace", version: 2, config });
          // CI must ignore retained override history on both regular reads
          // and strict admission reads using the existing transaction port.
          expect(
            await runtimeConfigs.findRuntimeReviewConfiguration(runtimeTarget),
          ).toEqual({
            source: "workspace",
            version: 2,
            workspaceVersion: 2,
            repositoryVersion: null,
            effectivePolicyDigest: `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`,
            config,
          });
          expect(
            await refetched!.$transaction((tx) =>
              runtimeConfigs.findRuntimeReviewConfiguration(runtimeTarget, tx),
            ),
          ).toEqual({
            source: "workspace",
            version: 2,
            workspaceVersion: 2,
            repositoryVersion: null,
            effectivePolicyDigest: `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`,
            config,
          });
          expect(
            await refetched!.reviewConfiguration.findUniqueOrThrow({
              where: {
                workspaceId_targetKey: {
                  workspaceId: "c2b-w",
                  targetKey: `repo:${clearedTarget.repositoryId}`,
                },
              },
              select: { active: true },
            }),
          ).toEqual({ active: false });
          expect(await retainedHistory()).toEqual(expectedHistory);
        };
        expect(await fresh.deleteTarget(clearedTarget)).toBe(true);
        await expectCleared();
        expect(
          await refetched.$transaction(async (tx) => {
            const transactionConfigs =
              new PrismaReviewConfigurationTransactionRepository(
                tx,
                undefined,
                false,
                undefined,
              );
            expect(
              await transactionConfigs.findLatest(clearedTarget),
            ).toMatchObject({ source: "workspace", version: 2, config });
            return transactionConfigs.deleteTarget(clearedTarget);
          }),
        ).toBe(false);
        // Inactive override has expectedVersion=null, while stored sequence is
        // monotonic. Failed CAS cannot reactivate; a new save may do so.
        await expect(
          fresh.saveNextVersion({
            target: clearedTarget,
            expectedVersion: 1,
            ...systemPolicyWriteFixture(override, clearedTarget),
          }),
        ).rejects.toMatchObject({
          code: "review_configuration_write_conflict",
        });
        await expectCleared();
        const newConfig = parseReviewConfigurationStrict({
          ...override,
          reviewLanguage: "French",
          limits: { ...override.limits, inlineMaxComments: 7 },
          investigationRollout: {
            ...override.investigationRollout,
            recordingEnabled: true,
          },
        });
        const reactivated = await fresh.saveNextVersion({
          target: clearedTarget,
          expectedVersion: null,
          ...systemPolicyWriteFixture(newConfig, clearedTarget),
        });
        expect(reactivated.version).toBe(2);
        expect(reactivated.config).toEqual(newConfig);
        expect(reactivated.revisionToken).toMatch(
          /^policy:2:2:sha256:[a-f0-9]{64}$/,
        );
        expect(reactivated.revisionToken).not.toBe(original.revisionToken);
        expect(await fresh.findLatest(clearedTarget)).toEqual(reactivated);
        const reactivatedHistory = await retainedHistory();
        expect(reactivatedHistory).toHaveLength(2);
        expect(reactivatedHistory.slice(0, 1)).toEqual(originalHistory);
        expect(await fresh.deleteTarget(clearedTarget)).toBe(true);
        await expectCleared(reactivatedHistory);
        const ordinaryAfterClear = await fresh.saveNextVersion({
          target: clearedTarget,
          expectedVersion: null,
          ...systemPolicyWriteFixture(override, clearedTarget),
        });
        expect(ordinaryAfterClear.version).toBe(3);
        expect(await fresh.findLatest(clearedTarget)).toEqual(
          ordinaryAfterClear,
        );
        expect((await retainedHistory()).slice(0, 1)).toEqual(originalHistory);

        // A cleared override follows the current workspace head, not the one
        // it was cleared against.
        const workspaceAdvanced = await fresh.saveNextVersion({
          target: workspace,
          expectedVersion: 2,
          ...systemPolicyWriteFixture(override, workspace),
        });
        expect(workspaceAdvanced.version).toBe(3);
        expect(workspaceAdvanced.config).toEqual(override);
        // Stored history stays readable when its selection is revoked; NEW
        // saves retain the existing live binding/profile guards.
        await sql.query(`UPDATE "WorkspaceAccountBinding" SET "state" = 'revoked', "revision" = 2,
        "policyRevision" = 2, "pendingFenceOperationId" = 'c2b-second-revoke-intent',
        "pendingFencePolicySubject" = 'c2b-second', "pendingFencePolicyRevision" = 2 WHERE "id" = 'c2b-second'`);
        // A revoked selection cannot reactivate a cleared override, not even
        // by resubmitting the stored document of its latest version.
        expect(await fresh.deleteTarget(clearedTarget)).toBe(true);
        await expect(
          fresh.saveNextVersion({
            target: clearedTarget,
            expectedVersion: null,
            policy: ordinaryAfterClear.policy as RepositoryReviewPolicy,
          }),
        ).rejects.toThrow("review_configuration_gateway_binding_unavailable");
        expect(await fresh.findLatest(clearedTarget)).toMatchObject({
          source: "workspace",
          version: workspaceAdvanced.version,
          config: workspaceAdvanced.config,
        });
        const historyAfterDeniedReactivation = await retainedHistory();
        expect(historyAfterDeniedReactivation).toHaveLength(3);
        expect(historyAfterDeniedReactivation.slice(0, 1)).toEqual(
          originalHistory,
        );

        // With workspace policy cleared, execution remains unconfigured and
        // the retained override history does not recreate it.
        expect(await fresh.deleteTarget(workspace)).toBe(true);
        expect(await fresh.findLatest(workspace)).toBeNull();
        expect(await fresh.findLatest(clearedTarget)).toBeNull();
        expect(
          await resolveReviewConfiguration(clearedTarget, freshDeps),
        ).toBeNull();
        expect(
          await runtimeConfigs.findRuntimeReviewConfiguration(runtimeTarget),
        ).toBeNull();
        expect(
          await refetched.$transaction((tx) =>
            runtimeConfigs.findRuntimeReviewConfiguration(runtimeTarget, tx),
          ),
        ).toBeNull();
        expect(await retainedHistory()).toEqual(historyAfterDeniedReactivation);

        // Ordinary writes leave the retained operation columns empty. A row
        // inserted directly over SQL must still satisfy their strict pair and
        // per-configuration uniqueness. Last, so no read above sees the rows.
        expect(
          historyAfterDeniedReactivation.map((row) => [
            row.operationId,
            row.operationIntentHash,
            row.operationSnapshotJson,
          ]),
        ).toEqual([
          [null, null, null],
          [null, null, null],
          [null, null, null],
        ]);
        const insertVersionCopy = (
          templateId: string,
          patch: Record<string, unknown>,
        ) =>
          sql.query(
            `INSERT INTO "ReviewConfigurationVersion" SELECT
            (jsonb_populate_record(NULL::"ReviewConfigurationVersion", to_jsonb(base) || $2::jsonb)).*
            FROM "ReviewConfigurationVersion" base WHERE base."id" = $1`,
            [templateId, JSON.stringify(patch)],
          );
        await insertVersionCopy(historyAfterDeniedReactivation[0]!.id, {
          id: "c2b-historical-receipt",
          version: 2000,
          operationId: "c2b-historical-batch",
          operationIntentHash: "a".repeat(64),
        });
        let receiptOrdinal = 2000;
        for (const [patch, code] of [
          [{ operationId: null }, "23514"],
          [{ operationIntentHash: null }, "23514"],
          [{ operationId: "" }, "23514"],
          [{ operationId: "bad\n" }, "23514"],
          [{ operationId: "x".repeat(129) }, "23514"],
          [{ operationIntentHash: "invalid" }, "23514"],
          [{}, "23505"],
        ] as const) {
          receiptOrdinal += 1;
          await expect(
            insertVersionCopy("c2b-historical-receipt", {
              id: `c2b-receipt-denied-${receiptOrdinal}`,
              version: receiptOrdinal,
              ...patch,
            }),
          ).rejects.toMatchObject({ code });
        }
      } finally {
        await refetched?.$disconnect();
        if (prisma !== refetched) await prisma?.$disconnect();
        await sql.end();
      }
    }, 240_000);
  },
);

// Reuse the owned, already migrated C2c fixture. No schema reset/provider ingress.
describe.skipIf(process.env.RR_H_CONFIG_WRITE_AUTHORITY_PG_TEST !== "1")(
  "personal config writes require actual locked saving actor",
  () => {
    it("denies support-only actors for H, preserves org writes, and holds the live admin through commit", async () => {
      const raw = process.env.RR_C2C_PG_TEST_URL ?? "";
      const url = new URL(raw);
      if (
        process.env.RR_C2C_MIGRATED_DISPOSABLE_DATABASE !== "1" ||
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        !/^rr_gateway_test_c2c_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("personal_config_owned_disposable_required");
      const [
        { createReviewActionV2E2EHarness },
        { PrismaPersonalAccountOperations },
      ] = await Promise.all([
        import("../../../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness"),
        import("@reviewrouter/features-provider-accounts/synchronization"),
      ]);
      // The suite stores its own repository selection from version null.
      const harness = await createReviewActionV2E2EHarness(raw, {
        repositoryProviderSelection: "none",
      });
      const {
        prisma: db,
        prefix,
        workspaceId,
        repositoryConnectionId,
      } = harness;
      try {
        const donor = `${prefix}-config-donor`,
          admin = `${prefix}-config-admin`,
          member = `${prefix}-config-member`,
          outsider = `${prefix}-config-support`;
        await db.user.createMany({
          data: [donor, admin, member, outsider].map((id) => ({ id })),
        });
        await db.workspaceMember.createMany({
          data: [
            { workspaceId, userId: donor, role: "admin" },
            { workspaceId, userId: admin, role: "admin" },
            { workspaceId, userId: member, role: "member" },
          ],
        });
        const personal = new PrismaPersonalAccountOperations(db);
        const p = await personal.resolvePersonalWorkspace(donor);
        await db.workspaceMember.create({
          data: { workspaceId: p, userId: admin, role: "admin" },
        });
        const source = await db.providerAccountConnection.create({
          data: {
            ownerUserId: donor,
            gatewayAccountRef: `${prefix}-config-personal`,
            profileRef: "mimo-responses-v1",
            displayName: "Shared personal",
            state: "active",
            authorizationEpochMirror: 7n,
          },
        });
        const binding = await db.workspaceAccountBinding.create({
          data: { workspaceId, connectionId: source.id, state: "active" },
        });
        const ownP = await db.workspaceAccountBinding.create({
          data: { workspaceId: p, connectionId: source.id, state: "active" },
        });
        const org = await db.providerAccountConnection.create({
          data: {
            ownerWorkspaceId: workspaceId,
            gatewayAccountRef: `${prefix}-config-org`,
            profileRef: "mimo-responses-v1",
            displayName: "Organization",
            state: "active",
          },
        });
        const orgBinding = await db.workspaceAccountBinding.create({
          data: { workspaceId, connectionId: org.id, state: "active" },
        });
        const config = (bindingId: string) =>
          parseReviewConfigurationStrict({
            ...workspacePolicyFixture,
            providers: [
              {
                ...workspaceProviderFixture,
                authMode: "codex_account_gateway",
                model: "mimo-v2-pro",
                gatewayProfileRef: "mimo-responses-v1",
                gatewayBindingId: bindingId,
              },
            ],
          });
        const target = { scope: "workspace" as const, workspaceId };
        const repository = {
          scope: "repository" as const,
          workspaceId,
          repositoryId: repositoryConnectionId,
        };
        const repo = (actor?: string) =>
          new PrismaReviewConfigurationRepository(db, undefined, true, actor);
        const workspaceHead = () =>
          db.reviewConfigurationVersion.findFirstOrThrow({
            where: {
              workspaceId,
              configuration: { targetKey: "workspace:default" },
            },
            orderBy: { version: "desc" },
          });
        // The shared harness stores a workspace document without a default
        // provider. These actor checks must preserve it on denial and use its
        // actual CAS.
        const baseline = await workspaceHead();
        expect(baseline.version).toBe(1);
        expect(await repo().findLatest(target)).toBeNull();
        const baselineVersion = baseline.version;
        const save = (actor?: string) =>
          repo(actor).saveNextVersion({
            target,
            expectedVersion: baselineVersion,
            ...systemPolicyWriteFixture(config(binding.id), target),
          });
        const profileCount = () =>
          db.workspaceProviderProfile.count({ where: { workspaceId } });
        for (const actor of [undefined, member, outsider]) {
          await expect(save(actor)).rejects.toThrow(
            "review_configuration_personal_actor_forbidden",
          );
          expect(await workspaceHead()).toEqual(baseline);
          expect(await profileCount()).toBe(0);
        }
        expect((await save(admin)).version).toBe(baselineVersion + 1);
        const actorRow = await db.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId, userId: admin } },
        });
        await db.$transaction(async (tx) => {
          const current = new PrismaReviewConfigurationTransactionRepository(
            tx,
            undefined,
            true,
            admin,
          );
          expect(
            (
              await current.saveNextVersion({
                target,
                expectedVersion: baselineVersion + 1,
                ...systemPolicyWriteFixture(config(binding.id), target),
              })
            ).version,
          ).toBe(baselineVersion + 2);
          // The actual row lock must survive validation and the configuration write.
          await expect(
            db.$transaction(
              (other) => other.$queryRaw`
            SELECT "id" FROM "WorkspaceMember" WHERE "id" = ${actorRow.id} FOR UPDATE NOWAIT`,
            ),
          ).rejects.toThrow(/could not obtain lock/);
        });
        // A repository document that only selects the profile the admin's save
        // created passes the same saving-actor gate as a drafted one.
        const personalProfile =
          await db.workspaceProviderProfile.findFirstOrThrow({
            where: { workspaceId, gatewayBindingId: binding.id },
          });
        const repositoryPolicy = parseRepositoryReviewPolicy({
          ...systemPolicyWriteFixture(config(binding.id), repository).policy,
          providers: selectionsFor(config(binding.id), [personalProfile.id]),
        });
        const saveRepository = (
          actor: string | undefined,
          expectedVersion: number | null,
        ) =>
          repo(actor).saveNextVersion({
            target: repository,
            expectedVersion,
            policy: repositoryPolicy,
          });
        await expect(saveRepository(undefined, null)).rejects.toThrow(
          "review_configuration_personal_actor_forbidden",
        );
        expect((await saveRepository(admin, null)).version).toBe(1);
        await personal.changeEligibility({
          actorUserId: donor,
          workspaceId,
          memberId: actorRow.id,
          userId: admin,
          expectedRole: "admin",
          nextRole: "member",
        });
        await expect(
          repo(admin).saveNextVersion({
            target,
            expectedVersion: baselineVersion + 2,
            ...systemPolicyWriteFixture(config(binding.id), target),
          }),
        ).rejects.toThrow("review_configuration_personal_actor_forbidden");
        await expect(
          db.$transaction((tx) =>
            new PrismaReviewConfigurationTransactionRepository(
              tx,
              undefined,
              true,
              outsider,
            ).saveNextVersion({
              target,
              expectedVersion: baselineVersion + 2,
              ...systemPolicyWriteFixture(config(binding.id), target),
            }),
          ),
        ).rejects.toThrow("review_configuration_personal_actor_forbidden");
        expect((await repo().findLatest(target))?.version).toBe(
          baselineVersion + 2,
        );
        // Role loss refuses a new repository save as well; the head stays.
        await expect(saveRepository(admin, 1)).rejects.toThrow(
          "review_configuration_personal_actor_forbidden",
        );
        expect((await repo().findLatest(repository))?.version).toBe(1);
        const pTarget = { scope: "workspace" as const, workspaceId: p };
        await expect(
          repo(admin).saveNextVersion({
            target: pTarget,
            expectedVersion: null,
            ...systemPolicyWriteFixture(config(ownP.id), pTarget),
          }),
        ).rejects.toThrow("review_configuration_personal_actor_forbidden");
        expect(
          (
            await repo(donor).saveNextVersion({
              target: pTarget,
              expectedVersion: null,
              ...systemPolicyWriteFixture(config(ownP.id), pTarget),
            })
          ).version,
        ).toBe(1);
        // Legacy organization selection keeps its existing authorization composition.
        expect(
          (
            await repo().saveNextVersion({
              target,
              expectedVersion: baselineVersion + 2,
              ...systemPolicyWriteFixture(config(orgBinding.id), target),
            })
          ).version,
        ).toBe(baselineVersion + 3);
        const mixed = parseReviewConfigurationStrict({
          ...config(orgBinding.id),
          execution: {
            ...workspacePolicyFixture.execution,
            providerLimit: 2,
            providerMaxParallel: 2,
          },
          providers: [
            ...config(orgBinding.id).providers,
            ...config(binding.id).providers,
          ],
        });
        await expect(
          repo().saveNextVersion({
            target,
            expectedVersion: baselineVersion + 3,
            ...systemPolicyWriteFixture(mixed, target),
          }),
        ).rejects.toThrow("review_configuration_personal_actor_forbidden");
        expect(
          (
            await repo(donor).saveNextVersion({
              target,
              expectedVersion: baselineVersion + 3,
              ...systemPolicyWriteFixture(mixed, target),
            })
          ).version,
        ).toBe(baselineVersion + 4);
      } finally {
        await harness.close();
      }
    }, 120_000);
  },
);
