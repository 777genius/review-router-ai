import { reviewerPlanDescriptorDigest } from "../../packages/shared/dist/review-reviewer-plan.js";

/** The immutable manifest describes this exact reviewed wire capability. */
export function parseProducerReviewerPlanReleaseProfile(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "descriptorDigest,planVersion" ||
    !("planVersion" in value) ||
    value.planVersion !== 1 ||
    !("descriptorDigest" in value) ||
    value.descriptorDigest !== reviewerPlanDescriptorDigest
  )
    throw new Error("unsupported reviewer plan release profile");
  return Object.freeze({
    planVersion: 1,
    descriptorDigest: reviewerPlanDescriptorDigest,
  } as const);
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
