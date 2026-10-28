import type { ReactElement } from "react";
import { Brain } from "lucide-react";
import { Badge } from "@reviewrouter/ui/badge";

/** Shared server-rendered state while the memory dashboard is paused. */
export function MemoryDevelopmentNotice(): ReactElement {
  return (
    <section
      id="dashboard-section-content"
      className="min-w-0 px-1 py-6 sm:py-8"
      aria-labelledby="dashboard-memory-title"
      aria-describedby="dashboard-memory-description"
    >
      <div className="max-w-2xl">
        <header>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1
              id="dashboard-memory-title"
              className="text-2xl font-semibold tracking-tight text-[var(--rr-color-text)] sm:text-3xl"
            >
              Memory
            </h1>
            <Badge
              tone="warning"
              size="xs"
              className="rounded-full px-2.5 py-1 text-xs normal-case tracking-normal"
            >
              In development
            </Badge>
          </div>
          <p
            id="dashboard-memory-description"
            className="mt-3 text-sm leading-6 text-[var(--rr-color-text-muted)]"
          >
            Saved knowledge for your workspace’s code reviews.
          </p>
        </header>
        <div className="mt-6 flex items-start gap-4 border-t border-[var(--rr-color-border)] pt-6 sm:mt-8 sm:pt-8">
          <Brain
            aria-hidden="true"
            strokeWidth={1.5}
            className="mt-0.5 h-6 w-6 shrink-0 text-[var(--rr-color-text-subtle)]"
          />
          <div className="min-w-0">
            <p className="text-base font-medium text-[var(--rr-color-text)]">
              This section isn’t available yet.
            </p>
            <p className="mt-2 max-w-lg text-sm leading-6 text-[var(--rr-color-text-muted)]">
              There’s nothing to set up here while we’re working on it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
