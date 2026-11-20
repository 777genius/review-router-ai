"use client";

import { Button } from "@reviewrouter/ui";

/**
 * Shown when a roster's only reviewer has a daily request limit. It advises
 * and never blocks saving; the action is the roster's own Add reviewer.
 */
export function DailyLimitNotice({
  onAddReviewer,
  disabled,
}: {
  onAddReviewer: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <div role="note" className="grid gap-2">
      <p className="text-sm leading-6 text-amber-100/85">
        This model has a daily request limit. When it is used up, reviews stop
        until the limit resets the next day. Add a second reviewer and use
        Fallback in order so reviews keep running.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={disabled}
        onClick={onAddReviewer}
      >
        Add a second reviewer
      </Button>
    </div>
  );
}
