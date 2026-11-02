import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSandboxMounts,
  assertComposeMemoryEnvironment,
  assertStoppedSelfHostedMemory,
  assertSelfHostedResumeOrigin,
  disposeSelfHostedMemory,
  selfHostedCleanupDiagnostic,
} from "./native-memory-install.ts";
import { validateConfig } from "../../deploy/hindsight/bootstrap.ts";

type Records = Parameters<typeof assertSandboxMounts>[0];
function fixture() {
  const config = {
    deployment: "selfhost-owned",
    modelDirectory: "/private/owned/models",
  } as ReturnType<typeof validateConfig>;
  const state = {
    schema: "reviewrouter-hindsight-bootstrap/v1",
    phase: "running",
    configurationDigest: "binding",
    imageId: "sha256:owned",
    containers: { postgres: "pg", api: "api", worker: "worker" },
  };
  const records = ["postgres", "api", "worker"].map((role) => ({
    Id: state.containers[role as keyof typeof state.containers],
    Config: {
      Labels: { "io.reviewrouter.hindsight.deployment": config.deployment },
    },
    Mounts: [
      {
        Type: "volume",
        Name: `selfhost-owned-${role === "postgres" ? "pg17-data" : "model-cache"}`,
        Source: "/var/lib/docker/volumes/owned",
        Destination:
          role === "postgres"
            ? "/var/lib/postgresql/data"
            : "/var/cache/reviewrouter-models",
        RW: true,
      },
      ...(role === "postgres"
        ? []
        : [
            {
              Type: "bind",
              Source: config.modelDirectory,
              Destination: "/models",
              RW: false,
            },
          ]),
    ],
  })) as unknown as Records;
  return { config, state, records };
}

test("valid exact sandbox mounts pass, an external model directory fails closed", () => {
  const f = fixture();
  assertSandboxMounts(f.records, f.config, f.state);
  const changed = structuredClone(f.records);
  changed[1]!.Mounts[1]!.Source = "/private/foreign/models";
  assert.throws(() => assertSandboxMounts(changed, f.config, f.state));
});
test("unknown mounted volume or writable models cannot be disposed as owned", () => {
  const f = fixture();
  assertSandboxMounts(f.records, f.config, f.state);
  const extra = structuredClone(f.records);
  extra[0]!.Mounts.push({
    Type: "volume",
    Name: "foreign",
    Source: "/foreign",
    Destination: "/extra",
    RW: true,
  });
  assert.throws(() => assertSandboxMounts(extra, f.config, f.state));
  const writable = structuredClone(f.records);
  writable[2]!.Mounts[1]!.RW = true;
  assert.throws(() => assertSandboxMounts(writable, f.config, f.state));
});
test("partial state or relabeled recorded container is preserved", () => {
  const f = fixture();
  assertSandboxMounts(f.records, f.config, f.state);
  assert.throws(() =>
    assertSandboxMounts(f.records, f.config, {
      ...f.state,
      phase: "preparing",
    }),
  );
  const foreign = structuredClone(f.records);
  foreign[1]!.Config.Labels["io.reviewrouter.hindsight.deployment"] = "foreign";
  assert.throws(() => assertSandboxMounts(foreign, f.config, f.state));
});

const settings = {
  REVIEW_ROUTER_MEMORY_PROVIDER: "hindsight",
  REVIEW_ROUTER_MEMORY_ENABLED: "true",
  REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: "hindsight-v1.1.0-chunks-v1",
  REVIEW_ROUTER_MEMORY_NAMESPACE: "sandbox",
  REVIEW_ROUTER_MEMORY_GENERATION: "generation",
  REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://172.17.0.1:8888",
  REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY: "test-private-service-key",
};
const consumers = () =>
  ["web", "api", "worker"].map((role) => ({
    Config: {
      Labels: { "com.docker.compose.service": role },
      Env: Object.entries(settings).map(([key, value]) => `${key}=${value}`),
    },
  }));
test("actual web/API/worker must all receive the same configured memory tuple", () => {
  const records = consumers();
  assertComposeMemoryEnvironment(records, settings);
  records[1]!.Config.Env = records[1]!.Config.Env.filter(
    (value) => !value.startsWith("REVIEW_ROUTER_MEMORY_PROVIDER="),
  );
  assert.throws(() => assertComposeMemoryEnvironment(records, settings));
});
test("credential mismatch fails without printing either service key", () => {
  const records = consumers();
  records[2]!.Config.Env = records[2]!.Config.Env.map((value) =>
    value.startsWith("REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY=")
      ? "REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY=foreign-private-key"
      : value,
  );
  assert.throws(
    () => assertComposeMemoryEnvironment(records, settings),
    (error: unknown) =>
      error instanceof Error &&
      !error.message.includes("private-key") &&
      !error.message.includes(settings.REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY),
  );
});

test("resume stop proof accepts all exact stopped IDs and rejects a partial or live lifecycle", () => {
  const containers = {
    postgres: "1".repeat(64),
    api: "2".repeat(64),
    worker: "3".repeat(64),
  };
  const stopped = Object.values(containers).map((Id) => ({
    Id,
    HostConfig: { RestartPolicy: { Name: "no" } },
    State: {
      Running: false,
      Pid: 0,
      Status: "exited",
      ExitCode: 0,
      Restarting: false,
      Paused: false,
      Dead: false,
    },
  })) as unknown as Records;
  assertStoppedSelfHostedMemory(stopped, containers);
  for (const change of [
    (record: Records[number]) => ({
      ...record,
      State: { ...record.State, Running: true, Pid: 123 },
    }),
    (record: Records[number]) => ({
      ...record,
      State: { ...record.State, Restarting: true },
    }),
    (record: Records[number]) => ({
      ...record,
      HostConfig: { ...record.HostConfig, RestartPolicy: { Name: "always" } },
    }),
    (record: Records[number]) => ({ ...record, Id: "4".repeat(64) }),
  ]) {
    const altered = [...structuredClone(stopped)];
    altered[1] = change(altered[1]!);
    assert.throws(() => assertStoppedSelfHostedMemory(altered, containers));
  }
  assert.throws(() =>
    assertStoppedSelfHostedMemory(stopped.slice(1), containers),
  );
  assert.throws(() =>
    assertStoppedSelfHostedMemory(stopped, {
      ...containers,
      worker: containers.api,
    }),
  );
});

test("explicit resume origin must match the fresh sandbox API binding", () => {
  const environment = "REVIEW_ROUTER_API_BIND=127.0.0.1:14000\n";
  assertSelfHostedResumeOrigin(environment, "http://127.0.0.1:14000");
  for (const origin of [
    "http://127.0.0.1:14001",
    "https://foreign.example",
    "http://127.0.0.1:14000/other",
    "http://127.0.0.1:14000?query=1",
    "http://private:credential@127.0.0.1:14000",
  ])
    assert.throws(() => assertSelfHostedResumeOrigin(environment, origin));
  assert.throws(() =>
    assertSelfHostedResumeOrigin(
      environment + environment,
      "http://127.0.0.1:14000",
    ),
  );
  assert.throws(() =>
    assertSelfHostedResumeOrigin("", "http://127.0.0.1:14000"),
  );
});

test("cleanup ownership refusal exposes only its closed phase and code before any effects", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = await mkdtemp(
    join(tmpdir(), "reviewrouter-self-hosted-e2e-"),
  );
  const sentinel = "foreign-private-credential-material";
  let composeStops = 0;
  try {
    await mkdir(join(directory, "memory-operator"), { mode: 0o700 });
    await writeFile(
      join(directory, "memory-operator/setup-binding.json"),
      sentinel,
      { mode: 0o600 },
    );
    await assert.rejects(
      disposeSelfHostedMemory(directory, () => {
        composeStops++;
      }),
      (error: unknown) => {
        assert.deepEqual(selfHostedCleanupDiagnostic(error), {
          phase: "authority",
          code: "guard_refused",
        });
        assert(!JSON.stringify(error).includes(sentinel));
        assert(error instanceof Error && !error.message.includes(sentinel));
        return true;
      },
    );
    assert.equal(composeStops, 0);
    const hostile = Object.assign(new Error(sentinel), {
      name: sentinel,
      code: sentinel,
    });
    assert.deepEqual(selfHostedCleanupDiagnostic(hostile), {
      phase: "unclassified",
      code: "operation_failed",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
