export * from "./domain/github-installation";
export * from "./domain/github-webhook";
export * from "./domain/github-review-request-ingress";
export * from "./domain/github-webhook-normalization";
export * from "./application/ports/github-installation-repository-port";
export * from "./application/ports/installation-workspace-owner-grant-port";
export * from "./application/ports/installation-sync-request-port";
export * from "./application/ports/webhook-delivery-repository-port";
export * from "./application/use-cases/handle-github-installation-webhook";
export * from "./infrastructure/crypto/github-webhook-signature";
export * from "./infrastructure/outbox/outbox-installation-sync-requester";
export * from "./infrastructure/outbox/prisma-installation-sync-status-reader";
export * from "./infrastructure/prisma/prisma-github-installation-repository";
export * from "./infrastructure/prisma/prisma-installation-workspace-owner-grant";
export * from "./infrastructure/prisma/prisma-webhook-delivery-repository";
// Internal building block for the WIP fenced protocol; no takeover is wired.
export {
  beginFencedWebhookDelivery,
  beginVerifiedFencedWebhookDelivery,
  reclaimWebhookFence,
  renewWebhookFence,
  runWebhookFencedDatabaseEffect,
  runWebhookFencedEffectInTransaction,
} from "./infrastructure/prisma/webhook-effect-fence";
export type { FencedDelivery } from "./infrastructure/prisma/webhook-effect-fence";
export * from "./interface/http/register-github-webhook-routes";

export { handleFencedInstallationWebhook } from "./infrastructure/prisma/fenced-installation-webhook";
export {
  prepareWebhookRecovery,
  reserveWebhookRedeliveryOnce,
  recordWebhookRedeliveryAccepted,
  confirmWebhookRecovery,
} from "./infrastructure/prisma/webhook-recovery-custody";
export type { WebhookRecoveryIdentity } from "./infrastructure/prisma/webhook-recovery-custody";
export {
  createGitHubAppWebhookVerifier,
  requireVerifiedGitHubAppWebhook,
} from "./infrastructure/crypto/github-app-webhook-verifier";
export type { VerifiedGitHubAppWebhook } from "./infrastructure/crypto/github-app-webhook-verifier";
export { verifyGitHubAppWebhookRequest } from "./interface/http/verify-github-app-webhook-request";
