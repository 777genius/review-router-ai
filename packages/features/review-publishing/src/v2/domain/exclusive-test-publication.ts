import { createHash } from "node:crypto";
import { canonicalReviewPublicationJson } from "./canonical-review-publication-json";

/** Server-authenticated owner intent, never a request-body override. */
export type ExclusiveTestPublicationIntent = Readonly<{
  publicationIntentId: string;
  approvalHash: string;
  approvalId: string;
  purpose: "owner_one_shot_uncapped_test";
  repositoryGitHubId: "1252762369";
  testIdentityId: string;
  executionId: string;
  ownerIdHash: string;
  expiresAt: string;
}>;
export type ExclusiveTestPublicationBinding = Readonly<{
  intent: ExclusiveTestPublicationIntent;
  artifactId: string;
  artifactHash: string;
  permitHash: string;
  publicationAttemptId: string;
  planHash: string;
  operations: readonly Readonly<{
    publicationOperationId: string;
    operationHash: string;
    dependsOnOperationId: string | null;
    required: boolean;
  }>[];
}>;
export type ExclusiveTestPublicationRecord = Readonly<{
  intent: ExclusiveTestPublicationIntent;
  binding: ExclusiveTestPublicationBinding | null;
  closedAt: Date | null;
  consumedOperations: readonly string[];
}>;

export function exclusivePublicationHash(value: unknown): string {
  const normalized = normalize(value);
  return createHash("sha256")
    .update(canonicalReviewPublicationJson(normalized))
    .digest("hex");
}
/** Hash only the immutable plan, excluding persisted lifecycle fields. */
export function exclusivePublicationOperationHash(
  value: import("./review-publication-attempt").ReviewPublicationOperationPlan,
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
  value: readonly import("./review-publication-attempt").ReviewPublicationOperationPlan[],
): string {
  return exclusivePublicationHash(value.map(exclusivePublicationOperationHash));
}
export function exclusivePublicationOperations(
  value: readonly import("./review-publication-attempt").ReviewPublicationOperationPlan[],
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
export function assertExclusivePublicationIntent(
  value: ExclusiveTestPublicationIntent,
): void {
  if (
    value.purpose !== "owner_one_shot_uncapped_test" ||
    value.repositoryGitHubId !== "1252762369" ||
    !Object.values(value).every((v) => typeof v === "string" && v.length > 0) ||
    !/^[a-f0-9]{64}$/.test(value.approvalHash) ||
    !/^[a-f0-9]{64}$/.test(value.ownerIdHash) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    new Date(value.expiresAt).toISOString() !== value.expiresAt
  ) {
    throw new Error("exclusive_test_publication_intent_invalid");
  }
}
export function assertExclusivePublicationBinding(
  value: ExclusiveTestPublicationBinding,
): void {
  assertExclusivePublicationIntent(value.intent);
  if (
    ![value.artifactHash, value.permitHash, value.planHash].every((v) =>
      /^[a-f0-9]{64}$/.test(v),
    ) ||
    ![value.artifactId, value.publicationAttemptId].every(
      (v) => typeof v === "string" && v.length > 0,
    ) ||
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    value.operations.some(
      (op, index) =>
        !op.publicationOperationId ||
        !/^[a-f0-9]{64}$/.test(op.operationHash) ||
        typeof op.required !== "boolean" ||
        value.operations
          .slice(0, index)
          .some(
            (p) => p.publicationOperationId === op.publicationOperationId,
          ) ||
        (op.dependsOnOperationId !== null &&
          !value.operations
            .slice(0, index)
            .some((p) => p.publicationOperationId === op.dependsOnOperationId)),
    )
  ) {
    throw new Error("exclusive_test_publication_binding_invalid");
  }
}
