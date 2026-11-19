"use client";

import { Button } from "@reviewrouter/ui";
import { durationText } from "./account-limits-line";

/** "just now" / "3m ago" for data that refreshes itself. */
export function updatedAgo(at: string | number): string {
  const minutes = Math.floor((Date.now() - new Date(at).getTime()) / 60_000);
  return minutes < 1 ? "just now" : `${durationText(minutes)} ago`;
}

/**
 * One line that reports data which keeps itself current. A failure offers
 * "Try again"; a working list may keep a small secondary refresh. Nothing in
 * the normal path asks the user to refresh.
 */
export function StatusLine({
  message,
  title,
  action,
}: {
  message: string;
  title?: string | undefined;
  action?:
    | {
        kind: "retry" | "refresh-models";
        busy: boolean;
        onClick: () => void;
      }
    | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
      <span role="status" title={title}>
        {message}
      </span>
      {action ? (
        <Button
          type="button"
          variant={action.kind === "retry" ? "outline" : "ghost"}
          size="sm"
          {...(action.kind === "refresh-models"
            ? { "aria-label": "Refresh models" }
            : {})}
          disabled={action.busy}
          onClick={action.onClick}
        >
          {action.kind === "retry" ? "Try again" : "Refresh"}
        </Button>
      ) : null}
    </div>
  );
}
