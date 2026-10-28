import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "@reviewrouter/features-review-run-control";
import type { ReviewPublicationAttemptView } from "@reviewrouter/features-review-publishing/v2";
import type { ReviewSnapshotV2Record } from "@reviewrouter/features-review-snapshots/v2";

export interface AppliedComparisonResolution {
  readonly lineageId: string;
  readonly targetId: string;
  readonly threadId: string;
  readonly markerFingerprint: string;
  readonly resolvedAt: string;
}
const boundedId = z.string().min(1).max(4096);
const target = z.object({
  targetId: boundedId,
  threadId: boundedId,
  markerFingerprint: z.string().regex(/^(?:rrl_[a-f0-9]{32}|[a-f0-9]{24,64})$/),
  lineageId: z
    .string()
    .regex(/^rrl_[a-f0-9]{32}$/)
    .optional(),
  verdict: z.string(),
  mutationEligible: z.boolean(),
});
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** A desired resolve is insufficient: require its canonical successful operation receipt. */
export function appliedComparisonResolutions(
  record: ReviewSnapshotV2Record,
  view: ReviewPublicationAttemptView | null,
): readonly AppliedComparisonResolution[] {
  if (
    !view ||
    view.attempt.state !== "terminal" ||
    view.attempt.terminalOutcome !== "succeeded" ||
    view.corrections.length > 0 ||
    view.tombstones.length > 0
  )
    return [];
  const projection = record.payload.projectionEnvelope;
  const publishing = z
    .object({ lifecycle: z.array(target).max(2000) })
    .safeParse(projection.publishing);
  const snapshot = z
    .object({
      lineageHints: z
        .array(z.object({ lineageId: z.string(), active: z.boolean() }))
        .max(2000),
    })
    .safeParse(projection.snapshot);
  if (!publishing.success || !snapshot.success) return [];
  const known = new Set(
    snapshot.data.lineageHints.map((hint) => hint.lineageId),
  );
  const result: AppliedComparisonResolution[] = [];
  for (const entry of publishing.data.lifecycle) {
    if (
      !entry.mutationEligible ||
      entry.verdict !== "resolved" ||
      !entry.lineageId ||
      !known.has(entry.lineageId) ||
      entry.markerFingerprint !== entry.lineageId
    )
      continue;
    const markerHash = sha(`reviewrouter-lifecycle:${entry.targetId}:resolved`);
    const bodyHash = sha(
      canonicalJson({ resolve: true, threadId: entry.threadId }),
    );
    const operation = view.attempt.operations.find(
      (operation) =>
        operation.publicationKind === "thread_lifecycle" &&
        operation.state === "completed" &&
        operation.markerHash === markerHash &&
        operation.bodyHash === bodyHash &&
        operation.targetCommitId === record.sourceReviewedHeadSha &&
        operation.reviewRevisionHash === record.sourceReviewRevisionHash,
    );
    if (!operation) continue;
    const receipt = view.receipts.find(
      (receipt) =>
        receipt.publicationOperationId === operation.publicationOperationId &&
        receipt.status === "succeeded" &&
        receipt.canonicalExternalObjectId === `thread:${entry.threadId}`,
    );
    const effect =
      receipt &&
      view.effects.find(
        (effect) =>
          effect.effectId === receipt.canonicalEffectId &&
          effect.publicationOperationId === operation.publicationOperationId &&
          effect.externalObjectId === receipt.canonicalExternalObjectId &&
          effect.effectKind !== "lifecycle_compensated",
      );
    if (!effect || !Number.isFinite(effect.observedAt.getTime())) continue;
    result.push({
      lineageId: entry.lineageId,
      targetId: entry.targetId,
      threadId: entry.threadId,
      markerFingerprint: entry.markerFingerprint,
      resolvedAt: effect.observedAt.toISOString(),
    });
  }
  const keys = result.map(
    (entry) => `${entry.lineageId}\0${entry.threadId}\0${entry.targetId}`,
  );
  return new Set(keys).size === keys.length ? result : [];
}

/** Positive history is independent of whole-publication success or retained snapshot state. */
export function retainedComparisonResolutionFacts(
  record: ReviewSnapshotV2Record,
  view: ReviewPublicationAttemptView | null,
): readonly import("@reviewrouter/features-review-publishing/v2").ConfirmedResolutionFact[] {
  if (!view) return [];
  const publishing = z
    .object({ lifecycle: z.array(target).max(2000) })
    .safeParse(record.payload.projectionEnvelope.publishing);
  if (!publishing.success) return [];
  const result: import("@reviewrouter/features-review-publishing/v2").ConfirmedResolutionFact[] =
    [];
  for (const entry of publishing.data.lifecycle) {
    if (entry.verdict !== "resolved" || !entry.mutationEligible) continue;
    const operation = view.attempt.operations.find(
      (operation) =>
        operation.publicationKind === "thread_lifecycle" &&
        operation.markerHash ===
          sha(`reviewrouter-lifecycle:${entry.targetId}:resolved`) &&
        operation.bodyHash ===
          sha(canonicalJson({ resolve: true, threadId: entry.threadId })) &&
        operation.targetCommitId === record.sourceReviewedHeadSha &&
        operation.reviewRevisionHash === record.sourceReviewRevisionHash,
    );
    if (!operation) continue;
    const effect = view.effects.find(
      (effect) =>
        effect.publicationOperationId === operation.publicationOperationId &&
        effect.externalObjectId === `thread:${entry.threadId}` &&
        effect.effectKind !== "lifecycle_compensated" &&
        Number.isFinite(effect.observedAt.getTime()),
    );
    if (!effect) continue;
    result.push({
      sourceKind: "canonical_operation",
      operationId: operation.publicationOperationId,
      publicationAttemptId: view.attempt.publicationAttemptId,
      executionId: view.attempt.permit.executionId,
      generation: view.attempt.permit.generation.toString(),
      reviewedHeadSha: operation.targetCommitId,
      bodyHash: operation.bodyHash,
      effectId: effect.effectId,
      observedAt: effect.observedAt.toISOString(),
    });
  }
  return result;
}

export type ComparisonResolutionHistoryWitness = Readonly<{
  targetId: string;
  threadId: string;
  parentCommentId: string;
  parentCreatedAt: string;
  parentBodyHash: string;
  history: import("@reviewrouter/features-review-publishing/v2").ResolutionHistory;
}>;

/** Bind history to the exact native parent; absence before the cut remains explicitly unobserved. */
export function bindComparisonResolutionHistory(
  targets: readonly Omit<ComparisonResolutionHistoryWitness, "history">[],
  histories: readonly import("@reviewrouter/features-review-publishing/v2").ResolutionHistory[],
): readonly ComparisonResolutionHistoryWitness[] {
  const byThread = new Map(
    histories.map((history) => [history.threadId, history]),
  );
  if (byThread.size !== histories.length)
    throw new Error("resolution_history_duplicate_thread");
  const unique = new Set<string>();
  return targets.map((target) => {
    const history = byThread.get(target.threadId);
    if (
      !history ||
      !target.targetId ||
      !target.threadId ||
      !target.parentCommentId ||
      !Number.isFinite(Date.parse(target.parentCreatedAt)) ||
      !/^[a-f0-9]{64}$/.test(target.parentBodyHash) ||
      unique.has(target.targetId)
    )
      throw new Error("resolution_history_target_binding_invalid");
    unique.add(target.targetId);
    return { ...target, history };
  });
}
