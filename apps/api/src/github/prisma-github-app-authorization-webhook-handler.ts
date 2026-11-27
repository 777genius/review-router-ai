import {
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
  type GitHubAppAuthorizationWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import type { Prisma } from "@prisma/client";
import type { PrismaClient } from "@reviewrouter/platform-db";

export class PrismaGitHubAppAuthorizationWebhookHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async handleGitHubAppAuthorizationWebhook(
    envelope: GitHubAppAuthorizationWebhookEnvelope,
  ): Promise<Record<string, unknown>> {
    return this.prisma.$transaction((transaction) =>
      this.applyRevocation(transaction, envelope),
    );
  }

  /** WIP: not selected by production routes or eligible for takeover yet. */
  async handleFencedGitHubAppAuthorizationWebhook(
    envelope: GitHubAppAuthorizationWebhookEnvelope,
    claim: FencedDelivery,
  ): Promise<Record<string, unknown>> {
    if (claim.deliveryId !== envelope.deliveryId || !envelope.payloadHash)
      throw new Error("webhook_fence_identity_mismatch");
    return runWebhookFencedDatabaseEffect(
      this.prisma,
      claim,
      async (transaction) => {
        const delivery = await transaction.gitHubWebhookDelivery.findUnique({
          where: { deliveryId: claim.deliveryId },
          select: { eventName: true, action: true, payloadHash: true },
        });
        if (
          delivery?.eventName !== envelope.eventName ||
          delivery.action !== envelope.payload.action ||
          delivery.payloadHash !== envelope.payloadHash
        )
          throw new Error("webhook_fence_identity_mismatch");
        const result = await this.applyRevocation(transaction, envelope);
        await transaction.gitHubWebhookDelivery.update({
          where: { deliveryId: claim.deliveryId },
          data: { status: "processed", processedAt: new Date() },
        });
        return result;
      },
      "processed",
    );
  }

  private async applyRevocation(
    transaction: Prisma.TransactionClient,
    envelope: GitHubAppAuthorizationWebhookEnvelope,
  ): Promise<Record<string, unknown>> {
    const githubUserId = BigInt(envelope.payload.sender.id);
    const users = await transaction.user.findMany({
      where: { githubUserId },
      select: { id: true },
    });
    if (users.length === 0) {
      return {
        processed: false,
        ignored: true,
        reason: "user_not_found",
        githubUserId: githubUserId.toString(),
      };
    }

    const userIds = users.map((user) => user.id);
    const appSlug = resolveGitHubAppSlug();
    await transaction.gitHubUserAuthorization.updateMany({
      where: {
        appSlug,
        userId: { in: userIds },
        revokedAt: null,
      },
      data: {
        revision: { increment: 1 },
        refreshAttemptId: null,
        revokedAt: new Date(),
        lastErrorCode: "github_app_authorization_revoked",
      },
    });
    await transaction.repositoryPermissionCache.deleteMany({
      where: { userId: { in: userIds }, authorizationAppSlug: appSlug },
    });

    return {
      processed: true,
      appSlug,
      githubUserId: githubUserId.toString(),
      userCount: users.length,
    };
  }
}

function resolveGitHubAppSlug(): string {
  return (
    process.env.GITHUB_APP_SLUG?.trim() ||
    process.env.GITHUB_APP_CLIENT_ID?.trim() ||
    "github-app"
  );
}
