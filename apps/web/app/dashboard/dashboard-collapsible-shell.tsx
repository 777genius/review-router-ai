"use client";

import type { ReactElement, ReactNode } from "react";

export function DashboardCollapsibleShell({
  children,
  nav,
}: {
  readonly children: ReactNode;
  readonly nav: ReactNode;
}): ReactElement {
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div id="dashboard-section-sidebar" className="min-w-0 lg:self-start">
        {nav}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
