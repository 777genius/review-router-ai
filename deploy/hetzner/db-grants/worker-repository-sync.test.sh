#!/usr/bin/env bash
# Real PG17 ACL/trigger contract. Pass an explicit psql command prefix, targeting
# a fresh disposable server only (native psql or docker exec -i CONTAINER psql).
set -euo pipefail
export LC_ALL=C
if [ "$#" -eq 0 ]; then
  echo "usage: $0 <psql command prefix...>" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GRANT_SQL="${RR_WORKER_SYNC_GRANT_SQL:-$ROOT/deploy/hetzner/db-grants/worker-repository-sync.sql}"
MIGRATIONS="$ROOT/packages/platform/db/prisma/migrations"
PSQL=("$@")
mkdir -p "$ROOT/tmp"
WORK="$(mktemp -d "$ROOT/tmp/worker-sync-contract.XXXXXX")"
holder_pid=""
cleanup() {
  local status=$?
  if [ -n "$holder_pid" ]; then
    kill "$holder_pid" 2>/dev/null || true
    wait "$holder_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
fail() { echo "FAIL: $* (fixture logs: $WORK)" >&2; exit 1; }
admin() { "${PSQL[@]}" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d postgres; }
database() { "${PSQL[@]}" -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -d review_router_dimy "$@"; }
owner() { database -U reviewrouter "$@"; }
worker() { database -U reviewrouter_worker "$@"; }
apply_grant() { database < "$GRANT_SQL" > "$WORK/grant.log" 2>&1; }
column_absent() {
  [ "$(owner -qAt -c "SELECT has_column_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','scmRepositoryIdentityId','UPDATE')")" = f ] || fail "SCM UPDATE was granted after refusal"
}
deny_worker() {
  local label="$1" sql="$2"
  if worker -c "$sql" > "$WORK/$label.log" 2>&1; then fail "$label unexpectedly succeeded"; fi
  grep -Eq 'ERROR:[[:space:]]+42501:' "$WORK/$label.log" || fail "$label did not fail with SQLSTATE 42501"
  echo "ok - $label denied with 42501"
}
test -r "$GRANT_SQL" || fail "grant SQL is not readable"

# No IF EXISTS, role reuse, or cleanup of someone else's database is allowed.
admin > "$WORK/bootstrap.log" 2>&1 <<'SQL'
BEGIN;
DO $$ BEGIN
  IF current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999
     OR EXISTS (SELECT 1 FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres')
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('reviewrouter','reviewrouter_worker')) THEN
    RAISE EXCEPTION 'fresh disposable PostgreSQL 17 server required';
  END IF;
END $$;
CREATE ROLE reviewrouter LOGIN;
CREATE ROLE reviewrouter_worker LOGIN;
COMMIT;
CREATE DATABASE review_router_dimy OWNER reviewrouter;
SQL
owner > "$WORK/schema.log" 2>&1 <<'SQL'
CREATE TABLE public."ScmRepositoryIdentity" (
  "scmRepositoryIdentityId" text PRIMARY KEY,
  "currentRepositoryConnectionId" text,
  "currentWorkspaceId" text
);
CREATE TABLE public."RepositoryConnection" (
  "id" text PRIMARY KEY, "workspaceId" text NOT NULL,
  "provider" text, "sourceBaseUrl" text, "externalRepositoryId" text,
  "installationId" text, "githubRepositoryId" bigint, "gitlabInstallationId" text,
  "scmRepositoryIdentityId" text REFERENCES public."ScmRepositoryIdentity"("scmRepositoryIdentityId"),
  "owner" text, "name" text, "fullName" text, "defaultBranch" text, "visibility" text,
  "selected" boolean, "archived" boolean, "stargazersCount" int, "setupStatus" text,
  "inventoryGeneration" bigint, "lifecycleResolutionMode" text,
  "lifecycleResolutionActivationVersion" int, "lastSyncedAt" timestamptz,
  "createdAt" timestamptz, "updatedAt" timestamptz
);
CREATE SEQUENCE public."RepositoryInventoryGeneration";
INSERT INTO public."RepositoryConnection" ("id","workspaceId","installationId")
VALUES ('repo-bound','workspace-1','installation-1'), ('repo-unbound','workspace-1','installation-1');
INSERT INTO public."ScmRepositoryIdentity" VALUES
  ('identity-a',NULL,NULL),
  ('identity-b','another-repository','workspace-1'),
  ('identity-c','repo-unbound','another-workspace');
GRANT SELECT ON public."RepositoryConnection", public."ScmRepositoryIdentity" TO reviewrouter_worker;
GRANT UPDATE ("currentRepositoryConnectionId","currentWorkspaceId")
  ON public."ScmRepositoryIdentity" TO reviewrouter_worker;
SQL
owner < "$MIGRATIONS/000133_allow_first_time_scm_identity_bind/migration.sql" > "$WORK/function.log" 2>&1
awk '/^CREATE TRIGGER "RepositoryConnection_runtime_referential_action_guard"/ { capture=1 }
  capture { print }
  capture && /;[[:space:]]*$/ { exit }' \
  "$MIGRATIONS/000066_codex_oauth_rotating_cascade_authority/migration.sql" > "$WORK/trigger.sql"
test -s "$WORK/trigger.sql" || fail "migration trigger was not extracted"
owner < "$WORK/trigger.sql" > "$WORK/trigger.log" 2>&1
apply_grant || { cat "$WORK/grant.log" >&2; fail "first grant application failed"; }
apply_grant || fail "idempotent grant application failed"

# session_user must be the real LOGIN worker, never a privileged SET ROLE.
if ! worker > "$WORK/first-bind.log" 2>&1 <<'SQL'
BEGIN;
DO $$ BEGIN
  IF session_user <> 'reviewrouter_worker' THEN RAISE EXCEPTION 'real worker LOGIN required'; END IF;
END $$;
UPDATE public."ScmRepositoryIdentity"
SET "currentRepositoryConnectionId"='repo-bound', "currentWorkspaceId"='workspace-1'
WHERE "scmRepositoryIdentityId"='identity-a';
UPDATE public."RepositoryConnection" SET "scmRepositoryIdentityId"='identity-a' WHERE "id"='repo-bound';
COMMIT;
SQL
then cat "$WORK/first-bind.log" >&2; fail "first bind transaction failed"; fi
owner > "$WORK/committed.log" 2>&1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."RepositoryConnection" r JOIN public."ScmRepositoryIdentity" i
      ON i."scmRepositoryIdentityId"=r."scmRepositoryIdentityId"
    WHERE r."id"='repo-bound' AND i."currentRepositoryConnectionId"=r."id"
      AND i."currentWorkspaceId"=r."workspaceId"
  ) THEN RAISE EXCEPTION 'first binding was not committed'; END IF;
  IF has_table_privilege('reviewrouter_worker','public."RepositoryConnection"','INSERT')
     OR has_table_privilege('reviewrouter_worker','public."RepositoryConnection"','UPDATE')
     OR has_table_privilege('reviewrouter_worker','public."RepositoryConnection"','DELETE')
     OR has_column_privilege('reviewrouter_worker','public."RepositoryConnection"','scmRepositoryIdentityId','INSERT')
     OR has_column_privilege('reviewrouter_worker','public."RepositoryConnection"','id','UPDATE')
     OR has_column_privilege('reviewrouter_worker','public."RepositoryConnection"','gitlabInstallationId','UPDATE') THEN
    RAISE EXCEPTION 'worker gained a forbidden write privilege';
  END IF;
END $$;
SQL
echo "ok - real LOGIN first bind commits; repeated grant is idempotent; broad writes absent"
deny_worker clear "UPDATE public.\"RepositoryConnection\" SET \"scmRepositoryIdentityId\"=NULL WHERE \"id\"='repo-bound'"
deny_worker retarget "UPDATE public.\"RepositoryConnection\" SET \"scmRepositoryIdentityId\"='identity-b' WHERE \"id\"='repo-bound'"
deny_worker workspace_move "UPDATE public.\"RepositoryConnection\" SET \"workspaceId\"='workspace-2' WHERE \"id\"='repo-bound'"
deny_worker installation_move "UPDATE public.\"RepositoryConnection\" SET \"installationId\"='installation-2' WHERE \"id\"='repo-bound'"
deny_worker mismatched_repository "UPDATE public.\"RepositoryConnection\" SET \"scmRepositoryIdentityId\"='identity-b' WHERE \"id\"='repo-unbound'"
deny_worker mismatched_workspace "UPDATE public.\"RepositoryConnection\" SET \"scmRepositoryIdentityId\"='identity-c' WHERE \"id\"='repo-unbound'"
deny_worker insert_scm "INSERT INTO public.\"RepositoryConnection\" (\"id\",\"workspaceId\",\"scmRepositoryIdentityId\") VALUES ('forbidden','workspace-1','identity-a')"
deny_worker delete_repository "DELETE FROM public.\"RepositoryConnection\" WHERE \"id\"='repo-bound'"

# Every damaged fixture must refuse BEFORE the sensitive column can be granted.
for drift in disabled tampered_body missing_column missing_delete after_row statement_row when_clause; do
  owner -c 'REVOKE UPDATE ("scmRepositoryIdentityId") ON public."RepositoryConnection" FROM reviewrouter_worker' > /dev/null
  column_absent
  case "$drift" in
    disabled)
      owner -c 'ALTER TABLE public."RepositoryConnection" DISABLE TRIGGER "RepositoryConnection_runtime_referential_action_guard"' > /dev/null ;;
    tampered_body)
      owner > /dev/null <<'SQL'
CREATE OR REPLACE FUNCTION public.codex_oauth_runtime_referential_action_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END $$;
SQL
      ;;
    *)
      owner -c 'DROP TRIGGER "RepositoryConnection_runtime_referential_action_guard" ON public."RepositoryConnection"' > /dev/null
      timing=BEFORE; level=ROW; extra=""; delete_event=' OR DELETE'
      columns='"id","workspaceId","installationId","gitlabInstallationId","scmRepositoryIdentityId"'
      case "$drift" in
        missing_column) columns='"id","workspaceId","installationId","gitlabInstallationId"' ;;
        missing_delete) delete_event="" ;;
        after_row) timing=AFTER ;;
        statement_row) level=STATEMENT ;;
        when_clause) extra='WHEN (false)' ;;
      esac
      owner -c "CREATE TRIGGER \"RepositoryConnection_runtime_referential_action_guard\" $timing UPDATE OF $columns$delete_event ON public.\"RepositoryConnection\" FOR EACH $level $extra EXECUTE FUNCTION public.codex_oauth_runtime_referential_action_guard()" > /dev/null ;;
  esac
  if apply_grant; then fail "$drift guard unexpectedly accepted"; fi
  column_absent
  owner < "$MIGRATIONS/000133_allow_first_time_scm_identity_bind/migration.sql" > /dev/null
  owner -c 'DROP TRIGGER "RepositoryConnection_runtime_referential_action_guard" ON public."RepositoryConnection"' > /dev/null
  owner < "$WORK/trigger.sql" > /dev/null
  apply_grant || fail "$drift fixture did not recover after restoration"
  echo "ok - $drift guard fails closed before SCM UPDATE grant"
done

owner -c 'REVOKE UPDATE ("scmRepositoryIdentityId") ON public."RepositoryConnection" FROM reviewrouter_worker' > /dev/null
lock_application="rr_worker_sync_contract_$$"
database -c "SET application_name='$lock_application'; BEGIN; SELECT pg_advisory_xact_lock(1381126735,1129271120); SELECT pg_sleep(8); COMMIT" > "$WORK/lock-owner.log" 2>&1 &
holder_pid=$!
locked=false
for ((attempt=0; attempt<50; attempt++)); do
  if [ "$(database -qAt -c "SELECT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.application_name='$lock_application' AND l.locktype='advisory' AND l.classid=1381126735 AND l.objid=1129271120 AND l.objsubid=2 AND l.granted)")" = t ]; then locked=true; break; fi
  sleep 0.1
done
[ "$locked" = true ] || fail "owned advisory lock was not observed"
if apply_grant; then fail "contended grant unexpectedly succeeded"; fi
grep -Eq 'ERROR:[[:space:]]+55P03:' "$WORK/grant.log" || fail "contended grant did not hit lock timeout"
column_absent
wait "$holder_pid"
holder_pid=""
apply_grant || fail "grant did not recover after the owned lock released"
echo "ok - canonical activation fence contention times out before grant and recovers"
echo "worker repository sync PG17 contract passed"
