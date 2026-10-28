import { afterEach, expect, test, vi } from "vitest";
import { personalAccountAccessReads } from "./personal-account-access-api";
afterEach(() => vi.unstubAllGlobals());
test("Access reads use GET for current summaries, exact grants and eligible organizations", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: "denied" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetch);
  const api = personalAccountAccessReads("actor.scope");
  expect(fetch).not.toHaveBeenCalled();
  expect(await api.listAccessSummaries({ sourceIds: ["source"] })).toEqual({
    status: "denied",
  });
  await api.listOwnGrants({
    sourceId: "source",
    afterBindingId: "old-binding",
    limit: 25,
  });
  await api.listEligibleOrganizations({
    sourceIds: ["source"],
    afterWorkspaceId: "previous",
    limit: 25,
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  const views = ["summaries", "grants", "organizations"];
  fetch.mock.calls.forEach(([url, init], index) => {
    const request = new URL(String(url), "https://reviewrouter.test");
    expect(request.pathname).toBe("/api/dashboard/accounts/access");
    expect(request.searchParams.get("context")).toBe("actor.scope");
    expect(request.searchParams.get("view")).toBe(views[index]);
    expect(init).toEqual({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
  });
  expect(
    JSON.parse(
      new URL(
        String(fetch.mock.calls[1]![0]),
        "https://reviewrouter.test",
      ).searchParams.get("request")!,
    ),
  ).toEqual({ sourceId: "source", afterBindingId: "old-binding", limit: 25 });
});
test("failed or malformed Access reads stay unavailable without issuing a mutation", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(new Response("not-json"))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "unexpected" })),
    );
  vi.stubGlobal("fetch", fetch);
  const api = personalAccountAccessReads("actor");
  for (let i = 0; i < 3; i++)
    expect(await api.listOwnGrants({ sourceId: "source", limit: 25 })).toEqual({
      status: "unavailable",
    });
  expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
    true,
  );
});
