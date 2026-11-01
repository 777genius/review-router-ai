import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  bootstrap,
  bootstrapDatabaseSql,
  parseInferenceEnv,
  validateConfig,
} from "./bootstrap.ts";
import { dockerCommand } from "../../scripts/hindsight-e2e/native-runtime.ts";
import { nativeSqlArguments } from "../../scripts/hindsight-e2e/operator-host.ts";

const imageId = `sha256:${"a".repeat(64)}`;
const postgresImage = `pgvector/pgvector@sha256:${"b".repeat(64)}`;
const inference = [
  "HINDSIGHT_API_LLM_PROVIDER=none",
  "HINDSIGHT_API_EMBEDDINGS_PROVIDER=local",
  "HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=reviewed-embedding-model",
  "HINDSIGHT_API_EMBEDDINGS_LOCAL_API_KEY=private-test-key",
  "HINDSIGHT_API_RERANKER_PROVIDER=local",
  "HINDSIGHT_API_RERANKER_LOCAL_MODEL=reviewed-reranker-model",
].join("\n");
test("credential SQL and provenance DSNs never enter spawned Docker arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-bootstrap-credentials-"));
  const previousPath = process.env.PATH;
  const password = "TEST-private-bootstrap-password-52dcb";
  const databaseUrl = `postgresql://hindsight:${password}@127.0.0.1:15547/hindsight`;
  try {
    const argvFile = join(directory, "argv");
    const inputFile = join(directory, "stdin");
    // Observe the actual child argv/stdin boundary without a Docker daemon.
    const executable = join(directory, "docker");
    await writeFile(
      executable,
      `#!/bin/sh\nprintf '%s\\n' "$@" > '${argvFile}'\ncat > '${inputFile}'\nprintf 'accepted\\n'\n`,
      { mode: 0o700 },
    );
    process.env.PATH = `${directory}:${previousPath ?? ""}`;
    const statement = `CREATE ROLE hindsight LOGIN PASSWORD '${password}';`;
    assert.equal(
      await bootstrapDatabaseSql("test-postgres", 15547, "postgres", statement),
      "accepted\n",
    );
    const sqlArgs = await readFile(argvFile, "utf8");
    assert(
      sqlArgs.includes("--interactive\n") && sqlArgs.includes("--file=-\n"),
    );
    assert(!sqlArgs.includes(password));
    assert.equal(await readFile(inputFile, "utf8"), statement);
    for (const readOnly of [true, false]) {
      const environment = join(
        directory,
        readOnly ? "observer.env" : "admin.env",
      );
      const dsn = new URL(databaseUrl);
      dsn.searchParams.set(
        "application_name",
        readOnly
          ? "rr-native-cleanup-read-observer"
          : "rr-native-provenance-admin",
      );
      await writeFile(environment, `HINDSIGHT_API_DATABASE_URL=${dsn}\n`, {
        mode: 0o600,
      });
      assert.equal(
        await dockerCommand(
          nativeSqlArguments(
            databaseUrl,
            imageId,
            [{ statement: "SELECT 1" }],
            readOnly,
            environment,
          ),
        ),
        "accepted\n",
      );
      const provenanceArgs = await readFile(argvFile, "utf8");
      assert(provenanceArgs.includes(`--env-file\n${environment}\n`));
      assert(!provenanceArgs.includes(password));
      await chmod(environment, 0o644);
      assert.throws(
        () =>
          nativeSqlArguments(
            databaseUrl,
            imageId,
            [{ statement: "SELECT 1" }],
            readOnly,
            environment,
          ),
        /private regular file/,
      );
      await chmod(environment, 0o600);
      await writeFile(
        environment,
        `HINDSIGHT_API_DATABASE_URL=${databaseUrl}\n`,
      );
      assert.throws(
        () =>
          nativeSqlArguments(
            databaseUrl,
            imageId,
            [{ statement: "SELECT 1" }],
            readOnly,
            environment,
          ),
        /differs from the bound database endpoint/,
      );
    }
    await writeFile(
      executable,
      `#!/bin/sh\nprintf '${password}' >&2\nexit 9\n`,
      { mode: 0o700 },
    );
    await assert.rejects(
      bootstrapDatabaseSql("test-postgres", 15547, "postgres", statement),
      (error: unknown) =>
        error instanceof Error &&
        !error.message.includes(password) &&
        error.message.includes("diagnostic payload suppressed"),
    );
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
function configuration(directory = "/srv/memory") {
  return {
    deployment: "test-memory",
    directory,
    image: imageId,
    postgresImage,
    qualificationEvidence: join(directory, "qualification.json"),
    inferenceEnvFile: join(directory, "inference.env"),
    namespace: "test",
    generation: "test-v1",
    apiBindHost: "172.17.0.1",
    apiPort: 8888,
    postgresPort: 5547,
    workerPort: 8889,
  };
}
test("native ingress must be explicitly private and images immutable", () => {
  assert.deepEqual(validateConfig(configuration()), configuration());
  for (const host of [
    "0.0.0.0",
    "8.8.8.8",
    "172.32.0.1",
    "example.com",
    "",
    "::",
  ])
    assert.throws(
      () => validateConfig({ ...configuration(), apiBindHost: host }),
      /apiBindHost/,
    );
  for (const host of ["127.0.0.1", "10.2.3.4", "192.168.2.4", "172.31.0.1"])
    assert.equal(
      validateConfig({ ...configuration(), apiBindHost: host }).apiBindHost,
      host,
    );
  assert.throws(
    () => validateConfig({ ...configuration(), image: "hindsight:latest" }),
    /immutable/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...configuration(),
        postgresImage: "pgvector/pgvector:pg17",
      }),
    /immutable/,
  );
  assert.throws(
    () => validateConfig({ ...configuration(), workerPort: 8888 }),
    /distinct/,
  );
});
test("inference file cannot override storage, privacy or execution ownership", () => {
  assert.equal(
    parseInferenceEnv(inference).HINDSIGHT_API_EMBEDDINGS_PROVIDER,
    "local",
  );
  for (const extra of [
    "HINDSIGHT_API_DATABASE_URL=postgresql://other/native",
    "HINDSIGHT_API_LLM_TRACE_ENABLED=true",
    "HINDSIGHT_API_LLM_DEBUG_DUMP_4XX=true",
    "HINDSIGHT_API_WORKER_ENABLED=true",
    "HINDSIGHT_API_LLM_PROVIDER=openai",
    "HINDSIGHT_API_RETAIN_LLM_PROVIDER=openai",
    "HINDSIGHT_API_LLM_2_PROVIDER=openai",
    "HINDSIGHT_API_LLM_BASE_URL=https://example.com",
  ])
    assert.throws(() => parseInferenceEnv(`${inference}\n${extra}`));
  assert.throws(
    () => parseInferenceEnv("HINDSIGHT_API_LLM_PROVIDER=none"),
    /EMBEDDINGS/,
  );
});
test("planning binds exact native evidence without creating deployment state or revealing credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-memory-bootstrap-"));
  try {
    const config = configuration(directory);
    await writeFile(config.inferenceEnvFile, inference, { mode: 0o600 });
    await writeFile(
      config.qualificationEvidence,
      JSON.stringify({
        schema: "hindsight-native-qualification/v1",
        nativeRevision: "a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5",
        imageId,
        postgresImage,
        completedAt: new Date().toISOString(),
      }),
    );
    const result = await bootstrap("plan", config);
    assert.equal(JSON.stringify(result).includes("private-test-key"), false);
    await assert.rejects(readFile(join(directory, "bootstrap-state.json")), {
      code: "ENOENT",
    });
    await writeFile(
      config.qualificationEvidence,
      JSON.stringify({
        schema: "hindsight-native-qualification/v1",
        nativeRevision: "a5a619b5ca59c5c39e0f96be6f7a31fabd136bd5",
        imageId,
        postgresImage: "other-image",
        completedAt: new Date().toISOString(),
      }),
    );
    await assert.rejects(
      bootstrap("plan", config),
      /exact-image native qualification/,
    );
    await chmod(config.inferenceEnvFile, 0o644);
    await assert.rejects(bootstrap("plan", config), /mode0600/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
