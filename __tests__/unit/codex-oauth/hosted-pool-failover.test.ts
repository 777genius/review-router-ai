import { request as httpRequest } from "node:http";

type HostedPoolFailureReason =
  | "quota_exhausted"
  | "authentication_failed"
  | undefined;

type HostedPoolFailoverInput<T> = {
  maxAttempts?: number;
  canRetry: () => boolean;
  runAttempt: (input: { attempt: number; maxAttempts: number }) => Promise<T>;
  onRetry?: (input: {
    attempt: number;
    maxAttempts: number;
    reason: Exclude<HostedPoolFailureReason, undefined>;
  }) => void | Promise<void>;
};

type HostedTransportInput = {
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  apiUrl: string;
  providerInstanceId: string;
  workflowSchemaVersion: number;
  bindingId: string;
  bindingVersion: number;
  maskSecret: (secret: string) => void;
  run: (input: { baseUrl: string }) => Promise<void>;
};

type HostedProxy = {
  baseUrl: string;
  failoverReason: () =>
    | "quota_exhausted"
    | "authentication_failed"
    | "ambiguous"
    | undefined;
  close: () => Promise<void>;
};

const actionBundle = jest.requireActual("../../../action-dist/index.cjs") as {
  hostedPoolAccountFailureReason(error: unknown): HostedPoolFailureReason;
  requestHostedRelayGrantWithFreshGitHubOidc(
    input: Omit<HostedTransportInput, "run">,
  ): Promise<unknown>;
  runHostedCodexRelayTransport(input: HostedTransportInput): Promise<void>;
  runHostedPoolLeaseFailover<T>(input: HostedPoolFailoverInput<T>): Promise<T>;
  startHostedCodexRelayProxy(input: {
    fetchImpl: typeof fetch;
    relayUrl: string;
    upstreamCommentTokenRefreshUrl: string;
    grant: string;
    commentTokenRefreshCapability: string;
    invocationLeaseId: string;
    bindingId: string;
    bindingVersion: number;
    policy: { maxRequests: number; maxRequestBodyBytes?: number };
  }): Promise<HostedProxy>;
};

const oidcUrl = "https://vstoken.actions.githubusercontent.com/oidc/token";
const apiUrl = "https://reviewrouter.test";

describe("hosted pool replay-fenced failover artifact", () => {
  it.each([
    ["hosted_pool_quota_exhausted", "quota_exhausted"],
    ["hosted_relay_grant_failed:429", "quota_exhausted"],
    ["hosted_pool_authentication_failed", "authentication_failed"],
    ["hosted_relay_grant_failed:401", "authentication_failed"],
  ] as const)(
    "classifies definite pre-effect %s as %s",
    (message, expected) => {
      expect(
        actionBundle.hostedPoolAccountFailureReason(new Error(message)),
      ).toBe(expected);
    },
  );

  it.each([
    "quota_limited",
    "authentication_failed",
    "hosted_pool_account_failed",
    "review_runtime_timeout",
    "hosted_relay_grant_failed:403",
    "hosted_relay_grant_ambiguous",
    "hosted_pool_effect_ambiguous",
  ])("does not rotate for non-proven %s", (message) => {
    expect(
      actionBundle.hostedPoolAccountFailureReason(new Error(message)),
    ).toBeUndefined();
  });

  it.each([401, 429] as const)(
    "uses one real backup after a complete pre-effect %s relay response",
    async (status) => {
      let grantCalls = 0;
      let relayCalls = 0;
      const attempts: number[] = [];
      await expect(
        actionBundle.runHostedPoolLeaseFailover({
          maxAttempts: 2,
          canRetry: () => true,
          runAttempt: async ({ attempt }) => {
            attempts.push(attempt);
            await actionBundle.runHostedCodexRelayTransport({
              env: freshOidcEnv(),
              apiUrl,
              providerInstanceId: "provider-1",
              workflowSchemaVersion: 5,
              bindingId: "binding-1",
              bindingVersion: 7,
              maskSecret: jest.fn(),
              fetchImpl: jest.fn(async (url: string | URL) => {
                if (String(url).startsWith(oidcUrl)) {
                  return Response.json({ value: `oidc-${attempt}` });
                }
                if (String(url).endsWith("/hosted-relay/grant")) {
                  grantCalls += 1;
                  return Response.json(validGrant(grantCalls));
                }
                relayCalls += 1;
                return new Response("definite pre-effect rejection", {
                  status,
                });
              }) as typeof fetch,
              run: async ({ baseUrl }) => {
                if (attempt === 1) {
                  const response = await fetch(`${baseUrl}/responses`, {
                    method: "POST",
                    body: "{}",
                  });
                  await response.text();
                }
              },
            });
            return "complete";
          },
        }),
      ).resolves.toBe("complete");
      expect(attempts).toEqual([1, 2]);
      expect(grantCalls).toBe(2);
      expect(relayCalls).toBe(1);
    },
  );

  it("never re-POSTs or enters the outer loop after a lost grant response", async () => {
    let grantCalls = 0;
    const attempts: number[] = [];
    await expect(
      actionBundle.runHostedPoolLeaseFailover({
        maxAttempts: 2,
        canRetry: () => true,
        runAttempt: async ({ attempt }) => {
          attempts.push(attempt);
          await actionBundle.runHostedCodexRelayTransport({
            env: freshOidcEnv(),
            apiUrl,
            providerInstanceId: "provider-1",
            workflowSchemaVersion: 5,
            bindingId: "binding-1",
            bindingVersion: 7,
            maskSecret: jest.fn(),
            run: async () => undefined,
            fetchImpl: jest.fn(async (url: string | URL) => {
              if (String(url).startsWith(oidcUrl)) {
                return Response.json({ value: "oidc" });
              }
              grantCalls += 1;
              throw new TypeError("response_lost_after_persist");
            }) as typeof fetch,
          });
        },
      }),
    ).rejects.toThrow("hosted_relay_grant_ambiguous");
    expect(attempts).toEqual([1]);
    expect(grantCalls).toBe(1);
  });

  it.each([
    ["completed 5xx", () => new Response("failed", { status: 500 })],
    [
      "truncated 200",
      () =>
        new Response('data: {"type":"response.completed"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    ],
  ] as const)(
    "keeps the outer-loop fence after a %s",
    async (_label, response) => {
      let grantCalls = 0;
      let relayCalls = 0;
      const attempts: number[] = [];
      await expect(
        actionBundle.runHostedPoolLeaseFailover({
          maxAttempts: 2,
          canRetry: () => true,
          runAttempt: async ({ attempt }) => {
            attempts.push(attempt);
            await actionBundle.runHostedCodexRelayTransport({
              env: freshOidcEnv(),
              apiUrl,
              providerInstanceId: "provider-1",
              workflowSchemaVersion: 5,
              bindingId: "binding-1",
              bindingVersion: 7,
              maskSecret: jest.fn(),
              fetchImpl: jest.fn(async (url: string | URL) => {
                if (String(url).startsWith(oidcUrl)) {
                  return Response.json({ value: "oidc" });
                }
                if (String(url).endsWith("/hosted-relay/grant")) {
                  grantCalls += 1;
                  return Response.json(validGrant(grantCalls));
                }
                relayCalls += 1;
                return response();
              }) as typeof fetch,
              run: async ({ baseUrl }) => {
                const result = await fetch(`${baseUrl}/responses`, {
                  method: "POST",
                  body: "{}",
                });
                await result.text();
                throw new Error("runtime_rejected_response");
              },
            });
          },
        }),
      ).rejects.toThrow("hosted_pool_effect_ambiguous");
      expect(attempts).toEqual([1]);
      expect(grantCalls).toBe(1);
      expect(relayCalls).toBe(1);
    },
  );

  it("sets the replay fence before a slow body can race another mutation", async () => {
    let relayCalls = 0;
    const proxy = await actionBundle.startHostedCodexRelayProxy({
      grant: "grant",
      commentTokenRefreshCapability: "refresh",
      invocationLeaseId: "lease",
      bindingId: "binding",
      bindingVersion: 1,
      relayUrl: "https://relay.reviewrouter.test/v1/responses",
      upstreamCommentTokenRefreshUrl:
        "https://relay.reviewrouter.test/v1/comment-token",
      policy: { maxRequests: 2 },
      fetchImpl: jest.fn(async () => {
        relayCalls += 1;
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    let slow: ReturnType<typeof httpRequest> | undefined;
    let slowSettled: Promise<void> | undefined;
    try {
      const slowRequest = httpRequest(`${proxy.baseUrl}/responses`, {
        method: "POST",
        agent: false,
        headers: { connection: "close", expect: "100-continue" },
      });
      slow = slowRequest;
      const slowFinished = new Promise<void>((resolve, reject) => {
        slowRequest.once("response", (response) => {
          response.resume();
          response.once("end", resolve);
          response.once("error", reject);
        });
        slowRequest.once("error", reject);
      });
      const slowClosed = new Promise<void>((resolve) => {
        slowRequest.once("close", resolve);
      });
      slowSettled = Promise.race([slowFinished, slowClosed]).catch(
        () => undefined,
      );
      const slowAdmitted = waitForContinue(slowRequest);
      slowRequest.flushHeaders();
      await slowAdmitted;
      slowRequest.write('{"input":"');
      const concurrent = await requestProxy(`${proxy.baseUrl}/responses`, "{}");
      expect(concurrent.status).toBe(409);
      expect(relayCalls).toBe(0);
      slowRequest.end('review"}');
      await slowFinished;
      expect(relayCalls).toBe(1);
    } finally {
      slow?.destroy();
      await slowSettled;
      await proxy.close();
    }
  });

  it("admits a second /v1/responses while the first SSE is still streaming", async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstUpstreamStarted!: () => void;
    const firstUpstream = new Promise<void>((resolve) => {
      firstUpstreamStarted = resolve;
    });
    let relayCalls = 0;
    const proxy = await actionBundle.startHostedCodexRelayProxy({
      grant: "grant",
      commentTokenRefreshCapability: "refresh",
      invocationLeaseId: "lease",
      bindingId: "binding",
      bindingVersion: 1,
      relayUrl: "https://relay.reviewrouter.test/v1/responses",
      upstreamCommentTokenRefreshUrl:
        "https://relay.reviewrouter.test/v1/comment-token",
      policy: { maxRequests: 2 },
      fetchImpl: jest.fn(async () => {
        relayCalls += 1;
        if (relayCalls === 1) {
          firstUpstreamStarted();
          await firstHeld;
        }
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    try {
      const first = fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        body: JSON.stringify({ input: "first" }),
      });
      await firstUpstream;
      const second = await fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        body: JSON.stringify({ input: "second" }),
      });
      expect(second.status).toBe(200);
      expect(await second.text()).toBe("data: [DONE]\n\n");
      expect(relayCalls).toBe(2);
      releaseFirst();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      expect(await firstResponse.text()).toBe("data: [DONE]\n\n");
    } finally {
      releaseFirst();
      await proxy.close();
    }
  });

  it("rechecks the replay fence when capacity waiters wake", async () => {
    const releases: Array<() => void> = [];
    let relayCalls = 0;
    const relayStarted: Array<() => void> = [];
    const started = [
      new Promise<void>((resolve) => relayStarted.push(resolve)),
      new Promise<void>((resolve) => relayStarted.push(resolve)),
    ];
    const proxy = await actionBundle.startHostedCodexRelayProxy({
      grant: "grant",
      commentTokenRefreshCapability: "refresh",
      invocationLeaseId: "lease",
      bindingId: "binding",
      bindingVersion: 1,
      relayUrl: "https://relay.reviewrouter.test/v1/responses",
      upstreamCommentTokenRefreshUrl:
        "https://relay.reviewrouter.test/v1/comment-token",
      policy: { maxRequests: 4 },
      fetchImpl: jest.fn(async () => {
        const call = relayCalls++;
        relayStarted[call]?.();
        if (call < 2) {
          await new Promise<void>((resolve) => releases.push(resolve));
        }
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    const active = [
      fetch(`${proxy.baseUrl}/responses`, { method: "POST", body: "{}" }),
      fetch(`${proxy.baseUrl}/responses`, { method: "POST", body: "{}" }),
    ];
    let slow: ReturnType<typeof httpRequest> | undefined;
    let slowSettled: Promise<void> | undefined;
    try {
      await Promise.all(started);
      const slowRequest = httpRequest(`${proxy.baseUrl}/responses`, {
        method: "POST",
        agent: false,
        headers: { connection: "close", expect: "100-continue" },
      });
      slow = slowRequest;
      const slowFinished = new Promise<void>((resolve, reject) => {
        slowRequest.once("response", (response) => {
          response.resume();
          response.once("end", resolve);
          response.once("error", reject);
        });
        slowRequest.once("error", reject);
      });
      const slowClosed = new Promise<void>((resolve) => {
        slowRequest.once("close", resolve);
      });
      slowSettled = Promise.race([slowFinished, slowClosed]).catch(
        () => undefined,
      );
      const slowContinued = waitForContinue(slowRequest);
      slowRequest.flushHeaders();
      await slowContinued;
      slowRequest.write('{"input":"');

      const otherRequest = httpRequest(`${proxy.baseUrl}/responses`, {
        method: "POST",
        agent: false,
        headers: {
          connection: "close",
          "content-length": 2,
          "content-type": "application/json",
          expect: "100-continue",
        },
      });
      const otherWaiter = new Promise<{ status: number }>((resolve, reject) => {
        otherRequest.once("response", (response) => {
          response.resume();
          response.once("end", () => {
            resolve({ status: response.statusCode ?? 0 });
          });
          response.once("error", reject);
        });
        otherRequest.once("error", reject);
      });
      const otherContinued = waitForContinue(otherRequest);
      otherRequest.flushHeaders();
      await otherContinued;
      otherRequest.end("{}");

      releases.shift()?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
      releases.shift()?.();

      await expect(otherWaiter).resolves.toEqual({ status: 409 });
      expect(relayCalls).toBe(2);
      slowRequest.end('review"}');
      await slowFinished;
      expect(relayCalls).toBe(3);
      const responses = await Promise.all(active);
      await Promise.all(responses.map((response) => response.text()));
    } finally {
      for (const release of releases) release();
      slow?.destroy();
      await slowSettled;
      await proxy.close();
    }
  });

  it.each([401, 429] as const)(
    "fails closed for ordinal-one %s after another relay was admitted",
    async (status) => {
      let releaseFirst!: () => void;
      let releaseSecond!: () => void;
      let firstStarted!: () => void;
      let secondStarted!: () => void;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const secondGate = new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      const firstUpstream = new Promise<void>((resolve) => {
        firstStarted = resolve;
      });
      const secondUpstream = new Promise<void>((resolve) => {
        secondStarted = resolve;
      });
      let relayCalls = 0;
      const proxy = await actionBundle.startHostedCodexRelayProxy({
        grant: "grant",
        commentTokenRefreshCapability: "refresh",
        invocationLeaseId: "lease",
        bindingId: "binding",
        bindingVersion: 1,
        relayUrl: "https://relay.reviewrouter.test/v1/responses",
        upstreamCommentTokenRefreshUrl:
          "https://relay.reviewrouter.test/v1/comment-token",
        policy: { maxRequests: 2 },
        fetchImpl: jest.fn(async () => {
          relayCalls += 1;
          if (relayCalls === 1) {
            firstStarted();
            await firstGate;
            return new Response("rejected", { status });
          }
          secondStarted();
          await secondGate;
          return new Response("data: [DONE]\n\n", {
            headers: { "content-type": "text/event-stream" },
          });
        }) as typeof fetch,
      });
      try {
        const first = fetch(`${proxy.baseUrl}/responses`, {
          method: "POST",
          body: "{}",
        });
        await firstUpstream;
        const second = fetch(`${proxy.baseUrl}/responses`, {
          method: "POST",
          body: "{}",
        });
        await secondUpstream;
        releaseFirst();
        const firstResponse = await first;
        await firstResponse.text();
        expect(proxy.failoverReason()).toBe("ambiguous");
        releaseSecond();
        const secondResponse = await second;
        await secondResponse.text();
      } finally {
        releaseFirst();
        releaseSecond();
        await proxy.close();
      }
    },
  );

  it("releases body-read admission without consuming the relay budget", async () => {
    const ordinals: string[] = [];
    const proxy = await actionBundle.startHostedCodexRelayProxy({
      grant: "grant",
      commentTokenRefreshCapability: "refresh",
      invocationLeaseId: "lease",
      bindingId: "binding",
      bindingVersion: 1,
      relayUrl: "https://relay.reviewrouter.test/v1/responses",
      upstreamCommentTokenRefreshUrl:
        "https://relay.reviewrouter.test/v1/comment-token",
      policy: { maxRequests: 1, maxRequestBodyBytes: 2 },
      fetchImpl: jest.fn(async (_url, init) => {
        ordinals.push(
          new Headers(init?.headers).get("x-reviewrouter-request-ordinal") ??
            "",
        );
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    try {
      const oversized = await fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        body: "too large",
      });
      expect(oversized.status).toBe(413);
      expect(await oversized.json()).toEqual({
        error: "proxy_request_body_too_large",
      });

      const valid = await fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        body: "{}",
      });
      expect(valid.status).toBe(200);
      await valid.text();
      expect(ordinals).toEqual(["1"]);
    } finally {
      await proxy.close();
    }
  });

  it("allows no third grant and rejects the former three-attempt budget", async () => {
    const attempts: number[] = [];
    await expect(
      actionBundle.runHostedPoolLeaseFailover({
        maxAttempts: 2,
        canRetry: () => true,
        runAttempt: async ({ attempt }) => {
          attempts.push(attempt);
          throw new Error("hosted_relay_grant_failed:429");
        },
      }),
    ).rejects.toThrow("hosted_pool_capacity_exhausted");
    expect(attempts).toEqual([1, 2]);
    await expect(
      actionBundle.runHostedPoolLeaseFailover({
        maxAttempts: 3,
        canRetry: () => true,
        runAttempt: async () => undefined,
      }),
    ).rejects.toThrow("hosted_pool_retry_budget_invalid");
  });
});

function freshOidcEnv(): NodeJS.ProcessEnv {
  return {
    ACTIONS_ID_TOKEN_REQUEST_URL: oidcUrl,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-token",
  };
}

function waitForContinue(
  request: ReturnType<typeof httpRequest>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      request.off("continue", onContinue);
      request.off("error", onError);
    };
    const onContinue = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    request.once("continue", onContinue);
    request.once("error", onError);
  });
}

function requestProxy(url: string, body: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: "POST",
        agent: false,
        headers: {
          connection: "close",
          "content-length": Buffer.byteLength(body),
          "content-type": "application/json",
        },
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve({ status: response.statusCode ?? 0 });
        });
        response.once("error", reject);
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

function validGrant(ordinal: number): Record<string, unknown> {
  return {
    protocolVersion: 1,
    grant: `grant-${ordinal}`,
    relayUrl: "https://relay.reviewrouter.test/v1/responses",
    invocationLeaseId: `lease-${ordinal}`,
    runtimeConfigVersion: 1,
    runtimeEnv: {},
    repository: "octo/repo",
    commentToken: `comment-${ordinal}`,
    commentTokenRefreshCapability: `refresh-${ordinal}`,
    grantExpiresAt: "2026-08-22T18:00:00.000Z",
    policy: { maxRequests: 2 },
  };
}
