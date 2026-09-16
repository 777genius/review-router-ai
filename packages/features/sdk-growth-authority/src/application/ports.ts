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

export interface CurrentAuthoritySnapshot {
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
  ): Promise<CurrentAuthoritySnapshot | null>;
}
export interface ClockPort {
  now(): number;
}
export interface PublicationIntentPort {
  /** Idempotently enqueue metadata by intentId in the existing publication/outbox infrastructure.
   * This is NOT permission to publish: the eventual adapter must recheck current authority.
   * Never execute candidate code or publish provider checks from this port. */
  enqueue(intent: PublicationIntent): Promise<void>;
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
export interface ReceiptRepositoryPort {
  /** Serializable per scope across ALL subjects and processes; rollback on throw.
   * Reads/writes and the retained pending intent commit atomically. The callback receives
   * a detached mutable draft; the adapter must not retain caller-owned object aliases.
   * Fence increments must be persisted, never reset or reused. No process-local lock in production.
   * Preserve request/completion tombstones for idempotency; never reuse expired request IDs. */
  transact<T>(
    scope: AuthorityScope,
    operation: (ledger: AuthorityLedger) => Promise<T>,
  ): Promise<T>;
}
export interface AuthorityPorts {
  readonly currentAuthority: CurrentAuthoritySnapshotPort;
  readonly receipts: ReceiptRepositoryPort;
  readonly clock: ClockPort;
  readonly publication: PublicationIntentPort;
}
