import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, isIP } from "node:net";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireDeploymentLock } from "../../scripts/hindsight-e2e/deployment-lock.ts";
import {
  dockerCommand,
  eventually,
} from "../../scripts/hindsight-e2e/native-runtime.ts";
import { installNativeProvenance } from "../../scripts/hindsight-e2e/native-provenance.ts";
import { nativeSqlArguments } from "../../scripts/hindsight-e2e/operator-host.ts";
import { nativeRevision } from "../../scripts/hindsight-e2e/prepare-hardening.ts";

export interface BootstrapConfig {
  deployment: string;
  directory: string;
  image: string;
  postgresImage: string;
  qualificationEvidence: string;
  inferenceEnvFile: string;
  namespace: string;
  generation: string;
  apiBindHost: string;
  apiPort: number;
  postgresPort: number;
  workerPort: number;
  startupTimeoutMs?: number;
  modelDirectory?: string;
}
interface State {
  schema: "reviewrouter-hindsight-bootstrap/v1";
  configurationDigest: string;
  imageId: string;
  phase: "preparing" | "running";
  routerEnvironmentDigest: string | null;
  containers: { postgres: string; api: string; worker: string };
}
const profile = "hindsight-v1.1.0-chunks-v1";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const secret = () => randomBytes(32).toString("hex");
const privateSettings: Record<string, string> = {
  HINDSIGHT_API_DATABASE_SCHEMA: "public",
  HINDSIGHT_API_TENANT_EXTENSION:
    "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
  HINDSIGHT_API_WORKER_ENABLED: "false",
  HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP: "false",
  HINDSIGHT_API_OPERATION_RETENTION_DAYS: "0",
  HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS: "0",
  HINDSIGHT_API_TEXT_SEARCH_EXTENSION: "native",
  HINDSIGHT_API_LLM_TRACE_ENABLED: "false",
  HINDSIGHT_API_OTEL_TRACES_ENABLED: "false",
  HINDSIGHT_API_AUDIT_LOG_ENABLED: "false",
  HINDSIGHT_API_LLM_DEBUG_DUMP_4XX: "false",
  HINDSIGHT_API_XAI_OAUTH_DEBUG_HEADERS: "false",
  HINDSIGHT_API_MCP_ENABLED: "false",
  HINDSIGHT_API_ENABLE_FILE_UPLOAD_API: "false",
  HINDSIGHT_API_ACCESS_LOG: "false",
  HINDSIGHT_API_FAIL_ON_EXTRACTION_ERRORS: "true",
  HINDSIGHT_API_STORE_DOCUMENT_TEXT: "true",
  HINDSIGHT_API_ENABLE_OBSERVATIONS: "false",
  HINDSIGHT_API_ENABLE_AUTO_CONSOLIDATION: "false",
  HF_HOME: "/var/cache/reviewrouter-models/huggingface",
  SENTENCE_TRANSFORMERS_HOME:
    "/var/cache/reviewrouter-models/sentence-transformers",
  HF_HUB_DISABLE_TELEMETRY: "1",
  DO_NOT_TRACK: "1",
};

export function validateConfig(value: unknown): BootstrapConfig {
  assert(
    value && typeof value === "object",
    "Bootstrap config must be an object",
  );
  const config = value as BootstrapConfig;
  for (const name of ["deployment", "namespace", "generation"] as const)
    assert(/^[a-zA-Z0-9_-]{1,60}$/.test(config[name]), `Invalid ${name}`);
  for (const name of [
    "directory",
    "qualificationEvidence",
    "inferenceEnvFile",
  ] as const)
    assert(
      typeof config[name] === "string" && isAbsolute(config[name]),
      `${name} must be absolute`,
    );
  assert(
    /^([\w./:-]+@)?sha256:[a-f0-9]{64}$/.test(config.image),
    "Derivative image must be immutable",
  );
  assert(
    /^pgvector\/pgvector@sha256:[a-f0-9]{64}$/.test(config.postgresImage),
    "PG17/pgvector image must be immutable",
  );
  assert(
    isPrivateHost(config.apiBindHost),
    "apiBindHost must be an explicit loopback or RFC1918 IPv4 address",
  );
  const ports = [config.apiPort, config.postgresPort, config.workerPort];
  assert(
    ports.every(
      (port) => Number.isInteger(port) && port >= 1024 && port <= 65535,
    ),
    "Invalid private service ports",
  );
  assert(new Set(ports).size === 3, "Private service ports must be distinct");
  assert(
    config.startupTimeoutMs === undefined ||
      (Number.isInteger(config.startupTimeoutMs) &&
        config.startupTimeoutMs >= 10_000 &&
        config.startupTimeoutMs <= 1_800_000),
    "startupTimeoutMs must be between ten seconds and thirty minutes",
  );
  assert(
    config.modelDirectory === undefined ||
      (isAbsolute(config.modelDirectory) &&
        !/[,\r\n]/.test(config.modelDirectory)),
    "modelDirectory must be an absolute bind-mount path",
  );
  return config;
}
function isPrivateHost(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}

/** A plain Docker env file: no shell interpolation, quotes, or multiline values. */
export function parseInferenceEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const match =
      /^(HINDSIGHT_API_(?:LLM|EMBEDDINGS|RERANKER)_[A-Z0-9_]+)=(\S.*)$/.exec(
        raw,
      );
    assert(
      match && !/[\r\n\0]/.test(raw),
      "Inference file must contain only explicit Hindsight inference settings",
    );
    const key = match[1]!;
    const value = match[2]!;
    assert(
      !(key in privateSettings) && !/(TRACE|DEBUG|DUMP|LOG)/.test(key),
      "Inference settings cannot override the privacy profile",
    );
    assert(
      !key.startsWith("HINDSIGHT_API_LLM_") ||
        key === "HINDSIGHT_API_LLM_PROVIDER",
      "The non-generative bootstrap must not configure LLM accounts, models or overrides",
    );
    assert(!(key in values), "Duplicate inference setting");
    assert(
      !/^["']|["']$/.test(value),
      "Docker inference values must be unquoted",
    );
    assert(
      !/REPLACE|placeholder|stub-model|example\.com/i.test(value),
      "Inference settings contain a placeholder",
    );
    values[key] = value;
  }
  for (const family of ["LLM", "EMBEDDINGS", "RERANKER"]) {
    if (family === "LLM") {
      assert(
        values.HINDSIGHT_API_LLM_PROVIDER === "none",
        "Ordinary chunk memory requires explicit LLM_PROVIDER=none; account-routed automatic learning has a separate activation path",
      );
      continue;
    }
    assert(
      values[`HINDSIGHT_API_${family}_PROVIDER`],
      `Explicit ${family} provider is required`,
    );
    assert(
      Object.keys(values).some(
        (key) =>
          key.startsWith(`HINDSIGHT_API_${family}_`) && key.endsWith("_MODEL"),
      ),
      `Explicit ${family} model is required`,
    );
  }
  return values;
}
async function privateFile(path: string): Promise<string> {
  const metadata = await lstat(path);
  assert(
    metadata.isFile() &&
      metadata.uid === process.getuid?.() &&
      (metadata.mode & 0o077) === 0,
    "Input must be an operator-owned mode0600 regular file",
  );
  return readFile(path, "utf8");
}
async function writePrivate(path: string, value: string): Promise<void> {
  await writeFile(path, value, { mode: 0o600, flag: "wx" });
}
const serializeEnv = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}\n`)
    .join("");
/** Keep credential-bearing role SQL off both Docker and psql process arguments. */
export function bootstrapDatabaseSql(
  containerId: string,
  port: number,
  database: string,
  statement: string,
): Promise<string> {
  return dockerCommand(
    [
      "exec",
      "--interactive",
      containerId,
      "psql",
      "-U",
      "postgres",
      "-p",
      String(port),
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "--file=-",
    ],
    false,
    statement,
  );
}
function names(config: BootstrapConfig) {
  return {
    postgres: `${config.deployment}-postgres`,
    api: `${config.deployment}-api`,
    worker: `${config.deployment}-worker`,
  };
}
async function assertPortAvailable(host: string, port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", () =>
      reject(new Error("Private native bind address or port is unavailable")),
    );
    server.listen({ host, port, exclusive: true }, done);
  });
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
}

export async function bootstrap(
  action: string,
  config: BootstrapConfig,
): Promise<object> {
  validateConfig(config);
  assert(
    ["validate", "plan", "apply", "status"].includes(action),
    "Use validate, plan, apply, or status",
  );
  const inferenceText = await privateFile(config.inferenceEnvFile);
  const inference = parseInferenceEnv(inferenceText);
  if (config.modelDirectory) {
    const models = await lstat(config.modelDirectory);
    assert(
      models.isDirectory() && (models.mode & 0o022) === 0,
      "Pinned model directory must deny group/other writes",
    );
    assert(
      inference.HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL?.startsWith("/models/") &&
        inference.HINDSIGHT_API_RERANKER_LOCAL_MODEL?.startsWith("/models/"),
      "Mounted local model paths must be within /models",
    );
  }
  const evidenceText = await readFile(config.qualificationEvidence, "utf8");
  const evidence = JSON.parse(evidenceText) as {
    schema?: string;
    nativeRevision?: string;
    imageId?: string;
    postgresImage?: string;
    completedAt?: string;
  };
  assert(
    evidence.schema === "hindsight-native-qualification/v1" &&
      evidence.nativeRevision === nativeRevision &&
      evidence.completedAt &&
      /^sha256:[a-f0-9]{64}$/.test(evidence.imageId ?? "") &&
      evidence.postgresImage === config.postgresImage,
    "Completed exact-image native qualification evidence is required",
  );
  const configurationDigest = digest(
    JSON.stringify(config) + digest(inferenceText) + digest(evidenceText),
  );
  const files = {
    state: join(config.directory, "bootstrap-state.json"),
    router: join(config.directory, "router.env"),
  };
  if (action === "validate" || action === "plan")
    return {
      action,
      configurationDigest,
      deployment: config.deployment,
      steps: [
        "verify immutable images and standalone Docker",
        "generate private credentials",
        "create isolated PG17 storage and bounded native role",
        "migrate then activate fresh provenance",
        "start private standalone API and worker under the shared lock",
        "write router.env for explicit control-plane activation",
      ],
      routerEnvironmentFile: files.router,
    };
  assert(
    process.platform === "linux",
    "The qualified standalone host profile requires Linux",
  );
  const info = JSON.parse(
    await dockerCommand(["info", "--format", "{{json .Swarm}}"]),
  );
  assert(info.LocalNodeState === "inactive", "Swarm must be inactive");
  if (action === "status") {
    const state = JSON.parse(await privateFile(files.state)) as State;
    assert(
      state.configurationDigest === configurationDigest,
      "Configuration changed; use the reviewed recovery/cutover procedure",
    );
    const states: Record<string, string> = {};
    for (const [role, id] of Object.entries(state.containers))
      states[role] = id
        ? await dockerCommand([
            "inspect",
            "--format",
            "{{.State.Status}}",
            id,
          ]).then(
            (value) => value.trim(),
            () => "unavailable",
          )
        : "not_recorded";
    return {
      phase: state.phase,
      states,
      routerEnvironmentFile: state.phase === "running" ? files.router : null,
    };
  }
  await mkdir(config.directory, { mode: 0o700, recursive: true });
  const directory = await lstat(config.directory);
  assert(
    directory.isDirectory() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o077) === 0,
    "Deployment directory must be an operator-owned mode0700 directory",
  );
  const lock = await acquireDeploymentLock(
    join(config.directory, "deployment.lock"),
  );
  try {
    await lock.assertHeld();
    const imageId = (
      await dockerCommand([
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        config.image,
      ])
    ).trim();
    assert(
      imageId === evidence.imageId,
      "Derivative differs from qualified image",
    );
    const revision = (
      await dockerCommand([
        "image",
        "inspect",
        "--format",
        '{{index .Config.Labels "io.reviewrouter.hindsight.source-revision"}}',
        imageId,
      ])
    ).trim();
    assert(revision === nativeRevision, "Derivative source revision differs");
    const pgEnv = JSON.parse(
      await dockerCommand([
        "image",
        "inspect",
        "--format",
        "{{json .Config.Env}}",
        config.postgresImage,
      ]),
    ) as string[];
    assert(
      pgEnv.includes("PG_MAJOR=17"),
      "Native database image must be PostgreSQL17",
    );
    let previous: State | undefined;
    try {
      previous = JSON.parse(await privateFile(files.state)) as State;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (previous) {
      assert(
        previous.configurationDigest === configurationDigest &&
          previous.imageId === imageId,
        "Existing deployment binding differs; use reviewed recovery",
      );
      assert(
        previous.phase === "running",
        "Partial bootstrap preserved; reconcile it before further effects (no automatic replay)",
      );
      assert(
        previous.routerEnvironmentDigest ===
          digest(await privateFile(files.router)),
        "Generated router environment changed; reconcile before activation",
      );
      await verifyRunning(config, previous);
      return {
        phase: "running",
        reused: true,
        routerEnvironmentFile: files.router,
      };
    }
    const containerNames = names(config);
    const volume = `${config.deployment}-pg17-data`;
    const cacheVolume = `${config.deployment}-model-cache`;
    assert(
      !(
        await dockerCommand([
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `label=io.reviewrouter.hindsight.deployment=${config.deployment}`,
        ])
      ).trim(),
      "Existing deployment containers require reconciliation",
    );
    assert(
      !(
        await dockerCommand([
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `name=^${volume}$`,
        ])
      ).trim(),
      "Existing native volume must never be adopted as fresh",
    );
    assert(
      !(
        await dockerCommand([
          "volume",
          "ls",
          "--quiet",
          "--filter",
          `name=^${cacheVolume}$`,
        ])
      ).trim(),
      "Existing model-cache volume requires reconciliation",
    );
    for (const name of Object.values(containerNames))
      assert(
        !(
          await dockerCommand([
            "ps",
            "--all",
            "--quiet",
            "--filter",
            `name=^/${name}$`,
          ])
        ).trim(),
        "Container name already exists",
      );
    await assertPortAvailable(config.apiBindHost, config.apiPort);
    await assertPortAvailable("127.0.0.1", config.postgresPort);
    await assertPortAvailable("127.0.0.1", config.workerPort);
    const state: State = {
      schema: "reviewrouter-hindsight-bootstrap/v1",
      configurationDigest,
      imageId,
      phase: "preparing",
      routerEnvironmentDigest: null,
      containers: { postgres: "", api: "", worker: "" },
    };
    await writePrivate(files.state, JSON.stringify(state, null, 2) + "\n");
    const adminPassword = secret();
    const nativePassword = secret();
    const serviceKey = secret();
    const operatorToken = secret();
    const signing = generateKeyPairSync("ed25519");
    const publicKey = signing.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    await writePrivate(
      join(config.directory, "cleanup-signing-private.pem"),
      signing.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    );
    await writePrivate(
      join(config.directory, "cleanup-signing-public.pem"),
      publicKey,
    );
    const databaseUrl = `postgresql://hindsight:${nativePassword}@127.0.0.1:${config.postgresPort}/hindsight`;
    const provenanceEnvironmentFiles = {
      admin: join(config.directory, "provenance-admin-database.env"),
      observer: join(config.directory, "provenance-observer-database.env"),
    };
    for (const [role, file] of Object.entries(provenanceEnvironmentFiles))
      await writePrivate(
        file,
        serializeEnv({
          HINDSIGHT_API_DATABASE_URL: `${databaseUrl}?application_name=${role === "admin" ? "rr-native-provenance-admin" : "rr-native-cleanup-read-observer"}`,
        }),
      );
    await writePrivate(
      join(config.directory, "postgres.env"),
      serializeEnv({
        POSTGRES_PASSWORD: adminPassword,
        PGDATA: "/var/lib/postgresql/data/pgdata",
      }),
    );
    for (const role of ["migrate", "api", "worker"] as const) {
      const processName =
        role === "migrate"
          ? `${config.deployment}-migrate`
          : containerNames[role];
      await writePrivate(
        join(config.directory, `${role}.env`),
        serializeEnv({
          ...inference,
          ...privateSettings,
          ...(config.modelDirectory
            ? { HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1" }
            : {}),
          HINDSIGHT_API_DATABASE_URL: `${databaseUrl}?application_name=${processName}`,
          HINDSIGHT_API_TENANT_API_KEY: serviceKey,
          HINDSIGHT_API_WORKER_ID: processName,
          ...(role === "api"
            ? {
                HINDSIGHT_API_HOST: config.apiBindHost,
                HINDSIGHT_API_PORT: String(config.apiPort),
              }
            : {}),
        }),
      );
    }
    const saveState = () =>
      writeFile(files.state, JSON.stringify(state, null, 2) + "\n", {
        mode: 0o600,
      });
    const run = async (role: "postgres" | "api" | "worker", args: string[]) => {
      await lock.assertHeld();
      const id = (
        await dockerCommand([
          "run",
          "--detach",
          "--restart=no",
          "--network=host",
          "--name",
          containerNames[role],
          "--label",
          `io.reviewrouter.hindsight.deployment=${config.deployment}`,
          ...(role === "postgres"
            ? []
            : ["--label", `io.reviewrouter.hindsight.role=${role}`]),
          "--env-file",
          join(config.directory, `${role}.env`),
          ...(role !== "postgres" && config.modelDirectory
            ? [
                "--mount",
                `type=bind,src=${config.modelDirectory},dst=/models,readonly`,
              ]
            : []),
          ...args,
        ])
      ).trim();
      state.containers[role] = id;
      await saveState();
    };
    await dockerCommand([
      "volume",
      "create",
      "--label",
      `io.reviewrouter.hindsight.deployment=${config.deployment}`,
      volume,
    ]);
    await dockerCommand([
      "volume",
      "create",
      "--label",
      `io.reviewrouter.hindsight.deployment=${config.deployment}`,
      cacheVolume,
    ]);
    const cacheMount = `type=volume,src=${cacheVolume},dst=/var/cache/reviewrouter-models`;
    await dockerCommand([
      "run",
      "--rm",
      "--restart=no",
      "--network=none",
      "--user=0",
      "--mount",
      cacheMount,
      imageId,
      "python",
      "-c",
      "import os,pwd; p=pwd.getpwnam('hindsight'); os.chown('/var/cache/reviewrouter-models',p.pw_uid,p.pw_gid); os.chmod('/var/cache/reviewrouter-models',0o700)",
    ]);
    await run("postgres", [
      "--mount",
      `type=volume,src=${volume},dst=/var/lib/postgresql/data`,
      config.postgresImage,
      "-p",
      String(config.postgresPort),
      "-c",
      "listen_addresses=127.0.0.1",
      "-c",
      "log_statement=none",
      "-c",
      "log_min_messages=panic",
      "-c",
      "log_min_error_statement=panic",
      "-c",
      "log_error_verbosity=terse",
      "-c",
      "log_parameter_max_length=0",
      "-c",
      "log_parameter_max_length_on_error=0",
    ]);
    await eventually(
      async () =>
        (
          await dockerCommand(
            [
              "exec",
              state.containers.postgres,
              "pg_isready",
              "-U",
              "postgres",
              "-p",
              String(config.postgresPort),
            ],
            true,
          )
        ).includes("accepting connections")
          ? true
          : undefined,
      "native PostgreSQL17 readiness",
    );
    const sql = (statement: string, database = "postgres") =>
      bootstrapDatabaseSql(
        state.containers.postgres,
        config.postgresPort,
        database,
        statement,
      );
    await sql(`CREATE ROLE hindsight LOGIN PASSWORD '${nativePassword}'`);
    await sql("CREATE DATABASE hindsight OWNER hindsight");
    await sql("CREATE EXTENSION vector; CREATE EXTENSION pg_trgm", "hindsight");
    await lock.assertHeld();
    await dockerCommand([
      "run",
      "--rm",
      "--restart=no",
      "--network=host",
      "--env-file",
      join(config.directory, "migrate.env"),
      "--mount",
      cacheMount,
      ...(config.modelDirectory
        ? [
            "--mount",
            `type=bind,src=${config.modelDirectory},dst=/models,readonly`,
          ]
        : []),
      imageId,
      "hindsight-admin",
      "run-db-migration",
    ]);
    await installNativeProvenance(
      async (steps, readOnly = true) =>
        (
          await dockerCommand(
            nativeSqlArguments(
              databaseUrl,
              imageId,
              steps,
              readOnly,
              provenanceEnvironmentFiles[readOnly ? "observer" : "admin"],
            ),
          )
        ).trim(),
      "public",
      {
        namespace: config.namespace,
        generation: config.generation,
        imageDigest: imageId,
      },
    );
    await run("api", ["--mount", cacheMount, imageId, "hindsight-api"]);
    await run("worker", [
      "--mount",
      cacheMount,
      imageId,
      "hindsight-worker",
      "--http-host",
      "127.0.0.1",
      "--http-port",
      String(config.workerPort),
    ]);
    await verifyRunning(config, state);
    const routerEnvironment = serializeEnv({
      REVIEW_ROUTER_MEMORY_PROVIDER: "hindsight",
      REVIEW_ROUTER_MEMORY_ENABLED: "true",
      REVIEW_ROUTER_MEMORY_GENERATION: config.generation,
      REVIEW_ROUTER_MEMORY_NAMESPACE: config.namespace,
      REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: profile,
      REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: `http://${config.apiBindHost}:${config.apiPort}`,
      REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY: serviceKey,
      REVIEW_ROUTER_MEMORY_RESUBMIT_WINDOW_MS: "0",
      REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN: operatorToken,
      REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST: imageId,
      REVIEW_ROUTER_MEMORY_CLEANUP_PUBLIC_KEYS: JSON.stringify({
        [config.deployment]: publicKey,
      }),
    });
    await writePrivate(files.router, routerEnvironment);
    state.routerEnvironmentDigest = digest(routerEnvironment);
    await writePrivate(
      join(config.directory, "operator.env"),
      serializeEnv({
        HINDSIGHT_OPERATOR_NATIVE_SERVICE_KEY: serviceKey,
        REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN: operatorToken,
        HINDSIGHT_CLEANUP_SIGNING_PRIVATE_KEY_FILE: join(
          config.directory,
          "cleanup-signing-private.pem",
        ),
        HINDSIGHT_CLEANUP_SIGNING_PUBLIC_KEY_FILE: join(
          config.directory,
          "cleanup-signing-public.pem",
        ),
        HINDSIGHT_CLEANUP_SIGNING_KEY_ID: config.deployment,
      }),
    );
    state.phase = "running";
    await saveState();
    return {
      phase: "running",
      routerEnvironmentFile: files.router,
      deploymentLockPath: lock.path,
    };
  } finally {
    await lock.close();
  }
}

async function verifyRunning(
  config: BootstrapConfig,
  state: State,
): Promise<void> {
  for (const role of ["postgres", "api", "worker"] as const) {
    const inspected = JSON.parse(
      await dockerCommand(["inspect", state.containers[role]]),
    )[0] as {
      Image: string;
      Config: { Labels: Record<string, string> };
      HostConfig: { RestartPolicy: { Name: string } };
      State: { Running: boolean };
    };
    assert(
      inspected.State.Running &&
        inspected.HostConfig.RestartPolicy.Name === "no" &&
        inspected.Config.Labels["io.reviewrouter.hindsight.deployment"] ===
          config.deployment,
      "Exact standalone container is not running under the deployment binding",
    );
    if (role !== "postgres")
      assert(
        inspected.Image === state.imageId &&
          inspected.Config.Labels["io.reviewrouter.hindsight.role"] === role,
        "Native image/role binding differs",
      );
  }
  for (const url of [
    `http://${config.apiBindHost}:${config.apiPort}/health/ready`,
    `http://127.0.0.1:${config.workerPort}/health/ready`,
  ])
    await eventually(
      async () => {
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(2_000),
          });
          return response.ok ? true : undefined;
        } catch {
          return undefined;
        }
      },
      "private native readiness",
      config.startupTimeoutMs ?? 600_000,
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [action, path] = process.argv.slice(2);
    assert(
      action && path,
      "Usage: node deploy/hindsight/bootstrap.ts validate|plan|apply|status /absolute/config.json",
    );
    const config = validateConfig(JSON.parse(await privateFile(resolve(path))));
    console.log(JSON.stringify(await bootstrap(action, config), null, 2));
  } catch (error) {
    // Native stdout, SQL, env values and provider diagnostics must never escape.
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "Memory bootstrap failed; private state preserved for reconciliation.",
    );
    process.exitCode = 1;
  }
}
