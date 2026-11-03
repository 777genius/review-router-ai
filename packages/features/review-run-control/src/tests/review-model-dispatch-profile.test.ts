import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseReviewModelDispatchProfileV2,
  parseReviewModelDispatchProfile,
  parseReviewModelDispatchCapabilityV2,
  parseReviewModelDispatchCapability,
  parseReviewModelDispatchClaimV2,
  parseReviewModelDispatchClaimForCapability,
  reviewModelDispatchCapacity128Contract,
  reviewModelDispatchCapacity128DescriptorDigest,
  reviewModelDispatchCapacityPolicyMatches,
  parseReviewModelDispatchSettlementV2,
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
} from "@reviewrouter/shared";
import { canonicalJson } from "../domain/review-run-control-types";
import {
  cloneProducerRelease,
  createProducerRelease,
  producerReleaseImmutableKey,
} from "../domain/producer-release";
import {
  ConfiguredProducerReleaseAttestationRegistry,
  readConfiguredProducerReleaseAttestations,
  reviewRunProducerReleaseAttestationsEnv,
} from "../infrastructure/configured-producer-release-attestation";
import { createTrustedProducerReleaseMaterializer } from "../infrastructure/trusted-producer-release-materializer";
import { createReviewRunControlTestKit } from "../testing/review-run-control-test-kit";
import { hashB, hashC, releaseCandidate } from "./fixtures";

const qualifiedAgentProfiles = [
  {
    profileRef: "ocr-controlled-responses",
    agentKind: "ocr" as const,
    binarySha256: "a".repeat(64),
    packageVersion: "1.0.0",
    modelTransports: ["provider_api" as const],
    contextGateway: false as const,
    cancellation: true as const,
    reviewSkillsVersion: 1 as const,
  },
];

const profile = {
  extensionId: "review-model-dispatch.v2" as const,
  descriptorDigest: reviewModelDispatchDescriptorDigest,
  policyVersion: "model-dispatch-policy.v2" as const,
  transports: ["runner_local_responses" as const],
  wireProtocols: ["openai-responses" as const, "codex-responses" as const],
  defaultAgentProfileRefs: {
    runner_local_responses: "ocr-controlled-responses",
  },
  limits: {
    maxRequests: 32,
    maxConcurrentRequests: 1 as const,
    maxRequestBytes: 16 * 1024 * 1024,
    maxResponseBytes: 8 * 1024 * 1024,
    maxOutputTokens: 32768,
  },
};

describe("versioned model dispatch approval", () => {
  it("pins the exact public descriptor and finite policy without mutating historical release identity", () => {
    expect(
      `sha256:${createHash("sha256").update(canonicalJson(reviewModelDispatchContract)).digest("hex")}`,
    ).toBe(reviewModelDispatchDescriptorDigest);
    const candidate = {
      ...releaseCandidate,
      agentProfiles: qualifiedAgentProfiles,
    };
    const legacy = createProducerRelease(
      candidate,
      new Date("2026-10-21T00:00:00.000Z"),
    );
    expect(legacy).not.toHaveProperty("modelDispatchProfile");
    const declared = createProducerRelease(
      { ...candidate, modelDispatchProfile: profile },
      legacy.registeredAt,
    );
    expect(producerReleaseImmutableKey(declared)).not.toBe(
      producerReleaseImmutableKey(legacy),
    );
    expect(cloneProducerRelease(declared).modelDispatchProfile).toEqual(
      profile,
    );
    expect(cloneProducerRelease(declared).modelDispatchProfile).not.toBe(
      profile,
    );
    expect(
      producerReleaseImmutableKey({
        ...declared,
        modelDispatchProfile: {
          ...profile,
          defaultAgentProfileRefs: {
            runner_local_responses: "different-approved-default",
          },
        },
      }),
    ).not.toBe(producerReleaseImmutableKey(declared));
  });

  it("rejects heuristic defaults, duplicate protocols, unknown fields and budget expansion", () => {
    expect(parseReviewModelDispatchProfileV2(profile)).toEqual(profile);
    for (const value of [
      {
        ...profile,
        transports: ["runner_local_responses", "runner_local_responses"],
      },
      { ...profile, transports: ["arbitrary_proxy"] },
      { ...profile, wireProtocols: ["openai-responses", "openai-responses"] },
      { ...profile, wireProtocols: ["unqualified-protocol"] },
      { ...profile, wireProtocols: [] },
      { ...profile, defaultAgentProfileRefs: {} },
      {
        ...profile,
        defaultAgentProfileRefs: {
          ...profile.defaultAgentProfileRefs,
          hosted_pool: "hidden-default",
        },
      },
      { ...profile, descriptorDigest: `sha256:${"0".repeat(64)}` },
      { ...profile, limits: { ...profile.limits, maxRequests: 33 } },
      { ...profile, limits: { ...profile.limits, maxConcurrentRequests: 2 } },
      { ...profile, endpoint: "https://unapproved.example" },
    ])
      expect(() => parseReviewModelDispatchProfileV2(value)).toThrow();
    expect(() =>
      parseReviewModelDispatchSettlementV2({
        state: "not_dispatched",
        proof: "http_error",
      }),
    ).toThrow();
    expect(() =>
      parseReviewModelDispatchSettlementV2({
        state: "completed",
        receipt: { status: 200 },
      }),
    ).toThrow();
  });

  it("refuses absent, unqualified and transport-incompatible dispatch defaults", () => {
    const candidate = { ...releaseCandidate, modelDispatchProfile: profile };
    for (const agentProfiles of [
      null,
      [{ ...qualifiedAgentProfiles[0], profileRef: "another-ocr" }],
      [{ ...qualifiedAgentProfiles[0], reviewSkillsVersion: undefined }],
      [
        {
          ...qualifiedAgentProfiles[0],
          agentKind: "codex",
          contextGateway: true,
        },
      ],
      [{ ...qualifiedAgentProfiles[0], modelTransports: ["account_gateway"] }],
    ]) {
      expect(() =>
        createProducerRelease(
          { ...candidate, agentProfiles } as Parameters<
            typeof createProducerRelease
          >[0],
          new Date("2026-10-21T00:00:00.000Z"),
        ),
      ).toThrow();
    }
  });

  it("rejects dispatch transports with no compatible wire protocol", () => {
    expect(() =>
      createProducerRelease(
        {
          ...releaseCandidate,
          agentProfiles: qualifiedAgentProfiles,
          modelDispatchProfile: {
            ...profile,
            transports: ["runner_local_anthropic"],
            wireProtocols: ["openai-responses"],
            defaultAgentProfileRefs: {
              runner_local_anthropic: "ocr-controlled-responses",
            },
          },
        },
        new Date("2026-10-21T00:00:00.000Z"),
      ),
    ).toThrow("model dispatch default agent is incompatible");
  });

  it("carries approved dispatch facts through configured attestation and materialization", async () => {
    const kit = createReviewRunControlTestKit();
    const attestations = readConfiguredProducerReleaseAttestations({
      [reviewRunProducerReleaseAttestationsEnv]: JSON.stringify([
        {
          ...releaseCandidate,
          agentProfiles: qualifiedAgentProfiles,
          reviewInvestigationCapability: null,
          reviewInvestigationCoverageProfileHash: null,
          reviewInvestigationPolicyHash: null,
          contextGatewayPolicyVersion: null,
          contextGatewayEntrypointDigest: null,
          canonicalizerDigest: hashC,
          modelDispatchProfile: profile,
        },
      ]),
    });
    expect(attestations[0]?.modelDispatchProfile).toEqual(profile);
    const registry = new ConfiguredProducerReleaseAttestationRegistry(
      attestations,
      kit.store,
    );
    const result = await registry.attest({
      actionCommitSha: releaseCandidate.actionCommitSha,
      expectedSchemaDigest: hashB,
      expectedCanonicalizerDigest: hashC,
    });
    expect(result.status).toBe("attested");
    if (result.status !== "attested") throw new Error("fixture");
    const materializer = createTrustedProducerReleaseMaterializer({
      digest: kit.digest,
      producerReleases: kit.control.producerReleases,
      releaseQueries: kit.store,
      protocolLimitsQueries: kit.store,
      operationalSloQueries: kit.store,
    });
    await materializer.ensureRegistered(result.release);
    expect(
      (
        await kit.store.findProducerReleaseById(
          result.release.producerReleaseId,
        )
      )?.modelDispatchProfile,
    ).toEqual(profile);
    expect(
      (
        await registry.attest({
          actionCommitSha: releaseCandidate.actionCommitSha,
          expectedSchemaDigest: hashB,
          expectedCanonicalizerDigest: hashC,
        })
      ).status,
    ).toBe("attested");
  });
});

describe("explicit capacity128 model dispatch policy", () => {
  const capacityProfile = {
    ...profile,
    descriptorDigest: reviewModelDispatchCapacity128DescriptorDigest,
    policyVersion: reviewModelDispatchCapacity128Contract.policyVersion,
    limits: { ...profile.limits, maxRequests: 128 },
  };
  const legacyCapability = {
    ...profile.limits,
    extensionId: "review-model-dispatch.v2" as const,
    version: 2 as const,
    routeIdentityHash: "a".repeat(64),
    transport: "runner_local_responses" as const,
    wireProtocol: "openai-responses" as const,
    outputTokenLimit: "upstream_request" as const,
    providerIndex: 0,
    model: "qualified-model",
    deadline: "2126-10-21T00:00:00.000Z",
  };
  const capacityCapability = {
    ...legacyCapability,
    capacityPolicy: "model-dispatch-policy.capacity128.v1" as const,
    maxRequests: 128,
  };
  const claim = (requestOrdinal: number) => ({
    dispatchVersion: 2,
    dispatchId: `rr-model-${"a".repeat(64)}`,
    executionId: "execution",
    workSlotId: "discovery",
    attemptOrdinal: 1,
    requestOrdinal,
    leaseId: "lease",
    leaseCapability: "synthetic-test-capability",
    fencingToken: "1",
    preparedManifestKey: "manifest",
    routeIdentityHash: "a".repeat(64),
    providerRequestEnvelopeHash: "b".repeat(64),
    requestBytes: 1024,
    maxOutputTokens: 1024,
  });

  it("adds a distinct canonical descriptor and attested profile without reinterpreting legacy32", () => {
    expect(
      `sha256:${createHash("sha256").update(canonicalJson(reviewModelDispatchCapacity128Contract)).digest("hex")}`,
    ).toBe(
      "sha256:d529a458a0d6e6644df1d8e341f42988b5c137920f6883cd1467bfe524e8aadb",
    );
    expect(reviewModelDispatchCapacity128DescriptorDigest).not.toBe(
      reviewModelDispatchDescriptorDigest,
    );
    expect(reviewModelDispatchContract.maxRequests).toBe(32);
    expect(parseReviewModelDispatchProfile(profile)).toEqual(profile);
    expect(parseReviewModelDispatchProfile(capacityProfile)).toEqual(
      capacityProfile,
    );
    expect(() => parseReviewModelDispatchProfileV2(capacityProfile)).toThrow();
    const candidate = {
      ...releaseCandidate,
      agentProfiles: qualifiedAgentProfiles,
    };
    const oldRelease = createProducerRelease(
      { ...candidate, modelDispatchProfile: profile },
      new Date("2026-10-21"),
    );
    const newRelease = createProducerRelease(
      { ...candidate, modelDispatchProfile: capacityProfile },
      oldRelease.registeredAt,
    );
    expect(cloneProducerRelease(newRelease).modelDispatchProfile).toEqual(
      capacityProfile,
    );
    expect(producerReleaseImmutableKey(newRelease)).not.toBe(
      producerReleaseImmutableKey(oldRelease),
    );
    expect(
      readConfiguredProducerReleaseAttestations({
        [reviewRunProducerReleaseAttestationsEnv]: JSON.stringify([
          {
            ...candidate,
            canonicalizerDigest: hashC,
            reviewInvestigationCapability: null,
            reviewInvestigationCoverageProfileHash: null,
            reviewInvestigationPolicyHash: null,
            contextGatewayPolicyVersion: null,
            contextGatewayEntrypointDigest: null,
            modelDispatchProfile: capacityProfile,
          },
        ]),
      })[0]?.modelDispatchProfile,
    ).toEqual(capacityProfile);
  });

  it("denies unapproved and mixed policy/digest identities even below32, and capacity129", () => {
    for (const value of [
      { ...profile, limits: { ...profile.limits, maxRequests: 33 } },
      {
        ...capacityProfile,
        descriptorDigest: reviewModelDispatchDescriptorDigest,
      },
      { ...capacityProfile, policyVersion: "model-dispatch-policy.v2" },
      {
        ...capacityProfile,
        policyVersion: "model-dispatch-policy.capacity256.v1",
      },
      {
        ...capacityProfile,
        descriptorDigest: reviewModelDispatchDescriptorDigest,
        limits: profile.limits,
      },
      {
        ...capacityProfile,
        limits: { ...capacityProfile.limits, maxRequests: 129 },
      },
      {
        ...capacityProfile,
        limits: { ...capacityProfile.limits, maxConcurrentRequests: 2 },
      },
    ])
      expect(() => parseReviewModelDispatchProfile(value)).toThrow();
    expect(
      reviewModelDispatchCapacityPolicyMatches(
        {
          ...capacityProfile,
          descriptorDigest: reviewModelDispatchDescriptorDigest,
        },
        capacityCapability,
      ),
    ).toBe(false);
    expect(
      reviewModelDispatchCapacityPolicyMatches(profile, legacyCapability),
    ).toBe(true);
    expect(
      reviewModelDispatchCapacityPolicyMatches(
        capacityProfile,
        capacityCapability,
      ),
    ).toBe(true);
    expect(
      reviewModelDispatchCapacityPolicyMatches(profile, {
        ...capacityCapability,
        maxRequests: 32,
      }),
    ).toBe(false);
    expect(
      reviewModelDispatchCapacityPolicyMatches(
        capacityProfile,
        legacyCapability,
      ),
    ).toBe(false);
  });

  it("requires the frozen discriminator and preserves legacy32/33 and new128/129 boundaries", () => {
    expect(parseReviewModelDispatchCapabilityV2(legacyCapability)).toEqual(
      legacyCapability,
    );
    expect(parseReviewModelDispatchCapability(capacityCapability)).toEqual(
      capacityCapability,
    );
    expect(() =>
      parseReviewModelDispatchCapabilityV2(capacityCapability),
    ).toThrow();
    for (const value of [
      { ...legacyCapability, maxRequests: 33 },
      { ...capacityCapability, capacityPolicy: "model-dispatch-policy.v2" },
      { ...capacityCapability, maxRequests: 129 },
      {
        ...capacityCapability,
        descriptorDigest: reviewModelDispatchCapacity128DescriptorDigest,
      },
    ])
      expect(() => parseReviewModelDispatchCapability(value)).toThrow();
    expect(parseReviewModelDispatchClaimV2(claim(32)).requestOrdinal).toBe(32);
    expect(() => parseReviewModelDispatchClaimV2(claim(33))).toThrow();
    expect(() =>
      parseReviewModelDispatchClaimForCapability(claim(33), legacyCapability),
    ).toThrow();
    for (const ordinal of [32, 33, 128])
      expect(
        parseReviewModelDispatchClaimForCapability(
          claim(ordinal),
          capacityCapability,
        ).requestOrdinal,
      ).toBe(ordinal);
    expect(() =>
      parseReviewModelDispatchClaimForCapability(
        claim(129),
        capacityCapability,
      ),
    ).toThrow();
    expect(() =>
      parseReviewModelDispatchClaimForCapability(claim(17), {
        ...capacityCapability,
        maxRequests: 16,
      }),
    ).toThrow();
    expect(() =>
      parseReviewModelDispatchClaimForCapability(
        { ...claim(1), capacityPolicy: capacityCapability.capacityPolicy },
        capacityCapability,
      ),
    ).toThrow();
    expect(() =>
      parseReviewModelDispatchClaimForCapability(
        { ...claim(1), attemptOrdinal: 2 },
        capacityCapability,
      ),
    ).toThrow();
    expect(() =>
      parseReviewModelDispatchClaimForCapability(
        { ...claim(1), requestBytes: 16777217 },
        capacityCapability,
      ),
    ).toThrow();
    expect(() =>
      parseReviewModelDispatchClaimForCapability(
        { ...claim(1), maxOutputTokens: 32769 },
        capacityCapability,
      ),
    ).toThrow();
  });
});
