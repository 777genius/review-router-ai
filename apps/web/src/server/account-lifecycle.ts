import { z } from "zod";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import {
  beginAccountLifecycle,
  submitAccountLifecycle,
  readAccountLifecycle,
  type AccountLifecycleDependencies,
  type AccountLifecycleReceipt,
} from "@reviewrouter/features-provider-accounts/synchronization";
import type { AccountAllowedAction } from "./account-gateway-accounts";

export const accountLifecycleRequest = z.strictObject({
  nonce: z
    .string()
    .uuid()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ),
  connectionId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .max(256),
  action: z.enum(["suspend", "resume", "delete"]),
  mirrorRevision: z.number().int().positive().max(2147483646),
  gatewayRevision: z.number().int().positive().safe(),
  authorizationEpoch: z.number().int().positive().safe(),
});
export type AccountLifecycleRequest = z.infer<typeof accountLifecycleRequest>;
export type AccountLifecycleView = {
  nonce: string;
  operationId: string;
  action: AccountLifecycleRequest["action"];
  phase: AccountLifecycleReceipt["phase"];
  closureComplete: boolean;
};
export function lifecycleProjection(input: {
  owned: boolean;
  compatible: boolean;
  state: string;
  pendingOperationId: string | null;
  synchronized: boolean;
  custodyVerified?: boolean;
  operationReadable?: boolean;
  pendingAction?: "suspend" | "resume" | "delete" | undefined;
}) {
  // Disabled is terminal for lifecycle writes: both the store and the
  // lifecycle_source_cas guard reserve delete only from active/suspended/
  // quarantined, so advertising any action there would be a dead control.
  const status =
    input.pendingAction === "delete"
      ? ("pending" as const)
      : input.state === "disabled"
        ? ("support_required" as const)
        : input.pendingOperationId
          ? ("pending" as const)
          : input.compatible && input.synchronized
            ? ("available" as const)
            : ("unavailable" as const);
  const actions: AccountAllowedAction[] = [];
  if (input.owned && status === "available") {
    if (input.state === "active") actions.push("suspend", "delete");
    if (input.state === "suspended") {
      if (input.custodyVerified) actions.push("resume");
      actions.push("delete");
    }
    if (input.state === "quarantined") actions.push("delete");
  }
  return {
    lifecycle: {
      status,
      ...(input.owned && input.pendingAction
        ? { action: input.pendingAction }
        : {}),
      ...(input.owned && input.operationReadable && input.pendingOperationId
        ? { operationId: input.pendingOperationId }
        : {}),
    },
    actions,
  };
}
function view(receipt: AccountLifecycleReceipt): AccountLifecycleView {
  return {
    nonce: receipt.intent.clientOperationId,
    operationId: receipt.id,
    action: receipt.intent.action,
    phase: receipt.phase,
    closureComplete: receipt.closureComplete,
  };
}
export function createAccountLifecycleService(input: {
  deps: AccountLifecycleDependencies;
  authorize(
    workspaceId: string,
  ): Promise<{ userId: string; personal: boolean }>;
  scopeForSource(
    sourceId: string,
  ): Promise<
    | { personalWorkspaceId: string; owningWorkspaceId: null }
    | { personalWorkspaceId: null; owningWorkspaceId: string }
  >;
  compatible(
    workspaceId: string,
    scope: { readonly personalWorkspaceId: string | null },
  ): Promise<boolean>;
  deliverFences(actor: string, operationId: string): Promise<void>;
}) {
  async function scope(workspaceId: string) {
    const actor = await input.authorize(workspaceId);
    return actor;
  }
  async function checkedScope(workspaceId: string, userId: string) {
    if ((await scope(workspaceId)).userId !== userId)
      throw new ProviderAccountError("workspace_forbidden");
  }
  async function reconcile(
    workspaceId: string,
    userId: string,
    receipt: AccountLifecycleReceipt,
    submit: boolean,
  ) {
    if (
      receipt.intent.personalWorkspaceId === null &&
      receipt.intent.owningWorkspaceId !== workspaceId
    )
      throw new ProviderAccountError("workspace_forbidden");
    await checkedScope(workspaceId, userId);
    if (["fencing", "ready"].includes(receipt.phase)) {
      try {
        await input.deliverFences(userId, receipt.id);
        await input.deps.store.ready(userId, receipt.id);
        await input.deliverFences(userId, receipt.id);
        await input.deps.store.ready(userId, receipt.id);
      } catch {
        await checkedScope(workspaceId, userId);
      }
    }
    const result = await (submit
      ? submitAccountLifecycle(userId, receipt.id, input.deps)
      : readAccountLifecycle(userId, receipt.id, input.deps));
    await checkedScope(workspaceId, userId);
    return view(result);
  }
  return {
    async mutate(workspaceId: string, raw: AccountLifecycleRequest) {
      const request = accountLifecycleRequest.parse(raw);
      const actor = await scope(workspaceId);
      await checkedScope(workspaceId, actor.userId);
      const ownership = await input.scopeForSource(request.connectionId);
      // Suspend/resume never reserve while the write gate is closed or
      // unreachable; a reservation would strand the source pending and fenced.
      if (
        request.action !== "delete" &&
        !(await input.compatible(workspaceId, ownership))
      )
        throw new ProviderAccountError("connection_unavailable");
      const receipt = await beginAccountLifecycle(
        {
          actorUserId: actor.userId,
          clientOperationId: request.nonce,
          sourceId: request.connectionId,
          action: request.action,
          expectedSourceMetadataRevision: request.mirrorRevision,
          expectedGatewayRevision: request.gatewayRevision,
          expectedAuthorizationEpoch: request.authorizationEpoch,
          ...ownership,
        },
        input.deps,
      );
      // Delete stays deny-first: its local denial records before any remote I/O.
      if (
        request.action === "delete" &&
        !(await input.compatible(workspaceId, receipt.intent))
      )
        throw new ProviderAccountError("connection_unavailable");
      return reconcile(workspaceId, actor.userId, receipt, true);
    },
    async continue(workspaceId: string, operationId: string) {
      const actor = await scope(workspaceId);
      const receipt = await input.deps.store.read(actor.userId, operationId);
      if (!["fencing", "ready"].includes(receipt.phase))
        return reconcile(workspaceId, actor.userId, receipt, false);
      if (!(await input.compatible(workspaceId, receipt.intent)))
        throw new ProviderAccountError("connection_unavailable");
      return reconcile(workspaceId, actor.userId, receipt, true);
    },
    async read(workspaceId: string, operationId: string) {
      const actor = await scope(workspaceId);
      // Recovery remains readable when write gates close; it never re-enters ingress.
      const receipt = await input.deps.store.read(actor.userId, operationId);
      if (
        receipt.intent.personalWorkspaceId === null &&
        receipt.intent.owningWorkspaceId !== workspaceId
      )
        throw new ProviderAccountError("workspace_forbidden");
      // Observational recovery may persist exact authoritative readback under CAS,
      // but never delivers fences, reserves, claims, or re-enters Gateway ingress.
      const result = await readAccountLifecycle(
        actor.userId,
        receipt.id,
        input.deps,
      );
      await checkedScope(workspaceId, actor.userId);
      return view(result);
    },
  };
}
