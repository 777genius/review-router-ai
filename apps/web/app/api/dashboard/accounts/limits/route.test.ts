import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  production: vi.fn(),
  adapter: vi.fn(),
  read: vi.fn(),
  limits: vi.fn(),
}));
vi.mock("../../../../../src/server/personal-account-composition", () => ({
  productionPersonalAccounts: h.production,
}));
vi.mock("../../../../../src/server/account-gateway-accounts", () => ({
  accountsServerAdapter: h.adapter,
}));
import { GET } from "./route";
const request = (query: Record<string, string> = {}) =>
  new Request(
    `https://test.invalid/api/dashboard/accounts/limits?${new URLSearchParams({ context: "personal-test", connectionId: "source", ...query })}`,
  );
beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockResolvedValue({ status: "ok", value: { status: "unknown" } });
  h.limits.mockReturnValue({ read: h.read });
  h.production.mockResolvedValue({ scope: "personal-test", limits: h.limits });
  h.adapter.mockResolvedValue({ limits: h.read });
});
it("reads one local connection privately with strict workspace routing", async () => {
  const response = await GET(request({ workspaceId: "org" }));
  expect(await response.json()).toMatchObject({ status: "ok" });
  expect(response.headers.get("Cache-Control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("Vary")).toBe("Cookie");
  expect(h.limits).toHaveBeenCalledWith("org", true);
  expect(h.read).toHaveBeenCalledWith("source");
});
it.each([
  { unexpected: "1" },
  { accountRef: "native" },
  { context: "" },
  { connectionId: "" },
])("rejects invalid selectors before composition: %o", async (input) => {
  expect(await (await GET(request(input))).json()).toEqual({
    status: "invalid",
  });
  expect(h.production).not.toHaveBeenCalled();
  expect(h.adapter).not.toHaveBeenCalled();
});
it("rejects duplicate query fields", async () => {
  expect(
    await (
      await GET(new Request(`${request().url}&connectionId=second`))
    ).json(),
  ).toEqual({ status: "invalid" });
  expect(h.read).not.toHaveBeenCalled();
});
it("checks personal actor before and after awaiting snapshot", async () => {
  h.production.mockResolvedValueOnce({
    scope: "personal-foreign",
    limits: h.limits,
  });
  expect(await (await GET(request())).json()).toEqual({ status: "denied" });
  expect(h.read).not.toHaveBeenCalled();
  h.production
    .mockResolvedValueOnce({ scope: "personal-test", limits: h.limits })
    .mockResolvedValueOnce({ scope: "personal-changed", limits: h.limits });
  expect(await (await GET(request())).json()).toEqual({ status: "denied" });
});
it("uses signed workspace context without a second workspace selector", async () => {
  expect(
    await (await GET(request({ context: "signed.context" }))).json(),
  ).toMatchObject({ status: "ok" });
  expect(h.read).toHaveBeenCalledWith("signed.context", "source");
  expect(h.production).not.toHaveBeenCalled();
  h.read.mockClear();
  expect(
    await (
      await GET(request({ context: "signed.context", workspaceId: "org" }))
    ).json(),
  ).toEqual({ status: "invalid" });
  expect(h.read).not.toHaveBeenCalled();
});
it("does not expose unexpected transport diagnostics", async () => {
  h.read.mockRejectedValue(new Error("secret upstream body"));
  expect(await (await GET(request())).json()).toEqual({ status: "denied" });
});
