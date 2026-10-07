import { Badge } from "@reviewrouter/ui";
import { GitHubAccountAvatar } from "../github-account-avatar";
import { GitLabBetaConnectButton } from "../gitlab-beta-connect-button";
import {
  SourceProviderLabel,
  SourceProviderLogo,
} from "../source-provider-logo";
import { FormSubmitButton } from "../form-submit-button";
import { DashboardActionForm } from "./dashboard-action-form";
import { requestInstallationSyncClientAction } from "./actions";
import { dashboardSectionHref } from "./dashboard-section";
import { formatAccountTypeLabel } from "./dashboard-copy";

export type WorkspaceSourceInstallation = {
  readonly accountLogin: string;
  readonly accountType: string;
  readonly accountAvatarUrl: string | null;
  readonly githubInstallationId: string;
  readonly status: string;
  readonly repositorySelection: string;
};

export type WorkspaceGitLabInstallation = {
  readonly id: string;
  readonly namespacePath: string;
  readonly sourceKind: string;
  readonly status: string;
  readonly selectedProjects: number;
};

export type WorkspaceSourceRepository = {
  readonly selected: boolean;
  readonly fullName: string;
};

export function WorkspaceSourceConnectionPanel({
  workspaceId,
  workspaceKey,
  installations,
  gitLabInstallations,
  repositories,
  hasWorkspaceWideAccess,
  mutationsEnabled,
}: {
  readonly workspaceId: string;
  readonly workspaceKey: string;
  readonly installations: readonly WorkspaceSourceInstallation[];
  readonly gitLabInstallations: readonly WorkspaceGitLabInstallation[];
  readonly repositories: readonly WorkspaceSourceRepository[];
  readonly hasWorkspaceWideAccess: boolean;
  readonly mutationsEnabled: boolean;
}): React.ReactElement {
  const visibleInstallations = dedupeGitHubInstallations(installations);
  const connectedCount =
    visibleInstallations.length + gitLabInstallations.length;
  const addSourceOpen = connectedCount === 0;

  return (
    <details
      {...(addSourceOpen ? { open: true } : {})}
      className="group rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
    >
      <summary className="cursor-pointer list-none rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-300/40">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Badge tone="accent">Repository sources</Badge>
            <p className="mt-2 truncate text-sm text-slate-400">
              {sourceSummary(visibleInstallations, gitLabInstallations)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-cyan-100">
              {connectedCount} connected
            </span>
            <span className="rounded-full border border-cyan-200/20 px-3 py-1.5 text-xs font-semibold text-cyan-100">
              <span className="group-open:hidden">Manage</span>
              <span className="hidden group-open:inline">Hide</span>
            </span>
          </div>
        </div>
      </summary>

      <p className="mt-5 border-t border-cyan-200/10 pt-5 text-sm leading-6 text-slate-400">
        Repositories come from the GitHub App or GitLab connection shown here.
        ChatGPT logins used to run reviews are managed under{" "}
        <a
          href={dashboardSectionHref("setup", workspaceKey)}
          className="text-cyan-100 underline decoration-cyan-300/40 underline-offset-4"
        >
          Accounts
        </a>
        .
      </p>

      {visibleInstallations.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibleInstallations.map((installation) => (
            <GitHubInstallCard
              key={`${workspaceId}-${installation.githubInstallationId}`}
              workspaceId={workspaceId}
              installation={installation}
              repositories={repositories}
              hasWorkspaceWideAccess={hasWorkspaceWideAccess}
              mutationsEnabled={mutationsEnabled}
            />
          ))}
        </div>
      ) : null}

      {gitLabInstallations.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {gitLabInstallations.map((installation) => (
            <GitLabInstallCard
              key={installation.id}
              installation={installation}
            />
          ))}
        </div>
      ) : null}

      <details
        {...(addSourceOpen ? { open: true } : {})}
        className="mt-5 rounded-2xl border border-cyan-200/10 bg-slate-950/55 p-4"
      >
        <summary className="cursor-pointer list-none text-sm font-semibold text-cyan-50">
          Connect another GitHub or GitLab source
        </summary>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-cyan-200/10 bg-cyan-300/[0.04] p-4 text-sm leading-6 text-slate-300">
            <p className="inline-flex items-center gap-2 font-semibold text-cyan-50">
              <SourceProviderLogo provider="github" className="h-4 w-4" />
              Another GitHub user or organization
            </p>
            <p className="mt-1">
              Install the GitHub App on that username or organization. Each
              install becomes a separate workspace in the left switcher.
            </p>
          </div>
          <div className="rounded-2xl border border-orange-300/20 bg-orange-300/[0.045] p-4 text-sm leading-6 text-slate-300">
            <p className="inline-flex items-center gap-2 font-semibold text-cyan-50">
              <SourceProviderLogo provider="gitlab" className="h-4 w-4" />
              GitLab group or project
            </p>
            <p className="mt-1">
              GitLab setup is in development and not available yet. ReviewRouter
              will keep GitLab tokens in GitLab CI/CD variables, not in the
              dashboard.
            </p>
            <GitLabBetaConnectButton
              size="sm"
              className="mt-3 border-orange-300/35"
            />
          </div>
        </div>
      </details>
    </details>
  );
}

function dedupeGitHubInstallations(
  installations: readonly WorkspaceSourceInstallation[],
): readonly WorkspaceSourceInstallation[] {
  const byAccount = new Map<string, WorkspaceSourceInstallation>();
  for (const installation of installations) {
    const key =
      `${installation.accountType}:${installation.accountLogin}`.toLowerCase();
    const current = byAccount.get(key);
    if (
      !current ||
      compareInstallationIds(
        installation.githubInstallationId,
        current.githubInstallationId,
      ) > 0
    ) {
      byAccount.set(key, installation);
    }
  }
  return [...byAccount.values()];
}

function compareInstallationIds(left: string, right: string): number {
  if (/^[0-9]+$/u.test(left) && /^[0-9]+$/u.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId === rightId ? 0 : leftId > rightId ? 1 : -1;
  }
  return left.localeCompare(right);
}

function sourceSummary(
  installations: readonly WorkspaceSourceInstallation[],
  gitLabInstallations: readonly WorkspaceGitLabInstallation[],
): string {
  const sources = [
    ...installations.map(
      (installation) => `GitHub: ${installation.accountLogin}`,
    ),
    ...gitLabInstallations.map(
      (installation) => `GitLab: ${installation.namespacePath}`,
    ),
  ];
  return sources.length > 0 ? sources.join(" / ") : "Connect GitHub or GitLab";
}

function GitHubInstallCard({
  workspaceId,
  installation,
  repositories,
  hasWorkspaceWideAccess,
  mutationsEnabled,
}: {
  readonly workspaceId: string;
  readonly installation: WorkspaceSourceInstallation;
  readonly repositories: readonly WorkspaceSourceRepository[];
  readonly hasWorkspaceWideAccess: boolean;
  readonly mutationsEnabled: boolean;
}): React.ReactElement {
  const selectedRepositories = repositories
    .filter(
      (repository) =>
        repository.selected &&
        repository.fullName.startsWith(`${installation.accountLogin}/`),
    )
    .map((repository) => repository.fullName);
  const visibleSelectedRepositories = selectedRepositories.slice(0, 6);
  const hiddenSelectedRepositoryCount =
    selectedRepositories.length - visibleSelectedRepositories.length;

  return (
    <div className="grid gap-4 rounded-2xl border border-cyan-200/10 bg-cyan-300/[0.04] p-4">
      <div className="flex min-w-0 items-center gap-3">
        <GitHubAccountAvatar
          avatarUrl={installation.accountAvatarUrl}
          login={installation.accountLogin}
          size="sm"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-cyan-50">
            {installation.accountLogin}
          </p>
          <p className="inline-flex flex-wrap items-center gap-1.5 text-xs uppercase tracking-[0.16em] text-slate-400">
            <SourceProviderLabel
              provider="github"
              label="GitHub"
              className="inline-flex items-center gap-1.5"
              logoClassName="h-3.5 w-3.5"
            />
            <span>/</span>
            {formatAccountTypeLabel(installation.accountType)} <span>/</span>
            {installation.status} / {installation.repositorySelection}
          </p>
        </div>
      </div>
      {installation.accountType === "Organization" ? (
        <div className="rounded-xl border border-cyan-200/10 bg-slate-950/55 p-3">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-cyan-100/70">
            Selected repositories
          </p>
          {installation.repositorySelection === "all" ? (
            <p className="mt-2 text-xs leading-5 text-slate-300">
              All organization repositories are available. Setup and secrets
              still apply only to the repository you choose.
            </p>
          ) : visibleSelectedRepositories.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleSelectedRepositories.map((repositoryFullName) => (
                <span
                  key={repositoryFullName}
                  className="rounded-full border border-cyan-300/15 bg-cyan-300/[0.08] px-2.5 py-1 text-[0.7rem] font-semibold text-cyan-50"
                >
                  {repositoryFullName}
                </span>
              ))}
              {hiddenSelectedRepositoryCount > 0 ? (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[0.7rem] font-semibold text-slate-300">
                  +{hiddenSelectedRepositoryCount} more
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-slate-300">
              Refresh repositories to show the exact selected repository list if
              the GitHub webhook has not synced it yet.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-cyan-200/10 bg-slate-950/55 p-3">
          <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-cyan-100/70">
            Personal repositories
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-300">
            This install belongs to your personal GitHub account. Use repository
            Actions secrets for provider credentials.
          </p>
        </div>
      )}
      {hasWorkspaceWideAccess ? (
        <DashboardActionForm
          action={requestInstallationSyncClientAction}
          fallbackParams={{
            error: "dashboard_action_failed",
            workspace: workspaceId,
            section: "repositories",
          }}
          refresh={false}
        >
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input
            type="hidden"
            name="githubInstallationId"
            value={installation.githubInstallationId}
          />
          <FormSubmitButton
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={!mutationsEnabled || installation.status !== "active"}
            idleLabel="Refresh repos"
            pendingLabel="Refreshing..."
          />
        </DashboardActionForm>
      ) : (
        <p className="rounded-xl border border-cyan-200/10 bg-slate-950/55 p-3 text-xs leading-5 text-slate-400">
          You can manage repositories where your GitHub role has write,
          maintain, or admin access. Workspace sync and organization-wide
          controls are available to workspace owners and admins.
        </p>
      )}
    </div>
  );
}

function GitLabInstallCard({
  installation,
}: {
  readonly installation: WorkspaceGitLabInstallation;
}): React.ReactElement {
  return (
    <div className="grid gap-4 rounded-2xl border border-cyan-200/10 bg-cyan-300/[0.04] p-4">
      <div>
        <p className="truncate text-sm font-semibold text-cyan-50">
          {installation.namespacePath}
        </p>
        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">
          GitLab {installation.sourceKind} / {installation.status}
        </p>
      </div>
      <div className="rounded-xl border border-cyan-200/10 bg-slate-950/55 p-3">
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-cyan-100/70">
          Selected projects
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-300">
          {installation.selectedProjects} project
          {installation.selectedProjects === 1 ? "" : "s"} selected. GitLab
          token and Codex auth are not stored in ReviewRouter.
        </p>
      </div>
      <GitLabBetaConnectButton
        label="Add GitLab repos"
        size="sm"
        className="w-fit rounded-xl"
      />
    </div>
  );
}
