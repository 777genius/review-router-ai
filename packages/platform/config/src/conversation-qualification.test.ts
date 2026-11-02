import { expect, it } from "vitest";
import {
  qualifiedGatewayInteractionRuntimeSha,
  readConversationQualification,
  conversationCapabilityAppliesToScope,
} from "./conversation-qualification.js";
import { conversationCapabilityFixture } from "./tests/conversation-qualification-fixture.js";
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
  { ...proof, sourceProcessingProfile: "transient-checked-inline-gateway-v2" },
])(
  "rejects unqualified deployment input without adding an account or model fallback",
  (value) => {
    expect(() => readConversationQualification(JSON.stringify(value))).toThrow(
      "conversation_qualification_invalid",
    );
  },
);
it("retains the exact qualified extraction mechanism rather than upgrading historical native evidence", () => {
  expect(
    readConversationQualification(JSON.stringify(proof))
      ?.sourceProcessingProfile,
  ).toBe("transient-checked-inline-v1");
  expect(
    readConversationQualification(
      JSON.stringify({
        ...proof,
        sourceProcessingProfile: "transient-checked-inline-gateway-v1",
      }),
    )?.sourceProcessingProfile,
  ).toBe("transient-checked-inline-gateway-v1");
  expect(
    readConversationQualification(
      JSON.stringify({
        ...proof,
        sourceProcessingProfile:
          "transient-checked-inline-gateway-full-thread-v1",
      }),
    )?.sourceProcessingProfile,
  ).toBe("transient-checked-inline-gateway-full-thread-v1");
});

it("applies explicit v2 mechanism evidence to new product scopes without granting their authority", () => {
  const capability = readConversationQualification(
    JSON.stringify(conversationCapabilityFixture()),
  )!;
  expect(capability).not.toHaveProperty("repositories");
  for (const scope of [
    { workspaceId: "new-workspace", repositoryId: "new-repository" },
    { workspaceId: "another-workspace", repositoryId: "another-repository" },
  ]) {
    expect(conversationCapabilityAppliesToScope(capability, scope)).toBe(true);
    expect(
      qualifiedGatewayInteractionRuntimeSha(
        {
          REVIEW_ROUTER_CONVERSATION_QUALIFICATION: JSON.stringify(capability),
          REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA: runtimeSha,
        },
        scope,
      ),
    ).toBe(runtimeSha);
  }
  expect(
    conversationCapabilityAppliesToScope(capability, {
      workspaceId: "",
      repositoryId: "new-repository",
    }),
  ).toBe(false);
  expect(
    conversationCapabilityAppliesToScope(null, {
      workspaceId: "new-workspace",
      repositoryId: "new-repository",
    }),
  ).toBe(false);
  expect(
    qualifiedGatewayInteractionRuntimeSha(
      {
        REVIEW_ROUTER_CONVERSATION_QUALIFICATION: JSON.stringify(capability),
        REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA: "b".repeat(40),
      },
      { workspaceId: "new-workspace", repositoryId: "new-repository" },
    ),
  ).toBeUndefined();
});

const capability = conversationCapabilityFixture();
it.each([
  { ...proof, repositories: undefined },
  { ...proof, repositories: [] },
  { ...proof, coverage: "normal-current-product-admission" },
  { ...capability, profileVersion: 1 },
  { ...capability, coverage: undefined },
  { ...capability, coverage: "all" },
  { ...capability, repositories: [] },
  { ...capability, repositories: "*" },
  { ...capability, sourceProcessingProfile: "transient-checked-inline-v1" },
  {
    ...capability,
    sourceProcessingProfile: "transient-checked-inline-gateway-v1",
  },
  { ...capability, sourceProfile: undefined },
  {
    ...capability,
    sourceProfile: {
      ...capability.sourceProfile,
      accountPolicySourceDigest: undefined,
    },
  },
  {
    ...capability,
    sourceProfile: {
      ...capability.sourceProfile,
      accountPolicySourceDigest: "main",
    },
  },
  {
    ...capability,
    sourceProfile: {
      ...capability.sourceProfile,
      arbitrarySource: "a".repeat(64),
    },
  },
  { ...capability, models: [] },
  { ...capability, accountRef: "other-user-account" },
  { ...capability, runtimeSha: "main" },
])(
  "rejects mixed, missing or unqualified mechanism declarations: %j",
  (input) => {
    expect(() => readConversationQualification(JSON.stringify(input))).toThrow(
      "conversation_qualification_invalid",
    );
  },
);
