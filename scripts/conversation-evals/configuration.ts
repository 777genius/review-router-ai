import type { ConversationOperationalModelBounds } from "../../apps/api/src/action-conversation-policy.js";

export const gatewayCandidateMechanism =
  "selected-account-gateway-candidate-v1";
export function assertEvaluationNativeScope(env: NodeJS.ProcessEnv): void {
  if (
    !/^eval_[A-Za-z0-9_-]{1,94}$/.test(
      env.REVIEW_ROUTER_MEMORY_NAMESPACE ?? "",
    ) ||
    !/^eval_[A-Za-z0-9_-]{1,94}$/.test(
      env.REVIEW_ROUTER_MEMORY_GENERATION ?? "",
    )
  )
    throw new Error("eval_requires_dedicated_native_namespace_and_generation");
}
export function evaluationMissingKeys(
  variant: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const required = [
    "REVIEW_ROUTER_MEMORY_HINDSIGHT_URL",
    "REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY",
    "CONVERSATION_EVAL_TEMPLATE_WORKSPACE_ID",
    "CONVERSATION_EVAL_TEMPLATE_REPOSITORY_ID",
  ];
  if (variant === "native-selection-only")
    required.push(
      "REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_QUALIFICATION",
      "REVIEW_ROUTER_MEMORY_SOURCE_PREVIEW_MISSION",
    );
  else
    required.push(
      "REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN",
      "REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER",
      "REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY",
      "REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY",
      "CONVERSATION_EVAL_MODEL_BOUNDS_JSON",
    );
  return required.filter((key) => !env[key]);
}

/** Operational limits are declared input, never a successful quality qualification. */
export function readCandidateModels(
  raw: string | undefined,
): readonly ConversationOperationalModelBounds[] {
  if (!raw) throw new Error("eval_candidate_model_bounds_missing");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("eval_candidate_model_bounds_invalid");
  }
  if (!Array.isArray(value) || !value.length)
    throw new Error("eval_candidate_model_bounds_invalid");
  // The shared candidate constructor validates every bound before capturing authority.
  return value as readonly ConversationOperationalModelBounds[];
}

/** Exact source identities reviewed for the candidate; historical variants retain their schema. */
export const candidateSourceDigestKeys = [
  "commonPromptSourceDigest",
  "gatewayPreviewSourceDigest",
  "accountPolicySourceDigest",
  "gatewaySdkProvenanceDigest",
] as const;
export type CandidateSourceProfile = Record<
  (typeof candidateSourceDigestKeys)[number],
  string
>;
export function requireCandidateSourceProfile(
  profile: Partial<CandidateSourceProfile> | undefined,
  reviewed: Partial<CandidateSourceProfile> | undefined,
): void {
  if (
    candidateSourceDigestKeys.some(
      (key) =>
        typeof profile?.[key] !== "string" ||
        !/^[a-f0-9]{64}$/.test(profile[key]!),
    )
  )
    throw new Error("eval_candidate_source_profile_missing");
  if (
    candidateSourceDigestKeys.some((key) => reviewed?.[key] !== profile![key])
  )
    throw new Error("eval_rubric_source_profile_mismatch");
}
