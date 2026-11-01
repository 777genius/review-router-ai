#!/usr/bin/env bash
# One-command release for the Hetzner production host, assembled from the steps of the
# 2026-10-30 and 2026-10-31 rollouts. It builds the image on the host (no CI wait, no
# registry), then runs the same ordered steps by hand-checked sub-commands.
#
#   deploy/hetzner/release.sh build   <sha>   # archive, upload, docker build on the host
#   deploy/hetzner/release.sh backup          # full pgBackRest backup
#   deploy/hetzner/release.sh migrate <sha>   # prisma migrate deploy, canonical ACL, worker grant
#   deploy/hetzner/release.sh swap    <sha>   # prepare + plan; apply only with --apply
#   deploy/hetzner/release.sh verify  <sha>   # fleet, privileges, readiness
#   deploy/hetzner/release.sh all     <sha> [--apply]
#
# RR_DRY_RUN=1 prints the ssh/scp/curl commands without running anything.
#
# Needs: ssh access with passwordless sudo to $RR_HOST, a clean checkout of <sha> locally.
# Does not touch the account gateway (see deploy/hetzner/db-grants/README.md and the
# notes in ai-docs/deployments for the native engine swap).
set -euo pipefail

RR_HOST="${RR_HOST:-iliya@37.27.125.57}"
RR_TMP=""
trap '[ -n "$RR_TMP" ] && rm -rf "$RR_TMP"' EXIT
RR_API_READY="${RR_API_READY:-https://api.reviewrouter.org/ready}"
DRY_RUN="${RR_DRY_RUN:-0}"
ROOT="$(git rev-parse --show-toplevel)"

die() { echo "release: $*" >&2; exit 1; }
# RR_DRY_RUN=1 prints the ssh/scp/curl/git calls instead of running them.
remote() {
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] ssh $RR_HOST sudo -n env $* bash -s  (script on stdin)"; return 0; fi
  ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$RR_HOST" "sudo -n env $* bash -s"
}
copy_to_host() { # copy_to_host <dest> <files...>
  local dest="$1"; shift
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] scp $* $RR_HOST:$dest"; return 0; fi
  scp -q -o BatchMode=yes "$@" "$RR_HOST:$dest"
}
check_ready() {
  if [ "$DRY_RUN" = 1 ]; then echo "[dry-run] curl -fsS $RR_API_READY"; return 0; fi
  curl -fsS -o /dev/null -w "ready=%{http_code}\n" "$RR_API_READY"
}
need_sha() { [[ "${1:-}" =~ ^[a-f0-9]{40}$ ]] || die "a full 40-hex commit sha is required"; }

cmd_build() {
  local sha="$1" t0=$SECONDS archive digest
  RR_TMP="$(mktemp -d)"
  archive="$RR_TMP/rr-src-$sha.tar.gz"
  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] git archive $sha -> private temp dir, sha256 checked on the host"
    digest=0000000000000000000000000000000000000000000000000000000000000000
  else
    git -C "$ROOT" cat-file -e "$sha^{commit}" || die "unknown commit $sha"
    git -C "$ROOT" archive --format=tar.gz --prefix=src/ -o "$archive" "$sha"
    digest="$(shasum -a 256 "$archive" | cut -d' ' -f1)"
  fi
  copy_to_host "" "$archive"
  echo "uploaded in $((SECONDS - t0))s"
  remote "SRC=$sha" "ARCSHA=$digest" <<'REMOTE'
set -euo pipefail
# Build state lives in a root-only directory; the upload is copied in and verified there.
BUILDS=/srv/platform/projects/review-router/builds
install -d -o root -g root -m 0700 "$BUILDS"
B="$BUILDS/rr-build-${SRC:0:12}"
rm -rf "$B"; mkdir -m 0700 "$B"
install -o root -g root -m 0600 "/home/iliya/rr-src-$SRC.tar.gz" "$B/src.tar.gz"; rm -f "/home/iliya/rr-src-$SRC.tar.gz"
[ "$(sha256sum "$B/src.tar.gz" | cut -d' ' -f1)" = "$ARCSHA" ] || { echo "archive checksum mismatch" >&2; exit 1; }
tar --no-same-owner -xzf "$B/src.tar.gz" -C "$B"
cd "$B/src"
DOCKER_BUILDKIT=1 docker build --platform linux/amd64 -f deploy/render-runtime/Dockerfile \
  --build-arg IMAGE_REVISION="$SRC" --build-arg IMAGE_VERSION="main-${SRC:0:12}" \
  -t "reviewrouter-manual:${SRC:0:8}" . > "$B/build.log" 2>&1 || { tail -40 "$B/build.log"; exit 1; }
IMG=$(docker image inspect -f '{{.Id}}' "reviewrouter-manual:${SRC:0:8}")
[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMG")" = "$SRC" ]
echo "$IMG" > "$B/image.id"; echo "image $IMG"
REMOTE
  echo "build done in $((SECONDS - t0))s"
}

cmd_backup() {
  remote <<'REMOTE'
set -euo pipefail
systemctl start review-router-pgbackrest-backup.service
sudo -n -u reviewrouter_pg /usr/local/sbin/review-router-pgbackrest --config=/etc/review-router-postgres/pgbackrest.conf \
  --stanza=reviewrouter --output=json info | jq -r '.[0].backup[-1] | "backup \(.label) \(.type) error=\(.error)"'
REMOTE
}

cmd_migrate() {
  local sha="$1"
  copy_to_host /home/iliya/worker-repository-sync.sql "$ROOT/deploy/hetzner/db-grants/worker-repository-sync.sql"
  remote "SRC=$sha" <<'REMOTE'
set -euo pipefail
B=/srv/platform/projects/review-router/builds/rr-build-${SRC:0:12}
[ "$(stat -c %u:%a "$B")" = 0:700 ] || { echo "build directory is not root-only" >&2; exit 1; }
IMG=$(cat "$B/image.id")
C=/srv/platform/projects/review-router/releases/main-${SRC:0:8}-migrate-$(date -u +%Y%m%d)
PGUID=$(id -u reviewrouter_pg); SOCKGID=$(stat -c %g /var/lib/review-router-postgres/socket)
psql_rr() { sudo -n -u reviewrouter_pg /usr/lib/postgresql/17/bin/psql -X -qAt -v ON_ERROR_STOP=1 -h /var/lib/review-router-postgres/socket -p 5434 -U reviewrouter_pg -d review_router_dimy "$@"; }
install -d -o root -g root -m 0700 "$C"
printf '%s\n' 'postgresql://reviewrouter_pg@localhost:5434/review_router_dimy?host=/run/rr-pg&sslmode=disable' > "$C/database-url"
chown "$PGUID:$SOCKGID" "$C/database-url"; chmod 0600 "$C/database-url"
RUN=(docker run --rm --pull never --network none --read-only --workdir /app --user "$PGUID:$SOCKGID" --cap-drop ALL --security-opt no-new-privileges:true --tmpfs /tmp:rw,nosuid,nodev,size=128m,mode=1777 -e HOME=/tmp)
DB=(--mount type=bind,src=/var/lib/review-router-postgres/socket,dst=/run/rr-pg,readonly --mount type=bind,src="$C/database-url",dst=/run/rr-input/database-url,readonly -e REVIEW_ROUTER_DATABASE_URL_FILE=/run/rr-input/database-url)
echo "== migrate"; "${RUN[@]}" "${DB[@]}" --entrypoint pnpm "$IMG" db:migrate:deploy > "$C/migrate.log" 2>&1 || { tail -20 "$C/migrate.log"; exit 1; }
psql_rr -c "SELECT 'ledger', count(*), count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished FROM _prisma_migrations"
echo "== canonical runtime ACL"
"${RUN[@]}" --entrypoint node "$IMG" --import tsx --input-type=module -e "import{runtimeGrantSql}from'./scripts/run-codex-rotating-release-migration.mjs';process.stdout.write(runtimeGrantSql({roles:[{role:'api',username:'reviewrouter_api'},{role:'web',username:'reviewrouter_web'},{role:'worker',username:'reviewrouter_worker'},{role:'comment-token-custody',username:'reviewrouter_comment_token_custody'},{role:'effect-authority',username:'reviewrouter_codex_effect_authority'}]}))" > "$C/canonical-runtime-acl.sql"
psql_rr -f - < "$C/canonical-runtime-acl.sql" > "$C/acl.log" 2>&1
echo "== worker repository sync grant (the ACL above revokes it)"
psql_rr -f - < /home/iliya/worker-repository-sync.sql > "$C/worker-grant.log" 2>&1
psql_rr -c "SELECT 'worker can update fullName', has_column_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','fullName','UPDATE')"
rm -f /home/iliya/worker-repository-sync.sql
REMOTE
}

cmd_swap() {
  local sha="$1" apply="${2:-}"
  copy_to_host /home/iliya/ "$ROOT/deploy/hetzner/fleet-overlay/fleet-overlay.mjs" "$ROOT/deploy/hetzner/fleet-overlay/cutover.mjs"
  remote "SRC=$sha" "APPLY=$([ "$apply" = --apply ] && echo 1 || echo 0)" <<'REMOTE'
set -euo pipefail
R=/srv/platform/projects/review-router/releases
# A plan and its later --apply may run within the same minute. Each prepare
# needs exclusive custody; never overwrite a previous plan or its evidence.
I=$(mktemp -d "$R/overlay-inputs-${SRC:0:8}-XXXXXXXX")
ID=${I##*/}
ID=${ID#overlay-inputs-}
C=$R/fleet-overlay-$ID
install -o root -g root -m 0600 /home/iliya/fleet-overlay.mjs /home/iliya/cutover.mjs "$I/"; rm -f /home/iliya/fleet-overlay.mjs /home/iliya/cutover.mjs
B=/srv/platform/projects/review-router/builds/rr-build-${SRC:0:12}
[ "$(stat -c %u:%a "$B")" = 0:700 ] || { echo "build directory is not root-only" >&2; exit 1; }
NEW=$(cat "$B/image.id")
python3 - "$I" "$SRC" "$NEW" <<'PY'
import json, subprocess, sys
i, src, new = sys.argv[1:4]
api = "rr-api-credential-rotation-20261011-v1-api-1"
cur = json.loads(subprocess.check_output(["docker", "inspect", api]))[0]
names = {}
for role, sub in (("web", "-web-"), ("api", "-api-"), ("worker", "-worker-"), ("scan", "skills-scan-worker")):
    out = subprocess.check_output(["docker", "ps", "--format", "{{.Names}}"], text=True).split()
    matches = [n for n in out if n.startswith("rr-") and sub in n and "before" not in n and "scanner" not in n and (role != "worker" or "skills-scan" not in n)]
    if len(matches) != 1:
        raise SystemExit(f"swap: expected one running {role} container, found {len(matches)}")
    names[role] = matches[0]
scan = json.loads(subprocess.check_output(["docker", "inspect", names["scan"]]))[0]
private_networks = [n for n in scan["NetworkSettings"]["Networks"] if n != "platform-review-router"]
if len(private_networks) != 1:
    raise SystemExit(f"swap: expected one private scan network, found {len(private_networks)}")
net = private_networks[0]
rev = cur["Config"]["Labels"]["org.opencontainers.image.revision"]
spec = {"machineId": open("/etc/machine-id").read().strip(), "network": net,
        "expectedImage": cur["Image"], "expectedRevision": rev,
        "targetImage": new, "targetImageRef": new, "targetRevision": src, "names": names,
        "updates": [
            {"key": "REVIEW_ROUTER_RUNTIME_RELEASE_COMMIT_SHA", "op": "set", "value": src},
            {"key": "REVIEW_ROUTER_RUNTIME_DEPLOYMENT_PROVENANCE", "op": "set", "value": new[7:]},
            {"key": "REVIEW_ROUTER_RUNTIME_ROLLOUT_ID", "op": "set", "value": f"rr-latest-app-{src[:8]}-{new[7:19]}"}]}
json.dump(spec, open(i + "/overlay-spec.json", "w"), indent=1)
PY
chmod 0600 "$I/overlay-spec.json"
N=/opt/nodejs/node-v24.21.0-linux-x64/bin/node
echo "controller=$C"
$N "$I/fleet-overlay.mjs" prepare "$C" "$I/overlay-spec.json"
$N "$I/fleet-overlay.mjs" plan "$C" "$I/overlay-spec.json"
if [ "$APPLY" = 1 ]; then $N "$I/fleet-overlay.mjs" apply "$C" "$I/overlay-spec.json"; else echo "planned only; rerun with --apply"; fi
REMOTE
}

cmd_verify() {
  local sha="$1"
  remote "SRC=$sha" <<'REMOTE'
set -euo pipefail
python3 - "$SRC" <<'PYVERIFY'
import json, subprocess, sys
expected = sys.argv[1]
names = subprocess.check_output(["docker", "ps", "--format", "{{.Names}}"], text=True).splitlines()
roles = {"web": "-web-", "api": "-api-", "worker": "-worker-", "scan": "skills-scan-worker"}
for role, marker in roles.items():
    matches = [n for n in names if n.startswith("rr-") and marker in n and "before" not in n and "scanner" not in n and (role != "worker" or "skills-scan" not in n)]
    if len(matches) != 1:
        raise SystemExit(f"verify: expected one running {role} container, found {len(matches)}")
    c = json.loads(subprocess.check_output(["docker", "inspect", matches[0]], text=True))[0]
    state = c["State"]
    revision = c["Config"].get("Labels", {}).get("org.opencontainers.image.revision")
    if not state.get("Running") or state.get("Restarting") or c.get("RestartCount") != 0 or revision != expected:
        raise SystemExit(f"verify: {role} state or revision mismatch")
    if state.get("Health", {}).get("Status", "healthy") != "healthy":
        raise SystemExit(f"verify: {role} is unhealthy")
    print(f"{role}: running, no restarts, revision={revision}")
PYVERIFY
REMOTE
  if [ "$DRY_RUN" = 1 ]; then
    echo "[dry-run] ssh $RR_HOST docker exec worker: runtime database privilege check"
  else
    ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$RR_HOST" \
      "sudo -n docker exec -i -w /app -e REVIEW_ROUTER_EXPECT_DB_ROLE=reviewrouter_worker rr-worker-cap-successor-newtest-20261008-v23-worker-1 node --input-type=module -" \
      < "$ROOT/scripts/check-runtime-db-privileges.mjs"
  fi
  check_ready
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    build) need_sha "${1:-}"; cmd_build "$1" ;;
    backup) cmd_backup ;;
    migrate) need_sha "${1:-}"; cmd_migrate "$1" ;;
    swap) need_sha "${1:-}"; cmd_swap "$1" "${2:-}" ;;
    verify) need_sha "${1:-}"; cmd_verify "$1" ;;
    all) need_sha "${1:-}"; cmd_build "$1"; cmd_backup; cmd_migrate "$1"; cmd_swap "$1" "${2:-}"; if [ "${2:-}" = --apply ]; then cmd_verify "$1"; fi ;;
    *) sed -n '2,17p' "$0"; exit 2 ;;
  esac
}
main "$@"
