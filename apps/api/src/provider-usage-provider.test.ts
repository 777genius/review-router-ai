import { describe, expect, it } from "vitest";
import { providerUsageConfiguredProvider } from "./provider-usage-provider";

describe("configured Usage provider identity", () => {
  it.each([
    ["openrouter-openai-responses-apikey-v1", "openrouter"],
    ["openai-codex-oauth-responses-v1", "codex"],
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
