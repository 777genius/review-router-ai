import { Prisma } from "@prisma/client";
import { accountModelDiscoveryProfile } from "@agent-teams/account-gateway/contracts";

// The SDK owns qualification; profile IDs select that registry, never a model
// name or a generic wire protocol. Unknown profiles retain their recorded label.
const profiles = [
  "openai-codex-oauth-responses-v1",
  "openrouter-openai-responses-apikey-v1",
].flatMap((profileRef) => {
  const profile = accountModelDiscoveryProfile(profileRef);
  return profile ? [{ profileRef, provider: profile.source }] : [];
});

/** Read-only attribution from the original authorization, scoped to this call.
 * Do not change immutable identities, observed providers/models, or source facts.
 * A malformed/unknown snapshot or an ambiguous allocation cannot correct a label.
 */
export function usageRequestedProviderJoinSql(): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN min(qualified.provider) END AS provider
    FROM "ReviewRunAuthorization" auth
    CROSS JOIN LATERAL (SELECT CASE
      WHEN auth."runtimeSnapshotCanonicalJson" IS JSON OBJECT
      THEN auth."runtimeSnapshotCanonicalJson"::jsonb
      ELSE '{}'::jsonb END AS snapshot) frozen
    CROSS JOIN LATERAL jsonb_array_elements(CASE
      WHEN frozen.snapshot->'snapshotVersion'='3'::jsonb
        AND jsonb_typeof(frozen.snapshot->'gateway')='object'
        THEN jsonb_build_array(frozen.snapshot->'gateway')
      WHEN frozen.snapshot->'snapshotVersion'='4'::jsonb
        AND jsonb_typeof(frozen.snapshot->'allocations')='array'
        THEN frozen.snapshot->'allocations'
      ELSE '[]'::jsonb END) allocation
    LEFT JOIN jsonb_to_recordset(${JSON.stringify(profiles)}::jsonb)
      AS qualified("profileRef" text,provider text)
      ON qualified."profileRef"=allocation->>'profileRef'
    WHERE u."provider"='codex' AND u."route"='gateway'
      AND auth."authorizationId"=u."projection"#>>'{identity,authorizationId}'
      AND auth."workspaceId"=u."workspaceId"
      AND auth."sourceRunId"=u."runId"
      AND auth."sourceRunAttempt"=u."projection"#>>'{identity,runAttempt}'
      AND allocation->>'bindingId'=u."bindingId"
      AND allocation->>'invocationId'=u."projection"#>>'{identity,invocationId}'
      AND allocation->>'attemptId'=u."projection"#>>'{identity,attemptId}'
  ) requested_attribution ON true`;
}

export const usageRequestedProviderSql = () =>
  Prisma.sql`COALESCE(requested_attribution.provider,u."provider")`;
