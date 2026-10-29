/**
 * Harness-only Account Gateway management API of a run without personal
 * account sharing: a loopback server that answers the profile catalog (and an
 * empty account list) the dashboard reads to validate a Gateway selection.
 * Everything else is 404. The dedicated reviewer-roster flow opts into exact
 * seeded organization-account metadata and two controlled model capabilities;
 * this permits configuration writes, without exposing any inference endpoint.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  VISUAL_GATEWAY_PROFILE,
  VISUAL_CONNECTIONS,
  VISUAL_WORKSPACES,
} from "./fixture-contract.js";

export type GatewayCatalogFixture = Readonly<{
  /** Environment that points the dashboard at this server. */
  environment: Readonly<Record<string, string>>;
  stop(): Promise<void>;
}>;

export async function startGatewayCatalogFixture(
  options: { reviewerAccounts?: boolean } = {},
): Promise<GatewayCatalogFixture> {
  const token = randomBytes(24).toString("base64url");
  let failedModelRefresh = false;
  const server: Server = createServer(async (request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: "unauthorized" });
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
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
        profiles: [{ ...VISUAL_GATEWAY_PROFILE, modelIds: models }],
      });
    if (
      options.reviewerAccounts &&
      request.method === "GET" &&
      path === "/v1/provider-connection-capabilities"
    ) {
      return send(200, {
        contract: "provider-connections/v1",
        capabilities: [
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
        ],
      });
    }
    if (options.reviewerAccounts && request.method === "GET") {
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
    if (request.method === "GET" && path === "/v1/accounts")
      return send(200, { accounts: [] });
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
    environment: {
      REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN: `http://127.0.0.1:${address.port}`,
      REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN: token,
      REVIEW_ROUTER_ACCOUNT_GATEWAY_ACCOUNTS_CONTEXT_SECRET:
        randomBytes(32).toString("base64url"),
      // The fixture profile is an approved key profile of this deployment.
      REVIEW_ROUTER_ACCOUNT_GATEWAY_OPENROUTER_PROFILE_ID:
        VISUAL_GATEWAY_PROFILE.profileId,
      ...(options.reviewerAccounts
        ? { REVIEW_ROUTER_ACCOUNT_MODEL_CATALOG_ENABLED: "1" }
        : {}),
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
