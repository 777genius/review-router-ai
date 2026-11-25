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
// Exercise the real action validation rather than mocking the client/action seam.
import { refreshAccountLimits } from "./account-limits-api";
const fresh = {
  status: "ok",
  value: {
    status: "snapshot",
    displayToken: "owned-generation",
    fetchedAt: "2026-11-05T10:00:00.000Z",
    refreshAvailable: true,
    scope: "account",
    windows: [
      {
        label: "5h",
        usedPercent: 25,
        remainingPercent: 75,
        progressPercent: 25,
        durationSeconds: 18000,
        observedAt: "2026-11-05T10:00:00.000Z",
        resetAt: null,
        stale: false,
        reason: null,
      },
    ],
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  h.refresh.mockResolvedValue(fresh);
  h.limits.mockReturnValue({ refresh: h.refresh });
  h.production.mockResolvedValue({ scope: "personal-test", limits: h.limits });
  h.adapter.mockResolvedValue({ refreshLimits: h.refresh });
});
it("refreshes a workspace row using its signed context without a competing workspace selector", async () => {
  expect(
    await refreshAccountLimits({
      context: "signed.context",
      connectionId: "source",
      workspaceId: "org",
    }),
  ).toEqual(fresh);
  expect(h.refresh).toHaveBeenCalledExactlyOnceWith("signed.context", "source");
  expect(h.production).not.toHaveBeenCalled();
});
it("retains the explicit workspace selector for a personal context", async () => {
  expect(
    await refreshAccountLimits({
      context: "personal-test",
      connectionId: "source",
      workspaceId: "org",
    }),
  ).toEqual(fresh);
  expect(h.limits).toHaveBeenCalledWith("org", true);
  expect(h.refresh).toHaveBeenCalledExactlyOnceWith("source");
});

it("preserves the closed provider diagnosis across the real Server Action boundary", async () => {
  const failure = {
    status: "unavailable",
    diagnosis: {
      code: "rate_limited",
      source: "provider",
      httpStatus: 429,
      retryAt: "2026-11-05T10:05:00.000Z",
    },
  };
  h.refresh.mockResolvedValue(failure);
  expect(
    await refreshAccountLimits({
      context: "personal-test",
      connectionId: "source",
    }),
  ).toEqual(failure);
});
