import type {
  WorkspaceDeletionLifecyclePort,
  WorkspaceDeletionLifecycleReadback,
  WorkspaceDeletionRetirementCounts,
} from "../../application/ports/workspace-deletion-lifecycle-port";
import { ProviderAccountError } from "../../domain/provider-account";

/** Structural subset of the reviewed normal SDK, not a transport implementation.
 * Composition must supply its authenticated, contract-validating management or
 * consumer-control client and the server-derived owner. No browser credentials.
 */
export interface WorkspaceDeletionGatewayControl {
  get(accountRef: string): Promise<{
    readonly accountRef: string;
    readonly ownerRef: string;
    readonly profileId: string;
    readonly metadataRevision: number;
    readonly authorizationEpoch: number;
  }>;
  disable(
    accountRef: string,
    intent: {
      readonly operationId: string;
      readonly expectedMetadataRevision: number;
    },
  ): Promise<unknown>;
  retirement(
    accountRef: string,
    disableOperationId: string,
  ): Promise<{
    readonly operationRef: string;
    readonly account: {
      readonly accountRef: string;
      readonly ownerRef: string;
      readonly profileId: string;
      readonly state: string;
      readonly metadataRevision: number;
      readonly authorizationEpoch: number;
    };
    readonly state: "pending" | "rejected" | "completed";
    readonly fence: {
      readonly metadataRevision: number;
      readonly authorizationEpoch: number;
    };
    readonly inert: boolean;
    readonly counts: {
      readonly retainedGenerations: number;
      readonly settledNativeErasureGenerations: number;
      readonly retainedExecutions: number;
      readonly openExecutions: number;
      readonly requests: number;
      readonly occupiedTransports: number;
      readonly acknowledgedNativeTransports: number;
      readonly positiveKernelNonEntryRequests: number;
      readonly unknownEffects: number;
    };
  }>;
}

type Binding = {
  readonly client: WorkspaceDeletionGatewayControl;
  readonly ownerRef: string;
};
export class GatewayWorkspaceDeletionLifecycle implements WorkspaceDeletionLifecyclePort {
  constructor(
    private readonly controlForTarget: (input: {
      readonly workspaceId: string;
      readonly owner: import("../../domain/provider-account").ConnectionOwner;
    }) => Promise<Binding>,
  ) {}

  async readAccount(
    input: Parameters<WorkspaceDeletionLifecyclePort["readAccount"]>[0],
  ) {
    const bound = await this.controlForTarget({
        workspaceId: input.workspaceId,
        owner: { ...input.target.owner },
      }),
      account = await bound.client.get(input.target.gatewayAccountRef);
    if (
      account.accountRef !== input.target.gatewayAccountRef ||
      account.ownerRef !== bound.ownerRef ||
      account.profileId !== input.target.profileRef ||
      !Number.isSafeInteger(account.metadataRevision) ||
      account.metadataRevision < 0 ||
      !Number.isSafeInteger(account.authorizationEpoch) ||
      account.authorizationEpoch < 0
    )
      throw new ProviderAccountError("connection_unavailable");
    return {
      connectionId: input.target.connectionId,
      gatewayAccountRef: account.accountRef,
      profileRef: account.profileId,
      metadataRevision: account.metadataRevision,
      authorizationEpoch: account.authorizationEpoch,
    };
  }

  async submitAndRead(
    input: Parameters<WorkspaceDeletionLifecyclePort["submitAndRead"]>[0],
  ): Promise<WorkspaceDeletionLifecycleReadback> {
    const dispatch = input.dispatchTarget;
    if (dispatch) {
      const saved = input.targets.find(
        (t) => t.connectionId === dispatch.connectionId,
      );
      if (
        !saved ||
        JSON.stringify(saved) !== JSON.stringify(dispatch) ||
        !dispatch.disableIssued ||
        dispatch.disableExpectedGatewayRevision === null
      )
        throw new ProviderAccountError("operation_conflict");
      // One newly reserved immutable intent, never reissued after unknown. The
      // RR mirror version is absent: this CAS came from authoritative SDK get.
      const bound = await this.controlForTarget({
        workspaceId: input.workspaceId,
        owner: { ...dispatch.owner },
      });
      try {
        await bound.client.disable(dispatch.gatewayAccountRef, {
          operationId: dispatch.disableOperationId,
          expectedMetadataRevision: dispatch.disableExpectedGatewayRevision,
        });
      } catch {
        /* Reconcile only by the original retirement GET below. */
      }
    }
    const targets = [];
    for (const target of input.targets) {
      const bound = await this.controlForTarget({
        workspaceId: input.workspaceId,
        owner: { ...target.owner },
      });
      let read;
      try {
        read = target.disableIssued
          ? await bound.client.retirement(
              target.gatewayAccountRef,
              target.disableOperationId,
            )
          : null;
      } catch {
        read = null;
      }
      if (!read) {
        targets.push({
          connectionId: target.connectionId,
          gatewayAccountRef: target.gatewayAccountRef,
          profileRef: target.profileRef,
          disableOperationId: target.disableOperationId,
          state: "pending" as const,
          fenceMetadataRevision: null,
          fenceAuthorizationEpoch: null,
          inert: false,
          counts: null,
        });
        continue;
      }
      const matches =
        read.operationRef === target.disableOperationId &&
        read.account.accountRef === target.gatewayAccountRef &&
        read.account.ownerRef === bound.ownerRef &&
        read.account.profileId === target.profileRef;
      const counts: WorkspaceDeletionRetirementCounts = {
        generations: read.counts.retainedGenerations,
        erasedGenerations: read.counts.settledNativeErasureGenerations,
        executions: read.counts.retainedExecutions,
        openExecutions: read.counts.openExecutions,
        requests: read.counts.requests,
        occupiedTransports: read.counts.occupiedTransports,
        acknowledgedTransports: read.counts.acknowledgedNativeTransports,
        nonEntryRequests: read.counts.positiveKernelNonEntryRequests,
        unknownEffects: read.counts.unknownEffects,
      };
      const completedAccount =
        read.state !== "completed" ||
        (read.account.state === "disabled" &&
          read.account.metadataRevision === read.fence.metadataRevision &&
          read.account.authorizationEpoch === read.fence.authorizationEpoch);
      targets.push({
        connectionId: target.connectionId,
        gatewayAccountRef: target.gatewayAccountRef,
        profileRef: target.profileRef,
        disableOperationId: target.disableOperationId,
        state: matches && completedAccount ? read.state : ("rejected" as const),
        fenceMetadataRevision: matches ? read.fence.metadataRevision : null,
        fenceAuthorizationEpoch: matches ? read.fence.authorizationEpoch : null,
        inert: matches && completedAccount && read.inert,
        counts: matches ? counts : null,
      });
    }
    return {
      operationId: input.operationId,
      workspaceId: input.workspaceId,
      expectedWorkspaceRevision: input.expectedWorkspaceRevision,
      targets,
      state: targets.some((t) => t.state === "rejected")
        ? "rejected"
        : targets.every((t) => t.state === "completed")
          ? "completed"
          : "pending",
    };
  }
}

/** Reuses the same trusted per-fence control binding as ordinary fence delivery.
 * Only the stored operation ID is sent; no caller-selected cohort or account.
 */
export function createGatewayBindingClosureDelivery(
  controlForFence: (
    intent: import("../../domain/provider-account").ScopedBindingFence,
  ) => Promise<{
    policyClosure(
      operationRef: string,
    ): Promise<
      import("../../application/ports/workspace-binding-fence-port").BindingClosureResponse
    >;
  }>,
): import("../../application/ports/workspace-binding-fence-port").WorkspaceBindingClosureDeliveryPort {
  return {
    async readPolicyClosure(intent) {
      const client = await controlForFence(intent);
      return client.policyClosure(intent.operationId);
    },
  };
}
