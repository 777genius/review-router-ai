// Controlled Gateway HTTP fixture. This proves RR integration, not live native quota.
import { FIXTURES } from "./contracts.ts";
import { setTimeout as delay } from "node:timers/promises";

type Account = {
  readonly ownerRef: string;
  readonly accountRef: string;
  readonly profileId: string;
  readonly authorizationEpoch: number;
};
type Mode =
  | "fresh"
  | "two-windows"
  | "partial"
  | "unknown"
  | "unsupported"
  | "unavailable"
  | "stale"
  | "claude-models";
const modes: readonly string[] = [
  "fresh",
  "two-windows",
  "partial",
  "unknown",
  "unsupported",
  "unavailable",
  "stale",
  "claude-models",
];

export function createLimitsFixture(accounts: readonly Account[]) {
  let mode: Mode = "fresh";
  let delayMs = 0;
  let revision = 1;
  let reads = 0;
  let completed = 0;
  const readAccounts: string[] = [];
  const completedAccounts: string[] = [];
  // The observation is immutable until fixture configuration changes. A cached
  // reread must not manufacture a fresh observation timestamp.
  let observedAt = new Date(Date.now() - 60_000).toISOString();
  let resetAt = new Date(Date.now() + 60_000).toISOString();
  return {
    configure(config: Record<string, unknown>) {
      if (modes.includes(String(config.mode))) mode = config.mode as Mode;
      delayMs =
        typeof config.delayMs === "number" &&
        config.delayMs >= 0 &&
        config.delayMs <= 2000
          ? config.delayMs
          : 0;
      revision++;
      reads = 0;
      completed = 0;
      readAccounts.length = 0;
      completedAccounts.length = 0;
      observedAt = new Date(
        Date.now() - (mode === "stale" ? 360_000 : 60_000),
      ).toISOString();
      resetAt = new Date(
        Date.now() + (mode === "stale" ? -60_000 : 60_000),
      ).toISOString();
    },
    stats: () => ({
      reads,
      completed,
      readAccounts: [...readAccounts],
      completedAccounts: [...completedAccounts],
      mode,
      observedAt,
      resetAt,
    }),
    async handle(
      method: string,
      pathname: string,
      body: () => Promise<Record<string, unknown>>,
    ) {
      if (method === "GET" && pathname === "/v1/capabilities/account-limits") {
        return {
          status: 200,
          body: {
            contract: "account-limits/v1",
            cachedRead: true,
            quotaOnlyRefresh: false,
          },
        };
      }
      if (method !== "POST" || pathname !== "/v1/account-limits/read")
        return null;
      const target = await body();
      const account = accounts.find(
        (item) =>
          item.accountRef === target.accountRef &&
          item.ownerRef === target.ownerRef &&
          item.profileId === target.profileId &&
          item.authorizationEpoch === target.expectedAuthorizationEpoch,
      );
      if (!account)
        return {
          status: 403,
          body: {
            code: "forbidden",
            traceRef: "limits-fixture-denied",
            effect: "not_dispatched",
            retry: { kind: "never" },
          },
        };
      reads++;
      readAccounts.push(account.accountRef);
      // Capture before waiting so a scope change races an actual old response.
      const capturedMode = mode;
      const family =
        account.profileId === FIXTURES.gateway.claudeProfileId
          ? "claude"
          : "codex";
      const snapshot = {
        status: "snapshot",
        physicalGeneration: `fixture-generation-${account.accountRef}`,
        principalVersion: "fixture-principal-v1",
        revision,
        scope: "account",
        windows: [
          {
            id: `${family}-5h`,
            family,
            durationSeconds: 18000,
            usedPercent: capturedMode === "partial" ? null : 37.5,
            observedAt,
            resetAt: capturedMode === "partial" ? null : resetAt,
            basis: "duration",
          },
        ],
      };
      if (capturedMode === "two-windows" || capturedMode === "claude-models") {
        snapshot.windows.push({
          id: `${family}-7d`,
          family,
          durationSeconds: 604800,
          usedPercent: 88,
          observedAt,
          resetAt: new Date(Date.parse(observedAt) + 86_400_000).toISOString(),
          basis: "duration",
        });
      }
      if (family === "claude" && capturedMode === "claude-models") {
        snapshot.windows.push(
          {
            ...snapshot.windows[1]!,
            id: "claude-7d-sonnet",
            usedPercent: 72.25,
          },
          { ...snapshot.windows[1]!, id: "claude-7d-fable", usedPercent: 125 },
        );
      }
      if (delayMs) await delay(delayMs);
      completed++;
      completedAccounts.push(account.accountRef);
      if (
        capturedMode === "fresh" ||
        capturedMode === "partial" ||
        capturedMode === "two-windows" ||
        capturedMode === "stale" ||
        capturedMode === "claude-models"
      )
        return { status: 200, body: snapshot };
      return {
        status: 200,
        // SDK v1 uses strict status-only objects for non-snapshot results.
        body: { status: capturedMode },
      };
    },
  };
}
