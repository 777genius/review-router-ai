import type {
  ReviewPublicationPermitIdentity,
  ReviewPublicationScope,
} from "../../domain/review-publication-attempt";

/** Facts translated from execution and authorization owners, never current host flags. */
export type CurrentPublicationLifecycleFacts = Readonly<{
  execution: Readonly<{
    executionId: string;
    generation: bigint;
    reviewedHeadSha: string;
    reviewRevisionHash: string;
  }> | null;
  artifact: Readonly<{
    artifactId: string;
    executionId: string;
    generation: bigint;
    reviewedHeadSha: string;
    reviewRevisionHash: string;
    projectionHash: string;
    projectionEnvelopeJson: string;
    lifecycleStateHash: string;
    commandLedgerWatermark: bigint;
    publicationPermit: ReviewPublicationPermitIdentity;
  }>;
  authorization: Readonly<{
    createdAt: Date;
    requiresResolutionHistory: boolean;
  }>;
}>;

export interface CurrentPublicationLifecycleFactsPort {
  /** Null means missing current execution, artifact or authorization; failed reads throw. */
  readCurrent(
    scope: ReviewPublicationScope,
  ): Promise<CurrentPublicationLifecycleFacts | null>;
}
