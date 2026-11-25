import assert from "node:assert/strict";
import { isIP } from "node:net";
import { isAbsolute, posix } from "node:path";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DockerExecutorInspection } from "./operator-host.ts";

export interface InspectedCleanupMount {
  readonly Type: string;
  readonly Source: string;
  readonly Destination: string;
  readonly RW: boolean;
  readonly Name?: string;
}
export type CleanupExecutorInspection = DockerExecutorInspection & {
  readonly Mounts?: readonly InspectedCleanupMount[];
};
const modelEnvironmentKeys = new Set([
  "HF_HOME",
  "SENTENCE_TRANSFORMERS_HOME",
  "HF_HUB_OFFLINE",
  "TRANSFORMERS_OFFLINE",
  "HF_HUB_DISABLE_TELEMETRY",
  "DO_NOT_TRACK",
]);
export function inspectedCleanupEnvironment(
  record: CleanupExecutorInspection,
): Record<string, string> {
  return Object.fromEntries(
    record.Config.Env.map((setting) => {
      const equal = setting.indexOf("=");
      return [setting.slice(0, equal), setting.slice(equal + 1)];
    }).filter(
      ([key]) =>
        key!.startsWith("HINDSIGHT_API_") || modelEnvironmentKeys.has(key!),
    ),
  );
}
const within = (path: string, directory: string) =>
  path === directory || path.startsWith(`${directory}/`);
const absoluteMountPath = (path: string) =>
  isAbsolute(path) &&
  posix.normalize(path) === path &&
  path !== "/" &&
  !/[,\r\n\0]/.test(path);

export async function writeCleanupEnvironmentFile(
  directory: string,
  name: string,
  environment: Readonly<Record<string, string>>,
): Promise<string> {
  assert(/^[a-z-]+\.env$/.test(name));
  const values = Object.entries(environment)
    .map(([key, value]) => {
      assert(
        /^[A-Z][A-Z0-9_]+$/.test(key) && !/[\r\n\0]/.test(value),
        "Cleanup environment cannot be represented safely",
      );
      return `${key}=${value}\n`;
    })
    .join("");
  const file = join(directory, name);
  await writeFile(file, values, { mode: 0o600, flag: "wx" });
  return file;
}

/** Clone only the inspected read-only local models and their private named cache. */
export function inspectedCleanupMountArguments(
  record: CleanupExecutorInspection,
): string[] {
  const env = inspectedCleanupEnvironment(record);
  const models = ["EMBEDDINGS", "RERANKER"].flatMap((family) => {
    if (env[`HINDSIGHT_API_${family}_PROVIDER`] !== "local") return [];
    const model = env[`HINDSIGHT_API_${family}_LOCAL_MODEL`];
    assert(
      model && absoluteMountPath(model),
      "Local cleanup models must use inspected absolute snapshot paths",
    );
    return [model];
  });
  const caches = [env.HF_HOME, env.SENTENCE_TRANSFORMERS_HOME].filter(
    (value): value is string => Boolean(value),
  );
  assert(
    caches.every(absoluteMountPath),
    "Cleanup model caches require absolute inspected paths",
  );
  const mounts = record.Mounts ?? [];
  assert(mounts.length <= 8, "Cleanup runtime mount profile is unsupported");
  const args: string[] = [];
  const coveredModels = new Set<string>();
  const coveredCaches = new Set<string>();
  for (const mount of mounts) {
    assert(
      absoluteMountPath(mount.Destination),
      "Cleanup mount destination is unsupported",
    );
    if (mount.Type === "bind") {
      const selected = models.filter((model) =>
        within(model, mount.Destination),
      );
      assert(
        !mount.RW && absoluteMountPath(mount.Source) && selected.length > 0,
        "Cleanup supports only inspected read-only model bind mounts",
      );
      for (const model of selected) coveredModels.add(model);
      args.push(
        "--mount",
        `type=bind,src=${mount.Source},dst=${mount.Destination},readonly`,
      );
    } else {
      const selected = caches.filter((cache) =>
        within(cache, mount.Destination),
      );
      assert(
        mount.Type === "volume" &&
          mount.Name &&
          /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(mount.Name) &&
          selected.length > 0,
        "Cleanup supports only the inspected named model-cache volume",
      );
      for (const cache of selected) coveredCaches.add(cache);
      args.push(
        "--mount",
        `type=volume,src=${mount.Name},dst=${mount.Destination}${mount.RW ? "" : ",readonly"}`,
      );
    }
  }
  assert(
    models.every((model) => coveredModels.has(model)),
    "Cleanup local model snapshot is not mounted read-only",
  );
  assert(
    caches.every((cache) => coveredCaches.has(cache)),
    "Cleanup model cache mount is missing",
  );
  return args;
}
function privateHost(host: string): boolean {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}
/** Readiness follows the inspected executor's actual bind, never a plan endpoint. */
export function inspectedExecutorHealthBase(
  record: CleanupExecutorInspection,
): string {
  const env = inspectedCleanupEnvironment(record);
  const worker =
    record.Config.Labels["io.reviewrouter.hindsight.role"] === "worker";
  const argument = (name: string): string | undefined => {
    const position = record.Config.Cmd.indexOf(name);
    return position >= 0 ? record.Config.Cmd[position + 1] : undefined;
  };
  const host = worker
    ? (argument("--http-host") ?? env.HINDSIGHT_API_WORKER_HTTP_HOST)
    : env.HINDSIGHT_API_HOST;
  const rawPort = worker
    ? (argument("--http-port") ?? env.HINDSIGHT_API_WORKER_HTTP_PORT)
    : env.HINDSIGHT_API_PORT;
  const port = Number(rawPort);
  assert(
    host &&
      privateHost(host) &&
      rawPort &&
      /^\d+$/.test(rawPort) &&
      Number.isInteger(port) &&
      port >= 1024 &&
      port <= 65535,
    "Cleanup readiness requires an inspected explicit private IPv4 bind and port",
  );
  return `http://${host}:${port}`;
}
