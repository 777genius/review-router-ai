import { describe, expect, it } from "vitest";
import {
  projectAccountLimits,
  type AccountLimitsSnapshot,
  type AccountLimitsWindowView,
} from "./account-limits";
import {
  readAccountLimits,
  type AccountLimitsAuthorization,
} from "../application/use-cases/read-account-limits";

const now = new Date("2026-10-22T12:00:00.000Z");
const context = {
  now,
  fetchedAt: now.toISOString(),
  displayToken: "opaque-scope",
};
const snapshot = (): AccountLimitsSnapshot => ({
  status: "snapshot",
  physicalGeneration: "private-generation",
  principalVersion: "private-principal",
  revision: 5,
  scope: "subscription",
  windows: [
    {
      id: "private-primary",
      family: "codex",
      durationSeconds: 18000,
      usedPercent: 37.5,
      observedAt: "2026-10-22T11:59:00Z",
      resetAt: "2026-10-22T13:00:00Z",
      basis: "duration",
    },
  ],
});
function window(
  overrides: Record<string, unknown> = {},
): AccountLimitsWindowView {
  const source = snapshot();
  const result = projectAccountLimits(
    { ...source, windows: [{ ...source.windows[0]!, ...overrides }] },
    context,
  );
  expect(result.status).toBe("snapshot");
  if (result.status !== "snapshot") throw new Error("expected_snapshot");
  return result.windows[0]!;
}
describe("canonical account limits display", () => {
  it("accepts canonical UTC nanoseconds and normalizes display to milliseconds", () => {
    expect(
      window({
        observedAt: "2026-10-22T11:59:00.123456789Z",
        resetAt: "2026-10-22T13:00:00.987654321Z",
      }),
    ).toMatchObject({
      observedAt: "2026-10-22T11:59:00.123Z",
      resetAt: "2026-10-22T13:00:00.987Z",
      stale: false,
      reason: null,
    });
    expect(
      window({ observedAt: "2026-02-30T11:59:00.123456789Z" }),
    ).toMatchObject({ observedAt: null, stale: true, reason: "invalid_field" });
  });
  it("keeps valid observations while stripping unfamiliar source reasons", () => {
    const unfamiliar = "future_source_code_with_private_label";
    const source = snapshot();
    const result = projectAccountLimits(
      {
        ...source,
        windows: [{ ...source.windows[0]!, reason: unfamiliar }],
      },
      context,
    );
    expect(result).toMatchObject({
      status: "snapshot",
      windows: [{ usedPercent: 37.5, remainingPercent: 62.5, reason: null }],
    });
    expect(JSON.stringify(result)).not.toContain(unfamiliar);
    const unavailable = projectAccountLimits(
      { status: "unavailable", reason: unfamiliar },
      context,
    );
    expect(unavailable).toMatchObject({ status: "unavailable", reason: null });
    expect(JSON.stringify(unavailable)).not.toContain(unfamiliar);
    expect(window({ resetAt: null, reason: "reset_conflict" })).toMatchObject({
      usedPercent: 37.5,
      remainingPercent: 62.5,
      resetAt: null,
      reason: "reset_conflict",
    });
  });
  it("preserves measured use, computes remaining independently and exposes no native identity", () => {
    const result = projectAccountLimits(snapshot(), context);
    expect(result).toMatchObject({
      status: "snapshot",
      refreshAvailable: false,
      windows: [
        {
          label: "5h",
          usedPercent: 37.5,
          remainingPercent: 62.5,
          progressPercent: 37.5,
          stale: false,
        },
      ],
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [
      "private-generation",
      "private-principal",
      "private-primary",
      "revision",
    ])
      expect(serialized).not.toContain(privateValue);
  });
  it.each([
    [0, 100, 0],
    [37.5, 62.5, 37.5],
    [125, 0, 100],
    [null, null, null],
    [-1, null, null],
    [Number.NaN, null, null],
    [Infinity, null, null],
    ["12", null, null],
  ])(
    "treats use %s as a reported fact without inventing a zero",
    (usedPercent, remainingPercent, progressPercent) => {
      expect(window({ usedPercent })).toMatchObject({
        usedPercent:
          typeof usedPercent === "number" &&
          Number.isFinite(usedPercent) &&
          usedPercent >= 0
            ? usedPercent
            : null,
        remainingPercent,
        progressPercent,
      });
    },
  );
  it("keeps partial and legacy windows without invented duration or extra windows", () => {
    expect(
      window({
        durationSeconds: null,
        usedPercent: null,
        observedAt: null,
        resetAt: null,
        basis: "legacy_alias",
      }),
    ).toMatchObject({
      label: "Window 1, duration unknown",
      usedPercent: null,
      remainingPercent: null,
      stale: true,
      reason: "unknown_observation",
    });
    expect(window({ durationSeconds: 604800 })).toMatchObject({ label: "7d" });
    expect(window({ durationSeconds: 3600 })).toMatchObject({ label: "1h" });
    const result = projectAccountLimits(snapshot(), context);
    expect(result.status === "snapshot" && result.windows.length).toBe(1);
  });
  it("marks reset and exact freshness boundaries stale without zeroing the observation", () => {
    expect(window({ observedAt: "2026-10-22T11:55:00Z" })).toMatchObject({
      stale: true,
      reason: "observation_expired",
      usedPercent: 37.5,
    });
    expect(window({ resetAt: now.toISOString() })).toMatchObject({
      stale: true,
      reason: "reset_elapsed",
      usedPercent: 37.5,
      remainingPercent: 62.5,
    });
    expect(window({ observedAt: "2026-10-22T12:01:01Z" })).toMatchObject({
      stale: true,
      observedAt: null,
      reason: "future_observation",
    });
  });
  it("rejects noncanonical dates and invalid envelopes, retaining valid partial fields", () => {
    expect(
      window({ resetAt: 1792674000, observedAt: "2026-02-30T12:00:00Z" }),
    ).toMatchObject({
      resetAt: null,
      observedAt: null,
      stale: true,
      usedPercent: 37.5,
      reason: "invalid_field",
    });
    const source = snapshot();
    for (const invalid of [
      { ...source, revision: 1.5 },
      { ...source, physicalGeneration: "" },
      { ...source, windows: [source.windows[0]!, source.windows[0]!] },
      { ...source, windows: [{ ...source.windows[0]!, family: "spark" }] },
    ])
      expect(
        projectAccountLimits(invalid as AccountLimitsSnapshot, context),
      ).toMatchObject({ status: "unavailable", reason: "invalid_snapshot" });
  });
});

const authority = (): AccountLimitsAuthorization => ({
  target: {
    ownerRef: "owner",
    accountRef: "account",
    profileId: "profile",
    expectedAuthorizationEpoch: 3,
  },
  displayToken: "opaque-generation",
});
describe("account limits authorization boundary", () => {
  it("does not read a restricted account", async () => {
    let calls = 0;
    const result = await readAccountLimits({
      authorize: async () => null,
      reader: {
        read: async () => {
          calls++;
          return snapshot();
        },
      },
      now: () => now,
    });
    expect(calls).toBe(0);
    expect(result.status).toBe("restricted");
  });
  it.each(["denied", "epoch", "token", "account", "profile", "owner"])(
    "discards awaited quota on %s change",
    async (change) => {
      let reads = 0;
      const result = await readAccountLimits({
        now: () => now,
        reader: { read: async () => snapshot() },
        authorize: async () => {
          const current = authority();
          if (reads++ === 0) return current;
          if (change === "denied") return null;
          if (change === "token")
            return { ...current, displayToken: "changed" };
          const field = {
            epoch: "expectedAuthorizationEpoch",
            account: "accountRef",
            profile: "profileId",
            owner: "ownerRef",
          }[change]!;
          return {
            ...current,
            target: {
              ...current.target,
              [field]: change === "epoch" ? 4 : "changed",
            },
          };
        },
      });
      expect(result).toMatchObject({ status: "restricted" });
      expect(JSON.stringify(result)).not.toContain("37.5");
    },
  );
  it("rejects revision regression only within the same physical principal", async () => {
    const read = (source: AccountLimitsSnapshot) =>
      readAccountLimits({
        now: () => now,
        authorize: async () => authority(),
        reader: { read: async () => source },
        previous: snapshot(),
      });
    expect(await read({ ...snapshot(), revision: 4 })).toMatchObject({
      status: "unavailable",
      reason: "revision_regressed",
    });
    expect(
      await read({
        ...snapshot(),
        revision: 1,
        physicalGeneration: "new-generation",
      }),
    ).toMatchObject({ status: "snapshot" });
  });
});
