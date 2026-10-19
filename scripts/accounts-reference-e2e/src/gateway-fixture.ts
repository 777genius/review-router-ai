import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES, type FixtureSecrets } from "./contracts.ts";

type WireAccount = {
  readonly accountRef: string;
  readonly ownerRef: string;
  readonly profileId: string;
  readonly displayName: string;
  readonly state: "active" | "disabled" | "quarantined" | "suspended";
  readonly metadataRevision: number;
  readonly authorizationEpoch: number;
};

export type GatewayFixture = {
  readonly url: string;
  readonly requestCount: number;
  stop(): Promise<void>;
};

export async function startGatewayFixture(input: {
  readonly workDir: string;
  readonly secrets: FixtureSecrets;
}): Promise<GatewayFixture> {
  const ownerForUser = (id: string) =>
    `rru_${createHash("sha256")
      .update(`rr-user-owner-v1\0${id}`)
      .digest("hex")}`;
  const ownerForWorkspace = (id: string) =>
    `rrw_${createHash("sha256")
      .update(`rr-workspace-owner-v1\0${id}`)
      .digest("hex")}`;
  const accounts: readonly WireAccount[] = [
    wire(
      FIXTURES.gateway.accounts.viewerPrimary,
      ownerForUser(FIXTURES.users.viewer),
      FIXTURES.sourceLabels.viewerPrimary,
      "active",
      1,
    ),
    wire(
      FIXTURES.gateway.accounts.viewerLegacyDisabled,
      ownerForUser(FIXTURES.users.viewer),
      FIXTURES.sourceLabels.viewerLegacyDisabled,
      "disabled",
      2,
    ),
    wire(
      FIXTURES.gateway.accounts.viewerSuspendedCapable,
      ownerForUser(FIXTURES.users.viewer),
      FIXTURES.sourceLabels.viewerSuspendedCapable,
      process.argv.includes("--lifecycle-fixture")
        ? "suspended"
        : "quarantined",
      1,
    ),
    wire(
      FIXTURES.gateway.accounts.otherPrimary,
      ownerForUser(FIXTURES.users.other),
      FIXTURES.sourceLabels.otherPrimary,
      "active",
      1,
    ),
    wire(
      FIXTURES.gateway.accounts.orgAlpha,
      ownerForWorkspace(FIXTURES.workspaces.orgAlpha),
      FIXTURES.sourceLabels.orgAlpha,
      "active",
      1,
    ),
    wire(
      FIXTURES.gateway.accounts.foreignPrimary,
      ownerForUser(FIXTURES.users.foreign),
      FIXTURES.sourceLabels.foreignPrimary,
      "active",
      1,
    ),
  ];
  const requests: string[] = [];
  let requestCount = 0;
  const server = createServer((request, response) => {
    requestCount += 1;
    void handle(request, response, requests).catch(() => {
      send(response, 500, safeError("internal_error", "rr-e2e-gateway-error"));
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("accounts_reference_e2e_gateway_address_missing");
  }
  const url = `http://127.0.0.1:${address.port}`;

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    log: string[],
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", url);
    const route = `${request.method ?? "GET"} ${requestUrl.pathname}`;
    log.push(route);
    await writeFile(
      join(input.workDir, "gateway-requests.jsonl"),
      `${JSON.stringify({ route, at: new Date().toISOString() })}\n`,
      { mode: 0o600, flag: "a" },
    );
    if (
      !isAuthorized(
        request,
        input.secrets.managementToken,
        input.secrets.personalControlToken,
      )
    ) {
      send(response, 401, safeError("unauthenticated", "rr-e2e-gateway-auth"));
      return;
    }
    if (
      process.argv.includes("--lifecycle-fixture") &&
      request.method === "GET"
    ) {
      if (requestUrl.pathname === "/v2/capabilities/account-lifecycle") {
        send(response, 200, {
          contract: "account-gateway/account-lifecycle/v2",
          clientContract: "account-gateway-client/account-lifecycle/v2",
          writeGate: "enabled",
          operations: ["suspend", "resume"],
          custody: {
            contract: "native-retained-custody/v1",
            api_key: "native-attestation-required",
            oauth: "native-attestation-required",
          },
        });
        return;
      }
      const match = requestUrl.pathname.match(
        /^\/v2\/accounts\/([A-Za-z0-9_-]+)$/,
      );
      if (match) {
        const account = accounts.find((item) => item.accountRef === match[1]);
        if (!account) {
          send(response, 404, safeError("not_found", "rr-e2e-v2-account"));
          return;
        }
        send(response, 200, {
          ...account,
          authKind: "api_key",
          resumeCustody:
            account.state === "suspended" ? "verified" : "not_applicable",
        });
        return;
      }
    }
    if (requestUrl.pathname === "/v1/profiles" && request.method === "GET") {
      send(response, 200, {
        profiles: [
          {
            profileId: FIXTURES.gateway.profileId,
            protocol: "openai-responses",
            modelIds: ["rr-e2e-model"],
            authKinds: ["api_key"],
          },
        ],
      });
      return;
    }
    if (requestUrl.pathname === "/v1/accounts" && request.method === "GET") {
      const ownerRef = requestUrl.searchParams.get("ownerRef");
      const filtered = ownerRef
        ? accounts.filter((account) => account.ownerRef === ownerRef)
        : accounts;
      send(response, 200, {
        accounts: filtered.slice(0, 25).map(legacyWire),
        ...(filtered.length > 25
          ? { nextCursor: filtered[25]!.accountRef }
          : {}),
      });
      return;
    }
    const accountMatch = requestUrl.pathname.match(
      /^\/v1\/accounts\/([A-Za-z0-9_-]+)$/,
    );
    if (accountMatch && request.method === "GET") {
      const account = accounts.find(
        (item) => item.accountRef === accountMatch[1],
      );
      if (!account) {
        send(response, 404, safeError("not_found", "rr-e2e-gateway-account"));
        return;
      }
      send(response, 200, legacyWire(account));
      return;
    }
    const operationMatch = requestUrl.pathname.match(
      /^\/v1\/operations\/([A-Za-z0-9_-]+)$/,
    );
    if (operationMatch && request.method === "GET") {
      send(response, 200, {
        operationRef: operationMatch[1],
        state: "applied",
        result: {
          kind: "account",
          accountRef: accounts[0]!.accountRef,
          metadataRevision: accounts[0]!.metadataRevision,
          authorizationEpoch: accounts[0]!.authorizationEpoch,
        },
      });
      return;
    }
    if (
      requestUrl.pathname === "/v1/policy-fences" &&
      request.method === "POST"
    ) {
      const body = await readJson(request);
      send(response, 200, {
        operationRef: String(body.operationId ?? "rr-e2e-fence"),
        state: "applied",
      });
      return;
    }
    const disableMatch = requestUrl.pathname.match(
      /^\/v1\/accounts\/([A-Za-z0-9_-]+)\/disable$/,
    );
    if (disableMatch && request.method === "POST") {
      const body = await readJson(request);
      const account = accounts.find(
        (item) => item.accountRef === disableMatch[1],
      );
      if (!account) {
        send(response, 404, safeError("not_found", "rr-e2e-gateway-account"));
        return;
      }
      send(response, 200, {
        operationRef: String(body.operationId ?? "rr-e2e-disable"),
        state: "applied",
        result: {
          kind: "account",
          accountRef: account.accountRef,
          metadataRevision: account.metadataRevision + 1,
          authorizationEpoch: account.authorizationEpoch,
        },
      });
      return;
    }
    send(response, 404, safeError("not_found", "rr-e2e-gateway-route"));
  }

  return {
    url,
    get requestCount() {
      return requestCount;
    },
    async stop() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function wire(
  accountRef: string,
  ownerRef: string,
  displayName: string,
  state: WireAccount["state"],
  metadataRevision: number,
): WireAccount {
  return {
    accountRef,
    ownerRef,
    profileId: FIXTURES.gateway.profileId,
    displayName,
    state,
    metadataRevision: state === "suspended" ? 2 : metadataRevision,
    authorizationEpoch: state === "suspended" ? 2 : 1,
  };
}

function isAuthorized(
  request: IncomingMessage,
  managementToken: string,
  personalControlToken: string,
): boolean {
  const authorization = request.headers.authorization ?? "";
  return (
    authorization === `Bearer ${managementToken}` ||
    authorization === `Bearer ${personalControlToken}`
  );
}

async function readJson(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

function safeError(
  code: "unauthenticated" | "not_found" | "internal_error",
  traceRef: string,
): Record<string, unknown> {
  return {
    code,
    traceRef,
    effect: "not_dispatched",
    retry: { kind: "never" },
  };
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function legacyWire(account: WireAccount) {
  return {
    ...account,
    state: account.state === "suspended" ? "quarantined" : account.state,
  };
}
