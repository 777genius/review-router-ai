import { createHash } from "node:crypto";
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
  if (!/^[1-9][0-9]*$/.test(config.appId) || !config.webhookSecret)
    throw new Error("github_app_webhook_config_invalid");
  let url: URL;
  try {
    url = new URL(config.apiBaseUrl);
  } catch {
    throw new Error("github_app_webhook_config_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("github_app_webhook_config_invalid");
  const canonicalBase = url.href.replace(/\/+$/, "");
  const appIdentityHash = createHash("sha256")
    .update("reviewrouter-github-app-v1\0")
    .update(canonicalBase)
    .update("\0")
    .update(config.appId)
    .digest("hex");
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
