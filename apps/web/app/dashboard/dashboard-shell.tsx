"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { buildPendingOrganizationInstallRequest } from "../../src/server/dashboard-app-install-request";
import { useNavigationFeedback } from "../navigation-feedback";
import { DashboardCollapsibleShell } from "./dashboard-collapsible-shell";
import { DashboardSectionLoading } from "./dashboard-section-loading";
import { resolveDashboardSection } from "./dashboard-section";
import {
  DashboardSectionNav,
  WorkspaceSwitcher,
  dashboardWorkspaceUrlKey,
  selectDashboardWorkspace,
  type DashboardWorkspaceSummary,
} from "./dashboard-workspace-navigation";

const DashboardShellContext = createContext<
  ((workspaces: readonly DashboardWorkspaceSummary[]) => void) | null
>(null);

/** Refresh the persistent layout's summaries after discovery or a server action. */
export function DashboardShellSnapshot({
  workspaces,
}: {
  readonly workspaces: readonly DashboardWorkspaceSummary[];
}): null {
  const update = useContext(DashboardShellContext);
  useEffect(() => {
    update?.(workspaces);
  }, [update, workspaces]);
  return null;
}

export function DashboardShell({
  children,
  workspaces: initialWorkspaces,
  appInstallUrl,
  fallbackUser,
}: {
  readonly children: ReactNode;
  readonly workspaces: readonly DashboardWorkspaceSummary[];
  readonly appInstallUrl: string | null;
  readonly fallbackUser: {
    readonly githubLogin: string | null;
    readonly githubAvatarUrl: string | null;
  };
}): React.ReactElement {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isPending, target } = useNavigationFeedback();
  const params = firstValueParams(searchParams);
  const currentSection = dashboardSection(pathname, params);
  const currentWorkspace =
    workspaces.length > 0
      ? selectDashboardWorkspace(
          workspaces,
          params.workspace ?? "",
          params.installation_id ?? "",
        )
      : null;
  const pendingParams =
    isPending && target && isDashboardPath(target.pathname)
      ? firstValueParams(new URLSearchParams(target.search))
      : null;
  const pendingSection = pendingParams
    ? dashboardSection(target?.pathname ?? pathname, pendingParams)
    : null;
  const pendingWorkspace =
    pendingParams && workspaces.length > 0
      ? selectDashboardWorkspace(
          workspaces,
          pendingParams.workspace ?? "",
          pendingParams.installation_id ?? "",
        )
      : null;
  const isDashboardContentPending = Boolean(
    pendingParams &&
    pendingSection &&
    pendingWorkspace &&
    (pendingSection !== currentSection ||
      pendingWorkspace.workspace.id !== currentWorkspace?.workspace.id),
  );
  const displayedParams =
    isDashboardContentPending && pendingParams ? pendingParams : params;
  const selectedSection = isDashboardContentPending
    ? (pendingSection ?? currentSection)
    : currentSection;
  const selectedWorkspace = isDashboardContentPending
    ? pendingWorkspace
    : currentWorkspace;

  return (
    <DashboardShellContext.Provider value={setWorkspaces}>
      {selectedWorkspace ? (
        <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 md:py-10">
          <DashboardLayoutMetrics workspaceCount={workspaces.length} />
          <WorkspaceSwitcher
            part="intro"
            workspaces={workspaces}
            selectedWorkspaceId={selectedWorkspace.workspace.id}
            selectedSection={selectedSection}
            appInstallUrl={appInstallUrl}
            pendingOrganizationInstallRequest={buildPendingOrganizationInstallRequest(
              displayedParams,
            )}
            fallbackUser={fallbackUser}
          />
          <section id="dashboard-workspace" className="min-w-0">
            <WorkspaceSwitcher
              part="tabs"
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspace.workspace.id}
              selectedSection={selectedSection}
              appInstallUrl={appInstallUrl}
              pendingOrganizationInstallRequest={buildPendingOrganizationInstallRequest(
                displayedParams,
              )}
              fallbackUser={fallbackUser}
            />
            <DashboardCollapsibleShell
              nav={
                <DashboardSectionNav
                  selectedSection={selectedSection}
                  workspaceKey={dashboardWorkspaceUrlKey(
                    selectedWorkspace.workspace,
                    workspaces,
                  )}
                />
              }
            >
              {isDashboardContentPending ? (
                <DashboardSectionLoading />
              ) : (
                children
              )}
            </DashboardCollapsibleShell>
          </section>
        </main>
      ) : (
        children
      )}
    </DashboardShellContext.Provider>
  );
}

function DashboardLayoutMetrics({
  workspaceCount,
}: {
  workspaceCount: number;
}): null {
  useEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>("[data-global-header]");
    const workspaceBar = document.getElementById("dashboard-workspace-bar");
    const compactNav = document.getElementById("dashboard-compact-nav");
    const read = (element: HTMLElement | null) =>
      // Sticky offsets are CSS layout pixels. Viewport rects include CSS zoom,
      // which would apply the scale twice when published back into CSS.
      element ? element.offsetHeight : 0;
    const previousPadding = root.style.scrollPaddingTop;
    const publish = () => {
      root.style.setProperty("--rr-header-height", `${read(header)}px`);
      root.style.setProperty(
        "--rr-workspace-bar-height",
        `${read(workspaceBar)}px`,
      );
      root.style.setProperty(
        "--rr-compact-nav-height",
        `${read(compactNav)}px`,
      );
      root.style.scrollPaddingTop = `${read(header)}px`;
      if (header && read(header) > 0)
        root.dataset.dashboardLayoutReady = "true";
    };
    publish();
    if (typeof ResizeObserver === "undefined")
      return () => {
        delete root.dataset.dashboardLayoutReady;
        root.style.removeProperty("--rr-header-height");
        root.style.removeProperty("--rr-workspace-bar-height");
        root.style.removeProperty("--rr-compact-nav-height");
        root.style.scrollPaddingTop = previousPadding;
      };
    const observer = new ResizeObserver(publish);
    for (const element of [header, workspaceBar, compactNav])
      if (element) observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingTop = previousPadding;
      delete root.dataset.dashboardLayoutReady;
      root.style.removeProperty("--rr-header-height");
      root.style.removeProperty("--rr-workspace-bar-height");
      root.style.removeProperty("--rr-compact-nav-height");
    };
  }, [workspaceCount]);
  return null;
}

function firstValueParams(
  searchParams: URLSearchParams | Readonly<URLSearchParams>,
): Record<string, string> {
  const params: Record<string, string> = {};
  // Match the server's first-value semantics for repeated query parameters.
  searchParams.forEach((value, key) => {
    if (!(key in params)) params[key] = value;
  });
  return params;
}

function dashboardSection(pathname: string, params: Record<string, string>) {
  return pathname === "/dashboard/setup"
    ? ("setup" as const)
    : resolveDashboardSection(params);
}

function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname === "/dashboard/setup";
}
