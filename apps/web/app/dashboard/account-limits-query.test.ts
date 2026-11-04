import { afterEach, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { AccountLimitsView } from "../../src/server/account-gateway-accounts";
import {
  accountLimitsKey,
  accountLimitsRefreshOptions,
} from "./account-limits-query";
import { refreshAccountLimits } from "./account-limits-api";

vi.mock("./account-limits-api", () => ({
  refreshAccountLimits: vi.fn(),
  readAccountLimits: vi.fn(),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.resetAllMocks();
});
function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  clients.push(client);
  const key = accountLimitsKey("viewer", "connection");
  const value: AccountLimitsView = {
    status: "snapshot",
    fetchedAt: "2026-11-04T12:00:00.000Z",
    displayToken: "generation-a",
    refreshAvailable: true,
    scope: "subscription",
    windows: [
      {
        label: "5h",
        durationSeconds: 18000,
        usedPercent: 37.5,
        remainingPercent: 62.5,
        progressPercent: 37.5,
        observedAt: "2026-11-04T12:00:00.000Z",
        resetAt: null,
        stale: true,
        reason: null,
      },
    ],
  };
  const saved = { status: "ok" as const, value };
  client.setQueryData(key, saved);
  const refresh = () =>
    client
      .getMutationCache()
      .build(
        client,
        accountLimitsRefreshOptions(
          "viewer",
          { context: "signed.context", connectionId: "connection" },
          client,
        ),
      )
      .execute(undefined);
  return { client, key, saved, refresh };
}
test.each(["unavailable", "conflict", "invalid"] as const)(
  "keeps the saved quota and rejects a %s refresh",
  async (status) => {
    const f = fixture();
    vi.mocked(refreshAccountLimits).mockResolvedValue({ status });
    await expect(f.refresh()).rejects.toThrow(
      "Could not refresh current limits",
    );
    expect(f.client.getQueryData(f.key)).toEqual(f.saved);
    expect(refreshAccountLimits).toHaveBeenCalledTimes(1);
  },
);
test("evicts numeric quota on actual refresh authorization denial", async () => {
  const f = fixture();
  vi.mocked(refreshAccountLimits).mockResolvedValue({ status: "denied" });
  await f.refresh();
  expect(f.client.getQueryData(f.key)).toEqual({ status: "denied" });
});
