import type {
  ScopedBindingFence,
  WorkspaceAccountBinding,
} from "../../domain/provider-account";

/** Trusted gateway boundary: "applied" means a durable fence receipt for these
 * exact fields, never HTTP success, local denial or native closure proof.
 * Implementations bound their own I/O and perform no inference, epoch change,
 * occupancy release or allowance reset. SDK/HTTP construction and authenticated
 * response validation belong to later server composition.
 */
export type BindingFenceResponse =
  | {
      readonly state: "applied";
      readonly operationId: string;
      readonly policySubject: string;
      readonly policyRevision: number;
    }
  | { readonly state: "pending" | "unknown" | "rejected" | "not_found" };

export interface WorkspaceBindingFenceDeliveryPort {
  submitFence(intent: ScopedBindingFence): Promise<BindingFenceResponse>;
  readFenceOperation(intent: ScopedBindingFence): Promise<BindingFenceResponse>;
}

export interface WorkspaceBindingFenceRepositoryPort {
  listPendingBindingFences(input: {
    readonly limit: number;
    readonly afterBindingId?: string;
    readonly bindingIds?: readonly string[];
  }): Promise<readonly WorkspaceAccountBinding[]>;
  /** Exact pending-intent CAS only. A stale ACK returns false and cannot clear a
   * replacement. This is trusted bookkeeping, not an authorization grant. */
  acknowledgeBindingFence(intent: ScopedBindingFence): Promise<boolean>;
}

/** Separate delete-consumer capability: a fence ACK does not attest native
 * transport closure. The server reconstructs the complete cohort from this
 * original fence operation; callers cannot choose executions or requests.
 */
export type BindingClosureResponse = {
  readonly operationRef: string;
  readonly policySubject: string;
  readonly policyRevision: number;
  readonly state: "pending" | "completed";
  readonly closed: boolean;
  readonly counts: {
    readonly retainedExecutions: number;
    readonly openExecutions: number;
    readonly requests: number;
    readonly occupiedTransports: number;
    readonly acknowledgedNativeTransports: number;
    readonly positiveKernelNonEntryRequests: number;
    readonly unknownEffects: number;
  };
};
export interface WorkspaceBindingClosureDeliveryPort {
  readPolicyClosure(
    intent: ScopedBindingFence,
  ): Promise<BindingClosureResponse>;
}
