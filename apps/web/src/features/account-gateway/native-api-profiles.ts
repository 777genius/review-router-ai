/** Product-qualified native profiles. Provider transport and models remain native-owned. */
export const directNativeAPIProfiles = {
  "anthropic-messages-apikey-v1": "anthropic",
  "gemini-openai-chat-apikey-v1": "gemini",
} as const;
export function nativeAPIProvider(profileId: string) {
  return Object.hasOwn(directNativeAPIProfiles, profileId)
    ? directNativeAPIProfiles[profileId as keyof typeof directNativeAPIProfiles]
    : undefined;
}
