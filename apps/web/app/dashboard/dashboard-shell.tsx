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
          <WorkspaceSwitcher
            workspaces={workspaces}
            selectedWorkspaceId={selectedWorkspace.workspace.id}
            selectedSection={selectedSection}
            appInstallUrl={appInstallUrl}
            pendingOrganizationInstallRequest={buildPendingOrganizationInstallRequest(
              displayedParams,
            )}
            fallbackUser={fallbackUser}
          />
          <section id="dashboard-workspace" className="grid gap-5 scroll-mt-28">
            <DashboardCollapsibleShell
              nav={
                <DashboardSectionNav
                  workspace={selectedWorkspace.workspace}
                  repositoryCount={selectedWorkspace.repositoryCount}
                  selectedSection={selectedSection}
                  workspaceKey={dashboardWorkspaceUrlKey(
                    selectedWorkspace.workspace,
                    workspaces,
                  )}
                  fallbackUser={fallbackUser}
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
