import { describe, expect, it } from "vitest";
import {
  gatewaySetupProvidersForProfiles,
  getSetupProvider,
  setupProviderForDirectAuthMode,
  setupProviderForGatewayProfile,
  setupProviderForSource,
  setupProviders,
} from "./setup-provider";
import type { AccountProfileView } from "../../server/account-gateway-accounts";

function profile(
  input: Partial<AccountProfileView> & Pick<AccountProfileView, "id">,
): AccountProfileView {
  return {
    label: "Editable display name",
    protocol: "openai-responses",
    models: ["display-model"],
    ...input,
  };
}

const codex = profile({
  id: "openai-codex-oauth-responses-v1",
  provider: "codex",
  authKind: "oauth",
});
const claude = profile({
  id: "anthropic-claude-oauth-messages-v1",
  provider: "claude",
  protocol: "openai-responses",
  authKind: "oauth",
});

describe("provider setup registry", () => {
  it("names every provider independently of credential storage", () => {
    expect(
      setupProviders.map((provider) => [provider.id, provider.label]),
    ).toEqual([
      ["codex", "Codex"],
      ["claude-code", "Claude Code"],
      ["openrouter", "OpenRouter"],
      ["mimo", "MiMo Token Plan"],
      ["kimi", "Kimi Code"],
      ["glm", "GLM Coding Plan"],
      ["minimax", "MiniMax M Plan"],
      ["grok", "Grok"],
    ]);
    expect(getSetupProvider("codex").githubSource).toBe("repository_rotating");
    expect(getSetupProvider("claude-code").githubSource).toBe(
      "user_ci_secret:claude_code_oauth",
    );
  });

  it.each([
    ["repository_rotating", "codex"],
    ["user_ci_secret:claude_code_oauth", "claude-code"],
    ["user_ci_secret:openrouter_api_key", "openrouter"],
    ["managed_api_key:openrouter_api_key", "openrouter"],
    ["user_ci_secret:mimo_token_plan_api_key", "mimo"],
    ["managed_api_key:mimo_token_plan_api_key", "mimo"],
    ["user_ci_secret:kimi_code_api_key", "kimi"],
    ["gateway_binding", undefined],
  ] as const)(
    "maps source %s without guessing a Gateway vendor",
    (key, expected) => {
      expect(setupProviderForSource({ key })).toBe(expected);
    },
  );

  it("keeps hosted and removed legacy auth out of the GitHub source mapping", () => {
    expect(
      setupProviderForDirectAuthMode("codex_subscription_oauth_hosted_pool"),
    ).toBeUndefined();
    expect(
      setupProviderForDirectAuthMode("codex_account_gateway"),
    ).toBeUndefined();
    expect(
      setupProviderForDirectAuthMode("codex_subscription_oauth_rotating"),
    ).toBe("codex");
    expect(setupProviderForDirectAuthMode("claude_code_oauth")).toBe(
      "claude-code",
    );
  });

  it("advertises Codex and Claude enrollment before any accounts exist", () => {
    expect(gatewaySetupProvidersForProfiles([codex, claude])).toEqual([
      "codex",
      "claude-code",
    ]);
  });

  it.each([
    ["glm", "glm-coding-global-responses-apikey-v1", "api_key"],
    ["minimax", "minimax-mplan-global-responses-apikey-v1", "api_key"],
    ["grok", "grok-subscription-responses-oauth-v1", "oauth"],
  ] as const)(
    "preserves the admitted %s Gateway provider without inventing a GitHub runtime",
    (provider, profileId, authKind) => {
      const connected = profile({
        id: profileId,
        provider: "codex",
        authKind,
        connection: {
          provider,
          planLabel: "Subscription",
          regionLabel: "Global",
          completionInputKind:
            authKind === "oauth" ? "authorization_code" : "none",
          personalOnly: false,
          limitsContract: "account-limits/v2",
          modelSettings: [],
        },
      });
      expect(setupProviderForGatewayProfile(connected)).toBe(provider);
      expect(gatewaySetupProvidersForProfiles([connected])).toEqual([provider]);
      expect(getSetupProvider(provider).githubSource).toBeNull();
      expect(getSetupProvider(provider).publicCatalogProvider).toBeNull();
      expect(
        setupProviderForGatewayProfile({
          ...connected,
          id: "unqualified-profile",
        }),
      ).toBeUndefined();
      expect(
        setupProviderForGatewayProfile({
          ...connected,
          authKind: authKind === "oauth" ? "api_key" : "oauth",
        }),
      ).toBeUndefined();
      expect(
        gatewaySetupProvidersForProfiles([
          { ...connected, availability: "deployment_configuration_required" },
        ]),
      ).toEqual([]);
    },
  );

  it("uses the authenticated deployment availability and deduplicates profiles", () => {
    expect(
      gatewaySetupProvidersForProfiles([
        codex,
        codex,
        { ...claude, availability: "deployment_configuration_required" },
        profile({
          id: "openrouter-fixed",
          provider: "openrouter",
          authKind: "api_key",
        }),
      ]),
    ).toEqual(["codex", "openrouter"]);
    expect(gatewaySetupProvidersForProfiles([])).toEqual([]);
  });

  it("rejects unknown subscription profiles and mismatched auth or vendor metadata", () => {
    expect(setupProviderForGatewayProfile(undefined)).toBeUndefined();
    expect(
      setupProviderForGatewayProfile({
        ...codex,
        id: "unqualified-openai-oauth",
      }),
    ).toBeUndefined();
    expect(
      setupProviderForGatewayProfile({
        ...claude,
        id: "unqualified-anthropic-oauth",
      }),
    ).toBeUndefined();
    expect(
      setupProviderForGatewayProfile({ ...codex, authKind: "api_key" }),
    ).toBeUndefined();
    const claudeWithoutAuth = { ...claude };
    delete claudeWithoutAuth.authKind;
    expect(setupProviderForGatewayProfile(claudeWithoutAuth)).toBeUndefined();
    expect(
      setupProviderForGatewayProfile({ ...claude, provider: "codex" }),
    ).toBeUndefined();
    expect(
      setupProviderForGatewayProfile({
        ...claude,
        protocol: "anthropic-messages",
      }),
    ).toBeUndefined();
    const conflictingConnection: NonNullable<AccountProfileView["connection"]> =
      {
        provider: "anthropic",
        planLabel: "Untrusted display label",
        regionLabel: "Global",
        completionInputKind: "callback_url",
        personalOnly: false,
        limitsContract: "none",
        modelSettings: [],
      };
    expect(
      setupProviderForGatewayProfile({
        ...codex,
        connection: conflictingConnection,
      }),
    ).toBeUndefined();
  });

  it("maps qualified connection metadata and ignores editable labels or models", () => {
    expect(setupProviderForGatewayProfile(codex)).toBe("codex");
    expect(setupProviderForGatewayProfile(claude)).toBe("claude-code");
    expect(
      setupProviderForGatewayProfile(
        profile({
          id: "another-oauth-profile",
          label: "Codex",
          models: ["gpt-5.6-sol"],
          authKind: "oauth",
        }),
      ),
    ).toBeUndefined();
  });
});
