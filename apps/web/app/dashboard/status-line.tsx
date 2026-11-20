"use client";

import { Button } from "@reviewrouter/ui";
import { durationText } from "./account-limits-line";

/**
 * "just now" / "3m ago" for data that refreshes itself, counted on the
 * ticking `useAgeClock` so the line keeps current while it is open.
 */
export function updatedAgo(at: string | number, now: number | null): string {
  if (now === null) return "recently";
  const minutes = Math.floor((now - new Date(at).getTime()) / 60_000);
  return minutes < 1 ? "just now" : `${durationText(minutes)} ago`;
}

/**
 * One line that reports data which keeps itself current. A failure offers
 * "Try again" (`onRetry`); a working model list may keep a small secondary
 * refresh (`onRefreshModels`). Nothing in the normal path asks to refresh.
 */
export function StatusLine({
  message,
  title,
  busy = false,
  onRetry,
  onRefreshModels,
}: {
  message: string;
  title?: string | undefined;
  busy?: boolean;
  onRetry?: (() => void) | undefined;
  onRefreshModels?: (() => void) | undefined;
}) {
  const onClick = onRetry ?? onRefreshModels;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
      <span role="status" title={title}>
        {message}
      </span>
      {onClick ? (
        <Button
          type="button"
          variant={onRetry ? "outline" : "ghost"}
          size="sm"
          {...(onRetry ? {} : { "aria-label": "Refresh models" })}
          disabled={busy}
          onClick={onClick}
        >
          {onRetry ? "Try again" : "Refresh"}
        </Button>
      ) : null}
    </div>
  );
}
