import { createHash } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createLifecycleClient,
  createManagementClient,
  createConsumerControlClient,
} from "@agent-teams/account-gateway/http";
import { PrismaAccountLifecycleOperations } from "@reviewrouter/features-provider-accounts/synchronization";
import {
  ProviderAccountError,
  PrismaProviderAccountRepository,
  reconcileWorkspaceBindingFences,
} from "@reviewrouter/features-provider-accounts";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { getPrisma } from "./prisma";
import {
  accountGatewayUserOwnerRef,
  accountGatewayWorkspaceOwnerRef,
  accountGatewayProfilesConfiguration,
} from "./account-gateway-accounts";
import { createAccountLifecycleGateway } from "./account-lifecycle-gateway";
import { createAccountLifecycleService } from "./account-lifecycle";

export async function productionAccountLifecycle(workspaceId: string) {
  c.reference.parse(workspaceId);
  const actor = await getDashboardSignedInActor();
  if (!actor?.userId) throw new ProviderAccountError("workspace_forbidden");
  const userId = actor.userId;
  const prisma = getPrisma();
  async function authorize() {
    const liveActor = await getDashboardSignedInActor();
    if (liveActor?.userId !== userId)
      throw new ProviderAccountError("workspace_forbidden");
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        deletionState: true,
        personalOwnerUserId: true,
        members: { where: { userId }, select: { role: true } },
      },
    });
    if (
      !workspace ||
      workspace.deletionState !== "active" ||
      (workspace.personalOwnerUserId !== null
        ? workspace.personalOwnerUserId !== userId
        : workspace.members.length !== 1)
    )
      throw new ProviderAccountError("workspace_forbidden");
    return { userId, personal: workspace.personalOwnerUserId !== null };
  }
  await authorize();
  const settingsFor = (personal: boolean) => ({
    role: personal ? ("consumer-control" as const) : ("management" as const),
    origin: personal
      ? (process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_ORIGIN ??
        "")
      : (process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? ""),
    token: personal
      ? (process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_TOKEN ?? "")
      : (process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? ""),
    timeoutMs: 10000,
    responseBytes: 65536,
  });
  const store = new PrismaAccountLifecycleOperations(prisma);
  const repository = new PrismaProviderAccountRepository(
    prisma,
    accountGatewayProfilesConfiguration().operatorWorkspaceId,
    true,
  );
  const checked = async <T>(call: () => Promise<T>) => {
    await authorize();
    const result = await call();
    await authorize();
    return result;
  };
  const boundGateway = (personal: boolean) => {
    const selected = settingsFor(personal);
    const legacy =
      selected.role === "management"
        ? createManagementClient({ ...selected, role: "management" })
        : createConsumerControlClient({
            ...selected,
            role: "consumer-control",
          });
    const lifecycle = createLifecycleClient({
      ...selected,
      capability: c.LIFECYCLE_CAPABILITY_CONTRACT,
      clientContract: c.LIFECYCLE_CLIENT_CONTRACT,
    });
    return createAccountLifecycleGateway({
      lifecycle,
      legacy,
      authorize: async () => {
        await authorize();
      },
      ownerRef: personal
        ? accountGatewayUserOwnerRef(userId)
        : accountGatewayWorkspaceOwnerRef(workspaceId),
      async bindingClosure(command) {
        const receipt = await store.read(userId, command.operationId);
        if (
          receipt.intent.action !== "delete" ||
          receipt.source.gatewayAccountRef !== command.accountRef
        )
          return null;
        const proof = createHash("sha256").update(
          JSON.stringify([
            "rr-account-delete-binding-proof-v1",
            command,
            receipt.intent.sourceId,
            receipt.source.metadataRevision,
          ]),
        );
        let after: string | undefined;
        for (;;) {
          const rows = await checked(() =>
            prisma.workspaceAccountBinding.findMany({
              where: {
                connectionId: receipt.intent.sourceId,
                ...(after ? { id: { gt: after } } : {}),
              },
              orderBy: { id: "asc" },
              take: 100,
              select: {
                id: true,
                state: true,
                policyRevision: true,
                pendingFenceOperationId: true,
                pendingFencePolicySubject: true,
                pendingFencePolicyRevision: true,
                fenceAckOperationId: true,
                fenceAckPolicyRevision: true,
              },
            }),
          );
          if (
            rows.some(
              (row) =>
                row.state !== "revoked" ||
                row.pendingFenceOperationId !== null ||
                row.pendingFencePolicySubject !== null ||
                row.pendingFencePolicyRevision !== null ||
                !row.fenceAckOperationId ||
                row.fenceAckPolicyRevision !== row.policyRevision,
            )
          )
            return null;
          for (const row of rows) proof.update(JSON.stringify(row));
          if (rows.length < 100) break;
          after = rows.at(-1)!.id;
        }
        const current = await store.read(userId, command.operationId);
        if (current.source.metadataRevision !== receipt.source.metadataRevision)
          return null;
        return `rr_${proof.digest("hex")}`;
      },
    });
  };
  const gateway = {
    async preflight(
      command: Parameters<ReturnType<typeof boundGateway>["submit"]>[0],
    ) {
      const receipt = await store.read(userId, command.operationId);
      const selected = settingsFor(receipt.intent.personalWorkspaceId !== null);
      const capability = await checked(() =>
        createLifecycleClient({
          ...selected,
          capability: c.LIFECYCLE_CAPABILITY_CONTRACT,
          clientContract: c.LIFECYCLE_CLIENT_CONTRACT,
        }).capability(),
      );
      if (capability.writeGate !== "enabled")
        throw new ProviderAccountError("connection_unavailable");
    },
    async submit(
      command: Parameters<ReturnType<typeof boundGateway>["submit"]>[0],
    ) {
      const receipt = await store.read(userId, command.operationId);
      return boundGateway(receipt.intent.personalWorkspaceId !== null).submit(
        command,
      );
    },
    async read(
      command: Parameters<ReturnType<typeof boundGateway>["read"]>[0],
    ) {
      const receipt = await store.read(userId, command.operationId);
      return boundGateway(receipt.intent.personalWorkspaceId !== null).read(
        command,
      );
    },
  };
  const service = createAccountLifecycleService({
    deps: {
      store,
      gateway,
      authorize: async (id) => {
        if (id !== userId)
          throw new ProviderAccountError("workspace_forbidden");
        await authorize();
      },
    },
    authorize: async (requested) => {
      if (requested !== workspaceId)
        throw new ProviderAccountError("workspace_forbidden");
      return authorize();
    },
    scopeForSource: async (sourceId) => {
      const source = await checked(() =>
        prisma.providerAccountConnection.findUnique({
          where: { id: sourceId },
          select: { ownerUserId: true, ownerWorkspaceId: true },
        }),
      );
      if (source?.ownerUserId === userId && source.ownerWorkspaceId === null) {
        const personal = await checked(() =>
          prisma.workspace.findUnique({
            where: { personalOwnerUserId: userId },
            select: { id: true, deletionState: true },
          }),
        );
        if (!personal || personal.deletionState !== "active")
          throw new ProviderAccountError("workspace_forbidden");
        return { personalWorkspaceId: personal.id, owningWorkspaceId: null };
      }
      if (
        !source ||
        source.ownerUserId !== null ||
        source.ownerWorkspaceId !== workspaceId
      )
        throw new ProviderAccountError("workspace_forbidden");
      return { personalWorkspaceId: null, owningWorkspaceId: workspaceId };
    },
    compatible: async (_workspaceId, scope) => {
      const selected = settingsFor(scope.personalWorkspaceId !== null);
      const capability = await checked(() =>
        createLifecycleClient({
          ...selected,
          capability: c.LIFECYCLE_CAPABILITY_CONTRACT,
          clientContract: c.LIFECYCLE_CLIENT_CONTRACT,
        }).capability(),
      );
      return capability.writeGate === "enabled";
    },
    async deliverFences(id, operationId) {
      const receipt = await store.read(id, operationId);
      const selected = settingsFor(receipt.intent.personalWorkspaceId !== null);
      const legacy =
        selected.role === "management"
          ? createManagementClient({ ...selected, role: "management" })
          : createConsumerControlClient({
              ...selected,
              role: "consumer-control",
            });
      let after: string | undefined;
      for (;;) {
        const page = await checked(() =>
          store.listFences(id, operationId, after),
        );
        if (!page.length) break;
        await checked(() =>
          reconcileWorkspaceBindingFences(
            { limit: 100, bindingIds: page.map((row) => row.bindingId) },
            {
              accounts: repository,
              delivery: {
                async submitFence(intent) {
                  const result = await checked(() =>
                    legacy.fence({
                      operationId: intent.operationId,
                      subjectRef: intent.policySubject,
                      revision: intent.policyRevision,
                    }),
                  );
                  const acknowledgement =
                    c.acknowledgementOperation.parse(result);
                  return acknowledgement.state === "applied" &&
                    acknowledgement.operationRef === intent.operationId
                    ? {
                        state: "applied" as const,
                        operationId: intent.operationId,
                        policySubject: intent.policySubject,
                        policyRevision: intent.policyRevision,
                      }
                    : { state: "unknown" as const };
                },
                async readFenceOperation(intent) {
                  const result = await checked(() =>
                    legacy.operation(intent.operationId),
                  );
                  const acknowledgement =
                    c.acknowledgementOperation.parse(result);
                  return acknowledgement.state === "applied" &&
                    acknowledgement.operationRef === intent.operationId
                    ? {
                        state: "applied" as const,
                        operationId: intent.operationId,
                        policySubject: intent.policySubject,
                        policyRevision: intent.policyRevision,
                      }
                    : { state: "unknown" as const };
                },
              },
            },
          ),
        );
        after = page.at(-1)!.bindingId;
        if (page.length < 100) break;
      }
    },
  });
  return {
    ...service,
    async readByNonce(nonce: string) {
      await authorize();
      const original = await checked(() =>
        prisma.personalAccountOperation.findUnique({
          where: {
            actorUserId_clientOperationId: {
              actorUserId: userId,
              clientOperationId: nonce,
            },
          },
          select: { id: true },
        }),
      );
      if (!original) throw new ProviderAccountError("not_found");
      return service.read(workspaceId, original.id);
    },
  };
}
