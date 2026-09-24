import { describe, expect, it, vi } from "vitest";
import {
  reviewActionV2PublishedSchemaDigest,
  reviewInvestigationExtensionV1,
} from "@reviewrouter/protocol-review-action-v2";
import { authorizeHostedV4WithFreshOidc } from "../action/hosted-v4-authorize.js";
import { createHostedV4ReadClient } from "../action/hosted-v4-read.js";

const headSha = "a".repeat(40);
const revision = "b".repeat(64);
const expiresAt = "2030-01-01T00:10:00.000Z";
const capability1 = `eyJ2ZXJzaW9uIjoxfQ.${"x".repeat(43)}`;
const capability2 = `eyJ2ZXJzaW9uIjoxfQ.${"y".repeat(43)}`;
const now = () => new Date("2030-01-01T00:00:00.000Z");
const expected = {
  repositoryConnectionId: "connection-7",
  pullRequestNumber: 42,
  headSha,
  reviewRevisionHash: revision,
  producerReleaseId: "release-9",
};
const facts = {
  ...expected,
  workspaceId: "workspace-1",
  scmRepositoryIdentityId: "scm-1",
  sourceRunId: "run-1",
  sourceRunAttempt: "1",
  baseSha: "e".repeat(40),
  mergeBaseSha: "f".repeat(40),
  selectedProtocolVersion: "2",
  schemaDigest: reviewActionV2PublishedSchemaDigest,
  trustDomain: "trusted_managed",
  providerVoteLanes: [
    { providerKind: "codex", providerVoteIdentityHash: "1".repeat(64) },
  ],
  reviewInvestigation: {
    authorizationDescriptorVersion: 3,
    capability: "review_investigation_v1",
    coverageProfileHash: "c".repeat(64),
    extensionCanonicalizerDigest:
      reviewInvestigationExtensionV1.canonicalizerDigest,
    extensionId: reviewInvestigationExtensionV1.extensionId,
    extensionSchemaDigest: reviewInvestigationExtensionV1.schemaDigest,
    policyHash: "d".repeat(64),
    providerCapabilities: [
      { providerKind: "codex", capabilities: ["recording"] },
    ],
  },
};
const limits = Object.fromEntries(
  [
    "maxWorkSlots",
    "maxAttemptsPerSlot",
    "maxObservationBytes",
    "maxObservationFindings",
    "maxProjectionBytes",
    "maxProjectionFindings",
    "maxPublicationOperations",
    "maxPublicationChunks",
    "maxPublicationBodyBytes",
    "maxRequestBatchSize",
    "maxLeaseDurationMs",
    "maxResultReportDurationMs",
    "maxReconciliationDurationMs",
  ].map((name) => [name, 1]),
);
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const env = () => ({
  ACTIONS_ID_TOKEN_REQUEST_URL:
    "https://vstoken.actions.githubusercontent.com/oidc/token",
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-secret",
});
const v2Response = (requestId: string, override: object = {}) => ({
  protocolVersion: "2",
  schemaDigest: reviewActionV2PublishedSchemaDigest,
  requestId,
  serverTime: "2030-01-01T00:00:00.000Z",
  result: {
    status: "authorized",
    authorizationId: "authorization-1",
    authorizationToken: "authorization-secret",
    producerReleaseId: "release-9",
    protocolLimitsProfileId: "limits-1",
    operationalSloProfileId: "slo-1",
    mutationEpoch: "0",
    expiresAt,
    authorizationFactsCanonicalJson: canonicalJson(facts),
    protocolLimitsCanonicalJson: canonicalJson(limits),
    ...override,
  },
});

describe("private hosted v4 client boundary", () => {
  // A generic v1 fallback or altered v2 body would send credentials to the wrong contract.
  it("uses fresh OIDC and the exact v2 authorize request, then exposes the binding gap", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const masks: string[] = [];
    const actionEnv = env();
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init! });
        if (calls.length === 1)
          return Response.json({ value: "fresh-oidc-secret" });
        const request = JSON.parse(String(init?.body));
        return Response.json(v2Response(request.requestId), { status: 201 });
      },
    ) as typeof fetch;
    const authorization = await authorizeHostedV4WithFreshOidc({
      env: actionEnv,
      fetchImpl,
      apiUrl: "https://api.example/",
      oidcAudience: "reviewrouter-prod",
      expected,
      maskSecret: (secret) => masks.push(secret),
      now,
    });
    expect(calls.map((call) => call.url)).toEqual([
      "https://vstoken.actions.githubusercontent.com/oidc/token?audience=reviewrouter-prod",
      "https://api.example/api/action/v2/review-runs/authorize",
    ]);
    expect(calls[0]?.init.headers).toEqual({
      authorization: "bearer request-secret",
    });
    const body = JSON.parse(String(calls[1]?.init.body));
    expect(body).toEqual({
      protocolVersion: "2",
      schemaDigest: reviewActionV2PublishedSchemaDigest,
      requestId: expect.stringMatching(/^rr_hosted_v4_/u),
      oidcToken: "fresh-oidc-secret",
      supportedProtocols: [
        {
          protocolVersion: "2",
          schemaDigest: reviewActionV2PublishedSchemaDigest,
        },
      ],
    });
    expect(authorization).toMatchObject({
      ...expected,
      authorizationToken: "authorization-secret",
      binding: { kind: "server_binding_contract_gap" },
    });
    expect(masks).toEqual([
      "request-secret",
      "fresh-oidc-secret",
      "authorization-secret",
    ]);
    expect(actionEnv).not.toHaveProperty("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
    expect(actionEnv).not.toHaveProperty("ACTIONS_ID_TOKEN_REQUEST_URL");
  });

  // A denied negotiation must never silently retry on v1, including its advertised fallback.
  it("rejects unsupported protocol without fallback or secret logging", async () => {
    const logs: string[] = [];
    const log = vi
      .spyOn(console, "log")
      .mockImplementation((...parts) => logs.push(parts.join(" ")));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation((...parts) => logs.push(parts.join(" ")));
    let count = 0;
    const fetchImpl = vi.fn(async () =>
      ++count === 1
        ? Response.json({ value: "fresh-oidc-secret" })
        : Response.json(
            {
              error: {
                errorCode: "unsupported_protocol",
                details: { fallbackProtocolVersion: "1" },
              },
            },
            { status: 426 },
          ),
    ) as typeof fetch;
    try {
      await expect(
        authorizeHostedV4WithFreshOidc({
          env: env(),
          fetchImpl,
          apiUrl: "https://api.example/",
          oidcAudience: "reviewrouter",
          expected,
          maskSecret: vi.fn(),
          now,
        }),
      ).rejects.toThrow("hosted_v4_authorize_denied_or_ambiguous");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(logs.join(" ")).not.toMatch(
        /fresh-oidc-secret|authorization-secret|request-secret/u,
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  // A stale head or missing recording permission must not become a usable authorization.
  it.each([
    { headSha: "e".repeat(40) },
    {
      reviewInvestigation: {
        ...facts.reviewInvestigation,
        providerCapabilities: [
          { providerKind: "codex", capabilities: ["shadow"] },
        ],
      },
    },
  ])("rejects stale or unsupported authorization facts", async (changed) => {
    let count = 0;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        count++;
        if (count === 1) return Response.json({ value: "oidc-secret" });
        const request = JSON.parse(String(init?.body));
        return Response.json(
          v2Response(request.requestId, {
            authorizationFactsCanonicalJson: canonicalJson({
              ...facts,
              ...changed,
            }),
          }),
          { status: 201 },
        );
      },
    ) as typeof fetch;
    await expect(
      authorizeHostedV4WithFreshOidc({
        env: env(),
        fetchImpl,
        apiUrl: "https://api.example/",
        oidcAudience: "reviewrouter",
        expected,
        maskSecret: vi.fn(),
        now,
      }),
    ).rejects.toThrow("hosted_v4_authority_stale_or_unsupported");
  });

  // An API response with an omitted required token must not be treated as success.
  it("rejects malformed authorization responses", async () => {
    let count = 0;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        count++;
        if (count === 1) return Response.json({ value: "oidc-secret" });
        const request = JSON.parse(String(init?.body));
        return Response.json(
          v2Response(request.requestId, { authorizationToken: null }),
          { status: 201 },
        );
      },
    ) as typeof fetch;
    await expect(
      authorizeHostedV4WithFreshOidc({
        env: env(),
        fetchImpl,
        apiUrl: "https://api.example/",
        oidcAudience: "reviewrouter",
        expected,
        maskSecret: vi.fn(),
        now,
      }),
    ).rejects.toThrow("hosted_v4_authorize_malformed");
  });

  // Noncanonical or incomplete server facts would allow a malformed v2 result to drive v4.
  it.each([
    { authorizationFactsCanonicalJson: JSON.stringify(facts) },
    { protocolLimitsCanonicalJson: "{}" },
    {
      authorizationFactsCanonicalJson: `{"headSha":"${"e".repeat(40)}",${canonicalJson(facts).slice(1)}`,
    },
  ])(
    "rejects noncanonical or incomplete authorization data",
    async (override) => {
      let count = 0;
      const fetchImpl = vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) => {
          count++;
          if (count === 1) return Response.json({ value: "oidc-secret" });
          const request = JSON.parse(String(init?.body));
          return Response.json(v2Response(request.requestId, override), {
            status: 201,
          });
        },
      ) as typeof fetch;
      await expect(
        authorizeHostedV4WithFreshOidc({
          env: env(),
          fetchImpl,
          apiUrl: "https://api.example/",
          oidcAudience: "reviewrouter",
          expected,
          maskSecret: vi.fn(),
          now,
        }),
      ).rejects.toThrow("hosted_v4_authorize_malformed");
    },
  );

  // A client that changes route or body shape cannot be admitted by the private server.
  it("uses exact admission, refresh and scoped file-read endpoints and bodies", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const masks: string[] = [];
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        if (calls.length === 1)
          return Response.json(
            { capability: capability1, expiresAt },
            { status: 201 },
          );
        if (calls.length === 2)
          return Response.json(
            { capability: capability2, expiresAt },
            { status: 200 },
          );
        return Response.json(
          {
            path: "src/index.ts",
            headSha,
            blobSha: "f".repeat(40),
            contentBase64: "aGk=",
          },
          { status: 200 },
        );
      },
    ) as typeof fetch;
    const client = createHostedV4ReadClient({
      fetchImpl,
      apiUrl: "https://api.example/",
      maskSecret: (secret) => masks.push(secret),
      now,
    });
    const authorization = {
      ...expected,
      authorizationId: "authorization-1",
      authorizationToken: "authorization-secret",
      expiresAt,
      binding: { kind: "server_binding_contract_gap" as const },
    };
    const read = await client.admit({
      authorization,
      binding: {
        repositoryConnectionId: expected.repositoryConnectionId,
        providerInstanceId: "hosted-pool:repository:123",
        bindingId: "binding-1",
        bindingVersion: 2,
      },
    });
    const refreshed = await client.refresh({ authorization, read });
    const file = await client.readFile({
      read: refreshed,
      path: "src/index.ts",
    });
    expect(calls).toEqual([
      {
        url: "https://api.example/api/hosted/v4/read-capabilities",
        body: {
          authorizationToken: "authorization-secret",
          repositoryConnectionId: "connection-7",
          providerInstanceId: "hosted-pool:repository:123",
          bindingId: "binding-1",
          bindingVersion: 2,
        },
      },
      {
        url: "https://api.example/api/hosted/v4/read-capabilities/refresh",
        body: {
          capability: capability1,
          authorizationToken: "authorization-secret",
        },
      },
      {
        url: "https://api.example/api/hosted/v4/files/read",
        body: {
          capability: capability2,
          path: "src/index.ts",
        },
      },
    ]);
    expect(file).toEqual({
      path: "src/index.ts",
      headSha,
      blobSha: "f".repeat(40),
      contentBase64: "aGk=",
    });
    expect(masks).toEqual([capability1, capability2]);
  });

  // Expired, denied, malformed, or stale capabilities must not yield file bytes.
  it("fails closed on malformed, denied and expired read capabilities", async () => {
    const authorization = {
      ...expected,
      authorizationId: "authorization-1",
      authorizationToken: "authorization-secret",
      expiresAt,
      binding: { kind: "server_binding_contract_gap" as const },
    };
    const binding = {
      repositoryConnectionId: "connection-7",
      providerInstanceId: "hosted-pool:repository:123",
      bindingId: "binding-1",
      bindingVersion: 2,
    };
    const bad = createHostedV4ReadClient({
      apiUrl: "https://api.example/",
      now,
      maskSecret: vi.fn(),
      fetchImpl: vi.fn(async () =>
        Response.json({ capability: "", expiresAt }, { status: 201 }),
      ) as typeof fetch,
    });
    await expect(bad.admit({ authorization, binding })).rejects.toThrow(
      "hosted_v4_read_capability_malformed",
    );
    const deniedFetch = vi.fn(async () =>
      Response.json({ error: "hosted_v4_authority_denied" }, { status: 403 }),
    ) as typeof fetch;
    const denied = createHostedV4ReadClient({
      apiUrl: "https://api.example/",
      now,
      maskSecret: vi.fn(),
      fetchImpl: deniedFetch,
    });
    await expect(denied.admit({ authorization, binding })).rejects.toThrow(
      "hosted_v4_read_denied_or_ambiguous",
    );
    expect(deniedFetch).toHaveBeenCalledTimes(1);
    await expect(
      denied.readFile({
        read: {
          capability: capability1,
          expiresAt: "2029-01-01T00:00:00.000Z",
          headSha,
          authorizationId: "authorization-1",
        },
        path: "src/index.ts",
      }),
    ).rejects.toThrow("hosted_v4_read_capability_expired_or_malformed");
    expect(deniedFetch).toHaveBeenCalledTimes(1);
  });

  // A 5xx or a file from a moved head must not trigger a legacy read or expose bytes.
  it("rejects ambiguous server responses and stale file heads without retry", async () => {
    const authorization = {
      ...expected,
      authorizationId: "authorization-1",
      authorizationToken: "authorization-secret",
      expiresAt,
      binding: { kind: "server_binding_contract_gap" as const },
    };
    const read = {
      capability: capability1,
      expiresAt,
      headSha,
      authorizationId: "authorization-1",
    };
    const serverErrorFetch = vi.fn(async () =>
      Response.json({ error: "unavailable" }, { status: 503 }),
    ) as typeof fetch;
    const serverErrorClient = createHostedV4ReadClient({
      apiUrl: "https://api.example/",
      now,
      maskSecret: vi.fn(),
      fetchImpl: serverErrorFetch,
    });
    await expect(
      serverErrorClient.refresh({ authorization, read }),
    ).rejects.toThrow("hosted_v4_read_denied_or_ambiguous");
    expect(serverErrorFetch).toHaveBeenCalledTimes(1);
    const staleFetch = vi.fn(async () =>
      Response.json({
        path: "src/index.ts",
        headSha: "e".repeat(40),
        blobSha: "f".repeat(40),
        contentBase64: "aGk=",
      }),
    ) as typeof fetch;
    const staleClient = createHostedV4ReadClient({
      apiUrl: "https://api.example/",
      now,
      maskSecret: vi.fn(),
      fetchImpl: staleFetch,
    });
    await expect(
      staleClient.readFile({ read, path: "src/index.ts" }),
    ).rejects.toThrow("hosted_v4_read_malformed_or_stale");
    expect(staleFetch).toHaveBeenCalledTimes(1);
  });
});
