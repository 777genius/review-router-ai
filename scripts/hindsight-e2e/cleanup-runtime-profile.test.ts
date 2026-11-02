import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectedCleanupEnvironment,
  inspectedCleanupMountArguments,
  inspectedExecutorHealthBase,
  writeCleanupEnvironmentFile,
  type CleanupExecutorInspection,
} from "./cleanup-runtime-profile.ts";
import { nativeSqlArguments } from "./operator-host.ts";
import {
  CLEANUP_HOST_CONTAINER_LIMIT,
  CleanupHostInventory,
  type CleanupHostInspection,
} from "./cleanup-host-inventory.ts";

function api(): CleanupExecutorInspection {
  return {
    Id: "a".repeat(64),
    Image: `sha256:${"b".repeat(64)}`,
    Config: {
      Env: [
        "HINDSIGHT_API_HOST=172.19.0.1",
        "HINDSIGHT_API_PORT=8888",
        "HINDSIGHT_API_EMBEDDINGS_PROVIDER=local",
        "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=/snapshots/embedding",
        "HINDSIGHT_API_RERANKER_PROVIDER=local",
        "HINDSIGHT_API_RERANKER_LOCAL_MODEL=/snapshots/reranker",
        "HF_HOME=/private-model-cache/huggingface",
        "SENTENCE_TRANSFORMERS_HOME=/private-model-cache/sentence-transformers",
        "HF_HUB_OFFLINE=1",
        "TRANSFORMERS_OFFLINE=1",
        "UNRELATED_PRIVATE_SETTING=do-not-clone",
      ],
      Cmd: ["hindsight-api"],
      Labels: { "io.reviewrouter.hindsight.role": "api" },
    },
    HostConfig: { RestartPolicy: { Name: "no" } },
    State: { Running: true, Pid: 123, Status: "running", ExitCode: 0 },
    Mounts: [
      {
        Type: "bind",
        Source: "/srv/operator/snapshots",
        Destination: "/snapshots",
        RW: false,
      },
      {
        Type: "volume",
        Name: "native-private-cache",
        Source: "/var/lib/docker/volumes/native-private-cache/_data",
        Destination: "/private-model-cache",
        RW: true,
      },
    ],
  };
}

function bootstrapInventory() {
  const deploymentLabel =
    "io.reviewrouter.hindsight.deployment=synthetic-memory";
  const native = api() as CleanupHostInspection;
  native.Config.Labels["io.reviewrouter.hindsight.deployment"] =
    "synthetic-memory";
  native.Config.Env.push(
    "HINDSIGHT_API_DATABASE_URL=postgresql://synthetic:private@127.0.0.1:55432/hindsight",
  );
  const worker = structuredClone(native);
  worker.Id = "c".repeat(64);
  worker.Config.Labels["io.reviewrouter.hindsight.role"] = "worker";
  const postgres: CleanupHostInspection = {
    Id: "d".repeat(64),
    Image: `sha256:${"e".repeat(64)}`,
    Config: {
      Labels: { "io.reviewrouter.hindsight.deployment": "synthetic-memory" },
      Env: ["PG_MAJOR=17", "PGDATA=/var/lib/postgresql/data/pgdata"],
      Entrypoint: ["docker-entrypoint.sh"],
      Cmd: [
        "-p",
        "55432",
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
    },
    HostConfig: { RestartPolicy: { Name: "no" }, NetworkMode: "host" },
    State: {
      Running: true,
      Pid: 456,
      Status: "running",
      ExitCode: 0,
      StartedAt: "2026-11-01T10:00:00.123456789Z",
      Restarting: false,
      Paused: false,
      Dead: false,
    },
    RestartCount: 0,
  };
  const nativePlan = {
    deploymentLabel,
    imageDigest: native.Image,
    apiContainerId: native.Id,
    executorContainerIds: [native.Id, worker.Id],
    restartContainerIds: [native.Id, worker.Id],
  };
  const plan = {
    ...nativePlan,
    postgresInfrastructure: {
      containerId: postgres.Id,
      imageDigest: postgres.Image,
      port: 55432,
    },
  };
  return {
    native,
    worker,
    postgres,
    nativePlan,
    plan,
    records: [native, worker, postgres],
  };
}
test("complete host census accepts all 1024 records, rejects 1025 and still checks the final record for hidden writers", () => {
  const { records, plan, native } = bootstrapInventory();
  assert.equal(CLEANUP_HOST_CONTAINER_LIMIT, 1024);
  const unrelated = Array.from(
    { length: CLEANUP_HOST_CONTAINER_LIMIT - records.length },
    (_, index) => ({
      ...native,
      Id: (index + 1).toString(16).padStart(64, "0"),
      Image: `sha256:${"f".repeat(64)}`,
      Config: { Env: [], Labels: {}, Cmd: ["sleep", "infinity"] },
    }),
  );
  const complete = [...records, ...unrelated];
  assert.equal(complete.length, 1024);
  assert.deepEqual(
    new CleanupHostInventory(plan)
      .inspect(complete, "initial")
      .map((record) => record.Id),
    plan.executorContainerIds,
  );
  assert.throws(
    () =>
      new CleanupHostInventory(plan).inspect(
        [...complete, { ...unrelated[0]!, Id: "f".repeat(64) }],
        "initial",
      ),
    /exceeds the bounded inspection profile/,
  );
  const last = unrelated.at(-1)!;
  for (const hidden of [
    { ...last, Image: native.Image },
    { ...last, Config: { ...last.Config, Env: [...native.Config.Env] } },
    {
      ...last,
      Config: {
        ...last.Config,
        Labels: {
          ...native.Config.Labels,
          "io.reviewrouter.hindsight.role": "",
        },
      },
    },
  ])
    assert.throws(() =>
      new CleanupHostInventory(plan).inspect(
        [...complete.slice(0, -1), hidden],
        "initial",
      ),
    );
});
test("only the exact bootstrap PG stays running outside the executor stop/restart inventory", () => {
  const { records, plan, postgres } = bootstrapInventory();
  const inventory = new CleanupHostInventory(plan);
  assert.deepEqual(
    inventory.inspect(records, "initial").map((record) => record.Id),
    plan.executorContainerIds,
  );
  const stopped = records.map((record) =>
    record.Id === postgres.Id
      ? record
      : {
          ...record,
          State: { ...record.State, Running: false, Pid: 0, Status: "exited" },
        },
  );
  for (const [phase, census] of [
    ["stopped", stopped],
    ["restarted", records],
  ] as const) {
    const executors = inventory.inspect(census, phase);
    assert(!executors.some((record) => record.Id === postgres.Id));
    assert.deepEqual(
      executors.map((record) => record.Id),
      plan.restartContainerIds,
    );
  }
  assert.throws(
    () =>
      new CleanupHostInventory({
        ...plan,
        restartContainerIds: [...plan.restartContainerIds, postgres.Id],
      }).inspect(records, "initial"),
    /binding is invalid/,
  );
});
test("legacy plans remain strict and every unbound or disguised same-label container refuses", () => {
  const { records, plan, postgres, nativePlan: legacy } = bootstrapInventory();
  assert.throws(() =>
    new CleanupHostInventory(legacy).inspect(records, "initial"),
  );
  assert.doesNotThrow(() =>
    new CleanupHostInventory(legacy).inspect(records.slice(0, 2), "initial"),
  );
  for (const changed of [
    { ...postgres, Id: "f".repeat(64) },
    { ...postgres, Image: `sha256:${"f".repeat(64)}` },
    {
      ...postgres,
      Config: {
        ...postgres.Config,
        Labels: {
          ...postgres.Config.Labels,
          "io.reviewrouter.hindsight.role": "worker",
        },
      },
    },
    {
      ...postgres,
      Config: {
        ...postgres.Config,
        Env: [...postgres.Config.Env, "HINDSIGHT_API_WORKER_ENABLED=true"],
      },
    },
    {
      ...postgres,
      HostConfig: { ...postgres.HostConfig, NetworkMode: "bridge" },
    },
    {
      ...postgres,
      HostConfig: { ...postgres.HostConfig, RestartPolicy: { Name: "always" } },
    },
    { ...postgres, Config: { ...postgres.Config, Env: ["PG_MAJOR=16"] } },
    { ...postgres, Config: { ...postgres.Config, Cmd: ["hindsight-api"] } },
  ])
    assert.throws(() =>
      new CleanupHostInventory(plan).inspect(
        [...records.slice(0, 2), changed],
        "initial",
      ),
    );
  assert.throws(() =>
    new CleanupHostInventory({
      ...plan,
      postgresInfrastructure: { ...plan.postgresInfrastructure, port: 55433 },
    }).inspect(records, "initial"),
  );
  assert.throws(() =>
    new CleanupHostInventory(plan).inspect(
      [...records, { ...postgres, Id: "f".repeat(64) }],
      "initial",
    ),
  );
});
test("attested PG binding never hides native-image or actual-database writers elsewhere on the host", () => {
  const { records, native, plan } = bootstrapInventory();
  assert.doesNotThrow(() =>
    new CleanupHostInventory(plan).inspect(
      [
        ...records,
        {
          ...native,
          Id: "f".repeat(64),
          Image: `sha256:${"f".repeat(64)}`,
          Config: { Labels: {}, Cmd: [], Env: undefined },
        } as unknown as CleanupHostInspection,
      ],
      "initial",
    ),
  );
  for (const changed of [
    { ...native, Id: "f".repeat(64), Config: { ...native.Config, Labels: {} } },
    {
      ...native,
      Id: "f".repeat(64),
      Image: `sha256:${"f".repeat(64)}`,
      Config: { ...native.Config, Labels: {} },
    },
    { ...native, Id: "f".repeat(64), Image: `sha256:${"f".repeat(64)}` },
  ])
    assert.throws(() =>
      new CleanupHostInventory(plan).inspect([...records, changed], "initial"),
    );
});
test("PG must retain its original running process through every cleanup phase", () => {
  for (const phase of ["stopped", "restarted"] as const)
    for (const field of [
      "Pid",
      "StartedAt",
      "RestartCount",
      "Running",
    ] as const) {
      const { records, plan, postgres } = bootstrapInventory();
      const inventory = new CleanupHostInventory(plan);
      inventory.inspect(records, "initial");
      const native = records.slice(0, 2).map((record) =>
        phase === "stopped"
          ? {
              ...record,
              State: {
                ...record.State,
                Running: false,
                Pid: 0,
                Status: "exited",
              },
            }
          : record,
      );
      assert.doesNotThrow(() =>
        inventory.inspect([...native, postgres], phase),
      );
      const changed = structuredClone(postgres);
      if (field === "RestartCount") Object.assign(changed, { RestartCount: 1 });
      else
        Object.assign(changed.State, {
          [field]:
            field === "Pid"
              ? 457
              : field === "StartedAt"
                ? "2026-11-01T11:00:00Z"
                : false,
        });
      assert.throws(
        () => inventory.inspect([...native, changed], phase),
        field === "Running"
          ? /Attested PostgreSQL must remain continuously running/
          : /Attested PostgreSQL restarted or changed/,
      );
    }
});
test("cleanup clones inspected model/cache mounts and offline environment without assuming /models", () => {
  const record = api();
  assert.deepEqual(inspectedCleanupMountArguments(record), [
    "--mount",
    "type=bind,src=/srv/operator/snapshots,dst=/snapshots,readonly",
    "--mount",
    "type=volume,src=native-private-cache,dst=/private-model-cache",
  ]);
  const env = inspectedCleanupEnvironment(record);
  assert.equal(env.HF_HOME, "/private-model-cache/huggingface");
  assert.equal(env.TRANSFORMERS_OFFLINE, "1");
  assert.equal(env.UNRELATED_PRIVATE_SETTING, undefined);
  assert.equal(
    env.HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL,
    "/snapshots/embedding",
  );
});
test("unsupported or incomplete inspected mounts refuse before any executor stop", () => {
  const record = api();
  for (const mounts of [
    [],
    record.Mounts!.slice(0, 1),
    record.Mounts!.slice(1),
    [{ ...record.Mounts![0]!, RW: true }, record.Mounts![1]!],
    [
      { ...record.Mounts![0]!, Source: "/srv/model,readonly=false" },
      record.Mounts![1]!,
    ],
    [
      ...record.Mounts!,
      { Type: "bind", Source: "/etc", Destination: "/foreign", RW: false },
    ],
    [
      record.Mounts![0]!,
      { ...record.Mounts![1]!, Name: "cache,volume-opt=other" },
    ],
    [{ ...record.Mounts![0]!, Type: "tmpfs" }, record.Mounts![1]!],
  ])
    assert.throws(() =>
      inspectedCleanupMountArguments({ ...record, Mounts: mounts }),
    );
  assert.deepEqual(
    inspectedCleanupMountArguments({
      ...record,
      Config: {
        ...record.Config,
        Env: [
          "HINDSIGHT_API_EMBEDDINGS_PROVIDER=openai",
          "HINDSIGHT_API_RERANKER_PROVIDER=siliconflow",
        ],
      },
      Mounts: [],
    }),
    [],
  );
});
test("restart readiness uses the inspected private API address and worker command bind", () => {
  const record = api();
  assert.equal(inspectedExecutorHealthBase(record), "http://172.19.0.1:8888");
  const worker = {
    ...record,
    Config: {
      ...record.Config,
      Env: ["HINDSIGHT_API_HOST=0.0.0.0", "HINDSIGHT_API_PORT=8888"],
      Labels: { "io.reviewrouter.hindsight.role": "worker" },
      Cmd: [
        "hindsight-worker",
        "--http-host",
        "127.0.0.1",
        "--http-port",
        "18889",
      ],
    },
  };
  assert.equal(inspectedExecutorHealthBase(worker), "http://127.0.0.1:18889");
  for (const host of [
    "0.0.0.0",
    "8.8.8.8",
    "172.32.0.1",
    "localhost",
    "127.0.0.1/path",
  ])
    assert.throws(
      () =>
        inspectedExecutorHealthBase({
          ...record,
          Config: {
            ...record.Config,
            Env: [`HINDSIGHT_API_HOST=${host}`, "HINDSIGHT_API_PORT=8888"],
          },
        }),
      /inspected explicit private/,
    );
  for (const port of ["", "80", "65536", "8888/path"])
    assert.throws(() =>
      inspectedExecutorHealthBase({
        ...record,
        Config: {
          ...record.Config,
          Env: ["HINDSIGHT_API_HOST=172.19.0.1", `HINDSIGHT_API_PORT=${port}`],
        },
      }),
    );
});
test("cleanup credentials remain in private exclusive environment files bound to the inspected DSN", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-cleanup-private-env-"));
  const secret = "TEST-private-native-database-password";
  try {
    const dsn = `postgresql://native:${secret}@127.0.0.1:5547/native?application_name=rr-native-cleanup-read-observer`;
    const file = await writeCleanupEnvironmentFile(directory, "observer.env", {
      HINDSIGHT_API_DATABASE_URL: dsn,
    });
    assert.equal((await stat(file)).mode & 0o077, 0);
    assert.equal(
      await readFile(file, "utf8"),
      `HINDSIGHT_API_DATABASE_URL=${dsn}\n`,
    );
    const args = nativeSqlArguments(
      dsn,
      `sha256:${"b".repeat(64)}`,
      [{ statement: "SELECT 1" }],
      true,
      file,
    );
    assert(args.includes("--env-file") && args.includes(file));
    assert(!args.join(" ").includes(secret));
    await assert.rejects(
      writeCleanupEnvironmentFile(directory, "observer.env", {
        HINDSIGHT_API_DATABASE_URL: dsn,
      }),
      { code: "EEXIST" },
    );
    await assert.rejects(
      writeCleanupEnvironmentFile(directory, "unsafe.env", {
        HINDSIGHT_API_DATABASE_URL: `${dsn}\nOTHER=unsafe`,
      }),
      /cannot be represented/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
