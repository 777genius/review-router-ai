import { describe, expect, it } from "vitest";
import type {
  ReviewExecutionSnapshot,
  ReviewInvocationLease,
} from "@reviewrouter/features-review-executions";
import type { ReviewPublicationAttemptView } from "@reviewrouter/features-review-publishing/v2";
import {
  exactRestoredPublication,
  persistedReviewExecutionRestore,
  loadAcceptedReviewInvocationManifests,
} from "./review-execution-publication-restore.js";

const snapshot = {
  execution: {
    executionId: "execution",
    generation: 3n,
    planHash: "persisted-plan",
    compatibilityKey: "persisted-compatibility-key",
    revision: { headSha: "head", reviewRevisionHash: "revision" },
    assignmentManifestVersion: 2,
    assignmentManifestHash: "manifest-hash",
    assignmentManifestCanonicalJson: '{"selectedTargets":["A","B"]}',
    workSlots: [
      {
        workSlotId: "verification-slot",
        taskKind: "lifecycle_revalidation",
        acceptedObservationRefId: "accepted-observation",
        nextAttemptOrdinal: 2,
      },
    ],
  },
  artifact: {
    artifactId: "artifact",
    executionId: "execution",
    generation: 3n,
    reviewedHeadSha: "head",
    reviewRevisionHash: "revision",
    projectionHash: "projection",
    projectionEnvelopeVersion: 1,
    projectionEnvelopeJson: '{"fixesVerified":2}',
    lifecycleStateHash: "lifecycle",
    commandLedgerWatermark: 8n,
  },
} as unknown as ReviewExecutionSnapshot;

describe("persisted publication recovery readback", () => {
  it("returns the original selected A/B plan and frozen artifact after a new reader starts", () => {
    const before = persistedReviewExecutionRestore(snapshot);
    const restarted = persistedReviewExecutionRestore(snapshot);
    expect(restarted).toEqual(before);
    expect(restarted.assignmentManifestCanonicalJson).toBe(
      '{"selectedTargets":["A","B"]}',
    );
    expect(restarted.workSlots[0]).toMatchObject({
      acceptedObservationRefId: "accepted-observation",
      nextAttemptOrdinal: 2,
    });
    expect(restarted.artifact?.projectionEnvelopeCanonicalJson).toBe(
      '{"fixesVerified":2}',
    );
    const view = {
      attempt: {
        publicationAttemptId: restarted.artifact!.publicationAttemptId,
        permit: {
          executionId: "execution",
          generation: 3n,
          reviewedHeadSha: "head",
          reviewRevisionHash: "revision",
          projectionHash: "projection",
        },
      },
    } as unknown as ReviewPublicationAttemptView;
    expect(exactRestoredPublication(snapshot, view)).toBe(view);
    expect(() =>
      exactRestoredPublication(snapshot, {
        ...view,
        attempt: {
          ...view.attempt,
          permit: { ...view.attempt.permit, reviewedHeadSha: "foreign-head" },
        },
      }),
    ).toThrow("restore_publication_scope_mismatch");
    expect(() =>
      persistedReviewExecutionRestore({
        ...snapshot,
        artifact: { ...snapshot.artifact!, generation: 4n },
      }),
    ).toThrow("restore_artifact_scope_mismatch");
  });
  it("restores the original accepted manifest from a released source lease and rejects a foreign scope or fence", async () => {
    const accepted = {
      ...snapshot,
      artifact: null,
      execution: {
        ...snapshot.execution,
        workspaceId: "workspace",
        repositoryConnectionId: "repository",
        scmRepositoryIdentityId: "scm",
        pullRequestNumber: 1,
        workSlots: [
          {
            ...snapshot.execution.workSlots[0]!,
            state: "satisfied",
            providerVoteIdentityHash: "vote",
          },
        ],
      },
      activeLeases: [],
      observationRefs: [
        {
          observationRefId: "accepted-observation",
          executionId: "execution",
          workSlotId: "verification-slot",
          providerVoteIdentityHash: "vote",
          providerInvocationKey: "original-invocation",
          sourceExecutionId: "original-source-execution",
          sourceLeaseId: "released-source-lease",
          sourceFencingToken: 7n,
        },
      ],
    } as unknown as ReviewExecutionSnapshot;
    const source = {
      leaseId: "released-source-lease",
      purpose: "provider_execution",
      state: "released",
      executionId: "original-source-execution",
      fencingToken: 7n,
      workspaceId: "workspace",
      repositoryConnectionId: "repository",
      scmRepositoryIdentityId: "scm",
      pullRequestNumber: 1,
      reviewRevisionHash: "revision",
      providerVoteIdentityHash: "vote",
      providerInvocationKey: "original-invocation",
      preparedManifestCanonicalJson:
        '{"originalPacketHash":"A-and-B-before-B-changed"}',
      preparedManifestKey: "original-manifest-key",
    } as unknown as ReviewInvocationLease;
    const requested: string[] = [];
    const manifests = await loadAcceptedReviewInvocationManifests(accepted, {
      async findLease(id) {
        requested.push(id);
        return source;
      },
    });
    expect(requested).toEqual(["released-source-lease"]);
    expect(manifests).toEqual([
      {
        workSlotId: "verification-slot",
        manifestCanonicalJson:
          '{"originalPacketHash":"A-and-B-before-B-changed"}',
        manifestKey: "original-manifest-key",
        providerInvocationKey: "original-invocation",
        providerVoteIdentityHash: "vote",
      },
    ]);
    expect(
      persistedReviewExecutionRestore(accepted, manifests).acceptedManifests,
    ).toEqual(manifests);
    for (const invalid of [
      { ...source, fencingToken: 8n },
      { ...source, reviewRevisionHash: "other-head-revision" },
      { ...source, repositoryConnectionId: "foreign-repository" },
    ])
      expect(
        await loadAcceptedReviewInvocationManifests(accepted, {
          async findLease() {
            return invalid;
          },
        }),
      ).toEqual([]);
  });
});
