#!/usr/bin/env node
/**
 * Fleet env overlay for the four ReviewRouter app containers (web, api, worker, scan).
 *
 * Replaces each container with an identical copy (same image, mounts, networks, limits) whose only
 * difference is a reviewed set of environment updates, mirrored into the canonical runtime env files.
 * All old containers are stopped before any new one starts, old containers are kept stopped for rollback.
 *
 *   node fleet-overlay.mjs <prepare|plan|apply> <custody-dir> <spec.json>
 *
 * spec.json: { machineId, network, expectedImage, expectedRevision, names:{web,api,worker,scan},
 *              updates:[{key, op:"set"|"appendCsv"|"appendJsonArray", value, roles?:[...]}] }
 * Secrets stay on the host: output only prints key names and value hashes.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { coherentCutover, requireNoExtraScopedWorkers } from "./cutover.mjs";

const roles = ["api", "worker", "scan", "web"];
const envRoot = "/etc/platform/projects/review-router/runtime-env";
const custodyRoot = "/srv/platform/projects/review-router/releases/";
const canonicalPath = (role) =>
  `${envRoot}/runtime-${role === "scan" ? "skill-scan-worker" : role}.env`;

const need = (ok, code) => {
  if (!ok) throw new Error(code);
};
const row = (v) => {
  need(
    v !== null && typeof v === "object" && !Array.isArray(v),
    "object_required",
  );
  return v;
};
const stable = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
const hash = (v) => createHash("sha256").update(v).digest("hex");
// Docker reports an unset OomKillDisable as null on older containers and false on newly created ones.
const hostCfg = (h) => ({
  ...row(h),
  OomKillDisable: row(h).OomKillDisable ?? false,
});

function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const bytes =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        socketPath: "/var/run/docker.sock",
        path: `/v1.47${path}`,
        method,
        headers: bytes
          ? {
              "content-type": "application/json",
              "content-length": bytes.length,
            }
          : {},
      },
      (res) => {
        const parts = [];
        let size = 0;
        res.on("data", (part) => {
          size += part.length;
          if (size > 4 * 1024 * 1024)
            req.destroy(new Error("docker_response_bound"));
          else parts.push(part);
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300)
            return reject(new Error(`docker_${method}_${status}`));
          const text = Buffer.concat(parts).toString("utf8");
          try {
            resolve(text ? JSON.parse(text) : null);
          } catch {
            reject(new Error("docker_json"));
          }
        });
      },
    );
    req.setTimeout(60_000, () => req.destroy(new Error("docker_timeout")));
    req.on("error", () => reject(new Error("docker_transport")));
    req.end(bytes);
  });
}
const inspect = async (id) =>
  row(await docker("GET", `/containers/${encodeURIComponent(id)}/json`));

async function privateFile(path) {
  const s = await lstat(path);
  need(
    s.isFile() &&
      !s.isSymbolicLink() &&
      s.uid === 0 &&
      (s.mode & 0o777) === 0o600,
    "private_file_required",
  );
  return readFile(path, "utf8");
}
const privateWrite = (path, value, exclusive = false) =>
  writeFile(path, value, { mode: 0o600, flag: exclusive ? "wx" : "w" });
async function replacePrivate(path, value) {
  const temporary = `${path}.overlay-stage-${process.pid}`;
  await privateWrite(temporary, value, true);
  await rename(temporary, path);
}

function envMap(i) {
  const list = row(i.Config).Env;
  need(
    Array.isArray(list) &&
      list.every((x) => typeof x === "string" && x.includes("=")),
    "environment_shape",
  );
  const map = new Map();
  for (const entry of list) {
    const k = entry.slice(0, entry.indexOf("="));
    need(!map.has(k), "duplicate_environment");
    map.set(k, entry.slice(k.length + 1));
  }
  return map;
}

/** Pure: next value of one env entry. */
export function nextValue(current, update) {
  switch (update.op) {
    case "set":
      return update.value;
    case "appendCsv": {
      const items = current.split(",");
      return items.includes(update.value)
        ? current
        : `${current},${update.value}`;
    }
    case "appendJsonArray": {
      const rows = JSON.parse(current);
      need(Array.isArray(rows) && current.endsWith("]"), "json_array_required");
      if (rows.some((r) => stable(r) === stable(update.value))) return current;
      const added = JSON.stringify(update.value);
      return `${current.slice(0, -1)}${rows.length === 0 ? "" : ","}${added}]`;
    }
    default:
      throw new Error("unknown_update_op");
  }
}

/** Pure: env updates that apply to one role, as Map(key -> nextValue). Strict: targeted keys must exist. */
export function roleUpdates(role, env, updates) {
  const result = new Map();
  for (const update of updates) {
    if (update.roles && !update.roles.includes(role)) continue;
    need(env.has(update.key), `update_key_missing:${update.key}`);
    result.set(
      update.key,
      nextValue(result.get(update.key) ?? env.get(update.key), update),
    );
  }
  return result;
}

export function applyEnvList(list, updates) {
  return list.map((entry) => {
    const k = entry.slice(0, entry.indexOf("="));
    return updates.has(k) ? `${k}=${updates.get(k)}` : entry;
  });
}

/** Pure: replace exactly one `KEY=old` line per update; old must match the container value (CAS). */
export function applyCanonical(text, oldEnv, updates) {
  let out = text;
  for (const [key, value] of updates) {
    const lines = out.split("\n");
    const hits = lines
      .map((l, i) => (l.startsWith(`${key}=`) ? i : -1))
      .filter((i) => i >= 0);
    need(hits.length === 1, `canonical_line_count:${key}`);
    need(
      lines[hits[0]] === `${key}=${oldEnv.get(key)}`,
      `canonical_differs_from_container:${key}`,
    );
    lines[hits[0]] = `${key}=${value}`;
    out = lines.join("\n");
  }
  return out;
}

function pin(i) {
  return hash(
    stable({
      Id: i.Id,
      Name: i.Name,
      Image: i.Image,
      Config: i.Config,
      HostConfig: i.HostConfig,
      Mounts: i.Mounts,
      Networks: row(i.NetworkSettings).Networks,
      Running: row(i.State).Running,
    }),
  );
}
const allowedNetworks = (role, network) =>
  role === "web" || role === "scan"
    ? ["platform-review-router", network]
    : ["platform-review-router"];

function createBody(actual, role, network, env) {
  const config = row(actual.Config);
  const host = row(actual.HostConfig);
  const endpoints = row(row(actual.NetworkSettings).Networks);
  need(
    stable(Object.keys(endpoints).sort()) ===
      stable(allowedNetworks(role, network).sort()),
    "network_set_changed",
  );
  need(
    Array.isArray(actual.Mounts) &&
      actual.Mounts.every((m) => row(m).Type === "bind") &&
      Object.keys(row(config.Volumes ?? {})).length === 0 &&
      host.AutoRemove !== true,
    "bind_mount_contract",
  );
  const next = {};
  for (const [key, value] of Object.entries(endpoints)) {
    const endpoint = row(value);
    need(endpoint.IPAMConfig === null, "dynamic_ipam_required");
    next[key] = {
      IPAMConfig: null,
      Links: endpoint.Links ?? null,
      Aliases: endpoint.Aliases ?? null,
      DriverOpts: endpoint.DriverOpts ?? null,
      ...(endpoint.GwPriority === undefined
        ? {}
        : { GwPriority: endpoint.GwPriority }),
    };
  }
  if (role === "web" || role === "api") {
    const path = "/run/reviewrouter-flags-state";
    need(
      typeof row(host.Tmpfs)[path] === "string",
      "fresh_flags_tmpfs_required",
    );
  }
  return {
    ...config,
    Env: env,
    HostConfig: structuredClone(host),
    NetworkingConfig: { EndpointsConfig: next },
  };
}

async function verifyScopedInventory(knownIds, image) {
  const listing = await docker("GET", "/containers/json?all=false");
  need(Array.isArray(listing), "inventory_shape");
  const running = [];
  for (const item of listing) {
    const c = await inspect(String(row(item).Id));
    if (row(c.State).Running === true) running.push(c);
  }
  requireNoExtraScopedWorkers(running, knownIds, image, image);
}

async function loadSpec(path) {
  const spec = JSON.parse(await privateFile(path));
  need(/^[a-f0-9]{32}$/.test(spec.machineId ?? ""), "spec_machine");
  need(/^sha256:[a-f0-9]{64}$/.test(spec.expectedImage ?? ""), "spec_image");
  need(/^[a-f0-9]{40}$/.test(spec.expectedRevision ?? ""), "spec_revision");
  need(/^[a-z0-9][a-z0-9_-]{0,127}$/.test(spec.network ?? ""), "spec_network");
  need(
    roles.every((r) => typeof spec.names?.[r] === "string"),
    "spec_names",
  );
  need(Array.isArray(spec.updates) && spec.updates.length > 0, "spec_updates");
  for (const u of spec.updates) {
    need(
      /^[A-Z][A-Z0-9_]+$/.test(u.key) && typeof u.value !== "undefined",
      "spec_update_shape",
    );
    need(
      u.roles === undefined ||
        (Array.isArray(u.roles) && u.roles.every((r) => roles.includes(r))),
      "spec_update_roles",
    );
  }
  return spec;
}

async function snapshotRole(role, spec) {
  const i = await inspect(spec.names[role]);
  need(
    i.Image === spec.expectedImage && row(i.State).Running === true,
    "baseline_image_or_state",
  );
  need(
    row(row(i.Config).Labels)["org.opencontainers.image.revision"] ===
      spec.expectedRevision,
    "baseline_revision",
  );
  need(
    row(row(i.HostConfig).RestartPolicy).Name === "no",
    "restart_policy_must_remain_no",
  );
  const canonical = await privateFile(canonicalPath(role));
  return { inspect: i, pin: pin(i), canonical, canonicalSha: hash(canonical) };
}

async function main() {
  need(
    process.platform === "linux" && process.getuid?.() === 0,
    "linux_root_required",
  );
  const [mode, custody, specPath] = process.argv.slice(2);
  need(
    ["prepare", "plan", "apply"].includes(mode ?? ""),
    "mode_prepare_plan_apply",
  );
  need(
    custody?.startsWith(`${custodyRoot}fleet-overlay-`) &&
      !custody.includes(".."),
    "custody_scope",
  );
  need(
    specPath?.startsWith(custodyRoot) && !specPath.includes(".."),
    "spec_scope",
  );
  process.umask(0o077);
  const spec = await loadSpec(specPath);
  need(
    (await readFile("/etc/machine-id", "utf8")).trim() === spec.machineId,
    "machine_mismatch",
  );
  const image = spec.expectedImage;

  if (mode === "prepare") {
    const snapshots = {};
    for (const role of roles) snapshots[role] = await snapshotRole(role, spec);
    await verifyScopedInventory(
      Object.values(snapshots).map((s) => String(s.inspect.Id)),
      image,
    );
    await mkdir(custody, { mode: 0o700 });
    await privateWrite(
      `${custody}/snapshot.json`,
      JSON.stringify({
        version: 1,
        specSha: hash(JSON.stringify(spec)),
        roles: snapshots,
      }) + "\n",
      true,
    );
    console.log(
      JSON.stringify({ status: "prepared", image, secretsPrinted: false }),
    );
    return;
  }

  const directory = await lstat(custody);
  need(
    directory.isDirectory() &&
      !directory.isSymbolicLink() &&
      directory.uid === 0 &&
      (directory.mode & 0o777) === 0o700,
    "custody_private_directory_required",
  );
  const state = JSON.parse(await privateFile(`${custody}/snapshot.json`));
  need(
    state.version === 1 && state.specSha === hash(JSON.stringify(spec)),
    "snapshot_or_spec_changed",
  );

  const baselines = {};
  const plans = {};
  for (const role of roles) {
    baselines[role] = await inspect(spec.names[role]);
    need(
      pin(baselines[role]) === state.roles[role].pin &&
        hash(await privateFile(canonicalPath(role))) ===
          state.roles[role].canonicalSha,
      "live_baseline_cas_changed",
    );
    const env = envMap(baselines[role]);
    const updates = roleUpdates(role, env, spec.updates);
    const nextList = applyEnvList(row(baselines[role].Config).Env, updates);
    plans[role] = {
      env,
      updates,
      nextList,
      body: createBody(baselines[role], role, spec.network, nextList),
    };
    // the canonical env file must be updatable with the same values
    applyCanonical(state.roles[role].canonical, env, updates);
  }

  if (mode === "plan") {
    const summary = {};
    for (const role of roles)
      summary[role] = [...plans[role].updates].map(
        ([k, v]) => `${k} sha256:${hash(v).slice(0, 12)} len=${v.length}`,
      );
    console.log(
      JSON.stringify({
        status: "planned",
        image,
        summary,
        secretsPrinted: false,
      }),
    );
    return;
  }

  const receiptPath = `${custody}/apply-receipt.json`;
  await privateWrite(
    receiptPath,
    JSON.stringify({ phase: "preflight", image }),
    true,
  );
  const ids = {};
  const retained = {};
  let phase = "preflight";
  const receipt = () =>
    replacePrivate(
      receiptPath,
      JSON.stringify({
        phase,
        ids,
        retained,
        image,
        at: new Date().toISOString(),
      }) + "\n",
    );
  try {
    const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "");
    for (const role of roles) {
      const result = row(
        await docker(
          "POST",
          `/containers/create?name=${encodeURIComponent(`${spec.names[role]}-ovl-candidate-${suffix}`)}`,
          plans[role].body,
        ),
      );
      need(
        typeof result.Id === "string" && /^[a-f0-9]{64}$/.test(result.Id),
        "created_container_identity",
      );
      ids[role] = result.Id;
      phase = `created:${role}`;
      await receipt();
    }
    await coherentCutover({
      verifyAllCandidatesStopped: async () => {
        for (const role of roles) {
          const c = await inspect(ids[role]);
          need(
            c.Image === image && row(c.State).Running === false,
            "candidate_must_be_stopped",
          );
          const expected = {
            ...row(baselines[role].Config),
            Env: plans[role].nextList,
          };
          need(
            stable(c.Config) === stable(expected) &&
              stable(hostCfg(c.HostConfig)) ===
                stable(hostCfg(baselines[role].HostConfig)),
            "stopped_candidate_config",
          );
        }
      },
      verifyAllBaselines: async () => {
        for (const role of roles)
          need(
            pin(await inspect(spec.names[role])) === state.roles[role].pin &&
              hash(await privateFile(canonicalPath(role))) ===
                state.roles[role].canonicalSha,
            "pre_cut_cas_changed",
          );
      },
      verifyScopedInventory: () =>
        verifyScopedInventory(
          [
            ...Object.values(baselines).map((c) => String(c.Id)),
            ...Object.values(ids),
          ],
          image,
        ),
      persistCanonical: async () => {
        for (const role of roles)
          await replacePrivate(
            canonicalPath(role),
            applyCanonical(
              state.roles[role].canonical,
              plans[role].env,
              plans[role].updates,
            ),
          );
        phase = "canonical_env_updated";
        await receipt();
      },
      stopAndRetain: async (role) => {
        const before = baselines[role];
        need(
          pin(await inspect(spec.names[role])) === state.roles[role].pin,
          "role_pre_stop_cas_changed",
        );
        await docker("POST", `/containers/${String(before.Id)}/stop?t=30`);
        phase = `stopped:${role}`;
        await receipt();
        await docker(
          "POST",
          `/containers/${String(before.Id)}/rename?name=${encodeURIComponent(`${spec.names[role]}-before-ovl-${suffix}`)}`,
        );
        retained[role] = String(before.Id);
        phase = `retained:${role}`;
        await receipt();
      },
      verifyAllOldStopped: async () => {
        for (const role of roles)
          need(
            row((await inspect(String(baselines[role].Id))).State).Running ===
              false,
            "all_old_roles_must_be_stopped",
          );
        phase = "all_old_roles_stopped";
        await receipt();
      },
      startAndVerify: async (role) => {
        const before = baselines[role];
        const id = ids[role];
        await docker(
          "POST",
          `/containers/${id}/rename?name=${encodeURIComponent(spec.names[role])}`,
        );
        await docker("POST", `/containers/${id}/start`);
        const after = await inspect(id);
        const expected = { ...row(before.Config), Env: plans[role].nextList };
        need(
          stable(after.Config) === stable(expected) &&
            stable(hostCfg(after.HostConfig)) ===
              stable(hostCfg(before.HostConfig)),
          "opaque_successor_readback",
        );
        need(
          after.Image === image && row(after.State).Running === true,
          "successor_readback_failed",
        );
        phase = `running:${role}`;
        await receipt();
      },
    });
    phase = "applied";
    await receipt();
    console.log(
      JSON.stringify({
        status: phase,
        ids,
        retained,
        image,
        secretsPrinted: false,
      }),
    );
  } catch (e) {
    phase = `failed:${phase}`;
    await receipt();
    throw e;
  }
}

if (process.argv[1]?.endsWith("fleet-overlay.mjs"))
  main().catch((error) => {
    const code =
      error instanceof Error && /^[A-Za-z0-9_:.-]+$/.test(error.message)
        ? error.message
        : "operator_failed";
    console.error(
      JSON.stringify({ status: "failed", code, secretsPrinted: false }),
    );
    process.exitCode = 1;
  });
