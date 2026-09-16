import { Badge, LinkButton } from "@reviewrouter/ui";
import { GitHubAccountAvatar } from "../github-account-avatar";
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

export function gitLabSetupHref(input: {
  readonly workspaceId: string;
  readonly installationId?: string;
}): string {
  const query = new URLSearchParams({
    workspaceId: input.workspaceId,
  });
  if (input.installationId) {
    query.set("installationId", input.installationId);
  }
  return `/setup/gitlab?${query.toString()}`;
}

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
  const connectedCount = installations.length + gitLabInstallations.length;
  const addSourceOpen = connectedCount === 0;

  return (
    <section className="rounded-[1.5rem] border border-cyan-200/10 bg-slate-950/60 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <Badge tone="accent">Source of repositories</Badge>
          <h3 className="mt-3 text-lg font-semibold text-cyan-50">
            GitHub and GitLab connection
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            This workspace is attached to a GitHub App install or a GitLab
            group or project. Repositories on this page come from that
            connection. ChatGPT logins used to run reviews are on{" "}
            <a
              href={dashboardSectionHref("setup", workspaceKey)}
              className="text-cyan-100 underline decoration-cyan-300/40 underline-offset-4"
            >
              Accounts
            </a>
            , not here.
          </p>
        </div>
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-cyan-100">
          {connectedCount} connected
        </span>
      </div>

      {installations.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {installations.map((installation) => (
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
              workspaceId={workspaceId}
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
              Connect from a group or project URL. ReviewRouter keeps GitLab
              tokens in GitLab CI/CD variables, not in the dashboard.
            </p>
            <LinkButton
              href={gitLabSetupHref({ workspaceId })}
              variant="outline"
              size="sm"
              className="mt-3 border-orange-300/35"
            >
              <SourceProviderLabel provider="gitlab" label="Connect GitLab" />
            </LinkButton>
          </div>
        </div>
      </details>
    </section>
  );
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
  workspaceId,
  installation,
}: {
  readonly workspaceId: string;
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
      <LinkButton
        href={gitLabSetupHref({
          workspaceId,
          installationId: installation.id,
        })}
        variant="outline"
        size="sm"
        className="w-fit rounded-xl"
      >
        Add GitLab repos
      </LinkButton>
    </div>
  );
}
