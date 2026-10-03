import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import { InvestigationRolloutCapability } from "@reviewrouter/features-review-investigation-operations";
import { parseInvestigationAuthorizationDescriptorJson } from "@reviewrouter/features-hosted-account-pool/v4-relay-descriptor";

export type ReviewInvestigationAuthorizedProviderKind = "codex" | "claude_code";

export type ReviewInvestigationExtensionRequirement = Readonly<{
  providerKind: ReviewInvestigationAuthorizedProviderKind;
  capability: InvestigationRolloutCapability;
}>;

export function hasAuthorizedReviewInvestigationExtension(
  authorization: Pick<
    ReviewRunAuthorization,
    "reviewInvestigationAuthorizationDescriptorCanonicalJson"
  >,
  requirement?: ReviewInvestigationExtensionRequirement,
): boolean {
  const descriptor = parseInvestigationAuthorizationDescriptorJson(
    authorization.reviewInvestigationAuthorizationDescriptorCanonicalJson,
  );
  if (descriptor === null) return false;
  return (
    requirement === undefined ||
    descriptor.providerCapabilities.some(
      (row) =>
        row.providerKind === requirement.providerKind &&
        row.capabilities.includes(requirement.capability),
    )
  );
}
