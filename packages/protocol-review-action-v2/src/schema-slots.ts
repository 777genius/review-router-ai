import * as current from "./generated/review-action-v2.js";
import * as legacy from "./generated/review-action-v2-legacy.js";
import * as pinned171 from "./generated/review-action-v2-pinned171.js";

export { pinned171 as reviewActionV2Pinned171Slot };

const compiledSlots: readonly (typeof current)[] = [
  current,
  legacy as unknown as typeof current,
  pinned171 as unknown as typeof current,
];

/** Exact producer contract selection; one schema can have multiple published canonicalizers. */
export function reviewActionV2ContractSlot(
  schemaDigest: unknown,
  canonicalizerDigest: unknown,
): typeof current | null {
  return (
    compiledSlots.find(
      (slot) =>
        slot.reviewActionV2PublishedSchemaDigest === schemaDigest &&
        slot.reviewActionV2CanonicalizerDigest === canonicalizerDigest,
    ) ?? null
  );
}

/** Extension identity comes from an attested contract or an authenticated stored snapshot. */
export function reviewActionV2InvestigationExtensionForSchema(
  schemaDigest: unknown,
  extensionCanonicalizerDigest: unknown,
) {
  return (
    compiledSlots.find(
      (slot) =>
        slot.reviewActionV2PublishedSchemaDigest === schemaDigest &&
        slot.reviewInvestigationExtensionV1.canonicalizerDigest ===
          extensionCanonicalizerDigest,
    )?.reviewInvestigationExtensionV1 ?? null
  );
}

/** Native wire parser selection. The two legacy modules have byte-identical native functions. */
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

export interface ReviewActionV2ContractDescriptor {
  readonly protocolVersion: string;
  readonly schemaDigest: string;
  readonly canonicalizerDigest: string;
}

/** Public identifiers of the compiled slots, derived from the same modules as the slot selection. */
export function reviewActionV2SupportedContracts(): readonly ReviewActionV2ContractDescriptor[] {
  return compiledSlots.map((slot) => ({
    protocolVersion: slot.reviewActionV2PublishedProtocolVersion,
    schemaDigest: slot.reviewActionV2PublishedSchemaDigest,
    canonicalizerDigest: slot.reviewActionV2CanonicalizerDigest,
  }));
}
