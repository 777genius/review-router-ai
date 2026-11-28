import type { FastifyRequest } from "fastify";
import type { VerifiedGitHubAppWebhook } from "../../infrastructure/crypto/github-app-webhook-verifier";

/** Ingress adapter; App config is captured in the supplied trusted verifier. */
export function verifyGitHubAppWebhookRequest(
  request: FastifyRequest,
  verify: (
    input: Readonly<{ rawPayload: Buffer; signatureHeader?: string }>,
  ) => VerifiedGitHubAppWebhook | null,
): VerifiedGitHubAppWebhook | null {
  if (!Buffer.isBuffer(request.rawBody)) return null;
  const signature = request.headers["x-hub-signature-256"];
  return verify({
    rawPayload: request.rawBody,
    ...(typeof signature === "string" ? { signatureHeader: signature } : {}),
  });
}
