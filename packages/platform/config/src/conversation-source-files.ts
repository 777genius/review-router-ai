/** Exact implementation inputs for the full-thread Gateway mechanism. */
export const conversationSourceFiles = {
  commonPromptSourceDigest:
    "packages/features/conversations/src/application/process-conversation.ts",
  gatewayPreviewSourceDigest:
    "apps/api/src/action-conversation-memory-preview.ts",
  accountPolicySourceDigest: "apps/api/src/action-conversation-policy.ts",
  gatewaySdkProvenanceDigest: "vendor/account-gateway/nvidia-sandbox-sdk-provenance.json",
} as const;
