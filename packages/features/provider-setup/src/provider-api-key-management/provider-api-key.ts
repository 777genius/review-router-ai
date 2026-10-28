import { z } from "zod";

export const providerApiKeyProviderSchema = z.enum(["mimo", "openrouter"]);
export type ProviderApiKeyProvider = z.infer<
  typeof providerApiKeyProviderSchema
>;

export const providerApiKeyRepositoryStatusSchema = z.enum([
  "pending",
  "applying",
  "applied",
  "failed",
  "stale",
  "reconciliation_needed",
  "denied",
]);
export type ProviderApiKeyRepositoryStatus = z.infer<
  typeof providerApiKeyRepositoryStatusSchema
>;

export const providerApiKeyErrorReasonSchema = z.enum([
  "repository_not_allowed",
  "repository_not_found",
  "repository_not_available_to_github_app",
  "insufficient_permissions",
  "rate_limited",
  "github_request_failed",
  "github_secret_encryption_failed",
  "stored_api_key_unavailable",
  "persistence_failed",
]);
export type ProviderApiKeyErrorReason = z.infer<
  typeof providerApiKeyErrorReasonSchema
>;

export type ProviderApiKeyRepositoryResult = {
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly status: ProviderApiKeyRepositoryStatus;
  readonly errorReason?: ProviderApiKeyErrorReason;
  readonly errorSummary?: string;
  readonly keyVersion?: number;
};

export type ProviderApiKeySecretPutUncertainReason =
  | "response_incomplete"
  | "timeout"
  | "transport_unknown";

export class ProviderApiKeySecretPutPreDispatchError extends Error {
  readonly outcome = "pre_dispatch_failure" as const;

  constructor(cause?: unknown) {
    super("provider_api_key_secret_put_pre_dispatch_failed", { cause });
    this.name = "ProviderApiKeySecretPutPreDispatchError";
  }
}

export class ProviderApiKeySecretPutOutcomeUnknownError extends Error {
  readonly outcome = "transport_unknown" as const;
  readonly reason: ProviderApiKeySecretPutUncertainReason;

  constructor(reason: ProviderApiKeySecretPutUncertainReason, cause?: unknown) {
    super(`provider_api_key_secret_put_${reason}`, { cause });
    this.name = "ProviderApiKeySecretPutOutcomeUnknownError";
    this.reason = reason;
  }
}

export class ProviderApiKeyGitHubHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`github_secret_put_http_${status}`);
    this.name = "ProviderApiKeyGitHubHttpError";
    this.status = status;
  }
}

export function isProviderApiKeySecretPutOutcomeUnknownError(
  error: unknown,
): boolean {
  return (
    error instanceof ProviderApiKeySecretPutOutcomeUnknownError ||
    (typeof error === "object" &&
      error !== null &&
      "outcome" in error &&
      error.outcome === "transport_unknown")
  );
}

export type ProviderApiKeyState = {
  readonly providerType: ProviderApiKeyProvider;
  readonly connected: boolean;
  readonly keyVersion: number | null;
  readonly repositories: readonly {
    readonly repositoryId: string;
    readonly repositoryFullName: string;
    readonly status: ProviderApiKeyRepositoryStatus;
    readonly errorReason?: ProviderApiKeyErrorReason;
    readonly errorSummary?: string;
    readonly appliedKeyVersion: number | null;
    readonly attemptedKeyVersion: number | null;
    readonly appliedAt: Date | null;
  }[];
};

export function providerApiKeySecretName(
  providerType: ProviderApiKeyProvider,
): "MIMO_TOKEN_PLAN_API_KEY" | "OPENROUTER_API_KEY" {
  return providerType === "mimo"
    ? "MIMO_TOKEN_PLAN_API_KEY"
    : "OPENROUTER_API_KEY";
}
