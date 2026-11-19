import { z } from "zod";

/** Closed, credential-free product diagnosis. Messages are owned here, never upstream. */
export const accountDiagnosisSchema = z.strictObject({
  code: z.enum([
    "access_denied",
    "invalid_request",
    "conflict",
    "unavailable",
    "unsupported",
    "invalid_response",
    "timeout",
    "cancelled",
    "busy",
    "rate_limited",
    "quota_exhausted",
    "credentials_rejected",
    "model_unavailable",
    "cleanup_pending",
    "unknown",
  ]),
  source: z.enum(["application", "gateway", "provider", "network", "unknown"]),
  httpStatus: z.number().int().min(400).max(599).optional(),
  retryAt: z
    .string()
    .max(32)
    .refine((v) => {
      const time = Date.parse(v);
      return Number.isFinite(time) && new Date(time).toISOString() === v;
    })
    .optional(),
});
export type AccountDiagnosis = z.infer<typeof accountDiagnosisSchema>;
const messages: Record<AccountDiagnosis["code"], string> = {
  access_denied: "Account access changed. Refresh account options.",
  invalid_request:
    "The account request was not valid. Refresh the page and try again.",
  conflict:
    "The account changed during this request. Refresh account options and try again.",
  unavailable: "The service is temporarily unavailable. Try again later.",
  unsupported: "This account does not support this operation.",
  invalid_response: "The provider did not return a complete, valid response.",
  timeout:
    "The request timed out. Completion is unconfirmed; it was not retried.",
  cancelled:
    "Request cancelled. A request already sent may still consume quota.",
  busy: "Request capacity is temporarily full. Try again shortly.",
  rate_limited: "Requests are temporarily limited. Wait before trying again.",
  quota_exhausted:
    "The provider's quota is exhausted. Wait for it to reset or use another account or model.",
  credentials_rejected:
    "The provider rejected this account's credentials. Reconnect the account.",
  model_unavailable:
    "The selected model is unavailable for this account. Choose another model.",
  cleanup_pending:
    "The session could not be confirmed closed. Wait for it to expire before trying again.",
  unknown: "The request could not be completed. Try again later.",
};
export function accountDiagnosisMessage(value: unknown): string {
  const parsed = accountDiagnosisSchema.safeParse(value);
  if (!parsed.success) return messages.unknown;
  const diagnosis = parsed.data;
  const retry = diagnosis.retryAt
    ? ` Try again after ${new Date(diagnosis.retryAt).toISOString().slice(0, 19).replace("T", " ")} UTC.`
    : "";
  return messages[diagnosis.code] + retry;
}
export class AccountDiagnosisError extends Error {
  readonly diagnosis: AccountDiagnosis;
  constructor(value: AccountDiagnosis) {
    const diagnosis = accountDiagnosisSchema.parse(value);
    super(accountDiagnosisMessage(diagnosis));
    this.diagnosis = diagnosis;
  }
}
