import type { ConversationQualification } from "../conversation-qualification.js";

/** Synthetic parser/authority input only; never a qualified release artifact. */
export function conversationCapabilityFixture(
  overrides: Partial<
    Extract<ConversationQualification, { profileVersion: 2 }>
  > = {},
): Extract<ConversationQualification, { profileVersion: 2 }> {
  return {
    profileVersion: 2,
    proofId: "synthetic-unit-mechanism-evidence",
    sourceProcessingProfile: "transient-checked-inline-gateway-full-thread-v1",
    runtimeSha: "a".repeat(40),
    coverage: "normal-current-product-admission",
    sourceProfile: {
      commonPromptSourceDigest: "1".repeat(64),
      gatewayPreviewSourceDigest: "2".repeat(64),
      accountPolicySourceDigest: "3".repeat(64),
      gatewaySdkProvenanceDigest: "4".repeat(64),
    },
    models: [
      {
        profileId: "openai-codex-oauth-responses-v1",
        model: "gpt-6.1-sol",
        contextWindowTokens: 128000,
        tokensPerByteUpperBound: 4,
      },
    ],
    ...overrides,
  };
}
