import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertEnvironmentBinding,
  assertPrivateInstallLocation,
  createEnvironment,
  defaultActionCommit,
  parseEnvironment,
  prepareRepositoryEnvironment,
  publicOrigin,
  readPrivate,
  readSettings,
  renderEnvironment,
  sha256,
  writePrivate,
  type InstallSettings,
} from "./install-config.ts";
import {
  assertReleaseRegistered,
  assertRuntimePreflight,
  openInitialEmergencyStop,
  repositoryActivation,
  repositoryName,
  waitForHealth,
} from "./install.ts";
import { assertCodexRotatingNewWorkAdmitted } from "../../packages/features/action-control-plane/src/domain/codex-rotating-new-work-admission.ts";

const settings: InstallSettings = {
  version: 1,
  sourceCommit: "a".repeat(40),
  actionCommit: defaultActionCommit,
  installationId: "0123456789abcdef",
  webUrl: "https://review.example.com",
  apiUrl: "https://api.example.com",
  proxy: "caddy",
  memory: "hindsight",
  permissionProfile: "provisioning",
};
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const app = {
  GITHUB_APP_ID: "123",
  GITHUB_APP_SLUG: "test-app",
  GITHUB_APP_CLIENT_ID: "Iv1.test",
  GITHUB_APP_CLIENT_SECRET: "private$app-client-secret",
  GITHUB_WEBHOOK_SECRET: "private-webhook-secret",
  // Importing a profile must not opt an installation into another runtime.
  REVIEW_ROUTER_REVIEW_INVESTIGATION_RECORDING_ENABLED: "1",
};

test("configuration generates independent credentials and preserves the App webhook and permissions", () => {
  const env = createEnvironment(
    { REVIEW_ROUTER_REVIEW_INVESTIGATION_RECORDING_ENABLED: "0" },
    settings,
    app,
    privateKey,
    "operator-secret",
  );
  assert.equal(env.GITHUB_WEBHOOK_SECRET, app.GITHUB_WEBHOOK_SECRET);
  assert.equal(env.GITHUB_CLIENT_SECRET, app.GITHUB_APP_CLIENT_SECRET);
  assert.equal(env.REVIEW_ROUTER_REVIEW_INVESTIGATION_RECORDING_ENABLED, "0");
  assert.equal(
    env.REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL_SHA256,
    sha256("operator-secret"),
  );
  assert(!Object.values(env).includes("operator-secret"));
  assert.equal(env.REVIEW_ROUTER_MEMORY_PROVIDER, "");
  assert.equal(env.REVIEW_ROUTER_ENABLE_WORKFLOW_PROVISIONING, "1");
  assert.equal(env.REVIEW_ROUTER_DISABLE_WORKFLOW_PROVISIONING, "0");
  const independent = [
    env.AUTH_SECRET,
    env.REVIEW_ROUTER_ACTION_SESSION_SECRET,
    env.REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY,
    env.POSTGRES_PASSWORD,
    env.REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS,
  ];
  assert.equal(new Set(independent).size, independent.length);
  for (const key of independent)
    assert(key && Buffer.from(key, "base64url").length === 32);
  const runtimeDb = new URL(env.DATABASE_URL!);
  const effectDb = new URL(
    env.REVIEW_ROUTER_CODEX_EFFECT_AUTHORITY_DATABASE_URL!,
  );
  assert.notEqual(runtimeDb.username, effectDb.username);
  assert.notEqual(runtimeDb.password, effectDb.password);
  const runKey = JSON.parse(
    env.REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_KEYS_JSON!,
  )[0].secretBase64;
  const capabilityKey = JSON.parse(
    env.REVIEW_ROUTER_REVIEW_V2_CAPABILITY_KEYS_JSON!,
  )[0].secretBase64;
  assert.notEqual(runKey, capabilityKey);
  assert.notEqual(
    capabilityKey,
    env.REVIEW_ROUTER_REVIEW_V2_CONTEXT_SESSION_SECRET_BASE64,
  );
  assert.equal(env.GITHUB_APP_PRIVATE_KEY_FILE, "");
  assert.deepEqual(parseEnvironment(renderEnvironment(env)), env);
  assertEnvironmentBinding(env, settings, "operator-secret");
  assert.throws(() => assertEnvironmentBinding(env, settings, "wrong"));
});

test("explicit Memory opt-out and review-only permissions remain independent", () => {
  const env = createEnvironment(
    {},
    { ...settings, memory: "disabled", permissionProfile: "review-only" },
    app,
    privateKey,
    "operator-secret",
  );
  assert.equal(env.REVIEW_ROUTER_MEMORY_PROVIDER, "disabled");
  assert.equal(env.REVIEW_ROUTER_ENABLE_WORKFLOW_PROVISIONING, "0");
  assert.equal(env.REVIEW_ROUTER_DISABLE_WORKFLOW_PROVISIONING, "1");
});

test("repository setup admits the selected Codex repository through the real runtime guard and preserves a later pause", () => {
  const base = createEnvironment(
    {},
    settings,
    app,
    privateKey,
    "operator-secret",
  );
  const enabled = prepareRepositoryEnvironment(base, "owner/repository");
  assert.equal(
    enabled.REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED,
    "1",
  );
  const input = {
    enabledValue:
      enabled.REVIEW_ROUTER_CODEX_ROTATING_NEW_WORK_ADMISSION_ENABLED,
    approvedRepositories:
      enabled.REVIEW_ROUTER_CODEX_ROTATING_OAUTH_REPOSITORIES!.split(","),
    repositoryFullName: "owner/repository",
  };
  assertCodexRotatingNewWorkAdmitted(input);
  assert.throws(() =>
    assertCodexRotatingNewWorkAdmitted({
      ...input,
      repositoryFullName: "another/repository",
    }),
  );
  assert.deepEqual(
    prepareRepositoryEnvironment(enabled, "owner/repository"),
    enabled,
  );
  assert.throws(
    () => prepareRepositoryEnvironment(enabled, "another/repository"),
    /will not widen/,
  );
  assert.throws(
    () =>
      prepareRepositoryEnvironment(
        {
          ...enabled,
          REVIEW_ROUTER_CODEX_ROTATING_NEW_WORK_ADMISSION_ENABLED: "0",
        },
        "owner/repository",
      ),
    /will not reopen/,
  );
  assert.throws(
    () =>
      prepareRepositoryEnvironment(
        {
          ...enabled,
          REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED: "0",
        },
        "owner/repository",
      ),
    /will not reopen/,
  );
});

test("state pins the source and Action and rejects an implicit upgrade or conflicting domains", () => {
  assert.deepEqual(readSettings(settings, settings.sourceCommit), settings);
  assert.throws(
    () => readSettings(settings, "b".repeat(40)),
    /recorded revision/,
  );
  assert.throws(() =>
    readSettings({ ...settings, actionCommit: "main" }, settings.sourceCommit),
  );
  assert.throws(() =>
    readSettings(
      { ...settings, apiUrl: settings.webUrl },
      settings.sourceCommit,
    ),
  );
  assert.equal(
    publicOrigin("review.example.com"),
    "https://review.example.com",
  );
  for (const url of [
    "http://review.example.com",
    "https://127.0.0.1",
    "https://review.local",
    "https://user:secret@review.example.com",
    "https://review.example.com/path",
    "https://review.example.com:8443",
  ]) {
    assert.throws(() => publicOrigin(url));
  }
});

test("env serialization retains literal dollars and key newlines without shell interpolation", () => {
  const env = {
    TOKEN: "$token ${HOME} # literal",
    KEY: "-----BEGIN-----\\nkey\\n-----END-----",
    JSON: '[{"secret":"abc+/="}]',
  };
  assert.deepEqual(parseEnvironment(renderEnvironment(env)), env);
  assert.equal(
    parseEnvironment('TOKEN="escaped\\\\path"\n').TOKEN,
    "escaped\\path",
  );
  assert.throws(() => parseEnvironment("TOKEN=a\nTOKEN=b\n"), /Duplicate/);
  assert.throws(() => parseEnvironment("export TOKEN=x"));
  assert.throws(() => renderEnvironment({ TOKEN: "value\nOTHER=oops" }));
});

test("private state survives atomic replacement and refuses symlink targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-install-"));
  try {
    const file = join(directory, "state");
    await writePrivate(file, "first");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await writePrivate(file, "second");
    assert.equal(await readPrivate(file), "second");
    const link = join(directory, "link");
    await symlink(file, link);
    await assert.rejects(writePrivate(link, "changed"), /symlinks/);
    assert.equal(await readFile(file, "utf8"), "second");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("custom state and imported credentials cannot enter the application Docker build context", () => {
  assertPrivateInstallLocation("/source/reviewrouter", "/private/install");
  assertPrivateInstallLocation(
    "/source/reviewrouter",
    "/source/reviewrouter/deploy/self-hosted/secrets/install",
  );
  assertPrivateInstallLocation(
    "/source/reviewrouter",
    "/source/reviewrouter/.local-secrets/app.env",
  );
  for (const path of [
    "/source/reviewrouter",
    "/source/reviewrouter/private/app.env",
    "/source/reviewrouter/deploy/self-hosted/secrets-lookalike",
    "/source/reviewrouter/.local-secrets/../leaked.env",
  ]) {
    assert.throws(
      () => assertPrivateInstallLocation("/source/reviewrouter", path),
      /Docker build context/,
    );
  }
});

test("first-install activation refuses to reset legacy or paused repository authority", () => {
  assert.equal(repositoryName("owner/repo.name"), "owner/repo.name");
  assert.throws(() => repositoryName("owner/repo --confirm global"));
  assert.equal(repositoryActivation({ authority: null }), "initialize");
  assert.equal(
    repositoryActivation({
      authority: { mode: "v2_active" },
      emergencyControls: {
        global: { stopped: false },
        repository: { stopped: false },
      },
    }),
    "ready",
  );
  for (const mode of ["v1_open", "v1_draining", "paused"])
    assert.throws(
      () => repositoryActivation({ authority: { mode } }),
      /cutover/,
    );
  assert.throws(
    () =>
      repositoryActivation({
        authority: { mode: "v2_active" },
        emergencyControls: { global: { stopped: true } },
      }),
    /will not reopen/,
  );
  assert.throws(() => repositoryActivation({}), /cutover/);
});

test("initial activation can open only the untouched migration stop, never an operator pause", () => {
  const initial = {
    stopped: true,
    version: 1,
    reason: "review_v2_not_promoted",
    updatedBy: "migration:000029",
  };
  assert.equal(
    openInitialEmergencyStop({
      emergencyControls: { global: initial, repository: null },
    }),
    true,
  );
  assert.equal(
    openInitialEmergencyStop({
      emergencyControls: {
        global: { stopped: false },
        repository: { stopped: false },
      },
    }),
    false,
  );
  assert.throws(
    () =>
      openInitialEmergencyStop({
        emergencyControls: { global: { ...initial, version: 2 } },
      }),
    /original migration stop/,
  );
  assert.throws(
    () =>
      openInitialEmergencyStop({
        emergencyControls: { global: { ...initial, updatedBy: "operator" } },
      }),
    /original migration stop/,
  );
  assert.throws(
    () =>
      openInitialEmergencyStop({
        emergencyControls: { global: initial, repository: { stopped: true } },
      }),
    /will not reopen/,
  );
});

test("exit-zero admin responses cannot turn a failed preflight or conflicting release into server readiness", () => {
  assertRuntimePreflight({ ready: true, missing: [], invalid: [] });
  assert.throws(
    () => assertRuntimePreflight({ ready: false, missing: ["GITHUB_APP_ID"] }),
    /preflight/,
  );
  const expected = {
    producerReleaseId: "release-1",
    actionCommitSha: defaultActionCommit,
    protocolLimitsProfileId: "limits-1",
    operationalSloProfileId: "slo-1",
  };
  const registered = { ...expected, state: "registered", revokedAt: null };
  for (const status of ["created", "restored"])
    assertReleaseRegistered(
      { releaseResult: { status, value: registered } },
      expected,
    );
  assert.throws(
    () =>
      assertReleaseRegistered(
        {
          releaseResult: {
            status: "conflict",
            existingId: expected.producerReleaseId,
          },
        },
        expected,
      ),
    /not accepted/,
  );
  for (const change of [
    { state: "revoked" },
    { revokedAt: "2026-11-07" },
    { actionCommitSha: "b".repeat(40) },
    { protocolLimitsProfileId: "different-limits" },
  ]) {
    assert.throws(
      () =>
        assertReleaseRegistered(
          {
            releaseResult: {
              status: "restored",
              value: { ...registered, ...change },
            },
          },
          expected,
        ),
      /not accepted/,
    );
  }
});

test("public health rejects redirects and failed responses", async () => {
  const server = createServer((request, response) => {
    response.writeHead(
      request.url === "/healthy"
        ? 200
        : request.url === "/redirect"
          ? 302
          : 503,
      { location: "/healthy" },
    );
    response.end("health");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    await waitForHealth(`${origin}/healthy`, 1);
    await assert.rejects(
      waitForHealth(`${origin}/redirect`, 1),
      /Health check failed/,
    );
    await assert.rejects(
      waitForHealth(`${origin}/failed`, 1),
      /Health check failed/,
    );
  } finally {
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
