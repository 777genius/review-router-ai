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
worker_write_absent() {
  local label="$1"
  local result
  result="$(owner -qAt -c "SELECT
    has_column_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','id','INSERT'),
    has_column_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','fullName','INSERT'),
    has_column_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','fullName','UPDATE'),
    has_column_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','scmRepositoryIdentityId','UPDATE'),
    has_table_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','INSERT'),
    has_table_privilege('reviewrouter_worker','public.\"RepositoryConnection\"','UPDATE'),
    has_table_privilege('reviewrouter_worker','public.\"GitHubInstallation\"','INSERT'),
    has_table_privilege('reviewrouter_worker','public.\"GitHubInstallation\"','DELETE'),
    has_column_privilege('reviewrouter_worker','public.\"GitHubInstallation\"','workspaceId','UPDATE')")"
  [ "$result" = 'f|f|f|f|f|f|f|f|f' ] ||
    fail "$label left worker writes after guard verification failure ($result)"
  deny_worker "$label-no-write" "$(insert_repo_sql "forbidden-$label" 'workspace-2' 'installation-1' '1088' 1088)"
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
-- Owner-provided installation fixture; worker has no SELECT grant here.
-- The insert trigger must read the parent under SECURITY DEFINER.
CREATE TABLE public."GitHubInstallation" (
  "id" text PRIMARY KEY, "workspaceId" text NOT NULL
);
INSERT INTO public."GitHubInstallation" VALUES
  ('installation-1','workspace-1'),
  ('installation-foreign','workspace-2');
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
-- Canonical ACL initially gives broad worker DML on the installation anchor.
-- Explicit column grants must also be stripped, not just table privileges.
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE
  ON public."GitHubInstallation" TO reviewrouter_worker;
GRANT INSERT ("id","workspaceId"), UPDATE ("id","workspaceId")
  ON public."GitHubInstallation" TO reviewrouter_worker;
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

insert_repo_sql() {
  local id="$1" workspace="$2" installation="$3" external="$4"
  local repository_id="$5" provider="${6:-github}" source="${7:-https://github.com}"
  printf 'INSERT INTO public."RepositoryConnection" ("id","workspaceId","installationId","provider","sourceBaseUrl","externalRepositoryId","githubRepositoryId","owner","name","fullName","defaultBranch","visibility") VALUES ('"'"'%s'"'"','"'"'%s'"'"','"'"'%s'"'"','"'"'%s'"'"','"'"'%s'"'"','"'"'%s'"'"',%s,'"'"'owner'"'"','"'"'repo'"'"','"'"'owner/repo'"'"','"'"'main'"'"','"'"'private'"'"');' \
    "$id" "$workspace" "$installation" "$provider" "$source" "$external" "$repository_id"
}
# Exercise the actual LOGIN-backed worker; SET ROLE from an owner would bypass
# session_user and therefore would not prove the tenant boundary.
worker -c "$(insert_repo_sql 'repo-created' 'workspace-1' 'installation-1' '1001' 1001)" \
  > "$WORK/worker-insert-success.log" 2>&1 || fail "legitimate worker INSERT failed"
[ "$(owner -qAt -c "SELECT count(*) FROM public.\"RepositoryConnection\" WHERE \"id\"='repo-created'")" = 1 ] \
  || fail "legitimate worker INSERT not committed"
deny_worker foreign_tenant_insert "$(insert_repo_sql 'forbidden-ws' 'workspace-2' 'installation-1' '1002' 1002)"
deny_worker foreign_installation_insert "$(insert_repo_sql 'forbidden-install' 'workspace-1' 'installation-foreign' '1003' 1003)"
deny_worker missing_installation_insert "$(insert_repo_sql 'forbidden-missing' 'workspace-1' 'missing-installation' '1004' 1004)"
deny_worker mismatched_repository_id "$(insert_repo_sql 'forbidden-id' 'workspace-1' 'installation-1' 'different-id' 1005)"
deny_worker invalid_provider_insert "$(insert_repo_sql 'forbidden-provider' 'workspace-1' 'installation-1' '1006' 1006 gitlab)"
deny_worker invalid_source_insert "$(insert_repo_sql 'forbidden-source' 'workspace-1' 'installation-1' '1007' 1007 github 'https://attacker.invalid')"
deny_worker zero_repository_id "$(insert_repo_sql 'forbidden-zero' 'workspace-1' 'installation-1' '0' 0)"
deny_worker null_installation_insert 'INSERT INTO public."RepositoryConnection" ("id","workspaceId","provider","sourceBaseUrl","externalRepositoryId","githubRepositoryId") VALUES ('"'"'forbidden-null'"'"','"'"'workspace-1'"'"','"'"'github'"'"','"'"'https://github.com'"'"','"'"'1008'"'"',1008)'
deny_worker insert_scm_identity 'INSERT INTO public."RepositoryConnection" ("id","workspaceId","installationId","scmRepositoryIdentityId") VALUES ('"'"'forbidden-identity'"'"','"'"'workspace-1'"'"','"'"'installation-1'"'"','"'"'identity-a'"'"')'
# The guarded LOGIN cannot move or forge the installation tenant anchor.
deny_worker forged_installation 'INSERT INTO public."GitHubInstallation" ("id","workspaceId") VALUES ('"'"'forged-anchor'"'"','"'"'workspace-2'"'"')'
deny_worker moved_installation 'UPDATE public."GitHubInstallation" SET "workspaceId"='"'"'workspace-2'"'"' WHERE "id"='"'"'installation-1'"'"''
deny_worker deleted_installation 'DELETE FROM public."GitHubInstallation" WHERE "id"='"'"'installation-1'"'"''
[ "$(owner -qAt -c "SELECT has_table_privilege('reviewrouter_worker','public.\"GitHubInstallation\"','SELECT')")" = t ] ||
  fail "worker lost sanctioned read access to GitHubInstallation"
echo "ok - valid LOGIN insert and cross-tenant/identity/provider INSERT denials; immutable tenant anchor"

# Independent column-grant drift on the parent must also be stripped by the
# post-ACL owner grant, while API-owned installation writers stay untouched.
owner -c 'GRANT INSERT ("id"), UPDATE ("workspaceId") ON public."GitHubInstallation" TO reviewrouter_worker' > /dev/null
apply_grant || fail "reapplication did not revoke parent column-grant drift"
deny_worker anchor_drift_forgery 'INSERT INTO public."GitHubInstallation" ("id","workspaceId") VALUES ('"'"'anchor-after-drift'"'"','"'"'workspace-2'"'"')'
deny_worker anchor_drift_move 'UPDATE public."GitHubInstallation" SET "workspaceId"='"'"'workspace-2'"'"' WHERE "id"='"'"'installation-1'"'"''

# Re-apply after a previously successful worker grant without pre-revoking
# even one column. A refused re-verification MUST commit denial before return.
# Real LOGIN INSERT must fail 42501 while any guard is absent or corrupted.
owner -c 'ALTER TABLE public."RepositoryConnection" DISABLE TRIGGER "RepositoryConnection_worker_insert_scope_guard"' > /dev/null
if apply_grant; then fail "disabled INSERT trigger unexpectedly accepted"; fi
worker_write_absent disabled-guard
owner -c 'ALTER TABLE public."RepositoryConnection" ENABLE TRIGGER "RepositoryConnection_worker_insert_scope_guard"' > /dev/null
apply_grant || fail "guard did not recover after explicit reenable"
worker -c "$(insert_repo_sql 'repo-after-reenable' 'workspace-1' 'installation-1' '1009' 1009)" > /dev/null ||
  fail "legitimate worker INSERT not restored after explicit reenable"
owner -c 'DROP TRIGGER "RepositoryConnection_worker_insert_scope_guard" ON public."RepositoryConnection"' > /dev/null
if apply_grant; then fail "missing INSERT trigger unexpectedly accepted"; fi
worker_write_absent missing-guard
owner -c 'DROP FUNCTION public.reviewrouter_worker_repository_insert_guard()' > /dev/null
apply_grant || fail "owner failed to reinitialize fully removed guard"
owner > "$WORK/insert-guard-tamper.log" 2>&1 <<'SQL'
CREATE OR REPLACE FUNCTION public.reviewrouter_worker_repository_insert_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $tampered$ BEGIN RETURN NEW; END $tampered$;
SQL
if apply_grant; then fail "tampered INSERT function unexpectedly accepted"; fi
worker_write_absent tampered-guard
owner -c 'DROP TRIGGER "RepositoryConnection_worker_insert_scope_guard" ON public."RepositoryConnection"' > /dev/null
owner -c 'DROP FUNCTION public.reviewrouter_worker_repository_insert_guard()' > /dev/null
apply_grant || fail "owner failed to recover from tampered function after explicit reset"
worker -c "$(insert_repo_sql 'repo-after-tamper-repair' 'workspace-1' 'installation-1' '1010' 1010)" > /dev/null ||
  fail "legitimate worker INSERT not restored after explicit tamper repair"
[ "$(owner -qAt -c "SELECT count(*) FROM public.\"RepositoryConnection\" WHERE \"id\" LIKE 'forbidden-%'")" = 0 ] \
  || fail "a denied cross-tenant INSERT persisted"
echo "ok - disabled/missing/tampered INSERT guard blocks privilege reissue"

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
