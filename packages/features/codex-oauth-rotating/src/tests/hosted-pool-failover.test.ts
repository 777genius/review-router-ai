import { request as httpRequest } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  runHostedCodexRelayTransport,
  startHostedCodexRelayProxy,
} from "../action/hosted-codex-relay";
import {
  hasHostedPoolRetryBudget,
  hostedPoolAccountFailureReason,
  runHostedPoolLeaseFailover,
} from "../action/github-action";

const oidcUrl = "https://vstoken.actions.githubusercontent.com/oidc/token";
const apiUrl = "https://reviewrouter.test";

describe("hosted pool account failover", () => {
  it.each([
    ["hosted_pool_quota_exhausted", "quota_exhausted"],
    ["hosted_relay_grant_failed:429", "quota_exhausted"],
    ["hosted_pool_authentication_failed", "authentication_failed"],
    ["hosted_relay_grant_failed:401", "authentication_failed"],
  ] as const)(
    "classifies definite pre-effect %s as %s",
    (message, expected) => {
      expect(hostedPoolAccountFailureReason(new Error(message))).toBe(expected);
    },
  );

  it.each([
    "quota_limited",
    "authentication_failed",
    "hosted_pool_account_failed",
    "relay_error: account_status_failed",
    "permission_required",
    "review_runtime_timeout",
    "hosted_relay_grant_failed:403",
    "hosted_relay_grant_ambiguous",
    "hosted_pool_effect_ambiguous",
  ])("does not rotate accounts for non-proven %s", (message) => {
    expect(hostedPoolAccountFailureReason(new Error(message))).toBeUndefined();
  });

  it("requires enough time for one backup grant exchange", () => {
    expect(
      hasHostedPoolRetryBudget({
        executionDeadlineEpochMs: 189_999,
        nowEpochMs: 100_000,
      }),
    ).toBe(false);
    expect(
      hasHostedPoolRetryBudget({
        executionDeadlineEpochMs: 190_000,
        nowEpochMs: 100_000,
      }),
    ).toBe(true);
  });

  it.each([401, 429] as const)(
    "runs one real backup transport after a definite pre-effect %s grant response",
    async (status) => {
      let oidcCalls = 0;
      let grantCalls = 0;
      const attempts: number[] = [];
      const reasons: string[] = [];
      const fetchImpl = vi.fn(async (url: string | URL) => {
        if (String(url).startsWith(oidcUrl)) {
          oidcCalls += 1;
          return Response.json({ value: `oidc-${oidcCalls}` });
        }
        grantCalls += 1;
        if (grantCalls === 1) return new Response("denied", { status });
        return Response.json(validGrant(grantCalls));
      }) as unknown as typeof fetch;

      await expect(
        runHostedPoolLeaseFailover({
          maxAttempts: 2,
          canRetry: () => true,
          onRetry: ({ reason }) => {
            reasons.push(reason);
          },
          runAttempt: async ({ attempt }) => {
            attempts.push(attempt);
            await runHostedCodexRelayTransport({
              env: freshOidcEnv(),
              fetchImpl,
              apiUrl,
              providerInstanceId: "provider-1",
              workflowSchemaVersion: 5,
              bindingId: "binding-1",
              bindingVersion: 7,
              maskSecret: vi.fn(),
              run: async () => undefined,
            });
            return "complete";
          },
        }),
      ).resolves.toBe("complete");

      expect(attempts).toEqual([1, 2]);
      expect(oidcCalls).toBe(2);
      expect(grantCalls).toBe(2);
      expect(reasons).toEqual([
        status === 401 ? "authentication_failed" : "quota_exhausted",
      ]);
    },
  );

  it.each([401, 429] as const)(
    "runs one real backup transport after a complete pre-effect %s relay response",
    async (status) => {
      let grantCalls = 0;
      let relayCalls = 0;
      const attempts: number[] = [];
      await expect(
        runHostedPoolLeaseFailover({
          maxAttempts: 2,
          canRetry: () => true,
          runAttempt: async ({ attempt }) => {
            attempts.push(attempt);
            await runHostedCodexRelayTransport({
              env: freshOidcEnv(),
              fetchImpl: vi.fn(async (url: string | URL) => {
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
              }) as unknown as typeof fetch,
              apiUrl,
              providerInstanceId: "provider-1",
              workflowSchemaVersion: 5,
              bindingId: "binding-1",
              bindingVersion: 7,
              maskSecret: vi.fn(),
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

  it("never grants again after a lost grant response", async () => {
    let grantCalls = 0;
    const attempts: number[] = [];
    await expect(
      runHostedPoolLeaseFailover({
        maxAttempts: 2,
        canRetry: () => true,
        runAttempt: async ({ attempt }) => {
          attempts.push(attempt);
          await runHostedCodexRelayTransport({
            env: freshOidcEnv(),
            fetchImpl: vi.fn(async (url: string | URL) => {
              if (String(url).startsWith(oidcUrl)) {
                return Response.json({ value: "oidc" });
              }
              grantCalls += 1;
              throw new TypeError("response_lost_after_persist");
            }) as unknown as typeof fetch,
            apiUrl,
            providerInstanceId: "provider-1",
            workflowSchemaVersion: 5,
            bindingId: "binding-1",
            bindingVersion: 7,
            maskSecret: vi.fn(),
            run: async () => undefined,
          });
        },
      }),
    ).rejects.toThrow("hosted_relay_grant_ambiguous");
    expect(attempts).toEqual([1]);
    expect(grantCalls).toBe(1);
  });

  it.each([
    [
      "completed 5xx",
      () => new Response("failed", { status: 500 }),
      "hosted_pool_effect_ambiguous",
    ],
    [
      "truncated 200",
      () =>
        new Response('data: {"type":"response.completed"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      "hosted_pool_effect_ambiguous",
    ],
  ] as const)(
    "does not run the outer loop again after a %s",
    async (_label, relayResponse, expectedError) => {
      let grantCalls = 0;
      let relayCalls = 0;
      const attempts: number[] = [];
      await expect(
        runHostedPoolLeaseFailover({
          maxAttempts: 2,
          canRetry: () => true,
          runAttempt: async ({ attempt }) => {
            attempts.push(attempt);
            await runHostedCodexRelayTransport({
              env: freshOidcEnv(),
              fetchImpl: vi.fn(async (url: string | URL) => {
                if (String(url).startsWith(oidcUrl)) {
                  return Response.json({ value: "oidc" });
                }
                if (String(url).endsWith("/hosted-relay/grant")) {
                  grantCalls += 1;
                  return Response.json(validGrant(grantCalls));
                }
                relayCalls += 1;
                return relayResponse();
              }) as unknown as typeof fetch,
              apiUrl,
              providerInstanceId: "provider-1",
              workflowSchemaVersion: 5,
              bindingId: "binding-1",
              bindingVersion: 7,
              maskSecret: vi.fn(),
              run: async ({ baseUrl }) => {
                const response = await fetch(`${baseUrl}/responses`, {
                  method: "POST",
                  body: "{}",
                });
                await response.text();
                throw new Error("runtime_rejected_response");
              },
            });
          },
        }),
      ).rejects.toThrow(expectedError);
      expect(attempts).toEqual([1]);
      expect(grantCalls).toBe(1);
      expect(relayCalls).toBe(1);
    },
  );

  it("allows at most one backup and never requests a third grant", async () => {
    const attempts: number[] = [];
    await expect(
      runHostedPoolLeaseFailover({
        maxAttempts: 2,
        canRetry: () => true,
        runAttempt: async ({ attempt }) => {
          attempts.push(attempt);
          throw new Error("hosted_relay_grant_failed:429");
        },
      }),
    ).rejects.toThrow("hosted_pool_capacity_exhausted");
    expect(attempts).toEqual([1, 2]);
  });

  it("rejects the former three-grant budget", async () => {
    await expect(
      runHostedPoolLeaseFailover({
        maxAttempts: 3,
        canRetry: () => true,
        runAttempt: async () => "unreachable",
      }),
    ).rejects.toThrow("hosted_pool_retry_budget_invalid");
  });

  it("does not acquire a backup after the execution budget closes", async () => {
    const attempts: number[] = [];
    await expect(
      runHostedPoolLeaseFailover({
        maxAttempts: 2,
        canRetry: () => false,
        runAttempt: async ({ attempt }) => {
          attempts.push(attempt);
          throw new Error("hosted_relay_grant_failed:401");
        },
      }),
    ).rejects.toThrow("hosted_pool_capacity_exhausted");
    expect(attempts).toEqual([1]);
  });

  it("rechecks the replay fence when capacity waiters wake", async () => {
    const releases: Array<() => void> = [];
    const startedSignals = [deferred<void>(), deferred<void>()];
    let relayCalls = 0;
    const proxy = await startHostedCodexRelayProxy({
      ...proxyInput({ maxRequests: 4 }),
      fetchImpl: vi.fn(async () => {
        const call = relayCalls++;
        startedSignals[call]?.resolve();
        if (call < 2) {
          await new Promise<void>((resolve) => releases.push(resolve));
        }
        return successfulSse();
      }) as unknown as typeof fetch,
    });
    const firstActive = fetch(`${proxy.baseUrl}/responses`, {
      method: "POST",
      body: "{}",
    });
    const secondActive = fetch(`${proxy.baseUrl}/responses`, {
      method: "POST",
      body: "{}",
    });
    let slow: ReturnType<typeof httpRequest> | undefined;
    let other: ReturnType<typeof httpRequest> | undefined;
    try {
      await Promise.all(startedSignals.map((signal) => signal.promise));
      slow = httpRequest(`${proxy.baseUrl}/responses`, {
        method: "POST",
        agent: false,
        headers: { connection: "close", expect: "100-continue" },
      });
      const slowResponse = responseStatus(slow);
      const slowContinued = waitForContinue(slow);
      slow.flushHeaders();
      await slowContinued;
      slow.write('{"input":"');

      other = httpRequest(`${proxy.baseUrl}/responses`, {
        method: "POST",
        agent: false,
        headers: {
          connection: "close",
          "content-length": 2,
          "content-type": "application/json",
          expect: "100-continue",
        },
      });
      const otherResponse = responseStatus(other);
      const otherContinued = waitForContinue(other);
      other.flushHeaders();
      await otherContinued;
      other.end("{}");

      releases.shift()?.();
      const firstResponse = await firstActive;
      await firstResponse.text();
      await new Promise<void>((resolve) => setImmediate(resolve));
      releases.shift()?.();

      await expect(otherResponse).resolves.toBe(409);
      expect(relayCalls).toBe(2);
      slow.end('review"}');
      await expect(slowResponse).resolves.toBe(200);
      expect(relayCalls).toBe(3);
      const secondResponse = await secondActive;
      await secondResponse.text();
    } finally {
      for (const release of releases) release();
      slow?.destroy();
      other?.destroy();
      await proxy.close();
    }
  });

  it.each([401, 429] as const)(
    "fails closed for ordinal-one %s after another relay was admitted",
    async (status) => {
      const firstGate = deferred<void>();
      const secondGate = deferred<void>();
      const firstStarted = deferred<void>();
      const secondStarted = deferred<void>();
      let relayCalls = 0;
      const proxy = await startHostedCodexRelayProxy({
        ...proxyInput({ maxRequests: 2 }),
        fetchImpl: vi.fn(async () => {
          relayCalls += 1;
          if (relayCalls === 1) {
            firstStarted.resolve();
            await firstGate.promise;
            return new Response("rejected", { status });
          }
          secondStarted.resolve();
          await secondGate.promise;
          return successfulSse();
        }) as unknown as typeof fetch,
      });
      try {
        const first = fetch(`${proxy.baseUrl}/responses`, {
          method: "POST",
          body: "{}",
        });
        await firstStarted.promise;
        const second = fetch(`${proxy.baseUrl}/responses`, {
          method: "POST",
          body: "{}",
        });
        await secondStarted.promise;
        firstGate.resolve();
        const firstResponse = await first;
        await firstResponse.text();
        expect(proxy.failoverReason()).toBe("ambiguous");
        secondGate.resolve();
        const secondResponse = await second;
        await secondResponse.text();
      } finally {
        firstGate.resolve();
        secondGate.resolve();
        await proxy.close();
      }
    },
  );

  it("releases body-read admission without consuming the relay budget", async () => {
    const ordinals: string[] = [];
    const proxy = await startHostedCodexRelayProxy({
      ...proxyInput({ maxRequests: 1, maxRequestBodyBytes: 2 }),
      fetchImpl: vi.fn(async (_url, init) => {
        ordinals.push(
          new Headers(init?.headers).get("x-reviewrouter-request-ordinal") ??
            "",
        );
        return successfulSse();
      }) as unknown as typeof fetch,
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

  it("admits a second response while the first SSE is still streaming", async () => {
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const finishFirst = deferred<void>();
    let relayCalls = 0;
    const proxy = await startHostedCodexRelayProxy({
      ...proxyInput({ maxRequests: 2 }),
      fetchImpl: vi.fn(async () => {
        relayCalls += 1;
        if (relayCalls === 1) {
          firstStarted.resolve();
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"response.output_text.delta"}\n\n',
                  ),
                );
                void finishFirst.promise.then(() => {
                  controller.enqueue(
                    new TextEncoder().encode("data: [DONE]\n\n"),
                  );
                  controller.close();
                });
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        secondStarted.resolve();
        return successfulSse();
      }) as unknown as typeof fetch,
    });
    try {
      const first = fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        body: "{}",
      });
      await firstStarted.promise;
      const second = fetch(`${proxy.baseUrl}/responses`, {
        method: "POST",
        body: "{}",
      });
      await secondStarted.promise;
      const secondResponse = await second;
      expect(secondResponse.status).toBe(200);
      await secondResponse.text();
      finishFirst.resolve();
      const firstResponse = await first;
      expect(firstResponse.status).toBe(200);
      await firstResponse.text();
    } finally {
      finishFirst.resolve();
      await proxy.close();
    }
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function waitForContinue(
  request: ReturnType<typeof httpRequest>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.once("continue", resolve);
    request.once("error", reject);
  });
}

function responseStatus(
  request: ReturnType<typeof httpRequest>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    request.once("response", (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
      response.once("error", reject);
    });
    request.once("error", reject);
  });
}

function proxyInput(policy: {
  maxRequests: number;
  maxRequestBodyBytes?: number;
}) {
  return {
    grant: "grant",
    commentTokenRefreshCapability: "refresh",
    invocationLeaseId: "lease",
    bindingId: "binding",
    bindingVersion: 1,
    relayUrl: "https://relay.reviewrouter.test/v1/responses",
    upstreamCommentTokenRefreshUrl:
      "https://relay.reviewrouter.test/v1/comment-token",
    policy,
  };
}

function successfulSse(): Response {
  return new Response("data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  });
}

function freshOidcEnv(): NodeJS.ProcessEnv {
  return {
    ACTIONS_ID_TOKEN_REQUEST_URL: oidcUrl,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "github-request-token",
  };
}

function validGrant(ordinal: number): Record<string, unknown> {
  return {
    protocolVersion: 1,
    grant: `opaque-grant-${ordinal}`,
    relayUrl: "https://relay.reviewrouter.test/v1/responses",
    invocationLeaseId: `lease-${ordinal}`,
    runtimeConfigVersion: 1,
    runtimeEnv: {},
    repository: "octo/repo",
    commentToken: `comment-token-${ordinal}`,
    commentTokenRefreshCapability: `refresh-capability-${ordinal}`,
    grantExpiresAt: "2026-08-22T18:00:00.000Z",
    policy: { maxRequests: 2 },
  };
}
