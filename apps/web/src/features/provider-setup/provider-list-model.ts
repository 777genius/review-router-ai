import type { ProviderIdentity } from "./provider-identity";
import {
  decideProviderManagement,
  type ProviderManagementActor,
  type ProviderManagementWorkspace,
} from "@reviewrouter/features-review-config/provider-management-policy";
import type {
  ManagedApiKeyAuthMode,
  ProviderCredentialKind,
  ProviderProfileUsage,
} from "@reviewrouter/features-review-config/workspace-provider-profile";
import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import {
  providerSetupDenialText,
  type ProviderSetupDenialReason,
  type ProviderSetupFacts,
} from "./provider-setup-model";

/**
 * View model of the workspace Providers list. Built on the server from the
 * same facts and the same provider management policy as the provider dialog;
 * the client only renders it, and every write decides again under its locks.
 */

/** Reasons the list adds to the dialog's own reasons. */
export type ProviderListDenialReason =
  | ProviderSetupDenialReason
  | "provider_in_use"
  | "hosted_pool_not_default"
  | "list_add_admin_required";

export type ProviderListDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: ProviderListDenialReason }>;

/** Who added a provider, as the viewer reads it. */
export type ProviderListCreator =
  | Readonly<{ kind: "you" }>
  | Readonly<{ kind: "member"; login: string | null }>
  | Readonly<{ kind: "former_member"; login: string | null }>
  | Readonly<{ kind: "system" }>;

export type ProviderListUsage = Readonly<{
  /** It is the workspace default. */
  workspaceDefault: boolean;
  /** Repositories that chose it themselves, by name. */
  repositories: readonly Readonly<{ id: string; fullName: string }>[];
}>;

export type ProviderListRow = Readonly<{
  id: string;
  label: string;
  model: string;
  providerId?: ProviderIdentity | undefined;
  authMode: ProviderAuthMode;
  credentialKind: ProviderCredentialKind;
  gatewayBindingId: string | null;
  gatewayProfileRef?: string | null;
  /** Connected accounts only. */
  account: Readonly<{
    /** Shown for workspace accounts; a shared personal account stays unnamed. */
    name: string | null;
    personal: boolean;
    available: boolean;
  }> | null;
  /** Rotating Codex only: the one repository it serves. */
  rotatingRepositoryName: string | null;
  isDefault: boolean;
  usage: ProviderListUsage;
  creator: ProviderListCreator;
  actions: Readonly<{
    /** Rename and change the model. */
    edit: ProviderListDecision;
    /** Choose the default, or edit the current default's review settings. */
    makeDefault: ProviderListDecision | null;
    /** Only on the default. */
    removeDefault: ProviderListDecision | null;
    remove: ProviderListDecision;
    /** Only for a key saved by ReviewRouter. */
    replaceKey: ProviderListDecision | null;
  }>;
}>;

export type ProviderListView = Readonly<{
  workspaceId: string;
  viewerIsAdmin: boolean;
  /** Access rights: only owners and admins manage providers. */
  accessRightsAdminOnly: boolean;
  hasDefault: boolean;
  /** Adding a provider from the list (owner/admin). */
  add: ProviderListDecision;
  /** The default first, then in the order they were added. */
  rows: readonly ProviderListRow[];
}>;

/** Verified facts of one list read. */
export type ProviderListFacts = Readonly<{
  workspaceId: string;
  actor: ProviderManagementActor;
  workspace: ProviderManagementWorkspace;
  profiles: ProviderSetupFacts["profiles"];
  defaultProfileId: string | null;
  usage: readonly ProviderProfileUsage[];
  /** Names of the repositories the profiles mention. */
  repositoryNames: ReadonlyMap<string, string>;
  /** Creator by user ID; `member` is false once they left the workspace. */
  creators: ReadonlyMap<
    string,
    Readonly<{ login: string | null; member: boolean }>
  >;
  /** Connected accounts by binding ID. */
  accounts: ReadonlyMap<
    string,
    Readonly<{ name: string | null; available: boolean }>
  >;
}>;

const allowed: ProviderListDecision = { allowed: true };

export function buildProviderListView(
  facts: ProviderListFacts,
): ProviderListView {
  const decide = (
    action: Parameters<typeof decideProviderManagement>[0]["action"],
  ): ProviderListDecision => {
    const decision = decideProviderManagement({
      actor: facts.actor,
      workspace: facts.workspace,
      action,
    });
    return decision.allowed
      ? allowed
      : { allowed: false, reason: decision.reason };
  };
  const admin = facts.actor.role === "owner" || facts.actor.role === "admin";
  const usageById = new Map(facts.usage.map((item) => [item.profileId, item]));

  const rows = facts.profiles.map((profile): ProviderListRow => {
    const profileFacts = {
      credentialKind: profile.credentialKind,
      createdByUserId: profile.createdByUserId,
      personalBinding: profile.personalBinding,
      repositoryId: profile.rotatingRepositoryId,
    };
    const stored = usageById.get(profile.id);
    const isDefault = facts.defaultProfileId === profile.id;
    const usage: ProviderListUsage = {
      workspaceDefault: isDefault || stored?.workspaceDefault === true,
      repositories: (stored?.repositoryIds ?? []).map((id) => ({
        id,
        fullName: facts.repositoryNames.get(id) ?? id,
      })),
    };
    const archive = decide({ kind: "archive_profile", profile: profileFacts });
    const account = profile.gatewayBindingId
      ? facts.accounts.get(profile.gatewayBindingId)
      : undefined;
    return {
      id: profile.id,
      label: profile.label,
      model: profile.model,
      ...(profile.providerId ? { providerId: profile.providerId } : {}),
      authMode: profile.authMode,
      credentialKind: profile.credentialKind,
      gatewayBindingId: profile.gatewayBindingId,
      gatewayProfileRef: profile.gatewayProfileRef ?? null,
      account:
        profile.credentialKind === "gateway_binding"
          ? {
              name: profile.personalBinding ? null : (account?.name ?? null),
              personal: profile.personalBinding,
              available: account?.available ?? false,
            }
          : null,
      rotatingRepositoryName: profile.rotatingRepositoryId
        ? (facts.repositoryNames.get(profile.rotatingRepositoryId) ?? null)
        : null,
      isDefault,
      usage,
      creator: creatorOf(facts, profile.createdByUserId),
      actions: {
        edit: decide({ kind: "edit_profile", profile: profileFacts }),
        makeDefault:
          profile.credentialKind === "hosted_pool"
            ? // A hosted pool comes from each repository's session source.
              { allowed: false, reason: "hosted_pool_not_default" }
            : decide({ kind: "set_default", profile: profileFacts }),
        removeDefault: isDefault ? decide({ kind: "clear_default" }) : null,
        // A provider still selected anywhere is refused by the write too.
        remove:
          archive.allowed &&
          (usage.workspaceDefault || usage.repositories.length > 0)
            ? { allowed: false, reason: "provider_in_use" }
            : archive,
        replaceKey:
          profile.credentialKind === "managed_api_key"
            ? decide({ kind: "manage_managed_key" })
            : null,
      },
    };
  });

  const add = decide({
    kind: "create_profile",
    profile: {
      credentialKind: "user_ci_secret",
      personalBinding: false,
      repositoryId: null,
    },
  });
  return {
    workspaceId: facts.workspaceId,
    viewerIsAdmin: admin,
    accessRightsAdminOnly: facts.workspace.providerManagementAdminOnly,
    hasDefault: facts.defaultProfileId !== null,
    add:
      !add.allowed && add.reason === "workspace_admin_required"
        ? { allowed: false, reason: "list_add_admin_required" }
        : add,
    rows: [
      ...rows.filter((row) => row.isDefault),
      ...rows.filter((row) => !row.isDefault),
    ],
  };
}

function creatorOf(
  facts: ProviderListFacts,
  userId: string | null,
): ProviderListCreator {
  if (userId === null) return { kind: "system" };
  if (userId === facts.actor.userId) return { kind: "you" };
  const creator = facts.creators.get(userId);
  return creator?.member
    ? { kind: "member", login: creator.login }
    : { kind: "former_member", login: creator?.login ?? null };
}

/**
 * Reasons that refuse the same actions on every row for this viewer; the list
 * states them once instead of repeating them on each provider.
 */
export const providerListWideReasons: ReadonlySet<ProviderListDenialReason> =
  new Set(["workspace_admin_required", "access_rights_admin_only"]);

/** Plain-language reason shown beside a disabled list action. */
export function providerListDenialText(
  reason: ProviderListDenialReason,
): string {
  switch (reason) {
    case "provider_in_use":
      return "To remove it, first choose another provider wherever it is used.";
    case "hosted_pool_not_default":
      return "A hosted Codex pool is chosen for each repository in Accounts, so it cannot be the default.";
    case "list_add_admin_required":
      return "Only workspace owners and admins add providers here. To add one for a repository you maintain, use its row in Repositories.";
    default:
      return providerSetupDenialText(reason);
  }
}

/** "Default for the workspace and used by 2 repositories", or "Not used yet". */
export function providerUsageText(usage: ProviderListUsage): string {
  const count = usage.repositories.length;
  const repositories = `${count} ${count === 1 ? "repository" : "repositories"}`;
  if (usage.workspaceDefault && count > 0)
    return `Workspace default, also chosen by ${repositories}`;
  if (usage.workspaceDefault) return "Workspace default";
  if (count > 0) return `Used by ${repositories}`;
  return "Not used yet";
}

export function providerCreatorText(creator: ProviderListCreator): string {
  switch (creator.kind) {
    case "you":
      return "Added by you";
    case "member":
      return creator.login ? `Added by @${creator.login}` : "Added by a member";
    case "former_member":
      return creator.login
        ? `Added by @${creator.login}, no longer a member`
        : "Added by a former member";
    case "system":
      return "Added by ReviewRouter";
  }
}

/** The managed key a provider uses, by its auth mode. */
export function managedKeyAuthModeOf(
  row: Pick<ProviderListRow, "credentialKind" | "authMode">,
): ManagedApiKeyAuthMode | null {
  return row.credentialKind === "managed_api_key" &&
    (row.authMode === "mimo_token_plan_api_key" ||
      row.authMode === "openrouter_api_key")
    ? row.authMode
    : null;
}
