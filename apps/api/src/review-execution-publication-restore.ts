import { createHash } from "node:crypto";
import {
  ReviewExecutionState,
  ReviewWorkSlotState,
  ReviewTaskKind,
  ReviewInvocationLeaseState,
  type ReviewExecutionSnapshot,
  type ReviewExecutionQueryPort,
  type ReviewWorkSlot,
} from "@reviewrouter/features-review-executions";
import type { ReviewObservationQueryPort } from "@reviewrouter/features-review-evidence";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import type { ReviewActionV2DigestPort } from "./review-action-v2-execution-evidence-dependencies.js";
import {
  authorizationScopeHash,
  evidenceTrustDomain,
  toEvidenceScope,
} from "./review-action-v2-execution-evidence-authority.js";
import { isAdoptionLookupSourceValid } from "./review-action-v2-execution-evidence-observation-validation.js";
import { reviewPublicationAttemptId } from "@reviewrouter/features-review-publishing/v2";

export type PersistedAcceptedReviewManifest = Readonly<{
  workSlotId: string;
  manifestCanonicalJson: string;
  manifestKey: string;
  providerInvocationKey: string;
  providerVoteIdentityHash: string;
}>;

export type PersistedUnattachedReviewManifest =
  PersistedAcceptedReviewManifest &
    Readonly<{
      observationId: string;
      payloadHash: string;
      sourceLeaseId: string;
      sourceFencingToken: string;
      sourceOwnerIdHash: string;
    }>;

/** A single spent provider attempt has no possible later source to choose. */
export function isUnattachedAcceptedRestoreSlot(
  snapshot: ReviewExecutionSnapshot,
  slot: ReviewWorkSlot,
): boolean {
  return (
    snapshot.execution.state === ReviewExecutionState.Running &&
    snapshot.stream.activeExecutionId === snapshot.execution.executionId &&
    slot.taskKind === ReviewTaskKind.FindingDiscovery &&
    slot.state === ReviewWorkSlotState.Exhausted &&
    slot.attemptBudget === 1 &&
    slot.nextAttemptOrdinal === 2 &&
    slot.activeLeaseId === null &&
    slot.acceptedObservationRefId === null
  );
}

/** Original identity hints; lookup and adoption still recheck authority. */
export async function loadUnattachedAcceptedReviewManifests(input: {
  readonly snapshot: ReviewExecutionSnapshot;
  readonly authorization: ReviewRunAuthorization;
  readonly queries: Pick<ReviewExecutionQueryPort, "findLease">;
  readonly observations: Pick<
    ReviewObservationQueryPort,
    "findSourceSlotCandidates"
  >;
  readonly digest: ReviewActionV2DigestPort;
  readonly now: Date;
  readonly maxObservationBytes: number;
  readonly maxObservationFindings: number;
}): Promise<readonly PersistedUnattachedReviewManifest[]> {
  const { snapshot, authorization } = input;
  const slots = snapshot.execution.workSlots.filter((slot) =>
    isUnattachedAcceptedRestoreSlot(snapshot, slot),
  );
  if (slots.length === 0) return [];
  const scopeHash = await authorizationScopeHash(authorization, input.digest);
  const manifests: PersistedUnattachedReviewManifest[] = [];
  for (const slot of slots) {
    const candidates = await input.observations.findSourceSlotCandidates({
      scope: toEvidenceScope(authorization, scopeHash),
      trustDomain: evidenceTrustDomain(authorization.trustDomain),
      sourceExecutionId: snapshot.execution.executionId,
      sourceWorkSlotId: slot.workSlotId,
      providerVoteIdentityHash: slot.providerVoteIdentityHash,
      reusableAfterMs: input.now.getTime(),
    });
    if (candidates.length > 1)
      throw new Error("review_restore_accepted_source_ambiguous");
    const observation = candidates[0];
    if (!observation) continue;
    const sourceLease = await input.queries.findLease(
      observation.sourceLeaseId,
    );
    if (
      !sourceLease ||
      (sourceLease.state !== ReviewInvocationLeaseState.Released &&
        sourceLease.state !== ReviewInvocationLeaseState.Expired) ||
      sourceLease.attemptOrdinal !== 1 ||
      !sourceLease.preparedManifestCanonicalJson ||
      !sourceLease.preparedManifestKey ||
      observation.sourceWorkSlotId !== slot.workSlotId ||
      observation.sourceAuthorizationId !== authorization.authorizationId ||
      observation.sourcePlanHash !== snapshot.execution.planHash ||
      observation.sourceRunId !== snapshot.execution.sourceRunId ||
      observation.sourceRunAttempt !== snapshot.execution.sourceRunAttempt ||
      observation.byteCount > input.maxObservationBytes ||
      observation.findingCount > input.maxObservationFindings
    )
      continue;
    const manifest: PersistedUnattachedReviewManifest = {
      workSlotId: slot.workSlotId,
      manifestCanonicalJson: sourceLease.preparedManifestCanonicalJson,
      manifestKey: sourceLease.preparedManifestKey,
      providerInvocationKey: sourceLease.providerInvocationKey,
      providerVoteIdentityHash: sourceLease.providerVoteIdentityHash,
      observationId: observation.observationId,
      payloadHash: observation.payloadHash,
      sourceLeaseId: sourceLease.leaseId,
      sourceFencingToken: sourceLease.fencingToken.toString(10),
      sourceOwnerIdHash: sourceLease.ownerIdHash,
    };
    if (
      await isAdoptionLookupSourceValid({
        request: { ...manifest, executionId: snapshot.execution.executionId },
        authorization,
        snapshot,
        observation,
        sourceLease,
        scopeHash,
        now: input.now,
        digest: input.digest,
      })
    )
      manifests.push(manifest);
  }
  return Object.freeze(manifests);
}

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
  unattachedAcceptedManifests: readonly PersistedUnattachedReviewManifest[] = [],
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
    ...(unattachedAcceptedManifests.length > 0
      ? {
          unattachedAcceptedManifests: unattachedAcceptedManifests.map(
            (manifest) => ({ ...manifest }),
          ),
        }
      : {}),
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
