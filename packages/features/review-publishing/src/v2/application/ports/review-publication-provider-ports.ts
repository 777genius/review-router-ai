import {
  ReviewPublicationReceiptStatus,
  type ReviewPublicationPermitIdentity,
  type ReviewPublicationOperation,
  type ReviewPublicationOperationCapabilityFacts,
} from "../../domain/review-publication-attempt";
import { type ReviewPublicationGatewayObject } from "./review-publication-ports";
import {
  ReviewV2ScmCredentialPurpose,
  ReviewV2ScmProvider,
} from "./review-publication-execution-ports";

export interface ReviewV2ProviderPublicationClientPort {
  findAllByMarker(input: {
    readonly operation: ReviewPublicationOperation;
    readonly cursor: string | null;
  }): Promise<{
    readonly objects: readonly ReviewPublicationGatewayObject[];
    readonly nextCursor: string | null;
  }>;
  applyOperation(input: {
    readonly operation: ReviewPublicationOperation;
    readonly capability: ReviewPublicationOperationCapabilityFacts;
  }): Promise<ReviewPublicationGatewayObject>;
  markStaleOrDelete(input: {
    readonly operation: ReviewPublicationOperation;
    readonly canonicalExternalObjectId: string;
    readonly duplicateExternalObjectIds: readonly string[];
    readonly compensateCanonical: boolean;
  }): Promise<ReviewPublicationReceiptStatus>;
}

export type ReviewV2ProviderPublicationClientSession = {
  readonly client: ReviewV2ProviderPublicationClientPort;
  close(): Promise<void>;
};

/** Production implementations may hold a token internally but never return it. */
export interface ReviewV2ProviderCredentialPort {
  readonly provider: ReviewV2ScmProvider;
  acquireClient(input: {
    readonly purpose: ReviewV2ScmCredentialPurpose;
    readonly permit: ReviewPublicationPermitIdentity;
    readonly capability: ReviewPublicationOperationCapabilityFacts;
  }): Promise<ReviewV2ProviderPublicationClientSession>;
}
