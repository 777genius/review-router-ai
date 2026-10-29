// Generated from shared/src/review-model-route-policy.ts. Do not edit.
import type {
  ReviewModelDispatchProfileV2,
  ReviewModelOutputTokenLimit,
  ReviewModelTransport,
  ReviewModelWireProtocol,
  AnthropicModelAlias,
} from "./review-model-dispatch-contract";
import { anthropicModelAliases } from "./review-model-dispatch-contract";

/** The public Gateway keeps its Responses wire even when its qualified native
 * account uses Codex subscription, whose output bound is acceptance-only. */
export const codexOAuthGatewayProfileRef = "openai-codex-oauth-responses-v1";

export function reviewModelWirePolicyForProvider(
  provider: Readonly<{
    authMode: string;
    gatewayProfileRef?: string | undefined;
  }>,
):
  | Readonly<{
      wireProtocol: ReviewModelWireProtocol;
      outputTokenLimit: ReviewModelOutputTokenLimit;
    }>
  | undefined {
  switch (provider.authMode) {
    case "codex_subscription_oauth_rotating":
    case "codex_subscription_oauth_hosted_pool":
      return {
        wireProtocol: "codex-responses",
        outputTokenLimit: "terminal_acceptance",
      };
    case "claude_code_oauth":
      return {
        wireProtocol: "anthropic-messages",
        outputTokenLimit: "upstream_request",
      };
    case "codex_account_gateway":
      return {
        wireProtocol: "openai-responses",
        outputTokenLimit:
          provider.gatewayProfileRef === codexOAuthGatewayProfileRef
            ? "terminal_acceptance"
            : "upstream_request",
      };
    case "openrouter_api_key":
    case "mimo_token_plan_api_key":
    case "kimi_code_api_key":
      return {
        wireProtocol: "openai-responses",
        outputTokenLimit: "upstream_request",
      };
    default:
      return undefined;
  }
}

/** Credential storage never selects an engine. These are the finite existing
 * connection contracts; subscription credentials are not provider API keys. */
export function reviewModelTransportForAuthMode(
  authMode: string,
): ReviewModelTransport | undefined {
  switch (authMode) {
    case "codex_account_gateway":
      return "account_gateway";
    case "codex_subscription_oauth_hosted_pool":
      return "hosted_pool";
    case "claude_code_oauth":
      return "runner_local_anthropic";
    case "codex_subscription_oauth_rotating":
    case "openrouter_api_key":
    case "mimo_token_plan_api_key":
    case "kimi_code_api_key":
      return "runner_local_responses";
    default:
      return undefined;
  }
}

/** Shared by admission and readiness. The exact trusted producer provides an
 * explicit default for each route; retained profiles never compete by name. */
export function selectReviewModelRoutePolicy(
  profile: ReviewModelDispatchProfileV2,
  providers: readonly Readonly<{
    authMode: string;
    model: string;
    gatewayProfileRef?: string | undefined;
  }>[],
):
  | Readonly<{
      transport: ReviewModelTransport;
      wireProtocol: ReviewModelWireProtocol;
      outputTokenLimit: ReviewModelOutputTokenLimit;
      providerIndex: 0;
      model: string;
      configuredModel?: AnthropicModelAlias;
      defaultAgentProfileRef: string;
    }>
  | undefined {
  if (providers.length !== 1) return undefined;
  const provider = providers[0]!;
  const transport = reviewModelTransportForAuthMode(provider.authMode);
  const wire = reviewModelWirePolicyForProvider(provider);
  if (
    !transport ||
    !profile.transports.includes(transport) ||
    !wire ||
    !profile.wireProtocols.includes(wire.wireProtocol)
  )
    return undefined;
  const defaultAgentProfileRef = profile.defaultAgentProfileRefs[transport];
  if (!defaultAgentProfileRef || !provider.model.trim()) return undefined;
  const alias =
    transport === "runner_local_anthropic" &&
    (anthropicModelAliases as readonly string[]).includes(provider.model)
      ? (provider.model as AnthropicModelAlias)
      : undefined;
  const model = alias ? profile.anthropicModelAliases?.[alias] : provider.model;
  if (!model) return undefined;
  return Object.freeze({
    transport,
    ...wire,
    providerIndex: 0,
    model,
    ...(alias ? { configuredModel: alias } : {}),
    defaultAgentProfileRef,
  });
}
