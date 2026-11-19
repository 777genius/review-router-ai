import * as c from "@agent-teams/account-gateway/contracts";
import { GatewayError } from "@agent-teams/account-gateway/http";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { RateLimitExceededError } from "@reviewrouter/features-rate-limits";
import {
  AccountDiagnosisError,
  accountDiagnosisSchema,
  type AccountDiagnosis,
} from "../features/account-gateway/account-diagnosis";

function retryAt(value: string | Date, now: Date): string | undefined {
  const time = new Date(value).getTime();
  // Display only a bounded, future instant supplied by an attested adapter.
  if (
    !Number.isFinite(time) ||
    time <= now.getTime() ||
    time > now.getTime() + 366 * 86400000
  )
    return undefined;
  return new Date(time).toISOString();
}
/** The SDK boundary owns provider normalization. Never inspect exception text or raw bodies. */
export function diagnoseAccountGatewayFailure(
  error: unknown,
  now = new Date(),
): AccountDiagnosis {
  if (error instanceof AccountDiagnosisError) {
    const parsed = accountDiagnosisSchema.safeParse(error.diagnosis);
    return parsed.success
      ? parsed.data
      : { code: "unknown", source: "unknown" };
  }
  if (error instanceof ProviderAccountError)
    return {
      code:
        error.code === "invalid_input"
          ? "invalid_request"
          : error.code === "revision_conflict" ||
              error.code === "operation_conflict"
            ? "conflict"
            : "access_denied",
      source: "application",
    };
  if (error instanceof RateLimitExceededError) {
    const reset = retryAt(error.decision.resetAt, now);
    return {
      code: "rate_limited",
      source: "application",
      httpStatus: 429,
      ...(reset ? { retryAt: reset } : {}),
    };
  }
  if (!(error instanceof GatewayError))
    return { code: "unknown", source: "unknown" };
  const status =
    error.httpStatus !== undefined &&
    Number.isInteger(error.httpStatus) &&
    error.httpStatus >= 400 &&
    error.httpStatus <= 599
      ? { httpStatus: error.httpStatus }
      : {};
  if (error.code === "safe_error") {
    const parsed = c.safeError.safeParse(error.diagnostic);
    if (parsed.success) {
      const diagnostic = parsed.data;
      if (
        diagnostic.code === "upstream_failure" &&
        diagnostic.providerQuota?.remaining === 0
      ) {
        const reset = retryAt(diagnostic.providerQuota.resetAt, now);
        return {
          code: "quota_exhausted",
          source: "provider",
          httpStatus: 429,
          ...(reset ? { retryAt: reset } : {}),
        };
      }
      const reset =
        diagnostic.retry.kind === "after"
          ? retryAt(
              new Date(now.getTime() + diagnostic.retry.milliseconds),
              now,
            )
          : undefined;
      const code =
        diagnostic.code === "forbidden" || diagnostic.code === "unauthenticated"
          ? "access_denied"
          : diagnostic.code === "invalid_request"
            ? "invalid_request"
            : diagnostic.code === "conflict"
              ? "conflict"
              : diagnostic.code === "admission_limited"
                ? "busy"
                : error.httpStatus === 429
                  ? "rate_limited"
                  : "unavailable";
      return {
        code,
        source: "gateway",
        ...status,
        ...(reset ? { retryAt: reset } : {}),
      };
    }
  }
  return {
    code:
      error.code === "cancelled"
        ? "cancelled"
        : error.code === "invalid_input"
          ? "invalid_request"
          : "unavailable",
    source:
      error.code === "transport" || error.code === "cancelled"
        ? "network"
        : "gateway",
    ...status,
  };
}
