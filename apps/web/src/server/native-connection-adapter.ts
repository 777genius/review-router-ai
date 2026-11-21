import { z } from "zod";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  GatewayError,
  type ManagementClient,
} from "@agent-teams/account-gateway/http";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import {
  nativeConnectionMethodView,
  nativeCredentialView,
} from "./native-connection-view";
import {
  nativeConnectionMethodAllowed,
  nativeConnectionInputsAllowed,
  snapshotNativeConnectionInputs,
  type NativeConnectionSelection,
} from "../features/account-gateway/domain/native-connection";
import type {
  AccountOperationView,
  AccountOAuthBeginView,
  AccountProfileView,
  AccountsResult,
} from "./account-gateway-accounts";

export type AccountNativeConnectionIntent = {
  nonce: string;
  connection: NativeConnectionSelection;
  label?: string;
  existing?: {
    connectionId: string;
    gatewayRevision: number;
    mirrorRevision: number;
  };
};
const nonceSchema = z.string().uuid();
const intentSchema = z.strictObject({
  nonce: nonceSchema,
  connection: c.connectionBinding,
  label: z
    .string()
    .trim()
    .max(120)
    .refine((value) => Buffer.byteLength(value) <= 400)
    .optional(),
  existing: z
    .strictObject({
      connectionId: c.reference,
      gatewayRevision: c.revision,
      mirrorRevision: c.revision,
    })
    .optional(),
});
export const snapshotNativeConnectionRequest = (
  value: unknown,
): AccountNativeConnectionIntent => {
  const parsed = intentSchema.parse(value);
  return {
    nonce: parsed.nonce,
    connection: parsed.connection,
    ...(parsed.label === undefined ? {} : { label: parsed.label }),
    ...(parsed.existing === undefined ? {} : { existing: parsed.existing }),
  };
};
type NativeClient = Pick<
  ManagementClient,
  | "beginConnection"
  | "reconnectConnection"
  | "submitConnection"
  | "pollConnection"
  | "readConnection"
>;

/** SDK adapter around existing RR authorization, mirror CAS and operation projection. */
export function createNativeConnectionAdapter<Scope>(input: {
  authorize(context: string): Promise<Scope>;
  owner(scope: Scope): string;
  operationId(scope: Scope, nonce: string): string;
  client(
    context: string,
    scope: Scope,
    onEnter?: () => Promise<void>,
  ): NativeClient;
  reauthorize(context: string, scope: Scope): Promise<void>;
  profiles(context: string, scope: Scope): Promise<AccountProfileView[]>;
  reconnectTarget(
    context: string,
    scope: Scope,
    intent: AccountNativeConnectionIntent,
    profiles: AccountProfileView[],
  ): Promise<{
    accountRef: string;
    profileId: string;
    metadataRevision: number;
    assertCurrent(): Promise<void>;
  }>;
  project(
    context: string,
    scope: Scope,
    nonce: string,
    operation: c.Operation,
    profiles: AccountProfileView[],
    profileId?: string,
  ): Promise<AccountOperationView>;
  failure(error: unknown): AccountsResult<never>;
}) {
  const denied = (): never => {
    throw new ProviderAccountError("connection_unavailable");
  };
  const unknown = (nonce: string): AccountsResult<AccountOperationView> => ({
    status: "ok",
    value: { nonce, state: "unknown", cleanup: "unresolved" },
  });
  async function project(
    context: string,
    scope: Scope,
    nonce: string,
    result: c.ConnectionOperation,
    profiles?: AccountProfileView[],
  ): Promise<AccountOperationView> {
    if (result.operation.operationRef !== input.operationId(scope, nonce))
      denied();
    const snapshot = result.connection;
    // A pinned method is enough for recovery; discovery is never needed here.
    const catalog =
      profiles ??
      (snapshot
        ? [
            {
              id: snapshot.connection.profileId,
              label: "Provider account",
              protocol: "openai-responses" as const,
              models: [],
              canReconnect: false,
            },
          ]
        : []);
    const view = await input.project(
      context,
      scope,
      nonce,
      result.operation,
      catalog,
      snapshot?.connection.profileId,
    );
    await input.reauthorize(context, scope);
    return snapshot
      ? {
          ...view,
          native: {
            connection: { ...snapshot.connection },
            method: nativeConnectionMethodView(snapshot.method),
            ...(snapshot.credential
              ? { credential: nativeCredentialView(snapshot.credential) }
              : {}),
          },
          ...(snapshot.credential &&
          view.account &&
          result.operation.state === "applied" &&
          result.operation.result?.kind === "account" &&
          view.account.gatewayRevision ===
            result.operation.result.metadataRevision
            ? {
                account: {
                  ...view.account,
                  nativeCredential: nativeCredentialView(snapshot.credential),
                },
              }
            : {}),
          ...(snapshot.method.interaction.kind === "browser"
            ? {
                oauthMethod: "browser" as const,
                completion: {
                  providerLabel: "Provider",
                  inputKind: snapshot.method.interaction.completionInputKind,
                },
              }
            : snapshot.method.interaction.kind === "device"
              ? { oauthMethod: "device_code" as const }
              : {}),
        }
      : view;
  }
  return {
    async begin(
      context: string,
      raw: AccountNativeConnectionIntent,
      values: unknown,
    ): Promise<AccountsResult<AccountOAuthBeginView>> {
      let entered = false;
      let nonce: string | undefined;
      try {
        const intent = snapshotNativeConnectionRequest(raw);
        const inputFields = snapshotNativeConnectionInputs(values);
        nonce = intent.nonce;
        const scope = await input.authorize(context);
        const profiles = await input.profiles(context, scope);
        const profile = profiles.find(
          (profile) => profile.id === intent.connection.profileId,
        );
        const method = profile?.connection?.nativeMethods?.find(
          (method) => method.methodId === intent.connection.methodId,
        );
        if (
          !profile ||
          profile.availability !== "enabled" ||
          !method ||
          method.revision !== intent.connection.methodRevision ||
          method.configurationGeneration !==
            intent.connection.configurationGeneration ||
          !nativeConnectionMethodAllowed(
            method,
            intent.existing ? "reconnect" : "create",
          )
        )
          denied();
        // Field bounds only. Credential and callback grammars remain native-owned.
        if (!nativeConnectionInputsAllowed(method!, inputFields))
          throw new ProviderAccountError("invalid_input");
        const target = intent.existing
          ? await input.reconnectTarget(context, scope, intent, profiles)
          : undefined;
        if (target && target.profileId !== intent.connection.profileId)
          denied();
        const client = input.client(context, scope, async () => {
          await target?.assertCurrent();
          entered = true;
        });
        const result = target
          ? await client.reconnectConnection(target.accountRef, {
              operationId: input.operationId(scope, nonce),
              expectedMetadataRevision: target.metadataRevision,
              connection: intent.connection,
              inputFields,
            })
          : await client.beginConnection({
              operationId: input.operationId(scope, nonce),
              ownerRef: input.owner(scope),
              displayName: intent.label || profile!.label,
              connection: intent.connection,
              inputFields,
            });
        const operation = await project(
          context,
          scope,
          nonce,
          result,
          profiles,
        );
        return {
          status: "ok",
          value: {
            operation,
            ...(result.challenge?.kind === "browser"
              ? { authorizationURL: result.challenge.authorizationURL }
              : {}),
            ...(result.challenge?.kind === "device"
              ? {
                  deviceAuthorization: {
                    userCode: result.challenge.userCode,
                    verificationURL: result.challenge.verificationURL,
                    expiresAt: result.challenge.expiresAt,
                    intervalSeconds: result.challenge.intervalSeconds,
                  },
                }
              : {}),
          },
        };
      } catch (error) {
        if (entered && nonce)
          return {
            status: "ok",
            value: {
              operation: { nonce, state: "unknown", cleanup: "unresolved" },
            },
          };
        return input.failure(error);
      }
    },
    async continue(
      context: string,
      rawNonce: string,
      values?: unknown,
    ): Promise<AccountsResult<AccountOperationView>> {
      let entered = false;
      let nonce: string | undefined;
      try {
        nonce = nonceSchema.parse(rawNonce);
        const inputFields =
          values === undefined
            ? undefined
            : snapshotNativeConnectionInputs(values);
        const scope = await input.authorize(context);
        const client = input.client(context, scope, async () => {
          entered = true;
        });
        const operationId = input.operationId(scope, nonce);
        const original = await client.readConnection(operationId);
        if (
          original.operation.operationRef !== operationId ||
          !original.connection
        )
          denied();
        if (original.operation.state !== "pending")
          return {
            status: "ok",
            value: await project(context, scope, nonce, original),
          };
        const interaction = original.connection!.method.interaction;
        const request = { operationId, ownerRef: input.owner(scope) };
        const result =
          inputFields !== undefined &&
          interaction.kind === "browser" &&
          Object.keys(inputFields).length === 1 &&
          typeof inputFields.completion === "string"
            ? await client.submitConnection({ ...request, inputFields })
            : inputFields === undefined && interaction.kind === "device"
              ? await client.pollConnection(request)
              : denied();
        return {
          status: "ok",
          value: await project(context, scope, nonce, result),
        };
      } catch (error) {
        return nonce &&
          (entered ||
            (error instanceof GatewayError &&
              error.effect === "effect_unknown"))
          ? unknown(nonce)
          : input.failure(error);
      }
    },
    async read(
      context: string,
      rawNonce: string,
    ): Promise<AccountsResult<AccountOperationView>> {
      let nonce: string | undefined;
      try {
        nonce = nonceSchema.parse(rawNonce);
        const scope = await input.authorize(context);
        const result = await input
          .client(context, scope)
          .readConnection(input.operationId(scope, nonce));
        return {
          status: "ok",
          value: await project(context, scope, nonce, result),
        };
      } catch (error) {
        if (
          nonce &&
          error instanceof GatewayError &&
          error.effect === "effect_unknown"
        )
          return unknown(nonce);
        return input.failure(error);
      }
    },
  };
}
