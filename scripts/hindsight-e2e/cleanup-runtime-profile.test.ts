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
