import type { Prisma, PrismaClient } from "@prisma/client";
import { fingerprintDatabaseRecoveryWitness } from "@reviewrouter/features-codex-oauth-rotating";
import type { ForcedRecoveryAuthority } from "../../domain/codex-rotating-setup-manifest-policy";

type SetupManifestQueryClient = Pick<PrismaClient, "$queryRaw">;

export async function assertCodexRotatingSetupRecoveryWitness(
  tx: SetupManifestQueryClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly configuredRecoveryWitness?: string;
    readonly forcedRecoveryAuthority: ForcedRecoveryAuthority | null;
  },
): Promise<string> {
  const currentFingerprint = fingerprintConfiguredSetupRecoveryWitness(
    input.configuredRecoveryWitness,
  );
  if (
    input.forcedRecoveryAuthority &&
    (input.forcedRecoveryAuthority.databaseRecoveryWitness !==
      currentFingerprint ||
      (input.forcedRecoveryAuthority.kind === "replay" &&
        input.forcedRecoveryAuthority.manifestDatabaseRecoveryWitness !==
          currentFingerprint))
  ) {
    throw new Error("codex_rotating_setup_recovery_required");
  }
  if (input.forcedRecoveryAuthority) {
    const recoveryOwnerId = `setup-recovery:${input.forcedRecoveryAuthority.requestId}`;
    const exactAuthority = await tx.$queryRaw<
      Array<{ readonly allowed: boolean }>
    >`
      SELECT EXISTS (
        SELECT 1
        FROM "CodexOAuthSetupRecoveryRequest" recovery
        JOIN "CodexOAuthProviderInstance" provider
          ON provider."id" = recovery."providerInstanceRowId"
        LEFT JOIN "CodexOAuthSetupManifest" manifest
          ON manifest."id" = recovery."latestManifestId"
        WHERE provider."id" = ${input.providerInstanceRowId}
          AND recovery."recoveryRequestId" = ${input.forcedRecoveryAuthority.requestId}
          AND recovery."mutationEpoch" = ${input.forcedRecoveryAuthority.epoch}
          AND recovery."databaseRecoveryWitness" = ${currentFingerprint}
          AND recovery."mode" IN ('forced_reseed', 'forced_reseed_account_switch')
          AND (
            (${input.forcedRecoveryAuthority.kind} = 'allocation'
              AND recovery."state" = 'active'
              AND recovery."latestManifestId" IS NULL
              AND provider."mutationEpoch" = recovery."mutationEpoch"
              AND provider."mutationOwner" = 'recovery'
              AND provider."mutationOwnerId" = ${recoveryOwnerId})
            OR
            (${input.forcedRecoveryAuthority.kind} = 'replay'
              AND recovery."state" = 'manifest_issued'
              AND manifest."providerInstanceRowId" = provider."id"
              AND manifest."status" = 'issued'
              AND manifest."mutationEpoch" = recovery."mutationEpoch" + 1
              AND manifest."mutationEpoch" = provider."mutationEpoch"
              AND manifest."databaseRecoveryWitness" = ${currentFingerprint}
              AND provider."mutationOwner" = 'setup'
              AND provider."mutationOwnerId" = manifest."id")
          )
      ) AS "allowed"
    `;
    if (exactAuthority[0]?.allowed !== true) {
      throw new Error("codex_rotating_setup_recovery_required");
    }
  }
  const evidence = await tx.$queryRaw<
    Array<{ readonly databaseRecoveryWitness: string | null }>
  >`
    SELECT evidence."databaseRecoveryWitness"
    FROM (
      SELECT manifest."databaseRecoveryWitness", manifest."mutationEpoch" AS "authorityEpoch",
             manifest."createdAt", 1 AS priority, manifest."id"
      FROM "CodexOAuthSetupManifest" manifest
      WHERE manifest."providerInstanceRowId" = ${input.providerInstanceRowId}
        AND manifest."mutationEpoch" IS NOT NULL
      UNION ALL
      SELECT claim."databaseRecoveryWitness", claim."recoveryEpoch" AS "authorityEpoch",
             claim."createdAt", 2 AS priority, claim."id"
      FROM "CodexOAuthSetupPayloadClaim" claim
      WHERE claim."providerInstanceRowId" = ${input.providerInstanceRowId}
      UNION ALL
      SELECT intent."databaseRecoveryWitness", intent."mutationEpoch" AS "authorityEpoch",
             intent."createdAt", 3 AS priority, intent."id"
      FROM "CodexOAuthWritebackIntent" intent
      WHERE intent."providerInstanceRowId" = ${input.providerInstanceRowId}
        AND intent."mutationEpoch" IS NOT NULL
      UNION ALL
      SELECT namespace."databaseRecoveryWitness",
             COALESCE(claim."recoveryEpoch", intent."mutationEpoch", 0::bigint) AS "authorityEpoch",
             namespace."createdAt", 4 AS priority, namespace."id"
      FROM "CodexOAuthSecretNamespace" namespace
      LEFT JOIN "CodexOAuthSetupDispatchAttempt" attempt
        ON attempt."namespaceId" = namespace."id"
      LEFT JOIN "CodexOAuthSetupPayloadClaim" claim
        ON claim."id" = attempt."claimId"
      LEFT JOIN "CodexOAuthWritebackIntent" intent
        ON intent."secretNamespaceId" = namespace."id"
      WHERE namespace."providerInstanceRowId" = ${input.providerInstanceRowId}
    ) evidence
    ORDER BY evidence."authorityEpoch" DESC, evidence.priority DESC,
             evidence."createdAt" DESC, evidence."id" DESC
    LIMIT 1
  `;
  if (input.forcedRecoveryAuthority?.kind === "allocation") {
    const liveAuthority = await tx.$queryRaw<Array<{ readonly count: bigint }>>`
      SELECT (
        (SELECT count(*) FROM "CodexOAuthSetupManifest"
         WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
           AND "status" IN ('issued', 'fetched'))
        +
        (SELECT count(*) FROM "CodexOAuthSetupPayloadClaim"
         WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
           AND "status" IN ('prepared', 'confirmed_candidate', 'active'))
        +
        (SELECT count(*) FROM "CodexOAuthSecretNamespace"
         WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
           AND "status" IN ('dispatch_authorized', 'confirmed_candidate', 'active'))
        +
        (SELECT count(*) FROM "CodexOAuthSetupDispatchAttempt" attempt
         JOIN "CodexOAuthSetupPayloadClaim" claim ON claim."id" = attempt."claimId"
         WHERE claim."providerInstanceRowId" = ${input.providerInstanceRowId}
           AND attempt."status" IN ('dispatch_authorized', 'confirmed'))
        +
        (SELECT count(*) FROM "CodexOAuthWritebackIntent"
         WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
           AND ("status" = 'pending'
             OR ("status" = 'remote_outcome_unknown' AND "recoveryResolvedAt" IS NULL)))
      )::bigint AS count
    `;
    if (liveAuthority[0]?.count !== 0n) {
      throw new Error("codex_rotating_setup_recovery_required");
    }
  }
  const persistedFingerprint = evidence[0]?.databaseRecoveryWitness;
  if (
    persistedFingerprint !== undefined &&
    persistedFingerprint !== currentFingerprint
  ) {
    if (input.forcedRecoveryAuthority?.kind !== "allocation") {
      throw new Error("codex_rotating_setup_recovery_required");
    }
  }
  return currentFingerprint;
}

export function fingerprintConfiguredSetupRecoveryWitness(
  configuredRecoveryWitness: string | undefined,
): string {
  try {
    return fingerprintDatabaseRecoveryWitness(configuredRecoveryWitness ?? "");
  } catch {
    throw new Error("codex_rotating_setup_recovery_required");
  }
}

export async function requireProvenWriter(
  tx: Prisma.TransactionClient,
  expectedIncarnation?: string,
  expectedRecoveryWitness?: string,
  configuredRecoveryWitness?: string,
): Promise<{
  databaseIncarnation: string;
  databaseRecoveryWitness: string;
}> {
  let databaseRecoveryWitness: string;
  try {
    databaseRecoveryWitness = fingerprintDatabaseRecoveryWitness(
      configuredRecoveryWitness ?? "",
    );
  } catch {
    throw new Error("codex_rotating_retryable_uncommitted");
  }
  let rows: Array<{ writer: boolean; databaseIncarnation: string }>;
  try {
    rows = await tx.$queryRaw`
      SELECT NOT pg_is_in_recovery() AS "writer",
             "system_identifier"::text AS "databaseIncarnation"
      FROM pg_control_system()
    `;
  } catch {
    throw new Error("codex_rotating_retryable_uncommitted");
  }
  const proof = rows[0];
  if (
    !proof?.writer ||
    !/^[1-9][0-9]+$/.test(proof.databaseIncarnation) ||
    (expectedIncarnation !== undefined &&
      proof.databaseIncarnation !== expectedIncarnation) ||
    (expectedRecoveryWitness !== undefined &&
      databaseRecoveryWitness !== expectedRecoveryWitness)
  ) {
    throw new Error("codex_rotating_retryable_uncommitted");
  }
  return {
    databaseIncarnation: proof.databaseIncarnation,
    databaseRecoveryWitness,
  };
}
