import type { ConnectionOwner } from "../../domain/provider-account";
/** Consumer-owned projection of the authoritative complete-set Gateway
 * retirement readback. Counts cover every retained generation/request for the
 * logical account, never caller-selected native IDs or fabricated proof refs.
 */
export type WorkspaceDeletionRetirementCounts = {
  readonly generations: number;
  readonly erasedGenerations: number;
  readonly executions: number;
  readonly openExecutions: number;
  readonly requests: number;
  readonly occupiedTransports: number;
  readonly acknowledgedTransports: number;
  readonly nonEntryRequests: number;
  readonly unknownEffects: number;
};

export type WorkspaceDeletionLifecycleTarget = {
  readonly connectionId: string;
  readonly owner: ConnectionOwner;
  readonly gatewayAccountRef: string;
  readonly profileRef: string | null;
  /** RR mirror CAS version, never a Gateway expectedMetadataRevision. */
  readonly expectedMetadataRevision: number;
  readonly expectedAuthorizationEpoch: number | null;
  readonly bindingIds: readonly string[];
  readonly disableOperationId: string;
  readonly disableExpectedGatewayRevision: number | null;
  readonly disableExpectedGatewayEpoch: number | null;
  readonly disableIssued: boolean;
};

export type WorkspaceDeletionAccountRetirement = {
  readonly connectionId: string;
  readonly gatewayAccountRef: string;
  readonly profileRef: string | null;
  /** Stable normal disable operation, persisted before any remote await. */
  readonly disableOperationId: string;
  readonly state: "pending" | "rejected" | "completed";
  readonly fenceMetadataRevision: number | null;
  readonly fenceAuthorizationEpoch: number | null;
  readonly inert: boolean;
  readonly counts: WorkspaceDeletionRetirementCounts | null;
};

export type WorkspaceDeletionLifecycleReadback = {
  readonly state: "pending" | "rejected" | "completed";
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedWorkspaceRevision: number;
  readonly targets: readonly WorkspaceDeletionAccountRetirement[];
};

export type WorkspaceDeletionGatewayAccount = {
  readonly connectionId: string;
  readonly gatewayAccountRef: string;
  readonly profileRef: string;
  readonly metadataRevision: number;
  readonly authorizationEpoch: number;
};
export interface WorkspaceDeletionLifecyclePort {
  readAccount(input: {
    readonly workspaceId: string;
    readonly target: WorkspaceDeletionLifecycleTarget;
  }): Promise<WorkspaceDeletionGatewayAccount>;
  /** Normal disable acknowledges only the fence. Completion requires the
   * separately authenticated retirement readback for that exact operation.
   * Unknown submit outcomes must be reconciled, never replayed under a new ID.
   */
  submitAndRead(input: {
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
    readonly targets: readonly WorkspaceDeletionLifecycleTarget[];
    /** Only the single newly reserved immutable intent may send a POST. */
    readonly dispatchTarget: WorkspaceDeletionLifecycleTarget | null;
  }): Promise<WorkspaceDeletionLifecycleReadback>;
}
