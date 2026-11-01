/** Publication-owned scheduling facts; discovery does not grant mutation authority. */
export type ReviewPublicationDueWork = {
  readonly executionId: string;
  readonly publicationAttemptId: string;
  readonly publicationOperationId: string;
  readonly provider: "github" | "gitlab";
  readonly retryCount: number;
};

export interface ReviewPublicationWorkFeedPort {
  /** Returns at most min(limit, 1000) eligible operations; zero returns no work. */
  scan(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<readonly ReviewPublicationDueWork[]>;
  /** A stale retry count or terminal operation leaves persisted state unchanged. */
  defer(input: {
    readonly work: ReviewPublicationDueWork;
    readonly nextEligibleAt: Date;
    readonly lastErrorCode: string;
  }): Promise<void>;
}
