import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
} from "@reviewrouter/shared";
import Fastify from "fastify";
import { registerReviewExecutionV2Routes } from "@reviewrouter/features-action-control-plane/v2";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ConfiguredCapabilityKeyRing,
  JoseRotatingCapabilityCodec,
} from "@reviewrouter/platform-signed-capabilities";
import {
  AcceptReviewObservationStatus,
  LookupReviewEvidenceStatus,
  ProviderResultCompletionStatus,
  ProviderExecutionProfile,
  ReviewObservationQualityFlag,
  ReviewProviderKind,
  ReviewReuseTier,
  ReviewTaskKind as EvidenceTaskKind,
  ReviewTrustDomain as EvidenceTrustDomain,
  ReuseEligibility,
  buildProviderInvocationIdentity,
  prepareReviewObservationPayload,
  reviewEvidencePayloadVersion,
  reviewReuseEligibilityPolicyVersion,
  serializeProviderInvocationManifestCanonicalWireJson,
  type ProviderInvocationManifest,
  type ReviewObservation,
} from "@reviewrouter/features-review-evidence";
import {
  AcquireOrJoinInvocationFlightStatus,
  CurrentReviewExecutionRevisionStatus,
  LeaseTransitionDecisionStatus,
  ReviewCoverageState,
  ReviewExecutionAdmissionVerdict,
  ReviewExecutionProviderKind,
  ReviewExecutionFinalizeStatus,
  ReviewExecutionLifecycleTransitionStatus,
  ReviewExecutionState,
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewInvocationLeaseTransitionStatus,
  ReviewObservationAttachmentKind,
  ReviewObservationAttachmentStatus,
  ReviewTaskKind,
  ReviewWorkSlotState,
  ReviewWorkSlotTerminalReason as DomainWorkSlotTerminalReason,
  StartReviewExecutionStatus,
  canonicalReviewAssignmentManifestHashPreimage,
  canonicalReviewExecutionPlanHashPreimage,
  decideLeaseAcquire,
  decideLeaseRelease,
  decideLeaseRenewal,
  type ReviewExecutionSnapshot,
  type FinalizedReviewProjectionArtifact,
  type InvocationFlight,
  type ReviewInvocationLease,
} from "@reviewrouter/features-review-executions";
import { InMemoryReviewExecutionStore } from "@reviewrouter/features-review-executions/testing";
import {
  ReviewProtocolVersion,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  canonicalizeReviewActionV2Request,
  reviewActionV2LegacySlot,
  prDescriptionExtensionV1,
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  ReviewEvidenceLookupResultStatus,
  ReviewEvidenceCommitResultStatus,
  ReviewExecutionMutationResultStatus,
  ReviewInvocationLeaseResultStatus,
  ReviewWorkSlotTerminalReason,
  ReviewWorkSlotTerminalState,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  type ReviewExecutionObservationAttachRequest,
  type ReviewExecutionObservationAdoptRequest,
  type ReviewEvidenceCommitRequest,
  type ReviewExecutionFinalizeRequest,
  type ReviewExecutionStartRequest,
  type ReviewInvocationLeaseAcquireRequest,
} from "@reviewrouter/protocol-review-action-v2";
import { ReviewActionV2ExecutionEvidenceCapabilityAdapter } from "./review-action-v2-execution-evidence-capabilities.js";
import {
  composeReviewActionV2EvidenceRoutes,
  composeReviewActionV2ExecutionRoutes,
  createReviewActionV2EvidenceHandlers,
  createReviewActionV2ExecutionHandlers,
  type ReviewActionV2EvidenceHandlerDependencies,
  type ReviewActionV2ExecutionHandlerDependencies,
} from "./review-action-v2-execution-evidence-composition.js";

const now = new Date("2026-07-22T20:00:00.000Z");
const digest = {
  digestUtf8: async (value: string) => sha(value),
  digest: async (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex"),
};

describe("Review Action v2 execution/evidence composition", () => {
  it("stays disabled unless explicitly composed with every dependency", () => {
    const runtime = {
      readServerTime: async () => now,
      createRequestId: () => "request-1",
    };
    expect(
      composeReviewActionV2ExecutionRoutes({ enabled: false, runtime }),
    ).toEqual(runtime);
    expect(
      composeReviewActionV2EvidenceRoutes({ enabled: false, runtime }),
    ).toEqual(runtime);
    expect(() =>
      composeReviewActionV2ExecutionRoutes({ enabled: true, runtime }),
    ).toThrow("review_action_v2_execution_dependencies_unavailable");
  });

  it("restores the persisted lifecycle plan before any replacement planning", async () => {
    const storedPlan = canonicalJson({
      manifestVersion: 2,
      lifecyclePlan: { targets: [{ targetId: "A" }, { targetId: "B" }] },
    });
    const restored = {
      ...snapshot,
      execution: {
        ...snapshot.execution,
        assignmentManifestCanonicalJson: storedPlan,
      },
    };
    const base = executionDependencies({ findExecution: async () => restored });
    const d = {
      ...base,
      executionQueries: {
        ...base.executionQueries,
        findStream: async () => restored.stream,
      },
    };
    const response = await createReviewActionV2ExecutionHandlers(
      d,
    ).restore.execute({
      ...envelope("restore-plan"),
      authorizationToken: "authorization-token",
      authorizationId: authorization.authorizationId,
      reviewRevisionHash: authorization.reviewRevisionHash,
    });
    expect(response.result).toHaveProperty("executionCanonicalJson");
    if (!("executionCanonicalJson" in response.result))
      throw new Error("restore missing");
    expect(
      JSON.parse(response.result.executionCanonicalJson).persistedPlan,
    ).toMatchObject({
      planHash: snapshot.execution.planHash,
      assignmentManifestCanonicalJson: storedPlan,
      workSlots: [
        {
          workSlotId: "slot-1",
          taskKind: ReviewTaskKind.FindingDiscovery,
          attemptBudget: 2,
        },
      ],
      artifact: null,
    });
    expect(d.executions.startReviewExecution.execute).not.toHaveBeenCalled();
    expect(d.executions.invocationFlights.execute).not.toHaveBeenCalled();
  });

  it("restores one unattached source after work expiry without changing admitted plan identity", async () => {
    const f = await unattachedRestoreFixture();
    const response = await f.restore();
    const originalPlan = {
      planHash: f.snapshot.execution.planHash,
      assignmentManifestHash: f.snapshot.execution.assignmentManifestHash,
      assignmentManifestCanonicalJson:
        f.snapshot.execution.assignmentManifestCanonicalJson,
    };
    if (!("executionCanonicalJson" in response.result))
      throw new Error("restore missing");
    const readback = JSON.parse(response.result.executionCanonicalJson);
    expect(readback.persistedPlan).toMatchObject({
      ...originalPlan,
      acceptedManifests: [],
      unattachedAcceptedManifests: [
        {
          workSlotId: f.sourceLease.workSlotId,
          manifestCanonicalJson: f.sourceLease.preparedManifestCanonicalJson,
          manifestKey: f.sourceLease.preparedManifestKey,
          observationId: f.observation.observationId,
          payloadHash: f.observation.payloadHash,
          sourceLeaseId: f.sourceLease.leaseId,
          sourceFencingToken: "7",
          sourceOwnerIdHash: hash("d"),
        },
      ],
    });
    expect(readback.planHash).toBe(originalPlan.planHash);
    expect(readback.persistedPlan.workSlots).toEqual(
      f.snapshot.execution.workSlots,
    );
    expect(f.snapshot.execution).toMatchObject(originalPlan);
    expect(f.sourceLease.expiresAt.getTime()).toBeLessThan(now.getTime());
    expect(f.d.executions.startReviewExecution.execute).not.toHaveBeenCalled();
    expect(f.d.executions.invocationFlights.execute).not.toHaveBeenCalled();
    expect(
      f.d.executions.observationAttachments.adoptAccepted,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ["revoked", { state: ReviewInvocationLeaseState.Revoked }],
    ["expired report", { resultReportUntil: new Date(now.getTime() - 1) }],
    ["wrong fence", { fencingToken: 8n }],
    ["second attempt", { attemptOrdinal: 2 }],
    ["foreign execution", { executionId: "foreign-execution" }],
    ["foreign authorization", { authorizationId: "foreign-authorization" }],
    ["active source", { state: ReviewInvocationLeaseState.Active }],
  ] as const)(
    "withholds the original-source hint for %s",
    async (_label, change) => {
      const f = await unattachedRestoreFixture(change);
      const response = await f.restore();
      if (!("executionCanonicalJson" in response.result))
        throw new Error("restore missing");
      expect(
        JSON.parse(response.result.executionCanonicalJson).persistedPlan,
      ).not.toHaveProperty("unattachedAcceptedManifests");
      expect(f.d.executions.invocationFlights.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["multi-attempt", { attemptBudget: 2 }],
    ["unspent", { nextAttemptOrdinal: 1 }],
    ["leased", { state: ReviewWorkSlotState.Leased, activeLeaseId: "lease-1" }],
    ["cancelled", { state: ReviewWorkSlotState.Cancelled }],
    ["already attached", { acceptedObservationRefId: "existing-ref" }],
  ] as const)(
    "leaves %s slots outside source discovery",
    async (_label, change) => {
      const f = await unattachedRestoreFixture({}, change);
      const response = await f.restore();
      if (!("executionCanonicalJson" in response.result))
        throw new Error("restore missing");
      expect(
        JSON.parse(response.result.executionCanonicalJson).persistedPlan,
      ).not.toHaveProperty("unattachedAcceptedManifests");
      expect(f.findSources).not.toHaveBeenCalled();
    },
  );

  it("fails ambiguous source restore and retains a missing-source exhausted result", async () => {
    const f = await unattachedRestoreFixture();
    f.findSources.mockResolvedValueOnce([]);
    const absent = await f.restore();
    if (!("executionCanonicalJson" in absent.result))
      throw new Error("restore missing");
    const readback = JSON.parse(absent.result.executionCanonicalJson);
    expect(readback.persistedPlan).not.toHaveProperty(
      "unattachedAcceptedManifests",
    );
    expect(readback.workSlots[0].state).toBe(ReviewWorkSlotState.Exhausted);
    f.findSources.mockResolvedValueOnce([
      f.observation,
      { ...f.observation, observationId: "ambiguous-source" },
    ]);
    await expect(f.restore()).rejects.toThrow(
      "review_restore_accepted_source_ambiguous",
    );
    expect(f.d.executions.invocationFlights.execute).not.toHaveBeenCalled();
  });

  it("restores accepted invocation identity from a released persisted source lease", async () => {
    const sourceLease = lease({ state: ReviewInvocationLeaseState.Released });
    const acceptedRef = {
      observationRefId: "accepted-ref",
      executionId: snapshot.execution.executionId,
      workSlotId: sourceLease.workSlotId,
      providerInvocationKey: sourceLease.providerInvocationKey,
      observationId: "accepted-observation",
      providerVoteIdentityHash: sourceLease.providerVoteIdentityHash,
      attachmentKind: ReviewObservationAttachmentKind.FreshLease,
      eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      reuseSafetyDecisionHash: null,
      sourceExecutionId: sourceLease.executionId,
      sourceLeaseId: sourceLease.leaseId,
      sourceFencingToken: sourceLease.fencingToken,
      payloadHash: hash("a"),
      byteCount: 100,
      findingCount: 0,
      attachedAt: now,
    };
    const restored = {
      ...snapshot,
      observationRefs: [acceptedRef],
      activeLeases: [],
      execution: {
        ...snapshot.execution,
        workSlots: [
          {
            ...snapshot.execution.workSlots[0]!,
            state: ReviewWorkSlotState.Satisfied,
            acceptedObservationRefId: acceptedRef.observationRefId,
          },
        ],
      },
    };
    const base = executionDependencies({
      findExecution: async () => restored,
      findLease: vi.fn(async () => sourceLease),
    });
    const d = {
      ...base,
      authorizations: {
        resolveReviewRunAuthorizationToken: async () => ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization: lifecycleAuthorization(),
        }),
      },
      executionQueries: {
        ...base.executionQueries,
        findStream: async () => restored.stream,
      },
    };
    const response = await createReviewActionV2ExecutionHandlers(
      d,
    ).restore.execute({
      ...envelope("restore-accepted"),
      authorizationToken: "authorization-token",
      authorizationId: authorization.authorizationId,
      reviewRevisionHash: authorization.reviewRevisionHash,
    });
    if (!("executionCanonicalJson" in response.result))
      throw new Error("restore missing");
    expect(
      JSON.parse(response.result.executionCanonicalJson).persistedPlan
        .acceptedManifests,
    ).toEqual([
      {
        workSlotId: sourceLease.workSlotId,
        manifestCanonicalJson: sourceLease.preparedManifestCanonicalJson,
        manifestKey: sourceLease.preparedManifestKey,
        providerInvocationKey: sourceLease.providerInvocationKey,
        providerVoteIdentityHash: sourceLease.providerVoteIdentityHash,
      },
    ]);
    expect(d.executionQueries.findLease).toHaveBeenCalledWith(
      sourceLease.leaseId,
    );
    expect(d.executions.invocationFlights.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["restore", "accepted"],
    ["start", "accepted"],
    ["restore", "unattached"],
    ["start", "unattached"],
  ] as const)(
    "%s retains the original %s discovery source for a v1 plan on a captured v4 runtime",
    async (operation, sourceKind) => {
      const f = await unattachedRestoreFixture({}, {}, 1);
      const captured = ordinaryDiscoveryAuthorization(4);
      const runtime = parseReviewRunRuntimeSnapshot(
        captured.runtimeSnapshotCanonicalJson,
      );
      expect(runtime?.snapshotVersion).toBe(4);
      expect(runtime?.lifecycleVerificationCapability).toBeUndefined();
      expect(f.snapshot.execution.assignmentManifestVersion).toBe(1);
      const acceptedRef = {
        observationRefId: "accepted-v1-ref",
        executionId: f.snapshot.execution.executionId,
        workSlotId: f.sourceLease.workSlotId,
        providerInvocationKey: f.sourceLease.providerInvocationKey,
        observationId: f.observation.observationId,
        providerVoteIdentityHash: f.sourceLease.providerVoteIdentityHash,
        attachmentKind: ReviewObservationAttachmentKind.FreshLease,
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
        reuseSafetyDecisionHash: null,
        sourceExecutionId: f.sourceLease.executionId,
        sourceLeaseId: f.sourceLease.leaseId,
        sourceFencingToken: f.sourceLease.fencingToken,
        payloadHash: f.observation.payloadHash,
        byteCount: f.observation.byteCount,
        findingCount: f.observation.findingCount,
        attachedAt: now,
      };
      const restored: ReviewExecutionSnapshot =
        sourceKind === "accepted"
          ? {
              ...f.snapshot,
              observationRefs: [acceptedRef],
              execution: {
                ...f.snapshot.execution,
                workSlots: [
                  {
                    ...f.snapshot.execution.workSlots[0]!,
                    state: ReviewWorkSlotState.Satisfied,
                    acceptedObservationRefId: acceptedRef.observationRefId,
                  },
                ],
              },
            }
          : f.snapshot;
      const beforeSnapshot = structuredClone(restored);
      const beforeLease = structuredClone(f.sourceLease);
      const start = vi.fn<
        ReviewActionV2ExecutionHandlerDependencies["executions"]["startReviewExecution"]["execute"]
      >(async () => ({
        status: StartReviewExecutionStatus.Restored,
        snapshot: restored,
      }));
      const d = {
        ...f.d,
        authorizations: {
          resolveReviewRunAuthorizationToken: async () => ({
            status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
            authorization: captured,
          }),
        },
        executionQueries: {
          ...f.d.executionQueries,
          findExecution: async () => restored,
        },
        executions: {
          ...f.d.executions,
          startReviewExecution: { execute: start },
        },
      } satisfies ReviewActionV2ExecutionHandlerDependencies;
      const readback = await discoveryExecutionReadback(
        operation,
        d,
        restored,
      );
      expect(readback.persistedPlan).toMatchObject({
        assignmentManifestVersion: 1,
        planHash: restored.execution.planHash,
        assignmentManifestHash: restored.execution.assignmentManifestHash,
        assignmentManifestCanonicalJson:
          restored.execution.assignmentManifestCanonicalJson,
        workSlots: restored.execution.workSlots,
        acceptedManifests:
          sourceKind === "accepted"
            ? [
                {
                  workSlotId: f.sourceLease.workSlotId,
                  manifestCanonicalJson:
                    f.sourceLease.preparedManifestCanonicalJson,
                  manifestKey: f.sourceLease.preparedManifestKey,
                  providerInvocationKey: f.sourceLease.providerInvocationKey,
                  providerVoteIdentityHash:
                    f.sourceLease.providerVoteIdentityHash,
                },
              ]
            : [],
      });
      if (sourceKind === "unattached") {
        expect(readback.persistedPlan.unattachedAcceptedManifests).toEqual([
          {
            workSlotId: f.sourceLease.workSlotId,
            manifestCanonicalJson: f.sourceLease.preparedManifestCanonicalJson,
            manifestKey: f.sourceLease.preparedManifestKey,
            providerInvocationKey: f.sourceLease.providerInvocationKey,
            providerVoteIdentityHash: f.sourceLease.providerVoteIdentityHash,
            observationId: f.observation.observationId,
            payloadHash: f.observation.payloadHash,
            sourceLeaseId: f.sourceLease.leaseId,
            sourceFencingToken: f.sourceLease.fencingToken.toString(10),
            sourceOwnerIdHash: f.sourceLease.ownerIdHash,
          },
        ]);
        expect(f.findSources).toHaveBeenCalledTimes(1);
      } else {
        expect(readback.persistedPlan).not.toHaveProperty(
          "unattachedAcceptedManifests",
        );
        expect(f.findSources).not.toHaveBeenCalled();
      }
      expect(restored.execution.workSlots[0]).toMatchObject({
        attemptBudget: 1,
        nextAttemptOrdinal: 2,
        activeLeaseId: null,
      });
      expect(restored).toEqual(beforeSnapshot);
      expect(f.sourceLease).toEqual(beforeLease);
      expect(start).toHaveBeenCalledTimes(operation === "start" ? 1 : 0);
      expect(d.executions.invocationFlights.execute).not.toHaveBeenCalled();
      expect(d.executions.invocationLeases.acquire).not.toHaveBeenCalled();
      expect(
        d.executions.observationAttachments.attachFresh,
      ).not.toHaveBeenCalled();
      expect(
        d.executions.observationAttachments.adoptAccepted,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["restore", "legacy"],
    ["start", "legacy"],
    ["restore", "null"],
    ["start", "null"],
    ["restore", "v3"],
    ["start", "v3"],
  ] as const)(
    "%s preserves the legacy execution shape for an ordinary v1 plan with %s runtime",
    async (operation, runtimeKind) => {
      const f = await unattachedRestoreFixture({}, {}, 1);
      const captured =
        runtimeKind === "v3"
          ? ordinaryDiscoveryAuthorization(3)
          : runtimeKind === "null"
            ? { ...authorization, runtimeSnapshotCanonicalJson: null }
            : authorization;
      const runtime = parseReviewRunRuntimeSnapshot(
        captured.runtimeSnapshotCanonicalJson,
      );
      expect(runtime?.snapshotVersion ?? null).toBe(
        runtimeKind === "v3" ? 3 : null,
      );
      expect(runtime?.lifecycleVerificationCapability).toBeUndefined();
      const start = vi.fn<
        ReviewActionV2ExecutionHandlerDependencies["executions"]["startReviewExecution"]["execute"]
      >(async () => ({
        status: StartReviewExecutionStatus.Restored,
        snapshot: f.snapshot,
      }));
      const d = {
        ...f.d,
        authorizations: {
          resolveReviewRunAuthorizationToken: async () => ({
            status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
            authorization: captured,
          }),
        },
        executions: {
          ...f.d.executions,
          startReviewExecution: { execute: start },
        },
      } satisfies ReviewActionV2ExecutionHandlerDependencies;
      const readback = await discoveryExecutionReadback(
        operation,
        d,
        f.snapshot,
      );
      expect(Object.keys(readback).sort()).toEqual([
        "authorizationId",
        "executionId",
        "generation",
        "planHash",
        "reviewRevisionHash",
        "state",
        "version",
        "workSlots",
      ]);
      expect(readback).not.toHaveProperty("persistedPlan");
      expect(readback.workSlots).toEqual([
        {
          workSlotId: "slot-1",
          state: ReviewWorkSlotState.Exhausted,
          required: true,
          providerVoteIdentityHash: f.sourceLease.providerVoteIdentityHash,
          activeLeaseId: null,
          acceptedObservationRefId: null,
        },
      ]);
      expect(start).toHaveBeenCalledTimes(operation === "start" ? 1 : 0);
      expect(f.findSources).not.toHaveBeenCalled();
      expect(d.executions.invocationFlights.execute).not.toHaveBeenCalled();
    },
  );

  it("refuses enabled verifier work without its captured assignment plan before admission", async () => {
    const base = executionDependencies();
    const enabled = lifecycleAuthorization();
    const d = {
      ...base,
      authorizations: {
        resolveReviewRunAuthorizationToken: async () => ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization: enabled,
        }),
      },
    };
    const slot = {
      ...snapshot.execution.workSlots[0]!,
      taskKind: ReviewTaskKind.LifecycleRevalidation,
      required: false,
      attemptBudget: 1,
    };
    const {
      state: _state,
      activeLeaseId: _active,
      acceptedObservationRefId: _accepted,
      nextAttemptOrdinal: _ordinal,
      ...planSlot
    } = slot;
    void [_state, _active, _accepted, _ordinal];
    await expect(
      createReviewActionV2ExecutionHandlers(d).start.execute(
        await startRequest({
          workSlotsCanonicalJson: canonicalJson([planSlot]),
        }),
      ),
    ).rejects.toMatchObject({
      issues: ["lifecycle_verification_plan_required"],
    });
    expect(d.executions.startReviewExecution.execute).not.toHaveBeenCalled();
  });

  it("requires durable completed dispatch proof before accepting verifier evidence from a signed lease", async () => {
    const capabilities = capabilityAdapter();
    const currentLease = lease();
    const leaseCapability = await capabilities.issueLease(
      currentLease,
      manifest().scopeHash,
    );
    const prepared = prepareReviewObservationPayload(
      reusableObservation().payload,
    );
    const observation = reusableObservation({
      sourceExecutionId: currentLease.executionId,
      sourceLeaseId: currentLease.leaseId,
      attemptId: currentLease.attemptId!,
      providerInvocationKey: currentLease.providerInvocationKey,
      payloadHash: await digest.digest(prepared.canonicalBytes),
      byteCount: prepared.byteCount,
    });
    const accepted = vi.fn();
    const base = evidenceDependencies({
      capabilities,
      currentLease,
      acceptObservation: accepted,
    });
    const enabled = lifecycleAuthorization();
    const d = {
      ...base,
      authorizations: {
        resolveReviewRunAuthorizationToken: async () => ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization: enabled,
        }),
      },
      executionQueries: {
        ...base.executionQueries,
        findExecution: async () => ({
          ...snapshot,
          execution: {
            ...snapshot.execution,
            workSlots: [
              {
                ...snapshot.execution.workSlots[0]!,
                taskKind: ReviewTaskKind.LifecycleRevalidation,
                required: false,
                attemptBudget: 1,
              },
            ],
          },
        }),
      },
    };
    await expect(
      createReviewActionV2EvidenceHandlers(d).commit.execute(
        await commitRequest(
          leaseCapability,
          observation,
          stableJsonForTest(observation.payload),
        ),
      ),
    ).rejects.toMatchObject({
      issues: ["lifecycle_verification_dispatch_proof_unavailable"],
    });
    expect(accepted).not.toHaveBeenCalled();
  });

  it("refuses new-profile description publication without a completed scoped dispatch", async () => {
    const fixture = await finalizationFixture(new Date(now.getTime() + 60000));
    const enabled = lifecycleAuthorization();
    const runtime = JSON.parse(enabled.runtimeSnapshotCanonicalJson!);
    runtime.prDescriptionCapability = prDescriptionExtensionV1;
    const auth = {
      ...enabled,
      runtimeSnapshotCanonicalJson: canonicalJson(runtime),
    };
    const descriptionSnapshot = {
      ...snapshot,
      execution: {
        ...snapshot.execution,
        workSlots: [
          {
            ...snapshot.execution.workSlots[0]!,
            taskKind: ReviewTaskKind.PrDescription,
            required: false,
            attemptBudget: 1,
          },
        ],
      },
    };
    const sourceLease = lease({
      state: ReviewInvocationLeaseState.Released,
      preparedManifestCanonicalJson: canonicalJson({
        ...manifest(),
        taskKindSet: [EvidenceTaskKind.PrDescription],
        providerPolicyVersion: "pr-description-provider-policy.v1",
      }),
    });
    const base = executionDependencies({
      currentLease: sourceLease,
      findExecution: async () => descriptionSnapshot,
      finalize: fixture.finalize,
      finalizationFacts: fixture.finalizationFacts,
    });
    const d = {
      ...base,
      authorizations: {
        resolveReviewRunAuthorizationToken: async () => ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization: auth,
        }),
      },
    };
    const projection = {
      publishing: {
        prDescription: {
          generatedMarkdown: "Description",
          generationProvenance: {
            leaseId: sourceLease.leaseId,
            providerIndex: 0,
            requestedModel: "gpt-5-codex",
            actualModel: "gpt-5-codex",
            providerRequestEnvelopeHash: manifest().providerRequestEnvelopeHash,
          },
        },
      },
    };
    const canonical = canonicalJson(projection);
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionFinalize,
      {
        ...fixture.request,
        projectionEnvelopeCanonicalJson: canonical,
        projectionHash: await digest.digestUtf8(canonical),
      },
    );
    await expect(
      createReviewActionV2ExecutionHandlers(d).finalize.execute(request),
    ).rejects.toMatchObject({
      issues: ["pr_description_dispatch_proof_unavailable"],
    });
    expect(fixture.finalizationFacts).not.toHaveBeenCalled();
    expect(fixture.finalize).not.toHaveBeenCalled();
  });

  it("accepts a frozen historical client request at the hashed native execution seam", async () => {
    const base = executionDependencies();
    const d = {
      ...base,
      authorizations: {
        resolveReviewRunAuthorizationToken: async () => ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization: {
            ...authorization,
            schemaDigest:
              reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
          },
        }),
      },
    };
    const request = {
      ...(await startRequest()),
      schemaDigest:
        reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
    };
    const hashed = {
      ...request,
      requestBodyHash: await digest.digestUtf8(
        reviewActionV2LegacySlot.canonicalizeReviewActionV2Request(
          reviewActionV2LegacySlot.ReviewActionV2OperationId
            .ReviewExecutionStart,
          request,
        ),
      ),
    };
    const app = Fastify({ logger: false });
    await registerReviewExecutionV2Routes(app, {
      ...createReviewActionV2ExecutionHandlers(d),
      readServerTime: async () => now,
      createRequestId: () => "old-start",
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/review-executions/start",
      payload: hashed,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      schemaDigest:
        reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
      result: { status: "admitted" },
    });
    await app.close();
    expect(d.executions.startReviewExecution.execute).toHaveBeenCalledOnce();
  });

  it("rejects authorization and revision mismatches before starting", async () => {
    const d = executionDependencies();
    const handlers = createReviewActionV2ExecutionHandlers(d);
    await expect(
      handlers.start.execute(
        await startRequest({ authorizationId: "wrong-authorization" }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      handlers.start.execute(
        await startRequest({ reviewRevisionHash: hash("f") }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(d.executions.startReviewExecution.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed", '{"privateManifest":"never-expose-this",'],
    ["noncanonical", ' { "privateManifest": "never-expose-this" } '],
  ])(
    "rejects %s assignment JSON with a safe protocol error before admission",
    async (_kind, assignmentManifestCanonicalJson) => {
      const d = executionDependencies();
      const enabled = lifecycleAuthorization();
      d.authorizations.resolveReviewRunAuthorizationToken = vi.fn(async () => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization: enabled,
      }));
      // Start from a valid hashed envelope, then corrupt the wire field so the
      // real protocol parser rejects it before entering the handler.
      const request = {
        ...(await startRequest()),
        assignmentManifestCanonicalJson,
        assignmentManifestHash: hash("a"),
      };
      const app = Fastify({ logger: false });
      await registerReviewExecutionV2Routes(app, {
        ...createReviewActionV2ExecutionHandlers(d),
        readServerTime: async () => now,
        createRequestId: () => "invalid-assignment-start",
      });
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/action/v2/review-executions/start",
          payload: request,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({
          errorCode: ReviewActionV2ProtocolErrorCode.InvalidRequest,
          details: {
            issues: ["field_invalid:assignmentManifestCanonicalJson"],
          },
        });
        expect(response.body).not.toContain("never-expose-this");
        expect(response.body).not.toContain("SyntaxError");
        expect(
          d.executions.startReviewExecution.execute,
        ).not.toHaveBeenCalled();
        expect(d.executions.invocationFlights.execute).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it("validates and binds a canonical assignment manifest before starting", async () => {
    const d = executionDependencies();
    d.executions.startReviewExecution.execute = vi.fn(async (input) =>
      input.assignmentManifestHash === hash("f")
        ? {
            status: StartReviewExecutionStatus.AssignmentManifestRejected,
            rejectionReason: "review_assignment_manifest_hash_mismatch",
          }
        : { status: StartReviewExecutionStatus.Admitted, snapshot },
    );
    const handlers = createReviewActionV2ExecutionHandlers(d);
    const sourceSlot = snapshot.execution.workSlots[0]!;
    const workSlots = [
      {
        workSlotId: sourceSlot.workSlotId,
        taskKind: sourceSlot.taskKind,
        providerKind: sourceSlot.providerKind,
        providerVoteIdentityHash: sourceSlot.providerVoteIdentityHash,
        shardKey: sourceSlot.shardKey,
        required: sourceSlot.required,
        attemptBudget: sourceSlot.attemptBudget,
        retryPolicyVersion: sourceSlot.retryPolicyVersion,
      },
    ];
    const workSlotsCanonicalJson = canonicalJson(workSlots);
    const assignmentManifestCanonicalJson = canonicalJson({
      manifestVersion: 1,
      assignments: [{ workSlotId: "slot-1", paths: ["src/a.ts"] }],
      eligiblePaths: ["src/a.ts", "src/b.ts"],
      uncoveredPaths: ["src/b.ts"],
      excludedPaths: ["generated/out.ts"],
    });
    const assignmentManifestHash = await digest.digestUtf8(
      canonicalReviewAssignmentManifestHashPreimage(
        assignmentManifestCanonicalJson,
      ),
    );
    const planHash = await digest.digestUtf8(
      canonicalReviewExecutionPlanHashPreimage({
        assignmentManifestHash,
        compatibilityKey: hash("1"),
        reviewRevisionHash: authorization.reviewRevisionHash,
        workSlots,
      }),
    );
    await expect(
      handlers.start.execute(
        await startRequest({
          workSlotsCanonicalJson,
          assignmentManifestCanonicalJson,
          assignmentManifestHash,
          planHash,
        }),
      ),
    ).resolves.toMatchObject({ result: { status: "admitted" } });
    expect(d.executions.startReviewExecution.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentManifestCanonicalJson,
        assignmentManifestHash,
        planHash,
      }),
    );
    await expect(
      handlers.start.execute(
        await startRequest({
          workSlotsCanonicalJson,
          assignmentManifestCanonicalJson,
          assignmentManifestHash: hash("f"),
          planHash,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it("terminalizes only the active generation and forwards the safe reason pair", async () => {
    const terminalizeWorkSlot = vi.fn(async () => ({
      status: ReviewExecutionLifecycleTransitionStatus.Applied,
      snapshot,
    }));
    const d = executionDependencies();
    d.executions.executionLifecycle.terminalizeWorkSlot = terminalizeWorkSlot;
    const handlers = createReviewActionV2ExecutionHandlers(d);
    const request = {
      ...envelope("terminalize-1"),
      authorizationToken: "authorization-token",
      idempotencyKey: "terminalize-idempotency",
      requestBodyHash: hash("0"),
      executionId: snapshot.execution.executionId,
      generation: snapshot.execution.generation.toString(10),
      reviewRevisionHash: authorization.reviewRevisionHash,
      workSlotId: "slot-1",
      terminalState: ReviewWorkSlotTerminalState.Exhausted,
      reasonCode: ReviewWorkSlotTerminalReason.AttemptBudgetExhausted,
    };
    const signed = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionWorkSlotTerminalize,
      request,
    );
    await expect(
      handlers.terminalizeWorkSlot.execute(signed),
    ).resolves.toMatchObject({
      result: {
        status: ReviewExecutionMutationResultStatus.Applied,
        workSlotId: "slot-1",
      },
    });
    expect(terminalizeWorkSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        generation: snapshot.execution.generation,
        reviewRevisionHash: authorization.reviewRevisionHash,
        workSlotId: "slot-1",
        terminalState: ReviewWorkSlotState.Exhausted,
      }),
    );
    terminalizeWorkSlot.mockResolvedValueOnce({
      status: ReviewExecutionLifecycleTransitionStatus.ConcurrencyConflict,
      snapshot,
    });
    const stale = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionWorkSlotTerminalize,
      { ...request, requestId: "terminalize-stale", generation: "999" },
    );
    await expect(
      handlers.terminalizeWorkSlot.execute(stale),
    ).resolves.toMatchObject({
      result: { status: ReviewExecutionMutationResultStatus.Conflict },
    });
    terminalizeWorkSlot.mockResolvedValueOnce({
      status: ReviewExecutionLifecycleTransitionStatus.Applied,
      snapshot,
    });
    const cancelled = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionWorkSlotTerminalize,
      {
        ...request,
        requestId: "terminalize-cancelled",
        terminalState: ReviewWorkSlotTerminalState.Cancelled,
        reasonCode: ReviewWorkSlotTerminalReason.DeadlineReached,
      },
    );
    await handlers.terminalizeWorkSlot.execute(cancelled);
    expect(terminalizeWorkSlot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        terminalState: ReviewWorkSlotState.Cancelled,
        reasonCode: DomainWorkSlotTerminalReason.DeadlineReached,
      }),
    );
  });

  it("verifies signed capabilities fail-closed and rejects tampering", async () => {
    const capabilities = capabilityAdapter();
    const token = await capabilities.issueLease(lease(), hash("a"));
    await expect(capabilities.verifyLease(token, now)).resolves.toMatchObject({
      authorizationId: authorization.authorizationId,
      leaseId: "lease-1",
      attemptId: "attempt-1",
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    await expect(capabilities.verifyLease(tampered, now)).rejects.toBeDefined();
  });

  it("revalidates cross-execution reuse and restores an idempotent retry", async () => {
    const capabilities = capabilityAdapter();
    const observation = reusableObservation();
    const invocationManifest = manifest();
    const scopeHash = await digest.digestUtf8(
      canonicalJson({
        workspaceId: authorization.workspaceId,
        repositoryConnectionId: authorization.repositoryConnectionId,
        scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
        pullRequestNumber: authorization.pullRequestNumber,
      }),
    );
    const attachmentCapability = await capabilities.issueReusableAttachment(
      {
        authorizationId: authorization.authorizationId,
        mutationEpoch: authorization.mutationEpoch,
        scopeHash,
        targetExecutionId: "execution-target",
        targetWorkSlotId: "slot-1",
        targetReviewRevisionHash: authorization.reviewRevisionHash,
        targetPlanHash: hash("9"),
        observationId: observation.observationId,
        sourceExecutionId: observation.sourceExecutionId,
        manifest: invocationManifest,
        manifestKey: observation.manifestKey,
        providerInvocationKey: observation.providerInvocationKey,
        providerVoteIdentityHash: observation.providerVoteIdentityHash,
        payloadHash: observation.payloadHash,
        byteCount: observation.byteCount,
        findingCount: observation.findingCount,
        attachmentKind: ReviewObservationAttachmentKind.ExactRevisionReuse,
        reuseSafetyDecisionHash: hash("8"),
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
        trustDomain: EvidenceTrustDomain.TrustedManaged,
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );
    let attachmentCalls = 0;
    const d = executionDependencies({
      capabilities,
      evidenceLookup: vi.fn(async () => reuseHit(observation)),
      attachReusable: vi.fn(async () => ({
        status:
          attachmentCalls++ === 0
            ? ReviewObservationAttachmentStatus.Attached
            : ReviewObservationAttachmentStatus.Restored,
        snapshot,
      })),
    });
    const handlers = createReviewActionV2ExecutionHandlers(d);
    const request = await attachRequest(attachmentCapability, observation);
    await expect(
      handlers.attachObservation.execute(request),
    ).resolves.toMatchObject({
      result: { status: ReviewExecutionMutationResultStatus.Applied },
    });
    await expect(
      handlers.attachObservation.execute(request),
    ).resolves.toMatchObject({
      result: { status: ReviewExecutionMutationResultStatus.Restored },
    });
    expect(d.evidence.lookupReviewEvidence.execute).toHaveBeenCalledTimes(2);
    expect(
      d.executions.observationAttachments.attachReusable,
    ).toHaveBeenCalledTimes(2);
  });

  it("rejects context-gateway attachment when its replay proof is stale", async () => {
    const capabilities = capabilityAdapter();
    const attestationId = "attestation-1";
    const attestationHash = hash("a");
    const observation = reusableObservation({
      contextDependencyAttestationId: attestationId,
      contextDependencyAttestationHash: attestationHash,
    });
    const invocationManifest = manifest();
    const verifyAttachment = vi.fn(async () => false);
    const attachmentCapability = await capabilities.issueReusableAttachment(
      {
        authorizationId: authorization.authorizationId,
        mutationEpoch: authorization.mutationEpoch,
        scopeHash: invocationManifest.scopeHash,
        targetExecutionId: "execution-target",
        targetWorkSlotId: "slot-1",
        targetReviewRevisionHash: authorization.reviewRevisionHash,
        targetPlanHash: hash("9"),
        observationId: observation.observationId,
        sourceExecutionId: observation.sourceExecutionId,
        manifest: invocationManifest,
        manifestKey: observation.manifestKey,
        providerInvocationKey: observation.providerInvocationKey,
        providerVoteIdentityHash: observation.providerVoteIdentityHash,
        payloadHash: observation.payloadHash,
        byteCount: observation.byteCount,
        findingCount: observation.findingCount,
        attachmentKind:
          ReviewObservationAttachmentKind.ContextGatewayCrossRevisionReuse,
        reuseSafetyDecisionHash: hash("8"),
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
        trustDomain: EvidenceTrustDomain.TrustedManaged,
        contextReplayProofId: "replay-proof-1",
        contextReplayProofHash: hash("b"),
        contextAttestationId: attestationId,
        contextAttestationHash: attestationHash,
        targetCheckoutTreeOid: gitSha("c"),
        replayBinaryHash: hash("d"),
        replayPolicyVersion: "context-gateway-v1",
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );
    const d = executionDependencies({
      capabilities,
      contextReplay: {
        prepareReplay: vi.fn(),
        verifyAttachment,
        assertCurrentPolicy: vi.fn(),
      },
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).attachObservation.execute(
        await attachRequest(attachmentCapability, observation),
      ),
    ).rejects.toMatchObject({
      statusCode: 412,
      issues: ["attachment_policy_stale"],
    });
    expect(verifyAttachment).toHaveBeenCalledTimes(1);
    expect(d.evidence.lookupReviewEvidence.execute).not.toHaveBeenCalled();
    expect(
      d.executions.observationAttachments.attachReusable,
    ).not.toHaveBeenCalled();
  });

  it("never issues generic reuse authority for same-execution recovery", async () => {
    const { manifestCanonicalJson, identity, sourceLease, observation } =
      await committedAdoptionFixture();
    const d = evidenceDependencies({
      currentLease: sourceLease,
      evidenceLookup: vi.fn(async () => ({
        ...reuseHit(observation),
        status: LookupReviewEvidenceStatus.Shadow,
        selected: {
          ...reuseHit(observation).selected,
          canAttach: false,
          eligibility: ReuseEligibility.CandidateOnly,
          reason: "same_execution_requires_adoption",
          reuseSafetyDecisionHash: null,
        },
      })),
    });
    const result = await createReviewActionV2EvidenceHandlers(d).lookup.execute(
      {
        ...envelope("lookup-1"),
        authorizationToken: "authorization-token",
        executionId: "execution-target",
        workSlotId: "slot-1",
        planHash: hash("9"),
        manifestCanonicalJson,
        manifestKey: identity.manifestKey,
        providerInvocationKey: identity.providerInvocationKey,
        providerVoteIdentityHash: observation.providerVoteIdentityHash,
      },
    );
    expect(result.result).toMatchObject({
      status: ReviewEvidenceLookupResultStatus.Shadow,
      attachmentCapability: null,
      sourceLeaseId: "lease-1",
      sourceFencingToken: "7",
      sourceOwnerIdHash: hash("d"),
    });
  });

  it("prepares a dependency replay for an eligible cross-revision candidate", async () => {
    const providerManifest = manifest();
    const manifestCanonicalJson =
      serializeProviderInvocationManifestCanonicalWireJson(providerManifest);
    const identity = await buildProviderInvocationIdentity(digest, {
      manifest: providerManifest,
      providerVoteIdentityHash: hash("c"),
    });
    const observation = reusableObservation({
      manifestKey: identity.manifestKey,
      providerInvocationKey: identity.providerInvocationKey,
      contextDependencyAttestationId: "attestation-1",
      contextDependencyAttestationHash: hash("a"),
    });
    const prepareReplay = vi.fn(async () => ({
      contextDependencyAttestationId: "attestation-1",
      contextDependencyAttestationHash: hash("a"),
      contextReplayCapability: "replay-capability",
      contextReplayPlanCanonicalJson: "{}",
      contextReplayPlanHash: sha("{}"),
    }));
    const d = evidenceDependencies({
      evidenceLookup: vi.fn(async () => ({
        status: LookupReviewEvidenceStatus.Shadow,
        selected: {
          ...reuseHit(observation).selected,
          eligibility: ReuseEligibility.CandidateOnly,
          tier: ReviewReuseTier.T2ContextGatewayCrossRevision,
          reason: "context_replay_required",
          canAttach: false,
        },
        considered: 1,
        denialReasons: ["context_replay_required"],
      })),
      contextReplay: {
        prepareReplay,
        verifyAttachment: vi.fn(async () => true),
        assertCurrentPolicy: vi.fn(),
      },
    });

    const response = await createReviewActionV2EvidenceHandlers(
      d,
    ).lookup.execute({
      ...envelope("lookup-replay"),
      authorizationToken: "authorization-token",
      executionId: "execution-target",
      workSlotId: "slot-1",
      planHash: hash("9"),
      manifestCanonicalJson,
      manifestKey: identity.manifestKey,
      providerInvocationKey: identity.providerInvocationKey,
      providerVoteIdentityHash: observation.providerVoteIdentityHash,
    });

    expect(response.result).toMatchObject({
      status: ReviewEvidenceLookupResultStatus.ReplayRequired,
      observationId: observation.observationId,
      contextDependencyAttestationId: "attestation-1",
      contextReplayCapability: "replay-capability",
      contextReplayPlanHash: sha("{}"),
      denialReasons: ["context_replay_required"],
    });
    expect(prepareReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization,
        snapshot,
        workSlotId: "slot-1",
        manifest: providerManifest,
        observation,
      }),
    );
  });

  it("fails same-execution lookup closed when adoption source facts drift", async () => {
    const { manifestCanonicalJson, identity, sourceLease, observation } =
      await committedAdoptionFixture();
    const d = evidenceDependencies({
      currentLease: { ...sourceLease, fencingToken: 8n },
      evidenceLookup: vi.fn(async () => ({
        ...reuseHit(observation),
        status: LookupReviewEvidenceStatus.Shadow,
        selected: {
          ...reuseHit(observation).selected,
          canAttach: false,
          eligibility: ReuseEligibility.CandidateOnly,
          reason: "same_execution_requires_adoption",
          reuseSafetyDecisionHash: null,
        },
      })),
    });

    const result = await createReviewActionV2EvidenceHandlers(d).lookup.execute(
      {
        ...envelope("lookup-source-drift"),
        authorizationToken: "authorization-token",
        executionId: "execution-target",
        workSlotId: "slot-1",
        planHash: hash("9"),
        manifestCanonicalJson,
        manifestKey: identity.manifestKey,
        providerInvocationKey: identity.providerInvocationKey,
        providerVoteIdentityHash: observation.providerVoteIdentityHash,
      },
    );

    expect(result.result).toEqual({
      status: ReviewEvidenceLookupResultStatus.Miss,
      denialReasons: ["adoption_source_facts_unavailable"],
    });
  });

  it("fails same-execution lookup closed after the result-report deadline", async () => {
    const { manifestCanonicalJson, identity, sourceLease, observation } =
      await committedAdoptionFixture();
    const d = evidenceDependencies({
      currentLease: {
        ...sourceLease,
        resultReportUntil: new Date(now.getTime() - 1),
      },
      evidenceLookup: vi.fn(async () => ({
        ...reuseHit(observation),
        status: LookupReviewEvidenceStatus.Shadow,
        selected: {
          ...reuseHit(observation).selected,
          canAttach: false,
          eligibility: ReuseEligibility.CandidateOnly,
          reason: "same_execution_requires_adoption",
          reuseSafetyDecisionHash: null,
        },
      })),
    });

    const result = await createReviewActionV2EvidenceHandlers(d).lookup.execute(
      {
        ...envelope("lookup-source-expired"),
        authorizationToken: "authorization-token",
        executionId: "execution-target",
        workSlotId: "slot-1",
        planHash: hash("9"),
        manifestCanonicalJson,
        manifestKey: identity.manifestKey,
        providerInvocationKey: identity.providerInvocationKey,
        providerVoteIdentityHash: observation.providerVoteIdentityHash,
      },
    );

    expect(result.result).toEqual({
      status: ReviewEvidenceLookupResultStatus.Miss,
      denialReasons: ["adoption_source_facts_unavailable"],
    });
  });

  it("does not return an observation payload above negotiated bounds", async () => {
    const observation = reusableObservation({ byteCount: 2_000_000 });
    const d = evidenceDependencies({
      evidenceLookup: vi.fn(async () => reuseHit(observation)),
    });
    const result = await createReviewActionV2EvidenceHandlers(d).lookup.execute(
      {
        ...envelope("lookup-2"),
        authorizationToken: "authorization-token",
        executionId: "execution-target",
        workSlotId: "slot-1",
        planHash: hash("9"),
        manifestCanonicalJson: stableManifestJson(),
        manifestKey: observation.manifestKey,
        providerInvocationKey: observation.providerInvocationKey,
        providerVoteIdentityHash: observation.providerVoteIdentityHash,
      },
    );
    expect(result.result).toEqual({
      status: ReviewEvidenceLookupResultStatus.Miss,
      denialReasons: ["payload_limit_exceeded"],
    });
  });

  it("releases an acquired lease when the revision changes before capability issuance", async () => {
    const capabilities = capabilityAdapter();
    const issueLease = vi.spyOn(capabilities, "issueLease");
    const acquiredLease = lease();
    const acquire = vi.fn(async () => ({
      status: AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
      flight: invocationFlight(acquiredLease),
    }));
    const release = vi.fn(async () => ({
      status: ReviewInvocationLeaseTransitionStatus.Applied,
      lease: {
        ...acquiredLease,
        state: ReviewInvocationLeaseState.Released,
      },
    }));
    const currentRevision = vi
      .fn()
      .mockResolvedValueOnce(CurrentReviewExecutionRevisionStatus.Current)
      .mockResolvedValueOnce(CurrentReviewExecutionRevisionStatus.Stale);
    const prepared = manifest();
    const identity = await buildProviderInvocationIdentity(digest, {
      manifest: prepared,
      providerVoteIdentityHash: hash("c"),
    });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
      {
        ...envelope("acquire-revision-race"),
        authorizationToken: "authorization-token",
        idempotencyKey: "acquire-revision-race",
        requestBodyHash: hash("0"),
        executionId: snapshot.execution.executionId,
        workSlotId: "slot-1",
        purpose: ReviewInvocationLeasePurpose.ProviderExecution,
        manifestCanonicalJson:
          serializeProviderInvocationManifestCanonicalWireJson(prepared),
        manifestKey: identity.manifestKey,
        providerVoteIdentityHash: hash("c"),
        providerInvocationKey: identity.providerInvocationKey,
        acquireRequestId: "acquire-revision-race",
        ownerIdHash: acquiredLease.ownerIdHash,
      } satisfies ReviewInvocationLeaseAcquireRequest,
    );

    await expect(
      createReviewActionV2ExecutionHandlers(
        executionDependencies({
          capabilities,
          acquire,
          release,
          currentRevision,
          leaseSafety: vi.fn(async () => ({
            allowed: true,
            decisionHash: hash("6"),
          })),
        }),
      ).acquireLease.execute(request),
    ).rejects.toMatchObject({
      statusCode: 412,
      issues: ["execution_revision_stale"],
    });
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseId: acquiredLease.leaseId,
        fencingToken: acquiredLease.fencingToken,
      }),
    );
    expect(issueLease).not.toHaveBeenCalled();
  });

  it("acquires an invocation lease for an OCR work slot without execution_provider_unknown", async () => {
    // Discriminating pair for evidenceProviderForExecution: manifest
    // validation on the invocation-lease acquire path must map the Ocr
    // execution provider kind. Without the explicit Ocr case the same
    // request rejects 422 execution_provider_unknown before any lease work.
    const capabilities = capabilityAdapter();
    const acquiredLease = lease();
    const acquire = vi.fn(async () => ({
      status: AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
      flight: invocationFlight(acquiredLease),
    }));
    const ocrSnapshot = {
      ...snapshot,
      execution: {
        ...snapshot.execution,
        workSlots: [
          {
            ...snapshot.execution.workSlots[0]!,
            providerKind: ReviewExecutionProviderKind.Ocr,
          },
        ],
      },
    } as ReviewExecutionSnapshot;
    const prepared: ProviderInvocationManifest = {
      ...manifest(),
      providerKind: ReviewProviderKind.Ocr,
    };
    const identity = await buildProviderInvocationIdentity(digest, {
      manifest: prepared,
      providerVoteIdentityHash: hash("c"),
    });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
      {
        ...envelope("acquire-ocr-work-slot"),
        authorizationToken: "authorization-token",
        idempotencyKey: "acquire-ocr-work-slot",
        requestBodyHash: hash("0"),
        executionId: snapshot.execution.executionId,
        workSlotId: "slot-1",
        purpose: ReviewInvocationLeasePurpose.ProviderExecution,
        manifestCanonicalJson:
          serializeProviderInvocationManifestCanonicalWireJson(prepared),
        manifestKey: identity.manifestKey,
        providerVoteIdentityHash: hash("c"),
        providerInvocationKey: identity.providerInvocationKey,
        acquireRequestId: "acquire-ocr-work-slot",
        ownerIdHash: acquiredLease.ownerIdHash,
      } satisfies ReviewInvocationLeaseAcquireRequest,
    );

    await expect(
      createReviewActionV2ExecutionHandlers(
        executionDependencies({
          capabilities,
          acquire,
          findExecution: vi.fn(async () => ocrSnapshot),
          leaseSafety: vi.fn(async () => ({
            allowed: true,
            decisionHash: hash("6"),
          })),
        }),
      ).acquireLease.execute(request),
    ).resolves.toMatchObject({
      statusCode: 201,
      result: {
        status: ReviewInvocationLeaseResultStatus.Acquired,
        leaseId: acquiredLease.leaseId,
      },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it.each([
    "expired",
    "revoked",
    "extended",
    "expired-before-acquire",
    "expired-during-identity",
  ] as const)(
    "revalidates %s acquisition authority before issuing a lease capability",
    async (scenario) => {
      let acquired = false;
      let currentNow = now;
      const capabilities = capabilityAdapter();
      const issue = vi.spyOn(capabilities, "issueLease");
      const expiresBeforeAcquire =
        scenario === "expired-before-acquire" ||
        scenario === "expired-during-identity";
      if (scenario === "expired-during-identity") {
        const prepareIdentity = capabilities.prepareIdentity.bind(capabilities);
        vi.spyOn(capabilities, "prepareIdentity").mockImplementation(
          async () => {
            const identity = await prepareIdentity();
            currentNow = authorization.expiresAt;
            return identity;
          },
        );
      }
      const acquiredLease = lease(
        scenario === "extended"
          ? {
              expiresAt: new Date(authorization.expiresAt.getTime() + 1),
              resultReportUntil: new Date(
                authorization.expiresAt.getTime() + 1,
              ),
            }
          : {},
      );
      const release = vi.fn(async () => ({
        status: ReviewInvocationLeaseTransitionStatus.Applied,
        lease: { ...acquiredLease, state: ReviewInvocationLeaseState.Released },
      }));
      const acquire = vi.fn(async () => {
        acquired = true;
        if (scenario === "expired") currentNow = authorization.expiresAt;
        return {
          status: AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
          flight: invocationFlight(acquiredLease),
        };
      });
      const dependencies = executionDependencies({
        capabilities,
        release,
        now: () => currentNow,
        currentLease: acquiredLease,
        acquire,
        leaseSafety: async () => {
          if (scenario === "expired-before-acquire")
            currentNow = authorization.expiresAt;
          return { allowed: true, decisionHash: hash("6") };
        },
      });
      const handlers = createReviewActionV2ExecutionHandlers({
        ...dependencies,
        authorizationQueries: {
          findReviewRunAuthorizationById: async () => ({
            ...authorization,
            state:
              acquired && scenario === "revoked"
                ? ReviewRunAuthorizationState.Revoked
                : ReviewRunAuthorizationState.Active,
          }),
        },
      });
      const prepared = manifest();
      const identity = await buildProviderInvocationIdentity(digest, {
        manifest: prepared,
        providerVoteIdentityHash: hash("c"),
      });
      const request = await withBodyHash(
        ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
        {
          ...envelope("acquire-authority-race"),
          authorizationToken: "authorization-token",
          idempotencyKey: "acquire-authority-race",
          requestBodyHash: hash("0"),
          executionId: snapshot.execution.executionId,
          workSlotId: "slot-1",
          purpose: ReviewInvocationLeasePurpose.ProviderExecution,
          manifestCanonicalJson:
            serializeProviderInvocationManifestCanonicalWireJson(prepared),
          manifestKey: identity.manifestKey,
          providerVoteIdentityHash: hash("c"),
          providerInvocationKey: identity.providerInvocationKey,
          acquireRequestId: "acquire-authority-race",
          ownerIdHash: hash("d"),
        } satisfies ReviewInvocationLeaseAcquireRequest,
      );

      await expect(
        handlers.acquireLease.execute(request),
      ).rejects.toMatchObject({
        statusCode: 410,
        errorCode: ReviewActionV2ProtocolErrorCode.ResourceGone,
      });
      expect(issue).not.toHaveBeenCalled();
      if (expiresBeforeAcquire) {
        expect(acquire).not.toHaveBeenCalled();
        expect(release).not.toHaveBeenCalled();
        return;
      }
      expect(release).toHaveBeenCalledOnce();
      expect(release).toHaveBeenCalledWith({
        leaseId: acquiredLease.leaseId,
        ownerIdHash: acquiredLease.ownerIdHash,
        leaseCapabilityId: acquiredLease.leaseCapabilityId,
        fencingToken: acquiredLease.fencingToken,
        now: currentNow,
      });
    },
  );

  it("acquires and renews a valid lease when authorization has less than the initial lease duration left", async () => {
    const delayedNow = new Date(now.getTime() + 1_000);
    let currentNow = delayedNow;
    const delayedSnapshot = {
      ...snapshot,
      execution: {
        ...snapshot.execution,
        executionDeadlineAt: new Date(now.getTime() + 6 * 60 * 60 * 1_000),
      },
    };
    let acquiredLease: ReviewInvocationLease | undefined;
    const acquire = vi.fn<
      ReviewActionV2ExecutionHandlerDependencies["executions"]["invocationFlights"]["execute"]
    >(async (command) => {
      const decision = decideLeaseAcquire({
        ...command,
        stream: delayedSnapshot.stream,
        execution: delayedSnapshot.execution,
        activeLease: null,
        fencingToken: 1n,
      });
      if (!("lease" in decision)) throw new Error("test_lease_not_acquired");
      acquiredLease = decision.lease;
      return {
        status: AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
        flight: invocationFlight(acquiredLease),
      };
    });
    const renew = vi.fn<
      ReviewActionV2ExecutionHandlerDependencies["executions"]["invocationLeases"]["renew"]
    >(async (command) => {
      if (!acquiredLease) throw new Error("test_lease_not_acquired");
      const decision = decideLeaseRenewal({
        ...command,
        lease: acquiredLease,
        execution: delayedSnapshot.execution,
      });
      if (decision.status === LeaseTransitionDecisionStatus.InvalidDeadline) {
        return {
          status: ReviewInvocationLeaseTransitionStatus.InvalidDeadline,
        };
      }
      if (decision.status !== LeaseTransitionDecisionStatus.Restored)
        throw new Error("test_lease_not_restored");
      acquiredLease = decision.lease;
      return {
        status: ReviewInvocationLeaseTransitionStatus.Restored,
        lease: decision.lease,
      };
    });
    const dependencies = executionDependencies({
      now: () => currentNow,
      findExecution: vi.fn(async () => delayedSnapshot),
      findLease: vi.fn(async () => acquiredLease ?? null),
      acquire,
      renew,
      leaseSafety: vi.fn(async () => ({
        allowed: true,
        decisionHash: hash("6"),
      })),
    });
    const d: ReviewActionV2ExecutionHandlerDependencies = {
      ...dependencies,
      timing: { ...dependencies.timing, initialLeaseDurationMs: 600_000 },
      protocolLimits: {
        ...dependencies.protocolLimits,
        findProtocolLimitsProfileById: vi.fn(async () => ({
          ...protocolLimits,
          maxLeaseDurationMs: 600_000,
          maxResultReportDurationMs: 1_200_000,
        })),
      },
    };
    const prepared = manifest();
    const identity = await buildProviderInvocationIdentity(digest, {
      manifest: prepared,
      providerVoteIdentityHash: hash("c"),
    });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
      {
        ...envelope("acquire-short-authorization"),
        authorizationToken: "authorization-token",
        idempotencyKey: "acquire-short-authorization",
        requestBodyHash: hash("0"),
        executionId: delayedSnapshot.execution.executionId,
        workSlotId: "slot-1",
        purpose: ReviewInvocationLeasePurpose.ProviderExecution,
        manifestCanonicalJson:
          serializeProviderInvocationManifestCanonicalWireJson(prepared),
        manifestKey: identity.manifestKey,
        providerVoteIdentityHash: hash("c"),
        providerInvocationKey: identity.providerInvocationKey,
        acquireRequestId: "acquire-short-authorization",
        ownerIdHash: hash("d"),
      } satisfies ReviewInvocationLeaseAcquireRequest,
    );

    const handlers = createReviewActionV2ExecutionHandlers(d);
    const acquired = await handlers.acquireLease.execute(request);
    expect(acquired).toMatchObject({ statusCode: 201 });
    expect(acquiredLease?.expiresAt).toEqual(authorization.expiresAt);
    expect(acquiredLease?.resultReportUntil).toEqual(authorization.expiresAt);
    expect(acquiredLease?.expiresAt.getTime()).toBeGreaterThan(
      delayedNow.getTime(),
    );
    if (!acquiredLease || !acquired.result.leaseCapability)
      throw new Error("test_acquired_capability_missing");
    const originalLease = acquiredLease;
    currentNow = new Date(delayedNow.getTime() + 30_000);
    const renewed = await handlers.renewLease.execute(
      await withBodyHash(ReviewActionV2OperationId.ReviewInvocationLeaseRenew, {
        ...envelope("renew-short-authorization"),
        leaseCapability: acquired.result.leaseCapability,
        idempotencyKey: "renew-short-authorization",
        requestBodyHash: hash("0"),
        leaseId: originalLease.leaseId,
        ownerIdHash: originalLease.ownerIdHash,
        fencingToken: originalLease.fencingToken.toString(10),
        renewRequestId: "renew-short-authorization",
      }),
    );
    expect(renewed).toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewInvocationLeaseResultStatus.Restored,
        expiresAt: authorization.expiresAt.toISOString(),
        fencingToken: originalLease.fencingToken.toString(10),
      },
    });
    expect(acquiredLease.resultReportUntil).toEqual(
      originalLease.resultReportUntil,
    );
    expect(acquiredLease.expiresAt.getTime()).toBeGreaterThan(
      currentNow.getTime(),
    );
    if (!renewed.result.leaseCapability)
      throw new Error("test_renewed_capability_missing");
    await expect(
      d.capabilities.verifyLease(renewed.result.leaseCapability, currentNow),
    ).resolves.toMatchObject({
      ownershipExpiresAt: originalLease.expiresAt,
      resultReportUntil: originalLease.resultReportUntil,
    });
  });

  it("rolls a live invocation lease beyond ten minutes without exceeding ownership TTL or the execution deadline", async () => {
    let currentNow = new Date(now);
    const hardDeadline = new Date(now.getTime() + 35 * 60_000);
    const liveAuthorization = {
      ...authorization,
      expiresAt: new Date(now.getTime() + 6 * 60 * 60_000),
      maxExpiresAt: new Date(now.getTime() + 6 * 60 * 60_000),
    };
    const longSnapshot = {
      ...snapshot,
      execution: { ...snapshot.execution, executionDeadlineAt: hardDeadline },
    };
    let currentLease: ReviewInvocationLease | null = null;
    const acquire = vi.fn<
      ReviewActionV2ExecutionHandlerDependencies["executions"]["invocationFlights"]["execute"]
    >(async (command) => {
      const decision = decideLeaseAcquire({
        ...command,
        stream: longSnapshot.stream,
        execution: longSnapshot.execution,
        activeLease: null,
        fencingToken: 1n,
      });
      if (!("lease" in decision)) throw new Error("test_lease_not_acquired");
      currentLease = decision.lease;
      return {
        status: AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
        flight: invocationFlight(currentLease),
      };
    });
    const renew = vi.fn<
      ReviewActionV2ExecutionHandlerDependencies["executions"]["invocationLeases"]["renew"]
    >(async (command) => {
      if (!currentLease) throw new Error("test_lease_not_acquired");
      const decision = decideLeaseRenewal({
        ...command,
        lease: currentLease,
        execution: longSnapshot.execution,
      });
      if (
        decision.status !== LeaseTransitionDecisionStatus.Applied &&
        decision.status !== LeaseTransitionDecisionStatus.Restored
      )
        throw new Error(`test_renewal_rejected:${decision.status}`);
      currentLease = decision.lease;
      return {
        status:
          decision.status === LeaseTransitionDecisionStatus.Applied
            ? ReviewInvocationLeaseTransitionStatus.Applied
            : ReviewInvocationLeaseTransitionStatus.Restored,
        lease: currentLease,
      };
    });
    const release = vi.fn<
      ReviewActionV2ExecutionHandlerDependencies["executions"]["invocationLeases"]["release"]
    >(async (command) => {
      if (!currentLease) throw new Error("test_lease_not_acquired");
      const decision = decideLeaseRelease({
        ...command,
        lease: currentLease,
        execution: longSnapshot.execution,
      });
      if (decision.status !== LeaseTransitionDecisionStatus.Applied)
        throw new Error("test_release_rejected");
      currentLease = decision.lease;
      return {
        status: ReviewInvocationLeaseTransitionStatus.Applied,
        lease: currentLease,
      };
    });
    const dependencies = executionDependencies({
      now: () => currentNow,
      findExecution: vi.fn(async () => longSnapshot),
      findLease: vi.fn(async () => currentLease),
      acquire,
      renew,
      release,
      leaseSafety: vi.fn(async () => ({
        allowed: true,
        decisionHash: hash("6"),
      })),
    });
    const d: ReviewActionV2ExecutionHandlerDependencies = {
      ...dependencies,
      timing: { ...dependencies.timing, initialLeaseDurationMs: 600_000 },
    };
    d.authorizations.resolveReviewRunAuthorizationToken = vi.fn(async () => ({
      status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
      authorization: liveAuthorization,
    }));
    d.authorizationQueries.findReviewRunAuthorizationById = vi.fn(
      async () => liveAuthorization,
    );
    d.protocolLimits.findProtocolLimitsProfileById = vi.fn(async () => ({
      ...protocolLimits,
      maxLeaseDurationMs: 600_000,
      maxResultReportDurationMs: 1_200_000,
    }));
    const prepared = manifest();
    const identity = await buildProviderInvocationIdentity(digest, {
      manifest: prepared,
      providerVoteIdentityHash: hash("c"),
    });
    const handlers = createReviewActionV2ExecutionHandlers(d);
    const acquired = await handlers.acquireLease.execute(
      await withBodyHash(
        ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
        {
          ...envelope("acquire-rolling"),
          authorizationToken: "authorization-token",
          idempotencyKey: "acquire-rolling",
          requestBodyHash: hash("0"),
          executionId: longSnapshot.execution.executionId,
          workSlotId: "slot-1",
          purpose: ReviewInvocationLeasePurpose.ProviderExecution,
          manifestCanonicalJson:
            serializeProviderInvocationManifestCanonicalWireJson(prepared),
          manifestKey: identity.manifestKey,
          providerVoteIdentityHash: hash("c"),
          providerInvocationKey: identity.providerInvocationKey,
          acquireRequestId: "acquire-rolling",
          ownerIdHash: hash("d"),
        } satisfies ReviewInvocationLeaseAcquireRequest,
      ),
    );
    let capability = acquired.result.leaseCapability;
    if (!capability) throw new Error("test_capability_missing");
    for (const minute of [5, 10, 15, 20, 25, 30]) {
      currentNow = new Date(now.getTime() + minute * 60_000);
      const liveLease = await d.executionQueries.findLease("lease-generated");
      if (!liveLease) throw new Error("test_lease_missing");
      const request = await withBodyHash(
        ReviewActionV2OperationId.ReviewInvocationLeaseRenew,
        {
          ...envelope(`renew-rolling-${minute}`),
          leaseCapability: capability,
          idempotencyKey: `renew-rolling-${minute}`,
          requestBodyHash: hash("0"),
          leaseId: liveLease.leaseId,
          ownerIdHash: liveLease.ownerIdHash,
          fencingToken: liveLease.fencingToken.toString(10),
          renewRequestId: `renew-rolling-${minute}`,
        },
      );
      const renewed = await handlers.renewLease.execute(request);
      expect(renewed.result).toMatchObject({
        status:
          minute === 30
            ? ReviewInvocationLeaseResultStatus.Restored
            : ReviewInvocationLeaseResultStatus.Applied,
        expiresAt: new Date(
          Math.min(currentNow.getTime() + 600_000, hardDeadline.getTime()),
        ).toISOString(),
      });
      const expectedReportUntil = new Date(
        Math.min(currentNow.getTime() + 1_200_000, hardDeadline.getTime()),
      );
      expect(
        (await d.executionQueries.findLease(liveLease.leaseId))
          ?.resultReportUntil,
      ).toEqual(expectedReportUntil);
      if (!renewed.result.leaseCapability)
        throw new Error("test_capability_missing");
      await expect(
        d.capabilities.verifyLease(renewed.result.leaseCapability, currentNow),
      ).resolves.toMatchObject({ resultReportUntil: expectedReportUntil });
      // Lost acknowledgement: the same request restores the original dates.
      currentNow = new Date(currentNow.getTime() + 1_000);
      await expect(handlers.renewLease.execute(request)).resolves.toMatchObject(
        {
          result: {
            ...renewed.result,
            status: ReviewInvocationLeaseResultStatus.Restored,
            leaseCapability: expect.any(String),
          },
        },
      );
      expect(
        (await d.executionQueries.findLease(liveLease.leaseId))
          ?.resultReportUntil,
      ).toEqual(expectedReportUntil);
      if (minute === 30) {
        await handlers.releaseLease.execute(
          await withBodyHash(
            ReviewActionV2OperationId.ReviewInvocationLeaseRelease,
            {
              ...envelope("release-rolling"),
              leaseCapability: capability,
              idempotencyKey: "release-rolling",
              releaseRequestId: "release-rolling",
              requestBodyHash: hash("0"),
              leaseId: liveLease.leaseId,
              ownerIdHash: liveLease.ownerIdHash,
              fencingToken: liveLease.fencingToken.toString(10),
            },
          ),
        );
        const renewCount = renew.mock.calls.length;
        await expect(
          handlers.renewLease.execute(request),
        ).rejects.toMatchObject({ statusCode: 410 });
        expect(renew).toHaveBeenCalledTimes(renewCount);
      }
      if (!renewed.result.leaseCapability)
        throw new Error("test_capability_missing");
      capability = renewed.result.leaseCapability;
    }
    const renewCount = renew.mock.calls.length;
    currentNow = hardDeadline;
    await expect(
      handlers.renewLease.execute(
        await withBodyHash(
          ReviewActionV2OperationId.ReviewInvocationLeaseRenew,
          {
            ...envelope("renew-at-hard-deadline"),
            leaseCapability: capability,
            idempotencyKey: "renew-at-hard-deadline",
            requestBodyHash: hash("0"),
            leaseId: "lease-generated",
            ownerIdHash: hash("d"),
            fencingToken: "1",
            renewRequestId: "renew-at-hard-deadline",
          },
        ),
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      issues: ["lease_capability_invalid"],
    });
    expect(renew).toHaveBeenCalledTimes(renewCount);
  });

  it.each(["revoked", "expired"] as const)(
    "denies rolling renewal when the original authorization is %s",
    async (condition) => {
      const capabilities = capabilityAdapter();
      const currentLease = lease();
      const capability = await capabilities.issueLease(
        currentLease,
        manifest().scopeHash,
      );
      const d = executionDependencies({ capabilities, currentLease });
      d.authorizationQueries.findReviewRunAuthorizationById = vi.fn(
        async () => ({
          ...authorization,
          ...(condition === "revoked"
            ? { state: ReviewRunAuthorizationState.Revoked }
            : { expiresAt: now }),
        }),
      );
      const issueLease = vi.spyOn(capabilities, "issueLease");
      await expect(
        createReviewActionV2ExecutionHandlers(d).renewLease.execute(
          await withBodyHash(
            ReviewActionV2OperationId.ReviewInvocationLeaseRenew,
            {
              ...envelope(`renew-${condition}-authorization`),
              leaseCapability: capability,
              idempotencyKey: `renew-${condition}-authorization`,
              requestBodyHash: hash("0"),
              leaseId: currentLease.leaseId,
              ownerIdHash: currentLease.ownerIdHash,
              fencingToken: currentLease.fencingToken.toString(10),
              renewRequestId: `renew-${condition}-authorization`,
            },
          ),
        ),
      ).rejects.toMatchObject({ statusCode: 410 });
      expect(d.executions.invocationLeases.renew).not.toHaveBeenCalled();
      expect(issueLease).not.toHaveBeenCalled();
    },
  );

  it("returns busy for an exact-revision join without issuing owner capability", async () => {
    const capabilities = capabilityAdapter();
    const issueLease = vi.spyOn(capabilities, "issueLease");
    const incumbentLease = lease();
    const acquire = vi.fn(async () => ({
      status: AcquireOrJoinInvocationFlightStatus.Joined,
      flight: invocationFlight(incumbentLease),
    }));
    const prepared = manifest();
    const identity = await buildProviderInvocationIdentity(digest, {
      manifest: prepared,
      providerVoteIdentityHash: hash("c"),
    });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
      {
        ...envelope("join-existing-flight"),
        authorizationToken: "authorization-token",
        idempotencyKey: "join-existing-flight",
        requestBodyHash: hash("0"),
        executionId: snapshot.execution.executionId,
        workSlotId: "slot-1",
        purpose: ReviewInvocationLeasePurpose.ProviderExecution,
        manifestCanonicalJson:
          serializeProviderInvocationManifestCanonicalWireJson(prepared),
        manifestKey: identity.manifestKey,
        providerVoteIdentityHash: hash("c"),
        providerInvocationKey: identity.providerInvocationKey,
        acquireRequestId: "join-existing-flight",
        ownerIdHash: sha("joining-owner"),
      } satisfies ReviewInvocationLeaseAcquireRequest,
    );
    const d = executionDependencies({
      capabilities,
      acquire,
      leaseSafety: vi.fn(async () => ({
        allowed: true,
        decisionHash: hash("6"),
      })),
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).acquireLease.execute(request),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: { status: ReviewInvocationLeaseResultStatus.Busy },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(d.executionQueries.findLease).not.toHaveBeenCalled();
    expect(issueLease).not.toHaveBeenCalled();
  });

  it("returns a safe rejection reason when the invocation attempt budget is exhausted", async () => {
    const capabilities = capabilityAdapter();
    const issueLease = vi.spyOn(capabilities, "issueLease");
    const acquire = vi.fn(async () => ({
      status: AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted,
    }));
    const prepared = manifest();
    const identity = await buildProviderInvocationIdentity(digest, {
      manifest: prepared,
      providerVoteIdentityHash: hash("c"),
    });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseAcquire,
      {
        ...envelope("attempt-budget-exhausted"),
        authorizationToken: "authorization-token",
        idempotencyKey: "attempt-budget-exhausted",
        requestBodyHash: hash("0"),
        executionId: snapshot.execution.executionId,
        workSlotId: "slot-1",
        purpose: ReviewInvocationLeasePurpose.ProviderExecution,
        manifestCanonicalJson:
          serializeProviderInvocationManifestCanonicalWireJson(prepared),
        manifestKey: identity.manifestKey,
        providerVoteIdentityHash: hash("c"),
        providerInvocationKey: identity.providerInvocationKey,
        acquireRequestId: "attempt-budget-exhausted",
        ownerIdHash: sha("owner"),
      } satisfies ReviewInvocationLeaseAcquireRequest,
    );
    const d = executionDependencies({
      capabilities,
      acquire,
      leaseSafety: vi.fn(async () => ({
        allowed: true,
        decisionHash: hash("6"),
      })),
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).acquireLease.execute(request),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewInvocationLeaseResultStatus.Rejected,
        rejectionReason:
          AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted,
      },
    });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(d.executionQueries.findLease).not.toHaveBeenCalled();
    expect(issueLease).not.toHaveBeenCalled();
  });

  it("surfaces a stale fencing term without applying a renewal", async () => {
    const capabilities = capabilityAdapter();
    const leaseCapability = await capabilities.issueLease(
      lease(),
      manifest().scopeHash,
    );
    const renew = vi.fn(async () => ({
      status: ReviewInvocationLeaseTransitionStatus.StaleTerm,
    }));
    const d = executionDependencies({ capabilities, renew });
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseRenew,
      {
        ...envelope("renew-1"),
        leaseCapability,
        idempotencyKey: "renew-idempotency",
        requestBodyHash: hash("0"),
        leaseId: "lease-1",
        ownerIdHash: hash("d"),
        fencingToken: "6",
        renewRequestId: "renew-request-1",
      },
    );
    await expect(
      createReviewActionV2ExecutionHandlers(d).renewLease.execute(request),
    ).resolves.toMatchObject({
      result: { status: ReviewInvocationLeaseResultStatus.StaleTerm },
    });
    expect(renew).toHaveBeenCalledWith(
      expect.objectContaining({
        fencingToken: 6n,
        renewRequestIdHash: await digest.digestUtf8("renew-request-1"),
        renewRequestHash: request.requestBodyHash,
      }),
    );
  });

  it.each(["revision", "authorization"] as const)(
    "releases a renewed lease when the %s changes before capability issuance",
    async (changedAuthority) => {
      const capabilities = capabilityAdapter();
      const originalLease = lease();
      const renewedLease = lease({
        renewedAt: new Date(now),
        expiresAt: new Date(now.getTime() + 60_000),
      });
      const leaseCapability = await capabilities.issueLease(
        originalLease,
        manifest().scopeHash,
      );
      const issueLease = vi.spyOn(capabilities, "issueLease");
      issueLease.mockClear();
      const renew = vi.fn(async () => ({
        status: ReviewInvocationLeaseTransitionStatus.Applied,
        lease: renewedLease,
      }));
      const release = vi.fn(async () => ({
        status: ReviewInvocationLeaseTransitionStatus.Applied,
        lease: {
          ...renewedLease,
          state: ReviewInvocationLeaseState.Released,
        },
      }));
      const currentRevision = vi
        .fn()
        .mockResolvedValueOnce(CurrentReviewExecutionRevisionStatus.Current)
        .mockResolvedValueOnce(
          changedAuthority === "revision"
            ? CurrentReviewExecutionRevisionStatus.Stale
            : CurrentReviewExecutionRevisionStatus.Current,
        );
      const request = await withBodyHash(
        ReviewActionV2OperationId.ReviewInvocationLeaseRenew,
        {
          ...envelope("renew-revision-race"),
          leaseCapability,
          idempotencyKey: "renew-revision-race",
          requestBodyHash: hash("0"),
          leaseId: originalLease.leaseId,
          ownerIdHash: originalLease.ownerIdHash,
          fencingToken: originalLease.fencingToken.toString(10),
          renewRequestId: "renew-revision-race",
        },
      );

      const d = executionDependencies({
        capabilities,
        currentLease: originalLease,
        currentRevision,
        renew,
        release,
      });
      if (changedAuthority === "authorization") {
        d.authorizationQueries.findReviewRunAuthorizationById = vi
          .fn()
          .mockResolvedValueOnce(authorization)
          .mockResolvedValueOnce({
            ...authorization,
            state: ReviewRunAuthorizationState.Revoked,
          });
      }
      await expect(
        createReviewActionV2ExecutionHandlers(d).renewLease.execute(request),
      ).rejects.toMatchObject({
        statusCode: changedAuthority === "revision" ? 412 : 410,
        issues: [
          changedAuthority === "revision"
            ? "execution_revision_stale"
            : "lease_authorization_inactive",
        ],
      });
      expect(release).toHaveBeenCalledWith(
        expect.objectContaining({
          leaseId: renewedLease.leaseId,
          fencingToken: renewedLease.fencingToken,
        }),
      );
      expect(issueLease).not.toHaveBeenCalled();
    },
  );

  it("rejects a renewal replay identity reused with a different body", async () => {
    const capabilities = capabilityAdapter();
    const currentLease = lease();
    const leaseCapability = await capabilities.issueLease(
      currentLease,
      manifest().scopeHash,
    );
    const renew = vi.fn(async () => ({
      status: ReviewInvocationLeaseTransitionStatus.IdempotencyConflict,
    }));
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewInvocationLeaseRenew,
      {
        ...envelope("renew-conflict"),
        leaseCapability,
        idempotencyKey: "renew-conflict",
        requestBodyHash: hash("0"),
        leaseId: currentLease.leaseId,
        ownerIdHash: currentLease.ownerIdHash,
        fencingToken: currentLease.fencingToken.toString(10),
        renewRequestId: "renew-request-reused",
      },
    );

    await expect(
      createReviewActionV2ExecutionHandlers(
        executionDependencies({ capabilities, currentLease, renew }),
      ).renewLease.execute(request),
    ).rejects.toMatchObject({
      statusCode: 409,
      issues: ["lease_renewal_replay_conflict"],
    });
  });

  it("returns a renewed capability, rejects old ownership, and keeps late reporting valid", async () => {
    const capabilities = capabilityAdapter();
    const originalLease = lease({
      expiresAt: new Date(now.getTime() + 10_000),
      resultReportUntil: new Date(now.getTime() + 120_000),
    });
    const renewedLease = lease({
      renewedAt: new Date(now),
      expiresAt: new Date(now.getTime() + 60_000),
      resultReportUntil: originalLease.resultReportUntil,
    });
    const oldCapability = await capabilities.issueLease(
      originalLease,
      manifest().scopeHash,
    );
    const renew = vi.fn(async () => ({
      status: ReviewInvocationLeaseTransitionStatus.Applied,
      lease: renewedLease,
    }));
    const renewed = await createReviewActionV2ExecutionHandlers(
      executionDependencies({
        capabilities,
        currentLease: originalLease,
        renew,
      }),
    ).renewLease.execute(
      await withBodyHash(ReviewActionV2OperationId.ReviewInvocationLeaseRenew, {
        ...envelope("renew-fresh-capability"),
        leaseCapability: oldCapability,
        idempotencyKey: "renew-fresh-capability",
        requestBodyHash: hash("0"),
        leaseId: originalLease.leaseId,
        ownerIdHash: originalLease.ownerIdHash,
        fencingToken: originalLease.fencingToken.toString(10),
        renewRequestId: "renew-fresh-capability",
      }),
    );
    const newCapability = renewed.result.leaseCapability;
    if (!newCapability) throw new Error("renewed_capability_missing");
    expect(newCapability).not.toBe(oldCapability);

    const afterOriginalOwnership = new Date(now.getTime() + 20_000);
    await expect(
      capabilities.verifyLease(oldCapability, afterOriginalOwnership),
    ).resolves.toMatchObject({
      ownershipExpiresAt: originalLease.expiresAt,
      resultReportUntil: originalLease.resultReportUntil,
    });
    await expect(
      capabilities.verifyLease(newCapability, afterOriginalOwnership),
    ).resolves.toMatchObject({
      ownershipExpiresAt: renewedLease.expiresAt,
      resultReportUntil: renewedLease.resultReportUntil,
    });

    const release = vi.fn(async () => ({
      status: ReviewInvocationLeaseTransitionStatus.Applied,
      lease: {
        ...renewedLease,
        state: ReviewInvocationLeaseState.Released,
      },
    }));
    const ownershipHandlers = createReviewActionV2ExecutionHandlers(
      executionDependencies({
        capabilities,
        currentLease: renewedLease,
        release,
        now: () => afterOriginalOwnership,
      }),
    );
    const releaseRequest = (leaseCapability: string, requestId: string) =>
      withBodyHash(ReviewActionV2OperationId.ReviewInvocationLeaseRelease, {
        ...envelope(requestId),
        leaseCapability,
        idempotencyKey: requestId,
        requestBodyHash: hash("0"),
        leaseId: renewedLease.leaseId,
        ownerIdHash: renewedLease.ownerIdHash,
        fencingToken: renewedLease.fencingToken.toString(10),
        releaseRequestId: requestId,
      });
    await expect(
      ownershipHandlers.releaseLease.execute(
        await releaseRequest(oldCapability, "release-old-capability"),
      ),
    ).rejects.toMatchObject({
      statusCode: 410,
      issues: ["lease_ownership_expired"],
    });
    expect(release).not.toHaveBeenCalled();

    const preparedPayload = prepareReviewObservationPayload(
      reusableObservation().payload,
    );
    const observation = reusableObservation({
      sourceExecutionId: renewedLease.executionId,
      sourceLeaseId: renewedLease.leaseId,
      attemptId: renewedLease.attemptId!,
      providerInvocationKey: renewedLease.providerInvocationKey,
      payloadHash: await digest.digest(preparedPayload.canonicalBytes),
      byteCount: preparedPayload.byteCount,
    });
    const acceptObservation = vi.fn(async () => ({
      status: AcceptReviewObservationStatus.Accepted,
      observation,
      historicalOnly: false,
      eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
    }));
    await expect(
      createReviewActionV2EvidenceHandlers(
        evidenceDependencies({
          capabilities,
          currentLease: renewedLease,
          acceptObservation,
          now: () => afterOriginalOwnership,
        }),
      ).commit.execute(
        await commitRequest(
          oldCapability,
          observation,
          stableJsonForTest(observation.payload),
        ),
      ),
    ).resolves.toMatchObject({
      result: { status: ReviewEvidenceCommitResultStatus.Accepted },
    });
    expect(acceptObservation).toHaveBeenCalledTimes(1);

    await expect(
      ownershipHandlers.releaseLease.execute(
        await releaseRequest(newCapability, "release-new-capability"),
      ),
    ).resolves.toMatchObject({
      result: { status: ReviewInvocationLeaseResultStatus.Applied },
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rejects fresh attachment after persisted lease expiry", async () => {
    const capabilities = capabilityAdapter();
    const expiredLease = lease({
      acquiredAt: new Date(now.getTime() - 60_000),
      renewedAt: new Date(now.getTime() - 60_000),
      expiresAt: new Date(now.getTime() - 1_000),
      resultReportUntil: new Date(now.getTime() + 60_000),
    });
    const leaseCapability = await capabilities.issueLease(
      expiredLease,
      manifest().scopeHash,
    );
    const observation = reusableObservation({
      sourceExecutionId: "execution-target",
      sourceLeaseId: "lease-1",
      attemptId: "attempt-1",
      providerInvocationKey: expiredLease.providerInvocationKey,
    });
    const d = executionDependencies({
      capabilities,
      currentLease: expiredLease,
    });
    await expect(
      createReviewActionV2ExecutionHandlers(d).attachObservation.execute(
        await attachRequest(leaseCapability, observation),
      ),
    ).rejects.toMatchObject({ statusCode: 410 });
    expect(
      d.executions.observationAttachments.attachFresh,
    ).not.toHaveBeenCalled();
  });

  it("restores a lost fresh-attachment response after the persisted source lease is released", async () => {
    const { d, store, sourceLease, request } =
      await persistedObservationFixture();
    const handlers = createReviewActionV2ExecutionHandlers(d);

    await expect(
      handlers.attachObservation.execute(request),
    ).resolves.toMatchObject({
      result: { status: ReviewExecutionMutationResultStatus.Applied },
    });
    expect(await store.findLease(sourceLease.leaseId)).toMatchObject({
      state: ReviewInvocationLeaseState.Released,
    });
    const attached = await store.findExecution(sourceLease.executionId);
    expect(attached?.observationRefs).toHaveLength(1);

    await expect(
      handlers.attachObservation.execute(request),
    ).resolves.toMatchObject({
      result: { status: ReviewExecutionMutationResultStatus.Restored },
    });
    expect(await store.findExecution(sourceLease.executionId)).toEqual(
      attached,
    );
  });

  it("does not use an unattached released lease to create a fresh observation reference", async () => {
    const { d, store, sourceLease, request } =
      await persistedObservationFixture();
    await store.releaseLease({
      leaseId: sourceLease.leaseId,
      ownerIdHash: sourceLease.ownerIdHash,
      leaseCapabilityId: sourceLease.leaseCapabilityId,
      fencingToken: sourceLease.fencingToken,
      now,
    });
    const released = await store.findExecution(sourceLease.executionId);

    await expect(
      createReviewActionV2ExecutionHandlers(d).attachObservation.execute(
        request,
      ),
    ).resolves.toMatchObject({
      result: { status: ReviewExecutionMutationResultStatus.Rejected },
    });
    expect(
      d.executions.observationAttachments.attachFresh,
    ).toHaveBeenCalledTimes(1);
    expect(await store.findExecution(sourceLease.executionId)).toEqual(
      released,
    );
  });

  it("does not restore a changed fresh-attachment body from a released source lease", async () => {
    const { d, store, sourceLease, request } =
      await persistedObservationFixture();
    const handlers = createReviewActionV2ExecutionHandlers(d);
    await handlers.attachObservation.execute(request);
    const attached = await store.findExecution(sourceLease.executionId);
    const changed = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionObservationAttach,
      {
        ...request,
        payloadHash: hash("8"),
      },
    );

    await expect(
      handlers.attachObservation.execute(changed),
    ).rejects.toMatchObject({
      statusCode: 403,
      issues: ["fresh_observation_authority_mismatch"],
    });
    expect(
      d.executions.observationAttachments.attachFresh,
    ).toHaveBeenCalledTimes(1);
    expect(await store.findExecution(sourceLease.executionId)).toEqual(
      attached,
    );
  });

  it("does not restore an attached observation after its authorization expires", async () => {
    const { d, store, sourceLease, request } =
      await persistedObservationFixture();
    const handlers = createReviewActionV2ExecutionHandlers(d);
    await handlers.attachObservation.execute(request);
    const attached = await store.findExecution(sourceLease.executionId);
    d.authorizations.resolveReviewRunAuthorizationToken = vi.fn(async () => ({
      status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
      authorization: { ...authorization, expiresAt: new Date(now) },
    }));

    await expect(
      handlers.attachObservation.execute(request),
    ).rejects.toMatchObject({
      statusCode: 410,
      issues: ["authorization_inactive"],
    });
    expect(
      d.executions.observationAttachments.attachFresh,
    ).toHaveBeenCalledTimes(1);
    expect(await store.findExecution(sourceLease.executionId)).toEqual(
      attached,
    );
  });

  it.each([
    {
      label: "API deadline expired",
      deadlineMs: -1,
      serverTimeMs: 0,
      statusCode: 410,
    },
    {
      label: "database deadline equality",
      deadlineMs: 60_000,
      serverTimeMs: 60_000,
      statusCode: 410,
    },
    {
      label: "database expiry with lagging API",
      deadlineMs: 60_000,
      serverTimeMs: 60_001,
      statusCode: 410,
    },
    {
      label: "unavailable database clock",
      deadlineMs: 180_000,
      serverTimeMs: "reject",
      statusCode: 503,
    },
    {
      label: "invalid database clock",
      deadlineMs: 180_000,
      serverTimeMs: "invalid",
      statusCode: 503,
    },
    {
      label: "valid deadline with database ahead",
      deadlineMs: 180_000,
      serverTimeMs: 60_000,
      statusCode: 200,
    },
  ] as const)(
    "checks publication replay before signing: $label",
    async ({ deadlineMs, serverTimeMs, statusCode }) => {
      const capabilities = capabilityAdapter();
      const issuePublicationPermit = vi.spyOn(
        capabilities,
        "issuePublicationPermit",
      );
      const fixture = await finalizationFixture(
        new Date(now.getTime() + 180_000),
      );
      const artifact = {
        ...fixture.artifact,
        publicationPermit: {
          ...fixture.artifact.publicationPermit,
          publicationNotAfter: new Date(now.getTime() + deadlineMs),
        },
      };
      const persisted = { ...snapshot, artifact };
      const unchanged = structuredClone(persisted);
      const finalize = vi.fn(async () => ({
        status: ReviewExecutionFinalizeStatus.Restored,
        artifact,
        snapshot: persisted,
      }));
      const readServerTime = vi.fn(async () => {
        if (serverTimeMs === "reject")
          throw new Error("database clock unavailable");
        return serverTimeMs === "invalid"
          ? new Date(Number.NaN)
          : new Date(now.getTime() + serverTimeMs);
      });
      const handlers = createReviewActionV2ExecutionHandlers(
        executionDependencies({
          capabilities,
          finalize,
          finalizationFacts: fixture.finalizationFacts,
          readServerTime,
        }),
      );

      if (statusCode === 200) {
        const response = await handlers.finalize.execute(fixture.request);
        expect(response).toMatchObject({
          statusCode: 200,
          result: { status: ReviewExecutionMutationResultStatus.Restored },
        });
        expect(issuePublicationPermit).toHaveBeenCalledTimes(1);
        expect(issuePublicationPermit).toHaveBeenCalledWith(
          artifact.publicationPermit,
          now,
        );
        const token = response.result.publicationPermit;
        expect(token).toEqual(expect.any(String));
        await expect(
          capabilities.verifyPublicationPermit(token!, now),
        ).resolves.toMatchObject({
          executionId: artifact.executionId,
        });
      } else {
        await expect(
          handlers.finalize.execute(fixture.request),
        ).rejects.toMatchObject({
          statusCode,
          errorCode:
            statusCode === 410
              ? ReviewActionV2ProtocolErrorCode.ResourceGone
              : ReviewActionV2ProtocolErrorCode.ServiceUnavailable,
          issues: [
            statusCode === 410
              ? "publication_permit_expired"
              : "publication_time_unavailable",
          ],
        });
        expect(issuePublicationPermit).not.toHaveBeenCalled();
      }
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(readServerTime).toHaveBeenCalledTimes(1);
      expect(persisted).toEqual(unchanged);
    },
  );

  it.each(["authorization", "publication"] as const)(
    "does not finalize when facts resolution outlives the %s deadline",
    async (deadlineOwner) => {
      const {
        d: dependencies,
        store,
        sourceLease,
        request: attach,
      } = await persistedObservationFixture();
      await createReviewActionV2ExecutionHandlers(
        dependencies,
      ).attachObservation.execute(attach);
      const before = (await store.findExecution(sourceLease.executionId))!;
      const deadline =
        deadlineOwner === "authorization"
          ? authorization.expiresAt
          : new Date(now.getTime() + 60_000);
      const fixture = await finalizationFixture(deadline);
      let currentNow = new Date(now);
      const d = { ...dependencies, now: () => currentNow };
      const finalize = vi.fn(store.finalizeExecution.bind(store));
      d.executions.finalizeReviewExecution.execute = finalize;
      d.finalizationFacts.resolve = vi.fn(async () => {
        currentNow = new Date(deadline);
        return fixture.finalizationFacts();
      });
      const issuePublicationPermit = vi.spyOn(
        d.capabilities,
        "issuePublicationPermit",
      );
      const request = await withBodyHash(
        ReviewActionV2OperationId.ReviewExecutionFinalize,
        {
          ...fixture.request,
          expectedStreamVersion: before.stream.version.toString(10),
          expectedExecutionVersion: before.execution.version.toString(10),
        },
      );

      await expect(
        createReviewActionV2ExecutionHandlers(d).finalize.execute(request),
      ).rejects.toMatchObject({
        statusCode: 410,
        errorCode: ReviewActionV2ProtocolErrorCode.ResourceGone,
        issues: [
          deadlineOwner === "authorization"
            ? "authorization_inactive"
            : "publication_permit_expired",
        ],
      });
      expect(finalize).not.toHaveBeenCalled();
      expect(issuePublicationPermit).not.toHaveBeenCalled();
      expect(await store.findExecution(sourceLease.executionId)).toEqual(
        before,
      );
    },
  );

  it.each([
    { label: "deadline equality", offsetMs: 0, invalidRetention: false },
    { label: "past deadline", offsetMs: 1, invalidRetention: false },
    { label: "invalid retention", offsetMs: 0, invalidRetention: true },
  ])(
    "preserves the store finalization outcome: $label",
    async ({ offsetMs, invalidRetention }) => {
      const {
        d: dependencies,
        store,
        sourceLease,
        request: attach,
      } = await persistedObservationFixture();
      await createReviewActionV2ExecutionHandlers(
        dependencies,
      ).attachObservation.execute(attach);
      const before = (await store.findExecution(sourceLease.executionId))!;
      const fixture = await finalizationFixture(
        new Date(now.getTime() + 60_000),
      );
      const d = { ...dependencies };
      const finalize = vi.fn(
        (command: Parameters<typeof store.finalizeExecution>[0]) =>
          store.finalizeExecution({
            ...command,
            now: new Date(command.publicationNotAfter.getTime() + offsetMs),
            retainUntil: invalidRetention
              ? command.publicationNotAfter
              : command.retainUntil,
          }),
      );
      d.executions.finalizeReviewExecution.execute = finalize;
      d.finalizationFacts.resolve = fixture.finalizationFacts;
      const readServerTime = vi.spyOn(d, "readServerTime");
      const issuePublicationPermit = vi.spyOn(
        d.capabilities,
        "issuePublicationPermit",
      );
      const request = await withBodyHash(
        ReviewActionV2OperationId.ReviewExecutionFinalize,
        {
          ...fixture.request,
          expectedStreamVersion: before.stream.version.toString(10),
          expectedExecutionVersion: before.execution.version.toString(10),
        },
      );

      const result =
        createReviewActionV2ExecutionHandlers(d).finalize.execute(request);
      if (invalidRetention) {
        await expect(result).rejects.toThrowError(
          "review_execution_invalid_finalization_window",
        );
      } else {
        await expect(result).rejects.toMatchObject({
          statusCode: 410,
          errorCode: ReviewActionV2ProtocolErrorCode.ResourceGone,
          issues: ["publication_permit_expired"],
        });
      }
      expect(finalize).toHaveBeenCalledTimes(1);
      expect(finalize).toHaveBeenCalledWith(
        expect.objectContaining({
          now,
          publicationNotAfter:
            fixture.artifact.publicationPermit.publicationNotAfter,
        }),
      );
      expect(readServerTime).not.toHaveBeenCalled();
      expect(issuePublicationPermit).not.toHaveBeenCalled();
      expect(await store.findExecution(sourceLease.executionId)).toEqual(
        before,
      );
    },
  );

  it.each([
    CurrentReviewExecutionRevisionStatus.Unavailable,
    CurrentReviewExecutionRevisionStatus.Stale,
  ])(
    "does not issue a publication permit when the revision becomes %s after finalization",
    async (revisionStatus) => {
      const fixture = await finalizationFixture(
        new Date(now.getTime() + 60_000),
      );
      const capabilities = capabilityAdapter();
      const issuePublicationPermit = vi.spyOn(
        capabilities,
        "issuePublicationPermit",
      );
      const currentRevision = vi
        .fn()
        .mockResolvedValueOnce(CurrentReviewExecutionRevisionStatus.Current)
        .mockResolvedValueOnce(revisionStatus);

      await expect(
        createReviewActionV2ExecutionHandlers(
          executionDependencies({
            capabilities,
            finalize: fixture.finalize,
            finalizationFacts: fixture.finalizationFacts,
            currentRevision,
          }),
        ).finalize.execute(fixture.request),
      ).rejects.toMatchObject({
        statusCode:
          revisionStatus === CurrentReviewExecutionRevisionStatus.Stale
            ? 412
            : 503,
        issues: [
          revisionStatus === CurrentReviewExecutionRevisionStatus.Stale
            ? "execution_revision_stale"
            : "execution_revision_unavailable",
        ],
      });
      expect(fixture.finalize).toHaveBeenCalledTimes(1);
      expect(issuePublicationPermit).not.toHaveBeenCalled();
    },
  );

  it("does not issue a publication permit when post-finalization revision verification reaches its deadline", async () => {
    const {
      d: dependencies,
      store,
      sourceLease,
      request: attach,
    } = await persistedObservationFixture();
    await createReviewActionV2ExecutionHandlers(
      dependencies,
    ).attachObservation.execute(attach);
    const before = (await store.findExecution(sourceLease.executionId))!;
    const publicationNotAfter = new Date(now.getTime() + 60_000);
    const fixture = await finalizationFixture(publicationNotAfter);
    let currentNow = new Date(now);
    const d = { ...dependencies, now: () => currentNow };
    const finalize = vi.fn(store.finalizeExecution.bind(store));
    d.executions.finalizeReviewExecution.execute = finalize;
    d.finalizationFacts.resolve = fixture.finalizationFacts;
    const currentRevision = vi
      .fn()
      .mockResolvedValueOnce(CurrentReviewExecutionRevisionStatus.Current)
      .mockImplementationOnce(async () => {
        currentNow = new Date(publicationNotAfter);
        return CurrentReviewExecutionRevisionStatus.Current;
      });
    d.executions.currentRevision.execute = currentRevision;
    const issuePublicationPermit = vi.spyOn(
      d.capabilities,
      "issuePublicationPermit",
    );
    const request = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionFinalize,
      {
        ...fixture.request,
        expectedStreamVersion: before.stream.version.toString(10),
        expectedExecutionVersion: before.execution.version.toString(10),
      },
    );

    await expect(
      createReviewActionV2ExecutionHandlers(d).finalize.execute(request),
    ).rejects.toMatchObject({
      statusCode: 410,
      issues: ["publication_permit_expired"],
    });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(currentRevision).toHaveBeenCalledTimes(2);
    expect(issuePublicationPermit).not.toHaveBeenCalled();
    const persisted = (await store.findExecution(sourceLease.executionId))!;
    expect(persisted.execution.state).toBe(ReviewExecutionState.Completed);
    expect(persisted.artifact?.publicationPermit.publicationNotAfter).toEqual(
      publicationNotAfter,
    );
  });

  it("fails finalization before projection work when context policy is stale", async () => {
    const fixture = await finalizationFixture(new Date(now.getTime() + 60_000));
    const assertCurrentPolicy = vi
      .fn()
      .mockRejectedValue(new Error("context_policy_stale"));
    const d = executionDependencies({
      finalize: fixture.finalize,
      finalizationFacts: fixture.finalizationFacts,
      contextReplay: {
        prepareReplay: vi.fn(),
        verifyAttachment: vi.fn(),
        assertCurrentPolicy,
      },
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).finalize.execute(
        fixture.request,
      ),
    ).rejects.toThrow("context_policy_stale");
    expect(assertCurrentPolicy).toHaveBeenCalledTimes(1);
    expect(fixture.finalizationFacts).not.toHaveBeenCalled();
    expect(fixture.finalize).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "native span",
      qualityFlags: [
        ReviewObservationQualityFlag.ContextInspectionIncomplete,
        ReviewObservationQualityFlag.ProviderWarning,
        ReviewObservationQualityFlag.UnverifiedNativeSpan,
      ],
    },
    {
      name: "verified clean",
      qualityFlags: [ReviewObservationQualityFlag.InvestigationVerifiedClean],
    },
    ...[
      ReviewObservationQualityFlag.ReviewMainIncomplete,
      ReviewObservationQualityFlag.ReviewRoundIncomplete,
      ReviewObservationQualityFlag.ReviewPhaseIncomplete,
    ].map((cause) => ({
      name: cause,
      qualityFlags: [
        ReviewObservationQualityFlag.ContextInspectionIncomplete,
        ReviewObservationQualityFlag.ProviderWarning,
        cause,
      ],
    })),
  ])("restores $name after crash", async ({ qualityFlags }) => {
    const capabilities = capabilityAdapter();
    const currentLease = lease();
    const leaseCapability = await capabilities.issueLease(
      currentLease,
      manifest().scopeHash,
    );
    const payloadCanonicalJson = stableJsonForTest(
      reusableObservation().payload,
    );
    const preparedPayload = prepareReviewObservationPayload(
      reusableObservation().payload,
    );
    const observation = reusableObservation({
      sourceExecutionId: "execution-target",
      sourceLeaseId: currentLease.leaseId,
      attemptId: currentLease.attemptId!,
      providerInvocationKey: currentLease.providerInvocationKey,
      payloadHash: await digest.digest(preparedPayload.canonicalBytes),
      byteCount: preparedPayload.byteCount,
      qualityFlags,
    });
    const acceptObservation = vi
      .fn()
      .mockResolvedValueOnce({
        status: AcceptReviewObservationStatus.Accepted,
        observation,
        historicalOnly: false,
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      })
      .mockResolvedValueOnce({
        status: AcceptReviewObservationStatus.Idempotent,
        observation,
        historicalOnly: false,
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      });
    const evidence = evidenceDependencies({
      capabilities,
      currentLease,
      acceptObservation,
    });
    const commit = await withBodyHash(
      ReviewActionV2OperationId.ReviewEvidenceCommit,
      {
        ...(await commitRequest(
          leaseCapability,
          observation,
          payloadCanonicalJson,
        )),
        qualityFlags,
      },
    );

    await expect(
      createReviewActionV2EvidenceHandlers(evidence).commit.execute(commit),
    ).resolves.toMatchObject({
      result: {
        status: ReviewEvidenceCommitResultStatus.Accepted,
        observationId: observation.observationId,
      },
    });

    // Simulated crash: no attachment is attempted before the exact commit retry.
    await expect(
      createReviewActionV2EvidenceHandlers(evidence).commit.execute(commit),
    ).resolves.toMatchObject({
      result: {
        status: ReviewEvidenceCommitResultStatus.Idempotent,
        observationId: observation.observationId,
      },
    });

    const attachFresh = vi.fn(async () => ({
      status: ReviewObservationAttachmentStatus.Attached,
      snapshot,
    }));
    const execution = executionDependencies({
      capabilities,
      currentLease,
      observation,
      attachFresh,
    });
    await expect(
      createReviewActionV2ExecutionHandlers(
        execution,
      ).attachObservation.execute(
        await attachRequest(leaseCapability, observation),
      ),
    ).resolves.toMatchObject({
      result: { status: ReviewExecutionMutationResultStatus.Applied },
    });
    expect(acceptObservation).toHaveBeenCalledTimes(2);
    expect(acceptObservation).toHaveBeenCalledWith(
      expect.objectContaining({ qualityFlags: commit.qualityFlags }),
    );
    expect(attachFresh).toHaveBeenCalledTimes(1);
    expect(execution.observations.findById).toHaveBeenCalledWith(
      observation.observationId,
    );
    await expect(
      vi.mocked(execution.observations.findById).mock.results[0]?.value,
    ).resolves.toMatchObject({ qualityFlags });
  });

  it("adopts committed evidence after process restart without issuing a reuse capability", async () => {
    const { manifestCanonicalJson, identity, sourceLease, observation } =
      await committedAdoptionFixture();
    const leasedSnapshot = snapshotWithSlot({
      state: ReviewWorkSlotState.Leased,
      activeLeaseId: sourceLease.leaseId,
      executionVersion: 3n,
      activeLeases: [sourceLease],
    });
    const adoptedSnapshot = snapshotWithSlot({
      state: ReviewWorkSlotState.Satisfied,
      activeLeaseId: null,
      acceptedObservationRefId: "obsref-adopted",
      executionVersion: 5n,
    });
    const adoptAccepted = vi.fn(async () => ({
      status: ReviewObservationAttachmentStatus.Attached,
      snapshot: adoptedSnapshot,
    }));
    const d = executionDependencies({
      currentLease: sourceLease,
      observation,
      adoptAccepted,
      findExecution: vi.fn().mockResolvedValue(leasedSnapshot),
      findLease: vi.fn(async () => sourceLease),
      leaseSafety: vi.fn(async () => ({
        allowed: true,
        decisionHash: hash("6"),
      })),
    });
    const request = await adoptionRequest({
      sourceLease,
      observation,
      manifestCanonicalJson,
      manifestKey: identity.manifestKey,
      expectedExecutionVersion: leasedSnapshot.execution.version,
      expectedStreamVersion: leasedSnapshot.stream.version,
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).adoptObservation.execute(
        request,
      ),
    ).resolves.toMatchObject({
      statusCode: 201,
      result: {
        status: ReviewExecutionMutationResultStatus.Applied,
        executionId: sourceLease.executionId,
        workSlotId: sourceLease.workSlotId,
        observationPayloadCanonicalJson: expect.any(String),
        observationFactsCanonicalJson: expect.any(String),
      },
    });
    expect(adoptAccepted).toHaveBeenCalledTimes(1);
    expect(adoptAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLeaseId: sourceLease.leaseId,
        sourceFencingToken: sourceLease.fencingToken,
        sourceObservationId: observation.observationId,
        providerInvocationKey: identity.providerInvocationKey,
        leaseCapabilityId: "capability-generated",
        capabilitySigningKeyId: "test-key",
        expectedExecutionVersion: leasedSnapshot.execution.version,
        expectedStreamVersion: leasedSnapshot.stream.version,
      }),
    );
  });

  it("rejects adoption after the source result-report deadline", async () => {
    const {
      d: dependencies,
      store,
      before,
      sourceLease,
      request,
      adoptAccepted,
    } = await persistedAdoptionFixture();
    const d = {
      ...dependencies,
      now: () => new Date(sourceLease.resultReportUntil.getTime() + 1),
    };

    await expect(
      createReviewActionV2ExecutionHandlers(d).adoptObservation.execute(
        request,
      ),
    ).rejects.toMatchObject({
      statusCode: 412,
      issues: ["adoption_result_report_expired"],
    });
    expect(adoptAccepted).toHaveBeenCalledTimes(1);
    expect(await store.findExecution(sourceLease.executionId)).toEqual(before);
    expect(await store.findLease(sourceLease.leaseId)).toEqual(sourceLease);
  });

  it("reports adoption expiry from the store clock when the API clock lags", async () => {
    const { d, store, before, sourceLease, request, adoptAccepted } =
      await persistedAdoptionFixture();
    adoptAccepted.mockImplementation((command) =>
      store.adoptObservation({
        ...command,
        now: new Date(sourceLease.resultReportUntil.getTime() + 1),
      }),
    );

    await expect(
      createReviewActionV2ExecutionHandlers(d).adoptObservation.execute(
        request,
      ),
    ).rejects.toMatchObject({
      statusCode: 412,
      issues: ["adoption_result_report_expired"],
    });
    expect(adoptAccepted).toHaveBeenCalledTimes(1);
    expect(await store.findExecution(sourceLease.executionId)).toEqual(before);
    expect(await store.findLease(sourceLease.leaseId)).toEqual(sourceLease);
  });

  it("keeps a stale adoption rejection when the API clock passes the report window", async () => {
    const {
      d: dependencies,
      store,
      before,
      sourceLease,
      request,
      adoptAccepted,
    } = await persistedAdoptionFixture();
    let currentNow = new Date(now);
    const d = { ...dependencies, now: () => currentNow };
    adoptAccepted.mockImplementation(async (command) => {
      const result = await store.adoptObservation({
        ...command,
        expectedExecutionVersion: command.expectedExecutionVersion + 1n,
      });
      expect(result.status).toBe(ReviewObservationAttachmentStatus.Ineligible);
      currentNow = new Date(sourceLease.resultReportUntil.getTime() + 1);
      return result;
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).adoptObservation.execute(
        request,
      ),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: { status: ReviewExecutionMutationResultStatus.Rejected },
    });
    expect(adoptAccepted).toHaveBeenCalledTimes(1);
    expect(await store.findExecution(sourceLease.executionId)).toEqual(before);
    expect(await store.findLease(sourceLease.leaseId)).toEqual(sourceLease);
  });

  it.each(["safety resolution", "capability preparation"] as const)(
    "rejects adoption when %s outlives the source result-report window",
    async (delayAt) => {
      const {
        d: dependencies,
        store,
        sourceLease,
        observation,
        manifestCanonicalJson,
        identity,
      } = await persistedObservationFixture();
      const before = (await store.findExecution(sourceLease.executionId))!;
      let currentNow = new Date(now);
      const d = { ...dependencies, now: () => currentNow };
      const advancePastReportWindow = () => {
        currentNow = new Date(sourceLease.resultReportUntil.getTime() + 1);
      };
      d.leaseSafety.resolve = vi.fn(async () => {
        if (delayAt === "safety resolution") advancePastReportWindow();
        return { allowed: true, decisionHash: hash("6") };
      });
      const prepareIdentity = d.capabilities.prepareIdentity.bind(
        d.capabilities,
      );
      vi.spyOn(d.capabilities, "prepareIdentity").mockImplementation(
        async () => {
          const identity = await prepareIdentity();
          if (delayAt === "capability preparation") advancePastReportWindow();
          return identity;
        },
      );
      const adoptAccepted = vi.fn(store.adoptObservation.bind(store));
      d.executions.observationAttachments.adoptAccepted = adoptAccepted;
      const request = await adoptionRequest({
        sourceLease,
        observation,
        manifestCanonicalJson,
        manifestKey: identity.manifestKey,
        expectedExecutionVersion: before.execution.version,
        expectedStreamVersion: before.stream.version,
      });

      await expect(
        createReviewActionV2ExecutionHandlers(d).adoptObservation.execute(
          request,
        ),
      ).rejects.toMatchObject({
        statusCode: 412,
        issues: ["adoption_result_report_expired"],
      });
      expect(adoptAccepted).toHaveBeenCalledTimes(1);
      expect(await store.findExecution(sourceLease.executionId)).toEqual(
        before,
      );
      expect(await store.findLease(sourceLease.leaseId)).toEqual(sourceLease);
    },
  );

  it("rejects an inactive-source adoption whose caller version is exactly one behind", async () => {
    const { manifestCanonicalJson, identity, sourceLease, observation } =
      await committedAdoptionFixture({
        state: ReviewInvocationLeaseState.Released,
      });
    const currentSnapshot = snapshotWithSlot({
      state: ReviewWorkSlotState.Pending,
      activeLeaseId: null,
      executionVersion: snapshot.execution.version + 1n,
    });
    const adoptAccepted = vi.fn();
    const leaseSafety = vi.fn();
    const d = executionDependencies({
      currentLease: sourceLease,
      observation,
      adoptAccepted,
      leaseSafety,
      findExecution: vi.fn(async () => currentSnapshot),
    });
    const request = await adoptionRequest({
      sourceLease,
      observation,
      manifestCanonicalJson,
      manifestKey: identity.manifestKey,
      expectedExecutionVersion: currentSnapshot.execution.version - 1n,
      expectedStreamVersion: currentSnapshot.stream.version,
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).adoptObservation.execute(
        request,
      ),
    ).rejects.toMatchObject({
      statusCode: 412,
      issues: ["adoption_execution_version_mismatch"],
    });
    expect(leaseSafety).not.toHaveBeenCalled();
    expect(adoptAccepted).not.toHaveBeenCalled();
  });

  it("restores concurrent identical observation adoptions without a second persisted mutation", async () => {
    const {
      d,
      store,
      before,
      sourceLease,
      observation,
      request,
      adoptAccepted,
    } = await persistedAdoptionFixture();
    let releasePreparations!: () => void;
    const preparationsReady = new Promise<void>((resolve) => {
      releasePreparations = resolve;
    });
    let preparationCount = 0;
    const prepareIdentity = d.capabilities.prepareIdentity.bind(d.capabilities);
    vi.spyOn(d.capabilities, "prepareIdentity").mockImplementation(async () => {
      const identity = await prepareIdentity();
      const ordinal = ++preparationCount;
      if (preparationCount === 2) releasePreparations();
      await preparationsReady;
      return { ...identity, capabilityId: `concurrent-adoption-${ordinal}` };
    });
    const handlers = createReviewActionV2ExecutionHandlers(d);
    const results = await Promise.all([
      handlers.adoptObservation.execute(request),
      handlers.adoptObservation.execute(request),
    ]);

    expect(preparationCount).toBe(2);
    expect(adoptAccepted).toHaveBeenCalledTimes(2);
    const firstCommand = adoptAccepted.mock.calls[0]![0];
    const secondCommand = adoptAccepted.mock.calls[1]![0];
    expect(secondCommand.adoptionLeaseId).toBe(firstCommand.adoptionLeaseId);
    expect(secondCommand.leaseCapabilityId).not.toBe(
      firstCommand.leaseCapabilityId,
    );
    const persisted = (await store.findExecution(sourceLease.executionId))!;
    expect(persisted.observationRefs).toHaveLength(1);
    expect(persisted.execution.version).toBe(before.execution.version + 1n);
    expect(persisted.execution.workSlots[0]).toMatchObject({
      state: ReviewWorkSlotState.Satisfied,
      activeLeaseId: null,
      acceptedObservationRefId: persisted.observationRefs[0]!.observationRefId,
      nextAttemptOrdinal: before.execution.workSlots[0]!.nextAttemptOrdinal,
    });
    expect(await store.findLease(sourceLease.leaseId)).toMatchObject({
      state: ReviewInvocationLeaseState.Released,
    });
    expect(await store.findLease(firstCommand.adoptionLeaseId)).toMatchObject({
      purpose: ReviewInvocationLeasePurpose.ObservationAdoption,
      state: ReviewInvocationLeaseState.Released,
      sourceObservationId: observation.observationId,
      acquireRequestHash: request.requestBodyHash,
    });
    expect(results.map((result) => result.result.status).sort()).toEqual(
      [
        ReviewExecutionMutationResultStatus.Applied,
        ReviewExecutionMutationResultStatus.Restored,
      ].sort(),
    );
    for (const result of results) {
      expect(result.result).toMatchObject({
        observationPayloadCanonicalJson: expect.any(String),
        observationFactsCanonicalJson: expect.any(String),
      });
    }

    const persistedSource = await store.findLease(sourceLease.leaseId);
    const persistedAdoption = await store.findLease(
      firstCommand.adoptionLeaseId,
    );
    const preparedReplay = await d.capabilities.prepareIdentity();
    const replayCommand = {
      ...firstCommand,
      leaseCapabilityId: preparedReplay.capabilityId,
      capabilitySigningKeyId: preparedReplay.signingKeyId,
      now: new Date(sourceLease.resultReportUntil.getTime() + 1),
    };
    expect(replayCommand.leaseCapabilityId).not.toBe(
      persistedAdoption?.leaseCapabilityId,
    );
    const lateReplay = await store.adoptObservation(replayCommand);
    expect(lateReplay.status).toBe(ReviewObservationAttachmentStatus.Restored);
    expect(lateReplay.snapshot).toEqual(persisted);
    for (const changedIntent of [
      { ownerIdHash: hash("e") },
      { adoptionAcquireRequestHash: hash("f") },
    ]) {
      const conflict = await store.adoptObservation({
        ...replayCommand,
        ...changedIntent,
      });
      expect(conflict.status).toBe(ReviewObservationAttachmentStatus.Conflict);
    }
    expect(await store.findExecution(sourceLease.executionId)).toEqual(
      persisted,
    );
    expect(await store.findLease(sourceLease.leaseId)).toEqual(persistedSource);
    expect(await store.findLease(firstCommand.adoptionLeaseId)).toEqual(
      persistedAdoption,
    );
  });

  it("restores an identical in-flight adoption after its first commit crosses the report window", async () => {
    const fixture = await persistedAdoptionFixture();
    const {
      d: dependencies,
      store,
      sourceLease,
      request,
      adoptAccepted,
    } = fixture;
    let currentNow = new Date(now);
    const d = { ...dependencies, now: () => currentNow };
    let releasePreparations!: () => void;
    let rejectPreparations!: (error: unknown) => void;
    const preparationsReady = new Promise<void>((resolve, reject) => {
      releasePreparations = resolve;
      rejectPreparations = reject;
    });
    let releaseFirstCommit!: () => void;
    let rejectFirstCommit!: (error: unknown) => void;
    const firstCommitted = new Promise<void>((resolve, reject) => {
      releaseFirstCommit = resolve;
      rejectFirstCommit = reject;
    });
    // A request can fail before its peer starts waiting on either gate.
    void preparationsReady.catch(() => {});
    void firstCommitted.catch(() => {});
    const rejectGates = (error: unknown) => {
      rejectPreparations(error);
      rejectFirstCommit(error);
    };
    let preparationCount = 0;
    const prepareIdentity = d.capabilities.prepareIdentity.bind(d.capabilities);
    vi.spyOn(d.capabilities, "prepareIdentity").mockImplementation(async () => {
      const identity = await prepareIdentity();
      const ordinal = ++preparationCount;
      if (ordinal === 1) {
        await preparationsReady;
      } else {
        releasePreparations();
        await firstCommitted;
      }
      return { ...identity, capabilityId: `late-adoption-${ordinal}` };
    });
    adoptAccepted.mockImplementationOnce(async (command) => {
      try {
        const result = await store.adoptObservation(command);
        expect(result.status).toBe(ReviewObservationAttachmentStatus.Attached);
        currentNow = new Date(sourceLease.resultReportUntil.getTime() + 1);
        releaseFirstCommit();
        return result;
      } catch (error) {
        rejectFirstCommit(error);
        throw error;
      }
    });
    const handlers = createReviewActionV2ExecutionHandlers(d);

    const barrierTimeout = setTimeout(() => {
      rejectGates(
        new Error(
          preparationCount < 2
            ? "late_adoption_preparation_timeout"
            : "late_adoption_first_commit_timeout",
        ),
      );
    }, 5_000);
    const pending = [
      handlers.adoptObservation.execute(request),
      handlers.adoptObservation.execute(request),
    ];
    const requestsSettled = Promise.allSettled(pending);
    pending.forEach((pendingRequest, index) => {
      void pendingRequest.then(
        () => {
          if (preparationCount < 2) {
            rejectGates(
              new Error(
                `late_adoption_request_${index + 1}_settled_before_preparation_barrier`,
              ),
            );
          }
        },
        (error: unknown) => {
          rejectGates(
            new Error(`late_adoption_request_${index + 1}_failed`, {
              cause: error,
            }),
          );
        },
      );
    });
    let responses: Awaited<typeof requestsSettled>;
    try {
      await preparationsReady;
      await firstCommitted;
      responses = await requestsSettled;
    } finally {
      clearTimeout(barrierTimeout);
      releasePreparations();
      releaseFirstCommit();
      await requestsSettled;
    }

    expect(currentNow.getTime()).toBeLessThan(
      authorization.expiresAt.getTime(),
    );
    expect(preparationCount).toBe(2);
    const persisted = (await store.findExecution(sourceLease.executionId))!;
    expect(persisted.observationRefs).toHaveLength(1);
    expect(persisted.execution.version).toBe(
      fixture.before.execution.version + 1n,
    );
    expect(responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "fulfilled",
          value: expect.objectContaining({
            result: expect.objectContaining({
              status: ReviewExecutionMutationResultStatus.Applied,
            }),
          }),
        }),
        expect.objectContaining({
          status: "fulfilled",
          value: expect.objectContaining({
            result: expect.objectContaining({
              status: ReviewExecutionMutationResultStatus.Restored,
            }),
          }),
        }),
      ]),
    );
  });

  it("conflicts on an adoption identity reused with a changed canonical body at API and persistence boundaries", async () => {
    const { d, store, sourceLease, request, adoptAccepted } =
      await persistedAdoptionFixture();
    const handlers = createReviewActionV2ExecutionHandlers(d);
    const first = await handlers.adoptObservation.execute(request);
    expect(first.result.status).toBe(
      ReviewExecutionMutationResultStatus.Applied,
    );
    const persisted = (await store.findExecution(sourceLease.executionId))!;
    const changedRequest = await withBodyHash(
      ReviewActionV2OperationId.ReviewExecutionObservationAdopt,
      {
        ...request,
        expectedExecutionVersion: persisted.execution.version.toString(10),
      },
    );
    expect(changedRequest.requestBodyHash).not.toBe(request.requestBodyHash);

    await expect(
      handlers.adoptObservation.execute(changedRequest),
    ).rejects.toMatchObject({
      statusCode: 409,
      issues: ["adoption_replay_conflict"],
    });
    expect(adoptAccepted).toHaveBeenCalledTimes(1);
    const firstCommand = adoptAccepted.mock.calls[0]![0];
    const persistedAdoption = await store.findLease(
      firstCommand.adoptionLeaseId,
    );
    const result = await store.adoptObservation({
      ...firstCommand,
      expectedExecutionVersion: persisted.execution.version,
      adoptionAcquireRequestHash: changedRequest.requestBodyHash,
    });
    expect(result.status).toBe(ReviewObservationAttachmentStatus.Conflict);
    expect(await store.findExecution(sourceLease.executionId)).toEqual(
      persisted,
    );
    expect(await store.findLease(firstCommand.adoptionLeaseId)).toEqual(
      persistedAdoption,
    );
  });

  it("restores an exact observation adoption replay after signing-key rotation", async () => {
    const { manifestCanonicalJson, identity, sourceLease, observation } =
      await committedAdoptionFixture({
        state: ReviewInvocationLeaseState.Released,
      });
    const request = await adoptionRequest({
      sourceLease,
      observation,
      manifestCanonicalJson,
      manifestKey: identity.manifestKey,
      expectedExecutionVersion: 3n,
      expectedStreamVersion: snapshot.stream.version,
    });
    const adoptionIdentityHash = await digest.digestUtf8(
      canonicalJson({
        authorizationId: authorization.authorizationId,
        executionId: request.executionId,
        executionGeneration: request.executionGeneration,
        workSlotId: request.workSlotId,
        observationId: request.observationId,
        sourceLeaseId: request.sourceLeaseId,
        sourceFencingToken: request.sourceFencingToken,
        idempotencyKey: request.idempotencyKey,
      }),
    );
    const observationRefId = `obsref:${await digest.digestUtf8(
      canonicalJson({
        executionId: request.executionId,
        workSlotId: request.workSlotId,
        observationId: request.observationId,
      }),
    )}`;
    const adoptionLease = lease({
      leaseId: `adoption-${adoptionIdentityHash}`,
      purpose: ReviewInvocationLeasePurpose.ObservationAdoption,
      state: ReviewInvocationLeaseState.Released,
      preparedManifestCanonicalJson: null,
      preparedManifestKey: null,
      attemptId: null,
      sourceObservationId: observation.observationId,
      providerInvocationKey: request.providerInvocationKey,
      acquireRequestIdHash: await digest.digestUtf8(request.idempotencyKey),
      acquireRequestHash: request.requestBodyHash,
      leaseCapabilityId: "persisted-adoption-capability",
      capabilitySigningKeyId: "retired-signing-key",
    });
    const replaySnapshot = {
      ...snapshotWithSlot({
        state: ReviewWorkSlotState.Satisfied,
        activeLeaseId: null,
        acceptedObservationRefId: observationRefId,
        executionVersion: 5n,
      }),
      observationRefs: [
        {
          observationRefId,
          executionId: request.executionId,
          workSlotId: request.workSlotId,
          providerInvocationKey: request.providerInvocationKey,
          observationId: request.observationId,
          providerVoteIdentityHash: request.providerVoteIdentityHash,
          attachmentKind: ReviewObservationAttachmentKind.ObservationAdoption,
          eligibilityPolicyVersion: request.eligibilityPolicyVersion,
          reuseSafetyDecisionHash: null,
          sourceExecutionId: request.executionId,
          sourceLeaseId: request.sourceLeaseId,
          sourceFencingToken: sourceLease.fencingToken,
          payloadHash: request.payloadHash,
          byteCount: request.byteCount,
          findingCount: request.findingCount,
          attachedAt: now,
        },
      ],
    } as ReviewExecutionSnapshot;
    const release = vi.fn();
    const adoptAccepted = vi.fn();
    const capabilities = capabilityAdapter();
    const prepareIdentity = vi.spyOn(capabilities, "prepareIdentity");
    const d = executionDependencies({
      capabilities,
      currentLease: sourceLease,
      observation,
      release,
      adoptAccepted,
      findExecution: vi.fn(async () => replaySnapshot),
      findLease: vi.fn(async (leaseId: string) =>
        leaseId === sourceLease.leaseId ? sourceLease : adoptionLease,
      ),
      leaseSafety: vi.fn(),
    });

    await expect(
      createReviewActionV2ExecutionHandlers(d).adoptObservation.execute(
        request,
      ),
    ).resolves.toMatchObject({
      statusCode: 200,
      result: {
        status: ReviewExecutionMutationResultStatus.Restored,
        observationPayloadCanonicalJson: expect.any(String),
        observationFactsCanonicalJson: expect.any(String),
      },
    });
    expect(release).not.toHaveBeenCalled();
    expect(adoptAccepted).not.toHaveBeenCalled();
    expect(prepareIdentity).not.toHaveBeenCalled();
  });
});

async function discoveryExecutionReadback(
  operation: "restore" | "start",
  d: ReviewActionV2ExecutionHandlerDependencies,
  restored: ReviewExecutionSnapshot,
) {
  const handlers = createReviewActionV2ExecutionHandlers(d);
  const assignment = restored.execution.assignmentManifestCanonicalJson;
  const assignmentHash = restored.execution.assignmentManifestHash;
  if (!assignment || !assignmentHash)
    throw new Error("test_discovery_assignment_missing");
  const response =
    operation === "restore"
      ? await handlers.restore.execute({
          ...envelope("restore-v1-discovery"),
          authorizationToken: "authorization-token",
          authorizationId: authorization.authorizationId,
          reviewRevisionHash: authorization.reviewRevisionHash,
        })
      : await handlers.start.execute(
          await startRequest({
            assignmentManifestCanonicalJson: assignment,
            assignmentManifestHash: assignmentHash,
            workSlotsCanonicalJson: canonicalJson(
              restored.execution.workSlots.map(
                ({
                  state,
                  activeLeaseId,
                  acceptedObservationRefId,
                  nextAttemptOrdinal,
                  ...slot
                }) => {
                  void [
                    state,
                    activeLeaseId,
                    acceptedObservationRefId,
                    nextAttemptOrdinal,
                  ];
                  return slot;
                },
              ),
            ),
          }),
        );
  expect(response.statusCode).toBe(200);
  if (!("executionCanonicalJson" in response.result))
    throw new Error("test_discovery_restore_missing");
  return JSON.parse(response.result.executionCanonicalJson);
}

async function unattachedRestoreFixture(
  sourceChanges: Partial<ReviewInvocationLease> = {},
  slotChanges: Partial<
    ReviewExecutionSnapshot["execution"]["workSlots"][number]
  > = {},
  manifestVersion: 1 | 2 = 2,
) {
  const f = await committedAdoptionFixture({
    state: ReviewInvocationLeaseState.Released,
    expiresAt: new Date(now.getTime() - 1),
    ...sourceChanges,
  });
  const assignment = canonicalJson({ manifestVersion });
  const restored: ReviewExecutionSnapshot = {
    ...snapshot,
    execution: {
      ...snapshot.execution,
      assignmentManifestVersion: manifestVersion,
      assignmentManifestHash: sha(assignment),
      assignmentManifestCanonicalJson: assignment,
      workSlots: [
        {
          ...snapshot.execution.workSlots[0]!,
          state: ReviewWorkSlotState.Exhausted,
          attemptBudget: 1,
          nextAttemptOrdinal: 2,
          activeLeaseId: null,
          acceptedObservationRefId: null,
          ...slotChanges,
        },
      ],
    },
  };
  const observation: ReviewObservation = {
    ...f.observation,
    sourceExecutionId: snapshot.execution.executionId,
    sourceWorkSlotId: "slot-1",
    sourceAuthorizationId: authorization.authorizationId,
    sourcePlanHash: snapshot.execution.planHash,
    sourceRunId: snapshot.execution.sourceRunId,
    sourceRunAttempt: snapshot.execution.sourceRunAttempt,
    sourceFencingToken: "7",
  };
  const base = executionDependencies({
    findExecution: async () => restored,
    findLease: async () => f.sourceLease,
    observation,
  });
  const findSources = vi.fn(
    async (): Promise<readonly ReviewObservation[]> => [observation],
  );
  const d = {
    ...base,
    executionQueries: {
      ...base.executionQueries,
      findStream: async () => restored.stream,
    },
    observations: {
      findById: async () => observation,
      findCandidates: async () => [],
      findSourceSlotCandidates: findSources,
    },
  } satisfies ReviewActionV2ExecutionHandlerDependencies;
  const restore = () =>
    createReviewActionV2ExecutionHandlers(d).restore.execute({
      ...envelope("restore-unattached"),
      authorizationToken: "authorization-token",
      authorizationId: authorization.authorizationId,
      reviewRevisionHash: authorization.reviewRevisionHash,
    });
  return {
    d,
    restore,
    findSources,
    snapshot: restored,
    sourceLease: f.sourceLease,
    observation,
  };
}

function executionDependencies(
  overrides: {
    capabilities?: ReviewActionV2ExecutionEvidenceCapabilityAdapter;
    evidenceLookup?: ReturnType<typeof vi.fn>;
    attachReusable?: ReturnType<typeof vi.fn>;
    attachFresh?: ReturnType<typeof vi.fn>;
    adoptAccepted?: ReturnType<typeof vi.fn>;
    release?: ReturnType<typeof vi.fn>;
    acquire?: ReviewActionV2ExecutionHandlerDependencies["executions"]["invocationFlights"]["execute"];
    renew?: ReturnType<typeof vi.fn>;
    currentLease?: ReviewInvocationLease;
    observation?: ReviewObservation;
    findExecution?: ReviewActionV2ExecutionHandlerDependencies["executionQueries"]["findExecution"];
    findLease?: ReviewActionV2ExecutionHandlerDependencies["executionQueries"]["findLease"];
    leaseSafety?: ReviewActionV2ExecutionHandlerDependencies["leaseSafety"]["resolve"];
    finalize?: ReviewActionV2ExecutionHandlerDependencies["executions"]["finalizeReviewExecution"]["execute"];
    finalizationFacts?: ReviewActionV2ExecutionHandlerDependencies["finalizationFacts"]["resolve"];
    currentRevision?: ReviewActionV2ExecutionHandlerDependencies["executions"]["currentRevision"]["execute"];
    contextReplay?: ReviewActionV2ExecutionHandlerDependencies["contextReplay"];
    now?: () => Date;
    readServerTime?: () => Promise<Date>;
  } = {},
): ReviewActionV2ExecutionHandlerDependencies {
  const shared = common(
    overrides.capabilities,
    overrides.currentLease,
    overrides.now,
  );
  return {
    ...shared,
    readServerTime: overrides.readServerTime ?? (async () => now),
    authorizationQueries: {
      findReviewRunAuthorizationById: vi.fn(async () => authorization),
    },
    executionQueries: {
      ...shared.executionQueries,
      ...(overrides.findExecution
        ? { findExecution: overrides.findExecution }
        : {}),
      ...(overrides.findLease ? { findLease: overrides.findLease } : {}),
    },
    executions: {
      startReviewExecution: {
        execute: vi.fn(async () => ({
          status: StartReviewExecutionStatus.Admitted,
          snapshot,
        })),
      },
      invocationFlights: {
        execute: overrides.acquire ?? vi.fn(),
      },
      invocationLeases: {
        acquire: vi.fn(),
        renew: overrides.renew ?? vi.fn(),
        release: overrides.release ?? vi.fn(),
      },
      observationAttachments: {
        attachFresh: overrides.attachFresh ?? vi.fn(),
        attachReusable: overrides.attachReusable ?? vi.fn(),
        adoptAccepted: overrides.adoptAccepted ?? vi.fn(),
      },
      finalizeReviewExecution: { execute: overrides.finalize ?? vi.fn() },
      executionLifecycle: {
        supersede: vi.fn(),
        failAbandonedPrepared: vi.fn(),
        terminalizeWorkSlot: vi.fn(),
        failExpiredRunning: vi.fn(),
      },
      requestedIntents: {} as never,
      currentRevision: {
        execute:
          overrides.currentRevision ??
          vi.fn(async () => CurrentReviewExecutionRevisionStatus.Current),
      },
    } as unknown as ReviewActionV2ExecutionHandlerDependencies["executions"],
    evidence: {
      lookupReviewEvidence: {
        execute: overrides.evidenceLookup ?? vi.fn(),
      },
    } as unknown as ReviewActionV2ExecutionHandlerDependencies["evidence"],
    observations: {
      findById: vi.fn(async () => overrides.observation ?? null),
    } as unknown as ReviewActionV2ExecutionHandlerDependencies["observations"],
    leaseSafety: { resolve: overrides.leaseSafety ?? vi.fn() },
    finalizationFacts: {
      resolve: overrides.finalizationFacts ?? vi.fn(),
    },
    contextReplay:
      overrides.contextReplay ??
      ({
        prepareReplay: vi.fn(),
        verifyAttachment: vi.fn(async () => true),
        assertCurrentPolicy: vi.fn(),
      } satisfies ReviewActionV2ExecutionHandlerDependencies["contextReplay"]),
  };
}

function evidenceDependencies(
  overrides: {
    evidenceLookup?: ReturnType<typeof vi.fn>;
    acceptObservation?: ReturnType<typeof vi.fn>;
    capabilities?: ReviewActionV2ExecutionEvidenceCapabilityAdapter;
    contextReplay?: ReviewActionV2EvidenceHandlerDependencies["contextReplay"];
    currentLease?: ReviewInvocationLease;
    now?: () => Date;
  } = {},
): ReviewActionV2EvidenceHandlerDependencies {
  return {
    ...common(overrides.capabilities, overrides.currentLease, overrides.now),
    evidence: {
      lookupReviewEvidence: { execute: overrides.evidenceLookup ?? vi.fn() },
      acceptReviewObservation: {
        execute: overrides.acceptObservation ?? vi.fn(),
      },
      pruneReviewEvidence: {} as never,
    } as unknown as ReviewActionV2EvidenceHandlerDependencies["evidence"],
    observations: {
      findById: vi.fn(),
    } as unknown as ReviewActionV2EvidenceHandlerDependencies["observations"],
    contextReplay:
      overrides.contextReplay ??
      ({
        prepareReplay: vi.fn(),
        verifyAttachment: vi.fn(async () => true),
        assertCurrentPolicy: vi.fn(),
      } satisfies ReviewActionV2EvidenceHandlerDependencies["contextReplay"]),
  };
}

function common(
  capabilities = capabilityAdapter(),
  currentLease: ReviewInvocationLease = lease(),
  readNow: () => Date = () => now,
) {
  return {
    authorizations: {
      resolveReviewRunAuthorizationToken: vi.fn(async () => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization,
      })),
    },
    executionQueries: {
      findExecution: vi.fn(async () => snapshot),
      findStream: vi.fn(),
      findByStartIdentity: vi.fn(),
      findLease: vi.fn(async () => currentLease),
    },
    protocolLimits: {
      findProtocolLimitsProfileById: vi.fn(async () => protocolLimits),
    },
    digest,
    capabilities,
    now: readNow,
    nextId: (kind: string) => `${kind}-generated`,
    timing: {
      admissionDurationMs: 30_000,
      executionDurationMs: 300_000,
      initialLeaseDurationMs: 30_000,
      retentionDurationMs: 3_600_000,
      attachmentCapabilityDurationMs: 60_000,
    },
  } as unknown as Omit<
    ReviewActionV2ExecutionHandlerDependencies,
    | "executions"
    | "evidence"
    | "observations"
    | "leaseSafety"
    | "finalizationFacts"
    | "readServerTime"
  >;
}

function capabilityAdapter() {
  const keyRing = new ConfiguredCapabilityKeyRing({
    activeKeyId: "test-key",
    keys: [
      {
        keyId: "test-key",
        secret: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
        verifyUntil: null,
      },
    ],
  });
  return new ReviewActionV2ExecutionEvidenceCapabilityAdapter(
    new JoseRotatingCapabilityCodec(keyRing, 0),
    keyRing,
    "reviewrouter-execution-evidence",
    () => "capability-generated",
  );
}

async function committedAdoptionFixture(
  sourceLeaseOverrides: Partial<ReviewInvocationLease> = {},
) {
  const providerManifest = manifest();
  const manifestCanonicalJson =
    serializeProviderInvocationManifestCanonicalWireJson(providerManifest);
  const identity = await buildProviderInvocationIdentity(digest, {
    manifest: providerManifest,
    providerVoteIdentityHash: hash("c"),
  });
  const sourceLease = lease({
    preparedManifestCanonicalJson: manifestCanonicalJson,
    preparedManifestKey: identity.manifestKey,
    providerInvocationKey: identity.providerInvocationKey,
    ...sourceLeaseOverrides,
  });
  const prepared = prepareReviewObservationPayload(
    reusableObservation().payload,
  );
  const observation = reusableObservation({
    manifestKey: identity.manifestKey,
    providerInvocationKey: identity.providerInvocationKey,
    sourceExecutionId: sourceLease.executionId,
    sourceLeaseId: sourceLease.leaseId,
    sourceFencingToken: sourceLease.fencingToken.toString(10),
    attemptId: sourceLease.attemptId!,
    sourceRevision: {
      baseSha: authorization.baseSha,
      mergeBaseSha: authorization.mergeBaseSha,
      headSha: authorization.headSha,
      reviewRevisionHash: authorization.reviewRevisionHash,
    },
    payloadHash: await digest.digest(prepared.canonicalBytes),
    byteCount: prepared.byteCount,
    findingCount: prepared.findingCount,
  });
  return { manifestCanonicalJson, identity, sourceLease, observation } as const;
}

async function persistedObservationFixture() {
  const fixture = await committedAdoptionFixture();
  const store = new InMemoryReviewExecutionStore();
  const scope = {
    workspaceId: authorization.workspaceId,
    repositoryConnectionId: authorization.repositoryConnectionId,
    scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
    pullRequestNumber: authorization.pullRequestNumber,
  };
  const limits = {
    profileId: protocolLimits.protocolLimitsProfileId,
    maxWorkSlots: protocolLimits.maxWorkSlots,
    maxAttemptBudget: protocolLimits.maxAttemptsPerSlot,
    maxProjectionBytes: protocolLimits.maxProjectionBytes,
    maxFindingCount: protocolLimits.maxProjectionFindings,
    maxLeaseDurationMs: protocolLimits.maxLeaseDurationMs,
    maxResultReportDurationMs: protocolLimits.maxResultReportDurationMs,
  };
  const prepared = await store.prepareExecution({
    scope,
    expectedStreamVersion: 0n,
    executionId: snapshot.execution.executionId,
    authorizationId: authorization.authorizationId,
    producerReleaseId: authorization.producerReleaseId,
    mutationEpoch: authorization.mutationEpoch,
    revision: snapshot.execution.revision,
    startIdentityHash: hash("1"),
    canonicalStartHash: hash("2"),
    admissionSafetyDecisionHash: hash("3"),
    compatibilityKey: "compatibility-1",
    planHash: snapshot.execution.planHash,
    workSlots: snapshot.execution.workSlots,
    limits,
    sourceRunId: authorization.sourceRunId,
    sourceRunAttempt: authorization.sourceRunAttempt,
    now,
    admissionDeadlineAt: new Date(now.getTime() + 30_000),
    executionDeadlineAt: snapshot.execution.executionDeadlineAt,
    retainUntil: fixture.sourceLease.retainUntil,
  });
  if (!prepared.snapshot) throw new Error("test_execution_not_prepared");
  await store.confirmAdmission({
    scope,
    executionId: snapshot.execution.executionId,
    expectedStreamVersion: prepared.snapshot.stream.version,
    authorizationId: authorization.authorizationId,
    mutationEpoch: authorization.mutationEpoch,
    requestedRevision: snapshot.execution.revision,
    observedRevision: snapshot.execution.revision,
    verdict: ReviewExecutionAdmissionVerdict.Current,
    checkedAt: now,
  });
  const acquired = await store.acquireLease({
    scope,
    executionId: fixture.sourceLease.executionId,
    workSlotId: fixture.sourceLease.workSlotId,
    purpose: ReviewInvocationLeasePurpose.ProviderExecution,
    providerInvocationKey: fixture.sourceLease.providerInvocationKey,
    preparedManifestCanonicalJson: fixture.manifestCanonicalJson,
    preparedManifestKey: fixture.identity.manifestKey,
    providerVoteIdentityHash: fixture.sourceLease.providerVoteIdentityHash,
    leaseId: fixture.sourceLease.leaseId,
    attemptId: fixture.sourceLease.attemptId,
    sourceObservationId: null,
    acquireRequestIdHash: fixture.sourceLease.acquireRequestIdHash,
    acquireRequestHash: fixture.sourceLease.acquireRequestHash,
    ownerIdHash: fixture.sourceLease.ownerIdHash,
    leaseCapabilityId: fixture.sourceLease.leaseCapabilityId,
    capabilitySigningKeyId: fixture.sourceLease.capabilitySigningKeyId,
    leaseSafetyDecisionHash: fixture.sourceLease.leaseSafetyDecisionHash,
    now,
    expiresAt: fixture.sourceLease.expiresAt,
    resultReportUntil: fixture.sourceLease.resultReportUntil,
    retainUntil: fixture.sourceLease.retainUntil,
    limits,
  });
  if (!acquired.lease) throw new Error("test_lease_not_acquired");
  const sourceLease = acquired.lease;
  const observation = {
    ...fixture.observation,
    sourceFencingToken: sourceLease.fencingToken.toString(10),
  };
  const capabilities = capabilityAdapter();
  const d = executionDependencies({
    capabilities,
    currentLease: sourceLease,
    observation,
    findExecution: store.findExecution.bind(store),
    findLease: store.findLease.bind(store),
    attachFresh: vi.fn(store.attachObservation.bind(store)),
  });
  const request = await attachRequest(
    await capabilities.issueLease(sourceLease, manifest().scopeHash),
    observation,
  );
  return { ...fixture, d, store, sourceLease, observation, request };
}

async function persistedAdoptionFixture() {
  const fixture = await persistedObservationFixture();
  const before = (await fixture.store.findExecution(
    fixture.sourceLease.executionId,
  ))!;
  const adoptAccepted = vi.fn(
    fixture.store.adoptObservation.bind(fixture.store),
  );
  fixture.d.executions.observationAttachments.adoptAccepted = adoptAccepted;
  fixture.d.leaseSafety.resolve = vi.fn(async () => ({
    allowed: true,
    decisionHash: hash("6"),
  }));
  const request = await adoptionRequest({
    sourceLease: fixture.sourceLease,
    observation: fixture.observation,
    manifestCanonicalJson: fixture.manifestCanonicalJson,
    manifestKey: fixture.identity.manifestKey,
    expectedExecutionVersion: before.execution.version,
    expectedStreamVersion: before.stream.version,
  });
  return { ...fixture, before, adoptAccepted, request };
}

async function adoptionRequest(input: {
  sourceLease: ReviewInvocationLease;
  observation: ReviewObservation;
  manifestCanonicalJson: string;
  manifestKey: string;
  expectedExecutionVersion: bigint;
  expectedStreamVersion: bigint;
}): Promise<ReviewExecutionObservationAdoptRequest> {
  const request: ReviewExecutionObservationAdoptRequest = {
    ...envelope("adopt-1"),
    authorizationToken: "authorization-token",
    idempotencyKey: "adopt-idempotency-1",
    requestBodyHash: hash("0"),
    executionId: input.sourceLease.executionId,
    executionGeneration: input.sourceLease.executionGeneration.toString(10),
    expectedStreamVersion: input.expectedStreamVersion.toString(10),
    expectedExecutionVersion: input.expectedExecutionVersion.toString(10),
    workSlotId: input.sourceLease.workSlotId,
    observationId: input.observation.observationId,
    providerInvocationKey: input.observation.providerInvocationKey,
    providerVoteIdentityHash: input.observation.providerVoteIdentityHash,
    payloadHash: input.observation.payloadHash,
    byteCount: input.observation.byteCount,
    findingCount: input.observation.findingCount,
    sourceLeaseId: input.sourceLease.leaseId,
    sourceFencingToken: input.sourceLease.fencingToken.toString(10),
    manifestCanonicalJson: input.manifestCanonicalJson,
    manifestKey: input.manifestKey,
    planHash: snapshot.execution.planHash,
    reviewRevisionHash: authorization.reviewRevisionHash,
    ownerIdHash: input.sourceLease.ownerIdHash,
    eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
  };
  return withBodyHash(
    ReviewActionV2OperationId.ReviewExecutionObservationAdopt,
    request,
  );
}

function snapshotWithSlot(input: {
  state: ReviewWorkSlotState;
  activeLeaseId: string | null;
  acceptedObservationRefId?: string | null;
  executionVersion: bigint;
  activeLeases?: readonly ReviewInvocationLease[];
}): ReviewExecutionSnapshot {
  const workSlot = snapshot.execution.workSlots[0]!;
  return {
    ...snapshot,
    execution: {
      ...snapshot.execution,
      version: input.executionVersion,
      workSlots: [
        {
          ...workSlot,
          state: input.state,
          activeLeaseId: input.activeLeaseId,
          acceptedObservationRefId: input.acceptedObservationRefId ?? null,
        },
      ],
    },
    activeLeases: input.activeLeases ?? [],
  };
}

async function startRequest(
  overrides: Partial<ReviewExecutionStartRequest> = {},
): Promise<ReviewExecutionStartRequest> {
  const request: ReviewExecutionStartRequest = {
    ...envelope("start-1"),
    authorizationToken: "authorization-token",
    idempotencyKey: "idempotency-1",
    requestBodyHash: hash("0"),
    authorizationId: authorization.authorizationId,
    executionId: "execution-target",
    reviewRevisionHash: authorization.reviewRevisionHash,
    compatibilityKey: hash("1"),
    planHash: hash("9"),
    assignmentManifestCanonicalJson: null,
    assignmentManifestHash: null,
    workSlotsCanonicalJson: "[]",
    sourceRunId: authorization.sourceRunId,
    sourceRunAttempt: authorization.sourceRunAttempt,
    ...overrides,
  };
  return withBodyHash(ReviewActionV2OperationId.ReviewExecutionStart, request);
}

async function attachRequest(
  capability: string,
  observation: ReviewObservation,
): Promise<ReviewExecutionObservationAttachRequest> {
  const request: ReviewExecutionObservationAttachRequest = {
    ...envelope("attach-1"),
    authorizationToken: "authorization-token",
    leaseCapability: capability,
    idempotencyKey: "idempotency-attach",
    requestBodyHash: hash("0"),
    executionId: "execution-target",
    workSlotId: "slot-1",
    observationId: observation.observationId,
    providerInvocationKey: observation.providerInvocationKey,
    providerVoteIdentityHash: observation.providerVoteIdentityHash,
    payloadHash: observation.payloadHash,
    byteCount: observation.byteCount,
    findingCount: observation.findingCount,
    eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
  };
  return withBodyHash(
    ReviewActionV2OperationId.ReviewExecutionObservationAttach,
    request,
  );
}

async function commitRequest(
  leaseCapability: string,
  observation: ReviewObservation,
  payloadCanonicalJson: string,
): Promise<ReviewEvidenceCommitRequest> {
  const request: ReviewEvidenceCommitRequest = {
    ...envelope("commit-1"),
    authorizationToken: "authorization-token",
    leaseCapability,
    idempotencyKey: "idempotency-commit",
    requestBodyHash: hash("0"),
    attemptId: observation.attemptId,
    sourceLeaseId: observation.sourceLeaseId,
    ownerIdHash: hash("d"),
    fencingToken: "7",
    completionStatus: ProviderResultCompletionStatus.Success,
    schemaValidated: true,
    fullyConsumed: true,
    actualModel: observation.actualModel,
    contextDependencyAttestationId: null,
    contextDependencyAttestationHash: null,
    investigationCertificateId: null,
    investigationCertificateHash: null,
    payloadCanonicalJson,
    payloadHash: observation.payloadHash,
    qualityFlags: observation.qualityFlags,
    transportAttemptCount: observation.transportAttemptCount,
  };
  return withBodyHash(ReviewActionV2OperationId.ReviewEvidenceCommit, request);
}

async function withBodyHash<O extends ReviewActionV2OperationId>(
  operation: O,
  request: Parameters<typeof canonicalizeReviewActionV2Request<O>>[1],
) {
  const requestBodyHash = await digest.digestUtf8(
    canonicalizeReviewActionV2Request(operation, request),
  );
  return { ...request, requestBodyHash };
}

async function finalizationFixture(publicationNotAfter: Date) {
  const projectionEnvelopeCanonicalJson = "{}";
  const projectionHash = await digest.digestUtf8(
    projectionEnvelopeCanonicalJson,
  );
  const artifactHash = hash("a");
  const lifecycleStateHash = hash("b");
  const artifact: FinalizedReviewProjectionArtifact = {
    artifactId: "artifact-race",
    executionId: snapshot.execution.executionId,
    generation: snapshot.execution.generation,
    reviewedHeadSha: snapshot.execution.revision.headSha,
    reviewRevisionHash: snapshot.execution.revision.reviewRevisionHash,
    coverageState: ReviewCoverageState.Completed,
    projectionEnvelopeVersion: 1,
    projectionEnvelopeJson: projectionEnvelopeCanonicalJson,
    projectionHash,
    byteCount: 2,
    findingCount: 0,
    lifecycleStateHash,
    commandLedgerWatermark: 0n,
    projectionPolicyVersion: "projection-policy-1",
    publicationPermit: {
      workspaceId: authorization.workspaceId,
      repositoryConnectionId: authorization.repositoryConnectionId,
      scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
      pullRequestNumber: authorization.pullRequestNumber,
      executionId: snapshot.execution.executionId,
      generation: snapshot.execution.generation,
      authorizationId: authorization.authorizationId,
      producerReleaseId: authorization.producerReleaseId,
      reviewedHeadSha: snapshot.execution.revision.headSha,
      reviewRevisionHash: snapshot.execution.revision.reviewRevisionHash,
      projectionHash,
      lifecycleStateHash,
      commandLedgerWatermark: 0n,
      permitEpoch: authorization.mutationEpoch,
      publicationSafetyDecisionHash: hash("c"),
      publicationNotAfter,
    },
    createdAt: now,
    retainUntil: new Date(now.getTime() + 3_600_000),
  };
  const finalize = vi.fn(async () => ({
    status: ReviewExecutionFinalizeStatus.Finalized,
    artifact,
    snapshot: { ...snapshot, artifact },
  }));
  const finalizationFacts = vi.fn(async () => ({
    expectedArtifactHash: artifactHash,
    byteCount: artifact.byteCount,
    findingCount: artifact.findingCount,
    projectionPolicyVersion: artifact.projectionPolicyVersion,
    publicationSafetyDecisionHash:
      artifact.publicationPermit.publicationSafetyDecisionHash,
    publicationNotAfter,
    retainUntil: artifact.retainUntil,
  }));
  const request = await withBodyHash(
    ReviewActionV2OperationId.ReviewExecutionFinalize,
    {
      ...envelope("finalize-revision-race"),
      authorizationToken: "authorization-token",
      idempotencyKey: "finalize-revision-race",
      requestBodyHash: hash("0"),
      executionId: snapshot.execution.executionId,
      expectedStreamVersion: snapshot.stream.version.toString(10),
      expectedExecutionVersion: snapshot.execution.version.toString(10),
      artifactId: artifact.artifactId,
      artifactHash,
      projectionEnvelopeVersion: artifact.projectionEnvelopeVersion,
      projectionEnvelopeCanonicalJson,
      projectionHash,
      lifecycleStateHash,
      commandLedgerWatermark: artifact.commandLedgerWatermark.toString(10),
      allowPartial: false,
    } satisfies ReviewExecutionFinalizeRequest,
  );
  return { artifact, finalize, finalizationFacts, request } as const;
}

function envelope(requestId: string) {
  return {
    protocolVersion: reviewActionV2PublishedProtocolVersion,
    schemaDigest: reviewActionV2PublishedSchemaDigest,
    requestId,
  };
}

const authorization = {
  authorizationId: "authorization-1",
  workspaceId: "workspace-1",
  repositoryConnectionId: "connection-1",
  scmRepositoryIdentityId: "repository-1",
  pullRequestNumber: 42,
  sourceRunId: "run-1",
  sourceRunAttempt: "1",
  producerReleaseId: "release-1",
  selectedProtocolVersion: ReviewProtocolVersion.V2,
  protocolLimitsProfileId: "limits-1",
  operationalSloProfileId: "slo-1",
  mutationEpoch: 1n,
  providerVoteLanes: [
    {
      providerKind: "codex",
      providerVoteIdentityHash: hash("c"),
    },
  ],
  trustDomain: ReviewTrustDomain.TrustedManaged,
  state: ReviewRunAuthorizationState.Active,
  baseSha: gitSha("a"),
  mergeBaseSha: gitSha("b"),
  headSha: gitSha("c"),
  reviewRevisionHash: hash("b"),
  expiresAt: new Date(now.getTime() + 600_000),
  maxExpiresAt: new Date(now.getTime() + 600_000),
} as unknown as ReviewRunAuthorization;

const protocolLimits = {
  protocolLimitsProfileId: "limits-1",
  maxWorkSlots: 8,
  maxAttemptsPerSlot: 4,
  maxObservationBytes: 100_000,
  maxObservationFindings: 100,
  maxProjectionBytes: 200_000,
  maxProjectionFindings: 200,
  maxPublicationOperations: 100,
  maxPublicationChunks: 10,
  maxPublicationBodyBytes: 10_000,
  maxRequestBatchSize: 10,
  maxLeaseDurationMs: 60_000,
  maxResultReportDurationMs: 120_000,
  maxReconciliationDurationMs: 120_000,
  limitsDigest: hash("d"),
  registeredAt: now,
};

const snapshot = {
  stream: {
    ...authorization,
    version: 2n,
    activeExecutionId: "execution-target",
    preparedExecutionId: null,
    lastAllocatedGeneration: 1n,
    currentRevision: null,
    updatedAt: now,
  },
  execution: {
    ...authorization,
    executionId: "execution-target",
    version: 3n,
    generation: 1n,
    revision: {
      baseSha: authorization.baseSha,
      mergeBaseSha: authorization.mergeBaseSha,
      headSha: authorization.headSha,
      reviewRevisionHash: authorization.reviewRevisionHash,
    },
    state: ReviewExecutionState.Running,
    planHash: hash("9"),
    protocolLimitsProfileId: "limits-1",
    workSlots: [
      {
        workSlotId: "slot-1",
        taskKind: ReviewTaskKind.FindingDiscovery,
        providerKind: ReviewExecutionProviderKind.Codex,
        providerVoteIdentityHash: hash("c"),
        shardKey: "shard-1",
        required: true,
        attemptBudget: 2,
        retryPolicyVersion: "retry-1",
        state: ReviewWorkSlotState.Pending,
        activeLeaseId: null,
        acceptedObservationRefId: null,
        nextAttemptOrdinal: 1,
      },
    ],
    executionDeadlineAt: new Date(now.getTime() + 300_000),
  },
  observationRefs: [],
  activeLeases: [],
  artifact: null,
} as unknown as ReviewExecutionSnapshot;

function lease(
  overrides: Partial<ReviewInvocationLease> = {},
): ReviewInvocationLease {
  return {
    ...snapshot.execution,
    providerInvocationKey: hash("7"),
    preparedManifestCanonicalJson: canonicalJson(manifest()),
    preparedManifestKey: hash("8"),
    providerVoteIdentityHash: hash("c"),
    workSlotId: "slot-1",
    leaseId: "lease-1",
    purpose: ReviewInvocationLeasePurpose.ProviderExecution,
    reviewRevisionHash: authorization.reviewRevisionHash,
    leaseSafetyDecisionHash: hash("6"),
    attemptId: "attempt-1",
    sourceObservationId: null,
    attemptOrdinal: 1,
    acquireRequestIdHash: hash("4"),
    acquireRequestHash: hash("5"),
    ownerIdHash: hash("d"),
    leaseCapabilityId: "lease-capability-1",
    capabilitySigningKeyId: "test-key",
    fencingToken: 7n,
    executionId: "execution-target",
    executionGeneration: 1n,
    state: ReviewInvocationLeaseState.Active,
    acquiredAt: now,
    renewedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
    resultReportUntil: new Date(now.getTime() + 120_000),
    retainUntil: new Date(now.getTime() + 3_600_000),
    ...overrides,
  } as ReviewInvocationLease;
}

function invocationFlight(owner: ReviewInvocationLease): InvocationFlight {
  const identity = {
    reviewRevisionHash: owner.reviewRevisionHash,
    providerInvocationKey: owner.providerInvocationKey,
    preparedManifestKey: owner.preparedManifestKey!,
    providerVoteIdentityHash: owner.providerVoteIdentityHash,
    compatibilityKey: snapshot.execution.compatibilityKey,
    policyIdentityHash: owner.leaseSafetyDecisionHash,
  };
  return {
    flightId: owner.leaseId,
    identity,
    executionId: owner.executionId,
    workSlotId: owner.workSlotId,
    laneKey: owner.providerVoteIdentityHash,
    shardKey: "shard-1",
    ownerIdHash: owner.ownerIdHash,
    ownerLeaseId: owner.leaseId,
    fencingToken: owner.fencingToken,
    acquiredAt: owner.acquiredAt,
    renewedAt: owner.renewedAt,
    expiresAt: owner.expiresAt,
  };
}

function manifest(): ProviderInvocationManifest {
  return {
    manifestVersion: 1,
    scopeHash: sha(
      canonicalJson({
        workspaceId: authorization.workspaceId,
        repositoryConnectionId: authorization.repositoryConnectionId,
        scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
        pullRequestNumber: authorization.pullRequestNumber,
      }),
    ),
    taskKindSet: [EvidenceTaskKind.FindingDiscovery],
    providerKind: ReviewProviderKind.Codex,
    providerCapabilityHash: hash("d"),
    requestedModel: "gpt-5-codex",
    providerPolicyVersion: "policy-1",
    producerReleaseId: authorization.producerReleaseId,
    selectedProtocolVersion: authorization.selectedProtocolVersion,
    providerRequestEnvelopeHash: hash("e"),
    outputSchemaHash: hash("f"),
    reviewConfigHash: hash("1"),
    runtimeCompatibilityKey: hash("2"),
    filePatchManifestHash: hash("3"),
    contextManifestHash: hash("4"),
    memoryBundleHash: null,
    codeGraphProjectionHash: null,
    lifecycleTargetSetHash: null,
    liveLifecycleStateHash: null,
    toolPolicyHash: hash("5"),
    executionProfile: ProviderExecutionProfile.PromptOnlyEnvelopeV1,
    baseTreeHash: hash("6"),
    environmentContractHash: hash("7"),
  };
}

function stableManifestJson() {
  return stableJsonForTest(manifest());
}

function reusableObservation(
  overrides: Partial<ReviewObservation> = {},
): ReviewObservation {
  return {
    observationId: "observation-1",
    scope: {
      workspaceId: authorization.workspaceId,
      repositoryConnectionId: authorization.repositoryConnectionId,
      scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
      pullRequestNumber: authorization.pullRequestNumber,
      authorizationScopeHash: manifest().scopeHash,
    },
    manifestKey: hash("a"),
    providerInvocationKey: hash("7"),
    providerVoteIdentityHash: hash("c"),
    sourceExecutionId: "execution-source",
    sourceLeaseId: "lease-1",
    sourceFencingToken: "7",
    payloadHash: hash("e"),
    byteCount: 100,
    findingCount: 0,
    actualModel: "gpt-5-codex",
    qualityFlags: [],
    transportAttemptCount: 1,
    reuseExpiresAtMs: now.getTime() + 600_000,
    payload: {
      payloadVersion: reviewEvidencePayloadVersion,
      normalizedFindings: [],
      normalizedLifecycleRevalidations: [],
      safeUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
    ...overrides,
  } as ReviewObservation;
}

function reuseHit(observation: ReviewObservation) {
  return {
    status: LookupReviewEvidenceStatus.Hit,
    selected: {
      observation,
      eligibility: ReuseEligibility.ExactRevision,
      tier: ReviewReuseTier.T0ExactRevision,
      reason: "none",
      canAttach: true,
      reuseSafetyDecisionHash: hash("8"),
    },
    considered: 1,
    denialReasons: [],
  };
}

function stableJsonForTest(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(stableJsonForTest).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonForTest(item)}`)
    .join(",")}}`;
}

function sha(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function hash(character: string): string {
  return character.repeat(64).slice(0, 64);
}
function gitSha(character: string): string {
  return character.repeat(40);
}

function ordinaryDiscoveryAuthorization(
  snapshotVersion: 3 | 4,
): ReviewRunAuthorization {
  const captured = parseReviewRunRuntimeSnapshot(
    lifecycleAuthorization().runtimeSnapshotCanonicalJson,
  );
  if (captured?.snapshotVersion !== 3 || !captured.gateway)
    throw new Error("test_discovery_runtime_missing");
  const { lifecycleVerificationCapability, ...ordinary } = captured;
  void lifecycleVerificationCapability;
  let runtimeSnapshotCanonicalJson = canonicalJson(ordinary);
  if (snapshotVersion === 4) {
    const {
      snapshotVersion: oldVersion,
      agent,
      agentProfileDigest,
      gateway,
      ...common
    } = ordinary;
    void oldVersion;
    if (!gateway) throw new Error("test_discovery_gateway_missing");
    const { providerIndex, ...allocation } = gateway;
    runtimeSnapshotCanonicalJson = canonicalJson({
      ...common,
      snapshotVersion: 4,
      primaryReviewerId: "reviewer-0",
      maxParallelReviewers: 1,
      inlineMinAgreement: 1,
      reviewers: [
        {
          reviewerId: "reviewer-0",
          providerIndex,
          providerVoteIdentityHash: hash("c"),
          required: true,
          transport: { kind: "account_gateway", allocationId: "allocation-0" },
          requestedModel: "gpt-5-codex",
          agenticContext: true,
          fastMode: false,
          agentProfile: agent,
          agentProfileDigest,
          concurrencyGroupId: "allocation-0",
          investigationGrant: null,
        },
      ],
      allocations: [{ allocationId: "allocation-0", ...allocation }],
    });
  }
  const parsed = parseReviewRunRuntimeSnapshot(runtimeSnapshotCanonicalJson);
  if (
    parsed?.snapshotVersion !== snapshotVersion ||
    parsed.lifecycleVerificationCapability !== undefined
  )
    throw new Error("test_discovery_runtime_invalid");
  return { ...authorization, runtimeSnapshotCanonicalJson };
}

function lifecycleAuthorization(): ReviewRunAuthorization {
  const capability = {
    extensionId: lifecycleVerificationContract.extensionId,
    descriptorDigest: lifecycleVerificationDescriptorDigest,
    executor: lifecycleVerificationContract.executor,
    modelTransport: "account_gateway",
    providerIndex: 0,
    providerKind: "codex",
    model: "gpt-5-codex",
    maxDispatches: 2,
    maxPromptBytes: 98304,
    maxResponseBytes: 32768,
    maxOutputTokens: 4096,
    deadlineMs: 60000,
    attemptBudget: 1,
  };
  const configuration = {
    schemaVersion: 3,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        model: "gpt-5-codex",
        gatewayBindingId: "binding",
        gatewayProfileRef: "profile",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: false,
      },
    ],
    execution: {
      providerLimit: 1,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    },
    blockingPolicy: { failOnSeverity: "off" },
    limits: { inlineMaxComments: 10, targetTokensPerBatch: 8000 },
    reviewLanguage: null,
    investigationRollout: {
      recordingEnabled: false,
      shadowEnabled: false,
      contextCriticEnabled: false,
      verifiedCleanEnabled: false,
      crossRevisionReplayEnabled: false,
      productionEffectsEnabled: false,
    },
  };
  return {
    ...authorization,
    runtimeSnapshotCanonicalJson: canonicalJson({
      snapshotVersion: 3,
      lifecycleVerificationCapability: capability,
      configurationSource: "workspace",
      configurationVersion: 1,
      workspaceConfigurationVersion: 1,
      repositoryConfigurationVersion: null,
      effectivePolicyDigest: `sha256:${hash("a")}`,
      agent: {
        profileRef: "codex-default",
        agentKind: "codex",
        binarySha256: hash("a"),
        packageVersion: "1.0.0",
        modelTransports: ["account_gateway"],
        cancellation: true,
        contextGateway: true,
      },
      agentProfileDigest: hash("b"),
      producer: {
        producerReleaseId: "release-1",
        actionCommitSha: gitSha("a"),
        runtimeCommitSha: gitSha("b"),
      },
      configurationCanonicalJson: canonicalJson(configuration),
      deadline: authorization.expiresAt.toISOString(),
      gateway: {
        providerIndex: 0,
        bindingId: "binding",
        connectionId: "connection",
        bindingRevision: 1,
        policySubject: "binding",
        policyRevision: 1,
        permittedAccountRef: "account",
        profileRef: "profile",
        invocationId: "invocation",
        attemptId: "attempt",
        operationId: "operation",
        limits: {
          requests: 9,
          concurrency: 1,
          requestBytes: 98304,
          outputBytes: 32768,
          tokens: 4096,
        },
      },
    }),
  };
}
