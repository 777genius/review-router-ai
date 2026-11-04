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

  it("cancels retry backoff immediately when a caller aborts after HTTP 429", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetchImpl = vi.fn().mockResolvedValueOnce(
        new Response("rate limited", { status: 429 }),
      );
      const result = fetchWithRetry({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        label: "github_request",
        url: "https://example.invalid/review",
        init: { signal: controller.signal },
        timeoutMs: 10_000,
        maxAttempts: 2,
      });
      const assertion = expect(result).rejects.toThrow(
        "network_request_aborted:github_request",
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      controller.abort();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels retry backoff immediately following a network failure", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const fetchImpl = vi.fn().mockRejectedValueOnce(
        new Error("connection_lost"),
      );
      const result = fetchWithRetry({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        label: "github_request",
        url: "https://example.invalid/review",
        init: { signal: controller.signal },
        timeoutMs: 10_000,
        maxAttempts: 2,
      });
      const assertion = expect(result).rejects.toThrow(
        "network_request_aborted:github_request",
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      controller.abort();
      await assertion;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
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
  it("never repeats a committed HTTP mutation when response decoding fails", async () => {
    const post = vi.fn(async () => new Response("{bad-json", { status: 201 }));
    const result = fetchWithRetry({
      fetchImpl: post as typeof fetch,
      label: "github_comment_create",
      url: "https://example.invalid/comments",
      init: { method: "POST", body: "{}" },
      timeoutMs: 100,
      consume: (response) => response.json(),
    });
    await expect(result).rejects.toThrow(
      "network_request_failed:github_comment_create",
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

});
