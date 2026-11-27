import { createHash } from "node:crypto";
import { githubAppIdentityHash } from "./github-app-identity";
import { verifyGitHubWebhookSignature } from "./github-webhook-signature";

const verifiedContexts = new WeakSet<object>();
declare const verifiedBrand: unique symbol;
export type VerifiedGitHubAppWebhook = Readonly<{
  appIdentityHash: string;
  payloadHash: string;
  readonly [verifiedBrand]: true;
}>;

/**
 * WIP: the caller supplies trusted server configuration pairing App and secret.
 * GitHub's HMAC proves the secret, not that this configuration names the right
 * App. No request header or payload field may supply the App identity.
 */
export function createGitHubAppWebhookVerifier(
  config: Readonly<{
    appId: string;
    apiBaseUrl: string;
    webhookSecret: string;
  }>,
): (
  input: Readonly<{ rawPayload: Buffer; signatureHeader?: string }>,
) => VerifiedGitHubAppWebhook | null {
  if (!config.webhookSecret)
    throw new Error("github_app_webhook_config_invalid");
  const appIdentityHash = githubAppIdentityHash(config);
  const secret = config.webhookSecret;
  return ({ rawPayload, signatureHeader }) => {
    if (
      !Buffer.isBuffer(rawPayload) ||
      !verifyGitHubWebhookSignature({
        payload: rawPayload,
        signatureHeader,
        secret,
      })
    )
      return null;
    const context = Object.freeze({
      appIdentityHash,
      payloadHash: createHash("sha256").update(rawPayload).digest("hex"),
    }) as VerifiedGitHubAppWebhook;
    verifiedContexts.add(context);
    return context;
  };
}

/** Runtime provenance guard: a lookalike object cannot establish verification. */
export function requireVerifiedGitHubAppWebhook(
  input: unknown,
): VerifiedGitHubAppWebhook {
  if (!input || typeof input !== "object" || !verifiedContexts.has(input))
    throw new Error("github_app_webhook_unverified");
  return input as VerifiedGitHubAppWebhook;
}
