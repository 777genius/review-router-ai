export type Digest = string;
export type NumericId = string;
export type Instant = number;

export type AuthorityRef = Readonly<{
  tenantId: string;
  repositoryId: string;
  pullRequest: number;
  receiptFence: bigint;
  authorityEpoch: bigint;
  receiptDigest: Digest;
}>;

export type CheckSpec = Readonly<{
  repositoryId: NumericId;
  installationId: NumericId;
  appId: NumericId;
  repositoryFullName: string;
  headSha: string;
  name: "ReviewRouter / SDK growth authority";
  externalId: string;
  conclusion: "success" | "failure";
  output: Readonly<{ title: string; summary: string }>;
}>;

export type PublicationSeed = Readonly<{
  contractVersion: 1;
  intentId: string;
  envelopeDigest: Digest;
  authority: AuthorityRef;
  check: CheckSpec;
  createdAt: Instant;
}>;

export type DeliveryClaim = Readonly<{
  eventId: string;
  claimId: string;
  claimVersion: bigint;
  claimOwnerHash: string;
}>;

export type StaleAuthorityReason =
  | "expired"
  | "revoked"
  | "fenced"
  | "epoch-changed"
  | "binding-changed"
  | "installation-inactive"
  | "verifier-withdrawn";

export type AuthorityValidity =
  | Readonly<{ kind: "current" }>
  | Readonly<{ kind: "stale"; reason: StaleAuthorityReason }>
  | Readonly<{ kind: "unavailable" }>;

export type Observation =
  | Readonly<{
      kind: "exact";
      checkRunId: NumericId;
      observedDigest: Digest;
      at: Instant;
    }>
  | Readonly<{ kind: "absent"; at: Instant }>
  | Readonly<{
      kind: "unknown";
      reason:
        | "transport"
        | "partial-read"
        | "malformed-response"
        | "unavailable";
      at: Instant;
    }>
  | Readonly<{
      kind: "conflict";
      reason:
        | "duplicate"
        | "identity-mismatch"
        | "output-mismatch"
        | "unexpected-effect";
      witnessIds: readonly NumericId[];
      evidenceDigest: Digest;
      at: Instant;
    }>;

export type Evidence =
  | Observation
  | Readonly<{
      kind: "no-effect";
      reason: "local-pre-dispatch" | "provider-rejected";
      evidenceDigest: Digest;
      at: Instant;
    }>
  | Readonly<{
      kind: "not-started";
      reason: StaleAuthorityReason;
      at: Instant;
    }>;

export type Terminal =
  | "applied"
  | "not-applied"
  | "superseded"
  | "recovery-required";
export type EffectState = "ready" | "sending" | "reconcile-required" | Terminal;

export type EffectView = Readonly<{
  seed: PublicationSeed;
  state: EffectState;
  attempt: Readonly<{
    id: string;
    startedAt: Instant;
    reconciliationCount: number;
  }> | null;
  lastObservation: Evidence | null;
}>;

export type EffectChange =
  | Readonly<{ kind: "start"; attemptId: string }>
  | Readonly<{
      kind: "reconcile";
      attemptId: string;
      reconciliationCount: number;
      observation: Observation;
    }>
  | Readonly<{
      kind: "finish";
      attemptId: string | null;
      reconciliationCount: number;
      outcome: Terminal;
      evidence: Evidence;
    }>;

export interface PublicationHandoffStore {
  load(intentId: string): Promise<PublicationSeed | null>;
  listUnqueued(limit: number): Promise<readonly PublicationSeed[]>;
  link(
    intentId: string,
    envelopeDigest: Digest,
    eventId: string,
  ): Promise<"linked" | "already-linked" | "conflict">;
}

export interface PublicationEffectStore {
  withClaim<T>(
    intentId: string,
    claim: DeliveryClaim,
    decide: (
      effect: EffectView,
      authority: AuthorityValidity,
      databaseNow: Instant,
    ) => Readonly<{ change: EffectChange | null; value: T }>,
  ): Promise<
    | Readonly<{ kind: "committed"; value: T }>
    | Readonly<{ kind: "stale-claim" | "missing" }>
  >;
  /** Hold the current-authority and delivery-claim database fences until the
   * one provider mutation call has settled. No replacement epoch can commit
   * while this callback is allowed to begin the mutation. */
  withMutationPermit<T>(
    intentId: string,
    claim: DeliveryClaim,
    attemptId: string,
    mutate: () => Promise<T>,
  ): Promise<
    | Readonly<{ kind: "committed"; value: T }>
    | Readonly<{ kind: "stale-claim" | "missing" | "not-current" }>
  >;
}

export type PostResult =
  | Readonly<{ kind: "acknowledged"; checkRunId: NumericId }>
  | Extract<Evidence, { kind: "no-effect" | "unknown" }>;

export interface PublicationCheckGateway {
  inspect(spec: CheckSpec, signal: AbortSignal): Promise<Observation>;
  create(
    spec: CheckSpec,
    attemptId: string,
    signal: AbortSignal,
  ): Promise<PostResult>;
}
