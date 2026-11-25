import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getProviderModelCatalog } from "../../../src/server/openrouter-model-catalog";
import { GET } from "./route";
vi.mock("../../../src/server/openrouter-model-catalog", () => ({
  getProviderModelCatalog: vi.fn(),
}));
describe("public model catalog endpoint", () => {
  it.each(["codex", "claude", "openrouter"])(
    "accepts only public %s catalog inputs",
    async (providerKind) => {
      vi.mocked(getProviderModelCatalog).mockResolvedValueOnce({
        providerKind: "codex",
        models: [],
        source: "models.dev",
        fetchedAt: null,
        lastAttemptAt: null,
        state: "fallback",
        error: "source_unavailable",
        refresh: "cooldown",
      });
      const response = await GET(
        new NextRequest(
          `https://example.test/api/provider-model-catalog?providerKind=${providerKind}&refresh=true&binding=private&upstream=https://unsafe.test`,
        ),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(vi.mocked(getProviderModelCatalog).mock.lastCall?.[0]).toEqual({
        providerKind,
        forceRefresh: true,
        signal: expect.any(AbortSignal),
      });
      const body = await response.json();
      expect(body).not.toHaveProperty("binding");
      expect(body).not.toHaveProperty("accounts");
    },
  );
  it("rejects nonpublic providers before catalog lookup", async () => {
    vi.mocked(getProviderModelCatalog).mockClear();
    const response = await GET(
      new NextRequest(
        "https://example.test/api/provider-model-catalog?providerKind=codex-mimo",
      ),
    );
    expect(response.status).toBe(400);
    expect(getProviderModelCatalog).not.toHaveBeenCalled();
  });
});
