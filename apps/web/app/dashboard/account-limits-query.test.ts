import { afterEach, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { AccountLimitsView } from "../../src/server/account-gateway-accounts";
import {
  ACCOUNT_LIMITS_AUTO_REFRESH_COOLDOWN_MS,
  accountLimitsKey,
  accountLimitsRefreshOptions,
  claimAccountLimitsAutoRefresh,
  extractAccountLimits,
  hasNewerObservation,
} from "./account-limits-query";
import {
  AccountDiagnosisError,
  type AccountDiagnosis,
  accountDiagnosisMessage,
} from "../../src/features/account-gateway/account-diagnosis";
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
    const code = status === "invalid" ? "invalid_request" : status;
    const diagnosis: AccountDiagnosis = { code, source: "application" };
    vi.mocked(refreshAccountLimits).mockResolvedValue({ status, diagnosis });
    await expect(f.refresh()).rejects.toThrow(
      accountDiagnosisMessage(diagnosis),
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

test("preserves a stale observation while exposing a closed provider diagnosis", async () => {
  const f = fixture();
  const diagnosis = {
    code: "rate_limited" as const,
    source: "provider" as const,
    httpStatus: 429,
    retryAt: "2026-11-05T12:05:00.000Z",
  };
  vi.mocked(refreshAccountLimits).mockResolvedValue({
    status: "unavailable",
    diagnosis,
  });
  await expect(f.refresh()).rejects.toMatchObject({ diagnosis });
  expect(f.client.getQueryData(f.key)).toEqual(f.saved);
  expect(new AccountDiagnosisError(diagnosis).message).not.toContain("429");
});

test.each(["conflict", "invalid", "unavailable"] as const)(
  "uses a safe %s fallback when an older producer omits diagnosis",
  async (status) => {
    const f = fixture();
    vi.mocked(refreshAccountLimits).mockResolvedValue({ status });
    const expected: AccountDiagnosis = {
      code: status === "invalid" ? "invalid_request" : status,
      source: "application",
    };
    await expect(f.refresh()).rejects.toThrow(
      accountDiagnosisMessage(expected),
    );
    expect(f.client.getQueryData(f.key)).toEqual(f.saved);
  },
);

test("automatic refresh is claimed once per account generation and cooldown", () => {
  const start = Date.parse("2026-11-17T10:00:00.000Z");
  const claim = (displayToken: string, at: number, connectionId = "claimed") =>
    claimAccountLimitsAutoRefresh("viewer", connectionId, displayToken, at);
  expect(claim("generation-a", start)).toBe(true);
  expect(claim("generation-a", start + 1_000)).toBe(false);
  // A reconnect or another account is a different source and loads at once.
  expect(claim("generation-b", start + 1_000)).toBe(true);
  expect(claim("generation-a", start + 1_000, "other")).toBe(true);
  expect(
    claim("generation-a", start + ACCOUNT_LIMITS_AUTO_REFRESH_COOLDOWN_MS - 1),
  ).toBe(false);
  expect(
    claim("generation-a", start + ACCOUNT_LIMITS_AUTO_REFRESH_COOLDOWN_MS),
  ).toBe(true);
});

const observedAt = (
  view: AccountLimitsView,
  times: readonly string[],
  fetchedAt: string,
): AccountLimitsView => {
  if (view.status !== "snapshot") throw new Error("fixture");
  return {
    ...view,
    fetchedAt,
    windows: times.map((time, index) => ({
      ...view.windows[0]!,
      label: index ? "7d" : "5h",
      observedAt: time,
    })),
  };
};

test("a later inventory read keeps a newer refreshed observation", () => {
  const { client, key, saved } = fixture();
  // The refresh installed a 12:10 observation; a focus refetch at 12:20 still
  // reads the saved 12:00 one and must not bring the old numbers back.
  const refreshed = observedAt(
    saved.value,
    ["2026-11-04T12:10:00.000Z"],
    "2026-11-04T12:10:00.000Z",
  );
  client.setQueryData(key, { status: "ok", value: refreshed });
  const inventory = (limits: AccountLimitsView) => ({
    status: "ok" as const,
    value: {
      accounts: [
        {
          connectionId: "connection",
          label: "Seventeen",
          profileId: "codex",
          profileLabel: "Codex",
          state: "active" as const,
          gatewayRevision: 1,
          mirrorRevision: 1,
          binding: null,
          limits,
        },
      ],
    },
  });
  extractAccountLimits(
    client,
    "viewer",
    inventory(
      observedAt(
        saved.value,
        ["2026-11-04T12:00:00.000Z"],
        "2026-11-04T12:20:00.000Z",
      ),
    ),
  );
  expect(client.getQueryData(key)).toEqual({ status: "ok", value: refreshed });
  const newer = observedAt(
    saved.value,
    ["2026-11-04T12:15:00.000Z"],
    "2026-11-04T12:20:00.000Z",
  );
  extractAccountLimits(client, "viewer", inventory(newer));
  expect(client.getQueryData(key)).toEqual({ status: "ok", value: newer });
});

test("any window observed later counts as newer, not only the latest one", () => {
  const { saved } = fixture();
  const before = observedAt(
    saved.value,
    ["2026-11-04T09:40:00.000Z", "2026-11-04T09:50:00.000Z"],
    "2026-11-04T10:00:00.000Z",
  );
  const oneWindowAdvanced = observedAt(
    saved.value,
    ["2026-11-04T09:45:00.000Z", "2026-11-04T09:50:00.000Z"],
    "2026-11-04T10:01:00.000Z",
  );
  expect(hasNewerObservation(before, oneWindowAdvanced)).toBe(true);
  expect(hasNewerObservation(before, before)).toBe(false);
});
