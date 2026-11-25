import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { BootstrapConfig, BootstrapState } from "./bootstrap.ts";
import { privateFile } from "./bootstrap.ts";
import {
  dockerCommand,
  eventually,
} from "../../scripts/hindsight-e2e/native-runtime.ts";
import {
  CleanupHostInventory,
  CLEANUP_HOST_CONTAINER_LIMIT,
  type CleanupHostInspection,
} from "../../scripts/hindsight-e2e/cleanup-host-inventory.ts";
import { verifyNativeProvenance } from "../../scripts/hindsight-e2e/native-provenance.ts";
import { nativeSqlArguments } from "../../scripts/hindsight-e2e/operator-host.ts";
import {
  memoryNativeStartupBindingDigest,
  nativeStartupActor,
  type MemoryNativeStartupBinding,
  type MemoryNativeStartupState,
} from "../../packages/features/memory/src/application/memory-native-startup.ts";

type Inspection = CleanupHostInspection & {
  Name: string;
  Config: CleanupHostInspection["Config"] & { User?: string };
  Mounts: readonly {
    Type: string;
    Name?: string;
    Source: string;
    Destination: string;
    RW: boolean;
  }[];
};
type Image = {
  Id: string;
  Config: { Env?: string[]; Entrypoint?: string[]; User?: string };
};
type Status = MemoryNativeStartupState & {
  binding: MemoryNativeStartupBinding;
  bindingDigest: string;
};
type Attempt = {
  schema: "memory-native-resume/v1";
  attemptId: string;
  bindingDigest: string;
  initialEpoch: string;
  pausedEpoch: string;
  phase: "prepared" | "starting" | "complete" | "aborted" | "ambiguous";
  startIntents: string[];
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const env = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const equal = line.indexOf("=");
        assert(
          equal > 0 && /^[A-Z][A-Z0-9_]*$/.test(line.slice(0, equal)),
          "Saved native environment is invalid",
        );
        return [line.slice(0, equal), line.slice(equal + 1)];
      }),
  );
const stopped = (record: Inspection) =>
  record.State.Status === "exited" &&
  !record.State.Running &&
  record.State.Pid === 0 &&
  !record.State.Dead &&
  !record.State.Paused &&
  !record.State.Restarting;
const active = (record: Inspection) =>
  record.State.Status === "running" &&
  record.State.Running &&
  record.State.Pid > 0 &&
  !record.State.Dead &&
  !record.State.Paused &&
  !record.State.Restarting;
class Refused extends Error {}

/** One explicit operation, under the caller's existing whole deployment flock.
 * No replacement, provenance install, migration, inference or automatic retry. */
export async function resumeNativeDeployment(
  config: BootstrapConfig,
  state: BootstrapState,
  routerOrigin: string,
  lock: { assertHeld(): Promise<void> },
  verifyRunning: () => Promise<void>,
): Promise<object> {
  const origin = new URL(routerOrigin);
  assert(
    !origin.username &&
      !origin.password &&
      !origin.search &&
      !origin.hash &&
      origin.pathname === "/" &&
      (origin.protocol === "https:" ||
        (origin.protocol === "http:" &&
          /^(127\.0\.0\.1|localhost)$/.test(origin.hostname))),
    "Resume requires the configured HTTPS or loopback Router API origin",
  );
  const router = env(await privateFile(join(config.directory, "router.env")));
  const operator = env(
    await privateFile(join(config.directory, "operator.env")),
  );
  assert(
    operator.REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN &&
      operator.REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN ===
        router.REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN,
    "Saved operator authority differs",
  );
  const binding: MemoryNativeStartupBinding = {
    namespace: config.namespace,
    generation: config.generation,
    imageDigest: state.imageId,
    profile: router.REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE!,
    endpointDigest: sha(
      JSON.stringify(
        new URL(router.REVIEW_ROUTER_MEMORY_HINDSIGHT_URL!)
          .toString()
          .replace(/\/+$/, ""),
      ),
    ),
  };
  assert(
    router.REVIEW_ROUTER_MEMORY_GENERATION === config.generation &&
      router.REVIEW_ROUTER_MEMORY_NAMESPACE === config.namespace &&
      router.REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST === state.imageId,
    "Saved Router binding differs",
  );
  const bindingDigest = memoryNativeStartupBindingDigest(binding);
  const request = async (path: string, body?: object): Promise<Status> => {
    const response = await fetch(
      new URL(`/api/internal/memory/startup${path}`, origin),
      {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(35_000),
        headers: {
          authorization: `Bearer ${operator.REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    if (!response.ok) {
      if ([400, 403, 409].includes(response.status))
        throw new Refused("Router startup refused");
      throw new Error("Router startup outcome unavailable");
    }
    const value = (await response.json()) as Status;
    assert.deepEqual(
      value.binding,
      binding,
      "Router startup provider binding differs",
    );
    assert(
      value.bindingDigest === bindingDigest &&
        memoryNativeStartupBindingDigest(value.binding) === bindingDigest &&
        value.generation === config.generation &&
        /^(0|[1-9][0-9]*)$/.test(value.epoch) &&
        typeof value.paused === "boolean" &&
        typeof value.cleanupDebt === "boolean",
      "Router startup state is invalid",
    );
    return value;
  };
  const inspect = async (id: string) => {
    const rows = JSON.parse(
      await dockerCommand(["inspect", id]),
    ) as Inspection[];
    assert(
      rows.length === 1 && rows[0]!.Id === id,
      "Saved container identity differs",
    );
    return rows[0]!;
  };
  const census = async () => {
    await lock.assertHeld();
    const ids = (await dockerCommand(["ps", "--all", "--no-trunc", "--quiet"]))
      .trim()
      .split(/\s+/);
    assert(
      ids.length > 0 &&
        ids.length <= CLEANUP_HOST_CONTAINER_LIMIT &&
        new Set(ids).size === ids.length &&
        ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
      "Complete Docker census is unavailable",
    );
    const records: Inspection[] = [];
    for (const id of ids) records.push(await inspect(id));
    return records;
  };
  const image = async (id: string) => {
    const values = JSON.parse(
      await dockerCommand(["image", "inspect", id]),
    ) as Image[];
    assert(
      values.length === 1 && /^sha256:[a-f0-9]{64}$/.test(values[0]!.Id),
      "Saved image is unavailable",
    );
    return values[0]!;
  };
  const nativeImage = await image(state.imageId),
    pgImage = await image(config.postgresImage);
  const ids = Object.values(state.containers);
  assert(
    ids.length === 3 &&
      new Set(ids).size === 3 &&
      ids.every((id) => /^[a-f0-9]{64}$/.test(id)),
    "Saved container identities are invalid",
  );
  const environments: Record<string, Record<string, string>> = {};
  for (const role of ["postgres", "api", "worker"] as const)
    environments[role] = env(
      await privateFile(join(config.directory, `${role}.env`)),
    );
  const assertSaved = (records: Inspection[]) => {
    for (const role of ["postgres", "api", "worker"] as const) {
      const record = records.find(
        (record) => record.Id === state.containers[role],
      );
      assert(
        record && (stopped(record) || active(record)),
        "Saved container has an unknown lifecycle state",
      );
      const base = role === "postgres" ? pgImage : nativeImage;
      assert(
        record.Image === base.Id &&
          record.Name === `/${config.deployment}-${role}` &&
          record.HostConfig.NetworkMode === "host" &&
          record.HostConfig.RestartPolicy.Name === "no" &&
          record.Config.Labels["io.reviewrouter.hindsight.deployment"] ===
            config.deployment &&
          !Object.keys(record.Config.Labels).some((key) =>
            /^(com\.docker\.(compose|swarm)|io\.kubernetes|io\.containerd|com\.dokku)/.test(
              key,
            ),
          ),
        "Saved standalone runtime differs",
      );
      assert.deepEqual(
        record.Config.Entrypoint ?? [],
        base.Config.Entrypoint ?? [],
        "Saved entrypoint differs",
      );
      assert.equal(
        record.Config.User ?? "",
        base.Config.User ?? "",
        "Saved runtime user differs",
      );
      const expected = {
        ...Object.fromEntries(
          (base.Config.Env ?? []).map((setting) => {
            const i = setting.indexOf("=");
            return [setting.slice(0, i), setting.slice(i + 1)];
          }),
        ),
        ...environments[role],
      };
      const actual = Object.fromEntries(
        record.Config.Env.map((setting) => {
          const i = setting.indexOf("=");
          return [setting.slice(0, i), setting.slice(i + 1)];
        }),
      );
      assert(
        record.Config.Env.length === Object.keys(actual).length &&
          sha(JSON.stringify(Object.entries(actual).sort())) ===
            sha(JSON.stringify(Object.entries(expected).sort())),
        "Saved private environment differs",
      );
      if (role === "postgres") {
        assert(
          !Object.hasOwn(
            record.Config.Labels,
            "io.reviewrouter.hindsight.role",
          ),
          "Saved PostgreSQL is a writer",
        );
        assert.deepEqual(
          record.Config.Cmd,
          [
            "-p",
            String(config.postgresPort),
            "-c",
            "listen_addresses=127.0.0.1",
            "-c",
            "log_statement=none",
            "-c",
            "log_min_messages=panic",
            "-c",
            "log_min_error_statement=panic",
            "-c",
            "log_error_verbosity=terse",
            "-c",
            "log_parameter_max_length=0",
            "-c",
            "log_parameter_max_length_on_error=0",
          ],
          "Saved PostgreSQL command differs",
        );
      } else {
        assert.equal(
          record.Config.Labels["io.reviewrouter.hindsight.role"],
          role,
          "Saved native role differs",
        );
        assert.deepEqual(
          record.Config.Cmd,
          role === "api"
            ? ["hindsight-api"]
            : [
                "hindsight-worker",
                "--http-host",
                "127.0.0.1",
                "--http-port",
                String(config.workerPort),
              ],
          "Saved native command differs",
        );
      }
      const mounts = record.Mounts.map((m) => ({
        type: m.Type,
        source: m.Type === "volume" ? m.Name : m.Source,
        destination: m.Destination,
        rw: m.RW,
      })).sort((a, b) => a.destination.localeCompare(b.destination));
      const expectedMounts =
        role === "postgres"
          ? [
              {
                type: "volume",
                source: `${config.deployment}-pg17-data`,
                destination: "/var/lib/postgresql/data",
                rw: true,
              },
            ]
          : [
              {
                type: "volume",
                source: `${config.deployment}-model-cache`,
                destination: "/var/cache/reviewrouter-models",
                rw: true,
              },
              ...(config.modelDirectory
                ? [
                    {
                      type: "bind",
                      source: config.modelDirectory,
                      destination: "/models",
                      rw: false,
                    },
                  ]
                : []),
            ];
      assert.deepEqual(
        mounts,
        expectedMounts.sort((a, b) =>
          a.destination.localeCompare(b.destination),
        ),
        "Saved volume/model bindings differ",
      );
    }
    const expectedDatabase = new URL(
      environments.api!.HINDSIGHT_API_DATABASE_URL!,
    );
    for (const record of records) {
      if (ids.includes(record.Id)) continue;
      const setting = record.Config.Env?.find((value) =>
        value.startsWith("HINDSIGHT_API_DATABASE_URL="),
      );
      const database = setting
        ? new URL(setting.slice("HINDSIGHT_API_DATABASE_URL=".length))
        : null;
      assert(
        record.Image !== state.imageId &&
          record.Config.Labels?.["io.reviewrouter.hindsight.deployment"] !==
            config.deployment &&
          (!database ||
            `${database.hostname}:${database.port || 5432}${database.pathname}` !==
              `${expectedDatabase.hostname}:${expectedDatabase.port || 5432}${expectedDatabase.pathname}`),
        "Unknown native image/database/deployment executor exists",
      );
    }
  };
  const assertVolumes = async (records: Inspection[]) => {
    for (const [name, expectedUsers] of [
      [`${config.deployment}-pg17-data`, [state.containers.postgres]],
      [
        `${config.deployment}-model-cache`,
        [state.containers.api, state.containers.worker],
      ],
    ] as const) {
      const volumes = JSON.parse(
        await dockerCommand(["volume", "inspect", name]),
      ) as {
        Name: string;
        Driver: string;
        Scope: string;
        Options: Record<string, string> | null;
        Labels: Record<string, string>;
        Mountpoint: string;
      }[];
      const volume = volumes[0];
      assert(
        volumes.length === 1 &&
          volume?.Name === name &&
          volume.Driver === "local" &&
          volume.Scope === "local" &&
          Object.keys(volume.Options ?? {}).length === 0 &&
          volume.Labels?.["io.reviewrouter.hindsight.deployment"] ===
            config.deployment,
        "Saved native volume ownership/profile differs",
      );
      const users = records.filter((record) =>
        record.Mounts?.some(
          (mount) => mount.Type === "volume" && mount.Name === name,
        ),
      );
      assert.deepEqual(
        users.map((record) => record.Id).sort(),
        [...expectedUsers].sort(),
        "Native volume has unknown container users",
      );
      assert(
        users.every((record) =>
          record.Mounts.filter(
            (mount) => mount.Type === "volume" && mount.Name === name,
          ).every((mount) => mount.Source === volume.Mountpoint),
        ),
        "Saved native volume source differs",
      );
    }
  };
  let records = await census();
  assertSaved(records);
  await assertVolumes(records);
  const journalPath = join(config.directory, "resume-attempt.json");
  let previous: Attempt | undefined;
  try {
    previous = JSON.parse(await privateFile(journalPath)) as Attempt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const nativeIds = [state.containers.api, state.containers.worker];
  if (previous) {
    assert(
      previous.schema === "memory-native-resume/v1" &&
        previous.bindingDigest === bindingDigest &&
        /^(0|[1-9][0-9]*)$/.test(previous.initialEpoch) &&
        previous.pausedEpoch === String(BigInt(previous.initialEpoch) + 1n) &&
        ["prepared", "starting", "complete", "aborted", "ambiguous"].includes(
          previous.phase,
        ) &&
        Array.isArray(previous.startIntents) &&
        previous.startIntents.length <= 2 &&
        new Set(previous.startIntents).size === previous.startIntents.length &&
        previous.startIntents.every((id) => nativeIds.includes(id)),
      "Saved resume attempt is invalid",
    );
    nativeStartupActor({
      attemptId: previous.attemptId,
      bindingDigest,
      phase: "paused",
    });
    if (!["complete", "aborted"].includes(previous.phase)) {
      const observed = await request("");
      if (
        observed.owner?.attemptId === previous.attemptId &&
        observed.owner.bindingDigest === bindingDigest &&
        observed.owner.phase === "complete" &&
        !observed.paused &&
        observed.epoch === String(BigInt(previous.pausedEpoch) + 1n) &&
        nativeIds.every((id) =>
          active(records.find((record) => record.Id === id)!),
        )
      ) {
        await verifyRunning();
        previous.phase = "complete";
        await writeFile(journalPath, JSON.stringify(previous) + "\n", {
          mode: 0o600,
        });
        return {
          phase: "running",
          resumed: true,
          reconciled: true,
          attemptId: previous.attemptId,
          maintenanceEpoch: observed.epoch,
        };
      }
      throw new Error(
        "Previous resume remains unresolved; retain its private journal and reconcile the exact attempt",
      );
    }
  }
  if (
    nativeIds.every((id) => active(records.find((record) => record.Id === id)!))
  ) {
    await verifyRunning();
    return { phase: "running", reused: true };
  }
  assert(
    nativeIds.every((id) =>
      stopped(records.find((record) => record.Id === id)!),
    ),
    "Mixed native lifecycle requires explicit reconciliation",
  );
  const initial = await request("");
  assert(
    !initial.paused && !initial.cleanupDebt,
    "Router pause or cleanup debt prevents startup",
  );
  if (previous)
    await rename(
      journalPath,
      join(config.directory, `resume-attempt-${previous.attemptId}.json`),
    );
  const attempt: Attempt = {
    schema: "memory-native-resume/v1",
    attemptId: randomUUID(),
    bindingDigest,
    initialEpoch: initial.epoch,
    pausedEpoch: String(BigInt(initial.epoch) + 1n),
    phase: "prepared",
    startIntents: [],
  };
  await writeFile(journalPath, JSON.stringify(attempt) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  const save = () =>
    writeFile(journalPath, JSON.stringify(attempt) + "\n", { mode: 0o600 });
  const owned = (value: Status, phase: "paused" | "complete" | "aborted") =>
    value.owner?.attemptId === attempt.attemptId &&
    value.owner.bindingDigest === bindingDigest &&
    value.owner.phase === phase &&
    value.epoch ===
      (phase === "paused"
        ? attempt.pausedEpoch
        : String(BigInt(attempt.pausedEpoch) + 1n)) &&
    value.paused === (phase !== "complete");
  const change = (expectedEpoch: string) => ({
    attemptId: attempt.attemptId,
    bindingDigest,
    expectedEpoch,
  });
  let finishUncertain = false;
  let beginRefused = false;
  try {
    let paused: Status;
    try {
      paused = await request("/begin", change(initial.epoch));
    } catch (error) {
      beginRefused = error instanceof Refused;
      paused = await request("");
    }
    if (
      beginRefused &&
      paused.owner === null &&
      !paused.paused &&
      paused.epoch === initial.epoch
    ) {
      attempt.phase = "aborted";
      await save();
      throw new Refused("Router refused startup before any effect");
    }
    assert(
      owned(paused, "paused") && !paused.cleanupDebt,
      "Startup pause was not durably admitted",
    );
    const pg = records.find(
      (record) => record.Id === state.containers.postgres,
    )!;
    if (stopped(pg)) {
      await lock.assertHeld();
      await dockerCommand(["start", pg.Id]);
    }
    await eventually(
      async () =>
        (
          await dockerCommand(
            [
              "exec",
              state.containers.postgres,
              "pg_isready",
              "-U",
              "postgres",
              "-p",
              String(config.postgresPort),
              "-d",
              "hindsight",
            ],
            true,
          )
        ).includes("accepting connections")
          ? true
          : undefined,
      "existing native PostgreSQL readiness",
    );
    records = await census();
    assertSaved(records);
    await assertVolumes(records);
    const inventory = new CleanupHostInventory({
      deploymentLabel: `io.reviewrouter.hindsight.deployment=${config.deployment}`,
      imageDigest: state.imageId,
      apiContainerId: state.containers.api,
      executorContainerIds: nativeIds,
      restartContainerIds: nativeIds,
      postgresInfrastructure: {
        containerId: state.containers.postgres,
        imageDigest: pgImage.Id,
        port: config.postgresPort,
      },
    });
    inventory.inspect(records, "initial");
    await verifyNativeProvenance(
      async (steps) =>
        (
          await dockerCommand(
            nativeSqlArguments(
              environments.api!.HINDSIGHT_API_DATABASE_URL!,
              state.imageId,
              steps,
              true,
              join(config.directory, "provenance-observer-database.env"),
            ),
          )
        ).trim(),
      "public",
      binding,
      new Date().toISOString(),
    );
    const current = await request("");
    assert(
      owned(current, "paused") && !current.cleanupDebt,
      "Startup authority changed before writer start",
    );
    attempt.phase = "starting";
    await save();
    for (const id of nativeIds) {
      await lock.assertHeld();
      attempt.startIntents.push(id);
      await save();
      await dockerCommand(["start", id]);
    }
    await verifyRunning();
    records = await census();
    assertSaved(records);
    await assertVolumes(records);
    inventory.inspect(records, "restarted");
    finishUncertain = true;
    let finished: Status;
    try {
      finished = await request("/finish", change(attempt.pausedEpoch));
      finishUncertain = false;
    } catch (error) {
      if (error instanceof Refused) finishUncertain = false;
      finished = await request("");
      if (!owned(finished, "complete")) throw error;
    }
    assert(owned(finished, "complete"), "Startup finish was not settled");
    attempt.phase = "complete";
    await save();
    return {
      phase: "running",
      resumed: true,
      attemptId: attempt.attemptId,
      maintenanceEpoch: finished.epoch,
    };
  } catch (error) {
    if (
      error instanceof Refused &&
      attempt.phase === "aborted" &&
      attempt.startIntents.length === 0
    )
      throw error;
    let current: Status | undefined;
    try {
      current = await request("");
    } catch {
      /* No assumption about a lost finish. */
    }
    if (current && owned(current, "complete")) {
      attempt.phase = "complete";
      await save();
      await verifyRunning();
      return {
        phase: "running",
        resumed: true,
        attemptId: attempt.attemptId,
        maintenanceEpoch: current.epoch,
      };
    }
    if (!finishUncertain && current && owned(current, "paused")) {
      for (const id of attempt.startIntents) {
        const observed = await inspect(id);
        assertSaved(await census());
        if (active(observed)) {
          await lock.assertHeld();
          await dockerCommand(["stop", "--time", "30", id]);
        }
        assert(stopped(await inspect(id)), "Own started writer did not stop");
      }
      const aborted = await request("/abort", change(attempt.pausedEpoch));
      assert(owned(aborted, "aborted"), "Startup handoff was not settled");
      attempt.phase = "aborted";
      await save();
      throw new Error(
        "Native resume refused; own started writers stopped, Router remains paused for normal cleanup/reconciliation",
        { cause: error },
      );
    }
    attempt.phase = "ambiguous";
    await save();
    throw new Error(
      "Native resume outcome is unresolved; preserve the exact attempt and inspect startup status before any lifecycle operation",
      { cause: error },
    );
  }
}
