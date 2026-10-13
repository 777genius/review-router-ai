import { createHash } from "node:crypto";
import {
  ProviderAccountError,
  assertOpaqueReference,
} from "../../domain/provider-account";
import {
  assertWorkspaceAdminAllowed,
  type WorkspaceAccessRepositoryPort,
} from "@reviewrouter/features-auth";
import type {
  WorkspaceBindingFenceDeliveryPort,
  WorkspaceBindingClosureDeliveryPort,
  WorkspaceBindingFenceRepositoryPort,
} from "../ports/workspace-binding-fence-port";
import type {
  WorkspaceDeletionLifecyclePort,
  WorkspaceDeletionLifecycleReadback,
  WorkspaceDeletionLifecycleTarget,
} from "../ports/workspace-deletion-lifecycle-port";
import type {
  WorkspaceDeletionOperationView,
  WorkspaceDeletionRepositoryPort,
} from "../ports/workspace-deletion-repository-port";
import { reconcileWorkspaceBindingFences } from "./reconcile-workspace-binding-fences";
import type { WorkspaceAccountActor } from "./workspace-account-bindings";

export type WorkspaceAccountDeletionDependencies = {
  readonly deletion: WorkspaceDeletionRepositoryPort;
  readonly fences: WorkspaceBindingFenceRepositoryPort;
  readonly fenceDelivery: WorkspaceBindingFenceDeliveryPort;
  readonly lifecycle: WorkspaceDeletionLifecyclePort;
  readonly closures: WorkspaceBindingClosureDeliveryPort;
  readonly workspaceAccess: WorkspaceAccessRepositoryPort;
  readonly operatorWorkspaceId: string;
};

function snapshotRequest(input: {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedWorkspaceRevision: number;
  readonly actor: WorkspaceAccountActor;
}) {
  return {
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    expectedWorkspaceRevision: input.expectedWorkspaceRevision,
    actor: {
      userId: input.actor.userId,
      githubUserId: input.actor.githubUserId,
      githubLogin: input.actor.githubLogin,
    },
  };
}

function intentHash(input: {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedWorkspaceRevision: number;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        operationId: input.operationId,
        workspaceId: input.workspaceId,
        expectedWorkspaceRevision: input.expectedWorkspaceRevision,
      }),
    )
    .digest("hex");
}

async function assertOperator(
  actor: WorkspaceAccountActor,
  dependencies: WorkspaceAccountDeletionDependencies,
): Promise<void> {
  assertOpaqueReference(dependencies.operatorWorkspaceId);
  if (actor.userId !== undefined) assertOpaqueReference(actor.userId);
  if (
    typeof actor.githubUserId !== "string" ||
    typeof actor.githubLogin !== "string" ||
    (actor.userId === undefined && !/^[0-9]+$/.test(actor.githubUserId))
  )
    throw new ProviderAccountError("invalid_input");
  try {
    await assertWorkspaceAdminAllowed(
      {
        workspaceId: dependencies.operatorWorkspaceId,
        userId: actor.userId,
        githubUserId: actor.githubUserId,
        githubLogin: actor.githubLogin,
      },
      { workspaceAccess: dependencies.workspaceAccess },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("workspace_admin_forbidden:")
    )
      throw new ProviderAccountError("workspace_forbidden");
    throw error;
  }
}

export function assertWorkspaceDeletionLifecycleCompleted(
  readback: WorkspaceDeletionLifecycleReadback,
  operation: WorkspaceDeletionOperationView,
): void {
  if (
    readback.operationId !== operation.operationId ||
    readback.workspaceId !== operation.workspaceId ||
    readback.expectedWorkspaceRevision !== operation.currentWorkspaceRevision ||
    readback.state !== "completed"
  )
    throw new ProviderAccountError("connection_unavailable");
  const expected = new Map(
    operation.targets.map((target) => [target.connectionId, target]),
  );
  const seen = new Set<string>();
  if (
    expected.size !== operation.targets.length ||
    readback.targets.length !== expected.size
  )
    throw new ProviderAccountError("connection_unavailable");
  for (const target of readback.targets) {
    const mapped = expected.get(target.connectionId),
      counts = target.counts;
    if (
      !mapped ||
      seen.has(target.connectionId) ||
      target.gatewayAccountRef !== mapped.gatewayAccountRef ||
      target.profileRef !== mapped.profileRef ||
      target.state !== "completed" ||
      !target.inert ||
      target.disableOperationId !== mapped.disableOperationId ||
      !mapped.disableIssued ||
      mapped.disableExpectedGatewayRevision === null ||
      mapped.disableExpectedGatewayEpoch === null ||
      target.fenceMetadataRevision !==
        mapped.disableExpectedGatewayRevision + 1 ||
      target.fenceAuthorizationEpoch !==
        mapped.disableExpectedGatewayEpoch + 1 ||
      target.fenceMetadataRevision === null ||
      !Number.isSafeInteger(target.fenceMetadataRevision) ||
      target.fenceMetadataRevision < 1 ||
      target.fenceAuthorizationEpoch === null ||
      !Number.isSafeInteger(target.fenceAuthorizationEpoch) ||
      target.fenceAuthorizationEpoch < 1 ||
      !counts ||
      [
        counts.generations,
        counts.erasedGenerations,
        counts.executions,
        counts.openExecutions,
        counts.requests,
        counts.occupiedTransports,
        counts.acknowledgedTransports,
        counts.nonEntryRequests,
        counts.unknownEffects,
      ].some((value) => !Number.isSafeInteger(value) || value < 0) ||
      counts.generations < 1 ||
      counts.erasedGenerations !== counts.generations ||
      counts.openExecutions !== 0 ||
      counts.occupiedTransports !== 0 ||
      counts.acknowledgedTransports + counts.nonEntryRequests !==
        counts.requests ||
      counts.unknownEffects > counts.requests
    )
      throw new ProviderAccountError("connection_unavailable");
    seen.add(target.connectionId);
  }
  // Closed UNKNOWN effects are immutable audit, not transport occupancy.
}

/** One bounded authenticated operator command. A retry reads the same immutable
 * operation and never re-enrolls, restores, or creates a synthetic erase actor.
 */
export async function beginWorkspaceAccountDeletion(
  request: {
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
    readonly actor: WorkspaceAccountActor;
  },
  dependencies: WorkspaceAccountDeletionDependencies,
): Promise<WorkspaceDeletionOperationView> {
  const input = snapshotRequest(request);
  for (const ref of [input.operationId, input.workspaceId])
    assertOpaqueReference(ref);
  if (
    !Number.isInteger(input.expectedWorkspaceRevision) ||
    input.expectedWorkspaceRevision < 1
  )
    throw new ProviderAccountError("invalid_input");
  await assertOperator(input.actor, dependencies);
  return dependencies.deletion.beginWorkspaceDeletion({
    operatorActor: input.actor,
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    expectedWorkspaceRevision: input.expectedWorkspaceRevision,
    actorRef: input.actor.userId ?? `github:${input.actor.githubUserId}`,
  });
}

/** Advance one bounded stage. The caller repeats this command after a pending
 * result; there is no scheduler, inference retry, refund, or infinite wait.
 */
export async function advanceWorkspaceAccountDeletion(
  request: {
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision: number;
    readonly actor: WorkspaceAccountActor;
  },
  dependencies: WorkspaceAccountDeletionDependencies,
): Promise<WorkspaceDeletionOperationView> {
  const input = snapshotRequest(request);
  for (const ref of [input.operationId, input.workspaceId])
    assertOpaqueReference(ref);
  await assertOperator(input.actor, dependencies);
  let operation = await dependencies.deletion.readWorkspaceDeletion({
    operatorActor: input.actor,
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    expectedWorkspaceRevision: input.expectedWorkspaceRevision,
  });
  if (operation.stage === "deleted" || operation.stage === "refused")
    return operation;
  // Deliver one bounded page. The repository's complete pending count, not the
  // page length, gates lifecycle/erasure; subsequent calls visit remaining rows.
  await reconcileWorkspaceBindingFences(
    { limit: 100, bindingIds: operation.affectedBindingIds },
    { accounts: dependencies.fences, delivery: dependencies.fenceDelivery },
  );
  operation = await dependencies.deletion.readWorkspaceDeletion({
    operatorActor: input.actor,
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    expectedWorkspaceRevision: operation.currentWorkspaceRevision,
  });
  if (
    operation.pendingFenceCount !== 0 ||
    operation.pendingPersonalOperationCount !== 0
  )
    return operation;
  // Every affected use must close before any owner erasure, including borrowed
  // accounts. Each GET is scoped to the original persisted policy fence.
  for (const intent of operation.policyFenceTargets.slice(0, 100)) {
    let closure;
    try {
      closure = await dependencies.closures.readPolicyClosure(intent);
    } catch {
      continue; /* Unknown closure stays pending; no ACK fabrication. */
    }
    operation = await dependencies.deletion.recordPolicyClosure({
      operatorActor: input.actor,
      operationId: operation.operationId,
      workspaceId: operation.workspaceId,
      expectedWorkspaceRevision: operation.currentWorkspaceRevision,
      intent,
      readback: closure,
    });
  }
  if (operation.pendingPolicyClosureCount !== 0) return operation;
  let dispatchTarget: WorkspaceDeletionLifecycleTarget | null = null;
  const next = operation.targets.find((target) => !target.disableIssued);
  if (next) {
    const account = await dependencies.lifecycle.readAccount({
      workspaceId: operation.workspaceId,
      target: next,
    });
    const reserved = await dependencies.deletion.reserveDisable({
      operatorActor: input.actor,
      operationId: operation.operationId,
      workspaceId: operation.workspaceId,
      expectedWorkspaceRevision: operation.currentWorkspaceRevision,
      account,
    });
    operation = reserved.operation;
    dispatchTarget = reserved.dispatchTarget;
  }
  const readback = await dependencies.lifecycle.submitAndRead({
    operationId: operation.operationId,
    workspaceId: operation.workspaceId,
    expectedWorkspaceRevision: operation.currentWorkspaceRevision,
    targets: operation.targets,
    dispatchTarget,
  });
  operation = await dependencies.deletion.readWorkspaceDeletion({
    operatorActor: input.actor,
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    expectedWorkspaceRevision: operation.currentWorkspaceRevision,
  });
  operation = await dependencies.deletion.recordLifecycleReadback({
    operatorActor: input.actor,
    operationId: operation.operationId,
    workspaceId: operation.workspaceId,
    expectedWorkspaceRevision: operation.currentWorkspaceRevision,
    readback,
  });
  if (readback.state !== "completed") return operation;
  assertWorkspaceDeletionLifecycleCompleted(readback, operation);
  return dependencies.deletion.finalizeWorkspaceDeletion({
    operatorActor: input.actor,
    operationId: operation.operationId,
    workspaceId: operation.workspaceId,
    expectedWorkspaceRevision: operation.currentWorkspaceRevision,
    readback,
  });
}

export async function readWorkspaceAccountDeletion(
  request: {
    readonly operationId: string;
    readonly workspaceId: string;
    readonly expectedWorkspaceRevision?: number;
    readonly actor: WorkspaceAccountActor;
  },
  dependencies: WorkspaceAccountDeletionDependencies,
): Promise<WorkspaceDeletionOperationView> {
  const input = snapshotRequest({
    operationId: request.operationId,
    workspaceId: request.workspaceId,
    expectedWorkspaceRevision: request.expectedWorkspaceRevision ?? 1,
    actor: request.actor,
  });
  for (const ref of [input.operationId, input.workspaceId])
    assertOpaqueReference(ref);
  await assertOperator(input.actor, dependencies);
  return dependencies.deletion.readWorkspaceDeletion({
    operatorActor: input.actor,
    operationId: input.operationId,
    workspaceId: input.workspaceId,
    ...(request.expectedWorkspaceRevision === undefined
      ? {}
      : { expectedWorkspaceRevision: request.expectedWorkspaceRevision }),
  });
}

export function workspaceDeletionIntentHash(input: {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly expectedWorkspaceRevision: number;
}): string {
  return intentHash(input);
}
