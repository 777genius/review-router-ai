import type { HostedV4RelayGrantContract } from "../../domain/hosted-v4-relay-grant";

export type HostedV4RelayDurableStatus = Readonly<{
  logicalTurnKey: string;
  state:
    | "missing"
    | "prepared"
    | "dispatching"
    | "response_started"
    | "succeeded"
    | "failed_no_effect"
    | "failed_classified"
    | "terminal_unknown";
  grantId: string | null;
  requestId: string | null;
  effectId: string | null;
  ordinal: number | null;
  requestHash: string | null;
  acceptedAttestationId: string | null;
}>;

export type HostedV4PreparedRequest = Readonly<{
  /** A restored reservation is recovery data; it never authorizes another send. */
  status: "prepared" | "restored" | "recovery_required";
  grantId: string;
  requestId: string;
  effectId: string;
  ordinal: 1;
  requestHash: string;
}>;

export type HostedV4PreparedRequestInput = Readonly<{
  contract: HostedV4RelayGrantContract;
  grantId: string;
  idempotencyKey: string;
  ordinal: 1;
  body: Uint8Array;
  accountId: string;
  credentialGeneration: bigint;
  ownerIdHash: string;
}>;

export type HostedV4GrantReservation = Readonly<{
  status: "issued" | "restored" | "recovery_required";
  grantId: string;
}>;

export type HostedV4GrantReservationInput = Readonly<{
  contract: HostedV4RelayGrantContract;
  capabilityTokenHash: string;
  accountId: string;
  credentialGeneration: bigint;
  runtimeConfigVersion: number;
}>;

/** Persistence only. These checks do not resolve live authorization or leases. */
export interface HostedV4RelayTurnPort {
  reserveGrant(
    input: HostedV4GrantReservationInput,
  ): Promise<HostedV4GrantReservation>;
  reservePreparedRequest(
    input: HostedV4PreparedRequestInput,
  ): Promise<HostedV4PreparedRequest>;
  reserve(contract: HostedV4RelayGrantContract): Promise<void>;
  assertOpen(contract: HostedV4RelayGrantContract): Promise<void>;
  markTerminalUnknown(logicalTurnKey: string, at: Date): Promise<void>;
  /** Classify only an expired effect that never entered dispatching. */
  reconcileExpiredPrepared(
    logicalTurnKey: string,
  ): Promise<"failed_no_effect" | "recovery_required">;
  readStatus(logicalTurnKey: string): Promise<HostedV4RelayDurableStatus>;
}

export type HostedV4DispatchLease = Readonly<{
  contract: HostedV4RelayGrantContract;
  prepared: HostedV4PreparedRequest;
  accountId: string;
  credentialGeneration: bigint;
  ownerIdHash: string;
  fenceEpoch: 1n;
  idempotencyKey: string;
}>;

/** Separate V4 authority: legacy effect adapters must continue rejecting V4. */
export interface HostedV4RelayDispatchPort {
  assertCurrentGrant(
    contract: HostedV4RelayGrantContract,
    input: {
      grantId: string;
      accountId: string;
      credentialGeneration: bigint;
    },
  ): Promise<void>;
  beginDispatch(lease: HostedV4DispatchLease): Promise<void>;
  heartbeatDispatch(lease: HostedV4DispatchLease): Promise<void>;
  markDispatchResponseStarted(lease: HostedV4DispatchLease): Promise<void>;
  completeDispatchResponse(
    input: HostedV4DispatchLease & {
      responseBytes: number;
      responseHash: string;
      terminalEvidenceHash: string;
    },
  ): Promise<void>;
}
