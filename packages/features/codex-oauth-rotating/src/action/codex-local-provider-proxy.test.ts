import { describe, expect, it, vi } from "vitest";
import http from "node:http";
import {
  routeCodexLocalProviderRequest,
  startCodexLocalProviderProxy,
} from "./codex-local-provider-proxy";

describe("Action Codex loopback proxy boundary", () => {
  it("cancels upstream and its reader when a real client disconnects mid-stream", async () => {
    let signal: AbortSignal | undefined;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      },
      cancel,
    });
    const proxy = await startCodexLocalProviderProxy({
      accessToken: "fixture-token",
      upstreamResponsesUrl: "https://provider.invalid/responses",
      fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Response(body, {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const request = http.request(
          proxy.baseUrl + "/responses",
          { method: "POST" },
          (response) => {
            response.once("data", () => {
              response.destroy();
              resolve();
            });
            response.once("error", reject);
          },
        );
        request.once("error", reject);
        request.end("{}");
      });
      await vi.waitFor(() => {
        expect(signal?.aborted).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
      });
    } finally {
      await proxy.close();
    }
  });

  it("cancels a request disconnected before upstream headers arrive", async () => {
    let signal: AbortSignal | undefined;
    let resolveUpstream: (response: Response) => void = () => undefined;
    const upstream = new Promise<Response>((resolve) => {
      resolveUpstream = resolve;
    });
    const cancel = vi.fn();
    const proxy = await startCodexLocalProviderProxy({
      accessToken: "fixture-token",
      upstreamResponsesUrl: "https://provider.invalid/responses",
      fetchImpl: async (_url, init) => {
        signal = init?.signal ?? undefined;
        return upstream;
      },
    });
    const request = http.request(proxy.baseUrl + "/responses", {
      method: "POST",
    });
    request.on("error", () => undefined);
    request.end("{}");
    try {
      await vi.waitFor(() => expect(signal).toBeDefined());
      request.destroy();
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      resolveUpstream(new Response(new ReadableStream({ cancel })));
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    } finally {
      request.destroy();
      resolveUpstream(new Response());
      await proxy.close();
    }
  });

  it("stops reading ahead when a real downstream client does not consume its response", async () => {
    let pulls = 0;
    const chunk = new Uint8Array(256 * 1024);
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++pulls <= 128) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    });
    const proxy = await startCodexLocalProviderProxy({
      accessToken: "fixture-token",
      upstreamResponsesUrl: "https://provider.invalid/responses",
      fetchImpl: async () => new Response(body),
    });
    let downstream: http.IncomingMessage | undefined;
    const request = http.request(proxy.baseUrl + "/responses", {
      method: "POST",
    });
    request.on("error", () => undefined);
    try {
      const received = new Promise<void>((resolve) =>
        request.once("response", (response) => {
          downstream = response;
          response.pause();
          resolve();
        }),
      );
      request.end("{}");
      await received;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(pulls).toBeLessThan(64);
      downstream?.destroy();
      await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    } finally {
      downstream?.destroy();
      request.destroy();
      await proxy.close();
    }
  });

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
    expect(
      routeCodexLocalProviderRequest({ ...valid, path: "/v1/responses" }),
    ).toBe("deny");
    expect(
      routeCodexLocalProviderRequest({ ...valid, bodyBytes: 2_000_001 }),
    ).toBe("deny");
  });

  it("serves only its loopback nonce path and filters upstream headers", async () => {
    const upstream = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe("https://example.invalid/responses");
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );
    const proxy = await startCodexLocalProviderProxy({
      fetchImpl: upstream as typeof fetch,
      accessToken: "fallback-token",
      upstreamResponsesUrl: "https://example.invalid/responses",
    });
    try {
      expect(proxy.baseUrl).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]+\/v1$/,
      );
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
