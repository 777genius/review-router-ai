import { Prisma } from "@prisma/client";
import { gatewayProfileUsageProviders } from "./gateway-profile-provider";

/** Read-only attribution from the original authorization, scoped to this call.
 * Older Gateway rows were labelled `codex` for every profile, later ones
 * `unknown` for profiles without a discovery source; the SDK names the vendor.
 * Do not change immutable identities, observed providers/models, or source facts.
 * A malformed/unknown snapshot or an ambiguous allocation cannot correct a label.
 */
export function usageRequestedProviderJoinSql(): Prisma.Sql {
  return Prisma.sql`LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*)=1 THEN min(CASE
      WHEN allocation ? 'nativeContext' THEN CASE
        WHEN allocation#>'{nativeContext,schemaVersion}'='1'::jsonb
          AND allocation#>>'{nativeContext,profileId}'=allocation->>'profileRef'
          AND allocation#>>'{nativeContext,providerId}' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
          AND allocation#>>'{nativeContext,productId}' ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
        THEN allocation#>>'{nativeContext,providerId}' END
      ELSE CASE WHEN u."provider" IN ('codex','unknown')
        THEN qualified.provider ELSE u."provider" END END) END AS provider,
      CASE WHEN count(*)=1 AND bool_and(NOT (allocation ? 'nativeContext'))
        AND bool_and(qualified.subscription IS TRUE)
        THEN '{"status":"known","kind":"subscription"}'::jsonb
        ELSE '{"status":"unknown"}'::jsonb END AS billing
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
    LEFT JOIN jsonb_to_recordset(${JSON.stringify(gatewayProfileUsageProviders)}::jsonb)
      AS qualified("profileRef" text,provider text,subscription boolean)
      ON qualified."profileRef"=allocation->>'profileRef'
    WHERE u."route"='gateway'
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

/** Native request evidence wins; requested allocation context never claims billing. */
export const usageBillingSql = () => Prisma.sql`CASE
  WHEN u."projection"#>'{usage,nativeContext,schemaVersion}'='1'::jsonb
    THEN u."projection"#>'{usage,nativeContext,billing}'
  WHEN u."projection"#>'{usage,nativeContext}' IS NOT NULL
    THEN '{"status":"unknown"}'::jsonb
  ELSE COALESCE(requested_attribution.billing,'{"status":"unknown"}'::jsonb) END`;
