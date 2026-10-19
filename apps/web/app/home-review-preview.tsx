const diffLines = [
  { tone: "context", text: "const delays = mergeabilityRetryDelays;" },
  { tone: "removed", text: "- await scanReference(pullRequest);" },
  { tone: "added", text: "+ await scanWithRetry(pullRequest, delays);" },
  { tone: "added", text: "+ expect(result.coverageMoved).toBe(false);" },
  { tone: "context", text: "return buildInventory(result);" },
] as const;

const findingChips = [
  "evidence · 3 calls",
  "trace · verified",
  "metadata only",
] as const;

export function HomeReviewPreview(): React.ReactElement {
  return (
    <div
      aria-hidden="true"
      className="home-preview relative isolate mx-auto w-full min-w-0 max-w-[34rem] lg:mx-0 lg:max-w-none"
    >
      <div className="home-preview__glow" />

      <div className="relative overflow-hidden rounded-[1.5rem] border border-cyan-200/18 bg-[var(--rr-surface-panel)] shadow-[inset_0_1px_0_rgba(103,232,249,0.1),0_0_90px_-46px_rgba(0,240,255,0.95)]">
        <div className="flex min-w-0 items-center gap-2.5 border-b border-cyan-200/12 px-4 py-3">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-fuchsia-400/80 shadow-[0_0_10px_rgba(217,70,239,0.7)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80 shadow-[0_0_10px_rgba(252,211,77,0.7)]" />
            <span className="h-2.5 w-2.5 rounded-full bg-lime-300/80 shadow-[0_0_10px_rgba(190,242,100,0.7)]" />
          </span>
          <span className="min-w-0 truncate font-mono text-[0.66rem] uppercase tracking-[0.16em] text-slate-400">
            pull request #42 · managed-review-v2-workflow-inventory.ts
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-lime-300/35 bg-lime-300/[0.08] px-2.5 py-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-lime-200">
            <span className="h-1.5 w-1.5 rounded-full bg-lime-300 shadow-[0_0_8px_rgba(190,242,100,0.9)]" />
            checks passed
          </span>
        </div>

        <div className="grid gap-1 px-4 py-4 font-mono text-[0.72rem] leading-6">
          {diffLines.map((line) => (
            <span
              key={line.text}
              className={
                line.tone === "added"
                  ? "rounded bg-lime-300/[0.09] px-2 text-lime-100"
                  : line.tone === "removed"
                    ? "rounded bg-red-400/[0.08] px-2 text-red-200 line-through decoration-red-300/40"
                    : "px-2 text-slate-400"
              }
            >
              {line.text}
            </span>
          ))}
        </div>

        <div className="mx-4 mb-4 rounded-2xl border border-cyan-200/14 bg-cyan-300/[0.05] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-amber-300/[0.08] px-2.5 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-amber-100">
              P1 · correctness
            </span>
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.16em] text-slate-500">
              ReviewRouter review
            </span>
          </div>
          <p className="mt-2.5 text-sm font-semibold leading-6 text-cyan-50">
            Retry window can drop coverage when the PR merges mid-scan.
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Re-check the reference after the merge commit resolves, then pin the
            inventory hash before publishing findings.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {findingChips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-cyan-200/16 bg-white/[0.03] px-2.5 py-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-cyan-100"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className="home-preview__scan" />
      </div>

      <div className="home-preview__float home-preview__float--top absolute -top-4 right-4 hidden items-center gap-2 rounded-full border border-cyan-200/25 bg-[var(--rr-surface-card-strong)] px-3 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-cyan-100 shadow-[0_18px_40px_-28px_rgba(0,240,255,0.9)] sm:inline-flex">
        metadata-only access
      </div>
      <div className="home-preview__float home-preview__float--bottom absolute -bottom-4 left-4 hidden items-center gap-2 rounded-full border border-lime-300/30 bg-[var(--rr-surface-card-strong)] px-3 py-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.12em] text-lime-100 shadow-[0_18px_40px_-28px_rgba(163,230,53,0.9)] sm:inline-flex">
        runs in your CI
      </div>
    </div>
  );
}
