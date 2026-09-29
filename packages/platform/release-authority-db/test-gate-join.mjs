import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(fileURLToPath(new URL('./test-contract.sh', import.meta.url)), 'utf8');
const start = source.lastIndexOf('\ngate_fifos_open=false\n');
const end = source.indexOf('\nREVIEW_ROUTER_RELEASE_AUTHORITY_PROVIDER_DATABASE_URL_FILE=', start);
assert.ok(start >= 0 && end > start, 'bootstrap child join block must exist');
const joinBlock = source.slice(start + '\ngate_fifos_open=false\n'.length, end);

function joinStatus(ownerCommand, brokerCommand, ownerOutput = '', brokerOutput = '') {
  const directory = mkdtempSync(join(tmpdir(), 'rr-gate-join-'));
  try {
    writeFileSync(join(directory, 'bootstrap-owner.out'), ownerOutput);
    writeFileSync(join(directory, 'bootstrap-broker.out'), brokerOutput);
    const script = `set -euo pipefail
contract_tmp=$1
${ownerCommand} &
owner_backend_pid=$!
${brokerCommand} &
broker_backend_pid=$!
${joinBlock}
`;
    const result = spawnSync('bash', ['-c', script, 'gate-join-test', directory], {
      encoding: 'utf8', timeout: 3000,
    });
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('bootstrap client joins reject watchdog exits and accept only expected disconnects', () => {
  const disconnect = 'psql: FATAL:  terminating connection due to administrator command\n';
  assert.equal(joinStatus('exit 0', 'exit 0').status, 0);
  assert.equal(joinStatus('exit 2', 'exit 0', disconnect).status, 0);
  assert.equal(joinStatus('exit 0', 'exit 3', '', disconnect).status, 0);
  const watchdog = joinStatus('timeout -k 0.1s 0.1s sleep 5', 'exit 0', disconnect);
  assert.notEqual(watchdog.status, 0);
  assert.match(watchdog.stderr, /owner bootstrap client exited unexpectedly \(status 124\)/);
  const forcedKill = joinStatus('exit 0', 'exit 137', '', disconnect);
  assert.notEqual(forcedKill.status, 0);
  assert.match(forcedKill.stderr, /broker bootstrap client exited unexpectedly \(status 137\)/);
  assert.notEqual(joinStatus('exit 2', 'exit 0', 'unrelated failure\n').status, 0);
});
