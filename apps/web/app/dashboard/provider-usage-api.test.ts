import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProviderUsage,
  ProviderUsageError,
  providerUsageKey,
} from "./provider-usage-api";
const scope = {
  actorId: "actor-a",
  workspaceId: "workspace",
  effectiveAccess: "admin" as const,
  seedId: "seed-a",
};
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
        scope,
      ),
    ).rejects.toMatchObject({ status: 403, name: "ProviderUsageError" });
    expect(fetch.mock.calls[0]![0]).toContain("model=requested%2Fmodel");
    expect(fetch.mock.calls[0]![0]).toContain("runAfter=run+page");
    expect(fetch.mock.calls[0]![1]).toEqual({ signal, cache: "no-store" });
    expect(new ProviderUsageError(401).status).toBe(401);
  });
  it.each([
    { actorId: "actor-b" },
    { workspaceId: "foreign" },
    { effectiveAccess: "member" },
  ])("rejects a changed authenticated200 scope %j", async (changed) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: { ...scope, ...changed },
            report: { secret: true },
          }),
        ),
      ),
    );
    await expect(
      fetchProviderUsage("workspace", {}, new AbortController().signal, scope),
    ).rejects.toMatchObject({ status: 409 });
  });
  it.each([null, {}, { scope: null }])(
    "rejects an unverifiable200 envelope %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
      );
      await expect(
        fetchProviderUsage(
          "workspace",
          {},
          new AbortController().signal,
          scope,
        ),
      ).rejects.toMatchObject({ status: 409 });
    },
  );
  it("normalizes absent controls in the cache identity", () => {
    expect(
      providerUsageKey(
        { ...scope, workspaceId: "a" },
        {
          provider: "",
          model: undefined,
          purpose: "review",
        },
      ),
    ).toEqual(
      providerUsageKey({ ...scope, workspaceId: "a" }, { purpose: "review" }),
    );
    expect(
      providerUsageKey({ ...scope, workspaceId: "a" }, { model: "x" }),
    ).not.toEqual(
      providerUsageKey({ ...scope, workspaceId: "b" }, { model: "x" }),
    );
  });
});
