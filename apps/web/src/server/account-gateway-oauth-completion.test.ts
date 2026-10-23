import { describe, expect, it } from "vitest";
import { snapshotOAuthCompletion } from "./account-gateway-accounts";

const nonce = "9874b2bc-e987-4456-9212-7f94f58932da";
const state = "b".repeat(64);
describe("legacy neutral OAuth completion", () => {
  it("normalizes SDK credential representations without inventing a provider", () => {
    const callbackURL = `http://localhost:1455/auth/callback?code=synthetic&state=${state}`;
    expect(
      snapshotOAuthCompletion({ nonce, authorizationResult: callbackURL }),
    ).toEqual({ nonce, callbackURL });
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
      "synthetic-without-state",
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
