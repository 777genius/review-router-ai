/**
 * Harness-only Account Gateway management API of a run without personal
 * account sharing: a loopback server that answers the profile catalog (and an
 * empty account list) the dashboard reads to validate a Gateway selection.
 * Everything else is 404. Accounts never become usable through it.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { VISUAL_GATEWAY_PROFILE } from "./fixture-contract.js";

export type GatewayCatalogFixture = Readonly<{
  /** Environment that points the dashboard at this server. */
  environment: Readonly<Record<string, string>>;
  stop(): Promise<void>;
}>;

export async function startGatewayCatalogFixture(): Promise<GatewayCatalogFixture> {
  const token = randomBytes(24).toString("base64url");
  const server: Server = createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: "unauthorized" });
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/v1/profiles")
      return send(200, { profiles: [VISUAL_GATEWAY_PROFILE] });
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
    },
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
