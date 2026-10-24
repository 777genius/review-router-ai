/** Canonical native observations only. Raw provider normalization belongs to the source. */
export type AccountLimitsReason =
  | "missing_snapshot"
  | "invalid_snapshot"
  | "invalid_field"
  | "unknown_observation"
  | "future_observation"
  | "observation_expired"
  | "reset_elapsed"
  | "reset_conflict"
  | "source_unavailable"
  | "unsupported_profile"
  | "owner_only"
  | "generation_changed"
  | "revision_regressed";

type SourceWindow = {
  readonly id: string;
  readonly durationSeconds: number | null;
  readonly usedPercent: number | null;
  readonly observedAt: string | null;
  readonly resetAt: string | null;
  /** Untrusted source code; projection exposes only the closed display allowlist. */
  readonly reason?: string | undefined;
};

export type SubscriptionLimitsProvider = "kimi" | "glm" | "minimax" | "grok";
export type SubscriptionLimitsWindow = SourceWindow & {
  readonly family: SubscriptionLimitsProvider;
  readonly basis: "duration" | "billing_cycle" | "unknown";
  readonly dimension: "plan_quota" | "rate_limit";
  readonly unit: "credits" | "tokens" | "requests" | "unknown";
};
export type AccountLimitsSourceWindow =
  | (SourceWindow & {
      readonly family: "codex" | "claude";
      readonly basis: "duration" | "legacy_alias" | "unknown";
    })
  | SubscriptionLimitsWindow;

/** This result is server-only: physical identity must never enter a browser DTO. */
export type AccountLimitsSnapshot = {
  readonly status: "snapshot";
  readonly physicalGeneration: string;
  readonly principalVersion: string;
  readonly revision: number;
  readonly scope: "account" | "subscription";
  readonly windows: readonly AccountLimitsSourceWindow[];
};
export type AccountLimitsSourceResult =
  | AccountLimitsSnapshot
  | {
      readonly status: "unknown" | "unsupported" | "unavailable";
      readonly reason?: string | undefined;
    };

export type AccountLimitsWindowView = {
  readonly label: string;
  readonly durationSeconds: number | null;
  readonly usedPercent: number | null;
  readonly remainingPercent: number | null;
  readonly progressPercent: number | null;
  readonly observedAt: string | null;
  readonly resetAt: string | null;
  readonly stale: boolean;
  readonly reason: AccountLimitsReason | null;
  readonly dimension?: "plan_quota" | "rate_limit";
  readonly unit?: SubscriptionLimitsWindow["unit"];
};
type DisplayContext = {
  readonly fetchedAt: string;
  readonly displayToken: string;
  readonly refreshAvailable: false;
};
export type AccountLimitsView = DisplayContext &
  (
    | {
        readonly status: "snapshot";
        readonly scope: "account" | "subscription";
        readonly windows: readonly AccountLimitsWindowView[];
      }
    | {
        readonly status:
          | "unknown"
          | "unsupported"
          | "unavailable"
          | "restricted";
        readonly reason: AccountLimitsReason | null;
      }
  );

const reasons: ReadonlySet<string> = new Set<AccountLimitsReason>([
  "missing_snapshot",
  "invalid_snapshot",
  "invalid_field",
  "unknown_observation",
  "future_observation",
  "observation_expired",
  "reset_elapsed",
  "reset_conflict",
  "source_unavailable",
  "unsupported_profile",
  "owner_only",
  "generation_changed",
  "revision_regressed",
]);
function safeReason(value: unknown): AccountLimitsReason | null {
  return typeof value === "string" && reasons.has(value)
    ? (value as AccountLimitsReason)
    : null;
}
/** Reject Unix/relative timestamps and offsets: the SDK promises canonical UTC instants. */
function instant(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const normalized = new Date(time).toISOString();
  return normalized.slice(0, 19) === value.slice(0, 19) ? normalized : null;
}
function finiteNonnegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
function durationLabel(seconds: number | null, index: number): string {
  if (seconds === null) return `Window ${index + 1}, duration unknown`;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

// Only qualified Claude dimensions may become general/model quota labels.
// Canonical source IDs stay server-side; browser labels never echo arbitrary IDs.
const claudeLabels: Readonly<Record<string, string>> = {
  "claude-5h": "",
  "claude-7d": "",
  "claude-7d-sonnet": " Sonnet",
  "claude-7d-fable": " Fable",
};

const subscriptionProviders = new Set<string>([
  "kimi",
  "glm",
  "minimax",
  "grok",
]);
const subscriptionWindows = new Set<string>([
  "five_hour",
  "weekly",
  "monthly",
  "primary",
  "secondary",
  "unknown",
  "request_rate",
  "token_rate",
]);
function subscriptionWindow(
  window: AccountLimitsSourceWindow,
): window is SubscriptionLimitsWindow {
  return subscriptionProviders.has(window.family);
}
function subscriptionLabel(
  window: SubscriptionLimitsWindow,
  duration: number | null,
): string {
  if (window.dimension === "rate_limit") {
    return window.unit === "tokens"
      ? "Token rate"
      : window.unit === "requests"
        ? "Request rate"
        : "Rate limit";
  }
  if (window.basis === "billing_cycle") return "Month";
  if (duration === 18000) return "5h";
  if (duration === 604800) return "Week";
  return duration === null ? "Usage" : durationLabel(duration, 0);
}

export function projectAccountLimits(
  result: AccountLimitsSourceResult,
  context: {
    readonly now: Date;
    readonly fetchedAt: string;
    readonly displayToken: string;
  },
): AccountLimitsView {
  const common: DisplayContext = {
    fetchedAt: context.fetchedAt,
    displayToken: context.displayToken,
    refreshAvailable: false,
  };
  const invalid = (): AccountLimitsView => ({
    ...common,
    status: "unavailable",
    reason: "invalid_snapshot",
  });
  if (
    !result ||
    typeof result !== "object" ||
    !Number.isFinite(context.now.getTime())
  )
    return invalid();
  if (result.status !== "snapshot") {
    if (!["unknown", "unsupported", "unavailable"].includes(result.status))
      return invalid();
    return {
      ...common,
      status: result.status,
      reason: safeReason(result.reason),
    };
  }
  if (
    !result.physicalGeneration ||
    typeof result.physicalGeneration !== "string" ||
    !result.principalVersion ||
    typeof result.principalVersion !== "string" ||
    !Number.isSafeInteger(result.revision) ||
    result.revision < 0 ||
    !["account", "subscription"].includes(result.scope) ||
    !Array.isArray(result.windows) ||
    result.windows.length < 1 ||
    result.windows.length > 8
  )
    return invalid();
  const ids = new Set<string>();
  const family = result.windows[0]?.family;
  for (const window of result.windows) {
    const subscription = window && subscriptionWindow(window);
    const key = subscription
      ? `${window.id}:${window.dimension}:${window.unit}`
      : window?.id;
    if (
      !window ||
      typeof window.id !== "string" ||
      !window.id ||
      ids.has(key) ||
      (!["codex", "claude"].includes(window.family) && !subscription) ||
      window.family !== family ||
      (window.family === "claude" && !Object.hasOwn(claudeLabels, window.id)) ||
      (subscription
        ? !subscriptionWindows.has(window.id) ||
          !["plan_quota", "rate_limit"].includes(window.dimension) ||
          !["credits", "tokens", "requests", "unknown"].includes(window.unit) ||
          !["duration", "billing_cycle", "unknown"].includes(window.basis) ||
          (window.basis === "billing_cycle" &&
            (window.id !== "monthly" ||
              window.dimension !== "plan_quota" ||
              window.durationSeconds !== null)) ||
          (window.id === "five_hour" && window.durationSeconds !== 18000) ||
          (window.id === "weekly" && window.durationSeconds !== 604800) ||
          (window.id === "monthly" && window.basis !== "billing_cycle") ||
          (window.id === "request_rate" &&
            (window.dimension !== "rate_limit" ||
              window.unit !== "requests")) ||
          (window.id === "token_rate" &&
            (window.dimension !== "rate_limit" || window.unit !== "tokens")) ||
          (window.basis === "unknown" && window.durationSeconds !== null)
        : !["duration", "legacy_alias", "unknown"].includes(window.basis))
    )
      return invalid();
    ids.add(key);
  }
  const now = context.now.getTime();
  const windows = result.windows.map(
    (window, index): AccountLimitsWindowView => {
      const duration = finiteNonnegative(window.durationSeconds);
      const durationSeconds =
        duration !== null && Number.isSafeInteger(duration) && duration > 0
          ? duration
          : null;
      const usedPercent = finiteNonnegative(window.usedPercent);
      let observedAt = instant(window.observedAt);
      const resetAt = instant(window.resetAt);
      let reason = safeReason(window.reason);
      const invalidField =
        (window.usedPercent !== null && usedPercent === null) ||
        (window.durationSeconds !== null && durationSeconds === null) ||
        (window.observedAt !== null && observedAt === null) ||
        (window.resetAt !== null && resetAt === null);
      if (invalidField) reason = "invalid_field";
      const future =
        observedAt !== null && Date.parse(observedAt) > now + 60_000;
      if (future) {
        observedAt = null;
        reason = "future_observation";
      }
      const resetElapsed = resetAt !== null && Date.parse(resetAt) <= now;
      const expired =
        observedAt !== null && now - Date.parse(observedAt) >= 300_000;
      if (!reason)
        reason = resetElapsed
          ? "reset_elapsed"
          : observedAt === null
            ? "unknown_observation"
            : expired
              ? "observation_expired"
              : null;
      const label = subscriptionWindow(window)
        ? subscriptionLabel(window, durationSeconds)
        : `${durationLabel(durationSeconds, index)}${window.family === "claude" ? claudeLabels[window.id] : ""}`;
      const distinguishUnit =
        subscriptionWindow(window) &&
        window.unit !== "unknown" &&
        result.windows.some(
          (other) =>
            subscriptionWindow(other) &&
            other.id === window.id &&
            other.dimension === window.dimension &&
            other.unit !== window.unit,
        );
      return {
        label:
          distinguishUnit && subscriptionWindow(window)
            ? `${label} ${window.unit}`
            : label,
        durationSeconds,
        usedPercent,
        remainingPercent:
          usedPercent === null
            ? null
            : Math.max(0, Math.min(100, 100 - usedPercent)),
        progressPercent:
          usedPercent === null ? null : Math.min(100, usedPercent),
        observedAt,
        resetAt,
        stale: observedAt === null || resetElapsed || expired,
        reason,
        ...(subscriptionWindow(window)
          ? { dimension: window.dimension, unit: window.unit }
          : {}),
      };
    },
  );
  return { ...common, status: "snapshot", scope: result.scope, windows };
}
