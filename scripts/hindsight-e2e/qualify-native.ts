import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProviderStub, privacySentinel } from './provider-stub.ts';
import { nativeRevision } from './prepare-hardening.ts';

type Operation = { operation_id: string; status: string; task_payload?: unknown; error_message?: string | null; child_operations?: Operation[]; result_metadata?: unknown };
type Fact = { id: string; text: string; document_id?: string; mentioned_at?: string; occurred_start?: string; state?: string; tags?: string[] };
type NativeList<T> = { items: T[]; total: number };
type Document = { original_text: string; tags: string[] };
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function command(args: string[], allowFailure = false): Promise<string> {
  return await new Promise((resolve, reject) => {
    const process = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    process.stdout.on('data', data => { stdout += data; });
    process.stderr.on('data', data => { stderr += data; });
    process.on('error', () => reject(new Error('Docker runtime is unavailable')));
    process.on('close', code => code === 0 || allowFailure ? resolve(stdout + (allowFailure ? stderr : '')) : reject(new Error(`Docker ${args[0]} failed (${code}); diagnostic payload suppressed`)));
  });
}

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function eventually<T>(action: () => Promise<T | undefined>, label: string, timeout = 60_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await action();
    if (result !== undefined) return result;
    await pause(200);
  }
  throw new Error(`Native qualification timed out: ${label}`);
}

export async function qualifyNative() {
  const image = process.env.HINDSIGHT_QUALIFICATION_IMAGE;
  const postgresImage = process.env.HINDSIGHT_QUALIFICATION_POSTGRES_IMAGE;
  if (!image || !postgresImage?.includes('@sha256:')) throw new Error('Set derivative image and digest-pinned PostgreSQL17/pgvector image');
  const output = resolve(process.env.HINDSIGHT_QUALIFICATION_OUTPUT ?? 'tmp/hindsight-qualification');
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
  const startedAt = new Date().toISOString();
  const imageId = (await command(['image', 'inspect', '--format', '{{.Id}}', image])).trim();
  const sourceRevision = (await command(['image', 'inspect', '--format', '{{index .Config.Labels "io.reviewrouter.hindsight.source-revision"}}', image])).trim();
  assert.equal(sourceRevision, nativeRevision, 'Derivative image has an unreviewed source identity');
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  const env: Record<string, string> = {
    HINDSIGHT_API_DATABASE_SCHEMA: 'public',
    HINDSIGHT_API_TENANT_EXTENSION: 'hindsight_api.extensions.builtin.tenant:ApiKeyTenantExtension',
    HINDSIGHT_API_TENANT_API_KEY: serviceKey,
    HINDSIGHT_API_WORKER_ENABLED: 'false',
    HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP: 'false',
    HINDSIGHT_API_LLM_PROVIDER: 'openai', HINDSIGHT_API_LLM_MODEL: 'stub-model',
    HINDSIGHT_API_LLM_API_KEY: `${privacySentinel}_LLM_KEY`, HINDSIGHT_API_LLM_BASE_URL: `${stub.url}/v1`,
    HINDSIGHT_API_EMBEDDINGS_PROVIDER: 'openai', HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL: 'stub-embeddings',
    HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY: `${privacySentinel}_EMBEDDING_KEY`,
    HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL: `${stub.url}/v1`, HINDSIGHT_API_EMBEDDINGS_OPENAI_DIMENSIONS: '384',
    HINDSIGHT_API_RERANKER_PROVIDER: 'siliconflow', HINDSIGHT_API_RERANKER_SILICONFLOW_MODEL: 'stub-reranker',
    HINDSIGHT_API_RERANKER_SILICONFLOW_API_KEY: `${privacySentinel}_RERANK_KEY`, HINDSIGHT_API_RERANKER_SILICONFLOW_BASE_URL: stub.url,
    HINDSIGHT_API_LLM_MAX_RETRIES: '0', HINDSIGHT_API_EMBEDDINGS_MAX_RETRIES: '0', HINDSIGHT_API_RERANKER_MAX_RETRIES: '0',
    HINDSIGHT_API_WORKER_MAX_RETRIES: '0', HINDSIGHT_API_WORKER_POLL_INTERVAL_MS: '200',
    HINDSIGHT_API_WORKER_SHUTDOWN_TIMEOUT_SECONDS: '2', HINDSIGHT_API_DB_POOL_MIN_SIZE: '1', HINDSIGHT_API_DB_POOL_MAX_SIZE: '4',
    HINDSIGHT_API_CONSOLIDATION_USE_DECISION_MODEL: 'false', HINDSIGHT_API_MAINTENANCE_START_JITTER_SECONDS: '0',
    HINDSIGHT_API_LLM_TRACE_ENABLED: 'false', HINDSIGHT_API_OTEL_TRACES_ENABLED: 'false', HINDSIGHT_API_AUDIT_LOG_ENABLED: 'false',
    HINDSIGHT_API_LLM_DEBUG_DUMP_4XX: 'false', HINDSIGHT_API_XAI_OAUTH_DEBUG_HEADERS: 'false', HINDSIGHT_API_MCP_ENABLED: 'false',
    HINDSIGHT_API_ENABLE_FILE_UPLOAD_API: 'false', HINDSIGHT_API_ACCESS_LOG: 'false', HINDSIGHT_API_FAIL_ON_EXTRACTION_ERRORS: 'true',
    HINDSIGHT_API_TEXT_SEARCH_EXTENSION: 'native', HINDSIGHT_API_BANK_STATS_CACHE_TTL_SECONDS: '0',
  };
  const cleanupEnv = {
    HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS: '0', HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS: '0',
    HINDSIGHT_API_RETENTION_SWEEP_INTERVAL_SECONDS: '0', HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS: '0',
  };
  const databaseUrl = `postgresql://hindsight:${password}@127.0.0.1:${dbPort}/hindsight`;
  const sql = async (statement: string, database = 'hindsight') => (await command(['exec', pg, 'psql', '-U', 'postgres', '-p', String(dbPort), '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement])).trim();
  const base = `http://127.0.0.1:${apiPort}`;
  async function request<T>(path: string, method = 'GET', body?: unknown, expected = 200): Promise<T> {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    if (response.status >= 400) { errors.push(text); assert(!text.includes(privacySentinel), 'Native HTTP error leaked a synthetic private sentinel'); }
    assert.equal(response.status, expected, `${method} ${path} returned unexpected HTTP status; body suppressed`);
    return text ? JSON.parse(text) as T : undefined as T;
  }
  const bank = `${run}-workspace-a`;
  const otherBank = `${run}-workspace-b`;
  const path = (suffix: string, selectedBank = bank) => `/v1/default/banks/${selectedBank}${suffix}`;
  async function nativeContainer(name: string, args: string[], extra: Record<string, string> = {}) {
    containers.add(name);
    const settings = { ...env, HINDSIGHT_API_DATABASE_URL: `${databaseUrl}?application_name=${name}`, HINDSIGHT_API_WORKER_ID: name, ...extra };
    await command(['run', '--detach', '--name', name, '--network', 'host', '--label', label, ...Object.entries(settings).flatMap(([key, value]) => ['--env', `${key}=${value}`]), imageId, ...args]);
    assert.equal((await command(['inspect', '--format', '{{.Image}}', name])).trim(), imageId);
  }
  async function ready(port: number) {
    await eventually(async () => { try { const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1000) }); return response.ok ? true : undefined; } catch { return undefined; } }, 'process readiness', 120_000);
  }
  async function settled(id: string, expected = 'completed') {
    const operation = await eventually(async () => { const state = await request<Operation>(path(`/operations/${id}`)); return ['completed', 'failed', 'cancelled'].includes(state.status) ? state : undefined; }, 'native operation settlement');
    assert.equal(operation.status, expected, 'Native operation ended unexpectedly; raw error suppressed');
    for (const child of operation.child_operations ?? []) assert.equal(child.status, expected, 'Parent terminal state hid a nonterminal child');
    assert(!JSON.stringify({ error: operation.error_message, children: operation.child_operations, metadata: operation.result_metadata }).includes(privacySentinel), 'Native stored error or parent copy leaked private content');
    return operation;
  }
  const retainedIds: string[] = [];
  async function retain(document: string, content: string, timestamp = '2026-01-02T03:04:05Z', selectedBank = bank, id = randomUUID()) {
    await request(path('/memories', selectedBank), 'POST', { items: [{ document_id: document, content, timestamp, tags: ['kind:rule', 'topic:one'], strategy: 'router-approved-v1', update_mode: 'replace', observation_scopes: [['kind:rule']] }], async: true, operation_id: id });
    if (selectedBank === bank) retainedIds.push(id);
    return id;
  }
  async function stopNative(names: string[]) {
    for (const name of names) {
      await command(['stop', '--time', '10', name]);
      const state = JSON.parse(await command(['inspect', '--format', '{{json .State}}', name])) as { Running: boolean; Pid: number; Status: string };
      assert.equal(state.Running, false); assert.equal(state.Pid, 0); assert.equal(state.Status, 'exited');
    }
    assert.equal(await sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN (${names.map(name => `'${name}'`).join(',')})`), '0', 'Exited executors retained database sessions');
  }
  try {
    containers.add(pg);
    await command(['run', '--detach', '--name', pg, '--network', 'host', '--label', label, '--env', `POSTGRES_PASSWORD=${password}`, postgresImage, '-p', String(dbPort), '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic']);
    await eventually(async () => (await command(['exec', pg, 'pg_isready', '-U', 'postgres', '-p', String(dbPort)], true)).includes('accepting connections') ? true : undefined, 'PostgreSQL17 startup');
    // Explicit admin bootstrap; native services use an isolated non-superuser.
    const pgExec = async (statement: string, database = 'postgres') => (await command(['exec', pg, 'psql', '-U', 'postgres', '-p', String(dbPort), '-d', database, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement])).trim();
    await pgExec(`CREATE ROLE hindsight LOGIN PASSWORD '${password}'`);
    await pgExec('CREATE DATABASE hindsight OWNER hindsight');
    await pgExec('CREATE EXTENSION vector; CREATE EXTENSION pg_trgm', 'hindsight');
    assert.equal(await pgExec("SELECT rolsuper FROM pg_roles WHERE rolname='hindsight'"), 'f');
    await nativeContainer(`${run}-migrate`, ['hindsight-admin', 'run-db-migration'], cleanupEnv);
    const migrateStatus = (await command(['wait', `${run}-migrate`])).trim();
    assert.equal(migrateStatus, '0', 'Bounded native migration job failed');
    const normal = [`${run}-api`, `${run}-worker`, `${run}-old-worker`];
    await nativeContainer(normal[0], ['hindsight-api'], { HINDSIGHT_API_HOST: '127.0.0.1', HINDSIGHT_API_PORT: String(apiPort) });
    await ready(apiPort);
    await nativeContainer(normal[1], ['hindsight-worker', '--http-host', '127.0.0.1', '--http-port', String(workerPort)]);
    await ready(workerPort);
    await nativeContainer(normal[2], ['hindsight-worker', '--http-host', '127.0.0.1', '--http-port', String(oldWorkerPort)]);
    await ready(oldWorkerPort);
    for (const selectedBank of [bank, otherBank]) {
      await request(`/v1/default/banks/${selectedBank}`, 'PUT', { name: 'Synthetic qualification bank' });
      await request(path('/config', selectedBank), 'PATCH', { updates: { retain_strategies: { 'router-approved-v1': { retain_extraction_mode: 'chunks' } }, retain_default_strategy: 'router-approved-v1', enable_observations: false, enable_auto_consolidation: false, default_observation_scopes: [['kind:rule']] } });
      const config = await request<{ config: { retain_strategies: Record<string, { retain_extraction_mode: string }> } }>(path('/config', selectedBank));
      assert.equal(config.config.retain_strategies['router-approved-v1'].retain_extraction_mode, 'chunks');
    }
    const document = `${run}-entry`;
    const text = `Use transactional writes for ревью.\n${privacySentinel} approved distilled statement.`;
    const first = await retain(document, text);
    await settled(first);
    assert.equal((await request<Document>(path(`/documents/${document}`))).original_text, text);
    const facts = await request<NativeList<Fact>>(path(`/memories/list?document_id=${document}&limit=100`));
    assert(facts.items.length > 0); assert(facts.items.every(fact => fact.text.includes('Use transactional writes') || fact.text.includes(privacySentinel)));
    await retain(document, text, '2026-01-02T03:04:05Z', bank, first);
    assert.equal((await request<NativeList<Fact>>(path(`/memories/list?document_id=${document}&limit=100`))).total, facts.total);
    await request(path(`/documents/${document}`, otherBank), 'GET', undefined, 404);
    const otherRecall = await request<{ results: Fact[] }>(path('/memories/recall', otherBank), 'POST', { query: text, types: ['world'], budget: 'low', include: {} });
    assert.equal(otherRecall.results.length, 0);
    checkpoints.push('real-native-api-separate-overlapping-workers-pg17-nonsuperuser', 'named-chunks-normalized-body-readback', 'same-uuid-idempotence', 'native-bank-isolation');

    const nativeTime = facts.items.map(fact => [fact.id, fact.mentioned_at, fact.occurred_start]).sort();
    await settled(await retain(document, text, '2026-09-09T01:02:03Z'));
    const unchanged = await request<NativeList<Fact>>(path(`/memories/list?document_id=${document}&limit=100`));
    assert.deepEqual(unchanged.items.map(fact => [fact.id, fact.mentioned_at, fact.occurred_start]).sort(), nativeTime, 'Same-body reapproval counterfeited a new native event time');
    await request(path(`/documents/${document}`), 'PATCH', { tags: ['kind:rule', 'topic:two'], observation_scopes: [['kind:rule']] });
    assert.deepEqual(new Set((await request<Document>(path(`/documents/${document}`))).tags), new Set(['kind:rule', 'topic:two']));
    await settled(await retain(document, 'Use the current replacement rule.'));
    assert.equal((await request<Document>(path(`/documents/${document}`))).original_text, 'Use the current replacement rule.');
    const currentFacts = await request<NativeList<Fact>>(path(`/memories/list?document_id=${document}`));
    for (const fact of currentFacts.items) await request(path(`/memories/${fact.id}`), 'PATCH', { state: 'invalidated', reason: 'synthetic authorized retirement' });
    const recalledRetired = await request<{ results: Fact[] }>(path('/memories/recall'), 'POST', { query: 'current replacement rule', types: ['world'], budget: 'low', include: {} });
    assert(!recalledRetired.results.some(fact => fact.document_id === document));
    assert.equal((await request<Document>(path(`/documents/${document}`))).original_text, 'Use the current replacement rule.');
    checkpoints.push('same-body-preserves-native-event-time', 'topic-move-reserved-kind-preserved', 'online-replacement-and-all-fact-retirement');

    for (const mode of ['echo400', 'echo500'] as const) {
      stub.setMode(mode);
      const failed = await retain(`${run}-${mode}`, `${privacySentinel} private failing approved statement`);
      await settled(failed, 'failed');
      await request(path('/memories/recall'), 'POST', { query: `${privacySentinel} private recall query`, types: ['world'], budget: 'low' }, 500);
      stub.setMode('normal');
    }
    await request(path('/memories'), 'POST', { items: [{ content: text, timestamp: `${privacySentinel} invalid timestamp` }] }, 422);
    checkpoints.push('provider-4xx-5xx-http-validation-parent-child-error-sinks-private');

    // Exercise a genuinely in-flight native request, then stop every tracked
    // old/current executor and observe actual container exit + DB session drain.
    stub.setMode('hold');
    const late = await retain(document, `${privacySentinel} late queued write must never return`);
    await eventually(async () => stub.held > 0 ? true : undefined, 'in-flight native provider request');
    await stopNative(normal);
    stub.setMode('normal');
    const cleanup = `${run}-cleanup`;
    await nativeContainer(cleanup, ['hindsight-api'], { ...cleanupEnv, HINDSIGHT_API_HOST: '127.0.0.1', HINDSIGHT_API_PORT: String(apiPort) });
    await ready(apiPort);
    const resolved = JSON.parse(await command(['exec', cleanup, 'python', '-c', 'import json; from hindsight_api.config import get_config; c=get_config(); print(json.dumps({k:getattr(c,k) for k in ["worker_enabled","run_migrations_on_startup","consolidation_reconcile_interval_seconds","mental_model_refresh_tick_seconds","retention_sweep_interval_seconds","operation_cleanup_interval_seconds"]}))'])) as Record<string, boolean | number>;
    assert.equal(resolved.worker_enabled, false); assert.equal(resolved.run_migrations_on_startup, false);
    for (const name of Object.keys(cleanupEnv)) assert.equal(resolved[name.replace('HINDSIGHT_API_', '').toLowerCase()], 0);
    const sentinel = await retain(`${run}-queued-sentinel`, `${privacySentinel} paused executor sentinel`);
    await pause(1800);
    assert.equal((await request<Operation>(path(`/operations/${sentinel}`))).status, 'pending', 'Cleanup profile executed queued work');
    await request(path(`/documents/${run}-queued-sentinel`), 'GET', undefined, 404);
    const discovered = new Map<string, Operation>();
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const page = await request<{ operations: Operation[]; total: number }>(path(`/operations?limit=1&offset=${offset}`));
      total = page.total;
      for (const operation of page.operations) {
        const full = await request<Operation>(path(`/operations/${operation.operation_id}?include_payload=true`));
        discovered.set(full.operation_id, full);
      }
      offset += page.operations.length;
      assert(page.operations.length || offset >= total, 'Native operation pagination stopped early');
    }
    assert(discovered.size >= retainedIds.length, 'Historical/queued operation discovery incomplete');
    // This bank contains only disposable test sources. Cancel all its work,
    // snapshot child IDs first, then delete leaves before terminal parents.
    for (const operation of discovered.values()) {
      if (['pending', 'processing'].includes(operation.status)) await request(path(`/operations/${operation.operation_id}`), 'DELETE');
    }
    await request(path(`/documents/${document}`), 'DELETE');
    const ordered = [...discovered.values()].sort((a, b) => Number(Boolean(a.child_operations?.length)) - Number(Boolean(b.child_operations?.length)));
    for (const operation of ordered) await request(path(`/operations/${operation.operation_id}/delete`), 'DELETE');
    for (const operation of discovered.values()) await request(path(`/operations/${operation.operation_id}?include_payload=true`), 'GET', undefined, 404);
    await request(path(`/documents/${document}`), 'GET', undefined, 404);
    assert.equal((await request<NativeList<Fact>>(path(`/memories/list?document_id=${document}`))).total, 0);
    await stopNative([cleanup]);
    await nativeContainer(`${run}-restarted-api`, ['hindsight-api'], { HINDSIGHT_API_HOST: '127.0.0.1', HINDSIGHT_API_PORT: String(apiPort) });
    await ready(apiPort);
    await nativeContainer(`${run}-restarted-worker`, ['hindsight-worker', '--http-host', '127.0.0.1', '--http-port', String(workerPort)]);
    await ready(workerPort);
    await pause(1500);
    await request(path(`/documents/${document}`), 'GET', undefined, 404);
    await request(path(`/operations/${late}`), 'GET', undefined, 404);
    assert.equal((await request<NativeList<Fact>>(path(`/memories/list?document_id=${document}`))).total, 0);
    checkpoints.push('all-executor-exit-and-db-session-closure', 'same-image-resolved-maintenance-off-no-execution', 'paginated-historical-parent-leaf-payload-cleanup', 'forget-absence-after-native-worker-restart');
    assert.equal(stub.calls.unexpected, 0, 'Unscripted native provider request occurred');
    for (const name of containers) {
      if (name === pg) continue;
      const logs = await command(['logs', name], true);
      assert(!logs.includes(privacySentinel), 'Native stdout/stderr leaked private content/credentials');
    }
    const sinkCounts = await sql("SELECT json_build_object('audit_rows',(SELECT count(*) FROM audit_log),'llm_rows',(SELECT count(*) FROM llm_requests),'unsafe_errors',(SELECT count(*) FROM async_operations WHERE error_message LIKE '%RR_NATIVE_PRIVATE_%' OR result_metadata::text LIKE '%RR_NATIVE_PRIVATE_%'))");
    const counts = JSON.parse(sinkCounts) as { audit_rows: number; llm_rows: number; unsafe_errors: number };
    assert.deepEqual(counts, { audit_rows: 0, llm_rows: 0, unsafe_errors: 0 });
    checkpoints.push('stdout-stderr-collector-inputs-trace-audit-operation-sinks-private');
    const evidence = { schema: 'hindsight-native-qualification/v1', startedAt, completedAt: new Date().toISOString(), nativeRevision, imageId, postgresImage, checkpoints, providerCalls: stub.calls, safeSinkCounts: counts, evidenceKind: 'same-derivative-image-real-api-worker-postgresql17-deterministic-inference', realModelQualityQualified: false, productionReleaseQualified: false };
    await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
    const manifest = await command(['exec', `${run}-restarted-api`, 'cat', '/app/hardening-manifest.json']);
    await writeFile(`${output}/hardening-manifest.json`, manifest);
    process.stdout.write(JSON.stringify({ passed: true, checkpoints: checkpoints.length, imageId, evidence: `${output}/evidence.json` }) + '\n');
  } finally {
    for (const name of containers) await command(['rm', '--force', '--volumes', name], true);
    await stub.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  qualifyNative().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Native qualification failed'}\n`); process.exitCode = 1; });
}
