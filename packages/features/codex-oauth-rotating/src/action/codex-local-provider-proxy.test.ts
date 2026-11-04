import { describe, expect, it, vi } from "vitest";
import {
  routeCodexLocalProviderRequest,
  startCodexLocalProviderProxy,
} from "./codex-local-provider-proxy";

describe("Action Codex loopback proxy boundary", () => {
  it("enforces exact method, nonce route and body budget", () => {
    const valid = {
      method: "POST",
      path: "/nonce/v1/responses",
      nonce: "nonce",
      bodyBytes: 12,
    };
    expect(routeCodexLocalProviderRequest(valid)).toBe("responses");
    expect(routeCodexLocalProviderRequest({ ...valid, method: "GET" })).toBe(
      "deny",
    );
    expect(routeCodexLocalProviderRequest({ ...valid, path: "/v1/responses" })).toBe(
      "deny",
    );
    expect(
      routeCodexLocalProviderRequest({ ...valid, bodyBytes: 2_000_001 }),
    ).toBe("deny");
  });

  it("serves only its loopback nonce path and filters upstream headers", async () => {
    const upstream = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const proxy = await startCodexLocalProviderProxy({
      fetchImpl: upstream as typeof fetch,
      accessToken: "fallback-token",
      upstreamResponsesUrl: "https://example.invalid/responses",
    });
    try {
      expect(proxy.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/v1$/);
      const rejected = await fetch(proxy.baseUrl + "/other", {
        method: "POST",
        body: "{}",
      });
      expect(rejected.status).toBe(404);
      const response = await fetch(proxy.baseUrl + "/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-codex-unit-test": "allowed",
          cookie: "should-not-reach-upstream",
        },
        body: JSON.stringify({ model: "codex" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(upstream).toHaveBeenCalledOnce();
      const init = upstream.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = init?.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer fallback-token");
      expect(headers["x-codex-unit-test"]).toBe("allowed");
      expect(headers.cookie).toBeUndefined();
    } finally {
      await proxy.close();
    }
  });
});
