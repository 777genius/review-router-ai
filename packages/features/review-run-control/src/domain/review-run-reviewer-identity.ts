import {
  assertIdentifier,
  assertSha256,
  canonicalJson,
} from "./review-run-control-types";

/** The workspace profile owner supplies its normalized immutable identity key.
 * Settings and row position deliberately cannot manufacture another vote. */
export function canonicalReviewRunReviewerIdentity(
  input: Readonly<{
    providerProfileIdentityKey: string;
    agentProfileRef: string;
    agentProfileDigest: string;
  }>,
): string {
  assertIdentifier(input.agentProfileRef, "review_agent_profile_ref");
  assertSha256(input.agentProfileDigest, "review_agent_profile_digest");
  if (
    !input.providerProfileIdentityKey ||
    input.providerProfileIdentityKey.length > 2048
  )
    throw new Error("review_reviewer_identity_invalid");
  return canonicalJson([
    "review-reviewer-identity-v1",
    input.providerProfileIdentityKey,
    input.agentProfileRef,
    input.agentProfileDigest,
  ]);
}

/** Only an approved engine lane seed and captured reviewer may derive a vote. */
export function canonicalReviewRunReviewerVoteIdentity(
  input: Readonly<{
    providerVoteIdentityHash: string;
    reviewerId: string;
  }>,
): string {
  assertSha256(input.providerVoteIdentityHash, "provider_vote_identity_hash");
  assertIdentifier(input.reviewerId, "reviewer_id");
  return canonicalJson([
    "review-reviewer-vote-v1",
    input.providerVoteIdentityHash,
    input.reviewerId,
  ]);
}
