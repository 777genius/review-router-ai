import type { GitHubAppAuthorizationWebhookEnvelope } from "@reviewrouter/features-github-installations";
import type { Prisma, PrismaClient } from "@prisma/client";

export class PrismaGitHubAppAuthorizationWebhookHandler {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  async handleGitHubAppAuthorizationWebhook(
    envelope: GitHubAppAuthorizationWebhookEnvelope,
  ): Promise<Record<string, unknown>> {
    const githubUserId = BigInt(envelope.payload.sender.id);
    const users = await this.prisma.user.findMany({
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
    const revoke = async (tx: Prisma.TransactionClient) => {
      await tx.gitHubUserAuthorization.updateMany({
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
      await tx.repositoryPermissionCache.deleteMany({
        where: { userId: { in: userIds }, authorizationAppSlug: appSlug },
      });
    };
    if ("$connect" in this.prisma && typeof this.prisma.$connect === "function")
      await this.prisma.$transaction(revoke);
    else await revoke(this.prisma);

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
