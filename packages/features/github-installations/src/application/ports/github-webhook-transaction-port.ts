import type { Clock } from "@reviewrouter/shared";
import type {
  GitHubAppAuthorizationWebhookHandlerPort,
  GitHubPullRequestWebhookHandlerPort,
  GitHubPushWebhookHandlerPort,
  GitHubRepositoryWebhookHandlerPort,
  supportedGitHubInstallationWebhookEvents,
} from "../../domain/github-webhook";
import type { GitHubInstallationRepositoryPort } from "./github-installation-repository-port";
import type { InstallationWorkspaceOwnerGrantPort } from "./installation-workspace-owner-grant-port";
import type { InstallationSyncRequestPort } from "./installation-sync-request-port";
import type { WebhookDeliveryRepositoryPort } from "./webhook-delivery-repository-port";

/** All local effects and the receipt belong to this same atomic operation. */
export type GitHubWebhookTransaction = {
  readonly installations: GitHubInstallationRepositoryPort;
  readonly deliveries: WebhookDeliveryRepositoryPort;
  readonly ownerGrants?: InstallationWorkspaceOwnerGrantPort;
  readonly syncRequests?: InstallationSyncRequestPort;
  readonly appAuthorizations?: GitHubAppAuthorizationWebhookHandlerPort;
  readonly pullRequests?: GitHubPullRequestWebhookHandlerPort;
  readonly pushes?: GitHubPushWebhookHandlerPort;
  readonly repositories?: GitHubRepositoryWebhookHandlerPort;
  readonly clock: Clock;
};

/** Commits only after the operation resolves; rejection rolls back every effect.
 * Remote admission and HTTP response delivery are outside this boundary. */
export interface GitHubWebhookTransactionPort {
  run<Result>(
    eventName: (typeof supportedGitHubInstallationWebhookEvents)[number],
    work: (transaction: GitHubWebhookTransaction) => Promise<Result>,
  ): Promise<Result>;
}
