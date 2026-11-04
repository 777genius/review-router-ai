import {
  readGitHubWorkflowRepositoryIdentity,
  readGitHubWorkflowCommitSha,
  readGitHubVerifiedWorkflowBlob,
} from "@reviewrouter/features-workflow-provisioning/composition";
import { createHash } from "node:crypto";
import {
  canonicalCodexRotatingProviderId,
  codexRotatingAuthMode,
  inspectCodexRotatingWorkflowNamespace,
  type CodexRotatingDefaultWorkflowSourcePort,
} from "@reviewrouter/features-provider-setup";
import {
  assertTrustedCanonicalVersionedWorkflow,
  CodexRotatingT0WorkflowSchemaVersion,
  createVersionedSecretWorkflowSourceAttestation,
  codexWorkflowPathForRepository,
  isCodexWorkflowRepositoryIdentityAdmitted,
  defaultCodexRotatingWorkflowPath,
  isolatedQualityWorkflowPath,
  readCanonicalCodexRotatingT0WorkflowSourceMetadata,
  readCanonicalIsolatedQualityWorkflowSourceMetadata,
  workflowDocumentSemanticSha256,
  WorkflowSourceTrust,
  type VersionedProviderSecretNamespace,
} from "@reviewrouter/features-workflow-provisioning";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  requireReviewRouterDatabaseRecoveryWitness,
  resolveReviewRouterCodexRotatingTrustedActionRefs,
} from "@reviewrouter/platform-config";
import { codexRotatingSetupLedger } from "./codex-rotating-setup-ledger";
import { PrismaCodexRotatingWorkflowNamespace } from "@reviewrouter/features-provider-setup/composition";
import type { CodexRotatingWriterSchemaPolicy } from "./codex-rotating-writer-schema-policy";
import { completeCodexRuntimeMigrationActivation } from "./codex-runtime-migration-activation";

type GitHubRequester = {
  request(
    route: string,
    parameters?: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
};

export type CodexRotatingWorkflowActivationResult =
  | { readonly status: "not_configured" }
  | {
      readonly status: "already_active" | "activated";
      readonly namespaceEpoch: string;
      readonly workflowSourceCommitSha: string;
    };

export async function activateConfirmedCodexNamespaceAfterWorkflowMerge(input: {
  readonly prisma: PrismaClient;
  readonly octokit: GitHubRequester;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly githubRepositoryId: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly expectedRepositoryFullName: string;
  readonly expectedApiUrl: string;
  readonly writerSchemaPolicy: CodexRotatingWriterSchemaPolicy;
}): Promise<CodexRotatingWorkflowActivationResult> {
  if (
    !isCodexWorkflowRepositoryIdentityAdmitted({
      repositoryId: input.githubRepositoryId,
      repositoryFullName: input.expectedRepositoryFullName,
    })
  ) {
    throw new Error("codex_rotating_workflow_repository_identity_mismatch");
  }
  const workflowPath = codexWorkflowPathForRepository({
    repositoryId: input.githubRepositoryId,
    repositoryFullName: input.expectedRepositoryFullName,
  });
  if (
    workflowPath === isolatedQualityWorkflowPath &&
    input.defaultBranch !== "main"
  ) {
    throw new Error("codex_rotating_workflow_default_branch_mismatch");
  }
  const rotatingProvider =
    await input.prisma.codexOAuthProviderInstance.findUnique({
      where: {
        repositoryId_authMode: {
          repositoryId: input.repositoryId,
          authMode: codexRotatingAuthMode,
        },
      },
      select: { id: true, latestGenerationHash: true },
    });
  if (!rotatingProvider) return { status: "not_configured" };

  const providerInstanceId = canonicalCodexRotatingProviderId(
    input.githubRepositoryId,
  );
  const inspection = await inspectCodexRotatingWorkflowNamespace(
    {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      githubRepositoryId: input.githubRepositoryId,
      providerInstanceId,
    },
    {
      workflowNamespace: new PrismaCodexRotatingWorkflowNamespace(
        input.prisma,
        requireReviewRouterDatabaseRecoveryWitness(),
      ),
    },
  );
  const namespace = inspection.namespace;
  const activeNamespace =
    inspection.source === "active"
      ? await input.prisma.codexOAuthSecretNamespace.findUnique({
          where: { id: namespace.namespaceId },
          select: { workflowSchemaVersion: true },
        })
      : null;
  const expectedWorkflowSchemaVersion =
    input.writerSchemaPolicy.selectWriterSchemaVersion({
      existingNamespace: inspection.source === "active",
      existingWorkflowSchemaVersion:
        activeNamespace?.workflowSchemaVersion ?? null,
    });
  if (inspection.source === "active") {
    if (!rotatingProvider.latestGenerationHash) {
      throw new Error("codex_rotating_workflow_generation_missing");
    }
    const result = await codexRotatingSetupLedger.replaceActiveWorkflowSource(
      {
        claimId: inspection.claimId,
        attemptId: inspection.attemptId,
        expectedGenerationHash: rotatingProvider.latestGenerationHash,
        repositoryId: input.githubRepositoryId,
        repositoryFullName: input.expectedRepositoryFullName,
        workflowPath,
        namespace,
      },
      defaultWorkflowSourcePort(
        input,
        providerInstanceId,
        namespace,
        expectedWorkflowSchemaVersion,
        workflowPath,
      ),
    );
    await completeCodexRuntimeMigrationActivation({
      prisma: input.prisma,
      claimId: inspection.claimId,
      namespaceId: namespace.namespaceId,
      expectedApiUrl: input.expectedApiUrl,
    });
    return {
      status:
        result.status === "already_active" ? "already_active" : "activated",
      namespaceEpoch: namespace.epoch.toString(),
      workflowSourceCommitSha: result.workflowSourceCommitSha,
    };
  }
  const repositoryResponse = await input.octokit.request(
    "GET /repos/{owner}/{repo}",
    { owner: input.owner, repo: input.name },
  );
  const observedRepository = readGitHubRepositoryIdentity(
    repositoryResponse.data,
  );
  if (observedRepository.defaultBranch !== input.defaultBranch) {
    throw new Error("codex_rotating_workflow_default_branch_mismatch");
  }
  const refParameters = {
    owner: input.owner,
    repo: input.name,
    ref: `heads/${input.defaultBranch}`,
  };
  const refResponse = await input.octokit.request(
    "GET /repos/{owner}/{repo}/git/ref/{ref}",
    refParameters,
  );
  const workflowSourceCommitSha = readGitHubCommitSha(refResponse.data);
  const contentResponse = await input.octokit.request(
    "GET /repos/{owner}/{repo}/contents/{path}",
    {
      owner: input.owner,
      repo: input.name,
      path: workflowPath,
      ref: workflowSourceCommitSha,
    },
  );
  const { source, blobSha } = readGitHubWorkflowBlob(contentResponse.data);
  const metadata =
    workflowPath === defaultCodexRotatingWorkflowPath
      ? readCanonicalCodexRotatingT0WorkflowSourceMetadata(source)
      : readCanonicalIsolatedQualityWorkflowSourceMetadata(source);
  assertTrustedCanonicalVersionedWorkflow({
    metadata,
    observedRepositoryId: observedRepository.id,
    observedRepositoryFullName: observedRepository.fullName,
    expectedRepositoryId: input.githubRepositoryId,
    expectedRepositoryFullName: input.expectedRepositoryFullName,
    trustedActionRefs: resolveReviewRouterCodexRotatingTrustedActionRefs(),
    expectedApiUrl: input.expectedApiUrl,
    expectedProviderInstanceId: providerInstanceId,
    expectedSecretNamespace: namespace,
    expectedWorkflowSchemaVersion,
  });
  const attestation = createVersionedSecretWorkflowSourceAttestation({
    repositoryId: input.githubRepositoryId,
    workflowPath,
    workflowSourceCommitSha,
    workflowSourceBlobSha: blobSha,
    workflowSourceSha256: createHash("sha256").update(source).digest("hex"),
    workflowSemanticSha256: workflowDocumentSemanticSha256(source),
    workflowSchemaVersion: metadata.workflowSchemaVersion,
    sourceTrust: WorkflowSourceTrust.TrustedDefaultBranchRevision,
    secretNamespace: namespace,
  });
  const finalRepositoryResponse = await input.octokit.request(
    "GET /repos/{owner}/{repo}",
    { owner: input.owner, repo: input.name },
  );
  const finalRepository = readGitHubRepositoryIdentity(
    finalRepositoryResponse.data,
  );
  if (
    finalRepository.id !== observedRepository.id ||
    finalRepository.fullName !== observedRepository.fullName ||
    finalRepository.defaultBranch !== observedRepository.defaultBranch
  ) {
    throw new Error("codex_rotating_workflow_repository_identity_changed");
  }
  const finalRefResponse = await input.octokit.request(
    "GET /repos/{owner}/{repo}/git/ref/{ref}",
    {
      owner: input.owner,
      repo: input.name,
      ref: `heads/${finalRepository.defaultBranch}`,
    },
  );
  if (readGitHubCommitSha(finalRefResponse.data) !== workflowSourceCommitSha) {
    throw new Error("codex_rotating_workflow_default_head_changed");
  }
  await codexRotatingSetupLedger.activate({
    claimId: inspection.claimId,
    attemptId: inspection.attemptId,
    namespaceId: namespace.namespaceId,
    namespaceEpoch: namespace.epoch.toString(),
    secretName: namespace.name,
    repositoryId: attestation.repositoryId,
    repositoryFullName: finalRepository.fullName,
    workflowPath: attestation.workflowPath,
    workflowSourceCommitSha: attestation.workflowSourceCommitSha,
    workflowSourceBlobSha: attestation.workflowSourceBlobSha,
    workflowSourceSha256: attestation.workflowSourceSha256,
    workflowSemanticSha256: attestation.workflowSemanticSha256,
    sourceTrust: attestation.sourceTrust,
    workflowSchemaVersion: attestation.workflowSchemaVersion,
  });
  await completeCodexRuntimeMigrationActivation({
    prisma: input.prisma,
    claimId: inspection.claimId,
    namespaceId: namespace.namespaceId,
    expectedApiUrl: input.expectedApiUrl,
  });
  return {
    status: "activated",
    namespaceEpoch: namespace.epoch.toString(),
    workflowSourceCommitSha,
  };
}

function defaultWorkflowSourcePort(
  input: Pick<
    Parameters<typeof activateConfirmedCodexNamespaceAfterWorkflowMerge>[0],
    | "octokit"
    | "owner"
    | "name"
    | "defaultBranch"
    | "githubRepositoryId"
    | "expectedRepositoryFullName"
    | "expectedApiUrl"
  >,
  providerInstanceId: string,
  namespace: VersionedProviderSecretNamespace,
  expectedWorkflowSchemaVersion: CodexRotatingT0WorkflowSchemaVersion,
  workflowPath: string,
): CodexRotatingDefaultWorkflowSourcePort {
  let observedRepository:
    | Readonly<{ id: string; fullName: string; defaultBranch: string }>
    | undefined;
  return {
    async readDefaultSourceIdentity() {
      const repositoryResponse = await input.octokit.request(
        "GET /repos/{owner}/{repo}",
        { owner: input.owner, repo: input.name },
      );
      const repository = readGitHubRepositoryIdentity(repositoryResponse.data);
      if (repository.defaultBranch !== input.defaultBranch) {
        throw new Error("codex_rotating_workflow_default_branch_mismatch");
      }
      observedRepository = repository;
      const response = await input.octokit.request(
        "GET /repos/{owner}/{repo}/git/ref/{ref}",
        {
          owner: input.owner,
          repo: input.name,
          ref: `heads/${repository.defaultBranch}`,
        },
      );
      return {
        repositoryId: repository.id,
        repositoryFullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        headCommitSha: readGitHubCommitSha(response.data),
      };
    },
    async readVerifiedWorkflowAt({ commitSha }) {
      if (!observedRepository) {
        throw new Error("codex_rotating_workflow_repository_identity_missing");
      }
      const response = await input.octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: input.owner,
          repo: input.name,
          path: workflowPath,
          ref: commitSha,
        },
      );
      const { source, blobSha } = readGitHubWorkflowBlob(response.data);
      const metadata =
        workflowPath === defaultCodexRotatingWorkflowPath
          ? readCanonicalCodexRotatingT0WorkflowSourceMetadata(source)
          : readCanonicalIsolatedQualityWorkflowSourceMetadata(source);
      assertTrustedCanonicalVersionedWorkflow({
        metadata,
        observedRepositoryId: observedRepository.id,
        observedRepositoryFullName: observedRepository.fullName,
        expectedRepositoryId: input.githubRepositoryId,
        expectedRepositoryFullName: input.expectedRepositoryFullName,
        trustedActionRefs: resolveReviewRouterCodexRotatingTrustedActionRefs(),
        expectedApiUrl: input.expectedApiUrl,
        expectedProviderInstanceId: providerInstanceId,
        expectedSecretNamespace: namespace,
        expectedWorkflowSchemaVersion,
      });
      return createVersionedSecretWorkflowSourceAttestation({
        repositoryId: input.githubRepositoryId,
        workflowPath,
        workflowSourceCommitSha: commitSha,
        workflowSourceBlobSha: blobSha,
        workflowSourceSha256: createHash("sha256").update(source).digest("hex"),
        workflowSemanticSha256: workflowDocumentSemanticSha256(source),
        workflowSchemaVersion: metadata.workflowSchemaVersion,
        sourceTrust: WorkflowSourceTrust.TrustedDefaultBranchRevision,
        secretNamespace: namespace,
      });
    },
  };
}

function readGitHubRepositoryIdentity(data: unknown) {
  return readGitHubWorkflowRepositoryIdentity(data, "codex_rotating_workflow");
}

function readGitHubCommitSha(data: unknown): string {
  return readGitHubWorkflowCommitSha(data, "codex_rotating_workflow");
}

function readGitHubWorkflowBlob(data: unknown) {
  return readGitHubVerifiedWorkflowBlob(data, {
    errorPrefix: "codex_rotating_workflow",
  });
}
