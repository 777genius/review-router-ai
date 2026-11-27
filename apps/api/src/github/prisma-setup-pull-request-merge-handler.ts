import type { Prisma } from "@prisma/client";
import {
  runWebhookFencedEffectInTransaction,
  type FencedDelivery,
  type GitHubPullRequestWebhookEnvelope,
} from "@reviewrouter/features-github-installations";
import {
  runScopeEpochSerializableTransaction,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { PrismaWorkflowProvisioningStatusAuthority } from "@reviewrouter/features-workflow-provisioning/composition";

export class PrismaSetupPullRequestMergeHandler {
  constructor(private readonly prisma: PrismaClient) {}

  async handleGitHubPullRequestWebhook(
    envelope: GitHubPullRequestWebhookEnvelope,
  ): Promise<Record<string, unknown>> {
    const payload = envelope.payload;
    if (payload.action !== "closed" || payload.pull_request.merged !== true) {
      return {
        processed: false,
        ignored: true,
        reason: "pull_request_not_merged",
      };
    }

    const repository = await this.prisma.repositoryConnection.findFirst({
      where: {
        githubRepositoryId: BigInt(payload.repository.id),
        installation: {
          githubInstallationId: BigInt(payload.installation.id),
        },
      },
      select: {
        id: true,
        workspaceId: true,
        installationId: true,
        fullName: true,
      },
    });
    if (!repository?.installationId) {
      return {
        processed: false,
        ignored: true,
        reason: "repository_not_synced",
      };
    }

    const pullRequestNumber = payload.pull_request.number;
    const setupBranch = payload.pull_request.head.ref;
    const matched = await new PrismaWorkflowProvisioningStatusAuthority(
      this.prisma,
    ).markConfigured({
      repositoryId: repository.id,
      workspaceId: repository.workspaceId,
      installationId: repository.installationId,
      baseBranch: payload.pull_request.base.ref,
      headSha: payload.pull_request.head.sha ?? null,
      setupBranch,
      pullRequestNumber,
    });

    return matched
      ? {
          processed: true,
          repository: repository.fullName,
          status: "configured",
        }
      : {
          processed: false,
          ignored: true,
          reason: "not_reviewrouter_setup_pr",
          repository: repository.fullName,
        };
  }

  /** WIP: not selected by production routes or eligible for takeover yet. */
  async handleFencedGitHubPullRequestWebhook(
    envelope: GitHubPullRequestWebhookEnvelope,
    claim: FencedDelivery,
  ): Promise<Record<string, unknown>> {
    if (claim.deliveryId !== envelope.deliveryId || !envelope.payloadHash)
      throw new Error("webhook_fence_identity_mismatch");
    return runScopeEpochSerializableTransaction(
      this.prisma,
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
          return this.handlePullRequestInTransaction(transaction, envelope);
        }),
    );
  }

  /** DB-only effect; caller must acquire scope and delivery fences first. */
  async handlePullRequestInTransaction(
    transaction: Prisma.TransactionClient,
    envelope: GitHubPullRequestWebhookEnvelope,
  ): Promise<Record<string, unknown>> {
    const payload = envelope.payload;
    if (payload.action !== "closed" || payload.pull_request.merged !== true)
      return {
        processed: false,
        ignored: true,
        reason: "pull_request_not_merged",
      };
    const repository = await transaction.repositoryConnection.findFirst({
      where: {
        githubRepositoryId: BigInt(payload.repository.id),
        installation: {
          githubInstallationId: BigInt(payload.installation.id),
        },
      },
      select: {
        id: true,
        workspaceId: true,
        installationId: true,
        fullName: true,
      },
    });
    if (!repository?.installationId)
      return {
        processed: false,
        ignored: true,
        reason: "repository_not_synced",
      };
    const matched = await new PrismaWorkflowProvisioningStatusAuthority(
      this.prisma,
    ).markConfiguredInTransaction(transaction, {
      repositoryId: repository.id,
      workspaceId: repository.workspaceId,
      installationId: repository.installationId,
      baseBranch: payload.pull_request.base.ref,
      headSha: payload.pull_request.head.sha ?? null,
      setupBranch: payload.pull_request.head.ref,
      pullRequestNumber: payload.pull_request.number,
    });
    // A composite coordinator still has other generic effects to finish;
    // this adapter must not mark the whole delivery processed on its own.
    return matched
      ? {
          processed: true,
          repository: repository.fullName,
          status: "configured",
        }
      : {
          processed: false,
          ignored: true,
          reason: "not_reviewrouter_setup_pr",
          repository: repository.fullName,
        };
  }
}
