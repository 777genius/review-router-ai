import { renderToStaticMarkup } from "react-dom/server";
import { redirect } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DashboardWorkspaceLayout,
  DashboardWorkspacePage,
  DashboardSectionContent,
  listDashboardRepositoryAccess,
  loadDashboardSectionData,
  WorkspaceCard,
} from "./dashboard-workspace-page";
import type { DashboardWorkspaceSummary } from "./dashboard-workspace-navigation";
import type { EffectiveReviewConfiguration } from "@reviewrouter/features-review-config";
import type {
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";

vi.mock("next/navigation", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/navigation")>();
  return {
    ...original,
    redirect: vi.fn(original.redirect),
    useRouter: () => ({ refresh: vi.fn() }),
  };
});

const memoryKnowledge = vi.hoisted(() => ({
  load: vi.fn(async () => ({ workspaceId: "workspace-a", repositoryId: null })),
}));
const identity = vi.hoisted(() => ({
  scope: vi.fn(
    async (): Promise<unknown> => ({
      kind: "all",
      reason: "local_admin_override",
    }),
  ),
  actor: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("../../src/server/dashboard-memory-knowledge", () => ({
  loadDashboardMemoryKnowledge: memoryKnowledge.load,
}));
vi.mock(
  "../../src/features/memory/interface/components/memory-knowledge-workspace",
  () => ({
    MemoryKnowledgeWorkspace: () => (
      <section>
        <h1>Approved memory</h1>
      </section>
    ),
  }),
);

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
    policies: vi.fn(
      async (input: {
        readonly repositoryIds: readonly string[];
      }): Promise<{
        readonly workspace: EffectiveReviewConfiguration;
        readonly repositories: ReadonlyMap<
          string,
          EffectiveReviewConfiguration
        >;
        readonly workspacePolicy: null;
        readonly repositoryPolicies: ReadonlyMap<string, null>;
      }> => {
        const missing = {
          status: "provider_selection_required",
          workspaceVersion: null,
          repositoryVersion: null,
        } as const;
        return {
          workspace: missing,
          repositories: new Map(
            input.repositoryIds.map((repositoryId) => [repositoryId, missing]),
          ),
          workspacePolicy: null,
          repositoryPolicies: new Map(),
        };
      },
    ),
    outbox: vi.fn(async () => []),
    provisioning: vi.fn(async () => []),
    providerSetup: vi.fn(async () => []),
    readiness: vi.fn(async () => []),
    organizationRequest: vi.fn(async () => ({
      data: { plan: { name: "team" } },
    })),
    discovery: vi.fn(
      async (): Promise<
        Awaited<ReturnType<typeof listDashboardRepositoryAccess>>
      > => ({
        status: "ready" as const,
        workspaceIds: ["workspace-a"],
        repositoryIds: new Set(["repo-a"]),
        directConfigRepositoryIds: new Set<string>(),
        checkedAt: new Date("2026-09-01"),
      }),
    ),
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
    workspaceAdmin: vi.fn(async () => false),
    skillsDashboard: vi.fn(async () => ({ status: "signed_out" as const })),
    providerList: vi.fn(async () => ({ rows: [] }) as never),
    gatewayAccounts: vi.fn(async () => ({ status: "unavailable" as const })),
    gatewayHydration: vi.fn(
      async (
        ...args: [
          string,
          unknown,
          AccountsResult<AccountsPage> | undefined,
          readonly string[],
        ]
      ) => args[2],
    ),
  };
  return { spies, EmptyStore: class {} };
});
const { spies } = fixtures;

vi.mock("../../src/server/dashboard-gateway-accounts", () => ({
  loadDashboardPersonalAccounts: async () => null,
  loadDashboardGatewayAccounts: fixtures.spies.gatewayAccounts,
  hydrateDashboardGatewayAccounts: fixtures.spies.gatewayHydration,
}));
vi.mock(
  "../../src/server/prisma-gateway-review-v2-provisioning",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/server/prisma-gateway-review-v2-provisioning")
    >()),
    readGatewayReviewV2RepositoryReadiness: async () => new Map(),
  }),
);

vi.mock("../../src/server/review-skills-dashboard", () => ({
  loadReviewSkillsDashboard: fixtures.spies.skillsDashboard,
}));
vi.mock("./dashboard-action-form", () => ({
  DashboardActionForm: ({
    children,
  }: {
    readonly children: React.ReactNode;
  }) => <form>{children}</form>,
}));
vi.mock("./account-gateway-accounts-section", () => ({
  AccountGatewayAccountsSection: ({
    workspaceName,
  }: {
    workspaceName?: string;
  }) => <section>Your accounts; Accounts in {workspaceName}</section>,
}));
vi.mock("./hosted-pool-settings", () => ({
  HostedPoolSettingsPanel: () => <section>Hosted pool accounts</section>,
  RepositorySessionSourceSelector: () => null,
}));
vi.mock("./actions", () => ({
  importHostedPoolAccountClientAction: vi.fn(),
  startHostedPoolDeviceLoginClientAction: vi.fn(),
  pollHostedPoolDeviceLoginClientAction: vi.fn(),
  setHostedPoolAccountStateClientAction: vi.fn(),
  removeHostedPoolAccountClientAction: vi.fn(),
  setHostedRepositorySessionSourceClientAction: vi.fn(),
}));
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
vi.mock("./provider-setup-actions", () => ({
  inheritWorkspaceDefaultProviderAction: vi.fn(),
  saveProviderSetupAction: vi.fn(),
}));
vi.mock("../../src/server/dashboard-provider-selections", () => ({
  dashboardProviderProfiles: () => ({ list: async () => [] }),
}));
vi.mock("../../src/server/provider-list-view", () => ({
  loadProviderListView: fixtures.spies.providerList,
}));
vi.mock("../../src/server/dashboard-mutations", () => ({
  createGitHubAppInstallationOctokit: async () => ({
    request: fixtures.spies.organizationRequest,
  }),
  getDashboardMutationStatus: async () => ({
    signedIn: true,
    enabled: true,
    sourceLogin: "owner",
    sourceAvatarUrl: null,
  }),
  getDashboardWorkspaceScope: identity.scope,
  getDashboardSignedInActor: identity.actor,
  asDashboardGitHubActor: (actor: unknown) => actor,
  canDashboardActorAdminWorkspace: fixtures.spies.workspaceAdmin,
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
  getProviderModelCatalogs: vi.fn(async () => []),
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
  freeBetaEntitlement: () => ({ flags: { hosted_codex_pool: true } }),
  evaluateFeatureEntitlement: () => ({ allowed: true }),
}));
vi.mock("@reviewrouter/features-review-config", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@reviewrouter/features-review-config")
  >()),
  PrismaReviewPolicyHeadReader: fixtures.EmptyStore,
  resolveEffectiveReviewConfigurations: fixtures.spies.policies,
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
  simulateMemoryPolicyDecision: fixtures.spies.memorySimulation,
  listMemoryItemsForDashboard: fixtures.spies.memoryItems,
  listMemorySuggestionsForDashboard: fixtures.spies.memorySuggestions,
}));
vi.mock("@reviewrouter/features-memory/infrastructure", () => ({
  PrismaMemoryPermission: fixtures.EmptyStore,
  PrismaMemoryItemRepository: fixtures.EmptyStore,
  PrismaMemorySuggestionRepository: fixtures.EmptyStore,
  EntitlementMemoryQuotaPolicy: fixtures.EmptyStore,
  EntitlementMemoryPolicyConfig: class {
    getPolicy = fixtures.spies.memoryPolicy;
  },
  readMemoryServiceEnabled: () => true,
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
afterEach(() => vi.restoreAllMocks());

describe("dashboard server loading boundaries", () => {
  it.each([
    ["token_encryption_misconfigured", "token_encryption_key_missing"],
    ["token_refresh_failed", "github_oauth_client_misconfigured"],
  ] as const)(
    "keeps available workspace content and offers support for %s",
    async (status, errorCode) => {
      spies.repositories.mockResolvedValueOnce([]);
      const data = await loadDashboardSectionData(workspace, "policy", access);
      const html = renderToStaticMarkup(
        <WorkspaceCard
          data={data}
          mutationsEnabled
          selectedSection="policy"
          params={{}}
          repositoryAccess={{ ...access, status, errorCode }}
          workspaceKey="acme"
          appInstallUrl={null}
          modelOptions={[]}
        />,
      );
      expect(html).toContain("Save workspace settings");
      expect(html).toContain('aria-label="GitHub repository access"');
      expect(html).toContain('href="/support"');
      expect(html).toContain("Contact support");
      expect(html).not.toMatch(
        /Refresh (?:GitHub )?access|Reconnect GitHub|REVIEW_ROUTER_TOKEN|encryption|github_oauth_client_misconfigured/,
      );
    },
  );

  it("gives the same support action in the empty dashboard without exposing the internal cause", async () => {
    identity.scope.mockResolvedValueOnce({
      kind: "workspace_ids",
      workspaceIds: [],
    });
    identity.actor.mockResolvedValueOnce({
      sourceProvider: "github",
      userId: "user_1",
      githubLogin: "owner",
    });
    spies.discovery.mockResolvedValueOnce({
      ...access,
      status: "token_encryption_misconfigured",
      workspaceIds: [],
      repositoryIds: new Set(),
      errorCode: "token_encryption_key_missing",
    });
    const html = renderToStaticMarkup(await DashboardWorkspacePage({}));
    expect(html).toContain('href="/support"');
    expect(html).toContain("Contact support");
    expect(html).toContain("Connect source");
    expect(html).not.toMatch(
      /Refresh GitHub access|Reconnect GitHub|Status:|token_encryption|REVIEW_ROUTER_TOKEN/,
    );
    expect(spies.discovery).toHaveBeenCalledOnce();
  });

  it("hydrates the complete saved workspace and repository reviewer roster once after loading account metadata", async () => {
    const provider = (gatewayBindingId: string) => ({
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId,
      gatewayProfileRef: "openrouter-openai-responses-apikey-v1",
      model: "openai/gpt-4.1",
    });
    const config = {
      providers: [provider("binding_1"), provider("binding_2")],
    };
    const workspaceConfig = {
      providers: [provider("binding_workspace")],
    };
    const ready = {
      status: "ready",
      config,
      policy: { schemaVersion: 4 },
      effectivePolicyDigest: "sha256:test",
      revisionToken: "policy:test",
      source: "repository",
      workspaceVersion: 1,
      repositoryVersion: 1,
    } as unknown as Extract<EffectiveReviewConfiguration, { status: "ready" }>;
    spies.policies.mockResolvedValueOnce({
      workspace: {
        ...ready,
        config: workspaceConfig,
        source: "workspace",
        repositoryVersion: null,
      } as unknown as Extract<
        EffectiveReviewConfiguration,
        { status: "ready" }
      >,
      repositories: new Map([["repo-a", ready]]),
      workspacePolicy: null,
      repositoryPolicies: new Map(),
    });
    await DashboardSectionContent({
      context: {
        mutationStatus: {
          enabled: true,
          signedIn: true,
          sourceProvider: "github",
          externalUserId: "github-user-a",
          sourceLogin: "owner",
          sourceAvatarUrl: null,
          githubUserId: "github-user-a",
          githubLogin: "owner",
          githubAvatarUrl: null,
          reason: "ready",
        },
        workspaceScope: { kind: "all", reason: "local_admin_override" },
        signedInActor: null,
        repositoryAccess: access,
        workspaces: [workspace],
      },
      selectedWorkspace: workspace,
      selectedSection: "repositories",
      params: {},
      workspaceKey: "acme",
    });
    expect(spies.gatewayAccounts).toHaveBeenCalledExactlyOnceWith(
      "workspace-a",
      null,
    );
    expect(spies.gatewayHydration).toHaveBeenCalledExactlyOnceWith(
      "workspace-a",
      null,
      { status: "unavailable" },
      ["binding_workspace", "binding_1", "binding_2"],
    );
  });
  it.each([
    ["acme", "workspace-a", "acme"],
    ["second", "workspace-b", "second"],
    ["unknown", "workspace-a", "acme"],
  ])(
    "redirects the Context tools section to the authorized workspace selected by %s",
    async (requested, id, key) => {
      spies.summaries.mockResolvedValueOnce([
        {
          id: "workspace-a",
          name: "acme",
          slug: "acme",
          installations: [],
          gitLabInstallations: [],
          repositories: [{ owner: "acme" }],
          _count: { repositories: 2 },
        },
        {
          id: "workspace-b",
          name: "second",
          slug: "second",
          installations: [],
          gitLabInstallations: [],
          repositories: [{ owner: "second" }],
          _count: { repositories: 2 },
        },
      ]);
      await expect(
        DashboardWorkspacePage({
          searchParams: Promise.resolve({
            section: "context-tools",
            workspace: requested,
            workspaceId: "unauthorized-workspace",
          }),
        }),
      ).rejects.toThrow("NEXT_REDIRECT");
      expect(redirect).toHaveBeenCalledWith(
        `/dashboard/context-tools?workspaceId=${id}&workspace=${key}`,
      );
    },
  );

  it("starts unrelated workspace reads while policy reads wait for scoped metadata", async () => {
    let resolveRepositories!: (
      value: Awaited<ReturnType<typeof spies.repositories>>,
    ) => void;
    spies.repositories.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRepositories = resolve;
        }),
    );
    const withInstallation = {
      ...workspace,
      workspace: {
        ...workspace.workspace,
        installations: [
          {
            accountLogin: "Acme",
            accountType: "Organization",
            accountAvatarUrl: null,
            githubInstallationId: "900004",
            status: "active",
            repositorySelection: "all",
            organizationSecretPolicy: null,
          },
        ],
      },
    };

    const loading = loadDashboardSectionData(
      withInstallation,
      "repositories",
      access,
    );
    try {
      expect(spies.repositories).toHaveBeenCalledOnce();
      expect(spies.health).toHaveBeenCalledOnce();
      expect(spies.policies).not.toHaveBeenCalled();
      expect(spies.ruleset).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(spies.organizationRequest).toHaveBeenCalledOnce(),
      );
      expect(spies.provisioning).not.toHaveBeenCalled();
      expect(spies.hostedPool).not.toHaveBeenCalled();
    } finally {
      resolveRepositories([
        {
          id: "repo-a",
          workspaceId: "workspace-a",
          owner: "acme",
          fullName: "acme/test",
          visibility: "private",
          selected: true,
          archived: false,
        },
      ]);
      await loading;
    }
  });

  it("keeps opaque head revisions of only the visible targets for CAS", async () => {
    spies.policies.mockResolvedValueOnce({
      workspace: {
        status: "resave_required",
        workspaceVersion: 3,
        repositoryVersion: null,
      },
      repositories: new Map([
        [
          "repo-a",
          {
            status: "resave_required",
            workspaceVersion: 3,
            repositoryVersion: 11,
          },
        ],
      ]),
      workspacePolicy: null,
      repositoryPolicies: new Map([["repo-a", null]]),
    });
    const data = await loadDashboardSectionData(
      { ...workspace, hasWorkspaceWideAccess: false },
      "policy",
      access,
    );
    expect(spies.policies).toHaveBeenCalledExactlyOnceWith(
      { workspaceId: "workspace-a", repositoryIds: ["repo-a"] },
      expect.anything(),
    );
    expect(data.reviewConfig).toBeNull();
    expect(data.reviewConfigExpectedVersion).toBe(3);
    expect(data.repositoryConfigs).toEqual([
      {
        repositoryId: "repo-a",
        config: null,
        effective: null,
        status: "resave_required",
        expectedVersion: 11,
        policy: null,
      },
    ]);
  });

  it("uses the revisions of the parsed policies for CAS", async () => {
    const ready = {
      status: "ready",
      config: {},
      policy: { schemaVersion: 4 },
      effectivePolicyDigest: "sha256:test",
      revisionToken: "policy:test",
    } as unknown as Extract<EffectiveReviewConfiguration, { status: "ready" }>;
    spies.policies.mockResolvedValueOnce({
      workspace: {
        ...ready,
        version: 4,
        source: "workspace",
        workspaceVersion: 4,
        repositoryVersion: null,
      },
      repositories: new Map([
        [
          "repo-a",
          {
            ...ready,
            version: 12,
            source: "repository",
            workspaceVersion: 4,
            repositoryVersion: 12,
          },
        ],
      ]),
      workspacePolicy: null,
      repositoryPolicies: new Map([["repo-a", null]]),
    });
    const data = await loadDashboardSectionData(
      { ...workspace, hasWorkspaceWideAccess: false },
      "policy",
      access,
    );
    expect(data.reviewConfigExpectedVersion).toBe(4);
    expect(data.repositoryConfigs[0]).toMatchObject({
      config: { version: 12, source: "repository" },
      expectedVersion: 12,
    });
    expect(data.repositoryConfigs[0]?.config).not.toHaveProperty("status");
  });

  it("sends null CAS for inactive or new targets without borrowing the workspace revision", async () => {
    // The head reader excludes inactive configurations, even with retained versions.
    const data = await loadDashboardSectionData(workspace, "policy", access);
    expect(data.reviewConfigExpectedVersion).toBeNull();
    expect(
      data.repositoryConfigs.every((item) => item.expectedVersion === null),
    ).toBe(true);
  });

  it("observes early read failures while repositories are pending", async () => {
    let resolveRepositories!: (
      value: Awaited<ReturnType<typeof spies.repositories>>,
    ) => void;
    spies.repositories.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRepositories = resolve;
        }),
    );
    spies.health.mockRejectedValueOnce(new Error("health unavailable"));

    const loading = loadDashboardSectionData(workspace, "repositories", access);
    await Promise.resolve();
    resolveRepositories([]);
    await expect(loading).rejects.toThrow("health unavailable");
  });

  it("waits for repository visibility before exposing scoped installations", async () => {
    let resolveRepositories!: (
      value: Awaited<ReturnType<typeof spies.repositories>>,
    ) => void;
    spies.repositories.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRepositories = resolve;
        }),
    );
    const scopedWorkspace = {
      ...workspace,
      hasWorkspaceWideAccess: false,
      workspace: {
        ...workspace.workspace,
        installations: ["acme", "hidden"].map((accountLogin, index) => ({
          accountLogin,
          accountType: "Organization",
          accountAvatarUrl: null,
          githubInstallationId: String(900010 + index),
          status: "active",
          repositorySelection: "all",
          organizationSecretPolicy: null,
        })),
      },
    };

    const loading = loadDashboardSectionData(
      scopedWorkspace,
      "repositories",
      access,
    );
    expect(spies.organizationRequest).not.toHaveBeenCalled();
    resolveRepositories([
      {
        id: "repo-a",
        workspaceId: "workspace-a",
        owner: "acme",
        fullName: "acme/test",
        visibility: "private",
        selected: true,
        archived: false,
      },
      {
        id: "repo-hidden",
        workspaceId: "workspace-a",
        owner: "hidden",
        fullName: "hidden/test",
        visibility: "private",
        selected: true,
        archived: false,
      },
    ]);
    const data = await loading;
    expect(
      data.workspace.installations.map(({ accountLogin }) => accountLogin),
    ).toEqual(["acme"]);
    expect(spies.organizationRequest).not.toHaveBeenCalled();
  });

  it("starts provider readiness before an unrelated hosted pool read completes", async () => {
    let resolveHostedPool!: (
      value: Awaited<ReturnType<typeof spies.hostedPool>>,
    ) => void;
    const hostedPoolPending = new Promise<
      Awaited<ReturnType<typeof spies.hostedPool>>
    >((resolve) => {
      resolveHostedPool = resolve;
    });
    spies.hostedPool.mockImplementationOnce(() => hostedPoolPending);

    const loading = loadDashboardSectionData(workspace, "repositories", access);
    await vi.waitFor(() => expect(spies.providerSetup).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(spies.readiness).toHaveBeenCalledOnce());
    expect(spies.readiness).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSetup: [],
        workspaceId: "workspace-a",
      }),
    );

    resolveHostedPool({
      gate: "enabled",
      pool: null,
      accounts: [],
      repositories: [],
    });
    await loading;
  });

  it("single-flights and caches organization plan presentation metadata", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    let resolveOrganization!: (value: {
      data: { plan: { name: string } };
    }) => void;
    spies.organizationRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOrganization = resolve;
        }),
    );
    const withInstallation = {
      ...workspace,
      workspace: {
        ...workspace.workspace,
        installations: [
          {
            accountLogin: "Acme",
            accountType: "Organization",
            accountAvatarUrl: null,
            githubInstallationId: "900001",
            status: "active",
            repositorySelection: "all",
            organizationSecretPolicy: null,
          },
        ],
      },
    };

    const first = loadDashboardSectionData(
      withInstallation,
      "repositories",
      access,
    );
    const second = loadDashboardSectionData(
      withInstallation,
      "repositories",
      access,
    );
    await vi.waitFor(() =>
      expect(spies.organizationRequest).toHaveBeenCalledOnce(),
    );
    resolveOrganization({ data: { plan: { name: "Team" } } });
    const results = await Promise.all([first, second]);
    expect(
      results[0]?.workspace.installations[0]?.organizationSecretPolicy,
    ).toEqual({
      planName: "team",
      privateRepositoriesAvailable: true,
      status: "available",
    });
    await loadDashboardSectionData(withInstallation, "repositories", access);
    expect(spies.organizationRequest).toHaveBeenCalledOnce();

    await loadDashboardSectionData(
      {
        ...withInstallation,
        workspace: {
          ...withInstallation.workspace,
          installations: [
            {
              ...withInstallation.workspace.installations[0]!,
              accountLogin: "Other",
            },
          ],
        },
      },
      "repositories",
      access,
    );
    expect(spies.organizationRequest).toHaveBeenCalledTimes(2);

    now.mockReturnValue(5 * 60 * 1000 + 1000);
    await loadDashboardSectionData(withInstallation, "repositories", access);
    expect(spies.organizationRequest).toHaveBeenCalledTimes(3);
  });

  it("preserves permission and missing-plan statuses on organization lookup failure", async () => {
    spies.organizationRequest
      .mockRejectedValueOnce({ status: 403 })
      .mockRejectedValueOnce({ status: 404 });
    const installation = (githubInstallationId: string) => ({
      ...workspace,
      workspace: {
        ...workspace.workspace,
        installations: [
          {
            accountLogin: "Acme",
            accountType: "Organization",
            accountAvatarUrl: null,
            githubInstallationId,
            status: "active",
            repositorySelection: "all",
            organizationSecretPolicy: null,
          },
        ],
      },
    });
    const denied = await loadDashboardSectionData(
      installation("900002"),
      "repositories",
      access,
    );
    const missing = await loadDashboardSectionData(
      installation("900003"),
      "repositories",
      access,
    );
    expect(
      denied.workspace.installations[0]?.organizationSecretPolicy?.status,
    ).toBe("permission_required");
    expect(
      missing.workspace.installations[0]?.organizationSecretPolicy?.status,
    ).toBe("unknown");
  });
  it("shares one persistent route layout across dashboard and Accounts while keeping previews outside it", () => {
    const route = (path: string) => new URL(path, import.meta.url);
    const workspacePageSource = readFileSync(
      route("./dashboard-workspace-page.tsx"),
      "utf8",
    );
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
    expect(workspacePageSource).toContain("readParam(params.repository)");
    expect(workspacePageSource).toContain(
      "<NavigationContentReady completionKey={sectionBoundaryKey} />",
    );
    expect(workspacePageSource.match(/<NavigationContentReady/g)).toHaveLength(
      2,
    );
    expect(workspacePageSource).not.toContain(
      "selectedSection,\n          params,",
    );
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
      if (section === "setup") {
        expect(spies.repositories).not.toHaveBeenCalled();
      } else {
        expect(spies.repositories).toHaveBeenCalledExactlyOnceWith(
          "workspace-a",
        );
      }
      expect(spies.memoryItems).not.toHaveBeenCalled();
      expect(spies.memorySuggestions).not.toHaveBeenCalled();
      expect(spies.memoryPolicy).not.toHaveBeenCalled();
      expect(spies.memorySimulation).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "renders Connections within Providers without requesting policy (admin %s)",
    async (hasWorkspaceWideAccess) => {
      const data = await loadDashboardSectionData(
        { ...workspace, hasWorkspaceWideAccess },
        "setup",
        access,
      );
      expect(data.reviewConfig).toBeNull();
      const html = renderToStaticMarkup(
        <WorkspaceCard
          data={data}
          mutationsEnabled
          selectedSection="setup"
          params={{}}
          repositoryAccess={access}
          workspaceKey="acme"
          appInstallUrl={null}
          modelOptions={[]}
        />,
      );
      expect(html).toContain("Accounts in acme");
      expect(html).toContain("Your accounts");
      expect(html).not.toContain(">Accounts</h2>");
      expect(html).toContain(">Providers</h2>");
      expect(html).toContain('aria-label="Providers"');
      expect(html).toContain(">Connections</a>");
      expect(html).toContain(">Review providers</a>");
      expect(html).toContain("/dashboard/setup?workspace=acme");
      expect(html).toContain("Choose providers and models for reviews");
      expect(html).not.toContain("Save workspace review settings");
      expect(html).not.toContain("retired format");
      expect(html.includes("Hosted pool accounts")).toBe(
        hasWorkspaceWideAccess,
      );
      expect(spies.policies).not.toHaveBeenCalled();
    },
  );

  it("preserves the validated provider setup continuation across Providers views", async () => {
    const data = await loadDashboardSectionData(workspace, "setup", access);
    const html = renderToStaticMarkup(
      <WorkspaceCard
        data={data}
        mutationsEnabled
        selectedSection="setup"
        params={{
          keyProvider: "openrouter",
          keyStorage: "reviewrouter",
          keyWorkspace: "workspace-a",
          keyRepository: ["repo-a", "repo-b"],
        }}
        repositoryAccess={access}
        workspaceKey="acme"
        appInstallUrl={null}
        modelOptions={[]}
      />,
    );
    expect(html).toContain(
      "/dashboard?workspace=workspace-a&amp;keyProvider=openrouter&amp;keyStorage=reviewrouter&amp;keyWorkspace=workspace-a&amp;section=providers&amp;keyRepository=repo-a&amp;keyRepository=repo-b",
    );
    expect(html).toContain(
      "/dashboard/setup?workspace=workspace-a&amp;keyProvider=openrouter&amp;keyStorage=reviewrouter&amp;keyWorkspace=workspace-a&amp;keyRepository=repo-a&amp;keyRepository=repo-b",
    );
  });

  it.each(["provider_selection_required", "resave_required"] as const)(
    "keeps Review settings focused on behavior and points to Providers (%s)",
    async (reviewConfigStatus) => {
      spies.repositories.mockResolvedValueOnce([]);
      const data = await loadDashboardSectionData(workspace, "policy", access);
      const html = renderToStaticMarkup(
        <WorkspaceCard
          data={{ ...data, reviewConfigStatus }}
          mutationsEnabled
          selectedSection="policy"
          params={{}}
          repositoryAccess={access}
          workspaceKey="acme"
          appInstallUrl={null}
          modelOptions={[]}
        />,
      );
      expect(html).toContain(">Review settings</h2>");
      expect(html).toContain('aria-label="Default review provider"');
      expect(html).toContain(
        reviewConfigStatus === "resave_required"
          ? "Default provider unavailable: saved settings use a retired format."
          : "No default provider selected.",
      );
      expect(html).toContain("Manage providers and workspace default");
      expect(html).toContain("/dashboard?section=providers&amp;workspace=acme");
      expect(html).not.toContain("Choose a provider");
    },
  );

  it("renders Other without model configuration or repository health", async () => {
    const data = await loadDashboardSectionData(workspace, "setup", access);
    const html = renderToStaticMarkup(
      <WorkspaceCard
        data={{
          ...data,
          reviewDraftPullRequests: true,
          canEditOtherSettings: true,
        }}
        mutationsEnabled
        selectedSection="other"
        params={{}}
        repositoryAccess={access}
        workspaceKey="acme"
        appInstallUrl={null}
        modelOptions={[]}
      />,
    );
    expect(html).toContain(">Other</h2>");
    expect(html).toContain("Review draft pull requests");
    expect(html).toContain('name="reviewDraftPullRequests"');
    expect(html).toContain('checked=""');
    expect(html).not.toContain("Metadata only");
    expect(html).not.toContain("Save workspace review settings");
    expect(spies.policies).not.toHaveBeenCalled();
    expect(spies.health).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "loads Other from the workspace and the admin mutation gate (admin=%s)",
    async (admin) => {
      const actor = {
        userId: "user-a",
        sourceProvider: "github" as const,
        externalUserId: "1",
        sourceLogin: "member",
        githubUserId: "1",
        githubLogin: "member",
        actor: "user:github:member",
      };
      spies.audit.mockResolvedValueOnce({
        reviewDraftPullRequests: true,
      } as never);
      spies.workspaceAdmin.mockResolvedValueOnce(admin);
      const data = await loadDashboardSectionData(
        workspace,
        "other",
        access,
        undefined,
        actor,
      );
      expect(data.reviewDraftPullRequests).toBe(true);
      expect(data.canEditOtherSettings).toBe(admin);
      expect(spies.workspaceAdmin).toHaveBeenCalledWith({
        actor,
        workspaceId: "workspace-a",
      });
      expect(spies.policies).not.toHaveBeenCalled();
      expect(spies.health).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "reads the Providers list only for workspace members (member=%s)",
    async (hasWorkspaceWideAccess) => {
      const actor = {
        userId: "user-a",
        sourceProvider: "github" as const,
        externalUserId: "1",
        sourceLogin: "member",
        githubUserId: "1",
        githubLogin: "member",
        actor: "user:github:member",
      };
      const data = await loadDashboardSectionData(
        { ...workspace, hasWorkspaceWideAccess },
        "providers",
        access,
        undefined,
        actor,
      );
      if (hasWorkspaceWideAccess) {
        expect(spies.providerList).toHaveBeenCalledWith(
          expect.objectContaining({ workspaceId: "workspace-a", actor }),
        );
        expect(data.providerList).toEqual({ rows: [] });
      } else {
        expect(spies.providerList).not.toHaveBeenCalled();
        expect(data.providerList).toBeNull();
      }
      expect(spies.policies).not.toHaveBeenCalled();
      expect(spies.health).not.toHaveBeenCalled();
    },
  );

  it("loads account summaries without reading per-repository hosted bindings", async () => {
    const data = await loadDashboardSectionData(workspace, "setup", access);
    expect(data.repositoryCount).toBe(2);
    expect(spies.repositories).not.toHaveBeenCalled();
    expect(spies.hostedPool).toHaveBeenCalledWith(
      expect.objectContaining({
        featureEnabled: true,
        repositories: [],
      }),
    );
  });

  it.each(["setup", "memory"] as const)(
    "skips configuration, readiness, diagnostics and audit for %s",
    async (section) => {
      await loadDashboardSectionData(workspace, section, access);
      for (const spy of [
        spies.policies,
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

  it.each([true, false])(
    "cannot load memory through the retired section loader (workspace admin %s)",
    async (hasWorkspaceWideAccess) => {
      await loadDashboardSectionData(
        { ...workspace, hasWorkspaceWideAccess },
        "memory",
        access,
      );
      expect(spies.memoryItems).not.toHaveBeenCalled();
      expect(spies.memorySuggestions).not.toHaveBeenCalled();
      expect(spies.memoryPolicy).not.toHaveBeenCalled();
      expect(spies.memorySimulation).not.toHaveBeenCalled();
    },
  );

  it.each(["knowledge", "suggestions", "table"])(
    "loads authorized memory through its new facade without reactivating legacy mode %s",
    async (memoryMode) => {
      const content = await DashboardSectionContent({
        context: {
          mutationStatus: {
            enabled: true,
            signedIn: true,
            sourceProvider: "github",
            externalUserId: "github-user-a",
            sourceLogin: "owner",
            sourceAvatarUrl: null,
            githubUserId: "github-user-a",
            githubLogin: "owner",
            githubAvatarUrl: null,
            reason: "ready",
          },
          workspaceScope: { kind: "all", reason: "local_admin_override" },
          signedInActor: null,
          repositoryAccess: access,
          workspaces: [workspace],
        },
        selectedWorkspace: workspace,
        selectedSection: "memory",
        params: {
          memory_mode: memoryMode,
          status: "pending",
          notice: "memory_saved",
          memory: "previous-item",
        },
        workspaceKey: "acme",
      });
      const html = renderToStaticMarkup(content);
      expect(html).toContain("Approved memory");
      expect(html).not.toContain("previous-item");
      expect(memoryKnowledge.load).toHaveBeenCalledExactlyOnceWith({
        workspaceId: "workspace-a",
        repositoryId: null,
        cursor: null,
        topicId: null,
      });
      for (const spy of Object.values(spies)) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

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
    expect(spies.policies).toHaveBeenCalledExactlyOnceWith(
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
  it("returns the isolated Statistics section before unrelated section IO", async () => {
    const content = await DashboardSectionContent({
      context: {
        mutationStatus: {
          enabled: true,
          signedIn: true,
          sourceProvider: "github",
          externalUserId: "github-user-a",
          sourceLogin: "owner",
          sourceAvatarUrl: null,
          githubUserId: "github-user-a",
          githubLogin: "owner",
          githubAvatarUrl: null,
          reason: "ready",
        },
        workspaceScope: {
          kind: "workspace_ids",
          workspaceIds: ["workspace-a"],
        },
        signedInActor: null,
        repositoryAccess: access,
        workspaces: [workspace],
      },
      selectedWorkspace: workspace,
      selectedSection: "statistics",
      params: { statisticsDays: ["7", "30"], statisticsSeverity: "major" },
      workspaceKey: "acme",
    });
    expect(content.props).toEqual({
      workspaceId: "workspace-a",
      params: { statisticsDays: ["7", "30"], statisticsSeverity: "major" },
    });
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });
});
