import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  ConflictReviewPullRequestWebhookHandler,
  ConflictReviewPushWebhookHandler,
} from "@reviewrouter/features-conflict-review";
import {
  OutboxInstallationSyncRequester,
  PrismaGitHubInstallationRepository,
  PrismaInstallationWorkspaceOwnerGrant,
  PrismaWebhookDeliveryRepository,
  type RegisterGitHubWebhookRoutesDependencies,
} from "@reviewrouter/features-github-installations";
import {
  PrismaOutboxEventRepository,
  writePrismaOutboxEvent,
  type OutboxEventRepositoryPort,
} from "@reviewrouter/features-outbox";
import { PrismaWorkspaceReviewSettings } from "@reviewrouter/features-review-config/composition";
import { workflowProvisioningTransaction } from "@reviewrouter/features-workflow-provisioning/composition";
import {
  isConflictReviewFallbackAllowedForRepository,
  isConflictReviewFallbackEnabled,
} from "@reviewrouter/platform-config";
import {
  acquireCurrentScopeGuards,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { SystemClock } from "@reviewrouter/shared";
import { assertReviewIntentRolloutConfiguration } from "../review-intent-rollout-configuration.js";
import { ReviewV2GitHubRequestIngressOutbox } from "../review-v2-github-request-ingress-outbox.js";
import {
  CompositePullRequestWebhookHandler,
  CompositePushWebhookHandler,
} from "./composite-github-webhook-handlers.js";
import { PrismaGitHubAppAuthorizationWebhookHandler } from "./prisma-github-app-authorization-webhook-handler.js";
import { PrismaRepositoryWebhookHandler } from "./prisma-repository-webhook-handler.js";
import { PrismaSetupPullRequestMergeHandler } from "./prisma-setup-pull-request-merge-handler.js";
import { ReviewV2PullRequestWebhookHandler } from "./review-v2-pull-request-webhook-handler.js";

export function createDefaultGitHubWebhookDependencies(input: {
  readonly webhookSecret: string;
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
}): RegisterGitHubWebhookRoutesDependencies {
  const conflictReviewFallbackEnabled = isConflictReviewFallbackEnabled();
  const conflictReviewRolloutPolicy = {
    isConflictReviewFallbackAllowed(input: {
      readonly repositoryFullName: string;
    }) {
      return isConflictReviewFallbackAllowedForRepository(
        input.repositoryFullName,
      );
    },
  };
  const clock = new SystemClock();
  const reviewV2IntentHandler = createReviewV2IntentWebhookHandler(input);
  return {
    webhookSecret: input.webhookSecret,
    ...(reviewV2IntentHandler
      ? { preAdmissionPullRequests: reviewV2IntentHandler }
      : {}),
    transactions: {
      run(eventName, work) {
        const process = async (tx: Prisma.TransactionClient) => {
          // Preserve the authority lock order before claiming a delivery row.
          // Push/PR/auth events do not acquire an unrelated global writer lock.
          if (
            eventName === "installation" ||
            eventName === "installation_repositories" ||
            eventName === "repository"
          ) {
            await acquireCurrentScopeGuards(tx, [
              { scope: "global", mode: "exclusive" },
            ]);
          }
          const outbox: Pick<OutboxEventRepositoryPort, "enqueue"> = {
            enqueue: (event) => writePrismaOutboxEvent(tx, event),
          };
          return work({
            installations: new PrismaGitHubInstallationRepository(tx),
            ownerGrants: new PrismaInstallationWorkspaceOwnerGrant(tx),
            deliveries: new PrismaWebhookDeliveryRepository(tx),
            syncRequests: new OutboxInstallationSyncRequester(outbox),
            appAuthorizations: new PrismaGitHubAppAuthorizationWebhookHandler(
              tx,
            ),
            pullRequests: new CompositePullRequestWebhookHandler([
              new PrismaSetupPullRequestMergeHandler(tx),
              ...(conflictReviewFallbackEnabled
                ? [
                    new ConflictReviewPullRequestWebhookHandler({
                      outbox,
                      rolloutPolicy: conflictReviewRolloutPolicy,
                      clock,
                    }),
                  ]
                : []),
            ]),
            ...(conflictReviewFallbackEnabled
              ? {
                  pushes: new CompositePushWebhookHandler([
                    new ConflictReviewPushWebhookHandler({
                      outbox,
                      rolloutPolicy: conflictReviewRolloutPolicy,
                      clock,
                    }),
                  ]),
                }
              : {}),
            repositories: new PrismaRepositoryWebhookHandler(tx),
            clock,
          });
        };
        // Installation authority is read after its scope lock under ReadCommitted:
        // a Serializable snapshot may predate a lock wait and miss a new row.
        // Preserve the existing workflow authority's Serializable retry boundary;
        // retries never include independent admission or HTTP response delivery.
        return eventName === "pull_request" || eventName === "repository"
          ? workflowProvisioningTransaction(input.prisma, process)
          : input.prisma.$transaction(process, {
              isolationLevel: "ReadCommitted",
            });
      },
    },
  };
}

function createReviewV2IntentWebhookHandler(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
}): ReviewV2PullRequestWebhookHandler | null {
  if (input.env.REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED !== "1") {
    return null;
  }
  assertReviewIntentRolloutConfiguration(input.env);
  const ingress = new ReviewV2GitHubRequestIngressOutbox(
    new PrismaOutboxEventRepository(input.prisma),
    {
      async digestUtf8(value) {
        return createHash("sha256").update(value, "utf8").digest("hex");
      },
    },
  );
  const settings = new PrismaWorkspaceReviewSettings(input.prisma);
  return new ReviewV2PullRequestWebhookHandler({
    ingress,
    clock: new SystemClock(),
    policy: {
      reviewDrafts: (githubInstallationId) =>
        settings.reviewDraftsForGitHubInstallation(githubInstallationId),
    },
  });
}
