import { nativeVisualCatalog } from "../../provider-setup-visual/native-catalog-fixture.js";

type LegacyCatalog = Parameters<typeof nativeVisualCatalog>[0];
type Reply = { status: number; body: unknown };
type ObjectValue = Record<string, unknown>;
type Binding = {
  profileId: string;
  methodId: string;
  methodRevision: number;
  configurationGeneration: string;
};

/** Same synthetic profiles, negotiated through the current public contract. */
export function nativeFixtureCatalog(capabilities: LegacyCatalog) {
  const catalog = nativeVisualCatalog(capabilities, false);
  return {
    ...catalog,
    capabilities: catalog.capabilities.map((profile) => ({
      ...profile,
      modelPolicy: {
        sourceId: profile.profileId,
        contract: "native-account-models/v2",
        // NVIDIA has always required its own fresh account list in this fixture.
        unavailableFallback: profile.profileId.startsWith("nvidia-")
          ? "deny"
          : "qualified_anchor",
      },
    })),
  };
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("native_fixture_object_required");
  return Object.fromEntries(Object.entries(value));
}

function binding(value: unknown): Binding {
  const input = object(value);
  if (
    typeof input.profileId !== "string" ||
    typeof input.methodId !== "string" ||
    typeof input.methodRevision !== "number" ||
    typeof input.configurationGeneration !== "string"
  )
    throw new Error("native_fixture_binding_required");
  return {
    profileId: input.profileId,
    methodId: input.methodId,
    methodRevision: input.methodRevision,
    configurationGeneration: input.configurationGeneration,
  };
}

/** The HTTP boundary retains safe native descriptors, never submitted values.
 * Existing fixture handlers remain the single owner of synthetic effects. */
export function createNativeConnectionFixture(input: {
  catalog: () => ReturnType<typeof nativeFixtureCatalog>;
  account: (accountRef: string) =>
    | {
        ownerRef: string;
        profileId: string;
        metadataRevision: number;
        displayName: string;
      }
    | undefined;
  legacy: (
    method: string,
    path: string,
    body: ObjectValue,
  ) => Promise<Reply | null>;
}) {
  type Method = ReturnType<
    typeof nativeFixtureCatalog
  >["capabilities"][number]["methods"][number];
  type Retained = {
    ownerRef: string;
    intent: string;
    connection: Binding;
    method: Method;
    operation: ObjectValue;
  };
  const receipts = new Map<string, Retained>();
  const credentials = new Map<
    string,
    {
      credentialKind: "api_key" | "oauth";
      credentialPolicy: string;
      refreshPolicy: "native" | "none";
    }
  >();
  function receipt(value: Retained) {
    const result = value.operation.result;
    const accountRef = result ? object(result).accountRef : undefined;
    const policy = value.method.allowedCredentialPolicies[0];
    if (policy !== "provider_key" && policy !== "subscription_session")
      throw new Error("native_fixture_credential_policy_unsupported");
    const credential =
      policy === "provider_key"
        ? {
            credentialKind: "api_key" as const,
            credentialPolicy: policy,
            refreshPolicy: "none" as const,
          }
        : {
            credentialKind: "oauth" as const,
            credentialPolicy: policy,
            refreshPolicy: "native" as const,
          };
    if (value.operation.state === "applied" && typeof accountRef === "string")
      credentials.set(accountRef, credential);
    return {
      operation: value.operation,
      connection: {
        connection: value.connection,
        method: value.method,
        ...(value.operation.state === "applied" ? { credential } : {}),
      },
    };
  }
  return {
    credential: (accountRef: string) => credentials.get(accountRef),
    async handle(
      method: string,
      path: string,
      body: () => Promise<ObjectValue>,
    ): Promise<Reply | null> {
      const get = /^\/v3\/operations\/([^/]+)$/.exec(path);
      if (method === "GET" && get) {
        const retained = receipts.get(decodeURIComponent(get[1]!));
        return retained
          ? { status: 200, body: receipt(retained) }
          : { status: 404, body: { error: "operation_not_observed" } };
      }
      const reconnect =
        /^\/v3\/accounts\/([^/]+)\/connections\/reconnect$/.exec(path);
      if (
        method !== "POST" ||
        (!reconnect && !path.startsWith("/v3/accounts/connections/"))
      )
        return null;
      const request = await body();
      const targetRef = reconnect
        ? decodeURIComponent(reconnect[1]!)
        : undefined;
      const target = targetRef ? input.account(targetRef) : undefined;
      // Reconnect's strict SDK request has no owner field: its canonical target
      // supplies the owner, which is retained with the exact operation intent.
      const ownerRef = reconnect ? target?.ownerRef : request.ownerRef;
      if (
        typeof request.operationId !== "string" ||
        typeof ownerRef !== "string"
      )
        return { status: 400, body: { error: "invalid_operation" } };
      let retained = receipts.get(request.operationId);
      let legacyPath: string;
      let legacyBody: ObjectValue;
      if (path.endsWith("/begin") || reconnect) {
        const selection = binding(request.connection);
        const intent = JSON.stringify({
          action: reconnect ? "reconnect" : "connect",
          accountRef: targetRef,
          ownerRef,
          connection: selection,
          displayName: target?.displayName ?? request.displayName,
          expectedMetadataRevision: request.expectedMetadataRevision,
        });
        if (retained)
          return retained.intent === intent
            ? { status: 200, body: receipt(retained) }
            : { status: 409, body: { error: "operation_intent_conflict" } };
        if (
          reconnect &&
          (!target ||
            target.profileId !== selection.profileId ||
            target.metadataRevision !== request.expectedMetadataRevision)
        )
          return { status: 409, body: { error: "account_binding_conflict" } };
        const descriptor = input
          .catalog()
          .capabilities.find(
            (profile) => profile.profileId === selection.profileId,
          )
          ?.methods.find((item) => item.methodId === selection.methodId);
        if (
          !descriptor ||
          descriptor.revision !== selection.methodRevision ||
          descriptor.configurationGeneration !==
            selection.configurationGeneration ||
          !(reconnect ? descriptor.reconnect : descriptor.create)
        )
          return { status: 409, body: { error: "binding_unavailable" } };
        retained = {
          ownerRef,
          intent,
          connection: selection,
          method: descriptor,
          operation: { operationRef: request.operationId, state: "pending" },
        };
        const browser = descriptor.interaction.kind === "browser";
        legacyPath = reconnect
          ? `/v1/accounts/${reconnect[1]}/reconnect`
          : browser
            ? "/v1/accounts/oauth/begin"
            : "/v1/accounts";
        legacyBody = {
          operationId: request.operationId,
          ownerRef,
          profileId: selection.profileId,
          displayName: request.displayName,
          expectedMetadataRevision: request.expectedMetadataRevision,
          ...(browser
            ? {}
            : {
                credential: {
                  kind:
                    selection.methodId === "api_key"
                      ? "api_key"
                      : "credential_import",
                  ...(selection.methodId === "api_key"
                    ? {}
                    : { method: selection.methodId }),
                  value: object(request.inputFields).credential,
                },
              }),
        };
      } else {
        if (!retained || retained.ownerRef !== ownerRef)
          return { status: 404, body: { error: "operation_not_observed" } };
        if (path.endsWith("/poll"))
          return { status: 200, body: receipt(retained) };
        if (!path.endsWith("/submit")) return null;
        if (retained.method.interaction.kind !== "browser")
          return { status: 409, body: { error: "interaction_mismatch" } };
        legacyPath = "/v1/accounts/oauth/complete";
        const completion = object(request.inputFields).completion;
        legacyBody = {
          operationId: request.operationId,
          ownerRef: request.ownerRef,
          ...(object(retained.method.interaction).completionInputKind ===
          "callback_url"
            ? { callbackURL: completion }
            : { authorizationCode: completion }),
        };
      }
      const result = await input.legacy("POST", legacyPath, legacyBody);
      if (!result || result.status >= 400) return result;
      const response = object(result.body);
      const operation = object(response.operation ?? response);
      const safeOperation = { ...operation };
      delete safeOperation.oauthMethod;
      retained.operation = safeOperation;
      receipts.set(request.operationId, retained);
      return {
        status: result.status,
        body: {
          ...receipt(retained),
          ...(typeof response.authorizationURL === "string"
            ? {
                challenge: {
                  kind: "browser",
                  authorizationURL: response.authorizationURL,
                },
              }
            : {}),
        },
      };
    },
  };
}
