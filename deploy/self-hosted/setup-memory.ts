import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bootstrap,
  validateConfig,
  type BootstrapConfig,
} from "../hindsight/bootstrap.ts";
import { acquireDeploymentLock } from "../../scripts/hindsight-e2e/deployment-lock.ts";
import { dockerCommand } from "../../scripts/hindsight-e2e/native-runtime.ts";
import { prepareFirstInstallInputs } from "../hindsight/first-install-inputs.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function assignment(text: string, key: string): string {
  const line = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith(`${key}=`))
    .at(-1);
  return (line?.slice(key.length + 1).trim() ?? "").replace(
    /^(["'])(.*)\1$/,
    "$2",
  );
}
export function explicitlyDisabled(text: string): boolean {
  return assignment(text, "REVIEW_ROUTER_MEMORY_PROVIDER") === "disabled";
}
export function mergeMemoryEnvironment(
  current: string,
  generated: string,
): string {
  if (explicitlyDisabled(current)) return current;
  const replacement = new Map(
    generated
      .trim()
      .split("\n")
      .map((line) => [line.split("=", 1)[0]!, line]),
  );
  for (const key of replacement.keys())
    assert(
      /^REVIEW_ROUTER_MEMORY_[A-Z_]+$/.test(key),
      "Generated environment contains an unexpected key",
    );
  // Preserve an intentional service pause while retaining the provider for cleanup.
  const paused = assignment(current, "REVIEW_ROUTER_MEMORY_ENABLED");
  if (["0", "false", "off"].includes(paused.toLowerCase()))
    replacement.set(
      "REVIEW_ROUTER_MEMORY_ENABLED",
      `REVIEW_ROUTER_MEMORY_ENABLED=${paused}`,
    );
  if (
    ["1", "true", "on"].includes(
      assignment(current, "REVIEW_ROUTER_DISABLE_MEMORY").toLowerCase(),
    )
  )
    replacement.delete("REVIEW_ROUTER_MEMORY_ENABLED");
  if (
    [...replacement].every(
      ([key, value]) =>
        current
          .split(/\r?\n/)
          .filter((line) => line.startsWith(`${key}=`))
          .join("\n") === value,
    )
  )
    return current;
  const retained = current
    .split(/\r?\n/)
    .filter((line) => !replacement.has(line.split("=", 1)[0]!))
    .join("\n")
    .trimEnd();
  return `${retained}\n\n# Private memory backend, installed by setup-memory.ts\n${[...replacement.values()].join("\n")}\n`;
}
/** Setup's shared lock serializes cooperating installers. The final compare detects
 * external edits observed before rename; arbitrary editors still need coordination. */
export async function mergeEnvironmentFile(
  path: string,
  expected: string,
  generated: string,
): Promise<void> {
  const next = mergeMemoryEnvironment(expected, generated);
  if (next === expected) return;
  const original = await lstat(path);
  assert(
    original.isFile() &&
      original.uid === process.getuid?.() &&
      (original.mode & 0o077) === 0,
    "Self-hosted env must be an operator-owned mode0600 regular file",
  );
  const backup = `${path}.before-memory-${randomUUID()}`;
  await writeFile(backup, expected, { mode: 0o600, flag: "wx" });
  const temporary = `${path}.memory-${randomUUID()}`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(next);
    await file.sync();
  } finally {
    await file.close();
  }
  const now = await lstat(path);
  assert(
    now.ino === original.ino &&
      now.dev === original.dev &&
      (await readFile(path, "utf8")) === expected,
    "Self-hosted env changed during setup; preserved generated files and backup, no overwrite",
  );
  await rename(temporary, path);
  const parent = await open(dirname(path), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
async function availablePort(host: string): Promise<number> {
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(0, host, done);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  return address.port;
}

export async function setupMemory(
  envFile: string,
  directory: string,
  scratchDirectory = join(directory, "tmp"),
): Promise<object> {
  const metadata = await lstat(envFile);
  assert(
    metadata.isFile() &&
      metadata.uid === process.getuid?.() &&
      (metadata.mode & 0o077) === 0,
    "Self-hosted env must be an operator-owned mode0600 regular file",
  );
  const original = await readFile(envFile, "utf8");
  if (explicitlyDisabled(original))
    return { status: "explicitly_disabled", envFile };
  assert(
    ["", "hindsight"].includes(
      assignment(original, "REVIEW_ROUTER_MEMORY_PROVIDER"),
    ),
    "Existing explicit memory provider must be reconciled before first install",
  );
  assert(
    process.platform === "linux" && process.arch === "x64",
    "Native first-install qualification requires a Linux x64 Docker host",
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await acquireDeploymentLock(join(directory, "setup.lock"));
  try {
    const work = scratchDirectory;
    await mkdir(work, { recursive: true, mode: 0o700 });
    const scratch = await lstat(work);
    assert(
      scratch.isDirectory() &&
        scratch.uid === process.getuid?.() &&
        (scratch.mode & 0o077) === 0,
      "Scratch directory must be an operator-owned mode0700 directory",
    );
    const manifestPath = join(directory, "setup-binding.json");
    try {
      assert(
        (await readFile(manifestPath, "utf8")) === envFile,
        "Setup directory belongs to a different environment",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      assert(
        !assignment(original, "REVIEW_ROUTER_MEMORY_HINDSIGHT_URL") &&
          !assignment(original, "REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY"),
        "An existing backend requires reconciliation, not a fresh install",
      );
      await writeFile(manifestPath, envFile, { mode: 0o600, flag: "wx" });
    }
    const { qualified, models, evidencePath } = await prepareFirstInstallInputs(
      work,
      envFile,
      join(directory, "models"),
      join(directory, "qualification"),
    );
    const inferencePath = join(directory, "inference.env");
    const configPath = join(directory, "bootstrap.json");
    let config: BootstrapConfig;
    try {
      config = validateConfig(JSON.parse(await readFile(configPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const gateway = (
        await dockerCommand([
          "network",
          "inspect",
          "bridge",
          "--format",
          "{{(index .IPAM.Config 0).Gateway}}",
        ])
      ).trim();
      const apiPort = await availablePort(gateway),
        postgresPort = await availablePort("127.0.0.1"),
        workerPort = await availablePort("127.0.0.1");
      config = validateConfig({
        deployment: `rr-memory-${createHash("sha256").update(envFile).digest("hex").slice(0, 8)}`,
        directory,
        image: qualified.imageId,
        postgresImage: qualified.postgresImage,
        qualificationEvidence: evidencePath,
        inferenceEnvFile: inferencePath,
        namespace:
          assignment(original, "REVIEW_ROUTER_MEMORY_NAMESPACE") ||
          "reviewrouter",
        generation:
          assignment(original, "REVIEW_ROUTER_MEMORY_GENERATION") ||
          "memory-v1",
        apiBindHost: gateway,
        apiPort,
        postgresPort,
        workerPort,
        modelDirectory: models,
      });
      await writeFile(
        inferencePath,
        "HINDSIGHT_API_LLM_PROVIDER=none\nHINDSIGHT_API_EMBEDDINGS_PROVIDER=local\nHINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=/models/embedding\nHINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU=true\nHINDSIGHT_API_EMBEDDINGS_LOCAL_TRUST_REMOTE_CODE=false\nHINDSIGHT_API_RERANKER_PROVIDER=local\nHINDSIGHT_API_RERANKER_LOCAL_MODEL=/models/reranker\nHINDSIGHT_API_RERANKER_LOCAL_FORCE_CPU=true\nHINDSIGHT_API_RERANKER_LOCAL_TRUST_REMOTE_CODE=false\n",
        { mode: 0o600, flag: "wx" },
      );
      await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    }
    await bootstrap("apply", config);
    await mergeEnvironmentFile(
      envFile,
      original,
      await readFile(join(directory, "router.env"), "utf8"),
    );
    return {
      status: "configured",
      envFile,
      directory,
      nextCommand: `docker compose --env-file '${envFile.replaceAll("'", "'\\''")}' -f '${join(root, "deploy/self-hosted/compose.yml").replaceAll("'", "'\\''")}' up -d --build`,
    };
  } finally {
    await lock.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert(
      process.argv[2],
      "Usage: node deploy/self-hosted/setup-memory.ts /absolute/selfhost.env [/absolute/operator-directory [/absolute/scratch-directory]]",
    );
    console.log(
      JSON.stringify(
        await setupMemory(
          resolve(process.argv[2]),
          resolve(process.argv[3] ?? "/srv/reviewrouter/hindsight-operator"),
          process.argv[4] ? resolve(process.argv[4]) : undefined,
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof assert.AssertionError
        ? error.message
        : "Memory setup failed; inspect the retained private setup.log and state before retrying.",
    );
    process.exitCode = 1;
  }
}
