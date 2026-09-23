import { describe, expect, it } from "vitest";
import { readEffectiveSdkGrowthGitHubPolicy } from "../application/effective-github-policy.js";
import type { EffectiveGitHubPolicyObserverPort } from "../application/ports/effective-github-policy-observer-port.js";
import { SDK_GROWTH_CHECK_NAME } from "../application/check-identity-policy.js";
import type {
  EffectiveGitHubPolicyObservation,
  EffectiveGitHubPolicyRequirement,
  NormalizedGitHubRuleset,
} from "../domain/effective-github-policy.js";

const sha = "a".repeat(40);
const requirement: EffectiveGitHubPolicyRequirement = {
  repositoryId: "1001",
  repositoryFullName: "agent-teams-ai/alpha",
  targetRef: "refs/heads/main",
  targetSha: sha,
  appId: "987654",
  maxObservationAgeMs: 30_000,
};

describe("effective SDK growth GitHub policy", () => {
  it("qualifies a complete inherited active policy with exact numeric App identity", async () => {
    const observation = qualifyingObservation();
    const result = await read(observation);

    expect(result.verdict).toBe("QUALIFIED");
    expect(result.reasons).toEqual([]);
    expect(result.evidence).toMatchObject({
      repositoryId: "1001",
      appId: "987654",
      targetRef: "refs/heads/main",
      targetSha: sha,
      providerRulesetIds: ["77"],
      inheritedRulesetIds: ["77"],
      classicProtectionObserved: false,
    });
    expect(result.evidence.policyDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.operationalControlBoundary).toEqual({
      verdict: "HOLD",
      reasons: [
        "APP_RUNTIME_CUSTODY_UNPROVEN",
        "RULESET_ADMIN_CUSTODY_UNPROVEN",
      ],
    });
    const laterObservation = await read(
      qualifyingObservation({ observedAt: 19_500 }),
    );
    expect(laterObservation.evidence.policyDigest).toBe(
      result.evidence.policyDigest,
    );
  });

  it.each([
    [null, "CHECK_APP_ID_WILDCARD"],
    ["987655", "CHECK_APP_ID_MISMATCH"],
  ] as const)(
    "holds a reserved context whose App identity is %s",
    async (integrationId, expectedReason) => {
      const observation = qualifyingObservation({ integrationId });
      const result = await read(observation);

      expect(result.verdict).toBe("HOLD");
      expect(result.reasons).toContain(expectedReason);
      expect(result.reasons).toContain("NO_ACTIVE_EXACT_APP_CHECK");
    },
  );

  it("holds an evaluate-only exact App requirement", async () => {
    const observation = qualifyingObservation({
      ruleset: { enforcement: "evaluate" },
      effectiveRules: [],
    });
    const result = await read(observation);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toContain("EVALUATE_ONLY");
    expect(result.reasons).toContain("NO_ACTIVE_EXACT_APP_CHECK");
  });

  it("holds any applicable ordinary-user bypass", async () => {
    const observation = qualifyingObservation({
      ruleset: {
        bypassActors: [
          { actorType: "repository-role", actorId: "4", bypassMode: "always" },
        ],
      },
    });
    const result = await read(observation);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toContain("ORDINARY_USER_BYPASS");
    expect(result.reasons).toContain("DIRECT_PUSH_BYPASS");
  });

  it("holds repository-administered gates even when their provider rules are active", async () => {
    const observation = qualifyingObservation({
      ruleset: { sourceType: "repository", source: "agent-teams-ai/alpha" },
    });
    const result = await read(observation);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toContain("INDEPENDENT_ADMINISTRATION_UNPROVEN");
  });

  it("holds incomplete creation, freshness and direct-update coverage", async () => {
    const baseline = qualifyingObservation();
    const source = baseline.rulesets[0]!;
    const requiredCheck = source.rules.find(
      (rule) => rule.type === "required-status-checks",
    );
    if (!requiredCheck || requiredCheck.type !== "required-status-checks") {
      throw new Error("test fixture required check missing");
    }
    const observation = qualifyingObservation({
      ruleset: {
        rules: [
          { ...requiredCheck, strict: false, enforceOnCreation: false },
          { type: "pull-request" },
        ],
      },
      effectiveRules: [
        effectiveRequiredCheck({ strict: false, enforceOnCreation: false }),
        { rulesetId: "77", type: "pull-request" },
      ],
    });
    const result = await read(observation);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "REF_CREATION_NOT_COVERED",
        "REF_DELETION_NOT_PROTECTED",
        "BRANCH_FRESHNESS_NOT_REQUIRED",
        "DIRECT_PUSH_BYPASS",
      ]),
    );
  });

  it.each([
    {
      name: "App identity",
      effective: effectiveRequiredCheck({ integrationId: "987655" }),
      reason: "CHECK_APP_ID_MISMATCH",
    },
    {
      name: "freshness",
      effective: effectiveRequiredCheck({ strict: false }),
      reason: "BRANCH_FRESHNESS_NOT_REQUIRED",
    },
    {
      name: "creation coverage",
      effective: effectiveRequiredCheck({ enforceOnCreation: false }),
      reason: "REF_CREATION_NOT_COVERED",
    },
  ] as const)(
    "holds when effective required-check $name conflicts with ruleset detail",
    async ({ effective, reason }) => {
      const baseline = qualifyingObservation();
      const result = await read({
        ...baseline,
        effectiveRules: [effective, ...baseline.effectiveRules.slice(1)],
      });

      expect(result.verdict).toBe("HOLD");
      expect(result.reasons).toContain("PROVIDER_RESPONSE_INVALID");
      expect(result.reasons).toContain(reason);
    },
  );

  it("holds an incomplete inherited policy observation", async () => {
    const observation = qualifyingObservation({
      rulesets: [],
      effectiveRules: [effectiveRequiredCheck({ rulesetId: "9001" })],
    });
    const result = await read(observation);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toContain("INHERITED_RULESET_INCOMPLETE");
  });

  it("holds stale observations and target branches that changed during the read", async () => {
    const observation = qualifyingObservation({
      observedAt: 1_000,
      targetShaAtEnd: "b".repeat(40),
    });
    const result = await read(observation, 50_000);

    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toContain("OBSERVATION_STALE");
    expect(result.reasons).toContain("TARGET_REF_CHANGED");
  });

  it("keeps same-SHA revoked authority outside policy qualification and on HOLD", async () => {
    // A successful App-authored check can remain green on this SHA after the
    // underlying ReviewRouter authority is revoked. Configuration inspection
    // cannot prove a transactional provider merge boundary for that event.
    const result = await read(qualifyingObservation());

    expect(result.verdict).toBe("QUALIFIED");
    expect(result.atomicMergeBoundary).toEqual({
      verdict: "HOLD",
      reasons: [
        "SAME_SHA_AUTHORITY_REVOCATION_NOT_ATOMIC",
        "PROVIDER_MERGE_LINEARIZATION_UNPROVEN",
      ],
    });
  });

  it("turns observer exceptions and invalid configured App IDs into typed HOLD", async () => {
    const throwing: EffectiveGitHubPolicyObserverPort = {
      observe: async () => {
        throw new Error("network detail intentionally not exposed");
      },
    };
    const inaccessible = await readEffectiveSdkGrowthGitHubPolicy({
      requirement,
      observer: throwing,
      signal: new AbortController().signal,
      now: () => 20_000,
    });
    expect(inaccessible).toMatchObject({
      verdict: "HOLD",
      reasons: ["PROVIDER_INACCESSIBLE"],
    });

    const invalid = await readEffectiveSdkGrowthGitHubPolicy({
      requirement: { ...requirement, appId: "github-app-slug" },
      observer: throwing,
      signal: new AbortController().signal,
      now: () => 20_000,
    });
    expect(invalid).toMatchObject({
      verdict: "HOLD",
      reasons: ["CONFIGURATION_INVALID"],
    });
  });
});

async function read(
  observation: EffectiveGitHubPolicyObservation,
  now = 20_000,
) {
  const observer: EffectiveGitHubPolicyObserverPort = {
    observe: async () => ({ kind: "observed", value: observation }),
  };
  return readEffectiveSdkGrowthGitHubPolicy({
    requirement,
    observer,
    signal: new AbortController().signal,
    now: () => now,
  });
}

function qualifyingObservation(
  overrides: Readonly<{
    integrationId?: string | null;
    ruleset?: Partial<NormalizedGitHubRuleset>;
    rulesets?: readonly NormalizedGitHubRuleset[];
    effectiveRules?: EffectiveGitHubPolicyObservation["effectiveRules"];
    observedAt?: number;
    targetShaAtEnd?: string;
  }> = {},
): EffectiveGitHubPolicyObservation {
  const ruleset: NormalizedGitHubRuleset = {
    id: "77",
    name: "SDK growth gate",
    sourceType: "organization",
    source: "agent-teams-ai",
    enforcement: "active",
    refIncludes: ["~DEFAULT_BRANCH"],
    refExcludes: [],
    bypassActors: [],
    rules: [
      {
        type: "required-status-checks",
        strict: true,
        enforceOnCreation: true,
        checks: [
          {
            context: SDK_GROWTH_CHECK_NAME,
            integrationId:
              overrides.integrationId === undefined
                ? requirement.appId
                : overrides.integrationId,
          },
        ],
      },
      { type: "pull-request" },
      { type: "non-fast-forward" },
      { type: "deletion" },
    ],
    ...overrides.ruleset,
  };
  return {
    repositoryId: requirement.repositoryId,
    repositoryFullName: requirement.repositoryFullName,
    defaultBranchRef: requirement.targetRef,
    targetRef: requirement.targetRef,
    targetShaAtStart: requirement.targetSha,
    targetShaAtEnd: overrides.targetShaAtEnd ?? requirement.targetSha,
    observedAt: overrides.observedAt ?? 19_000,
    rulesets: overrides.rulesets ?? [ruleset],
    effectiveRules: overrides.effectiveRules ?? [
      effectiveRequiredCheck({
        integrationId:
          overrides.integrationId === undefined
            ? requirement.appId
            : overrides.integrationId,
      }),
      { rulesetId: "77", type: "pull-request" },
      { rulesetId: "77", type: "non-fast-forward" },
      { rulesetId: "77", type: "deletion" },
    ],
    classicProtection: null,
  };
}

function effectiveRequiredCheck(
  overrides: Readonly<{
    rulesetId?: string;
    integrationId?: string | null;
    strict?: boolean;
    enforceOnCreation?: boolean;
  }> = {},
): Extract<
  EffectiveGitHubPolicyObservation["effectiveRules"][number],
  { type: "required-status-checks" }
> {
  return {
    rulesetId: overrides.rulesetId ?? "77",
    type: "required-status-checks",
    checks: [
      {
        context: SDK_GROWTH_CHECK_NAME,
        integrationId:
          overrides.integrationId === undefined
            ? requirement.appId
            : overrides.integrationId,
      },
    ],
    strict: overrides.strict ?? true,
    enforceOnCreation: overrides.enforceOnCreation ?? true,
  };
}
