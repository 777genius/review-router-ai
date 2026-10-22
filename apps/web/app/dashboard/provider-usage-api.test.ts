import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProviderUsage,
  ProviderUsageError,
  providerUsageKey,
} from "./provider-usage-api";
afterEach(() => vi.unstubAllGlobals());
describe("usage transport", () => {
  it("preserves HTTP authorization status, model and independent cursors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    await expect(
      fetchProviderUsage(
        "workspace",
        {
          purpose: "review",
          model: "requested/model",
          after: "call page",
          runAfter: "run page",
        },
        signal,
      ),
    ).rejects.toMatchObject({ status: 403, name: "ProviderUsageError" });
    expect(fetch.mock.calls[0]![0]).toContain("model=requested%2Fmodel");
    expect(fetch.mock.calls[0]![0]).toContain("runAfter=run+page");
    expect(fetch.mock.calls[0]![1]).toEqual({ signal, cache: "no-store" });
    expect(new ProviderUsageError(401).status).toBe(401);
  });
  it("normalizes absent controls in the cache identity", () => {
    expect(
      providerUsageKey("a", {
        provider: "",
        model: undefined,
        purpose: "review",
      }),
    ).toEqual(providerUsageKey("a", { purpose: "review" }));
    expect(providerUsageKey("a", { model: "x" })).not.toEqual(
      providerUsageKey("b", { model: "x" }),
    );
  });
});
