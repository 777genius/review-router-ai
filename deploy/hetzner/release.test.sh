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

echo
if [ "$FAILS" -ne 0 ]; then echo "$FAILS check(s) failed"; exit 1; fi
echo "all checks passed"
