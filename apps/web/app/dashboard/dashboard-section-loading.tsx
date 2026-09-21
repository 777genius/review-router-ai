export function DashboardSectionLoading(): React.ReactElement {
  return (
    <div
      id="dashboard-section-content"
      className="min-w-0 space-y-5 scroll-mt-28"
      aria-busy="true"
      aria-label="Loading dashboard section"
    >
      <DashboardSectionHeaderSkeleton />
      <DashboardSectionBodySkeleton />
    </div>
  );
}

function DashboardSectionHeaderSkeleton(): React.ReactElement {
  return (
    <section className="rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/60 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <SkeletonText className="h-3 w-36" />
      <SkeletonText className="mt-3 h-8 w-56 max-w-full" />
      <SkeletonText className="mt-3 h-4 w-[32rem] max-w-full" />
      <div className="mt-4 flex flex-wrap gap-2">
        <SkeletonBlock className="h-7 w-24 rounded-full" />
        <SkeletonBlock className="h-7 w-32 rounded-full" />
      </div>
    </section>
  );
}

function DashboardSectionBodySkeleton(): React.ReactElement {
  return (
    <section className="rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/62 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:p-6">
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SkeletonText className="h-3 w-28" />
          <SkeletonBlock className="h-8 w-32 rounded-full" />
        </div>
        <SkeletonBlock className="h-12 w-full rounded-2xl" />
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBlock key={index} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </section>
  );
}

function SkeletonText({
  className,
}: {
  readonly className: string;
}): React.ReactElement {
  return (
    <div
      className={[
        "animate-pulse rounded-full bg-slate-700/55 shadow-[0_0_32px_-24px_rgba(103,232,249,0.8)]",
        className,
      ].join(" ")}
    />
  );
}

function SkeletonBlock({
  className,
}: {
  readonly className: string;
}): React.ReactElement {
  return (
    <div
      className={[
        "animate-pulse bg-slate-800/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),0_0_36px_-30px_rgba(103,232,249,0.9)]",
        className,
      ].join(" ")}
    />
  );
}
