import { describe, expect, it } from "vitest";
import {
  buildProviderSetupView,
  type ProviderSetupFacts,
} from "./provider-setup-model";

const profile = (
  id: string,
  overrides: Partial<ProviderSetupFacts["profiles"][number]> = {},
): ProviderSetupFacts["profiles"][number] => ({
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
const repository = (
  id: string,
  overrides: Partial<ProviderSetupFacts["repositories"][number]> = {},
): ProviderSetupFacts["repositories"][number] => ({
  id,
  fullName: `acme/${id}`,
  capability: "direct_config",
  ownSelection: null,
  rotatingAvailable: true,
  ...overrides,
});

function facts(
  overrides: Partial<ProviderSetupFacts> = {},
): ProviderSetupFacts {
  return {
    workspaceId: "workspace_1",
    target: "repositories",
    actor: { userId: "user_member", role: "member" },
    workspace: {
      personalOwnerUserId: null,
      providerManagementAdminOnly: false,
    },
    profiles: [
      profile("team"),
      profile("personal", { personalBinding: true }),
      profile("hosted", {
        authMode: "codex_subscription_oauth_hosted_pool",
        credentialKind: "hosted_pool",
        gatewayBindingId: null,
      }),
      profile("rotating", {
        authMode: "codex_subscription_oauth_rotating",
        credentialKind: "repository_rotating",
        gatewayBindingId: null,
        rotatingRepositoryId: "repo_a",
      }),
    ],
    defaultSelection: {
      profileId: "team",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
    repositories: [repository("repo_a")],
    managedKeys: {
      mimo_token_plan_api_key: {
        uploaded: false,
        installedRepositoryIds: new Set(),
      },
      openrouter_api_key: {
        uploaded: true,
        installedRepositoryIds: new Set(["repo_a"]),
      },
    },
    claudeCodeEnabled: true,
    ...overrides,
  };
}

const decisionOf = (
  view: ReturnType<typeof buildProviderSetupView>,
  id: string,
) => view.profiles.find((option) => option.id === id)?.decision;
const sourceOf = (
  view: ReturnType<typeof buildProviderSetupView>,
  key: string,
) => view.sources.find((option) => option.key === key);

describe("provider setup view", () => {
  it("preserves named Gateway enrollment when no provider account has been added", () => {
    const view = buildProviderSetupView(
      facts({
        profiles: [],
        gatewaySetupProviders: ["codex", "claude-code", "openrouter"],
      }),
    );
    expect(view.profiles).toEqual([]);
    expect(view.gatewaySetupProviders).toEqual([
      "codex",
      "claude-code",
      "openrouter",
    ]);
    expect(sourceOf(view, "gateway_binding")?.decision).toEqual({
      allowed: true,
    });
  });

  it("lets a maintainer attach shared providers to a fixed repository, explaining refusals", () => {
    const view = buildProviderSetupView(facts());
    expect(decisionOf(view, "team")).toEqual({ allowed: true });
    expect(decisionOf(view, "personal")).toEqual({
      allowed: false,
      reason: "personal_binding_owner_required",
    });
    // Hosted pool goes through its own session flow; rotating stays with its repository.
    expect(view.profiles.map((option) => option.id)).toEqual([
      "team",
      "personal",
      "rotating",
    ]);
    expect(view.repositories[0]).toMatchObject({
      source: "workspace",
      useDefault: { allowed: true },
    });
    // A key installed in the repository can be attached; installing one
    // stays with owners and admins.
    expect(
      sourceOf(view, "managed_api_key:openrouter_api_key")?.decision,
    ).toEqual({
      allowed: true,
    });
    // A key not installed here: the reason names the key, not just the role.
    expect(
      sourceOf(view, "managed_api_key:mimo_token_plan_api_key"),
    ).toMatchObject({
      decision: { allowed: false, reason: "managed_key_admin_required" },
      managedKey: {
        uploaded: false,
        install: { allowed: false, reason: "managed_key_admin_required" },
      },
    });
    expect(sourceOf(view, "repository_rotating")?.decision).toEqual({
      allowed: true,
    });
  });

  it("offers the workspace default only to owners and admins, never a rotating one", () => {
    const member = buildProviderSetupView(
      facts({ target: "workspace", repositories: [] }),
    );
    expect(decisionOf(member, "team")).toEqual({
      allowed: false,
      reason: "workspace_admin_required",
    });
    const admin = buildProviderSetupView(
      facts({
        target: "workspace",
        repositories: [],
        actor: { userId: "user_admin", role: "admin" },
      }),
    );
    expect(decisionOf(admin, "team")).toEqual({ allowed: true });
    expect(
      admin.profiles.find((option) => option.id === "team")?.isDefault,
    ).toBe(true);
    expect(admin.profiles.some((option) => option.id === "rotating")).toBe(
      false,
    );
    expect(sourceOf(admin, "repository_rotating")).toBeUndefined();
    // Saving a new key for the workspace list needs it stored first.
    expect(
      sourceOf(admin, "managed_api_key:mimo_token_plan_api_key")?.decision,
    ).toEqual({
      allowed: false,
      reason: "managed_key_not_installed",
    });
  });

  it("allows a bulk choice while one repository accepts it and counts the refusals", () => {
    const view = buildProviderSetupView(
      facts({
        repositories: [
          repository("repo_a"),
          repository("repo_b", { capability: "repo_manager" }),
        ],
      }),
    );
    expect(view.profiles.find((option) => option.id === "team")).toMatchObject({
      decision: { allowed: true },
      refusedRepositoryCount: 1,
    });
    // Rotating needs exactly one repository.
    expect(view.profiles.some((option) => option.id === "rotating")).toBe(
      false,
    );
    expect(sourceOf(view, "repository_rotating")).toBeUndefined();
  });

  it("follows Access rights: members see every change disabled with the reason", () => {
    const view = buildProviderSetupView(
      facts({
        workspace: {
          personalOwnerUserId: null,
          providerManagementAdminOnly: true,
        },
      }),
    );
    for (const option of view.profiles)
      expect(option.decision).toEqual({
        allowed: false,
        reason: "access_rights_admin_only",
      });
    expect(view.repositories[0]!.useDefault).toEqual({
      allowed: false,
      reason: "access_rights_admin_only",
    });
    expect(view.sources.every((source) => !source.decision.allowed)).toBe(true);
  });

  it("hides Claude Code where the deployment disables it", () => {
    const view = buildProviderSetupView(facts({ claudeCodeEnabled: false }));
    expect(sourceOf(view, "user_ci_secret:claude_code_oauth")).toBeUndefined();
    expect(
      sourceOf(view, "user_ci_secret:mimo_token_plan_api_key"),
    ).toBeDefined();
  });

  it("does not advertise rotating Codex when its repository deployment gate is off", () => {
    const view = buildProviderSetupView(
      facts({
        repositories: [repository("repo_a", { rotatingAvailable: false })],
      }),
    );
    expect(sourceOf(view, "repository_rotating")).toBeUndefined();
  });
});
