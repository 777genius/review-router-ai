#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function removeOwnedAllowlistEntry(current, marker) {
  return current.filter(
    (entry) =>
      !(
        entry.cidrBlock === marker.cidrBlock &&
        entry.description === marker.description
      ),
  );
}

export async function run(
  mode,
  env = process.env,
  fetchImpl = globalThis.fetch,
) {
  const key = env.RENDER_API_KEY;
  const dbId = env.RENDER_POSTGRES_ID;
  const statePath = env.RENDER_ALLOWLIST_BACKUP_PATH;
  const runId = env.GITHUB_RUN_ID;
  if (
    !key ||
    dbId !== "dpg-da32ipmk1f9s73dttm90-a" ||
    !statePath ||
    !/^\d+$/u.test(runId ?? "")
  ) {
    throw new Error("production_migration_allowlist_configuration_invalid");
  }
  const url = `https://api.render.com/v1/postgres/${dbId}`;
  const headers = {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const get = async () => {
    const response = await fetchImpl(url, { headers });
    if (!response.ok)
      throw new Error(`production_migration_allowlist_read_${response.status}`);
    const database = await response.json();
    if (!Array.isArray(database.ipAllowList))
      throw new Error("production_migration_allowlist_shape_invalid");
    return database.ipAllowList;
  };
  const patch = async (ipAllowList) => {
    const response = await fetchImpl(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ ipAllowList }),
    });
    if (!response.ok)
      throw new Error(
        `production_migration_allowlist_write_${response.status}`,
      );
  };
  if (mode === "open") {
    const identityResponse = await fetchImpl(
      "https://api.ipify.org?format=json",
    );
    if (!identityResponse.ok)
      throw new Error("production_migration_runner_ip_unavailable");
    const ip = (await identityResponse.json()).ip;
    if (isIP(ip) !== 4)
      throw new Error("production_migration_runner_ipv4_invalid");
    const marker = {
      cidrBlock: `${ip}/32`,
      description: `rr-additive-migration-${runId}`,
    };
    const current = await get();
    const alreadyAllowed = current.some(
      (entry) =>
        entry.cidrBlock === marker.cidrBlock || entry.cidrBlock === "0.0.0.0/0",
    );
    await writeFile(
      statePath,
      JSON.stringify({ ...marker, added: !alreadyAllowed }),
      { mode: 0o600 },
    );
    if (!alreadyAllowed) await patch([...current, marker]);
    console.log(JSON.stringify({ phase: "open", added: !alreadyAllowed }));
  } else if (mode === "restore") {
    let marker;
    try {
      marker = JSON.parse(await readFile(statePath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (
      marker.description !== `rr-additive-migration-${runId}` ||
      !/^\d{1,3}(?:\.\d{1,3}){3}\/32$/u.test(marker.cidrBlock)
    ) {
      throw new Error("production_migration_allowlist_state_invalid");
    }
    if (marker.added) {
      const current = await get();
      const next = removeOwnedAllowlistEntry(current, marker);
      if (next.length !== current.length) await patch(next);
      const observed = await get();
      if (
        removeOwnedAllowlistEntry(observed, marker).length !== observed.length
      ) {
        throw new Error("production_migration_allowlist_restore_unverified");
      }
    }
    console.log(JSON.stringify({ phase: "restore", complete: true }));
  } else {
    throw new Error("production_migration_allowlist_mode_invalid");
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  run(process.argv[2]).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
