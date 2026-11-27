import { createHash } from "node:crypto";
import type * as c from "@agent-teams/account-gateway/contracts";
import type { ConsumerControlClient } from "@agent-teams/account-gateway/http";
import {
  ProviderAccountError,
  type PersonalAccountOperationStore,
  type ProviderAccountConnection,
} from "@reviewrouter/features-provider-accounts";
import {
  beginPersonalCanonicalOperation,
  connectPersonalAccount,
  personalOperationId,
  readPersonalAccountOperation,
  readPersonalCanonicalOperation,
  snapshotNativeConnectionIntent,
  submitPersonalCanonicalOperation,
  type PersonalCanonicalDependencies,
  type PersonalCanonicalOperationStore,
} from "@reviewrouter/features-provider-accounts/synchronization";
import {
  nativeConnectionInputsAllowed,
  nativeConnectionMethodAllowed,
  type NativeConnectionSelection,
} from "../features/account-gateway/domain/native-connection";
import {
  accountGatewayUserOwnerRef,
  type AccountOperationView,
  type AccountOAuthBeginView,
  type AccountProfileView,
  type AccountView,
} from "./account-gateway-accounts";
import type { AccountNativeConnectionIntent } from "./native-connection-adapter";
import {
  nativeConnectionMethodView,
  nativeCredentialView,
} from "./native-connection-view";

type NativeControl = Pick<
  ConsumerControlClient,
  | "beginConnection"
  | "reconnectConnection"
  | "readConnection"
  | "submitConnection"
  | "pollConnection"
>;
type Scope = {
  actor: string;
  authorize(): Promise<void>;
  checked<T>(call: () => Promise<T>): Promise<T>;
  catalogue(): Promise<AccountProfileView[]>;
  deps: PersonalCanonicalDependencies;
  get(
    source: ProviderAccountConnection,
  ): Promise<{ metadataRevision: number; authorizationEpoch: number }>;
  project(
    source: ProviderAccountConnection,
    profile?: AccountProfileView,
  ): Promise<AccountView>;
};
const denied = (): never => {
  throw new ProviderAccountError("connection_unavailable");
};
const conflict = (): never => {
  throw new ProviderAccountError("operation_conflict");
};
const sameSelection = (
  a: NativeConnectionSelection,
  b: NativeConnectionSelection,
) =>
  a.profileId === b.profileId &&
  a.methodId === b.methodId &&
  a.methodRevision === b.methodRevision &&
  a.configurationGeneration === b.configurationGeneration;
const state = (phase: string): AccountOperationView["state"] =>
  phase === "applied" || phase === "rejected" || phase === "unknown"
    ? phase
    : "pending";

/** Native ingress uses the existing durable personal claim/fence use cases. */
export function createPersonalNativeConnections(input: {
  store: PersonalAccountOperationStore;
  canonical: PersonalCanonicalOperationStore;
  control: Partial<NativeControl>;
  deliverFences(actor: string, nonce: string): Promise<void>;
}) {
  function control(): NativeControl {
    const client = input.control;
    if (
      !client.beginConnection ||
      !client.reconnectConnection ||
      !client.readConnection ||
      !client.submitConnection ||
      !client.pollConnection
    )
      return denied();
    return {
      beginConnection: client.beginConnection,
      reconnectConnection: client.reconnectConnection,
      readConnection: client.readConnection,
      submitConnection: client.submitConnection,
      pollConnection: client.pollConnection,
    };
  }
  async function original(scope: Scope, nonce: string) {
    const receipt = await scope.checked(() =>
      input.store.readOperation(scope.actor, nonce),
    );
    const intent = receipt.intent;
    if (
      (intent.action !== "connect" && intent.action !== "reconnect") ||
      !intent.nativeConnection
    )
      return denied();
    return { receipt, connection: intent.nativeConnection };
  }
  async function read(
    scope: Scope,
    nonce: string,
    handoff?: c.ConnectionOperation,
  ): Promise<AccountOperationView> {
    const saved = await original(scope, nonce);
    const action = saved.receipt.intent.action;
    const receipt =
      action === "connect"
        ? await readPersonalAccountOperation(scope.actor, nonce, {
            ...scope.deps,
            store: input.store,
          })
        : await readPersonalCanonicalOperation(scope.actor, nonce, scope.deps);
    let snapshot = handoff;
    if (
      !snapshot &&
      ["submitted", "unknown", "applied", "rejected"].includes(receipt.phase)
    ) {
      try {
        snapshot = await scope.checked(() =>
          control().readConnection(receipt.id),
        );
      } catch {
        await scope.authorize();
      }
    }
    if (
      snapshot &&
      (snapshot.operation.operationRef !== receipt.id ||
        !snapshot.connection ||
        !sameSelection(saved.connection, snapshot.connection.connection))
    )
      return denied();
    const native = snapshot?.connection;
    const view: AccountOperationView = {
      nonce,
      state: state(receipt.phase),
      cleanup: "unresolved",
      ...(native
        ? {
            native: {
              connection: { ...native.connection },
              method: nativeConnectionMethodView(native.method),
              ...(native.credential
                ? { credential: nativeCredentialView(native.credential) }
                : {}),
            },
            ...(native.method.interaction.kind === "browser"
              ? {
                  oauthMethod: "browser" as const,
                  completion: {
                    providerLabel: "Provider",
                    inputKind: native.method.interaction.completionInputKind,
                  },
                }
              : native.method.interaction.kind === "device"
                ? { oauthMethod: "device_code" as const }
                : {}),
          }
        : {}),
    };
    if (
      action === "reconnect" &&
      ["fencing", "ready"].includes(receipt.phase)
    ) {
      try {
        await scope.checked(() => input.deliverFences(scope.actor, nonce));
      } catch {
        await scope.authorize();
      }
      const ready = await scope.checked(() =>
        input.canonical.ready(scope.actor, nonce),
      );
      if (
        ready.phase === "ready" &&
        (
          await scope.checked(() =>
            input.canonical.listFences(scope.actor, nonce),
          )
        ).length === 0
      )
        view.resume = {
          kind: "reconnect",
          connectionId: ready.source.id,
          profileId: saved.connection.profileId,
          gatewayRevision: ready.intent.expectedGatewayRevision,
          mirrorRevision: ready.intent.expectedSourceMetadataRevision,
          nativeConnection: { ...saved.connection },
        };
    }
    const sourceId = receipt.source?.id;
    if (receipt.phase === "applied" && sourceId) {
      const source = await scope.checked(() =>
        input.store.findOwnedSource(scope.actor, sourceId),
      );
      view.account = await scope.project(source, {
        id: saved.connection.profileId,
        label: "Provider account",
        protocol: "openai-responses",
        models: [],
        canReconnect: false,
      });
    }
    await scope.authorize();
    return view;
  }
  async function begin(
    scope: Scope,
    request: AccountNativeConnectionIntent,
    inputFields: Readonly<Record<string, string>>,
    retain: () => void,
  ): Promise<AccountOAuthBeginView> {
    const selection = snapshotNativeConnectionIntent({
      schemaVersion: 1,
      ...request.connection,
    });
    let prior: Awaited<ReturnType<typeof original>> | undefined;
    try {
      prior = await original(scope, request.nonce);
    } catch (error) {
      if (
        !(error instanceof ProviderAccountError) ||
        error.code !== "not_found"
      )
        throw error;
    }
    if (prior) {
      const intent = prior.receipt.intent;
      if (
        !sameSelection(prior.connection, selection) ||
        (request.existing
          ? intent.action !== "reconnect" ||
            intent.sourceId !== request.existing.connectionId ||
            intent.expectedSourceMetadataRevision !==
              request.existing.mirrorRevision ||
            intent.expectedGatewayRevision !== request.existing.gatewayRevision
          : intent.action !== "connect" ||
            (request.label !== undefined &&
              intent.displayName !== request.label))
      )
        return conflict();
      retain();
      if (
        ["submitted", "unknown", "applied", "rejected"].includes(
          prior.receipt.phase,
        )
      )
        return { operation: await read(scope, request.nonce) };
    }
    const profile = (await scope.catalogue()).find(
      (row) => row.id === selection.profileId,
    );
    const method = profile?.connection?.nativeMethods?.find(
      (row) => row.methodId === selection.methodId,
    );
    if (
      !profile ||
      profile.availability !== "enabled" ||
      !method ||
      method.revision !== selection.methodRevision ||
      method.configurationGeneration !== selection.configurationGeneration ||
      !nativeConnectionMethodAllowed(
        method,
        request.existing ? "reconnect" : "create",
      )
    )
      return denied();
    if (!nativeConnectionInputsAllowed(method, inputFields))
      throw new ProviderAccountError("invalid_input");
    const client = control();
    let handoff: c.ConnectionBeginResponse | undefined;
    if (!request.existing) {
      const personalWorkspaceId = await scope.checked(() =>
        input.store.resolvePersonalWorkspace(scope.actor),
      );
      retain();
      await connectPersonalAccount(
        {
          action: "connect",
          actorUserId: scope.actor,
          personalWorkspaceId,
          clientOperationId: request.nonce,
          proposedSourceId: `rrps_${createHash("sha256")
            .update(JSON.stringify([scope.actor, request.nonce]))
            .digest("hex")}`,
          profileId: selection.profileId,
          displayName: request.label || profile.label,
          ingress: "native-begin",
          nativeConnection: selection,
        },
        { ...scope.deps, store: input.store },
        async () => {
          handoff = await scope.checked(() =>
            client.beginConnection({
              operationId: personalOperationId(scope.actor, request.nonce),
              ownerRef: accountGatewayUserOwnerRef(scope.actor),
              displayName: request.label || profile.label,
              connection: request.connection,
              inputFields,
            }),
          );
        },
      );
    } else {
      if (!prior) {
        const source = await scope.checked(() =>
          input.store.findOwnedSource(
            scope.actor,
            request.existing!.connectionId,
          ),
        );
        if (source.profileRef !== selection.profileId) return denied();
        const account = await scope.get(source);
        if (account.metadataRevision !== request.existing.gatewayRevision)
          throw new ProviderAccountError("revision_conflict");
        const personalWorkspaceId = await scope.checked(() =>
          input.store.resolvePersonalWorkspace(scope.actor),
        );
        retain();
        await beginPersonalCanonicalOperation(
          {
            action: "reconnect",
            actorUserId: scope.actor,
            personalWorkspaceId,
            clientOperationId: request.nonce,
            sourceId: source.id,
            expectedSourceMetadataRevision: request.existing.mirrorRevision,
            expectedGatewayRevision: account.metadataRevision,
            expectedAuthorizationEpoch: account.authorizationEpoch,
            nativeConnection: selection,
          },
          scope.deps,
        );
      }
      retain();
      try {
        await scope.checked(() =>
          input.deliverFences(scope.actor, request.nonce),
        );
      } catch {
        await scope.authorize();
        return { operation: await read(scope, request.nonce) };
      }
      await submitPersonalCanonicalOperation(
        scope.actor,
        request.nonce,
        scope.deps,
        async (command) => {
          if (command.action !== "reconnect") return denied();
          handoff = await scope.checked(() =>
            client.reconnectConnection(command.accountRef, {
              operationId: command.operationId,
              expectedMetadataRevision: command.expectedMetadataRevision,
              connection: request.connection,
              inputFields,
            }),
          );
        },
      );
    }
    const operation = await read(scope, request.nonce, handoff);
    return {
      operation,
      ...(handoff?.challenge?.kind === "browser"
        ? { authorizationURL: handoff.challenge.authorizationURL }
        : {}),
      ...(handoff?.challenge?.kind === "device"
        ? {
            deviceAuthorization: {
              userCode: handoff.challenge.userCode,
              verificationURL: handoff.challenge.verificationURL,
              expiresAt: handoff.challenge.expiresAt,
              intervalSeconds: handoff.challenge.intervalSeconds,
            },
          }
        : {}),
    };
  }
  async function continueConnection(
    scope: Scope,
    nonce: string,
    inputFields: Readonly<Record<string, string>> | undefined,
    retain: () => void,
  ) {
    const saved = await original(scope, nonce);
    if (!["submitted", "unknown"].includes(saved.receipt.phase))
      return read(scope, nonce);
    const client = control();
    const originalNative = await scope.checked(() =>
      client.readConnection(saved.receipt.id),
    );
    if (
      !originalNative.connection ||
      !sameSelection(saved.connection, originalNative.connection.connection) ||
      originalNative.operation.operationRef !== saved.receipt.id
    )
      return denied();
    if (originalNative.operation.state !== "pending")
      return read(scope, nonce, originalNative);
    const kind = originalNative.connection.method.interaction.kind;
    const request = {
      operationId: saved.receipt.id,
      ownerRef: accountGatewayUserOwnerRef(scope.actor),
    };
    retain();
    const result =
      inputFields !== undefined &&
      kind === "browser" &&
      Object.keys(inputFields).length === 1 &&
      typeof inputFields.completion === "string"
        ? await scope.checked(() =>
            client.submitConnection({ ...request, inputFields }),
          )
        : inputFields === undefined && kind === "device"
          ? await scope.checked(() => client.pollConnection(request))
          : denied();
    return read(scope, nonce, result);
  }
  return { begin, read, continue: continueConnection };
}
