import {
  assertProviderManagementAllowed,
  decideProviderProfileManagementGate,
  ProviderManagementDeniedError,
} from "../../domain/provider-management-policy";
import {
  parseProviderProfileDraft,
  parseProviderProfileLabel,
  providerProfileModelSchema,
  ProviderProfileError,
  type ProviderProfileUsage,
  type WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";
import type {
  ProviderManagementFacts,
  ProviderProfileActor,
  ProviderProfileGateFacts,
  ProviderProfileModelChangeScope,
  WorkspaceProviderProfileRepositoryPort,
} from "../ports/workspace-provider-profile-repository-port";

type Dependencies = Readonly<{
  profiles: WorkspaceProviderProfileRepositoryPort;
}>;

/**
 * Checks of a model edit the caller owns, such as the Gateway catalog:
 * `beforeTransaction` may use the network, `scope` runs per affected scope
 * inside the write and must not. Both are required: a model edit changes
 * every scope using the profile, so none may skip the save-time rules.
 */
export type ProviderProfileModelChangeValidator = Readonly<{
  beforeTransaction: (input: {
    readonly profile: WorkspaceProviderProfile;
    readonly model: string;
  }) => Promise<void>;
  scope: (scope: ProviderProfileModelChangeScope) => void;
}>;

/**
 * Registers a provider in the workspace list from the Providers list, or
 * returns the existing one with the same credential source and model. Never
 * changes the workspace default; a profile created while attaching it to a
 * repository is decided together with that attach by the selection write.
 */
export function createWorkspaceProviderProfile(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    credential: unknown;
    model: unknown;
    label?: unknown;
  }>,
  dependencies: Dependencies,
): Promise<Readonly<{ profile: WorkspaceProviderProfile; created: boolean }>> {
  const draft = parseProviderProfileDraft(input);
  return dependencies.profiles.findOrCreate({
    workspaceId: input.workspaceId,
    actor: input.actor,
    ...draft,
    authorize: (facts) =>
      assertProviderManagementAllowed({
        actor: facts.actor,
        workspace: facts.workspace,
        action: { kind: "create_profile", profile: facts.profile },
      }),
  });
}

/**
 * Access rights: whether only owners and admins manage provider profiles and
 * selections. Only owners and admins change it.
 */
export function changeProviderAccessRights(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    adminOnly: boolean;
    auditMetadata?: Readonly<Record<string, unknown>>;
  }>,
  dependencies: Dependencies,
): Promise<Readonly<{ adminOnly: boolean; previous: boolean }>> {
  return dependencies.profiles.changeAccessRights({
    ...input,
    authorize: (facts) =>
      assertProviderManagementAllowed({
        actor: facts.actor,
        workspace: facts.workspace,
        action: { kind: "change_access_rights" },
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
    gate: assertProfileGate,
    authorize: (facts) =>
      assertProviderManagementAllowed({
        actor: facts.actor,
        workspace: facts.workspace,
        action: { kind: "edit_profile", profile: facts.profile },
      }),
  });
}

/**
 * Changes the model of a profile for every scope using it. The credential
 * source and auth mode never change, so neither does the workflow transport.
 */
export async function changeWorkspaceProviderProfileModel(
  input: Readonly<{
    workspaceId: string;
    profileId: string;
    actor: ProviderProfileActor;
    model: unknown;
  }>,
  dependencies: Dependencies &
    Readonly<{ validator: ProviderProfileModelChangeValidator }>,
) {
  const model = providerProfileModelSchema.safeParse(input.model);
  if (!model.success)
    throw new ProviderProfileError("provider_profile_invalid");
  const profile = (await dependencies.profiles.list(input.workspaceId)).find(
    (candidate) => candidate.id === input.profileId,
  );
  // A missing profile is refused by the write with the policy's reason first.
  if (profile)
    await dependencies.validator.beforeTransaction({
      profile,
      model: model.data,
    });
  return dependencies.profiles.changeModel({
    workspaceId: input.workspaceId,
    profileId: input.profileId,
    actor: input.actor,
    model: model.data,
    validateScope: dependencies.validator.scope,
    gate: assertProfileGate,
    authorize: (facts) =>
      assertProviderManagementAllowed({
        actor: facts.actor,
        workspace: facts.workspace,
        action: { kind: "edit_profile", profile: facts.profile },
      }),
  });
}

/** Archives an unused profile; one still selected anywhere is refused. */
export function archiveWorkspaceProviderProfile(
  input: Readonly<{
    workspaceId: string;
    profileId: string;
    actor: ProviderProfileActor;
  }>,
  dependencies: Dependencies,
): Promise<WorkspaceProviderProfile> {
  return dependencies.profiles.archive({
    workspaceId: input.workspaceId,
    profileId: input.profileId,
    actor: input.actor,
    gate: assertProfileGate,
    authorize: (facts) =>
      assertProviderManagementAllowed({
        actor: facts.actor,
        workspace: facts.workspace,
        action: { kind: "archive_profile", profile: facts.profile },
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

/**
 * The facts the provider policy decides with for one signed-in user, for
 * explaining disabled controls; writes decide again under their locks.
 */
export function readProviderManagementFacts(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    bindingIds: readonly string[];
  }>,
  dependencies: Dependencies,
): Promise<ProviderManagementFacts | null> {
  return dependencies.profiles.readManagementFacts(input);
}

/**
 * Which stored documents select each profile, for the Providers list and the
 * Accounts screen; callers authorize the read.
 */
export function listWorkspaceProviderProfileUsage(
  workspaceId: string,
  dependencies: Dependencies,
): Promise<readonly ProviderProfileUsage[]> {
  return dependencies.profiles.listUsage(workspaceId);
}

function assertProfileGate(facts: ProviderProfileGateFacts): void {
  const decision = decideProviderProfileManagementGate(facts);
  if (!decision.allowed)
    throw new ProviderManagementDeniedError(decision.reason);
}
