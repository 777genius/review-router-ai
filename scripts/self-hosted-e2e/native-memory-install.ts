import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConversationRelease } from "../../deploy/self-hosted/conversation-release.ts";
import {
  setupMemory,
  resumeMemory,
} from "../../deploy/self-hosted/setup-memory.ts";
import { isLoopbackHostname } from "../../packages/shared/src/validation/loopback-hostname.mjs";
import { bootstrap, validateConfig } from "../../deploy/hindsight/bootstrap.ts";
import { acquireDeploymentLock } from "../hindsight-e2e/deployment-lock.ts";
import { dockerCommand } from "../hindsight-e2e/native-runtime.ts";
import {
  CLEANUP_HOST_CONTAINER_LIMIT,
  CleanupHostInventory,
  type CleanupHostInspection,
} from "../hindsight-e2e/cleanup-host-inventory.ts";

type Inspection = CleanupHostInspection & {
  Mounts: {
    Type: string;
    Name?: string;
    Source: string;
    Destination: string;
    RW: boolean;
  }[];
};
type State = {
  schema: string;
  phase: string;
  configurationDigest: string;
  imageId: string;
  containers: Record<"postgres" | "api" | "worker", string>;
};
const label = "io.reviewrouter.hindsight.deployment";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const composeRoles = ["web", "api", "worker"] as const;
type ComposeRole = (typeof composeRoles)[number];
type ComposeInspection = Inspection & {
  State: Inspection["State"] & { Health?: { Status: string } };
  NetworkSettings: {
    Networks: Record<string, { NetworkID: string; IPAddress: string }>;
    Ports?: Record<string, { HostIp: string; HostPort: string }[] | null>;
  };
};
type NetworkInspection = {
  Id: string;
  Name: string;
  Driver: string;
  Labels: Record<string, string>;
};
export type SelfHostedComposeBinding = Readonly<{
  projectName: string;
  network: Readonly<{ id: string; name: string }>;
  roles: Readonly<
    Record<
      ComposeRole,
      Readonly<{
        id: string;
        imageId: string;
        ip: string;
        pid: number;
        startedAt: string;
      }>
    >
  >;
}>;
export type SelfHostedOwnedBinding = SelfHostedComposeBinding &
  Readonly<{
    directory: string;
    envFile: string;
    operatorDirectory: string;
    apiOrigin: string;
    native: Readonly<{
      deployment: string;
      imageId: string;
      postgresImageId: string;
      configurationDigest: string;
      containers: Readonly<State["containers"]>;
      apiHost: string;
      apiPort: number;
      namespace: string;
      generation: string;
      deploymentLockPath: string;
    }>;
  }>;
export type SelfHostedE2EOptions = Readonly<{
  configuredApiOrigin?: string;
  /** The owner journals cleanup before effects and returns the same one-shot cleanup promise. */
  afterComposeHealthy?: (
    binding: SelfHostedOwnedBinding,
  ) => Promise<() => Promise<void>>;
}>;

/** Same shared hostname classification as normal readiness; never relax TLS or map DNS. */
export function assertConfiguredSelfHostedApiOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    assert.fail("configured_sandbox_api_origin_invalid");
  }
  assert(
    url.protocol === "https:" &&
      !isLoopbackHostname(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      origin === url.origin &&
      !/example\.com|placeholder/i.test(origin),
    "configured_sandbox_api_origin_invalid",
  );
}

function environmentValue(environment: string, key: string): string {
  const values = environment
    .split("\n")
    .filter((line) => line.startsWith(`${key}=`));
  assert(
    values.length === 1,
    "sandbox_environment_setting_missing_or_duplicate",
  );
  return values[0]!.slice(key.length + 1);
}

export function assertSelfHostedConfiguredResumeOrigin(
  environment: string,
  origin: string,
): void {
  assertConfiguredSelfHostedApiOrigin(origin);
  for (const key of ["REVIEW_ROUTER_API_URL", "REVIEW_ROUTER_PUBLIC_API_URL"])
    assert(
      environmentValue(environment, key) === origin,
      "configured_sandbox_api_origin_mismatch",
    );
}

/** Projection only: the collector below supplies its actual complete Docker census. */
export function projectSelfHostedComposeBinding(
  projectName: string,
  network: NetworkInspection,
  records: readonly ComposeInspection[],
): SelfHostedComposeBinding {
  assert(
    /^reviewrouter-self-hosted-e2e-[a-z0-9-]+$/.test(projectName),
    "sandbox_project_invalid",
  );
  assert(
    network.Name === `${projectName}_default` &&
      network.Driver === "bridge" &&
      /^[a-f0-9]{64}$/.test(network.Id) &&
      network.Labels["com.docker.compose.project"] === projectName,
    "sandbox_network_binding_invalid",
  );
  assert(
    records.length === composeRoles.length,
    "sandbox_consumer_inventory_invalid",
  );
  const roles = {} as Record<
    ComposeRole,
    SelfHostedComposeBinding["roles"][ComposeRole]
  >;
  for (const role of composeRoles) {
    const matching = records.filter(
      (r) => r.Config.Labels["com.docker.compose.service"] === role,
    );
    assert(matching.length === 1, "sandbox_consumer_missing_or_duplicate");
    const record = matching[0]!;
    const attached = record.NetworkSettings.Networks[network.Name];
    assert(
      record.Config.Labels["com.docker.compose.project"] === projectName &&
        /^[a-f0-9]{64}$/.test(record.Id) &&
        /^sha256:[a-f0-9]{64}$/.test(record.Image) &&
        record.State.Running &&
        !record.State.Restarting &&
        !record.State.Paused &&
        !record.State.Dead &&
        Number.isSafeInteger(record.State.Pid) &&
        record.State.Pid > 0 &&
        record.RestartCount === 0 &&
        record.State.StartedAt &&
        Number.isFinite(Date.parse(record.State.StartedAt)) &&
        (role === "worker" || record.State.Health?.Status === "healthy") &&
        Object.keys(record.NetworkSettings.Networks).length === 1 &&
        attached?.NetworkID === network.Id &&
        isIP(attached.IPAddress) === 4,
      "sandbox_consumer_binding_invalid",
    );
    roles[role] = Object.freeze({
      id: record.Id,
      imageId: record.Image,
      ip: attached.IPAddress,
      pid: record.State.Pid,
      startedAt: record.State.StartedAt,
    });
  }
  assert(
    new Set(Object.values(roles).map((r) => r.id)).size === 3 &&
      new Set(Object.values(roles).map((r) => r.ip)).size === 3 &&
      new Set(Object.values(roles).map((r) => r.imageId)).size === 1,
    "sandbox_consumer_binding_not_exclusive",
  );
  return Object.freeze({
    projectName,
    network: Object.freeze({ id: network.Id, name: network.Name }),
    roles: Object.freeze(roles),
  });
}

/** Read and attest owned runtime identities; no credentials enter the lifecycle callback. */
export async function collectSelfHostedOwnedBinding(
  envFile: string,
  directory: string,
  projectName: string,
  apiOrigin: string,
): Promise<SelfHostedOwnedBinding> {
  assert(
    envFile === join(directory, "self-hosted.env"),
    "sandbox_env_binding_invalid",
  );
  assertSelfHostedResumeOrigin(await readFile(envFile, "utf8"), apiOrigin);
  return withSandboxAuthority(
    directory,
    async ({
      config,
      state,
      lock,
      inventory,
      census,
      operator,
      postgresImageId,
    }) => {
      const all = await census();
      inventory.inspect(all, "initial");
      const records = all.filter(
        (r) =>
          r.Config.Labels["com.docker.compose.project"] === projectName &&
          composeRoles.includes(
            r.Config.Labels["com.docker.compose.service"] as ComposeRole,
          ),
      ) as ComposeInspection[];
      const network = JSON.parse(
        await dockerCommand(["network", "inspect", `${projectName}_default`]),
      ) as NetworkInspection[];
      assert(network.length === 1, "sandbox_network_inventory_invalid");
      const compose = projectSelfHostedComposeBinding(
        projectName,
        network[0]!,
        records,
      );
      const api = records.find((record) => record.Id === compose.roles.api.id)!;
      const published = api.NetworkSettings.Ports?.["4000/tcp"];
      assert(
        published?.length === 1 &&
          published[0]!.HostIp === "127.0.0.1" &&
          published[0]!.HostPort === new URL(apiOrigin).port,
        "sandbox_api_published_binding_invalid",
      );
      const generated = await readFile(join(operator, "router.env"), "utf8");
      const expected = Object.fromEntries(
        generated
          .trim()
          .split("\n")
          .map((line) => {
            const equal = line.indexOf("=");
            assert(equal > 0, "generated_memory_setting_invalid");
            return [line.slice(0, equal), line.slice(equal + 1)];
          }),
      );
      assertComposeMemoryEnvironment(records, expected);
      await lock.assertHeld();
      return Object.freeze({
        ...compose,
        directory,
        envFile,
        operatorDirectory: operator,
        apiOrigin,
        native: Object.freeze({
          deployment: config.deployment,
          imageId: state.imageId,
          postgresImageId,
          configurationDigest: state.configurationDigest,
          containers: Object.freeze({ ...state.containers }),
          apiHost: config.apiBindHost,
          apiPort: config.apiPort,
          namespace: config.namespace,
          generation: config.generation,
          deploymentLockPath: join(operator, "deployment.lock"),
        }),
      });
    },
  ).catch(() => {
    throw new Error("selfhost_owned_binding_refused");
  });
}

/** Uses the real first-install owner; no qualification or provider is substituted. */
export async function installSelfHostedMemory(
  envFile: string,
  directory: string,
) {
  const operator = join(directory, "memory-operator");
  const first = await setupMemory(
    envFile,
    operator,
    join(directory, "memory-scratch"),
  );
  assert.equal((first as { status: string }).status, "configured");
  const release = await readConversationRelease(
    resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  );
  if (release.status === "available") {
    assert.equal(
      (first as { conversation: { status: string } }).conversation.status,
      "release_capability_installed",
    );
  } else {
    assert.equal(
      release.reason,
      "release_artifact_absent",
      "packaged_conversation_artifact_invalid",
    );
    assert.deepEqual(
      (first as { conversation: unknown }).conversation,
      release,
    );
  }
  const original = await readFile(envFile, "utf8");
  const state = await readFile(join(operator, "bootstrap-state.json"), "utf8");
  const router = await readFile(join(operator, "router.env"), "utf8");
  const values = Object.fromEntries(
    router
      .trim()
      .split("\n")
      .map((line) => {
        const i = line.indexOf("=");
        assert(i > 0);
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
  assert.equal(values.REVIEW_ROUTER_MEMORY_PROVIDER, "hindsight");
  assert.equal(values.REVIEW_ROUTER_MEMORY_ENABLED, "true");
  assert.equal(
    values.REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE,
    "hindsight-v1.1.0-chunks-v1",
  );
  const again = await setupMemory(
    envFile,
    operator,
    join(directory, "memory-scratch"),
  );
  assert.equal((again as { status: string }).status, "configured");
  assert.equal(sha(await readFile(envFile, "utf8")), sha(original));
  assert.equal(
    sha(await readFile(join(operator, "bootstrap-state.json"), "utf8")),
    sha(state),
  );
  const inference = await readFile(join(operator, "inference.env"), "utf8");
  for (const setting of [
    "HINDSIGHT_API_LLM_PROVIDER=none",
    "HINDSIGHT_API_EMBEDDINGS_PROVIDER=local",
    "HINDSIGHT_API_RERANKER_PROVIDER=local",
  ])
    assert(inference.split("\n").includes(setting));
  const receipt = {
    status: "selfhost_native_install_passed",
    environmentDigest: sha(original),
    bootstrapDigest: sha(state),
    imageId: (JSON.parse(state) as State).imageId,
    modelPinsDigest: sha(
      await readFile(join(operator, "models/snapshot-pins.json"), "utf8"),
    ),
    idempotent: true,
    localInferenceOnly: true,
    conversation: (first as { conversation: unknown }).conversation,
  };
  // Installation/identity evidence only; this never claims model quality.
  await writeFile(
    join(directory, "memory-install-result.json"),
    JSON.stringify(receipt) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return { operator, values, receipt };
}

/** Assert the actual consumer containers, never just the host CLI environment. */
export function assertComposeMemoryEnvironment(
  records: readonly {
    Config: { Env: string[]; Labels: Record<string, string> };
  }[],
  expected: Readonly<Record<string, string>>,
) {
  const roles = ["api", "web", "worker"];
  assert.equal(records.length, roles.length);
  assert.deepEqual(
    records
      .map((record) => record.Config.Labels["com.docker.compose.service"])
      .sort(),
    [...roles].sort(),
  );
  const keys = [
    "REVIEW_ROUTER_MEMORY_PROVIDER",
    "REVIEW_ROUTER_MEMORY_ENABLED",
    "REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE",
    "REVIEW_ROUTER_MEMORY_NAMESPACE",
    "REVIEW_ROUTER_MEMORY_GENERATION",
    "REVIEW_ROUTER_MEMORY_HINDSIGHT_URL",
    "REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY",
  ];
  for (const record of records) {
    for (const key of keys) {
      assert(expected[key], "installed_memory_setting_missing");
      const matches = record.Config.Env.filter((value) =>
        value.startsWith(`${key}=`),
      );
      assert.equal(
        matches.length,
        1,
        "compose_memory_setting_missing_or_duplicate",
      );
      assert.equal(
        sha(matches[0]!.slice(key.length + 1)),
        sha(expected[key]!),
        "compose_memory_environment_mismatch",
      );
    }
  }
  return {
    status: "selfhost_memory_environment_passed",
    roles,
    provider: "hindsight",
    serviceKeyDigest: sha(expected.REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY!),
  };
}

/** Supplement the existing complete host census with exact owned mount bindings. */
export function assertSandboxMounts(
  records: readonly Inspection[],
  config: ReturnType<typeof validateConfig>,
  state: State,
): void {
  assert.equal(state.schema, "reviewrouter-hindsight-bootstrap/v1");
  assert.equal(state.phase, "running");
  for (const role of ["postgres", "api", "worker"] as const) {
    const record = records.find((r) => r.Id === state.containers[role]);
    assert(record);
    assert.equal(record.Config.Labels[label], config.deployment);
    const name = `${config.deployment}-${role === "postgres" ? "pg17-data" : "model-cache"}`;
    const destination =
      role === "postgres"
        ? "/var/lib/postgresql/data"
        : "/var/cache/reviewrouter-models";
    assert.equal(
      record.Mounts.filter(
        (m) =>
          m.Type === "volume" &&
          m.Name === name &&
          m.Destination === destination,
      ).length,
      1,
    );
    assert(
      record.Mounts.every((m) =>
        m.Type === "volume"
          ? m.Name === name && m.Destination === destination
          : role !== "postgres" &&
            m.Type === "bind" &&
            m.Source === config.modelDirectory &&
            m.Destination === "/models" &&
            !m.RW,
      ),
    );
    if (role !== "postgres")
      assert(
        record.Mounts.some(
          (m) => m.Type === "bind" && m.Source === config.modelDirectory,
        ),
      );
  }
}

/** A stopped fixture is accepted only for all three recorded, non-restarting IDs. */
export function assertStoppedSelfHostedMemory(
  records: readonly Inspection[],
  containers: State["containers"],
): void {
  const ids = Object.values(containers);
  assert(ids.length === 3 && new Set(ids).size === 3);
  for (const id of ids) {
    assert(/^[a-f0-9]{64}$/.test(id));
    const matching = records.filter((record) => record.Id === id);
    assert.equal(
      matching.length,
      1,
      "stopped_native_container_missing_or_duplicate",
    );
    const record = matching[0]!;
    assert.equal(record.HostConfig.RestartPolicy.Name, "no");
    assert(
      record.State.Status === "exited" &&
        !record.State.Running &&
        record.State.Pid === 0 &&
        !record.State.Restarting &&
        !record.State.Paused &&
        !record.State.Dead,
      "native_sandbox_not_cleanly_stopped",
    );
  }
}

/** The explicit operator target is exactly this sandbox's published API binding. */
export function assertSelfHostedResumeOrigin(
  environment: string,
  origin: string,
): void {
  const bindings = environment
    .split("\n")
    .filter((line) => line.startsWith("REVIEW_ROUTER_API_BIND="));
  assert(bindings.length === 1, "sandbox_api_binding_missing_or_duplicate");
  const binding = bindings[0]!.slice("REVIEW_ROUTER_API_BIND=".length);
  assert(
    /^127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(binding),
    "sandbox_api_binding_not_loopback",
  );
  const url = new URL(origin);
  assert(
    url.origin === `http://${binding}` &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "resume_origin_differs_from_owned_sandbox_api",
  );
}

/** Exercise the normal explicit recovery while the real Compose API stays live. */
export async function resumeSelfHostedMemory(
  envFile: string,
  directory: string,
  apiOrigin: string,
  assertApiStillRunning: () => Promise<void>,
  options: Pick<SelfHostedE2EOptions, "configuredApiOrigin"> = {},
) {
  const environment = await readFile(envFile, "utf8");
  assertSelfHostedResumeOrigin(environment, apiOrigin);
  const configuredOrigin = options.configuredApiOrigin;
  if (configuredOrigin !== undefined) {
    assertSelfHostedConfiguredResumeOrigin(environment, configuredOrigin);
    const response = await fetch(new URL("/health", configuredOrigin), {
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    assert(response.status === 200, "configured_sandbox_api_health_status");
    const health = (await response.json()) as {
      service?: unknown;
      status?: unknown;
    };
    assert(
      health?.service === "review-router-api" && health.status === "ok",
      "configured_sandbox_api_health_payload",
    );
    await assertApiStillRunning();
  }
  const operator = join(directory, "memory-operator");
  const paths = [
    envFile,
    ...[
      "bootstrap.json",
      "bootstrap-state.json",
      "router.env",
      "inference.env",
    ].map((name) => join(operator, name)),
  ];
  const before = await Promise.all(
    paths.map(async (path) => sha(await readFile(path, "utf8"))),
  );
  const original = await withSandboxAuthority(
    directory,
    async ({ config, state, lock, inventory, census }) => {
      inventory.inspect(await census(), "initial");
      await lock.assertHeld();
      await dockerCommand([
        "stop",
        "--time",
        "10",
        state.containers.worker,
        state.containers.api,
      ]);
      inventory.inspect(await census(), "stopped");
      await lock.assertHeld();
      await dockerCommand(["stop", "--time", "10", state.containers.postgres]);
      assertStoppedSelfHostedMemory(await census(), state.containers);
      await assertApiStillRunning();
      return { state, config };
    },
  );
  // The stop owner releases the lock before the normal resume owner acquires it.
  // Any failed/ambiguous resume is preserved by the outer acceptance runner.
  // Default CI uses the explicit owned loopback interface. Configured acceptance
  // instead exercises the normal setup owner reading its real saved HTTPS URL.
  const resumed = (
    configuredOrigin === undefined
      ? await bootstrap("resume", original.config, apiOrigin)
      : await resumeMemory(envFile, operator)
  ) as {
    phase?: string;
    resumed?: boolean;
  };
  assert.equal(resumed.phase, "running");
  assert.equal(resumed.resumed, true);
  await withSandboxAuthority(
    directory,
    async ({ state, inventory, census }) => {
      assert.deepEqual(state, original.state);
      inventory.inspect(await census(), "initial");
    },
  );
  await assertApiStillRunning();
  const after = await Promise.all(
    paths.map(async (path) => sha(await readFile(path, "utf8"))),
  );
  assert.deepEqual(after, before, "resume_changed_saved_installation_bindings");
  const receipt = {
    status: "selfhost_native_explicit_resume_passed",
    operator:
      configuredOrigin === undefined
        ? "bootstrap resume"
        : "setup-memory resume",
    setupResumeUrlDerivationExercised: configuredOrigin !== undefined,
    sameContainerIds: true,
    sameSavedBindings: true,
    composeApiStayedRunning: true,
    beforeFirstSaveOrForget: true,
  };
  await writeFile(
    join(directory, "memory-resume-result.json"),
    JSON.stringify(receipt) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  return receipt;
}

type CleanupPhase =
  | "authority"
  | "census"
  | "mounts"
  | "inventory_initial"
  | "volumes"
  | "compose_stop"
  | "native_stop"
  | "inventory_stopped"
  | "postgres_stop"
  | "remove"
  | "absence"
  | "receipt";
type CleanupCode = "guard_refused" | "artifact_missing" | "operation_failed";
class NativeSandboxCleanupError extends Error {
  readonly phase: CleanupPhase;
  readonly code: CleanupCode;
  constructor(phase: CleanupPhase, error: unknown) {
    super("selfhost_native_cleanup_refused");
    this.phase = phase;
    this.code =
      error instanceof assert.AssertionError
        ? "guard_refused"
        : "operation_failed";
    try {
      if (
        error instanceof Error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        this.code = "artifact_missing";
    } catch {
      /* Diagnostic getters never replace the original refusal. */
    }
  }
}

/** Closed metadata only; never serialize an assertion, Docker stderr or env value. */
export function selfHostedCleanupDiagnostic(error: unknown) {
  return error instanceof NativeSandboxCleanupError
    ? { phase: error.phase, code: error.code }
    : { phase: "unclassified" as const, code: "operation_failed" as const };
}

type SandboxAuthority = {
  operator: string;
  config: ReturnType<typeof validateConfig>;
  state: State;
  postgresImageId: string;
  ids: string[];
  lock: Awaited<ReturnType<typeof acquireDeploymentLock>>;
  inventory: CleanupHostInventory;
  census: () => Promise<Inspection[]>;
};

/** Shared exact ownership checks before any sandbox lifecycle effect. */
async function withSandboxAuthority<T>(
  directory: string,
  operation: (authority: SandboxAuthority) => Promise<T>,
  observeCensus?: (phase: "census" | "mounts") => void,
): Promise<T> {
  assert(basename(directory).startsWith("reviewrouter-self-hosted-e2e-"));
  const operator = join(directory, "memory-operator");
  assert.equal(
    await readFile(join(operator, "setup-binding.json"), "utf8"),
    join(directory, "self-hosted.env"),
  );
  const metadata = await lstat(operator);
  assert(
    metadata.isDirectory() &&
      metadata.uid === process.getuid?.() &&
      !(metadata.mode & 0o077),
  );
  const config = validateConfig(
    JSON.parse(await readFile(join(operator, "bootstrap.json"), "utf8")),
  );
  assert.equal(config.directory, resolve(operator));
  assert.equal(config.modelDirectory, join(operator, "models"));
  assert.equal(config.generation, "selfhost-e2e");
  assert(/^selfhost_[a-f0-9]{16}$/.test(config.namespace));
  const state = JSON.parse(
    await readFile(join(operator, "bootstrap-state.json"), "utf8"),
  ) as State;
  const ids = Object.values(state.containers);
  assert(
    ids.length === 3 &&
      new Set(ids).size === 3 &&
      ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
  );
  const lock = await acquireDeploymentLock(join(operator, "deployment.lock"));
  try {
    const validated = (await bootstrap("validate", config)) as {
      configurationDigest: string;
    };
    assert.equal(state.configurationDigest, validated.configurationDigest);
    assert.equal(state.imageId, config.image);
    const pgImage = (
      await dockerCommand([
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        config.postgresImage,
      ])
    ).trim();
    const inventory = new CleanupHostInventory({
      deploymentLabel: `${label}=${config.deployment}`,
      imageDigest: state.imageId,
      apiContainerId: state.containers.api,
      executorContainerIds: [state.containers.api, state.containers.worker],
      restartContainerIds: [],
      postgresInfrastructure: {
        containerId: state.containers.postgres,
        imageDigest: pgImage,
        port: config.postgresPort,
      },
    });
    const census = async () => {
      observeCensus?.("census");
      await lock.assertHeld();
      const all = (
        await dockerCommand(["ps", "--all", "--no-trunc", "--quiet"])
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      assert(
        all.length <= CLEANUP_HOST_CONTAINER_LIMIT &&
          new Set(all).size === all.length,
      );
      const records: Inspection[] = [];
      for (const id of all)
        records.push(
          (
            JSON.parse(await dockerCommand(["inspect", id])) as Inspection[]
          )[0]!,
        );
      observeCensus?.("mounts");
      assertSandboxMounts(records, config, state);
      return records;
    };
    return await operation({
      operator,
      config,
      state,
      postgresImageId: pgImage,
      ids,
      lock,
      inventory,
      census,
    });
  } finally {
    await lock.close();
  }
}

/** Dispose only a successfully proved, fresh test deployment, under its normal lock.
 * This is sandbox decommission, not a signed product physical-Forget receipt. */
export async function disposeSelfHostedMemory(
  directory: string,
  disposeCompose: () => void | Promise<void>,
): Promise<void> {
  let phase: CleanupPhase = "authority";
  await withSandboxAuthority(
    directory,
    async ({ config, state, ids, lock, inventory, census }) => {
      const initial = await census();
      phase = "inventory_initial";
      inventory.inspect(initial, "initial");
      phase = "volumes";
      const volumes = [
        `${config.deployment}-pg17-data`,
        `${config.deployment}-model-cache`,
      ];
      for (const name of volumes) {
        const [volume] = JSON.parse(
          await dockerCommand(["volume", "inspect", name]),
        ) as {
          Name: string;
          Labels: Record<string, string>;
          Driver: string;
          Options: unknown;
        }[];
        assert(
          volume &&
            volume.Name === name &&
            volume.Labels[label] === config.deployment &&
            volume.Driver === "local" &&
            (!volume.Options || Object.keys(volume.Options).length === 0),
        );
        const users = (
          await dockerCommand([
            "ps",
            "--all",
            "--no-trunc",
            "--quiet",
            "--filter",
            `volume=${name}`,
          ])
        )
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        assert(users.every((id) => ids.includes(id)));
      }
      // Preserve the application DB too if any native ownership check failed.
      // Qualified native writers remain fenced while the app producer is removed.
      phase = "compose_stop";
      await disposeCompose();
      phase = "native_stop";
      await lock.assertHeld();
      await dockerCommand([
        "stop",
        "--time",
        "10",
        state.containers.worker,
        state.containers.api,
      ]);
      const stopped = await census();
      phase = "inventory_stopped";
      inventory.inspect(stopped, "stopped");
      phase = "postgres_stop";
      await lock.assertHeld();
      await dockerCommand(["stop", "--time", "10", state.containers.postgres]);
      phase = "remove";
      await dockerCommand(["rm", ...ids]);
      await dockerCommand(["volume", "rm", ...volumes]);
      phase = "absence";
      assert(
        !(
          await dockerCommand([
            "ps",
            "--all",
            "--quiet",
            "--filter",
            `label=${label}=${config.deployment}`,
          ])
        ).trim(),
      );
      for (const name of volumes)
        assert(
          !(
            await dockerCommand([
              "volume",
              "ls",
              "--quiet",
              "--filter",
              `name=^${name}$`,
            ])
          ).trim(),
        );
      phase = "receipt";
      await writeFile(
        join(directory, "memory-decommission-result.json"),
        JSON.stringify({
          status: "owned_sandbox_removed",
          containerIds: ids,
          volumeNames: volumes,
          productPhysicalForgetClaimed: false,
        }) + "\n",
        { mode: 0o600, flag: "wx" },
      );
    },
    (current) => {
      phase = current;
    },
  ).catch((error: unknown) => {
    throw new NativeSandboxCleanupError(phase, error);
  });
}
