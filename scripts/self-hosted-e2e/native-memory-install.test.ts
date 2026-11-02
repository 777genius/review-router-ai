import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertSandboxMounts,
  assertComposeMemoryEnvironment,
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
