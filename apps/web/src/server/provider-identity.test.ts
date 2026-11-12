import { beforeEach, describe, expect, it, vi } from "vitest";
import { savedProviderIdentity } from "./provider-identity";

const { configuration } = vi.hoisted(() => ({ configuration: vi.fn() }));
vi.mock("./account-gateway-accounts", () => ({
  accountGatewayProfilesConfiguration: configuration,
}));

describe("saved provider display identity", () => {
  beforeEach(() => {
    configuration.mockReset();
  });

  it("resolves custom legacy profile IDs from the trusted deployment mapping", () => {
    configuration.mockReturnValue({
      apiKeyProfiles: new Map([
        ["profile-mimo", "MiMo"],
        ["profile-router", "OpenRouter"],
        ["profile-nvidia", "NVIDIA Build"],
      ]),
    });
    expect(
      savedProviderIdentity({
        authMode: "codex_account_gateway",
        gatewayProfileRef: "profile-mimo",
      }),
    ).toBe("mimo");
    expect(
      savedProviderIdentity({
        authMode: "codex_account_gateway",
        gatewayProfileRef: "profile-router",
      }),
    ).toBe("openrouter");
    expect(
      savedProviderIdentity({
        authMode: "codex_account_gateway",
        gatewayProfileRef: "profile-nvidia",
      }),
    ).toBe("nvidia");
    // A model-looking but unconfigured reference cannot supply an identity.
    expect(
      savedProviderIdentity({
        authMode: "codex_account_gateway",
        gatewayProfileRef: "nvidia/nemotron-3.5-super-vl-120b-a12b",
      }),
    ).toBeUndefined();
  });

  it("keeps fixed qualified profile identity available without guessing from a model", () => {
    expect(
      savedProviderIdentity({
        authMode: "codex_account_gateway",
        gatewayProfileRef: "kimi-code-global-responses-apikey-v1",
      }),
    ).toBe("kimi");
    expect(
      savedProviderIdentity({
        authMode: "codex_account_gateway",
        gatewayProfileRef: "anthropic-claude-oauth-messages-v1",
      }),
    ).toBe("anthropic");
    expect(savedProviderIdentity({ authMode: "mimo_token_plan_api_key" })).toBe(
      "mimo",
    );
  });

  it("leaves unknown or unavailable Gateway identity neutral", () => {
    configuration.mockImplementation(() => {
      throw new Error("accounts_unavailable");
    });
    expect(
      savedProviderIdentity({
        authMode: "codex_account_gateway",
        gatewayProfileRef: "looks-like-openai",
      }),
    ).toBeUndefined();
    expect(
      savedProviderIdentity({ authMode: "codex_account_gateway" }),
    ).toBeUndefined();
  });
});
