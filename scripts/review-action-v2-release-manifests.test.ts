import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reviewerPlanDescriptorDigest } from "../packages/shared/src/review-reviewer-plan";
import {
  assertFullCommitSha,
  buildHandoffManifest,
  buildReleaseRegistrationCandidateFields,
  buildReleaseManifest,
  canonicalJson,
  parseContextGatewayReleaseMetadata,
  parseCanonicalJson,
  parseHandoffManifest,
  parseProtocolGenerationManifest,
  parseReleaseManifest,
  RELEASE_MANIFEST_VERSION,
  REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
  REVIEW_INVESTIGATION_RELEASE_COVERAGE_PROFILE_HASH,
  REVIEW_INVESTIGATION_RELEASE_POLICY_HASH,
  sha256Digest,
  validateContractExportDescriptor,
} from "./lib/review-action-v2-release-manifests.mjs";

const fixtureRoot = join(
  process.cwd(),
  "scripts/fixtures/review-action-v2-release",
);
const capabilityGolden = JSON.parse(
  readFileSync(
    join(fixtureRoot, "review-investigation-capability-v1.golden.json"),
    "utf8",
  ),
) as {
  coverageProfile: { sha256: string };
  policy: { sha256: string };
};

describe("review Action v2 release manifests", () => {
  it("binds reviewer-plan compatibility through manifest and registration only with its canonical parser", () => {
    const reviewerPlanProfile = {
      planVersion: 1,
      descriptorDigest: reviewerPlanDescriptorDigest,
    };
    const generated = JSON.parse(fixture("contract-source/manifest.json"));
    expect(
      parseProtocolGenerationManifest(
        JSON.stringify({ ...generated, reviewerPlanProfile }),
      ).reviewerPlanProfile,
    ).toEqual(reviewerPlanProfile);
    const legacy = parseReleaseManifest(fixture("expected-release.json"));
    const oldHandoff = parseHandoffManifest(fixture("expected-handoff.json"));
    expect(() =>
      buildReleaseManifest({
        ...legacy,
        handoffManifest: oldHandoff,
        reviewerPlanProfile,
      }),
    ).toThrow("no bound canonical parser");
    const handoff = {
      ...oldHandoff,
      generatedFileDigests: {
        ...oldHandoff.generatedFileDigests,
        "review-reviewer-plan.ts": "a".repeat(64),
      },
    };
    const release = buildReleaseManifest({
      ...legacy,
      handoffManifest: handoff,
      handoffManifestDigest: sha256Digest(canonicalJson(handoff)),
      reviewerPlanProfile,
    });
    expect(
      parseReleaseManifest(canonicalJson(release)).reviewerPlanProfile,
    ).toEqual(reviewerPlanProfile);
    expect(
      buildReleaseRegistrationCandidateFields(release).reviewerPlanProfile,
    ).toEqual(reviewerPlanProfile);
    for (const invalid of [
      null,
      { ...reviewerPlanProfile, planVersion: 2 },
      { ...reviewerPlanProfile, enabled: true },
      { ...reviewerPlanProfile, descriptorDigest: `sha256:${"0".repeat(64)}` },
    ])
      expect(() =>
        parseProtocolGenerationManifest(
          JSON.stringify({ ...generated, reviewerPlanProfile: invalid }),
        ),
      ).toThrow();
  });
  it("generates byte-stable handoff and release fixtures", () => {
    const generation = parseProtocolGenerationManifest(
      fixture("contract-source/manifest.json"),
    );
    const expectedHandoff = fixture("expected-handoff.json");
    const contract = validateContractExportDescriptor({
      ...generation,
      contractExportVersion: 1,
      canonicalizerDigest:
        parseHandoffManifest(expectedHandoff).canonicalizerDigest,
      generatedFileDigests:
        parseHandoffManifest(expectedHandoff).generatedFileDigests,
    });
    const handoff = buildHandoffManifest({
      contract,
      saasSourceCommit: "a".repeat(40),
      expectedPublicActionBaseCommit: "b".repeat(40),
    });
    expect(canonicalJson(handoff)).toBe(expectedHandoff);
    expect(parseHandoffManifest(expectedHandoff)).toEqual(handoff);

    const release = buildReleaseManifest({
      agentProfiles: [
        {
          profileRef: "fixture-codex",
          agentKind: "codex",
          binarySha256: "a".repeat(64),
          packageVersion: "0.147.0",
          modelTransports: ["account_gateway"],
          contextGateway: true,
          cancellation: true,
        },
      ],
      handoffManifest: handoff,
      handoffManifestDigest: sha256Digest(expectedHandoff),
      actionCommitSha: "c".repeat(40),
      runtimeEntrypointPath: "dist/index.js",
      runtimeEntrypointDigest: sha256Digest(
        Buffer.from(fixture("runtime-bundle.js")),
      ),
      contextGatewayPolicyVersion: "context-gateway-v3",
      contextGatewayEntrypointPath: "dist/context-gateway.js",
      contextGatewayEntrypointDigest: sha256Digest(
        Buffer.from(fixture("context-gateway-bundle.js")),
      ),
    });
    const expectedRelease = fixture("expected-release.json");
    expect(canonicalJson(release)).toBe(expectedRelease);
    expect(parseReleaseManifest(expectedRelease)).toEqual(release);
    expect(Object.hasOwn(release, "prDescriptionProfile")).toBe(false);
    expect(
      Object.hasOwn(
        buildReleaseRegistrationCandidateFields(release),
        "prDescriptionProfile",
      ),
    ).toBe(false);
  });

  it("binds optional PR description approval without changing release version or base digests", () => {
    const profile = {
      extensionId: "pr-description.v1",
      canonicalizerDigest:
        "aa043184eb0a1a0cf230d8fbb03c6a63a05b950c82c0107bee7d2533c386eed0",
    };
    const generated = JSON.parse(fixture("contract-source/manifest.json"));
    expect(
      parseProtocolGenerationManifest(
        JSON.stringify({ ...generated, auxiliaryExtensions: [profile] }),
      ).prDescriptionProfile,
    ).toEqual(profile);
    const legacy = parseReleaseManifest(fixture("expected-release.json"));
    const release = buildReleaseManifest({
      ...legacy,
      handoffManifest: parseHandoffManifest(fixture("expected-handoff.json")),
      prDescriptionProfile: profile,
    });
    const { prDescriptionProfile, ...unchanged } = release;
    expect(prDescriptionProfile).toEqual(profile);
    expect(canonicalJson(unchanged)).toBe(fixture("expected-release.json"));
    expect(parseReleaseManifest(canonicalJson(release))).toEqual(release);
    expect(
      buildReleaseRegistrationCandidateFields(release).prDescriptionProfile,
    ).toEqual(profile);
    for (const auxiliaryExtensions of [
      null,
      {},
      [profile, profile],
      [{ ...profile, extensionId: "unknown.v1" }],
      [{ extensionId: "pr-description.v1" }],
      [{ ...profile, canonicalizerDigest: "invalid" }],
      [{ ...profile, enabled: true }],
    ]) {
      expect(() =>
        parseProtocolGenerationManifest(
          JSON.stringify({ ...generated, auxiliaryExtensions }),
        ),
      ).toThrow();
    }
    expect(() =>
      parseReleaseManifest(
        canonicalJson({
          ...release,
          prDescriptionProfile: { ...profile, enabled: true },
        }),
      ),
    ).toThrow("fields must be exactly");
  });

  it("binds the generated MCP descriptor through release and registration without changing legacy bytes", () => {
    const contextToolsProfile = {
      extensionId: "context-tools.v1",
      descriptorDigest:
        "sha256:c188ad0a29581317f23b6aec3f103a7419f67576bea6fb3dc9910cf9ca3a3f7a",
    };
    const generated = JSON.parse(fixture("contract-source/manifest.json"));
    expect(
      parseProtocolGenerationManifest(
        JSON.stringify({ ...generated, contextToolsProfile }),
      ).contextToolsProfile,
    ).toEqual(contextToolsProfile);
    const legacy = parseReleaseManifest(fixture("expected-release.json"));
    expect(Object.hasOwn(legacy, "contextToolsProfile")).toBe(false);
    const release = buildReleaseManifest({
      ...legacy,
      handoffManifest: parseHandoffManifest(fixture("expected-handoff.json")),
      contextToolsProfile,
    });
    const { contextToolsProfile: actual, ...base } = release;
    expect(actual).toEqual(contextToolsProfile);
    expect(canonicalJson(base)).toBe(fixture("expected-release.json"));
    expect(parseReleaseManifest(canonicalJson(release))).toEqual(release);
    expect(
      buildReleaseRegistrationCandidateFields(release).contextToolsProfile,
    ).toEqual(contextToolsProfile);
    for (const invalid of [
      null,
      { ...contextToolsProfile, enabled: true },
      { ...contextToolsProfile, descriptorDigest: "bad" },
      { ...contextToolsProfile, extensionId: "unknown.v1" },
    ]) {
      expect(() =>
        parseReleaseManifest(
          canonicalJson({ ...release, contextToolsProfile: invalid }),
        ),
      ).toThrow();
      expect(() =>
        parseProtocolGenerationManifest(
          JSON.stringify({ ...generated, contextToolsProfile: invalid }),
        ),
      ).toThrow();
    }
  });

  it("rejects non-canonical JSON and unknown fields", () => {
    expect(() => parseCanonicalJson('{"b":2,"a":1}\n', "fixture")).toThrow(
      "canonical sorted JSON",
    );
    const handoff = JSON.parse(fixture("expected-handoff.json"));
    handoff.untrusted = true;
    expect(() => parseHandoffManifest(canonicalJson(handoff))).toThrow(
      "fields must be exactly",
    );
  });

  it("strictly validates bounded context gateway release metadata", () => {
    const metadata = canonicalJson({
      artifactKind: "reviewrouter-context-gateway",
      contextGatewayEntrypointDigest: "d".repeat(64),
      contextGatewayEntrypointPath: "dist/context-gateway.js",
      contextGatewayPolicyVersion: "context-gateway-v3",
      metadataVersion: 1,
    });
    expect(parseContextGatewayReleaseMetadata(metadata)).toMatchObject({
      contextGatewayPolicyVersion: "context-gateway-v3",
    });
    const legacyWithAuthenticatedSupport = canonicalJson({
      ...JSON.parse(metadata),
      supportedContextGatewayPolicyVersions: [
        "context-gateway-v3",
        "context-gateway-v4",
      ],
    });
    expect(
      parseContextGatewayReleaseMetadata(legacyWithAuthenticatedSupport),
    ).toMatchObject({
      supportedContextGatewayPolicyVersions: [
        "context-gateway-v3",
        "context-gateway-v4",
      ],
    });

    const investigation = investigationGatewayMetadata();
    expect(
      parseContextGatewayReleaseMetadata(canonicalJson(investigation)),
    ).toEqual(investigation);
    expect(() =>
      parseContextGatewayReleaseMetadata(
        canonicalJson({
          ...investigation,
          supportedContextGatewayPolicyVersions: ["context-gateway-v4"],
        }),
      ),
    ).toThrow("authenticated canonical policy set");
    expect(() =>
      parseContextGatewayReleaseMetadata(
        canonicalJson({
          ...investigation,
          reviewInvestigationCoverageProfileHash: "e".repeat(64),
        }),
      ),
    ).toThrow("does not match the authoritative fixture");
    expect(() =>
      parseContextGatewayReleaseMetadata(
        canonicalJson({
          ...JSON.parse(metadata),
          reviewInvestigationCapability:
            REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
        }),
      ),
    ).toThrow("fields must be exactly");
    expect(() =>
      parseContextGatewayReleaseMetadata(`${metadata}${" ".repeat(4_096)}`),
    ).toThrow("oversized");
    expect(() =>
      parseContextGatewayReleaseMetadata(
        canonicalJson({
          ...JSON.parse(metadata),
          contextGatewayEntrypointPath: "../context-gateway.js",
        }),
      ),
    ).toThrow("normalized relative POSIX path");
  });

  it("binds the authenticated v4 investigation profile into manifest v3", () => {
    const handoff = parseHandoffManifest(fixture("expected-handoff.json"));
    const release = buildReleaseManifest({
      agentProfiles: [
        {
          profileRef: "fixture-codex",
          agentKind: "codex",
          binarySha256: "a".repeat(64),
          packageVersion: "0.147.0",
          modelTransports: ["account_gateway"],
          contextGateway: true,
          cancellation: true,
          reviewSkillsVersion: 1,
        },
      ],
      handoffManifest: handoff,
      handoffManifestDigest: sha256Digest(canonicalJson(handoff)),
      actionCommitSha: "d".repeat(40),
      runtimeEntrypointPath: "dist/index.js",
      runtimeEntrypointDigest: "e".repeat(64),
      contextGatewayReleaseMetadata: investigationGatewayMetadata(),
    });

    expect(release).toMatchObject({
      releaseManifestVersion: RELEASE_MANIFEST_VERSION,
      contextGatewayPolicyVersion: "context-gateway-v4",
      supportedContextGatewayPolicyVersions: [
        "context-gateway-v3",
        "context-gateway-v4",
      ],
      reviewInvestigationCapability: REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
      reviewInvestigationCoverageProfileHash:
        capabilityGolden.coverageProfile.sha256,
      reviewInvestigationPolicyHash: capabilityGolden.policy.sha256,
    });
    expect(parseReleaseManifest(canonicalJson(release))).toEqual(release);
    expect(buildReleaseRegistrationCandidateFields(release)).toMatchObject({
      agentProfiles: [
        {
          profileRef: "fixture-codex",
          binarySha256: "a".repeat(64),
          reviewSkillsVersion: 1,
        },
      ],
      contextGatewayPolicyVersion: "context-gateway-v4",
      reviewInvestigationProfile: {
        capability: REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
        coverageProfileHash: capabilityGolden.coverageProfile.sha256,
        policyHash: capabilityGolden.policy.sha256,
      },
    });

    const tamperedHash = {
      ...release,
      reviewInvestigationPolicyHash: "f".repeat(64),
    };
    expect(() => parseReleaseManifest(canonicalJson(tamperedHash))).toThrow(
      "investigation hashes do not match the authoritative fixture",
    );
    const reorderedPolicies = {
      ...release,
      supportedContextGatewayPolicyVersions: [
        "context-gateway-v4",
        "context-gateway-v3",
      ],
    };
    expect(() =>
      parseReleaseManifest(canonicalJson(reorderedPolicies)),
    ).toThrow("authenticated canonical policy set");
  });

  it("keeps v2 manifests legacy-only and rejects manual v4 claims", () => {
    const legacy = JSON.parse(fixture("expected-release.json"));
    expect(parseReleaseManifest(canonicalJson(legacy))).toEqual(legacy);
    expect(buildReleaseRegistrationCandidateFields(legacy)).toMatchObject({
      contextGatewayPolicyVersion: "context-gateway-v3",
      reviewInvestigationProfile: null,
    });
    expect(() =>
      parseReleaseManifest(
        canonicalJson({
          ...legacy,
          reviewInvestigationCapability:
            REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
          reviewInvestigationCoverageProfileHash:
            REVIEW_INVESTIGATION_RELEASE_COVERAGE_PROFILE_HASH,
          reviewInvestigationPolicyHash:
            REVIEW_INVESTIGATION_RELEASE_POLICY_HASH,
          supportedContextGatewayPolicyVersions: [
            "context-gateway-v3",
            "context-gateway-v4",
          ],
        }),
      ),
    ).toThrow("fields must be exactly");

    legacy.contextGatewayPolicyVersion = "context-gateway-v4";
    expect(() => parseReleaseManifest(canonicalJson(legacy))).toThrow(
      "cannot claim investigation capability",
    );

    const handoff = parseHandoffManifest(fixture("expected-handoff.json"));
    expect(() =>
      buildReleaseManifest({
        agentProfiles: [
          {
            profileRef: "fixture-codex",
            agentKind: "codex",
            binarySha256: "a".repeat(64),
            packageVersion: "0.147.0",
            modelTransports: ["account_gateway"],
            contextGateway: true,
            cancellation: true,
          },
        ],
        handoffManifest: handoff,
        handoffManifestDigest: sha256Digest(canonicalJson(handoff)),
        actionCommitSha: "d".repeat(40),
        runtimeEntrypointPath: "dist/index.js",
        runtimeEntrypointDigest: "e".repeat(64),
        contextGatewayPolicyVersion: "context-gateway-v4",
        contextGatewayEntrypointPath: "dist/context-gateway.js",
        contextGatewayEntrypointDigest: "f".repeat(64),
      }),
    ).toThrow("require authenticated contextGatewayReleaseMetadata");
  });

  it("requires lowercase full commit SHAs and safe generated paths", () => {
    expect(() => assertFullCommitSha("a".repeat(39), "sha")).toThrow(
      "40-character",
    );
    expect(() => assertFullCommitSha("A".repeat(40), "sha")).toThrow(
      "lowercase",
    );

    const parsed = parseHandoffManifest(fixture("expected-handoff.json"));
    const descriptor = {
      ...parsed,
      generatedFileDigests: {
        ...parsed.generatedFileDigests,
      } as Record<string, string>,
    };
    delete (descriptor as Record<string, unknown>).saasSourceCommit;
    delete (descriptor as Record<string, unknown>)
      .expectedPublicActionBaseCommit;
    descriptor.generatedFileDigests["../escape.ts"] = "d".repeat(64);
    expect(() => validateContractExportDescriptor(descriptor)).toThrow(
      "normalized relative POSIX path",
    );
  });

  it("does not allow the base commit to masquerade as a final release", () => {
    const handoff = parseHandoffManifest(fixture("expected-handoff.json"));
    expect(() =>
      buildReleaseManifest({
        agentProfiles: [
          {
            profileRef: "fixture-codex",
            agentKind: "codex",
            binarySha256: "a".repeat(64),
            packageVersion: "0.147.0",
            modelTransports: ["account_gateway"],
            contextGateway: true,
            cancellation: true,
          },
        ],
        handoffManifest: handoff,
        handoffManifestDigest: sha256Digest(canonicalJson(handoff)),
        actionCommitSha: handoff.expectedPublicActionBaseCommit,
        runtimeEntrypointPath: "dist/index.js",
        runtimeEntrypointDigest: "e".repeat(64),
        contextGatewayPolicyVersion: "context-gateway-v3",
        contextGatewayEntrypointPath: "dist/context-gateway.js",
        contextGatewayEntrypointDigest: "f".repeat(64),
      }),
    ).toThrow("committed handoff and rebuilt runtime bundle");
  });
});

function fixture(relativePath: string): string {
  return readFileSync(join(fixtureRoot, relativePath), "utf8");
}

function investigationGatewayMetadata() {
  return {
    artifactKind: "reviewrouter-context-gateway",
    contextGatewayEntrypointDigest: "f".repeat(64),
    contextGatewayEntrypointPath: "dist/context-gateway.js",
    contextGatewayPolicyVersion: "context-gateway-v4",
    metadataVersion: 2,
    reviewInvestigationCapability: REVIEW_INVESTIGATION_RELEASE_CAPABILITY,
    reviewInvestigationCoverageProfileHash:
      REVIEW_INVESTIGATION_RELEASE_COVERAGE_PROFILE_HASH,
    reviewInvestigationPolicyHash: REVIEW_INVESTIGATION_RELEASE_POLICY_HASH,
    supportedContextGatewayPolicyVersions: [
      "context-gateway-v3",
      "context-gateway-v4",
    ],
  };
}
