BEGIN;

ALTER TABLE "HostedCodexInvocationGrant"
  ADD COLUMN "failoverRequestId" TEXT;

CREATE UNIQUE INDEX "HostedCodexInvocationGrant_failoverRequestId_key"
  ON "HostedCodexInvocationGrant"("failoverRequestId");

ALTER TABLE "HostedCodexInvocationGrant"
  ADD CONSTRAINT "HostedCodexInvocationGrant_failover_request_fkey"
  FOREIGN KEY ("failoverRequestId") REFERENCES "HostedCodexRelayRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION hosted_codex_invocation_grant_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."runtimeAuthzEpoch" IS NULL OR NEW."runtimeAuthzEpoch" < 1 THEN
      RAISE EXCEPTION 'hosted_codex_runtime_gate_epoch_required';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public."HostedCodexRuntimeGate" gate
      WHERE gate."id" = 'global'
        AND gate."status" = 'active'
        AND gate."authzEpoch" = NEW."runtimeAuthzEpoch"
    ) THEN
      RAISE EXCEPTION 'hosted_codex_runtime_gate_authority_mismatch';
    END IF;
    IF NEW."failoverCount" <> 0
       OR NEW."activeAccountId" IS DISTINCT FROM NEW."primaryAccountId"
       OR NEW."backupAccountId" IS NOT NULL AND NEW."backupAccountId" = NEW."primaryAccountId"
       OR NEW."firstSuccessfulResponseAt" IS NOT NULL
       OR NEW."failoverRequestId" IS NOT NULL THEN
      RAISE EXCEPTION 'hosted_codex_grant_invalid_initial_state';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."invocationId" IS DISTINCT FROM OLD."invocationId"
     OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR NEW."poolId" IS DISTINCT FROM OLD."poolId"
     OR NEW."repositoryConnectionId" IS DISTINCT FROM OLD."repositoryConnectionId"
     OR NEW."repositoryBindingId" IS DISTINCT FROM OLD."repositoryBindingId"
     OR NEW."primaryAccountId" IS DISTINCT FROM OLD."primaryAccountId"
     OR NEW."backupAccountId" IS DISTINCT FROM OLD."backupAccountId"
     OR NEW."reviewRequestId" IS DISTINCT FROM OLD."reviewRequestId"
     OR NEW."providerInvocationKey" IS DISTINCT FROM OLD."providerInvocationKey"
     OR NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."runAttempt" IS DISTINCT FROM OLD."runAttempt"
     OR NEW."model" IS DISTINCT FROM OLD."model" OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
     OR NEW."policyFingerprint" IS DISTINCT FROM OLD."policyFingerprint"
     OR NEW."runtimeConfigVersion" IS DISTINCT FROM OLD."runtimeConfigVersion"
     OR NEW."bindingRevision" IS DISTINCT FROM OLD."bindingRevision" OR NEW."authzEpoch" IS DISTINCT FROM OLD."authzEpoch"
     OR NEW."runtimeAuthzEpoch" IS DISTINCT FROM OLD."runtimeAuthzEpoch"
     OR NEW."capabilityTokenHash" IS DISTINCT FROM OLD."capabilityTokenHash"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."maxRequests" IS DISTINCT FROM OLD."maxRequests"
     OR NEW."maxConcurrentRequests" IS DISTINCT FROM OLD."maxConcurrentRequests"
     OR NEW."maxRequestBytes" IS DISTINCT FROM OLD."maxRequestBytes"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'hosted_codex_grant_identity_immutable';
  END IF;
  IF OLD."firstSuccessfulResponseAt" IS NOT NULL
     AND NEW."firstSuccessfulResponseAt" IS DISTINCT FROM OLD."firstSuccessfulResponseAt" THEN
    RAISE EXCEPTION 'hosted_codex_first_success_immutable';
  END IF;
  IF NEW."activeAccountId" IS DISTINCT FROM OLD."activeAccountId" THEN
    IF OLD."failoverCount" <> 0 OR NEW."failoverCount" <> 1
       OR OLD."activeAccountId" IS DISTINCT FROM OLD."primaryAccountId"
       OR OLD."backupAccountId" IS NULL OR NEW."activeAccountId" IS DISTINCT FROM OLD."backupAccountId"
       OR OLD."failoverRequestId" IS NOT NULL OR NEW."failoverRequestId" IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM public."HostedCodexRelayRequest" request
         WHERE request."id" = NEW."failoverRequestId"
           AND request."grantId" = OLD."id"
           AND request."status" IN ('received', 'processing')
           AND request."successfulResponseStartedAt" IS NULL
       ) THEN
      RAISE EXCEPTION 'hosted_codex_grant_failover_forbidden';
    END IF;
  ELSIF NEW."failoverCount" IS DISTINCT FROM OLD."failoverCount"
        OR NEW."primaryAccountId" IS DISTINCT FROM OLD."primaryAccountId"
        OR NEW."backupAccountId" IS DISTINCT FROM OLD."backupAccountId"
        OR NEW."failoverRequestId" IS DISTINCT FROM OLD."failoverRequestId" THEN
    RAISE EXCEPTION 'hosted_codex_grant_failover_evidence_invalid';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
    OLD."status" = 'issued'
    OR (OLD."status" = 'exhausted' AND NEW."status" = 'revoked')
  ) THEN
    RAISE EXCEPTION 'hosted_codex_grant_terminal_status';
  END IF;
  RETURN NEW;
END
$guard$;

COMMIT;
