import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseReviewModelDispatchProfileV2,
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

const profile = {
  extensionId: "review-model-dispatch.v2" as const,
  descriptorDigest: reviewModelDispatchDescriptorDigest,
  policyVersion: "model-dispatch-policy.v2" as const,
  transports: ["runner_local_responses" as const],
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
    const legacy = createProducerRelease(
      releaseCandidate,
      new Date("2026-10-21T00:00:00.000Z"),
    );
    expect(legacy).not.toHaveProperty("modelDispatchProfile");
    const declared = createProducerRelease(
      { ...releaseCandidate, modelDispatchProfile: profile },
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

  it("carries approved dispatch facts through configured attestation and materialization", async () => {
    const kit = createReviewRunControlTestKit();
    const attestations = readConfiguredProducerReleaseAttestations({
      [reviewRunProducerReleaseAttestationsEnv]: JSON.stringify([
        {
          ...releaseCandidate,
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
