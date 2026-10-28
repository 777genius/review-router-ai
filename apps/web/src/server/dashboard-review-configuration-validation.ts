import {
  isProviderApiDirectConfiguration,
  ProviderProfileError,
  type EffectiveReviewConfigurationValidatorPort,
  type ProviderProfileModelChangeValidator,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import { isCodexRotatingOAuthAllowedForRepository } from "@reviewrouter/platform-config";
import { assertDashboardContextSelectionAllowed } from "./context-tools";
import type {
  AccountProfileView,
  AccountsResult,
  AccountView,
} from "./account-gateway-accounts";
import { loadApprovedGatewayAgentProfiles } from "./gateway-agent-profile-options";
import {
  assertGatewayReviewAgentProfileContextAllowed,
  assertGatewayReviewConfigCatalogAllowed,
  assertGatewayReviewConfigSupported,
  type GatewaySelection,
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
  /** The Gateway catalog; a caller validating many scopes reads it once. */
  readonly loadGatewayProfiles?: (
    selection: GatewaySelection,
  ) => ReturnType<typeof loadGatewayReviewProfiles>;
}): Promise<Readonly<{ gatewayCatalogChecked: boolean }>> {
  await assertDashboardContextSelectionAllowed(
    input.workspaceId,
    input.config.contextTools,
  );
  isProviderApiDirectConfiguration(input.config);
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
      input.loadGatewayProfiles ??
        ((selection) =>
          loadGatewayReviewProfiles(input.workspaceId, selection)),
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
  // Reuse only the same exact binding/profile within this authorized write.
  const catalog = new Map<
    string,
    ReturnType<typeof loadGatewayReviewProfiles>
  >();
  const loadGatewayProfiles = (selection: GatewaySelection) => {
    const key = JSON.stringify([
      selection.gatewayBindingId,
      selection.gatewayProfileRef,
    ]);
    let value = catalog.get(key);
    if (!value) {
      value = loadGatewayReviewProfiles(input.workspaceId, selection);
      catalog.set(key, value);
    }
    return value;
  };
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
          loadGatewayProfiles,
        });
      if (gatewayCatalogChecked) await input.afterGatewayCatalogCheck?.(target);
    },
  };
}

/**
 * The dashboard checks of a provider model edit, which changes every scope
 * using the provider at once. Before the write the Gateway catalog of a
 * connected account must offer the model (network); inside the write each
 * affected scope passes the save-time rules a model can change, without I/O.
 * A scope whose stored settings the model no longer supports is refused as
 * incompatible and named. Context tool selections are not rechecked: a model
 * edit never changes them.
 */
export function dashboardProfileModelChangeValidator(input: {
  readonly workspaceId: string;
  readonly repositories: ReadonlyMap<string, DashboardValidatedRepository>;
  readonly afterGatewayCatalogCheck?: () => Promise<void>;
}): ProviderProfileModelChangeValidator {
  let catalog: Readonly<{
    profileId: string;
    bindingId: string;
    profiles: Awaited<ReturnType<typeof loadGatewayReviewProfiles>>;
  }> | null = null;
  return {
    async beforeTransaction({ profile, model }) {
      const { credential } = profile;
      if (credential.kind !== "gateway_binding") return;
      const profileRef = credential.gatewayProfileRef;
      const profiles = await loadGatewayReviewProfiles(input.workspaceId, {
        gatewayBindingId: credential.bindingId,
        gatewayProfileRef: profileRef,
      });
      const offered = profiles.some(
        (candidate) =>
          candidate.id === profileRef &&
          candidate.availability !== "deployment_configuration_required" &&
          candidate.protocol === "openai-responses" &&
          candidate.models.includes(model),
      );
      if (!offered) throw new Error("gateway_review_model_unsupported");
      await input.afterGatewayCatalogCheck?.();
      catalog = {
        profileId: profile.id,
        bindingId: credential.bindingId,
        profiles,
      };
    },
    scope({ target, config }) {
      isProviderApiDirectConfiguration(config);
      assertGatewayReviewAgentProfileContextAllowed(
        config,
        loadApprovedGatewayAgentProfiles,
      );
      assertCodexRotatingReviewConfigAllowed({
        config,
        repository:
          target.scope === "repository"
            ? (input.repositories.get(target.repositoryId) ?? null)
            : null,
      });
      if (!catalog) return;
      try {
        assertGatewayReviewConfigSupported(
          {
            providers: config.providers.filter(
              (row) =>
                row.authMode === "codex_account_gateway" &&
                row.gatewayBindingId === catalog!.bindingId,
            ),
          },
          catalog.profiles,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "gateway_review_reasoning_effort_unsupported" ||
            error.message === "gateway_review_fast_mode_unsupported")
        )
          throw new ProviderProfileError(
            "provider_profile_model_incompatible",
            {
              profileId: catalog.profileId,
              workspaceDefault: target.scope === "workspace",
              repositoryIds:
                target.scope === "repository" ? [target.repositoryId] : [],
            },
          );
        throw error;
      }
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

/** Model-only profile creation uses the same exact authorized binding catalog. */
export async function assertDashboardGatewayProviderModelAllowed(
  workspaceId: string,
  selection: {
    readonly gatewayBindingId: string;
    readonly gatewayProfileRef?: string;
  },
  model: string,
): Promise<void> {
  const profiles = await loadGatewayReviewProfiles(workspaceId, selection);
  if (
    !profiles.some(
      (profile) =>
        (selection.gatewayProfileRef === undefined ||
          profile.id === selection.gatewayProfileRef) &&
        profile.availability !== "deployment_configuration_required" &&
        profile.protocol === "openai-responses" &&
        profile.models.includes(model),
    )
  )
    throw new Error("gateway_review_model_unsupported");
}

async function loadGatewayReviewProfiles(
  workspaceId: string,
  selection: {
    readonly gatewayBindingId: string;
    readonly gatewayProfileRef?: string;
  },
) {
  const { productionGatewayModelAccounts } =
    await import("./gateway-model-account-composition");
  let result: AccountsResult<{
    account: AccountView;
    profile: AccountProfileView;
  }>;
  try {
    const { reader } = await productionGatewayModelAccounts(workspaceId);
    result = await reader.get(selection.gatewayBindingId);
  } catch {
    throw new Error("gateway_review_catalog_unavailable");
  }
  if (result.status !== "ok")
    throw new Error("gateway_review_catalog_unavailable");
  const { account, profile } = result.value;
  if (
    account.state !== "active" ||
    (selection.gatewayProfileRef !== undefined &&
      account.profileId !== selection.gatewayProfileRef) ||
    account.binding?.id !== selection.gatewayBindingId
  )
    throw new Error("gateway_review_model_unsupported");
  if (
    account.modelCatalog &&
    !["snapshot", "unavailable"].includes(account.modelCatalog.status)
  )
    throw new Error("gateway_review_catalog_unavailable");
  return [profile];
}
