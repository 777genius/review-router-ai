import { createHash } from "node:crypto";
import type { EffectiveGitHubPolicyObserverPort } from "./ports/effective-github-policy-observer-port.js";
import {
  evaluateEffectiveGitHubPolicy,
  type EffectiveGitHubPolicyEvidence,
  type EffectiveGitHubPolicyHoldReason,
  type EffectiveGitHubPolicyRequirement,
  type EffectiveGitHubPolicyResult,
} from "../domain/effective-github-policy.js";

const atomicMergeBoundary = {
  verdict: "HOLD",
  reasons: [
    "SAME_SHA_AUTHORITY_REVOCATION_NOT_ATOMIC",
    "PROVIDER_MERGE_LINEARIZATION_UNPROVEN",
  ],
} as const;

const operationalControlBoundary = {
  verdict: "HOLD",
  reasons: ["APP_RUNTIME_CUSTODY_UNPROVEN", "RULESET_ADMIN_CUSTODY_UNPROVEN"],
} as const;

/**
 * The single public read operation for this checkpoint. It qualifies only the
 * effective GitHub configuration. The separately returned merge capability is
 * intentionally HOLD even when policy configuration is QUALIFIED.
 */
export async function readEffectiveSdkGrowthGitHubPolicy(input: {
  readonly requirement: EffectiveGitHubPolicyRequirement;
  readonly observer: EffectiveGitHubPolicyObserverPort;
  readonly signal: AbortSignal;
  readonly now?: () => number;
}): Promise<EffectiveGitHubPolicyResult> {
  const now = input.now ?? Date.now;
  const evaluatedAt = now();
  const normalized = normalizeRequirement(input.requirement);
  if (!normalized) {
    return holdResult({
      reason: "CONFIGURATION_INVALID",
      requirement: bestEffortRequirement(input.requirement),
      observedAt: evaluatedAt,
      providerRulesetIds: [],
      inheritedRulesetIds: [],
      classicProtectionObserved: false,
      digestMaterial: { kind: "invalid-configuration" },
    });
  }

  let observationResult;
  try {
    observationResult = await input.observer.observe(normalized, input.signal);
  } catch {
    return holdResult({
      reason: "PROVIDER_INACCESSIBLE",
      requirement: normalized,
      observedAt: now(),
      providerRulesetIds: [],
      inheritedRulesetIds: [],
      classicProtectionObserved: false,
      digestMaterial: { kind: "observer-threw" },
    });
  }

  if (observationResult.kind === "unknown") {
    return holdResult({
      reason: observationResult.reason,
      requirement: normalized,
      observedAt: observationResult.observedAt,
      providerRulesetIds: observationResult.providerRulesetIds,
      inheritedRulesetIds: observationResult.inheritedRulesetIds,
      classicProtectionObserved: observationResult.classicProtectionObserved,
      digestMaterial: {
        kind: observationResult.kind,
        reason: observationResult.reason,
        providerRulesetIds: observationResult.providerRulesetIds,
        inheritedRulesetIds: observationResult.inheritedRulesetIds,
        classicProtectionObserved: observationResult.classicProtectionObserved,
      },
    });
  }

  const observation = observationResult.value;
  const evaluation = evaluateEffectiveGitHubPolicy(
    normalized,
    observation,
    now(),
  );
  const providerRulesetIds = sortedUnique(
    observation.rulesets.map(({ id }) => id),
  );
  const inheritedRulesetIds = sortedUnique(
    observation.rulesets
      .filter(({ sourceType }) => sourceType !== "repository")
      .map(({ id }) => id),
  );
  return {
    verdict: evaluation.verdict,
    reasons: evaluation.reasons,
    evidence: {
      repositoryId: normalized.repositoryId,
      appId: normalized.appId,
      targetRef: normalized.targetRef,
      targetSha: normalized.targetSha,
      observedAt: observation.observedAt,
      providerRulesetIds,
      inheritedRulesetIds,
      classicProtectionObserved: observation.classicProtection !== null,
      policyDigest: digestPolicy({
        repositoryId: observation.repositoryId,
        appId: normalized.appId,
        targetRef: observation.targetRef,
        rulesets: observation.rulesets,
        effectiveRules: observation.effectiveRules,
        classicProtection: observation.classicProtection,
      }),
    },
    operationalControlBoundary,
    atomicMergeBoundary,
  };
}

function holdResult(input: {
  readonly reason: EffectiveGitHubPolicyHoldReason;
  readonly requirement: EffectiveGitHubPolicyRequirement;
  readonly observedAt: number;
  readonly providerRulesetIds: readonly string[];
  readonly inheritedRulesetIds: readonly string[];
  readonly classicProtectionObserved: boolean;
  readonly digestMaterial: unknown;
}): EffectiveGitHubPolicyResult {
  const evidence: EffectiveGitHubPolicyEvidence = {
    repositoryId: input.requirement.repositoryId,
    appId: input.requirement.appId,
    targetRef: input.requirement.targetRef,
    targetSha: input.requirement.targetSha,
    observedAt: input.observedAt,
    providerRulesetIds: sortedUnique(input.providerRulesetIds),
    inheritedRulesetIds: sortedUnique(input.inheritedRulesetIds),
    classicProtectionObserved: input.classicProtectionObserved,
    policyDigest: digestPolicy({
      requirement: input.requirement,
      observation: input.digestMaterial,
    }),
  };
  return {
    verdict: "HOLD",
    reasons: [input.reason],
    evidence,
    operationalControlBoundary,
    atomicMergeBoundary,
  };
}

function normalizeRequirement(
  value: EffectiveGitHubPolicyRequirement,
): EffectiveGitHubPolicyRequirement | null {
  const repositoryId = numericId(value.repositoryId);
  const appId = numericId(value.appId);
  const repositoryFullName = value.repositoryFullName.trim();
  const targetRef = value.targetRef.trim();
  const targetSha = value.targetSha.trim().toLowerCase();
  if (
    !repositoryId ||
    !appId ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repositoryFullName) ||
    !/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(targetRef) ||
    targetRef.includes("..") ||
    !/^[a-f0-9]{40}$/u.test(targetSha) ||
    !Number.isSafeInteger(value.maxObservationAgeMs) ||
    value.maxObservationAgeMs <= 0
  ) {
    return null;
  }
  return {
    repositoryId,
    repositoryFullName,
    targetRef,
    targetSha,
    appId,
    maxObservationAgeMs: value.maxObservationAgeMs,
  };
}

function bestEffortRequirement(
  value: EffectiveGitHubPolicyRequirement,
): EffectiveGitHubPolicyRequirement {
  return {
    repositoryId: String(value.repositoryId ?? ""),
    repositoryFullName: String(value.repositoryFullName ?? ""),
    targetRef: String(value.targetRef ?? ""),
    targetSha: String(value.targetSha ?? ""),
    appId: String(value.appId ?? ""),
    maxObservationAgeMs: Number(value.maxObservationAgeMs),
  };
}

function numericId(value: string): string | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  try {
    return BigInt(value).toString();
  } catch {
    return null;
  }
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function digestPolicy(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
