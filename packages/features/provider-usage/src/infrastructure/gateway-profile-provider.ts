/**
 * Exact historical v1 aliases, frozen at Gateway 44bf7ae0c842. They decode old
 * immutable authorizations only; new profiles carry native context with the run.
 * Updating the live SDK/catalog must never relabel old usage or its pricing.
 */
const legacyProfiles = [
  ["openai-responses-apikey-v1", "mimo", false],
  ["openrouter-openai-responses-apikey-v1", "openrouter", false],
  ["nvidia-build-chat-apikey-v1", "nvidia", false],
  ["openai-codex-oauth-responses-v1", "codex", true],
  ["anthropic-claude-oauth-messages-v1", "claude", true],
  ["kimi-code-global-responses-apikey-v1", "kimi", true],
  ["glm-coding-global-responses-apikey-v1", "glm", true],
  ["minimax-mplan-global-responses-apikey-v1", "minimax", true],
  ["grok-subscription-responses-oauth-v1", "grok", true],
] as const;

export const gatewayProfileUsageProviders = legacyProfiles.map(
  ([profileRef, provider, subscription]) => ({ profileRef, provider, subscription }),
);

/** Compatibility only. Unknown profiles must use their frozen native context. */
export function gatewayProfileUsageProvider(profileRef: string): string | undefined {
  return gatewayProfileUsageProviders.find((profile) => profile.profileRef === profileRef)?.provider;
}

/** Legacy report compatibility; v3 request pricing uses per-execution evidence. */
export const gatewaySubscriptionUsageProviders = legacyProfiles
  .filter(([, , subscription]) => subscription)
  .map(([, provider]) => provider)
  .sort();
