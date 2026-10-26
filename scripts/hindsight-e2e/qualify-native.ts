import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startProviderStub, privacySentinel } from "./provider-stub.ts";
import { nativeRevision } from "./prepare-hardening.ts";
import {
  dockerCommand as command,
  eventually,
  freePort,
  pause,
} from "./native-runtime.ts";
import { qualifyProductionAdapter } from "./production-adapter-story.ts";
import { qualifyProductionCleanup } from "./production-cleanup-story.ts";
import { assertNativeOperationAbsent } from "./native-http.ts";

type Operation = {
  operation_id: string;
  status: string;
  task_payload?: unknown;
  error_message?: string | null;
  child_operations?: Operation[];
  result_metadata?: unknown;
};
type Fact = {
  id: string;
  text: string;
  document_id?: string;
  mentioned_at?: string;
  occurred_start?: string;
  state?: string;
  tags?: string[];
};
type NativeList<T> = { items: T[]; total: number };
type Document = { original_text: string; tags: string[] };
export async function qualifyNative() {
  const image = process.env.HINDSIGHT_QUALIFICATION_IMAGE;
  const postgresImage = process.env.HINDSIGHT_QUALIFICATION_POSTGRES_IMAGE;
  if (!image || !postgresImage?.includes("@sha256:"))
    throw new Error(
      "Set derivative image and digest-pinned PostgreSQL17/pgvector image",
    );
  const output = resolve(
    process.env.HINDSIGHT_QUALIFICATION_OUTPUT ?? "tmp/hindsight-qualification",
  );
  await mkdir(output, { recursive: true });
  const stub = await startProviderStub();
  const run = `rr-hs-${randomUUID().slice(0, 8)}`;
  const pg = `${run}-postgres`;
  const dbPort = await freePort();
  const apiPort = await freePort();
  const workerPort = await freePort();
  const oldWorkerPort = await freePort();
  const serviceKey = `${privacySentinel}_SERVICE_KEY`;
  const password = `${privacySentinel}_DATABASE_PASSWORD`;
  const label = `io.reviewrouter.hindsight.qualification=${run}`;
  const containers = new Set<string>();
  const checkpoints: string[] = [];
  const errors: string[] = [];
  const retainedLogs: string[] = [];
  const startedAt = new Date().toISOString();
  const imageId = (
    await command(["image", "inspect", "--format", "{{.Id}}", image])
  ).trim();
  const sourceRevision = (
    await command([
      "image",
      "inspect",
      "--format",
      '{{index .Config.Labels "io.reviewrouter.hindsight.source-revision"}}',
      image,
    ])
  ).trim();
  assert.equal(
    sourceRevision,
    nativeRevision,
    "Derivative image has an unreviewed source identity",
  );
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  const env: Record<string, string> = {
    HINDSIGHT_API_DATABASE_SCHEMA: "public",
    HINDSIGHT_API_TENANT_EXTENSION:
      "hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension",
    HINDSIGHT_API_TENANT_API_KEY: serviceKey,
    HINDSIGHT_API_WORKER_ENABLED: "false",
    HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP: "false",
    HINDSIGHT_API_OPERATION_RETENTION_DAYS: "0",
    HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS: "0",
    HINDSIGHT_API_LLM_PROVIDER: "openai",
    HINDSIGHT_API_LLM_MODEL: "stub-model",
    HINDSIGHT_API_LLM_API_KEY: `${privacySentinel}_LLM_KEY`,
    HINDSIGHT_API_LLM_BASE_URL: `${stub.url}/v1`,
    HINDSIGHT_API_EMBEDDINGS_PROVIDER: "openai",
    HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: "stub-embeddings",
    HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY: `${privacySentinel}_EMBEDDING_KEY`,
    HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL: `${stub.url}/v1`,
    HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS: "384",
    HINDSIGHT_API_RERANKER_PROVIDER: "siliconflow",
    HINDSIGHT_API_RERANKER_SILICONFLOW_MODEL: "stub-reranker",
    HINDSIGHT_API_RERANKER_SILICONFLOW_API_KEY: `${privacySentinel}_RERANK_KEY`,
    HINDSIGHT_API_RERANKER_SILICONFLOW_BASE_URL: stub.url,
    HINDSIGHT_API_LLM_MAX_RETRIES: "0",
    HINDSIGHT_API_EMBEDDINGS_MAX_RETRIES: "0",
    HINDSIGHT_API_RERANKER_MAX_RETRIES: "0",
    HINDSIGHT_API_WORKER_MAX_RETRIES: "0",
    HINDSIGHT_API_WORKER_POLL_INTERVAL_MS: "200",
    HINDSIGHT_API_DB_POOL_MIN_SIZE: "1",
    HINDSIGHT_API_DB_POOL_MAX_SIZE: "4",
    HINDSIGHT_API_CONSOLIDATION_USE_DECISION_MODEL: "false",
    HINDSIGHT_API_MAINTENANCE_START_JITTER_SECONDS: "0",
    HINDSIGHT_API_LLM_TRACE_ENABLED: "false",
    HINDSIGHT_API_OTEL_TRACES_ENABLED: "false",
    HINDSIGHT_API_AUDIT_LOG_ENABLED: "false",
    HINDSIGHT_API_LLM_DEBUG_DUMP_4XX: "false",
    HINDSIGHT_API_XAI_OAUTH_DEBUG_HEADERS: "false",
    HINDSIGHT_API_MCP_ENABLED: "false",
    HINDSIGHT_API_ENABLE_FILE_UPLOAD_API: "false",
    HINDSIGHT_API_ACCESS_LOG: "false",
    HINDSIGHT_API_FAIL_ON_EXTRACTION_ERRORS: "true",
    HINDSIGHT_API_TEXT_SEARCH_EXTENSION: "native",
    HINDSIGHT_API_BANK_STATS_CACHE_TTL_SECONDS: "0",
  };
  const cleanupEnv = {
    HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS: "0",
    HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS: "0",
    HINDSIGHT_API_RETENTION_SWEEP_INTERVAL_SECONDS: "0",
    HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS: "0",
  };
  const databaseUrl = `postgresql://hindsight:${password}@127.0.0.1:${dbPort}/hindsight`;
  const sql = async (statement: string, database = "hindsight") =>
    (
      await command([
        "exec",
        pg,
        "psql",
        "-U",
        "postgres",
        "-p",
        String(dbPort),
        "-d",
        database,
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        statement,
      ])
    ).trim();
  const base = `http://127.0.0.1:${apiPort}`;
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    expected = 200,
  ): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (response.status >= 400) {
      errors.push(text);
      assert(
        !text.includes(privacySentinel),
        "Native HTTP error leaked a synthetic private sentinel",
      );
    }
    assert.equal(
      response.status,
      expected,
      `${method} ${path} returned unexpected HTTP status; body suppressed`,
    );
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }
  const bank = `${run}-workspace-a`;
  const otherBank = `${run}-workspace-b`;
  const path = (suffix: string, selectedBank = bank) =>
    `/v1/default/banks/${selectedBank}${suffix}`;
  async function nativeContainer(
    name: string,
    args: string[],
    extra: Record<string, string> = {},
  ) {
    containers.add(name);
    const settings = {
      ...env,
      HINDSIGHT_API_DATABASE_URL: `${databaseUrl}?application_name=${name}`,
      HINDSIGHT_API_WORKER_ID: name,
      ...extra,
    };
    const role =
      name === `${run}-api`
        ? "api"
        : name === `${run}-worker` || name === `${run}-old-worker`
          ? "worker"
          : undefined;
    await command([
      "run",
      "--detach",
      "--name",
      name,
      "--network",
      "host",
      "--label",
      label,
      ...(role
        ? [
            "--label",
            `io.reviewrouter.hindsight.deployment=${run}`,
            "--label",
            `io.reviewrouter.hindsight.role=${role}`,
            "--restart",
            "no",
          ]
        : []),
      ...Object.entries(settings).flatMap(([key, value]) => [
        "--env",
        `${key}=${value}`,
      ]),
      imageId,
      ...args,
    ]);
    assert.equal(
      (await command(["inspect", "--format", "{{.Image}}", name])).trim(),
      imageId,
    );
  }
  async function ready(port: number) {
    await eventually(
      async () => {
        try {
          const response = await fetch(
            `http://127.0.0.1:${port}/health/ready`,
            { signal: AbortSignal.timeout(1000) },
          );
          return response.ok ? true : undefined;
        } catch {
          return undefined;
        }
      },
      "process readiness",
      120_000,
    );
  }
  async function settled(id: string, expected = "completed") {
    const operation = await eventually(async () => {
      const state = await request<Operation>(path(`/operations/${id}`));
      return ["completed", "failed", "cancelled"].includes(state.status)
        ? state
        : undefined;
    }, "native operation settlement");
    assert.equal(
      operation.status,
      expected,
      "Native operation ended unexpectedly; raw error suppressed",
    );
    for (const child of operation.child_operations ?? [])
      assert.equal(
        child.status,
        expected,
        "Parent terminal state hid a nonterminal child",
      );
    assert(
      !JSON.stringify({
        error: operation.error_message,
        children: operation.child_operations,
        metadata: operation.result_metadata,
      }).includes(privacySentinel),
      "Native stored error or parent copy leaked private content",
    );
    return operation;
  }
  const retainedIds: string[] = [];
  async function retain(
    document: string,
    content: string,
    timestamp = "2026-01-02T03:04:05Z",
    selectedBank = bank,
    id = randomUUID(),
  ) {
    await request(path("/memories", selectedBank), "POST", {
      items: [
        {
          document_id: document,
          content,
          timestamp,
          tags: ["kind:rule", "topic:one"],
          strategy: "router-approved-v1",
          update_mode: "replace",
          observation_scopes: [["kind:rule"]],
        },
      ],
      async: true,
      operation_id: id,
    });
    if (selectedBank === bank) retainedIds.push(id);
    return id;
  }
  async function stopNative(names: readonly string[]) {
    for (const name of names) {
      await command(["stop", "--time", "10", name]);
      const state = JSON.parse(
        await command(["inspect", "--format", "{{json .State}}", name]),
      ) as { Running: boolean; Pid: number; Status: string };
      assert.equal(state.Running, false);
      assert.equal(state.Pid, 0);
      assert.equal(state.Status, "exited");
    }
    assert.equal(
      await sql(
        `SELECT count(*) FROM pg_stat_activity WHERE application_name IN (${names.map((name) => `'${name}'`).join(",")})`,
      ),
      "0",
      "Exited executors retained database sessions",
    );
  }
  try {
    containers.add(pg);
    await command([
      "run",
      "--detach",
      "--name",
      pg,
      "--network",
      "host",
      "--label",
      label,
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      postgresImage,
      "-p",
      String(dbPort),
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
    ]);
    await eventually(
      async () =>
        (
          await command(
            ["exec", pg, "pg_isready", "-U", "postgres", "-p", String(dbPort)],
            true,
          )
        ).includes("accepting connections")
          ? true
          : undefined,
      "PostgreSQL17 startup",
    );
    const pgExec = async (statement: string, database = "postgres") =>
      (
        await command([
          "exec",
          pg,
          "psql",
          "-U",
          "postgres",
          "-p",
          String(dbPort),
          "-d",
          database,
          "-At",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          statement,
        ])
      ).trim();
    await pgExec(`CREATE ROLE hindsight LOGIN PASSWORD '${password}'`);
    await pgExec("CREATE DATABASE hindsight OWNER hindsight");
    await pgExec(
      "CREATE EXTENSION vector; CREATE EXTENSION pg_trgm",
      "hindsight",
    );
    assert.equal(
      await pgExec("SELECT rolsuper FROM pg_roles WHERE rolname='hindsight'"),
      "f",
    );
    for (const [setting, expected] of Object.entries({
      log_min_messages: "panic",
      log_min_error_statement: "panic",
      log_parameter_max_length: "0",
      log_parameter_max_length_on_error: "0",
      log_statement: "none",
    }))
      assert.equal(await pgExec(`SHOW ${setting}`), expected);
    await nativeContainer(
      `${run}-migrate`,
      ["hindsight-admin", "run-db-migration"],
      cleanupEnv,
    );
    const migrateStatus = (await command(["wait", `${run}-migrate`])).trim();
    assert.equal(migrateStatus, "0", "Bounded native migration job failed");
    retainedLogs.push(await command(["logs", `${run}-migrate`], true));
    await command(["rm", `${run}-migrate`]);
    containers.delete(`${run}-migrate`);
    const normal = [
      `${run}-api`,
      `${run}-worker`,
      `${run}-old-worker`,
    ] as const;
    await nativeContainer(normal[0], ["hindsight-api"], {
      HINDSIGHT_API_HOST: "127.0.0.1",
      HINDSIGHT_API_PORT: String(apiPort),
    });
    await ready(apiPort);
    await nativeContainer(normal[1], [
      "hindsight-worker",
      "--http-host",
      "127.0.0.1",
      "--http-port",
      String(workerPort),
    ]);
    await ready(workerPort);
    await nativeContainer(normal[2], [
      "hindsight-worker",
      "--http-host",
      "127.0.0.1",
      "--http-port",
      String(oldWorkerPort),
    ]);
    await ready(oldWorkerPort);
    for (const name of normal) {
      const retention = JSON.parse(
        await command([
          "exec",
          name,
          "python",
          "-c",
          "import json; from hindsight_api.config import get_config; c=get_config(); print(json.dumps([c.operation_retention_days,c.operation_cleanup_interval_seconds]))",
        ]),
      );
      assert.deepEqual(
        retention,
        [0, 0],
        "All executors must preserve native operation UUID replay authority",
      );
    }
    checkpoints.push(
      "all-native-executors-operation-pruning-disabled-for-bounded-stable-uuid-recovery",
    );
    const adapter = await qualifyProductionAdapter(base, serviceKey, run);
    checkpoints.push(...adapter.checkpoints);
    checkpoints.push(
      ...(await qualifyProductionCleanup({
        base,
        serviceKey,
        imageDigest: imageId,
        run,
        output,
        normalContainerNames: normal,
        stub,
      })),
    );
    for (const selectedBank of [bank, otherBank]) {
      await request(`/v1/default/banks/${selectedBank}`, "PUT", {
        name: "Synthetic qualification bank",
      });
      await request(path("/config", selectedBank), "PATCH", {
        updates: {
          retain_strategies: {
            "router-approved-v1": { retain_extraction_mode: "chunks" },
          },
          retain_default_strategy: "router-approved-v1",
          enable_observations: false,
          enable_auto_consolidation: false,
          default_observation_scopes: [["kind:rule"]],
        },
      });
      const config = await request<{
        config: {
          retain_strategies: Record<string, { retain_extraction_mode: string }>;
        };
      }>(path("/config", selectedBank));
      assert.equal(
        config.config.retain_strategies["router-approved-v1"]!
          .retain_extraction_mode,
        "chunks",
      );
    }
    const document = `${run}-entry`;
    const text = `Use transactional writes for ревью.\n${privacySentinel} approved distilled statement.`;
    const first = await retain(document, text);
    await settled(first);
    assert.equal(
      (await request<Document>(path(`/documents/${document}`))).original_text,
      text,
    );
    const facts = await request<NativeList<Fact>>(
      path(`/memories/list?document_id=${document}&limit=100`),
    );
    assert(facts.items.length > 0);
    assert(
      facts.items.every(
        (fact) =>
          fact.text.includes("Use transactional writes") ||
          fact.text.includes(privacySentinel),
      ),
    );
    await retain(document, text, "2026-01-02T03:04:05Z", bank, first);
    assert.equal(
      (
        await request<NativeList<Fact>>(
          path(`/memories/list?document_id=${document}&limit=100`),
        )
      ).total,
      facts.total,
    );
    await request(
      path(`/documents/${document}`, otherBank),
      "GET",
      undefined,
      404,
    );
    const otherRecall = await request<{ results: Fact[] }>(
      path("/memories/recall", otherBank),
      "POST",
      { query: text, types: ["world"], budget: "low", include: {} },
    );
    assert.equal(otherRecall.results.length, 0);
    checkpoints.push(
      "real-native-api-separate-overlapping-workers-pg17-nonsuperuser",
      "named-chunks-normalized-body-readback",
      "same-uuid-idempotence",
      "native-bank-isolation",
    );

    const nativeTime = facts.items
      .map((fact) => [fact.id, fact.mentioned_at, fact.occurred_start])
      .sort();
    await settled(await retain(document, text, "2026-09-09T01:02:03Z"));
    const unchanged = await request<NativeList<Fact>>(
      path(`/memories/list?document_id=${document}&limit=100`),
    );
    assert.deepEqual(
      unchanged.items
        .map((fact) => [fact.id, fact.mentioned_at, fact.occurred_start])
        .sort(),
      nativeTime,
      "Same-body reapproval counterfeited a new native event time",
    );
    await request(path(`/documents/${document}`), "PATCH", {
      tags: ["kind:rule", "topic:two"],
      observation_scopes: [["kind:rule"]],
    });
    assert.deepEqual(
      new Set((await request<Document>(path(`/documents/${document}`))).tags),
      new Set(["kind:rule", "topic:two"]),
    );
    await settled(await retain(document, "Use the current replacement rule."));
    assert.equal(
      (await request<Document>(path(`/documents/${document}`))).original_text,
      "Use the current replacement rule.",
    );
    const currentFacts = await request<NativeList<Fact>>(
      path(`/memories/list?document_id=${document}`),
    );
    for (const fact of currentFacts.items)
      await request(path(`/memories/${fact.id}`), "PATCH", {
        state: "invalidated",
        reason: "synthetic authorized retirement",
      });
    const recalledRetired = await request<{ results: Fact[] }>(
      path("/memories/recall"),
      "POST",
      {
        query: "current replacement rule",
        types: ["world"],
        budget: "low",
        include: {},
      },
    );
    assert.equal(
      recalledRetired.results.length,
      0,
      "Invalidated source facts re-entered recall",
    );
    assert.equal(
      (await request<Document>(path(`/documents/${document}`))).original_text,
      "Use the current replacement rule.",
    );
    checkpoints.push(
      "same-body-preserves-native-event-time",
      "topic-move-reserved-kind-preserved",
      "online-replacement-and-all-fact-retirement",
    );

    for (const mode of ["echo400", "echo500"] as const) {
      stub.setMode(mode);
      const failed = await retain(
        `${run}-${mode}`,
        `${privacySentinel} private failing approved statement`,
      );
      await settled(failed, "failed");
      await request(
        path("/memories/recall"),
        "POST",
        {
          query: `${privacySentinel} private recall query`,
          types: ["world"],
          budget: "low",
        },
        500,
      );
      stub.setMode("normal");
    }
    await request(
      path("/memories"),
      "POST",
      {
        items: [
          { content: text, timestamp: `${privacySentinel} invalid timestamp` },
        ],
      },
      422,
    );
    await request(path("/config"), "PATCH", {
      updates: { enable_observations: true, enable_auto_consolidation: true },
    });
    // Native 1.1.0 caches bank config for 30 seconds in each process. The API
    // edit only invalidates its own cache; a worker that retained while these
    // flags were false can otherwise skip enqueueing this probe permanently
    // until the separate 300-second reconciliation tick. Restart both existing
    // workers after the edit so this fault probe observes the new bank config.
    // Docker restart preserves their immutable image, identity and environment.
    await command(["restart", "--time", "10", normal[1], normal[2]]);
    await ready(workerPort);
    await ready(oldWorkerPort);
    checkpoints.push(
      "all-native-worker-config-caches-refreshed-before-malformed-consolidation-probe",
    );
    stub.setMode("malformed");
    const beforeMalformed = stub.calls.consolidation;
    await settled(
      await retain(
        `${run}-malformed`,
        `${privacySentinel} approved malformed consolidation fixture`,
      ),
    );
    await eventually(
      async () =>
        stub.calls.consolidation > beforeMalformed ? true : undefined,
      "malformed native consolidation response",
    );
    await eventually(async () => {
      const page = await request<{ operations: Operation[] }>(
        path("/operations?type=consolidation&limit=100"),
      );
      assert(
        !JSON.stringify(page).includes(privacySentinel),
        "Malformed model output leaked into operation errors",
      );
      return page.operations.length &&
        page.operations.every((operation) =>
          ["completed", "failed", "cancelled"].includes(operation.status),
        )
        ? true
        : undefined;
    }, "malformed consolidation settlement");
    stub.setMode("normal");
    await request(path("/config"), "PATCH", {
      updates: { enable_observations: false, enable_auto_consolidation: false },
    });
    const inspectSinks = async () => {
      const counts = JSON.parse(
        await sql(
          "SELECT json_build_object('audit_rows',(SELECT count(*) FROM audit_log),'llm_rows',(SELECT count(*) FROM llm_requests),'unsafe_errors',(SELECT count(*) FROM async_operations WHERE error_message LIKE '%RR_NATIVE_PRIVATE_%' OR result_metadata::text LIKE '%RR_NATIVE_PRIVATE_%'))",
        ),
      ) as { audit_rows: number; llm_rows: number; unsafe_errors: number };
      assert.deepEqual(counts, {
        audit_rows: 0,
        llm_rows: 0,
        unsafe_errors: 0,
      });
      return counts;
    };
    await inspectSinks();
    checkpoints.push(
      "provider-4xx-5xx-http-validation-parent-child-error-sinks-private",
      "malformed-consolidation-output-sinks-private",
    );

    stub.setMode("hold");
    const late = await retain(
      document,
      `${privacySentinel} late queued write must never return`,
    );
    await eventually(
      async () => (stub.held > 0 ? true : undefined),
      "in-flight native provider request",
    );
    await stopNative(normal);
    stub.setMode("normal");
    const cleanup = `${run}-cleanup`;
    await nativeContainer(cleanup, ["hindsight-api"], {
      ...cleanupEnv,
      HINDSIGHT_API_HOST: "127.0.0.1",
      HINDSIGHT_API_PORT: String(apiPort),
    });
    await ready(apiPort);
    const resolved = JSON.parse(
      await command([
        "exec",
        cleanup,
        "python",
        "-c",
        'import json; from hindsight_api.config import get_config; c=get_config(); print(json.dumps({k:getattr(c,k) for k in ["worker_enabled","run_migrations_on_startup","consolidation_reconcile_interval_seconds","mental_model_refresh_tick_seconds","retention_sweep_interval_seconds","operation_cleanup_interval_seconds"]}))',
      ]),
    ) as Record<string, boolean | number>;
    assert.equal(resolved.worker_enabled, false);
    assert.equal(resolved.run_migrations_on_startup, false);
    for (const name of Object.keys(cleanupEnv))
      assert.equal(
        resolved[name.replace("HINDSIGHT_API_", "").toLowerCase()],
        0,
      );
    const sentinel = await retain(
      `${run}-queued-sentinel`,
      `${privacySentinel} paused executor sentinel`,
    );
    await pause(1800);
    assert.equal(
      (await request<Operation>(path(`/operations/${sentinel}`))).status,
      "pending",
      "Cleanup profile executed queued work",
    );
    await request(
      path(`/documents/${run}-queued-sentinel`),
      "GET",
      undefined,
      404,
    );
    const discovered = new Map<string, Operation>();
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await request<{ operations: Operation[]; total: number }>(
        path(`/operations?limit=1&offset=${offset}`),
      );
      total = page.total;
      for (const operation of page.operations) {
        const full = await request<Operation>(
          path(`/operations/${operation.operation_id}?include_payload=true`),
        );
        discovered.set(full.operation_id, full);
      }
      offset += page.operations.length;
      assert(
        page.operations.length || offset >= total,
        "Native operation pagination stopped early",
      );
    }
    assert(
      discovered.size >= retainedIds.length,
      "Historical/queued operation discovery incomplete",
    );
    for (const operation of discovered.values()) {
      if (["pending", "processing"].includes(operation.status))
        await request(path(`/operations/${operation.operation_id}`), "DELETE");
    }
    await request(path(`/documents/${document}`), "DELETE");
    const ordered = [...discovered.values()].sort(
      (a, b) =>
        Number(Boolean(a.child_operations?.length)) -
        Number(Boolean(b.child_operations?.length)),
    );
    for (const operation of ordered)
      await request(
        path(`/operations/${operation.operation_id}/delete`),
        "DELETE",
      );
    for (const operation of discovered.values())
      assertNativeOperationAbsent(
        await request(
          path(`/operations/${operation.operation_id}?include_payload=true`),
        ),
        operation.operation_id,
      );
    await request(path(`/documents/${document}`), "GET", undefined, 404);
    assert.equal(
      (
        await request<NativeList<Fact>>(
          path(`/memories/list?document_id=${document}`),
        )
      ).total,
      0,
    );
    await stopNative([cleanup]);
    await nativeContainer(`${run}-restarted-api`, ["hindsight-api"], {
      HINDSIGHT_API_HOST: "127.0.0.1",
      HINDSIGHT_API_PORT: String(apiPort),
    });
    await ready(apiPort);
    await nativeContainer(`${run}-restarted-worker`, [
      "hindsight-worker",
      "--http-host",
      "127.0.0.1",
      "--http-port",
      String(workerPort),
    ]);
    await ready(workerPort);
    await pause(1500);
    await request(path(`/documents/${document}`), "GET", undefined, 404);
    assertNativeOperationAbsent(
      await request(path(`/operations/${late}?include_payload=true`)),
      late,
    );
    assert.equal(
      (
        await request<NativeList<Fact>>(
          path(`/memories/list?document_id=${document}`),
        )
      ).total,
      0,
    );
    checkpoints.push(
      "all-executor-exit-and-db-session-closure",
      "same-image-resolved-maintenance-off-no-execution",
      "paginated-historical-parent-leaf-payload-cleanup",
      "forget-absence-after-native-worker-restart",
    );
    assert.equal(
      stub.calls.unexpected,
      0,
      "Unscripted native provider request occurred",
    );
    const healthProbe = await command([
      "exec",
      `${run}-restarted-api`,
      "python",
      "-c",
      'import asyncio; from hindsight_api import MemoryEngine; m=object.__new__(MemoryEngine); m._initialized=True\nasync def poisoned_backend(): raise RuntimeError("RR_NATIVE_PRIVATE_5C36E924")\nm._get_backend=poisoned_backend\nresult=asyncio.run(m.health_check()); assert result=={"status":"unhealthy","database":"error","error":"RuntimeError"}; print("private_health_error_verified")',
    ]);
    assert(healthProbe.includes("private_health_error_verified"));
    const poisonedSql = await command(
      [
        "exec",
        pg,
        "psql",
        "-U",
        "postgres",
        "-p",
        String(dbPort),
        "-d",
        "hindsight",
        "-c",
        `SELECT '${privacySentinel}'::integer`,
      ],
      true,
    );
    assert(
      poisonedSql.includes(privacySentinel),
      "Synthetic native database failure did not carry the test sentinel",
    );
    const counts = await inspectSinks();
    await command(["stop", "--time", "10", pg]);
    await request("/health/ready", "GET", undefined, 503);
    for (const name of containers) {
      const logs = await command(["logs", name], true);
      assert(
        !logs.includes(privacySentinel),
        "Native stdout/stderr leaked private content/credentials",
      );
    }
    assert(
      retainedLogs.every((log) => !log.includes(privacySentinel)),
      "Bounded migration process leaked private credentials",
    );
    checkpoints.push(
      "stdout-stderr-collector-inputs-trace-audit-operation-sinks-private",
      "database-error-health-error-and-server-logging-profile-private",
    );
    const evidence = {
      schema: "hindsight-native-qualification/v1",
      startedAt,
      completedAt: new Date().toISOString(),
      nativeRevision,
      imageId,
      postgresImage,
      checkpoints,
      providerCalls: stub.calls,
      safeSinkCounts: counts,
      evidenceKind:
        "same-derivative-image-real-api-worker-postgresql17-deterministic-inference",
      realModelQualityQualified: false,
      productionReleaseQualified: false,
    };
    await writeFile(
      `${output}/evidence.json`,
      JSON.stringify(evidence, null, 2) + "\n",
    );
    const manifest = await command([
      "exec",
      `${run}-restarted-api`,
      "cat",
      "/app/hardening-manifest.json",
    ]);
    await writeFile(`${output}/hardening-manifest.json`, manifest);
    process.stdout.write(
      JSON.stringify({
        passed: true,
        checkpoints: checkpoints.length,
        imageId,
        evidence: `${output}/evidence.json`,
      }) + "\n",
    );
  } finally {
    for (const name of containers)
      await command(["rm", "--force", "--volumes", name], true);
    await stub.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  qualifyNative().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Native qualification failed"}\n`,
    );
    process.exitCode = 1;
  });
}
