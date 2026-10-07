/** These are authority metadata, never source, diff, model output or credentials. */
export interface Identity {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly subject: string;
}
export interface Request {
  readonly version: 1;
  readonly requestId: string;
  readonly repositoryId: string;
  readonly pullRequest: number;
}
/** Every field is resolved by the server from independently trusted custody. */
export interface Binding {
  readonly repositoryId: string;
  readonly pullRequest: number;
  readonly head: string;
  readonly base: string;
  readonly mergeBase: string;
  readonly verifierId: string;
  readonly verifierDigest: string;
  readonly policyDigest: string;
  readonly toolDigest: string;
  readonly artifactDigest: string;
  readonly lockDigest: string;
  readonly historyDigest: string;
  readonly scopeDigest: string;
  readonly scopes: readonly string[];
}
export interface OwnerEvidence {
  readonly version: 1;
  readonly evidenceId: string;
  readonly tenantId: string;
  readonly ownerSubject: string;
  readonly binding: Binding;
  readonly scopes: readonly string[];
  readonly decision: "approved" | "rejected";
  readonly sourceDigest: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
}
export interface Grant {
  readonly version: 1;
  readonly grantId: string;
  readonly identity: Identity;
  readonly request: Request;
  readonly binding: Binding;
  readonly ownerEvidence: OwnerEvidence;
  readonly fence: number;
  /** Monotonic generation observed under the commit lock. Zero is reserved
   * for decoded historical v1 bytes and is never current authority. */
  readonly authorityEpoch: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}
export interface Completion {
  readonly version: 1;
  readonly grantId: string;
  readonly fence: number;
  readonly binding: Binding;
  readonly coveredScopes: readonly string[];
  readonly coverage: "complete" | "partial" | "unavailable";
  readonly outcome: "passed" | "failed";
  readonly reportDigest: string;
}
export interface Receipt {
  readonly version: 1;
  readonly receiptId: string;
  readonly grantId: string;
  readonly identity: Identity;
  readonly binding: Binding;
  readonly fence: number;
  readonly authorityEpoch: number;
  readonly completedAt: number;
  readonly reportDigest: string;
  readonly admitted: boolean;
  readonly reason: "admitted" | "failed" | "incomplete";
}
export interface PublicationIntent {
  readonly version: 1;
  readonly intentId: string;
  readonly receipt: Receipt;
}
export type AuthorityErrorCode =
  | "io-timeout"
  | "invalid-contract"
  | "wrong-identity"
  | "conflict"
  | "not-found"
  | "expired"
  | "revoked"
  | "fenced"
  | "binding-changed"
  | "owner-evidence";
export class AuthorityError extends Error {
  constructor(
    readonly code: AuthorityErrorCode,
    /** Timeout describes the external effect, not remote cancellation. */
    readonly effect?: "none" | "unknown",
  ) {
    super(code);
    this.name = "AuthorityError";
  }
}
