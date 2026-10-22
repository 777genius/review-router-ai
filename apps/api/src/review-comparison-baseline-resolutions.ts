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
