import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CodexRotatingSetupClaimStatus,
  CodexRotatingSetupAttemptStatus,
} from "../../domain/codex-rotating-setup-payload-claim";

export type ClaimRow = {
  id: string;
  providerInstanceRowId: string;
  githubRepositoryId: string;
  manifestId: string;
  manifestDigest: string;
  recoveryRequestId: string | null;
  recoveryEpoch: bigint;
  operationId: string;
  payloadVersion: number;
  canonicalizationVersion: number;
  generationHash: string;
  accountIdentityHash: string;
  accountIdentityAlgorithm: string;
  authByteSize: number;
  installerVersion: string;
  installerDigest: string;
  databaseIncarnation: string;
  databaseRecoveryWitness: string;
  status: CodexRotatingSetupClaimStatus;
  claimVersion: number;
  prepareReplayExpiresAt: Date;
  recoveryExpiresAt: Date;
  confirmedAttemptId: string | null;
};

export type AttemptRow = {
  claimId: string;
  attemptId: string;
  namespaceId: string;
  namespaceEpoch: bigint;
  secretName: string;
  status: CodexRotatingSetupAttemptStatus;
  idempotencyKey: string;
  ordinal: number;
  dispatchExpiresAt: Date;
  definiteResponseCode: number | null;
  attemptRetiredAt: Date | null;
  namespaceStatus: string;
  namespacePermanentlyRetired: boolean;
  namespaceRetiredAt: Date | null;
};

export async function findClaim(
  tx: Prisma.TransactionClient | PrismaClient,
  id: string,
): Promise<ClaimRow> {
  const rows = await tx.$queryRaw<ClaimRow[]>`
    SELECT "id", "providerInstanceRowId", "githubRepositoryId", "manifestId", "manifestDigest", "recoveryRequestId",
      "recoveryEpoch", "operationId", "payloadVersion", "canonicalizationVersion", "generationHash",
      "accountIdentityHash", "accountIdentityAlgorithm", "authByteSize", "installerVersion",
      "installerDigest", "databaseIncarnation", "databaseRecoveryWitness", "status", "claimVersion", "prepareReplayExpiresAt", "recoveryExpiresAt",
      "confirmedAttemptId" FROM "CodexOAuthSetupPayloadClaim" WHERE "id" = ${id} LIMIT 1
  `;
  if (!rows[0]) throw new Error("codex_rotating_setup_claim_not_found");
  return rows[0];
}

export async function findClaimForUpdate(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<ClaimRow> {
  const rows = await tx.$queryRaw<ClaimRow[]>`
    SELECT "id", "providerInstanceRowId", "githubRepositoryId", "manifestId", "manifestDigest", "recoveryRequestId",
      "recoveryEpoch", "operationId", "payloadVersion", "canonicalizationVersion", "generationHash",
      "accountIdentityHash", "accountIdentityAlgorithm", "authByteSize", "installerVersion",
      "installerDigest", "databaseIncarnation", "databaseRecoveryWitness", "status", "claimVersion", "prepareReplayExpiresAt", "recoveryExpiresAt",
      "confirmedAttemptId" FROM "CodexOAuthSetupPayloadClaim" WHERE "id" = ${id} LIMIT 1 FOR UPDATE
  `;
  if (!rows[0]) throw new Error("codex_rotating_setup_claim_not_found");
  return rows[0];
}

export async function findAttemptForUpdate(
  tx: Prisma.TransactionClient,
  claimId: string,
  attemptId: string,
) {
  const rows = await tx.$queryRaw<AttemptRow[]>`
    SELECT a."claimId", a."id" AS "attemptId", a."namespaceId", n."namespaceEpoch",
      n."secretName", a."status", a."idempotencyKey", a."ordinal",
             a."dispatchExpiresAt", a."definiteResponseCode",
             a."retiredAt" AS "attemptRetiredAt", n."status" AS "namespaceStatus",
             n."permanentlyRetired" AS "namespacePermanentlyRetired",
             n."retiredAt" AS "namespaceRetiredAt"
    FROM "CodexOAuthSetupDispatchAttempt" a JOIN "CodexOAuthSecretNamespace" n ON n."id" = a."namespaceId"
    WHERE a."claimId" = ${claimId} AND a."id" = ${attemptId}
    LIMIT 1 FOR UPDATE OF a, n
  `;
  if (!rows[0]) throw new Error("codex_rotating_setup_attempt_not_found");
  return rows[0];
}
