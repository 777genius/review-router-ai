import { writePrismaOutboxEvent } from "@reviewrouter/features-outbox";
import {
  acquireCurrentScopeGuards,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import type { Clock } from "@reviewrouter/shared";
import { handleGitHubInstallationWebhook } from "../../application/use-cases/handle-github-installation-webhook";
import type { GitHubWebhookEnvelope } from "../../domain/github-webhook";
import { OutboxInstallationSyncRequester } from "../outbox/outbox-installation-sync-requester";
import { PrismaGitHubInstallationRepository } from "./prisma-github-installation-repository";
import { PrismaInstallationWorkspaceOwnerGrant } from "./prisma-installation-workspace-owner-grant";
import {
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
} from "./webhook-effect-fence";

/** Signed installation effects, sync outbox and completion commit together. */
export async function handleFencedInstallationWebhook(
  prisma: PrismaClient,
  envelope: GitHubWebhookEnvelope,
  claim: FencedDelivery,
  clock: Clock,
) {
  if (claim.deliveryId !== envelope.deliveryId || !envelope.payloadHash)
    throw new Error("webhook_fence_identity_mismatch");
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
        delivery.installationId !== BigInt(envelope.payload.installation.id) ||
        delivery.payloadHash !== envelope.payloadHash
      )
        throw new Error("webhook_fence_identity_mismatch");
      const installations = new PrismaGitHubInstallationRepository(prisma);
      const ownerGrants = new PrismaInstallationWorkspaceOwnerGrant(prisma);
      return handleGitHubInstallationWebhook(envelope, {
        clock,
        installations: {
          upsertInstallation: (snapshot) =>
            installations.upsertInstallationInTransaction(
              transaction,
              snapshot,
            ),
          markInstallationRemoved: (id) =>
            installations.markInstallationRemovedInTransaction(transaction, id),
        },
        ownerGrants: {
          grantInstallationActorOwner: (grant) =>
            ownerGrants.grantInstallationActorOwnerInTransaction(
              transaction,
              grant,
            ),
        },
        syncRequests: new OutboxInstallationSyncRequester({
          enqueue: (event) => writePrismaOutboxEvent(transaction, event),
        }),
        deliveries: {
          tryStartProcessing: async () => true,
          markProcessed: async (deliveryId) => {
            await transaction.gitHubWebhookDelivery.update({
              where: { deliveryId },
              data: { status: "processed", processedAt: clock.now() },
            });
          },
          // The transaction rolls back on failure. The outer coordinator records
          // a fenced failure only after that rollback has completed.
          markFailed: async () => {},
        },
      });
    },
    "processed",
    (tx) =>
      acquireCurrentScopeGuards(tx, [{ scope: "global", mode: "exclusive" }]),
  );
}
