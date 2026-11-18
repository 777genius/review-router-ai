import type { ReactNode } from "react";

/**
 * The order a new workspace follows to its first review. Setup itself
 * reads the provider, so the provider comes before any repository.
 */
export function RepositoryFirstRunGuide({
  providerStep,
}: {
  /** The workspace provider line, or why the viewer cannot choose one. */
  readonly providerStep: ReactNode;
}): React.ReactElement {
  return (
    <section
      aria-labelledby="repository-first-run-guide-title"
      data-repository-first-run-guide
      className="space-y-3 border-y border-cyan-200/10 py-4"
    >
      <h3
        id="repository-first-run-guide-title"
        className="text-sm font-semibold text-cyan-50"
      >
        Get your first review
      </h3>
      <div className="space-y-2">
        <p className="text-sm text-slate-300">Choose a provider for reviews.</p>
        {providerStep}
      </div>
      <p className="text-sm leading-6 text-slate-300">
        Then create a setup PR for a repository in the list below and follow
        its steps. Search for the one you want to start with; the others can
        wait.
      </p>
    </section>
  );
}
