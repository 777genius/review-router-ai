import {
  dashboardWorkspaceUrlKey,
  type DashboardWorkspace,
  type DashboardWorkspaceSummary,
} from "../../src/server/dashboard-workspace-model";
export {
  filterVisibleDashboardWorkspaces,
  selectDashboardWorkspace,
  dashboardWorkspaceUrlKey,
} from "../../src/server/dashboard-workspace-model";
export type {
  DashboardWorkspace,
  DashboardWorkspaceSummary,
} from "../../src/server/dashboard-workspace-model";
export type { DashboardOrganizationSecretPolicy } from "../../src/server/dashboard-organization-secret-policy";
import type { PendingOrganizationInstallRequest } from "../../src/server/dashboard-app-install-request";
import { ConnectSourceDialog } from "../connect-source-dialog";
import {
  DashboardWorkspaceTabs,
  workspaceAddTabClass,
} from "./dashboard-workspace-tabs";
import {
  DashboardSectionCompactNav,
  DashboardSectionTabs,
} from "./dashboard-section-tabs";
import {
  DASHBOARD_NAV_SECTIONS,
  dashboardSectionHref,
  dashboardSectionMeta,
  type DashboardSection,
} from "./dashboard-section";

function workspaceAvatarUrl(
  workspace: DashboardWorkspace,
  fallbackUser?: {
    readonly githubLogin: string | null;
    readonly githubAvatarUrl: string | null;
  },
): string | null {
  const installationAvatar =
    workspace.installations.find(
      (installation) => installation.status === "active",
    )?.accountAvatarUrl ??
    workspace.installations[0]?.accountAvatarUrl ??
    null;
  if (installationAvatar) return installationAvatar;

  const personalInstallation = workspace.installations.find(
    (installation) =>
      installation.accountType === "User" &&
      installation.accountLogin === fallbackUser?.githubLogin,
  );
  if (personalInstallation && fallbackUser?.githubAvatarUrl) {
    return fallbackUser.githubAvatarUrl;
  }

  return githubAvatarUrlForLogin(workspace.installations[0]?.accountLogin);
}

function githubAvatarUrlForLogin(
  login: string | null | undefined,
): string | null {
  if (!login || !/^[A-Za-z0-9-]+$/.test(login)) {
    return null;
  }

  return `https://github.com/${login}.png?size=64`;
}

export function WorkspaceSwitcher({
  workspaces,
  selectedWorkspaceId,
  selectedSection,
  appInstallUrl,
  pendingOrganizationInstallRequest,
  fallbackUser,
  part = "all",
}: {
  readonly part?: "all" | "intro" | "tabs";
  readonly workspaces: readonly DashboardWorkspaceSummary[];
  readonly selectedWorkspaceId: string;
  readonly selectedSection: DashboardSection;
  readonly appInstallUrl: string | null;
  readonly pendingOrganizationInstallRequest: PendingOrganizationInstallRequest | null;
  readonly fallbackUser: {
    readonly githubLogin: string | null;
    readonly githubAvatarUrl: string | null;
  };
}): React.ReactElement | null {
  if (workspaces.length < 2 && !pendingOrganizationInstallRequest) {
    if (part === "tabs") return null;
    return (
      <section className="py-3">
        <div className="flex justify-end border-b border-cyan-200/15 px-1 pb-px">
          <ConnectSourceDialog
            appInstallUrl={appInstallUrl}
            workspaceId={selectedWorkspaceId}
            triggerLabel="Add workspace"
            triggerVariant="ghost"
            triggerSize="sm"
            triggerClassName={workspaceAddTabClass}
          />
        </div>
      </section>
    );
  }

  const items = workspaces.map((workspace) => {
    const workspaceKey = dashboardWorkspaceUrlKey(
      workspace.workspace,
      workspaces,
    );
    return {
      id: workspace.workspace.id,
      label: workspace.workspace.name,
      avatarUrl: workspaceAvatarUrl(workspace.workspace, fallbackUser),
      repositoryCount: workspace.repositoryCount,
      ...(workspace.hasWorkspaceWideAccess
        ? {}
        : { statusLabel: "Repo access" }),
      href: dashboardSectionHref(
        selectedSection,
        workspaceKey,
        workspace.workspace.id,
      ),
    };
  });
  const pendingTab = pendingOrganizationInstallRequest
    ? {
        id: pendingOrganizationInstallRequest.id,
        label: pendingOrganizationInstallRequest.accountLogin,
        href: dashboardSectionHref(
          selectedSection,
          undefined,
          selectedSection === "context-tools" ? selectedWorkspaceId : undefined,
        ),
        statusLabel: "Request pending",
      }
    : null;

  return (
    <>
      {part !== "intro" && (items.length > 1 || pendingTab) ? (
        <div
          id="dashboard-workspace-bar"
          className="z-30 bg-[var(--rr-page-bg)] pb-3 pt-1"
        >
          <DashboardWorkspaceTabs
            items={items}
            selectedWorkspaceId={selectedWorkspaceId}
            pendingInstallRequest={pendingTab}
            addWorkspace={
              <ConnectSourceDialog
                appInstallUrl={appInstallUrl}
                workspaceId={selectedWorkspaceId}
                triggerLabel="Add workspace"
                triggerVariant="ghost"
                triggerSize="sm"
                triggerClassName={workspaceAddTabClass}
              />
            }
          />
        </div>
      ) : null}
    </>
  );
}

export function DashboardSectionNav({
  selectedSection,
  workspaceKey,
  workspaceId,
}: {
  readonly selectedSection: DashboardSection;
  readonly workspaceKey: string;
  readonly workspaceId?: string;
}): React.ReactElement {
  const items = DASHBOARD_NAV_SECTIONS.map((section) => ({
    section,
    label: dashboardSectionMeta[section].title,
    description: dashboardSectionMeta[section].navDescription,
    href: dashboardSectionHref(section, workspaceKey, workspaceId),
  }));
  const activeSection =
    selectedSection === "setup" ? "providers" : selectedSection;

  return (
    <aside className="min-w-0">
      <DashboardSectionCompactNav
        items={items}
        selectedSection={activeSection}
      />
      <div className="dashboard-section-nav-scroll hidden lg:grid">
        <DashboardSectionTabs items={items} selectedSection={activeSection} />
      </div>
    </aside>
  );
}
