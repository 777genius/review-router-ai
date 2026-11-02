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

test("completed resume refuses cleanup debt, wrong bindings and unknown volume users before any Docker start", async (t) => {
  const { createServer } = await import("node:http");
  const { randomUUID, createHash } = await import("node:crypto");
  const { resumeNativeDeployment } = await import("./bootstrap-resume.ts");
  const { memoryNativeStartupBindingDigest } =
    await import("../../packages/features/memory/src/application/memory-native-startup.ts");
  for (const failure of ["debt", "binding", "volume-user"] as const)
    await t.test(failure, async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "rr-native-resume-refusal-"),
      );
      const oldPath = process.env.PATH;
      const config = configuration(directory);
      const api = "1".repeat(64),
        worker = "2".repeat(64),
        postgres = "3".repeat(64);
      const pgId = `sha256:${"c".repeat(64)}`;
      const password = "TEST-private-native-resume-password";
      const token = "TEST-private-operator-token-" + randomUUID();
      const database = `postgresql://hindsight:${password}@127.0.0.1:5547/hindsight`;
      const apiEnv = { HINDSIGHT_API_DATABASE_URL: database };
      const pgEnv = { POSTGRES_PASSWORD: password };
      const binding = {
        namespace: config.namespace,
        generation: config.generation,
        imageDigest: imageId,
        profile: "hindsight-v1.1.0-chunks-v1",
        endpointDigest: createHash("sha256")
          .update(JSON.stringify("http://172.17.0.1:8888"))
          .digest("hex"),
      };
      let requests = 0;
      const server = createServer((_request, response) => {
        requests++;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            binding:
              failure === "binding"
                ? { ...binding, endpointDigest: "f".repeat(64) }
                : binding,
            bindingDigest: memoryNativeStartupBindingDigest(binding),
            generation: config.generation,
            epoch: "0",
            paused: false,
            owner: null,
            cleanupDebt: failure === "debt",
          }),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const address = server.address();
        assert(address && typeof address !== "string");
        const settings = (values: Record<string, string>) =>
          Object.entries(values)
            .map(([k, v]) => `${k}=${v}\n`)
            .join("");
        await writeFile(
          join(directory, "router.env"),
          settings({
            REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: binding.profile,
            REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://172.17.0.1:8888",
            REVIEW_ROUTER_MEMORY_GENERATION: config.generation,
            REVIEW_ROUTER_MEMORY_NAMESPACE: config.namespace,
            REVIEW_ROUTER_MEMORY_HINDSIGHT_IMAGE_DIGEST: imageId,
            REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN: token,
          }),
          { mode: 0o600 },
        );
        await writeFile(
          join(directory, "operator.env"),
          settings({ REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN: token }),
          { mode: 0o600 },
        );
        for (const role of ["api", "worker", "postgres"])
          await writeFile(
            join(directory, `${role}.env`),
            settings(role === "postgres" ? pgEnv : apiEnv),
            { mode: 0o600 },
          );
        const volume = (name: string, destination: string) => ({
          Type: "volume",
          Name: name,
          Source: `/volumes/${name}`,
          Destination: destination,
          RW: true,
        });
        const pgName = `${config.deployment}-pg17-data`,
          cacheName = `${config.deployment}-model-cache`;
        const records = [
          {
            Id: api,
            Name: `/${config.deployment}-api`,
            Image: imageId,
            Config: {
              Env: settings(apiEnv).trim().split("\n"),
              Cmd: ["hindsight-api"],
              Entrypoint: ["entry"],
              User: "1000",
              Labels: {
                "io.reviewrouter.hindsight.deployment": config.deployment,
                "io.reviewrouter.hindsight.role": "api",
              },
            },
            Mounts: [volume(cacheName, "/var/cache/reviewrouter-models")],
          },
          {
            Id: worker,
            Name: `/${config.deployment}-worker`,
            Image: imageId,
            Config: {
              Env: settings(apiEnv).trim().split("\n"),
              Cmd: [
                "hindsight-worker",
                "--http-host",
                "127.0.0.1",
                "--http-port",
                "8889",
              ],
              Entrypoint: ["entry"],
              User: "1000",
              Labels: {
                "io.reviewrouter.hindsight.deployment": config.deployment,
                "io.reviewrouter.hindsight.role": "worker",
              },
            },
            Mounts: [volume(cacheName, "/var/cache/reviewrouter-models")],
          },
          {
            Id: postgres,
            Name: `/${config.deployment}-postgres`,
            Image: pgId,
            Config: {
              Env: ["PG_MAJOR=17", ...settings(pgEnv).trim().split("\n")],
              Cmd: [
                "-p",
                "5547",
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
              Entrypoint: ["docker-entrypoint.sh"],
              User: "",
              Labels: {
                "io.reviewrouter.hindsight.deployment": config.deployment,
              },
            },
            Mounts: [volume(pgName, "/var/lib/postgresql/data")],
          },
          ...(failure === "volume-user"
            ? [
                {
                  Id: "4".repeat(64),
                  Image: `sha256:${"d".repeat(64)}`,
                  Config: { Env: [], Labels: {} },
                  Mounts: [volume(pgName, "/foreign")],
                },
              ]
            : []),
        ].map((record) => ({
          ...record,
          HostConfig: { NetworkMode: "host", RestartPolicy: { Name: "no" } },
          State: {
            Status: "exited",
            Running: false,
            Pid: 0,
            Dead: false,
            Paused: false,
            Restarting: false,
          },
        }));
        const fixture = {
          records,
          images: {
            [imageId]: {
              Id: imageId,
              Config: { Env: [], Entrypoint: ["entry"], User: "1000" },
            },
            [postgresImage]: {
              Id: pgId,
              Config: {
                Env: ["PG_MAJOR=17"],
                Entrypoint: ["docker-entrypoint.sh"],
                User: "",
              },
            },
          },
          volumes: Object.fromEntries(
            [pgName, cacheName].map((name) => [
              name,
              {
                Name: name,
                Driver: "local",
                Scope: "local",
                Options: null,
                Labels: {
                  "io.reviewrouter.hindsight.deployment": config.deployment,
                },
                Mountpoint: `/volumes/${name}`,
              },
            ]),
          ),
        };
        await writeFile(
          join(directory, "fixture.json"),
          JSON.stringify(fixture),
        );
        await writeFile(
          join(directory, "driver.mjs"),
          `import fs from 'node:fs'; const root=import.meta.dirname;const data=JSON.parse(fs.readFileSync(root+'/fixture.json'));const a=process.argv.slice(2);fs.appendFileSync(root+'/calls',JSON.stringify(a)+'\\n');let v;if(a[0]==='ps')process.stdout.write(data.records.map(r=>r.Id).join('\\n'));else{if(a[0]==='inspect')v=data.records.filter(r=>r.Id===a[1]);else if(a[0]==='image')v=[data.images[a[2]]];else if(a[0]==='volume')v=[data.volumes[a[2]]];else process.exit(90);process.stdout.write(JSON.stringify(v));}`,
        );
        await writeFile(
          join(directory, "docker"),
          `#!/bin/sh\nexec '${process.execPath}' '${join(directory, "driver.mjs")}' "$@"\n`,
          { mode: 0o700 },
        );
        process.env.PATH = `${directory}:${oldPath ?? ""}`;
        const state = {
          schema: "reviewrouter-hindsight-bootstrap/v1" as const,
          configurationDigest: "a".repeat(64),
          imageId,
          phase: "running" as const,
          routerEnvironmentDigest: "a".repeat(64),
          containers: { api, worker, postgres },
        };
        await assert.rejects(
          resumeNativeDeployment(
            config,
            state,
            `http://127.0.0.1:${address.port}`,
            { assertHeld: async () => {} },
            async () => {
              throw new Error("unexpected readiness");
            },
          ),
        );
        const calls = await readFile(join(directory, "calls"), "utf8");
        assert(
          !calls.includes('"start"') &&
            !calls.includes('"run"') &&
            !calls.includes(password) &&
            !calls.includes(token),
        );
        assert.equal(requests, failure === "volume-user" ? 0 : 1);
        await assert.rejects(readFile(join(directory, "resume-attempt.json")), {
          code: "ENOENT",
        });
      } finally {
        if (oldPath === undefined) delete process.env.PATH;
        else process.env.PATH = oldPath;
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        await rm(directory, { recursive: true, force: true });
      }
    });
});
