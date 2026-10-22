import * as current from "./generated/review-action-v2.js";
import * as legacy from "./generated/review-action-v2-legacy.js";

/** Exactly two compiled contracts; historical parser/serializer bytes remain immutable. */
export function reviewActionV2SchemaSlot(
  digest: unknown,
): typeof current | null {
  if (digest === current.reviewActionV2PublishedSchemaDigest) return current;
  if (digest === legacy.reviewActionV2PublishedSchemaDigest)
    return legacy as unknown as typeof current;
  return null;
}
export function reviewActionV2CanonicalizerForSchema(
  digest: unknown,
): string | null {
  return (
    reviewActionV2SchemaSlot(digest)?.reviewActionV2CanonicalizerDigest ?? null
  );
}

/** Select the historical canonicalizer before hashing any native request. */
export function canonicalizeReviewActionV2RequestForSlot<
  O extends current.ReviewActionV2OperationId,
>(operation: O, request: current.ReviewActionV2RequestMap[O]): string {
  const slot = reviewActionV2SchemaSlot(request.schemaDigest);
  if (!slot) throw new Error("unsupported_review_action_v2_schema_slot");
  return slot.canonicalizeReviewActionV2Request(operation, request);
}
