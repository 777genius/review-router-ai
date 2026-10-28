import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createProducerRelease,
  parseProducerContextToolsProfile,
  producerReleaseImmutableKey,
} from "../domain/producer-release";
import { ProducerReleaseAttestationStatus } from "../application/ports/producer-release-attestation-ports";
import {
  ConfiguredProducerReleaseAttestationRegistry,
  readConfiguredProducerReleaseAttestations,
  reviewRunProducerReleaseAttestationsEnv,
} from "../infrastructure/configured-producer-release-attestation";
import { createTrustedProducerReleaseMaterializer } from "../infrastructure/trusted-producer-release-materializer";
import { producerReleaseToDomain } from "../infrastructure/prisma/prisma-review-run-control-mappers";
import { createReviewRunControlTestKit } from "../testing/review-run-control-test-kit";
import { hashB, hashC, releaseCandidate } from "./fixtures";

const profile = {
  extensionId: "context-tools.v1" as const,
  descriptorDigest: `sha256:${"1".repeat(64)}`,
};
const now = new Date("2026-10-21T00:00:00.000Z");
const attestInput = {
  actionCommitSha: releaseCandidate.actionCommitSha,
  expectedSchemaDigest: hashB,
  expectedCanonicalizerDigest: hashC,
};
const attestation = () => ({
  ...releaseCandidate,
  canonicalizerDigest: hashC,
  contextGatewayPolicyVersion: null,
  contextGatewayEntrypointDigest: null,
  contextToolsProfile: profile,
});

describe("producer context tools extension identity", () => {
  it("keeps old immutable bytes unchanged and makes a declared profile part of identity", () => {
    const legacy = createProducerRelease(releaseCandidate, now);
    expect(legacy).not.toHaveProperty("contextToolsProfile");
    expect(
      createHash("sha256")
        .update(producerReleaseImmutableKey(legacy))
        .digest("hex"),
    ).toBe("edf66a624bdb6baff0625f58a47f44b337cbc43c6454917f9d0cbd2607008f08");
    const profiled = createProducerRelease(
      { ...releaseCandidate, contextToolsProfile: profile },
      now,
    );
    expect(profiled.contextToolsProfile).toEqual(profile);
    expect(profiled.contextToolsProfile).not.toBe(profile);
    expect(producerReleaseImmutableKey(profiled)).not.toBe(
      producerReleaseImmutableKey(legacy),
    );
    expect(
      producerReleaseImmutableKey({
        ...profiled,
        contextToolsProfile: {
          ...profile,
          descriptorDigest: `sha256:${"2".repeat(64)}`,
        },
      }),
    ).not.toBe(producerReleaseImmutableKey(profiled));
  });

  it("rejects unknown profile fields, versions, null and malformed digests", () => {
    const invalid: unknown[] = [
      null,
      {},
      { ...profile, version: 1 },
      { ...profile, extra: true },
      { ...profile, extensionId: "context-tools.v2" },
      { ...profile, descriptorDigest: "1".repeat(64) },
      { ...profile, descriptorDigest: `sha256:${"A".repeat(64)}` },
    ];
    for (const value of invalid) {
      expect(() => parseProducerContextToolsProfile(value)).toThrow(
        "producer_context_tools_profile_invalid",
      );
      expect(() =>
        readConfiguredProducerReleaseAttestations({
          [reviewRunProducerReleaseAttestationsEnv]: JSON.stringify([
            { ...attestation(), contextToolsProfile: value },
          ]),
        }),
      ).toThrow("producer_context_tools_profile_invalid");
    }
    expect(parseProducerContextToolsProfile(profile)).toEqual(profile);
    const { contextToolsProfile: _profile, ...old } = attestation();
    void _profile;
    expect(
      readConfiguredProducerReleaseAttestations({
        [reviewRunProducerReleaseAttestationsEnv]: JSON.stringify([old]),
      })[0],
    ).not.toHaveProperty("contextToolsProfile");
  });

  it("omits a persisted SQL null profile and validates declared JSON during mapping", () => {
    const {
      agentProfiles: _agents,
      reviewInvestigationProfile: _investigation,
      ...legacy
    } = createProducerRelease(releaseCandidate, now);
    void _agents;
    void _investigation;
    const row = {
      ...legacy,
      distributionKind: "public_reusable" as const,
      state: "registered" as const,
      agentProfilesJson: null,
      reviewInvestigationCapability: null,
      reviewInvestigationCoverageProfileHash: null,
      reviewInvestigationPolicyHash: null,
      contextToolsProfile: null,
      prDescriptionProfile: null,
      lifecycleVerificationProfile: null,
    };
    expect(producerReleaseToDomain(row)).not.toHaveProperty(
      "contextToolsProfile",
    );
    expect(
      producerReleaseToDomain({ ...row, contextToolsProfile: profile })
        .contextToolsProfile,
    ).toEqual(profile);
    expect(() =>
      producerReleaseToDomain({
        ...row,
        contextToolsProfile: { ...profile, version: 2 },
      }),
    ).toThrow("producer_context_tools_profile_invalid");
  });

  it("materializes the profile and denies immutable drift and revocation", async () => {
    const kit = createReviewRunControlTestKit();
    const release = createProducerRelease(
      { ...releaseCandidate, contextToolsProfile: profile },
      now,
    );
    const materializer = createTrustedProducerReleaseMaterializer({
      digest: kit.digest,
      producerReleases: kit.control.producerReleases,
      releaseQueries: kit.store,
      protocolLimitsQueries: kit.store,
      operationalSloQueries: kit.store,
    });
    await materializer.ensureRegistered(release);
    expect(
      (await kit.store.findProducerReleaseById(release.producerReleaseId))
        ?.contextToolsProfile,
    ).toEqual(profile);
    await expect(
      materializer.ensureRegistered({
        ...release,
        contextToolsProfile: {
          ...profile,
          descriptorDigest: `sha256:${"2".repeat(64)}`,
        },
      }),
    ).rejects.toThrow("trusted_producer_release_conflict");
    await kit.control.producerReleases.revokeProducerRelease(
      release.producerReleaseId,
    );
    await expect(materializer.ensureRegistered(release)).rejects.toThrow(
      "trusted_producer_release_revoked",
    );
  });

  it("attests the exact optional profile and rejects old rows, changed profiles and revoked releases", async () => {
    const kit = createReviewRunControlTestKit();
    const registry = new ConfiguredProducerReleaseAttestationRegistry(
      readConfiguredProducerReleaseAttestations({
        [reviewRunProducerReleaseAttestationsEnv]: JSON.stringify([
          attestation(),
        ]),
      }),
      kit.store,
    );
    await expect(registry.attest(attestInput)).resolves.toMatchObject({
      status: ProducerReleaseAttestationStatus.Attested,
      release: { contextToolsProfile: profile },
    });
    await kit.store.registerProducerRelease(
      createProducerRelease(releaseCandidate, now),
    );
    await expect(registry.attest(attestInput)).resolves.toEqual({
      status: ProducerReleaseAttestationStatus.Mismatch,
    });
    const otherKit = createReviewRunControlTestKit();
    const release = createProducerRelease(
      { ...releaseCandidate, contextToolsProfile: profile },
      now,
    );
    await otherKit.store.registerProducerRelease(release);
    const matching = new ConfiguredProducerReleaseAttestationRegistry(
      [attestation()],
      otherKit.store,
    );
    await expect(matching.attest(attestInput)).resolves.toMatchObject({
      status: ProducerReleaseAttestationStatus.Attested,
    });
    const drift = new ConfiguredProducerReleaseAttestationRegistry(
      [
        {
          ...attestation(),
          contextToolsProfile: {
            ...profile,
            descriptorDigest: `sha256:${"2".repeat(64)}`,
          },
        },
      ],
      otherKit.store,
    );
    await expect(drift.attest(attestInput)).resolves.toEqual({
      status: ProducerReleaseAttestationStatus.Mismatch,
    });
    await otherKit.store.revokeProducerRelease({
      producerReleaseId: release.producerReleaseId,
      revokedAt: now,
    });
    await expect(matching.attest(attestInput)).resolves.toEqual({
      status: ProducerReleaseAttestationStatus.Revoked,
    });
  });
  it("materializes lifecycle approval through trusted attestation and refuses profile drift", async () => {
    const kit = createReviewRunControlTestKit();
    const lifecycleVerificationProfile = {
      extensionId: "lifecycle-verification.v1" as const,
      descriptorDigest: `sha256:${"3".repeat(64)}`,
    };
    const registry = new ConfiguredProducerReleaseAttestationRegistry(
      readConfiguredProducerReleaseAttestations({
        [reviewRunProducerReleaseAttestationsEnv]: JSON.stringify([
          { ...attestation(), lifecycleVerificationProfile },
        ]),
      }),
      kit.store,
    );
    const attested = await registry.attest(attestInput);
    expect(attested).toMatchObject({
      status: ProducerReleaseAttestationStatus.Attested,
      release: { lifecycleVerificationProfile },
    });
    if (attested.status !== ProducerReleaseAttestationStatus.Attested)
      throw new Error("attestation failed");
    const materializer = createTrustedProducerReleaseMaterializer({
      digest: kit.digest,
      producerReleases: kit.control.producerReleases,
      releaseQueries: kit.store,
      protocolLimitsQueries: kit.store,
      operationalSloQueries: kit.store,
    });
    await materializer.ensureRegistered(attested.release);
    expect(
      (
        await kit.store.findProducerReleaseById(
          releaseCandidate.producerReleaseId,
        )
      )?.lifecycleVerificationProfile,
    ).toEqual(lifecycleVerificationProfile);
    await expect(
      materializer.ensureRegistered({
        ...attested.release,
        lifecycleVerificationProfile: {
          ...lifecycleVerificationProfile,
          descriptorDigest: `sha256:${"4".repeat(64)}`,
        },
      }),
    ).rejects.toThrow("trusted_producer_release_conflict");
    await expect(registry.attest(attestInput)).resolves.toMatchObject({
      status: ProducerReleaseAttestationStatus.Attested,
    });
  });
});
