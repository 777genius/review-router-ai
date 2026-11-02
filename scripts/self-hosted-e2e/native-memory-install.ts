import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConversationRelease } from "../../deploy/self-hosted/conversation-release.ts";
import {
  resumeMemory,
  setupMemory,
} from "../../deploy/self-hosted/setup-memory.ts";
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
) {
  assertSelfHostedResumeOrigin(await readFile(envFile, "utf8"), apiOrigin);
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
  // Readiness uses synthetic public callback origins; this existing operator
  // interface explicitly targets the real sandbox API without DNS overrides.
  const resumed = (await bootstrap("resume", original.config, apiOrigin)) as {
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
    operator: "bootstrap resume",
    setupResumeUrlDerivationExercised: false,
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

type SandboxAuthority = {
  operator: string;
  config: ReturnType<typeof validateConfig>;
  state: State;
  ids: string[];
  lock: Awaited<ReturnType<typeof acquireDeploymentLock>>;
  inventory: CleanupHostInventory;
  census: () => Promise<Inspection[]>;
};

/** Shared exact ownership checks before any sandbox lifecycle effect. */
async function withSandboxAuthority<T>(
  directory: string,
  operation: (authority: SandboxAuthority) => Promise<T>,
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
      assertSandboxMounts(records, config, state);
      return records;
    };
    return await operation({
      operator,
      config,
      state,
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
  await withSandboxAuthority(
    directory,
    async ({ config, state, ids, lock, inventory, census }) => {
      inventory.inspect(await census(), "initial");
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
      await disposeCompose();
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
      await dockerCommand(["rm", ...ids]);
      await dockerCommand(["volume", "rm", ...volumes]);
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
  );
}
