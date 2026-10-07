import type {
  Binding,
  Completion,
  Grant,
  Identity,
  OwnerEvidence,
  PublicationIntent,
  Receipt,
  Request,
} from "../domain/contracts.js";

/** Cooperative per-call monotonic wait budget. assertActive checks local expiry.
 * Neither this check nor AbortSignal cancels or fences a remote commit. */
export interface AuthorityIoBudget {
  readonly signal: AbortSignal;
  assertActive(): void;
}

export interface CurrentAuthoritySnapshot {
  /** Monotonic canonical-authority generation held through decision commit. */
  readonly epoch: number;
  readonly binding: Binding;
  readonly ownerEvidence: OwnerEvidence;
}
export interface CurrentAuthoritySnapshotPort {
  /** Authorize Identity+Request and derive all canonical binding fields independently
   * of candidate input. Authenticate owner evidence through trusted infrastructure.
   * Return a detached pair from ONE current authority version/epoch covering binding,
   * owner approval, replacement and revocation. Fence the entire resolution: if that
   * epoch changes before resolution finishes, reject; never combine independent reads.
   * Use an atomic authority read or a shared version/transaction fence across sources.
   * Missing, unauthorized, closed or unavailable authority returns null or rejects.
   * A snapshot is evidence at resolution, not a lease or permission for a later write. */
  resolve(
    identity: Identity,
    request: Request,
    budget: AuthorityIoBudget,
  ): Promise<CurrentAuthoritySnapshot | null>;
}
export type AuthorityChange =
  | "provision"
  | "binding-replacement"
  | "owner-replacement"
  | "owner-revocation"
  | "installation-invalidation"
  | "verifier-withdrawal";
export interface AuthenticatedOwnerProvenance {
  readonly issuer: string;
  readonly subject: string;
  readonly authenticationId: string;
  readonly installationId: string;
  readonly sourceDigest: string;
  readonly authorizedSubjects: readonly string[];
}
export interface CanonicalAuthorityMaterial {
  readonly binding: Binding;
  readonly ownerEvidence: OwnerEvidence;
  readonly provenance: AuthenticatedOwnerProvenance;
  readonly installationActive: boolean;
  readonly verifierActive: boolean;
}

/** Result of authenticating the server-side owner/operator credential. The
 * credential itself is opaque to SDK growth and none of these values may be
 * copied from a candidate request. */
export interface AuthenticatedAuthorityPrincipal {
  readonly issuer: string;
  readonly subject: string;
  readonly authenticationId: string;
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly githubRepositoryId: string;
  readonly installationId: string;
}

export interface TrustedOwnerApproval {
  readonly version: 1;
  readonly evidenceId: string;
  readonly tenantId: string;
  readonly ownerSubject: string;
  readonly scopes: readonly string[];
  readonly decision: "approved" | "rejected";
  readonly sourceDigest: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
}

/** Complete authority facts loaded from trusted server-side custody. Binding
 * contains source/base/merge-base and every pinned tool, policy and artifact
 * identity. */
export interface TrustedAuthorityRecord {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly pullRequest: number;
  readonly githubRepositoryId: string;
  readonly installationId: string;
  readonly binding: Binding;
  readonly approval: TrustedOwnerApproval;
  /** Immutable authentication provenance captured when the approval was
   * accepted. This is deliberately distinct from the principal authorizing
   * the current lifecycle operation. */
  readonly approvalProvenance: AuthenticatedOwnerProvenance;
  readonly installationActive: boolean;
  readonly verifierActive: boolean;
}

export interface TrustedAuthorityAuthenticatorPort {
  /** Authenticate and authorize the principal performing this operation.
   * A later login/session is expected to differ from approval provenance. */
  authenticate(
    credential: unknown,
    scope: AuthorityScope,
    change: AuthorityChange,
  ): Promise<AuthenticatedAuthorityPrincipal>;
}

export interface TrustedAuthoritySourcePort {
  load(input: {
    readonly principal: AuthenticatedAuthorityPrincipal;
    readonly scope: AuthorityScope;
    readonly change: AuthorityChange;
  }): Promise<TrustedAuthorityRecord | null>;
}
/** Authenticate the operator and owner, then load independently trusted custody.
 * Candidate request JSON must never be returned as canonical material. */
export interface TrustedAuthorityIngestion {
  authenticateAndLoad(
    credential: unknown,
    scope: AuthorityScope,
    change: AuthorityChange,
  ): Promise<CanonicalAuthorityMaterial>;
}
export interface ClockPort {
  now(): number;
}
export interface PublicationIntentPort {
  /** Idempotently enqueue metadata by intentId in the existing publication/outbox infrastructure.
   * This is NOT permission to publish: the eventual adapter must recheck current authority.
   * MUST deduplicate by intentId, including overlapping retries and late commits.
   * Timeout releases the caller with effect="unknown": enqueue may have committed
   * or may commit later despite abort. Retry the same intentId; the core retains
   * the pending intent and does not mark it dispatched after a late completion.
   * The budget enables cooperative cancellation only, not durable commit fencing.
   * Never execute candidate code or publish provider checks from this port. */
  enqueue(intent: PublicationIntent, budget: AuthorityIoBudget): Promise<void>;
}
export interface AuthorityRecord {
  grant: Grant;
  revoked: boolean;
  completion: Completion | null;
  receipt: Receipt | null;
  intent: PublicationIntent | null;
  dispatched: boolean;
}
export interface AuthorityLedger {
  fence: number;
  records: AuthorityRecord[];
}
export interface AuthorityScope {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly pullRequest: number;
}
export type ReceiptSelection = { requestId: string } | { grantId: string };
export interface ReceiptRepositoryPort {
  /** Serializable per scope across ALL subjects and processes; rollback on throw.
   * Reads/writes and the retained pending intent commit atomically. The callback receives
   * a detached mutable draft containing only the selected record (or none);
   * the adapter must not retain caller-owned object aliases.
   * Fence increments must be persisted, never reset or reused. No process-local lock in production.
   * Preserve request/completion tombstones for idempotency; never reuse expired request IDs. */
  transact<T>(
    scope: AuthorityScope,
    selection: ReceiptSelection,
    operation: (ledger: AuthorityLedger) => Promise<T>,
  ): Promise<T>;
}
export interface AuthorityPorts {
  readonly currentAuthority: CurrentAuthoritySnapshotPort;
  readonly receipts: ReceiptRepositoryPort;
  readonly clock: ClockPort;
  readonly publication: PublicationIntentPort;
}
