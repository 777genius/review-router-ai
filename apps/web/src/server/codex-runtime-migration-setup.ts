import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  codexRotatingAuthMode,
  codexRotatingSetupManifestSchema,
  codexRuntimeMigrationCleanup,
  codexRuntimeMigrationWorkflowPath,
  renderCodexRuntimeMigrationWorkflow,
  type CodexRuntimeMigrationBinding,
} from "@reviewrouter/features-provider-setup";
import type { WorkflowSetupGatewayPort } from "@reviewrouter/features-workflow-provisioning";
import {
  isWorkflowProvisioningEnabled,
  requireReviewRouterDatabaseRecoveryWitness,
  resolveReviewRouterCodexRotatingActionRef,
} from "@reviewrouter/platform-config";
import {
  assertSetupIssuanceEnabled,
  issueCodexRotatingSetupCommand,
} from "./codex-rotating-setup-manifest";
import {
  resolveCodexRotatingPublicWebUrl,
  resolveCodexRotatingSeedScriptDescriptor,
} from "./codex-rotating-seed-script";
import {
  assertConfiguredCodexRuntimeMigrationTarget,
  createCodexRuntimeMigrationGitHub,
} from "./codex-runtime-migration-composition";
import { createDashboardRateLimitPolicy } from "./dashboard-rate-limits";

/** Called from the existing authorized Update setup PR action, never a read. */
export async function continueCodexRuntimeMigrationSetup(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly githubRepositoryId: string;
  readonly githubInstallationId: string;
  readonly defaultBranch: string;
  readonly sourceActionRef: string;
  readonly setupGateway: WorkflowSetupGatewayPort;
}): Promise<Record<string, string>> {
  if (!isWorkflowProvisioningEnabled())
    throw new Error("workflow_provisioning_disabled");
  assertSetupIssuanceEnabled();
  const targetActionRef = resolveReviewRouterCodexRotatingActionRef();
  await assertConfiguredCodexRuntimeMigrationTarget({
    ...input,
    targetActionRef,
  });
  if (targetActionRef === input.sourceActionRef)
    throw new Error("codex_runtime_migration_target_unavailable");
  const provider = await input.prisma.codexOAuthProviderInstance.findUnique({
    where: {
      repositoryId_authMode: {
        repositoryId: input.repositoryId,
        authMode: codexRotatingAuthMode,
      },
    },
    include: { activeSecretNamespace: true },
  });
  const namespace = provider?.activeSecretNamespace;
  if (
    !provider ||
    !namespace ||
    provider.workspaceId !== input.workspaceId ||
    namespace.permanentlyRetired ||
    namespace.status !== "active" ||
    !provider.latestGenerationHash ||
    !provider.activeAccountIdentityHash ||
    namespace.workflowPath !== ".github/workflows/reviewrouter-codex.yml" ||
    !namespace.workflowSourceCommitSha ||
    !namespace.workflowSourceBlobSha ||
    !namespace.workflowSourceSha256 ||
    !namespace.workflowSemanticSha256 ||
    (namespace.workflowSchemaVersion !== 4 &&
      namespace.workflowSchemaVersion !== 5)
  ) {
    throw new Error("codex_runtime_migration_source_mismatch");
  }
  const setupBaseUrl = resolveCodexRotatingPublicWebUrl();
  const github = await createCodexRuntimeMigrationGitHub({
    ...input,
    providerInstanceId: provider.providerInstanceId,
    setupBaseUrl,
  });
  const pending = await input.prisma.codexOAuthSetupManifest.findFirst({
    where: {
      providerInstanceRowId: provider.id,
      status: { in: ["issued", "fetched"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (pending) {
    const binding = codexRotatingSetupManifestSchema.parse(
      pending.manifestJson,
    ).runtimeMigration;
    if (!binding || binding.targetActionRef !== targetActionRef)
      throw new Error("codex_runtime_migration_recovery_required");
    const outcome = await github.migration.dispatch(binding, "readback_only");
    return migrationNotice(
      input,
      outcome.status === "observed"
        ? "runtime_migration_running"
        : "runtime_migration_recovery_required",
    );
  }
  const bootstrap = renderCodexRuntimeMigrationWorkflow({
    targetActionRef,
    setupBaseUrl,
    providerInstanceId: provider.providerInstanceId,
    sourceNamespaceId: namespace.id,
    sourceNamespaceEpoch: namespace.namespaceEpoch.toString(),
    sourceSecretName: namespace.secretName,
  });
  if (
    !(await github.migration.bootstrapInstalled({
      defaultBranch: input.defaultBranch,
      expectedSource: bootstrap,
    }))
  ) {
    const [owner, repo] = input.repositoryFullName.split("/");
    const pullRequest = await input.setupGateway.createOrUpdateSetupPullRequest(
      {
        owner: owner!,
        repo: repo!,
        baseBranch: input.defaultBranch,
        setupBranch: "reviewrouter/runtime-migration",
        setupMode: "runtime_migration",
        workflowFiles: [
          { path: codexRuntimeMigrationWorkflowPath, content: bootstrap },
        ],
      },
    );
    return {
      ...migrationNotice(input, "runtime_migration_bootstrap_pr_ready"),
      pr: pullRequest.url,
      branch: pullRequest.baseBranch ?? input.defaultBranch,
    };
  }
  const source: CodexRuntimeMigrationBinding["source"] = {
    namespaceId: namespace.id,
    namespaceEpoch: namespace.namespaceEpoch.toString(),
    secretName: namespace.secretName,
    canonicalizationVersion: 1,
    mutationEpoch: provider.mutationEpoch.toString(),
    generation: provider.latestGeneration,
    generationHash: provider.latestGenerationHash,
    accountIdentityHash: provider.activeAccountIdentityHash,
    generationHashSalt: provider.generationHashSalt,
    accountFingerprintSalt: provider.accountFingerprintSalt,
    actionRef: input.sourceActionRef,
    workflowPath: namespace.workflowPath,
    workflowSourceCommitSha: namespace.workflowSourceCommitSha,
    workflowSourceBlobSha: namespace.workflowSourceBlobSha,
    workflowSourceSha256: namespace.workflowSourceSha256,
    workflowSemanticSha256: namespace.workflowSemanticSha256,
    workflowSchemaVersion: namespace.workflowSchemaVersion,
  };
  const binding = await github.migration.captureBinding({
    source,
    targetActionRef,
    defaultBranch: input.defaultBranch,
    migrationId: `codex_migration_${randomUUID()}`,
  });
  await github.migration.disableIngress(binding);
  try {
    await github.migration.assertDrained(binding);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "codex_runtime_migration_runs_not_drained"
    ) {
      return migrationNotice(input, "runtime_migration_draining");
    }
    throw error;
  }
  const url = (suffix: string) =>
    new URL(`/api/codex-rotating/${suffix}`, setupBaseUrl).toString();
  const issued = await issueCodexRotatingSetupCommand({
    ...input,
    repositoryFullName: input.repositoryFullName,
    repositoryDefaultBranch: input.defaultBranch,
    installer: resolveCodexRotatingSeedScriptDescriptor(),
    setupManifestUrl: url("setup-manifest"),
    setupPrepareUrl: url("setup-prepare"),
    setupDispatchUrl: url("setup-dispatch"),
    setupDispatchOutcomeUrl: url("setup-dispatch-outcome"),
    setupStatusUrl: url("setup-status"),
    databaseRecoveryWitness: requireReviewRouterDatabaseRecoveryWitness(),
    runtimeEnvironment: process.env,
    runtimeMigration: {
      binding,
      assertDrained: () => github.migration.assertDrained(binding),
    },
    admittedOperation: async (tx) =>
      createDashboardRateLimitPolicy(tx).assertReviewConfigSaveAllowed({
        workspaceId: input.workspaceId,
        resourceId: `codex-rotating-setup:${input.repositoryId}`,
      }),
  });
  if (!issued.runtimeMigration)
    throw new Error("codex_runtime_migration_recovery_required");
  const outcome = await github.migration.dispatch(
    binding,
    issued.runtimeMigration.dispatchAdmission,
  );
  return migrationNotice(
    input,
    outcome.status === "observed"
      ? "runtime_migration_running"
      : "runtime_migration_recovery_required",
  );
}

/** Pending migration is a continuation, not a ready active namespace. */
export async function readPendingCodexRuntimeMigration(input: {
  readonly prisma: PrismaClient;
  readonly providerInstanceId: string;
}): Promise<CodexRuntimeMigrationBinding | null> {
  const row = await input.prisma.codexOAuthSetupManifest.findFirst({
    where: {
      providerInstanceId: input.providerInstanceId,
      status: { in: ["issued", "fetched"] },
      payloadClaims: { none: { status: "confirmed_candidate" } },
    },
    orderBy: { createdAt: "desc" },
  });
  return row
    ? (codexRotatingSetupManifestSchema.parse(row.manifestJson)
        .runtimeMigration ?? null)
    : null;
}

/** A confirmed seed finishes on its captured release during a trusted overlap. */
export async function readCodexRuntimeMigrationCandidateActionRef(input: {
  readonly prisma: PrismaClient;
  readonly namespaceId: string;
  readonly trustedActionRefs: readonly string[];
}): Promise<string | null> {
  const binding = await readConfirmedMigrationCandidate(input);
  if (!binding) return null;
  if (!input.trustedActionRefs.includes(binding.targetActionRef)) {
    throw new Error("codex_runtime_migration_target_unavailable");
  }
  return binding.targetActionRef;
}

/** Only a confirmed candidate created by this purpose removes the bootstrap. */
export async function withCodexRuntimeMigrationCleanup(input: {
  readonly prisma: PrismaClient;
  readonly namespaceId: string;
  readonly targetActionRef: string;
  readonly gateway: WorkflowSetupGatewayPort;
}): Promise<WorkflowSetupGatewayPort> {
  const binding = await readConfirmedMigrationCandidate(input);
  if (!binding) return input.gateway;
  if (binding.targetActionRef !== input.targetActionRef) {
    throw new Error("codex_runtime_migration_recovery_required");
  }
  return {
    createOrUpdateSetupPullRequest: (request) =>
      input.gateway.createOrUpdateSetupPullRequest({
        ...request,
        workflowFiles: [...request.workflowFiles, codexRuntimeMigrationCleanup],
      }),
  };
}

async function readConfirmedMigrationCandidate(input: {
  readonly prisma: PrismaClient;
  readonly namespaceId: string;
}): Promise<CodexRuntimeMigrationBinding | null> {
  const attempt = await input.prisma.codexOAuthSetupDispatchAttempt.findUnique({
    where: { namespaceId: input.namespaceId },
    include: { claim: { include: { manifest: true } } },
  });
  const binding = attempt
    ? codexRotatingSetupManifestSchema.parse(
        attempt.claim.manifest.manifestJson,
      ).runtimeMigration
    : undefined;
  if (!binding) return null;
  if (
    attempt!.status !== "confirmed" ||
    attempt!.claim.status !== "confirmed_candidate"
  ) {
    throw new Error("codex_runtime_migration_recovery_required");
  }
  return binding;
}

function migrationNotice(
  input: { readonly repositoryFullName: string; readonly workspaceId: string },
  notice: string,
) {
  return {
    notice,
    repository: input.repositoryFullName,
    workspace: input.workspaceId,
    section: "repositories",
  };
}
