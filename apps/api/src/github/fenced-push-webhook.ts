import { ConflictReviewPushWebhookHandler } from "@reviewrouter/features-conflict-review";
import { writePrismaOutboxEvent } from "@reviewrouter/features-outbox";
import {
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
  type GitHubPushWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import {
  type PrismaClient,
} from "@reviewrouter/platform-db";

/** The caller verifies the signature and evaluates the existing rollout policy. */
export async function handleFencedPushWebhook(
  prisma: PrismaClient,
  envelope: GitHubPushWebhookEnvelope,
  claim: FencedDelivery,
  conflictFallbackAllowed: boolean,
): Promise<Record<string, unknown>> {
  if (
    claim.deliveryId !== envelope.deliveryId ||
    !envelope.payloadHash ||
    typeof conflictFallbackAllowed !== "boolean"
  )
    throw new Error("webhook_fence_identity_or_policy_invalid");
  return runWebhookFencedDatabaseEffect(
    prisma,
    claim,
        async (transaction) => {
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
            delivery.action !== "push" ||
            delivery.installationId !==
              BigInt(envelope.payload.installation.id) ||
            delivery.payloadHash !== envelope.payloadHash
          )
            throw new Error("webhook_fence_identity_mismatch");
          const result = await new ConflictReviewPushWebhookHandler({
            outbox: {
              enqueue: (event) => writePrismaOutboxEvent(transaction, event),
            },
            rolloutPolicy: {
              isConflictReviewFallbackAllowed: () => conflictFallbackAllowed,
            },
            clock: { now: () => new Date() },
          }).handleGitHubPushWebhook(envelope);
          await transaction.gitHubWebhookDelivery.update({
            where: { deliveryId: claim.deliveryId },
            data: { status: "processed", processedAt: new Date() },
          });
          return result;
        },
    "processed",
  );
}
