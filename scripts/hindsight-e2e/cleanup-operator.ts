import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalHindsightCleanup, hindsightCleanupBankDigest, hindsightCleanupDigest, signHindsightCleanupReceipt, verifyHindsightCleanupReceipt, type HindsightCleanupAbsence, type HindsightCleanupBinding, type HindsightCleanupProof } from '../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-receipt.ts';
import { dockerCommand as docker, eventually, freePort, pause } from './native-runtime.ts';

interface OperatorPlan {
  readonly profile: 'docker-complete-inventory-v1';
  readonly binding: HindsightCleanupBinding;
  readonly nativeBankId: string;
  readonly deploymentLabel: string;
  readonly executorContainerIds: readonly string[];
  readonly apiContainerId: string;
  readonly restartContainerIds: readonly string[];
  readonly trackedOperationIds: readonly string[];
  readonly database: { readonly containerId: string; readonly port: number; readonly name: string; readonly adminUser: string };
  readonly routerPauseCheckUrl: string;
}
type Inspection = { Id: string; Image: string; Config: { Env: string[]; Cmd: string[]; Labels: Record<string, string> }; State: { Running: boolean; Pid: number; Status: string; ExitCode: number } };
type Operation = { operation_id: string; status: string; task_payload?: unknown; result_metadata?: { parent_operation_id?: string }; child_operations?: Operation[] };
type Fact = { id: string; source_memory_ids?: string[] };
type List<T> = { items: T[]; total: number };
const stamp = () => new Date().toISOString();
const id = (value: string) => /^[a-f0-9]{64}$/.test(value);
const safeName = (value: string) => /^[a-zA-Z0-9_.:-]{1,200}$/.test(value);
function containsDocument(value: unknown, document: string): boolean {
  if (Array.isArray(value)) return value.some(item => containsDocument(item, document));
  return !!value && typeof value === 'object' && Object.entries(value).some(([key, item]) => key === 'document_id' && item === document || containsDocument(item, document));
}
function containsId(value: unknown, ids: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some(item => containsId(item, ids));
  return !!value && typeof value === 'object' && Object.values(value).some(item => containsId(item, ids));
}
function documentIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(documentIds);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => key === 'document_id' && typeof item === 'string' ? [item] : documentIds(item));
}

/** Real Docker host observations only; no caller-provided exit/absence booleans. */
export async function runDockerHindsightCleanup(plan: OperatorPlan, credentials: { readonly nativeServiceKey: string; readonly routerOperatorToken: string; readonly signingKeyId: string; readonly signingPrivateKey: string; readonly signingPublicKey: string }) {
  assert.equal(plan.profile, 'docker-complete-inventory-v1');
  assert.equal(hindsightCleanupBankDigest(plan.nativeBankId), plan.binding.bankIdDigest);
  assert(safeName(plan.nativeBankId) && /^io\.reviewrouter\.hindsight\.deployment=[a-zA-Z0-9_.-]+$/.test(plan.deploymentLabel));
  assert(plan.executorContainerIds.length > 0 && plan.executorContainerIds.length <= 64 && plan.executorContainerIds.every(id) && new Set(plan.executorContainerIds).size === plan.executorContainerIds.length);
  assert(plan.executorContainerIds.includes(plan.apiContainerId) && plan.restartContainerIds.length > 0 && plan.restartContainerIds.every(container => plan.executorContainerIds.includes(container)));
  assert(plan.trackedOperationIds.length <= 1024 && plan.trackedOperationIds.every(value => /^[a-f0-9-]{36}$/i.test(value)));
  assert(id(plan.database.containerId) && Number.isSafeInteger(plan.database.port) && plan.database.port > 0 && plan.database.port < 65536 && safeName(plan.database.name) && safeName(plan.database.adminUser));
  assert(credentials.nativeServiceKey && credentials.routerOperatorToken && credentials.nativeServiceKey !== credentials.routerOperatorToken && credentials.signingPrivateKey !== credentials.nativeServiceKey);
  const pauseUrl = new URL(plan.routerPauseCheckUrl);
  assert(pauseUrl.protocol === 'https:' || pauseUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(pauseUrl.hostname));
  const inspect = async (container: string): Promise<Inspection> => JSON.parse(await docker(['inspect', '--format', '{{json .}}', container])) as Inspection;
  const inspectAll = async () => {
    const containers = (await docker(['ps', '--all', '--no-trunc', '--filter', `label=${plan.deploymentLabel}`, '--format', '{{.ID}}'])).trim().split('\n').filter(Boolean);
    const native: Inspection[] = [];
    for (const container of containers) {
      const record = await inspect(container);
      const role = record.Config.Labels?.['io.reviewrouter.hindsight.role'];
      if (role === 'api' || role === 'worker' || record.Image === plan.binding.imageDigest) native.push(record);
    }
    assert.deepEqual(native.map(record => record.Id).sort(), [...plan.executorContainerIds].sort(), 'Executor inventory drift; no receipt can be issued');
    assert(native.every(record => record.Image === plan.binding.imageDigest), 'An unqualified old executor image remains');
    return native;
  };
  async function checkPause() {
    const response = await fetch(pauseUrl, { headers: { Authorization: `Bearer ${credentials.routerOperatorToken}` }, signal: AbortSignal.timeout(5_000) });
    assert.equal(response.status, 200, 'Current Router pause could not be verified');
    const state = await response.json() as { binding: HindsightCleanupBinding; submissionsPaused: boolean };
    assert.equal(state.submissionsPaused, true);
    assert.equal(canonicalHindsightCleanup(state.binding), canonicalHindsightCleanup(plan.binding), 'Router pause binding changed');
  }
  await checkPause();
  const pauseObservedAt = stamp();
  const inventory = await inspectAll();
  const api = inventory.find(record => record.Id === plan.apiContainerId)!;
  const originalEnvironment = Object.fromEntries(api.Config.Env.filter(value => value.startsWith('HINDSIGHT_API_')).map(value => { const equal = value.indexOf('='); return [value.slice(0, equal), value.slice(equal + 1)]; }));
  const configuredDsn = originalEnvironment.HINDSIGHT_API_DATABASE_URL; assert(configuredDsn);
  const databaseUrl = new URL(configuredDsn);
  assert(['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) && Number(databaseUrl.port || 5432) === plan.database.port && databaseUrl.pathname === `/${plan.database.name}`, 'Docker DB session observer is not bound to the native database');
  const sql = async (statement: string) => (await docker(['exec', plan.database.containerId, 'psql', '-U', plan.database.adminUser, '-p', String(plan.database.port), '-d', plan.database.name, '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement])).trim();
  assert(Number(await sql('SHOW server_version_num')) >= 170000 && Number(await sql('SHOW server_version_num')) < 180000);
  const executorRecords: HindsightCleanupProof['executors'][number][] = [];
  for (const record of inventory) {
    const environment = Object.fromEntries(record.Config.Env.map(value => { const equal = value.indexOf('='); return [value.slice(0, equal), value.slice(equal + 1)]; }));
    const dsn = environment.HINDSIGHT_API_DATABASE_URL; assert(dsn);
    const applicationName = new URL(dsn).searchParams.get('application_name');
    assert(applicationName && safeName(applicationName), 'Executor has no traceable DB application_name');
    await docker(['stop', '--time', '30', record.Id]);
    const stopped = await inspect(record.Id);
    assert.equal(stopped.State.Running, false); assert.equal(stopped.State.Pid, 0); assert.equal(stopped.State.Status, 'exited');
    executorRecords.push({ containerId: record.Id, imageDigest: record.Image, databaseApplicationName: applicationName, pidBefore: record.State.Pid, pidAfter: 0, running: false, exitCode: stopped.State.ExitCode, observedAt: stamp() });
  }
  await inspectAll();
  await eventually(async () => await sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()") === '0' ? true : undefined, 'all native DB sessions closed');
  const sessionsClosedAt = stamp();
  const port = await freePort();
  const cleanupName = `rr-hindsight-cleanup-${randomUUID()}`;
  databaseUrl.searchParams.set('application_name', cleanupName);
  const environment = { ...originalEnvironment, HINDSIGHT_API_DATABASE_URL: databaseUrl.toString(), HINDSIGHT_API_HOST: '127.0.0.1', HINDSIGHT_API_PORT: String(port), HINDSIGHT_API_WORKER_ENABLED: 'false', HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP: 'false', HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS: '0', HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS: '0', HINDSIGHT_API_RETENTION_SWEEP_INTERVAL_SECONDS: '0', HINDSIGHT_API_OPERATION_CLEANUP_INTERVAL_SECONDS: '0', HINDSIGHT_API_LLM_TRACE_ENABLED: 'false', HINDSIGHT_API_OTEL_TRACES_ENABLED: 'false', HINDSIGHT_API_AUDIT_LOG_ENABLED: 'false', HINDSIGHT_API_LLM_DEBUG_DUMP_4XX: 'false', HINDSIGHT_API_MCP_ENABLED: 'false', HINDSIGHT_API_ENABLE_FILE_UPLOAD_API: 'false', HINDSIGHT_API_ACCESS_LOG: 'false' };
  await docker(['run', '--detach', '--name', cleanupName, '--network', 'host', ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]), plan.binding.imageDigest, 'hindsight-api']);
  const base = `http://127.0.0.1:${port}`;
  const document = `entry-${plan.binding.entryId}`;
  const bankPath = (bank = plan.nativeBankId) => `/v1/default/banks/${encodeURIComponent(bank)}`;
  async function request<T>(path: string, method = 'GET', body?: unknown, allowed = [200]): Promise<T | null> {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${credentials.nativeServiceKey}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    assert(allowed.includes(response.status), 'Native cleanup request did not reach its required postcondition');
    if (response.status === 404) return null;
    return await response.json() as T;
  }
  try {
    await eventually(async () => { try { return (await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok ? true : undefined; } catch { return undefined; } }, 'cleanup API readiness', 120_000);
    const configuration = JSON.parse(await docker(['exec', cleanupName, 'python', '-c', 'import json; from hindsight_api.config import get_config; c=get_config(); print(json.dumps({k:getattr(c,k) for k in ["worker_enabled","run_migrations_on_startup","consolidation_reconcile_interval_seconds","mental_model_refresh_tick_seconds","retention_sweep_interval_seconds","operation_cleanup_interval_seconds"]}))'])) as Record<string, number | boolean>;
    assert.equal(configuration.worker_enabled, false); assert.equal(configuration.run_migrations_on_startup, false);
    for (const key of ['consolidation_reconcile_interval_seconds', 'mental_model_refresh_tick_seconds', 'retention_sweep_interval_seconds', 'operation_cleanup_interval_seconds']) assert.equal(configuration[key], 0);
    const list = async <T>(suffix: string): Promise<T[]> => {
      const all: T[] = []; let total = Infinity;
      while (all.length < total) {
        const page = await request<List<T>>(`${bankPath()}${suffix}${suffix.includes('?') ? '&' : '?'}limit=100&offset=${all.length}`);
        assert(page && page.total <= 10_000 && (page.items.length > 0 || all.length === page.total));
        total = page.total; all.push(...page.items);
      }
      return all;
    };
    const sourceFacts = [...await list<Fact>(`/memories/list?document_id=${encodeURIComponent(document)}&state=valid`), ...await list<Fact>(`/memories/list?document_id=${encodeURIComponent(document)}&state=invalidated`)];
    const sourceIds = new Set(sourceFacts.map(fact => fact.id));
    const operations: Operation[] = []; let operationTotal = Infinity;
    while (operations.length < operationTotal) {
      const page = await request<{ operations: Operation[]; total: number }>(`${bankPath()}/operations?limit=100&offset=${operations.length}`);
      assert(page && page.total <= 10_000 && (page.operations.length || operations.length === page.total));
      operationTotal = page.total; operations.push(...page.operations);
    }
    const full = new Map<string, Operation>();
    for (const operation of operations) {
      const state = await request<Operation>(`${bankPath()}/operations/${operation.operation_id}?include_payload=true`);
      assert(state); full.set(state.operation_id, state);
    }
    const related = new Set(plan.trackedOperationIds);
    for (const operation of full.values()) if (containsDocument(operation, document)) related.add(operation.operation_id);
    for (const operationId of [...related]) {
      const operation = full.get(operationId);
      if (operation?.result_metadata?.parent_operation_id) related.add(operation.result_metadata.parent_operation_id);
    }
    for (const operationId of [...related]) for (const child of full.get(operationId)?.child_operations ?? []) related.add(child.operation_id);
    assert(related.size <= 1024, 'Cleanup exceeds the bounded first-profile operation inventory');
    for (const operationId of related) assert(documentIds(full.get(operationId)).every(value => value === document), 'Mixed-source native retain batch is unsupported by the first cleanup profile');
    const sentinelBank = `rr-cleanup-probe-${randomUUID()}`;
    await request(bankPath(sentinelBank), 'PUT', { name: 'Disposable no-execution probe' });
    await request(`${bankPath(sentinelBank)}/config`, 'PATCH', { updates: { audit_log_enabled: false } });
    const sentinelId = randomUUID(); const sentinelStarted = stamp(); const pollIntervalMs = 500; const observedPolls = 3;
    await request(`${bankPath(sentinelBank)}/memories`, 'POST', { items: [{ content: 'Synthetic cleanup execution sentinel', document_id: 'cleanup-probe' }], async: true, operation_id: sentinelId });
    for (let poll = 0; poll < observedPolls; poll++) { await pause(pollIntervalMs); assert.equal((await request<Operation>(`${bankPath(sentinelBank)}/operations/${sentinelId}`))?.status, 'pending'); }
    const sentinelEnded = stamp();
    const sentinel = await request<Operation>(`${bankPath(sentinelBank)}/operations/${sentinelId}`); assert(sentinel);
    for (const child of sentinel.child_operations ?? []) await request(`${bankPath(sentinelBank)}/operations/${child.operation_id}`, 'DELETE', undefined, [200, 409]);
    await request(`${bankPath(sentinelBank)}/operations/${sentinelId}`, 'DELETE', undefined, [200, 409]);
    for (const child of sentinel.child_operations ?? []) await request(`${bankPath(sentinelBank)}/operations/${child.operation_id}/delete`, 'DELETE');
    await request(`${bankPath(sentinelBank)}/operations/${sentinelId}/delete`, 'DELETE');
    await request(bankPath(sentinelBank), 'DELETE');
    const relevant = [...related].map(operationId => full.get(operationId)).filter((value): value is Operation => !!value);
    for (const operation of relevant) if (['pending', 'processing'].includes(operation.status)) await request(`${bankPath()}/operations/${operation.operation_id}`, 'DELETE', undefined, [200, 409]);
    await request(`${bankPath()}/documents/${encodeURIComponent(document)}`, 'DELETE', undefined, [200, 404]);
    relevant.sort((a, b) => Number(Boolean(a.child_operations?.length)) - Number(Boolean(b.child_operations?.length)));
    for (const operation of relevant) await request(`${bankPath()}/operations/${operation.operation_id}/delete`, 'DELETE', undefined, [200, 404]);
    async function absence(): Promise<HindsightCleanupAbsence> {
      assert.equal(await request(`${bankPath()}/documents/${encodeURIComponent(document)}`, 'GET', undefined, [404]), null);
      for (const state of ['valid', 'invalidated']) {
        assert.equal((await list<Fact>(`/memories/list?document_id=${encodeURIComponent(document)}&state=${state}`)).length, 0);
        for (const observation of await list<Fact>(`/memories/list?type=observation&state=${state}`)) {
          assert(!observation.source_memory_ids?.some(source => sourceIds.has(source)), 'A live observation still cites the forgotten source');
          const history = await request<unknown>(`${bankPath()}/memories/${observation.id}/history`, 'GET', undefined, [200, 404]);
          assert(!containsDocument(history, document) && !containsId(history, sourceIds), 'Observation history still exposes forgotten source evidence');
        }
      }
      for (const operationId of related) await request(`${bankPath()}/operations/${operationId}?include_payload=true`, 'GET', undefined, [404]);
      return { documentAbsent: true, sourceFactCount: 0, evidenceSourceCount: 0, operationPayloadCount: 0, observedAt: stamp() };
    }
    const beforeRestart = await absence();
    await checkPause(); await inspectAll();
    await docker(['stop', '--time', '30', cleanupName]);
    for (const container of plan.restartContainerIds) await docker(['start', container]);
    for (const container of plan.restartContainerIds) {
      const record = await inspect(container);
      assert(record.State.Running && record.Image === plan.binding.imageDigest);
      const settings = Object.fromEntries(record.Config.Env.map(value => { const equal = value.indexOf('='); return [value.slice(0, equal), value.slice(equal + 1)]; }));
      const worker = record.Config.Labels?.['io.reviewrouter.hindsight.role'] === 'worker';
      const argument = record.Config.Cmd?.indexOf('--http-port') ?? -1;
      const readyPort = Number(worker ? argument >= 0 ? record.Config.Cmd[argument + 1] : settings.HINDSIGHT_API_WORKER_HTTP_PORT || 8889 : settings.HINDSIGHT_API_PORT || 8888);
      await eventually(async () => { try { return (await fetch(`http://127.0.0.1:${readyPort}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok ? true : undefined; } catch { return undefined; } }, 'restarted executor readiness', 120_000);
      if (worker) await eventually(async () => {
        const response = await fetch(`http://127.0.0.1:${readyPort}/health/live`, { signal: AbortSignal.timeout(1000) });
        const state = await response.json() as { seconds_since_last_poll?: number; is_shutdown?: boolean };
        return response.ok && state.is_shutdown === false && typeof state.seconds_since_last_poll === 'number' && state.seconds_since_last_poll < 5 ? true : undefined;
      }, 'restarted worker poll progress');
    }
    const restartObservedAt = stamp();
    // Reuse the cleanup API only as a read observer after restarting executors.
    await docker(['start', cleanupName]);
    await eventually(async () => { try { return (await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok ? true : undefined; } catch { return undefined; } }, 'post-restart observer readiness', 120_000);
    await pause(3 * pollIntervalMs);
    const afterRestart = await absence();
    await checkPause(); await inspectAll();
    const inventoryRecords = executorRecords.map(({ containerId, imageDigest, databaseApplicationName }) => ({ containerId, imageDigest, databaseApplicationName })).sort((a, b) => a.containerId.localeCompare(b.containerId));
    const proof: HindsightCleanupProof = { schema: 'hindsight-cleanup-proof/v1', binding: plan.binding, profile: plan.profile, documentId: document, deploymentInventoryDigest: hindsightCleanupDigest(inventoryRecords), deploymentExecutorCount: executorRecords.length, pauseObservedAt, executors: executorRecords, sessionsClosedAt, openExecutorSessions: 0, cleanupApiImageDigest: plan.binding.imageDigest, cleanupConfiguration: { workerEnabled: false, migrationsEnabled: false, consolidationReconcileSeconds: 0, mentalModelRefreshSeconds: 0, retentionSweepSeconds: 0, operationCleanupSeconds: 0 }, queuedSentinel: { operationId: sentinelId, status: 'pending', startedAt: sentinelStarted, endedAt: sentinelEnded, pollIntervalMs, observedPolls }, removedOperationIds: [...related, sentinelId, ...(sentinel.child_operations ?? []).map(child => child.operation_id)], beforeRestart, restartObservedAt, restartImageDigest: plan.binding.imageDigest, afterRestart, completedAt: stamp() };
    const receipt = signHindsightCleanupReceipt(proof, credentials.signingKeyId, credentials.signingPrivateKey);
    assert(verifyHindsightCleanupReceipt(receipt, plan.binding, { [credentials.signingKeyId]: credentials.signingPublicKey }, new Date()), 'Observed evidence did not satisfy the receipt contract');
    return receipt;
  } finally { await docker(['rm', '--force', cleanupName], true); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  (async () => {
    const [planPath, receiptPath] = process.argv.slice(2);
    assert(planPath && receiptPath, 'Usage: node cleanup-operator.ts PLAN.json RECEIPT.json');
    const privateKeyPath = process.env.HINDSIGHT_CLEANUP_SIGNING_PRIVATE_KEY_FILE;
    const publicKeyPath = process.env.HINDSIGHT_CLEANUP_SIGNING_PUBLIC_KEY_FILE;
    assert(privateKeyPath && publicKeyPath && ((await stat(privateKeyPath)).mode & 0o077) === 0, 'Signing private key must be a separate mode0600 Ed25519 key file');
    const receipt = await runDockerHindsightCleanup(JSON.parse(await readFile(planPath, 'utf8')) as OperatorPlan, { nativeServiceKey: process.env.HINDSIGHT_OPERATOR_NATIVE_SERVICE_KEY ?? '', routerOperatorToken: process.env.REVIEW_ROUTER_MEMORY_OPERATOR_TOKEN ?? '', signingKeyId: process.env.HINDSIGHT_CLEANUP_SIGNING_KEY_ID ?? '', signingPrivateKey: await readFile(privateKeyPath, 'utf8'), signingPublicKey: await readFile(publicKeyPath, 'utf8') });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    process.stdout.write('Signed native cleanup receipt created; submit to Router for current-fence verification.\n');
  })().catch(() => { process.stderr.write('Native cleanup remains pending. Keep Router submissions paused and retain operator evidence.\n'); process.exitCode = 1; });
}
