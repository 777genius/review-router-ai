import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProviderProfileError,
  type WorkspaceMemberRole,
} from "@reviewrouter/features-review-config";

const mocks = vi.hoisted(() => ({
  adminGate: vi.fn(),
  signedIn: vi.fn(),
  rateLimit: vi.fn(),
  entitlement: vi.fn(),
  findRepositories: vi.fn(),
  loadRepository: vi.fn(),
  setDefault: vi.fn(),
  gatewayModel: vi.fn(),
  authority: {
    /** `none`: the workspace is unavailable to the actor. */
    role: "member" as WorkspaceMemberRole | null | "none",
    adminOnly: false,
    createdBy: "user_owner" as string | null,
  },
  writes: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/server/dashboard-mutations", () => ({
  assertDashboardMutationAllowed: mocks.adminGate,
  assertDashboardSignedInMutationActor: mocks.signedIn,
  assertDashboardRepositoryConfigMutationAllowed: vi.fn(),
}));
vi.mock("../../src/server/dashboard-rate-limits", () => ({
  createDashboardRateLimitPolicy: () => ({
    assertReviewConfigSaveAllowed: mocks.rateLimit,
  }),
}));
vi.mock("../../src/server/dashboard-repository-guards", () => ({
  assertDashboardEntitlement: mocks.entitlement,
  assertGatewayReviewActorUnchanged: vi.fn(),
  assertRepositoryConfigMutable: vi.fn(),
  loadDashboardRepository: mocks.loadRepository,
}));
vi.mock("../../src/server/prisma", () => ({
  getPrisma: () => ({
    repositoryConnection: { findMany: mocks.findRepositories },
  }),
}));
vi.mock("../../src/server/dashboard-review-configuration-validation", () => ({
  assertDashboardGatewayProviderModelAllowed: mocks.gatewayModel,
  dashboardProfileModelChangeValidator: () => ({
    beforeTransaction: async () => {},
    scope: () => {},
  }),
}));
vi.mock(
  "../../src/server/dashboard-provider-selections",
  async (importOriginal) => {
    type Input = {
      readonly actor: { readonly userId: string };
      readonly gate: (facts: unknown) => void;
      readonly authorize: (facts: unknown) => void;
    };
    // Decides like the Prisma repository: the gate, then the profile facts.
    const decide = (input: Input) => {
      const authority = {
        actor: { userId: input.actor.userId, role: mocks.authority.role },
        workspace: {
          personalOwnerUserId: null,
          providerManagementAdminOnly: mocks.authority.adminOnly,
        },
      };
      input.gate(authority);
      input.authorize({
        ...authority,
        profile: {
          credentialKind: "user_ci_secret",
          createdByUserId: mocks.authority.createdBy,
          personalBinding: false,
          repositoryId: null,
        },
      });
    };
    const profile = {
      id: "profile_1",
      workspaceId: "workspace_1",
      createdByUserId: "user_owner",
      credential: { kind: "user_ci_secret", authMode: "claude_code_oauth" },
      model: "opus",
      label: "Team Claude",
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    return {
      ...(await importOriginal<
        typeof import("../../src/server/dashboard-provider-selections")
      >()),
      dashboardSelectionDependencies: () => ({}),
      dashboardProviderProfiles: () => ({
        readManagementFacts: async (input: Pick<Input, "actor">) =>
          mocks.authority.role === "none"
            ? null
            : {
                actor: {
                  userId: input.actor.userId,
                  role: mocks.authority.role,
                },
                workspace: {
                  personalOwnerUserId: null,
                  providerManagementAdminOnly: mocks.authority.adminOnly,
                },
                personalBindingIds: new Set<string>(),
              },
        list: async () => [
          { ...profile, createdByUserId: mocks.authority.createdBy },
        ],
        rename: async (input: Input) => {
          decide(input);
          mocks.writes.push("rename");
          return profile;
        },
        changeModel: async (input: Input) => {
          decide(input);
          mocks.writes.push("changeModel");
          return { profile, previousModel: "opus", affected: undefined };
        },
        archive: async (input: Input) => {
          decide(input);
          throw new ProviderProfileError("provider_profile_in_use", {
            profileId: "profile_1",
            workspaceDefault: true,
            repositoryIds: ["repo_b", "repo_a"],
          });
        },
      }),
    };
  },
);
vi.mock("@reviewrouter/features-review-config", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@reviewrouter/features-review-config")
  >()),
  setWorkspaceDefaultProvider: mocks.setDefault,
}));

import {
  archiveProviderProfileAction,
  clearWorkspaceDefaultProviderAction,
  createProviderProfileAction,
  saveProviderSetupAction,
  updateProviderProfileAction,
} from "./provider-setup-actions";

const member = {
  userId: "user_member",
  actor: "user:github:member",
  githubLogin: "member",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.writes.length = 0;
  Object.assign(mocks.authority, {
    role: "member",
    adminOnly: false,
    createdBy: "user_owner",
  });
  mocks.signedIn.mockResolvedValue(member);
  mocks.adminGate.mockRejectedValue(
    new Error("workspace_mutation_forbidden:insufficient_role"),
  );
  mocks.findRepositories.mockResolvedValue([
    { id: "repo_a", fullName: "acme/api" },
    { id: "repo_b", fullName: "acme/web" },
  ]);
});

describe("Providers list actions decide with the provider policy", () => {
  const edit = (overrides: { label?: string; model?: string } = {}) =>
    updateProviderProfileAction({
      workspaceId: "workspace_1",
      profileId: "profile_1",
      model: "sonnet",
      ...overrides,
    });

  it("lets the member who added a provider edit it without the admin gate", async () => {
    mocks.authority.createdBy = "user_member";
    await expect(edit({ label: "Our Claude" })).resolves.toEqual({
      status: "saved",
    });
    expect(mocks.adminGate).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual(["changeModel", "rename"]);
  });

  it("refuses another member's provider and admin-only Access rights with the policy reason", async () => {
    await expect(edit()).resolves.toEqual({
      status: "error",
      error: "provider_management_forbidden",
      reason: "profile_creator_required",
    });
    mocks.authority.createdBy = "user_member";
    mocks.authority.adminOnly = true;
    await expect(edit()).resolves.toEqual({
      status: "error",
      error: "provider_management_forbidden",
      reason: "access_rights_admin_only",
    });
    expect(mocks.writes).toEqual([]);
    // Owners and admins keep it under admin-only Access rights.
    mocks.authority.role = "admin";
    mocks.authority.createdBy = "user_owner";
    await expect(edit()).resolves.toEqual({ status: "saved" });
  });

  it("checks a new label before any authority or write", async () => {
    await expect(
      edit({ label: "sk-proj-0123456789abcdefghij" }),
    ).resolves.toEqual({ status: "error", error: "provider_profile_invalid" });
    expect(mocks.signedIn).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
  });

  it("names the default and the repositories that keep a provider from being removed", async () => {
    mocks.authority.role = "owner";
    await expect(
      archiveProviderProfileAction({
        workspaceId: "workspace_1",
        profileId: "profile_1",
      }),
    ).resolves.toEqual({
      status: "error",
      error: "provider_profile_in_use",
      blocking: {
        workspaceDefault: true,
        repositories: ["acme/api", "acme/web"],
      },
    });
  });

  it("refuses non-members and admin-only Access rights before the rate limit, entitlement and reads", async () => {
    const archive = () =>
      archiveProviderProfileAction({
        workspaceId: "workspace_1",
        profileId: "profile_1",
      });
    mocks.authority.role = null;
    await expect(archive()).resolves.toEqual({
      status: "error",
      error: "provider_management_forbidden",
      reason: "workspace_member_required",
    });
    // An unavailable workspace answers like an unknown profile would.
    mocks.authority.role = "none";
    await expect(edit()).resolves.toEqual({
      status: "error",
      error: "provider_management_forbidden",
      reason: "workspace_member_required",
    });
    mocks.authority.role = "member";
    mocks.authority.adminOnly = true;
    await expect(edit()).resolves.toEqual({
      status: "error",
      error: "provider_management_forbidden",
      reason: "access_rights_admin_only",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.entitlement).not.toHaveBeenCalled();
    expect(mocks.findRepositories).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
  });

  it("keeps clearing the default behind the owner/admin gate", async () => {
    await expect(
      clearWorkspaceDefaultProviderAction({ workspaceId: "workspace_1" }),
    ).resolves.toEqual({
      status: "error",
      error: "workspace_mutation_forbidden",
    });
    expect(mocks.setDefault).not.toHaveBeenCalled();
  });
});

describe("provider choices refused before quotas: hosted pools and Access rights", () => {
  const settings = {
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
  } as const;

  beforeEach(() => {
    mocks.adminGate.mockResolvedValue({
      userId: "user_owner",
      actor: "user:github:owner",
      githubLogin: "owner",
    });
  });

  it("refuses it as the default or as a new provider of the list", async () => {
    await expect(
      saveProviderSetupAction({
        workspaceId: "workspace_1",
        target: { kind: "workspace" },
        provider: {
          kind: "new",
          credential: { kind: "hosted_pool" },
          model: "gpt-5.5",
        },
        settings,
      }),
    ).resolves.toEqual({
      status: "error",
      error: "hosted_pool_session_source_required",
    });
    await expect(
      createProviderProfileAction({
        workspaceId: "workspace_1",
        credential: { kind: "hosted_pool" },
        model: "gpt-5.5",
      }),
    ).resolves.toEqual({
      status: "error",
      error: "hosted_pool_session_source_required",
    });
    await expect(
      saveProviderSetupAction({
        workspaceId: "workspace_1",
        target: { kind: "repositories", repositoryIds: ["repo_a"] },
        provider: {
          kind: "new",
          credential: { kind: "hosted_pool" },
          model: "gpt-5.5",
        },
        settings,
      }),
    ).resolves.toEqual({
      status: "error",
      error: "hosted_pool_session_source_required",
    });
    expect(mocks.setDefault).not.toHaveBeenCalled();
    // Refused before any quota, entitlement or GitHub check.
    expect(mocks.entitlement).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.loadRepository).not.toHaveBeenCalled();
  });

  it("refuses a member's choice under admin-only Access rights before quotas and GitHub checks", async () => {
    mocks.authority.adminOnly = true;
    await expect(
      saveProviderSetupAction({
        workspaceId: "workspace_1",
        target: { kind: "repositories", repositoryIds: ["repo_a"] },
        provider: { kind: "profile", profileId: "profile_1" },
        settings,
      }),
    ).resolves.toEqual({
      status: "error",
      error: "provider_management_forbidden",
      reason: "access_rights_admin_only",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.entitlement).not.toHaveBeenCalled();
    expect(mocks.loadRepository).not.toHaveBeenCalled();
  });
});

// RED if model-only provider creation skips its exact binding catalog.
it("refuses a model offered only by another account before creating a provider", async () => {
  mocks.adminGate.mockResolvedValue(member);
  mocks.gatewayModel.mockRejectedValueOnce(
    new Error("gateway_review_model_unsupported"),
  );
  await expect(
    createProviderProfileAction({
      workspaceId: "workspace_1",
      credential: {
        kind: "gateway_binding",
        bindingId: "binding-a",
        gatewayProfileRef: "codex-profile",
      },
      model: "account-b-only",
    }),
  ).resolves.toEqual({
    status: "error",
    error: "gateway_review_model_unsupported",
  });
  expect(mocks.gatewayModel).toHaveBeenCalledWith(
    "workspace_1",
    { gatewayBindingId: "binding-a", gatewayProfileRef: "codex-profile" },
    "account-b-only",
  );
  expect(mocks.writes).toEqual([]);
});
