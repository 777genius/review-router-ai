import { App } from "@octokit/app";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { PostgresLeaseLock } from "@reviewrouter/platform-locks";
import {
  assertWorkspaceFeatureEntitlement,
  PrismaEntitlementRepository,
} from "@reviewrouter/features-entitlements";
import {
  createGithubHostedPoolActionCatalog,
  readGitHubAppPrivateKey,
  resolveHostedPoolActionReleaseForProvision,
  resolveReviewRouterCodexRotatingTrustedActionRefs,
  resolveReviewRouterPublicApiUrl,
  type HostedPoolPublicActionCatalog,
} from "@reviewrouter/platform-config";
import {
  activateConfirmedHostedPoolBindingAfterWorkflowMerge,
  switchRepositoryConfigurationAuthMode,
} from "@reviewrouter/features-workflow-provisioning";
import { createHostedPoolOperatorConnect } from "./hosted-pool-operator-connect.js";
import type { HostedPoolOperatorConnect } from "./hosted-pool-operator-composition.js";
import {
  readHostedPoolOperatorScope,
  prismaHostedPoolOperatorMembership,
} from "./hosted-pool-operator-authorization.js";
import { hasMatchingHostedPoolWorkflow } from "./hosted-pool-workflow-readiness.js";

/** Production composition is lazy: status/account operations do not initialize GitHub. */
export function createDefaultHostedPoolOperatorConnect(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly actionReleaseCatalog?: HostedPoolPublicActionCatalog;
}): HostedPoolOperatorConnect {
  return async (command) => {
    const scope = readHostedPoolOperatorScope(input.env);
    if (
      !scope ||
      !scope.workspaceIds.includes(command.workspaceId) ||
      command.operatorId !== scope.operatorId
    )
      throw new Error("hosted_pool_operator_forbidden");
    const membership = prismaHostedPoolOperatorMembership(input.prisma);
    const authorize = async (workspaceId: string) => {
      if (!(await membership.isCurrentAdmin(scope, workspaceId)))
        throw new Error("hosted_pool_operator_forbidden");
      await assertWorkspaceFeatureEntitlement(
        { workspaceId, actor: scope.operatorId, feature: "hosted_codex_pool" },
        { entitlements: new PrismaEntitlementRepository(input.prisma) },
      );
    };
    await authorize(command.workspaceId);
    const appId = input.env.GITHUB_APP_ID?.trim();
    const privateKey = readGitHubAppPrivateKey(input.env);
    if (!appId || !privateKey)
      throw new Error("hosted_pool_github_app_not_configured");
    const app = new App({ appId, privateKey });
    const githubToken =
      input.env.GITHUB_TOKEN?.trim() || input.env.GH_TOKEN?.trim();
    const actionRef = (
      await resolveHostedPoolActionReleaseForProvision(
        input.env,
        input.actionReleaseCatalog ??
          createGithubHostedPoolActionCatalog(
            githubToken ? { token: githubToken } : {},
          ),
      )
    ).actionRef;
    const apiUrl = resolveReviewRouterPublicApiUrl(input.env);
    if (!apiUrl) throw new Error("hosted_pool_api_url_not_configured");
    const connect = createHostedPoolOperatorConnect({
      prisma: input.prisma,
      actionRef,
      trustedPriorActionRefs: resolveReviewRouterCodexRotatingTrustedActionRefs(
        input.env,
      ),
      apiUrl,
      authorize,
      lock: new PostgresLeaseLock(input.prisma),
      installationOctokit: async (value) => {
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id < 1)
          throw new Error("hosted_pool_installation_id_invalid");
        return app.getInstallationOctokit(id);
      },
      activateExact: async ({ repository, octokit, binding }) => {
        // Absence or an older workflow needs a setup PR, never an active-state shortcut.
        if (
          !(await hasMatchingHostedPoolWorkflow({
            repository,
            octokit,
            binding,
            actionRef,
            apiUrl,
          }))
        )
          return "pending";
        let result;
        try {
          result = await activateConfirmedHostedPoolBindingAfterWorkflowMerge({
            prisma: input.prisma,
            octokit,
            workspaceId: repository.workspaceId,
            repositoryId: repository.id,
            installationId: repository.installationId,
            githubRepositoryId: repository.githubRepositoryId,
            owner: repository.owner,
            name: repository.name,
            defaultBranch: repository.defaultBranch,
            expectedRepositoryFullName: repository.fullName,
            expectedApiUrl: apiUrl,
            now: new Date(),
            trustedActionRefs:
              resolveReviewRouterCodexRotatingTrustedActionRefs(input.env),
            switchConfiguration: switchRepositoryConfigurationAuthMode,
            expectedBinding: {
              id: binding.bindingId,
              revision: BigInt(binding.revision),
              stateVersion: BigInt(binding.stateVersion),
              status: binding.status,
            },
            beforeActivation: () => authorize(command.workspaceId),
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "hosted_workflow_stored_attestation_mismatch"
          )
            return "pending";
          throw error;
        }
        return result.status === "not_configured" ? "pending" : "active";
      },
    });
    return connect(command);
  };
}
