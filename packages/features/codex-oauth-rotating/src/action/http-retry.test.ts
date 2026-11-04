import { describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./http-retry";

describe("Action HTTP retry boundary", () => {
  it("discards a retryable response before one bounded retry", async () => {
    vi.useFakeTimers();
    try {
      const temporary = new Response("temporarily unavailable", { status: 429 });
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(temporary)
        .mockResolvedValueOnce(new Response("completed", { status: 200 }));

      const result = fetchWithRetry<string>({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        label: "github_request",
        url: "https://example.invalid/review",
        timeoutMs: 10_000,
        maxAttempts: 2,
        consume: (response) => response.text(),
      });
      await vi.advanceTimersByTimeAsync(750);
      await expect(result).resolves.toBe("completed");
      expect(temporary.bodyUsed).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a non-transient response", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    const result = await fetchWithRetry({
      fetchImpl: fetchImpl as typeof fetch,
      label: "github_forbidden",
      url: "https://example.invalid/denied",
      timeoutMs: 100,
    });
    expect(result.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an already-aborted request before network I/O", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    const fetchImpl = vi.fn();
    await expect(
      fetchWithRetry({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        label: "github_request",
        url: "https://example.invalid/review",
        init: { signal: controller.signal },
        timeoutMs: 100,
      }),
    ).rejects.toThrow("network_request_aborted:github_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retains a per-attempt timeout error without leaking the URL", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      );
      const result = fetchWithRetry({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        label: "github_request",
        url: "https://example.invalid/sensitive/path",
        timeoutMs: 25,
        maxAttempts: 1,
      });
      const assertion = expect(result).rejects.toThrow(
        "network_request_timeout:github_request",
      );
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
