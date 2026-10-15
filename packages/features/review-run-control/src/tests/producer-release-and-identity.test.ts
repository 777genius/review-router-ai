import {
  parseReviewAgentProfiles,
  selectReviewAgentProfile,
} from "../domain/review-agent-profile";
import { createTrustedProducerReleaseMaterializer } from "../infrastructure/trusted-producer-release-materializer";
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
  cloneProducerRelease,
  producerReleaseImmutableKey,
  canonicalReviewProtocolLimits,
  createProducerRelease,
  reviewInvestigationCapabilityV1,
  type ProducerReviewInvestigationProfile,
} from "../domain/producer-release";

describe("immutable release registries", () => {
  it("retains legacy key bytes and materializes an immutable detached agent roster", async () => {
    const kit = createReviewRunControlTestKit();
    const legacy = createProducerRelease(releaseCandidate, kit.clock.now());
    expect(legacy.agentProfiles).toBeNull();
    const key = producerReleaseImmutableKey(releaseCandidate);
    expect(key).toBe(
      `{"actionCommitSha":"${"a".repeat(40)}","capabilityProfile":"exact_revision_v2","contextGatewayEntrypointDigest":null,"contextGatewayPolicyVersion":null,"distributionKind":"public_reusable","operationalSloProfileId":"slo-1","protocolLimitsProfileId":"limits-1","reviewInvestigationCapability":null,"reviewInvestigationCoverageProfileHash":null,"reviewInvestigationPolicyHash":null,"runtimeCommitSha":"${"b".repeat(40)}","runtimeEntrypointDigest":"${hashA}","schemaDigest":"${hashB}","wrapperEntrypointDigest":null}`,
    );
    expect(
      producerReleaseImmutableKey({ ...releaseCandidate, agentProfiles: null }),
    ).toBe(key);
    const input = [
      {
        profileRef: "codex-approved",
        agentKind: "codex" as const,
        binarySha256: hashA,
        packageVersion: "1.2.3",
        modelTransports: ["account_gateway" as const],
        contextGateway: true as const,
        cancellation: true as const,
      },
    ];
    const release = createProducerRelease(
      { ...releaseCandidate, agentProfiles: input },
      kit.clock.now(),
    );
    input[0]!.packageVersion = "9.9.9";
    expect(release.agentProfiles![0]!.packageVersion).toBe("1.2.3");
    const clone = cloneProducerRelease(release);
    expect(clone.agentProfiles).toEqual(release.agentProfiles);
    expect(clone.agentProfiles).not.toBe(release.agentProfiles);
    expect(clone.agentProfiles![0]!.modelTransports).not.toBe(
      release.agentProfiles![0]!.modelTransports,
    );
    const materializer = createTrustedProducerReleaseMaterializer({
      digest: kit.digest,
      producerReleases: kit.control.producerReleases,
      releaseQueries: kit.store,
      protocolLimitsQueries: kit.store,
      operationalSloQueries: kit.store,
    });
    await materializer.ensureRegistered(release);
    await materializer.ensureRegistered(clone);
    expect((await kit.store.registerProducerRelease(clone)).status).toBe(
      ImmutableRegistryWriteStatus.Restored,
    );
    expect(
      (
        await kit.store.registerProducerRelease({
          ...release,
          agentProfiles: [
            { ...release.agentProfiles![0]!, packageVersion: "2.0.0" },
          ],
        })
      ).status,
    ).toBe(ImmutableRegistryWriteStatus.Conflict);
    expect(
      (await kit.store.findProducerReleaseById(release.producerReleaseId))!
        .agentProfiles,
    ).toEqual(release.agentProfiles);
    await expect(
      materializer.ensureRegistered({ ...release, agentProfiles: null }),
    ).rejects.toThrow("trusted_producer_release_conflict");
    await expect(
      materializer.ensureRegistered({
        ...release,
        producerReleaseId: "different-id",
        agentProfiles: null,
      }),
    ).rejects.toThrow("trusted_producer_release_conflict");
    expect(
      selectReviewAgentProfile(
        release.agentProfiles,
        "codex-approved",
        "account_gateway",
      ),
    ).toEqual(release.agentProfiles![0]);
    expect(() =>
      selectReviewAgentProfile(
        release.agentProfiles,
        "codex-approved",
        "provider_api",
      ),
    ).toThrow("review_agent_profile_unavailable");
    for (const invalid of [
      [],
      [...input, ...input],
      [{ ...input[0], extra: true }],
      [{ ...input[0], binarySha256: "not-a-digest" }],
      [{ ...input[0], cancellation: false }],
      [
        {
          ...input[0],
          modelTransports: ["account_gateway", "account_gateway"],
        },
      ],
    ])
      expect(() => parseReviewAgentProfiles(invalid)).toThrow();
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
