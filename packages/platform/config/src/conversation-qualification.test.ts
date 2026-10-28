import { expect, it } from "vitest";
import {
  qualifiedGatewayInteractionRuntimeSha,
  readConversationQualification,
} from "./conversation-qualification.js";
const runtimeSha = "a".repeat(40);
const proof = {
  profileVersion: 1,
  proofId: "qualified-disposable-proof",
  sourceProcessingProfile: "transient-checked-inline-v1",
  runtimeSha,
  repositories: [{ workspaceId: "workspace", repositoryId: "repository" }],
  models: [
    {
      profileId: "openai-codex-oauth-responses-v1",
      model: "gpt-6.1-sol",
      contextWindowTokens: 128000,
      tokensPerByteUpperBound: 1,
    },
  ],
};
it("requires both the qualified repository scope and the exact available interaction runtime", () => {
  const env = {
    REVIEW_ROUTER_CONVERSATION_QUALIFICATION: JSON.stringify(proof),
    REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA: runtimeSha,
  };
  expect(
    qualifiedGatewayInteractionRuntimeSha(env, proof.repositories[0]!),
  ).toBe(runtimeSha);
  expect(
    qualifiedGatewayInteractionRuntimeSha(env, {
      workspaceId: "adjacent-workspace",
      repositoryId: "repository",
    }),
  ).toBeUndefined();
  expect(
    qualifiedGatewayInteractionRuntimeSha(
      { ...env, REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA: "b".repeat(40) },
      proof.repositories[0]!,
    ),
  ).toBeUndefined();
  expect(readConversationQualification(undefined)).toBeNull();
});
it.each([
  { ...proof, runtimeSha: "main" },
  { ...proof, arbitraryAccount: "untrusted" },
  { ...proof, models: [{ ...proof.models[0], tokensPerByteUpperBound: 0.2 }] },
])(
  "rejects unqualified deployment input without adding an account or model fallback",
  (value) => {
    expect(() => readConversationQualification(JSON.stringify(value))).toThrow(
      "conversation_qualification_invalid",
    );
  },
);
