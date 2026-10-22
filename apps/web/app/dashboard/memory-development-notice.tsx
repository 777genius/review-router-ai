import type { ReactElement } from "react";

/** Shared server-rendered state while the memory dashboard is paused. */
export function MemoryDevelopmentNotice(): ReactElement {
  return (
    <section
      id="dashboard-section-content"
      className="min-w-0 px-1 py-8"
      aria-labelledby="dashboard-memory-title"
    >
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
        In development
      </p>
      <h2
        id="dashboard-memory-title"
        className="mt-3 text-3xl font-bold tracking-tight text-cyan-50"
      >
        Memory
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
        Workspace memory is being prepared. This section is not available yet.
      </p>
    </section>
  );
}
