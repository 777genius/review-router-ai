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
  privateFile,
  type BootstrapConfig,
} from "../hindsight/bootstrap.ts";
import { acquireDeploymentLock } from "../../scripts/hindsight-e2e/deployment-lock.ts";
import { dockerCommand } from "../../scripts/hindsight-e2e/native-runtime.ts";
import { prepareFirstInstallInputs } from "../hindsight/first-install-inputs.ts";
import {
  readConversationQualification,
  conversationSourceProfileMatches,
} from "./conversation-verifier.mjs";
import {
  readConversationRelease,
  validateConversationEnvironmentTuple,
  conversationQualificationEnvironmentValue,
  type ConversationEnvironmentTuple,
  type ConversationReleaseResult,
} from "./conversation-release.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
type EnvironmentStatement = {
  readonly raw: string;
  readonly key?: string;
  readonly value?: string;
};
const controls = new Set([
  "REVIEW_ROUTER_MEMORY_PROVIDER",
  "REVIEW_ROUTER_MEMORY_ENABLED",
  "REVIEW_ROUTER_DISABLE_MEMORY",
]);
const conversationQualificationKey = "REVIEW_ROUTER_CONVERSATION_QUALIFICATION";
const conversationRuntimeKey = "REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA";
const conversationKeys = new Set([
  conversationQualificationKey,
  conversationRuntimeKey,
]);
/** Static Compose env_file assignments, retaining original statement bytes.
 * Quoted multiline secrets are one statement. Dynamic/escaped memory controls
 * and unsupported memory declarations fail closed rather than enabling memory. */
function environmentStatements(text: string): readonly EnvironmentStatement[] {
  const result: EnvironmentStatement[] = [];
  const pattern =
    /^[\t \uFEFF]*(?:export[\t ]+)?([A-Za-z_][\w.[\]-]*)[\t ]*[=:][\t ]*('(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|[^\r\n]*)/gm;
  const appendUnparsed = (raw: string) => {
    assert(
      !/^[\t ]*(?:export[\t ]+)?REVIEW_ROUTER_(?:MEMORY_|DISABLE_MEMORY\b)/m.test(
        raw,
      ),
      "Unsupported memory environment declaration; preserve and reconcile it",
    );
    if (raw) result.push({ raw });
  };
  let cursor = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    appendUnparsed(text.slice(cursor, match.index));
    const key = match[1]!,
      rawValue = match[2]!;
    const quoted = rawValue.startsWith("'") || rawValue.startsWith('"');
    if (quoted)
      assert(
        rawValue.length >= 2 && rawValue.at(-1) === rawValue[0],
        "Unterminated environment value; preserve and reconcile it",
      );
    const rest = text
      .slice(pattern.lastIndex)
      .match(/^[^\r\n]*(?:\r\n|\r|\n|$)/)![0];
    const memory =
      key.startsWith("REVIEW_ROUTER_MEMORY_") ||
      key === "REVIEW_ROUTER_DISABLE_MEMORY";
    assert(
      !/REVIEW_ROUTER_(?:MEMORY_|DISABLE_MEMORY\b)/.test(
        rest.replace(/^[\t ]*#.*/, ""),
      ),
      "Unsupported memory environment declaration; preserve and reconcile it",
    );
    if (memory && quoted)
      assert(
        !rest.trim() || rest.trimStart().startsWith("#"),
        "Unsupported trailing memory environment syntax",
      );
    const value = quoted
      ? rawValue.slice(1, -1)
      : rawValue.split(" #", 1)[0]!.trimEnd();
    if (controls.has(key)) {
      assert(
        !/[\\$\r\n]/.test(value),
        "Dynamic or escaped memory control requires explicit reconciliation",
      );
      assert(
        key === "REVIEW_ROUTER_MEMORY_PROVIDER"
          ? ["", "hindsight", "disabled"].includes(value.trim())
          : ["", "0", "1", "true", "false", "on", "off"].includes(
              value.trim().toLowerCase(),
            ),
        "Unrecognized memory control value; preserve and reconcile it",
      );
    }
    const end = pattern.lastIndex + rest.length;
    result.push({ raw: text.slice(match.index, end), key, value });
    cursor = end;
    pattern.lastIndex = end;
  }
  appendUnparsed(text.slice(cursor));
  return result;
}
function assignment(text: string, key: string): string {
  return (
    environmentStatements(text)
      .filter((statement) => statement.key === key)
      .at(-1)
      ?.value?.trim() ?? ""
  );
}
export function explicitlyDisabled(text: string): boolean {
  return assignment(text, "REVIEW_ROUTER_MEMORY_PROVIDER") === "disabled";
}
function memoryPaused(text: string): boolean {
  return (
    ["0", "false", "off"].includes(
      assignment(text, "REVIEW_ROUTER_MEMORY_ENABLED").toLowerCase(),
    ) ||
    ["1", "true", "on"].includes(
      assignment(text, "REVIEW_ROUTER_DISABLE_MEMORY").toLowerCase(),
    )
  );
}
function hasConversationConfiguration(
  statements: readonly EnvironmentStatement[],
) {
  return statements.some(
    (statement) =>
      conversationKeys.has(statement.key ?? "") ||
      (!statement.key &&
        /^[\t \uFEFF]*(?:export[\t ]+)?REVIEW_ROUTER_(?:CONVERSATION_QUALIFICATION|GATEWAY_INTERACTION_RUNTIME_SHA)\b/m.test(
          statement.raw,
        )),
  );
}
type ConversationSetupPlan =
  | { readonly status: "operator_opt_out" | "existing_configuration_preserved" }
  | Extract<ConversationReleaseResult, { status: "unqualified" }>
  | {
      readonly status: "unqualified";
      readonly reason:
        | "existing_configuration_requires_reconciliation"
        | "existing_configuration_source_mismatch";
    }
  | Extract<ConversationReleaseResult, { status: "available" }>;

/** Optional release consumption cannot block ordinary approved storage setup. */
export async function planConversationEnvironment(
  current: string,
  installedSourceRoot = root,
): Promise<ConversationSetupPlan> {
  if (explicitlyDisabled(current) || memoryPaused(current))
    return { status: "operator_opt_out" };
  const statements = environmentStatements(current);
  if (hasConversationConfiguration(statements)) {
    const qualifications = statements.filter(
      (statement) => statement.key === conversationQualificationKey,
    );
    const pins = statements.filter(
      (statement) => statement.key === conversationRuntimeKey,
    );
    try {
      const qualification = readConversationQualification(
        qualifications[0]?.value,
      );
      if (
        qualifications.length === 1 &&
        pins.length === 1 &&
        qualification &&
        pins[0]?.value === qualification.runtimeSha
      ) {
        if (
          qualification.profileVersion === 2 &&
          !conversationSourceProfileMatches(qualification.sourceProfile)
        )
          return {
            status: "unqualified",
            reason: "existing_configuration_source_mismatch",
          };
        return { status: "existing_configuration_preserved" };
      }
    } catch {
      /* Preserve invalid/partial operator input for explicit reconciliation. */
    }
    return {
      status: "unqualified",
      reason: "existing_configuration_requires_reconciliation",
    };
  }
  return readConversationRelease(installedSourceRoot);
}
export function mergeMemoryEnvironment(
  current: string,
  generated: string,
  conversation?: ConversationEnvironmentTuple,
): string {
  if (explicitlyDisabled(current)) return current;
  const statements = environmentStatements(current);
  const replacement = new Map(
    environmentStatements(generated).map((statement) => {
      assert(
        statement.key !== undefined && statement.value !== undefined,
        "Generated environment contains an unexpected declaration",
      );
      return [statement.key, statement.value] as const;
    }),
  );
  for (const key of replacement.keys())
    assert(
      /^REVIEW_ROUTER_MEMORY_[A-Z_]+$/.test(key),
      "Generated environment contains an unexpected key",
    );
  if (conversation) {
    validateConversationEnvironmentTuple(conversation);
    if (!memoryPaused(current) && !hasConversationConfiguration(statements)) {
      replacement.set(
        conversationQualificationKey,
        conversationQualificationEnvironmentValue(conversation.qualification),
      );
      replacement.set(
        conversationRuntimeKey,
        conversation.interactionRuntimeSha,
      );
    }
  }
  // Preserve an intentional service pause while retaining the provider for cleanup.
  if (memoryPaused(current)) replacement.delete("REVIEW_ROUTER_MEMORY_ENABLED");
  if (
    [...replacement].every(([key, value]) => {
      const matching = statements.filter((statement) => statement.key === key);
      return matching.length === 1 && matching[0]!.value === value;
    })
  )
    return current;
  const retained = statements
    .filter((statement) => !statement.key || !replacement.has(statement.key))
    .map((statement) => statement.raw)
    .join("");
  const newline = current.match(/\r\n|\r|\n/)?.[0] ?? "\n";
  const separator = retained && !/[\r\n]$/.test(retained) ? newline : "";
  return `${retained}${separator}${newline}# Private memory backend, installed by setup-memory.ts${newline}${[...replacement].map(([key, value]) => `${key}=${value}`).join(newline)}${newline}`;
}
/** Setup's shared lock serializes cooperating installers. The final compare detects
 * external edits observed before rename; arbitrary editors still need coordination. */
export async function mergeEnvironmentFile(
  path: string,
  expected: string,
  generated: string,
  conversation?: ConversationEnvironmentTuple,
): Promise<void> {
  const next = mergeMemoryEnvironment(expected, generated, conversation);
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
    const conversation = await planConversationEnvironment(original);
    await mergeEnvironmentFile(
      envFile,
      original,
      await readFile(join(directory, "router.env"), "utf8"),
      conversation.status === "available"
        ? conversation.environment
        : undefined,
    );
    return {
      status: "configured",
      envFile,
      directory,
      conversation:
        conversation.status === "available"
          ? { status: "release_capability_installed" }
          : conversation,
      nextCommand: `docker compose --env-file '${envFile.replaceAll("'", "'\\''")}' -f '${join(root, "deploy/self-hosted/compose.yml").replaceAll("'", "'\\''")}' up -d --build`,
    };
  } finally {
    await lock.close();
  }
}
/** Explicit completed-deployment recovery: never enters first-install preparation. */
export async function resumeMemory(
  envFile: string,
  directory: string,
): Promise<object> {
  const original = await privateFile(envFile);
  if (explicitlyDisabled(original))
    return { status: "explicitly_disabled", envFile };
  assert(
    (await privateFile(join(directory, "setup-binding.json"))) === envFile,
    "Setup directory belongs to a different environment",
  );
  const lock = await acquireDeploymentLock(join(directory, "setup.lock"));
  try {
    const config = validateConfig(
      JSON.parse(await privateFile(join(directory, "bootstrap.json"))),
    );
    assert(config.directory === directory, "Saved bootstrap directory differs");
    const generated = await privateFile(join(directory, "router.env"));
    for (const key of [
      "REVIEW_ROUTER_MEMORY_PROVIDER",
      "REVIEW_ROUTER_MEMORY_GENERATION",
      "REVIEW_ROUTER_MEMORY_NAMESPACE",
      "REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE",
      "REVIEW_ROUTER_MEMORY_HINDSIGHT_URL",
      "REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY",
      "REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN",
      "REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST",
    ])
      assert(
        assignment(original, key) === assignment(generated, key),
        "Self-hosted provider tuple differs from the saved backend",
      );
    const origin = assignment(original, "REVIEW_ROUTER_API_URL");
    assert(origin, "Resume requires the configured Router API URL");
    return await bootstrap("resume", config, origin);
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
      "Usage: node deploy/self-hosted/setup-memory.ts [resume] /absolute/selfhost.env [/absolute/operator-directory [/absolute/scratch-directory]]",
    );
    console.log(
      JSON.stringify(
        process.argv[2] === "resume"
          ? await resumeMemory(
              resolve(process.argv[3] ?? ""),
              resolve(
                process.argv[4] ?? "/srv/reviewrouter/hindsight-operator",
              ),
            )
          : await setupMemory(
              resolve(process.argv[2]),
              resolve(
                process.argv[3] ?? "/srv/reviewrouter/hindsight-operator",
              ),
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
