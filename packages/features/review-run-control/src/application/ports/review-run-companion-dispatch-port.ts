import type { ReviewRunAuthorization } from "../../domain/review-run-authorization";
import type {
  ReviewModelDispatchSettlementV2,
  ReviewModelDispatchTerminalReceiptV2,
} from "@reviewrouter/shared";

export type ReviewRunCompanionRole =
  | "finding_discovery"
  | "lifecycle_verification"
  | "pr_description";
export type ReviewRunCompanionDispatchState =
  | "dispatch_may_have_started"
  | "effect_unknown"
  | "completed"
  | "not_dispatched";

/** Safe durable facts only; neither request/response bytes nor capabilities. */
export type ReviewRunCompanionDispatch = Readonly<{
  authorizationId: string;
  dispatchId: string;
  executionId: string;
  workSlotId: string;
  attemptOrdinal: number;
  leaseId: string;
  fencingToken: bigint;
  preparedManifestKey: string;
  providerRequestEnvelopeHash: string;
  nativeRequestRef: string;
  role: ReviewRunCompanionRole;
  state: ReviewRunCompanionDispatchState;
  /** Absent on historical V1 readbacks. */
  dispatchVersion?: 2;
  requestOrdinal?: number;
  routeIdentityHash?: string;
  requestBytes?: number;
  maxOutputTokens?: number;
  terminalReceipt?: ReviewModelDispatchTerminalReceiptV2 | null;
}>;

export type ReviewRunCompanionDispatchClaim = Omit<
  ReviewRunCompanionDispatch,
  "role" | "state" | "nativeRequestRef" | "terminalReceipt"
> &
  Readonly<{
    runtimeSnapshotCanonicalJson: string;
    leaseCapabilityId: string;
    ownerIdHash: string;
    providerInvocationKey: string;
    ownershipExpiresAt: Date;
    capabilityMutationEpoch: bigint;
    capabilityReviewRevisionHash: string;
    capabilityScopeHash: string;
    /** Server-owned native forwarding, never accepted from an HTTP body. */
    forwardExisting?: true;
  }>;

export class ReviewRunCompanionDispatchFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface ReviewRunCompanionDispatchRepository {
  /** Serializes on the original authorization, derives role from the stored
   * slot, checks current lease/plan/phase, then reserves before any SDK call. */
  claim(input: ReviewRunCompanionDispatchClaim): Promise<
    Readonly<{
      status: "claimed" | "restored";
      dispatch: ReviewRunCompanionDispatch;
      notAfter: Date;
      /** Newly claimed V2 only; never stored or returned by claim readback. */
      receiptToken?: string;
    }>
  >;
  read(
    authorizationId: string,
    dispatchId: string,
  ): Promise<ReviewRunCompanionDispatch | null>;
  /** Terminal native proof wins over later delivery failures; no transition
   * ever deletes a reservation or restores an attempt allowance. */
  settle(
    authorizationId: string,
    dispatchId: string,
    state: Exclude<
      ReviewRunCompanionDispatchState,
      "dispatch_may_have_started"
    >,
  ): Promise<void>;
  readReceipt(
    dispatchId: string,
    receiptToken: string,
  ): Promise<ReviewRunCompanionDispatch | null>;
  settleReceipt(
    dispatchId: string,
    receiptToken: string,
    settlement: ReviewModelDispatchSettlementV2,
  ): Promise<ReviewRunCompanionDispatch>;
}

/** HTTP-facing consumer contract. Capability verification belongs to its
 * composition adapter; repository receives only verified, bounded facts. */
export interface ReviewRunCompanionDispatchAdmission {
  claim(
    authorization: ReviewRunAuthorization,
    context: Readonly<{
      dispatchId: string;
      executionId: string;
      workSlotId: string;
      attemptOrdinal: number;
      leaseId: string;
      leaseCapability: string;
      fencingToken: string;
      preparedManifestKey: string;
      dispatchVersion?: 2;
      requestOrdinal?: number;
      routeIdentityHash?: string;
      requestBytes?: number;
      maxOutputTokens?: number;
    }>,
    providerRequestEnvelopeHash: string,
  ): ReturnType<ReviewRunCompanionDispatchRepository["claim"]>;
  read: ReviewRunCompanionDispatchRepository["read"];
  settle: ReviewRunCompanionDispatchRepository["settle"];
}

export interface ReviewRunModelDispatchAdmission extends ReviewRunCompanionDispatchAdmission {
  forward: ReviewRunCompanionDispatchAdmission["claim"];
  readReceipt: ReviewRunCompanionDispatchRepository["readReceipt"];
  settleReceipt: ReviewRunCompanionDispatchRepository["settleReceipt"];
}
