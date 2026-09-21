import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardWorkspaceLayout,
  listDashboardRepositoryAccess,
  loadDashboardSectionData,
} from "./dashboard-workspace-page";
import type { DashboardWorkspaceSummary } from "./dashboard-workspace-navigation";

const fixtures = vi.hoisted(() => {
  const repository = {
    id: "repo-a",
    workspaceId: "workspace-a",
    owner: "acme",
    fullName: "acme/test",
    visibility: "private",
    selected: true,
    archived: false,
  };
  const spies = {
    repositories: vi.fn(async () => [
      repository,
      { ...repository, id: "repo-hidden" },
    ]),
    entitlement: vi.fn(async () => ({ flags: { hosted_codex_pool: true } })),
    health: vi.fn(async () => []),
    config: vi.fn(async () => null),
    batchConfig: vi.fn(
      async (input: { readonly repositoryIds: readonly string[] }) =>
        input.repositoryIds.map((repositoryId) => ({
          repositoryId,
          config: null,
        })),
    ),
    outbox: vi.fn(async () => []),
    provisioning: vi.fn(async () => []),
    providerSetup: vi.fn(async () => []),
    readiness: vi.fn(async () => []),
    discovery: vi.fn(async () => ({
      status: "ready" as const,
      workspaceIds: ["workspace-a"],
      repositoryIds: new Set(["repo-a"]),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: new Date("2026-09-01"),
    })),
    requestedCandidates: vi.fn(async () => []),
    diagnostics: vi.fn(async () => null),
    ruleset: vi.fn(async () => null),
    memoryItems: vi.fn(async () => ({ items: [] })),
    memorySuggestions: vi.fn(async () => ({ suggestions: [] })),
    memoryPolicy: vi.fn(async () => ({ memoryEnabled: true })),
    memorySimulation: vi.fn(),
    audit: vi.fn(async () => ({
      auditEvents: [
        {
          action: "test",
          actor: "owner",
          targetType: "workspace",
          createdAt: new Date("2026-09-01"),
        },
      ],
    })),
    summaries: vi.fn(async () => [
      {
        id: "workspace-a",
        name: "acme",
        slug: "acme",
        installations: [],
        gitLabInstallations: [],
        repositories: [{ owner: "acme" }],
        _count: { repositories: 2 },
      },
    ]),
    hostedPool: vi.fn(async () => ({
      gate: "enabled",
      pool: null,
      accounts: [],
      repositories: [],
    })),
  };
  return { spies, EmptyStore: class {} };
});
const { spies } = fixtures;

vi.mock("./actions", () => ({}));
vi.mock("../../src/server/prisma", () => ({
  getPrisma: () => ({
    providerSetupState: { findMany: fixtures.spies.providerSetup },
    workspace: {
      findMany: fixtures.spies.summaries,
      findUnique: fixtures.spies.audit,
    },
    repositoryConnection: {
      findMany: fixtures.spies.requestedCandidates,
    },
  }),
}));
vi.mock("../../src/server/dashboard-mutations", () => ({
  getDashboardMutationStatus: async () => ({
    signedIn: true,
    enabled: true,
    sourceLogin: "owner",
    sourceAvatarUrl: null,
  }),
  getDashboardWorkspaceScope: async () => ({
    kind: "all",
    reason: "local_admin_override",
  }),
  getDashboardSignedInActor: async () => null,
  asDashboardGitHubActor: (actor: unknown) => actor,
}));
vi.mock("../../src/server/github-app-install-url", () => ({
  getGitHubAppInstallUrl: () => null,
}));
vi.mock("../../src/server/github-user-repository-access", () => ({
  listGitHubUserRepositoryAccess: fixtures.spies.discovery,
}));
vi.mock("../../src/server/prisma-codex-rotating-setup-readiness", () => ({
  PrismaCodexRotatingSetupReadiness: fixtures.EmptyStore,
}));
vi.mock("../../src/server/dashboard-codex-rotating-setup-readiness", () => ({
  deriveDashboardProviderSetupReadiness: fixtures.spies.readiness,
}));
vi.mock("../../src/server/openrouter-model-catalog", () => ({
  getReviewModelOptions: vi.fn(async () => []),
}));
vi.mock("../../src/server/hosted-pool-dashboard", () => ({
  loadHostedPoolDashboardView: fixtures.spies.hostedPool,
}));
vi.mock("@reviewrouter/platform-config", () => ({
  isHostedCodexPoolEnabled: () => true,
  requireReviewRouterDatabaseRecoveryWitness: () => "test-witness",
  resolveReviewRouterActionRef: () => "test-sha",
}));
vi.mock("@reviewrouter/features-repositories", () => ({
  PrismaRepositoryConnectionRepository: class {
    listWorkspaceRepositories = fixtures.spies.repositories;
  },
}));
vi.mock("@reviewrouter/features-repo-health", () => ({
  PrismaRepositoryHealthRepository: fixtures.EmptyStore,
  listWorkspaceRepositoryHealth: fixtures.spies.health,
}));
vi.mock("@reviewrouter/features-entitlements", () => ({
  PrismaEntitlementRepository: class {
    findWorkspaceEntitlement = fixtures.spies.entitlement;
  },
  freeBetaEntitlement: () => ({ flags: { hosted_codex_pool: false } }),
}));
vi.mock("@reviewrouter/features-review-config", () => ({
  PrismaReviewConfigurationRepository: fixtures.EmptyStore,
  findReviewConfiguration: fixtures.spies.config,
  findRepositoryReviewConfigurations: fixtures.spies.batchConfig,
}));
vi.mock("@reviewrouter/features-outbox", () => ({
  PrismaOutboxEventRepository: fixtures.EmptyStore,
  listWorkspaceOutboxFailures: fixtures.spies.outbox,
}));
vi.mock("@reviewrouter/features-support-diagnostics", () => ({
  PrismaSupportDiagnosticsRepository: fixtures.EmptyStore,
  getWorkspaceSupportDiagnostics: fixtures.spies.diagnostics,
}));
vi.mock("@reviewrouter/features-org-ruleset-provisioning", () => ({
  PrismaOrgRulesetProvisioningRepository: class {
    findByWorkspaceId = fixtures.spies.ruleset;
  },
}));
vi.mock("@reviewrouter/features-workflow-provisioning", () => ({
  PrismaWorkflowProvisioningQuery: fixtures.EmptyStore,
  listRepositoryWorkflowProvisioning: fixtures.spies.provisioning,
}));
vi.mock("@reviewrouter/features-audit-log", () => ({
  PrismaAuditLogRepository: fixtures.EmptyStore,
}));
vi.mock("@reviewrouter/features-hosted-account-pool", () => ({
  PrismaHostedPoolQuery: fixtures.EmptyStore,
}));
vi.mock("@reviewrouter/features-provider-setup", () => ({}));
vi.mock("@reviewrouter/features-memory", () => ({
  PrismaMemoryPermission: fixtures.EmptyStore,
  PrismaMemoryItemRepository: fixtures.EmptyStore,
  PrismaMemorySuggestionRepository: fixtures.EmptyStore,
  EntitlementMemoryQuotaPolicy: fixtures.EmptyStore,
  EntitlementMemoryPolicyConfig: class {
    getPolicy = fixtures.spies.memoryPolicy;
  },
  readMemoryServiceEnabled: () => true,
  simulateMemoryPolicyDecision: fixtures.spies.memorySimulation,
  listMemoryItemsForDashboard: fixtures.spies.memoryItems,
  listMemorySuggestionsForDashboard: fixtures.spies.memorySuggestions,
}));

const workspace: DashboardWorkspaceSummary = {
  workspace: {
    id: "workspace-a",
    name: "acme",
    slug: "acme",
    installations: [],
    gitLabInstallations: [],
    auditEvents: [],
  },
  repositoryCount: 2,
  hasWorkspaceWideAccess: true,
};
const access = {
  status: "ready" as const,
  workspaceIds: ["workspace-a"],
  repositoryIds: new Set(["repo-a"]),
  directConfigRepositoryIds: new Set<string>(),
  checkedAt: null,
};

beforeEach(() => vi.clearAllMocks());

describe("dashboard server loading boundaries", () => {
  it("shares one persistent route layout across dashboard and Accounts while keeping previews outside it", () => {
    const route = (path: string) => new URL(path, import.meta.url);
    expect(readFileSync(route("./(workspace)/layout.tsx"), "utf8")).toContain(
      "DashboardWorkspaceLayout as default",
    );
    expect(readFileSync(route("./(workspace)/loading.tsx"), "utf8")).toContain(
      "DashboardSectionLoading as default",
    );
    expect(existsSync(route("./(workspace)/page.tsx"))).toBe(true);
    expect(existsSync(route("./(workspace)/setup/page.tsx"))).toBe(true);
    expect(existsSync(route("./memory-preview/page.tsx"))).toBe(true);
    expect(existsSync(route("./hosted-pool-preview/page.tsx"))).toBe(true);
    expect(existsSync(route("./loading.tsx"))).toBe(false);
  });

  it("renders shell data without section queries", async () => {
    const shell = await DashboardWorkspaceLayout({ children: "content" });
    expect((shell.props as { workspaces: unknown[] }).workspaces).toHaveLength(
      1,
    );
    expect(spies.summaries).toHaveBeenCalledOnce();
    for (const spy of Object.values(spies).filter(
      (spy) => spy !== spies.summaries,
    ))
      expect(spy).not.toHaveBeenCalled();
  });

  it("reuses base discovery when augmenting a direct repository URL", async () => {
    const actor = {
      userId: "user-a",
      sourceProvider: "github" as const,
      externalUserId: "github-user-a",
      sourceLogin: "owner",
      githubUserId: "github-user-a",
      githubLogin: "owner",
      actor: "github:owner",
    };
    const workspaceScope = {
      kind: "workspace_ids" as const,
      workspaceIds: [] as string[],
    };
    const baseAccess = await listDashboardRepositoryAccess({
      actor,
      workspaceScope,
      requestedRepositoryFullName: "",
    });

    await listDashboardRepositoryAccess({
      actor,
      workspaceScope,
      requestedRepositoryFullName: "acme/test",
      baseAccess,
    });

    expect(spies.discovery).toHaveBeenCalledOnce();
    expect(spies.requestedCandidates).toHaveBeenCalledOnce();
  });

  it.each(["repositories", "policy", "diagnostics", "setup"] as const)(
    "does not load Memory when visiting %s",
    async (section) => {
      await loadDashboardSectionData(workspace, section, access);
      expect(spies.repositories).toHaveBeenCalledExactlyOnceWith("workspace-a");
      expect(spies.memoryItems).not.toHaveBeenCalled();
      expect(spies.memorySuggestions).not.toHaveBeenCalled();
      expect(spies.memoryPolicy).not.toHaveBeenCalled();
      expect(spies.memorySimulation).not.toHaveBeenCalled();
    },
  );

  it.each(["setup", "memory"] as const)(
    "skips configuration, readiness, diagnostics and audit for %s",
    async (section) => {
      await loadDashboardSectionData(workspace, section, access);
      for (const spy of [
        spies.config,
        spies.batchConfig,
        spies.health,
        spies.provisioning,
        spies.providerSetup,
        spies.readiness,
        spies.diagnostics,
        spies.outbox,
        spies.ruleset,
        spies.audit,
      ])
        expect(spy).not.toHaveBeenCalled();
    },
  );

  it("loads Memory only for the selected workspace", async () => {
    await loadDashboardSectionData(workspace, "memory", access);
    expect(spies.memoryItems).toHaveBeenCalledWith(
      { workspaceId: "workspace-a", limit: 25 },
      expect.anything(),
    );
    expect(spies.memorySuggestions).toHaveBeenCalledOnce();
    expect(spies.memoryPolicy).toHaveBeenCalledExactlyOnceWith({
      workspaceId: "workspace-a",
    });
    expect(spies.hostedPool).toHaveBeenCalledWith(
      expect.objectContaining({ featureEnabled: false }),
    );
  });

  it("keeps selected-workspace audit and support diagnostics in Diagnostics", async () => {
    const data = await loadDashboardSectionData(
      workspace,
      "diagnostics",
      access,
    );
    expect(data.workspace.auditEvents[0]?.action).toBe("test");
    expect(spies.audit).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "workspace-a" } }),
    );
    expect(spies.diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-a" }),
      expect.anything(),
    );
    expect(spies.ruleset).not.toHaveBeenCalled();
  });

  it("keeps repository-scoped access from receiving other repository configs or workspace diagnostics", async () => {
    const data = await loadDashboardSectionData(
      { ...workspace, hasWorkspaceWideAccess: false },
      "diagnostics",
      access,
    );
    expect(data.repositories.map((repository) => repository.id)).toEqual([
      "repo-a",
    ]);
    expect(data.repositoryConfigs.map((config) => config.repositoryId)).toEqual(
      ["repo-a"],
    );
    expect(spies.batchConfig).toHaveBeenCalledExactlyOnceWith(
      {
        workspaceId: "workspace-a",
        repositoryIds: ["repo-a"],
      },
      expect.anything(),
    );
    expect(spies.diagnostics).not.toHaveBeenCalled();
    expect(spies.outbox).not.toHaveBeenCalled();
    expect(spies.audit).not.toHaveBeenCalled();
  });
});
