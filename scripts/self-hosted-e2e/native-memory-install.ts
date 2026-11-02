import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConversationRelease } from "../../deploy/self-hosted/conversation-release.ts";
import { setupMemory } from "../../deploy/self-hosted/setup-memory.ts";
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

/** Dispose only a successfully proved, fresh test deployment, under its normal lock.
 * This is sandbox decommission, not a signed product physical-Forget receipt. */
export async function disposeSelfHostedMemory(
  directory: string,
  disposeCompose: () => void | Promise<void>,
): Promise<void> {
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
  } finally {
    await lock.close();
  }
}
