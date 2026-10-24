import { describe, expect, it } from "vitest";
import {
  snapshotOAuthCompletion,
  oauthCompletionMatchesProfile,
} from "./account-gateway-accounts";

const nonce = "9874b2bc-e987-4456-9212-7f94f58932da";
const state = "b".repeat(64);
describe("legacy neutral OAuth completion", () => {
  it("normalizes SDK credential representations without inventing a provider", () => {
    const callbackURL = `http://localhost:1455/auth/callback?code=synthetic&state=${state}`;
    expect(
      snapshotOAuthCompletion({ nonce, authorizationResult: callbackURL }),
    ).toEqual({ nonce, callbackURL });
    expect(
      snapshotOAuthCompletion({
        nonce,
        authorizationResult: "synthetic-grok-plain-code",
      }),
    ).toEqual({ nonce, authorizationCode: "synthetic-grok-plain-code" });
    const authorizationCode = `synthetic-manual-code#${state}`;
    expect(
      snapshotOAuthCompletion({
        nonce,
        authorizationResult: authorizationCode,
      }),
    ).toEqual({ nonce, authorizationCode });
  });
  it("rejects arbitrary callback destinations, malformed callbacks and mixed fields", () => {
    for (const authorizationResult of [
      `https://untrusted.example/callback?code=synthetic&state=${state}`,
      `http://localhost:1455/auth/callback?code=synthetic&state=${state}&state=${state}`,
      "synthetic?invalid",
    ])
      expect(() =>
        snapshotOAuthCompletion({ nonce, authorizationResult }),
      ).toThrow();
    expect(() =>
      snapshotOAuthCompletion({
        nonce,
        authorizationResult: `synthetic#${state}`,
        callbackURL: "ignored",
      } as never),
    ).toThrow();
  });
});

describe("saved profile completion grammar", () => {
  const grok = {
    id: "grok-subscription-responses-oauth-v1",
    label: "Grok",
    connection: {
      provider: "grok" as const,
      planLabel: "Subscription",
      regionLabel: "Global",
      completionInputKind: "authorization_code" as const,
      personalOnly: false,
      limitsContract: "account-limits/v2" as const,
      modelSettings: [],
    },
  };
  const claude = { id: "anthropic-claude-oauth-messages-v1", label: "Claude" };
  const codex = { id: "openai-codex-oauth-responses-v1", label: "Codex" };
  it("accepts Grok plain code and its legacy callback only for the saved Grok profile", () => {
    const authorizationCode = "synthetic-grok-plain-code";
    expect(
      oauthCompletionMatchesProfile(grok, { nonce, authorizationCode }),
    ).toBe(true);
    expect(
      oauthCompletionMatchesProfile(claude, { nonce, authorizationCode }),
    ).toBe(false);
    expect(
      oauthCompletionMatchesProfile(codex, { nonce, authorizationCode }),
    ).toBe(false);
    const callbackURL = `http://127.0.0.1:56121/callback?code=synthetic&state=${state}`;
    expect(oauthCompletionMatchesProfile(grok, { nonce, callbackURL })).toBe(
      true,
    );
    expect(oauthCompletionMatchesProfile(claude, { nonce, callbackURL })).toBe(
      false,
    );
    expect(oauthCompletionMatchesProfile(codex, { nonce, callbackURL })).toBe(
      false,
    );
  });
  it("preserves Claude code#state and rejects that representation for saved Grok", () => {
    const authorizationCode = `synthetic-claude-code#${state}`;
    expect(
      oauthCompletionMatchesProfile(claude, { nonce, authorizationCode }),
    ).toBe(true);
    expect(
      oauthCompletionMatchesProfile(grok, { nonce, authorizationCode }),
    ).toBe(false);
  });
});
