import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, rm, readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import {
  CODEX_MODEL_PROFILE,
  ACCOUNT_MODEL_UI_ATTESTATIONS,
} from "./account-models-fixture.ts";
import { RUNTIME_UI_ATTESTATIONS } from "./review-runtime-fixture.ts";
import {
  FIXTURES,
  TEST_DATABASE_NAME,
  type RuntimeDescriptor,
} from "./contracts.ts";

type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<T>>;
  end(): Promise<void>;
};

export type DatabaseFixture = {
  readonly descriptor: Pick<RuntimeDescriptor, "databaseMode" | "databaseName">;
  readonly databaseUrl: string;
  close(): Promise<void>;
};

export async function createDatabaseFixture(input: {
  readonly repoRoot: string;
  readonly workDir: string;
  readonly databaseUrl: string | null;
  readonly isolatedPglite: boolean;
}): Promise<DatabaseFixture> {
  await mkdir(input.workDir, { recursive: true });
  let pglite: PGlite | null = null;
  let socket: PGLiteSocketServer | null = null;
  let databaseUrl = input.databaseUrl;
  if (input.isolatedPglite) {
    const created = await startPgliteFixture(
      join(input.workDir, "pglite-data"),
    );
    pglite = created.db;
    socket = created.socket;
    databaseUrl = created.databaseUrl;
  }
  if (!databaseUrl) throw new Error("accounts_reference_e2e_database_missing");

  try {
    const client = new pg.Client({
      connectionString: databaseUrl,
      application_name: "reviewrouter-accounts-reference-e2e-fixture",
    });
    await client.connect();
    try {
      if (process.argv.includes("--resume-own-fixtures")) {
        const rows = await client.query(
          `SELECT current_database() AS name, (SELECT array_agg(id ORDER BY id) FROM "User") AS ids`,
        );
        const expected = Object.values(FIXTURES.users).sort();
        if (
          rows.rows[0]?.name !== TEST_DATABASE_NAME ||
          JSON.stringify(rows.rows[0].ids) !== JSON.stringify(expected)
        )
          throw new Error("resume_fixture_identity_mismatch");
      } else if (process.argv.includes("--restored-empty-baseline")) {
        if (input.isolatedPglite)
          throw new Error("restored_baseline_requires_actual_postgres");
        await assertRestoredEmptyBaseline(client, input.repoRoot);
      } else await assertFreshTestDatabase(client, input.isolatedPglite);
    } finally {
      await client.end();
    }
    if (!process.argv.includes("--resume-own-fixtures")) {
      await migrateTestDatabase(input.repoRoot, input.workDir, databaseUrl);
      await seedFixtures(databaseUrl, input.repoRoot);
    }
  } catch (error) {
    await socket?.stop().catch(() => undefined);
    await pglite?.close().catch(() => undefined);
    if (input.isolatedPglite) {
      await rm(join(input.workDir, "pglite-data"), {
        recursive: true,
        force: true,
      });
    }
    throw error;
  }

  return {
    descriptor: {
      databaseMode: input.isolatedPglite
        ? "isolated-pglite"
        : "explicit-test-url",
      databaseName: TEST_DATABASE_NAME,
    },
    databaseUrl,
    async close() {
      await socket?.stop();
      await pglite?.close();
      if (input.isolatedPglite) {
        await rm(join(input.workDir, "pglite-data"), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

async function assertRestoredEmptyBaseline(
  client: Queryable,
  repoRoot: string,
): Promise<void> {
  const identity = await client.query(
    `SELECT current_database() AS name, (SELECT count(*)::int FROM "User") AS users, (SELECT count(*)::int FROM "ProviderAccountConnection") AS sources`,
  );
  const row = identity.rows[0];
  if (row?.name !== TEST_DATABASE_NAME || row.users !== 0 || row.sources !== 0)
    throw new Error("restored_baseline_identity_or_empty_guard");
  const migrations = await client.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`,
  );
  const root = join(repoRoot, "packages/platform/db/prisma/migrations");
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0 || migrations.rows.length !== names.length)
    throw new Error("restored_baseline_requires_exact_source_roster");
  for (let i = 0; i < names.length; i++) {
    const migration = migrations.rows[i];
    const checksum = createHash("sha256")
      .update(await readFile(join(root, names[i]!, "migration.sql")))
      .digest("hex");
    if (
      !migration ||
      migration.migration_name !== names[i] ||
      migration.checksum !== checksum ||
      !migration.finished_at ||
      migration.rolled_back_at
    )
      throw new Error("restored_baseline_migration_checksum_mismatch");
  }
}

async function startPgliteFixture(dataDir: string): Promise<{
  db: PGlite;
  socket: PGLiteSocketServer;
  databaseUrl: string;
}> {
  await mkdir(dataDir, { recursive: true });
  const db = await PGlite.create({ dataDir });
  // PGlite inherits the host zone and its socket ignores PostgreSQL startup
  // options. Match the real adapter's UTC session contract before serving it.
  await db.exec("SET TIME ZONE 'UTC'");
  const socket = new PGLiteSocketServer({
    db,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 100,
    idleTimeout: 120_000,
  });
  const listeningPort = new Promise<number>((resolve, reject) => {
    socket.addEventListener(
      "listening",
      (event) => {
        const detail = (event as CustomEvent<{ port?: number }>).detail;
        if (typeof detail.port !== "number") {
          reject(new Error("accounts_reference_e2e_pglite_port_missing"));
          return;
        }
        resolve(detail.port);
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => reject(new Error("accounts_reference_e2e_pglite_start_failed")),
      { once: true },
    );
  });
  await socket.start();
  const port = await listeningPort;
  return {
    db,
    socket,
    databaseUrl: `postgresql://rr_accounts_reference_e2e@127.0.0.1:${port}/${TEST_DATABASE_NAME}?schema=public`,
  };
}

async function assertFreshTestDatabase(
  client: Queryable,
  isolatedPglite: boolean,
): Promise<void> {
  const result = await client.query<{
    readonly database_name: string;
    readonly public_tables: string;
    readonly migration_table: string | null;
    readonly major: string;
  }>(
    `SELECT current_database() AS database_name,
      (SELECT count(*)::text FROM pg_catalog.pg_tables WHERE schemaname = 'public') AS public_tables,
      to_regclass('"_prisma_migrations"')::text AS migration_table,
      current_setting('server_version_num') AS major`,
  );
  const row = result.rows[0];
  const allowedNames = isolatedPglite
    ? new Set(["pglite", "postgres", TEST_DATABASE_NAME])
    : new Set([TEST_DATABASE_NAME]);
  if (!row || !allowedNames.has(row.database_name)) {
    throw new Error("accounts_reference_e2e_database_name_mismatch");
  }
  if (Number(row.major) < 170_000) {
    throw new Error("accounts_reference_e2e_postgres_17_required");
  }
  if (row.public_tables !== "0" || row.migration_table !== null) {
    throw new Error(
      "accounts_reference_e2e_database_must_be_a_fresh_disposable_test_database",
    );
  }
}

async function migrateTestDatabase(
  repoRoot: string,
  workDir: string,
  databaseUrl: string,
): Promise<void> {
  const migrationLog = await open(join(workDir, "migrations.log"), "a", 0o600);
  const logStream = migrationLog.createWriteStream();
  await new Promise<void>((resolve, reject) => {
    const child: ChildProcess = spawn(
      process.execPath,
      ["scripts/migrate-deploy.mjs"],
      {
        cwd: join(repoRoot, "packages", "platform", "db"),
        env: migrationEnvironment(repoRoot, databaseUrl),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`accounts_reference_e2e_migration_signal:${signal}`));
      } else if (code !== 0) {
        reject(
          new Error(
            `accounts_reference_e2e_migration_exit:${code ?? "unknown"}`,
          ),
        );
      } else {
        resolve();
      }
    });
  });
  await migrationLog.close();
}

function migrationEnvironment(
  repoRoot: string,
  databaseUrl: string,
): NodeJS.ProcessEnv {
  const environment = cleanEnvironment(process.env);
  environment.DATABASE_URL = databaseUrl;
  delete environment.REVIEW_ROUTER_DATABASE_URL_FILE;
  const nodeBin = dirname(process.execPath);
  const workspaceBin = join(repoRoot, "node_modules", ".bin");
  const pathEntries = (environment.PATH ?? "").split(":").filter(Boolean);
  environment.PATH = [workspaceBin, nodeBin, ...pathEntries].join(":");
  return environment;
}

function cleanEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowlist = new Set([
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "NODE_OPTIONS",
    "PNPM_HOME",
    "npm_config_cache",
    "COREPACK_HOME",
  ]);
  const output: NodeJS.ProcessEnv = { NODE_ENV: input.NODE_ENV ?? "test" };
  for (const [key, value] of Object.entries(input)) {
    if (allowlist.has(key) && value !== undefined) output[key] = value;
  }
  return output;
}

export function applicationEnvironment(input: {
  readonly databaseUrl: string;
  readonly appUrl: string;
  readonly gatewayUrl: string;
  readonly secrets: import("./contracts.ts").FixtureSecrets;
  readonly tmpDir: string;
}): NodeJS.ProcessEnv {
  return {
    ...cleanEnvironment(process.env),
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PRIVATE_TEST_MODE: "1",
    DATABASE_URL: input.databaseUrl,
    AUTH_SECRET: input.secrets.authSecret,
    NEXTAUTH_SECRET: input.secrets.authSecret,
    AUTH_TRUST_HOST: "true",
    NEXTAUTH_URL: input.appUrl,
    REVIEW_ROUTER_WEB_URL: input.appUrl,
    REVIEW_ROUTER_API_URL: input.gatewayUrl,
    REVIEW_ROUTER_PUBLIC_WEB_URL: input.appUrl,
    REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS: "1",
    REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS:
      randomBytes(32).toString("base64url"),
    // Synthetic operator authority for usage acceptance, including full-suite runs.
    ...(!process.env.ACCOUNTS_REFERENCE_E2E_GREP ||
    process.env.ACCOUNTS_REFERENCE_E2E_GREP.includes("provider usage")
      ? { ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID: FIXTURES.workspaces.orgAlpha }
      : {}),
    ...(process.argv.includes("--catalog-fixture")
      ? { REVIEW_ROUTER_ENABLE_CODEX_ROTATING_OAUTH: "1" }
      : {}),
    REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED: "1",
    REVIEW_ROUTER_ACCOUNT_GATEWAY_ACCOUNTS_CONTEXT_SECRET:
      input.secrets.gatewayAccountsContextSecret,
    GITHUB_APP_CLIENT_ID: input.secrets.githubClientId,
    GITHUB_APP_CLIENT_SECRET: input.secrets.githubClientSecret,
    REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN: input.gatewayUrl,
    REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN:
      input.secrets.managementToken,
    REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_ORIGIN: input.gatewayUrl,
    REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_TOKEN:
      input.secrets.personalControlToken,
    REVIEW_ROUTER_ACCOUNT_GATEWAY_MIMO_PROFILE_ID: FIXTURES.gateway.profileId,
    ...(process.argv.includes("--review-runtime-fixture")
      ? {
          REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON:
            RUNTIME_UI_ATTESTATIONS,
        }
      : {}),
    ...(process.argv.includes("--account-models-fixture")
      ? {
          REVIEW_ROUTER_ACCOUNT_GATEWAY_CODEX_OAUTH_PROFILE_ID:
            "openai-codex-oauth-responses-v1",
          REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON:
            ACCOUNT_MODEL_UI_ATTESTATIONS,
        }
      : {}),
    ...(process.argv.includes("--limits-fixture")
      ? {
          REVIEW_ROUTER_ACCOUNT_GATEWAY_CLAUDE_OAUTH_PROFILE_ID:
            FIXTURES.gateway.claudeProfileId,
        }
      : {}),
    ...(process.argv.includes("--subscription-fixture")
      ? {
          REVIEW_ROUTER_ACCOUNT_GATEWAY_SUBSCRIPTION_PROFILE_IDS:
            "kimi-code-global-responses-apikey-v1,glm-coding-global-responses-apikey-v1,minimax-mplan-global-responses-apikey-v1,grok-subscription-responses-oauth-v1",
        }
      : {}),
    ...(process.argv.includes("--api-key-storage-fixture")
      ? {
          REVIEW_ROUTER_ACCOUNT_GATEWAY_MIMO_PROFILE_ID:
            "openai-responses-apikey-v1",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_MIMO_BASE_URL:
            "https://token-plan-sgp.xiaomimimo.com/v1",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_OPENROUTER_PROFILE_ID:
            "openrouter-openai-responses-apikey-v1",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_SUBSCRIPTION_PROFILE_IDS:
            "kimi-code-global-responses-apikey-v1",
        }
      : {}),
    TMPDIR: input.tmpDir,
  };
}

async function seedFixtures(
  databaseUrl: string,
  repoRoot: string,
): Promise<void> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: "reviewrouter-accounts-reference-e2e-seed",
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query(SQL_SEED);
    if (process.argv.includes("--account-models-fixture")) {
      const { CODEX_MODEL_PROFILE, CODEX_SAVED_PROFILE, CODEX_SAVED_MODEL } =
        await import("./account-models-fixture.ts");
      const identity = [
        "gateway_binding",
        `${encodeURIComponent(FIXTURES.bindings.viewerAlpha)}/${encodeURIComponent(CODEX_MODEL_PROFILE)}`,
        encodeURIComponent(CODEX_SAVED_MODEL),
      ].join(":");
      await client.query(
        `INSERT INTO "WorkspaceProviderProfile" (id,"workspaceId","createdByUserId","credentialKind","authMode","gatewayBindingId","gatewayProfileRef",model,label,"identityKey","updatedAt") VALUES ($1,$2,$3,'gateway_binding','codex_account_gateway',$4,$5,$6,'Codex saved',$7,CURRENT_TIMESTAMP)`,
        [
          CODEX_SAVED_PROFILE,
          FIXTURES.workspaces.orgAlpha,
          FIXTURES.users.viewer,
          FIXTURES.bindings.viewerAlpha,
          CODEX_MODEL_PROFILE,
          CODEX_SAVED_MODEL,
          identity,
        ],
      );
    }
    if (process.argv.includes("--limits-fixture"))
      await client.query(`
      INSERT INTO "ProviderAccountConnection" ("id", "ownerUserId", "ownerWorkspaceId", "gatewayAccountRef", "gatewayOperationRef", "profileRef", "displayName", "state", "metadataRevision", "authorizationEpochMirror", "updatedAt")
      VALUES ('${FIXTURES.sources.viewerClaude}', '${FIXTURES.users.viewer}', NULL, '${FIXTURES.gateway.accounts.viewerClaude}', NULL, '${FIXTURES.gateway.claudeProfileId}', '${FIXTURES.sourceLabels.viewerClaude}', 'active', 1, 1, CURRENT_TIMESTAMP);
      INSERT INTO "WorkspaceAccountBinding" ("id", "workspaceId", "connectionId", "state", "revision", "policyRevision", "updatedAt")
      VALUES ('${FIXTURES.bindings.viewerClaudeAlpha}', '${FIXTURES.workspaces.orgAlpha}', '${FIXTURES.sources.viewerClaude}', 'active', 1, 1, CURRENT_TIMESTAMP);
    `);
    const policy = (await import(
      pathToFileURL(
        join(
          repoRoot,
          "packages/features/provider-accounts/src/application/use-cases/personal-account-operations.ts",
        ),
      ).href
    )) as {
      personalIntentDigest(intent: unknown): string;
      personalOperationId(actor: string, nonce: string): string;
    };
    for (const [
      bindingId,
      actorUserId,
      personalWorkspaceId,
      sourceId,
      targetWorkspaceId,
    ] of [
      [
        FIXTURES.bindings.viewerAlpha,
        FIXTURES.users.viewer,
        FIXTURES.workspaces.personalViewer,
        FIXTURES.sources.viewerPrimary,
        FIXTURES.workspaces.orgAlpha,
      ],
      [
        FIXTURES.bindings.viewerBravo,
        FIXTURES.users.viewer,
        FIXTURES.workspaces.personalViewer,
        FIXTURES.sources.viewerPrimary,
        FIXTURES.workspaces.orgBravo,
      ],
      ...(process.argv.includes("--limits-fixture")
        ? [
            [
              FIXTURES.bindings.viewerClaudeAlpha,
              FIXTURES.users.viewer,
              FIXTURES.workspaces.personalViewer,
              FIXTURES.sources.viewerClaude,
              FIXTURES.workspaces.orgAlpha,
            ] as const,
          ]
        : []),
      [
        FIXTURES.bindings.otherAlpha,
        FIXTURES.users.other,
        FIXTURES.workspaces.personalOther,
        FIXTURES.sources.otherPrimary,
        FIXTURES.workspaces.orgAlpha,
      ],
    ] as const) {
      const clientOperationId = `rr-e2e-attach-${bindingId}`;
      const intent = {
        actorUserId,
        clientOperationId,
        personalWorkspaceId,
        action: "attach",
        sourceId,
        targetWorkspaceId,
        expectedSourceMetadataRevision: 1,
        expectedGatewayRevision: 1,
        predecessorBindingId: null,
        expectedPredecessorRevision: null,
      };
      await client.query(
        `INSERT INTO "PersonalAccountOperation" (id, "actorUserId", "clientOperationId", action, "personalWorkspaceId", "sourceId", "targetWorkspaceId", "normalizedIntentHash", "expectedSourceMetadataRevision", "expectedGatewayRevision", "resultSourceId", "resultBindingId", phase, "updatedAt") VALUES ($1,$2,$3,'attach',$4,$5,$6,$7,1,1,$5,$8,'applied',CURRENT_TIMESTAMP)`,
        [
          policy.personalOperationId(actorUserId, clientOperationId),
          actorUserId,
          clientOperationId,
          personalWorkspaceId,
          sourceId,
          targetWorkspaceId,
          policy.personalIntentDigest(intent),
          bindingId,
        ],
      );
    }
    await client.query("COMMIT");
    if (process.argv.includes("--lifecycle-fixture"))
      await seedSuspendedWireFixture(databaseUrl, repoRoot);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function seedSuspendedWireFixture(
  databaseUrl: string,
  repoRoot: string,
): Promise<void> {
  const require = createRequire(
    join(repoRoot, "packages/platform/db/package.json"),
  );
  const { PrismaClient } = require("@prisma/client") as {
    PrismaClient: new (input: { adapter: unknown }) => {
      $disconnect(): Promise<void>;
    };
  };
  const { PrismaPg } = require("@prisma/adapter-pg") as {
    PrismaPg: new (input: { connectionString: string }) => unknown;
  };
  type Receipt = { id: string; phase: string; source: { state: string } };
  type Store = {
    reserve(input: unknown): Promise<Receipt>;
    ready(actor: string, id: string): Promise<Receipt>;
    claim(actor: string, id: string): Promise<{ claimToken: string } | null>;
    enterClaim(actor: string, id: string, token: string): Promise<boolean>;
    finalize(
      actor: string,
      id: string,
      account: unknown,
      retirement: null,
      closure: null,
    ): Promise<Receipt>;
  };
  const { PrismaAccountLifecycleOperations } = (await import(
    pathToFileURL(
      join(
        repoRoot,
        "packages/features/provider-accounts/src/infrastructure/prisma/prisma-account-lifecycle-operations.ts",
      ),
    ).href
  )) as { PrismaAccountLifecycleOperations: new (client: unknown) => Store };
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const store = new PrismaAccountLifecycleOperations(db);
    const actor = FIXTURES.users.viewer;
    const operation = await store.reserve({
      actorUserId: actor,
      clientOperationId: "rr-e2e-suspended-wire-fixture",
      personalWorkspaceId: FIXTURES.workspaces.personalViewer,
      owningWorkspaceId: null,
      sourceId: FIXTURES.sources.viewerSuspendedCapable,
      expectedSourceMetadataRevision: 1,
      expectedGatewayRevision: 1,
      expectedAuthorizationEpoch: 1,
      action: "suspend",
    });
    if ((await store.ready(actor, operation.id)).phase !== "ready")
      throw new Error("suspended_wire_fixture_not_ready");
    const claim = await store.claim(actor, operation.id);
    if (
      !claim ||
      !(await store.enterClaim(actor, operation.id, claim.claimToken))
    )
      throw new Error("suspended_wire_fixture_claim_failed");
    // This creates a synthetic wire/read fixture through the actual storage guard;
    // it is not an attestation or a native provider effect.
    const result = await store.finalize(
      actor,
      operation.id,
      {
        accountRef: FIXTURES.gateway.accounts.viewerSuspendedCapable,
        profileId: FIXTURES.gateway.profileId,
        displayName: FIXTURES.sourceLabels.viewerSuspendedCapable,
        state: "suspended",
        metadataRevision: 2,
        authorizationEpoch: 2,
      },
      null,
      null,
    );
    if (result.phase !== "applied" || result.source.state !== "suspended")
      throw new Error("suspended_wire_fixture_not_applied");
  } finally {
    await db.$disconnect();
  }
}

const SQL_SEED = `
INSERT INTO "User" ("id", "githubUserId", "githubLogin", "primaryEmail", "avatarUrl", "updatedAt")
VALUES
  ('${FIXTURES.users.viewer}', 910000000001, 'rr-e2e-viewer', 'rr-e2e-viewer@invalid.test', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"%3E%3C/svg%3E', CURRENT_TIMESTAMP),
  ('${FIXTURES.users.other}', NULL, NULL, 'rr-e2e-other@invalid.test', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"%3E%3C/svg%3E', CURRENT_TIMESTAMP),
  ('${FIXTURES.users.foreign}', 910000000003, 'rr-e2e-foreign-person', 'rr-e2e-foreign@invalid.test', NULL, CURRENT_TIMESTAMP);

INSERT INTO "UserExternalIdentity"
  ("id", "userId", "provider", "externalUserId", "login", "primaryEmail", "avatarUrl", "updatedAt")
VALUES
  ('rr-e2e-identity-viewer-0001', '${FIXTURES.users.viewer}', 'github', '${FIXTURES.identities.viewer.externalUserId}', '${FIXTURES.identities.viewer.login}', 'rr-e2e-viewer@invalid.test', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"%3E%3C/svg%3E', CURRENT_TIMESTAMP),
  ('rr-e2e-identity-other-0001', '${FIXTURES.users.other}', 'gitlab', '${FIXTURES.identities.other.externalUserId}', '${FIXTURES.identities.other.login}', 'rr-e2e-other@invalid.test', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"%3E%3C/svg%3E', CURRENT_TIMESTAMP),
  ('rr-e2e-identity-foreign-0001', '${FIXTURES.users.foreign}', 'github', '${FIXTURES.identities.foreign.externalUserId}', '${FIXTURES.identities.foreign.login}', 'rr-e2e-foreign@invalid.test', NULL, CURRENT_TIMESTAMP);

INSERT INTO "Workspace"
  ("id", "slug", "name", "deletionState", "deletionRevision", "personalOwnerUserId", "updatedAt")
VALUES
  ('${FIXTURES.workspaces.personalViewer}', 'rr-e2e-personal-viewer', '${FIXTURES.workspaceNames.personalViewer}', 'active', 1, '${FIXTURES.users.viewer}', CURRENT_TIMESTAMP),
  ('${FIXTURES.workspaces.personalOther}', 'rr-e2e-personal-other', '${FIXTURES.workspaceNames.personalOther}', 'active', 1, '${FIXTURES.users.other}', CURRENT_TIMESTAMP),
  ('${FIXTURES.workspaces.personalForeign}', 'rr-e2e-personal-foreign', '${FIXTURES.workspaceNames.personalForeign}', 'active', 1, '${FIXTURES.users.foreign}', CURRENT_TIMESTAMP),
  ('${FIXTURES.workspaces.orgAlpha}', 'rr-e2e-org-alpha', '${FIXTURES.workspaceNames.orgAlpha}', 'active', 1, NULL, CURRENT_TIMESTAMP),
  ('${FIXTURES.workspaces.orgBravo}', 'rr-e2e-org-bravo', '${FIXTURES.workspaceNames.orgBravo}', 'active', 1, NULL, CURRENT_TIMESTAMP);

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "githubLogin", "role", "updatedAt")
VALUES
  ('rr-e2e-member-viewer-personal', '${FIXTURES.workspaces.personalViewer}', '${FIXTURES.users.viewer}', 'rr-e2e-viewer', 'owner', CURRENT_TIMESTAMP),
  ('rr-e2e-member-other-personal', '${FIXTURES.workspaces.personalOther}', '${FIXTURES.users.other}', NULL, 'owner', CURRENT_TIMESTAMP),
  ('rr-e2e-member-foreign-personal', '${FIXTURES.workspaces.personalForeign}', '${FIXTURES.users.foreign}', 'rr-e2e-foreign-person', 'owner', CURRENT_TIMESTAMP),
  ('rr-e2e-member-viewer-alpha', '${FIXTURES.workspaces.orgAlpha}', '${FIXTURES.users.viewer}', 'rr-e2e-viewer', 'admin', CURRENT_TIMESTAMP),
  ('rr-e2e-member-viewer-bravo', '${FIXTURES.workspaces.orgBravo}', '${FIXTURES.users.viewer}', 'rr-e2e-viewer', 'admin', CURRENT_TIMESTAMP),
  ('rr-e2e-member-other-alpha', '${FIXTURES.workspaces.orgAlpha}', '${FIXTURES.users.other}', NULL, 'admin', CURRENT_TIMESTAMP);

INSERT INTO "GitHubInstallation"
  ("id", "workspaceId", "githubInstallationId", "accountLogin", "accountType", "accountAvatarUrl", "repositorySelection", "status", "updatedAt")
VALUES
  ('rr-e2e-install-alpha-suspended', '${FIXTURES.workspaces.orgAlpha}', 920000000001, 'rr-e2e-org-alpha', 'Organization', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"%3E%3Ccircle cx="4" cy="4" r="4" fill="%2322d3ee"/%3E%3C/svg%3E', 'selected', 'suspended', CURRENT_TIMESTAMP);

INSERT INTO "GitHubInstallation"
  ("id", "workspaceId", "githubInstallationId", "accountLogin", "accountType", "accountAvatarUrl", "repositorySelection", "status", "updatedAt")
VALUES
  ('rr-e2e-install-personal-viewer', '${FIXTURES.workspaces.personalViewer}', 920000000002, 'rr-e2e-viewer', 'User', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"%3E%3Ccircle cx="4" cy="4" r="4" fill="%2334d399"/%3E%3C/svg%3E', 'selected', 'suspended', CURRENT_TIMESTAMP),
  ('rr-e2e-install-personal-other', '${FIXTURES.workspaces.personalOther}', 920000000003, 'rr-e2e-other-person', 'User', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"%3E%3Ccircle cx="4" cy="4" r="4" fill="%23fbbf24"/%3E%3C/svg%3E', 'selected', 'suspended', CURRENT_TIMESTAMP),
  ('rr-e2e-install-bravo', '${FIXTURES.workspaces.orgBravo}', 920000000004, 'rr-e2e-org-bravo', 'Organization', 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"%3E%3Ccircle cx="4" cy="4" r="4" fill="%23a78bfa"/%3E%3C/svg%3E', 'selected', 'suspended', CURRENT_TIMESTAMP);

INSERT INTO "ProviderAccountConnection"
  ("id", "ownerUserId", "ownerWorkspaceId", "gatewayAccountRef", "gatewayOperationRef", "profileRef", "displayName", "state", "metadataRevision", "authorizationEpochMirror", "updatedAt")
VALUES
  ('${FIXTURES.sources.viewerPrimary}', '${FIXTURES.users.viewer}', NULL, '${FIXTURES.gateway.accounts.viewerPrimary}', NULL, '${process.argv.includes("--account-models-fixture") ? CODEX_MODEL_PROFILE : FIXTURES.gateway.profileId}', '${FIXTURES.sourceLabels.viewerPrimary}', 'active', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.sources.viewerLegacyDisabled}', '${FIXTURES.users.viewer}', NULL, '${FIXTURES.gateway.accounts.viewerLegacyDisabled}', NULL, '${FIXTURES.gateway.profileId}', '${FIXTURES.sourceLabels.viewerLegacyDisabled}', 'active', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.sources.viewerSuspendedCapable}', '${FIXTURES.users.viewer}', NULL, '${FIXTURES.gateway.accounts.viewerSuspendedCapable}', NULL, '${FIXTURES.gateway.profileId}', '${FIXTURES.sourceLabels.viewerSuspendedCapable}', '${process.argv.includes("--lifecycle-fixture") ? "active" : "quarantined"}', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.sources.otherPrimary}', '${FIXTURES.users.other}', NULL, '${FIXTURES.gateway.accounts.otherPrimary}', NULL, '${FIXTURES.gateway.profileId}', '${FIXTURES.sourceLabels.otherPrimary}', 'active', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.sources.orgAlpha}', NULL, '${FIXTURES.workspaces.orgAlpha}', '${FIXTURES.gateway.accounts.orgAlpha}', NULL, '${process.argv.includes("--account-models-fixture") ? CODEX_MODEL_PROFILE : FIXTURES.gateway.profileId}', '${FIXTURES.sourceLabels.orgAlpha}', 'active', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.sources.foreignPrimary}', '${FIXTURES.users.foreign}', NULL, '${FIXTURES.gateway.accounts.foreignPrimary}', NULL, '${FIXTURES.gateway.profileId}', '${FIXTURES.sourceLabels.foreignPrimary}', 'active', 1, 1, CURRENT_TIMESTAMP);

INSERT INTO "WorkspaceAccountBinding"
  ("id", "workspaceId", "connectionId", "state", "revision", "policyRevision", "updatedAt")
VALUES
  ('${FIXTURES.bindings.viewerAlpha}', '${FIXTURES.workspaces.orgAlpha}', '${FIXTURES.sources.viewerPrimary}', 'active', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.bindings.viewerBravo}', '${FIXTURES.workspaces.orgBravo}', '${FIXTURES.sources.viewerPrimary}', 'active', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.bindings.otherAlpha}', '${FIXTURES.workspaces.orgAlpha}', '${FIXTURES.sources.otherPrimary}', 'active', 1, 1, CURRENT_TIMESTAMP),
  ('${FIXTURES.bindings.orgAlpha}', '${FIXTURES.workspaces.orgAlpha}', '${FIXTURES.sources.orgAlpha}', 'active', 1, 1, CURRENT_TIMESTAMP);

UPDATE "ProviderAccountConnection"
SET "state" = 'disabled', "metadataRevision" = 2, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = '${FIXTURES.sources.viewerLegacyDisabled}';
`;

export async function withDatabase<T>(
  databaseUrl: string,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: "reviewrouter-accounts-reference-e2e-assertion",
  });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

export function fixtureRequestId(): string {
  return `rr-e2e-request-${randomUUID()}`;
}
