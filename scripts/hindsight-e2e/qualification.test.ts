import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { embedding, dimensions, privacySentinel, startProviderStub } from './provider-stub.ts';
import { prepare } from './prepare-hardening.ts';

test('deterministic lexical vectors are finite, normalized and multilingual', () => {
  const vector = embedding('Reviewed transactional правило');
  assert.equal(vector.length, dimensions);
  assert(vector.every(Number.isFinite));
  assert(Math.abs(vector.reduce((sum, value) => sum + value * value, 0) - 1) < 1e-12);
  assert.deepEqual(vector, embedding('Reviewed transactional правило'));
  assert.notDeepEqual(vector, embedding('unrelated source'));
});

test('provider stub fails unscripted calls and supplies intentional private error echoes', async () => {
  const stub = await startProviderStub();
  try {
    const unknown = await fetch(`${stub.url}/v1/chat/completions`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'An unscripted semantic task' }] }) });
    assert.equal(unknown.status, 400);
    assert.equal(stub.calls.unexpected, 1);
    for (const mode of ['echo400', 'echo500'] as const) {
      stub.setMode(mode);
      const response = await fetch(`${stub.url}/v1/embeddings`, { method: 'POST', body: JSON.stringify({ input: [privacySentinel] }) });
      assert.equal(response.status, mode === 'echo400' ? 400 : 500);
      assert((await response.text()).includes(privacySentinel));
    }
  } finally { await stub.close(); }
});

test('privacy sink removes fstrings, exception bodies, tracebacks, extras and uncaught errors', () => {
  const privacy = resolve(dirname(fileURLToPath(import.meta.url)), '../../deploy/hindsight/native-privacy.py');
  const result = spawnSync('python', ['-c', `
import importlib.util,logging,sys,types,warnings
spec=importlib.util.spec_from_file_location('native_privacy',sys.argv[1])
privacy=importlib.util.module_from_spec(spec); spec.loader.exec_module(privacy)
privacy.install(); privacy.install()
secret='RR_NATIVE_PRIVATE_5C36E924'
logging.basicConfig(level=logging.DEBUG)
warnings.warn(secret)
try:
 raise RuntimeError(secret)
except RuntimeError as error:
 original=str(error)
 logging.getLogger('synthetic.native').error(f'query={secret}',extra={'private_payload':secret},exc_info=True)
 assert str(error)==original
 record=logging.getLogger('synthetic.native').makeRecord('synthetic.native',40,'fixed.py',123,secret,(),(type(error),error,error.__traceback__),extra={'private_payload':secret})
 assert 'private_payload' not in record.__dict__
 assert record.exc_info is None and record.stack_info is None
 sys.excepthook(type(error),error,error.__traceback__)
 threading_args=types.SimpleNamespace(exc_type=type(error),exc_value=error,exc_traceback=error.__traceback__)
 import threading
 threading.excepthook(threading_args)
 print('safe_sink_verified')
`, privacy], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, 'Python privacy sink probe did not complete');
  const output = result.stdout + result.stderr;
  assert(!output.includes(privacySentinel));
  assert(output.includes('RuntimeError'));
  assert(output.includes('native_event='));
  assert(output.includes('safe_sink_verified'));
});

test('pinned native readiness error exposes its class without the poisoned DB message', { skip: !process.env.HINDSIGHT_SOURCE_CHECKOUT }, async () => {
  const { files } = await prepare(process.env.HINDSIGHT_SOURCE_CHECKOUT!);
  const source = files['engine/memory_engine.py']!.after;
  const start = source.indexOf('    async def health_check(self)');
  const end = source.indexOf('    @staticmethod', start);
  assert(start >= 0 && end > start);
  const healthMethod = source.slice(start, end).split('\n').map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n');
  const code = `import asyncio,time\n${healthMethod}\nclass Probe:\n _initialized=True\n async def _get_backend(self): raise RuntimeError('RR_NATIVE_PRIVATE_5C36E924')\n health_check=health_check\nresult=asyncio.run(Probe().health_check())\nassert result=={'status':'unhealthy','database':'error','error':'RuntimeError'}\nprint('private_health_verified')\n`;
  const result = spawnSync('python', ['-c', code], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'private_health_verified');
  assert(!(result.stdout + result.stderr).includes(privacySentinel));
});

test('scripted consolidation update uses real candidate identity and refuses a missing candidate', async () => {
  const stub = await startProviderStub();
  const observation = '11111111-1111-4111-8111-111111111111';
  const fact = '22222222-2222-4222-8222-222222222222';
  try {
    stub.setObservationUpdateFixture({ observationId: observation, sourceMarker: 'supporting-fixture' });
    const send = (candidate: string) => fetch(`${stub.url}/v1/chat/completions`, { method: 'POST', body: JSON.stringify({ model: 'stub-model', messages: [{ role: 'user', content: `### New facts\n[${fact}] supporting-fixture\n### Existing observations\n${candidate}` }] }) });
    const accepted = await send(observation); assert.equal(accepted.status, 200);
    const completion = await accepted.json() as { choices: { message: { content: string } }[] };
    const actions = JSON.parse(completion.choices[0]!.message.content);
    assert.deepEqual(actions.creates, []); assert.equal(actions.updates[0].observation_id, observation); assert.deepEqual(actions.updates[0].source_fact_ids, [fact]);
    assert.equal((await send('No candidate supplied by native retrieval')).status, 400);
    assert.equal(stub.calls.unexpected, 1);
  } finally { await stub.close(); }
});
