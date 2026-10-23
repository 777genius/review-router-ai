import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { acquireDeploymentLock } from './deployment-lock.ts';
import { leafFirstOperations, operationClosure, persistCleanupInventory, readCleanupInventory, signCleanupInventory, verifyCleanupInventory, type CleanupOperation, type CleanupSourceInventory } from './cleanup-inventory.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const binding = { namespace: 'native', generation: 'generation-1', scopeDigest: 'a'.repeat(64), bankIdDigest: 'b'.repeat(64), entryId: 'entry-1', forgetCommandId: randomUUID(), imageDigest: `sha256:${'c'.repeat(64)}`, pauseEpoch: '1' };
const inventory: CleanupSourceInventory = { schema: 'hindsight-cleanup-inventory/v1', binding, documentId: 'entry-entry-1', capturedAt: new Date().toISOString(), sourceFactIds: [randomUUID()], observationIds: [randomUUID()], operationIds: [randomUUID()] };

test('actual Linux flock survives acquiring subprocess exit and excludes another launcher until close', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rr-hindsight-fence-'));
  try {
    await chmod(directory, 0o700); const path = join(directory, 'deployment.lock');
    const first = await acquireDeploymentLock(path);
    try { await first.assertHeld(); await assert.rejects(acquireDeploymentLock(path)); await first.assertHeld(); } finally { await first.close(); }
    const next = await acquireDeploymentLock(path); try { await next.assertHeld(); } finally { await next.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('signed fsynced inventory preserves evidence identities after partial deletion and refuses overwrite/tamper', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rr-hindsight-inventory-'));
  try {
    await chmod(directory, 0o700); const path = join(directory, 'inventory.json');
    assert.equal(await readCleanupInventory(path, binding, 'operator', publicPem), undefined);
    const signed = signCleanupInventory(inventory, 'operator', privatePem);
    await persistCleanupInventory(path, signed);
    assert.deepEqual(await readCleanupInventory(path, binding, 'operator', publicPem), inventory);
    await assert.rejects(persistCleanupInventory(path, signed));
    const stored = JSON.parse(await readFile(path, 'utf8')); stored.inventory.sourceFactIds = [];
    assert.throws(() => verifyCleanupInventory(stored, binding, 'operator', publicPem));
    assert.throws(() => verifyCleanupInventory(signed, { ...binding, pauseEpoch: '3' }, 'operator', publicPem));
    assert.throws(() => verifyCleanupInventory(signCleanupInventory({ ...inventory, sourceFactIds: [] }, 'operator', privatePem), binding, 'operator', publicPem));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recursive operation closure includes ancestors, deep descendants and reverse parent edges, then deletes leaves first', () => {
  const [parent, child, grandchild, sibling, other] = Array.from({ length: 5 }, () => randomUUID());
  const operations = new Map<string, CleanupOperation>([
    [parent!, { operation_id: parent!, status: 'cancelled', child_operations: [{ operation_id: child!, status: 'cancelled' }] }],
    [child!, { operation_id: child!, status: 'cancelled', result_metadata: { parent_operation_id: parent! } }],
    [grandchild!, { operation_id: grandchild!, status: 'cancelled', result_metadata: { parent_operation_id: child! } }],
    [sibling!, { operation_id: sibling!, status: 'cancelled', result_metadata: { parent_operation_id: parent! } }],
    [other!, { operation_id: other!, status: 'completed' }],
  ]);
  const closure = operationClosure(operations, [grandchild!]);
  assert.deepEqual(closure, new Set([parent, child, grandchild, sibling]));
  const order = leafFirstOperations(operations, closure);
  assert(order.indexOf(grandchild!) < order.indexOf(child!) && order.indexOf(child!) < order.indexOf(parent!) && order.indexOf(sibling!) < order.indexOf(parent!));
  operations.set(parent!, { ...operations.get(parent!)!, result_metadata: { parent_operation_id: grandchild! } });
  assert.throws(() => leafFirstOperations(operations, closure));
});

test('SQL observer cannot use an unrelated same-named PostgreSQL container as absence proof', async () => {
  const { nativeSqlObserverArguments } = await import('./operator-host.ts');
  const actual = new URL('postgresql://native:synthetic@127.0.0.1:55432/actual_native?application_name=api&sslmode=disable');
  const args = nativeSqlObserverArguments(actual.toString(), binding.imageDigest, 'SELECT count(*) FROM observation_history');
  assert.deepEqual(args.slice(0, 4), ['run', '--rm', '--network', 'host']);
  const observer = new URL(args[args.indexOf('--env') + 1]!.slice('HINDSIGHT_API_DATABASE_URL='.length));
  assert.equal(observer.hostname, actual.hostname); assert.equal(observer.port, actual.port); assert.equal(observer.pathname, actual.pathname); assert.equal(observer.username, actual.username); assert.equal(observer.password, actual.password); assert.equal(observer.searchParams.get('sslmode'), 'disable');
  assert(!args.includes('exec') && !args.includes('psql') && !args.includes('unrelated-postgres-container'));
  assert(args.includes(binding.imageDigest));
});

test('same-ID executor restart during stopped phase and unexpected post-restart replica fail closed', async () => {
  const { assertExecutorPhase } = await import('./operator-host.ts');
  const stopped = { Id: 'executor', Image: binding.imageDigest, Config: { Env: [], Cmd: [], Labels: { 'io.reviewrouter.hindsight.role': 'worker' } }, HostConfig: { RestartPolicy: { Name: 'no' } }, State: { Running: false, Pid: 0, Status: 'exited', ExitCode: 0 } };
  assert.doesNotThrow(() => assertExecutorPhase([stopped], ['executor'], 'stopped'));
  const restarted = { ...stopped, State: { Running: true, Pid: 456, Status: 'running', ExitCode: 0 } };
  assert.throws(() => assertExecutorPhase([restarted], ['executor'], 'stopped'));
  assert.doesNotThrow(() => assertExecutorPhase([restarted], ['executor'], 'restarted'));
  assert.throws(() => assertExecutorPhase([restarted], [], 'restarted'));
  assert.throws(() => assertExecutorPhase([{ ...stopped, HostConfig: { RestartPolicy: { Name: 'always' } } }], ['executor'], 'stopped'));
});
