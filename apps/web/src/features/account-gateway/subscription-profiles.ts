/** Fixed qualified profiles shared by enrollment projection and provider setup. */
const subscriptionProfiles = {
  "kimi-code-global-responses-apikey-v1": {
    provider: "kimi",
    authKind: "api_key",
  },
  "glm-coding-global-responses-apikey-v1": {
    provider: "glm",
    authKind: "api_key",
  },
  "minimax-mplan-global-responses-apikey-v1": {
    provider: "minimax",
    authKind: "api_key",
  },
  "grok-subscription-responses-oauth-v1": {
    provider: "grok",
    authKind: "oauth",
  },
} as const;

type SubscriptionProfileId = keyof typeof subscriptionProfiles;

export const subscriptionProfileProviders = Object.fromEntries(
  Object.entries(subscriptionProfiles).map(([id, profile]) => [
    id,
    profile.provider,
  ]),
) as {
  readonly [Id in SubscriptionProfileId]: (typeof subscriptionProfiles)[Id]["provider"];
};

export function subscriptionProfileDefinition(profileId: string) {
  return Object.hasOwn(subscriptionProfiles, profileId)
    ? subscriptionProfiles[profileId as SubscriptionProfileId]
    : undefined;
}
