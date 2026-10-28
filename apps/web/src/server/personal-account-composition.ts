import { connectionProfiles } from "./account-connection-catalog";
import { createAccountLimitsService } from "./account-limits-service";
import { accountLimitsReader } from "./account-limits-composition";
import { createAccountLifecycleReader } from "./account-lifecycle-reader";
import { createHash } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createLifecycleClient,
  createConsumerControlClient,
  createManagementClient,
} from "@agent-teams/account-gateway/http";
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
  accountsServerAdapter,
  loadAccountsBootstrap,
  accountGatewayProfilesConfiguration,
  accountGatewayUserOwnerRef,
  accountGatewayWorkspaceOwnerRef,
  type AccountProfileView,
  createDisabledPersonalAccountsAdapter,
} from "./account-gateway-accounts";
import {
  getDashboardSignedInActor,
  getDashboardWorkspaceScope,
} from "./dashboard-mutations";
import { getPrisma } from "./prisma";
import { PrismaPersonalAccountSharingQueries } from "./personal-account-sharing-queries";
import { createPersonalAccountSharingApi } from "./personal-account-sharing";
import { createPersonalCanonicalAccounts } from "./personal-canonical-accounts";
import { createAccountsOverview } from "./accounts-overview";
import { createGatewayModelAccountOptions } from "./gateway-model-account-options";
import { createGatewayConnectionProbe } from "./gateway-connection-probe";
import { gatewayProbeAccessClient } from "./gateway-probe-access-client";
import {
  assertRateLimit,
  PrismaRateLimitStore,
} from "@reviewrouter/features-rate-limits";
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
  const lifecycleReader = createAccountLifecycleReader({
    legacy: control,
    lifecycle: createLifecycleClient({
      ...controlSettings,
      capability: c.LIFECYCLE_CAPABILITY_CONTRACT,
      clientContract: c.LIFECYCLE_CLIENT_CONTRACT,
    }),
  });
  const prisma = getPrisma();
  const store = new PrismaPersonalAccountOperations(prisma);
  const canonicalStore = new PrismaPersonalCanonicalOperations(prisma);
  const accounts = new PrismaProviderAccountRepository(
    prisma,
    settings.operatorWorkspaceId,
    true,
  );
  const legacyProfiles: Array<
    Parameters<typeof createPersonalCanonicalAccounts>[0]["profiles"][number]
  > = [...settings.apiKeyProfiles].map(([id, name]) => ({
    id,
    label: name,
    provider: name === "MiMo" ? "codex-mimo" : "openrouter",
    authKind: "api_key" as "api_key" | "oauth",
    canReconnect: true,
    ...(settings.apiKeyProfileBaseURLs.has(id)
      ? { dedicatedBaseURL: settings.apiKeyProfileBaseURLs.get(id)! }
      : {}),
  }));
  if (settings.codexOAuthProfileId)
    legacyProfiles.push({
      id: settings.codexOAuthProfileId,
      label: "Codex",
      provider: "codex",
      authKind: "oauth",
      canReconnect: false,
      oauthMethods: ["device_code", "browser"],
    });
  if (settings.claudeOAuthProfileId)
    legacyProfiles.push({
      id: settings.claudeOAuthProfileId,
      label: "Claude",
      provider: "claude",
      authKind: "oauth",
      canReconnect: false,
      oauthMethods: ["browser"],
    });
  const profiles = [...legacyProfiles];
  let connectionCapabilities:
    | Promise<c.ProviderConnectionCapabilities>
    | undefined;
  if (
    settings.subscriptionProfileIds !== undefined &&
    (settings.subscriptionProfileIds.length > 0 ||
      (process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN &&
        process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN))
  ) {
    const management = createManagementClient({
      role: "management",
      origin: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? "",
      token: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? "",
      timeoutMs: 10000,
      responseBytes: 65536,
    });
    connectionCapabilities = checked(() =>
      management.getProviderConnectionCapabilities(),
    );
    const subscriptions = await checked(() =>
      connectionProfiles({
        legacy: [],
        subscriptionProfileIds: settings.subscriptionProfileIds,
        capabilities: () => connectionCapabilities!,
      }),
    );
    profiles.push(
      ...subscriptions.flatMap((profile) =>
        profile.authKind ? [{ ...profile, authKind: profile.authKind }] : [],
      ),
    );
  }
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
      connectionProfiles: profiles,
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
  function limits(workspaceId?: string, management = false) {
    let cachedReader: ReturnType<typeof accountLimitsReader> | undefined;
    const reader = {
      async read(
        target: Parameters<
          import("@reviewrouter/features-provider-accounts").AccountLimitsReader["read"]
        >[0],
      ) {
        const settings = management
          ? {
              role: "management" as const,
              origin:
                process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ??
                "",
              token:
                process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ??
                "",
            }
          : controlSettings;
        cachedReader ??= accountLimitsReader(settings);
        return (await cachedReader).read(target);
      },
    };
    return createAccountLimitsService({
      prisma,
      reader,
      secret: settings.contextKey,
      ...(settings.operatorWorkspaceId
        ? { operatorWorkspaceId: settings.operatorWorkspaceId }
        : {}),
      authorize: async () => {
        await authorizeUser();
        if (workspaceId) await workspaceAccess(workspaceId);
        return { userId, ...(workspaceId ? { workspaceId } : {}) };
      },
      ownerRef: (owner) =>
        owner.kind === "user"
          ? accountGatewayUserOwnerRef(owner.userId)
          : accountGatewayWorkspaceOwnerRef(owner.workspaceId),
    });
  }
  const canonical = createPersonalCanonicalAccounts({
    limits: limits(),
    authorizeUser,
    store,
    canonical: canonicalStore,
    control,
    lifecycleReader,
    readLifecycleAction: async (sourceId, operationId) => {
      const operation = await checked(() =>
        prisma.personalAccountOperation.findFirst({
          where: {
            id: operationId,
            sourceId,
            action: { in: ["suspend", "resume", "delete"] },
            source: { ownerUserId: userId, ownerWorkspaceId: null },
          },
          select: { action: true },
        }),
      );
      return operation
        ? z.enum(["suspend", "resume", "delete"]).parse(operation.action)
        : null;
    },
    profiles,
    personalAdapterFactory: ({
      authorizeUser: authorize,
      profiles: allowed,
      connectionProfiles: safeProfiles,
    }) =>
      createDisabledPersonalAccountsAdapter({
        authorizeUser: authorize,
        store,
        profiles: allowed,
        ...(safeProfiles ? { connectionProfiles: safeProfiles } : {}),
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
  async function reviewProfiles(workspaceId: string) {
    await workspaceAccess(workspaceId);
    const live = await checked(() => control.profiles());
    const available: AccountProfileView[] = live.profiles.flatMap((wire) => {
      const configured = profiles.find(
        (profile) =>
          profile.id === wire.profileId &&
          profile.availability !== "deployment_configuration_required" &&
          wire.authKinds.includes(profile.authKind),
      );
      return configured
        ? [
            {
              id: configured.id,
              label: configured.label,
              ...(configured.provider ? { provider: configured.provider } : {}),
              authKind: configured.authKind,
              connection: configured.connection,
              availability: configured.availability,
              canReconnect: false,
              protocol: wire.protocol,
              models: configured.connection
                ? wire.modelIds.filter((model) =>
                    configured.connection!.modelSettings.some(
                      (setting) => setting.modelId === model,
                    ),
                  )
                : [...wire.modelIds],
            },
          ]
        : [];
    });
    // Apply the same qualified capabilities to existing API-key and OAuth
    // profiles as to coding plans. Public model metadata is never admission.
    const qualified = await connectionProfiles({
      legacy: available,
      ...(connectionCapabilities
        ? { capabilities: () => connectionCapabilities! }
        : {}),
    });
    await workspaceAccess(workspaceId);
    return qualified;
  }
  async function models(workspaceId: string) {
    const available = await reviewProfiles(workspaceId);
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
  // Usage rows name repositories, so they follow the dashboard's repository
  // visibility: workspace-wide viewers read unfiltered (null), everyone else
  // only the repositories they can see. The restricted path reads the
  // repository permission cache directly (DB only — never a live GitHub call
  // from a render path); a missing or stale cache fails closed (empty set,
  // usage hidden) together with any read failure.
  async function usageRepositoryVisibility(
    workspaceId: string,
  ): Promise<ReadonlySet<string> | null> {
    const scope = await getDashboardWorkspaceScope();
    if (
      scope.kind === "all" ||
      (scope.kind === "workspace_ids" &&
        scope.workspaceIds.includes(workspaceId))
    )
      return null;
    try {
      const rows = await prisma.repositoryPermissionCache.findMany({
        where: {
          userId,
          canManage: true,
          expiresAt: { gt: new Date() },
          repository: {
            selected: true,
            archived: false,
            installation: { status: "active" },
            ...(scope.kind === "workspace_ids" && scope.workspaceIds.length > 0
              ? { workspaceId: { notIn: [...scope.workspaceIds] } }
              : {}),
          },
        },
        select: { repositoryId: true },
      });
      return new Set(rows.map((row) => row.repositoryId));
    } catch {
      return new Set<string>();
    }
  }
  async function overview(workspaceId: string) {
    await workspaceAccess(workspaceId);
    const managementSettings = {
      role: "management" as const,
      origin: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? "",
      token: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? "",
      timeoutMs: 10000,
      responseBytes: 65536,
    };
    const overviewReader = createAccountLifecycleReader({
      legacy: createManagementClient(managementSettings),
      lifecycle: createLifecycleClient({
        ...managementSettings,
        capability: c.LIFECYCLE_CAPABILITY_CONTRACT,
        clientContract: c.LIFECYCLE_CLIENT_CONTRACT,
      }),
    });
    return createAccountsOverview({
      limits: limits(workspaceId, true),
      prisma,
      cursorSecret: controlSettings.token,
      gateway: overviewReader,
      visibleRepositoryIds: () => usageRepositoryVisibility(workspaceId),
      lifecycleCompatible: overviewReader.writable,
      profiles,
      ...(settings.operatorWorkspaceId
        ? { operatorWorkspaceId: settings.operatorWorkspaceId }
        : {}),
      ownerRef: (owner) =>
        owner.kind === "user"
          ? accountGatewayUserOwnerRef(owner.userId)
          : accountGatewayWorkspaceOwnerRef(owner.workspaceId),
      authorize: async () => {
        await authorizeUser();
        await workspaceAccess(workspaceId);
        return { workspaceId, userId };
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
  async function readWorkspaceDetachment(
    workspaceId: string,
    raw: { bindingId: string; expectedBindingRevision: number },
  ) {
    const request = z
      .strictObject({
        bindingId: c.reference,
        expectedBindingRevision: z.number().int().min(1).max(2147483647),
      })
      .parse(raw);
    const access = await workspaceAccess(workspaceId);
    if (!access.canDetach)
      throw new ProviderAccountError("workspace_forbidden");
    const binding = await checked(() =>
      prisma.workspaceAccountBinding.findFirst({
        where: { id: request.bindingId, workspaceId },
        select: {
          id: true,
          workspaceId: true,
          revision: true,
          state: true,
          policyRevision: true,
          pendingFenceOperationId: true,
          fenceAckOperationId: true,
          fenceAckPolicyRevision: true,
        },
      }),
    );
    if (
      !binding ||
      binding.state !== "revoked" ||
      (binding.revision !== request.expectedBindingRevision + 1 &&
        binding.revision !== request.expectedBindingRevision)
    )
      throw new ProviderAccountError("revision_conflict");
    if (!(await workspaceAccess(workspaceId)).canDetach)
      throw new ProviderAccountError("workspace_forbidden");
    return {
      bindingId: binding.id,
      workspaceId,
      revision: binding.revision,
      state: "revoked" as const,
      localAuthorization: "local_denied" as const,
      remoteFenceDelivery:
        binding.pendingFenceOperationId === null &&
        binding.fenceAckOperationId !== null &&
        binding.fenceAckPolicyRevision === binding.policyRevision
          ? ("remote_applied" as const)
          : ("remote_pending" as const),
    };
  }
  async function detachWorkspaceUse(
    workspaceId: string,
    raw: { bindingId: string; expectedBindingRevision: number },
  ) {
    const request = z
      .strictObject({
        bindingId: c.reference,
        expectedBindingRevision: z.number().int().min(1).max(2147483647),
      })
      .parse(raw);
    if (!(await workspaceAccess(workspaceId)).canDetach)
      throw new ProviderAccountError("workspace_forbidden");
    const binding = await checked(() =>
      prisma.workspaceAccountBinding.findFirst({
        where: { id: request.bindingId, workspaceId },
        select: {
          connectionId: true,
          connection: { select: { ownerUserId: true } },
        },
      }),
    );
    if (!binding) throw new ProviderAccountError("binding_unavailable");
    if (binding.connection.ownerUserId !== null)
      return detachRecipient(workspaceId, request);
    const bootstrap = await loadAccountsBootstrap(workspaceId);
    if (!bootstrap.context)
      throw new ProviderAccountError("workspace_forbidden");
    const result = await (
      await accountsServerAdapter()
    ).detach(bootstrap.context, {
      connectionId: binding.connectionId,
      expectedRevision: request.expectedBindingRevision,
    });
    if (result.status !== "ok")
      throw new ProviderAccountError(
        result.status === "conflict"
          ? "revision_conflict"
          : "binding_unavailable",
      );
    return readWorkspaceDetachment(workspaceId, request);
  }
  const scope = `personal-${createHash("sha256").update(`rr-personal-ui-v1\0${userId}`).digest("hex")}`;
  function probe(workspaceId: string) {
    return (
      request: Parameters<ReturnType<typeof createGatewayConnectionProbe>>[0],
      emit: Parameters<ReturnType<typeof createGatewayConnectionProbe>>[1],
      signal: AbortSignal,
    ) =>
      createGatewayConnectionProbe({
        resolve: async (bindingId, model) =>
          (await models(workspaceId)).resolveProbe(bindingId, model),
        admit: async () => {
          await workspaceAccess(workspaceId);
          await assertRateLimit(
            {
              key: `gateway-probe:${workspaceId}:${userId}`,
              limit: 5,
              windowMs: 60000,
            },
            {
              rateLimits: new PrismaRateLimitStore(prisma),
              clock: { now: () => new Date() },
            },
          );
        },
        control: gatewayProbeAccessClient(
          {
            origin:
              process.env.REVIEW_ROUTER_API_URL ??
              process.env.REVIEW_ROUTER_PUBLIC_API_URL ??
              "",
            secret: process.env.AUTH_SECRET ?? "",
          },
          {
            userId,
            workspaceId,
            bindingId: request.bindingId,
            model: request.model,
            nonce: request.nonce,
          },
        ),
        executionOrigin:
          process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN ??
          controlSettings.origin,
        executionControlOrigin:
          process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN ??
          controlSettings.origin,
      })(request, emit, signal);
  }
  return {
    limits,
    sharing,
    canonical,
    scope,
    models,
    probe,
    overview,
    reviewProfiles,
    workspaceAccess,
    detachRecipient,
    detachWorkspaceUse,
    readWorkspaceDetachment,
  };
}
