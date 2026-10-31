/**
 * Durable webhook delivery records must never persist arbitrary exception text.
 * This explicit allowlist contains only messages created by reviewed, local
 * installation adapters; provider errors and unexpected payloads stay opaque.
 */
const safeFailureCodes = new Set([
  "installation_not_found_for_owner_grant",
  "installation_owner_grant_identity_ambiguous",
  "repository_identity_epoch_time_missing",
]);

export function safeGitHubWebhookFailureSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : null;
  return message && safeFailureCodes.has(message)
    ? message
    : "github_webhook_processing_failed";
}
