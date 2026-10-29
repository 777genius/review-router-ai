/** Finite Action ↔ control-plane task. Bodies, models and accounts are server-owned. */
export type ConversationProcessRequest = {
  readonly protocolVersion: 2;
  readonly pullRequestNumber: number;
  readonly sourceCommentId: string;
  readonly sourceRevision: string;
  readonly eventAction: "created" | "edited" | "deleted";
  readonly replyMode?: "off" | "suggest";
};
export type ConversationStatusRequest = {
  readonly protocolVersion: 2;
  readonly processingId: string;
};
export type ConversationPublicationReceipt = ConversationStatusRequest & {
  readonly status: "published" | "unknown" | "failed";
  readonly commentId?: string;
  readonly bodyDigest?: string;
};
export type ConversationPublicationClaimRequest = ConversationStatusRequest & {
  readonly status: "dispatching";
  readonly bodyDigest: string;
};
export type ConversationPublicationClaimResult = ConversationStatusRequest & {
  readonly allowed: boolean;
};
export type ConversationProcessResult = ConversationStatusRequest & {
  readonly status:
    | "processing"
    | "ready"
    | "silent"
    | "published"
    | "context_incomplete"
    | "stale"
    | "unavailable"
    | "output_unavailable"
    | "unknown";
  readonly learning: {
    readonly status: string;
    readonly effectIds: readonly string[];
  };
  /** Exact unresolved envelope, purged on terminal publication resolution. */
  readonly reply?: {
    readonly body: string;
    readonly bodyDigest: string;
    readonly marker: string;
    readonly parentCommentId: string;
  };
  readonly publicationCommentId?: string;
};
