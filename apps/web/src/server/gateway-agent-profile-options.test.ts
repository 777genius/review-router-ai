import { describe, expect, it } from "vitest";
import {
  ProducerDistributionKind,
  ReviewCapabilityProfile,
  type ReviewAgentProfile,
  type TrustedProducerReleaseAttestation,
} from "@reviewrouter/features-review-run-control";
import {
  gatewayAgentProfileOptions,
  loadGatewayAgentProfileOptions,
  loadApprovedGatewayAgentProfiles,
  reviewOcrProfileSelectionEnv,
} from "./gateway-agent-profile-options";
import { assertGatewayReviewAgentProfileContextAllowed } from "./gateway-review-config-catalog";

// Not re-exported outside the package; keep in sync with
// configured-producer-release-attestation.ts.
const producerReleaseAttestationsEnv =
  "REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON";

describe("gateway agent profile options", () => {
  it("validates hidden approved OCR definitions independently of the offer gate and retained producers", () => {
    const row = {
      kind: "codex" as const,
      authMode: "codex_account_gateway" as const,
      model: "mimo-v2.6-pro",
      reasoningEffort: "high" as const,
      agenticContext: false,
      fastMode: false,
      requiredHealthy: true,
      gatewayBindingId: "binding-1",
      gatewayProfileRef: "gateway-1",
      agentProfileRef: "ocr-managed-v2",
    };
    const newRelease = attestation("new-release", [
      profile("ocr-managed-v2", "ocr"),
    ]);
    const oldRelease = attestation("old-release", [
      profile("codex-default", "codex"),
    ]);
    const conflictingRelease = attestation("conflicting-release", [
      profile("ocr-managed-v2", "codex"),
    ]);
    for (const releases of [
      [oldRelease, newRelease],
      [conflictingRelease, newRelease],
      [newRelease, conflictingRelease],
    ]) {
      const env = {
        ...attestationEnv(releases),
        [reviewOcrProfileSelectionEnv]: "0",
      };
      expect(loadGatewayAgentProfileOptions({ env })).toEqual([]);
      const loadProfiles = () => loadApprovedGatewayAgentProfiles({ env });
      expect(() =>
        assertGatewayReviewAgentProfileContextAllowed(
          { providers: [row] },
          loadProfiles,
        ),
      ).toThrow("agent_profile_requires_agentic_context");
      expect(() =>
        assertGatewayReviewAgentProfileContextAllowed(
          { providers: [{ ...row, agentProfileRef: "historical-unknown" }] },
          loadProfiles,
        ),
      ).not.toThrow();
    }
  });
  // Capture resolves an explicit agentProfileRef only against the run's exact
  // producer release, so offering a ref just one release resolves would deny
  // capture on the others (agent_profile_unavailable).
  it("offers a profile ref only when every producer release resolves it identically", () => {
    const options = gatewayAgentProfileOptions({
      attestations: [
        attestation("release-1", [
          profile("approved-codex", "codex"),
          profile("only-release-1", "codex"),
        ]),
        attestation("release-2", [
          profile("approved-codex", "codex"),
          profile("only-release-2", "codex"),
        ]),
      ],
      ocrSelectionEnabled: true,
    });

    expect(options.map((option) => option.profileRef)).toEqual([
      "approved-codex",
    ]);
    expect(options.map((option) => option.agentKind)).toEqual(["codex"]);
  });

  // A cross-producer profileRef dedupe could hide the agentKind disagreement
  // that the per-kind agentic-context save rule depends on.
  it("hides a profile ref whose agentKind differs across producer releases", () => {
    const options = gatewayAgentProfileOptions({
      attestations: [
        attestation("release-1", [profile("shared-ref", "codex")]),
        attestation("release-2", [profile("shared-ref", "ocr")]),
      ],
      ocrSelectionEnabled: true,
    });

    expect(options).toEqual([]);
  });

  it("hides profiles without the account_gateway transport capture requires", () => {
    const options = gatewayAgentProfileOptions({
      attestations: [
        attestation("release-1", [
          profile("api-only", "codex", ["provider_api"]),
        ]),
        attestation("release-2", [
          profile("api-only", "codex", ["provider_api"]),
        ]),
      ],
      ocrSelectionEnabled: true,
    });

    expect(options).toEqual([]);
  });

  // Releases without approved profiles bail out of capture before any ref
  // resolution, so they cannot constrain what the row offers.
  it("does not constrain the list by producer releases without approved profiles", () => {
    const options = gatewayAgentProfileOptions({
      attestations: [
        attestation("release-1", [profile("approved-codex", "codex")]),
        attestation("release-2", null),
      ],
      ocrSelectionEnabled: true,
    });

    expect(options.map((option) => option.profileRef)).toEqual([
      "approved-codex",
    ]);
  });

  it("hides OCR profiles while OCR engine selection is disabled", () => {
    const options = gatewayAgentProfileOptions({
      attestations: [
        attestation("release-1", [
          profile("approved-codex", "codex"),
          profile("approved-ocr", "ocr"),
        ]),
        attestation("release-2", [
          profile("approved-codex", "codex"),
          profile("approved-ocr", "ocr"),
        ]),
      ],
      ocrSelectionEnabled: false,
    });

    expect(options.map((option) => option.profileRef)).toEqual([
      "approved-codex",
    ]);
  });

  it("offers OCR profiles when OCR engine selection is enabled", () => {
    const options = gatewayAgentProfileOptions({
      attestations: [
        attestation("release-1", [profile("approved-ocr", "ocr")]),
        attestation("release-2", [profile("approved-ocr", "ocr")]),
      ],
      ocrSelectionEnabled: true,
    });

    expect(options.map((option) => option.profileRef)).toEqual([
      "approved-ocr",
    ]);
    expect(options.map((option) => option.agentKind)).toEqual(["ocr"]);
  });

  it.each([
    { name: "absent", gate: undefined },
    { name: "off", gate: "0" },
    { name: "any non-1 value", gate: "true" },
  ])(
    "never materializes an OCR option while the rollout gate is $name",
    ({ gate }) => {
      const env = attestationEnv([
        attestation("release-1", [profile("approved-ocr", "ocr")]),
        attestation("release-2", [profile("approved-ocr", "ocr")]),
      ]);
      if (gate !== undefined) env[reviewOcrProfileSelectionEnv] = gate;

      const options = loadGatewayAgentProfileOptions({ env });

      expect(options).toEqual([]);
    },
  );

  it("materializes the OCR option when the rollout gate key is 1", () => {
    const env = attestationEnv([
      attestation("release-1", [profile("approved-ocr", "ocr")]),
      attestation("release-2", [profile("approved-ocr", "ocr")]),
    ]);
    env[reviewOcrProfileSelectionEnv] = "1";

    const options = loadGatewayAgentProfileOptions({ env });

    expect(options.map((option) => option.profileRef)).toEqual([
      "approved-ocr",
    ]);
    expect(options.map((option) => option.agentKind)).toEqual(["ocr"]);
  });
});

function profile(
  profileRef: string,
  agentKind: ReviewAgentProfile["agentKind"],
  modelTransports: ReviewAgentProfile["modelTransports"] = ["account_gateway"],
): ReviewAgentProfile {
  const common = {
    profileRef,
    binarySha256: "a".repeat(64),
    packageVersion: "1.0.0",
    modelTransports,
    cancellation: true,
  } as const;
  switch (agentKind) {
    case "codex":
      return { ...common, agentKind: "codex", contextGateway: true };
    case "claude":
      return { ...common, agentKind: "claude", contextGateway: true };
    case "ocr":
      return { ...common, agentKind: "ocr", contextGateway: false };
  }
}

function attestation(
  producerReleaseId: string,
  agentProfiles: readonly ReviewAgentProfile[] | null,
): TrustedProducerReleaseAttestation {
  return {
    producerReleaseId,
    distributionKind: ProducerDistributionKind.PublicReusable,
    actionCommitSha: "a".repeat(40),
    runtimeCommitSha: "b".repeat(40),
    wrapperEntrypointDigest: null,
    runtimeEntrypointDigest: "c".repeat(64),
    contextGatewayPolicyVersion: null,
    contextGatewayEntrypointDigest: null,
    agentProfiles,
    schemaDigest: "d".repeat(64),
    canonicalizerDigest: "e".repeat(64),
    capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
    protocolLimitsProfileId: "limits-1",
    operationalSloProfileId: "slo-1",
  };
}

function attestationEnv(
  attestations: readonly TrustedProducerReleaseAttestation[],
): Record<string, string | undefined> {
  return {
    [producerReleaseAttestationsEnv]: JSON.stringify(
      attestations.map((attestationRow) => ({
        ...attestationRow,
        reviewInvestigationCapability: null,
        reviewInvestigationCoverageProfileHash: null,
        reviewInvestigationPolicyHash: null,
      })),
    ),
  };
}
