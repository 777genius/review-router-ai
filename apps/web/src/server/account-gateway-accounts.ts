import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createManagementClient,
  GatewayError,
  type ManagementClient,
} from "@agent-teams/account-gateway/http";
import {
  bindWorkspaceAccount,
  resolveWorkspaceAccountBinding,
  revokeWorkspaceAccountBinding,
  ProviderAccountError,
  PrismaProviderAccountRepository,
  type ProviderAccountAccountsQueryPort,
  type ProviderAccountConnection,
  type ProviderAccountDependencies,
  type WorkspaceAccountActor,
} from "@reviewrouter/features-provider-accounts";
import {
  PrismaProviderAccountSynchronization,
  type ProviderAccountSynchronizationPort,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { PrismaWorkspaceAccessRepository } from "@reviewrouter/features-auth";
import { z } from "zod";

// This module is imported at runtime only by RSC/server actions. Client imports are type-only.
export type AccountsResult<T> =
  | { status: "ok"; value: T }
  | {
      status: "denied" | "conflict" | "invalid" | "unavailable";
    };
export type AccountProfileView = {
  id: string;
  label: string;
  protocol: c.Profile["protocol"];
  models: string[];
};
export type AccountView = {
  connectionId: string;
  label: string;
  profileId: string;
  profileLabel: string;
  state: c.Account["state"];
  gatewayRevision: number;
  mirrorRevision: number;
  binding: {
    revision: number;
    state: "active" | "revoked";
    fencePending: boolean;
  } | null;
};
export type AccountsPage = {
  accounts: AccountView[];
  profiles: AccountProfileView[];
  nextCursor: string | null;
};
export type AccountOperationView = {
  nonce: string;
  state: c.Operation["state"];
  account?: AccountView;
  // Management disable is logical denial. This SDK supplies no erasure/transport cleanup proof.
  cleanup: "unresolved";
};
export type AccountIntent = {
  kind: "connect" | "rename" | "reconnect" | "disable";
  nonce: string;
  connectionId?: string;
  profileId?: string;
  label?: string;
  gatewayRevision?: number;
  mirrorRevision?: number;
};
export type AccountsBootstrap = {
  context: string;
  page: AccountsResult<AccountsPage>;
};

type Authority = { workspaceId: string; actor: WorkspaceAccountActor };
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const label = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((v) => !/[\x00-\x1f\x7f]/.test(v));
const mirrorRevision = z.number().int().min(1).max(2147483646);
const existing = {
  connectionId: c.reference,
  gatewayRevision: c.revision,
  mirrorRevision,
};
const intentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("connect"),
    nonce: uuid,
    profileId: c.reference,
    label,
  }),
  z.strictObject({
    kind: z.literal("rename"),
    nonce: uuid,
    ...existing,
    label,
  }),
  z.strictObject({ kind: z.literal("reconnect"), nonce: uuid, ...existing }),
  z.strictObject({ kind: z.literal("disable"), nonce: uuid, ...existing }),
]);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
function ownerRef(workspaceId: string) {
  return `rrw_${hash(`rr-workspace-owner-v1\0${workspaceId}`)}`;
}
function operationRef(owner: string, nonce: string) {
  // ALL intents share this namespace: reusing a nonce with changed intent conflicts at the gateway.
  return `rrc3_${hash(owner).slice(0, 48)}_${uuid.parse(nonce)}`;
}
class Denied extends Error {}
function safeFailure(error: unknown): AccountsResult<never> {
  if (error instanceof Denied) return { status: "denied" };
  if (error instanceof z.ZodError) return { status: "invalid" };
  if (error instanceof ProviderAccountError)
    return {
      status:
        error.code === "revision_conflict"
          ? "conflict"
          : error.code === "invalid_input"
            ? "invalid"
            : "denied",
    };
  if (error instanceof GatewayError && error.diagnostic?.code === "conflict")
    return { status: "conflict" };
  // Neither SDK diagnostics nor exception messages cross our server boundary.
  return { status: "unavailable" };
}

/** Consumer-owned server adapter; authorize must resolve stable session + workspace and live admin.
 * No credential/intent ledger. Actual HTTP effects are performed only by the pinned SDK.
 */
export function createAccountsAdapter(input: {
  authorize(context: string): Promise<Authority>;
  gateway: ManagementClient;
  accounts: ProviderAccountAccountsQueryPort;
  synchronization: ProviderAccountSynchronizationPort;
  bindingDependencies: ProviderAccountDependencies;
  apiKeyProfiles: ReadonlyMap<string, "MiMo" | "OpenRouter">;
}) {
  const { gateway, accounts, synchronization, bindingDependencies } = input;
  const approved = new Map(input.apiKeyProfiles);
  async function authorize(context: string) {
    try {
      const authority = await input.authorize(
        z.string().min(1).max(2048).parse(context),
      );
      return {
        workspaceId: authority.workspaceId,
        actor: { ...authority.actor },
        owner: ownerRef(authority.workspaceId),
      };
    } catch {
      throw new Denied();
    }
  }
  function scoped(
    context: string,
    authority: Awaited<ReturnType<typeof authorize>>,
    onEnter?: () => Promise<void>,
  ) {
    async function checked<T>(
      call: () => Promise<T>,
      mutation = false,
    ): Promise<T> {
      const live = await authorize(context);
      if (
        live.workspaceId !== authority.workspaceId ||
        live.actor.userId !== authority.actor.userId
      )
        throw new Denied();
      if (mutation) await onEnter?.();
      return call();
    }
    return {
      profiles: () => checked(() => gateway.profiles()),
      list: (query: c.ListQuery) => checked(() => gateway.list(query)),
      get: (ref: string) => checked(() => gateway.get(ref)),
      connect: (request: Parameters<ManagementClient["connect"]>[0]) =>
        checked(() => gateway.connect(request), true),
      rename: (ref: string, request: c.Rename) =>
        checked(() => gateway.rename(ref, request), true),
      reconnect: (
        ref: string,
        request: Parameters<ManagementClient["reconnect"]>[1],
      ) => checked(() => gateway.reconnect(ref, request), true),
      disable: (ref: string, request: c.Disable) =>
        checked(() => gateway.disable(ref, request), true),
      operation: (ref: string) => checked(() => gateway.operation(ref)),
    };
  }
  type ScopedClient = ReturnType<typeof scoped>;
  async function profiles(client: ScopedClient): Promise<AccountProfileView[]> {
    const catalogue = await client.profiles();
    return catalogue.profiles
      .filter(
        (p) => approved.has(p.profileId) && p.authKinds.includes("api_key"),
      )
      .map((p) => ({
        id: p.profileId,
        label: approved.get(p.profileId)!,
        protocol: p.protocol,
        models: [...p.modelIds],
      }));
  }
  function verified(
    account: c.Account,
    authority: Awaited<ReturnType<typeof authorize>>,
    catalogue: AccountProfileView[],
  ) {
    if (
      account.ownerRef !== authority.owner ||
      !catalogue.some((p) => p.id === account.profileId)
    )
      throw new Denied();
    // The C1 mirror has a stricter friendly-label bound than the wire catalogue.
    label.parse(account.displayName);
    return account;
  }
  async function synchronize(
    authority: Awaited<ReturnType<typeof authorize>>,
    account: c.Account,
    prior: ProviderAccountConnection | null,
    op: string | null,
  ) {
    const metadata = {
      gatewayOperationRef: op ?? prior?.gatewayOperationRef ?? null,
      profileRef: account.profileId,
      displayName: account.displayName,
      state:
        account.state === "active"
          ? ("active" as const)
          : account.state === "staging"
            ? ("pending" as const)
            : account.state === "disabled" || account.state === "tombstoned"
              ? ("disabled" as const)
              : ("quarantined" as const),
    };
    if (!prior)
      return synchronization.recordWorkspaceConnection({
        id: `agc_${hash(`${authority.owner}\0${account.accountRef}`).slice(0, 60)}`,
        workspaceId: authority.workspaceId,
        gatewayAccountRef: account.accountRef,
        ...metadata,
      });
    if (
      prior.gatewayAccountRef !== account.accountRef ||
      prior.owner.kind !== "workspace" ||
      prior.owner.workspaceId !== authority.workspaceId
    )
      throw new Denied();
    if (
      prior.displayName === metadata.displayName &&
      prior.profileRef === metadata.profileRef &&
      prior.state === metadata.state &&
      prior.gatewayOperationRef === metadata.gatewayOperationRef
    )
      return prior;
    // Capture prior BEFORE gateway GET. A delayed response cannot overwrite a newer mirror CAS.
    return synchronization.synchronizeMetadata({
      workspaceId: authority.workspaceId,
      connectionId: prior.id,
      expectedRevision: prior.metadataRevision,
      ...metadata,
    });
  }
  async function view(
    authority: Awaited<ReturnType<typeof authorize>>,
    account: c.Account,
    mirror: ProviderAccountConnection,
    catalogue: AccountProfileView[],
  ): Promise<AccountView> {
    const binding = await accounts.findConnectionBinding({
      workspaceId: authority.workspaceId,
      connectionId: mirror.id,
    });
    return {
      connectionId: mirror.id,
      label: account.displayName,
      profileId: account.profileId,
      profileLabel: catalogue.find((p) => p.id === account.profileId)!.label,
      state: account.state,
      gatewayRevision: account.metadataRevision,
      mirrorRevision: mirror.metadataRevision,
      binding: binding
        ? {
            revision: binding.revision,
            state: binding.state,
            fencePending: binding.pendingFence !== null,
          }
        : null,
    };
  }
  async function assertCurrentMirror(
    authority: Awaited<ReturnType<typeof authorize>>,
    prior: ProviderAccountConnection,
  ) {
    const live = await accounts.findOwnedConnection({
      workspaceId: authority.workspaceId,
      connectionId: prior.id,
    });
    if (!live || live.gatewayAccountRef !== prior.gatewayAccountRef)
      throw new Denied();
    if (live.metadataRevision !== prior.metadataRevision)
      throw new ProviderAccountError("revision_conflict");
  }
  async function current(
    authority: Awaited<ReturnType<typeof authorize>>,
    connectionId: string,
    catalogue: AccountProfileView[],
    client: ScopedClient,
  ) {
    const prior = await accounts.findOwnedConnection({
      workspaceId: authority.workspaceId,
      connectionId,
    });
    if (!prior) throw new Denied();
    const account = verified(
      await client.get(prior.gatewayAccountRef),
      authority,
      catalogue,
    );
    if (
      account.accountRef !== prior.gatewayAccountRef ||
      account.profileId !== prior.profileRef
    )
      throw new Denied();
    return { prior, account };
  }
  async function projectOperation(
    authority: Awaited<ReturnType<typeof authorize>>,
    nonce: string,
    operation: c.Operation,
    catalogue: AccountProfileView[],
    client: ScopedClient,
    expected?: { accountRef?: string; profileId: string },
  ) {
    if (operation.operationRef !== operationRef(authority.owner, nonce))
      throw new Denied();
    const result: AccountOperationView = {
      nonce,
      state: operation.state,
      cleanup: "unresolved",
    };
    if (operation.state !== "applied") return result;
    if (operation.result?.kind !== "account") throw new Denied();
    const returned = operation.result;
    if (expected?.accountRef && expected.accountRef !== returned.accountRef)
      throw new Denied();
    const prior = await accounts.findOwnedConnectionByGatewayRef({
      workspaceId: authority.workspaceId,
      gatewayAccountRef: returned.accountRef,
    });
    const account = verified(
      await client.get(returned.accountRef),
      authority,
      catalogue,
    );
    if (
      account.accountRef !== returned.accountRef ||
      account.metadataRevision < returned.metadataRevision ||
      account.authorizationEpoch < returned.authorizationEpoch ||
      (expected && expected.profileId !== account.profileId) ||
      (prior && prior.profileRef !== account.profileId)
    )
      throw new Denied();
    result.account = await view(
      authority,
      account,
      await synchronize(authority, account, prior, operation.operationRef),
      catalogue,
    );
    return result;
  }
  async function list(
    context: string,
    cursor: string | null = null,
  ): Promise<AccountsResult<AccountsPage>> {
    try {
      const savedCursor =
        cursor === null ? undefined : c.reference.parse(cursor);
      const authority = await authorize(context);
      const client = scoped(context, authority);
      const catalogue = await profiles(client);
      const page = await client.list({
        ownerRef: authority.owner,
        limit: 25,
        ...(savedCursor ? { cursor: savedCursor } : {}),
      });
      if (page.accounts.length > 25) throw new Denied();
      // Refuse the whole page on an unexpected owner; never project foreign metadata.
      for (const account of page.accounts)
        verified(account, authority, catalogue);
      const rows: AccountView[] = [];
      for (const listed of page.accounts) {
        const prior = await accounts.findOwnedConnectionByGatewayRef({
          workspaceId: authority.workspaceId,
          gatewayAccountRef: listed.accountRef,
        });
        // Re-read after mirror capture; listing is discovery, never synchronization authority.
        const account = verified(
          await client.get(listed.accountRef),
          authority,
          catalogue,
        );
        if (
          account.accountRef !== listed.accountRef ||
          account.profileId !== listed.profileId ||
          account.metadataRevision < listed.metadataRevision ||
          (prior && prior.profileRef !== account.profileId)
        )
          throw new Denied();
        rows.push(
          await view(
            authority,
            account,
            await synchronize(authority, account, prior, null),
            catalogue,
          ),
        );
      }
      return {
        status: "ok",
        value: {
          accounts: rows,
          profiles: catalogue,
          nextCursor: page.nextCursor ?? null,
        },
      };
    } catch (error) {
      return safeFailure(error);
    }
  }
  async function mutate(
    context: string,
    raw: AccountIntent,
    credential?: string,
  ): Promise<AccountsResult<AccountOperationView>> {
    let entered = false;
    let savedNonce: string | undefined;
    try {
      const intent = intentSchema.parse(raw); // primitive snapshot before ANY await
      const key =
        intent.kind === "connect" || intent.kind === "reconnect"
          ? z.string().min(1).max(16384).parse(credential)
          : undefined;
      if (key === undefined && credential !== undefined) throw new Denied();
      const authority = await authorize(context);
      const id = operationRef(authority.owner, intent.nonce);
      let effectConnection: ProviderAccountConnection | undefined;
      const client = scoped(context, authority, async () => {
        if (effectConnection)
          await assertCurrentMirror(authority, effectConnection);
        entered = true;
        savedNonce = intent.nonce;
      });
      const catalogue = await profiles(client);
      let operation: c.Operation;
      let expected: { accountRef?: string; profileId: string } | undefined;
      if (intent.kind === "connect") {
        if (!catalogue.some((p) => p.id === intent.profileId))
          throw new Denied();
        expected = { profileId: intent.profileId };
        operation = await client.connect({
          operationId: id,
          ownerRef: authority.owner,
          profileId: intent.profileId,
          displayName: intent.label,
          credential: { kind: "api_key", value: key! },
        });
      } else {
        const { prior, account } = await current(
          authority,
          intent.connectionId,
          catalogue,
          client,
        );
        if (
          prior.metadataRevision !== intent.mirrorRevision ||
          account.metadataRevision !== intent.gatewayRevision
        )
          return { status: "conflict" };
        effectConnection = prior;
        await assertCurrentMirror(authority, prior);
        expected = {
          accountRef: account.accountRef,
          profileId: account.profileId,
        };
        if (account.state === "tombstoned") throw new Denied();
        if (intent.kind === "disable") {
          const binding = await accounts.findConnectionBinding({
            workspaceId: authority.workspaceId,
            connectionId: prior.id,
          });
          if (binding?.state === "active")
            await revokeWorkspaceAccountBinding(
              {
                workspaceId: authority.workspaceId,
                connectionId: prior.id,
                actor: authority.actor,
                expectedRevision: binding.revision,
              },
              bindingDependencies,
            );
        }
        const revision = {
          operationId: id,
          expectedMetadataRevision: account.metadataRevision,
        };
        operation =
          intent.kind === "rename"
            ? await client.rename(account.accountRef, {
                ...revision,
                displayName: intent.label,
              })
            : intent.kind === "reconnect"
              ? await client.reconnect(account.accountRef, {
                  ...revision,
                  credential: { kind: "api_key", value: key! },
                })
              : await client.disable(account.accountRef, revision);
      }
      const projected = await projectOperation(
        authority,
        intent.nonce,
        operation,
        catalogue,
        client,
        expected,
      );
      return { status: "ok", value: projected };
    } catch (error) {
      // Once POST may have entered, lost ACK/invalid response/mirror failure is readback only.
      if (
        entered &&
        savedNonce &&
        !(
          error instanceof GatewayError &&
          error.code === "safe_error" &&
          error.effect === "not_dispatched"
        )
      ) {
        return {
          status: "ok",
          value: { nonce: savedNonce, state: "unknown", cleanup: "unresolved" },
        };
      }
      return safeFailure(error);
    }
  }
  async function operation(
    context: string,
    rawNonce: string,
  ): Promise<AccountsResult<AccountOperationView>> {
    let nonce: string | undefined;
    try {
      nonce = uuid.parse(rawNonce);
      const authority = await authorize(context);
      const client = scoped(context, authority);
      const catalogue = await profiles(client);
      return {
        status: "ok",
        value: await projectOperation(
          authority,
          nonce,
          await client.operation(operationRef(authority.owner, nonce)),
          catalogue,
          client,
        ),
      };
    } catch (error) {
      if (
        nonce &&
        error instanceof GatewayError &&
        error.effect === "effect_unknown"
      )
        return {
          status: "ok",
          value: { nonce, state: "unknown", cleanup: "unresolved" },
        };
      return safeFailure(error);
    }
  }
  async function bind(
    context: string,
    raw: {
      connectionId: string;
      mirrorRevision: number;
      gatewayRevision: number;
      bindingRevision: number;
    },
  ): Promise<AccountsResult<{ label: string }>> {
    try {
      const intent = z
        .strictObject({
          ...existing,
          bindingRevision: z.number().int().min(0).max(2147483646),
        })
        .parse(raw);
      const authority = await authorize(context);
      const client = scoped(context, authority);
      const catalogue = await profiles(client);
      const { prior, account } = await current(
        authority,
        intent.connectionId,
        catalogue,
        client,
      );
      if (
        prior.metadataRevision !== intent.mirrorRevision ||
        account.metadataRevision !== intent.gatewayRevision
      )
        return { status: "conflict" };
      if (account.state !== "active") throw new Denied();
      const mirror = await synchronize(authority, account, prior, null);
      const scope = {
        workspaceId: authority.workspaceId,
        connectionId: mirror.id,
      };
      let binding = await accounts.findConnectionBinding(scope);
      if ((binding?.revision ?? 0) !== intent.bindingRevision)
        return { status: "conflict" };
      if (binding?.pendingFence) throw new Denied();
      if (binding?.state !== "active")
        binding = await bindWorkspaceAccount(
          {
            ...scope,
            actor: authority.actor,
            expectedRevision: intent.bindingRevision,
          },
          bindingDependencies,
        );
      await resolveWorkspaceAccountBinding(
        {
          workspaceId: authority.workspaceId,
          bindingId: binding.id,
          actor: authority.actor,
        },
        bindingDependencies,
      );
      return { status: "ok", value: { label: account.displayName } };
    } catch (error) {
      return safeFailure(error);
    }
  }
  return { list, mutate, operation, bind };
}

// One server-configured origin/management role. Never read a caller URL/token/native ID.
function configuration() {
  const origin =
    process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? "";
  const token =
    process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? "";
  const contextKey =
    process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ACCOUNTS_CONTEXT_SECRET ?? "";
  if (contextKey.length < 32) throw new Error("accounts_unavailable");
  const apiKeyProfiles = new Map<string, "MiMo" | "OpenRouter">();
  for (const [value, name] of [
    [process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MIMO_PROFILE_ID, "MiMo"],
    [
      process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_OPENROUTER_PROFILE_ID,
      "OpenRouter",
    ],
  ] as const)
    if (value) {
      c.reference.parse(value);
      if (apiKeyProfiles.has(value)) throw new Error("accounts_unavailable");
      apiKeyProfiles.set(value, name);
    }
  if (!apiKeyProfiles.size) throw new Error("accounts_unavailable");
  return {
    contextKey,
    apiKeyProfiles,
    gateway: createManagementClient({
      role: "management",
      origin,
      token,
      timeoutMs: 10000,
      responseBytes: 65536,
    }),
  };
}
function contextSignature(body: string, key: string) {
  return createHmac("sha256", key)
    .update(`rr-c3-accounts-context-v1\0${body}`)
    .digest("base64url");
}
async function production() {
  const settings = configuration();
  const { getPrisma } = await import("./prisma");
  const { assertDashboardWorkspaceAdminAllowed, getDashboardSignedInActor } =
    await import("./dashboard-mutations");
  const prisma = getPrisma();
  const accounts = new PrismaProviderAccountRepository(prisma);
  const access = new PrismaWorkspaceAccessRepository(prisma);
  const adapter = createAccountsAdapter({
    ...settings,
    accounts,
    synchronization: new PrismaProviderAccountSynchronization(prisma),
    bindingDependencies: {
      accounts,
      workspaceAccess: access,
      localAdminGithubLogins: (
        process.env.REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS ?? ""
      )
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    },
    async authorize(context) {
      const [body, signature, extra] = context.split(".");
      if (!body || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(body))
        throw new Denied();
      const expected = Buffer.from(contextSignature(body, settings.contextKey));
      const actual = Buffer.from(signature);
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Denied();
      const saved = z
        .strictObject({ workspaceId: c.reference, userId: c.reference })
        .parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
      const currentActor = await getDashboardSignedInActor();
      if (!currentActor || currentActor.userId !== saved.userId)
        throw new Denied();
      const workspace = await prisma.workspace.findUnique({
        where: { id: saved.workspaceId },
        select: { id: true },
      });
      if (!workspace) throw new Denied();
      const actor = await assertDashboardWorkspaceAdminAllowed(workspace.id);
      if (actor.userId !== saved.userId) throw new Denied();
      return {
        workspaceId: workspace.id,
        actor: {
          userId: actor.userId,
          githubUserId: actor.githubUserId ?? "",
          githubLogin: actor.githubLogin ?? "",
        },
      };
    },
  });
  return { adapter, settings, assertDashboardWorkspaceAdminAllowed, prisma };
}
export async function loadAccountsBootstrap(
  workspaceId: string,
): Promise<AccountsBootstrap> {
  try {
    const { adapter, settings, assertDashboardWorkspaceAdminAllowed, prisma } =
      await production();
    // RSC's selected Workspace.id is authoritative, never a slug/login-derived owner.
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    });
    if (!workspace) throw new Denied();
    const actor = await assertDashboardWorkspaceAdminAllowed(
      workspace.id,
    ).catch(() => {
      throw new Denied();
    });
    const body = Buffer.from(
      JSON.stringify({ workspaceId: workspace.id, userId: actor.userId }),
    ).toString("base64url");
    const context = `${body}.${contextSignature(body, settings.contextKey)}`;
    return { context, page: await adapter.list(context) };
  } catch (error) {
    return { context: "", page: safeFailure(error) };
  }
}
export async function accountsServerAdapter() {
  return (await production()).adapter;
}
