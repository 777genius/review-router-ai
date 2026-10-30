import type { PrismaClient } from "@prisma/client";
import {
  codexRotatingSetupManifestSchema,
  codexRuntimeMigrationAudience,
  codexRuntimeMigrationIdSchema,
  codexRuntimeMigrationReusableWorkflowPath,
  codexRuntimeMigrationWorkflowPath,
  type CodexRuntimeMigrationBinding,
  type CodexRuntimeMigrationExchange,
} from "@reviewrouter/features-provider-setup";
import type {
  GitHubActionsOidcClaims,
  GitHubActionsOidcTokenVerifierPort,
} from "@reviewrouter/features-action-control-plane/oidc";
import { resolveCodexRotatingSetupManifestForNonce } from "./codex-rotating-setup-manifest";
import type { CodexRuntimeMigrationGitHub } from "./codex-runtime-migration-github";

export function assertCodexRuntimeMigrationOidc(input: {
  readonly claims: GitHubActionsOidcClaims;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly binding: CodexRuntimeMigrationBinding;
}): void {
  const { claims, binding } = input;
  const ref = `refs/heads/${binding.defaultBranch}`;
  const targetSha = binding.targetActionRef.split("@")[1]!;
  if (
    claims.repository_id !== input.repositoryId ||
    claims.repository !== input.repositoryFullName ||
    claims.repository_owner !== input.repositoryFullName.split("/")[0] ||
    claims.event_name !== "workflow_dispatch" ||
    claims.ref !== ref ||
    claims.sub !== `repo:${input.repositoryFullName}:ref:${ref}` ||
    claims.workflow_ref !==
      `${input.repositoryFullName}/${codexRuntimeMigrationWorkflowPath}@${ref}` ||
    claims.workflow_sha !== binding.bootstrap.sourceCommitSha ||
    claims.job_workflow_ref !==
      `${codexRuntimeMigrationReusableWorkflowPath}@${targetSha}` ||
    claims.job_workflow_sha !== targetSha ||
    claims.runner_environment !== "github-hosted" ||
    claims.run_attempt !== "1" ||
    !/^[1-9][0-9]*$/u.test(claims.run_id)
  ) {
    throw new Error("codex_runtime_migration_runner_mismatch");
  }
}

export async function exchangeCodexRuntimeMigration(input: {
  readonly prisma: PrismaClient;
  readonly migrationId: string;
  readonly oidcToken: string;
  readonly oidc: GitHubActionsOidcTokenVerifierPort;
  readonly setupBaseUrl: string;
  readonly databaseRecoveryWitness: string;
  readonly runtimeEnvironment: NodeJS.ProcessEnv;
  readonly github: (scope: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly providerInstanceId: string;
  }) => Promise<{
    readonly migration: CodexRuntimeMigrationGitHub;
    readonly publicKey: () => Promise<{
      readonly keyId: string;
      readonly key: string;
    }>;
  }>;
  readonly assertTargetQualified: (input: {
    readonly repositoryId: string;
    readonly workspaceId: string;
    readonly targetActionRef: string;
  }) => Promise<void>;
}): Promise<CodexRuntimeMigrationExchange> {
  const migrationId = codexRuntimeMigrationIdSchema.parse(input.migrationId);
  const claims = await input.oidc.verify({
    token: input.oidcToken,
    audience: codexRuntimeMigrationAudience,
  });
  const row = await input.prisma.codexOAuthSetupManifest.findUnique({
    where: { id: migrationId },
    include: { repository: { include: { installation: true } } },
  });
  if (
    !row ||
    !row.repository.installation ||
    row.repository.installation.status !== "active" ||
    !row.repository.selected ||
    row.repository.archived
  ) {
    throw new Error("codex_runtime_migration_unavailable");
  }
  const manifest = codexRotatingSetupManifestSchema.parse(row.manifestJson);
  const binding = manifest.runtimeMigration;
  if (
    !binding ||
    binding.migrationId !== row.id ||
    row.setupNonce !== manifest.setupNonce
  ) {
    throw new Error("codex_runtime_migration_unavailable");
  }
  assertCodexRuntimeMigrationOidc({
    claims,
    repositoryId: manifest.repositoryId,
    repositoryFullName: manifest.repositoryFullName,
    binding,
  });
  await input.assertTargetQualified({
    repositoryId: row.repositoryId,
    workspaceId: row.workspaceId,
    targetActionRef: binding.targetActionRef,
  });
  const github = await input.github({
    githubInstallationId:
      row.repository.installation.githubInstallationId.toString(),
    githubRepositoryId: manifest.repositoryId,
    repositoryFullName: manifest.repositoryFullName,
    providerInstanceId: manifest.providerInstanceId,
  });
  const githubPublicKey = await github.publicKey();
  const resolved = await resolveCodexRotatingSetupManifestForNonce({
    prisma: input.prisma,
    setupNonce: row.setupNonce,
    databaseRecoveryWitness: input.databaseRecoveryWitness,
    runtimeEnvironment: input.runtimeEnvironment,
    authorizeRuntimeMigration: async (_tx, lockedManifest) => {
      if (JSON.stringify(lockedManifest) !== JSON.stringify(manifest)) {
        throw new Error("codex_runtime_migration_source_changed");
      }
      await github.migration.assertRunner(
        binding,
        claims.run_id,
        claims.run_attempt,
      );
    },
  });
  const url = (suffix: string) =>
    new URL(`/api/codex-rotating/${suffix}`, input.setupBaseUrl).toString();
  return {
    version: 1,
    migrationId,
    ...resolved,
    githubPublicKey,
    setup: {
      prepareUrl: url("setup-prepare"),
      dispatchUrl: url("setup-dispatch"),
      dispatchOutcomeUrl: url("setup-dispatch-outcome"),
      statusUrl: url("setup-status"),
    },
  };
}
