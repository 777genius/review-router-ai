import {
  githubAppAuthorizationWebhookPayloadSchema,
  githubInstallationWebhookPayloadSchema,
  githubPullRequestWebhookPayloadSchema,
  githubPushWebhookPayloadSchema,
  githubRepositoryWebhookPayloadSchema,
  type GitHubAppAuthorizationWebhookEnvelope,
  type GitHubPullRequestWebhookEnvelope,
  type GitHubPushWebhookEnvelope,
  type GitHubRepositoryWebhookEnvelope,
  type GitHubWebhookEnvelope,
} from "../../domain/github-webhook";
import type { VerifiedGitHubAppWebhook } from "../../infrastructure/crypto/github-app-webhook-verifier";

export type ParsedGitHubWebhook =
  | GitHubAppAuthorizationWebhookEnvelope
  | GitHubPullRequestWebhookEnvelope
  | GitHubPushWebhookEnvelope
  | GitHubRepositoryWebhookEnvelope
  | (GitHubWebhookEnvelope & {
      readonly eventName: "installation" | "installation_repositories";
    });

/** The HTTP adapter verifies and parses; the composition owns durable effects. */
export interface GitHubWebhookProcessor {
  verify(input: {
    readonly rawPayload: Buffer;
    readonly signatureHeader?: string;
  }): VerifiedGitHubAppWebhook | null;
  process(
    envelope: ParsedGitHubWebhook,
    verification: VerifiedGitHubAppWebhook,
  ): Promise<Record<string, unknown>>;
}

export function parseGitHubWebhook(
  eventName: string,
  body: unknown,
  receipt: Readonly<{ deliveryId: string; payloadHash: string }>,
): ParsedGitHubWebhook | null {
  switch (eventName) {
    case "github_app_authorization": {
      const parsed = githubAppAuthorizationWebhookPayloadSchema.safeParse(body);
      return parsed.success
        ? { ...receipt, eventName, payload: parsed.data }
        : null;
    }
    case "pull_request": {
      const parsed = githubPullRequestWebhookPayloadSchema.safeParse(body);
      return parsed.success
        ? { ...receipt, eventName, payload: parsed.data }
        : null;
    }
    case "push": {
      const parsed = githubPushWebhookPayloadSchema.safeParse(body);
      return parsed.success
        ? { ...receipt, eventName, payload: parsed.data }
        : null;
    }
    case "repository": {
      const parsed = githubRepositoryWebhookPayloadSchema.safeParse(body);
      return parsed.success
        ? { ...receipt, eventName, payload: parsed.data }
        : null;
    }
    case "installation":
    case "installation_repositories": {
      const parsed = githubInstallationWebhookPayloadSchema.safeParse(body);
      return parsed.success
        ? { ...receipt, eventName, payload: parsed.data }
        : null;
    }
    default:
      return null;
  }
}
