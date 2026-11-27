import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  claimVerifiedFencedWebhookDelivery,
  claimVerifiedFencedWebhookDeliveryInTransaction,
  createGitHubAppWebhookVerifier,
  failWebhookFencedDelivery,
  handleFencedInstallationWebhook,
  normalizeGitHubWebhookEvent,
  runWebhookFencedDatabaseEffect,
  type FencedDelivery,
  type GitHubWebhookProcessor,
  type ParsedGitHubWebhook,
  type RegisterGitHubWebhookRoutesDependencies,
  type WebhookDeliveryRecord,
} from "@reviewrouter/features-github-installations";
import { acquireCurrentScopeGuards, type PrismaClient } from "@reviewrouter/platform-db";
import { isConflictReviewFallbackAllowedForRepository, isConflictReviewFallbackEnabled } from "@reviewrouter/platform-config";
import { SystemClock } from "@reviewrouter/shared";
import { assertReviewIntentRolloutConfiguration } from "../review-v2-intent-rollout-configuration.js";
import { handleFencedPullRequestComposite } from "./fenced-pull-request-composite.js";
import { handleFencedPushWebhook } from "./fenced-push-webhook.js";
import { writePullRequestIngressInTransaction } from "./fenced-pull-request-ingress.js";
import { PrismaGitHubAppAuthorizationWebhookHandler } from "./prisma-github-app-authorization-webhook-handler.js";
import { PrismaRepositoryWebhookHandler } from "./prisma-repository-webhook-handler.js";

/** Every supported production webhook uses this one durable delivery protocol. */
export function createDefaultGitHubWebhookDependencies(input: {
  readonly webhookSecret: string;
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
}): RegisterGitHubWebhookRoutesDependencies {
  const verify = createGitHubAppWebhookVerifier({
    appId: input.env.GITHUB_APP_ID ?? "",
    apiBaseUrl: input.env.GITHUB_API_BASE_URL ?? "https://api.github.com",
    webhookSecret: input.webhookSecret,
  });
  const reviewIngressEnabled = input.env.REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED === "1";
  if (reviewIngressEnabled) assertReviewIntentRolloutConfiguration(input.env);
  const conflictFallbackEnabled = isConflictReviewFallbackEnabled(input.env);
  const fallbackAllowed = (repositoryFullName: string) =>
    isConflictReviewFallbackAllowedForRepository(repositoryFullName, input.env);
  const clock = new SystemClock();

  async function apply(envelope: ParsedGitHubWebhook, claim: FencedDelivery) {
    switch (envelope.eventName) {
      case "installation":
      case "installation_repositories":
        return handleFencedInstallationWebhook(input.prisma, envelope, claim, clock);
      case "github_app_authorization":
        return new PrismaGitHubAppAuthorizationWebhookHandler(input.prisma,
          input.env.GITHUB_APP_SLUG?.trim() || input.env.GITHUB_APP_CLIENT_ID?.trim() || "github-app")
          .handleFencedGitHubAppAuthorizationWebhook(envelope, claim);
      case "repository":
        return new PrismaRepositoryWebhookHandler(input.prisma).handleFencedGitHubRepositoryWebhook(envelope, claim);
      case "pull_request":
        return handleFencedPullRequestComposite(input.prisma, envelope, claim, {
          // Initial ingress already committed with the durable claim below.
          reviewIngressEnabled: false, conflictFallbackEnabled,
          conflictFallbackAllowed: fallbackAllowed(envelope.payload.repository.full_name),
        });
      case "push":
        if (conflictFallbackEnabled)
          return handleFencedPushWebhook(input.prisma, envelope, claim, fallbackAllowed(envelope.payload.repository.full_name));
        return runWebhookFencedDatabaseEffect(input.prisma, claim, async (transaction) => {
          await transaction.gitHubWebhookDelivery.update({
            where: { deliveryId: claim.deliveryId }, data: { status: "processed", processedAt: clock.now() },
          });
          return { processed: false, ignored: true, eventName: envelope.eventName };
        }, "processed");
    }
  }
  const processor: GitHubWebhookProcessor = {
    verify,
    async process(envelope, verification) {
      const ownerHash = randomBytes(32).toString("hex");
      const acquisition = envelope.eventName === "pull_request" && reviewIngressEnabled
        ? await input.prisma.$transaction(async (transaction) => {
            await acquireCurrentScopeGuards(transaction, [{ scope: "global", mode: "shared" }]);
            const acquired = await claimVerifiedFencedWebhookDeliveryInTransaction(
              transaction, verification, deliveryRecord(envelope), ownerHash, 30_000,
            );
            if (acquired.kind === "claimed" && acquired.claim.generation === 1n)
              await writePullRequestIngressInTransaction(transaction, envelope);
            return acquired;
          }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
        : await claimVerifiedFencedWebhookDelivery(input.prisma, verification, deliveryRecord(envelope), ownerHash, 30_000);
      if (acquisition.kind === "processed") return { processed: false };
      try { return await apply(envelope, acquisition.claim); }
      catch (error) {
        try { await failWebhookFencedDelivery(input.prisma, acquisition.claim, "github_webhook_processing_failed"); }
        catch { /* Retain the durable claim if failure recording is also unknown. */ }
        throw error;
      }
    },
  };
  return { processor };
}

function deliveryRecord(envelope: ParsedGitHubWebhook): WebhookDeliveryRecord {
  const common = { deliveryId: envelope.deliveryId, eventName: envelope.eventName, payloadHash: envelope.payloadHash };
  if (envelope.eventName === "github_app_authorization")
    return { ...common, action: envelope.payload.action, normalizedEvent: {
      type: "github.app_authorization", version: 1, action: envelope.payload.action,
      senderId: String(envelope.payload.sender.id), senderLogin: envelope.payload.sender.login,
    } };
  const installationId = String(envelope.payload.installation.id);
  if (envelope.eventName === "installation" || envelope.eventName === "installation_repositories")
    return { ...common, installationId, action: envelope.payload.action, normalizedEvent: normalizeGitHubWebhookEvent(envelope) };
  const repository = envelope.payload.repository;
  const normalized = { version: 1, installationId, repositoryId: String(repository.id), repositoryFullName: repository.full_name };
  if (envelope.eventName === "push")
    return { ...common, installationId, action: "push", normalizedEvent: {
      ...normalized, type: "github.push", ref: envelope.payload.ref, deleted: envelope.payload.deleted,
    } };
  if (envelope.eventName === "pull_request")
    return { ...common, installationId, action: envelope.payload.action, normalizedEvent: {
      ...normalized, type: "github.pull_request", action: envelope.payload.action,
      pullRequestNumber: envelope.payload.pull_request.number, merged: envelope.payload.pull_request.merged,
    } };
  return { ...common, installationId, action: envelope.payload.action, normalizedEvent: {
    ...normalized, type: "github.repository", action: envelope.payload.action,
    defaultBranch: envelope.payload.repository.default_branch ?? null,
    visibility: envelope.payload.repository.visibility === "internal" ? "internal" : envelope.payload.repository.private ? "private" : "public",
    archived: envelope.payload.repository.archived,
  } };
}
