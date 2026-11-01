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
 *              updates:[{key, op:"set"|"appendCsv"|"appendJsonArray", value, roles?:[...]}],
 *              targetImage?, targetImageRef?, targetRevision? }
 *
 * With targetImage (sha256 id), targetImageRef (a local tag that resolves to it) and targetRevision (40 hex)
 * the copies run the new image instead of expectedImage. The image must already be on the host and carry
 * the revision label; its OCI labels replace the old ones. Runtime release metadata env values go in `updates`.
 * Secrets stay on the host: output only prints key names and value hashes.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { request } from "node:http";
import {
  coherentCutover,
  requireNoExtraScopedWorkers,
  startOrder,
} from "./cutover.mjs";

const roles = ["api", "worker", "scan", "web"];
const stabilizeMs = 20_000;
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
    case "add":
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
    need(
      update.op !== "add" || !update.containerOnly,
      "spec_add_requires_canonical",
    );
    if (update.op === "add")
      need(
        !env.has(update.key) && !result.has(update.key),
        `update_key_exists:${update.key}`,
      );
    else need(env.has(update.key), `update_key_missing:${update.key}`);
    result.set(
      update.key,
      nextValue(result.get(update.key) ?? env.get(update.key), update),
    );
  }
  return result;
}

export function roleContainerOnly(role, updates) {
  return new Set(
    updates
      .filter((u) => u.containerOnly && (!u.roles || u.roles.includes(role)))
      .map((u) => u.key),
  );
}

export function applyEnvList(list, updates) {
  const present = new Set(
    list.map((entry) => entry.slice(0, entry.indexOf("="))),
  );
  return [
    ...list.map((entry) => {
      const k = entry.slice(0, entry.indexOf("="));
      return updates.has(k) ? `${k}=${updates.get(k)}` : entry;
    }),
    ...[...updates]
      .filter(([key]) => !present.has(key))
      .map(([key, value]) => `${key}=${value}`),
  ];
}

/** Pure: replace exactly one `KEY=old` line per update; old must match the container value (CAS). */
export function applyCanonical(
  text,
  oldEnv,
  updates,
  containerOnly = new Set(),
) {
  let out = text;
  for (const [key, value] of updates) {
    if (containerOnly.has(key)) {
      need(oldEnv.has(key), "spec_add_requires_canonical");
      continue;
    }
    const lines = out.split("\n");
    const hits = lines
      .map((l, i) => (l.startsWith(`${key}=`) ? i : -1))
      .filter((i) => i >= 0);
    if (!oldEnv.has(key)) {
      need(hits.length === 0, `canonical_key_exists:${key}`);
      out = `${out}${out.endsWith("\n") || !out ? "" : "\n"}${key}=${value}\n`;
      continue;
    }
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

/**
 * Pure: the container Config a successor must have. Without a target image it is the baseline Config with
 * the new Env. With one, Image points at the target and the target's OCI labels replace the baseline's.
 */
export function plannedConfig(baselineConfig, env, target, targetLabels = {}) {
  const config = { ...row(baselineConfig), Env: env };
  if (!target) return config;
  const labels = { ...row(config.Labels ?? {}) };
  for (const [key, value] of Object.entries(targetLabels))
    if (key.startsWith("org.opencontainers.image.")) labels[key] = value;
  return { ...config, Image: target.ref, Labels: labels };
}

/** Pure: ExtraHosts for one role after appending the spec entries that apply to it. */
export function roleExtraHosts(role, current, extraHosts = []) {
  const list = Array.isArray(current) ? [...current] : [];
  for (const item of extraHosts) {
    if (item.roles && !item.roles.includes(role)) continue;
    if (!list.includes(item.entry)) list.push(item.entry);
  }
  return list;
}

function createBody(actual, role, network, extraHosts, config) {
  const host = { ...row(actual.HostConfig), ExtraHosts: extraHosts };
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
    HostConfig: host,
    NetworkingConfig: { EndpointsConfig: next },
  };
}

async function verifyScopedInventory(knownIds, image, targetImage = image) {
  const listing = await docker("GET", "/containers/json?all=false");
  need(Array.isArray(listing), "inventory_shape");
  const running = [];
  for (const item of listing) {
    const c = await inspect(String(row(item).Id));
    if (row(c.State).Running === true) running.push(c);
  }
  requireNoExtraScopedWorkers(running, knownIds, image, targetImage);
}

async function loadSpec(path) {
  const spec = JSON.parse(await privateFile(path));
  need(/^[a-f0-9]{32}$/.test(spec.machineId ?? ""), "spec_machine");
  need(/^sha256:[a-f0-9]{64}$/.test(spec.expectedImage ?? ""), "spec_image");
  need(/^[a-f0-9]{40}$/.test(spec.expectedRevision ?? ""), "spec_revision");
  need(/^[a-z0-9][a-z0-9_-]{0,127}$/.test(spec.network ?? ""), "spec_network");
  const targetFields = [
    spec.targetImage,
    spec.targetImageRef,
    spec.targetRevision,
  ];
  need(
    targetFields.every((v) => v === undefined) ||
      targetFields.every((v) => v !== undefined),
    "spec_target_all_or_none",
  );
  if (spec.targetImage !== undefined) {
    need(/^sha256:[a-f0-9]{64}$/.test(spec.targetImage), "spec_target_image");
    need(
      /^[a-z0-9][a-z0-9_./:-]{0,200}$/.test(spec.targetImageRef),
      "spec_target_image_ref",
    );
    need(/^[a-f0-9]{40}$/.test(spec.targetRevision), "spec_target_revision");
    need(
      spec.targetImage !== spec.expectedImage,
      "spec_target_equals_expected",
    );
  }
  need(
    roles.every((r) => typeof spec.names?.[r] === "string"),
    "spec_names",
  );
  need(Array.isArray(spec.updates) && spec.updates.length > 0, "spec_updates");
  for (const u of spec.updates) {
    need(
      /^[A-Z][A-Z0-9_]+$/.test(u.key) &&
        ["add", "set", "appendCsv", "appendJsonArray"].includes(u.op),
      "spec_update_shape",
    );
    need(
      u.op === "appendJsonArray"
        ? typeof u.value === "object" && u.value !== null
        : typeof u.value === "string" &&
            u.value.length > 0 &&
            ![...u.value].some((ch) => ch.charCodeAt(0) < 32),
      "spec_update_value",
    );
    need(
      u.roles === undefined ||
        (Array.isArray(u.roles) && u.roles.every((r) => roles.includes(r))),
      "spec_update_roles",
    );
    need(
      u.containerOnly === undefined || typeof u.containerOnly === "boolean",
      "spec_update_container_only",
    );
    need(u.op !== "add" || !u.containerOnly, "spec_add_requires_canonical");
  }
  for (const h of spec.extraHosts ?? []) {
    need(
      typeof h.entry === "string" && /^[a-z0-9.-]+:[0-9a-f.:]+$/.test(h.entry),
      "spec_extra_host",
    );
    need(
      h.roles === undefined ||
        (Array.isArray(h.roles) && h.roles.every((r) => roles.includes(r))),
      "spec_extra_host_roles",
    );
  }
  return spec;
}

/** The target image must already be on the host and match the reviewed identity. Returns its labels. */
async function verifyTargetImage(spec) {
  const found = row(
    await docker(
      "GET",
      `/images/${encodeURIComponent(spec.targetImageRef)}/json`,
    ),
  );
  need(found.Id === spec.targetImage, "target_image_ref_mismatch");
  need(
    found.Os === "linux" && found.Architecture === "amd64",
    "target_image_platform",
  );
  const labels = row(row(found.Config).Labels ?? {});
  need(
    labels["org.opencontainers.image.revision"] === spec.targetRevision,
    "target_image_revision_label",
  );
  return labels;
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
  const target = spec.targetImage
    ? { image: spec.targetImage, ref: spec.targetImageRef }
    : null;
  const toImage = target?.image ?? image;
  const targetLabels = target ? await verifyTargetImage(spec) : {};

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
        roles: Object.fromEntries(
          Object.entries(snapshots).map(([r, v]) => [
            r,
            {
              pin: v.pin,
              canonical: v.canonical,
              canonicalSha: v.canonicalSha,
            },
          ]),
        ),
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
    const extraHosts = roleExtraHosts(
      role,
      row(baselines[role].HostConfig).ExtraHosts,
      spec.extraHosts,
    );
    const config = plannedConfig(
      row(baselines[role]).Config,
      nextList,
      target,
      targetLabels,
    );
    const body = createBody(
      baselines[role],
      role,
      spec.network,
      extraHosts,
      config,
    );
    plans[role] = {
      env,
      updates,
      nextList,
      config,
      body,
      hostConfig: body.HostConfig,
    };
    // the canonical env file must be updatable with the same values
    applyCanonical(
      state.roles[role].canonical,
      env,
      updates,
      roleContainerOnly(role, spec.updates),
    );
  }

  if (mode === "plan") {
    const summary = {};
    for (const role of roles)
      summary[role] = [
        ...[...plans[role].updates].map(
          ([k, v]) => `${k} sha256:${hash(v).slice(0, 12)} len=${v.length}`,
        ),
        ...row(plans[role].hostConfig).ExtraHosts.map((h) => `ExtraHosts ${h}`),
      ];
    console.log(
      JSON.stringify({
        status: "planned",
        image,
        targetImage: target ? toImage : undefined,
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
  let cutoverStarted = false;
  const receipt = () =>
    replacePrivate(
      receiptPath,
      JSON.stringify({
        phase,
        ids,
        retained,
        image: toImage,
        at: new Date().toISOString(),
      }) + "\n",
    );
  const suffix = new Date().toISOString().replace(/[-:.TZ]/g, "");
  /** Bring the old fleet back: candidates away from the canonical names, old containers renamed back and started, canonical env restored. */
  async function rollback() {
    for (const role of roles) {
      if (!ids[role]) continue;
      const c = await inspect(ids[role]);
      if (row(c.State).Running === true)
        await docker("POST", `/containers/${ids[role]}/stop?t=30`);
      if (String(c.Name).replace(/^\//, "") === spec.names[role])
        await docker(
          "POST",
          `/containers/${ids[role]}/rename?name=${encodeURIComponent(`${spec.names[role]}-ovl-failed-${suffix}`)}`,
        );
    }
    for (const role of roles)
      await replacePrivate(canonicalPath(role), state.roles[role].canonical);
    for (const role of [...startOrder].filter((r) => roles.includes(r))) {
      const old = await inspect(String(baselines[role].Id));
      if (String(old.Name).replace(/^\//, "") !== spec.names[role])
        await docker(
          "POST",
          `/containers/${old.Id}/rename?name=${encodeURIComponent(spec.names[role])}`,
        );
      if (row(old.State).Running !== true)
        await docker("POST", `/containers/${old.Id}/start`);
    }
  }
  try {
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
            c.Image === toImage && row(c.State).Running === false,
            "candidate_must_be_stopped",
          );
          need(
            stable(c.Config) === stable(plans[role].config) &&
              stable(hostCfg(c.HostConfig)) ===
                stable(hostCfg(plans[role].hostConfig)),
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
          toImage,
        ),
      persistCanonical: async () => {
        cutoverStarted = true;
        for (const role of roles)
          await replacePrivate(
            canonicalPath(role),
            applyCanonical(
              state.roles[role].canonical,
              plans[role].env,
              plans[role].updates,
              roleContainerOnly(role, spec.updates),
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
        const id = ids[role];
        await docker(
          "POST",
          `/containers/${id}/rename?name=${encodeURIComponent(spec.names[role])}`,
        );
        await docker("POST", `/containers/${id}/start`);
        const after = await inspect(id);
        need(
          stable(after.Config) === stable(plans[role].config) &&
            stable(hostCfg(after.HostConfig)) ===
              stable(hostCfg(plans[role].hostConfig)),
          "opaque_successor_readback",
        );
        need(
          after.Image === toImage && row(after.State).Running === true,
          "successor_readback_failed",
        );
        phase = `running:${role}`;
        await receipt();
      },
    });
    phase = "stabilizing";
    await receipt();
    await new Promise((resolve) => setTimeout(resolve, stabilizeMs));
    for (const role of roles) {
      const c = await inspect(ids[role]);
      need(
        row(c.State).Running === true &&
          row(c.State).Restarting !== true &&
          (c.RestartCount ?? 0) === 0,
        "successor_unstable",
      );
    }
    phase = "applied";
    await receipt();
    console.log(
      JSON.stringify({
        status: phase,
        ids,
        retained,
        image: toImage,
        secretsPrinted: false,
      }),
    );
  } catch (e) {
    const failedAt = phase;
    phase = `failed:${failedAt}`;
    await receipt();
    if (cutoverStarted) {
      try {
        await rollback();
        phase = `rolled_back_after:${failedAt}`;
      } catch {
        phase = `rollback_failed_after:${failedAt}`;
      }
      await receipt();
    }
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
