"use client";

import Link from "next/link";

import { useEffect, useMemo, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { GitHubAccountAvatar } from "../github-account-avatar";
import { useNavigationFeedback } from "../navigation-feedback";
import { dashboardClientNavigationHref } from "./dashboard-section";

export type DashboardWorkspaceTabItem = {
  readonly id: string;
  readonly label: string;
  readonly avatarUrl?: string | null;
  readonly repositoryCount?: number;
  readonly statusLabel?: string;
  readonly href: string;
};

export type DashboardPendingWorkspaceTabItem = {
  readonly id: string;
  readonly label: string;
  readonly avatarUrl?: string | null;
  readonly repositoryCount?: number;
  readonly href: string;
  readonly statusLabel: string;
};

export const workspaceAddTabClass =
  "inline-flex min-h-12 w-auto shrink-0 items-center gap-2 rounded-lg border border-dashed border-white/[0.16] px-3 py-2.5 text-sm font-semibold text-slate-200 transition duration-200 ease-out hover:saturate-125 hover:border-cyan-200/45 hover:bg-white/[0.07] hover:text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200";

export function DashboardWorkspaceTabs({
  items,
  selectedWorkspaceId,
  pendingInstallRequest,
  addWorkspace,
}: {
  readonly items: readonly DashboardWorkspaceTabItem[];
  readonly selectedWorkspaceId: string;
  readonly pendingInstallRequest?: DashboardPendingWorkspaceTabItem | null;
  readonly addWorkspace?: React.ReactNode;
}): React.ReactElement {
  const { startNavigation } = useNavigationFeedback();
  const [showPendingRequest, setShowPendingRequest] = useState(false);
  const activeLabels = useMemo(
    () => new Set(items.map((item) => item.label.toLowerCase())),
    [items],
  );
  const visibleItems =
    showPendingRequest &&
    pendingInstallRequest &&
    !activeLabels.has(pendingInstallRequest.label.toLowerCase())
      ? [...items, pendingInstallRequest]
      : items;

  useEffect(() => {
    if (!pendingInstallRequest) return;
    if (!isLikelyGitHubRedirect()) return;
    if (activeLabels.has(pendingInstallRequest.label.toLowerCase())) return;

    const key = `reviewrouter:github-app-request-tab:${pendingInstallRequest.label}`;
    try {
      if (window.sessionStorage.getItem(key) === "1") return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage can be blocked. Keep this page render ephemeral.
    }

    setShowPendingRequest(true);
  }, [activeLabels, pendingInstallRequest]);

  return (
    <Tabs.Root
      value={selectedWorkspaceId}
      className="flex items-stretch gap-2 overflow-x-auto overflow-y-hidden pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <Tabs.List
        aria-label="Workspace"
        activateOnFocus
        className="flex shrink-0 items-stretch gap-1 border-b border-white/[0.10]"
      >
        {visibleItems.map((item) => {
          const href = dashboardClientNavigationHref(item.href);
          return (
            <Tabs.Tab
              key={item.id}
              value={item.id}
              nativeButton={false}
              render={
                <Link
                  href={href}
                  scroll={false}
                  data-navigation-feedback="ignore"
                  onNavigate={() => startNavigation(href)}
                  aria-current={
                    selectedWorkspaceId === item.id ? "page" : undefined
                  }
                />
              }
              className={({ active }) =>
                [
                  "group relative -mb-px inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 pb-2.5 pt-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200",
                  active
                    ? "border-cyan-300/80 text-cyan-50"
                    : "border-transparent text-slate-300 hover:border-white/30 hover:text-cyan-100",
                ].join(" ")
              }
            >
              <GitHubAccountAvatar
                avatarUrl={item.avatarUrl}
                login={item.label}
                size="sm"
                className="-my-1"
              />
              <span>{item.label}</span>
              <span
                className={[
                  "font-mono text-xs group-hover:text-slate-300 group-data-[active]:text-cyan-100/80",
                  item.statusLabel ? "text-amber-200/85" : "text-slate-500",
                ].join(" ")}
              >
                {item.statusLabel ?? `${item.repositoryCount ?? 0} repos`}
              </span>
            </Tabs.Tab>
          );
        })}
      </Tabs.List>
      {addWorkspace}
    </Tabs.Root>
  );
}

function isLikelyGitHubRedirect(): boolean {
  try {
    const referrer = new URL(document.referrer);
    return (
      referrer.hostname === "github.com" ||
      referrer.hostname.endsWith(".github.com")
    );
  } catch {
    return false;
  }
}
