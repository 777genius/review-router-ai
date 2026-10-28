import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ImmutableRegistryWriteStatus,
  ProducerReleaseRevocationStatus,
} from "../application/ports/producer-release-ports";
import {
  ScmRepositoryIdentityBindingStatus,
  ScmRepositoryIdentityResolveStatus,
} from "../application/ports/scm-repository-identity-ports";
import {
  ProducerReleaseState,
  ReviewRunControlErrorCode,
  ScmProvider,
} from "../domain/review-run-control-types";
import { createReviewRunControlTestKit } from "../testing/review-run-control-test-kit";
import { ReviewMutationAuthorityCommandKind } from "../application/use-cases/manage-review-mutation-authority";
import { reviewMutationAuthorityProofReference } from "../domain/review-mutation-authority-proof";
import {
  hashA,
  hashB,
  hashC,
  limits,
  limitsDigest,
  releaseCandidate,
  sloDigest,
  sloThresholds,
} from "./fixtures";
import {
  canonicalReviewProtocolLimits,
  createProducerRelease,
  producerReleaseImmutableKey,
  parseProducerPrDescriptionProfile,
  parseProducerLifecycleVerificationProfile,
  cloneProducerRelease,
  reviewInvestigationCapabilityV1,
  type ProducerReviewInvestigationProfile,
} from "../domain/producer-release";

describe("immutable release registries", () => {
  it("keeps historical immutable keys stable and binds exact PR description approval", () => {
    const legacy = createProducerRelease(releaseCandidate, new Date(0));
    expect(Object.hasOwn(legacy, "prDescriptionProfile")).toBe(false);
    expect(
      createHash("sha256")
        .update(producerReleaseImmutableKey(legacy))
        .digest("hex"),
    ).toBe("edf66a624bdb6baff0625f58a47f44b337cbc43c6454917f9d0cbd2607008f08");
    expect(
      producerReleaseImmutableKey({ ...legacy, prDescriptionProfile: null }),
    ).toBe(producerReleaseImmutableKey(legacy));
    const profile = {
      extensionId: "pr-description.v1" as const,
      canonicalizerDigest: hashA,
    };
    const approved = createProducerRelease(
      { ...releaseCandidate, prDescriptionProfile: profile },
      new Date(0),
    );
    profile.canonicalizerDigest = hashB;
    expect(approved.prDescriptionProfile?.canonicalizerDigest).toBe(hashA);
    expect(producerReleaseImmutableKey(approved)).not.toBe(
      producerReleaseImmutableKey(legacy),
    );
    expect(producerReleaseImmutableKey(approved)).not.toBe(
      producerReleaseImmutableKey({
        ...approved,
        prDescriptionProfile: profile,
      }),
    );
    for (const malformed of [
      { extensionId: "pr-description.v2", canonicalizerDigest: hashA },
      { extensionId: "pr-description.v1", canonicalizerDigest: "invalid" },
      {
        extensionId: "pr-description.v1",
        canonicalizerDigest: hashA,
        enabled: true,
      },
    ]) {
      expect(() => parseProducerPrDescriptionProfile(malformed)).toThrow();
    }
  });

  it("rejects caller-supplied profile digests that do not match canonical bytes", async () => {
    const kit = createReviewRunControlTestKit();
    await expect(
      kit.control.producerReleases.registerProtocolLimitsProfile({
        protocolLimitsProfileId: "limits-forged",
        limitsDigest: hashA,
        limits,
      }),
    ).rejects.toMatchObject({
      code: ReviewRunControlErrorCode.ImmutableConflict,
      message: "protocol_limits_digest_mismatch",
    });
    await expect(
      kit.control.producerReleases.registerOperationalSloProfile({
        operationalSloProfileId: "slo-forged",
        sloDigest: hashB,
        thresholds: sloThresholds,
        ownerRefs: ["team-reviewrouter"],
        runbookRefs: ["runbook/review-v2"],
      }),
    ).rejects.toMatchObject({
      code: ReviewRunControlErrorCode.ImmutableConflict,
      message: "operational_slo_digest_mismatch",
    });
  });

  it("registers immutable profiles/release, restores exact retries, and rejects rebinding", async () => {
    const kit = createReviewRunControlTestKit();
    const firstLimits =
      await kit.control.producerReleases.registerProtocolLimitsProfile({
        protocolLimitsProfileId: "limits-1",
        limitsDigest,
        limits,
      });
    kit.clock.advance(1_000);
    const retriedLimits =
      await kit.control.producerReleases.registerProtocolLimitsProfile({
        protocolLimitsProfileId: "limits-1",
        limitsDigest,
        limits,
      });
    expect(firstLimits.status).toBe(ImmutableRegistryWriteStatus.Created);
    expect(retriedLimits.status).toBe(ImmutableRegistryWriteStatus.Restored);

    const changedLimits = { ...limits, maxWorkSlots: limits.maxWorkSlots - 1 };
    const changed =
      await kit.control.producerReleases.registerProtocolLimitsProfile({
        protocolLimitsProfileId: "limits-1",
        limitsDigest: await kit.digest.digestUtf8(
          canonicalReviewProtocolLimits(changedLimits),
        ),
        limits: changedLimits,
      });
    expect(changed.status).toBe(ImmutableRegistryWriteStatus.Conflict);

    await kit.control.producerReleases.registerOperationalSloProfile({
      operationalSloProfileId: "slo-1",
      sloDigest,
      thresholds: sloThresholds,
      ownerRefs: ["team-reviewrouter"],
      runbookRefs: ["runbook/review-v2"],
    });
    const release = await kit.control.producerReleases.registerProducerRelease({
      candidate: releaseCandidate,
      expectedProtocolLimitsDigest: limitsDigest,
      expectedOperationalSloDigest: sloDigest,
    });
    expect(release.status).toBe(ImmutableRegistryWriteStatus.Created);
    const restored = await kit.control.producerReleases.registerProducerRelease(
      {
        candidate: releaseCandidate,
        expectedProtocolLimitsDigest: limitsDigest,
        expectedOperationalSloDigest: sloDigest,
      },
    );
    expect(restored.status).toBe(ImmutableRegistryWriteStatus.Restored);
  });

  it("normalizes a legacy producer release to an explicit null investigation profile", () => {
    const release = createProducerRelease(
      releaseCandidate,
      new Date("2026-07-22T12:00:00.000Z"),
    );

    expect(release.reviewInvestigationProfile).toBeNull();
  });

  it("drops transport-only fields at the producer release domain boundary", () => {
    const candidateWithTransportMetadata = {
      ...releaseCandidate,
      canonicalizerDigest: hashA,
    } as typeof releaseCandidate;

    const release = createProducerRelease(
      candidateWithTransportMetadata,
      new Date("2026-07-22T12:00:00.000Z"),
    );

    expect(release).not.toHaveProperty("canonicalizerDigest");
  });

  it("preserves the complete investigation profile in the immutable release tuple", async () => {
    const kit = createReviewRunControlTestKit();
    await kit.control.producerReleases.registerProtocolLimitsProfile({
      protocolLimitsProfileId: "limits-1",
      limitsDigest,
      limits,
    });
    await kit.control.producerReleases.registerOperationalSloProfile({
      operationalSloProfileId: "slo-1",
      sloDigest,
      thresholds: sloThresholds,
      ownerRefs: ["team-reviewrouter"],
      runbookRefs: ["runbook/review-v2"],
    });
    const reviewInvestigationProfile = {
      capability: reviewInvestigationCapabilityV1,
      coverageProfileHash: hashA,
      policyHash: hashB,
    } as const;
    const candidate = {
      ...releaseCandidate,
      contextGatewayPolicyVersion: "review-context-gateway.v1",
      contextGatewayEntrypointDigest: hashC,
      reviewInvestigationProfile,
    } as const;

    const created = await kit.control.producerReleases.registerProducerRelease({
      candidate,
      expectedProtocolLimitsDigest: limitsDigest,
      expectedOperationalSloDigest: sloDigest,
    });
    expect(created).toMatchObject({
      status: ImmutableRegistryWriteStatus.Created,
      value: { reviewInvestigationProfile },
    });

    const changedProfile =
      await kit.control.producerReleases.registerProducerRelease({
        candidate: {
          ...candidate,
          reviewInvestigationProfile: {
            ...reviewInvestigationProfile,
            policyHash: hashC,
          },
        },
        expectedProtocolLimitsDigest: limitsDigest,
        expectedOperationalSloDigest: sloDigest,
      });
    expect(changedProfile).toEqual({
      status: ImmutableRegistryWriteStatus.Conflict,
      existingId: releaseCandidate.producerReleaseId,
    });
  });

  it("rejects malformed, partial, or gateway-less investigation profiles", () => {
    const registeredAt = new Date("2026-07-22T12:00:00.000Z");
    const gatewayCandidate = {
      ...releaseCandidate,
      contextGatewayPolicyVersion: "review-context-gateway.v1",
      contextGatewayEntrypointDigest: hashC,
    } as const;
    const partialProfile = {
      capability: reviewInvestigationCapabilityV1,
      coverageProfileHash: hashA,
    } as unknown as ProducerReviewInvestigationProfile;
    const invalidCapability = {
      capability: "review_investigation_v2",
      coverageProfileHash: hashA,
      policyHash: hashB,
    } as unknown as ProducerReviewInvestigationProfile;
    const completeProfile = {
      capability: reviewInvestigationCapabilityV1,
      coverageProfileHash: hashA,
      policyHash: hashB,
    } as const;

    expect(() =>
      createProducerRelease(
        { ...gatewayCandidate, reviewInvestigationProfile: partialProfile },
        registeredAt,
      ),
    ).toThrow("review_investigation_policy_hash_invalid");
    expect(() =>
      createProducerRelease(
        { ...gatewayCandidate, reviewInvestigationProfile: invalidCapability },
        registeredAt,
      ),
    ).toThrow("review_investigation_capability_invalid");
    expect(() =>
      createProducerRelease(
        { ...releaseCandidate, reviewInvestigationProfile: completeProfile },
        registeredAt,
      ),
    ).toThrow("review_investigation_context_gateway_artifact_required");
  });

  it("requires registered matching profiles and never reactivates a revoked release", async () => {
    const kit = createReviewRunControlTestKit();
    await expect(
      kit.control.producerReleases.registerProducerRelease({
        candidate: releaseCandidate,
        expectedProtocolLimitsDigest: limitsDigest,
        expectedOperationalSloDigest: sloDigest,
      }),
    ).rejects.toMatchObject({ code: ReviewRunControlErrorCode.Missing });

    await kit.control.producerReleases.registerProtocolLimitsProfile({
      protocolLimitsProfileId: "limits-1",
      limitsDigest,
      limits,
    });
    await kit.control.producerReleases.registerOperationalSloProfile({
      operationalSloProfileId: "slo-1",
      sloDigest,
      thresholds: sloThresholds,
      ownerRefs: ["team-reviewrouter"],
      runbookRefs: ["runbook/review-v2"],
    });
    await kit.control.producerReleases.registerProducerRelease({
      candidate: releaseCandidate,
      expectedProtocolLimitsDigest: limitsDigest,
      expectedOperationalSloDigest: sloDigest,
    });
    const revoked = await kit.control.producerReleases.revokeProducerRelease(
      releaseCandidate.producerReleaseId,
    );
    expect(revoked.status).toBe(ProducerReleaseRevocationStatus.Revoked);
    const registrationRetry =
      await kit.control.producerReleases.registerProducerRelease({
        candidate: releaseCandidate,
        expectedProtocolLimitsDigest: limitsDigest,
        expectedOperationalSloDigest: sloDigest,
      });
    expect(registrationRetry.status).toBe(
      ImmutableRegistryWriteStatus.Restored,
    );
    if ("value" in registrationRetry) {
      expect(registrationRetry.value.state).toBe(ProducerReleaseState.Revoked);
    }
  });

  it("rejects protocol values above the server-owned absolute ceiling", async () => {
    const kit = createReviewRunControlTestKit();
    await expect(
      kit.control.producerReleases.registerProtocolLimitsProfile({
        protocolLimitsProfileId: "limits-too-large",
        limitsDigest: await kit.digest.digestUtf8(
          canonicalReviewProtocolLimits({ ...limits, maxWorkSlots: 1_001 }),
        ),
        limits: { ...limits, maxWorkSlots: 1_001 },
      }),
    ).rejects.toMatchObject({
      code: ReviewRunControlErrorCode.InvalidArgument,
    });
  });
});

describe("ScmRepositoryIdentity", () => {
  it("normalizes and permanently restores the external identity tuple", async () => {
    const kit = createReviewRunControlTestKit();
    const first =
      await kit.control.repositoryIdentities.resolveOrRegisterScmRepositoryIdentity(
        {
          provider: ScmProvider.GitHub,
          sourceBaseUrl: "https://GITHUB.com///",
          externalRepositoryId: "123",
        },
      );
    const retry =
      await kit.control.repositoryIdentities.resolveOrRegisterScmRepositoryIdentity(
        {
          provider: ScmProvider.GitHub,
          sourceBaseUrl: "https://github.com",
          externalRepositoryId: "123",
        },
      );
    expect(first.status).toBe(ScmRepositoryIdentityResolveStatus.Created);
    expect(retry.status).toBe(ScmRepositoryIdentityResolveStatus.Restored);
    expect(retry.identity.scmRepositoryIdentityId).toBe(
      first.identity.scmRepositoryIdentityId,
    );
  });

  it("quarantines conflicting bindings and unbinds only while authority is paused", async () => {
    const kit = createReviewRunControlTestKit();
    const resolved =
      await kit.control.repositoryIdentities.resolveOrRegisterScmRepositoryIdentity(
        {
          provider: ScmProvider.GitHub,
          sourceBaseUrl: "https://github.com",
          externalRepositoryId: "123",
        },
      );
    const bound =
      await kit.control.repositoryIdentities.bindScmRepositoryIdentity({
        scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
        expectedVersion: resolved.identity.version,
        workspaceId: "workspace-1",
        repositoryConnectionId: "repository-1",
      });
    expect(bound.status).toBe(ScmRepositoryIdentityBindingStatus.Bound);
    const conflict =
      await kit.control.repositoryIdentities.bindScmRepositoryIdentity({
        scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
        expectedVersion: "identity" in bound ? bound.identity.version : 0,
        workspaceId: "workspace-2",
        repositoryConnectionId: "repository-2",
      });
    expect(conflict.status).toBe(ScmRepositoryIdentityBindingStatus.Conflict);
    const directV2Preflight = await kit.control.mutationAuthority.preflight({
      scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
      operation: ReviewMutationAuthorityCommandKind.DirectV2Initialize,
    });
    if (!("proof" in directV2Preflight) || !directV2Preflight.proof) {
      throw new Error("direct_v2_proof_missing");
    }
    await kit.control.mutationAuthority.initializeDirectV2({
      scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
      proof: reviewMutationAuthorityProofReference(directV2Preflight.proof),
    });
    const beforePause =
      await kit.control.repositoryIdentities.unbindScmRepositoryIdentity({
        scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
        expectedVersion: "identity" in bound ? bound.identity.version : 0,
      });
    expect(beforePause.status).toBe(
      ScmRepositoryIdentityBindingStatus.AuthorityNotPaused,
    );
    const paused = await kit.control.mutationAuthority.pause({
      scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
      expectedVersion: 1,
    });
    expect(paused.status).toBe("updated");
    const unbound =
      await kit.control.repositoryIdentities.unbindScmRepositoryIdentity({
        scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
        expectedVersion: "identity" in bound ? bound.identity.version : 0,
      });
    expect(unbound.status).toBe(ScmRepositoryIdentityBindingStatus.Unbound);
  });
});

describe("immutable lifecycle verifier producer approval", () => {
  it("keeps absence byte compatible and detaches a recognized profile", () => {
    const legacy = createProducerRelease(releaseCandidate, new Date(0));
    const profile = {
      extensionId: "lifecycle-verification.v1" as const,
      descriptorDigest: `sha256:${"a".repeat(64)}`,
    };
    const release = createProducerRelease(
      { ...releaseCandidate, lifecycleVerificationProfile: profile },
      new Date(0),
    );
    const approvedKey = producerReleaseImmutableKey(release);
    profile.descriptorDigest = `sha256:${"b".repeat(64)}`;
    expect(release.lifecycleVerificationProfile?.descriptorDigest).toBe(
      `sha256:${"a".repeat(64)}`,
    );
    expect(cloneProducerRelease(release).lifecycleVerificationProfile).toEqual(
      release.lifecycleVerificationProfile,
    );
    expect(
      producerReleaseImmutableKey({
        ...legacy,
        lifecycleVerificationProfile: null,
      }),
    ).toBe(producerReleaseImmutableKey(legacy));
    expect(approvedKey).not.toBe(producerReleaseImmutableKey(legacy));
    expect(approvedKey).not.toBe(
      producerReleaseImmutableKey({
        ...release,
        lifecycleVerificationProfile: profile,
      }),
    );
    expect(Object.hasOwn(legacy, "lifecycleVerificationProfile")).toBe(false);
  });
  it("rejects a malformed extension identity and unapproved profile fields", () => {
    for (const value of [
      null,
      {},
      {
        extensionId: "lifecycle-verification.v2",
        descriptorDigest: `sha256:${"a".repeat(64)}`,
      },
      { extensionId: "lifecycle-verification.v1", descriptorDigest: "bad" },
      {
        extensionId: "lifecycle-verification.v1",
        descriptorDigest: `sha256:${"a".repeat(64)}`,
        model: "caller-model",
      },
    ]) {
      expect(() => parseProducerLifecycleVerificationProfile(value)).toThrow();
    }
  });
});
