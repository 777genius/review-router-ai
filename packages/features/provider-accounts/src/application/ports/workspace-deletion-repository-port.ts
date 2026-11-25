import type { ScopedBindingFence } from "../../domain/provider-account";
import type { BindingClosureResponse } from "./workspace-binding-fence-port";
import type { WorkspaceAccountActor } from "../use-cases/workspace-account-bindings";
import type {
  WorkspaceDeletionLifecycleReadback,
  WorkspaceDeletionLifecycleTarget,
  WorkspaceDeletionGatewayAccount,
} from "./workspace-deletion-lifecycle-port";

export type WorkspaceDeletionStage =
  | "delete_pending"
  | "fences_pending"
  | "execution_closure_pending"
  | "erase_pending"
  | "finalize_pending"
  | "deleted"
  | "refused";

export type WorkspaceDeletionOperationView = {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedWorkspaceRevision: number;
  readonly currentWorkspaceRevision: number;
  readonly intentHash: string;
  readonly actorRef: string;
  readonly stage: WorkspaceDeletionStage;
  readonly stageReason:
    | "delete_pending"
    | "fence_ack_pending"
    | "execution_closure_pending"
    | "material_erasure_pending"
    | "finalize_pending"
    | "deleted"
    | "gateway_rejected"
    | "invalid_lifecycle_readback";
  readonly targets: readonly WorkspaceDeletionLifecycleTarget[];
  readonly affectedBindingIds: readonly string[];
  /** Complete locked DB count over the operation's affected binding set. */
  readonly pendingFenceCount: number;
  /** Borrowed-use closure needs authoritative policy-scope evidence, not owner erase. */
  readonly pendingPolicyClosureCount: number;
  readonly policyFenceTargets: readonly ScopedBindingFence[];
  /** Enrollment may have entered remotely before a local source row exists. */
  readonly pendingPersonalOperationCount: number;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
};

export interface WorkspaceDeletionRepositoryPort {
  beginWorkspaceDeletion(input: {
    readonly actorRef: string;
    readonly operatorActor: WorkspaceAccountActor;
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
  }): Promise<WorkspaceDeletionOperationView>;
  readWorkspaceDeletion(input: {
    readonly operatorActor: WorkspaceAccountActor;
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision?: number;
  }): Promise<WorkspaceDeletionOperationView>;
  reserveDisable(input: {
    readonly operatorActor: WorkspaceAccountActor;
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
    readonly account: WorkspaceDeletionGatewayAccount;
  }): Promise<{
    readonly operation: WorkspaceDeletionOperationView;
    readonly dispatchTarget: WorkspaceDeletionLifecycleTarget | null;
  }>;
  recordPolicyClosure(input: {
    readonly operatorActor: WorkspaceAccountActor;
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
    readonly intent: ScopedBindingFence;
    readonly readback: BindingClosureResponse;
  }): Promise<WorkspaceDeletionOperationView>;
  recordLifecycleReadback(input: {
    readonly operatorActor: WorkspaceAccountActor;
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
    readonly readback: WorkspaceDeletionLifecycleReadback;
  }): Promise<WorkspaceDeletionOperationView>;
  finalizeWorkspaceDeletion(input: {
    readonly operatorActor: WorkspaceAccountActor;
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
    readonly readback: WorkspaceDeletionLifecycleReadback;
  }): Promise<WorkspaceDeletionOperationView>;
}
