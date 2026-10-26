// Generated from shared/src/review-model-route-policy.ts. Do not edit.
import type {
  ReviewModelDispatchProfileV2,
  ReviewModelTransport,
} from "./review-model-dispatch-contract";

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
  providers: readonly Readonly<{ authMode: string; model: string }>[],
):
  | Readonly<{
      transport: ReviewModelTransport;
      providerIndex: 0;
      model: string;
      defaultAgentProfileRef: string;
    }>
  | undefined {
  if (providers.length !== 1) return undefined;
  const provider = providers[0]!;
  const transport = reviewModelTransportForAuthMode(provider.authMode);
  if (!transport || !profile.transports.includes(transport)) return undefined;
  const defaultAgentProfileRef = profile.defaultAgentProfileRefs[transport];
  if (!defaultAgentProfileRef || !provider.model.trim()) return undefined;
  return Object.freeze({
    transport,
    providerIndex: 0,
    model: provider.model,
    defaultAgentProfileRef,
  });
}
