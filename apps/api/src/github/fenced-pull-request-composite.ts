import {
  runWebhookFencedEffectInTransaction,
  type FencedDelivery,
  type GitHubPullRequestWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import {
  runScopeEpochSerializableTransaction,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { writePullRequestIngressInTransaction } from "./fenced-pull-request-ingress.js";
import { PrismaSetupPullRequestMergeHandler } from "./prisma-setup-pull-request-merge-handler.js";

/** WIP: signature verification is the caller's responsibility. Not route-wired. */
export async function handleFencedPullRequestComposite(
  prisma: PrismaClient,
  envelope: GitHubPullRequestWebhookEnvelope,
  claim: FencedDelivery,
  options: {
    readonly reviewIngressEnabled: boolean;
    readonly conflictFallbackEnabled: boolean;
  },
): Promise<Record<string, unknown>> {
  if (claim.deliveryId !== envelope.deliveryId || !envelope.payloadHash)
    throw new Error("webhook_fence_identity_mismatch");
  // The optional conflict handler is not yet ported to the transaction.
  if (options.conflictFallbackEnabled)
    throw new Error("webhook_fence_conflict_fallback_unimplemented");
  return runScopeEpochSerializableTransaction(
    prisma,
    [{ scope: "global", mode: "exclusive" }],
    (tx) =>
      runWebhookFencedEffectInTransaction(tx, claim, async (transaction) => {
        const delivery = await transaction.gitHubWebhookDelivery.findUnique({
          where: { deliveryId: claim.deliveryId },
          select: {
            eventName: true,
            action: true,
            installationId: true,
            payloadHash: true,
          },
        });
        if (
          delivery?.eventName !== envelope.eventName ||
          delivery.action !== envelope.payload.action ||
          delivery.installationId !==
            BigInt(envelope.payload.installation.id) ||
          delivery.payloadHash !== envelope.payloadHash
        )
          throw new Error("webhook_fence_identity_mismatch");
        const ingress = options.reviewIngressEnabled
          ? await writePullRequestIngressInTransaction(transaction, envelope)
          : null;
        const setup = await new PrismaSetupPullRequestMergeHandler(
          prisma,
        ).handlePullRequestInTransaction(transaction, envelope);
        // Deliberately leave processing; the full handler set and finalization protocol are not qualified.
        return { ingress, setup };
      }),
  );
}
