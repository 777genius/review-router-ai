import type { AccountLimitsService } from "./account-limits-service";
import { operationCompletion } from "./account-connection-catalog";
import { secretSubmission } from "@agent-teams/account-gateway/http";
import { lifecycleProjection } from "./account-lifecycle";
import type { AccountLifecycleRead } from "./account-lifecycle-reader";
import * as c from "@agent-teams/account-gateway/contracts";
import type { ConsumerControlClient } from "@agent-teams/account-gateway/http";
import { z } from "zod";
import {
  ProviderAccountError,
  assertOpaqueReference,
  type PersonalAccountOperationStore,
  type ProviderAccountConnection,
} from "@reviewrouter/features-provider-accounts";
import {
  beginPersonalCanonicalOperation,
  readPersonalCanonicalOperation,
  submitPersonalCanonicalOperation,
  type PersonalCanonicalOperationStore,
  type PersonalCanonicalReceipt,
} from "@reviewrouter/features-provider-accounts/synchronization";
import {
  snapshotOAuthCompletion,
  oauthCompletionMatchesProfile,
  accountGatewayUserOwnerRef,
  type AccountIntent,
  type AccountOAuthIntent,
  type AccountOAuthReconnectIntent,
  type AccountOAuthCompletion,
  type AccountOperationView,
  type AccountProfileView,
  type AccountsPage,
  type AccountsResult,
  type createDisabledPersonalAccountsAdapter,
} from "./account-gateway-accounts";
import {
  canonicalMimoBaseURL,
  suggestedAccountLabel,
} from "../features/account-gateway/connection-options";

type PersonalAdapter = Pick<
  ReturnType<typeof createDisabledPersonalAccountsAdapter>,
  "list" | "connect" | "operation" | "completeOAuth" | "pollOAuth"
>;
export type PersonalCanonicalOperationView = AccountOperationView & {
  resume?: {
    kind: "reconnect";
    connectionId: string;
    profileId: string;
    gatewayRevision: number;
    mirrorRevision: number;
  };
};
type Dependencies = {
  limits?: AccountLimitsService;
  authorizeUser(): Promise<string>;
  lifecycleReader?: {
    get(accountRef: string): Promise<AccountLifecycleRead>;
    compatible(): Promise<boolean>;
    writable(): Promise<boolean>;
  };
  readLifecycleAction?: (
    sourceId: string,
    operationId: string,
  ) => Promise<"suspend" | "resume" | "delete" | null>;
  store: PersonalAccountOperationStore;
  canonical: PersonalCanonicalOperationStore;
  control: Pick<
    ConsumerControlClient,
    "profiles" | "get" | "operation" | "rename" | "reconnect" | "disable"
  > &
    Partial<
      Pick<ConsumerControlClient, "beginOAuthReconnect" | "completeOAuth">
    >;
  profiles: readonly {
    id: string;
    label: string;
    provider?: NonNullable<AccountProfileView["provider"]>;
    authKind: "api_key" | "oauth";
    canReconnect?: boolean;
    oauthMethods?: NonNullable<AccountProfileView["oauthMethods"]>;
    dedicatedBaseURL?: string;
    connection?: AccountProfileView["connection"];
    availability?: AccountProfileView["availability"];
  }[];
  personalAdapterFactory(input: {
    authorizeUser(): Promise<string>;
    profiles: ReadonlyMap<string, "api-key-create" | "oauth-begin">;
    connectionProfiles?: readonly Pick<
      AccountProfileView,
      "id" | "label" | "connection" | "oauthMethods"
    >[];
  }): PersonalAdapter;
  /** Bounded exact-ID fence delivery/ACK only; no credential or inference ingress. */
  deliverFences(actorUserId: string, clientOperationId: string): Promise<void>;
};
const nonce = z
  .string()
  .uuid()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const revision = z.number().int().min(1).max(2147483646);
const label = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      Buffer.byteLength(value, "utf8") <= 400 &&
      [...value].every((character) => {
        const code = character.charCodeAt(0);
        return code >= 0x20 && code !== 0x7f;
      }),
  );
const fresh = z.strictObject({
  nonce,
  profileId: c.reference,
  label: label.optional(),
  baseURL: z.string().max(2048).optional(),
  method: z.enum(["device_code", "browser"]).optional(),
});
const existing = z.strictObject({
  kind: z.enum(["rename", "reconnect", "disable"]),
  nonce,
  connectionId: c.reference,
  mirrorRevision: revision,
  gatewayRevision: c.revision.optional(),
  profileId: c.reference.optional(),
  label: label.optional(),
});
class Denied extends Error {}
const operationState = (phase: string): AccountOperationView["state"] =>
  phase === "applied" || phase === "rejected" || phase === "unknown"
    ? phase
    : "pending";
const unknown = (value: string): PersonalCanonicalOperationView => ({
  nonce: value,
  state: "unknown",
  cleanup: "unresolved",
});

/** Disabled composition only. Display context never supplies identity or permissions. */
export function createPersonalCanonicalAccounts(input: Dependencies) {
  const approved = input.profiles.map((profile) => ({
    id: profile.id,
    label: profile.label,
    ...(profile.availability ? { availability: profile.availability } : {}),
    ...(profile.connection ? { connection: profile.connection } : {}),
    ...(profile.provider ? { provider: profile.provider } : {}),
    authKind: profile.authKind,
    ...(profile.oauthMethods
      ? { oauthMethods: [...profile.oauthMethods] }
      : {}),
    canReconnect:
      profile.canReconnect === true &&
      (profile.authKind === "api_key" || profile.connection !== undefined),
    ...(profile.dedicatedBaseURL
      ? { dedicatedBaseURL: profile.dedicatedBaseURL }
      : {}),
  }));
  async function session() {
    const actor = await input.authorizeUser();
    assertOpaqueReference(actor);
    const authorize = async () => {
      if ((await input.authorizeUser()) !== actor) throw new Denied();
    };
    async function checked<T>(call: () => Promise<T>) {
      await authorize();
      const value = await call();
      await authorize();
      return value;
    }
    const ownerRef = accountGatewayUserOwnerRef(actor);
    // Original operation recovery must survive catalog outages. Protocol/model
    // discovery is needed only by display/fresh enrollment, never nonce lookup.
    async function catalogue(): Promise<AccountProfileView[]> {
      const available = (
        await checked(() => input.control.profiles())
      ).profiles.map((profile) => c.profile.parse(profile));
      return approved.flatMap((profile) => {
        const wire = available.find(
          (row) =>
            row.profileId === profile.id &&
            row.authKinds.includes(profile.authKind),
        );
        return wire
          ? [
              {
                ...profile,
                protocol: wire.protocol,
                models: profile.connection
                  ? wire.modelIds.filter((model) =>
                      profile.connection!.modelSettings.some(
                        (setting) => setting.modelId === model,
                      ),
                    )
                  : [...wire.modelIds],
              },
            ]
          : [];
      });
    }
    const profileFor = (id: string | null) =>
      approved.find((profile) => profile.id === id);
    const personal = input.personalAdapterFactory({
      connectionProfiles: approved,
      authorizeUser: async () => {
        await authorize();
        return actor;
      },
      profiles: new Map(
        approved.map((profile) => [
          profile.id,
          profile.authKind === "api_key" ? "api-key-create" : "oauth-begin",
        ]),
      ),
    });
    async function get(
      source: ProviderAccountConnection,
    ): Promise<AccountLifecycleRead> {
      const account = input.lifecycleReader
        ? await checked(() =>
            input.lifecycleReader!.get(source.gatewayAccountRef),
          )
        : c.account.parse(
            await checked(() => input.control.get(source.gatewayAccountRef)),
          );
      if (
        source.owner.kind !== "user" ||
        source.owner.userId !== actor ||
        account.ownerRef !== ownerRef ||
        account.accountRef !== source.gatewayAccountRef ||
        account.profileId !== source.profileRef ||
        !profileFor(account.profileId)
      )
        throw new Denied();
      return account;
    }
    const deps = {
      store: input.canonical,
      authorizeOwner: async (user: string) => {
        if (user !== actor) throw new Denied();
        await authorize();
      },
      gateway: {
        get: async (user: string, accountRef: string, profileId: string) => {
          if (user !== actor) throw new Denied();
          const account = c.account.parse(
            await checked(() => input.control.get(accountRef)),
          );
          if (
            account.ownerRef !== ownerRef ||
            account.accountRef !== accountRef ||
            account.profileId !== profileId ||
            !profileFor(profileId)
          )
            throw new Denied();
          return account;
        },
        operation: async (operationId: string) => {
          const operation = c.operation.parse(
            await checked(() => input.control.operation(operationId)),
          );
          return {
            operationId: operation.operationRef,
            state: operation.state,
            ...(operation.state === "applied" &&
            operation.result?.kind === "account"
              ? { result: operation.result }
              : {}),
          };
        },
      },
    };
    async function project(source: ProviderAccountConnection) {
      const account = await get(source);
      const current = await checked(() =>
        input.store.findOwnedSource(actor, source.id),
      );
      const synchronized =
        current.metadataRevision === source.metadataRevision &&
        current.pendingSourceOperationId == null &&
        current.state === account.state &&
        current.authorizationEpochMirror === account.authorizationEpoch;
      const pendingAction = current.pendingSourceOperationId
        ? await input.readLifecycleAction?.(
            source.id,
            current.pendingSourceOperationId,
          )
        : null;
      const lifecycle = lifecycleProjection({
        pendingAction: pendingAction ?? undefined,
        owned: true,
        compatible: !!(await input.lifecycleReader?.writable()),
        state: account.state,
        pendingOperationId: current.pendingSourceOperationId ?? null,
        synchronized,
        custodyVerified: account.resumeCustody === "verified",
        operationReadable: !!pendingAction,
      });
      return {
        lifecycle: lifecycle.lifecycle,
        isOwnedByViewer: true,
        origin: "personal" as const,
        allowedActions: lifecycle.actions,
        ...(lifecycle.lifecycle.status === "available"
          ? { authorizationEpoch: account.authorizationEpoch }
          : {}),
        connectionId: source.id,
        label: account.displayName,
        profileId: account.profileId,
        profileLabel: profileFor(account.profileId)!.label,
        provider: profileFor(account.profileId)!.provider,
        authKind: profileFor(account.profileId)!.authKind,
        connection: profileFor(account.profileId)!.connection,
        state: account.state,
        readiness: current.pendingSourceOperationId
          ? ("pending" as const)
          : synchronized
            ? account.state === "active"
              ? ("ready" as const)
              : ("unavailable" as const)
            : ("unknown" as const),
        gatewayRevision: account.metadataRevision,
        mirrorRevision: current.metadataRevision,
        binding: null,
        canManage:
          current.metadataRevision === source.metadataRevision &&
          current.pendingSourceOperationId == null &&
          !["disabled", "suspended", "unknown", "pending"].includes(
            current.state,
          ) &&
          current.state === account.state &&
          current.authorizationEpochMirror === account.authorizationEpoch,
      };
    }
    async function view(
      receipt: PersonalCanonicalReceipt,
    ): Promise<PersonalCanonicalOperationView> {
      const original = receipt.intent;
      const profile = profileFor(receipt.source.profileRef);
      const fencesClear =
        receipt.phase !== "ready" ||
        (
          await checked(() =>
            input.canonical.listFences(actor, original.clientOperationId),
          )
        ).length === 0;
      return {
        nonce: original.clientOperationId,
        state: operationState(receipt.phase),
        ...(profile?.authKind === "oauth" && original.action === "reconnect"
          ? {
              completion: operationCompletion(profile),
              oauthMethod: "browser" as const,
            }
          : {}),
        cleanup: "unresolved",
        ...(receipt.phase === "ready" &&
        fencesClear &&
        original.action === "reconnect" &&
        profile?.canReconnect
          ? {
              resume: {
                kind: "reconnect" as const,
                connectionId: original.sourceId,
                profileId: profile.id,
                gatewayRevision: original.expectedGatewayRevision,
                mirrorRevision: original.expectedSourceMetadataRevision,
              },
            }
          : {}),
      };
    }
    async function readCanonical(value: string) {
      let original = await checked(() => input.canonical.read(actor, value));
      if (original.phase === "fencing" || original.phase === "ready") {
        try {
          await checked(() => input.deliverFences(actor, value));
        } catch {
          await authorize();
        }
        original = await checked(() => input.canonical.ready(actor, value));
      }
      return original.phase === "submitted" || original.phase === "unknown"
        ? readPersonalCanonicalOperation(actor, value, deps)
        : original;
    }
    return {
      actor,
      authorize,
      checked,
      personal,
      catalogue,
      profileFor,
      project,
      get,
      deps,
      view,
      readCanonical,
    };
  }
  type Session = Awaited<ReturnType<typeof session>>;
  async function safe<T>(
    work: (scope: Session, retain: () => void) => Promise<T>,
    uncertain?: () => T,
  ): Promise<AccountsResult<T>> {
    let retained = false;
    try {
      const scope = await session();
      const result = await work(scope, () => {
        retained = true;
      });
      await scope.authorize();
      return { status: "ok", value: result };
    } catch (error) {
      // Once an operation may be committed/entered, preserve only its caller's
      // nonce. A lost session must not reflect owner data or discard readback.
      if (
        error instanceof ProviderAccountError &&
        ["operation_conflict", "revision_conflict"].includes(error.code)
      )
        return { status: "conflict" };
      if (
        error instanceof z.ZodError ||
        (error instanceof ProviderAccountError &&
          error.code === "invalid_input")
      )
        return { status: "invalid" };
      if (retained && uncertain) return { status: "ok", value: uncertain() };
      return { status: error instanceof Denied ? "denied" : "unavailable" };
    }
  }
  async function mutation(
    scope: Session,
    request: z.infer<typeof existing>,
    credential: string | undefined,
    retain: () => void,
    oauthHandoff?: (value: c.OAuthBeginResponse) => void,
  ) {
    const action = request.kind === "disable" ? "retire" : request.kind;
    if ((action === "rename") !== (request.label !== undefined))
      throw new z.ZodError([]);
    let original: PersonalCanonicalReceipt | undefined;
    try {
      original = await scope.checked(() =>
        input.canonical.read(scope.actor, request.nonce),
      );
    } catch (error) {
      if (
        !(error instanceof ProviderAccountError) ||
        error.code !== "not_found"
      )
        throw error;
    }
    if (original) {
      if (
        original.intent.action !== action ||
        original.intent.sourceId !== request.connectionId ||
        original.intent.expectedSourceMetadataRevision !==
          request.mirrorRevision ||
        (action === "rename" &&
          (original.intent.action !== "rename" ||
            original.intent.displayName !== request.label)) ||
        (request.profileId !== undefined &&
          request.profileId !== original.source.profileRef)
      )
        throw new ProviderAccountError("operation_conflict");
    } else {
      const source = await scope.checked(() =>
        input.store.findOwnedSource(scope.actor, request.connectionId),
      );
      if (source.metadataRevision !== request.mirrorRevision)
        throw new ProviderAccountError("revision_conflict");
      const account = await scope.get(source);
      const profile = scope.profileFor(source.profileRef);
      if (
        action === "reconnect" &&
        profile?.availability === "deployment_configuration_required"
      )
        throw new Denied();
      if (oauthHandoff && profile?.authKind !== "oauth") throw new Denied();
      if (
        request.profileId !== undefined &&
        request.profileId !== source.profileRef
      )
        throw new ProviderAccountError("operation_conflict");
      if (
        action === "reconnect" &&
        (!profile?.canReconnect ||
          (profile.authKind !== "api_key" && !oauthHandoff))
      )
        throw new Denied();
      const personalWorkspaceId = await scope.checked(() =>
        input.store.resolvePersonalWorkspace(scope.actor),
      );
      retain();
      original = await beginPersonalCanonicalOperation(
        {
          actorUserId: scope.actor,
          clientOperationId: request.nonce,
          personalWorkspaceId,
          sourceId: source.id,
          expectedSourceMetadataRevision: request.mirrorRevision,
          expectedGatewayRevision: account.metadataRevision,
          expectedAuthorizationEpoch: account.authorizationEpoch,
          ...(action === "rename"
            ? { action, displayName: request.label! }
            : { action }),
        },
        scope.deps,
      );
    }
    retain();
    if (
      ["submitted", "unknown", "applied", "rejected"].includes(original.phase)
    )
      return scope.view(await scope.readCanonical(request.nonce));
    const currentProfile = scope.profileFor(original.source.profileRef);
    if (
      action === "reconnect" &&
      currentProfile?.availability === "deployment_configuration_required"
    )
      throw new Denied();
    if (
      action === "reconnect" &&
      (!currentProfile?.canReconnect ||
        (currentProfile.authKind !== "api_key" && !oauthHandoff))
    )
      throw new Denied();
    if (original.phase === "fencing" || original.phase === "ready") {
      try {
        await scope.checked(() =>
          input.deliverFences(scope.actor, request.nonce),
        );
      } catch {
        await scope.authorize();
        return scope.view(original);
      }
      await scope.checked(() =>
        input.canonical.ready(scope.actor, request.nonce),
      );
    }
    if (action === "reconnect" && credential === undefined && !oauthHandoff)
      return scope.view(await scope.readCanonical(request.nonce));
    const result = await submitPersonalCanonicalOperation(
      scope.actor,
      request.nonce,
      scope.deps,
      async (command) => {
        const revision = {
          operationId: command.operationId,
          expectedMetadataRevision: command.expectedMetadataRevision,
        };
        if (command.action === "rename")
          await input.control.rename(command.accountRef, {
            ...revision,
            displayName: command.displayName!,
          });
        else if (command.action === "reconnect") {
          if (oauthHandoff) {
            if (!input.control.beginOAuthReconnect) throw new Denied();
            oauthHandoff(
              await input.control.beginOAuthReconnect(command.accountRef, {
                ...revision,
                method: "browser",
              }),
            );
          } else
            await input.control.reconnect(command.accountRef, {
              ...revision,
              credential: { kind: "api_key", value: credential! },
            });
        } else await input.control.disable(command.accountRef, revision);
      },
    );
    return scope.view(result);
  }
  async function completeCanonicalOAuth(
    scope: Session,
    request: ReturnType<typeof snapshotOAuthCompletion>,
    retain: () => void,
  ) {
    const original = await scope.checked(() =>
      input.canonical.read(scope.actor, request.nonce),
    );
    const profile = scope.profileFor(original.source.profileRef);
    if (
      original.intent.action !== "reconnect" ||
      profile?.authKind !== "oauth" ||
      !profile.canReconnect ||
      !input.control.completeOAuth
    )
      throw new Denied();
    if (!oauthCompletionMatchesProfile(profile, request)) throw new Denied();
    if (["submitted", "unknown"].includes(original.phase)) {
      const operation = await scope.checked(() =>
        input.control.operation(original.id),
      );
      if (
        operation.operationRef !== original.id ||
        operation.oauthMethod === "device_code"
      )
        throw new Denied();
      if (operation.state === "pending") {
        retain();
        await scope.checked(() =>
          input.control.completeOAuth!(
            secretSubmission.oauthComplete.parse({
              operationId: original.id,
              ownerRef: accountGatewayUserOwnerRef(scope.actor),
              ...("callbackURL" in request
                ? { callbackURL: request.callbackURL }
                : { authorizationCode: request.authorizationCode }),
            }),
          ),
        );
      }
    }
    return scope.view(await scope.readCanonical(request.nonce));
  }
  async function connect(
    scope: Session,
    request: z.infer<typeof fresh>,
    credential: string | undefined,
    retain: () => void,
  ) {
    // A committed nonce is recoverable even when live profile discovery fails.
    // Check its immutable intent before any fresh enrollment prerequisite.
    let original:
      | Awaited<ReturnType<PersonalAccountOperationStore["readOperation"]>>
      | undefined;
    try {
      original = await scope.checked(() =>
        input.store.readOperation(scope.actor, request.nonce),
      );
    } catch (error) {
      if (
        !(error instanceof ProviderAccountError) ||
        error.code !== "not_found"
      )
        throw error;
    }
    if (original) {
      const intent = original.intent;
      if (
        intent.action !== "connect" ||
        intent.profileId !== request.profileId ||
        (request.label !== undefined && intent.displayName !== request.label) ||
        intent.ingress !==
          (credential === undefined ? "oauth-begin" : "api-key-create") ||
        (request.method !== undefined &&
          (intent.method ?? "browser") !== request.method)
      )
        throw new ProviderAccountError("operation_conflict");
      if (
        request.baseURL !== undefined &&
        !canonicalMimoBaseURL(request.baseURL)
      )
        throw new z.ZodError([]);
      retain();
      if (original.phase !== "reserved")
        return { operation: await scope.personal.operation(request.nonce) };
      // A positively unentered reservation may still use C2's single claim.
      // Preserve its original default label if configuration copy has changed.
      request = {
        ...request,
        label: intent.displayName,
        ...(intent.method ? { method: intent.method } : {}),
      };
    }
    const profile = (await scope.catalogue()).find(
      (profile) => profile.id === request.profileId,
    );
    if (
      !profile ||
      profile.availability === "deployment_configuration_required" ||
      (credential !== undefined
        ? profile.authKind !== "api_key"
        : profile.authKind !== "oauth")
    )
      throw new Denied();
    if (
      credential === undefined &&
      profile.oauthMethods &&
      !profile.oauthMethods.includes(request.method ?? profile.oauthMethods[0]!)
    )
      throw new Denied();
    if (request.baseURL !== undefined) {
      const baseURL = canonicalMimoBaseURL(request.baseURL);
      if (!baseURL || baseURL !== profile.dedicatedBaseURL)
        throw new z.ZodError([]);
    }
    const method = request.method ?? profile.oauthMethods?.[0];
    retain();
    return scope.personal.connect(
      {
        nonce: request.nonce,
        profileId: profile.id,
        label: request.label ?? suggestedAccountLabel(profile.label),
        ...(profile.authKind === "oauth" && method !== undefined
          ? { method }
          : {}),
      },
      credential,
    );
  }
  async function projectConnectResult(
    scope: Session,
    value: string,
    result: Awaited<ReturnType<PersonalAdapter["operation"]>>,
  ): Promise<AccountOperationView> {
    const receipt: AccountOperationView = {
      nonce: value,
      ...(result.completion ? { completion: result.completion } : {}),
      state: operationState(result.phase),
      ...(result.oauthMethod ? { oauthMethod: result.oauthMethod } : {}),
      cleanup: "unresolved",
    };
    const sourceId = result.sourceId;
    if (result.phase !== "applied" || !sourceId) return receipt;
    try {
      const source = await scope.checked(() =>
        input.store.findOwnedSource(scope.actor, sourceId),
      );
      if (source.id !== sourceId) throw new Denied();
      const account = await scope.project(source);
      await scope.authorize();
      return { ...receipt, account };
    } catch (error) {
      // Optional identity metadata cannot undo an already applied operation.
      // A current owner/session denial must still escape without reflecting it.
      await scope.authorize();
      if (
        error instanceof Denied ||
        (error instanceof ProviderAccountError &&
          error.code === "workspace_forbidden")
      )
        throw error;
      return receipt;
    }
  }
  return {
    async listGatewayAccounts(
      _context: string,
      cursor: string | null,
    ): Promise<AccountsResult<AccountsPage>> {
      return safe(async (scope) => {
        const profiles = await scope.catalogue();
        const afterSourceId =
          cursor === null ? undefined : c.reference.parse(cursor);
        const page = await scope.personal.list({
          limit: 25,
          ...(afterSourceId ? { afterSourceId } : {}),
        });
        const rows = await Promise.all(
          page.sources.map(async (row) => {
            if (!scope.profileFor(row.profileId)) return null;
            try {
              return await scope.project(
                await scope.checked(() =>
                  input.store.findOwnedSource(scope.actor, row.sourceId),
                ),
              );
            } catch (error) {
              if (error instanceof Denied) return null;
              let source: ProviderAccountConnection;
              let pendingAction: "suspend" | "resume" | "delete" | null;
              try {
                source = await scope.checked(() =>
                  input.store.findOwnedSource(scope.actor, row.sourceId),
                );
                pendingAction = source.pendingSourceOperationId
                  ? ((await input.readLifecycleAction?.(
                      source.id,
                      source.pendingSourceOperationId,
                    )) ?? null)
                  : null;
              } catch (fallbackError) {
                if (fallbackError instanceof Denied) throw fallbackError;
                return null;
              }
              const profile = scope.profileFor(source.profileRef);
              if (!profile) return null;
              const projection = lifecycleProjection({
                pendingAction: pendingAction ?? undefined,
                owned: true,
                compatible: false,
                state: source.state,
                pendingOperationId: source.pendingSourceOperationId ?? null,
                synchronized: false,
                operationReadable: !!pendingAction,
              });
              return {
                connectionId: source.id,
                label: source.displayName,
                profileId: profile.id,
                profileLabel: profile.label,
                provider: profile.provider,
                authKind: profile.authKind,
                connection: profile.connection,
                state:
                  source.state === "suspended"
                    ? ("suspended" as const)
                    : source.state === "disabled"
                      ? ("disabled" as const)
                      : ("quarantined" as const),
                readiness: source.pendingSourceOperationId
                  ? ("pending" as const)
                  : ("unknown" as const),
                gatewayRevision: 0,
                mirrorRevision: source.metadataRevision,
                binding: null,
                canManage: false,
                isOwnedByViewer: true,
                origin: "personal" as const,
                lifecycle: projection.lifecycle,
                allowedActions: projection.actions,
              };
            }
          }),
        );
        return {
          accounts: input.limits
            ? await input.limits.page(rows.filter((row) => row !== null))
            : rows.filter((row) => row !== null),
          profiles: profiles.filter(
            (profile) =>
              profile.availability !== "deployment_configuration_required",
          ),
          nextCursor: page.nextCursor,
        };
      });
    },
    async mutateGatewayAccount(_context: string, raw: AccountIntent) {
      let request: z.infer<typeof existing>;
      try {
        request = existing.parse(raw);
        if (request.kind === "reconnect") return { status: "invalid" as const };
      } catch {
        return { status: "invalid" as const };
      }
      return safe(
        (scope, retain) => mutation(scope, request, undefined, retain),
        () => unknown(request.nonce),
      );
    },
    async submitGatewayApiKey(
      _context: string,
      raw: AccountIntent,
      key: string,
    ) {
      const credential = key;
      if (
        typeof credential !== "string" ||
        credential.length < 1 ||
        credential.length > 16384
      )
        return { status: "invalid" as const };
      let request: z.infer<typeof fresh> | z.infer<typeof existing>;
      try {
        request =
          raw.kind === "connect"
            ? fresh.parse({
                nonce: raw.nonce,
                profileId: raw.profileId,
                ...(raw.label !== undefined ? { label: raw.label } : {}),
                ...(raw.baseURL !== undefined ? { baseURL: raw.baseURL } : {}),
              })
            : existing.parse(raw);
        if ("kind" in request && request.kind !== "reconnect")
          return { status: "invalid" as const };
      } catch {
        return { status: "invalid" as const };
      }
      return safe(
        async (scope, retain) =>
          "kind" in request
            ? mutation(scope, request, credential, retain)
            : projectConnectResult(
                scope,
                request.nonce,
                (await connect(scope, request, credential, retain)).operation,
              ),
        () => unknown(request.nonce),
      );
    },
    async readGatewayOperation(_context: string, raw: string) {
      let value: string;
      try {
        value = nonce.parse(raw);
      } catch {
        return { status: "invalid" as const };
      }
      return safe(async (scope) => {
        const operation = await scope.checked(() =>
          input.store.readOperation(scope.actor, value),
        );
        if (["rename", "reconnect", "retire"].includes(operation.intent.action))
          return scope.view(await scope.readCanonical(value));
        if (operation.intent.action !== "connect") throw new Denied();
        const result = await scope.personal.operation(value);
        return projectConnectResult(scope, value, result);
      });
    },
    async beginGatewayOAuth(
      _context: string,
      raw: AccountOAuthIntent | AccountOAuthReconnectIntent,
    ) {
      let request: z.infer<typeof fresh> | z.infer<typeof existing>;
      try {
        if (
          "connectionId" in raw &&
          !approved.some(
            (profile) => profile.authKind === "oauth" && profile.canReconnect,
          )
        )
          return { status: "invalid" as const };
        if ("connectionId" in raw) {
          if (raw.method !== undefined && raw.method !== "browser")
            return { status: "invalid" as const };
          const reconnect = { ...raw };
          delete reconnect.method;
          request = existing.parse({ ...reconnect, kind: "reconnect" });
        } else request = fresh.parse(raw);
      } catch {
        return { status: "invalid" as const };
      }
      return safe(
        async (scope, retain) => {
          if ("kind" in request) {
            let handoff: c.OAuthBeginResponse | undefined;
            const operation = await mutation(
              scope,
              request,
              undefined,
              retain,
              (value) => {
                handoff = value;
              },
            );
            return {
              operation,
              ...(handoff?.authorizationURL
                ? { authorizationURL: handoff.authorizationURL }
                : {}),
            };
          }
          const result = await connect(scope, request, undefined, retain);
          return {
            operation: await projectConnectResult(
              scope,
              request.nonce,
              result.operation,
            ),
            ...(result.authorizationURL !== undefined
              ? { authorizationURL: result.authorizationURL }
              : {}),
            ...(result.deviceAuthorization !== undefined
              ? { deviceAuthorization: result.deviceAuthorization }
              : {}),
          };
        },
        () => ({ operation: unknown(request.nonce) }),
      );
    },
    async completeGatewayOAuth(_context: string, raw: AccountOAuthCompletion) {
      let request: ReturnType<typeof snapshotOAuthCompletion>;
      try {
        request = snapshotOAuthCompletion(raw);
      } catch {
        return { status: "invalid" as const };
      }
      return safe(
        async (scope, retain) => {
          // The shared journal owns the action discriminator. The canonical
          // reader deliberately rejects connect rows rather than returning absence.
          const original = await scope.checked(() =>
            input.store.readOperation(scope.actor, request.nonce),
          );
          if (original.intent.action === "reconnect")
            return completeCanonicalOAuth(scope, request, retain);
          if (original.intent.action !== "connect") throw new Denied();
          retain();
          const result = await scope.personal.completeOAuth(request);
          return projectConnectResult(scope, request.nonce, result);
        },
        () => unknown(request.nonce),
      );
    },
    async pollGatewayOAuth(_context: string, rawNonce: string) {
      let value: string;
      try {
        value = nonce.parse(rawNonce);
      } catch {
        return { status: "invalid" as const };
      }
      return safe(
        async (scope, retain) => {
          retain();
          const result = await scope.personal.pollOAuth(value);
          return projectConnectResult(scope, value, result);
        },
        () => unknown(value),
      );
    },
  };
}
