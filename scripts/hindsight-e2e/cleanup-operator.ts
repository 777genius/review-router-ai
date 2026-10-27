import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalHindsightCleanup,
  hindsightCleanupBankDigest,
  hindsightCleanupDigest,
  signHindsightCleanupReceipt,
  verifyHindsightCleanupReceipt,
  type HindsightCleanupAbsence,
  type HindsightCleanupBinding,
  type HindsightCleanupProof,
} from "../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-receipt.ts";
import {
  dockerCommand as docker,
  eventually,
  freePort,
  pause,
} from "./native-runtime.ts";
import { acquireDeploymentLock } from "./deployment-lock.ts";
import {
  assertExecutorPhase,
  nativeSqlObserverArguments,
  type DockerExecutorInspection,
} from "./operator-host.ts";
import {
  assertCleanupOperationSources,
  leafFirstOperations,
  operationClosure,
  persistCleanupInventory,
  readCleanupInventory,
  signCleanupInventory,
  type CleanupOperation,
} from "./cleanup-inventory.ts";
import {
  assertNativeCleanupStatus,
  assertNativeOperationAbsent,
  assertNativeObservationsCleared,
} from "./native-http.ts";

interface OperatorPlan {
  readonly profile: "docker-complete-inventory-v1";
  readonly binding: HindsightCleanupBinding;
  readonly nativeBankId: string;
  readonly deploymentLabel: string;
  readonly executorContainerIds: readonly string[];
  readonly apiContainerId: string;
  readonly restartContainerIds: readonly string[];
  readonly trackedOperationIds: readonly string[];
  readonly routerPauseCheckUrl: string;
  readonly deploymentLockPath: string;
  readonly sourceInventoryPath: string;
}
type Inspection = DockerExecutorInspection;
type Operation = CleanupOperation;
type Fact = { id: string; source_memory_ids?: string[] };
type List<T> = { items: T[]; total: number };
const stamp = () => new Date().toISOString();
const id = (value: string) => /^[a-f0-9]{64}$/.test(value);
const safeName = (value: string) => /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
function containsDocument(value: unknown, document: string): boolean {
  if (Array.isArray(value))
    return value.some((item) => containsDocument(item, document));
  return (
    !!value &&
    typeof value === "object" &&
    Object.entries(value).some(
      ([key, item]) =>
        (key === "document_id" && item === document) ||
        containsDocument(item, document),
    )
  );
}
function containsId(value: unknown, ids: ReadonlySet<string>): boolean {
  if (typeof value === "string") return ids.has(value);
  if (Array.isArray(value)) return value.some((item) => containsId(item, ids));
  return (
    !!value &&
    typeof value === "object" &&
    Object.values(value).some((item) => containsId(item, ids))
  );
}

/** Real Docker host observations only; no caller-provided exit/absence booleans. */
export async function runDockerHindsightCleanup(
  plan: OperatorPlan,
  credentials: {
    readonly nativeServiceKey: string;
    readonly routerOperatorToken: string;
    readonly signingKeyId: string;
    readonly signingPrivateKey: string;
    readonly signingPublicKey: string;
  },
  qualification?: {
    readonly inspectCleanupDiagnostics: (text: string) => void;
  },
) {
  const lock = await acquireDeploymentLock(plan.deploymentLockPath);
  try {
    return await runLockedCleanup(plan, credentials, lock, qualification);
  } finally {
    await lock.close();
  }
}

async function runLockedCleanup(
  plan: OperatorPlan,
  credentials: {
    readonly nativeServiceKey: string;
    readonly routerOperatorToken: string;
    readonly signingKeyId: string;
    readonly signingPrivateKey: string;
    readonly signingPublicKey: string;
  },
  deploymentLock: Awaited<ReturnType<typeof acquireDeploymentLock>>,
  qualification?: {
    readonly inspectCleanupDiagnostics: (text: string) => void;
  },
) {
  const deploymentFenceHeldAt = stamp();
  assert.equal(plan.profile, "docker-complete-inventory-v1");
  assert.equal(
    hindsightCleanupBankDigest(plan.nativeBankId),
    plan.binding.bankIdDigest,
  );
  assert(
    safeName(plan.nativeBankId) &&
      /^io\.reviewrouter\.hindsight\.deployment=[a-zA-Z0-9_.-]+$/.test(
        plan.deploymentLabel,
      ),
  );
  assert(
    plan.executorContainerIds.length > 0 &&
      plan.executorContainerIds.length <= 64 &&
      plan.executorContainerIds.every(id) &&
      new Set(plan.executorContainerIds).size ===
        plan.executorContainerIds.length,
  );
  assert(
    plan.executorContainerIds.includes(plan.apiContainerId) &&
      plan.restartContainerIds.includes(plan.apiContainerId) &&
      new Set(plan.restartContainerIds).size ===
        plan.restartContainerIds.length &&
      plan.restartContainerIds.every((container) =>
        plan.executorContainerIds.includes(container),
      ),
  );
  assert(
    /^(0|[1-9][0-9]*)$/.test(plan.binding.pauseEpoch),
    "Pause must bind the actual durable numeric maintenance epoch",
  );
  assert(
    plan.trackedOperationIds.length <= 1024 &&
      plan.trackedOperationIds.every((value) => /^[a-f0-9-]{36}$/i.test(value)),
  );
  assert(
    credentials.nativeServiceKey &&
      credentials.routerOperatorToken &&
      credentials.nativeServiceKey !== credentials.routerOperatorToken &&
      credentials.signingPrivateKey !== credentials.nativeServiceKey,
  );
  const pauseUrl = new URL(plan.routerPauseCheckUrl);
  assert(
    pauseUrl.protocol === "https:" ||
      (pauseUrl.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(pauseUrl.hostname)),
  );
  const inspect = async (container: string): Promise<Inspection> =>
    JSON.parse(
      await docker(["inspect", "--format", "{{json .}}", container]),
    ) as Inspection;
  const inspectAll = async (
    phase: "initial" | "stopped" | "restarted",
    cleanupContainerId?: string,
  ) => {
    await deploymentLock.assertHeld();
    const swarm = JSON.parse(
      await docker(["info", "--format", "{{json .Swarm}}"]),
    ) as { LocalNodeState?: string };
    assert.equal(
      swarm.LocalNodeState,
      "inactive",
      "Swarm reconciliation is unsupported by this standalone host profile",
    );
    const containers = (
      await docker(["ps", "--all", "--no-trunc", "--format", "{{.ID}}"])
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    assert(
      containers.length <= 512,
      "Standalone host inventory exceeds the bounded inspection profile",
    );
    const records: Inspection[] = [];
    for (const container of containers) records.push(await inspect(container));
    const apiRecord = records.find(
      (record) => record.Id === plan.apiContainerId,
    );
    assert(apiRecord);
    const databaseIdentity = (record: Inspection) => {
      const setting = record.Config.Env?.find((value) =>
        value.startsWith("HINDSIGHT_API_DATABASE_URL="),
      );
      if (!setting) return undefined;
      const url = new URL(setting.slice("HINDSIGHT_API_DATABASE_URL=".length));
      return `${url.hostname}:${url.port || 5432}${url.pathname}`;
    };
    const expectedDatabase = databaseIdentity(apiRecord);
    assert(expectedDatabase);
    const native: Inspection[] = [];
    const [labelKey, labelValue] = plan.deploymentLabel.split("=");
    for (const record of records) {
      if (record.Id === cleanupContainerId) {
        assert(
          record.Image === plan.binding.imageDigest &&
            record.Config.Cmd?.[0] === "hindsight-api",
          "Private cleanup observer identity drift",
        );
        continue;
      }
      const role = record.Config.Labels?.["io.reviewrouter.hindsight.role"];
      if (
        record.Config.Labels?.[labelKey!] === labelValue ||
        record.Image === plan.binding.imageDigest ||
        databaseIdentity(record) === expectedDatabase
      ) {
        assert(
          record.Config.Labels?.[labelKey!] === labelValue,
          "An executor sharing this image/database is outside the authoritative deployment label",
        );
        assert(role === "api" || role === "worker");
        native.push(record);
      }
    }
    assert.deepEqual(
      native.map((record) => record.Id).sort(),
      [...plan.executorContainerIds].sort(),
      "Executor inventory drift; no receipt can be issued",
    );
    assert(
      native.every((record) => record.Image === plan.binding.imageDigest),
      "An unqualified old executor image remains",
    );
    assertExecutorPhase(native, plan.restartContainerIds, phase);
    return native;
  };
  async function checkPause() {
    const response = await fetch(pauseUrl, {
      headers: { Authorization: `Bearer ${credentials.routerOperatorToken}` },
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(
      response.status,
      200,
      "Current Router pause could not be verified",
    );
    const state = (await response.json()) as {
      binding: HindsightCleanupBinding;
      submissionsPaused: boolean;
      maintenance: { generation: string; epoch: string; paused: boolean };
    };
    assert.equal(state.submissionsPaused, true);
    assert.equal(
      canonicalHindsightCleanup(state.binding),
      canonicalHindsightCleanup(plan.binding),
      "Router pause binding changed",
    );
    assert.equal(state.maintenance.generation, plan.binding.generation);
    assert.equal(state.maintenance.epoch, plan.binding.pauseEpoch);
    assert.equal(state.maintenance.paused, true);
  }
  await checkPause();
  const pauseObservedAt = stamp();
  const inventory = await inspectAll("initial");
  const api = inventory.find((record) => record.Id === plan.apiContainerId)!;
  assert.equal(api.Config.Labels["io.reviewrouter.hindsight.role"], "api");
  assert(
    inventory.some(
      (record) =>
        plan.restartContainerIds.includes(record.Id) &&
        record.Config.Labels["io.reviewrouter.hindsight.role"] === "worker",
    ),
    "Restart must include a separately observed worker",
  );
  const originalEnvironment = Object.fromEntries(
    api.Config.Env.filter((value) => value.startsWith("HINDSIGHT_API_")).map(
      (value) => {
        const equal = value.indexOf("=");
        return [value.slice(0, equal), value.slice(equal + 1)];
      },
    ),
  );
  const configuredDsn = originalEnvironment.HINDSIGHT_API_DATABASE_URL;
  assert(configuredDsn);
  const databaseUrl = new URL(configuredDsn);
  assert(
    ["127.0.0.1", "localhost"].includes(databaseUrl.hostname),
    "Initial Docker host profile requires a loopback PostgreSQL endpoint",
  );
  // Connect through the actual API DSN, never a plan-selected database container.
  // Even an identically named DB in another container cannot supply this proof.
  const sql = async (statement: string) =>
    (
      await docker(
        nativeSqlObserverArguments(
          configuredDsn,
          plan.binding.imageDigest,
          statement,
        ),
      )
    ).trim();
  assert(
    Number(await sql("SHOW server_version_num")) >= 170000 &&
      Number(await sql("SHOW server_version_num")) < 180000,
  );
  const executorRecords: HindsightCleanupProof["executors"][number][] = [];
  for (const record of inventory) {
    const environment = Object.fromEntries(
      record.Config.Env.map((value) => {
        const equal = value.indexOf("=");
        return [value.slice(0, equal), value.slice(equal + 1)];
      }),
    );
    const dsn = environment.HINDSIGHT_API_DATABASE_URL;
    assert(dsn);
    const applicationName = new URL(dsn).searchParams.get("application_name");
    assert(
      applicationName && safeName(applicationName),
      "Executor has no traceable DB application_name",
    );
    await docker(["stop", "--time", "30", record.Id]);
    const stopped = await inspect(record.Id);
    assert.equal(stopped.State.Running, false);
    assert.equal(stopped.State.Pid, 0);
    assert.equal(stopped.State.Status, "exited");
    executorRecords.push({
      containerId: record.Id,
      imageDigest: record.Image,
      databaseApplicationName: applicationName,
      pidBefore: record.State.Pid,
      pidAfter: 0,
      running: false,
      exitCode: stopped.State.ExitCode,
      observedAt: stamp(),
    });
  }
  await inspectAll("stopped");
  await eventually(
    async () =>
      (await sql(
        "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()",
      )) === "0"
        ? true
        : undefined,
    "all native DB sessions closed",
  );
  const sessionsClosedAt = stamp();
  const port = await freePort();
  const cleanupName = `rr-hindsight-cleanup-${randomUUID()}`;
  databaseUrl.searchParams.set("application_name", cleanupName);
  const environment = {
    ...originalEnvironment,
    HINDSIGHT_API_DATABASE_URL: databaseUrl.toString(),
    HINDSIGHT_API_HOST: "127.0.0.1",
    HINDSIGHT_API_PORT: String(port),
    HINDSIGHT_API_WORKER_ENABLED: "false",
    HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP: "false",
    HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS: "0",
    HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS: "0",
    HINDSIGHT_API_RETENTION_SWEEP_INTERVAL_SECONDS: "0",
    HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS: "0",
    HINDSIGHT_API_LLM_TRACE_ENABLED: "false",
    HINDSIGHT_API_OTEL_TRACES_ENABLED: "false",
    HINDSIGHT_API_AUDIT_LOG_ENABLED: "false",
    HINDSIGHT_API_LLM_DEBUG_DUMP_4XX: "false",
    HINDSIGHT_API_MCP_ENABLED: "false",
    HINDSIGHT_API_ENABLE_FILE_UPLOAD_API: "false",
    HINDSIGHT_API_ACCESS_LOG: "false",
  };
  await docker([
    "run",
    "--detach",
    "--name",
    cleanupName,
    "--network",
    "host",
    ...Object.entries(environment).flatMap(([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]),
    plan.binding.imageDigest,
    "hindsight-api",
  ]);
  const cleanupContainerId = (await inspect(cleanupName)).Id;
  const base = `http://127.0.0.1:${port}`;
  const document = `entry-${plan.binding.entryId}`;
  const bankPath = (bank = plan.nativeBankId) =>
    `/v1/default/banks/${encodeURIComponent(bank)}`;
  async function request<T>(
    path: string,
    method = "GET",
    body?: unknown,
    allowed = [200],
  ): Promise<T | null> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${credentials.nativeServiceKey}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    assertNativeCleanupStatus(path, method, response.status, allowed);
    if (response.status === 404) return null;
    return (await response.json()) as T;
  }
  try {
    await eventually(
      async () => {
        try {
          return (
            await fetch(`${base}/health/ready`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
            ? true
            : undefined;
        } catch {
          return undefined;
        }
      },
      "cleanup API readiness",
      120_000,
    );
    const configuration = JSON.parse(
      await docker([
        "exec",
        cleanupName,
        "python",
        "-c",
        'import json; from hindsight_api.config import get_config; c=get_config(); print(json.dumps({k:getattr(c,k) for k in ["worker_enabled","run_migrations_on_startup","consolidation_reconcile_interval_seconds","mental_model_refresh_tick_seconds","retention_sweep_interval_seconds","operation_cleanup_interval_seconds"]}))',
      ]),
    ) as Record<string, number | boolean>;
    assert.equal(configuration.worker_enabled, false);
    assert.equal(configuration.run_migrations_on_startup, false);
    for (const key of [
      "consolidation_reconcile_interval_seconds",
      "mental_model_refresh_tick_seconds",
      "retention_sweep_interval_seconds",
      "operation_cleanup_interval_seconds",
    ])
      assert.equal(configuration[key], 0);
    const list = async <T>(suffix: string): Promise<T[]> => {
      const all: T[] = [];
      let total = Infinity;
      while (all.length < total) {
        const page = await request<List<T>>(
          `${bankPath()}${suffix}${suffix.includes("?") ? "&" : "?"}limit=100&offset=${all.length}`,
        );
        assert(
          page &&
            page.total <= 10_000 &&
            (page.items.length > 0 || all.length === page.total),
        );
        total = page.total;
        all.push(...page.items);
      }
      return all;
    };
    await checkPause();
    await inspectAll("stopped", cleanupContainerId);
    const priorInventory = await readCleanupInventory(
      plan.sourceInventoryPath,
      plan.binding,
      credentials.signingKeyId,
      credentials.signingPublicKey,
    );
    const sourceDocument = await request(
      `${bankPath()}/documents/${encodeURIComponent(document)}`,
      "GET",
      undefined,
      [200, 404],
    );
    assert(
      sourceDocument || priorInventory,
      "Document is already absent without authenticated pre-delete source inventory; cleanup must stay pending",
    );
    const sourceFacts = [
      ...(await list<Fact>(
        `/memories/list?document_id=${encodeURIComponent(document)}&state=valid`,
      )),
      ...(await list<Fact>(
        `/memories/list?document_id=${encodeURIComponent(document)}&state=invalidated`,
      )),
    ];
    const sourceIds = new Set(
      priorInventory?.sourceFactIds ?? sourceFacts.map((fact) => fact.id),
    );
    assert(
      sourceIds.size > 0 && sourceFacts.every((fact) => sourceIds.has(fact.id)),
      "Source inventory changed after its durable capture",
    );
    const operations: Operation[] = [];
    let operationTotal = Infinity;
    while (operations.length < operationTotal) {
      const page = await request<{ operations: Operation[]; total: number }>(
        `${bankPath()}/operations?limit=100&offset=${operations.length}`,
      );
      assert(
        page &&
          page.total <= 10_000 &&
          (page.operations.length || operations.length === page.total),
      );
      operationTotal = page.total;
      operations.push(...page.operations);
    }
    const full = new Map<string, Operation>();
    for (const operation of operations) {
      const state = await request<Operation>(
        `${bankPath()}/operations/${operation.operation_id}?include_payload=true`,
      );
      assert(state);
      full.set(state.operation_id, state);
    }
    const seeds = new Set([
      ...plan.trackedOperationIds,
      ...(priorInventory?.operationIds ?? []),
    ]);
    for (const operation of full.values())
      if (containsDocument(operation, document))
        seeds.add(operation.operation_id);
    const related = operationClosure(full, seeds);
    if (priorInventory)
      assert(
        [...related].every((operationId) =>
          priorInventory.operationIds.includes(operationId),
        ),
        "Native operation inventory changed after durable capture",
      );
    for (const operationId of related)
      assertCleanupOperationSources(
        full.get(operationId),
        document,
        plan.nativeBankId,
      );
    const observationIds = new Set(priorInventory?.observationIds ?? []);
    for (const state of ["valid", "invalidated"])
      for (const observation of await list<Fact>(
        `/memories/list?type=observation&state=${state}`,
      )) {
        const history = await request<unknown>(
          `${bankPath()}/memories/${observation.id}/history`,
          "GET",
          undefined,
          [200, 404],
        );
        if (
          observation.source_memory_ids?.some((source) =>
            sourceIds.has(source),
          ) ||
          containsId(history, sourceIds) ||
          containsDocument(history, document)
        ) {
          assert(
            !priorInventory || observationIds.has(observation.id),
            "A related observation appeared after inventory capture",
          );
          observationIds.add(observation.id);
        }
      }
    const sourceInventory = priorInventory ?? {
      schema: "hindsight-cleanup-inventory/v1" as const,
      binding: plan.binding,
      documentId: document,
      capturedAt: stamp(),
      sourceFactIds: [...sourceIds].sort(),
      observationIds: [...observationIds].sort(),
      operationIds: [...related].sort(),
    };
    if (!priorInventory)
      await persistCleanupInventory(
        plan.sourceInventoryPath,
        signCleanupInventory(
          sourceInventory,
          credentials.signingKeyId,
          credentials.signingPrivateKey,
        ),
      );
    // Authentication/readback and fsync must complete before the first target deletion.
    assert(
      await readCleanupInventory(
        plan.sourceInventoryPath,
        plan.binding,
        credentials.signingKeyId,
        credentials.signingPublicKey,
      ),
    );
    await checkPause();
    await inspectAll("stopped", cleanupContainerId);
    const sentinelBank = `rr-cleanup-probe-${randomUUID()}`;
    await request(bankPath(sentinelBank), "PUT", {
      name: "Disposable no-execution probe",
    });
    await request(`${bankPath(sentinelBank)}/config`, "PATCH", {
      updates: { audit_log_enabled: false },
    });
    const sentinelId = randomUUID();
    const sentinelStarted = stamp();
    const pollIntervalMs = 500;
    const observedPolls = 3;
    await request(`${bankPath(sentinelBank)}/memories`, "POST", {
      items: [
        {
          content: "Synthetic cleanup execution sentinel",
          document_id: "cleanup-probe",
        },
      ],
      async: true,
      operation_id: sentinelId,
    });
    for (let poll = 0; poll < observedPolls; poll++) {
      await pause(pollIntervalMs);
      assert.equal(
        (
          await request<Operation>(
            `${bankPath(sentinelBank)}/operations/${sentinelId}`,
          )
        )?.status,
        "pending",
      );
    }
    const sentinelEnded = stamp();
    const sentinel = await request<Operation>(
      `${bankPath(sentinelBank)}/operations/${sentinelId}`,
    );
    assert(sentinel);
    for (const child of sentinel.child_operations ?? [])
      await request(
        `${bankPath(sentinelBank)}/operations/${child.operation_id}`,
        "DELETE",
        undefined,
        [200, 409],
      );
    await request(
      `${bankPath(sentinelBank)}/operations/${sentinelId}`,
      "DELETE",
      undefined,
      [200, 409],
    );
    for (const child of sentinel.child_operations ?? [])
      await request(
        `${bankPath(sentinelBank)}/operations/${child.operation_id}/delete`,
        "DELETE",
      );
    await request(
      `${bankPath(sentinelBank)}/operations/${sentinelId}/delete`,
      "DELETE",
    );
    await request(bankPath(sentinelBank), "DELETE");
    const relevant = [...related]
      .map((operationId) => full.get(operationId))
      .filter((value): value is Operation => !!value);
    for (const operation of relevant)
      if (["pending", "processing"].includes(operation.status))
        await request(
          `${bankPath()}/operations/${operation.operation_id}`,
          "DELETE",
          undefined,
          [200, 409],
        );
    await request(
      `${bankPath()}/documents/${encodeURIComponent(document)}`,
      "DELETE",
      undefined,
      [200, 404],
    );
    for (const operationId of leafFirstOperations(full, related))
      await request(
        `${bankPath()}/operations/${operationId}/delete`,
        "DELETE",
        undefined,
        [200, 404],
      );
    // Retag/replacement can orphan history whose old source IDs are no longer
    // discoverable from the current document. The pinned public reset erases all
    // derived history and requeues surviving sources without deleting their
    // approved documents/facts or starting execution in this stopped profile.
    assertNativeObservationsCleared(
      await request(`${bankPath()}/observations`, "DELETE"),
    );
    async function absence(
      beforeRestart = false,
    ): Promise<HindsightCleanupAbsence> {
      assert.equal(
        await request(
          `${bankPath()}/documents/${encodeURIComponent(document)}`,
          "GET",
          undefined,
          [404],
        ),
        null,
      );
      for (const state of ["valid", "invalidated"]) {
        assert.equal(
          (
            await list<Fact>(
              `/memories/list?document_id=${encodeURIComponent(document)}&state=${state}`,
            )
          ).length,
          0,
        );
        const observations = await list<Fact>(
          `/memories/list?type=observation&state=${state}`,
        );
        if (beforeRestart)
          assert.equal(
            observations.length,
            0,
            "Native observation reset left derived records behind",
          );
        for (const observation of observations) {
          assert(
            !observation.source_memory_ids?.some((source) =>
              sourceIds.has(source),
            ),
            "A live observation still cites the forgotten source",
          );
          const history = await request<unknown>(
            `${bankPath()}/memories/${observation.id}/history`,
            "GET",
            undefined,
            [200, 404],
          );
          assert(
            !containsDocument(history, document) &&
              !containsId(history, sourceIds),
            "Observation history still exposes forgotten source evidence",
          );
        }
      }
      // Deleted observations have no public history endpoint. Inspect persisted history
      // read-only as well; an inaccessible orphan cannot become a vacuous success.
      const schema =
        originalEnvironment.HINDSIGHT_API_DATABASE_SCHEMA || "public";
      assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema));
      const knownObservations = [...observationIds]
        .map((value) => `'${value}'::uuid`)
        .join(",");
      const sources = [...sourceIds]
        .map((value) => `content::text LIKE '%${value}%'`)
        .join(" OR ");
      const observationMatch = knownObservations
        ? `observation_id IN (${knownObservations}) OR `
        : "";
      assert.equal(
        await sql(
          `SELECT count(*) FROM "${schema}".observation_history WHERE bank_id='${plan.nativeBankId}'${beforeRestart ? "" : ` AND (${observationMatch}${sources})`}`,
        ),
        "0",
        "Persisted observation history still contains forgotten evidence",
      );
      for (const operationId of related)
        assertNativeOperationAbsent(
          await request(
            `${bankPath()}/operations/${operationId}?include_payload=true`,
          ),
          operationId,
        );
      return {
        documentAbsent: true,
        sourceFactCount: 0,
        evidenceSourceCount: 0,
        operationPayloadCount: 0,
        observedAt: stamp(),
      };
    }
    const beforeRestart = await absence(true);
    await checkPause();
    await inspectAll("stopped", cleanupContainerId);
    await docker(["stop", "--time", "30", cleanupName]);
    for (const container of plan.restartContainerIds)
      await docker(["start", container]);
    for (const container of plan.restartContainerIds) {
      const record = await inspect(container);
      assert(record.State.Running && record.Image === plan.binding.imageDigest);
      const settings = Object.fromEntries(
        record.Config.Env.map((value) => {
          const equal = value.indexOf("=");
          return [value.slice(0, equal), value.slice(equal + 1)];
        }),
      );
      const worker =
        record.Config.Labels?.["io.reviewrouter.hindsight.role"] === "worker";
      const argument = record.Config.Cmd?.indexOf("--http-port") ?? -1;
      const readyPort = Number(
        worker
          ? argument >= 0
            ? record.Config.Cmd[argument + 1]
            : settings.HINDSIGHT_API_WORKER_HTTP_PORT || 8889
          : settings.HINDSIGHT_API_PORT || 8888,
      );
      await eventually(
        async () => {
          try {
            return (
              await fetch(`http://127.0.0.1:${readyPort}/health/ready`, {
                signal: AbortSignal.timeout(1000),
              })
            ).ok
              ? true
              : undefined;
          } catch {
            return undefined;
          }
        },
        "restarted executor readiness",
        120_000,
      );
      if (worker)
        await eventually(async () => {
          const response = await fetch(
            `http://127.0.0.1:${readyPort}/health/live`,
            { signal: AbortSignal.timeout(1000) },
          );
          const state = (await response.json()) as {
            seconds_since_last_poll?: number;
            is_shutdown?: boolean;
          };
          return response.ok &&
            state.is_shutdown === false &&
            typeof state.seconds_since_last_poll === "number" &&
            state.seconds_since_last_poll < 5
            ? true
            : undefined;
        }, "restarted worker poll progress");
    }
    const restartObservedAt = stamp();
    // Reuse the cleanup API only as a read observer after restarting executors.
    await docker(["start", cleanupName]);
    await eventually(
      async () => {
        try {
          return (
            await fetch(`${base}/health/ready`, {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
            ? true
            : undefined;
        } catch {
          return undefined;
        }
      },
      "post-restart observer readiness",
      120_000,
    );
    await pause(3 * pollIntervalMs);
    const afterRestart = await absence();
    await checkPause();
    await inspectAll("restarted", cleanupContainerId);
    const inventoryRecords = executorRecords
      .map(({ containerId, imageDigest, databaseApplicationName }) => ({
        containerId,
        imageDigest,
        databaseApplicationName,
      }))
      .sort((a, b) => a.containerId.localeCompare(b.containerId));
    const proof: HindsightCleanupProof = {
      schema: "hindsight-cleanup-proof/v1",
      binding: plan.binding,
      profile: plan.profile,
      documentId: document,
      deploymentInventoryDigest: hindsightCleanupDigest(inventoryRecords),
      deploymentExecutorCount: executorRecords.length,
      deploymentFence: {
        profile: "standalone-docker-flock-v1",
        heldAt: deploymentFenceHeldAt,
        verifiedAt: stamp(),
        swarmInactive: true,
        automaticRestartDisabled: true,
      },
      sourceInventory: {
        digest: hindsightCleanupDigest(sourceInventory),
        sourceFactCount: sourceInventory.sourceFactIds.length,
        observationCount: sourceInventory.observationIds.length,
        capturedAt: sourceInventory.capturedAt,
      },
      pauseObservedAt,
      executors: executorRecords,
      sessionsClosedAt,
      openExecutorSessions: 0,
      cleanupApiImageDigest: plan.binding.imageDigest,
      cleanupConfiguration: {
        workerEnabled: false,
        migrationsEnabled: false,
        consolidationReconcileSeconds: 0,
        mentalModelRefreshSeconds: 0,
        retentionSweepSeconds: 0,
        operationCleanupSeconds: 0,
      },
      queuedSentinel: {
        operationId: sentinelId,
        status: "pending",
        startedAt: sentinelStarted,
        endedAt: sentinelEnded,
        pollIntervalMs,
        observedPolls,
      },
      removedOperationIds: [
        ...related,
        sentinelId,
        ...(sentinel.child_operations ?? []).map((child) => child.operation_id),
      ],
      beforeRestart,
      restartObservedAt,
      restartImageDigest: plan.binding.imageDigest,
      afterRestart,
      completedAt: stamp(),
    };
    const receipt = signHindsightCleanupReceipt(
      proof,
      credentials.signingKeyId,
      credentials.signingPrivateKey,
    );
    assert(
      verifyHindsightCleanupReceipt(
        receipt,
        plan.binding,
        { [credentials.signingKeyId]: credentials.signingPublicKey },
        new Date(),
      ),
      "Observed evidence did not satisfy the receipt contract",
    );
    return receipt;
  } finally {
    try {
      qualification?.inspectCleanupDiagnostics(
        await docker(["logs", cleanupName], true),
      );
    } finally {
      await docker(["rm", "--force", cleanupName], true);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  (async () => {
    const [planPath, receiptPath] = process.argv.slice(2);
    assert(
      planPath && receiptPath,
      "Usage: node cleanup-operator.ts PLAN.json RECEIPT.json",
    );
    const privateKeyPath =
      process.env.HINDSIGHT_CLEANUP_SIGNING_PRIVATE_KEY_FILE;
    const publicKeyPath = process.env.HINDSIGHT_CLEANUP_SIGNING_PUBLIC_KEY_FILE;
    assert(
      privateKeyPath &&
        publicKeyPath &&
        ((await stat(privateKeyPath)).mode & 0o077) === 0,
      "Signing private key must be a separate mode0600 Ed25519 key file",
    );
    const receipt = await runDockerHindsightCleanup(
      JSON.parse(await readFile(planPath, "utf8")) as OperatorPlan,
      {
        nativeServiceKey:
          process.env.HINDSIGHT_OPERATOR_NATIVE_SERVICE_KEY ?? "",
        routerOperatorToken:
          process.env.REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN ?? "",
        signingKeyId: process.env.HINDSIGHT_CLEANUP_SIGNING_KEY_ID ?? "",
        signingPrivateKey: await readFile(privateKeyPath, "utf8"),
        signingPublicKey: await readFile(publicKeyPath, "utf8"),
      },
    );
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
    });
    process.stdout.write(
      "Signed native cleanup receipt created; submit to Router for current-fence verification.\n",
    );
  })().catch(() => {
    process.stderr.write(
      "Native cleanup remains pending. Keep Router submissions paused and retain operator evidence.\n",
    );
    process.exitCode = 1;
  });
}
