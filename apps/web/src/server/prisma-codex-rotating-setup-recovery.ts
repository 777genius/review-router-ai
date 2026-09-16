import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  canonicalCodexRotatingProviderId,
  classifyCodexRotatingMutationOwnership,
  codexRotatingAccountSwitchAcknowledgement,
  codexRotatingAuthMode,
  codexRotatingForcedRecoveryAttemptTransitions,
  codexRotatingForcedRecoveryClaimTransitions,
  codexRotatingSetupRecoveryAcknowledgement,
  codexRotatingSecretName,
  codexRotatingWritebackClaimMarker,
  codexRotatingWritebackDispatchedMarker,
  isRuntimeVersionedDurableMarker,
  fingerprintDatabaseRecoveryWitness,
  classifyExternalRecoveryWitnessRelation,
  ExternalRecoveryWitnessRelation,
  type CodexRotatingIdentityQuarantineReadModel,
  type CodexRotatingSetupRecoveryPort,
  type CodexRotatingSetupRecoveryResult,
  type CodexRotatingSetupRecoveryStatus,
} from "@reviewrouter/features-provider-setup";
import {
  lockCodexRotatingProviderRow,
  lockCodexRotatingSetupProvider,
} from "./codex-rotating-provider-mutation-fence";
import { assertCodexRotatingSetupRecoveryWitness } from "./codex-rotating-setup-manifest";

const recoveryTransactionTimeoutMs = 10_000;

type CodexRotatingSetupRecoveryAcknowledgement =
  | typeof codexRotatingSetupRecoveryAcknowledgement
  | typeof codexRotatingAccountSwitchAcknowledgement;

export function validateCodexRotatingSetupRecoveryAcknowledgement(input: {
  readonly acknowledgement: string;
  readonly accountSwitch: boolean;
}): CodexRotatingSetupRecoveryAcknowledgement {
  const requiredAcknowledgement = input.accountSwitch
    ? codexRotatingAccountSwitchAcknowledgement
    : codexRotatingSetupRecoveryAcknowledgement;
  if (input.acknowledgement !== requiredAcknowledgement) {
    throw new Error("codex_rotating_setup_recovery_acknowledgement_required");
  }
  // Return the caller-supplied value so the durable recovery row records the
  // exact operator proof that crossed the adapter boundary.
  return input.acknowledgement as CodexRotatingSetupRecoveryAcknowledgement;
}

export class PrismaCodexRotatingSetupRecovery implements CodexRotatingSetupRecoveryPort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly databaseRecoveryWitness?: string,
  ) {}

  async findIdentityQuarantine(input: {
    readonly workspaceId: string;
    readonly repositoryId: string;
  }): Promise<CodexRotatingIdentityQuarantineReadModel | null> {
    const rows = await this.prisma.$queryRaw<QuarantineRow[]>`
      SELECT "providerInstanceRowId", "observedWorkspaceId",
             "observedRepositoryId", "observedProviderInstanceId",
             "expectedProviderInstanceId", "reason", "quarantinedAt"
      FROM "CodexOAuthProviderIdentityQuarantine" quarantine
      JOIN "RepositoryConnection" repository
        ON repository."id" = quarantine."observedRepositoryId"
      WHERE repository."workspaceId" = ${input.workspaceId}
        AND repository."id" = ${input.repositoryId}
        AND quarantine."resolvedAt" IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    return row
      ? {
          providerInstanceRowId: row.providerInstanceRowId,
          workspaceId: row.observedWorkspaceId,
          repositoryId: row.observedRepositoryId,
          observedProviderInstanceId: row.observedProviderInstanceId,
          expectedProviderInstanceId: row.expectedProviderInstanceId,
          reason: row.reason,
          quarantinedAt: row.quarantinedAt,
        }
      : null;
  }

  async inspectStatus(input: {
    readonly workspaceId: string;
    readonly repositoryId: string;
    readonly issuanceEnabled: boolean;
  }): Promise<CodexRotatingSetupRecoveryStatus> {
    if (!input.issuanceEnabled) return { status: "issuance_quiesced" };
    const quarantine = await this.findIdentityQuarantine(input);
    if (quarantine) return { status: "identity_quarantined", quarantine };
    const provider = await this.prisma.codexOAuthProviderInstance.findFirst({
      where: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        authMode: codexRotatingAuthMode,
      },
      select: {
        id: true,
        mutationOwner: true,
        writebackIntents: {
          where: {
            status: "remote_outcome_unknown",
            recoveryResolvedAt: null,
          },
          take: 1,
          select: {
            id: true,
            secretNamespace: {
              select: { permanentlyRetired: true, status: true },
            },
          },
        },
        setupManifests: {
          where: { status: "fetched" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (
      provider?.setupManifests.length ||
      provider?.writebackIntents.some(
        (intent) =>
          !intent.secretNamespace?.permanentlyRetired ||
          intent.secretNamespace.status !== "retired_ambiguous",
      )
    ) {
      return { status: "recovery_required" };
    }
    if (provider?.mutationOwner === "recovery") {
      return { status: "recovery_required" };
    }
    if (provider) {
      try {
        await assertCodexRotatingSetupRecoveryWitness(this.prisma, {
          providerInstanceRowId: provider.id,
          ...(this.databaseRecoveryWitness !== undefined
            ? { configuredRecoveryWitness: this.databaseRecoveryWitness }
            : {}),
          forcedRecoveryAuthority: null,
        });
      } catch {
        return { status: "recovery_required" };
      }
    }
    return { status: "ready" };
  }

  async recover(
    input: Parameters<CodexRotatingSetupRecoveryPort["recover"]>[0],
  ): Promise<CodexRotatingSetupRecoveryResult> {
    const acknowledgement =
      validateCodexRotatingSetupRecoveryAcknowledgement(input);
    const expectedProviderInstanceId = canonicalCodexRotatingProviderId(
      input.githubRepositoryId,
    );
    return this.prisma.$transaction(
      async (tx) => {
        await lockCodexRotatingSetupProvider(tx, expectedProviderInstanceId);
        const scopedQuarantine = await findScopedQuarantine(tx, {
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
        });
        if (scopedQuarantine) {
          input.decide({
            canonicalIdentity: false,
            quarantined: true,
            mutationOwnership: "ambiguous",
            recoveryRequestAlreadyApplied: false,
          });
          throw new Error("codex_rotating_identity_quarantined");
        }
        const providerLocator = await tx.codexOAuthProviderInstance.findUnique({
          where: {
            repositoryId_authMode: {
              repositoryId: input.repositoryId,
              authMode: codexRotatingAuthMode,
            },
          },
          select: { id: true },
        });
        if (!providerLocator) {
          throw new Error("codex_rotating_provider_not_found");
        }
        await lockCodexRotatingProviderRow(tx, providerLocator.id);

        // The row lock is the serialization point. Never decide from the
        // locator snapshot read before it was acquired.
        const provider = await tx.codexOAuthProviderInstance.findUniqueOrThrow({
          where: { id: providerLocator.id },
          include: {
            repository: {
              select: { workspaceId: true, githubRepositoryId: true },
            },
          },
        });
        const latestNamespace = await tx.codexOAuthSecretNamespace.findFirst({
          where: { providerInstanceRowId: provider.id },
          orderBy: [{ namespaceEpoch: "desc" }, { id: "desc" }],
          select: { databaseRecoveryWitness: true },
        });
        let currentWitness: string;
        try {
          currentWitness = fingerprintDatabaseRecoveryWitness(
            this.databaseRecoveryWitness ?? "",
          );
        } catch {
          throw new Error("codex_rotating_retryable_uncommitted");
        }
        const externalRecoveryWitnessRelation =
          classifyExternalRecoveryWitnessRelation({
            persistedFingerprint:
              latestNamespace?.databaseRecoveryWitness ?? null,
            currentFingerprint: currentWitness,
          });

        const quarantine = await findQuarantine(tx, provider.id);
        const request = await findRecoveryRequest(
          tx,
          provider.id,
          input.recoveryRequestId,
        );
        if (request && request.databaseRecoveryWitness !== currentWitness) {
          // Idempotency keys are scoped to one database writer generation.
          // Immutable W1 evidence cannot be reused as a W2 recovery request.
          throw new Error("codex_rotating_setup_recovery_already_used");
        }
        if (request && !["active", "manifest_issued"].includes(request.state)) {
          throw new Error("codex_rotating_setup_recovery_already_used");
        }
        const requestedMode = input.accountSwitch
          ? "forced_reseed_account_switch"
          : "forced_reseed";
        if (request && request.mode !== requestedMode) {
          throw new Error("codex_rotating_setup_recovery_request_conflict");
        }
        const activeOtherRequest = await findOtherActiveRecoveryRequest(
          tx,
          provider.id,
          input.recoveryRequestId,
          currentWitness,
        );
        const maySupersedeActiveOtherRequest =
          activeOtherRequest !== null &&
          (await canSupersedeUnclaimedRecoveryRequest(tx, {
            providerInstanceRowId: provider.id,
            recoveryRequestRowId: activeOtherRequest.id,
            currentWitness,
            now: input.now,
          }));
        if (activeOtherRequest && !maySupersedeActiveOtherRequest) {
          throw new Error("codex_rotating_setup_recovery_request_conflict");
        }
        const setup = await tx.codexOAuthSetupManifest.findFirst({
          where: {
            providerInstanceRowId: provider.id,
            status: { in: ["issued", "fetched"] },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            status: true,
            expiresAt: true,
            lastFetchedAt: true,
          },
        });
        const pendingIntent = await tx.codexOAuthWritebackIntent.findFirst({
          where: {
            providerInstanceRowId: provider.id,
            OR: [
              { status: "pending" },
              {
                status: "remote_outcome_unknown",
                recoveryResolvedAt: null,
              },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            leaseId: true,
            status: true,
            createdAt: true,
            safeErrorCode: true,
            secretNamespace: {
              select: { permanentlyRetired: true, status: true },
            },
          },
        });
        const runtimeLease = provider.mutationOwnerId
          ? await tx.codexOAuthLease.findFirst({
              where: {
                id: provider.mutationOwnerId,
                providerInstanceRowId: provider.id,
              },
              select: { id: true, status: true, expiresAt: true },
            })
          : null;
        const canonicalIdentity =
          provider.repository.workspaceId === input.workspaceId &&
          provider.repository.githubRepositoryId?.toString() ===
            input.githubRepositoryId &&
          provider.repositoryId === input.repositoryId &&
          provider.providerInstanceId === expectedProviderInstanceId &&
          provider.authMode === codexRotatingAuthMode &&
          provider.secretName === codexRotatingSecretName;
        const ownership = classifyCodexRotatingMutationOwnership({
          owner: provider.mutationOwner,
          ownerId: provider.mutationOwnerId,
          now: input.now,
          setup,
          writeback: pendingIntent
            ? {
                id: pendingIntent.id,
                leaseId: pendingIntent.leaseId,
                status: pendingIntent.status,
                claimedAt: pendingIntent.createdAt,
                claimMarker:
                  pendingIntent.safeErrorCode ===
                    codexRotatingWritebackClaimMarker ||
                  pendingIntent.safeErrorCode ===
                    codexRotatingWritebackDispatchedMarker ||
                  isRuntimeVersionedDurableMarker(pendingIntent.safeErrorCode),
                remoteNamespacePermanentlyRetired:
                  pendingIntent.secretNamespace?.permanentlyRetired === true &&
                  pendingIntent.secretNamespace.status === "retired_ambiguous",
              }
            : null,
          runtimeLease,
        });
        const decision = input.decide({
          canonicalIdentity,
          quarantined: quarantine !== null,
          mutationOwnership: maySupersedeActiveOtherRequest
            ? "recoverable"
            : ownership.classification,
          versionedNamespaceRecoveryAvailable: true,
          externalRecoveryWitnessRelation,
          recoveryRequestAlreadyApplied:
            request?.state === "active" || request?.state === "manifest_issued",
        });
        const supersededStaleRecoveryRequests =
          await supersedeMismatchedActiveRecoveryRequests(tx, {
            providerInstanceRowId: provider.id,
            currentWitness,
            now: input.now,
          });
        if (decision.kind === "idempotent_replay") {
          if (!request)
            throw new Error("codex_rotating_setup_recovery_required");
          return {
            status: "idempotent_replay" as const,
            recoveryEpoch: request.mutationEpoch,
          };
        }

        if (activeOtherRequest) {
          await supersedeUnclaimedRecoveryRequest(tx, {
            providerInstanceRowId: provider.id,
            recoveryRequestRowId: activeOtherRequest.id,
            currentWitness,
            now: input.now,
          });
        }

        const recoveryOwnerId = `setup-recovery:${input.recoveryRequestId}`;
        const recoveryEpoch = provider.mutationEpoch + 1n;
        const sanitizedActor = sanitizeRecoveryActor(input.actor);
        await tx.codexOAuthProviderInstance.update({
          where: { id: provider.id },
          data: {
            state: "unknown_auth_state",
            activeLeaseId: null,
            activeLeaseExpiresAt: null,
            activeSecretNamespaceId: null,
            activeSecretNamespaceEpoch: null,
            activeSecretNamespaceName: null,
            activeAccountIdentityHash: input.accountSwitch
              ? null
              : provider.activeAccountIdentityHash,
            mutationEpoch: recoveryEpoch,
            mutationOwner: "recovery",
            mutationOwnerId: recoveryOwnerId,
          },
        });
        await retirePriorNamespaceGeneration(tx, {
          providerInstanceRowId: provider.id,
          now: input.now,
        });
        await tx.providerSetupState.updateMany({
          where: {
            workspaceId: input.workspaceId,
            repositoryId: input.repositoryId,
            targetKey: `repo:${input.repositoryId}`,
            providerKind: "codex",
            authMode: codexRotatingAuthMode,
          },
          data: { state: "stale_or_invalid" },
        });
        const recoveryRequestRowId = `codex_recovery_${randomUUID()}`;
        await insertRecoveryRequest(tx, {
          id: recoveryRequestRowId,
          providerInstanceRowId: provider.id,
          recoveryRequestId: input.recoveryRequestId,
          actor: sanitizedActor,
          mutationEpoch: recoveryEpoch,
          databaseRecoveryWitness: currentWitness,
          acknowledgement,
          accountSwitch: input.accountSwitch,
          now: input.now,
        });
        await tx.codexOAuthSetupManifest.updateMany({
          where: {
            providerInstanceRowId: provider.id,
            status: { in: ["issued", "fetched"] },
          },
          data: {
            status: "recovered",
            consumedAt: input.now,
            confirmationJson: {
              recoveryRequestId: input.recoveryRequestId,
              acknowledgedSecretMayHaveChanged: true,
              recoveryEpoch: recoveryEpoch.toString(10),
            },
          },
        });
        await tx.codexOAuthWritebackIntent.updateMany({
          where: { providerInstanceRowId: provider.id, status: "pending" },
          data: {
            status: "failed",
            safeErrorCode: "operator_setup_recovery",
            completedAt: input.now,
            recoveryRequestRowId,
            recoveryResolvedAt: input.now,
          },
        });
        await tx.codexOAuthWritebackIntent.updateMany({
          where: {
            providerInstanceRowId: provider.id,
            status: "remote_outcome_unknown",
            recoveryResolvedAt: null,
          },
          data: {
            recoveryRequestRowId,
            recoveryResolvedAt: input.now,
          },
        });
        if (provider.activeLeaseId) {
          await tx.codexOAuthLease.updateMany({
            where: { id: provider.activeLeaseId, status: { not: "completed" } },
            data: { status: "abandoned", expiresAt: input.now },
          });
        }
        await tx.auditEvent.create({
          data: {
            workspaceId: input.workspaceId,
            actor: sanitizedActor,
            action: "codex_rotating.setup_recovered",
            targetType: "repository",
            targetId: input.repositoryId,
            metadata: {
              source: "operator",
              recoveryRequestId: input.recoveryRequestId,
              recoveryEpoch: recoveryEpoch.toString(10),
              accountSwitch: input.accountSwitch,
              previousOwnership: ownership.classification,
              witnessRotation:
                externalRecoveryWitnessRelation ===
                ExternalRecoveryWitnessRelation.Mismatched,
              supersededStaleRecoveryRequests,
            },
          },
        });
        return { status: "recovered" as const, recoveryEpoch };
      },
      { timeout: recoveryTransactionTimeoutMs },
    );
  }
}

type RecoveryRequestRow = {
  readonly id: string;
  readonly mutationEpoch: bigint;
  readonly databaseRecoveryWitness: string | null;
  readonly mode: string;
  readonly state: string;
};

async function findRecoveryRequest(
  tx: Prisma.TransactionClient,
  providerInstanceRowId: string,
  recoveryRequestId: string,
): Promise<RecoveryRequestRow | null> {
  const rows = await tx.$queryRaw<RecoveryRequestRow[]>`
    SELECT "id", "mutationEpoch", "databaseRecoveryWitness", "mode", "state"
    FROM "CodexOAuthSetupRecoveryRequest"
    WHERE "providerInstanceRowId" = ${providerInstanceRowId}
      AND "recoveryRequestId" = ${recoveryRequestId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findOtherActiveRecoveryRequest(
  tx: Prisma.TransactionClient,
  providerInstanceRowId: string,
  recoveryRequestId: string,
  currentWitness: string,
): Promise<{ readonly id: string } | null> {
  const rows = await tx.$queryRaw<Array<{ readonly id: string }>>`
    SELECT "id" FROM "CodexOAuthSetupRecoveryRequest"
    WHERE "providerInstanceRowId" = ${providerInstanceRowId}
      AND "recoveryRequestId" <> ${recoveryRequestId}
      AND "state" IN ('active', 'manifest_issued')
      AND "databaseRecoveryWitness" IS NOT DISTINCT FROM ${currentWitness}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function expiredConfirmedCandidatePredicate(input: {
  readonly providerInstanceRowId: string;
  readonly recoveryRequestRowId: string;
  readonly currentWitness: string;
  readonly now: Date;
}): Prisma.Sql {
  return Prisma.sql`
    recovery."id" = ${input.recoveryRequestRowId}
    AND recovery."providerInstanceRowId" = ${input.providerInstanceRowId}
    AND recovery."state" = 'manifest_issued'
    AND recovery."mode" IN ('forced_reseed', 'forced_reseed_account_switch')
    AND recovery."databaseRecoveryWitness" IS NOT DISTINCT FROM ${input.currentWitness}
    AND manifest."status" = 'fetched'
    AND manifest."databaseRecoveryWitness" IS NOT DISTINCT FROM ${input.currentWitness}
    AND manifest."recoveryExpiresAt" <= ${input.now}
    AND manifest."mutationEpoch" = recovery."mutationEpoch" + 1
    AND claim."recoveryEpoch" = manifest."mutationEpoch"
    AND claim."status" = 'confirmed_candidate'
    AND claim."databaseRecoveryWitness" = ${input.currentWitness}
    AND claim."recoveryExpiresAt" <= ${input.now}
    AND claim."confirmedAt" IS NOT NULL
    AND claim."activatedAt" IS NULL
    AND attempt."status" = 'confirmed'
    AND attempt."definiteResponseCode" IN (201, 204)
    AND attempt."confirmedAt" IS NOT NULL
    AND namespace."status" = 'confirmed_candidate'
    AND namespace."databaseRecoveryWitness" = ${input.currentWitness}
    AND namespace."permanentlyRetired" = false
    AND namespace."activatedAt" IS NULL
    AND namespace."workflowPath" IS NULL
    AND namespace."workflowSourceCommitSha" IS NULL
    AND namespace."workflowSourceBlobSha" IS NULL
    AND namespace."workflowSourceSha256" IS NULL
    AND namespace."workflowSemanticSha256" IS NULL
    AND namespace."workflowSourceTrust" IS NULL
    AND namespace."workflowSchemaVersion" IS NULL
    AND namespace."attestedRepositoryId" IS NULL
    AND provider."mutationOwner" = 'setup'
    AND provider."mutationOwnerId" = manifest."id"
    AND provider."mutationEpoch" = manifest."mutationEpoch"
    AND provider."activeLeaseId" IS NULL
    AND provider."activeSecretNamespaceId" IS DISTINCT FROM namespace."id"
    AND NOT EXISTS (
      SELECT 1 FROM "CodexOAuthLease" lease
      WHERE lease."providerInstanceRowId" = provider."id"
        AND lease."status" IN ('preleased', 'finalized')
    )
    AND NOT EXISTS (
      SELECT 1 FROM "CodexOAuthWritebackIntent" writeback
      WHERE writeback."providerInstanceRowId" = provider."id"
        AND writeback."status" IN ('pending', 'remote_outcome_unknown')
        AND (writeback."status" <> 'remote_outcome_unknown'
          OR writeback."recoveryResolvedAt" IS NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM "CodexOAuthWorkflowCompatibility" compatibility
      WHERE compatibility."namespaceId" = namespace."id"
    )
  `;
}

export async function canSupersedeUnclaimedRecoveryRequest(
  tx: Prisma.TransactionClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly recoveryRequestRowId: string;
    readonly currentWitness: string;
    readonly now: Date;
  },
): Promise<boolean> {
  const expiredCandidate = expiredConfirmedCandidatePredicate(input);
  const rows = await tx.$queryRaw<Array<{ readonly allowed: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM "CodexOAuthSetupRecoveryRequest" recovery
      JOIN "CodexOAuthSetupManifest" manifest
        ON manifest."id" = recovery."latestManifestId"
       AND manifest."providerInstanceRowId" = recovery."providerInstanceRowId"
      JOIN "CodexOAuthProviderInstance" provider
        ON provider."id" = recovery."providerInstanceRowId"
      WHERE recovery."id" = ${input.recoveryRequestRowId}
        AND recovery."providerInstanceRowId" = ${input.providerInstanceRowId}
        AND recovery."state" = 'manifest_issued'
        AND recovery."mode" IN ('forced_reseed', 'forced_reseed_account_switch')
        AND recovery."databaseRecoveryWitness" IS NOT DISTINCT FROM ${input.currentWitness}
        AND manifest."status" IN ('issued', 'fetched')
        AND manifest."payloadClaimedAt" IS NULL
        AND manifest."mutationEpoch" = recovery."mutationEpoch" + 1
        AND provider."mutationOwner" = 'setup'
        AND provider."mutationOwnerId" = manifest."id"
        AND provider."mutationEpoch" = manifest."mutationEpoch"
        AND NOT EXISTS (
          SELECT 1
          FROM "CodexOAuthSetupPayloadClaim" claim
          WHERE claim."manifestId" = manifest."id"
        )
    ) OR EXISTS (
      SELECT 1
      FROM "CodexOAuthSetupRecoveryRequest" recovery
      JOIN "CodexOAuthSetupManifest" manifest
        ON manifest."id" = recovery."latestManifestId"
       AND manifest."providerInstanceRowId" = recovery."providerInstanceRowId"
      JOIN "CodexOAuthSetupPayloadClaim" claim
        ON claim."providerInstanceRowId" = recovery."providerInstanceRowId"
       AND claim."manifestId" = manifest."id"
       AND claim."recoveryRequestId" = recovery."recoveryRequestId"
      JOIN "CodexOAuthSetupDispatchAttempt" attempt
        ON attempt."id" = claim."confirmedAttemptId"
       AND attempt."claimId" = claim."id"
      JOIN "CodexOAuthSecretNamespace" namespace
        ON namespace."id" = attempt."namespaceId"
       AND namespace."providerInstanceRowId" = recovery."providerInstanceRowId"
      JOIN "CodexOAuthProviderInstance" provider
        ON provider."id" = recovery."providerInstanceRowId"
      WHERE ${expiredCandidate}
    ) AS "allowed"
  `;
  return rows[0]?.allowed === true;
}

export async function supersedeUnclaimedRecoveryRequest(
  tx: Prisma.TransactionClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly recoveryRequestRowId: string;
    readonly currentWitness: string;
    readonly now: Date;
  },
): Promise<void> {
  const updated = await tx.$executeRaw`
    UPDATE "CodexOAuthSetupRecoveryRequest" recovery
    SET "state" = 'superseded', "completedAt" = ${input.now},
        "updatedAt" = ${input.now}
    WHERE recovery."id" = ${input.recoveryRequestRowId}
      AND recovery."providerInstanceRowId" = ${input.providerInstanceRowId}
      AND recovery."state" = 'manifest_issued'
      AND recovery."mode" IN ('forced_reseed', 'forced_reseed_account_switch')
      AND recovery."databaseRecoveryWitness" IS NOT DISTINCT FROM ${input.currentWitness}
      AND EXISTS (
        SELECT 1
        FROM "CodexOAuthSetupManifest" manifest
        JOIN "CodexOAuthProviderInstance" provider
          ON provider."id" = manifest."providerInstanceRowId"
        WHERE manifest."id" = recovery."latestManifestId"
          AND manifest."providerInstanceRowId" = recovery."providerInstanceRowId"
          AND manifest."status" IN ('issued', 'fetched')
          AND manifest."payloadClaimedAt" IS NULL
          AND manifest."mutationEpoch" = recovery."mutationEpoch" + 1
          AND provider."mutationOwner" = 'setup'
          AND provider."mutationOwnerId" = manifest."id"
          AND provider."mutationEpoch" = manifest."mutationEpoch"
          AND NOT EXISTS (
            SELECT 1
            FROM "CodexOAuthSetupPayloadClaim" claim
            WHERE claim."manifestId" = manifest."id"
          )
      )
  `;
  if (updated === 1) return;
  await supersedeExpiredConfirmedRecoveryRequest(tx, input);
}

export async function supersedeExpiredConfirmedRecoveryRequest(
  tx: Prisma.TransactionClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly recoveryRequestRowId: string;
    readonly currentWitness: string;
    readonly now: Date;
  },
): Promise<void> {
  const expiredCandidate = expiredConfirmedCandidatePredicate(input);
  const rows = await tx.$queryRaw<
    Array<{
      readonly recoveryCount: bigint;
      readonly attemptCount: bigint;
      readonly claimCount: bigint;
      readonly namespaceCount: bigint;
    }>
  >`
    WITH candidate AS MATERIALIZED (
      SELECT recovery."id" AS "recoveryId", claim."id" AS "claimId",
             attempt."id" AS "attemptId", namespace."id" AS "namespaceId"
      FROM "CodexOAuthSetupRecoveryRequest" recovery
      JOIN "CodexOAuthSetupManifest" manifest
        ON manifest."id" = recovery."latestManifestId"
       AND manifest."providerInstanceRowId" = recovery."providerInstanceRowId"
      JOIN "CodexOAuthSetupPayloadClaim" claim
        ON claim."providerInstanceRowId" = recovery."providerInstanceRowId"
       AND claim."manifestId" = manifest."id"
       AND claim."recoveryRequestId" = recovery."recoveryRequestId"
      JOIN "CodexOAuthSetupDispatchAttempt" attempt
        ON attempt."id" = claim."confirmedAttemptId"
       AND attempt."claimId" = claim."id"
      JOIN "CodexOAuthSecretNamespace" namespace
        ON namespace."id" = attempt."namespaceId"
       AND namespace."providerInstanceRowId" = recovery."providerInstanceRowId"
      JOIN "CodexOAuthProviderInstance" provider
        ON provider."id" = recovery."providerInstanceRowId"
      WHERE ${expiredCandidate}
      FOR UPDATE OF recovery, manifest, claim, attempt, namespace
    ), retired_attempt AS (
      UPDATE "CodexOAuthSetupDispatchAttempt" attempt
      SET "status" = 'retired_confirmed', "retiredAt" = ${input.now},
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE attempt."id" = candidate."attemptId" AND attempt."status" = 'confirmed'
      RETURNING attempt."id"
    ), retired_claim AS (
      UPDATE "CodexOAuthSetupPayloadClaim" claim
      SET "status" = 'retired_confirmed', "updatedAt" = ${input.now}
      FROM candidate
      WHERE claim."id" = candidate."claimId" AND claim."status" = 'confirmed_candidate'
      RETURNING claim."id"
    ), retired_namespace AS (
      UPDATE "CodexOAuthSecretNamespace" namespace
      SET "status" = 'retired_ambiguous', "permanentlyRetired" = true,
          "retiredAt" = ${input.now}
      FROM candidate
      WHERE namespace."id" = candidate."namespaceId"
        AND namespace."status" = 'confirmed_candidate'
      RETURNING namespace."id"
    ), superseded_recovery AS (
      UPDATE "CodexOAuthSetupRecoveryRequest" recovery
      SET "state" = 'superseded', "completedAt" = ${input.now},
          "updatedAt" = ${input.now}
      FROM candidate
      WHERE recovery."id" = candidate."recoveryId"
        AND recovery."state" = 'manifest_issued'
      RETURNING recovery."id"
    )
    SELECT (SELECT count(*) FROM superseded_recovery)::bigint AS "recoveryCount",
           (SELECT count(*) FROM retired_attempt)::bigint AS "attemptCount",
           (SELECT count(*) FROM retired_claim)::bigint AS "claimCount",
           (SELECT count(*) FROM retired_namespace)::bigint AS "namespaceCount"
  `;
  const counts = rows[0];
  if (
    counts?.recoveryCount !== 1n ||
    counts.attemptCount !== 1n ||
    counts.claimCount !== 1n ||
    counts.namespaceCount !== 1n
  ) {
    throw new Error("codex_rotating_setup_recovery_request_conflict");
  }
}

export async function supersedeMismatchedActiveRecoveryRequests(
  tx: Prisma.TransactionClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly currentWitness: string;
    readonly now: Date;
  },
): Promise<number> {
  return tx.$executeRaw`
    UPDATE "CodexOAuthSetupRecoveryRequest"
    SET "state" = 'superseded', "completedAt" = COALESCE("completedAt", ${input.now}),
        "updatedAt" = ${input.now}
    WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
      AND "state" IN ('active', 'manifest_issued')
      AND "databaseRecoveryWitness" IS DISTINCT FROM ${input.currentWitness}
  `;
}

async function insertRecoveryRequest(
  tx: Prisma.TransactionClient,
  input: {
    readonly id: string;
    readonly providerInstanceRowId: string;
    readonly recoveryRequestId: string;
    readonly actor: string;
    readonly mutationEpoch: bigint;
    readonly databaseRecoveryWitness: string;
    readonly acknowledgement: CodexRotatingSetupRecoveryAcknowledgement;
    readonly accountSwitch: boolean;
    readonly now: Date;
  },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "CodexOAuthSetupRecoveryRequest" (
      "id", "providerInstanceRowId", "recoveryRequestId", "actor",
      "acknowledgement", "mutationEpoch", "databaseRecoveryWitness", "mode", "state",
      "requestedAt", "activatedAt", "updatedAt"
    ) VALUES (
      ${input.id}, ${input.providerInstanceRowId}, ${input.recoveryRequestId},
      ${input.actor}, ${input.acknowledgement},
      ${input.mutationEpoch}, ${input.databaseRecoveryWitness}, ${
        input.accountSwitch ? "forced_reseed_account_switch" : "forced_reseed"
      }, 'active',
      ${input.now}, ${input.now}, ${input.now}
    )
  `;
}

export async function retirePriorNamespaceGeneration(
  tx: Prisma.TransactionClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly now: Date;
  },
): Promise<void> {
  const attemptTransitions = Object.entries(
    codexRotatingForcedRecoveryAttemptTransitions,
  );
  const claimTransitions = Object.entries(
    codexRotatingForcedRecoveryClaimTransitions,
  );
  await tx.$executeRaw`
    UPDATE "CodexOAuthSetupDispatchAttempt" attempt
    SET "status" = CASE attempt."status"
          ${Prisma.join(
            attemptTransitions.map(
              ([from, to]) => Prisma.sql`WHEN ${from} THEN ${to}`,
            ),
            " ",
          )}
          ELSE attempt."status"
        END,
        "retiredAt" = ${input.now},
        "updatedAt" = ${input.now}
    FROM "CodexOAuthSetupPayloadClaim" claim
    WHERE attempt."claimId" = claim."id"
      AND claim."providerInstanceRowId" = ${input.providerInstanceRowId}
      AND attempt."status" IN (${Prisma.join(
        attemptTransitions.map(([from]) => from),
      )})
  `;
  await tx.$executeRaw`
    UPDATE "CodexOAuthSetupPayloadClaim"
    SET "status" = CASE "status"
          ${Prisma.join(
            claimTransitions.map(
              ([from, to]) => Prisma.sql`WHEN ${from} THEN ${to}`,
            ),
            " ",
          )}
          ELSE "status"
        END,
        "updatedAt" = ${input.now}
    WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
      AND "status" IN (${Prisma.join(claimTransitions.map(([from]) => from))})
  `;
  await tx.$executeRaw`
    UPDATE "CodexOAuthSecretNamespace"
    SET "status" = CASE
          WHEN "status" = 'active' THEN 'retired_superseded'
          ELSE 'retired_ambiguous'
        END,
        "permanentlyRetired" = true,
        "retiredAt" = ${input.now}
    WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
      AND "status" IN ('dispatch_authorized', 'confirmed_candidate', 'active')
  `;
  const remaining = await tx.$queryRaw<Array<{ count: bigint }>>`
    SELECT (
      (SELECT count(*) FROM "CodexOAuthSecretNamespace"
       WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
         AND "status" IN ('dispatch_authorized', 'confirmed_candidate', 'active'))
      +
      (SELECT count(*) FROM "CodexOAuthSetupDispatchAttempt" attempt
       JOIN "CodexOAuthSetupPayloadClaim" claim ON claim."id" = attempt."claimId"
       WHERE claim."providerInstanceRowId" = ${input.providerInstanceRowId}
         AND attempt."status" IN (${Prisma.join(
           attemptTransitions.map(([from]) => from),
         )}))
      +
      (SELECT count(*) FROM "CodexOAuthSetupPayloadClaim"
       WHERE "providerInstanceRowId" = ${input.providerInstanceRowId}
         AND "status" IN (${Prisma.join(
           claimTransitions.map(([from]) => from),
         )}))
    )::bigint AS count
  `;
  if (remaining[0]?.count !== 0n) {
    throw new Error("codex_rotating_setup_recovery_retirement_conflict");
  }
}

function sanitizeRecoveryActor(actor: string): string {
  const sanitized = actor
    .trim()
    .replace(/[^A-Za-z0-9_.:@+-]/g, "_")
    .slice(0, 200);
  return sanitized || "unknown_operator";
}

type QuarantineRow = {
  readonly providerInstanceRowId: string;
  readonly observedWorkspaceId: string;
  readonly observedRepositoryId: string;
  readonly observedProviderInstanceId: string;
  readonly expectedProviderInstanceId: string | null;
  readonly reason: string;
  readonly quarantinedAt: Date;
};

async function findQuarantine(
  tx: Prisma.TransactionClient,
  providerInstanceRowId: string,
): Promise<QuarantineRow | null> {
  const rows = await tx.$queryRaw<QuarantineRow[]>`
    SELECT "providerInstanceRowId", "observedWorkspaceId",
           "observedRepositoryId", "observedProviderInstanceId",
           "expectedProviderInstanceId", "reason", "quarantinedAt"
    FROM "CodexOAuthProviderIdentityQuarantine"
    WHERE "providerInstanceRowId" = ${providerInstanceRowId}
      AND "resolvedAt" IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findScopedQuarantine(
  tx: Prisma.TransactionClient,
  input: { readonly workspaceId: string; readonly repositoryId: string },
): Promise<QuarantineRow | null> {
  const rows = await tx.$queryRaw<QuarantineRow[]>`
    SELECT quarantine."providerInstanceRowId",
           quarantine."observedWorkspaceId",
           quarantine."observedRepositoryId",
           quarantine."observedProviderInstanceId",
           quarantine."expectedProviderInstanceId",
           quarantine."reason", quarantine."quarantinedAt"
    FROM "CodexOAuthProviderIdentityQuarantine" quarantine
    JOIN "RepositoryConnection" repository
      ON repository."id" = quarantine."observedRepositoryId"
    WHERE repository."workspaceId" = ${input.workspaceId}
      AND repository."id" = ${input.repositoryId}
      AND quarantine."resolvedAt" IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}
