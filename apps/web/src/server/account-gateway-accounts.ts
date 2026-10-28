import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createManagementClient,
  createConsumerControlClient,
  type ConsumerControlConfig,
  GatewayError,
  type ManagementClient,
  secretSubmission,
} from "@agent-teams/account-gateway/http";
import {
  bindWorkspaceAccount,
  changeOperatorWorkspaceAccountGrant,
  revokeWorkspaceAccountBinding,
  reconcileWorkspaceBindingFences,
  resolveWorkspaceAccountBinding,
  ProviderAccountError,
  PrismaProviderAccountRepository,
  type ProviderAccountAccountsQueryPort,
  type PersonalAccountOperationStore,
  type PersonalOperationResult,
  type ProviderAccountConnection,
  type ProviderAccountDependencies,
  type WorkspaceAccountActor,
  type WorkspaceBindingFenceRepositoryPort,
  type ScopedBindingFence,
  type SafeBindingTuple,
} from "@reviewrouter/features-provider-accounts";
import {
  PrismaProviderAccountSynchronization,
  connectPersonalAccount,
  readPersonalAccountOperation,
  attachPersonalAccount,
  snapshotPersonalIntent,
  personalOperationId,
  personalIntentDigest,
  type PersonalAccountIntent,
  type ProviderAccountSynchronizationPort,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { PrismaWorkspaceAccessRepository } from "@reviewrouter/features-auth";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import { z } from "zod";
import {
  canonicalMimoBaseURL,
  suggestedAccountLabel,
} from "../features/account-gateway/connection-options";
import type { AccountUsageView } from "./account-usage";
import type { AccountLimitsView } from "@reviewrouter/features-provider-accounts";
export type { AccountLimitsView } from "@reviewrouter/features-provider-accounts";
import {
  createAccountLimitsService,
  type AccountLimitsService,
} from "./account-limits-service";
import { accountLimitsReader } from "./account-limits-composition";
import {
  connectionProfiles,
  configuredSubscriptionProfiles,
  operationCompletion,
} from "./account-connection-catalog";

// This module is imported at runtime only by RSC/server actions. Client imports are type-only.
export type AccountsResult<T> =
  | { status: "ok"; value: T }
  | {
      status: "denied" | "conflict" | "invalid" | "unavailable";
    };

export type AccountProfileView = {
  availability?: "enabled" | "deployment_configuration_required" | undefined;
  id: string;
  label: string;
  protocol: c.Profile["protocol"];
  models: string[];
  connection?:
    | import("../features/account-gateway/connection-capabilities").AccountConnectionView
    | undefined;
  // Trusted configured vendor; never derived from an editable account label.
  provider?: import("@reviewrouter/features-review-providers").ProviderKind;
  // Additive display fields; older safe bootstrap consumers may omit them.
  // The authorized adapter always supplies both from its configured catalog.
  authKind?: c.Profile["authKinds"][number];
  canReconnect?: boolean;
  oauthMethods?: readonly ("device_code" | "browser")[];
  // Trusted deployment binding to the Gateway's fixed profile, never a caller override.
  dedicatedBaseURL?: string;
};
export type AccountAllowedAction =
  | "rename"
  | "reconnect"
  | "retire"
  | "detach"
  | "access"
  | "checkStatus"
  | "suspend"
  | "resume"
  | "delete";
export type AccountOwnerView =
  | {
      kind: "personal";
      isViewer: boolean;
      handle: string | null;
      avatarUrl: string | null;
    }
  | { kind: "organization"; label: string; avatarUrl: string | null }
  | { kind: "operator"; label: string };
export type AccountView = {
  /** Trusted configured vendor fallback; connection.provider is the upstream when available. */
  provider?: AccountProfileView["provider"];
  modelCatalog?: import("../features/account-gateway/connection-capabilities").AccountModelCatalogView;
  connection?: AccountProfileView["connection"];
  origin?: "organization" | "personal" | "operator";
  // Display-only identity fact; never permission to manage a shared source.
  isOwnedByViewer?: boolean;
  canManage?: boolean;
  owner?: AccountOwnerView;
  allowedActions?: readonly AccountAllowedAction[];
  connectionId: string;
  label: string;
  profileId: string;
  profileLabel: string;
  authKind?: NonNullable<AccountProfileView["authKind"]>;
  state: c.Account["state"] | "suspended";
  authorizationEpoch?: number;
  lifecycle?: {
    status: "available" | "pending" | "support_required" | "unavailable";
    operationId?: string;
    action?: "suspend" | "resume" | "delete";
  };
  readiness?: "ready" | "pending" | "unavailable" | "unknown";
  gatewayRevision: number;
  mirrorRevision: number;
  binding: {
    id: string;
    revision: number;
    state: "active" | "revoked";
    fencePending: boolean;
  } | null;
  // Optional display projection; older safe bootstrap consumers may omit it.
  usage?: AccountUsageView;
  limits?: AccountLimitsView;
};
export type AccountsPage = {
  canGrantOperatorUse?: boolean;
  accounts: AccountView[];
  profiles: AccountProfileView[];
  nextCursor: string | null;
};
export type AccountOperationView = {
  nonce: string;
  state: c.Operation["state"];
  oauthMethod?: "device_code" | "browser";
  completion?: {
    providerLabel: string;
    providerId?:
      | import("../features/provider-setup/provider-identity").ProviderIdentity
      | undefined;
    inputKind: "none" | "callback_url" | "authorization_code";
    personalOnly?: boolean;
  };
  account?: AccountView;
  // Original safe reconnect fields, present only after durable fences are ready.
  // A continuation re-enters a credential using this same nonce.
  resume?: {
    kind: "reconnect";
    connectionId: string;
    profileId: string;
    gatewayRevision: number;
    mirrorRevision: number;
  };
  // Management disable is logical denial. This SDK supplies no erasure/transport cleanup proof.
  cleanup: "unresolved";
};
export type AccountOAuthIntent = Pick<c.OAuthBegin, "profileId" | "method"> & {
  nonce: string;
  label?: string;
};
export type AccountOAuthReconnectIntent = {
  method?: "device_code" | "browser";
  nonce: string;
  connectionId: string;
  gatewayRevision: number;
  mirrorRevision: number;
};
export type AccountOAuthCompletion = z.infer<typeof oauthCompletionSchema>;
// A fresh Begin response is a one-off handoff, never list/operation/cache metadata.
export type AccountOAuthBeginView = {
  operation: AccountOperationView;
  authorizationURL?: string;
  deviceAuthorization?: c.OAuthBeginResponse["deviceAuthorization"];
};
export type AccountIntent = {
  kind: "connect" | "rename" | "reconnect" | "disable";
  nonce: string;
  connectionId?: string;
  profileId?: string;
  label?: string;
  baseURL?: string;
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
  .refine((v) =>
    Array.from(v).every(
      (character) =>
        character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127,
    ),
  );
const mirrorRevision = z.number().int().min(1).max(2147483646);
const existing = {
  connectionId: c.reference,
  gatewayRevision: c.revision,
  mirrorRevision,
};
const codexOAuthProfileId = "openai-codex-oauth-responses-v1";
const claudeOAuthProfileId = "anthropic-claude-oauth-messages-v1";
function oauthMethodFor(
  profile: Pick<AccountProfileView, "oauthMethods">,
  requested?: "device_code" | "browser",
) {
  const allowed = profile.oauthMethods ?? ["device_code", "browser"];
  const method = requested ?? allowed[0];
  if (!method || !allowed.includes(method)) throw new Denied();
  return method;
}
const oauthIntentSchema = z.strictObject({
  nonce: uuid,
  profileId: c.reference,
  label,
  method: z.enum(["device_code", "browser"]).optional(),
});
const oauthBeginIntentSchema = z.union([
  oauthIntentSchema.extend({
    label: label.or(z.string().trim().length(0)).optional(),
  }),
  z.strictObject({
    nonce: uuid,
    ...existing,
    method: z.enum(["device_code", "browser"]).optional(),
  }),
]);
// The SDK owns the closed credential grammars. Snapshot before any await;
// no URL/code/state is retained in an intent or safe view.
const oauthCredentialCompletionSchema = z.union([
  z.strictObject({
    nonce: uuid,
    callbackURL: z
      .string()
      .refine(
        (value) =>
          secretSubmission.oauthCallbackURL.safeParse(value).success ||
          secretSubmission.grokOAuthCallbackURL.safeParse(value).success,
      ),
  }),
  z.strictObject({
    nonce: uuid,
    authorizationCode: z
      .string()
      .refine(
        (value) =>
          secretSubmission.claudeOAuthAuthorizationCode.safeParse(value)
            .success ||
          secretSubmission.grokOAuthAuthorizationCode.safeParse(value).success,
      ),
  }),
]);
const oauthCompletionSchema = z.union([
  oauthCredentialCompletionSchema,
  z.strictObject({
    nonce: uuid,
    authorizationResult: z.string().min(1).max(8257),
  }),
]);
type NormalizedOAuthCompletion = z.infer<
  typeof oauthCredentialCompletionSchema
>;
function oauthCompletionCredential(intent: NormalizedOAuthCompletion) {
  return "authorizationCode" in intent
    ? { authorizationCode: intent.authorizationCode }
    : { callbackURL: intent.callbackURL };
}
/** Credential authority comes from the saved profile, never from the pasted value. */
export function oauthCompletionMatchesProfile(
  profile: Pick<AccountProfileView, "id" | "label" | "connection">,
  completion: NormalizedOAuthCompletion | { nonce: string },
): boolean {
  const kind = operationCompletion(profile).inputKind;
  if (kind === "none") return false;
  if (profile.connection?.provider === "grok") {
    return "authorizationCode" in completion
      ? secretSubmission.grokOAuthAuthorizationCode.safeParse(
          completion.authorizationCode,
        ).success
      : "callbackURL" in completion &&
          secretSubmission.grokOAuthCallbackURL.safeParse(
            completion.callbackURL,
          ).success;
  }
  return kind === "authorization_code"
    ? "authorizationCode" in completion &&
        secretSubmission.claudeOAuthAuthorizationCode.safeParse(
          completion.authorizationCode,
        ).success
    : "callbackURL" in completion &&
        secretSubmission.oauthCallbackURL.safeParse(completion.callbackURL)
          .success;
}
export function snapshotOAuthCompletion(
  raw: AccountOAuthCompletion,
): NormalizedOAuthCompletion {
  const captured = oauthCompletionSchema.parse(raw);
  if (!("authorizationResult" in captured)) return captured;
  // Legacy pending operation DTOs omit profile metadata. Decode only the closed
  // SDK credential representation; the Gateway still selects the saved profile.
  const { nonce, authorizationResult } = captured;
  const callback =
    secretSubmission.oauthCallbackURL.safeParse(authorizationResult).success ||
    secretSubmission.grokOAuthCallbackURL.safeParse(authorizationResult)
      .success;
  return oauthCredentialCompletionSchema.parse(
    callback
      ? { nonce, callbackURL: authorizationResult }
      : { nonce, authorizationCode: authorizationResult },
  );
}
const intentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("connect"),
    nonce: uuid,
    profileId: c.reference,
    label: label.or(z.string().trim().length(0)).optional(),
    baseURL: z.string().max(2048).optional(),
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
export function accountGatewayWorkspaceOwnerRef(workspaceId: string) {
  return `rrw_${hash(`rr-workspace-owner-v1\0${workspaceId}`)}`;
}
export function accountGatewayUserOwnerRef(userId: string) {
  c.reference.parse(userId);
  return `rru_${hash(`rr-user-owner-v1\0${userId}`)}`;
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
  limits?(context: string): Promise<AccountLimitsService>;
  authorize(context: string): Promise<Authority>;
  gateway: ManagementClient;
  accounts: ProviderAccountAccountsQueryPort;
  synchronization: ProviderAccountSynchronizationPort;
  bindingDependencies: ProviderAccountDependencies;
  fences?: WorkspaceBindingFenceRepositoryPort;
  apiKeyProfiles: ReadonlyMap<string, "MiMo" | "OpenRouter">;
  apiKeyProfileBaseURLs?: ReadonlyMap<string, string>;
  codexOAuthProfileId?: typeof codexOAuthProfileId;
  claudeOAuthProfileId?: typeof claudeOAuthProfileId;
}) {
  const { gateway, accounts, synchronization, bindingDependencies } = input;
  const approved = new Map<
    string,
    Required<
      Pick<
        AccountProfileView,
        "label" | "authKind" | "canReconnect" | "provider"
      >
    > &
      Pick<AccountProfileView, "dedicatedBaseURL" | "oauthMethods">
  >(
    [...input.apiKeyProfiles].map(([id, name]) => [
      id,
      {
        label: name,
        provider: name === "MiMo" ? "codex-mimo" : "openrouter",
        authKind: "api_key",
        canReconnect: true,
      },
    ]),
  );
  for (const [id, raw] of input.apiKeyProfileBaseURLs ?? []) {
    const configured = approved.get(id);
    const baseURL = canonicalMimoBaseURL(raw);
    if (configured?.label !== "MiMo" || !baseURL)
      throw new Error("accounts_unavailable");
    configured.dedicatedBaseURL = baseURL;
  }
  if (input.codexOAuthProfileId !== undefined) {
    z.literal(codexOAuthProfileId).parse(input.codexOAuthProfileId);
    if (approved.has(codexOAuthProfileId))
      throw new Error("accounts_unavailable");
    approved.set(codexOAuthProfileId, {
      label: "Codex",
      provider: "codex",
      authKind: "oauth",
      canReconnect: true,
      oauthMethods: ["device_code", "browser"],
    });
  }
  if (input.claudeOAuthProfileId !== undefined) {
    z.literal(claudeOAuthProfileId).parse(input.claudeOAuthProfileId);
    if (approved.has(claudeOAuthProfileId))
      throw new Error("accounts_unavailable");
    approved.set(claudeOAuthProfileId, {
      label: "Claude",
      provider: "claude",
      authKind: "oauth",
      canReconnect: true,
      oauthMethods: ["browser"],
    });
  }
  async function deliverBindingFence(scope: {
    workspaceId: string;
    connectionId: string;
  }) {
    const binding = await accounts.findConnectionBinding(scope);
    if (!binding) return "remote_pending" as const;
    if (!binding.pendingFence)
      return binding.state === "revoked" &&
        binding.fenceAck?.policyRevision === binding.policyRevision
        ? ("remote_applied" as const)
        : ("remote_pending" as const);
    if (!input.fences) return "remote_pending" as const;
    const receipt = (operation: c.Operation, intent: ScopedBindingFence) => {
      const ack = c.acknowledgementOperation.parse(operation);
      return ack.state === "applied" && ack.operationRef === intent.operationId
        ? {
            state: "applied" as const,
            operationId: intent.operationId,
            policySubject: intent.policySubject,
            policyRevision: intent.policyRevision,
          }
        : { state: "unknown" as const };
    };
    const result = await reconcileWorkspaceBindingFences(
      { limit: 1 },
      {
        accounts: {
          listPendingBindingFences: async () => [binding],
          acknowledgeBindingFence: (intent) =>
            input.fences!.acknowledgeBindingFence(intent),
        },
        delivery: {
          submitFence: async (intent) =>
            receipt(
              await gateway.fence({
                operationId: intent.operationId,
                subjectRef: intent.policySubject,
                revision: intent.policyRevision,
              }),
              intent,
            ),
          readFenceOperation: async (intent) =>
            receipt(await gateway.operation(intent.operationId), intent),
        },
      },
    );
    return result.results[0]?.remoteFenceDelivery ?? "remote_pending";
  }
  async function authorize(context: string) {
    try {
      const authority = await input.authorize(
        z.string().min(1).max(2048).parse(context),
      );
      return {
        workspaceId: authority.workspaceId,
        actor: { ...authority.actor },
        owner: accountGatewayWorkspaceOwnerRef(authority.workspaceId),
      };
    } catch {
      throw new Denied();
    }
  }
  async function isOperatorAdmin(
    authority: Awaited<ReturnType<typeof authorize>>,
  ) {
    if (authority.workspaceId !== bindingDependencies.operatorWorkspaceId)
      return false;
    const role = authority.actor.userId
      ? await bindingDependencies.workspaceAccess.findWorkspaceRoleByUserId({
          workspaceId: authority.workspaceId,
          userId: authority.actor.userId,
        })
      : await bindingDependencies.workspaceAccess.findWorkspaceRoleByGitHubUserId(
          {
            workspaceId: authority.workspaceId,
            githubUserId: authority.actor.githubUserId,
          },
        );
    return role === "owner" || role === "admin";
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
        live.actor.userId !== authority.actor.userId ||
        live.actor.githubUserId !== authority.actor.githubUserId
      )
        throw new Denied();
      if (mutation) await onEnter?.();
      return call();
    }
    return {
      profiles: () => checked(() => gateway.profiles()),
      ...(gateway.getProviderConnectionCapabilities
        ? {
            getProviderConnectionCapabilities: () =>
              checked(() => gateway.getProviderConnectionCapabilities()),
          }
        : {}),
      list: (query: c.ListQuery) => checked(() => gateway.list(query)),
      get: (ref: string) => checked(() => gateway.get(ref)),
      connect: (request: Parameters<ManagementClient["connect"]>[0]) =>
        checked(() => gateway.connect(request), true),
      beginOAuth: (request: c.OAuthBegin) =>
        checked(() => gateway.beginOAuth(request), true),
      beginOAuthReconnect: (ref: string, request: c.OAuthReconnect) =>
        checked(() => gateway.beginOAuthReconnect(ref, request), true),
      completeOAuth: (request: secretSubmission.OAuthComplete) =>
        checked(() => gateway.completeOAuth(request), true),
      pollDeviceOAuth: (
        request: Parameters<ManagementClient["pollDeviceOAuth"]>[0],
      ) => checked(() => gateway.pollDeviceOAuth(request), true),
      reauthorize: () => checked(async () => undefined),
      rename: (ref: string, request: c.Rename) =>
        checked(() => gateway.rename(ref, request), true),
      reconnect: (
        ref: string,
        request: Parameters<ManagementClient["reconnect"]>[1],
      ) => checked(() => gateway.reconnect(ref, request), true),
      disable: (ref: string, request: c.Disable) =>
        checked(() => gateway.disable(ref, request), true),
      denyForDisable: (
        request: Parameters<
          ProviderAccountAccountsQueryPort["denyOwnedConnectionForDisable"]
        >[0],
      ) => checked(() => accounts.denyOwnedConnectionForDisable(request)),
      operation: (ref: string) => checked(() => gateway.operation(ref)),
    };
  }
  type ScopedClient = ReturnType<typeof scoped>;
  async function profiles(
    client: Pick<ScopedClient, "profiles"> &
      Partial<
        Pick<ScopedClient, "getProviderConnectionCapabilities" | "reauthorize">
      >,
  ): Promise<AccountProfileView[]> {
    const catalogue = await client.profiles();
    const legacy = catalogue.profiles
      .filter((p) => {
        const configured = approved.get(p.profileId);
        return (
          configured &&
          p.authKinds.includes(configured.authKind) &&
          (!configured.dedicatedBaseURL || p.protocol === "openai-responses") &&
          (configured.authKind !== "oauth" || p.protocol === "openai-responses")
        );
      })
      .map((p) => ({
        id: p.profileId,
        ...approved.get(p.profileId)!,
        protocol: p.protocol,
        models: [...p.modelIds],
      }));
    const result = await connectionProfiles({
      legacy,
      ...(client.getProviderConnectionCapabilities
        ? { capabilities: client.getProviderConnectionCapabilities }
        : {}),
    });
    await client.reauthorize?.();
    return result;
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
      canManage:
        mirror.owner.kind === "workspace" &&
        mirror.owner.workspaceId === authority.workspaceId,
      connectionId: mirror.id,
      label: account.displayName,
      profileId: account.profileId,
      profileLabel: catalogue.find((p) => p.id === account.profileId)!.label,
      provider: catalogue.find((p) => p.id === account.profileId)!.provider,
      connection: catalogue.find((p) => p.id === account.profileId)!.connection,
      authKind: catalogue.find((p) => p.id === account.profileId)!.authKind!,
      state: account.state,
      gatewayRevision: account.metadataRevision,
      mirrorRevision: mirror.metadataRevision,
      binding: binding
        ? {
            id: binding.id,
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
      ...(operation.oauthMethod ? { oauthMethod: operation.oauthMethod } : {}),
      cleanup: "unresolved",
    };
    const profile = expected
      ? catalogue.find((row) => row.id === expected.profileId)
      : undefined;
    if (
      profile?.authKind === "oauth" &&
      operation.oauthMethod !== "device_code"
    )
      result.completion = operationCompletion(profile);
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
      const grantCursor = savedCursor?.startsWith("rrgrant_")
        ? savedCursor.slice(8)
        : undefined;
      const page = grantCursor
        ? { accounts: [], nextCursor: null }
        : await client.list({
            ownerRef: authority.owner,
            limit: 25,
            ...(savedCursor ? { cursor: savedCursor } : {}),
          });
      if (page.accounts.length > 25) throw new Denied();
      // Refuse the whole page on an unexpected owner; never project foreign metadata.
      for (const account of page.accounts)
        verified(account, authority, catalogue);
      const rows: AccountView[] = [];
      const operatorBindings = new Map<string, SafeBindingTuple>();
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
      let nextCursor = page.nextCursor ?? null;
      const operatorWorkspaceId = bindingDependencies.operatorWorkspaceId;
      if (
        !nextCursor &&
        operatorWorkspaceId &&
        accounts.listOperatorGrantedBindings
      ) {
        const grants = await accounts.listOperatorGrantedBindings({
          workspaceId: authority.workspaceId,
          limit: 25,
          ...(grantCursor ? { afterBindingId: grantCursor } : {}),
        });
        if (grants.length > 25) throw new Denied();
        for (const grant of grants) {
          // Only explicit live bindings discover foreign metadata. Never list the
          // operator owner's accounts or expose its private owner/native identity.
          if (
            grant.connection.owner.kind !== "workspace" ||
            grant.connection.owner.workspaceId !== operatorWorkspaceId
          )
            throw new Denied();
          if (grant.connection.state !== "active") continue;
          let binding: SafeBindingTuple;
          try {
            binding = await resolveWorkspaceAccountBinding(
              {
                workspaceId: authority.workspaceId,
                bindingId: grant.binding.id,
                actor: authority.actor,
              },
              bindingDependencies,
            );
          } catch (error) {
            if (
              error instanceof ProviderAccountError &&
              ["binding_unavailable", "connection_unavailable"].includes(
                error.code,
              )
            )
              continue;
            throw error;
          }
          const operatorAuthority = {
            ...authority,
            workspaceId: operatorWorkspaceId,
            owner: accountGatewayWorkspaceOwnerRef(operatorWorkspaceId),
          };
          const account = verified(
            await client.get(grant.connection.gatewayAccountRef),
            operatorAuthority,
            catalogue,
          );
          if (
            account.accountRef !== grant.connection.gatewayAccountRef ||
            account.profileId !== grant.connection.profileRef
          )
            throw new Denied();
          const mirror = await synchronize(
            operatorAuthority,
            account,
            grant.connection,
            null,
          );
          // GET can discover owner disable while refreshing the safe mirror.
          if (mirror.state !== "active") continue;
          const projected = await view(authority, account, mirror, catalogue);
          if (
            projected.binding?.state === "active" &&
            !projected.binding.fencePending
          ) {
            rows.push(projected);
            operatorBindings.set(projected.connectionId, binding);
          }
        }
        if (grants.length === 25)
          nextCursor = `rrgrant_${grants[24]!.binding.id}`;
      }
      const canGrantOperatorUse = await isOperatorAdmin(authority);
      const enriched = input.limits
        ? await (await input.limits(context)).page(rows)
        : rows;
      const currentRows: AccountView[] = [];
      // Limits may await other owned accounts. Recheck each operator grant's
      // exact binding lifetime before releasing any of its private metadata.
      for (const row of enriched) {
        const original = operatorBindings.get(row.connectionId);
        if (original) {
          try {
            const current = await resolveWorkspaceAccountBinding(
              {
                workspaceId: authority.workspaceId,
                bindingId: original.bindingId,
                actor: authority.actor,
              },
              bindingDependencies,
            );
            if (JSON.stringify(current) !== JSON.stringify(original)) continue;
          } catch (error) {
            if (
              error instanceof ProviderAccountError &&
              ["binding_unavailable", "connection_unavailable"].includes(
                error.code,
              )
            )
              continue;
            throw error;
          }
        }
        currentRows.push(row);
      }
      await client.reauthorize();
      return {
        status: "ok",
        value: {
          canGrantOperatorUse,
          accounts: currentRows,
          profiles: catalogue,
          nextCursor,
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
        const profile = catalogue.find(
          (p) => p.id === intent.profileId && p.authKind === "api_key",
        );
        if (!profile) throw new Denied();
        if (
          intent.baseURL !== undefined &&
          (!profile.dedicatedBaseURL ||
            canonicalMimoBaseURL(intent.baseURL) !== profile.dedicatedBaseURL)
        )
          throw new Denied();
        expected = { profileId: intent.profileId };
        operation = await client.connect({
          operationId: id,
          ownerRef: authority.owner,
          profileId: intent.profileId,
          displayName: intent.label || suggestedAccountLabel(profile.label),
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
        if (
          intent.kind === "reconnect" &&
          (!catalogue.find((p) => p.id === account.profileId)?.canReconnect ||
            catalogue.find((p) => p.id === account.profileId)?.authKind !==
              "api_key")
        )
          throw new Denied();
        if (intent.kind === "disable") {
          await client.denyForDisable({
            workspaceId: authority.workspaceId,
            connectionId: prior.id,
            expectedMetadataRevision: prior.metadataRevision,
          });
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
  async function beginOAuth(
    context: string,
    raw: AccountOAuthIntent | AccountOAuthReconnectIntent,
  ): Promise<AccountsResult<AccountOAuthBeginView>> {
    let entered = false;
    let nonce: string | undefined;
    try {
      const intent = oauthBeginIntentSchema.parse(raw); // snapshot before any await
      nonce = intent.nonce;
      const authority = await authorize(context);
      let effectConnection: ProviderAccountConnection | undefined;
      const client = scoped(context, authority, async () => {
        if (effectConnection) {
          await assertCurrentMirror(authority, effectConnection);
          await client.reauthorize();
        }
        entered = true;
      });
      const catalogue = await profiles(client);
      let fresh: c.OAuthBeginResponse;
      let expected: { accountRef?: string; profileId: string };
      if ("connectionId" in intent) {
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
        const profile = catalogue.find((p) => p.id === account.profileId);
        if (
          profile?.authKind !== "oauth" ||
          !profile.canReconnect ||
          account.state === "tombstoned"
        )
          throw new Denied();
        effectConnection = prior;
        expected = {
          accountRef: account.accountRef,
          profileId: account.profileId,
        };
        fresh = await client.beginOAuthReconnect(account.accountRef, {
          operationId: operationRef(authority.owner, intent.nonce),
          expectedMetadataRevision: account.metadataRevision,
          method: oauthMethodFor(profile, intent.method),
        });
      } else {
        const profile = catalogue.find(
          (p) => p.id === intent.profileId && p.authKind === "oauth",
        );
        if (!profile) throw new Denied();
        expected = { profileId: intent.profileId };
        fresh = await client.beginOAuth({
          operationId: operationRef(authority.owner, intent.nonce),
          ownerRef: authority.owner,
          profileId: intent.profileId,
          displayName: intent.label || suggestedAccountLabel(profile.label),
          method: oauthMethodFor(profile, intent.method),
        });
      }
      const operation = await projectOperation(
        authority,
        intent.nonce,
        fresh.operation,
        catalogue,
        client,
        expected,
      );
      // Pending projection performs no reads. Explicitly recheck the ORIGINAL live
      // workspace/admin after Begin and all awaited projection before releasing its capability.
      await client.reauthorize();
      return {
        status: "ok",
        value: {
          operation,
          ...(fresh.authorizationURL === undefined
            ? {}
            : { authorizationURL: fresh.authorizationURL }),
          ...(fresh.deviceAuthorization === undefined
            ? {}
            : { deviceAuthorization: fresh.deviceAuthorization }),
        },
      };
    } catch (error) {
      // Permission loss/transport loss after entry cannot claim no effect or lose readback.
      if (entered && nonce)
        return {
          status: "ok",
          value: {
            operation: { nonce, state: "unknown", cleanup: "unresolved" },
          },
        };
      return safeFailure(error);
    }
  }
  async function completeOAuth(
    context: string,
    raw: AccountOAuthCompletion,
  ): Promise<AccountsResult<AccountOperationView>> {
    let entered = false;
    let nonce: string | undefined;
    try {
      const intent = snapshotOAuthCompletion(raw);
      nonce = intent.nonce;
      const authority = await authorize(context);
      const client = scoped(context, authority, async () => {
        entered = true;
      });
      const catalogue = await profiles(client);
      // Input grammar is declared by the configured catalog. The Gateway alone
      // resolves the original durable operation's profile before any exchange.
      if (
        !catalogue.some(
          (profile) =>
            profile.authKind === "oauth" &&
            oauthCompletionMatchesProfile(profile, intent),
        )
      )
        throw new Denied();
      const request = secretSubmission.oauthComplete.parse({
        operationId: operationRef(authority.owner, nonce),
        ownerRef: authority.owner,
        ...oauthCompletionCredential(intent),
      });
      const original = await client.operation(request.operationId);
      if (original.operationRef !== request.operationId) throw new Denied();
      // Only the original pending operation can accept explicit completion.
      // Terminal/unknown readback never enters sensitive ingress again.
      const returned =
        original.state === "pending" && original.oauthMethod !== "device_code"
          ? await client.completeOAuth(request)
          : original;
      await client.reauthorize();
      const result = await projectOperation(
        authority,
        nonce,
        returned,
        catalogue,
        client,
      );
      await client.reauthorize();
      return { status: "ok", value: result };
    } catch (error) {
      if (entered && nonce)
        return {
          status: "ok",
          value: { nonce, state: "unknown", cleanup: "unresolved" },
        };
      return safeFailure(error);
    }
  }
  async function pollOAuth(
    context: string,
    rawNonce: string,
  ): Promise<AccountsResult<AccountOperationView>> {
    let entered = false;
    let nonce: string | undefined;
    try {
      nonce = uuid.parse(rawNonce);
      const authority = await authorize(context);
      const client = scoped(context, authority, async () => {
        entered = true;
      });
      const catalogue = await profiles(client);
      if (!catalogue.some((profile) => profile.authKind === "oauth"))
        throw new Denied();
      const operationId = operationRef(authority.owner, nonce);
      const original = await client.operation(operationId);
      if (
        original.operationRef !== operationId ||
        original.oauthMethod !== "device_code"
      )
        throw new Denied();
      const returned =
        original.state === "pending"
          ? await client.pollDeviceOAuth({
              operationId,
              ownerRef: authority.owner,
            })
          : original;
      await client.reauthorize();
      const result = await projectOperation(
        authority,
        nonce,
        returned,
        catalogue,
        client,
        { profileId: codexOAuthProfileId },
      );
      await client.reauthorize();
      return { status: "ok", value: result };
    } catch (error) {
      if (entered && nonce)
        return {
          status: "ok",
          value: {
            nonce,
            state: "unknown",
            oauthMethod: "device_code",
            cleanup: "unresolved",
          },
        };
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
      const owned = await accounts.findOwnedConnection({
        workspaceId: authority.workspaceId,
        connectionId: intent.connectionId,
      });
      if (!owned && bindingDependencies.operatorWorkspaceId) {
        const binding = await accounts.findConnectionBinding({
          workspaceId: authority.workspaceId,
          connectionId: intent.connectionId,
        });
        if (!binding || binding.revision !== intent.bindingRevision)
          throw new Denied();
        const selected = await resolveWorkspaceAccountBinding(
          {
            workspaceId: authority.workspaceId,
            bindingId: binding.id,
            actor: authority.actor,
          },
          bindingDependencies,
        );
        if (selected.bindingRevision !== intent.bindingRevision)
          return { status: "conflict" };
        const selection = await accounts.findBinding({
          workspaceId: authority.workspaceId,
          bindingId: binding.id,
        });
        if (!selection) throw new Denied();
        const operatorAuthority = {
          ...authority,
          workspaceId: bindingDependencies.operatorWorkspaceId,
          owner: accountGatewayWorkspaceOwnerRef(
            bindingDependencies.operatorWorkspaceId,
          ),
        };
        const account = verified(
          await client.get(selection.connection.gatewayAccountRef),
          operatorAuthority,
          catalogue,
        );
        if (
          account.accountRef !== selection.connection.gatewayAccountRef ||
          account.state !== "active" ||
          account.profileId !== selection.connection.profileRef
        )
          throw new Denied();
        if (
          account.metadataRevision !== intent.gatewayRevision ||
          selection.connection.metadataRevision !== intent.mirrorRevision
        )
          return { status: "conflict" };
        const live = await resolveWorkspaceAccountBinding(
          {
            workspaceId: authority.workspaceId,
            bindingId: binding.id,
            actor: authority.actor,
          },
          bindingDependencies,
        );
        if (
          live.bindingRevision !== selected.bindingRevision ||
          live.policyRevision !== selected.policyRevision
        )
          return { status: "conflict" };
        return { status: "ok", value: { label: account.displayName } };
      }
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
  async function changeGrant(
    context: string,
    raw: {
      workspaceId: string;
      connectionId: string;
      expectedRevision: number;
      state: "active" | "revoked";
    },
  ): Promise<
    AccountsResult<{
      bindingId: string;
      revision: number;
      remoteFenceDelivery: "remote_pending" | "remote_applied" | "not_required";
    }>
  > {
    try {
      const intent = z
        .strictObject({
          workspaceId: c.reference,
          connectionId: c.reference,
          expectedRevision: z.number().int().min(0).max(2147483646),
          state: z.enum(["active", "revoked"]),
        })
        .parse(raw);
      const authority = await authorize(context);
      if (!(await isOperatorAdmin(authority))) throw new Denied();
      if (intent.state === "active") {
        // New authority requires a live owned account read. Revocation commits
        // local denial without waiting on Gateway availability or its catalogue.
        const client = scoped(context, authority);
        const { prior, account } = await current(
          authority,
          intent.connectionId,
          await profiles(client),
          client,
        );
        if (account.state !== "active") throw new Denied();
        await synchronize(authority, account, prior, null);
      }
      const binding = await changeOperatorWorkspaceAccountGrant(
        { ...intent, actor: authority.actor },
        bindingDependencies,
      );
      return {
        status: "ok",
        value: {
          bindingId: binding.id,
          revision: binding.revision,
          remoteFenceDelivery: binding.pendingFence
            ? await deliverBindingFence(intent)
            : "not_required",
        },
      };
    } catch (error) {
      return safeFailure(error);
    }
  }
  async function detach(
    context: string,
    raw: { connectionId: string; expectedRevision: number },
  ): Promise<
    AccountsResult<{ remoteFenceDelivery: "remote_pending" | "remote_applied" }>
  > {
    try {
      const intent = z
        .strictObject({
          connectionId: c.reference,
          expectedRevision: mirrorRevision,
        })
        .parse(raw);
      const authority = await authorize(context);
      await revokeWorkspaceAccountBinding(
        {
          ...intent,
          workspaceId: authority.workspaceId,
          actor: authority.actor,
        },
        bindingDependencies,
      );
      return {
        status: "ok",
        value: {
          remoteFenceDelivery: await deliverBindingFence({
            ...intent,
            workspaceId: authority.workspaceId,
          }),
        },
      };
    } catch (error) {
      return safeFailure(error);
    }
  }
  async function reconcileFence(
    context: string,
    raw: { workspaceId: string; connectionId: string },
  ): Promise<
    AccountsResult<{ remoteFenceDelivery: "remote_pending" | "remote_applied" }>
  > {
    try {
      const scope = z
        .strictObject({ workspaceId: c.reference, connectionId: c.reference })
        .parse(raw);
      const authority = await authorize(context);
      if (scope.workspaceId !== authority.workspaceId) {
        if (!(await isOperatorAdmin(authority))) throw new Denied();
        if (
          !(await accounts.findOwnedConnection({
            ...scope,
            workspaceId: authority.workspaceId,
          }))
        )
          throw new Denied();
      }
      const binding = await accounts.findConnectionBinding(scope);
      if (!binding) throw new Denied();
      if (!binding.pendingFence && !binding.fenceAck) throw new Denied();
      return {
        status: "ok",
        value: {
          remoteFenceDelivery: binding.pendingFence
            ? await deliverBindingFence(scope)
            : "remote_applied",
        },
      };
    } catch (error) {
      return safeFailure(error);
    }
  }
  return {
    async limits(
      context: string,
      connectionId: string,
    ): Promise<AccountsResult<AccountLimitsView>> {
      try {
        await authorize(context);
        if (!input.limits) return { status: "unavailable" };
        return (await input.limits(context)).read(connectionId);
      } catch (error) {
        return safeFailure(error);
      }
    },
    list,
    /**
     * The deployment's approved profiles with their live models. It holds no
     * account or workspace data, so it needs no Accounts context: a provider
     * selection the caller already authorized validates against it.
     */
    reviewCatalog: () =>
      profiles({
        profiles: () => gateway.profiles(),
        ...(gateway.getProviderConnectionCapabilities
          ? {
              getProviderConnectionCapabilities: () =>
                gateway.getProviderConnectionCapabilities(),
            }
          : {}),
      }),
    mutate,
    beginOAuth,
    completeOAuth,
    pollOAuth,
    operation,
    bind,
    changeGrant,
    detach,
    reconcileFence,
  };
}

/** Disabled internal composition/test seam. No public action/API calls this factory. */
export function createDisabledPersonalAccountsAdapter(input: {
  authorizeUser(): Promise<string>;
  store: PersonalAccountOperationStore;
  control: ConsumerControlConfig;
  profiles: ReadonlyMap<string, "api-key-create" | "oauth-begin">;
  connectionProfiles?: readonly Pick<
    AccountProfileView,
    "id" | "label" | "connection" | "oauthMethods"
  >[];
}) {
  const client = createConsumerControlClient(input.control);
  const profiles = new Map(input.profiles);
  for (const [profileId, ingress] of profiles) {
    c.reference.parse(profileId);
    z.enum(["api-key-create", "oauth-begin"]).parse(ingress);
  }
  const gateway = {
    async get(actorUserId: string, accountRef: string, profileId: string) {
      const account = await client.get(accountRef);
      if (
        account.accountRef !== accountRef ||
        account.ownerRef !== accountGatewayUserOwnerRef(actorUserId) ||
        account.profileId !== profileId ||
        !profiles.has(profileId)
      )
        throw new ProviderAccountError("connection_unavailable");
      return account;
    },
    async operation(operationId: string) {
      const operation = await client.operation(operationId);
      return {
        operationId: operation.operationRef,
        state: operation.state,
        ...(operation.state === "applied" &&
        operation.result?.kind === "account"
          ? {
              result: {
                accountRef: operation.result.accountRef,
                metadataRevision: operation.result.metadataRevision,
                authorizationEpoch: operation.result.authorizationEpoch,
              },
            }
          : {}),
      };
    },
  };
  const dependenciesFor = (actorUserId: string) => ({
    store: input.store,
    gateway,
    async authorizeOwner(expectedActor: string) {
      if (
        expectedActor !== actorUserId ||
        (await input.authorizeUser()) !== actorUserId
      )
        throw new ProviderAccountError("connection_unavailable");
    },
  });
  const completionFor = (result: PersonalOperationResult) => {
    if (result.intent.action !== "connect" || !input.connectionProfiles)
      return {};
    const profileId = result.intent.profileId;
    const profile = input.connectionProfiles.find(
      (row) => row.id === profileId,
    );
    return {
      completion: operationCompletion(
        profile ?? { id: profileId, label: profileId },
      ),
    };
  };
  const view = (result: PersonalOperationResult) => ({
    operationId: result.id,
    phase: result.phase,
    sourceId: result.source?.id ?? null,
    bindingId: result.binding?.id ?? null,
    available: result.available,
    ...completionFor(result),
    ...(result.intent.action === "connect" &&
    result.intent.method === "device_code"
      ? { oauthMethod: "device_code" as const }
      : {}),
    state:
      result.intent.action === "connect"
        ? (result.source?.state ?? "pending")
        : (result.binding?.state ?? "revoked"),
  });
  const selection = z.strictObject({
    nonce: uuid,
    sourceId: c.reference,
    targetWorkspaceId: c.reference,
    expectedSourceMetadataRevision: mirrorRevision,
    expectedGatewayRevision: c.revision.refine((v) => v > 0),
  });
  async function finishOAuth(
    rawNonce: string,
    completion?: AccountOAuthCompletion,
  ) {
    try {
      const safe = completion
        ? snapshotOAuthCompletion(completion)
        : { nonce: uuid.parse(rawNonce) };
      const actorUserId = await input.authorizeUser();
      const original = await input.store.readOperation(actorUserId, safe.nonce);
      if (original.intent.action !== "connect") throw new Denied();
      const savedIntent = original.intent;
      const originalProfile = input.connectionProfiles?.find(
        (profile) => profile.id === savedIntent.profileId,
      ) ?? { id: savedIntent.profileId, label: savedIntent.profileId };
      if (
        original.id !== personalOperationId(actorUserId, safe.nonce) ||
        savedIntent.actorUserId !== actorUserId ||
        savedIntent.clientOperationId !== safe.nonce ||
        savedIntent.ingress !== "oauth-begin" ||
        profiles.get(savedIntent.profileId) !== "oauth-begin" ||
        (completion && !oauthCompletionMatchesProfile(originalProfile, safe)) ||
        (completion
          ? savedIntent.method === "device_code"
          : savedIntent.method !== "device_code")
      )
        throw new Denied();
      async function reauthorize() {
        if ((await input.authorizeUser()) !== actorUserId) throw new Denied();
        // The store also checks the live original personal ownership scope.
        const live = await input.store.readOperation(actorUserId, safe.nonce);
        if (
          live.id !== original.id ||
          personalIntentDigest(live.intent) !==
            personalIntentDigest(original.intent) ||
          (await input.authorizeUser()) !== actorUserId
        )
          throw new Denied();
      }
      async function checked<T>(call: () => Promise<T>): Promise<T> {
        await reauthorize();
        const result = await call();
        await reauthorize();
        return result;
      }
      await reauthorize();
      if (["reserved", "applied", "rejected"].includes(original.phase))
        return view(original);
      const request = {
        operationId: original.id,
        ownerRef: accountGatewayUserOwnerRef(actorUserId),
      };
      const receipt = await checked(() => client.operation(original.id));
      if (
        receipt.operationRef !== original.id ||
        (completion && receipt.oauthMethod === "device_code")
      )
        throw new Denied();
      if (receipt.state === "pending") {
        if (completion)
          await checked(() =>
            client.completeOAuth(
              secretSubmission.oauthComplete.parse({
                ...request,
                ...oauthCompletionCredential(safe as NormalizedOAuthCompletion),
              }),
            ),
          );
        else {
          if (receipt.oauthMethod !== "device_code") throw new Denied();
          await checked(() => client.pollDeviceOAuth(request));
        }
      }
      return view(
        await checked(() =>
          readPersonalAccountOperation(
            actorUserId,
            safe.nonce,
            dependenciesFor(actorUserId),
          ),
        ),
      );
    } catch {
      // No callback, SDK diagnostic or transport error escapes this seam.
      throw new ProviderAccountError("connection_unavailable");
    }
  }
  return {
    async list(raw: { limit?: number; afterSourceId?: string } = {}) {
      const page = z
        .strictObject({
          limit: z.number().int().min(1).max(100).default(25),
          afterSourceId: c.reference.optional(),
        })
        .parse(raw);
      const actorUserId = await input.authorizeUser();
      const rows = await input.store.listOwnedSources({
        actorUserId,
        limit: page.limit + 1,
        ...(page.afterSourceId === undefined
          ? {}
          : { afterSourceId: page.afterSourceId }),
      });
      if ((await input.authorizeUser()) !== actorUserId)
        throw new ProviderAccountError("connection_unavailable");
      const sources = rows.slice(0, page.limit).map((source) => ({
        sourceId: source.id,
        label: source.displayName,
        profileId: source.profileRef,
        state: source.state,
        metadataRevision: source.metadataRevision,
        sourceOperationPending: source.sourceOperationPending,
      }));
      return {
        sources,
        nextCursor:
          rows.length > page.limit ? (sources.at(-1)?.sourceId ?? null) : null,
      };
    },
    async revoke(
      raw: z.input<typeof selection> & {
        bindingId: string;
        expectedBindingRevision: number;
      },
    ) {
      const safe = selection
        .extend({
          bindingId: c.reference,
          expectedBindingRevision: mirrorRevision,
        })
        .parse(raw);
      const actorUserId = await input.authorizeUser();
      // This seam is source-owner only, regardless of an actor's local admin
      // rights. Local denial must work without a Gateway read or target role.
      await input.store.findOwnedSource(actorUserId, safe.sourceId);
      const personalWorkspaceId =
        await input.store.resolvePersonalWorkspace(actorUserId);
      if ((await input.authorizeUser()) !== actorUserId)
        throw new ProviderAccountError("connection_unavailable");
      const result = await input.store.revoke({
        ...safe,
        action: "revoke",
        actorUserId,
        personalWorkspaceId,
        clientOperationId: safe.nonce,
      });
      if ((await input.authorizeUser()) !== actorUserId)
        throw new ProviderAccountError("connection_unavailable");
      const binding = result.binding;
      const acknowledged =
        binding?.state === "revoked" &&
        binding.pendingFence === null &&
        binding.fenceAck?.operationId === result.id &&
        binding.fenceAck.policyRevision === binding.policyRevision;
      return {
        operation: view(result),
        remoteFenceDelivery: acknowledged ? "remote_applied" : "remote_pending",
      };
    },
    async connect(
      raw: {
        nonce: string;
        profileId: string;
        label: string;
        method?: "device_code" | "browser";
      },
      credential?: string,
    ) {
      const safe = oauthIntentSchema.parse(raw);
      const key = credential;
      const actorUserId = await input.authorizeUser();
      const ingress = profiles.get(safe.profileId);
      if (!ingress) throw new ProviderAccountError("invalid_input");
      // Capture the one-off key before awaits; never retain it in SQL or safe intent.
      if (
        ingress === "api-key-create" &&
        (typeof key !== "string" || key.length < 1 || key.length > 16384)
      )
        throw new ProviderAccountError("invalid_input");
      if (ingress === "oauth-begin" && key !== undefined)
        throw new ProviderAccountError("invalid_input");
      const completionKind = operationCompletion(
        input.connectionProfiles?.find((p) => p.id === safe.profileId) ?? {
          id: safe.profileId,
          label: safe.profileId,
        },
      ).inputKind;
      const configuredMethods = input.connectionProfiles?.find(
        (p) => p.id === safe.profileId,
      )?.oauthMethods;
      if (
        ingress === "oauth-begin" &&
        configuredMethods &&
        !configuredMethods.includes(safe.method ?? configuredMethods[0]!)
      )
        throw new ProviderAccountError("invalid_input");
      if (
        ingress === "oauth-begin" &&
        completionKind === "authorization_code" &&
        safe.method === "device_code"
      )
        throw new ProviderAccountError("invalid_input");
      const personalWorkspaceId =
        await input.store.resolvePersonalWorkspace(actorUserId);
      const intent = snapshotPersonalIntent({
        action: "connect",
        actorUserId,
        personalWorkspaceId,
        clientOperationId: safe.nonce,
        proposedSourceId: `rrps_${hash(JSON.stringify([actorUserId, safe.nonce]))}`,
        profileId: safe.profileId,
        displayName: safe.label,
        ingress,
        ...(ingress === "oauth-begin" && safe.profileId === claudeOAuthProfileId
          ? { method: "browser" as const }
          : safe.method
            ? { method: safe.method }
            : {}),
      }) as PersonalAccountIntent & { action: "connect" };
      let authorizationURL: string | undefined;
      let deviceAuthorization: AccountOAuthBeginView["deviceAuthorization"];
      const result = await connectPersonalAccount(
        intent,
        dependenciesFor(actorUserId),
        async () => {
          // Only the committed CAS winner reaches this closure once.
          const original = {
            operationId: personalOperationId(actorUserId, safe.nonce),
            ownerRef: accountGatewayUserOwnerRef(actorUserId),
            profileId: intent.profileId,
            displayName: intent.displayName,
          };
          if (intent.ingress === "api-key-create")
            await client.connect({
              ...original,
              credential: { kind: "api_key", value: key! },
            });
          else {
            const fresh = await client.beginOAuth({
              ...original,
              ...(intent.method ? { method: intent.method } : {}),
            });
            authorizationURL = fresh.authorizationURL;
            deviceAuthorization = fresh.deviceAuthorization;
          }
        },
      );
      if ((await input.authorizeUser()) !== actorUserId)
        throw new ProviderAccountError("connection_unavailable");
      return {
        operation: view(result),
        ...(authorizationURL !== undefined ? { authorizationURL } : {}),
        ...(deviceAuthorization !== undefined ? { deviceAuthorization } : {}),
      };
    },
    async operation(nonce: string) {
      const clientOperationId = uuid.parse(nonce);
      const actorUserId = await input.authorizeUser();
      return view(
        await readPersonalAccountOperation(
          actorUserId,
          clientOperationId,
          dependenciesFor(actorUserId),
        ),
      );
    },
    async completeOAuth(raw: AccountOAuthCompletion) {
      return finishOAuth("", raw);
    },
    async pollOAuth(rawNonce: string) {
      return finishOAuth(rawNonce);
    },
    async attach(
      raw: z.input<typeof selection> & {
        predecessorBindingId: string | null;
        expectedPredecessorRevision: number | null;
      },
    ) {
      const safe = selection
        .extend({
          predecessorBindingId: c.reference.nullable(),
          expectedPredecessorRevision: mirrorRevision.nullable(),
        })
        .parse(raw);
      const actorUserId = await input.authorizeUser();
      const personalWorkspaceId =
        await input.store.resolvePersonalWorkspace(actorUserId);
      return view(
        await attachPersonalAccount(
          {
            ...safe,
            action: "attach",
            actorUserId,
            personalWorkspaceId,
            clientOperationId: safe.nonce,
          },
          dependenciesFor(actorUserId),
        ),
      );
    },
  };
}

// One server-configured origin/management role. Never read a caller URL/token/native ID.
export function accountGatewayProfilesConfiguration() {
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
  const configuredOAuth =
    process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CODEX_OAUTH_PROFILE_ID;
  const oauthProfile =
    configuredOAuth === undefined || configuredOAuth === ""
      ? undefined
      : z.literal(codexOAuthProfileId).parse(configuredOAuth);
  const configuredClaude =
    process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CLAUDE_OAUTH_PROFILE_ID;
  const claudeProfile =
    configuredClaude === undefined || configuredClaude === ""
      ? undefined
      : z.literal(claudeOAuthProfileId).parse(configuredClaude);
  const subscriptionProfileIds = configuredSubscriptionProfiles(
    process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_SUBSCRIPTION_PROFILE_IDS,
  );
  if (
    !apiKeyProfiles.size &&
    !oauthProfile &&
    !claudeProfile &&
    !subscriptionProfileIds.length
  )
    throw new Error("accounts_unavailable");
  // Operator pairs this public URL with the exact fixed Gateway service profile.
  // Missing binding preserves legacy ingress; it cannot advertise a URL option.
  const apiKeyProfileBaseURLs = new Map<string, string>();
  const configuredMimoURL =
    process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MIMO_BASE_URL;
  if (configuredMimoURL) {
    const profileId = process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MIMO_PROFILE_ID;
    const baseURL = canonicalMimoBaseURL(configuredMimoURL);
    if (!profileId || !baseURL) throw new Error("accounts_unavailable");
    apiKeyProfileBaseURLs.set(profileId, baseURL);
  }
  return {
    contextKey,
    ...(process.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID !== undefined
      ? {
          operatorWorkspaceId: c.reference.parse(
            process.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
          ),
        }
      : {}),
    apiKeyProfiles,
    apiKeyProfileBaseURLs,
    subscriptionProfileIds,
    ...(oauthProfile ? { codexOAuthProfileId: oauthProfile } : {}),
    ...(claudeProfile ? { claudeOAuthProfileId: claudeProfile } : {}),
  };
}
function configuration() {
  return {
    ...accountGatewayProfilesConfiguration(),
    gateway: createManagementClient({
      role: "management",
      origin: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? "",
      token: process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? "",
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
  const accounts = new PrismaProviderAccountRepository(
    prisma,
    settings.operatorWorkspaceId,
    readPersonalAccountSharingEnabled(process.env),
  );
  const access = new PrismaWorkspaceAccessRepository(prisma);
  async function authorizeContext(context: string) {
    const [body, signature, extra] = context.split(".");
    if (!body || !signature || extra || !/^[A-Za-z0-9_-]+$/.test(body))
      throw new Denied();
    const expected = Buffer.from(contextSignature(body, settings.contextKey));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Denied();
    const saved = z
      .strictObject({ workspaceId: c.reference, userId: c.reference })
      .parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    const currentActor = await getDashboardSignedInActor();
    if (!currentActor || currentActor.userId !== saved.userId)
      throw new Denied();
    const workspace = await prisma.workspace.findUnique({
      where: { id: saved.workspaceId },
      select: { id: true, personalOwnerUserId: true },
    });
    if (!workspace || workspace.personalOwnerUserId !== null)
      throw new Denied();
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
  }
  const adapter = createAccountsAdapter({
    ...settings,
    accounts,
    fences: accounts,
    synchronization: new PrismaProviderAccountSynchronization(prisma),
    bindingDependencies: {
      accounts,
      operatorGrants: accounts,
      ...(settings.operatorWorkspaceId
        ? { operatorWorkspaceId: settings.operatorWorkspaceId }
        : {}),
      workspaceAccess: access,
      localAdminGithubLogins: (
        process.env.REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS ?? ""
      )
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    },
    authorize: authorizeContext,
    async limits(context) {
      return createAccountLimitsService({
        prisma,
        secret: settings.contextKey,
        reader: await accountLimitsReader({
          role: "management",
          origin:
            process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN ?? "",
          token:
            process.env.REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN ?? "",
        }),
        ...(settings.operatorWorkspaceId
          ? { operatorWorkspaceId: settings.operatorWorkspaceId }
          : {}),
        ownerRef: (owner) =>
          owner.kind === "user"
            ? accountGatewayUserOwnerRef(owner.userId)
            : accountGatewayWorkspaceOwnerRef(owner.workspaceId),
        authorize: async () => {
          const current = await authorizeContext(context);
          return {
            userId: current.actor.userId,
            workspaceId: current.workspaceId,
          };
        },
      });
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
      select: { id: true, personalOwnerUserId: true },
    });
    if (!workspace || workspace.personalOwnerUserId !== null)
      throw new Denied();
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
