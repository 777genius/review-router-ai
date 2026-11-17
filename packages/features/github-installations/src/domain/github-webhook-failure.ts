/**
 * Durable webhook delivery records must never persist arbitrary exception text.
 * This explicit allowlist contains only messages created by reviewed, local
 * installation adapters; provider errors and unexpected payloads stay opaque.
 */
const safeFailureCodes = new Set([
  "installation_not_found_for_owner_grant",
  "installation_owner_grant_identity_ambiguous",
  "repository_identity_epoch_time_missing",
  "repository_webhook_binding_cas_failed",
]);

/** Prisma known-request codes (for example P2034) and PL/pgSQL raise codes
 * (P0001) are bounded identifiers that carry no tenant data. */
const persistenceFailureCode = /^P[0-9]{4}$/;

export function safeGitHubWebhookFailureSummary(error: unknown): string {
  if (!(error instanceof Error)) return "github_webhook_processing_failed";
  if (safeFailureCodes.has(error.message)) return error.message;
  const code = (error as Error & { readonly code?: unknown }).code;
  return typeof code === "string" && persistenceFailureCode.test(code)
    ? `github_webhook_persistence_failed:${code}`
    : "github_webhook_processing_failed";
}
