import type { Prisma } from "@prisma/client";
import type { CodexRuntimeMigrationBinding } from "@reviewrouter/features-provider-setup";

/** Called only while the existing provider mutation row lock is held. */
export async function assertOriginalCodexRuntimeMigrationSource(input: {
  readonly tx: Prisma.TransactionClient;
  readonly providerInstanceRowId: string;
  readonly githubRepositoryId: string;
  readonly binding: CodexRuntimeMigrationBinding;
  readonly stage: "before_setup" | "setup";
}): Promise<void> {
  const provider = await input.tx.codexOAuthProviderInstance.findUnique({
    where: { id: input.providerInstanceRowId },
    include: { activeSecretNamespace: true },
  });
  const namespace = provider?.activeSecretNamespace;
  const source = input.binding.source;
  const sourceEpoch = BigInt(source.mutationEpoch);
  if (
    !provider ||
    !namespace ||
    provider.activeLeaseId !== null ||
    provider.latestGeneration !== source.generation ||
    provider.latestGenerationHash !== source.generationHash ||
    provider.activeAccountIdentityHash !== source.accountIdentityHash ||
    provider.generationHashSalt !== source.generationHashSalt ||
    provider.accountFingerprintSalt !== source.accountFingerprintSalt ||
    provider.activeSecretNamespaceId !== source.namespaceId ||
    provider.activeSecretNamespaceEpoch?.toString() !== source.namespaceEpoch ||
    provider.activeSecretNamespaceName !== source.secretName ||
    namespace.id !== source.namespaceId ||
    namespace.namespaceEpoch.toString() !== source.namespaceEpoch ||
    namespace.secretName !== source.secretName ||
    namespace.providerInstanceRowId !== provider.id ||
    namespace.githubRepositoryId !== input.githubRepositoryId ||
    namespace.attestedRepositoryId !== input.githubRepositoryId ||
    namespace.status !== "active" ||
    namespace.permanentlyRetired ||
    namespace.workflowPath !== source.workflowPath ||
    namespace.workflowSourceCommitSha !== source.workflowSourceCommitSha ||
    namespace.workflowSourceBlobSha !== source.workflowSourceBlobSha ||
    namespace.workflowSourceSha256 !== source.workflowSourceSha256 ||
    namespace.workflowSemanticSha256 !== source.workflowSemanticSha256 ||
    namespace.workflowSchemaVersion !== source.workflowSchemaVersion ||
    namespace.workflowSourceTrust !== "trusted_default_branch_revision" ||
    (input.stage === "before_setup"
      ? provider.state !== "active" ||
        provider.mutationOwner !== null ||
        provider.mutationOwnerId !== null ||
        provider.mutationEpoch !== sourceEpoch
      : !["setup_pending", "workflow_update_required"].includes(
          provider.state,
        ) ||
        provider.mutationOwner !== "setup" ||
        provider.mutationOwnerId !== input.binding.migrationId ||
        provider.mutationEpoch !== sourceEpoch + 1n)
  ) {
    throw new Error("codex_runtime_migration_source_mismatch");
  }
}
