import { RenewReviewPublicationClaimStatus } from "../ports/review-publication-ports";
import {
  type ReviewPublicationClaimTerm,
  type ReviewPublicationOperation,
  type ReviewPublicationPermitIdentity,
} from "../../domain/review-publication-attempt";
import {
  ReviewV2PublicationEffectGateDecision,
  ReviewV2ScmProvider,
  type ReviewV2PublicationExecutionCommand,
  type ReviewV2PublicationExecutionResult,
  type ReviewV2PublicationExecutorPolicy,
  type ReviewV2PublicationFreshnessPort,
  type ReviewV2PublicationEffectGatePort,
  type ReviewV2PublicationApplicationPort,
} from "../ports/review-publication-execution-ports";
import {
  assessFreshness,
  retryable,
  busy,
  type FreshnessAssessment,
} from "./review-publication-execution-state";

type PublicationExecutionAuthorityDependencies = {
  readonly freshness: ReviewV2PublicationFreshnessPort;
  readonly effectGate: ReviewV2PublicationEffectGatePort;
  readonly renewClaim: ReviewV2PublicationApplicationPort["renewClaim"];
};

/** Fresh authority checks and durable lease renewal at each existing effect boundary. */
export class PublicationExecutionAuthority {
  constructor(
    private readonly dependencies: PublicationExecutionAuthorityDependencies,
    private readonly policy: Pick<
      ReviewV2PublicationExecutorPolicy,
      "claimDurationMs" | "minimumMutationLeaseMs"
    >,
  ) {}

  async authorizeEffect(
    provider: ReviewV2ScmProvider,
    permit: ReviewPublicationPermitIdentity,
    operation: ReviewPublicationOperation,
  ): Promise<ReviewV2PublicationEffectGateDecision> {
    try {
      return await this.dependencies.effectGate.authorize({
        provider,
        permit,
        operation,
      });
    } catch {
      return ReviewV2PublicationEffectGateDecision.Unavailable;
    }
  }

  async renewForMutation(
    command: ReviewV2PublicationExecutionCommand,
    claim: ReviewPublicationClaimTerm,
  ): Promise<
    | { readonly claim: ReviewPublicationClaimTerm }
    | { readonly result: ReviewV2PublicationExecutionResult }
  > {
    try {
      const renewed = await this.dependencies.renewClaim({
        publicationAttemptId: command.publicationAttemptId,
        claimId: claim.claimId,
        ownerIdHash: command.ownerIdHash,
        claimFencingToken: claim.fencingToken,
        extendByMs: this.policy.claimDurationMs,
        minimumRemainingMs: this.policy.minimumMutationLeaseMs,
      });
      return renewed.status === RenewReviewPublicationClaimStatus.Renewed
        ? { claim: renewed.claim }
        : {
            result:
              renewed.status === RenewReviewPublicationClaimStatus.StaleClaim
                ? busy("publication_claim_fenced_before_mutation")
                : retryable(`publication_claim_renewal_${renewed.status}`),
          };
    } catch {
      return { result: retryable("publication_claim_renewal_unavailable") };
    }
  }

  async readFreshness(
    provider: ReviewV2ScmProvider,
    permit: ReviewPublicationPermitIdentity,
  ): Promise<FreshnessAssessment> {
    try {
      const read = await this.dependencies.freshness.read(provider, permit);
      return assessFreshness(read, permit);
    } catch {
      return {
        status: "unavailable",
        safeReason: "publication_freshness_read_failed",
      };
    }
  }
}
