import {
  isOpenRouterDirectConfiguration,
  type EffectiveReviewConfigurationValidatorPort,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import { isCodexRotatingOAuthAllowedForRepository } from "@reviewrouter/platform-config";
import { assertDashboardContextSelectionAllowed } from "./context-tools";
import { loadApprovedGatewayAgentProfiles } from "./gateway-agent-profile-options";
import {
  assertGatewayReviewAgentProfileContextAllowed,
  assertGatewayReviewConfigCatalogAllowed,
} from "./gateway-review-config-catalog";

export type DashboardValidatedRepository = Readonly<{
  fullName: string;
  visibility: string;
}>;

/**
 * The dashboard's save-time checks of one effective configuration: context
 * tool selection, the OpenRouter direct route, engine profiles, rotating
 * availability and the Gateway catalog. Shared by every dashboard write of a
 * provider selection and run before the write transaction; the write then
 * refuses any other effective result than the validated one. Reports whether
 * the network Gateway catalog was consulted, so the caller rechecks its actor.
 */
export async function validateDashboardEffectiveConfiguration(input: {
  readonly workspaceId: string;
  /** Null validates the workspace default. */
  readonly repository: DashboardValidatedRepository | null;
  readonly config: ReviewConfiguration;
}): Promise<Readonly<{ gatewayCatalogChecked: boolean }>> {
  await assertDashboardContextSelectionAllowed(
    input.workspaceId,
    input.config.contextTools,
  );
  isOpenRouterDirectConfiguration(input.config);
  assertGatewayReviewAgentProfileContextAllowed(
    input.config,
    loadApprovedGatewayAgentProfiles,
  );
  assertCodexRotatingReviewConfigAllowed({
    config: input.config,
    repository: input.repository,
  });
  return {
    gatewayCatalogChecked: await assertGatewayReviewConfigCatalogAllowed(
      input.config,
      () => loadGatewayReviewProfiles(input.workspaceId),
    ),
  };
}

/**
 * The dashboard checks as the validator of the selection use cases. When the
 * network Gateway catalog was consulted, `afterGatewayCatalogCheck` runs
 * before the write so the caller can confirm its actor is unchanged.
 */
export function dashboardSelectionValidator(input: {
  readonly workspaceId: string;
  readonly repositories: ReadonlyMap<string, DashboardValidatedRepository>;
  readonly afterGatewayCatalogCheck?: (
    target: Parameters<
      EffectiveReviewConfigurationValidatorPort["validate"]
    >[0]["target"],
  ) => Promise<void>;
}): EffectiveReviewConfigurationValidatorPort {
  return {
    async validate({ target, config }) {
      const repository =
        target.scope === "repository"
          ? input.repositories.get(target.repositoryId)
          : null;
      if (repository === undefined) throw new Error("repository_not_found");
      const { gatewayCatalogChecked } =
        await validateDashboardEffectiveConfiguration({
          workspaceId: input.workspaceId,
          repository,
          config,
        });
      if (gatewayCatalogChecked) await input.afterGatewayCatalogCheck?.(target);
    },
  };
}

/**
 * Rotating Codex belongs to one repository and is never a workspace default;
 * a repository may use it only where the deployment enables it.
 */
export function assertCodexRotatingReviewConfigAllowed(input: {
  readonly config: ReviewConfiguration;
  readonly repository: DashboardValidatedRepository | null;
}): void {
  const rotatingProviders = input.config.providers.filter(
    (provider) => provider.authMode === "codex_subscription_oauth_rotating",
  );
  if (rotatingProviders.length === 0) return;
  if (!input.repository)
    throw new Error("codex_rotating_repository_scope_required");
  assertCodexRotatingOAuthRepositoryAllowed({
    repositoryFullName: input.repository.fullName,
  });
  if (
    rotatingProviders.length !== 1 ||
    rotatingProviders[0]?.kind !== "codex"
  ) {
    throw new Error("codex_rotating_single_provider_required");
  }
}

export function assertCodexRotatingOAuthRepositoryAllowed(input: {
  readonly repositoryFullName: string;
}): void {
  if (!isCodexRotatingOAuthAllowedForRepository(input.repositoryFullName)) {
    throw new Error("codex_rotating_not_enabled");
  }
}

async function loadGatewayReviewProfiles(workspaceId: string) {
  const { productionPersonalAccounts } =
    await import("./personal-account-composition");
  const personal = await productionPersonalAccounts();
  if (personal) {
    const allowed = await personal
      .workspaceAccess(workspaceId)
      .catch(() => null);
    if (allowed) {
      return personal.reviewProfiles(workspaceId);
    }
  }
  const { loadAccountsBootstrap } = await import("./account-gateway-accounts");
  const { page } = await loadAccountsBootstrap(workspaceId);
  if (page.status === "denied") throw new Error("gateway_review_config_denied");
  if (page.status !== "ok")
    throw new Error("gateway_review_catalog_unavailable");
  return page.value.profiles;
}
