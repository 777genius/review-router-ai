import { cache } from "react";
import {
  getDashboardMutationStatus,
  getDashboardSignedInActor,
  getDashboardWorkspaceScope,
} from "./dashboard-mutations";
import {
  listDashboardRepositoryAccess,
  dashboardRepositoryVisibilityChanged,
  normalizeRequestedRepositoryFullName,
} from "./dashboard-repository-access";
import { loadDashboardWorkspaceSummaries } from "./dashboard-workspace-summaries";

const loadDashboardIdentity = cache(async () => {
  const [mutationStatus, workspaceScope, signedInActor] = await Promise.all([
    getDashboardMutationStatus(),
    getDashboardWorkspaceScope(),
    getDashboardSignedInActor(),
  ]);
  return { mutationStatus, workspaceScope, signedInActor };
});

export const loadDashboardBaseShellData = cache(async () => {
  const identity = await loadDashboardIdentity();
  const repositoryAccess = await listDashboardRepositoryAccess({
    actor: identity.signedInActor,
    workspaceScope: identity.workspaceScope,
    requestedRepositoryFullName: "",
  });
  const workspaces = await loadDashboardWorkspaceSummaries(
    identity.workspaceScope,
    repositoryAccess,
  );
  return { ...identity, repositoryAccess, workspaces };
});

export const loadDashboardShellData = cache(
  async (
    requestedRepositoryFullName: string,
    workspaceKey = "",
    installationId = "",
  ) => {
    const base = await loadDashboardBaseShellData();
    const repositoryAccess = normalizeRequestedRepositoryFullName(
      requestedRepositoryFullName,
    )
      ? await listDashboardRepositoryAccess({
          actor: base.signedInActor,
          workspaceScope: base.workspaceScope,
          requestedRepositoryFullName,
          baseAccess: base.repositoryAccess,
        })
      : base.repositoryAccess;
    const summaries = dashboardRepositoryVisibilityChanged(
      base.repositoryAccess,
      repositoryAccess,
    )
      ? await loadDashboardWorkspaceSummaries(
          base.workspaceScope,
          repositoryAccess,
        )
      : base.workspaces;
    // Resolve explicit links independently of the switcher's ten recent entries.
    const requested =
      workspaceKey || installationId
        ? await loadDashboardWorkspaceSummaries(
            base.workspaceScope,
            repositoryAccess,
            { workspaceKey, installationId },
          )
        : [];
    const workspaces = [
      ...new Map(
        [...summaries, ...requested].map((item) => [item.workspace.id, item]),
      ).values(),
    ];
    return { ...base, repositoryAccess, workspaces };
  },
);
