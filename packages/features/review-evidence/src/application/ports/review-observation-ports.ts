import type { ReviewObservation } from "../../domain/review-observation";
import type {
  ReviewEvidenceScope,
  ReviewTrustDomain,
} from "../../domain/review-evidence-primitives";

export enum ReviewObservationAcceptPersistenceStatus {
  Accepted = "accepted",
  Idempotent = "idempotent",
  Conflict = "conflict",
}

export type ReviewObservationAcceptPersistenceResult =
  | Readonly<{
      status:
        | ReviewObservationAcceptPersistenceStatus.Accepted
        | ReviewObservationAcceptPersistenceStatus.Idempotent;
      observation: ReviewObservation;
    }>
  | Readonly<{
      status: ReviewObservationAcceptPersistenceStatus.Conflict;
    }>;

export interface ReviewObservationCommandPort {
  acceptObservation(
    observation: ReviewObservation,
  ): Promise<ReviewObservationAcceptPersistenceResult>;
}

export interface ReviewObservationIdentityPort {
  nextObservationId(): string;
}

export interface ReviewObservationQueryPort {
  /** Exact original source inventory; at most two rows expose ambiguity. */
  findSourceSlotCandidates(input: {
    readonly scope: ReviewEvidenceScope;
    readonly trustDomain: ReviewTrustDomain;
    readonly sourceExecutionId: string;
    readonly sourceWorkSlotId: string;
    readonly providerVoteIdentityHash: string;
    readonly reusableAfterMs: number;
  }): Promise<readonly ReviewObservation[]>;
  findById(observationId: string): Promise<ReviewObservation | null>;
  findCandidates(input: {
    readonly scope: ReviewEvidenceScope;
    readonly trustDomain: ReviewTrustDomain;
    readonly providerInvocationKey: string;
    readonly reusableAfterMs: number;
    readonly limit: number;
  }): Promise<readonly ReviewObservation[]>;
}

export interface ReviewEvidencePrunerPort {
  pruneRetainedObservations(input: {
    readonly retainUntilOrBeforeMs: number;
    readonly limit: number;
  }): Promise<number>;
}
