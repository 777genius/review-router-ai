import { createHash } from "node:crypto";
import { canonicalReviewPublicationJson } from "../domain/canonical-review-publication-json";
import type { ExclusiveTestPublicationBinding } from "../domain/exclusive-test-publication";

export function exclusivePublicationHash(value: unknown): string {
  const normalized = normalize(value);
  return createHash("sha256")
    .update(canonicalReviewPublicationJson(normalized))
    .digest("hex");
}
/** Hash only the immutable plan, excluding persisted lifecycle fields. */
export function exclusivePublicationOperationHash(
  value: import("../domain/review-publication-attempt").ReviewPublicationOperationPlan,
): string {
  const {
    publicationOperationId,
    publicationKind,
    chunkIndex,
    effectStrategy,
    role,
    markerHash,
    bodyHash,
    renderPolicyVersion,
    targetCommitId,
    reviewRevisionHash,
    required,
    dependsOnOperationId,
    reconcileUntil,
  } = value;
  return exclusivePublicationHash({
    publicationOperationId,
    publicationKind,
    chunkIndex,
    effectStrategy,
    role,
    markerHash,
    bodyHash,
    renderPolicyVersion,
    targetCommitId,
    reviewRevisionHash,
    required,
    dependsOnOperationId,
    reconcileUntil,
  });
}
export function exclusivePublicationPlanHash(
  value: readonly import("../domain/review-publication-attempt").ReviewPublicationOperationPlan[],
): string {
  return exclusivePublicationHash(value.map(exclusivePublicationOperationHash));
}
export function exclusivePublicationOperations(
  value: readonly import("../domain/review-publication-attempt").ReviewPublicationOperationPlan[],
): ExclusiveTestPublicationBinding["operations"] {
  const remaining = [...value];
  const ordered: ExclusiveTestPublicationBinding["operations"][number][] = [];
  while (remaining.length) {
    const index = remaining.findIndex(
      (op) =>
        op.dependsOnOperationId === null ||
        ordered.some(
          (previous) =>
            previous.publicationOperationId === op.dependsOnOperationId,
        ),
    );
    if (index < 0) throw new Error("exclusive_publication_dependency_invalid");
    const [op] = remaining.splice(index, 1);
    if (
      !op ||
      ordered.some(
        (previous) =>
          previous.publicationOperationId === op.publicationOperationId,
      )
    )
      throw new Error("exclusive_publication_operation_duplicate");
    ordered.push({
      publicationOperationId: op.publicationOperationId,
      operationHash: exclusivePublicationOperationHash(op),
      dependsOnOperationId: op.dependsOnOperationId,
      required: op.required,
    });
  }
  return ordered;
}
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Date) return { $date: value.toISOString() };
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}
