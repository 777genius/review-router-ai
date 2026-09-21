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
import { DashboardCollapsibleShell } from "./dashboard-collapsible-shell";
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
  const params: Record<string, string> = {};
  // Match the server's first-value semantics for repeated query parameters.
  searchParams.forEach((value, key) => {
    if (!(key in params)) params[key] = value;
  });
  const selectedSection =
    pathname === "/dashboard/setup" ? "setup" : resolveDashboardSection(params);
  const selectedWorkspace =
    workspaces.length > 0
      ? selectDashboardWorkspace(
          workspaces,
          params.workspace ?? "",
          params.installation_id ?? "",
        )
      : null;

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
              params,
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
              {children}
            </DashboardCollapsibleShell>
          </section>
        </main>
      ) : (
        children
      )}
    </DashboardShellContext.Provider>
  );
}
