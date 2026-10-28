import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// These parser/operator-policy tests must not construct production services.
vi.mock("./review-action-v2-production-composition.js", () => ({
  composeReviewActionV2ProductionRunControl: () => {
    throw new Error("production_composition_not_expected_in_cli_policy_test");
  },
}));
import { InvestigationRolloutProvider } from "@reviewrouter/features-review-investigation-operations";
import {
  ImmutableRegistryWriteStatus,
  ReviewSafetyCapability,
  ReviewSafetyRolloutMode,
} from "@reviewrouter/features-review-run-control";
import {
  inspectEnvironment,
  inspectRepositoryReleaseSelection,
  inspectReleaseRegistrationEnvironment,
  parseArguments,
  parseInvestigationRolloutProvider,
  parseReviewV2ReleaseBundleCandidate,
  requireConfirmation,
  reviewV2CohortEmergencyInitialization,
  reviewV2CohortOperationForCommand,
  reviewV2CohortRolloutModes,
  reviewV2GlobalEmergencyTransitionForCommand,
  reviewV2RepositoryEmergencyTransitionForCommand,
  reviewV2WorkspaceEmergencyTransitionForCommand,
  resolveImmutableRegistryProfileId,
  serializeOperatorCliJson,
} from "./review-action-v2-operator-cli";

describe("review action v2 operator CLI", () => {
  it("rejects ambiguous or missing selection preflight targets before registry reads", async () => {
    const repository = {
      id: "repo",
      workspaceId: "workspace",
      scmRepositoryIdentityId: "identity",
    };
    const queries = {
      findProducerReleaseById: async () => {
        throw new Error("unexpected registry read");
      },
      findProtocolLimitsProfileById: async () => {
        throw new Error("unexpected registry read");
      },
    };
    for (const repositories of [[], [repository, repository]]) {
      await expect(
        inspectRepositoryReleaseSelection({
          repositories,
          queries,
          raw: undefined,
          actionCommitSha: "a".repeat(40),
        }),
      ).rejects.toThrow("repository_missing_or_ambiguous");
    }
  });

  it("parses commands and exact confirmation values without interpreting them", () => {
    expect(
      parseArguments([
        "mutation",
        "activate",
        "--repo",
        "777genius/agent-teams-ai",
        "--confirm",
        "777genius/agent-teams-ai",
      ]),
    ).toEqual({
      positionals: ["mutation", "activate"],
      options: {
        repo: "777genius/agent-teams-ai",
        confirm: "777genius/agent-teams-ai",
      },
    });
  });

  it("binds irreversible confirmation to the exact target", () => {
    const parsed = parseArguments([
      "release",
      "revoke",
      "--release",
      "review-action-v2-bad",
      "--confirm",
      "review-action-v2-bad",
    ]);

    expect(() =>
      requireConfirmation(parsed, "review-action-v2-bad"),
    ).not.toThrow();
    expect(() =>
      requireConfirmation(parsed, "review-action-v2-production"),
    ).toThrow("review_v2_confirmation_required:review-action-v2-production");
  });

  it("reports only missing or malformed environment variable names", () => {
    const credential = "operator-secret";
    const result = inspectEnvironment({
      DATABASE_URL: "postgresql://example.invalid/reviewrouter",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "private-key",
      REVIEW_ROUTER_ACTION_OIDC_AUDIENCE: "reviewrouter",
      REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_ACTIVE_KEY_ID: "authorization-1",
      REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_KEYS_JSON: "[]",
      REVIEW_ROUTER_REVIEW_V2_CAPABILITY_ACTIVE_KEY_ID: "capability-1",
      REVIEW_ROUTER_REVIEW_V2_CAPABILITY_KEYS_JSON: "[]",
      REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON: "[]",
      REVIEW_ROUTER_REVIEW_V2_PROVIDER_VOTE_LANES_JSON: "not-json",
      REVIEW_ROUTER_REVIEW_V2_PROJECTION_POLICY_VERSION: "1",
      REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL: credential,
      REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL_SHA256: createHash("sha256")
        .update(credential, "utf8")
        .digest("hex"),
    });

    expect(result).toEqual({
      ready: false,
      missing: [],
      invalid: ["REVIEW_ROUTER_REVIEW_V2_PROVIDER_VOTE_LANES_JSON"],
    });
    expect(JSON.stringify(result)).not.toContain(credential);
  });

  it("preflights release registration without unrelated runtime secrets", () => {
    const credential = "release-operator-secret";
    expect(
      inspectReleaseRegistrationEnvironment({
        DATABASE_URL: "postgresql://example.invalid/reviewrouter",
        REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL: credential,
        REVIEW_ROUTER_REVIEW_V2_OPERATOR_CREDENTIAL_SHA256: createHash("sha256")
          .update(credential, "utf8")
          .digest("hex"),
      }),
    ).toEqual({ ready: true, missing: [], invalid: [] });
  });

  it("reuses an existing immutable profile only when the digest owns another id", () => {
    expect(
      resolveImmutableRegistryProfileId(
        {
          status: ImmutableRegistryWriteStatus.Conflict,
          existingId: "limits-existing",
        },
        "limits-requested",
        "limits_conflict",
      ),
    ).toBe("limits-existing");
    expect(() =>
      resolveImmutableRegistryProfileId(
        {
          status: ImmutableRegistryWriteStatus.Conflict,
          existingId: "limits-requested",
        },
        "limits-requested",
        "limits_conflict",
      ),
    ).toThrow("limits_conflict");
  });

  it("serializes bigint fencing values as decimal strings", () => {
    expect(
      JSON.parse(
        serializeOperatorCliJson({
          authority: { mutationEpoch: 7n },
          version: 2,
        }),
      ),
    ).toEqual({
      authority: { mutationEpoch: "7" },
      version: 2,
    });
  });

  it("parses the exact normalized producer release candidate shape", () => {
    const parsed = parseReviewV2ReleaseBundleCandidate(releaseCandidate());
    expect(parsed).toEqual(releaseCandidate());
    expect(Object.hasOwn(parsed, "prDescriptionProfile")).toBe(false);
  });

  it("preserves the approved MCP descriptor in the normal registration bundle", () => {
    const contextToolsProfile = {
      extensionId: "context-tools.v1",
      descriptorDigest:
        "sha256:c188ad0a29581317f23b6aec3f103a7419f67576bea6fb3dc9910cf9ca3a3f7a",
    };
    const candidate = { ...releaseCandidate(), contextToolsProfile };
    expect(parseReviewV2ReleaseBundleCandidate(candidate)).toEqual(candidate);
    expect(
      Object.hasOwn(
        parseReviewV2ReleaseBundleCandidate(releaseCandidate()),
        "contextToolsProfile",
      ),
    ).toBe(false);
    for (const value of [
      null,
      { ...contextToolsProfile, enabled: true },
      { ...contextToolsProfile, descriptorDigest: "bad" },
    ]) {
      expect(() =>
        parseReviewV2ReleaseBundleCandidate({
          ...candidate,
          contextToolsProfile: value,
        }),
      ).toThrow();
    }
  });

  it("preserves and validates optional PR description approval in registration bundles", () => {
    const profile = {
      extensionId: "pr-description.v1",
      canonicalizerDigest:
        "aa043184eb0a1a0cf230d8fbb03c6a63a05b950c82c0107bee7d2533c386eed0",
    };
    const candidate = { ...releaseCandidate(), prDescriptionProfile: profile };
    expect(parseReviewV2ReleaseBundleCandidate(candidate)).toEqual(candidate);
    expect(
      parseReviewV2ReleaseBundleCandidate({
        ...candidate,
        prDescriptionProfile: null,
      }).prDescriptionProfile,
    ).toBeNull();
    for (const prDescriptionProfile of [
      { ...profile, canonicalizerDigest: "invalid" },
      { ...profile, enabled: true },
    ]) {
      expect(() =>
        parseReviewV2ReleaseBundleCandidate({
          ...candidate,
          prDescriptionProfile,
        }),
      ).toThrow();
    }
  });

  it("binds optional lifecycle approval without granting caller model settings", () => {
    const profile = {
      extensionId: "lifecycle-verification.v1",
      descriptorDigest: `sha256:${"a".repeat(64)}`,
    };
    const candidate = {
      ...releaseCandidate(),
      lifecycleVerificationProfile: profile,
    };
    expect(parseReviewV2ReleaseBundleCandidate(candidate)).toEqual(candidate);
    expect(
      parseReviewV2ReleaseBundleCandidate({
        ...candidate,
        lifecycleVerificationProfile: null,
      }).lifecycleVerificationProfile,
    ).toBeNull();
    expect(() =>
      parseReviewV2ReleaseBundleCandidate({
        ...candidate,
        lifecycleVerificationProfile: { ...profile, model: "other" },
      }),
    ).toThrow();
  });

  it("rejects registration without a qualified agent profile", () => {
    const candidate = releaseCandidate();
    delete candidate.agentProfiles;
    expect(() => parseReviewV2ReleaseBundleCandidate(candidate)).toThrow();
    for (const agentProfiles of [
      [],
      [{ agentKind: "codex" }],
      [
        {
          ...(releaseCandidate().agentProfiles as Record<string, unknown>[])[0],
          binarySha256: "unknown",
        },
      ],
    ])
      expect(() =>
        parseReviewV2ReleaseBundleCandidate({
          ...releaseCandidate(),
          agentProfiles,
        }),
      ).toThrow();
  });

  it("rejects flattened raw-manifest investigation fields", () => {
    const withoutProfile = releaseCandidateWithoutInvestigationProfile();

    expect(() =>
      parseReviewV2ReleaseBundleCandidate({
        ...withoutProfile,
        reviewInvestigationCapability: "review_investigation_v1",
        reviewInvestigationCoverageProfileHash: "5".repeat(64),
        reviewInvestigationPolicyHash: "6".repeat(64),
      }),
    ).toThrow("review_v2_bundle_field_shape_invalid:candidate");
  });

  it("requires an explicit null for a legacy candidate profile", () => {
    const candidate = releaseCandidateWithoutInvestigationProfile();

    expect(() => parseReviewV2ReleaseBundleCandidate(candidate)).toThrow(
      "review_v2_bundle_field_shape_invalid:candidate",
    );
    expect(
      parseReviewV2ReleaseBundleCandidate({
        ...candidate,
        reviewInvestigationProfile: null,
      }).reviewInvestigationProfile,
    ).toBeNull();
  });

  it("stages only T0 capabilities and promotes context reuse independently", () => {
    const t0Capabilities = [
      ReviewSafetyCapability.RunAuthorizationV2,
      ReviewSafetyCapability.EvidenceWritesV2,
      ReviewSafetyCapability.EvidenceReuseV2,
      ReviewSafetyCapability.PublicationOperationsV2,
      ReviewSafetyCapability.MutationEpochV2,
    ] as const;
    for (const capability of t0Capabilities) {
      expect(reviewV2CohortRolloutModes(capability)).toEqual({
        global: ReviewSafetyRolloutMode.Allowlisted,
        repository: ReviewSafetyRolloutMode.Enabled,
      });
    }

    const deferredCapabilities = [
      ReviewSafetyCapability.PromptOnlyReuse,
      ReviewSafetyCapability.ContextGatewayReuse,
      ReviewSafetyCapability.ReviewInvestigationV1,
    ] as const;
    for (const capability of deferredCapabilities) {
      expect(reviewV2CohortRolloutModes(capability)).toBeNull();
    }
    for (const capability of t0Capabilities) {
      expect(
        reviewV2CohortRolloutModes(capability, "enable-context-reuse"),
      ).toBeNull();
    }
    expect(
      reviewV2CohortRolloutModes(
        ReviewSafetyCapability.ContextGatewayReuse,
        "shadow-context-reuse",
      ),
    ).toEqual({
      global: ReviewSafetyRolloutMode.Allowlisted,
      repository: ReviewSafetyRolloutMode.Shadow,
    });
    expect(
      reviewV2CohortRolloutModes(
        ReviewSafetyCapability.ContextGatewayReuse,
        "enable-context-reuse",
      ),
    ).toEqual({
      global: ReviewSafetyRolloutMode.Allowlisted,
      repository: ReviewSafetyRolloutMode.Enabled,
    });
    expect(
      reviewV2CohortRolloutModes(
        ReviewSafetyCapability.ContextGatewayReuse,
        "disable-context-reuse",
      ),
    ).toEqual({
      global: null,
      repository: ReviewSafetyRolloutMode.Disabled,
    });
    expect(
      reviewV2CohortRolloutModes(
        ReviewSafetyCapability.PromptOnlyReuse,
        "enable-context-reuse",
      ),
    ).toBeNull();

    expect([...t0Capabilities, ...deferredCapabilities].sort()).toEqual(
      Object.values(ReviewSafetyCapability).sort(),
    );
  });

  it("maps only explicit context reuse rollout commands", () => {
    expect(
      reviewV2CohortOperationForCommand("cohort context-reuse shadow"),
    ).toBe("shadow-context-reuse");
    expect(
      reviewV2CohortOperationForCommand("cohort context-reuse enable"),
    ).toBe("enable-context-reuse");
    expect(
      reviewV2CohortOperationForCommand("cohort context-reuse disable"),
    ).toBe("disable-context-reuse");
    expect(reviewV2CohortOperationForCommand("cohort stage")).toBe("stage-t0");
    expect(
      reviewV2CohortOperationForCommand("cohort context-reuse enabled"),
    ).toBeNull();
  });

  it("initializes missing emergency controls without clearing existing stops", () => {
    expect(reviewV2CohortEmergencyInitialization(null)).toEqual({
      expectedVersion: 0,
      stopped: false,
      reason: "review-v2-cohort-staged",
    });
    expect(
      reviewV2CohortEmergencyInitialization({ stopped: false }),
    ).toBeNull();
    expect(reviewV2CohortEmergencyInitialization({ stopped: true })).toBeNull();
  });

  it("maps only explicit global emergency transitions", () => {
    expect(
      reviewV2GlobalEmergencyTransitionForCommand("emergency global open"),
    ).toEqual({
      stopped: false,
      reason: "review-v2-global-emergency-opened",
    });
    expect(
      reviewV2GlobalEmergencyTransitionForCommand("emergency global stop"),
    ).toEqual({
      stopped: true,
      reason: "review-v2-global-emergency-stopped",
    });
    expect(
      reviewV2GlobalEmergencyTransitionForCommand("emergency repository open"),
    ).toBeNull();
  });

  it("maps only explicit repository emergency transitions", () => {
    expect(
      reviewV2RepositoryEmergencyTransitionForCommand(
        "emergency repository open",
      ),
    ).toEqual({
      stopped: false,
      reason: "review-v2-repository-emergency-opened",
    });
    expect(
      reviewV2RepositoryEmergencyTransitionForCommand(
        "emergency repository stop",
      ),
    ).toEqual({
      stopped: true,
      reason: "review-v2-repository-emergency-stopped",
    });
    expect(
      reviewV2RepositoryEmergencyTransitionForCommand("emergency global open"),
    ).toBeNull();
  });

  it("maps only explicit workspace emergency transitions", () => {
    expect(
      reviewV2WorkspaceEmergencyTransitionForCommand(
        "emergency workspace open",
      ),
    ).toEqual({
      stopped: false,
      reason: "review-v2-workspace-emergency-opened",
    });
    expect(
      reviewV2WorkspaceEmergencyTransitionForCommand(
        "emergency workspace stop",
      ),
    ).toEqual({
      stopped: true,
      reason: "review-v2-workspace-emergency-stopped",
    });
    expect(
      reviewV2WorkspaceEmergencyTransitionForCommand(
        "emergency repository open",
      ),
    ).toBeNull();
  });

  it("maps only supported investigation rollout providers", () => {
    expect(parseInvestigationRolloutProvider("codex")).toBe(
      InvestigationRolloutProvider.Codex,
    );
    expect(parseInvestigationRolloutProvider("claude")).toBe(
      InvestigationRolloutProvider.Claude,
    );
    expect(() => parseInvestigationRolloutProvider("openrouter")).toThrow(
      "review_v2_investigation_provider_invalid:openrouter",
    );
  });
});

function releaseCandidate(): Record<string, unknown> {
  return {
    agentProfiles: [
      {
        profileRef: "codex-default",
        agentKind: "codex",
        binarySha256: "a".repeat(64),
        packageVersion: "0.147.0",
        modelTransports: ["account_gateway", "provider_api"],
        contextGateway: true,
        cancellation: true,
      },
    ],
    producerReleaseId: "review-action-v2-release",
    distributionKind: "public_reusable",
    actionCommitSha: "1".repeat(40),
    runtimeCommitSha: "2".repeat(40),
    wrapperEntrypointDigest: null,
    runtimeEntrypointDigest: "3".repeat(64),
    contextGatewayPolicyVersion: "context-gateway-v4",
    contextGatewayEntrypointDigest: "4".repeat(64),
    reviewInvestigationProfile: {
      capability: "review_investigation_v1",
      coverageProfileHash: "5".repeat(64),
      policyHash: "6".repeat(64),
    },
    schemaDigest: "7".repeat(64),
    capabilityProfile: "exact_revision_v2",
  };
}

function releaseCandidateWithoutInvestigationProfile(): Record<
  string,
  unknown
> {
  return Object.fromEntries(
    Object.entries(releaseCandidate()).filter(
      ([key]) => key !== "reviewInvestigationProfile",
    ),
  );
}
