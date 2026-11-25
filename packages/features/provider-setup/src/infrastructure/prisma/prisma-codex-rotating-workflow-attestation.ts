import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createVersionedSecretWorkflowSourceAttestation,
  WorkflowSourceTrust,
  type VersionedProviderSecretNamespace,
} from "@reviewrouter/features-codex-oauth-rotating";
import {
  assertCodexRotatingWorkflowAlreadyActiveTransition,
  assertCodexRotatingWorkflowReplacementTransition,
} from "../../domain/codex-rotating-workflow-reattestation";
import type {
  CodexRotatingCurrentWorkflowAttestationPort,
  CodexRotatingWorkflowReattestationPersistencePort,
  CodexRotatingWorkflowReattestationTransition,
} from "../../application/ports/codex-rotating-workflow-reattestation-port";
import { sameExactWorkflowAttestation } from "../../domain/codex-rotating-setup-lifecycle";
import { lockCodexRotatingProviderRow } from "./codex-rotating-provider-mutation-fence";
import {
  findClaim,
  findClaimForUpdate,
  findAttemptForUpdate,
} from "./codex-rotating-setup-records";
import { requireProvenWriter } from "./codex-rotating-setup-witness";

const transactionTimeoutMs = 10_000;

export type CodexRotatingWorkflowReattestationErrorCode =
  | "codex_rotating_workflow_reattestation_stale"
  | "codex_rotating_workflow_reattestation_invalid"
  | "codex_rotating_workflow_reattestation_forbidden";

export class CodexRotatingWorkflowReattestationError extends Error {
  override readonly name = "CodexRotatingWorkflowReattestationError";

  constructor(readonly code: CodexRotatingWorkflowReattestationErrorCode) {
    super(code);
  }
}

export function translateWorkflowReattestationDatabaseError(
  error: unknown,
): unknown {
  if (error instanceof CodexRotatingWorkflowReattestationError) return error;
  if (typeof error !== "object" || error === null) return error;
  const candidate = error as {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly meta?: { readonly code?: unknown; readonly message?: unknown };
  };
  if (candidate.code !== "P2010") return error;
  const sqlState =
    typeof candidate.meta?.code === "string" ? candidate.meta.code : "";
  const wrappedMessage = [candidate.message, candidate.meta?.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const mappings = [
    [
      "40001",
      "codex_oauth_active_namespace_reattestation_stale",
      "codex_rotating_workflow_reattestation_stale",
    ],
    [
      "22023",
      "codex_oauth_active_namespace_reattestation_invalid",
      "codex_rotating_workflow_reattestation_invalid",
    ],
    [
      "42501",
      "codex_oauth_active_namespace_reattestation_role_forbidden",
      "codex_rotating_workflow_reattestation_forbidden",
    ],
  ] as const;
  const mapping = mappings.find(
    ([expectedState, databaseCode]) =>
      sqlState === expectedState &&
      new RegExp(
        `(?:^|[^A-Za-z0-9_])${databaseCode}(?:$|[^A-Za-z0-9_])`,
        "u",
      ).test(wrappedMessage),
  );
  return mapping
    ? new CodexRotatingWorkflowReattestationError(mapping[2])
    : error;
}

/** Persists canonical workflow evidence for an existing active namespace. */
export class PrismaCodexRotatingWorkflowAttestation
  implements
    CodexRotatingCurrentWorkflowAttestationPort,
    CodexRotatingWorkflowReattestationPersistencePort
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly databaseRecoveryWitness?: string,
  ) {}

  /**
   * Re-attests the workflow source for an unchanged active namespace. This is
   * used when a canonical workflow schema is upgraded without rotating the
   * provider secret generation.
   */
  async readActiveWorkflowAttestation(
    namespace: VersionedProviderSecretNamespace,
  ) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        githubRepositoryId: string;
        workflowPath: string | null;
        workflowSourceCommitSha: string | null;
        workflowSourceBlobSha: string | null;
        workflowSourceSha256: string | null;
        workflowSemanticSha256: string | null;
        workflowSourceTrust: string | null;
        workflowSchemaVersion: number | null;
        attestedRepositoryId: string | null;
      }>
    >`
      SELECT namespace."githubRepositoryId", namespace."workflowPath",
        namespace."workflowSourceCommitSha", namespace."workflowSourceBlobSha",
        namespace."workflowSourceSha256", namespace."workflowSemanticSha256",
        namespace."workflowSourceTrust", namespace."workflowSchemaVersion",
        namespace."attestedRepositoryId"
      FROM "CodexOAuthSecretNamespace" namespace
      JOIN "CodexOAuthProviderInstance" provider
        ON provider."id" = namespace."providerInstanceRowId"
      WHERE namespace."id" = ${namespace.namespaceId}
        AND namespace."providerInstanceRowId" = provider."id"
        AND namespace."githubRepositoryId" = ${namespace.scope.repositoryId}
        AND namespace."namespaceEpoch" = ${namespace.epoch}
        AND namespace."secretName" = ${namespace.name}
        AND namespace."status" = 'active'
        AND NOT namespace."permanentlyRetired"
        AND provider."providerInstanceId" = ${namespace.scope.providerInstanceId}
        AND provider."state" = 'active'
        AND provider."activeSecretNamespaceId" = namespace."id"
        AND provider."activeSecretNamespaceEpoch" = namespace."namespaceEpoch"
        AND provider."activeSecretNamespaceName" = namespace."secretName"
    `;
    const row = rows.length === 1 ? rows[0] : null;
    if (
      !row ||
      row.githubRepositoryId !== namespace.scope.repositoryId ||
      row.attestedRepositoryId !== namespace.scope.repositoryId ||
      !row.workflowPath ||
      !row.workflowSourceCommitSha ||
      !row.workflowSourceBlobSha ||
      !row.workflowSourceSha256 ||
      !row.workflowSemanticSha256 ||
      row.workflowSourceTrust !==
        WorkflowSourceTrust.TrustedDefaultBranchRevision ||
      row.workflowSchemaVersion === null
    ) {
      return null;
    }
    return createVersionedSecretWorkflowSourceAttestation({
      repositoryId: row.attestedRepositoryId,
      workflowPath: row.workflowPath,
      workflowSourceCommitSha: row.workflowSourceCommitSha,
      workflowSourceBlobSha: row.workflowSourceBlobSha,
      workflowSourceSha256: row.workflowSourceSha256,
      workflowSemanticSha256: row.workflowSemanticSha256,
      sourceTrust: row.workflowSourceTrust,
      workflowSchemaVersion: row.workflowSchemaVersion,
      secretNamespace: namespace,
    });
  }

  async validateActiveWorkflowSource(
    input: Parameters<
      CodexRotatingWorkflowReattestationPersistencePort["validateActiveWorkflowSource"]
    >[0],
  ) {
    const { target, expectedCurrent, verifiedActive } = input;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const initial = await findClaim(tx, target.claimId);
          await requireProvenWriter(
            tx,
            initial.databaseIncarnation,
            initial.databaseRecoveryWitness,
            this.databaseRecoveryWitness,
          );
          await lockCodexRotatingProviderRow(tx, initial.providerInstanceRowId);
          const rows = await tx.$queryRaw<
            Array<{
              workflowPath: string;
              workflowSourceCommitSha: string;
              workflowSourceBlobSha: string;
              workflowSourceSha256: string;
              workflowSemanticSha256: string;
              workflowSourceTrust: WorkflowSourceTrust;
              workflowSchemaVersion: number;
              attestedRepositoryId: string;
            }>
          >`
            SELECT namespace."workflowPath", namespace."workflowSourceCommitSha",
              namespace."workflowSourceBlobSha", namespace."workflowSourceSha256",
              namespace."workflowSemanticSha256", namespace."workflowSourceTrust",
              namespace."workflowSchemaVersion", namespace."attestedRepositoryId"
            FROM "CodexOAuthProviderInstance" provider
            JOIN "CodexOAuthSecretNamespace" namespace
              ON namespace."id" = provider."activeSecretNamespaceId"
            JOIN "CodexOAuthSetupPayloadClaim" claim
              ON claim."id" = ${target.claimId}
            JOIN "CodexOAuthSetupDispatchAttempt" attempt
              ON attempt."id" = ${target.attemptId}
            JOIN "CodexOAuthSetupManifest" manifest
              ON manifest."id" = claim."manifestId"
            JOIN "RepositoryConnection" repository
              ON repository."id" = provider."repositoryId"
            JOIN "ScmRepositoryIdentity" identity
              ON identity."scmRepositoryIdentityId" = repository."scmRepositoryIdentityId"
            WHERE provider."id" = ${initial.providerInstanceRowId}
              AND provider."state" = 'active'
              AND provider."latestGenerationHash" = ${target.expectedGenerationHash}
              AND provider."mutationOwner" IS NULL
              AND provider."mutationOwnerId" IS NULL
              AND provider."activeLeaseId" IS NULL
              AND provider."activeSecretNamespaceId" = ${target.namespace.namespaceId}
              AND provider."activeSecretNamespaceEpoch" = ${target.namespace.epoch}
              AND provider."activeSecretNamespaceName" = ${target.namespace.name}
              AND namespace."providerInstanceRowId" = provider."id"
              AND namespace."githubRepositoryId" = ${target.repositoryId}
              AND namespace."namespaceEpoch" = ${target.namespace.epoch}
              AND namespace."secretName" = ${target.namespace.name}
              AND namespace."status" = 'active'
              AND NOT namespace."permanentlyRetired"
              AND namespace."attestedRepositoryId" = ${target.repositoryId}
              AND claim."providerInstanceRowId" = provider."id"
              AND claim."githubRepositoryId" = ${target.repositoryId}
              AND claim."generationHash" = ${target.expectedGenerationHash}
              AND claim."status" = 'active'
              AND claim."confirmedAttemptId" = attempt."id"
              AND manifest."status" = 'consumed'
              AND manifest."manifestJson"->>'repositoryFullName' = ${target.repositoryFullName}
              AND manifest."manifestJson"->>'repositoryId' = ${target.repositoryId}
              AND repository."fullName" = ${target.repositoryFullName}
              AND repository."externalRepositoryId" = ${target.repositoryId}
              AND identity."externalRepositoryId" = ${target.repositoryId}
              AND identity."currentWorkspaceId" = repository."workspaceId"
              AND identity."currentRepositoryConnectionId" = repository."id"
              AND identity."version" = (manifest."manifestJson"->>'repositoryIdentityVersion')::integer
              AND attempt."claimId" = claim."id"
              AND attempt."namespaceId" = namespace."id"
              AND attempt."status" = 'confirmed'
              AND (SELECT count(*) FROM "CodexOAuthSetupPayloadClaim" active_claim
                   WHERE active_claim."providerInstanceRowId" = provider."id"
                     AND active_claim."status" = 'active') = 1
              AND (SELECT count(*) FROM "CodexOAuthSecretNamespace" active_namespace
                   WHERE active_namespace."providerInstanceRowId" = provider."id"
                     AND active_namespace."status" = 'active') = 1
            FOR UPDATE OF provider, namespace, claim, attempt
          `;
          const row = rows.length === 1 ? rows[0] : null;
          if (!row) {
            throw new Error("codex_rotating_workflow_reattestation_stale");
          }
          const persisted = createVersionedSecretWorkflowSourceAttestation({
            repositoryId: row.attestedRepositoryId,
            workflowPath: row.workflowPath,
            workflowSourceCommitSha: row.workflowSourceCommitSha,
            workflowSourceBlobSha: row.workflowSourceBlobSha,
            workflowSourceSha256: row.workflowSourceSha256,
            workflowSemanticSha256: row.workflowSemanticSha256,
            sourceTrust: row.workflowSourceTrust,
            workflowSchemaVersion: row.workflowSchemaVersion,
            secretNamespace: target.namespace,
          });
          if (!sameExactWorkflowAttestation(persisted, expectedCurrent)) {
            throw new Error("codex_rotating_workflow_reattestation_stale");
          }
          assertCodexRotatingWorkflowAlreadyActiveTransition({
            persisted,
            verified: verifiedActive,
          });
          return { status: "active" as const };
        },
        { timeout: transactionTimeoutMs },
      );
    } catch (error) {
      throw translateWorkflowReattestationDatabaseError(error);
    }
  }

  async replaceActiveWorkflowSource(
    transition: CodexRotatingWorkflowReattestationTransition,
  ) {
    const { target, expectedCurrent, replacement } = transition;
    assertCodexRotatingWorkflowReplacementTransition({
      current: expectedCurrent,
      replacement,
      compatibilityWindowSeconds: transition.compatibilityWindowSeconds,
      repositoryFullName: target.repositoryFullName,
    });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const initial = await findClaim(tx, target.claimId);
          await requireProvenWriter(
            tx,
            initial.databaseIncarnation,
            initial.databaseRecoveryWitness,
            this.databaseRecoveryWitness,
          );
          await lockCodexRotatingProviderRow(tx, initial.providerInstanceRowId);
          const mutationFences = await tx.$queryRaw<
            Array<{
              mutationOwner: string | null;
              mutationOwnerId: string | null;
              activeLeaseId: string | null;
            }>
          >`
            SELECT "mutationOwner", "mutationOwnerId", "activeLeaseId"
            FROM "CodexOAuthProviderInstance"
            WHERE "id" = ${initial.providerInstanceRowId}
          `;
          const mutationFence = mutationFences[0];
          if (
            !mutationFence ||
            mutationFence.mutationOwner !== null ||
            mutationFence.mutationOwnerId !== null ||
            mutationFence.activeLeaseId !== null
          ) {
            throw new Error("codex_rotating_workflow_reattestation_stale");
          }
          const claim = await findClaimForUpdate(tx, target.claimId);
          const attempt = await findAttemptForUpdate(
            tx,
            target.claimId,
            target.attemptId,
          );
          if (
            claim.status !== "active" ||
            attempt.status !== "confirmed" ||
            attempt.namespaceId !== target.namespace.namespaceId ||
            claim.githubRepositoryId !== target.repositoryId
          ) {
            throw new Error("codex_rotating_setup_activation_mismatch");
          }
          if (expectedCurrent.workflowSchemaVersion === 5) {
            if (
              claim.generationHash !== target.expectedGenerationHash ||
              claim.confirmedAttemptId !== attempt.attemptId ||
              attempt.namespaceEpoch !== target.namespace.epoch ||
              attempt.secretName !== target.namespace.name
            ) {
              throw new Error("codex_rotating_setup_activation_mismatch");
            }
            const updated = await tx.$executeRaw`
              UPDATE "CodexOAuthSecretNamespace" namespace
              SET "workflowPath" = ${replacement.workflowPath},
                "workflowSourceCommitSha" = ${replacement.workflowSourceCommitSha},
                "workflowSourceBlobSha" = ${replacement.workflowSourceBlobSha},
                "workflowSourceSha256" = ${replacement.workflowSourceSha256},
                "workflowSemanticSha256" = ${replacement.workflowSemanticSha256}
              WHERE namespace."id" = ${target.namespace.namespaceId}
                AND namespace."providerInstanceRowId" = ${initial.providerInstanceRowId}
                AND namespace."githubRepositoryId" = ${target.repositoryId}
                AND namespace."workflowPath" = ${expectedCurrent.workflowPath}
                AND namespace."workflowSchemaVersion" = 5
                AND namespace."workflowSourceTrust" = ${expectedCurrent.sourceTrust}
                AND namespace."workflowSourceCommitSha" = ${expectedCurrent.workflowSourceCommitSha}
                AND namespace."workflowSourceBlobSha" = ${expectedCurrent.workflowSourceBlobSha}
                AND namespace."workflowSourceSha256" = ${expectedCurrent.workflowSourceSha256}
                AND namespace."workflowSemanticSha256" = ${expectedCurrent.workflowSemanticSha256}
                AND namespace."status" = 'active'
                AND NOT namespace."permanentlyRetired"
                AND EXISTS (
                  SELECT 1 FROM "CodexOAuthProviderInstance" provider
                  WHERE provider."id" = ${initial.providerInstanceRowId}
                    AND provider."state" = 'active'
                    AND provider."latestGenerationHash" = ${target.expectedGenerationHash}
                    AND provider."activeSecretNamespaceId" = namespace."id"
                    AND provider."mutationOwner" IS NULL
                    AND provider."mutationOwnerId" IS NULL
                    AND provider."activeLeaseId" IS NULL
                )
                AND EXISTS (
                  SELECT 1
                  FROM "CodexOAuthSetupPayloadClaim" active_claim
                  JOIN "CodexOAuthSetupManifest" manifest
                    ON manifest."id" = active_claim."manifestId"
                  JOIN "CodexOAuthProviderInstance" active_provider
                    ON active_provider."id" = active_claim."providerInstanceRowId"
                  JOIN "RepositoryConnection" repository
                    ON repository."id" = active_provider."repositoryId"
                  JOIN "ScmRepositoryIdentity" identity
                    ON identity."scmRepositoryIdentityId" = repository."scmRepositoryIdentityId"
                  WHERE active_claim."id" = ${target.claimId}
                    AND active_claim."providerInstanceRowId" = ${initial.providerInstanceRowId}
                    AND active_claim."status" = 'active'
                    AND manifest."status" = 'consumed'
                    AND manifest."manifestJson"->>'repositoryFullName' = ${target.repositoryFullName}
                    AND manifest."manifestJson"->>'repositoryId' = ${target.repositoryId}
                    AND repository."fullName" = ${target.repositoryFullName}
                    AND repository."externalRepositoryId" = ${target.repositoryId}
                    AND identity."externalRepositoryId" = ${target.repositoryId}
                    AND identity."currentWorkspaceId" = repository."workspaceId"
                    AND identity."currentRepositoryConnectionId" = repository."id"
                    AND identity."version" = (manifest."manifestJson"->>'repositoryIdentityVersion')::integer
                )
            `;
            if (updated !== 1) {
              throw new Error("codex_rotating_workflow_reattestation_stale");
            }
            return { status: "active" as const };
          }
          await assertV4ReattestationRepositoryIdentity(tx, {
            providerInstanceRowId: claim.providerInstanceRowId,
            claimId: claim.id,
            manifestId: claim.manifestId,
            repositoryId: target.repositoryId,
            repositoryFullName: target.repositoryFullName,
          });
          await tx.$executeRaw`
            SELECT "codex_oauth_reattest_active_namespace_v4_to_v5"(
              ${claim.providerInstanceRowId}, ${claim.id}, ${attempt.attemptId},
              ${target.namespace.namespaceId}, ${target.namespace.epoch}, ${target.namespace.name},
              ${target.repositoryId}, ${target.expectedGenerationHash}, ${target.workflowPath},
              ${replacement.sourceTrust}, ${expectedCurrent.workflowSchemaVersion},
              ${replacement.workflowSchemaVersion},
              ${expectedCurrent.workflowSourceCommitSha},
              ${expectedCurrent.workflowSourceBlobSha},
              ${expectedCurrent.workflowSourceSha256},
              ${expectedCurrent.workflowSemanticSha256},
              ${replacement.workflowSourceCommitSha}, ${replacement.workflowSourceBlobSha},
              ${replacement.workflowSourceSha256}, ${replacement.workflowSemanticSha256},
              ${transition.compatibilityWindowSeconds}
            )
          `;
          return { status: "active" as const };
        },
        { timeout: transactionTimeoutMs },
      );
    } catch (error) {
      throw translateWorkflowReattestationDatabaseError(error);
    }
  }
}

async function assertV4ReattestationRepositoryIdentity(
  tx: Prisma.TransactionClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly claimId: string;
    readonly manifestId: string;
    readonly repositoryId: string;
    readonly repositoryFullName: string;
  },
): Promise<void> {
  const rows = await tx.$queryRaw<readonly { version: number }[]>`
    SELECT identity."version"
    FROM "CodexOAuthSetupPayloadClaim" claim
    JOIN "CodexOAuthSetupManifest" manifest
      ON manifest."id" = claim."manifestId"
    JOIN "CodexOAuthProviderInstance" provider
      ON provider."id" = claim."providerInstanceRowId"
    JOIN "RepositoryConnection" repository
      ON repository."id" = provider."repositoryId"
    JOIN "GitHubInstallation" installation
      ON installation."id" = repository."installationId"
    JOIN "ScmRepositoryIdentity" identity
      ON identity."scmRepositoryIdentityId" = repository."scmRepositoryIdentityId"
    WHERE claim."id" = ${input.claimId}
      AND claim."manifestId" = ${input.manifestId}
      AND claim."providerInstanceRowId" = ${input.providerInstanceRowId}
      AND claim."status" = 'active'
      AND manifest."status" = 'consumed'
      AND manifest."manifestJson"->>'repositoryFullName' = ${input.repositoryFullName}
      AND manifest."manifestJson"->>'repositoryId' = ${input.repositoryId}
      AND provider."id" = ${input.providerInstanceRowId}
      AND repository."workspaceId" = provider."workspaceId"
      AND repository."provider" = 'github'
      AND repository."fullName" = ${input.repositoryFullName}
      AND repository."externalRepositoryId" = ${input.repositoryId}
      AND repository."selected" = true
      AND repository."archived" = false
      AND installation."workspaceId" = repository."workspaceId"
      AND installation."status" = 'active'
      AND identity."provider" = 'github'
      AND identity."externalRepositoryId" = ${input.repositoryId}
      AND identity."currentWorkspaceId" = repository."workspaceId"
      AND identity."currentRepositoryConnectionId" = repository."id"
      AND identity."version" = (manifest."manifestJson"->>'repositoryIdentityVersion')::integer
      AND identity."boundAt" IS NOT NULL
      AND identity."unboundAt" IS NULL
    FOR UPDATE OF identity
  `;
  if (rows.length !== 1) {
    throw new Error("codex_rotating_workflow_reattestation_stale");
  }
}
