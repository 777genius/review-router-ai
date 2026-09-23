import { SDK_GROWTH_CHECK_NAME } from "../application/check-identity-policy.js";

export type GitHubRulesetSourceType =
  | "repository"
  | "organization"
  | "enterprise";

export type GitHubRulesetEnforcement = "active" | "evaluate" | "disabled";

export type NormalizedRulesetBypassActor = Readonly<{
  actorType:
    | "user"
    | "team"
    | "integration"
    | "organization-admin"
    | "repository-role"
    | "deploy-key";
  actorId: string | null;
  bypassMode: "always" | "pull-request";
}>;

export type NormalizedRequiredStatusCheck = Readonly<{
  context: string;
  /** null is GitHub's wildcard producer identity, never the configured App. */
  integrationId: string | null;
}>;

export type NormalizedGitHubRule =
  | Readonly<{
      type: "required-status-checks";
      checks: readonly NormalizedRequiredStatusCheck[];
      strict: boolean;
      enforceOnCreation: boolean;
    }>
  | Readonly<{ type: "pull-request" }>
  | Readonly<{ type: "non-fast-forward" }>
  | Readonly<{ type: "deletion" }>
  | Readonly<{ type: "other"; providerType: string }>;

export type NormalizedGitHubRuleset = Readonly<{
  id: string;
  name: string;
  sourceType: GitHubRulesetSourceType;
  source: string;
  enforcement: GitHubRulesetEnforcement;
  refIncludes: readonly string[];
  refExcludes: readonly string[];
  bypassActors: readonly NormalizedRulesetBypassActor[];
  rules: readonly NormalizedGitHubRule[];
}>;

export type NormalizedEffectiveRule =
  | Readonly<{
      rulesetId: string;
      type: "required-status-checks";
      checks: readonly NormalizedRequiredStatusCheck[];
      strict: boolean;
      enforceOnCreation: boolean;
    }>
  | Readonly<{
      rulesetId: string;
      type: "pull-request" | "non-fast-forward" | "deletion";
    }>
  | Readonly<{
      rulesetId: string;
      type: "other";
      providerType: string;
    }>;

export type NormalizedClassicBranchProtection = Readonly<{
  requiredChecks: readonly NormalizedRequiredStatusCheck[];
  strict: boolean;
  enforceAdmins: boolean;
  pullRequestRequired: boolean;
  pullRequestBypassActors: readonly Readonly<{
    actorType: "user" | "team" | "integration";
    actorId: string;
  }>[];
  pushRestrictionActors: readonly Readonly<{
    actorType: "user" | "team" | "integration";
    actorId: string;
  }>[];
  forcePushesAllowed: boolean;
  deletionsAllowed: boolean;
}>;

export type EffectiveGitHubPolicyObservation = Readonly<{
  repositoryId: string;
  repositoryFullName: string;
  defaultBranchRef: string;
  targetRef: string;
  targetShaAtStart: string;
  targetShaAtEnd: string;
  observedAt: number;
  rulesets: readonly NormalizedGitHubRuleset[];
  effectiveRules: readonly NormalizedEffectiveRule[];
  classicProtection: NormalizedClassicBranchProtection | null;
}>;

export type EffectiveGitHubPolicyHoldReason =
  | "CONFIGURATION_INVALID"
  | "PROVIDER_INACCESSIBLE"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_PAGINATION_INCOMPLETE"
  | "TARGET_REF_MISSING"
  | "TARGET_SHA_MISMATCH"
  | "TARGET_REF_CHANGED"
  | "RULESET_DETAIL_INACCESSIBLE"
  | "INHERITED_RULESET_INCOMPLETE"
  | "OBSERVATION_STALE"
  | "RULESET_APPLICABILITY_AMBIGUOUS"
  | "EVALUATE_ONLY"
  | "CHECK_APP_ID_WILDCARD"
  | "CHECK_APP_ID_MISMATCH"
  | "NO_ACTIVE_EXACT_APP_CHECK"
  | "REF_CREATION_NOT_COVERED"
  | "REF_DELETION_NOT_PROTECTED"
  | "BRANCH_FRESHNESS_NOT_REQUIRED"
  | "PULL_REQUEST_NOT_REQUIRED"
  | "ORDINARY_USER_BYPASS"
  | "INDEPENDENT_ADMINISTRATION_UNPROVEN"
  | "DIRECT_PUSH_BYPASS";

export type AtomicMergeBoundaryHoldReason =
  | "SAME_SHA_AUTHORITY_REVOCATION_NOT_ATOMIC"
  | "PROVIDER_MERGE_LINEARIZATION_UNPROVEN";

export type OperationalControlBoundaryHoldReason =
  | "APP_RUNTIME_CUSTODY_UNPROVEN"
  | "RULESET_ADMIN_CUSTODY_UNPROVEN";

export type EffectiveGitHubPolicyEvidence = Readonly<{
  repositoryId: string;
  appId: string;
  targetRef: string;
  targetSha: string;
  observedAt: number;
  providerRulesetIds: readonly string[];
  inheritedRulesetIds: readonly string[];
  classicProtectionObserved: boolean;
  policyDigest: string;
}>;

export type EffectiveGitHubPolicyResult = Readonly<{
  verdict: "QUALIFIED" | "HOLD";
  reasons: readonly EffectiveGitHubPolicyHoldReason[];
  evidence: EffectiveGitHubPolicyEvidence;
  /** REST policy reads cannot establish protected operational custody. */
  operationalControlBoundary: Readonly<{
    verdict: "HOLD";
    reasons: readonly OperationalControlBoundaryHoldReason[];
  }>;
  /**
   * Deliberately independent of configuration qualification. GitHub's required
   * App check does not bind ReviewRouter's authority epoch, expiry or revocation
   * to the provider's irreversible merge acceptance.
   */
  atomicMergeBoundary: Readonly<{
    verdict: "HOLD";
    reasons: readonly AtomicMergeBoundaryHoldReason[];
  }>;
}>;

export type EffectiveGitHubPolicyRequirement = Readonly<{
  repositoryId: string;
  repositoryFullName: string;
  targetRef: string;
  targetSha: string;
  appId: string;
  maxObservationAgeMs: number;
}>;

type PolicyEvaluation = Readonly<{
  verdict: "QUALIFIED" | "HOLD";
  reasons: readonly EffectiveGitHubPolicyHoldReason[];
}>;

/** Pure policy decision over a complete, provider-normalized observation. */
export function evaluateEffectiveGitHubPolicy(
  requirement: EffectiveGitHubPolicyRequirement,
  observation: EffectiveGitHubPolicyObservation,
  evaluatedAt: number,
): PolicyEvaluation {
  const reasons = new Set<EffectiveGitHubPolicyHoldReason>();
  if (
    observation.repositoryId !== requirement.repositoryId ||
    observation.repositoryFullName.toLowerCase() !==
      requirement.repositoryFullName.toLowerCase()
  ) {
    reasons.add("PROVIDER_RESPONSE_INVALID");
  }
  if (observation.targetRef !== requirement.targetRef) {
    reasons.add("TARGET_REF_MISSING");
  }
  if (observation.targetShaAtStart !== requirement.targetSha) {
    reasons.add("TARGET_SHA_MISMATCH");
  }
  if (observation.targetShaAtStart !== observation.targetShaAtEnd) {
    reasons.add("TARGET_REF_CHANGED");
  }
  if (
    !Number.isSafeInteger(observation.observedAt) ||
    observation.observedAt > evaluatedAt ||
    evaluatedAt - observation.observedAt > requirement.maxObservationAgeMs
  ) {
    reasons.add("OBSERVATION_STALE");
  }

  const effective = new Map<string, NormalizedEffectiveRule>();
  const detailedIds = new Set(observation.rulesets.map(({ id }) => id));
  for (const rule of observation.effectiveRules) {
    const identity = effectiveRuleIdentity(rule);
    if (effective.has(identity)) reasons.add("PROVIDER_RESPONSE_INVALID");
    effective.set(identity, rule);
    if (!detailedIds.has(rule.rulesetId)) {
      reasons.add("INHERITED_RULESET_INCOMPLETE");
    }
  }

  let exactCheck = false;
  let independentlyAdministeredCheck = false;
  let freshness = false;
  let independentlyAdministeredFreshness = false;
  let creationCovered = false;
  let independentlyAdministeredCreation = false;
  let pullRequestRequired = false;
  let independentlyAdministeredPullRequest = false;
  let nonFastForward = false;
  let independentlyAdministeredNonFastForward = false;
  let deletionProtected = false;
  let independentlyAdministeredDeletion = false;
  let forcePushesDisallowed = false;

  for (const ruleset of observation.rulesets) {
    const effectiveTypes = new Set(
      observation.effectiveRules
        .filter((rule) => rule.rulesetId === ruleset.id)
        .map(effectiveProviderType),
    );
    const anyEffective = effectiveTypes.size > 0;
    const applicability = rulesetRefApplicability(
      ruleset,
      observation.targetRef,
      observation.defaultBranchRef,
    );
    if (anyEffective && applicability !== true) {
      reasons.add("RULESET_APPLICABILITY_AMBIGUOUS");
    }

    const applicable = anyEffective && ruleset.enforcement === "active";
    const hasBypass = ruleset.bypassActors.length > 0;
    if (applicable && hasBypass) {
      if (ruleset.bypassActors.some(isOrdinaryRulesetBypass)) {
        reasons.add("ORDINARY_USER_BYPASS");
      }
      reasons.add("DIRECT_PUSH_BYPASS");
    }

    for (const rule of ruleset.rules) {
      if (rule.type === "required-status-checks") {
        const effectiveRule = effective.get(
          `${ruleset.id}:required_status_checks`,
        );
        const checkApplies = effectiveRule?.type === "required-status-checks";
        if (checkApplies && !sameRequiredStatusCheckRule(rule, effectiveRule)) {
          reasons.add("PROVIDER_RESPONSE_INVALID");
        }
        for (const check of rule.checks) {
          if (check.context !== SDK_GROWTH_CHECK_NAME) continue;
          if (check.integrationId === null) {
            if (checkApplies || applicability === true) {
              reasons.add("CHECK_APP_ID_WILDCARD");
            }
          } else if (check.integrationId !== requirement.appId) {
            if (checkApplies || applicability === true) {
              reasons.add("CHECK_APP_ID_MISMATCH");
            }
          } else if (
            ruleset.enforcement === "evaluate" &&
            applicability === true
          ) {
            reasons.add("EVALUATE_ONLY");
          }
        }
        const effectiveChecks = checkApplies ? effectiveRule.checks : [];
        for (const check of effectiveChecks) {
          if (check.context !== SDK_GROWTH_CHECK_NAME) continue;
          if (check.integrationId === null) {
            if (checkApplies || applicability === true)
              reasons.add("CHECK_APP_ID_WILDCARD");
          } else if (check.integrationId !== requirement.appId) {
            if (checkApplies || applicability === true)
              reasons.add("CHECK_APP_ID_MISMATCH");
          } else if (ruleset.enforcement === "evaluate") {
            if (applicability === true) reasons.add("EVALUATE_ONLY");
          } else if (applicable && checkApplies && !hasBypass) {
            exactCheck = true;
            freshness ||= effectiveRule.strict;
            creationCovered ||= effectiveRule.enforceOnCreation;
            independentlyAdministeredCheck ||=
              ruleset.sourceType !== "repository";
            independentlyAdministeredFreshness ||=
              effectiveRule.strict && ruleset.sourceType !== "repository";
            independentlyAdministeredCreation ||=
              effectiveRule.enforceOnCreation &&
              ruleset.sourceType !== "repository";
          }
        }
      }
      if (
        applicable &&
        !hasBypass &&
        rule.type === "pull-request" &&
        effective.has(`${ruleset.id}:pull_request`)
      ) {
        pullRequestRequired = true;
        independentlyAdministeredPullRequest ||=
          ruleset.sourceType !== "repository";
      }
      if (
        applicable &&
        !hasBypass &&
        rule.type === "non-fast-forward" &&
        effective.has(`${ruleset.id}:non_fast_forward`)
      ) {
        nonFastForward = true;
        independentlyAdministeredNonFastForward ||=
          ruleset.sourceType !== "repository";
      }
      if (
        applicable &&
        !hasBypass &&
        rule.type === "deletion" &&
        effective.has(`${ruleset.id}:deletion`)
      ) {
        deletionProtected = true;
        independentlyAdministeredDeletion ||=
          ruleset.sourceType !== "repository";
      }
    }
  }

  for (const effectiveRule of observation.effectiveRules) {
    const ruleset = observation.rulesets.find(
      ({ id }) => id === effectiveRule.rulesetId,
    );
    if (
      ruleset &&
      !ruleset.rules.some(
        (rule) =>
          detailedProviderType(rule) === effectiveProviderType(effectiveRule),
      )
    ) {
      reasons.add("PROVIDER_RESPONSE_INVALID");
    }
  }

  const classic = observation.classicProtection;
  if (classic) {
    let classicExact = false;
    for (const check of classic.requiredChecks) {
      if (check.context !== SDK_GROWTH_CHECK_NAME) continue;
      if (check.integrationId === null) {
        reasons.add("CHECK_APP_ID_WILDCARD");
      } else if (check.integrationId !== requirement.appId) {
        reasons.add("CHECK_APP_ID_MISMATCH");
      } else {
        classicExact = true;
      }
    }
    const classicBypass =
      classic.pullRequestBypassActors.length > 0 ||
      classic.pushRestrictionActors.length > 0 ||
      !classic.enforceAdmins;
    if (classicBypass) {
      reasons.add("ORDINARY_USER_BYPASS");
      reasons.add("DIRECT_PUSH_BYPASS");
    }
    if (classicExact && !classicBypass) {
      exactCheck = true;
      freshness ||= classic.strict;
      // Classic protection is necessarily for an existing branch. GitHub's
      // response has no proof that the status check gates branch creation.
      creationCovered ||= false;
    }
    if (classic.pullRequestRequired && !classicBypass) {
      pullRequestRequired = true;
    }
    if (!classic.forcePushesAllowed && !classic.deletionsAllowed) {
      forcePushesDisallowed = true;
      deletionProtected = true;
    }
  }

  if (!exactCheck) reasons.add("NO_ACTIVE_EXACT_APP_CHECK");
  if (
    (exactCheck && !independentlyAdministeredCheck) ||
    (freshness && !independentlyAdministeredFreshness) ||
    (creationCovered && !independentlyAdministeredCreation) ||
    (pullRequestRequired && !independentlyAdministeredPullRequest) ||
    (nonFastForward && !independentlyAdministeredNonFastForward) ||
    (deletionProtected && !independentlyAdministeredDeletion)
  ) {
    reasons.add("INDEPENDENT_ADMINISTRATION_UNPROVEN");
  }
  if (!creationCovered) reasons.add("REF_CREATION_NOT_COVERED");
  if (!deletionProtected) reasons.add("REF_DELETION_NOT_PROTECTED");
  if (!freshness) reasons.add("BRANCH_FRESHNESS_NOT_REQUIRED");
  if (!pullRequestRequired) reasons.add("PULL_REQUEST_NOT_REQUIRED");
  if (!pullRequestRequired || (!nonFastForward && !forcePushesDisallowed)) {
    reasons.add("DIRECT_PUSH_BYPASS");
  }

  return reasons.size === 0
    ? { verdict: "QUALIFIED", reasons: [] }
    : { verdict: "HOLD", reasons: [...reasons].sort() };
}

function sameRequiredStatusCheckRule(
  detailed: Extract<NormalizedGitHubRule, { type: "required-status-checks" }>,
  effective: Extract<
    NormalizedEffectiveRule,
    { type: "required-status-checks" }
  >,
): boolean {
  return (
    detailed.strict === effective.strict &&
    detailed.enforceOnCreation === effective.enforceOnCreation &&
    detailed.checks.length === effective.checks.length &&
    detailed.checks.every(
      (check, index) =>
        check.context === effective.checks[index]?.context &&
        check.integrationId === effective.checks[index]?.integrationId,
    )
  );
}

function effectiveProviderType(rule: NormalizedEffectiveRule): string {
  if (rule.type === "required-status-checks") return "required_status_checks";
  if (rule.type === "pull-request") return "pull_request";
  if (rule.type === "non-fast-forward") return "non_fast_forward";
  if (rule.type === "deletion") return "deletion";
  if (rule.type === "other") return rule.providerType;
  throw new Error("unreachable effective rule type");
}

function effectiveRuleIdentity(rule: NormalizedEffectiveRule): string {
  return `${rule.rulesetId}:${effectiveProviderType(rule)}`;
}

function detailedProviderType(rule: NormalizedGitHubRule): string {
  if (rule.type === "required-status-checks") return "required_status_checks";
  if (rule.type === "pull-request") return "pull_request";
  if (rule.type === "non-fast-forward") return "non_fast_forward";
  if (rule.type === "deletion") return "deletion";
  return rule.providerType;
}

function isOrdinaryRulesetBypass(actor: NormalizedRulesetBypassActor): boolean {
  return (
    actor.actorType === "user" ||
    actor.actorType === "team" ||
    actor.actorType === "organization-admin" ||
    actor.actorType === "repository-role"
  );
}

/**
 * GitHub documents fnmatch-style ref conditions. Only the unambiguous subset
 * needed for observation is interpreted; richer patterns fail closed.
 */
function rulesetRefApplicability(
  ruleset: NormalizedGitHubRuleset,
  targetRef: string,
  defaultBranchRef: string,
): boolean | null {
  const excluded = matchesAnyRefPattern(
    ruleset.refExcludes,
    targetRef,
    defaultBranchRef,
  );
  const included = matchesAnyRefPattern(
    ruleset.refIncludes,
    targetRef,
    defaultBranchRef,
  );
  if (excluded === true) return false;
  if (excluded === null || included === null) return null;
  return included;
}

function matchesAnyRefPattern(
  patterns: readonly string[],
  targetRef: string,
  defaultBranchRef: string,
): boolean | null {
  let ambiguous = false;
  for (const pattern of patterns) {
    const match = matchRefPattern(pattern, targetRef, defaultBranchRef);
    if (match === true) return true;
    if (match === null) ambiguous = true;
  }
  return ambiguous ? null : false;
}

function matchRefPattern(
  pattern: string,
  targetRef: string,
  defaultBranchRef: string,
): boolean | null {
  if (pattern === "~ALL") return true;
  if (pattern === "~DEFAULT_BRANCH") return targetRef === defaultBranchRef;
  if (/[[\]{}()!+@\\]/u.test(pattern)) return null;
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[.*+?^${}|[\]\\]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u").test(targetRef);
}
