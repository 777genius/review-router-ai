import { Prisma, type PrismaClient } from "@prisma/client";
import * as c from "@agent-teams/account-gateway/contracts";
import type { ManagementClient } from "@agent-teams/account-gateway/http";
import {
  assertOpaqueReference,
  assertMetadata,
  PrismaProviderAccountRepository,
  ProviderAccountError,
  selectBinding,
  type BindingSelection,
  type SafeBindingTuple,
  type ConnectionOwner,
} from "@reviewrouter/features-provider-accounts";
import {
  readAccountModelCatalogEnabled,
  readPersonalAccountSharingEnabled,
} from "@reviewrouter/features-provider-accounts/composition";
import type {
  AccountProfileView,
  AccountsPage,
  AccountsResult,
  AccountView,
} from "./account-gateway-accounts";

type Principal = {
  readonly workspaceId: string;
  readonly actor: { readonly userId: string };
};
type ModelAccount = AccountView & {
  readonly origin: "personal" | "organization" | "operator";
};
type ModelPage = Omit<AccountsPage, "accounts"> & { accounts: ModelAccount[] };
class Denied extends Error {}
class RowDenied extends Error {}

/** Server-only read composition. No browser owner/scope/allow-personal input,
 * Gateway discovery, mirror writes, provisioning or implicit binding creation.
 */
export function createGatewayModelAccountOptions(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly operatorWorkspaceId?: string;
  readonly profiles: readonly AccountProfileView[];
  readonly gateway: Pick<ManagementClient, "get"> &
    Partial<Pick<ManagementClient, "readAccountModels">>;
  readonly ownerRef: (owner: ConnectionOwner) => string;
  readonly authorizeWorkspace: () => Promise<Principal>;
}) {
  const { prisma, gateway, ownerRef, authorizeWorkspace, operatorWorkspaceId } =
    input;
  const personalEnabled = readPersonalAccountSharingEnabled(input.env);
  const accounts = new PrismaProviderAccountRepository(
    prisma,
    operatorWorkspaceId,
    personalEnabled,
  );
  const profiles = input.profiles
    .filter(
      (profile) => profile.availability !== "deployment_configuration_required",
    )
    .map((profile) => ({
      id: profile.id,
      label: profile.label,
      ...(profile.connection ? { connection: profile.connection } : {}),
      ...(profile.provider ? { provider: profile.provider } : {}),
      protocol: profile.protocol,
      models: [...profile.models],
      ...(profile.authKind ? { authKind: profile.authKind } : {}),
      canReconnect: false,
    }));
  const catalogue = new Map(profiles.map((profile) => [profile.id, profile]));
  if (profiles.length > 128 || catalogue.size !== profiles.length)
    throw new Error("model_account_profiles_invalid");
  for (const profile of profiles) assertOpaqueReference(profile.id);

  async function principal(): Promise<Principal> {
    const current = await authorizeWorkspace();
    const result = {
      workspaceId: current.workspaceId,
      actor: { userId: current.actor.userId },
    };
    assertOpaqueReference(result.workspaceId);
    assertOpaqueReference(result.actor.userId);
    return result;
  }
  const same = (a: Principal, b: Principal) =>
    a.workspaceId === b.workspaceId && a.actor.userId === b.actor.userId;
  async function authorize() {
    const who = await principal();
    const scope = await prisma.workspace.findUnique({
      where: { id: who.workspaceId },
      select: {
        personalOwnerUserId: true,
        deletionState: true,
        members: {
          where: { userId: who.actor.userId },
          select: { role: true },
        },
      },
    });
    if (
      !same(who, await principal()) ||
      !scope ||
      scope.deletionState !== "active" ||
      (scope.personalOwnerUserId !== null
        ? scope.personalOwnerUserId !== who.actor.userId
        : scope.members.length !== 1)
    )
      throw new Denied();
    return {
      ...who,
      role: scope.members[0]?.role ?? null,
      personalOwnerUserId: scope.personalOwnerUserId,
    };
  }
  type Authority = Awaited<ReturnType<typeof authorize>>;
  async function checked<T>(
    authority: Authority,
    call: () => Promise<T>,
  ): Promise<T> {
    if (!same(authority, await authorize())) throw new Denied();
    const result = await call();
    if (!same(authority, await authorize())) throw new Denied();
    return result;
  }
  function selected(
    authority: Authority,
    bindingId: string,
    row: BindingSelection | null,
  ) {
    if (
      authority.personalOwnerUserId !== null &&
      authority.personalOwnerUserId !== authority.actor.userId
    )
      throw new Denied();
    try {
      return selectBinding(
        authority.workspaceId,
        bindingId,
        row,
        operatorWorkspaceId,
      );
    } catch (error) {
      if (
        error instanceof ProviderAccountError &&
        (error.code === "connection_unavailable" ||
          error.code === "binding_unavailable")
      )
        throw new RowDenied();
      throw error;
    }
  }
  async function detail(
    authority: Authority,
    bindingId: string,
    readModels = false,
    forceRefresh = false,
  ): Promise<{
    account: ModelAccount;
    profile: AccountProfileView;
    selection: SafeBindingTuple;
    authorizationEpoch: number;
  }> {
    const request = { workspaceId: authority.workspaceId, bindingId };
    const before = await checked(authority, () =>
      accounts.findBinding(request),
    );
    const original = selected(authority, bindingId, before);
    const profile = original.profileRef
      ? catalogue.get(original.profileRef)
      : undefined;
    if (!profile || !before) throw new RowDenied();
    const remote = c.account.parse(
      await checked(authority, () => gateway.get(original.gatewayAccountRef)),
    );
    assertMetadata({
      gatewayOperationRef: null,
      profileRef: remote.profileId,
      displayName: remote.displayName,
      state: "active",
    });
    const row = await checked(authority, () => accounts.findBinding(request));
    const live = selected(authority, bindingId, row);
    if (
      !row ||
      original.connectionId !== live.connectionId ||
      original.bindingRevision !== live.bindingRevision ||
      original.policyRevision !== live.policyRevision ||
      original.profileRef !== live.profileRef ||
      original.gatewayAccountRef !== live.gatewayAccountRef ||
      original.expectedAuthorizationEpoch !== live.expectedAuthorizationEpoch ||
      before.connection.metadataRevision !== row.connection.metadataRevision ||
      remote.accountRef !== original.gatewayAccountRef ||
      remote.ownerRef !== ownerRef(row.connection.owner) ||
      remote.profileId !== profile.id ||
      (live.expectedAuthorizationEpoch !== undefined &&
        remote.authorizationEpoch !== live.expectedAuthorizationEpoch)
    )
      throw new RowDenied();
    let scopedProfile: AccountProfileView = profile;
    let modelCatalog: ModelAccount["modelCatalog"];
    const discoverySource = profile.authKind
      ? c.accountModelDiscoverySource({
          profileId: profile.id,
          protocol: profile.protocol,
          authKind: profile.authKind,
        })
      : undefined;
    if (
      readModels &&
      readAccountModelCatalogEnabled(input.env) &&
      discoverySource
    ) {
      let models: c.AccountModels;
      try {
        models = gateway.readAccountModels
          ? c.accountModels.parse(
              await checked(authority, () =>
                gateway.readAccountModels!({
                  ownerRef: ownerRef(row.connection.owner),
                  accountRef: live.gatewayAccountRef,
                  profileId: profile.id,
                  expectedAuthorizationEpoch: remote.authorizationEpoch,
                  ...(forceRefresh ? { forceRefresh: true } : {}),
                }),
              ),
            )
          : { status: "unsupported" };
      } catch (error) {
        if (error instanceof Denied || error instanceof RowDenied) throw error;
        // A malformed/failed response is not an explicit authorized fallback.
        models = { status: "unknown" };
      }
      if (
        models.status === "snapshot" &&
        (models.source !== discoverySource ||
          Date.parse(models.fetchedAt) > Date.now() ||
          Date.parse(models.expiresAt) <= Date.now())
      )
        models = { status: "unknown" };
      // Re-read the exact authorized binding and remote account after discovery.
      // The Gateway independently fences physical identity during discovery.
      const after = await detail(authority, bindingId);
      if (
        JSON.stringify(after.selection) !== JSON.stringify(live) ||
        after.authorizationEpoch !== remote.authorizationEpoch ||
        after.account.gatewayRevision !== remote.metadataRevision ||
        after.account.mirrorRevision !== row.connection.metadataRevision
      )
        throw new RowDenied();
      if (models.status === "snapshot") {
        const connection = profile.connection ?? {
          provider:
            discoverySource === "codex"
              ? ("openai" as const)
              : ("openrouter" as const),
          planLabel: profile.label,
          regionLabel: "Global",
          completionInputKind: "none" as const,
          personalOnly: false,
          limitsContract: "none" as const,
          modelSettings: [],
        };
        scopedProfile = {
          ...profile,
          models: models.models.map((model) => model.modelId),
          connection: { ...connection, modelSettings: models.models },
        };
        modelCatalog = {
          status: "snapshot",
          source: models.source,
          fetchedAt: models.fetchedAt,
          expiresAt: models.expiresAt,
          models: scopedProfile.models,
        };
      } else {
        // Only the Gateway's unavailable fallback admits the configured anchor.
        // Unsupported/unknown discovery cannot authorize profile seed models.
        const legacyModels =
          models.status === "unavailable" ? [...profile.models] : [];
        scopedProfile = {
          ...profile,
          models: legacyModels,
          ...(profile.connection
            ? {
                connection: {
                  ...profile.connection,
                  modelSettings: profile.connection.modelSettings.filter(
                    (setting) => legacyModels.includes(setting.modelId),
                  ),
                },
              }
            : {}),
        };
        modelCatalog = {
          status: models.status,
          source: "legacy_profile",
          models: legacyModels,
        };
      }
    }
    const own =
      row.connection.owner.kind === "user"
        ? authority.personalOwnerUserId === authority.actor.userId &&
          row.connection.owner.userId === authority.actor.userId
        : row.connection.owner.workspaceId === authority.workspaceId;
    return {
      selection: live,
      authorizationEpoch: remote.authorizationEpoch,
      account: {
        // Shared consumption has only the exact binding handle, never foreign source ID.
        connectionId: own ? row.connection.id : bindingId,
        origin:
          row.connection.owner.kind === "user"
            ? "personal"
            : row.connection.owner.workspaceId === operatorWorkspaceId
              ? "operator"
              : "organization",
        isOwnedByViewer:
          row.connection.owner.kind === "user" &&
          row.connection.owner.userId === authority.actor.userId,
        canManage:
          own &&
          (authority.personalOwnerUserId !== null ||
            authority.role === "owner" ||
            authority.role === "admin"),
        label: remote.displayName,
        profileId: profile.id,
        profileLabel: profile.label,
        ...(profile.provider ? { provider: profile.provider } : {}),
        ...(scopedProfile.connection
          ? { connection: scopedProfile.connection }
          : {}),
        ...(modelCatalog ? { modelCatalog } : {}),
        ...(profile.authKind ? { authKind: profile.authKind } : {}),
        state: remote.state,
        gatewayRevision: remote.metadataRevision,
        mirrorRevision: row.connection.metadataRevision,
        binding: {
          id: bindingId,
          revision: row.binding.revision,
          state: row.binding.state,
          fencePending: row.binding.pendingFence !== null,
        },
      },
      profile: scopedProfile,
    };
  }
  async function result<T>(work: () => Promise<T>): Promise<AccountsResult<T>> {
    try {
      return { status: "ok", value: await work() };
    } catch (error) {
      if (error instanceof Denied || error instanceof RowDenied)
        return { status: "denied" };
      if (error instanceof ProviderAccountError)
        return {
          status: error.code === "invalid_input" ? "invalid" : "denied",
        };
      return { status: "unavailable" };
    }
  }
  return {
    list(
      request: {
        readonly afterBindingId?: string;
        readonly limit?: number;
      } = {},
    ): Promise<AccountsResult<ModelPage>> {
      const afterBindingId = request.afterBindingId,
        limit = request.limit ?? 25;
      return result(async () => {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          throw new ProviderAccountError("invalid_input");
        if (afterBindingId !== undefined) assertOpaqueReference(afterBindingId);
        const authority = await authorize();
        if (!profiles.length)
          return { accounts: [], profiles: [], nextCursor: null };
        // Local policy and profile filtering precede keyset/limit. No foreign-owner
        // catalog discovery and no post-limit filtering that starves later valid rows.
        const candidates = await checked(authority, () =>
          prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT b."id" FROM "WorkspaceAccountBinding" b
          JOIN "ProviderAccountConnection" s ON s."id" = b."connectionId"
          JOIN "Workspace" w ON w."id" = b."workspaceId"
          LEFT JOIN "Workspace" owned ON owned."id" = s."ownerWorkspaceId"
          LEFT JOIN "WorkspaceMember" donor ON donor."workspaceId" = b."workspaceId" AND donor."userId" = s."ownerUserId"
          WHERE b."workspaceId" = ${authority.workspaceId} AND w."deletionState" = 'active'
            AND b."state" = 'active' AND b."pendingFenceOperationId" IS NULL
            AND b."pendingFencePolicySubject" IS NULL AND b."pendingFencePolicyRevision" IS NULL
            AND s."state" = 'active' AND s."pendingSourceOperationId" IS NULL
            AND s."profileRef" IN (${Prisma.join(profiles.map((profile) => profile.id))})
            AND ((s."ownerUserId" IS NULL AND owned."personalOwnerUserId" IS NULL
              AND (s."ownerWorkspaceId" = ${authority.workspaceId}
                OR (${operatorWorkspaceId !== undefined} AND s."ownerWorkspaceId" = ${operatorWorkspaceId ?? authority.workspaceId})))
              OR (${personalEnabled} AND s."ownerWorkspaceId" IS NULL AND s."ownerUserId" IS NOT NULL
                AND s."authorizationEpochMirror" IS NOT NULL
                AND (w."personalOwnerUserId" = s."ownerUserId"
                  OR (w."personalOwnerUserId" IS NULL AND donor."role" IN ('owner', 'admin')))))
            ${afterBindingId === undefined ? Prisma.empty : Prisma.sql`AND b."id" > ${afterBindingId}`}
          ORDER BY b."id" ASC LIMIT ${limit + 1}`),
        );
        const rows = candidates.slice(0, limit);
        const projected: ModelAccount[] = [];
        for (const row of rows) {
          try {
            projected.push((await detail(authority, row.id)).account);
          } catch (error) {
            if (!(error instanceof RowDenied)) throw error;
          }
        }
        await checked(authority, async () => undefined);
        return {
          accounts: projected,
          profiles,
          nextCursor:
            candidates.length > limit ? rows[rows.length - 1]!.id : null,
        };
      });
    },
    get(
      bindingId: string,
      options: { readonly forceRefresh?: boolean } = {},
    ): Promise<
      AccountsResult<{ account: ModelAccount; profile: AccountProfileView }>
    > {
      const id = bindingId;
      return result(async () => {
        assertOpaqueReference(id);
        const authority = await authorize();
        const { account, profile } = await detail(
          authority,
          id,
          true,
          options.forceRefresh === true,
        );
        await checked(authority, async () => undefined);
        return { account, profile };
      });
    },
    // Private server-only selection for a diagnostic inference. Never returned
    // by the public list/get DTOs or accepted from the browser.
    async resolveProbe(bindingId: string, model: string) {
      try {
        assertOpaqueReference(bindingId);
        const authority = await authorize();
        const value = await detail(authority, bindingId, true);
        if (
          value.account.state !== "active" ||
          (value.account.modelCatalog &&
            !["snapshot", "unavailable"].includes(
              value.account.modelCatalog.status,
            )) ||
          !value.profile.models.includes(model) ||
          value.profile.protocol !== "openai-responses"
        )
          throw new RowDenied();
        await checked(authority, async () => undefined);
        return {
          ...value.selection,
          authorizationEpoch: value.authorizationEpoch,
        };
      } catch (error) {
        if (error instanceof Denied || error instanceof RowDenied)
          throw new ProviderAccountError("binding_unavailable");
        throw error;
      }
    },
  };
}
