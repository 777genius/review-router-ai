import { describe, expect, it } from "vitest";
import {
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
  reviewModelTransports,
  reviewModelWireProtocols,
  type ReviewModelDispatchProfileV2,
} from "@reviewrouter/shared";
import {
  createProducerRelease,
  ProducerDistributionKind,
  ProducerReleaseState,
  ReviewCapabilityProfile,
} from "@reviewrouter/features-review-run-control";
import {
  installedReviewRuntimeCompatibility,
  readDashboardRuntimeReleases,
  type DashboardRuntimeReleases,
} from "./review-runtime-readiness";

const current = "a".repeat(40);
const previous = "b".repeat(40);
const profile: ReviewModelDispatchProfileV2 = {
  extensionId: reviewModelDispatchContract.extensionId,
  policyVersion: reviewModelDispatchContract.policyVersion,
  descriptorDigest: reviewModelDispatchDescriptorDigest,
  transports: reviewModelTransports,
  wireProtocols: reviewModelWireProtocols,
  defaultAgentProfileRefs: Object.fromEntries(
    reviewModelTransports.map((transport) => [transport, `ocr-${transport}`]),
  ),
  limits: {
    maxRequests: reviewModelDispatchContract.maxRequests,
    maxConcurrentRequests: reviewModelDispatchContract.maxConcurrentRequests,
    maxRequestBytes: reviewModelDispatchContract.maxRequestBytes,
    maxResponseBytes: reviewModelDispatchContract.maxResponseBytes,
    maxOutputTokens: reviewModelDispatchContract.maxOutputTokens,
  },
};
const agentProfiles = reviewModelTransports.map((transport) => ({
  profileRef: `ocr-${transport}`,
  agentKind: "ocr" as const,
  binarySha256: "f".repeat(64),
  packageVersion: "1.0.0",
  modelTransports: ["account_gateway", "provider_api"] as const,
  contextGateway: false as const,
  cancellation: true as const,
  reviewSkillsVersion: 1 as const,
}));
const releases: DashboardRuntimeReleases = new Map([
  [
    current,
    {
      modelDispatchProfile: profile,
      agentProfiles,
      provisioningTransports: reviewModelTransports,
    },
  ],
]);

const installed = (
  actionVersion = `777genius/review-router@${current}`,
  status = "configured",
) => ({
  providers: [{ authMode: "openrouter_api_key", model: "openai/gpt-5.4-mini" }],
  provisioning: { status, actionVersion },
  requirementMatches: true,
  releases,
  gatewayAuthorizationReady: false,
});

describe("confirmed installed review runtime", () => {
  it("requires an update for a same-transport old immutable pin", () => {
    expect(installedReviewRuntimeCompatibility(installed())).toBe("compatible");
    expect(
      installedReviewRuntimeCompatibility(
        installed(`777genius/review-router@${previous}`),
      ),
    ).toBe("update_required");
  });

  it.each(["setup_pr_open", "failed", "not_started"])(
    "does not treat a %s candidate pin as installed",
    (status) => {
      expect(
        installedReviewRuntimeCompatibility(installed(current, status)),
      ).toBe("unknown");
    },
  );

  it("keeps unverified source and unavailable deployment support unknown", () => {
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(),
        requirementMatches: false,
      }),
    ).toBe("unknown");
    expect(
      installedReviewRuntimeCompatibility({ ...installed(), releases: null }),
    ).toBe("unknown");
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(),
        releases: new Map(),
      }),
    ).toBe("unknown");
    expect(installedReviewRuntimeCompatibility(installed("v1"))).toBe(
      "unknown",
    );
  });

  it("uses the Gateway neutral ABI and qualified authorization without comparing its channel to an Action SHA", () => {
    const gateway = {
      ...installed("workflow-v1"),
      providers: [{ authMode: "codex_account_gateway", model: "gpt-5.6-sol" }],
    };
    expect(installedReviewRuntimeCompatibility(gateway)).toBe("unknown");
    expect(
      installedReviewRuntimeCompatibility({
        ...gateway,
        gatewayAuthorizationReady: true,
      }),
    ).toBe("compatible");
    expect(
      installedReviewRuntimeCompatibility({
        ...gateway,
        provisioning: { status: "configured", actionVersion: "workflow-v0" },
        gatewayAuthorizationReady: true,
      }),
    ).toBe("update_required");
  });

  it("does not borrow compatibility from another route", () => {
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(),
        providers: [
          {
            authMode: "codex_subscription_oauth_hosted_pool",
            model: "gpt-5.6-sol",
          },
        ],
        releases: new Map([
          [
            current,
            {
              modelDispatchProfile: {
                ...profile,
                transports: ["runner_local_responses"],
              },
              agentProfiles,
              provisioningTransports: reviewModelTransports,
            },
          ],
        ]),
      }),
    ).toBe("unknown");
  });
  it("uses admission's finite route selection and rejects unsupported or multiple provider selections", () => {
    for (const providers of [
      [{ authMode: "unqualified", model: "model" }],
      [{ authMode: "openrouter_api_key", model: "" }],
      [
        { authMode: "openrouter_api_key", model: "model" },
        { authMode: "claude_code_oauth", model: "claude" },
      ],
    ])
      expect(
        installedReviewRuntimeCompatibility({ ...installed(), providers }),
      ).toBe("unknown");
  });

  it("shares admission's approved default and exact explicit agent selection", () => {
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(),
        releases: new Map([
          [
            current,
            {
              modelDispatchProfile: profile,
              agentProfiles: null,
              provisioningTransports: reviewModelTransports,
            },
          ],
        ]),
      }),
    ).toBe("unknown");
    expect(
      installedReviewRuntimeCompatibility({
        ...installed("workflow-v1"),
        gatewayAuthorizationReady: true,
        providers: [
          {
            authMode: "codex_account_gateway",
            model: "model",
            agentProfileRef: "missing-profile",
          },
        ],
      }),
    ).toBe("unknown");
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(),
        providers: [
          {
            authMode: "openrouter_api_key",
            model: "model",
            agenticContext: false,
          },
        ],
      }),
    ).toBe("unknown");
  });

  it("does not offer an update when the registered candidate is not the actual configured setup target", () => {
    const candidateOnly = new Map([
      [
        current,
        {
          modelDispatchProfile: profile,
          agentProfiles,
          provisioningTransports: [],
        },
      ],
    ]);
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(previous),
        releases: candidateOnly,
      }),
    ).toBe("unknown");
    // Compatible A stays valid while the release configuration moves to B.
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(current),
        releases: candidateOnly,
      }),
    ).toBe("compatible");
    expect(
      installedReviewRuntimeCompatibility({
        ...installed("workflow-v1"),
        providers: [{ authMode: "codex_account_gateway", model: "model" }],
        releases: candidateOnly,
        gatewayAuthorizationReady: true,
      }),
    ).toBe("unknown");
  });

  it("does not present an active rotating namespace's pinned caller as an ordinary same-pin upgrade", () => {
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(previous),
        providers: [
          {
            authMode: "codex_subscription_oauth_rotating",
            model: "gpt-5.6-sol",
          },
        ],
      }),
    ).toBe("unknown");
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(current),
        providers: [
          {
            authMode: "codex_subscription_oauth_rotating",
            model: "gpt-5.6-sol",
          },
        ],
      }),
    ).toBe("compatible");
  });

  it("requires the actual subscription wire support in the target profile", () => {
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(current),
        providers: [
          {
            authMode: "codex_subscription_oauth_rotating",
            model: "gpt-5.6-sol",
          },
        ],
        releases: new Map([
          [
            current,
            {
              modelDispatchProfile: {
                ...profile,
                wireProtocols: ["openai-responses"],
              },
              agentProfiles,
              provisioningTransports: reviewModelTransports,
            },
          ],
        ]),
      }),
    ).toBe("unknown");
  });
});

describe("dashboard registered runtime source", () => {
  const candidate = {
    producerReleaseId: "fixture-release",
    distributionKind: ProducerDistributionKind.PublicReusable,
    actionCommitSha: current,
    runtimeCommitSha: "b".repeat(40),
    wrapperEntrypointDigest: null,
    runtimeEntrypointDigest: "c".repeat(64),
    contextGatewayPolicyVersion: null,
    contextGatewayEntrypointDigest: null,
    reviewInvestigationProfile: null,
    schemaDigest: "d".repeat(64),
    capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
    protocolLimitsProfileId: "fixture-limits",
    operationalSloProfileId: "fixture-slo",
    modelDispatchProfile: profile,
    agentProfiles,
  };
  const { reviewInvestigationProfile: _ignored, ...wire } = candidate;
  const env = {
    REVIEW_ROUTER_ACTION_REF: `777genius/review-router@${current}`,
    REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${current}`,
    REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "v1.99.0",
    REVIEW_ROUTER_HOSTED_POOL_ACTION_SHA: current,
    REVIEW_ROUTER_HOSTED_POOL_ACTION_DIST_SHA256: "6".repeat(64),
    REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON: JSON.stringify([
      {
        ...wire,
        canonicalizerDigest: "e".repeat(64),
        reviewInvestigationCapability: null,
        reviewInvestigationCoverageProfileHash: null,
        reviewInvestigationPolicyHash: null,
      },
    ]),
  };
  const release = createProducerRelease(
    candidate,
    new Date("2026-10-26T00:00:00Z"),
  );

  it("accepts registered exact V2 metadata without a historical V1 verifier field", async () => {
    expect(
      await readDashboardRuntimeReleases({
        env,
        releases: {
          async findProducerReleaseById() {
            return release;
          },
        },
      }),
    ).toEqual(releases);
  });

  it("does not materialize missing releases or trust revoked/mismatched metadata", async () => {
    for (const row of [
      null,
      {
        ...release,
        state: ProducerReleaseState.Revoked,
        revokedAt: new Date(),
      },
      { ...release, runtimeCommitSha: "f".repeat(40) },
    ])
      expect(
        await readDashboardRuntimeReleases({
          env,
          releases: {
            async findProducerReleaseById() {
              return row;
            },
          },
        }),
      ).toEqual(new Map());
    expect(
      await readDashboardRuntimeReleases({
        env: {},
        releases: {
          async findProducerReleaseById() {
            throw new Error("must_not_read");
          },
        },
      }),
    ).toBeNull();
  });

  it("qualifies actual route targets independently from admitted overlap candidates and rejects partial Hosted tuples", async () => {
    const available = await readDashboardRuntimeReleases({
      env: {
        ...env,
        REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${previous}`,
      },
      releases: {
        async findProducerReleaseById() {
          return release;
        },
      },
    });
    expect(available?.get(current)?.provisioningTransports).toEqual([
      "runner_local_anthropic",
    ]);
    expect(
      installedReviewRuntimeCompatibility({
        ...installed(previous),
        releases: available,
      }),
    ).toBe("unknown");
  });
});
