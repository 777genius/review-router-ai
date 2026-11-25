import {
  reviewerPlanContract,
  reviewerPlanDescriptorDigest,
  reviewerPlanV1DescriptorDigest,
} from "../../packages/shared/dist/review-reviewer-plan.js";

/**
 * The immutable manifest describes this exact reviewed wire capability: the
 * current descriptor, or the version 1 descriptor of an earlier release.
 */
export function parseProducerReviewerPlanReleaseProfile(value: unknown) {
  const known = new Map<number, string>([
    [1, reviewerPlanV1DescriptorDigest],
    [reviewerPlanContract.planVersion, reviewerPlanDescriptorDigest],
  ]);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "descriptorDigest,planVersion" ||
    !("planVersion" in value) ||
    typeof value.planVersion !== "number" ||
    !("descriptorDigest" in value) ||
    known.get(value.planVersion) !== value.descriptorDigest
  )
    throw new Error("unsupported reviewer plan release profile");
  return Object.freeze({
    planVersion: value.planVersion,
    descriptorDigest: value.descriptorDigest as string,
  });
}

/** The optional compatibility fact must travel with its canonical parser bytes. */
export function bindProducerReviewerPlanReleaseProfile(
  value: unknown,
  files: Readonly<Record<string, string>>,
) {
  const profile = parseProducerReviewerPlanReleaseProfile(value);
  if (!/^[a-f0-9]{64}$/.test(files["review-reviewer-plan.ts"] ?? ""))
    throw new Error("reviewer plan profile has no bound canonical parser");
  return profile;
}
