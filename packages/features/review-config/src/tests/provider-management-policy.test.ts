import { describe, expect, it } from "vitest";
import {
  decideProviderManagement,
  type ProviderManagementAction,
  type ProviderManagementDenialReason,
  type ProviderProfileFacts,
  type WorkspaceMemberRole,
} from "../domain/provider-management-policy";

const repo = "repo-r";
const users = {
  owner: { userId: "u-owner", role: "owner" },
  admin: { userId: "u-admin", role: "admin" },
  creator: { userId: "u-creator", role: "member" },
  member: { userId: "u-member", role: "member" },
  outsider: { userId: "u-outsider", role: null },
} as const satisfies Record<
  string,
  { userId: string; role: WorkspaceMemberRole | null }
>;
type Who = keyof typeof users;

const profile = (
  credentialKind: ProviderProfileFacts["credentialKind"],
  extra: Partial<ProviderProfileFacts> = {},
): ProviderProfileFacts => ({
  credentialKind,
  createdByUserId: users.creator.userId,
  personalBinding: false,
  repositoryId: credentialKind === "repository_rotating" ? repo : null,
  ...extra,
});
const maintain = { repositoryId: repo, capability: "direct_config" } as const;
const write = { repositoryId: repo, capability: "repo_manager" } as const;
const none = { repositoryId: repo, capability: null } as const;

type Expectation = true | ProviderManagementDenialReason;
// One row per permission-table line; expectations for owner, admin, the
// profile creator (member), another member and a non-member GitHub maintainer.
const table: readonly {
  readonly name: string;
  readonly action: ProviderManagementAction;
  readonly off: Readonly<Record<Who, Expectation>>;
  readonly on: Readonly<Record<Who, Expectation>>;
}[] = [
  {
    name: "create from the Providers list",
    action: { kind: "create_profile", profile: profile("gateway_binding") },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "create in an attach flow with maintain on R",
    action: {
      kind: "create_and_attach",
      profile: profile("user_ci_secret"),
      repository: maintain,
    },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: true,
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "create in an attach flow with only write on R",
    action: {
      kind: "create_and_attach",
      profile: profile("gateway_binding"),
      repository: write,
    },
    off: {
      owner: true,
      admin: true,
      creator: "repository_direct_config_required",
      member: "repository_direct_config_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "create over a personal gateway binding",
    action: {
      kind: "create_and_attach",
      profile: profile("gateway_binding", { personalBinding: true }),
      repository: maintain,
    },
    off: {
      owner: true,
      admin: true,
      creator: "personal_binding_owner_required",
      member: "personal_binding_owner_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "create a hosted pool profile",
    action: {
      kind: "create_and_attach",
      profile: profile("hosted_pool"),
      repository: maintain,
    },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "create in an attach flow over a managed key applied to R",
    action: {
      kind: "create_and_attach",
      profile: profile("managed_api_key"),
      repository: maintain,
      managedKeyApplied: true,
    },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: true,
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    // A refused attach must not leave the profile in the workspace list, so
    // the managed-key rule decides the creation too.
    name: "create in an attach flow over a managed key not applied to R",
    action: {
      kind: "create_and_attach",
      profile: profile("managed_api_key"),
      repository: maintain,
      managedKeyApplied: false,
    },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "edit model or label",
    action: { kind: "edit_profile", profile: profile("user_ci_secret") },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: "profile_creator_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "edit a system-created profile",
    action: {
      kind: "edit_profile",
      profile: profile("hosted_pool", { createdByUserId: null }),
    },
    off: {
      owner: true,
      admin: true,
      creator: "profile_creator_required",
      member: "profile_creator_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "edit a profile over a personal binding",
    action: {
      kind: "edit_profile",
      profile: profile("gateway_binding", { personalBinding: true }),
    },
    off: {
      owner: true,
      admin: true,
      creator: "personal_binding_owner_required",
      member: "personal_binding_owner_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "archive",
    action: { kind: "archive_profile", profile: profile("gateway_binding") },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: "profile_creator_required",
      outsider: "workspace_member_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "workspace_member_required",
    },
  },
  {
    name: "attach another member's gateway profile with maintain on R",
    action: {
      kind: "attach_profile",
      profile: profile("gateway_binding"),
      repository: maintain,
    },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: true,
      outsider: true,
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "access_rights_admin_only",
    },
  },
  {
    name: "attach with only write on R",
    action: {
      kind: "attach_profile",
      profile: profile("user_ci_secret"),
      repository: write,
    },
    off: {
      owner: true,
      admin: true,
      creator: "repository_direct_config_required",
      member: "repository_direct_config_required",
      outsider: "repository_direct_config_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "access_rights_admin_only",
    },
  },
  {
    name: "attach a managed key already applied to R",
    action: {
      kind: "attach_profile",
      profile: profile("managed_api_key"),
      repository: maintain,
      managedKeyApplied: true,
    },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: true,
      outsider: true,
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "access_rights_admin_only",
    },
  },
  {
    name: "attach a managed key not yet applied to R",
    action: {
      kind: "attach_profile",
      profile: profile("managed_api_key"),
      repository: maintain,
    },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "access_rights_admin_only",
    },
  },
  {
    name: "attach a hosted pool profile",
    action: {
      kind: "attach_profile",
      profile: profile("hosted_pool"),
      repository: maintain,
    },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "access_rights_admin_only",
    },
  },
  {
    name: "attach a personal binding profile",
    action: {
      kind: "attach_profile",
      profile: profile("gateway_binding", { personalBinding: true }),
      repository: maintain,
    },
    off: {
      owner: true,
      admin: true,
      creator: "personal_binding_owner_required",
      member: "personal_binding_owner_required",
      outsider: "personal_binding_owner_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "access_rights_admin_only",
    },
  },
  {
    name: "clear a repository selection",
    action: { kind: "clear_selection", repository: maintain },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: true,
      outsider: true,
    },
    on: {
      owner: true,
      admin: true,
      creator: "access_rights_admin_only",
      member: "access_rights_admin_only",
      outsider: "access_rights_admin_only",
    },
  },
  {
    name: "set the workspace default",
    action: { kind: "set_default", profile: profile("gateway_binding") },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
  },
  {
    name: "upload or rotate a managed key",
    action: { kind: "manage_managed_key" },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
  },
  {
    name: "install a user CI secret with write on R",
    action: { kind: "install_ci_secret", repository: write },
    off: {
      owner: true,
      admin: true,
      creator: true,
      member: true,
      outsider: true,
    },
    on: {
      owner: true,
      admin: true,
      creator: true,
      member: true,
      outsider: true,
    },
  },
  {
    name: "install a user CI secret without write on R",
    action: { kind: "install_ci_secret", repository: none },
    off: {
      owner: true,
      admin: true,
      creator: "repository_manager_required",
      member: "repository_manager_required",
      outsider: "repository_manager_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "repository_manager_required",
      member: "repository_manager_required",
      outsider: "repository_manager_required",
    },
  },
  {
    name: "change the Access rights setting",
    action: { kind: "change_access_rights" },
    off: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
    on: {
      owner: true,
      admin: true,
      creator: "workspace_admin_required",
      member: "workspace_admin_required",
      outsider: "workspace_admin_required",
    },
  },
];

function decide(
  who: Who,
  action: ProviderManagementAction,
  workspace: {
    providerManagementAdminOnly: boolean;
    personalOwnerUserId?: string | null;
  },
): Expectation {
  const decision = decideProviderManagement({
    actor: users[who],
    workspace: {
      personalOwnerUserId: workspace.personalOwnerUserId ?? null,
      providerManagementAdminOnly: workspace.providerManagementAdminOnly,
    },
    action,
  });
  return decision.allowed ? true : decision.reason;
}

describe("provider management permission table", () => {
  it.each(table)("$name", ({ action, off, on }) => {
    const actual = (providerManagementAdminOnly: boolean) =>
      Object.fromEntries(
        (Object.keys(users) as Who[]).map((who) => [
          who,
          decide(who, action, { providerManagementAdminOnly }),
        ]),
      );
    expect(actual(false)).toEqual(off);
    expect(actual(true)).toEqual(on);
  });

  it("lets only the personal owner manage personal bindings of a personal workspace", () => {
    const personal = profile("gateway_binding", { personalBinding: true });
    for (const action of [
      { kind: "create_and_attach", profile: personal, repository: maintain },
      { kind: "edit_profile", profile: personal },
      { kind: "attach_profile", profile: personal, repository: maintain },
      { kind: "set_default", profile: personal },
    ] as const satisfies readonly ProviderManagementAction[]) {
      const workspace = {
        providerManagementAdminOnly: false,
        personalOwnerUserId: users.creator.userId,
      };
      // A personal workspace's owner may hold only a member row there.
      expect(decide("creator", action, workspace)).toBe(
        action.kind === "set_default" ? "workspace_admin_required" : true,
      );
      expect(decide("admin", action, workspace)).toBe(
        "personal_binding_owner_required",
      );
    }
  });

  it("keeps a rotating profile on its own repository and out of the default", () => {
    const rotating = profile("repository_rotating");
    const other = {
      repositoryId: "repo-other",
      capability: "direct_config",
    } as const;
    const off = { providerManagementAdminOnly: false };
    expect(
      decide("member", { kind: "create_profile", profile: rotating }, off),
    ).toBe("rotating_profile_repository_only");
    expect(
      decide(
        "member",
        { kind: "create_and_attach", profile: rotating, repository: maintain },
        off,
      ),
    ).toBe(true);
    expect(
      decide(
        "owner",
        { kind: "attach_profile", profile: rotating, repository: other },
        off,
      ),
    ).toBe("rotating_profile_repository_only");
    expect(
      decide("owner", { kind: "set_default", profile: rotating }, off),
    ).toBe("rotating_profile_not_default");
  });
});
