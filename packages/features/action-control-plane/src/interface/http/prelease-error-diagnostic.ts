import { z } from "zod";

export type PreleaseFailureStage =
  | "request_body_validation"
  | "verified_claim_validation"
  | "use_case_rejection";

const issueCode = z.enum([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
]);
const bodyPath = z.enum([
  "oidcToken",
  "audience",
  "providerInstanceId",
  "workflowSchemaVersion",
]);
const claimPath = z.enum([
  "iss",
  "aud",
  "sub",
  "repository",
  "repository_id",
  "repository_owner",
  "repository_owner_id",
  "repository_visibility",
  "event_name",
  "ref",
  "run_id",
  "run_attempt",
  "workflow_ref",
  "workflow_sha",
  "job_workflow_ref",
  "job_workflow_sha",
  "actor",
  "runner_environment",
  "iat",
  "nbf",
  "exp",
  "jti",
]);
// Some existing public codes pass through arbitrary suffixes. Never log those.
const publicReason = z.enum([
  "repository_not_registered",
  "repository_not_selected",
  "installation_not_active",
  "workflow_ref_not_allowed",
  "invalid_action_token",
  "action_repository_mismatch",
  "workflow_schema_mismatch",
  "workflow_source_temporarily_unavailable",
  "review_request_not_ready",
  "review_request_revision_moved",
  "codex_rotating_new_work_admission_closed",
  "codex_rotating_new_work_cohort_required",
  "codex_rotating_new_work_repository_not_approved",
  "codex_rotating_lease_conflict",
  "codex_rotating_not_enabled",
  "codex_legacy_auth_requires_reconnect",
  "codex_provider_requires_rotating_workflow",
  "action_control_plane_entitlement_denied",
]);

export function projectPreleaseErrorDiagnostic(
  stage: PreleaseFailureStage,
  error: unknown,
  safePublicCode: string,
) {
  const reason = publicReason.safeParse(safePublicCode);
  return {
    stage,
    reason: reason.success ? reason.data : "unknown",
    issues:
      error instanceof z.ZodError
        ? error.issues.slice(0, 8).map((issue) => {
            const code = issueCode.safeParse(issue.code);
            // Never stringify or truncate untrusted paths.
            const pathSchema =
              stage === "request_body_validation" ? bodyPath : claimPath;
            const path =
              issue.path.length === 1 && stage !== "use_case_rejection"
                ? pathSchema.safeParse(issue.path[0])
                : null;
            return {
              code: code.success ? code.data : "unknown",
              path:
                issue.path.length === 0
                  ? "root"
                  : path?.success
                    ? path.data
                    : "unknown",
            } as const;
          })
        : [],
  } as const;
}
