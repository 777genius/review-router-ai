import { describe, expect, it } from "vitest";
import {
  parseProviderProfileDraft,
  providerCredentialSourceFromStorage,
  providerProfileIdentityKey,
  type ProviderCredentialSource,
} from "../domain/workspace-provider-profile";

const gateway = (
  bindingId: string,
  gatewayProfileRef: string,
): ProviderCredentialSource => ({
  kind: "gateway_binding",
  authMode: "codex_account_gateway",
  bindingId,
  gatewayProfileRef,
});

describe("workspace provider profile identity", () => {
  it("keys by credential source and trimmed model, never by label", () => {
    expect(
      providerProfileIdentityKey(gateway("b1", "p1"), " gpt-5.6-sol "),
    ).toBe("gateway_binding:b1/p1:gpt-5.6-sol");
    // Model IDs are case-sensitive at the provider and in the runtime
    // configuration, so a differently cased model is another provider.
    expect(providerProfileIdentityKey(gateway("b1", "p1"), "Model-X")).not.toBe(
      providerProfileIdentityKey(gateway("b1", "p1"), "model-x"),
    );
    expect(
      providerProfileIdentityKey(
        { kind: "user_ci_secret", authMode: "claude_code_oauth" },
        "sonnet",
      ),
    ).toBe("user_ci_secret:claude_code_oauth:sonnet");
    // A changed account profile is a distinct provider.
    expect(providerProfileIdentityKey(gateway("b1", "p2"), "m")).not.toBe(
      providerProfileIdentityKey(gateway("b1", "p1"), "m"),
    );
  });

  it("stays injective when references and models contain separators", () => {
    expect(providerProfileIdentityKey(gateway("b", "p:m1"), "x")).not.toBe(
      providerProfileIdentityKey(gateway("b", "p"), "m1:x"),
    );
    expect(
      providerProfileIdentityKey(
        {
          kind: "managed_api_key",
          authMode: "openrouter_api_key",
          apiKeyConnectionId: "k:a",
        },
        "b",
      ),
    ).not.toBe(
      providerProfileIdentityKey(
        {
          kind: "managed_api_key",
          authMode: "openrouter_api_key",
          apiKeyConnectionId: "k",
        },
        "a:b",
      ),
    );
  });
});

describe("workspace provider profile input", () => {
  it.each([
    ["a secret-looking label", { label: "sk-proj-0123456789abcdefghij" }],
    ["an assignment-shaped label", { label: "API_KEY=abc" }],
    ["a control character", { label: "Team\nkey" }],
    ["a URL model", { model: "https://example.com/model" }],
    ["a token model", { model: "ghp_0123456789abcdefghijklmn" }],
    [
      "a secret-shaped expected gateway profile ref",
      {
        credential: {
          kind: "gateway_binding",
          bindingId: "b1",
          gatewayProfileRef: "sk-proj-0123456789",
        },
      },
    ],
    [
      "an auth mode the credential kind cannot deliver",
      {
        credential: {
          kind: "user_ci_secret",
          authMode: "codex_account_gateway",
        },
      },
    ],
    [
      // A single OpenRouter provider runs over the provider API with the
      // server-managed key; a repository secret of the user is never read.
      "an OpenRouter repository secret",
      {
        credential: { kind: "user_ci_secret", authMode: "openrouter_api_key" },
      },
    ],
  ])("refuses %s", (_name, override) => {
    expect(() =>
      parseProviderProfileDraft({
        credential: { kind: "gateway_binding", bindingId: "b1" },
        model: "gpt-5.6-sol",
        label: "Team gateway",
        ...override,
      }),
    ).toThrow("provider_profile_invalid");
  });

  it("refuses stored rows whose auth mode or references do not fit the kind", () => {
    const row = {
      credentialKind: "managed_api_key",
      authMode: "openrouter_api_key",
      gatewayBindingId: null,
      gatewayProfileRef: null,
      apiKeyConnectionId: "key-1",
      repositoryId: null,
    };
    expect(providerCredentialSourceFromStorage(row)).toEqual({
      kind: "managed_api_key",
      authMode: "openrouter_api_key",
      apiKeyConnectionId: "key-1",
    });
    for (const broken of [
      { ...row, authMode: "claude_code_oauth" },
      { ...row, apiKeyConnectionId: null },
      { ...row, credentialKind: "unknown" },
    ])
      expect(() => providerCredentialSourceFromStorage(broken)).toThrow(
        "provider_profile_invalid",
      );
  });
});
