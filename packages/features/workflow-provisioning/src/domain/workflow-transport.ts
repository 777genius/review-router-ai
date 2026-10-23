import { codexRotatingAuthMode } from "@reviewrouter/features-codex-oauth-rotating";
import {
  isOpenRouterDirectConfiguration,
  parseReviewConfigurationStrict,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import { hostedPoolSessionMode } from "./hosted-pool-workflow-template";

/** How a repository workflow receives the credentials of its provider. */
export type WorkflowTransport =
  | "gateway"
  | "provider_api"
  | "rotating"
  | "hosted_pool"
  | "ci_secrets";

/**
 * The transport an effective configuration needs. Gateway and provider-API
 * workflows share one path, rotating and hosted pool share another, so the
 * transport is never derived from a workflow path. A transport that owns the
 * whole review (Gateway, provider API) refuses any other provider row.
 */
export function requiredWorkflowTransport(
  config: ReviewConfiguration,
): WorkflowTransport {
  if (
    config.providers.some(
      (provider) => provider.authMode === "codex_account_gateway",
    )
  ) {
    const parsed = parseReviewConfigurationStrict(config);
    if (
      parsed.providers.length !== 1 ||
      parsed.providers[0]?.authMode !== "codex_account_gateway"
    ) {
      throw new Error("account_gateway_single_provider_required");
    }
    return "gateway";
  }
  if (isOpenRouterDirectConfiguration(config)) return "provider_api";
  if (
    config.providers.some(
      (provider) => provider.authMode === codexRotatingAuthMode,
    )
  ) {
    return "rotating";
  }
  if (
    config.providers.some(
      (provider) => provider.authMode === hostedPoolSessionMode,
    )
  ) {
    return "hosted_pool";
  }
  return "ci_secrets";
}
