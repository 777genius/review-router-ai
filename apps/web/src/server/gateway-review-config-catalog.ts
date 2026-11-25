import type {
  ReviewConfiguration,
  ReviewProviderConfiguration,
} from "@reviewrouter/features-review-config";
import type { AccountProfileView } from "./account-gateway-accounts";
import { reviewAgentProfileAgenticContextSaveIssue } from "@reviewrouter/features-review-config/review-configuration";
import type { ReviewAgentProfile } from "@reviewrouter/features-review-run-control";
import { gatewayModelSupportsReasoningEffort } from "../features/account-gateway/review-reasoning-capabilities";

export type GatewaySelection = Extract<
  ReviewProviderConfiguration,
  { authMode: "codex_account_gateway" }
>;

/** Apply known engine capabilities after authorization, before either policy write.
 * Unknown saved refs remain readable/preservable; admission resolves them exactly.
 */
export function assertGatewayReviewAgentProfileContextAllowed(
  config: Pick<ReviewConfiguration, "providers">,
  loadProfiles: () => readonly Pick<
    ReviewAgentProfile,
    "profileRef" | "agentKind"
  >[],
): void {
  const selections = config.providers.filter(
    (provider) =>
      provider.authMode === "codex_account_gateway" &&
      provider.agentProfileRef !== undefined,
  );
  if (selections.length === 0) return;
  const profiles = loadProfiles();
  for (const provider of selections) {
    if (
      provider.authMode !== "codex_account_gateway" ||
      provider.agentProfileRef === undefined
    )
      continue;
    const matches = profiles.filter(
      (candidate) => candidate.profileRef === provider.agentProfileRef,
    );
    for (const profile of matches) {
      const issue = reviewAgentProfileAgenticContextSaveIssue(
        {
          agentProfileRef: provider.agentProfileRef,
          agenticContext: provider.agenticContext,
        },
        profile.agentKind,
      );
      if (issue !== null) throw new Error(issue);
    }
  }
}

export function isGatewayReviewModelSupported(
  selection: GatewaySelection,
  profiles: readonly AccountProfileView[],
): boolean {
  return profiles.some(
    (profile) =>
      profile.id === selection.gatewayProfileRef &&
      profile.availability !== "deployment_configuration_required" &&
      profile.protocol === "openai-responses" &&
      profile.models.includes(selection.model),
  );
}

/** Validate every Gateway row against the current authorized public catalog.
 * Returns whether the caller must refresh authorization after the catalog await.
 * Legacy-only configurations perform no catalog I/O.
 */
export async function assertGatewayReviewConfigCatalogAllowed(
  config: Pick<ReviewConfiguration, "providers">,
  loadProfiles: (
    selection: GatewaySelection,
  ) => Promise<readonly AccountProfileView[]>,
): Promise<boolean> {
  const selections = config.providers.filter(isGatewaySelection);
  if (selections.length === 0) return false;
  // Resolve each exact binding independently, even when profile IDs coincide.
  for (const selection of selections)
    assertGatewayReviewConfigSupported(
      { providers: [selection] },
      await loadProfiles(selection),
    );
  return true;
}

/**
 * The catalog rules of `assertGatewayReviewConfigCatalogAllowed` against an
 * already loaded catalog, without I/O, for checks that run inside a write.
 */
export function assertGatewayReviewConfigSupported(
  config: Pick<ReviewConfiguration, "providers">,
  profiles: readonly AccountProfileView[],
): void {
  const selections = config.providers.filter(isGatewaySelection);
  if (selections.length === 0) return;
  if (selections.some((row) => !isGatewayReviewModelSupported(row, profiles)))
    throw new Error("gateway_review_model_unsupported");
  if (
    selections.some(
      (row) =>
        !gatewayModelSupportsReasoningEffort(
          row.model,
          row.reasoningEffort,
          profiles.find((profile) => profile.id === row.gatewayProfileRef)
            ?.connection,
          row.gatewayProfileRef,
        ),
    )
  )
    throw new Error("gateway_review_reasoning_effort_unsupported");
  if (
    selections.some((row) => {
      const connection = profiles.find(
        (profile) => profile.id === row.gatewayProfileRef,
      )?.connection;
      if (!connection) return false;
      const qualified = connection.modelSettings.find(
        (model) => model.modelId === row.model,
      );
      return row.fastMode && !qualified?.fast?.allowed.includes("fast");
    })
  )
    throw new Error("gateway_review_fast_mode_unsupported");
}

function isGatewaySelection(
  row: ReviewProviderConfiguration,
): row is GatewaySelection {
  return row.authMode === "codex_account_gateway";
}
