import { describe, expect, it, vi } from "vitest";
import { fetchHostedV4Json } from "../action/hosted-v4-http.js";

describe("hosted v4 bounded HTTP response", () => {
  // A body that stalls after valid headers must not outlive the request deadline.
  it("times out while consuming the response body", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":'));
      },
    });
    const fetchImpl = vi.fn(
      async () => new Response(stream, { status: 200 }),
    ) as typeof fetch;
    await expect(
      fetchHostedV4Json({
        fetchImpl,
        url: "https://api.example/check",
        init: { method: "POST" },
        acceptedStatuses: [200],
        timeoutMs: 20,
        maxBytes: 1024,
        errorPrefix: "hosted_v4_test",
      }),
    ).rejects.toThrow("hosted_v4_test_transport_ambiguous");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  // A successful status with an oversized body must be rejected before JSON buffering.
  it("rejects a response that exceeds its byte budget", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ value: "x".repeat(100) }),
    ) as typeof fetch;
    await expect(
      fetchHostedV4Json({
        fetchImpl,
        url: "https://api.example/check",
        init: { method: "POST" },
        acceptedStatuses: [200],
        timeoutMs: 1000,
        maxBytes: 32,
        errorPrefix: "hosted_v4_test",
      }),
    ).rejects.toThrow("hosted_v4_test_response_too_large");
  });
});
