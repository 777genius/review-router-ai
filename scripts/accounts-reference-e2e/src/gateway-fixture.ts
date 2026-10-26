import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FIXTURES, type FixtureSecrets } from "./contracts.ts";
import {
  createAccountModelsFixture,
  CODEX_MODEL_PROFILE,
} from "./account-models-fixture.ts";
import { createLimitsFixture } from "./limits-fixture.ts";
import {
  createSubscriptionFixture,
  subscriptionProfiles,
  apiKeyStorageProfiles,
} from "./subscription-fixture.ts";

export type WireAccount = {
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
  readonly repoRoot: string;
  readonly databaseUrl: string;
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
  const accounts: WireAccount[] = [
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
    ...(process.argv.includes("--limits-fixture")
      ? [
          wire(
            FIXTURES.gateway.accounts.viewerClaude,
            ownerForUser(FIXTURES.users.viewer),
            FIXTURES.sourceLabels.viewerClaude,
            "active",
            1,
            FIXTURES.gateway.claudeProfileId,
          ),
        ]
      : []),
  ];
  if (process.argv.includes("--account-models-fixture")) {
    for (const accountRef of [
      FIXTURES.gateway.accounts.viewerPrimary,
      FIXTURES.gateway.accounts.orgAlpha,
    ]) {
      const index = accounts.findIndex(
        (account) => account.accountRef === accountRef,
      );
      accounts[index] = { ...accounts[index]!, profileId: CODEX_MODEL_PROFILE };
    }
  }
  const accountModels = process.argv.includes("--account-models-fixture")
    ? createAccountModelsFixture(accounts)
    : null;
  const connectionProfiles = process.argv.includes("--api-key-storage-fixture")
    ? apiKeyStorageProfiles
    : subscriptionProfiles;
  const subscriptions =
    process.argv.includes("--subscription-fixture") ||
    process.argv.includes("--api-key-storage-fixture")
      ? createSubscriptionFixture(accounts, connectionProfiles)
      : null;
  const limits = process.argv.includes("--limits-fixture")
    ? createLimitsFixture(accounts)
    : null;
  const probes = new Map<
    string,
    { admission: Record<string, unknown>; bearer: string }
  >();
  const probeStats = { preparations: 0, requests: 0, closes: 0 };
  let probeMode = "ok";
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

  let issuer:
    | ((
        raw: unknown,
        signature: unknown,
      ) => Promise<{ status: number; body: unknown }>)
    | undefined;
  let disconnect: (() => Promise<void>) | undefined;
  if (process.argv.includes("--probe-fixture")) {
    const dbModule = await import(
      pathToFileURL(join(input.repoRoot, "packages/platform/db/src/index.ts"))
        .href
    );
    const module = await import(
      pathToFileURL(
        join(input.repoRoot, "apps/api/src/dashboard-gateway-probe-access.ts"),
      ).href
    );
    const { createConsumerControlClient } = await import(
      pathToFileURL(
        join(
          input.repoRoot,
          "apps/api/node_modules/@agent-teams/account-gateway/dist/http/index.js",
        ),
      ).href
    );
    const prisma = dbModule.createPrismaClient({
      databaseUrl: input.databaseUrl,
    });
    disconnect = () => prisma.$disconnect();
    issuer = module.createDashboardGatewayProbeAccess({
      prisma,
      secret: input.secrets.authSecret,
      profiles: [
        {
          profileId: FIXTURES.gateway.profileId,
          protocol: "openai-responses",
          modelIds: ["rr-e2e-model"],
          authKinds: ["api_key"],
        },
      ],
      control: createConsumerControlClient({
        role: "consumer-control",
        origin: url,
        token: input.secrets.personalControlToken,
      }),
      executionOrigin: url,
      env: { REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED: "1" },
    });
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
    log: string[],
  ): Promise<void> {
    const requestUrl = new URL(request.url ?? "/", url);
    const route = `${request.method ?? "GET"} ${requestUrl.pathname}`;
    log.push(route);
    subscriptions?.observe(request.method ?? "GET", requestUrl.pathname);
    await writeFile(
      join(input.workDir, "gateway-requests.jsonl"),
      `${JSON.stringify({ route, at: new Date().toISOString() })}\n`,
      { mode: 0o600, flag: "a" },
    );
    if (
      requestUrl.pathname === "/internal/dashboard/gateway-probe-access" &&
      issuer &&
      request.method === "POST"
    ) {
      const result = await issuer(
        await readJson(request),
        request.headers["x-reviewrouter-probe-proof"],
      );
      send(response, result.status, result.body);
      return;
    }
    if (accountModels && requestUrl.pathname === "/__account-models-fixture") {
      if (request.method === "POST")
        accountModels.configure(await readJson(request));
      send(response, 200, accountModels.stats());
      return;
    }
    if (subscriptions && requestUrl.pathname === "/__subscription-fixture") {
      send(response, 200, subscriptions.stats());
      return;
    }
    if (limits && requestUrl.pathname === "/__limits-fixture") {
      if (request.method === "POST") limits.configure(await readJson(request));
      send(response, 200, limits.stats());
      return;
    }
    // Opt-in synthetic transport contract; never enabled in product code.
    if (process.argv.includes("--probe-fixture")) {
      if (requestUrl.pathname === "/__probe-fixture") {
        if (request.method === "POST") {
          const config = await readJson(request);
          probeMode = String(config.mode ?? "ok");
        }
        send(response, 200, { ...probeStats, mode: probeMode });
        return;
      }
      if (
        requestUrl.pathname === "/internal/v1/run-access" &&
        request.method === "POST" &&
        request.headers.authorization ===
          `Bearer ${input.secrets.personalControlToken}`
      ) {
        const body = await readJson(request);
        const refs = body.accountRefs as string[];
        const account = accounts.find(
          (item) => item.accountRef === refs?.[0] && item.state === "active",
        );
        if (!account || (body.limits as { requests?: number }).requests !== 1) {
          send(response, 403, safeError("forbidden", "probe-denied"));
          return;
        }
        const executionRef = `probe-execution-${probes.size + 1}`;
        const bearer = `synthetic-${executionRef}-bearer`;
        const admission = {
          invocationRef: body.invocationRef,
          attemptRef: body.attemptRef,
          accountRef: account.accountRef,
          authorizationEpoch: account.authorizationEpoch,
          subjectRef: body.subjectRef,
          policyRevision: body.policyRevision,
          bindingRevision: body.bindingRevision,
          profileId: body.profileId,
          limits: body.limits,
          expiresAt: body.deadline,
        };
        probes.set(executionRef, { admission, bearer });
        probeStats.preparations++;
        send(response, 200, {
          bearer,
          admission,
          operation: {
            operationRef: body.operationId,
            state: "applied",
            result: {
              kind: "execution",
              executionRef,
              accountRef: account.accountRef,
              authorizationEpoch: account.authorizationEpoch,
              deadline: body.deadline,
              state: "active",
            },
          },
        });
        return;
      }
      const match = requestUrl.pathname.match(
        /^\/v1\/executions\/(probe-execution-\d+)\/(requests|close)$/,
      );
      if (match && request.method === "POST") {
        const execution = probes.get(match[1]!);
        if (
          !execution ||
          request.headers.authorization !== `Bearer ${execution.bearer}`
        ) {
          send(response, 403, safeError("forbidden", "probe-auth"));
          return;
        }
        const body = await readJson(request);
        if (match[2] === "close") {
          probeStats.closes++;
          send(response, 200, {
            operationRef: body.operationId,
            state: "applied",
          });
          return;
        }
        if (
          body.model !== "rr-e2e-model" ||
          body.stream !== true ||
          JSON.stringify(body.input) !==
            JSON.stringify([
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: "Reply with the single word OK.",
                  },
                ],
              },
            ]) ||
          body.service_tier !== "default" ||
          body.store !== false ||
          !request.headers["x-gateway-admission"]
        ) {
          send(response, 400, safeError("invalid_request", "probe-body"));
          return;
        }
        probeStats.requests++;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "x-gateway-request-ref": String(
            request.headers["x-gateway-request-id"],
          ),
        });
        response.flushHeaders();
        // Hold real HTTP stages long enough for the browser to verify progress.
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (response.destroyed) return;
        response.write(
          'data: {"type":"response.output_text.delta","delta":"OK"}\n\n',
        );
        await new Promise((resolve) =>
          setTimeout(resolve, probeMode === "slow" ? 5000 : 600),
        );
        if (response.destroyed) return;
        response.end(
          probeMode === "failed"
            ? 'data: {"type":"response.failed","response":{"status":"failed"}}\n\n'
            : 'data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n',
        );
        return;
      }
    }
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
      accountModels &&
      requestUrl.pathname === "/v1/account-models/read" &&
      request.method === "POST"
    ) {
      const result = accountModels.read(await readJson(request));
      send(response, result.status, result.body);
      return;
    }
    if (subscriptions) {
      const result = await subscriptions.handle(
        request.method ?? "GET",
        requestUrl.pathname,
        () => readJson(request),
      );
      if (result) {
        send(response, result.status, result.body);
        return;
      }
    }
    if (limits) {
      const result = await limits.handle(
        request.method ?? "GET",
        requestUrl.pathname,
        () => readJson(request),
      );
      if (result) {
        send(response, result.status, result.body);
        return;
      }
    }
    if (
      (process.argv.includes("--lifecycle-fixture") || subscriptions) &&
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
          authKind:
            account.profileId === "grok-subscription-responses-oauth-v1"
              ? "oauth"
              : "api_key",
          resumeCustody:
            account.state === "suspended" ? "verified" : "not_applicable",
        });
        return;
      }
    }
    if (requestUrl.pathname === "/v1/profiles" && request.method === "GET") {
      send(response, 200, {
        profiles: [
          ...(accountModels
            ? [
                {
                  profileId: CODEX_MODEL_PROFILE,
                  protocol: "openai-responses",
                  modelIds: ["gpt-5.6-sol"],
                  authKinds: ["oauth"],
                },
              ]
            : []),
          ...(subscriptions
            ? connectionProfiles.map((profile) => ({
                profileId: profile.profileId,
                protocol: "openai-responses",
                modelIds: [profile.model],
                authKinds: [profile.provider === "grok" ? "oauth" : "api_key"],
              }))
            : []),
          {
            profileId: FIXTURES.gateway.profileId,
            protocol: "openai-responses",
            modelIds: ["rr-e2e-model"],
            authKinds: ["api_key"],
          },
          ...(limits
            ? [
                {
                  profileId: FIXTURES.gateway.claudeProfileId,
                  protocol: "openai-responses",
                  modelIds: ["claude-sonnet-4-6"],
                  authKinds: ["oauth"],
                },
              ]
            : []),
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
      await disconnect?.();
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
  profileId: string = FIXTURES.gateway.profileId,
): WireAccount {
  return {
    accountRef,
    ownerRef,
    profileId,
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
  code:
    | "unauthenticated"
    | "not_found"
    | "internal_error"
    | "forbidden"
    | "invalid_request",
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
