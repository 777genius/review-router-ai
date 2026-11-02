import type { PrismaClient } from "@prisma/client";
import { codexRotatingSetupManifestSchema } from "@reviewrouter/features-provider-setup";
import { renderCanonicalCodexRotatingInteractionWorkflowV3 } from "@reviewrouter/features-workflow-provisioning";
import { createCodexRuntimeMigrationGitHub } from "./codex-runtime-migration-composition";
import { resolveCodexRotatingPublicWebUrl } from "./codex-rotating-seed-script";
import { lockCodexRotatingProviderRow } from "./codex-rotating-provider-mutation-fence";

/** Normal setup is unchanged. A migration resumes only its exact activated B. */
export async function completeCodexRuntimeMigrationActivation(input: {
  readonly prisma: PrismaClient;
  readonly claimId: string;
  readonly namespaceId: string;
  readonly expectedApiUrl: string;
}): Promise<void> {
  const claim = await input.prisma.codexOAuthSetupPayloadClaim.findFirst({
    where: {
      id: input.claimId,
      manifestId: { startsWith: "codex_migration_" },
    },
    include: {
      manifest: true,
      repository: { include: { installation: true } },
    },
  });
  if (!claim) return;
  const binding = codexRotatingSetupManifestSchema.parse(
    claim.manifest.manifestJson,
  ).runtimeMigration;
  if (!binding) return;
  if (
    claim.status !== "active" ||
    claim.manifest.status !== "consumed" ||
    claim.manifest.id !== binding.migrationId ||
    !claim.repository.installation ||
    claim.repository.installation.status !== "active"
  ) {
    throw new Error("codex_runtime_migration_activation_invalid");
  }
  const github = await createCodexRuntimeMigrationGitHub({
    githubInstallationId:
      claim.repository.installation.githubInstallationId.toString(),
    githubRepositoryId: claim.githubRepositoryId,
    repositoryFullName: claim.repository.fullName,
    providerInstanceId: claim.manifest.providerInstanceId,
    setupBaseUrl: resolveCodexRotatingPublicWebUrl(),
  });
  await input.prisma.$transaction(
    async (tx) => {
      await lockCodexRotatingProviderRow(tx, claim.providerInstanceRowId);
      const provider = await tx.codexOAuthProviderInstance.findUnique({
        where: { id: claim.providerInstanceRowId },
        include: { activeSecretNamespace: true },
      });
      const namespace = provider?.activeSecretNamespace;
      if (
        !provider ||
        !namespace ||
        provider.state !== "active" ||
        provider.mutationOwner !== null ||
        namespace.id !== input.namespaceId ||
        namespace.id === binding.source.namespaceId ||
        namespace.status !== "active" ||
        namespace.permanentlyRetired ||
        !namespace.workflowSourceSha256 ||
        provider.activeAccountIdentityHash !==
          binding.source.accountIdentityHash ||
        namespace.namespaceEpoch !== provider.activeSecretNamespaceEpoch ||
        namespace.secretName !== provider.activeSecretNamespaceName
      ) {
        throw new Error("codex_runtime_migration_activation_invalid");
      }
      await github.migration.enableActivatedIngress({
        binding,
        reviewSourceSha256: namespace.workflowSourceSha256,
        interactionSources: (["off", "suggest"] as const).map(
          (discussionMode) =>
            renderCanonicalCodexRotatingInteractionWorkflowV3({
              actionRef: binding.targetActionRef,
              apiUrl: input.expectedApiUrl,
              runtimeConfigMode: "oidc",
              discussionMode,
            }),
        ),
      });
    },
    { timeout: 30_000 },
  );
}
