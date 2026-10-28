import type { ProviderCredentialKind } from "./workspace-provider-profile";

export type WorkspaceMemberRole = "owner" | "admin" | "member";

/**
 * Repository capabilities as the dashboard verifies them: `repo_manager` is
 * write and above, `direct_config` is maintain and above (and implies
 * `repo_manager`). The caller passes the highest one the actor holds.
 */
export type ProviderRepositoryCapability = "repo_manager" | "direct_config";

export type ProviderManagementActor = Readonly<{
  userId: string;
  /** Effective workspace role; null for a non-member. */
  role: WorkspaceMemberRole | null;
}>;

export type ProviderManagementWorkspace = Readonly<{
  /** Set for a personal workspace; its owner alone manages personal bindings. */
  personalOwnerUserId: string | null;
  /** Access rights: only owners and admins manage providers and selections. */
  providerManagementAdminOnly: boolean;
}>;

export type ProviderRepositoryFacts = Readonly<{
  repositoryId: string;
  capability: ProviderRepositoryCapability | null;
}>;

export type ProviderProfileFacts = Readonly<{
  credentialKind: ProviderCredentialKind;
  createdByUserId: string | null;
  /** A gateway binding whose account belongs to a user, not the workspace. */
  personalBinding: boolean;
  /** The only repository a rotating profile can serve. */
  repositoryId: string | null;
}>;

export type ProviderManagementAction =
  /** Created from the Providers list, without attaching it anywhere. */
  | Readonly<{
      kind: "create_profile";
      profile: Omit<ProviderProfileFacts, "createdByUserId">;
    }>
  /**
   * Created inside an attach flow for one repository: one decision for both,
   * so a refused attach never leaves a profile in the workspace list.
   */
  | Readonly<{
      kind: "create_and_attach";
      profile: Omit<ProviderProfileFacts, "createdByUserId">;
      repository: ProviderRepositoryFacts;
      managedKeyApplied?: boolean;
    }>
  | Readonly<{ kind: "edit_profile"; profile: ProviderProfileFacts }>
  | Readonly<{ kind: "archive_profile"; profile: ProviderProfileFacts }>
  | Readonly<{
      kind: "attach_profile";
      profile: ProviderProfileFacts;
      repository: ProviderRepositoryFacts;
      /** Managed keys only: the key is already applied to the repository. */
      managedKeyApplied?: boolean;
    }>
  | Readonly<{ kind: "clear_selection"; repository: ProviderRepositoryFacts }>
  | Readonly<{ kind: "set_default"; profile: ProviderProfileFacts }>
  | Readonly<{ kind: "clear_default" }>
  | Readonly<{ kind: "manage_managed_key" }>
  | Readonly<{ kind: "install_ci_secret"; repository: ProviderRepositoryFacts }>
  | Readonly<{ kind: "change_access_rights" }>;

export type ProviderManagementDenialReason =
  | "workspace_member_required"
  | "workspace_admin_required"
  | "access_rights_admin_only"
  | "personal_binding_owner_required"
  | "profile_creator_required"
  | "repository_direct_config_required"
  | "repository_manager_required"
  | "rotating_profile_repository_only"
  | "rotating_profile_not_default";

export type ProviderManagementDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: ProviderManagementDenialReason;
    };

export class ProviderManagementDeniedError extends Error {
  constructor(readonly reason: ProviderManagementDenialReason) {
    super(`provider_management_forbidden:${reason}`);
    this.name = "ProviderManagementDeniedError";
  }
}

const allowed: ProviderManagementDecision = { allowed: true };
const denied = (
  reason: ProviderManagementDenialReason,
): ProviderManagementDecision => ({ allowed: false, reason });

/**
 * The single permission decision for provider profiles and selections. Pure:
 * callers supply verified facts (role, repository capability, binding owner)
 * and every denial carries a reason the UI can show on a disabled control.
 * Authority checks of the write paths (personal actor locks, gateway fences,
 * entitlements) still run independently at save and admission.
 */
export function decideProviderManagement(input: {
  readonly actor: ProviderManagementActor;
  readonly workspace: ProviderManagementWorkspace;
  readonly action: ProviderManagementAction;
}): ProviderManagementDecision {
  const { actor, workspace, action } = input;
  const admin = actor.role === "owner" || actor.role === "admin";
  const adminOnly = workspace.providerManagementAdminOnly && !admin;
  const personalOwner = (profile: { readonly personalBinding: boolean }) =>
    !profile.personalBinding ||
    (workspace.personalOwnerUserId !== null
      ? workspace.personalOwnerUserId === actor.userId
      : admin);
  const directConfig = (repository: ProviderRepositoryFacts) =>
    admin || repository.capability === "direct_config";

  const attach = (
    profile: Omit<ProviderProfileFacts, "createdByUserId">,
    repository: ProviderRepositoryFacts,
    managedKeyApplied: boolean | undefined,
  ): ProviderManagementDecision => {
    if (adminOnly) return denied("access_rights_admin_only");
    if (!personalOwner(profile))
      return denied("personal_binding_owner_required");
    if (
      profile.credentialKind === "repository_rotating" &&
      profile.repositoryId !== repository.repositoryId
    )
      return denied("rotating_profile_repository_only");
    // Hosted pool and applying a managed key keep their admin-only flows.
    if (
      profile.credentialKind === "hosted_pool" ||
      (profile.credentialKind === "managed_api_key" &&
        managedKeyApplied !== true)
    )
      return admin ? allowed : denied("workspace_admin_required");
    return directConfig(repository)
      ? allowed
      : denied("repository_direct_config_required");
  };

  switch (action.kind) {
    case "create_profile": {
      if (actor.role === null) return denied("workspace_member_required");
      if (adminOnly) return denied("access_rights_admin_only");
      if (!personalOwner(action.profile))
        return denied("personal_binding_owner_required");
      // A rotating credential exists only inside its repository's attach flow.
      if (action.profile.credentialKind === "repository_rotating")
        return denied("rotating_profile_repository_only");
      return admin ? allowed : denied("workspace_admin_required");
    }
    case "create_and_attach":
      if (actor.role === null) return denied("workspace_member_required");
      return attach(
        action.profile,
        action.repository,
        action.managedKeyApplied,
      );
    case "edit_profile":
    case "archive_profile": {
      if (actor.role === null) return denied("workspace_member_required");
      if (adminOnly) return denied("access_rights_admin_only");
      if (action.kind === "edit_profile" && !personalOwner(action.profile))
        return denied("personal_binding_owner_required");
      return admin || action.profile.createdByUserId === actor.userId
        ? allowed
        : denied("profile_creator_required");
    }
    case "attach_profile":
      return attach(
        action.profile,
        action.repository,
        action.managedKeyApplied,
      );
    case "clear_selection":
      if (adminOnly) return denied("access_rights_admin_only");
      return directConfig(action.repository)
        ? allowed
        : denied("repository_direct_config_required");
    case "set_default":
      if (!admin) return denied("workspace_admin_required");
      if (action.profile.credentialKind === "repository_rotating")
        return denied("rotating_profile_not_default");
      return personalOwner(action.profile)
        ? allowed
        : denied("personal_binding_owner_required");
    case "install_ci_secret":
      return admin || action.repository.capability !== null
        ? allowed
        : denied("repository_manager_required");
    case "clear_default":
    case "manage_managed_key":
    case "change_access_rights":
      return admin ? allowed : denied("workspace_admin_required");
  }
}

/**
 * The part of an edit, rename or archive decision that does not depend on the
 * profile. Checked before the profile is read, so neither a non-member nor a
 * member under admin-only access rights learns whether a profile ID exists.
 */
export function decideProviderProfileManagementGate(input: {
  readonly actor: ProviderManagementActor;
  readonly workspace: ProviderManagementWorkspace;
}): ProviderManagementDecision {
  const admin = input.actor.role === "owner" || input.actor.role === "admin";
  if (input.actor.role === null) return denied("workspace_member_required");
  if (input.workspace.providerManagementAdminOnly && !admin)
    return denied("access_rights_admin_only");
  return allowed;
}

export function assertProviderManagementAllowed(
  input: Parameters<typeof decideProviderManagement>[0],
): void {
  const decision = decideProviderManagement(input);
  if (!decision.allowed)
    throw new ProviderManagementDeniedError(decision.reason);
}
