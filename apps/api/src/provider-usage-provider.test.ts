import { describe, expect, it } from "vitest";
import { providerUsageConfiguredProvider } from "./provider-usage-provider";

describe("configured Usage provider identity", () => {
  it.each([
    ["openrouter-openai-responses-apikey-v1", "openrouter"],
    ["openai-codex-oauth-responses-v1", "codex"],
    ["nvidia-build-chat-apikey-v1", "nvidia"],
    // The SDK names the vendor; the native_catalog source only owns the list.
    ["glm-coding-global-responses-apikey-v1", "glm"],
    ["minimax-mplan-global-responses-apikey-v1", "minimax"],
    ["kimi-code-global-responses-apikey-v1", "kimi"],
    ["grok-subscription-responses-oauth-v1", "grok"],
    ["anthropic-claude-oauth-messages-v1", "claude"],
    ["openai-responses-apikey-v1", "mimo"],
    ["unqualified-profile", "unknown"],
    [undefined, "unknown"],
  ])(
    "uses qualified Gateway profile %s, independently of the model",
    (profile, provider) => {
      expect(
        providerUsageConfiguredProvider({
          kind: "codex",
          authMode: "codex_account_gateway",
          gatewayProfileRef: profile,
          model: "nvidia/nemotron-3-ultra-550b-a55b:free",
        }),
      ).toEqual({
        provider,
        requestedModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
      });
    },
  );

  it("keeps direct provider identity and its existing free alias", () => {
    expect(
      providerUsageConfiguredProvider({
        kind: "openrouter",
        authMode: "openrouter_api_key",
        gatewayProfileRef: "openai-codex-oauth-responses-v1",
        model: "free",
      }),
    ).toEqual({ provider: "openrouter", requestedModel: "openrouter/free" });
    expect(
      providerUsageConfiguredProvider({ kind: "codex-mimo", model: "model" }),
    ).toEqual({ provider: "mimo", requestedModel: "model" });
  });
});
