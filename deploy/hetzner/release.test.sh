#!/usr/bin/env bash
# Tests for release.sh using stub ssh/scp/curl/git binaries. Nothing touches a real host.
# Run: bash deploy/hetzner/release.test.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/release.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
CALLS="$WORK/calls.log"

for tool in ssh scp curl git; do
  cat > "$WORK/bin/$tool" <<STUB
#!/usr/bin/env bash
if [ "$tool" = git ] && [ "\${1:-}" = rev-parse ]; then echo "$HERE/../.."; exit 0; fi
if [ "$tool" = git ] && [ "\${3:-}" = archive ]; then
  # git -C <root> archive ... -o <file> <sha>: create the output file like git does
  for ((i = 1; i <= \$#; i++)); do
    if [ "\${!i}" = -o ]; then j=\$((i + 1)); echo stub-archive > "\${!j}"; fi
  done
fi
echo "$tool \$*" >> "$CALLS"
[ "$tool" = ssh ] && cat > /dev/null
exit 0
STUB
  chmod +x "$WORK/bin/$tool"
done

GOOD_SHA="0123456789abcdef0123456789abcdef01234567"
FAILS=0

# run <args...>: runs release.sh with stubs first in PATH; sets RC and OUT, resets the call log.
run() {
  : > "$CALLS"
  OUT="$(PATH="$WORK/bin:$PATH" RR_HOST=test@example.invalid "$SCRIPT" "$@" 2>&1)"
  RC=$?
}
calls() { grep -c "^$1 " "$CALLS" || true; }
check() { # check <name> <condition result 0/1>
  if [ "$2" = 0 ]; then echo "ok   - $1"; else echo "FAIL - $1"; FAILS=$((FAILS + 1)); fi
}

run
check "no arguments: usage and non-zero exit" "$([ "$RC" -ne 0 ] && echo 0 || echo 1)"
check "no arguments: nothing executed" "$([ ! -s "$CALLS" ] && echo 0 || echo 1)"

for bad in abc "${GOOD_SHA:0:8}" "${GOOD_SHA}0" "${GOOD_SHA//0/G}" "0123456789ABCDEF0123456789ABCDEF01234567"; do
  for cmd in build migrate swap verify all; do
    run "$cmd" "$bad"
    check "$cmd rejects bad sha '${bad:0:12}'" "$([ "$RC" -ne 0 ] && [ ! -s "$CALLS" ] && echo 0 || echo 1)"
  done
done
run build
check "build without sha is rejected" "$([ "$RC" -ne 0 ] && [ ! -s "$CALLS" ] && echo 0 || echo 1)"

run swap "$GOOD_SHA"
check "swap without --apply exits 0" "$([ "$RC" -eq 0 ] && echo 0 || echo 1)"
check "swap without --apply passes APPLY=0" "$(grep -q 'APPLY=0' "$CALLS" && ! grep -q 'APPLY=1' "$CALLS" && echo 0 || echo 1)"

run swap "$GOOD_SHA" --apply
check "swap with --apply passes APPLY=1" "$(grep -q 'APPLY=1' "$CALLS" && echo 0 || echo 1)"

run all "$GOOD_SHA"
check "all without --apply exits 0" "$([ "$RC" -eq 0 ] && echo 0 || echo 1)"
check "all without --apply does not call curl (verify)" "$([ "$(calls curl)" = 0 ] && echo 0 || echo 1)"
check "all without --apply plans only (APPLY=0)" "$(grep -q 'APPLY=0' "$CALLS" && ! grep -q 'APPLY=1' "$CALLS" && echo 0 || echo 1)"

run all "$GOOD_SHA" --apply
check "all with --apply calls verify (curl)" "$([ "$(calls curl)" = 1 ] && echo 0 || echo 1)"

for cmd in "build $GOOD_SHA" backup "migrate $GOOD_SHA" "swap $GOOD_SHA --apply" "verify $GOOD_SHA" "all $GOOD_SHA --apply"; do
  : > "$CALLS"
  # shellcheck disable=SC2086
  OUT="$(RR_DRY_RUN=1 PATH="$WORK/bin:$PATH" RR_HOST=test@example.invalid "$SCRIPT" $cmd 2>&1)"
  RC=$?
  check "dry-run '${cmd%% *}': exit 0, nothing executed, commands printed" \
    "$([ "$RC" -eq 0 ] && [ ! -s "$CALLS" ] && grep -q '\[dry-run\]' <<<"$OUT" && echo 0 || echo 1)"
done

# Execute the real remote verification body against a disposable Docker fixture.
# This catches false success on a partial or wrong-revision fleet, rather than
# merely checking that the script issued an ssh command.
cat > "$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = ps ]; then
  printf '%s\n' rr-test-web-1 rr-test-api-1 "${RR_FIXTURE_WORKER:-rr-test-worker-1}"
  [ "${RR_VERIFY_CASE:-}" != missing ] && echo rr-skills-scan-worker-test
  [ "${RR_VERIFY_CASE:-}" = duplicate ] && echo rr-extra-api-1
  exit 0
fi
if [ "$1" = exec ]; then
  echo "docker-exec $*" >> "$RR_FIXTURE_CALLS"
  cat > "$RR_FIXTURE_DB_STDIN"
  [ "${7:-}" = "fixture-${RR_FIXTURE_WORKER:-rr-test-worker-1}" ] || exit 79
  [ "${6:-}" = REVIEW_ROUTER_EXPECT_DB_ROLE=reviewrouter_worker ] || exit 80
  cmp -s "$RR_FIXTURE_DB_STDIN" "$RR_FIXTURE_CHECKER" || exit 81
  exit "${RR_DB_RC:-0}"
fi
revision="$FIXTURE_SHA"
running=true
restarts=0
health=healthy
case "${RR_VERIFY_CASE:-}" in
  revision) revision=ffffffffffffffffffffffffffffffffffffffff ;;
  stopped) running=false ;;
  restarted) restarts=1 ;;
  unhealthy) health=unhealthy ;;
esac
printf '[{"Id":"fixture-%s","State":{"Running":%s,"Health":{"Status":"%s"}},"RestartCount":%s,"Config":{"Labels":{"org.opencontainers.image.revision":"%s"}}}]\n' "$2" "$running" "$health" "$restarts" "$revision"
STUB
cat > "$WORK/bin/ssh" <<STUB
#!/usr/bin/env bash
echo "ssh \$*" >> "$CALLS"
case "\$*" in
  *'docker exec'*) cat > /dev/null; exit 79 ;;
esac
command="\${!#}"
checker="\${command#*DB_CHECK_B64=}"
export DB_CHECK_B64="\${checker%% *}"
export SRC="$GOOD_SHA"
bash -s
STUB
chmod +x "$WORK/bin/docker" "$WORK/bin/ssh"
export FIXTURE_SHA="$GOOD_SHA"
export RR_FIXTURE_CALLS="$CALLS" RR_FIXTURE_DB_STDIN="$WORK/db-check-input" RR_FIXTURE_CHECKER="$HERE/../../scripts/check-runtime-db-privileges.mjs"
run verify "$GOOD_SHA"
[ "$RC" = 0 ] || echo "$OUT"
check "healthy exact-revision fleet and worker check succeed" "$([ "$RC" = 0 ] && [ "$(calls curl)" = 1 ] && echo 0 || echo 1)"
check "privilege probe uses the inspected worker identity and exact checker input" "$([ "$(calls docker-exec)" = 1 ] && grep -q 'fixture-rr-test-worker-1 node' "$CALLS" && cmp -s "$RR_FIXTURE_DB_STDIN" "$RR_FIXTURE_CHECKER" && echo 0 || echo 1)"
export RR_FIXTURE_WORKER=rr-alternate-worker-production-7
run verify "$GOOD_SHA"
check "renamed worker is verified and probed in the same remote invocation" "$([ "$RC" = 0 ] && [ "$(calls ssh)" = 1 ] && [ "$(calls docker-exec)" = 1 ] && grep -q 'fixture-rr-alternate-worker-production-7 node' "$CALLS" && echo 0 || echo 1)"
unset RR_FIXTURE_WORKER
for scenario in missing duplicate revision stopped restarted unhealthy; do
  export RR_VERIFY_CASE="$scenario"
  run verify "$GOOD_SHA"
  check "verify rejects $scenario before readiness and database checks" "$([ "$RC" -ne 0 ] && [ "$(calls curl)" = 0 ] && [ "$(calls ssh)" = 1 ] && [ "$(calls docker-exec)" = 0 ] && echo 0 || echo 1)"
done
unset RR_VERIFY_CASE
export RR_DB_RC=1
run verify "$GOOD_SHA"
check "worker privilege failure stops verification before readiness" "$([ "$RC" -ne 0 ] && [ "$(calls curl)" = 0 ] && echo 0 || echo 1)"
unset RR_DB_RC

# Run the actual swap-spec generator with disposable inspect/ps results. The API
# and main worker have only the platform network; web and scan use a private one.
python3 - "$SCRIPT" "$WORK" "$GOOD_SHA" <<'PYSWAPTEST'
import io
import json
import pathlib
import sys
from unittest.mock import patch

script, work, target = sys.argv[1:]
source = pathlib.Path(script).read_text()
body = source.split('python3 - "$I" "$SRC" "$NEW" <<\'PY\'\n', 1)[1].split('\nPY\n', 1)[0]
generator = compile(body, script + ':swap-spec', 'exec')
api = 'rr-api-credential-rotation-20261011-v1-api-1'
roles = {'api': api, 'web': 'rr-test-web-1', 'worker': 'rr-test-worker-1',
         'scan': 'rr-skills-scan-worker-test'}
private = 'rr-private-test'
image = 'sha256:' + 'a' * 64
revision = 'b' * 40
real_open = open

def run_case(name, *, missing=None, duplicate=None, networks=None, refusal=None):
    output = pathlib.Path(work) / ('swap-spec-' + name)
    output.mkdir()
    names = [container for role, container in roles.items() if role != missing]
    if duplicate:
        names.append(roles[duplicate] + '-duplicate')
    # Decoys must not turn into a second main worker or replace a live role.
    names += ['rr-before-worker-1', 'rr-skills-scanner-worker-1']
    topology = {roles['api']: ['platform-review-router'],
                roles['worker']: ['platform-review-router'],
                roles['web']: ['platform-review-router', private],
                roles['scan']: ['platform-review-router', private] if networks is None else networks}

    def docker(args, **kwargs):
        if args == ['docker', 'ps', '--format', '{{.Names}}']:
            assert kwargs.get('text') is True
            return '\n'.join(names)
        assert args[:2] == ['docker', 'inspect'] and len(args) == 3, args
        container = args[2]
        assert container in topology, container
        return json.dumps([{'Image': image,
                            'Config': {'Labels': {'org.opencontainers.image.revision': revision}},
                            'NetworkSettings': {'Networks': {network: {} for network in topology[container]}}}]).encode()

    def fixture_open(path, *args, **kwargs):
        if path == '/etc/machine-id':
            return io.StringIO('fixture-machine-id\n')
        return real_open(path, *args, **kwargs)

    with patch('sys.argv', ['swap-spec', str(output), target, image]), \
         patch('subprocess.check_output', side_effect=docker), \
         patch('builtins.open', side_effect=fixture_open):
        try:
            exec(generator, {})
        except SystemExit as error:
            assert refusal is not None and str(error) == refusal, (name, str(error))
            assert not (output / 'overlay-spec.json').exists(), name
        else:
            assert refusal is None, name + ' unexpectedly accepted'
            spec = json.loads((output / 'overlay-spec.json').read_text())
            assert spec['names'] == roles, spec['names']
            assert spec['names']['worker'] != spec['names']['scan']
            assert spec['network'] == private, spec['network']
            assert spec['machineId'] == 'fixture-machine-id'
            assert spec['expectedImage'] == image and spec['expectedRevision'] == revision
            assert spec['targetImage'] == image and spec['targetRevision'] == target
    print('ok   - swap spec ' + name)

run_case('normal topology selects scan private network and distinct main worker')
for count, networks in [(0, ['platform-review-router']), (2, ['platform-review-router', private, 'rr-other-private'])]:
    run_case('rejects ' + str(count) + ' private scan networks', networks=networks,
             refusal=f'swap: expected one private scan network, found {count}')
for role in roles:
    run_case('rejects missing ' + role, missing=role,
             refusal=f'swap: expected one running {role} container, found 0')
    run_case('rejects duplicate ' + role, duplicate=role,
             refusal=f'swap: expected one running {role} container, found 2')
PYSWAPTEST
check "embedded swap-spec topology regression cases" "$?"

echo
if [ "$FAILS" -ne 0 ]; then echo "$FAILS check(s) failed"; exit 1; fi
echo "all checks passed"
