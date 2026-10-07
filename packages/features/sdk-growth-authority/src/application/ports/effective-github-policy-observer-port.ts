import type {
  EffectiveGitHubPolicyObservation,
  EffectiveGitHubPolicyRequirement,
  EffectiveGitHubPolicyHoldReason,
} from "../../domain/effective-github-policy.js";

export type EffectiveGitHubPolicyObservationFailure = Readonly<{
  kind: "unknown";
  reason: Extract<
    EffectiveGitHubPolicyHoldReason,
    | "PROVIDER_INACCESSIBLE"
    | "PROVIDER_RESPONSE_INVALID"
    | "PROVIDER_PAGINATION_INCOMPLETE"
    | "TARGET_REF_MISSING"
    | "TARGET_SHA_MISMATCH"
    | "TARGET_REF_CHANGED"
    | "RULESET_DETAIL_INACCESSIBLE"
    | "INHERITED_RULESET_INCOMPLETE"
  >;
  observedAt: number;
  providerRulesetIds: readonly string[];
  inheritedRulesetIds: readonly string[];
  classicProtectionObserved: boolean;
}>;

export type EffectiveGitHubPolicyObservationResult =
  | Readonly<{ kind: "observed"; value: EffectiveGitHubPolicyObservation }>
  | EffectiveGitHubPolicyObservationFailure;

export interface EffectiveGitHubPolicyObserverPort {
  /**
   * Read the exact repository/ref twice around complete ruleset and classic
   * protection reads. Never convert access denial or partial pagination into
   * absence.
   */
  observe(
    requirement: EffectiveGitHubPolicyRequirement,
    signal: AbortSignal,
  ): Promise<EffectiveGitHubPolicyObservationResult>;
}
