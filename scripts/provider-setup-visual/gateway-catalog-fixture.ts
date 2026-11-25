/**
 * Harness-only Account Gateway management API of a run without personal
 * account sharing: a loopback server that answers the profile catalog (and an
 * empty account list) the dashboard reads to validate a Gateway selection.
 * Everything else is 404. The dedicated reviewer-roster flow opts into exact
 * seeded organization-account metadata and two controlled model capabilities;
 * this permits configuration writes, without exposing any inference endpoint.
 * The separate native visibility flow adds consumer-control reads for the
 * existing personal/shared PG accounts; RR still authorizes each private read.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  nativeVisualCatalog,
  VISUAL_NATIVE_PROFILE,
} from "./native-catalog-fixture.js";
import {
  createNativeVisibilityFixture,
  type NativeVisibilityFixture,
} from "./native-visibility-fixture.js";
import {
  createNativeOperationsFixture,
  type NativeOperationsFixture,
} from "./native-operations-fixture.js";
import {
  VISUAL_GATEWAY_PROFILE,
  VISUAL_CONNECTIONS,
  VISUAL_WORKSPACES,
} from "./fixture-contract.js";

const NVIDIA_EVAL_PROFILE = {
  profileId: "nvidia-build-chat-apikey-v1",
  protocol: "openai-responses",
  modelIds: ["nvidia/nemotron-3.5-super-vl-120b-a12b"],
  authKinds: ["api_key"],
} as const;

const NVIDIA_EVAL_CAPABILITY = {
  contract: "provider-connections/v1",
  profileId: NVIDIA_EVAL_PROFILE.profileId,
  provider: { identity: "nvidia", label: "NVIDIA Build" },
  plan: { identity: "unknown", label: "NVIDIA API trial (evaluation only)" },
  region: { identity: "global", label: "Global" },
  protocol: "openai-responses",
  modelIds: [...NVIDIA_EVAL_PROFILE.modelIds],
  authMethods: ["api_key"],
  completionInputKind: "none",
  availability: "enabled",
  oauthCallbackMode: null,
  reconnect: "replace_api_key",
  limitsContract: "none",
  models: NVIDIA_EVAL_PROFILE.modelIds.map((modelId) => ({
    modelId,
    reasoning: null,
    fast: null,
    // Matches the independently tested sandbox function-call contract.
    tools: { allowed: ["function"], default: "function" },
  })),
} as const;

const NATIVE_IMPORT_PROFILES = [
  {
    profileId: "openai-codex-oauth-responses-v1",
    provider: "openai",
    label: "Codex",
    authKind: "oauth",
  },
  {
    profileId: "anthropic-messages-apikey-v1",
    provider: "anthropic",
    label: "Anthropic",
    authKind: "api_key",
  },
  {
    profileId: "gemini-openai-chat-apikey-v1",
    provider: "gemini",
    label: "Gemini",
    authKind: "api_key",
  },
] as const;

export type GatewayCatalogFixture = Readonly<{
  /** Environment that points the dashboard at this server. */
  environment: Readonly<Record<string, string>>;
  nativeOperations: NativeOperationsFixture;
  nativeVisibility?: NativeVisibilityFixture;
  stop(): Promise<void>;
}>;

export async function startGatewayCatalogFixture(
  options: {
    reviewerAccounts?: boolean;
    nvidiaEvaluation?: boolean;
    accountMetadata?: boolean;
    credentialImports?: boolean;
    nativeVisibility?: boolean;
  } = {},
): Promise<GatewayCatalogFixture> {
  const token = randomBytes(24).toString("base64url");
  const personalToken = randomBytes(24).toString("base64url");
  const nativeOperations = createNativeOperationsFixture();
  const nativeVisibility = options.nativeVisibility
    ? createNativeVisibilityFixture()
    : undefined;
  let failedModelRefresh = false;
  const server: Server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    const realm =
      request.headers.authorization === `Bearer ${token}`
        ? "management"
        : nativeVisibility?.active &&
            request.headers.authorization === `Bearer ${personalToken}`
          ? "consumer-control"
          : null;
    if (!realm) return send(401, { error: "unauthorized" });
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (await nativeVisibility?.handle(request, path, realm, send)) return;
    if (await nativeOperations.handle(request, path, send)) return;
    const nativeAccount = nativeOperations
      .accounts()
      .find((row) => path === `/v1/accounts/${row.accountRef}`);
    if (request.method === "GET" && nativeAccount)
      return send(200, nativeAccount);
    const accountRows = Object.values(VISUAL_CONNECTIONS)
      .filter((row) => row.owner.kind === "workspace")
      .map((connection) => ({
        accountRef: connection.gatewayAccountRef,
        ownerRef: `rrw_${createHash("sha256")
          .update(
            [
              "rr-workspace-owner-v1",
              VISUAL_WORKSPACES[connection.workspace].id,
            ].join(String.fromCharCode(0)),
          )
          .digest("hex")}`,
        profileId: connection.profileRef,
        displayName: connection.displayName,
        state: "active",
        metadataRevision: 1,
        authorizationEpoch: 1,
      }));
    const metadataRows = [...accountRows, ...nativeOperations.accounts()];
    if (
      options.accountMetadata &&
      request.method === "POST" &&
      ["/v1/account-info/read", "/v2/account-info/read"].includes(path)
    ) {
      try {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        const input = JSON.parse(body) as {
          ownerRef: string;
          accountRefs: string[];
        };
        if (
          !Array.isArray(input.accountRefs) ||
          input.accountRefs.length > 50 ||
          input.accountRefs.some(
            (ref) =>
              !metadataRows.some(
                (row) =>
                  row.accountRef === ref && row.ownerRef === input.ownerRef,
              ),
          )
        )
          return send(403, { error: "account_unavailable" });
        const known = <T>(value: T, freshness = "current") => ({
          status: "known",
          value,
          source: "provider_api",
          observedAt: "2026-11-19T09:00:00Z",
          freshness,
        });
        return send(200, {
          contract: path.startsWith("/v2/")
            ? "account-info/v2"
            : "account-info/v1",
          accounts: input.accountRefs.map((accountRef) => {
            const account = metadataRows.find(
              (row) => row.accountRef === accountRef,
            )!;
            return {
              accountRef,
              metadataRevision: account.metadataRevision,
              authorizationEpoch: account.authorizationEpoch,
              info:
                account.profileId === VISUAL_NATIVE_PROFILE ||
                accountRef === VISUAL_CONNECTIONS.lockedOrg.gatewayAccountRef
                  ? { status: "unsupported" }
                  : {
                      status: "available",
                      infoRevision: "visual-native-info-1",
                      fields: {
                        email: known(
                          "review-team-with-a-deliberately-long-account-name@example.invalid",
                        ),
                        accountLabel: { status: "unknown" },
                        subscription: known({
                          code: "team",
                          label:
                            "Team annual subscription with extended native account details",
                          scope: "organization",
                          endsAt: { kind: "date", value: "2026-12-31" },
                        }),
                        credentialExpiresAt: known("2026-11-30T23:00:00Z"),
                        ...(path.startsWith("/v2/")
                          ? { trainingUsage: known("disabled", "stale") }
                          : { privacyMode: { status: "unsupported" } }),
                      },
                    },
            };
          }),
        });
      } catch {
        return send(400, { error: "invalid_metadata_request" });
      }
    }
    const models = options.reviewerAccounts
      ? ["gpt-5.5", "gpt-5.4"]
      : [...VISUAL_GATEWAY_PROFILE.modelIds];
    const qualified = models.map((modelId) => ({
      modelId,
      reasoning: { allowed: ["medium", "high", "xhigh"], default: "high" },
      fast: null,
      tools: { allowed: ["function"], default: "function" },
    }));
    if (
      options.reviewerAccounts &&
      request.method === "POST" &&
      path === "/v1/account-models/read"
    ) {
      try {
        let body = "";
        for await (const chunk of request) body += String(chunk);
        const input = JSON.parse(body) as Record<string, unknown>;
        const connection = Object.values(VISUAL_CONNECTIONS).find(
          (row) =>
            row.owner.kind === "workspace" &&
            row.gatewayAccountRef === input.accountRef &&
            row.profileRef === input.profileId,
        );
        if (!connection || input.expectedAuthorizationEpoch !== 1)
          return send(403, { error: "binding_unavailable" });
        const ownerRef = `rrw_${createHash("sha256")
          .update(
            [
              "rr-workspace-owner-v1",
              VISUAL_WORKSPACES[connection.workspace].id,
            ].join(String.fromCharCode(0)),
          )
          .digest("hex")}`;
        if (input.ownerRef !== ownerRef)
          return send(403, { error: "binding_unavailable" });
        if (input.forceRefresh === true && !failedModelRefresh) {
          failedModelRefresh = true;
          return send(503, { error: "temporary_catalog_unavailable" });
        }
        return send(200, {
          status: "snapshot",
          source: "openrouter",
          physicalGeneration: "visual-physical-generation",
          principalVersion: "visual-principal-version",
          fetchedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          models: qualified,
        });
      } catch {
        return send(400, { error: "invalid_models_request" });
      }
    }
    if (request.method === "GET" && path === "/v1/profiles")
      return send(200, {
        profiles: [
          { ...VISUAL_GATEWAY_PROFILE, modelIds: models },
          ...(options.credentialImports
            ? NATIVE_IMPORT_PROFILES.map((profile) => ({
                profileId: profile.profileId,
                protocol: "openai-responses",
                modelIds: models,
                authKinds: [profile.authKind],
              }))
            : []),
          ...(options.nvidiaEvaluation ? [NVIDIA_EVAL_PROFILE] : []),
        ],
      });
    if (
      request.method === "GET" &&
      [
        "/v2/provider-connection-capabilities",
        "/v3/provider-connection-capabilities",
      ].includes(path)
    ) {
      if (path.startsWith("/v3/") && !nativeOperations.discoveryAvailable)
        return send(503, { error: "catalog_unavailable" });
      const identity = {
        region: { id: "global", label: "Global" },
        protocol: "openai-responses",
        models: qualified,
        accountInfo: true,
        limitsContract: "none",
        availability: "enabled",
      };
      const catalog = {
        contract: "provider-connections/v2",
        capabilities: [
          {
            ...identity,
            profileId: VISUAL_GATEWAY_PROFILE.profileId,
            provider: { id: "openrouter", label: "OpenRouter" },
            product: { id: "pay_as_you_go", label: "API" },
            methods: [{ kind: "api_key", create: true, reconnect: true }],
          },
          ...(options.credentialImports ? NATIVE_IMPORT_PROFILES : []).map(
            (profile) => ({
              ...identity,
              profileId: profile.profileId,
              provider: { id: profile.provider, label: profile.label },
              product: {
                id:
                  profile.authKind === "oauth"
                    ? "subscription"
                    : "pay_as_you_go",
                label:
                  profile.authKind === "oauth" ? "Codex subscription" : "API",
              },
              methods:
                profile.authKind === "api_key"
                  ? [{ kind: "api_key", create: true, reconnect: true }]
                  : [
                      {
                        kind: "browser",
                        completionInputKind: "callback_url",
                        callbackMode: "manual_callback_url",
                        create: true,
                        reconnect: false,
                      },
                      { kind: "device_code", create: true, reconnect: false },
                      {
                        kind: "credential_import",
                        method: "refresh_token",
                        maxBytes: 65536,
                        create: true,
                        reconnect: true,
                      },
                      {
                        kind: "credential_import",
                        method: "oauth_auth_json",
                        maxBytes: 65536,
                        create: true,
                        reconnect: true,
                      },
                    ],
            }),
          ),
          ...(options.nvidiaEvaluation
            ? [
                {
                  ...identity,
                  profileId: NVIDIA_EVAL_PROFILE.profileId,
                  provider: { id: "nvidia", label: "NVIDIA Build" },
                  product: { id: "unknown", label: "API key" },
                  models: NVIDIA_EVAL_CAPABILITY.models,
                  methods: [{ kind: "api_key", create: true, reconnect: true }],
                },
              ]
            : []),
        ],
      };
      return send(
        200,
        path.startsWith("/v3/")
          ? nativeVisualCatalog(
              catalog.capabilities,
              options.credentialImports === true ||
                nativeVisibility?.active === true,
              nativeVisibility?.active === true,
            )
          : catalog,
      );
    }
    if (
      (options.reviewerAccounts ||
        options.nvidiaEvaluation ||
        options.accountMetadata) &&
      request.method === "GET" &&
      path === "/v1/provider-connection-capabilities"
    ) {
      return send(200, {
        contract: "provider-connections/v1",
        capabilities: [
          ...(options.reviewerAccounts || options.accountMetadata
            ? [
                {
                  contract: "provider-connections/v1",
                  profileId: VISUAL_GATEWAY_PROFILE.profileId,
                  provider: { identity: "openrouter", label: "OpenRouter" },
                  plan: { identity: "pay_as_you_go", label: "API" },
                  region: { identity: "global", label: "Global" },
                  protocol: "openai-responses",
                  modelIds: models,
                  authMethods: ["api_key"],
                  completionInputKind: "none",
                  availability: "enabled",
                  oauthCallbackMode: null,
                  reconnect: "replace_api_key",
                  limitsContract: "none",
                  models: qualified,
                },
              ]
            : []),
          ...(options.nvidiaEvaluation ? [NVIDIA_EVAL_CAPABILITY] : []),
        ],
      });
    }
    if (
      (options.reviewerAccounts || options.accountMetadata) &&
      request.method === "GET"
    ) {
      const connection = Object.values(VISUAL_CONNECTIONS).find(
        (row) =>
          row.owner.kind === "workspace" &&
          path === `/v1/accounts/${row.gatewayAccountRef}`,
      );
      if (connection)
        return send(200, {
          accountRef: connection.gatewayAccountRef,
          ownerRef: `rrw_${createHash("sha256")
            .update(
              [
                "rr-workspace-owner-v1",
                VISUAL_WORKSPACES[connection.workspace].id,
              ].join(String.fromCharCode(0)),
            )
            .digest("hex")}`,
          profileId: connection.profileRef,
          displayName: connection.displayName,
          state: "active",
          metadataRevision: 1,
          authorizationEpoch: 1,
        });
    }
    if (request.method === "GET" && path === "/v1/accounts") {
      const ownerRef = new URL(
        request.url ?? "/",
        "http://127.0.0.1",
      ).searchParams.get("ownerRef");
      return send(200, {
        accounts: [
          ...(options.accountMetadata
            ? accountRows.filter((row) => row.ownerRef === ownerRef)
            : []),
          ...nativeOperations
            .accounts()
            .filter((row) => row.ownerRef === ownerRef),
        ],
      });
    }
    return send(404, { error: "not_found" });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address !== "object")
    throw new Error("provider_visual_gateway_fixture_unavailable");
  return {
    nativeOperations,
    ...(nativeVisibility ? { nativeVisibility } : {}),
    environment: {
      REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN: `http://127.0.0.1:${address.port}`,
      REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN: token,
      ...(nativeVisibility
        ? {
            REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_ORIGIN: `http://127.0.0.1:${address.port}`,
            REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_TOKEN: personalToken,
          }
        : {}),
      REVIEW_ROUTER_ACCOUNT_GATEWAY_ACCOUNTS_CONTEXT_SECRET:
        randomBytes(32).toString("base64url"),
      // The fixture profile is an approved key profile of this deployment.
      REVIEW_ROUTER_ACCOUNT_GATEWAY_OPENROUTER_PROFILE_ID:
        VISUAL_GATEWAY_PROFILE.profileId,
      ...(options.credentialImports
        ? {
            REVIEW_ROUTER_ACCOUNT_GATEWAY_CODEX_OAUTH_PROFILE_ID:
              "openai-codex-oauth-responses-v1",
          }
        : {}),
      ...(options.nvidiaEvaluation
        ? {
            REVIEW_ROUTER_ACCOUNT_GATEWAY_NVIDIA_PROFILE_ID:
              NVIDIA_EVAL_PROFILE.profileId,
          }
        : {}),
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
