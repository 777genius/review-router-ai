import type { Prisma } from "@prisma/client";

export async function retireAttemptAndNamespace(
  tx: Prisma.TransactionClient,
  attemptId: string,
  namespaceId: string,
  now: Date,
  expectedFence: Readonly<{
    providerInstanceRowId: string;
    ownerId: string;
    epoch: bigint;
  }>,
) {
  return retireAttemptAndNamespaceWithStatus(
    tx,
    attemptId,
    namespaceId,
    now,
    expectedFence,
    "retired_ambiguous",
  );
}

export async function retirePredispatchAttemptAndNamespace(
  tx: Prisma.TransactionClient,
  attemptId: string,
  namespaceId: string,
  now: Date,
  expectedFence: Readonly<{
    providerInstanceRowId: string;
    ownerId: string;
    epoch: bigint;
  }>,
) {
  return retireAttemptAndNamespaceWithStatus(
    tx,
    attemptId,
    namespaceId,
    now,
    expectedFence,
    "retired_predispatch",
  );
}

async function retireAttemptAndNamespaceWithStatus(
  tx: Prisma.TransactionClient,
  attemptId: string,
  namespaceId: string,
  now: Date,
  expectedFence: Readonly<{
    providerInstanceRowId: string;
    ownerId: string;
    epoch: bigint;
  }>,
  namespaceRetirementStatus: "retired_ambiguous" | "retired_predispatch",
) {
  const rows = await tx.$queryRaw<
    Array<{
      attemptId: string;
      attemptClaimId: string;
      attemptNamespaceId: string;
      attemptStatus: string;
      attemptRetiredAt: Date | null;
      namespaceProviderInstanceRowId: string;
      namespaceEpoch: bigint;
      namespaceSecretName: string;
      namespaceStatus: string;
      namespacePermanentlyRetired: boolean;
      namespaceRetiredAt: Date | null;
      claimProviderInstanceRowId: string;
      claimRecoveryEpoch: bigint;
      claimManifestId: string;
      providerMutationOwner: string | null;
      providerMutationOwnerId: string | null;
      providerMutationEpoch: bigint;
    }>
  >`
    SELECT attempt."id" AS "attemptId", attempt."claimId" AS "attemptClaimId",
      attempt."namespaceId" AS "attemptNamespaceId", attempt."status" AS "attemptStatus",
      attempt."retiredAt" AS "attemptRetiredAt",
      namespace."providerInstanceRowId" AS "namespaceProviderInstanceRowId",
      namespace."namespaceEpoch", namespace."secretName" AS "namespaceSecretName",
      namespace."status" AS "namespaceStatus",
      namespace."permanentlyRetired" AS "namespacePermanentlyRetired",
      namespace."retiredAt" AS "namespaceRetiredAt",
      claim."providerInstanceRowId" AS "claimProviderInstanceRowId",
      claim."recoveryEpoch" AS "claimRecoveryEpoch", claim."manifestId" AS "claimManifestId",
      provider."mutationOwner" AS "providerMutationOwner",
      provider."mutationOwnerId" AS "providerMutationOwnerId",
      provider."mutationEpoch" AS "providerMutationEpoch"
    FROM "CodexOAuthSetupDispatchAttempt" attempt
    JOIN "CodexOAuthSecretNamespace" namespace ON namespace."id" = attempt."namespaceId"
    JOIN "CodexOAuthSetupPayloadClaim" claim ON claim."id" = attempt."claimId"
    JOIN "CodexOAuthProviderInstance" provider ON provider."id" = claim."providerInstanceRowId"
    WHERE attempt."id" = ${attemptId} AND namespace."id" = ${namespaceId}
    FOR UPDATE OF attempt, namespace, claim, provider
  `;
  const row = rows[0];
  if (
    !row ||
    row.attemptId !== attemptId ||
    row.attemptNamespaceId !== namespaceId ||
    row.claimProviderInstanceRowId !== expectedFence.providerInstanceRowId ||
    row.namespaceProviderInstanceRowId !== row.claimProviderInstanceRowId ||
    row.providerMutationOwner !== "setup" ||
    row.providerMutationOwnerId !== expectedFence.ownerId ||
    row.providerMutationEpoch !== expectedFence.epoch ||
    row.claimRecoveryEpoch > expectedFence.epoch
  ) {
    throw new Error("codex_rotating_setup_retirement_conflict");
  }
  if (
    row.attemptStatus === "retired_ambiguous" &&
    row.attemptRetiredAt &&
    row.namespaceStatus === namespaceRetirementStatus &&
    row.namespacePermanentlyRetired &&
    row.namespaceRetiredAt
  ) {
    return;
  }
  if (
    row.attemptStatus !== "dispatch_authorized" ||
    row.attemptRetiredAt ||
    row.namespaceStatus !== "dispatch_authorized" ||
    row.namespacePermanentlyRetired ||
    row.namespaceRetiredAt
  ) {
    throw new Error("codex_rotating_setup_retirement_conflict");
  }
  const retiredAttempt = await tx.$executeRaw`
    UPDATE "CodexOAuthSetupDispatchAttempt"
    SET "status" = 'retired_ambiguous', "retiredAt" = ${now}, "updatedAt" = ${now}
    WHERE "id" = ${row.attemptId} AND "claimId" = ${row.attemptClaimId}
      AND "namespaceId" = ${namespaceId} AND "status" = 'dispatch_authorized'
      AND "retiredAt" IS NULL
  `;
  const retiredNamespace = await tx.$executeRaw`
    UPDATE "CodexOAuthSecretNamespace"
    SET "status" = ${namespaceRetirementStatus}, "permanentlyRetired" = true,
        "retiredAt" = ${now}
    WHERE "id" = ${namespaceId}
      AND "providerInstanceRowId" = ${row.namespaceProviderInstanceRowId}
      AND "namespaceEpoch" = ${row.namespaceEpoch}
      AND "secretName" = ${row.namespaceSecretName}
      AND "status" = 'dispatch_authorized'
      AND NOT "permanentlyRetired" AND "retiredAt" IS NULL
  `;
  if (retiredAttempt !== 1 || retiredNamespace !== 1) {
    throw new Error("codex_rotating_setup_retirement_conflict");
  }
}
