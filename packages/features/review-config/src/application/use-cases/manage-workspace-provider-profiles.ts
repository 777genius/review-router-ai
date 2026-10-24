import {
  assertProviderManagementAllowed,
  type ProviderRepositoryFacts,
} from "../../domain/provider-management-policy";
import {
  parseProviderProfileDraft,
  parseProviderProfileLabel,
  type WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";
import type {
  ProviderProfileActor,
  WorkspaceProviderProfileRepositoryPort,
} from "../ports/workspace-provider-profile-repository-port";

type Dependencies = Readonly<{
  profiles: WorkspaceProviderProfileRepositoryPort;
}>;

/**
 * Registers a provider in the workspace list, or returns the existing one with
 * the same credential source and model. Never changes the workspace default.
 */
export function createWorkspaceProviderProfile(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    credential: unknown;
    model: unknown;
    label?: unknown;
    /** Present when the profile is created while attaching it to a repository. */
    repository?: ProviderRepositoryFacts;
  }>,
  dependencies: Dependencies,
): Promise<Readonly<{ profile: WorkspaceProviderProfile; created: boolean }>> {
  const draft = parseProviderProfileDraft(input);
  const repository = input.repository;
  return dependencies.profiles.findOrCreate({
    workspaceId: input.workspaceId,
    actor: input.actor,
    ...draft,
    ...(repository ? { repository } : {}),
    authorize: (facts) =>
      assertProviderManagementAllowed({
        actor: facts.actor,
        workspace: facts.workspace,
        action: {
          kind: "create_profile",
          profile: facts.profile,
          ...(repository ? { repository } : {}),
        },
      }),
  });
}

/** A label edit applies to every repository using the profile at once. */
export function renameWorkspaceProviderProfile(
  input: Readonly<{
    workspaceId: string;
    profileId: string;
    actor: ProviderProfileActor;
    label: unknown;
  }>,
  dependencies: Dependencies,
): Promise<WorkspaceProviderProfile> {
  return dependencies.profiles.rename({
    workspaceId: input.workspaceId,
    profileId: input.profileId,
    actor: input.actor,
    label: parseProviderProfileLabel(input.label),
    authorize: (facts) =>
      assertProviderManagementAllowed({
        actor: facts.actor,
        workspace: facts.workspace,
        action: { kind: "edit_profile", profile: facts.profile },
      }),
  });
}

/** The workspace list without usage counts; callers authorize the read. */
export function listWorkspaceProviderProfiles(
  workspaceId: string,
  dependencies: Dependencies,
): Promise<readonly WorkspaceProviderProfile[]> {
  return dependencies.profiles.list(workspaceId);
}
