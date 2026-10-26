import { createHash } from "node:crypto";
import type {
  ReviewExecutionSnapshot,
  ReviewExecutionQueryPort,
} from "@reviewrouter/features-review-executions";
import {
  reviewPublicationAttemptId,
  type ReviewPublicationAttemptView,
} from "@reviewrouter/features-review-publishing/v2";

export type PersistedAcceptedReviewManifest = Readonly<{
  workSlotId: string;
  manifestCanonicalJson: string;
  manifestKey: string;
  providerInvocationKey: string;
  providerVoteIdentityHash: string;
}>;

/** Released source leases remain authoritative; activeLeases alone is not a recovery inventory. */
export async function loadAcceptedReviewInvocationManifests(
  snapshot: ReviewExecutionSnapshot,
  queries: Pick<ReviewExecutionQueryPort, "findLease">,
): Promise<readonly PersistedAcceptedReviewManifest[]> {
  const manifests: PersistedAcceptedReviewManifest[] = [];
  for (const slot of snapshot.execution.workSlots) {
    if (slot.state !== "satisfied" || !slot.acceptedObservationRefId) continue;
    const refs = snapshot.observationRefs.filter(
      (ref) =>
        ref.observationRefId === slot.acceptedObservationRefId &&
        ref.workSlotId === slot.workSlotId &&
        ref.executionId === snapshot.execution.executionId &&
        ref.providerVoteIdentityHash === slot.providerVoteIdentityHash,
    );
    if (
      refs.length !== 1 ||
      !refs[0]!.sourceLeaseId ||
      refs[0]!.sourceFencingToken === null
    )
      continue;
    const ref = refs[0]!;
    const lease = await queries.findLease(ref.sourceLeaseId!);
    if (
      !lease ||
      lease.purpose !== "provider_execution" ||
      lease.leaseId !== ref.sourceLeaseId ||
      lease.fencingToken !== ref.sourceFencingToken ||
      lease.executionId !== ref.sourceExecutionId ||
      lease.workspaceId !== snapshot.execution.workspaceId ||
      lease.repositoryConnectionId !==
        snapshot.execution.repositoryConnectionId ||
      lease.scmRepositoryIdentityId !==
        snapshot.execution.scmRepositoryIdentityId ||
      lease.pullRequestNumber !== snapshot.execution.pullRequestNumber ||
      lease.reviewRevisionHash !==
        snapshot.execution.revision.reviewRevisionHash ||
      lease.providerInvocationKey !== ref.providerInvocationKey ||
      lease.providerVoteIdentityHash !== ref.providerVoteIdentityHash ||
      !lease.preparedManifestCanonicalJson ||
      !lease.preparedManifestKey
    )
      continue;
    manifests.push({
      workSlotId: slot.workSlotId,
      manifestCanonicalJson: lease.preparedManifestCanonicalJson,
      manifestKey: lease.preparedManifestKey,
      providerInvocationKey: lease.providerInvocationKey,
      providerVoteIdentityHash: lease.providerVoteIdentityHash,
    });
  }
  return manifests;
}

/** Read only persisted identity before any inventory-driven planning in a restarted runner. */
export function persistedReviewExecutionRestore(
  snapshot: ReviewExecutionSnapshot,
  acceptedManifests: readonly PersistedAcceptedReviewManifest[] = [],
) {
  const execution = snapshot.execution;
  const artifact = snapshot.artifact;
  if (
    artifact &&
    (artifact.executionId !== execution.executionId ||
      artifact.generation !== execution.generation ||
      artifact.reviewedHeadSha !== execution.revision.headSha ||
      artifact.reviewRevisionHash !== execution.revision.reviewRevisionHash)
  )
    throw new Error("restore_artifact_scope_mismatch");
  return {
    planHash: execution.planHash,
    compatibilityKey: execution.compatibilityKey,
    assignmentManifestVersion: execution.assignmentManifestVersion ?? null,
    assignmentManifestHash: execution.assignmentManifestHash ?? null,
    assignmentManifestCanonicalJson:
      execution.assignmentManifestCanonicalJson ?? null,
    workSlots: execution.workSlots.map((slot) => ({ ...slot })),
    acceptedManifests: acceptedManifests.map((manifest) => ({ ...manifest })),
    artifact: artifact
      ? {
          artifactId: artifact.artifactId,
          executionId: artifact.executionId,
          generation: artifact.generation.toString(),
          reviewedHeadSha: artifact.reviewedHeadSha,
          reviewRevisionHash: artifact.reviewRevisionHash,
          projectionHash: artifact.projectionHash,
          projectionEnvelopeVersion: artifact.projectionEnvelopeVersion,
          projectionEnvelopeCanonicalJson: artifact.projectionEnvelopeJson,
          lifecycleStateHash: artifact.lifecycleStateHash,
          commandLedgerWatermark: artifact.commandLedgerWatermark.toString(),
          publicationAttemptId: reviewPublicationAttemptId({
            executionId: artifact.executionId,
            artifactId: artifact.artifactId,
            projectionHash: artifact.projectionHash,
            digestUtf8: (value) =>
              createHash("sha256").update(value).digest("hex"),
          }),
        }
      : null,
  };
}

/** A lookup result must be this exact frozen publication, regardless of current inventory digest. */
export function exactRestoredPublication(
  snapshot: ReviewExecutionSnapshot,
  view: ReviewPublicationAttemptView | null,
): ReviewPublicationAttemptView | null {
  const expected = persistedReviewExecutionRestore(snapshot).artifact;
  if (!view || !expected) return null;
  const attempt = view.attempt;
  if (
    attempt.publicationAttemptId !== expected.publicationAttemptId ||
    attempt.permit.executionId !== expected.executionId ||
    attempt.permit.generation.toString() !== expected.generation ||
    attempt.permit.projectionHash !== expected.projectionHash ||
    attempt.permit.reviewedHeadSha !== expected.reviewedHeadSha ||
    attempt.permit.reviewRevisionHash !== expected.reviewRevisionHash
  )
    throw new Error("restore_publication_scope_mismatch");
  return view;
}
