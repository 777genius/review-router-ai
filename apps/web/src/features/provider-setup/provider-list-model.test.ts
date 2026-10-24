import { describe, expect, it } from "vitest";
import {
  buildProviderListView,
  providerListDenialText,
  type ProviderListFacts,
  type ProviderListView,
} from "./provider-list-model";

const profile = (
  id: string,
  overrides: Partial<ProviderListFacts["profiles"][number]> = {},
): ProviderListFacts["profiles"][number] => ({
  id,
  label: id,
  model: "gpt-5.5",
  authMode: "codex_account_gateway",
  credentialKind: "gateway_binding",
  createdByUserId: "user_owner",
  gatewayBindingId: `binding-${id}`,
  personalBinding: false,
  rotatingRepositoryId: null,
  ...overrides,
});

function facts(overrides: Partial<ProviderListFacts> = {}): ProviderListFacts {
  return {
    workspaceId: "workspace_1",
    actor: { userId: "user_member", role: "member" },
    workspace: {
      personalOwnerUserId: null,
      providerManagementAdminOnly: false,
    },
    profiles: [
      profile("team"),
      profile("mine", {
        authMode: "claude_code_oauth",
        credentialKind: "user_ci_secret",
        gatewayBindingId: null,
        createdByUserId: "user_member",
      }),
      profile("key", {
        authMode: "openrouter_api_key",
        credentialKind: "managed_api_key",
        gatewayBindingId: null,
        createdByUserId: "user_gone",
      }),
      profile("hosted", {
        authMode: "codex_subscription_oauth_hosted_pool",
        credentialKind: "hosted_pool",
        gatewayBindingId: null,
        createdByUserId: null,
      }),
    ],
    defaultProfileId: "team",
    usage: [
      { profileId: "team", workspaceDefault: true, repositoryIds: [] },
      { profileId: "mine", workspaceDefault: false, repositoryIds: ["repo_a"] },
    ],
    repositoryNames: new Map([["repo_a", "acme/web"]]),
    creators: new Map([
      ["user_owner", { login: "owner", member: true }],
      ["user_gone", { login: "gone", member: false }],
    ]),
    accounts: new Map([["binding-team", { name: "Team", available: true }]]),
    ...overrides,
  };
}

const row = (view: ProviderListView, id: string) =>
  view.rows.find((candidate) => candidate.id === id)!;
const denied = (reason: string) => ({ allowed: false, reason });

describe("Providers list view", () => {
  it("lets a member change only what they added and keeps the rest visible with reasons", () => {
    const view = buildProviderListView(facts());
    // The default comes first.
    expect(view.rows.map((candidate) => candidate.id)).toEqual([
      "team",
      "mine",
      "key",
      "hosted",
    ]);
    expect(row(view, "team").actions).toEqual({
      edit: denied("profile_creator_required"),
      makeDefault: null,
      removeDefault: denied("workspace_admin_required"),
      remove: denied("profile_creator_required"),
      replaceKey: null,
    });
    // Their own provider: editable; removal waits until nothing uses it.
    expect(row(view, "mine").actions).toMatchObject({
      edit: { allowed: true },
      makeDefault: denied("workspace_admin_required"),
      remove: denied("provider_in_use"),
    });
    expect(row(view, "key").actions.replaceKey).toEqual(
      denied("workspace_admin_required"),
    );
    expect(view.add).toEqual(denied("list_add_admin_required"));
    expect(row(view, "mine").creator).toEqual({ kind: "you" });
    expect(row(view, "key").creator).toEqual({
      kind: "former_member",
      login: "gone",
    });
    expect(row(view, "hosted").creator).toEqual({ kind: "system" });
    expect(row(view, "mine").usage.repositories).toEqual([
      { id: "repo_a", fullName: "acme/web" },
    ]);
  });

  it("gives owners and admins every action, refusing only removal in use and a hosted pool default", () => {
    const view = buildProviderListView(
      facts({ actor: { userId: "user_admin", role: "admin" } }),
    );
    expect(view.add).toEqual({ allowed: true });
    expect(row(view, "team").actions).toEqual({
      edit: { allowed: true },
      makeDefault: null,
      removeDefault: { allowed: true },
      remove: denied("provider_in_use"),
      replaceKey: null,
    });
    expect(row(view, "key").actions).toEqual({
      edit: { allowed: true },
      makeDefault: { allowed: true },
      removeDefault: null,
      remove: { allowed: true },
      replaceKey: { allowed: true },
    });
    expect(row(view, "hosted").actions.makeDefault).toEqual(
      denied("hosted_pool_not_default"),
    );
  });

  it("follows Access rights: members lose even their own providers, owners keep everything", () => {
    const adminOnly = {
      personalOwnerUserId: null,
      providerManagementAdminOnly: true,
    };
    const member = buildProviderListView(facts({ workspace: adminOnly }));
    expect(member.accessRightsAdminOnly).toBe(true);
    expect(row(member, "mine").actions).toMatchObject({
      edit: denied("access_rights_admin_only"),
      remove: denied("access_rights_admin_only"),
    });
    expect(member.add).toEqual(denied("access_rights_admin_only"));
    expect(providerListDenialText("access_rights_admin_only")).toBe(
      "Only workspace owners and admins can manage providers.",
    );
    const owner = buildProviderListView(
      facts({
        workspace: adminOnly,
        actor: { userId: "user_owner", role: "owner" },
      }),
    );
    expect(row(owner, "mine").actions.edit).toEqual({ allowed: true });
    expect(owner.add).toEqual({ allowed: true });
  });
});
