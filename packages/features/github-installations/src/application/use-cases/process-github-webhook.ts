import type {
  GitHubAppAuthorizationWebhookEnvelope,
  GitHubPullRequestWebhookEnvelope,
  GitHubPushWebhookEnvelope,
  GitHubRepositoryWebhookEnvelope,
  GitHubWebhookEnvelope,
} from "../../domain/github-webhook";
import type {
  GitHubWebhookTransaction,
  GitHubWebhookTransactionPort,
} from "../ports/github-webhook-transaction-port";
import type { WebhookDeliveryRecord } from "../ports/webhook-delivery-repository-port";
import { handleGitHubInstallationWebhook } from "./handle-github-installation-webhook";

export type SupportedGitHubWebhookEnvelope =
  | (GitHubWebhookEnvelope & {
      readonly eventName: "installation" | "installation_repositories";
    })
  | GitHubAppAuthorizationWebhookEnvelope
  | GitHubPullRequestWebhookEnvelope
  | GitHubPushWebhookEnvelope
  | GitHubRepositoryWebhookEnvelope;

export type ProcessGitHubWebhookResult =
  | { readonly kind: "unhandled"; readonly eventName: string }
  | { readonly kind: "handled"; readonly value: Record<string, unknown> };

/** A successful result is returned only after the receipt and local effects commit.
 * Failed new receipts roll back too: an ordinary redelivery can acquire them. */
export async function processGitHubWebhook(
  envelope: SupportedGitHubWebhookEnvelope,
  transactions: GitHubWebhookTransactionPort,
  preAdmissionResult: Record<string, unknown> | null = null,
): Promise<ProcessGitHubWebhookResult> {
  return transactions.run(envelope.eventName, async (transaction) => {
    if (
      envelope.eventName === "installation" ||
      envelope.eventName === "installation_repositories"
    ) {
      return {
        kind: "handled",
        value: await handleGitHubInstallationWebhook(envelope, transaction),
      };
    }

    const effect = resolveEffect(envelope, transaction);
    if (!effect) {
      return preAdmissionResult && envelope.eventName === "pull_request"
        ? { kind: "handled", value: preAdmissionResult }
        : { kind: "unhandled", eventName: envelope.eventName };
    }
    if (
      !(await transaction.deliveries.tryStartProcessing(
        webhookDelivery(envelope),
      ))
    ) {
      return { kind: "handled", value: { processed: false } };
    }

    const value = await effect();
    await transaction.deliveries.markProcessed(envelope.deliveryId);
    return { kind: "handled", value };
  });
}

type OtherWebhook = Exclude<
  SupportedGitHubWebhookEnvelope,
  GitHubWebhookEnvelope
>;

function resolveEffect(
  envelope: OtherWebhook,
  transaction: GitHubWebhookTransaction,
): (() => Promise<Record<string, unknown>>) | undefined {
  switch (envelope.eventName) {
    case "github_app_authorization": {
      const handler = transaction.appAuthorizations;
      return handler
        ? () => handler.handleGitHubAppAuthorizationWebhook(envelope)
        : undefined;
    }
    case "pull_request": {
      const handler = transaction.pullRequests;
      return handler
        ? () => handler.handleGitHubPullRequestWebhook(envelope)
        : undefined;
    }
    case "push": {
      const handler = transaction.pushes;
      return handler
        ? () => handler.handleGitHubPushWebhook(envelope)
        : undefined;
    }
    case "repository": {
      const handler = transaction.repositories;
      return handler
        ? () => handler.handleGitHubRepositoryWebhook(envelope)
        : undefined;
    }
  }
}

function webhookDelivery(envelope: OtherWebhook): WebhookDeliveryRecord {
  const common = {
    deliveryId: envelope.deliveryId,
    eventName: envelope.eventName,
    ...(envelope.payloadHash ? { payloadHash: envelope.payloadHash } : {}),
  };
  switch (envelope.eventName) {
    case "github_app_authorization":
      return {
        ...common,
        action: envelope.payload.action,
        normalizedEvent: {
          type: "github.app_authorization",
          version: 1,
          action: envelope.payload.action,
          senderId: String(envelope.payload.sender.id),
          senderLogin: envelope.payload.sender.login,
        },
      };
    case "pull_request":
      return {
        ...common,
        action: envelope.payload.action,
        installationId: String(envelope.payload.installation.id),
        normalizedEvent: {
          type: "github.pull_request",
          version: 1,
          action: envelope.payload.action,
          installationId: String(envelope.payload.installation.id),
          repositoryId: String(envelope.payload.repository.id),
          repositoryFullName: envelope.payload.repository.full_name,
          pullRequestNumber: envelope.payload.pull_request.number,
          merged: envelope.payload.pull_request.merged,
        },
      };
    case "push":
      return {
        ...common,
        action: "push",
        installationId: String(envelope.payload.installation.id),
        normalizedEvent: {
          type: "github.push",
          version: 1,
          installationId: String(envelope.payload.installation.id),
          repositoryId: String(envelope.payload.repository.id),
          repositoryFullName: envelope.payload.repository.full_name,
          ref: envelope.payload.ref,
          deleted: envelope.payload.deleted,
        },
      };
    case "repository": {
      const repository = envelope.payload.repository;
      return {
        ...common,
        action: envelope.payload.action,
        installationId: String(envelope.payload.installation.id),
        normalizedEvent: {
          type: "github.repository",
          version: 1,
          action: envelope.payload.action,
          installationId: String(envelope.payload.installation.id),
          repositoryId: String(repository.id),
          repositoryFullName: repository.full_name,
          defaultBranch: repository.default_branch ?? null,
          visibility:
            repository.visibility === "internal"
              ? "internal"
              : repository.private
                ? "private"
                : "public",
          archived: repository.archived,
        },
      };
    }
  }
}
