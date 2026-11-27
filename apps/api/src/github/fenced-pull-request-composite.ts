import { ConflictReviewPullRequestWebhookHandler } from "@reviewrouter/features-conflict-review";
import { writePrismaOutboxEvent } from "@reviewrouter/features-outbox";
import {
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
  type GitHubPullRequestWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import {
  acquireCurrentScopeGuards,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { writePullRequestIngressInTransaction } from "./fenced-pull-request-ingress.js";
import { PrismaSetupPullRequestMergeHandler } from "./prisma-setup-pull-request-merge-handler.js";

/** Signed ingress, setup and conflict outbox effects commit as one unit. */
export async function handleFencedPullRequestComposite(
  prisma: PrismaClient,
  envelope: GitHubPullRequestWebhookEnvelope,
  claim: FencedDelivery,
  options: {
    readonly reviewIngressEnabled: boolean;
    readonly conflictFallbackEnabled: boolean;
    readonly conflictFallbackAllowed?: boolean;
  },
): Promise<Record<string, unknown>> {
  if (claim.deliveryId !== envelope.deliveryId || !envelope.payloadHash)
    throw new Error("webhook_fence_identity_mismatch");
  // The caller must evaluate the existing repository rollout policy before entry.
  if (
    options.conflictFallbackEnabled &&
    options.conflictFallbackAllowed === undefined
  )
    throw new Error("webhook_fence_conflict_policy_missing");
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
          const conflict = options.conflictFallbackEnabled
            ? await new ConflictReviewPullRequestWebhookHandler({
                outbox: {
                  enqueue: (event) =>
                    writePrismaOutboxEvent(transaction, event),
                },
                rolloutPolicy: {
                  isConflictReviewFallbackAllowed: () =>
                    options.conflictFallbackAllowed!,
                },
                clock: { now: () => new Date() },
              }).handleGitHubPullRequestWebhook(envelope)
            : null;
          await transaction.gitHubWebhookDelivery.update({
            where: { deliveryId: claim.deliveryId },
            data: { status: "processed", processedAt: new Date() },
          });
          return { ingress, setup, conflict };
        },
    "processed",
    (tx) => acquireCurrentScopeGuards(tx, [{ scope: "global", mode: "shared" }]),
  );
}
