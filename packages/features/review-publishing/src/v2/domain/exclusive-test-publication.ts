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
