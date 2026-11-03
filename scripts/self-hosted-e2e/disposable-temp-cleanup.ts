import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

export type DisposableTempDirectory = Readonly<{ path: string }>;
type Identity = { dev: string; ino: string; uid: string; mode: string };
type Root = Identity & {
  path: string;
  fd: number;
  state: "fresh" | "cleaning" | "retained" | "removed";
  imageId?: string;
  readOnlyCanonicalizationUsed?: boolean;
};
type Phase =
  | "identity"
  | "image_capture"
  | "container_inventory"
  | "mount_inventory"
  | "host_remove"
  | "helper_create"
  | "helper_profile"
  | "helper_start"
  | "helper_remove"
  | "host_empty_remove"
  | "absence";
type SafeCause = {
  errno: string;
  pathRelation: "root" | "descendant" | "outside" | "unknown";
};
type Diagnostic = SafeCause & {
  phase: Phase | "unknown";
  reason?: string;
  firstHostFailure?: SafeCause;
  ownedHelper?: { name: string; imageId: string; containerId?: string };
};
const roots = new WeakMap<DisposableTempDirectory, Root>();
const errnos = new Set([
  "EACCES",
  "EPERM",
  "EBUSY",
  "ENOTEMPTY",
  "EAGAIN",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "EIO",
  "ETIMEDOUT",
  "ENOBUFS",
  "E2BIG",
]);
class CleanupRefusal extends Error {
  readonly diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    super("disposable_temp_cleanup_refused");
    this.diagnostic = diagnostic;
  }
}
export function disposableTempCleanupDiagnostic(error: unknown): Diagnostic {
  return error instanceof CleanupRefusal
    ? error.diagnostic
    : { phase: "unknown", errno: "UNKNOWN", pathRelation: "unknown" };
}
function refusal(
  phase: Phase,
  reason: string,
  error?: unknown,
  root?: string,
): never {
  const details = error as { code?: unknown; path?: unknown } | undefined;
  let pathRelation: Diagnostic["pathRelation"] = "unknown";
  if (root && typeof details?.path === "string")
    pathRelation =
      details.path === root
        ? "root"
        : within(root, details.path)
          ? "descendant"
          : "outside";
  throw new CleanupRefusal({
    phase,
    reason,
    errno:
      typeof details?.code === "string" && errnos.has(details.code)
        ? details.code
        : "UNKNOWN",
    pathRelation,
  });
}
const within = (parent: string, child: string) => {
  const part = relative(parent, child);
  return (
    part === "" ||
    (part !== ".." && !part.startsWith("../") && !isAbsolute(part))
  );
};
const identity = (stat: import("node:fs").BigIntStats): Identity => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  uid: String(stat.uid),
  mode: String(Number(stat.mode) & 0o777),
});
function same(a: Identity, b: Identity) {
  return (
    a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode
  );
}
function owned(handle: DisposableTempDirectory): Root {
  const root = roots.get(handle);
  if (!root || root.state === "retained" || root.state === "removed")
    refusal("identity", "fresh_process_provenance_required");
  try {
    const stat = lstatSync(root.path, { bigint: true });
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      realpathSync(root.path) !== root.path ||
      !same(identity(stat), root) ||
      !same(identity(fstatSync(root.fd, { bigint: true })), root)
    )
      refusal("identity", "root_identity_changed");
  } catch (error) {
    if (error instanceof CleanupRefusal) throw error;
    refusal("identity", "root_identity_unavailable", error, root.path);
  }
  return root;
}
/** Only this process's fresh creation establishes deletion authority; arbitrary existing paths cannot be adopted. */
export function createDisposableTempDirectory(
  parent = tmpdir(),
): DisposableTempDirectory {
  const path = mkdtempSync(
    join(realpathSync(parent), "reviewrouter-self-hosted-e2e-"),
  );
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const stat = fstatSync(fd, { bigint: true });
  if (
    !stat.isDirectory() ||
    stat.uid !== BigInt(process.getuid?.() ?? -1) ||
    (stat.mode & 0o777n) !== 0o700n
  ) {
    closeSync(fd);
    refusal("identity", "fresh_root_owner_or_mode");
  }
  const handle = Object.freeze({ path });
  roots.set(handle, { ...identity(stat), path, fd, state: "fresh" });
  return handle;
}
function docker(args: string[], phase: Phase, timeout = 15_000) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    // A complete retained-container Mounts-only census can exceed4MiB even
    // within the1024-container bound; no Env or payload data is requested.
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0)
    refusal(
      phase,
      result.error || result.signal || result.status === null
        ? "docker_outcome_unknown"
        : "docker_command_refused",
      result.error,
    );
  return result.stdout.trim();
}
function jsonDocker(args: string[], phase: Phase): unknown {
  try {
    return JSON.parse(docker(args, phase));
  } catch (error) {
    if (error instanceof CleanupRefusal) throw error;
    refusal(phase, "docker_metadata_invalid");
  }
}
/** Captured from the already-built, running Compose API before its normal decommission. Never resolves a mutable tag or pulls an image. */
export function captureDisposableTempCleanupImage(
  handle: DisposableTempDirectory,
  apiId: string,
  project: string,
): void {
  const root = owned(handle);
  if (root.state !== "fresh" || root.imageId)
    refusal("image_capture", "image_already_captured_or_cleanup_started");
  if (!/^[a-f0-9]{64}$/.test(apiId) || !/^[a-z0-9][a-z0-9_-]+$/.test(project))
    refusal("image_capture", "live_api_selector_invalid");
  const value = jsonDocker(
    [
      "container",
      "inspect",
      "--format",
      '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}',
      apiId,
    ],
    "image_capture",
  ) as Record<string, unknown>;
  if (
    value.id !== apiId ||
    value.running !== true ||
    value.project !== project ||
    value.service !== "api" ||
    typeof value.image !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(value.image)
  )
    refusal("image_capture", "live_api_provenance_mismatch");
  const actual = docker(
    ["image", "inspect", "--format", "{{.Id}}", value.image],
    "image_capture",
  );
  if (actual !== value.image)
    refusal("image_capture", "immutable_image_mismatch");
  root.imageId = actual;
}
export type DisposableMountConsumer = {
  id: string;
  state?: unknown;
  mounts: readonly { Source?: string; Type?: string }[];
};
/** Only explicit physically inactive states can skip canonical alias proof.
 * All retained records still receive lexical overlap checks. */
export function isInactiveDisposableState(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    Object.keys(state).sort().join(",") ===
      "Dead,Paused,Pid,Restarting,Running,Status" &&
    (state.Status === "created" || state.Status === "exited") &&
    state.Running === false &&
    state.Paused === false &&
    state.Restarting === false &&
    state.Dead === false &&
    state.Pid === 0
  );
}
/** Retained inactive records are never dropped: known lexical overlaps refuse. */
export function assertDisposableTempMountIsolation(
  path: string,
  consumers: readonly DisposableMountConsumer[],
  mountInfo: string,
  exceptId?: string,
): void {
  for (const consumer of consumers) {
    if (consumer.id === exceptId) continue;
    for (const mount of consumer.mounts) {
      if (mount.Type === "tmpfs") continue;
      if (typeof mount.Source !== "string" || !isAbsolute(mount.Source))
        refusal("container_inventory", "mount_source_unavailable");
      const source = resolve(mount.Source);
      if (within(path, source) || within(source, path))
        refusal("container_inventory", "container_mount_overlaps_root");
    }
  }
  for (const line of mountInfo.trim().split("\n")) {
    const fields = line.split(" ");
    if (fields.length < 7 || !fields.includes("-"))
      refusal("mount_inventory", "mount_inventory_invalid");
    const mount = fields[4]!.replace(/\\([0-7]{3})/g, (_raw, octal: string) =>
      String.fromCharCode(parseInt(octal, 8)),
    );
    if (!isAbsolute(mount)) refusal("mount_inventory", "mount_point_invalid");
    if (within(path, resolve(mount)))
      refusal("mount_inventory", "nested_host_mount");
  }
}
/** Exact vector protocol from the fixed realpath executable; partial/missing
 * outputs are never treated as canonical proof for an unresolved source. */
export function parseDisposableCanonicalSources(
  output: string,
  expectedCount: number,
): string[] {
  const paths = output.split("\0");
  if (
    !Number.isInteger(expectedCount) ||
    expectedCount < 1 ||
    expectedCount > 64 ||
    paths.pop() !== "" ||
    paths.length !== expectedCount ||
    paths.some((path) => !isAbsolute(path) || resolve(path) !== path)
  )
    refusal("container_inventory", "readonly_metadata_protocol_invalid");
  return paths;
}
/** Fixed metadata-only tools; no shell or privileged write is accepted. */
function canonicalBindSources(
  root: Root,
  sources: readonly string[],
  deadline: number,
): Map<string, string> {
  const canonical = new Map<string, string>();
  const inaccessible: string[] = [];
  for (const source of sources) {
    if (Date.now() >= deadline)
      refusal("container_inventory", "census_budget_exhausted");
    if (!isAbsolute(source))
      refusal("container_inventory", "bind_source_not_absolute");
    try {
      canonical.set(source, realpathSync(source));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EACCES" && code !== "EPERM")
        refusal(
          "container_inventory",
          "bind_source_canonicalization_unavailable",
          error,
          root.path,
        );
      inaccessible.push(source);
    }
  }
  if (!inaccessible.length) return canonical;
  for (const binary of ["/usr/bin/sudo", "/usr/bin/realpath"]) {
    const parts = binary.split("/").filter(Boolean);
    for (let i = 0; i <= parts.length; i++) {
      const part = "/" + parts.slice(0, i).join("/");
      let stat;
      try {
        stat = lstatSync(part, { bigint: true });
      } catch {
        refusal("container_inventory", "readonly_metadata_tool_unavailable");
      }
      if (
        stat.isSymbolicLink() ||
        stat.uid !== 0n ||
        (stat.mode & 0o022n) !== 0n ||
        (i === parts.length
          ? !stat.isFile() || (stat.mode & 0o111n) === 0n
          : !stat.isDirectory())
      )
        refusal("container_inventory", "readonly_metadata_tool_untrusted");
    }
  }
  const read = (batch: readonly string[]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      refusal("container_inventory", "census_budget_exhausted");
    root.readOnlyCanonicalizationUsed = true;
    const result = spawnSync(
      "/usr/bin/sudo",
      [
        "-n",
        "/usr/bin/realpath",
        "--canonicalize-existing",
        "--zero",
        "--",
        ...batch,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: Math.min(2000, remaining),
        maxBuffer: 512 * 1024,
      },
    );
    if (
      result.error ||
      result.signal ||
      result.status !== 0 ||
      Date.now() >= deadline
    )
      refusal(
        "container_inventory",
        "readonly_metadata_canonicalization_unavailable",
        result.error,
        root.path,
      );
    const paths = parseDisposableCanonicalSources(result.stdout, batch.length);
    for (let i = 0; i < batch.length; i++) canonical.set(batch[i]!, paths[i]!);
  };
  let batch: string[] = [];
  let bytes = 0;
  for (const source of inaccessible) {
    const size = Buffer.byteLength(source) + 1;
    if (size > 64 * 1024)
      refusal("container_inventory", "readonly_metadata_argv_budget");
    if (batch.length && (batch.length === 64 || bytes + size > 64 * 1024)) {
      read(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(source);
    bytes += size;
  }
  if (batch.length) read(batch);
  return canonical;
}
function isolation(root: Root, exceptId?: string) {
  const deadline = Date.now() + 30_000;
  const raw = docker(
    ["ps", "--all", "--no-trunc", "--quiet"],
    "container_inventory",
  );
  const ids = raw ? raw.split(/\s+/) : [];
  if (
    ids.length > 1024 ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !/^[a-f0-9]{64}$/.test(id))
  )
    refusal("container_inventory", "complete_census_unavailable");
  const consumers: DisposableMountConsumer[] = [];
  if (ids.length) {
    const lines = docker(
      [
        "container",
        "inspect",
        "--format",
        '{"id":{{json .Id}},"mounts":{{json .Mounts}},"state":{"Status":{{json .State.Status}},"Running":{{json .State.Running}},"Paused":{{json .State.Paused}},"Restarting":{{json .State.Restarting}},"Dead":{{json .State.Dead}},"Pid":{{json .State.Pid}}}}',
        ...ids,
      ],
      "container_inventory",
    ).split("\n");
    if (lines.length !== ids.length)
      refusal("container_inventory", "census_changed");
    for (let i = 0; i < lines.length; i++) {
      let record: DisposableMountConsumer;
      try {
        record = JSON.parse(lines[i]!);
      } catch {
        refusal("container_inventory", "census_invalid");
      }
      if (record.id !== ids[i] || !Array.isArray(record.mounts))
        refusal("container_inventory", "census_identity_mismatch");
      consumers.push(record);
    }
  }
  // Cache identical aliases within this one complete capture, including sources
  // shared by many retained containers. No cross-capture proof is reused.
  const sources = [
    ...new Set(
      consumers
        .filter((record) => !isInactiveDisposableState(record.state))
        .flatMap((record) =>
          record.mounts
            .filter((mount) => mount.Type === "bind")
            .map((mount) => {
              if (typeof mount.Source !== "string")
                refusal("container_inventory", "mount_source_unavailable");
              return mount.Source;
            }),
        ),
    ),
  ];
  const canonicalSources = canonicalBindSources(root, sources, deadline);
  for (const record of consumers)
    for (const mount of record.mounts) {
      if (mount.Type === "bind" && !isInactiveDisposableState(record.state))
        mount.Source = canonicalSources.get(mount.Source!)!;
    }
  let mounts: string;
  try {
    mounts = readFileSync("/proc/self/mountinfo", "utf8");
  } catch {
    refusal("mount_inventory", "host_mount_inventory_unavailable");
  }
  assertDisposableTempMountIsolation(root.path, consumers, mounts, exceptId);
}
/** Serialized only after type stripping/compilation. Builtins only; the helper has one host bind and no writable container root or network. */
function removeChildrenInContainer(expected: Identity & { nonce: string }) {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const root = "/owned";
  const check = () => {
    const s = fs.lstatSync(root, { bigint: true });
    if (
      !s.isDirectory() ||
      s.isSymbolicLink() ||
      fs.realpathSync(root) !== root ||
      String(s.dev) !== expected.dev ||
      String(s.ino) !== expected.ino ||
      String(s.uid) !== expected.uid ||
      String(Number(s.mode) & 0o777) !== expected.mode
    )
      throw Object.assign(new Error(), { code: "ESTALE" });
  };
  const remove = (entry: string) => {
    const s = fs.lstatSync(entry, { bigint: true });
    if (String(s.dev) !== expected.dev)
      throw Object.assign(new Error(), { code: "EXDEV" });
    if (s.isDirectory() && !s.isSymbolicLink()) {
      for (const name of fs.readdirSync(entry)) remove(path.join(entry, name));
      fs.rmdirSync(entry);
    } else fs.unlinkSync(entry);
  };
  try {
    check();
    for (const name of fs.readdirSync(root)) {
      check();
      remove(path.join(root, name));
    }
    check();
    console.log(
      JSON.stringify({
        status: "children_removed",
        ...expected,
      }),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.error(
      JSON.stringify({
        status: "refused",
        phase: "owned_children",
        errno: [
          "EACCES",
          "EPERM",
          "EXDEV",
          "ESTALE",
          "EBUSY",
          "ENOTEMPTY",
        ].includes(code ?? "")
          ? code
          : "UNKNOWN",
      }),
    );
    process.exitCode = 1;
  }
}
function verifyHelper(root: Root, id: string, name: string) {
  const r = jsonDocker(
    [
      "container",
      "inspect",
      "--format",
      '{"id":{{json .Id}},"image":{{json .Image}},"name":{{json .Name}},"mounts":{{json .Mounts}},"host":{"NetworkMode":{{json .HostConfig.NetworkMode}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"Privileged":{{json .HostConfig.Privileged}},"CapDrop":{{json .HostConfig.CapDrop}},"CapAdd":{{json .HostConfig.CapAdd}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"Mounts":{{json .HostConfig.Mounts}},"RestartPolicy":{{json .HostConfig.RestartPolicy}}},"entrypoint":{{json .Config.Entrypoint}},"health":{{json .Config.Healthcheck}},"user":{{json .Config.User}},"labels":{{json .Config.Labels}},"state":{"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"Status":{{json .State.Status}},"Pid":{{json .State.Pid}}}}',
      id,
    ],
    "helper_profile",
  ) as {
    id: string;
    image: string;
    name: string;
    mounts: {
      Type: string;
      Source: string;
      Destination: string;
      RW: boolean;
    }[];
    host: {
      NetworkMode: string;
      ReadonlyRootfs: boolean;
      Privileged: boolean;
      CapDrop: string[];
      CapAdd: string[];
      SecurityOpt: string[];
      Mounts: { BindOptions?: { NonRecursive?: boolean } }[];
      RestartPolicy: { Name: string };
    };
    entrypoint: string[];
    health?: { Test?: string[] };
    user: string;
    labels: Record<string, string>;
    state: { Running: boolean; ExitCode: number; Status: string; Pid: number };
  };
  if (
    r.id !== id ||
    r.image !== root.imageId ||
    r.name !== `/${name}` ||
    r.labels["io.reviewrouter.disposable-temp-cleanup"] !== name ||
    r.user !== "0:0" ||
    JSON.stringify(r.entrypoint) !== '["node"]' ||
    JSON.stringify(r.health?.Test) !== '["NONE"]' ||
    r.host.NetworkMode !== "none" ||
    r.host.ReadonlyRootfs !== true ||
    r.host.Privileged !== false ||
    JSON.stringify(r.host.CapDrop) !== '["ALL"]' ||
    r.host.CapAdd.map((cap) => (cap.startsWith("CAP_") ? cap.slice(4) : cap))
      .sort()
      .join(",") !== "DAC_OVERRIDE,FOWNER" ||
    !r.host.SecurityOpt.includes("no-new-privileges") ||
    r.host.RestartPolicy.Name !== "no" ||
    r.mounts.length !== 1 ||
    r.mounts[0]?.Type !== "bind" ||
    r.mounts[0]?.Source !== root.path ||
    r.mounts[0]?.Destination !== "/owned" ||
    r.mounts[0]?.RW !== true ||
    r.host.Mounts.length !== 1 ||
    r.host.Mounts[0]?.BindOptions?.NonRecursive !== true
  )
    refusal("helper_profile", "isolated_helper_profile_mismatch");
  return r.state;
}
/** Called only after compose absence and native sandbox decommission were proved by the harness. */
export async function cleanupDisposableTempDirectory(
  handle: DisposableTempDirectory,
): Promise<{
  status: "removed";
  method: "host" | "isolated_root_helper";
  hostErrno?: string;
  metadataCanonicalization?: "readonly_sudo_realpath";
}> {
  const root = owned(handle);
  if (root.state !== "fresh") refusal("identity", "cleanup_already_started");
  root.state = "cleaning";
  let firstHostFailure: SafeCause | undefined;
  let ownedHelper: Diagnostic["ownedHelper"];
  try {
    let permission: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      owned(handle);
      isolation(root);
      owned(handle);
      try {
        rmSync(root.path, { recursive: true, force: false, maxRetries: 0 });
        permission = undefined;
        break;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "EACCES" || code === "EPERM") {
          permission = error;
          const failedPath = (error as { path?: unknown }).path;
          firstHostFailure = {
            errno: code,
            pathRelation:
              typeof failedPath !== "string"
                ? "unknown"
                : failedPath === root.path
                  ? "root"
                  : within(root.path, failedPath)
                    ? "descendant"
                    : "outside",
          };
          break;
        }
        if (
          attempt < 2 &&
          ["EBUSY", "ENOTEMPTY", "EAGAIN", "EMFILE", "ENFILE"].includes(
            code ?? "",
          )
        ) {
          await pause(25);
          continue;
        }
        refusal("host_remove", "host_removal_failed", error, root.path);
      }
    }
    let method: "host" | "isolated_root_helper" = "host";
    if (permission) {
      owned(handle);
      isolation(root);
      owned(handle);
      if (!root.imageId || /[,\r\n\0]/.test(root.path))
        refusal(
          "helper_create",
          "trusted_image_or_bind_path_unavailable",
          permission,
          root.path,
        );
      const name = `rr-temp-cleanup-${randomUUID()}`;
      ownedHelper = { name, imageId: root.imageId };
      const expected = {
        dev: root.dev,
        ino: root.ino,
        uid: root.uid,
        mode: root.mode,
        nonce: randomUUID(),
      };
      const program = `(${removeChildrenInContainer.toString()})(${JSON.stringify(expected)})`;
      const id = docker(
        [
          "create",
          "--pull",
          "never",
          "--name",
          name,
          "--label",
          `io.reviewrouter.disposable-temp-cleanup=${name}`,
          "--user",
          "0:0",
          "--network",
          "none",
          "--read-only",
          "--no-healthcheck",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "DAC_OVERRIDE",
          "--cap-add",
          "FOWNER",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "32",
          "--memory",
          "128m",
          "--cpus",
          "0.5",
          "--env",
          "NODE_OPTIONS=",
          "--env",
          "NODE_PATH=",
          "--entrypoint",
          "node",
          "--mount",
          `type=bind,src=${root.path},dst=/owned,bind-recursive=disabled`,
          root.imageId,
          "-e",
          program,
        ],
        "helper_create",
      );
      if (!/^[a-f0-9]{64}$/.test(id))
        refusal("helper_create", "helper_identity_unknown");
      ownedHelper.containerId = id;
      const initialState = verifyHelper(root, id, name);
      if (
        initialState.Running ||
        initialState.Status !== "created" ||
        initialState.Pid !== 0 ||
        initialState.ExitCode !== 0
      )
        refusal("helper_profile", "helper_start_state_unknown");
      owned(handle);
      isolation(root, id);
      owned(handle);
      const output = docker(["start", "--attach", id], "helper_start", 60_000);
      let ack: Record<string, unknown>;
      try {
        ack = JSON.parse(output);
      } catch {
        refusal("helper_start", "helper_ack_unknown");
      }
      if (
        ack.status !== "children_removed" ||
        Object.entries(expected).some(([key, value]) => ack[key] !== value)
      )
        refusal("helper_start", "helper_ack_mismatch");
      const state = verifyHelper(root, id, name);
      if (
        state.Running ||
        state.Status !== "exited" ||
        state.ExitCode !== 0 ||
        state.Pid !== 0
      )
        refusal("helper_start", "helper_terminal_unproved");
      owned(handle);
      isolation(root, id);
      docker(["rm", id], "helper_remove");
      if (
        docker(
          ["ps", "--all", "--no-trunc", "--quiet", "--filter", `id=${id}`],
          "helper_remove",
        )
      )
        refusal("helper_remove", "helper_absence_unproved");
      owned(handle);
      isolation(root);
      owned(handle);
      try {
        rmdirSync(root.path);
      } catch (error) {
        refusal(
          "host_empty_remove",
          "root_not_empty_or_unavailable",
          error,
          root.path,
        );
      }
      method = "isolated_root_helper";
    }
    try {
      lstatSync(root.path);
      refusal("absence", "root_still_present");
    } catch (error) {
      if (error instanceof CleanupRefusal) throw error;
      if ((error as { code?: string }).code !== "ENOENT")
        refusal("absence", "absence_unproved", error, root.path);
    }
    root.state = "removed";
    roots.delete(handle);
    closeSync(root.fd);
    return {
      status: "removed",
      method,
      ...(permission
        ? { hostErrno: String((permission as { code?: string }).code) }
        : {}),
      ...(root.readOnlyCanonicalizationUsed
        ? { metadataCanonicalization: "readonly_sudo_realpath" as const }
        : {}),
    };
  } catch (error) {
    root.state = "retained";
    closeSync(root.fd);
    if (error instanceof CleanupRefusal)
      throw new CleanupRefusal({
        ...error.diagnostic,
        ...(firstHostFailure ? { firstHostFailure } : {}),
        ...(ownedHelper ? { ownedHelper } : {}),
      });
    refusal("host_remove", "unexpected_cleanup_failure", error, root.path);
  }
}
