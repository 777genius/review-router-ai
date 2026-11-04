import {
  type ReviewPublicationOperation,
  type ReviewPublicationPermitIdentity,
} from "../../domain/review-publication-attempt";

export enum ReviewV2PublicationPayloadKind {
  PrDescription = "pr_description",
  Summary = "summary",
  ManagedCheck = "managed_check",
  PendingReviewCreate = "pending_review_create",
  PendingReviewSubmit = "pending_review_submit",
  SubmittedReview = "submitted_review",
  ThreadLifecycle = "thread_lifecycle",
}

type ReviewV2PublicationPayloadIdentity = {
  readonly marker: string;
  readonly markerHash: string;
  readonly bodyHash: string;
  readonly bodyByteCount: number;
};

export type ReviewV2PublicationPayload =
  | (ReviewV2PublicationPayloadIdentity & {
      readonly kind: ReviewV2PublicationPayloadKind.PrDescription;
      readonly body: string;
    })
  | (ReviewV2PublicationPayloadIdentity & {
      readonly kind: ReviewV2PublicationPayloadKind.Summary;
      readonly body: string;
    })
  | (ReviewV2PublicationPayloadIdentity & {
      readonly kind: ReviewV2PublicationPayloadKind.ManagedCheck;
      readonly name: string;
      readonly title: string;
      readonly summary: string;
      readonly conclusion: "success" | "failure" | "neutral";
    })
  | (ReviewV2PublicationPayloadIdentity & {
      readonly kind:
        | ReviewV2PublicationPayloadKind.PendingReviewCreate
        | ReviewV2PublicationPayloadKind.SubmittedReview;
      readonly body: string;
      readonly comments: readonly {
        readonly path: string;
        readonly line: number;
        readonly startLine: number | null;
        readonly body: string;
      }[];
    })
  | (ReviewV2PublicationPayloadIdentity & {
      readonly kind: ReviewV2PublicationPayloadKind.PendingReviewSubmit;
      readonly body: string;
    })
  | (ReviewV2PublicationPayloadIdentity & {
      readonly kind: ReviewV2PublicationPayloadKind.ThreadLifecycle;
      readonly threadId: string;
      readonly resolve: boolean;
    });

export interface ReviewV2PublicationPayloadPort {
  resolve(input: {
    readonly permit: ReviewPublicationPermitIdentity;
    readonly operation: ReviewPublicationOperation;
  }): Promise<ReviewV2PublicationPayload | null>;
}
