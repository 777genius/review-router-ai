-- Standalone PG17 regression. Run only in a NEW empty disposable database.
\set ON_ERROR_STOP on
SET TIME ZONE 'Europe/Berlin';
CREATE TYPE public."HostedCodexInvocationGrantStatus" AS ENUM ('issued','exhausted','revoked');
CREATE TABLE public."HostedCodexInvocationGrant"(
"id" text PRIMARY KEY,"requestCount" integer NOT NULL DEFAULT 0,"inFlight" integer NOT NULL DEFAULT 0,"revision" integer NOT NULL DEFAULT 0,
"status" public."HostedCodexInvocationGrantStatus" NOT NULL DEFAULT 'issued',"updatedAt" timestamp(3),"expiresAt" timestamp(3) NOT NULL,
"maxRequests" integer NOT NULL DEFAULT 32,"maxConcurrentRequests" integer NOT NULL DEFAULT 2,"maxRequestBytes" integer NOT NULL DEFAULT 2000000);
CREATE TABLE public."HostedCodexRelayRequest"("id" text PRIMARY KEY,"grantId" text NOT NULL,"requestBytes" integer NOT NULL);
CREATE OR REPLACE FUNCTION public.hosted_codex_relay_admission_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  admitted_grant_id TEXT;
BEGIN
  UPDATE public."HostedCodexInvocationGrant" AS target_grant
  SET "requestCount" = target_grant."requestCount" + 1,
      "inFlight" = target_grant."inFlight" + 1,
      "revision" = target_grant."revision" + 1,
      "status" = CASE
        WHEN target_grant."requestCount" + 1 = target_grant."maxRequests" THEN 'exhausted'::public."HostedCodexInvocationGrantStatus"
        ELSE target_grant."status"
      END,
      "updatedAt" = clock_timestamp()
  WHERE target_grant."id" = NEW."grantId"
    AND target_grant."status" = 'issued'
    AND target_grant."expiresAt" > clock_timestamp()
    AND target_grant."requestCount" < target_grant."maxRequests"
    AND target_grant."inFlight" < target_grant."maxConcurrentRequests"
    AND NEW."requestBytes" <= target_grant."maxRequestBytes"
  RETURNING target_grant."id" INTO admitted_grant_id;

  IF admitted_grant_id IS NULL THEN
    RAISE EXCEPTION 'hosted_codex_relay_admission_denied';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER "HostedCodexRelayRequest_admission_guard" BEFORE INSERT ON public."HostedCodexRelayRequest" FOR EACH ROW EXECUTE FUNCTION public.hosted_codex_relay_admission_guard();
INSERT INTO public."HostedCodexInvocationGrant"("id","expiresAt") VALUES ('fresh',(clock_timestamp() AT TIME ZONE 'UTC')+ interval '15 minutes');
DO $test$ BEGIN
 BEGIN INSERT INTO public."HostedCodexRelayRequest" VALUES ('red','fresh',100); RAISE EXCEPTION 'expected_old_clock_failure';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'hosted_codex_relay_admission_denied' THEN RAISE; END IF; END;
 IF (SELECT "requestCount" FROM public."HostedCodexInvocationGrant" WHERE id='fresh')<>0 THEN RAISE EXCEPTION 'failed_admission_consumed'; END IF;
 RAISE NOTICE 'RED reproduced: fresh UTC grant denied in Berlin by old exact trigger';
END $test$;
\ir ../prisma/migrations/000116_hosted_codex_relay_admission_utc/migration.sql
INSERT INTO public."HostedCodexRelayRequest" VALUES ('green','fresh',100);
DO $test$ BEGIN
 IF current_setting('TimeZone') <> 'Europe/Berlin' THEN RAISE EXCEPTION 'caller_timezone_not_restored'; END IF;
 IF (SELECT ("requestCount","inFlight","revision") IS DISTINCT FROM (1,1,1) FROM public."HostedCodexInvocationGrant" WHERE id='fresh') THEN RAISE EXCEPTION 'admission_counter_mismatch'; END IF;
 IF NOT (SELECT "updatedAt" BETWEEN (clock_timestamp() AT TIME ZONE 'UTC')-interval '10 seconds' AND (clock_timestamp() AT TIME ZONE 'UTC') FROM public."HostedCodexInvocationGrant" WHERE id='fresh') THEN RAISE EXCEPTION 'updated_at_not_utc'; END IF;
 RAISE NOTICE 'GREEN: fresh grant admitted exactly once, counters and UTC timestamp correct; caller Berlin restored';
END $test$;
INSERT INTO public."HostedCodexInvocationGrant"("id","expiresAt","requestCount","inFlight","status") VALUES
 ('expired',(clock_timestamp() AT TIME ZONE 'UTC')-interval '1 minute',0,0,'issued'),
 ('budget',(clock_timestamp() AT TIME ZONE 'UTC')+interval '15 minutes',32,0,'issued'),
 ('concurrency',(clock_timestamp() AT TIME ZONE 'UTC')+interval '15 minutes',0,2,'issued'),
 ('oversize',(clock_timestamp() AT TIME ZONE 'UTC')+interval '15 minutes',0,0,'issued'),
 ('revoked',(clock_timestamp() AT TIME ZONE 'UTC')+interval '15 minutes',0,0,'revoked');
DO $test$ DECLARE k text; BEGIN
 FOREACH k IN ARRAY ARRAY['expired','budget','concurrency','oversize','revoked'] LOOP
  BEGIN INSERT INTO public."HostedCodexRelayRequest" VALUES (k,k,CASE WHEN k='oversize' THEN 2000001 ELSE 100 END); RAISE EXCEPTION 'invariant_admitted:%',k;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'hosted_codex_relay_admission_denied' THEN RAISE; END IF; END;
 END LOOP;
 IF (SELECT count(*) FROM public."HostedCodexRelayRequest")<>1 THEN RAISE EXCEPTION 'denied_request_persisted'; END IF;
 IF current_setting('TimeZone')<>'Europe/Berlin' THEN RAISE EXCEPTION 'denied_caller_timezone_not_restored'; END IF;
 RAISE NOTICE 'PASS: expired/budget/concurrency/oversize/revoked all denied without request persistence';
END $test$;
ALTER FUNCTION public.hosted_codex_relay_admission_guard() RESET timezone;
DO $test$ BEGIN
 IF (SELECT proconfig FROM pg_proc WHERE oid='public.hosted_codex_relay_admission_guard()'::regprocedure) IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[] THEN RAISE EXCEPTION 'rollback_config_mismatch'; END IF;
 RAISE NOTICE 'PASS: rollback restored exact original function config';
END $test$;
