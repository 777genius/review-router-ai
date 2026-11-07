import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  production: vi.fn(),
  adapter: vi.fn(),
  refresh: vi.fn(),
  limits: vi.fn(),
}));
vi.mock("../../src/server/personal-account-composition", () => ({
  productionPersonalAccounts: h.production,
}));
vi.mock("../../src/server/account-gateway-accounts", () => ({
  accountsServerAdapter: h.adapter,
}));
import { refreshAccountLimitsAction } from "./account-limits-actions";
const request = { context: "personal-test", connectionId: "source" };
beforeEach(() => {
  vi.resetAllMocks();
  h.refresh.mockResolvedValue({ status: "ok", value: { status: "unknown" } });
  h.limits.mockReturnValue({ refresh: h.refresh });
  h.production.mockResolvedValue({ scope: "personal-test", limits: h.limits });
  h.adapter.mockResolvedValue({ refreshLimits: h.refresh });
});
it("routes personal refresh with live scope before and after", async () => {
  expect(
    await refreshAccountLimitsAction({ ...request, workspaceId: "org" }),
  ).toMatchObject({ status: "ok" });
  expect(h.limits).toHaveBeenCalledWith("org", true);
  expect(h.refresh).toHaveBeenCalledWith("source");
  h.production.mockResolvedValueOnce({ scope: "other", limits: h.limits });
  h.refresh.mockClear();
  expect(await refreshAccountLimitsAction(request)).toEqual({
    status: "denied",
  });
  expect(h.refresh).not.toHaveBeenCalled();
  h.production
    .mockResolvedValueOnce({ scope: "personal-test", limits: h.limits })
    .mockResolvedValueOnce({ scope: "changed" });
  expect(await refreshAccountLimitsAction(request)).toEqual({
    status: "denied",
  });
});
it("rejects raw native selectors and invalid IDs before composition", async () => {
  for (const invalid of [
    { ...request, ownerRef: "native" },
    { ...request, connectionId: "" },
    { ...request, connectionId: "invalid/id" },
  ])
    expect(await refreshAccountLimitsAction(invalid)).toMatchObject({
      status: "invalid",
    });
  expect(h.production).not.toHaveBeenCalled();
  expect(h.adapter).not.toHaveBeenCalled();
});
it("uses the signed context's sole workspace authority", async () => {
  expect(
    await refreshAccountLimitsAction({
      ...request,
      context: "signed.context",
      workspaceId: "org",
    }),
  ).toMatchObject({
    status: "invalid",
    diagnosis: { code: "invalid_request", source: "application" },
  });
  expect(h.adapter).not.toHaveBeenCalled();
  expect(
    await refreshAccountLimitsAction({ ...request, context: "signed.context" }),
  ).toMatchObject({ status: "ok" });
  expect(h.refresh).toHaveBeenCalledWith("signed.context", "source");
});
it("normalizes unsafe failures", async () => {
  h.refresh.mockRejectedValue(new Error("private token"));
  expect(await refreshAccountLimitsAction(request)).toEqual({
    status: "denied",
  });
});
