import { describe, expect, it, vi } from "vitest";
import {
  ManageReviewRunAuthorizations,
  ReviewRunAuthorizationDenialReason,
  ReviewRunAuthorizationUseCaseStatus,
  type ReviewRunAuthorizationUseCaseResult,
} from "../application/use-cases/manage-review-run-authorizations";
import { ResolveReviewSafetyPolicy } from "../application/use-cases/resolve-review-safety-policy";
import type { ReviewSafetyDecisionResolverPort } from "../application/ports/review-safety-policy-ports";
import type {
  ReviewRunRuntimeCaptureDenial,
  ReviewRunRuntimeSnapshotPort,
} from "../application/ports/review-run-runtime-snapshot-port";
import type { ReviewAgentProfile } from "../domain/review-agent-profile";
import type { ReviewRunRuntimeSnapshot } from "../domain/review-run-runtime-snapshot";
import type { ReviewSafetyResolutionTarget } from "../domain/review-safety-policy";
import {
  canonicalJson,
  ReviewProviderKind,
  ReviewSafetyCapability,
  ReviewSafetyPolicyScope,
  ReviewSafetyRolloutMode,
  ReviewTaskKind,
  type ProviderVoteLane,
} from "../domain/review-run-control-types";
import { createReviewRunControlTestKit } from "../testing/review-run-control-test-kit";
import {
  hashA,
  hashB,
  hashC,
  provisionV2AuthorizationContext,
  releaseCandidate,
  shaA,
  shaB,
} from "./fixtures";

const ocrAgent: ReviewAgentProfile = {
  profileRef: "approved-ocr",
  agentKind: "ocr",
  binarySha256: hashA,
  packageVersion: "1.0.0",
  modelTransports: ["account_gateway"],
  contextGateway: false,
  cancellation: true,
};

const codexAgent: ReviewAgentProfile = {
  profileRef: "approved-codex",
  agentKind: "codex",
  binarySha256: hashA,
  packageVersion: "0.159.2",
  modelTransports: ["account_gateway"],
  contextGateway: true,
  cancellation: true,
};

/** Valid captured snapshot; the engine selection is frozen inside it. */
function snapshotFor(
  agent: ReviewAgentProfile,
  deadline: Date,
): ReviewRunRuntimeSnapshot {
  return {
    snapshotVersion: 3,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${hashB}`,
    agent,
    agentProfileDigest: hashC,
    producer: {
      producerReleaseId: releaseCandidate.producerReleaseId,
      actionCommitSha: shaA,
      runtimeCommitSha: shaB,
    },
    configurationCanonicalJson: canonicalJson({ schemaVersion: 3 }),
    deadline: deadline.toISOString(),
    gateway: null,
  };
}

class FakeRuntimeSnapshots implements ReviewRunRuntimeSnapshotPort {
  captures = 0;

  constructor(
    private readonly result: (
      input: Parameters<ReviewRunRuntimeSnapshotPort["capture"]>[0],
    ) => ReviewRunRuntimeSnapshot | ReviewRunRuntimeCaptureDenial | null,
  ) {}

  capture(
    input: Parameters<ReviewRunRuntimeSnapshotPort["capture"]>[0],
  ): Promise<ReviewRunRuntimeSnapshot | ReviewRunRuntimeCaptureDenial | null> {
    this.captures += 1;
    return Promise.resolve(this.result(input));
  }

  isLive(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class RecordingSafetyDecisions implements ReviewSafetyDecisionResolverPort {
  readonly targets: ReviewSafetyResolutionTarget[] = [];

  constructor(private readonly inner: ReviewSafetyDecisionResolverPort) {}

  resolveReviewSafetyPolicy(
    input: Parameters<
      ReviewSafetyDecisionResolverPort["resolveReviewSafetyPolicy"]
    >[0],
  ) {
    this.targets.push(input.target);
    return this.inner.resolveReviewSafetyPolicy(input);
  }
}

async function admissionSetup(snapshots: ReviewRunRuntimeSnapshotPort) {
  const kit = createReviewRunControlTestKit();
  const fixture = await provisionV2AuthorizationContext(kit);
  const safety = new RecordingSafetyDecisions(
    new ResolveReviewSafetyPolicy({
      clock: kit.clock,
      digest: kit.digest,
      policyQueries: kit.store,
      emergencyQueries: kit.store,
    }),
  );
  const useCase = new ManageReviewRunAuthorizations({
    runtimeSnapshots: snapshots,
    clock: kit.clock,
    identifiers: kit.identifiers,
    digest: kit.digest,
    identities: kit.store,
    authorities: kit.store,
    releases: kit.store,
    limits: kit.store,
    slos: kit.store,
    safetyDecisions: safety,
    authorizationQueries: kit.store,
    authorizationCommands: kit.store,
    tokens: kit.tokens,
  });
  return { kit, fixture, safety, useCase };
}

function inputFor(
  fixture: Awaited<ReturnType<typeof provisionV2AuthorizationContext>>,
  overrides: Partial<
    Parameters<ManageReviewRunAuthorizations["authorizeReviewRun"]>[0]
  > = {},
) {
  return {
    ...fixture.authorizeInput,
    modelTransport: "account_gateway" as const,
    ...overrides,
  };
}

function authorizationOf(result: ReviewRunAuthorizationUseCaseResult) {
  if (!("authorization" in result))
    throw new Error(`expected authorization, got ${JSON.stringify(result)}`);
  return result;
}

const codexLane: ProviderVoteLane = {
  providerKind: ReviewProviderKind.Codex,
  providerVoteIdentityHash: hashA,
};
const codexLaneOther: ProviderVoteLane = {
  providerKind: ReviewProviderKind.Codex,
  providerVoteIdentityHash: hashB,
};
const claudeLane: ProviderVoteLane = {
  providerKind: ReviewProviderKind.ClaudeCode,
  providerVoteIdentityHash: hashB,
};
const ocrLane: ProviderVoteLane = {
  providerKind: ReviewProviderKind.Ocr,
  providerVoteIdentityHash: hashC,
};

/** Optional RR investigation participation capability, exactly as the
 * run-control composition binds it from a release investigation profile. */
function optionalInvestigationDescriptor(
  providerCapabilities: readonly {
    readonly providerKind: "codex" | "claude_code";
    readonly capabilities: readonly string[];
  }[],
) {
  return {
    authorizationDescriptorVersion: 3 as const,
    capability: "review_investigation_v1",
    coverageProfileHash: hashA,
    extensionCanonicalizerDigest: hashB,
    extensionId: "review_investigation_extension_v1",
    extensionSchemaDigest: hashC,
    policyHash: hashA,
    providerCapabilities,
  };
}

const codexCapabilityRow = {
  providerKind: "codex" as const,
  capabilities: ["recording"],
};
const claudeCapabilityRow = {
  providerKind: "claude_code" as const,
  capabilities: ["recording"],
};

describe("ReviewRunAuthorization engine admission lanes", () => {
  it("authorizes only the captured OCR engine lane from a mixed allowlist", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(ocrAgent, input.deadline),
    );
    const { fixture, useCase } = await admissionSetup(snapshots);

    const result = authorizationOf(
      await useCase.authorizeReviewRun(
        inputFor(fixture, {
          providerVoteLanes: [codexLane, ocrLane],
        }),
      ),
    );

    expect(result.status).toBe(ReviewRunAuthorizationUseCaseStatus.Authorized);
    expect(result.authorization.providerVoteLanes).toEqual([ocrLane]);
    expect(result.authorization.runtimeSnapshotCanonicalJson).toContain(
      "approved-ocr",
    );
  });

  it("never authorizes a Codex and OCR dual vote from one captured engine", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(codexAgent, input.deadline),
    );
    const { fixture, useCase } = await admissionSetup(snapshots);

    const result = authorizationOf(
      await useCase.authorizeReviewRun(
        inputFor(fixture, {
          providerVoteLanes: [codexLane, ocrLane],
        }),
      ),
    );

    expect(result.status).toBe(ReviewRunAuthorizationUseCaseStatus.Authorized);
    expect(result.authorization.providerVoteLanes).toEqual([codexLane]);
    expect(result.authorization.runtimeSnapshotCanonicalJson).toContain(
      "approved-codex",
    );
  });

  it("refuses a missing lane for the captured engine", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(ocrAgent, input.deadline),
    );
    const { fixture, useCase } = await admissionSetup(snapshots);

    await expect(
      useCase.authorizeReviewRun(
        inputFor(fixture, { providerVoteLanes: [codexLane] }),
      ),
    ).resolves.toEqual({
      status: ReviewRunAuthorizationUseCaseStatus.Denied,
      reason: ReviewRunAuthorizationDenialReason.ProviderVoteLaneUnavailable,
    });
  });

  it("refuses duplicate lanes for the captured engine", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(codexAgent, input.deadline),
    );
    const { fixture, useCase } = await admissionSetup(snapshots);

    await expect(
      useCase.authorizeReviewRun(
        inputFor(fixture, {
          providerVoteLanes: [codexLane, codexLaneOther],
        }),
      ),
    ).resolves.toEqual({
      status: ReviewRunAuthorizationUseCaseStatus.Denied,
      reason: ReviewRunAuthorizationDenialReason.ProviderVoteLaneUnavailable,
    });
  });

  it("binds the OCR safety target and stores no optional investigation descriptor for the OCR lane", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(ocrAgent, input.deadline),
    );
    const { fixture, safety, useCase } = await admissionSetup(snapshots);

    // §4.1.1 step 5: with the spec's mixed [codex, ocr] allowlist and a
    // release investigation profile, the precomputed descriptor is optional
    // participation eligibility only. The OCR lane must be ADMITTED with an
    // absent descriptor — the precomputed Codex capability is dropped, never
    // rejected.
    const result = authorizationOf(
      await useCase.authorizeReviewRun(
        inputFor(fixture, {
          providerVoteLanes: [codexLane, ocrLane],
          reviewInvestigationAuthorizationDescriptorCanonicalJson:
            canonicalJson(
              optionalInvestigationDescriptor([codexCapabilityRow]),
            ),
        }),
      ),
    );

    expect(result.status).toBe(ReviewRunAuthorizationUseCaseStatus.Authorized);
    expect(result.authorization.providerVoteLanes).toEqual([ocrLane]);
    expect(
      result.authorization
        .reviewInvestigationAuthorizationDescriptorCanonicalJson,
    ).toBeNull();
    // The provider/task safety target follows the selected OCR lane only.
    for (const target of safety.targets)
      expect(target.providerTasks).toEqual([
        {
          providerKind: ReviewProviderKind.Ocr,
          taskKind: ReviewTaskKind.CodeReview,
        },
      ]);
  });

  it("still rejects a mandatory investigation policy the captured OCR engine cannot satisfy", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(ocrAgent, input.deadline),
    );
    const { fixture, useCase } = await admissionSetup(snapshots);

    // Rejection is reserved for a mandatory investigation policy demand that
    // cannot be recognized as optional participation eligibility: §4.2 rejects
    // the incompatible combination before inference instead of weakening it.
    await expect(
      useCase.authorizeReviewRun(
        inputFor(fixture, {
          providerVoteLanes: [codexLane, ocrLane],
          reviewInvestigationAuthorizationDescriptorCanonicalJson:
            canonicalJson({ investigation: "mandatory-policy" }),
        }),
      ),
    ).resolves.toEqual({
      status: ReviewRunAuthorizationUseCaseStatus.Denied,
      reason:
        ReviewRunAuthorizationDenialReason.ReviewInvestigationIncompatible,
    });
  });

  it("binds the investigation descriptor to the selected lane only", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(codexAgent, input.deadline),
    );
    const { fixture, useCase } = await admissionSetup(snapshots);

    const result = authorizationOf(
      await useCase.authorizeReviewRun(
        inputFor(fixture, {
          providerVoteLanes: [codexLane, claudeLane, ocrLane],
          reviewInvestigationAuthorizationDescriptorCanonicalJson:
            canonicalJson(
              optionalInvestigationDescriptor([
                codexCapabilityRow,
                claudeCapabilityRow,
              ]),
            ),
        }),
      ),
    );

    expect(result.status).toBe(ReviewRunAuthorizationUseCaseStatus.Authorized);
    expect(result.authorization.providerVoteLanes).toEqual([codexLane]);
    // Only the selected Codex lane's capability survives binding; the
    // ClaudeCode row computed from the pre-selection allowlist is not stored.
    expect(
      JSON.parse(
        result.authorization
          .reviewInvestigationAuthorizationDescriptorCanonicalJson!,
      ),
    ).toEqual(optionalInvestigationDescriptor([codexCapabilityRow]));
  });

  it("restores the captured snapshot and lanes when current settings change", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(ocrAgent, input.deadline),
    );
    const { fixture, useCase } = await admissionSetup(snapshots);

    const first = authorizationOf(
      await useCase.authorizeReviewRun(
        inputFor(fixture, { providerVoteLanes: [codexLane, ocrLane] }),
      ),
    );
    // Current settings now offer a different lane set; the ongoing admission
    // keeps its captured engine and lanes and never re-selects from policy.
    const second = authorizationOf(
      await useCase.authorizeReviewRun(
        inputFor(fixture, { providerVoteLanes: [codexLane] }),
      ),
    );

    expect(snapshots.captures).toBe(1);
    expect(first.status).toBe(ReviewRunAuthorizationUseCaseStatus.Authorized);
    expect(second.status).toBe(ReviewRunAuthorizationUseCaseStatus.Restored);
    expect(second.authorization.authorizationId).toBe(
      first.authorization.authorizationId,
    );
    expect(second.authorization.providerVoteLanes).toEqual([ocrLane]);
    expect(second.authorization.runtimeSnapshotCanonicalJson).toBe(
      first.authorization.runtimeSnapshotCanonicalJson,
    );
  });

  it.each([
    [
      "an invalid or disabled explicit ref",
      "agent_profile_unavailable",
      ReviewRunAuthorizationDenialReason.AgentProfileUnavailable,
    ],
    [
      "an OCR selection beside agenticContext=false",
      "agent_profile_incompatible",
      ReviewRunAuthorizationDenialReason.AgentProfileIncompatible,
    ],
  ] as const)(
    "refuses %s as a configuration error without fallback or inference",
    async (_label, captureDenied, reason) => {
      const snapshots = new FakeRuntimeSnapshots(() => ({ captureDenied }));
      const { kit, fixture, useCase } = await admissionSetup(snapshots);
      const write = vi.spyOn(
        kit.store,
        "createOrRestoreReviewRunAuthorizationAtomically",
      );

      await expect(
        useCase.authorizeReviewRun(
          inputFor(fixture, { providerVoteLanes: [ocrLane] }),
        ),
      ).resolves.toEqual({
        status: ReviewRunAuthorizationUseCaseStatus.Denied,
        reason,
      });
      // Zero inference/effects: no retry with another engine, no authorization.
      expect(snapshots.captures).toBe(1);
      expect(write).not.toHaveBeenCalled();
    },
  );

  it("returns the eligibility-changed refusal when policy drifts between capture and commit", async () => {
    const snapshots = new FakeRuntimeSnapshots((input) =>
      snapshotFor(ocrAgent, input.deadline),
    );
    const { kit, fixture, useCase } = await admissionSetup(snapshots);
    const commit =
      kit.store.createOrRestoreReviewRunAuthorizationAtomically.bind(kit.store);
    vi.spyOn(
      kit.store,
      "createOrRestoreReviewRunAuthorizationAtomically",
    ).mockImplementationOnce(async (input) => {
      // Saved safety policy moves after capture/eligibility, before the commit.
      await kit.control.safetyControls.updateReviewSafetyPolicy({
        expectedVersion: 1,
        scope: { scope: ReviewSafetyPolicyScope.Global },
        capability: ReviewSafetyCapability.RunAuthorizationV2,
        rolloutMode: ReviewSafetyRolloutMode.Enabled,
        updatedBy: "test-operator",
      });
      return commit(input);
    });

    await expect(
      useCase.authorizeReviewRun(
        inputFor(fixture, { providerVoteLanes: [ocrLane] }),
      ),
    ).resolves.toEqual({
      status: ReviewRunAuthorizationUseCaseStatus.Denied,
      reason: ReviewRunAuthorizationDenialReason.AdmissionFactsChanged,
    });
    await expect(
      kit.store.findReviewRunAuthorizationForAdmission({
        workspaceId: fixture.authorizeInput.verifiedIdentity.workspaceId,
        repositoryConnectionId:
          fixture.authorizeInput.verifiedIdentity.repositoryConnectionId,
        scmRepositoryIdentityId:
          fixture.authorizeInput.verifiedIdentity.scmRepositoryIdentityId,
        sourceRunId: fixture.authorizeInput.verifiedIdentity.sourceRunId,
        sourceRunAttempt:
          fixture.authorizeInput.verifiedIdentity.sourceRunAttempt,
        protocolOfferHash: fixture.authorizeInput.protocolOfferHash,
      }),
    ).resolves.toBeNull();
  });
});
