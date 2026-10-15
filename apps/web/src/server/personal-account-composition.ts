import { createHash } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import {
  PrismaProviderAccountRepository,
  ProviderAccountError,
  reconcileWorkspaceBindingFences,
  type ScopedBindingFence,
} from "@reviewrouter/features-provider-accounts";
import {
  PrismaPersonalAccountOperations,
  PrismaPersonalCanonicalOperations,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import {
  accountGatewayProfilesConfiguration,
  accountGatewayUserOwnerRef,
  accountGatewayWorkspaceOwnerRef,
  type AccountProfileView,
  createDisabledPersonalAccountsAdapter,
} from "./account-gateway-accounts";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { getPrisma } from "./prisma";
import { PrismaPersonalAccountSharingQueries } from "./personal-account-sharing-queries";
import { createPersonalAccountSharingApi } from "./personal-account-sharing";
import { createPersonalCanonicalAccounts } from "./personal-canonical-accounts";
import { createGatewayModelAccountOptions } from "./gateway-model-account-options";
import { z } from "zod";

// A dedicated server-only consumer-control credential is required. Management
// and API run-control credentials are not substituted for this role.
export async function productionPersonalAccounts() {
  if (!readPersonalAccountSharingEnabled(process.env)) return null;
  const actor = await getDashboardSignedInActor();
  if (!actor?.userId) throw new ProviderAccountError("workspace_forbidden");
  const userId = actor.userId;
  async function authorizeUser() {
    if (!readPersonalAccountSharingEnabled(process.env))
      throw new ProviderAccountError("workspace_forbidden");
    const current = await getDashboardSignedInActor();
    if (!current || current.userId !== userId)
      throw new ProviderAccountError("workspace_forbidden");
    return userId;
  }
  async function checked<T>(call: () => Promise<T>): Promise<T> {
    await authorizeUser();
    const value = await call();
    await authorizeUser();
    return value;
  }
  const settings = accountGatewayProfilesConfiguration();
  const controlSettings = {
    role: "consumer-control" as const,
    origin:
      process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_ORIGIN ?? "",
    token:
      process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_TOKEN ?? "",
    timeoutMs: 10000,
    responseBytes: 65536,
  };
  const control = createConsumerControlClient(controlSettings);
  const prisma = getPrisma();
  const store = new PrismaPersonalAccountOperations(prisma);
  const canonicalStore = new PrismaPersonalCanonicalOperations(prisma);
  const accounts = new PrismaProviderAccountRepository(
    prisma,
    settings.operatorWorkspaceId,
    true,
  );
  const profiles: Array<
    Parameters<typeof createPersonalCanonicalAccounts>[0]["profiles"][number]
  > = [...settings.apiKeyProfiles].map(([id, name]) => ({
    id,
    label: name,
    authKind: "api_key" as "api_key" | "oauth",
    canReconnect: true,
    ...(settings.apiKeyProfileBaseURLs.has(id)
      ? { dedicatedBaseURL: settings.apiKeyProfileBaseURLs.get(id)! }
      : {}),
  }));
  if (settings.codexOAuthProfileId)
    profiles.push({
      id: settings.codexOAuthProfileId,
      label: "Codex",
      authKind: "oauth",
      canReconnect: false,
    });
  const ingress = new Map(
    profiles.map((profile) => [
      profile.id,
      profile.authKind === "api_key"
        ? ("api-key-create" as const)
        : ("oauth-begin" as const),
    ]),
  );
  const createAdapter = (authorize: () => Promise<string>) =>
    createDisabledPersonalAccountsAdapter({
      authorizeUser: authorize,
      store,
      control: controlSettings,
      profiles: ingress,
    });
  const gateway = {
    async get(actorUserId: string, accountRef: string, profileId: string) {
      if (actorUserId !== userId || !ingress.has(profileId))
        throw new ProviderAccountError("connection_unavailable");
      const account = await checked(() => control.get(accountRef));
      if (
        account.ownerRef !== accountGatewayUserOwnerRef(userId) ||
        account.accountRef !== accountRef ||
        account.profileId !== profileId
      )
        throw new ProviderAccountError("connection_unavailable");
      return account;
    },
    async operation(operationId: string) {
      const operation = await checked(() => control.operation(operationId));
      return {
        operationId: operation.operationRef,
        state: operation.state,
        ...(operation.state === "applied" &&
        operation.result?.kind === "account"
          ? { result: operation.result }
          : {}),
      };
    },
  };
  function receipt(operation: c.Operation, intent: ScopedBindingFence) {
    const result = c.acknowledgementOperation.parse(operation);
    return result.state === "applied" &&
      result.operationRef === intent.operationId
      ? {
          state: "applied" as const,
          operationId: intent.operationId,
          policySubject: intent.policySubject,
          policyRevision: intent.policyRevision,
        }
      : { state: "unknown" as const };
  }
  const bindingFences = {
    accounts: {
      listPendingBindingFences: (
        request: Parameters<typeof accounts.listPendingBindingFences>[0],
      ) => checked(() => accounts.listPendingBindingFences(request)),
      acknowledgeBindingFence: (intent: ScopedBindingFence) =>
        checked(() => accounts.acknowledgeBindingFence(intent)),
    },
    delivery: {
      submitFence: async (intent: ScopedBindingFence) =>
        receipt(
          await checked(() =>
            control.fence({
              operationId: intent.operationId,
              subjectRef: intent.policySubject,
              revision: intent.policyRevision,
            }),
          ),
          intent,
        ),
      readFenceOperation: async (intent: ScopedBindingFence) =>
        receipt(
          await checked(() => control.operation(intent.operationId)),
          intent,
        ),
    },
  };
  const sharing = createPersonalAccountSharingApi({
    authorizeUser,
    store,
    createAdapter,
    gateway,
    queries: new PrismaPersonalAccountSharingQueries(prisma),
    bindingFences,
    async readBindingAttachOperation(actorUserId, bindingId) {
      if (actorUserId !== userId)
        throw new ProviderAccountError("workspace_forbidden");
      const original = await checked(() =>
        prisma.personalAccountOperation.findFirst({
          where: {
            actorUserId,
            action: "attach",
            phase: "applied",
            resultBindingId: bindingId,
            resultSource: { ownerUserId: actorUserId, ownerWorkspaceId: null },
          },
          select: { clientOperationId: true },
        }),
      );
      if (!original) throw new ProviderAccountError("not_found");
      return checked(() =>
        store.readOperation(actorUserId, original.clientOperationId),
      );
    },
  });
  const canonical = createPersonalCanonicalAccounts({
    authorizeUser,
    store,
    canonical: canonicalStore,
    control,
    profiles,
    personalAdapterFactory: ({ authorizeUser: authorize, profiles: allowed }) =>
      createDisabledPersonalAccountsAdapter({
        authorizeUser: authorize,
        store,
        profiles: allowed,
        control: controlSettings,
      }),
    async deliverFences(actorUserId, clientOperationId) {
      if (actorUserId !== userId)
        throw new ProviderAccountError("workspace_forbidden");
      const pending = await checked(() =>
        canonicalStore.listFences(actorUserId, clientOperationId),
      );
      if (pending.length)
        await checked(() =>
          reconcileWorkspaceBindingFences(
            { limit: 100, bindingIds: pending.map((row) => row.bindingId) },
            bindingFences,
          ),
        );
    },
  });
  async function workspaceAccess(workspaceId: string) {
    c.reference.parse(workspaceId);
    const workspace = await checked(() =>
      prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: {
          deletionState: true,
          personalOwnerUserId: true,
          members: { where: { userId }, select: { role: true } },
        },
      }),
    );
    if (
      !workspace ||
      workspace.deletionState !== "active" ||
      (workspace.personalOwnerUserId !== null
        ? workspace.personalOwnerUserId !== userId
        : workspace.members.length !== 1)
    )
      throw new ProviderAccountError("workspace_forbidden");
    return {
      personal: workspace.personalOwnerUserId !== null,
      canDetach:
        workspace.personalOwnerUserId === null &&
        (workspace.members[0]?.role === "owner" ||
          workspace.members[0]?.role === "admin"),
    };
  }
  async function models(workspaceId: string) {
    await workspaceAccess(workspaceId);
    const live = await checked(() => control.profiles());
    const available: AccountProfileView[] = live.profiles.flatMap((wire) => {
      const configured = profiles.find(
        (profile) =>
          profile.id === wire.profileId &&
          wire.authKinds.includes(profile.authKind),
      );
      return configured
        ? [
            {
              ...configured,
              protocol: wire.protocol,
              models: [...wire.modelIds],
            },
          ]
        : [];
    });
    return createGatewayModelAccountOptions({
      prisma,
      env: process.env,
      profiles: available,
      gateway: control,
      ...(settings.operatorWorkspaceId
        ? { operatorWorkspaceId: settings.operatorWorkspaceId }
        : {}),
      ownerRef: (owner) =>
        owner.kind === "user"
          ? accountGatewayUserOwnerRef(owner.userId)
          : accountGatewayWorkspaceOwnerRef(owner.workspaceId),
      authorizeWorkspace: async () => {
        await authorizeUser();
        return { workspaceId, actor: { userId } };
      },
    });
  }
  async function detachRecipient(
    workspaceId: string,
    raw: { bindingId: string; expectedBindingRevision: number },
  ) {
    const request = z
      .strictObject({
        bindingId: c.reference,
        expectedBindingRevision: z.number().int().min(1).max(2147483647),
      })
      .parse(raw);
    c.reference.parse(workspaceId);
    const committed = await checked(() =>
      store.detachRecipientBinding({
        actorUserId: userId,
        workspaceId,
        ...request,
      }),
    );
    try {
      await checked(() =>
        reconcileWorkspaceBindingFences(
          { limit: 1, bindingIds: [request.bindingId] },
          bindingFences,
        ),
      );
      return await checked(() =>
        store.detachRecipientBinding({
          actorUserId: userId,
          workspaceId,
          ...request,
        }),
      );
    } catch {
      await authorizeUser();
      return committed;
    }
  }
  const scope = `personal-${createHash("sha256").update(`rr-personal-ui-v1\0${userId}`).digest("hex")}`;
  return {
    sharing,
    canonical,
    scope,
    models,
    workspaceAccess,
    detachRecipient,
  };
}
