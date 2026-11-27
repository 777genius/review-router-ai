import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createGitHubAppWebhookVerifier,
  requireVerifiedGitHubAppWebhook,
} from "../infrastructure/crypto/github-app-webhook-verifier";
const config = {
  appId: "123",
  apiBaseUrl: "https://api.github.com/",
  webhookSecret: "synthetic-secret",
};
const rawPayload = Buffer.from('{"action":"opened"}');
const signature = `sha256=${createHmac("sha256", config.webhookSecret).update(rawPayload).digest("hex")}`;
describe("trusted GitHub App webhook verifier", () => {
  it("produces an immutable app-bound context only after successful HMAC", () => {
    const verify = createGitHubAppWebhookVerifier(config);
    expect(
      verify({ rawPayload, signatureHeader: "sha256=invalid" }),
    ).toBeNull();
    expect(
      verify({
        rawPayload: Buffer.from("changed"),
        signatureHeader: signature,
      }),
    ).toBeNull();
    const context = verify({ rawPayload, signatureHeader: signature });
    expect(context?.appIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(context?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(context)).toBe(true);
    expect(requireVerifiedGitHubAppWebhook(context)).toBe(context);
    expect(() => requireVerifiedGitHubAppWebhook({ ...context })).toThrow(
      "github_app_webhook_unverified",
    );
    expect(JSON.stringify(context)).not.toContain(config.webhookSecret);
  });
  it("separates configured App identities and normalizes the trusted URL", () => {
    const first = createGitHubAppWebhookVerifier(config)({
      rawPayload,
      signatureHeader: signature,
    });
    const same = createGitHubAppWebhookVerifier({
      ...config,
      apiBaseUrl: "https://API.GITHUB.COM",
    })({ rawPayload, signatureHeader: signature });
    const other = createGitHubAppWebhookVerifier({ ...config, appId: "124" })({
      rawPayload,
      signatureHeader: signature,
    });
    expect(first?.appIdentityHash).toBe(same?.appIdentityHash);
    expect(first?.appIdentityHash).not.toBe(other?.appIdentityHash);
  });
  it.each([
    { ...config, appId: "0" },
    { ...config, appId: "123x" },
    { ...config, apiBaseUrl: "http://example.com" },
    { ...config, apiBaseUrl: "https://secret@example.com" },
    { ...config, apiBaseUrl: "https://example.com/?q=1" },
    { ...config, webhookSecret: "" },
  ])("rejects malformed trusted configuration", (invalid) => {
    expect(() => createGitHubAppWebhookVerifier(invalid)).toThrow(
      "github_app_webhook_config_invalid",
    );
  });
});
