import { createHash } from "node:crypto";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
  type GitHubPullRequestWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import {
  writePrismaOutboxEvent,
  type OutboxEventStatus,
} from "@reviewrouter/features-outbox";
import { PrismaWorkspaceReviewSettings } from "@reviewrouter/features-review-config";
import { ReviewV2GitHubRequestIngressOutbox } from "../review-v2-github-request-ingress-outbox.js";
import { ReviewV2PullRequestWebhookHandler } from "./review-v2-pull-request-webhook-handler.js";

/** WIP: not selected by HTTP ingress or eligible for production takeover. */
export async function writeFencedPullRequestIngress(
  prisma: PrismaClient,
  envelope: GitHubPullRequestWebhookEnvelope,
  claim: FencedDelivery,
): Promise<Record<string, unknown>> {
  if (claim.deliveryId !== envelope.deliveryId || !envelope.payloadHash)
    throw new Error("webhook_fence_identity_mismatch");
  return runWebhookFencedDatabaseEffect(prisma, claim, async (transaction) => {
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
      delivery.installationId !== BigInt(envelope.payload.installation.id) ||
      delivery.payloadHash !== envelope.payloadHash
    )
      throw new Error("webhook_fence_identity_mismatch");

    const outbox = {
      enqueue: (event: Parameters<typeof writePrismaOutboxEvent>[1]) =>
        writePrismaOutboxEvent(transaction, event),
      async findStatusByIdempotencyKey(idempotencyKey: string) {
        const event = await transaction.outboxEvent.findUnique({
          where: { idempotencyKey },
          select: { id: true, status: true },
        });
        return event
          ? { id: event.id, status: event.status as OutboxEventStatus }
          : null;
      },
    };
    const ingress = new ReviewV2GitHubRequestIngressOutbox(outbox, {
      async digestUtf8(value) {
        return createHash("sha256").update(value, "utf8").digest("hex");
      },
    });
    const settings = new PrismaWorkspaceReviewSettings(transaction);
    const handler = new ReviewV2PullRequestWebhookHandler({
      ingress,
      clock: { now: () => new Date() },
      policy: {
        reviewDrafts: (githubInstallationId) =>
          settings.reviewDraftsForGitHubInstallation(githubInstallationId),
      },
    });
    // Leave processing active: a later fenced generic handler must commit its
    // effects and terminal status. The outbox insertion shares this guard.
    return handler.handleGitHubPullRequestWebhook(envelope);
  });
}
