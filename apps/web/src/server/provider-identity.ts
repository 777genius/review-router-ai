import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import {
  providerIdentityForAuthMode,
  type ProviderIdentity,
} from "../features/provider-setup/provider-identity";
import { subscriptionProfileProviders } from "./account-connection-catalog";
import { accountGatewayProfilesConfiguration } from "./account-gateway-accounts";

/** Resolve saved display identity from the same trusted deployment catalog.
 * This neither discovers credentials nor authorizes a binding or a model.
 */
export function savedProviderIdentity(input: {
  authMode: ProviderAuthMode;
  gatewayProfileRef?: string | null | undefined;
}): ProviderIdentity | undefined {
  if (input.authMode !== "codex_account_gateway")
    return providerIdentityForAuthMode(input.authMode);
  const ref = input.gatewayProfileRef;
  if (!ref) return undefined;
  if (ref === "openai-codex-oauth-responses-v1") return "openai";
  if (ref === "anthropic-claude-oauth-messages-v1") return "anthropic";
  if (Object.hasOwn(subscriptionProfileProviders, ref))
    return subscriptionProfileProviders[
      ref as keyof typeof subscriptionProfileProviders
    ];
  try {
    const provider =
      accountGatewayProfilesConfiguration().apiKeyProfiles.get(ref);
    return provider === "MiMo"
      ? "mimo"
      : provider === "OpenRouter"
        ? "openrouter"
        : undefined;
  } catch {
    // An unavailable/retired catalog cannot justify guessing from a label/model.
    return undefined;
  }
}
