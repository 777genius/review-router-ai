import { describe, expect, it } from "vitest";
import {
  ACCOUNT_READ_FAILURE_COOLDOWN_MS,
  ACCOUNT_READ_STALE_MS,
  accountModelCatalogFresh,
  accountModelCatalogOutOfDate,
  accountReadSchedule,
} from "./account-model-catalog-freshness";
import type {
  AccountProfileView,
  AccountView,
} from "../../server/account-gateway-accounts";

const now = Date.parse("2026-11-19T12:00:00.000Z");
const nvidia: AccountProfileView = {
  id: "nvidia-build-chat-apikey-v1",
  label: "NVIDIA",
  protocol: "openai-responses",
  authKind: "api_key",
  models: ["nvidia/model"],
  connection: {
    provider: "nvidia",
    planLabel: "Trial",
    regionLabel: "Global",
    completionInputKind: "none",
    limitsContract: "none",
    modelSettings: [],
  },
};
const codex: AccountProfileView = {
  ...nvidia,
  id: "openai-codex-oauth-responses-v1",
  authKind: "oauth",
  connection: { ...nvidia.connection!, provider: "openai" },
};
const snapshot = (fetchedAt: number, lifetime = 60_000) => ({
  status: "snapshot" as const,
  source: "nvidia" as const,
  fetchedAt: new Date(fetchedAt).toISOString(),
  expiresAt: new Date(fetchedAt + lifetime).toISOString(),
  models: ["nvidia/model"],
});
const read = (
  profile: AccountProfileView,
  modelCatalog: AccountView["modelCatalog"],
) => ({
  status: "ok" as const,
  value: {
    account: {
      connectionId: "connection",
      label: "Account",
      profileId: profile.id,
      profileLabel: profile.label,
      state: "active" as const,
      gatewayRevision: 1,
      mirrorRevision: 1,
      binding: {
        id: "binding",
        revision: 1,
        state: "active" as const,
        fencePending: false,
      },
      ...(modelCatalog ? { modelCatalog } : {}),
    },
    profile,
  },
});

describe("this account's own model list", () => {
  it("is fresh only from its own source and inside its validity window", () => {
    expect(accountModelCatalogFresh(nvidia, snapshot(now - 1_000), now)).toBe(
      true,
    );
    expect(accountModelCatalogFresh(nvidia, snapshot(now - 61_000), now)).toBe(
      false,
    );
    expect(
      accountModelCatalogFresh(
        nvidia,
        { ...snapshot(now), source: "openrouter" },
        now,
      ),
    ).toBe(false);
    expect(accountModelCatalogFresh(nvidia, undefined, now)).toBe(false);
    // A browser clock slightly behind the server is not a list from the future;
    // a timestamp far ahead still is.
    expect(accountModelCatalogFresh(nvidia, snapshot(now + 5_000), now)).toBe(
      true,
    );
    expect(accountModelCatalogFresh(nvidia, snapshot(now + 60_000), now)).toBe(
      false,
    );
  });

  it("is required, and so can be out of date, only for NVIDIA", () => {
    expect(accountModelCatalogOutOfDate(nvidia, undefined, now)).toBe(true);
    expect(
      accountModelCatalogOutOfDate(nvidia, snapshot(now - 61_000), now),
    ).toBe(true);
    expect(accountModelCatalogOutOfDate(nvidia, snapshot(now), now)).toBe(
      false,
    );
    expect(accountModelCatalogOutOfDate(codex, undefined, now)).toBe(false);
  });
});

describe("when an account read happens again", () => {
  it("reads a required list again before it lapses, never sooner than 20 seconds", () => {
    // Native's one-minute list: read again 45 seconds after it arrived.
    expect(accountReadSchedule(read(nvidia, snapshot(now)), now)).toEqual({
      staleTime: 45_000,
      refreshAt: now + 45_000,
    });
    // A long list is read again at most five minutes before it lapses.
    expect(
      accountReadSchedule(read(nvidia, snapshot(now, 60 * 60_000)), now),
    ).toEqual({ staleTime: 55 * 60_000, refreshAt: now + 55 * 60_000 });
    expect(
      accountReadSchedule(read(nvidia, snapshot(now, 10_000)), now).refreshAt,
    ).toBe(now + 20_000);
    // A far-off expiry is still read again within the hour, so browser timers
    // stay in range.
    expect(
      accountReadSchedule(
        read(nvidia, snapshot(now, 10 * 365 * 86_400_000)),
        now,
      ).refreshAt,
    ).toBe(now + 60 * 60_000);
  });

  it("waits a cooldown after a failed or already lapsed list instead of looping", () => {
    const cooldown = {
      staleTime: ACCOUNT_READ_FAILURE_COOLDOWN_MS,
      refreshAt: null,
    };
    expect(accountReadSchedule({ status: "unavailable" }, now)).toEqual(
      cooldown,
    );
    expect(
      accountReadSchedule(
        read(nvidia, {
          status: "unknown",
          source: "legacy_profile",
          models: [],
        }),
        now,
      ),
    ).toEqual(cooldown);
    expect(
      accountReadSchedule(read(nvidia, snapshot(now - 61_000)), now),
    ).toEqual(cooldown);
  });

  it("keeps the ordinary staleness for accounts that do not require their own list", () => {
    expect(
      accountReadSchedule(
        read(codex, { ...snapshot(now), source: "codex" }),
        now,
      ),
    ).toEqual({ staleTime: ACCOUNT_READ_STALE_MS, refreshAt: null });
    expect(accountReadSchedule(undefined, now)).toEqual({
      staleTime: ACCOUNT_READ_STALE_MS,
      refreshAt: null,
    });
  });
});
