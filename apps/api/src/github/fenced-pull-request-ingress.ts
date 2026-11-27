import { createHash } from "node:crypto";
import { acquireCurrentScopeGuards, type PrismaClient } from "@reviewrouter/platform-db";
import { Prisma } from "@prisma/client";
import {
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
  type GitHubPullRequestWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import {
  writePrismaOutboxEvent,
  type OutboxEventStatus,
} from "@reviewrouter/features-outbox";
import { ReviewV2GitHubRequestIngressOutbox } from "../review-v2-github-request-ingress-outbox.js";
import { ReviewV2PullRequestWebhookHandler } from "./review-v2-pull-request-webhook-handler.js";

/** A partial ingress effect; production uses the complete PR coordinator. */
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

    return writePullRequestIngressInTransaction(transaction, envelope);
  }, "processing", (tx) => acquireCurrentScopeGuards(tx, [{ scope: "global", mode: "shared" }]));
}

/** DB-only effect; caller must acquire scope and delivery fences first. */
export async function writePullRequestIngressInTransaction(
  transaction: Prisma.TransactionClient,
  envelope: GitHubPullRequestWebhookEnvelope,
): Promise<Record<string, unknown>> {
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
  const handler = new ReviewV2PullRequestWebhookHandler({
    ingress,
    clock: { now: () => new Date() },
    policy: {
      reviewDrafts: (githubInstallationId) =>
        readCurrentDraftPolicy(transaction, githubInstallationId),
    },
  });
  // Leave processing active: a later fenced generic handler must commit its
  // effects and terminal status. The outbox insertion shares this guard.
  return handler.handleGitHubPullRequestWebhook(envelope);
}


async function readCurrentDraftPolicy(transaction: Prisma.TransactionClient, githubInstallationId: string): Promise<boolean> {
  // Ordinary settings writers update Workspace directly. Row locks keep that
  // policy stable through outbox commit without requiring a new writer protocol.
  const installations = await transaction.$queryRaw<Array<{workspaceId: string}>>(
    Prisma.sql`SELECT "workspaceId" FROM "GitHubInstallation"
      WHERE "githubInstallationId" = ${BigInt(githubInstallationId)} FOR SHARE`,
  );
  const workspaceId = installations[0]?.workspaceId;
  if (!workspaceId) return false;
  const settings = await transaction.$queryRaw<Array<{reviewDraftPullRequests: boolean}>>(
    Prisma.sql`SELECT "reviewDraftPullRequests" FROM "Workspace"
      WHERE "id" = ${workspaceId} FOR SHARE`,
  );
  return settings[0]?.reviewDraftPullRequests === true;
}
