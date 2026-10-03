import type {
  ExclusiveTestPublicationIntent,
  ExclusiveTestPublicationBinding,
  ExclusiveTestPublicationRecord,
} from "../../domain/exclusive-test-publication";

export interface ExclusiveTestPublicationPort {
  admitIntent(intent: ExclusiveTestPublicationIntent): Promise<void>;
  bind(
    binding: ExclusiveTestPublicationBinding,
    operations: readonly import("../../domain/review-publication-attempt").ReviewPublicationOperationPlan[],
  ): Promise<void>;
  findByAttempt(
    publicationAttemptId: string,
  ): Promise<ExclusiveTestPublicationRecord | null>;
  closeUnknown(binding: ExclusiveTestPublicationBinding): Promise<void>;
  /** One transaction, no SQL/transport retry. A thrown/lost ACK means UNKNOWN. */
  consume(input: {
    binding: ExclusiveTestPublicationBinding;
    publicationOperationId: string;
    claimId: string;
    claimFencingToken: bigint;
    operationAttemptId: string;
    operationCapabilityId: string;
  }): Promise<boolean>;
}
