import { describe, expect, it } from "vitest";
import {
  projectAccountLimits,
  type AccountLimitsSnapshot,
  type AccountLimitsSourceWindow,
  type AccountLimitsWindowView,
  type SubscriptionLimitsWindow,
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
const snapshot = (): AccountLimitsSnapshot & {
  windows: readonly Extract<
    AccountLimitsSourceWindow,
    { family: "codex" | "claude" }
  >[];
} => ({
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

describe("subscription quota display", () => {
  const subscription = (
    overrides: Partial<SubscriptionLimitsWindow> = {},
  ): SubscriptionLimitsWindow => ({
    id: "five_hour",
    family: "kimi",
    dimension: "plan_quota",
    unit: "requests",
    basis: "duration",
    durationSeconds: 18000,
    usedPercent: 0,
    observedAt: "2026-10-22T11:59:00Z",
    resetAt: "2026-10-22T13:00:00Z",
    ...overrides,
  });
  const project = (windows: readonly SubscriptionLimitsWindow[]) =>
    projectAccountLimits({ ...snapshot(), windows }, context);

  it("keeps credits and tokens in the same GLM window distinct", () => {
    expect(
      project([
        subscription({ family: "glm", unit: "credits", usedPercent: 10 }),
        subscription({ family: "glm", unit: "tokens", usedPercent: 20 }),
      ]),
    ).toMatchObject({
      status: "snapshot",
      windows: [
        { label: "5h credits", usedPercent: 10, unit: "credits" },
        { label: "5h tokens", usedPercent: 20, unit: "tokens" },
      ],
    });
  });

  it("keeps an actual monthly billing cycle separate from duration and a missing monthly percentage from zero", () => {
    const result = project([
      subscription(),
      subscription({
        id: "monthly",
        basis: "billing_cycle",
        durationSeconds: null,
        usedPercent: null,
        resetAt: "2026-11-03T12:00:00Z",
      }),
    ]);
    expect(result).toMatchObject({
      status: "snapshot",
      windows: [
        {
          label: "5h",
          usedPercent: 0,
          remainingPercent: 100,
          progressPercent: 0,
          stale: false,
        },
        {
          label: "Month",
          durationSeconds: null,
          usedPercent: null,
          remainingPercent: null,
          progressPercent: null,
          resetAt: "2026-11-03T12:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-generation|private-principal|kimi/,
    );
  });

  it("does not present Grok request/token rate observations as subscription allowance", () => {
    const result = project([
      subscription({
        family: "grok",
        id: "weekly",
        durationSeconds: 604800,
        unit: "credits",
        usedPercent: 45,
      }),
      subscription({
        family: "grok",
        id: "request_rate",
        dimension: "rate_limit",
        basis: "unknown",
        durationSeconds: null,
        unit: "requests",
        usedPercent: 20,
      }),
      subscription({
        family: "grok",
        id: "token_rate",
        dimension: "rate_limit",
        basis: "unknown",
        durationSeconds: null,
        unit: "tokens",
        usedPercent: null,
      }),
    ]);
    expect(result).toMatchObject({
      status: "snapshot",
      windows: [
        { label: "Week", dimension: "plan_quota", unit: "credits" },
        {
          label: "Request rate",
          dimension: "rate_limit",
          unit: "requests",
          resetAt: "2026-10-22T13:00:00.000Z",
        },
        {
          label: "Token rate",
          dimension: "rate_limit",
          unit: "tokens",
          progressPercent: null,
        },
      ],
    });
  });

  it("keeps the healthy five-hour observation when the monthly observation expires", () => {
    expect(
      project([
        subscription({ family: "minimax" }),
        subscription({
          family: "minimax",
          id: "monthly",
          basis: "billing_cycle",
          durationSeconds: null,
          observedAt: "2026-10-22T10:00:00Z",
        }),
      ]),
    ).toMatchObject({
      status: "snapshot",
      windows: [
        { label: "5h", stale: false },
        { label: "Month", stale: true, reason: "observation_expired" },
      ],
    });
  });

  it("never manufactures a unit or period for a valid unknown source window", () => {
    expect(
      project([
        subscription({
          id: "unknown",
          family: "glm",
          unit: "unknown",
          basis: "unknown",
          durationSeconds: null,
          usedPercent: null,
        }),
      ]),
    ).toMatchObject({
      status: "snapshot",
      windows: [
        {
          label: "Usage",
          unit: "unknown",
          durationSeconds: null,
          usedPercent: null,
        },
      ],
    });
  });

  it("rejects mismatched providers, repeated observations and fabricated window identities without reflecting them", () => {
    for (const windows of [
      [
        subscription(),
        subscription({ family: "glm", id: "weekly", durationSeconds: 604800 }),
      ],
      [subscription(), subscription()],
      [subscription({ id: "private-untrusted-bucket" })],
      [
        subscription({
          id: "monthly",
          basis: "billing_cycle",
          durationSeconds: 2592000,
        }),
      ],
    ]) {
      const result = project(windows);
      expect(result).toMatchObject({
        status: "unavailable",
        reason: "invalid_snapshot",
      });
      expect(JSON.stringify(result)).not.toContain("private-untrusted-bucket");
    }
  });
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
  it("keeps Claude all/model windows distinct without exposing native dimensions or inferring durations", () => {
    const source = snapshot();
    const result = projectAccountLimits(
      {
        ...source,
        windows: [
          { ...source.windows[0]!, family: "claude", id: "claude-5h" },
          {
            ...source.windows[0]!,
            family: "claude",
            id: "claude-7d",
            durationSeconds: 604800,
            usedPercent: 88,
          },
          {
            ...source.windows[0]!,
            family: "claude",
            id: "claude-7d-sonnet",
            durationSeconds: 604800,
            usedPercent: null,
            observedAt: null,
            resetAt: null,
          },
          {
            ...source.windows[0]!,
            family: "claude",
            id: "claude-7d-fable",
            durationSeconds: null,
            usedPercent: 125,
            resetAt: now.toISOString(),
          },
        ],
      },
      context,
    );
    expect(result).toMatchObject({
      status: "snapshot",
      windows: [
        { label: "5h", remainingPercent: 62.5, stale: false },
        { label: "7d", remainingPercent: 12, stale: false },
        { label: "7d Sonnet", remainingPercent: null, stale: true },
        {
          label: "Window 4, duration unknown Fable",
          usedPercent: 125,
          remainingPercent: 0,
          progressPercent: 100,
          stale: true,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /claude-7d|physicalGeneration|principalVersion|private-/,
    );
    expect(
      window({
        family: "claude",
        id: "claude-7d-sonnet",
        durationSeconds: 3600,
      }),
    ).toMatchObject({ label: "1h Sonnet", durationSeconds: 3600 });
  });
  it("rejects mixed provider windows for one physical account without exposing either observation", () => {
    const source = snapshot();
    const codex = source.windows[0]!;
    const claude = { ...codex, family: "claude" as const, id: "claude-5h" };
    for (const windows of [
      [codex, claude],
      [claude, codex],
    ]) {
      const result = projectAccountLimits({ ...source, windows }, context);
      expect(result).toMatchObject({
        status: "unavailable",
        reason: "invalid_snapshot",
      });
      expect(result).not.toHaveProperty("windows");
    }
  });
  it("rejects unqualified Claude buckets rather than displaying them as general quota", () => {
    const source = snapshot();
    for (const id of ["private-model-bucket", "claude-7d-opus", "toString"]) {
      expect(
        projectAccountLimits(
          {
            ...source,
            windows: [{ ...source.windows[0]!, family: "claude", id }],
          },
          context,
        ),
      ).toMatchObject({ status: "unavailable", reason: "invalid_snapshot" });
    }
    // A similarly named Codex identifier cannot acquire a Claude model label.
    expect(
      window({ id: "claude-7d-sonnet", durationSeconds: 604800 }),
    ).toMatchObject({ label: "7d" });
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
