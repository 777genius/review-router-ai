import {
  credentialSourceFixture,
  providerProfileFixture,
  providerProfileRowFixture,
  repositoryPolicyDocumentFixture,
  storedPolicyHeadFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "../../../../../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  parseReviewConfigurationStrict,
  type WorkspaceProviderProfile,
} from "@reviewrouter/features-review-config";
import { projectRepositorySetupStatus } from "@reviewrouter/features-workflow-provisioning";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSetupRecoveryIssue } from "../../../../dashboard/dashboard-copy";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../../../src/server/account-gateway-accounts";
import { resolveDashboardRepositoryReadiness } from "../../../../../src/server/dashboard-repository-readiness";
import type { HostedPoolDashboardView } from "../../../../../src/server/hosted-pool-dashboard";
import type { GatewayReviewV2RepositoryReadiness } from "../../../../../src/server/prisma-gateway-review-v2-provisioning";

const mocks = vi.hoisted(() => ({
  getDashboardSignedInActor: vi.fn(),
  getDashboardWorkspaceScope: vi.fn(),
  deriveDashboardProviderSetupReadiness: vi.fn(),
  listGitHubUserRepositoryAccess: vi.fn(),
  listWorkspaceRepositoryHealth: vi.fn(),
  providerSetupFindMany: vi.fn(),
  reviewConfigurationFindUnique: vi.fn(),
  reviewConfigurationFindMany: vi.fn(),
  providerProfileFindMany: vi.fn(),
  repositoryConnectionFindMany: vi.fn(),
  workspaceFindMany: vi.fn(),
  loadHostedPoolDashboardView: vi.fn(),
  loadDashboardGatewayAccounts: vi.fn(),
  readGatewayReviewV2RepositoryReadiness: vi.fn(),
}));

vi.mock("@reviewrouter/features-repo-health", () => ({
  listWorkspaceRepositoryHealth: mocks.listWorkspaceRepositoryHealth,
  PrismaRepositoryHealthRepository: class PrismaRepositoryHealthRepository {},
}));

vi.mock("@reviewrouter/platform-config", () => ({
  isHostedCodexPoolEnabled: () => true,
  requireReviewRouterDatabaseRecoveryWitness: () => "w".repeat(43),
  resolveReviewRouterActionRef: () => "reviewrouter/action@v1",
}));

vi.mock("@reviewrouter/features-entitlements", () => ({
  PrismaEntitlementRepository: class {
    findWorkspaceEntitlement = async () => null;
  },
  freeBetaEntitlement: () => ({}),
  evaluateFeatureEntitlement: () => ({ allowed: true }),
}));

vi.mock(
  "../../../../../src/server/hosted-pool-dashboard",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../src/server/hosted-pool-dashboard")
    >()),
    loadHostedPoolDashboardView: mocks.loadHostedPoolDashboardView,
  }),
);

vi.mock("../../../../../src/server/dashboard-gateway-accounts", () => ({
  loadDashboardPersonalAccounts: async () => null,
  loadDashboardGatewayAccounts: mocks.loadDashboardGatewayAccounts,
}));

vi.mock(
  "../../../../../src/server/prisma-gateway-review-v2-provisioning",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../../../../src/server/prisma-gateway-review-v2-provisioning")
    >()),
    readGatewayReviewV2RepositoryReadiness:
      mocks.readGatewayReviewV2RepositoryReadiness,
  }),
);

vi.mock("../../../../../src/server/dashboard-mutations", () => ({
  asDashboardGitHubActor: (
    actor: {
      readonly sourceProvider?: string;
      readonly githubUserId?: string | null;
      readonly githubLogin?: string | null;
    } | null,
  ) =>
    actor?.sourceProvider === "github" &&
    actor.githubUserId &&
    actor.githubLogin
      ? actor
      : null,
  getDashboardSignedInActor: mocks.getDashboardSignedInActor,
  getDashboardWorkspaceScope: mocks.getDashboardWorkspaceScope,
}));

vi.mock("../../../../../src/server/github-user-repository-access", () => ({
  listGitHubUserRepositoryAccess: mocks.listGitHubUserRepositoryAccess,
}));

vi.mock(
  "../../../../../src/server/dashboard-codex-rotating-setup-readiness",
  () => ({
    deriveDashboardProviderSetupReadiness:
      mocks.deriveDashboardProviderSetupReadiness,
  }),
);

vi.mock("../../../../../src/server/prisma", () => ({
  getPrisma: () => ({
    providerSetupState: { findMany: mocks.providerSetupFindMany },
    reviewConfiguration: {
      findUnique: mocks.reviewConfigurationFindUnique,
      findMany: mocks.reviewConfigurationFindMany,
    },
    workspaceProviderProfile: { findMany: mocks.providerProfileFindMany },
    repositoryConnection: { findMany: mocks.repositoryConnectionFindMany },
    workspace: { findMany: mocks.workspaceFindMany },
  }),
}));

import { GET } from "./route";

describe("dashboard repository search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDashboardSignedInActor.mockResolvedValue({
      userId: "user_1",
      sourceProvider: "github",
      externalUserId: "123",
      sourceLogin: "maintainer",
      githubUserId: "123",
      githubLogin: "maintainer",
      actor: "user:maintainer",
    });
    mocks.workspaceFindMany.mockResolvedValue([
      {
        id: "workspace_1",
        slug: "fin-int",
        name: "Fin Int",
        installations: [{ accountLogin: "fin-int" }],
      },
    ]);
    mocks.providerSetupFindMany.mockResolvedValue([]);
    mocks.loadHostedPoolDashboardView.mockImplementation(
      async (input: {
        readonly repositories: readonly {
          readonly id: string;
          readonly fullName: string;
          readonly visibility: string;
        }[];
      }) => hostedPoolView(input.repositories, []),
    );
    mocks.loadDashboardGatewayAccounts.mockResolvedValue({
      status: "unavailable",
    });
    mocks.readGatewayReviewV2RepositoryReadiness.mockResolvedValue(new Map());
    // The workspace has no default provider; every repository selects its
    // own rotating Codex profile unless a test stores another selection.
    testProfiles.clear();
    mocks.reviewConfigurationFindUnique.mockResolvedValue({
      active: true,
      repositoryId: null,
      versions: [
        storedPolicyHeadFixture(
          workspacePolicyDocumentFixture(workspacePolicyFixture),
        ),
      ],
    });
    mocks.reviewConfigurationFindMany.mockImplementation(
      async (input: RepositoryHeadsQuery) =>
        input.where.repositoryId.in.map((repositoryId) => ({
          repositoryId,
          versions: [repositoryPolicyRow(repositoryId)],
        })),
    );
    mocks.providerProfileFindMany.mockImplementation(
      async (input: { readonly where: { readonly id: { in: string[] } } }) =>
        input.where.id.in.flatMap((id) => {
          const profile = testProfiles.get(id);
          return profile ? [providerProfileRowFixture(profile)] : [];
        }),
    );
    mocks.listWorkspaceRepositoryHealth.mockResolvedValue([]);
    mocks.deriveDashboardProviderSetupReadiness.mockImplementation(
      async (input: { readonly providerSetup: readonly unknown[] }) =>
        input.providerSetup,
    );
  });

  it("filters repo-only search results to repositories the GitHub user can manage", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: [],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: ["workspace_1"],
      repositoryIds: new Set(["repo_allowed"]),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: new Date("2026-05-12T10:00:00Z"),
    });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({ id: "repo_allowed", fullName: "fin-int/tvaity" }),
    ]);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int&q=tvaity",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: ["repo_allowed"],
      repositories: [
        {
          id: "repo_allowed",
          fullName: "fin-int/tvaity",
          provider: "github",
        },
      ],
      total: 1,
      query: "tvaity",
      filter: "all",
    });
    expect(mocks.repositoryConnectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "workspace_1",
          id: { in: ["repo_allowed"] },
        },
      }),
    );
  });

  it("lists repositories without readiness, hosted pool or Gateway reads when nothing filters", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({ kind: "all" });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({ id: "repo_1", fullName: "fin-int/tvaity" }),
    ]);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: ["repo_1"],
      total: 1,
      filter: "all",
    });
    expect(mocks.listWorkspaceRepositoryHealth).not.toHaveBeenCalled();
    expect(mocks.reviewConfigurationFindUnique).not.toHaveBeenCalled();
    expect(mocks.loadHostedPoolDashboardView).not.toHaveBeenCalled();
    expect(mocks.loadDashboardGatewayAccounts).not.toHaveBeenCalled();
    expect(mocks.readGatewayReviewV2RepositoryReadiness).not.toHaveBeenCalled();
  });

  it("keeps workspace-admin search unrestricted by repository permission cache", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace_1"],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({ id: "repo_admin", fullName: "fin-int/admin-repo" }),
    ]);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int&q=admin",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: ["repo_admin"],
      total: 1,
      query: "admin",
    });
    expect(mocks.repositoryConnectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace_1" },
      }),
    );
  });

  it("searches with the latest workflow provisioning status instead of legacy setup status", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace_1"],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({
        id: "repo_failed",
        fullName: "fin-int/failed",
        setupStatus: "configured",
        provisioningStatus: "failed",
      }),
    ]);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int&q=needs%20attention",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: ["repo_failed"],
      total: 1,
    });
  });

  it("does not count legacy Codex setup as ready for rotating Codex policy", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace_1"],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({ id: "repo_legacy", fullName: "fin-int/legacy" }),
      repositoryRow({ id: "repo_rotating", fullName: "fin-int/rotating" }),
    ]);
    mocks.listWorkspaceRepositoryHealth.mockResolvedValue([
      staleProviderReport("repo_legacy"),
      staleProviderReport("repo_rotating"),
    ]);
    mocks.providerSetupFindMany.mockResolvedValue([
      providerSetupRow({
        repositoryId: "repo_legacy",
        authMode: "codex_subscription_oauth",
      }),
      providerSetupRow({
        repositoryId: "repo_rotating",
        authMode: "codex_subscription_oauth_rotating",
      }),
    ]);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int&setup=ready",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: ["repo_rotating"],
      total: 2,
      filter: "ready",
    });
  });

  it("does not let a stale healthy report hide a legacy provider setup mismatch", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace_1"],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({ id: "repo_legacy", fullName: "fin-int/legacy" }),
      repositoryRow({ id: "repo_rotating", fullName: "fin-int/rotating" }),
    ]);
    mocks.listWorkspaceRepositoryHealth.mockResolvedValue([
      healthyReport("repo_legacy"),
      healthyReport("repo_rotating"),
    ]);
    mocks.providerSetupFindMany.mockResolvedValue([
      providerSetupRow({
        repositoryId: "repo_legacy",
        authMode: "codex_subscription_oauth",
      }),
      providerSetupRow({
        repositoryId: "repo_rotating",
        authMode: "codex_subscription_oauth_rotating",
      }),
    ]);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int&setup=ready",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: ["repo_rotating"],
      total: 2,
      filter: "ready",
    });
  });

  it("does not surface cached rotating readiness after exact evidence becomes stale", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace_1"],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({ id: "repo_stale", fullName: "fin-int/stale" }),
    ]);
    mocks.listWorkspaceRepositoryHealth.mockResolvedValue([
      healthyReport("repo_stale"),
    ]);
    mocks.providerSetupFindMany.mockResolvedValue([
      providerSetupRow({
        repositoryId: "repo_stale",
        authMode: "codex_subscription_oauth_rotating",
      }),
    ]);
    mocks.deriveDashboardProviderSetupReadiness.mockImplementationOnce(
      async (input: {
        readonly providerSetup: readonly ReturnType<typeof providerSetupRow>[];
      }) =>
        input.providerSetup.map((setup) => ({
          ...setup,
          state: "stale_or_invalid",
        })),
    );

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int&setup=ready",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: [],
      total: 1,
      filter: "ready",
    });
    expect(mocks.deriveDashboardProviderSetupReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "workspace_1",
        repositories: [
          expect.objectContaining({
            id: "repo_stale",
            githubRepositoryId: 123456n,
          }),
        ],
      }),
    );
  });

  it("loads repository policies for non-configured provider setup rows", async () => {
    mocks.reviewConfigurationFindMany.mockResolvedValue([
      {
        repositoryId: "repo_missing",
        versions: [
          repositoryPolicyRow("repo_missing", {
            kind: "openrouter",
            authMode: "openrouter_api_key",
            model: "poolside/laguna-m.1:free",
            reasoningEffort: "medium",
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
          }),
        ],
      },
    ]);
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace_1"],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    });
    mocks.repositoryConnectionFindMany.mockResolvedValue([
      repositoryRow({ id: "repo_missing", fullName: "fin-int/missing" }),
    ]);
    mocks.listWorkspaceRepositoryHealth.mockResolvedValue([
      healthyReport("repo_missing"),
    ]);
    mocks.providerSetupFindMany.mockResolvedValue([
      providerSetupRow({
        repositoryId: "repo_missing",
        authMode: "openrouter_api_key",
        providerKind: "openrouter",
        state: "missing",
      }),
    ]);

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/repositories/search?workspace=fin-int&setup=ready",
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      repositoryIds: [],
      total: 1,
      filter: "ready",
    });
    expect(mocks.reviewConfigurationFindMany).toHaveBeenCalledOnce();
    expect(mocks.reviewConfigurationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: "workspace_1",
          repositoryId: { in: ["repo_missing"] },
          active: true,
        },
      }),
    );
  });

  it("gives the dashboard page and this route the same readiness, including Gateway", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "workspace_ids",
      workspaceIds: ["workspace_1"],
    });
    mocks.listGitHubUserRepositoryAccess.mockResolvedValue({
      status: "ready",
      workspaceIds: [],
      repositoryIds: new Set<string>(),
      directConfigRepositoryIds: new Set<string>(),
      checkedAt: null,
    });
    const table = [
      {
        id: "repo_secret_ready",
        health: "healthy",
        setupRow: true,
        expected: "ready",
      },
      { id: "repo_secret_missing", health: "healthy", expected: "needs_setup" },
      {
        id: "repo_gateway_ready",
        health: "healthy",
        gateway: { status: "ready" },
        expected: "ready",
      },
      {
        id: "repo_gateway_unauthorized",
        health: "healthy",
        gateway: {
          status: "blocked",
          issue: "gateway_review_v2_runtime_not_ready",
        },
        expected: "needs_setup",
      },
      {
        id: "repo_hosted",
        health: "provider_needs_setup",
        hosted: true,
        expected: "ready",
      },
      {
        id: "repo_unhealthy",
        health: "provider_unhealthy",
        setupRow: true,
        expected: "needs_attention",
      },
      {
        id: "repo_recovery",
        health: "healthy",
        setupRow: true,
        setupIssue: "setup_pr_closed",
        expected: "needs_setup",
      },
    ] as const satisfies readonly ReadinessFixture[];
    const rows = table.map((item: ReadinessFixture) =>
      repositoryRow({
        id: item.id,
        fullName: `fin-int/${item.id}`,
        ...(item.setupIssue
          ? { provisioningStatus: "failed", errorMessage: item.setupIssue }
          : {}),
      }),
    );
    const health = table.map((item) => ({
      ...healthyReport(item.id),
      status: item.health,
    }));
    const providerSetup = table.flatMap((item: ReadinessFixture) =>
      item.setupRow
        ? [
            providerSetupRow({
              repositoryId: item.id,
              authMode: "codex_subscription_oauth_rotating",
            }),
          ]
        : [],
    );
    const gatewayReadiness = new Map(
      table.flatMap((item: ReadinessFixture) =>
        item.gateway ? [[item.id, item.gateway] as const] : [],
      ),
    ) as ReadonlyMap<string, GatewayReviewV2RepositoryReadiness>;
    const hostedView = hostedPoolView(
      rows,
      table.flatMap((item: ReadinessFixture) => (item.hosted ? [item.id] : [])),
    );
    const accounts = gatewayAccounts();
    mocks.repositoryConnectionFindMany.mockResolvedValue(rows);
    mocks.listWorkspaceRepositoryHealth.mockResolvedValue(health);
    mocks.providerSetupFindMany.mockResolvedValue(providerSetup);
    mocks.reviewConfigurationFindMany.mockImplementation(
      async (input: RepositoryHeadsQuery) =>
        input.where.repositoryId.in.map((repositoryId) => ({
          repositoryId,
          versions: [
            gatewayReadiness.has(repositoryId)
              ? repositoryPolicyRow(repositoryId, gatewayProvider)
              : repositoryPolicyRow(repositoryId),
          ],
        })),
    );
    mocks.loadHostedPoolDashboardView.mockResolvedValue(hostedView);
    mocks.loadDashboardGatewayAccounts.mockResolvedValue(accounts);
    mocks.readGatewayReviewV2RepositoryReadiness.mockResolvedValue(
      gatewayReadiness,
    );

    const routeReadiness = new Map<string, string>();
    for (const [setup, readiness] of [
      ["ready", "ready"],
      ["needed", "needs_setup"],
      ["attention", "needs_attention"],
    ] as const) {
      const response = await GET(
        nextRequest(
          `http://localhost/api/dashboard/repositories/search?workspace=fin-int&setup=${setup}`,
        ),
      );
      const body = (await response.json()) as {
        readonly repositoryIds: readonly string[];
      };
      for (const id of body.repositoryIds) routeReadiness.set(id, readiness);
    }
    expect(mocks.loadDashboardGatewayAccounts).toHaveBeenCalledWith(
      "workspace_1",
      null,
      expect.arrayContaining([
        expect.objectContaining({ providers: [gatewayProvider] }),
      ]),
    );
    // Composed as the dashboard page composes it for its table and summary.
    const pageReadiness = resolveDashboardRepositoryReadiness({
      effectiveConfigs: new Map(
        rows.map((repository) => [
          repository.id,
          gatewayReadiness.has(repository.id)
            ? parseReviewConfigurationStrict({
                ...workspacePolicyFixture,
                providers: [gatewayProvider],
              })
            : workspacePolicyFixture,
        ]),
      ),
      repositories: rows.map((repository) => ({
        ...repository,
        setupStatus: projectRepositorySetupStatus({
          workflowProvisioningStatus:
            repository.provisioning[0]?.status ?? null,
          legacySetupStatus: repository.setupStatus,
        }),
        setupNeedsAttention: isSetupRecoveryIssue(
          repository.provisioning[0]?.errorMessage ?? null,
        ),
        installedWorkflowRequirement:
          repository.provisioning[0]?.installedWorkflowRequirement ?? null,
      })),
      health,
      providerSetup,
      hostedRepositories: hostedView.repositories,
      gatewayAccounts: accounts,
      gatewayReadiness,
      providerSecretCheckFailedRepositoryFullName: null,
    });

    expect(
      Object.fromEntries(
        pageReadiness.map((item) => [item.repository.id, item.readiness]),
      ),
    ).toEqual(Object.fromEntries(routeReadiness));
    expect(Object.fromEntries(routeReadiness)).toEqual(
      Object.fromEntries(table.map((item) => [item.id, item.expected])),
    );
    expect(mocks.readGatewayReviewV2RepositoryReadiness).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryIds: ["repo_gateway_ready", "repo_gateway_unauthorized"],
      }),
    );
  });

  it("does not discover repositories for signed-out search requests", async () => {
    mocks.getDashboardWorkspaceScope.mockResolvedValue({
      kind: "none",
      reason: "signed_out",
    });

    const response = await GET(
      nextRequest("http://localhost/api/dashboard/repositories/search"),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "sign_in_required",
    });
    expect(mocks.listGitHubUserRepositoryAccess).not.toHaveBeenCalled();
    expect(mocks.repositoryConnectionFindMany).not.toHaveBeenCalled();
  });
});

function nextRequest(url: string) {
  return { nextUrl: new URL(url) } as Parameters<typeof GET>[0];
}

type ReadinessFixture = {
  readonly id: string;
  readonly health: "healthy" | "provider_needs_setup" | "provider_unhealthy";
  readonly setupRow?: boolean;
  readonly setupIssue?: string;
  readonly hosted?: boolean;
  readonly gateway?: { readonly status: string; readonly issue?: string };
  readonly expected: "ready" | "needs_setup" | "needs_attention";
};

const gatewayProvider = {
  kind: "codex",
  authMode: "codex_account_gateway",
  gatewayBindingId: "binding_1",
  gatewayProfileRef: "openai-responses-apikey-v1",
  model: "mimo-v2.6-pro",
  reasoningEffort: "medium",
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
} as const;

type RepositoryHeadsQuery = {
  readonly where: { readonly repositoryId: { readonly in: string[] } };
};

/** Profiles the stored repository selections of a test reference. */
const testProfiles = new Map<string, WorkspaceProviderProfile>();

/**
 * The stored head of a repository selecting one profile of the provider's
 * credential source; the workspace settings stay inherited.
 */
function repositoryPolicyRow(
  repositoryId: string,
  provider: unknown = workspaceProviderFixture,
) {
  const config = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [provider],
  });
  const profiles = config.providers.map((row) =>
    providerProfileFixture({
      id: `profile_${row.authMode}_${repositoryId}`,
      credential: credentialSourceFixture(row, repositoryId),
      model: row.model,
    }),
  );
  for (const profile of profiles) testProfiles.set(profile.id, profile);
  return storedPolicyHeadFixture(
    repositoryPolicyDocumentFixture(
      config,
      profiles.map((profile) => profile.id),
    ),
  );
}

function gatewayAccounts(): AccountsResult<AccountsPage> {
  return {
    status: "ok",
    value: {
      accounts: [
        {
          connectionId: "connection_1",
          label: "Workspace account",
          profileId: gatewayProvider.gatewayProfileRef,
          profileLabel: "MiMo",
          state: "active",
          gatewayRevision: 1,
          mirrorRevision: 1,
          binding: {
            id: gatewayProvider.gatewayBindingId,
            revision: 1,
            state: "active",
            fencePending: false,
          },
        },
      ],
      profiles: [
        {
          id: gatewayProvider.gatewayProfileRef,
          label: "MiMo",
          protocol: "openai-responses",
          models: [gatewayProvider.model],
        },
      ],
      nextCursor: null,
    },
  };
}

function hostedPoolView(
  repositories: readonly {
    readonly id: string;
    readonly fullName: string;
    readonly visibility: string;
  }[],
  activeRepositoryIds: readonly string[],
): HostedPoolDashboardView {
  return {
    gate: "enabled",
    pool: null,
    accounts: [],
    repositories: repositories.map((repository) => {
      const active = activeRepositoryIds.includes(repository.id);
      return {
        id: repository.id,
        fullName: repository.fullName,
        visibility: repository.visibility,
        source: active ? "hosted_workspace_pool" : "repository_secret",
        bindingId: active ? `binding_${repository.id}` : null,
        bindingVersion: active ? 1 : 0,
        activation: active ? "active" : "legacy",
        eligible: true,
      };
    }),
  };
}

function repositoryRow(input: {
  readonly id: string;
  readonly fullName: string;
  readonly setupStatus?:
    | "not_configured"
    | "setup_pr_open"
    | "configured"
    | "needs_attention";
  readonly provisioningStatus?:
    | "not_started"
    | "setup_pr_open"
    | "configured"
    | "failed";
  readonly errorMessage?: string;
}) {
  const [owner = "", name = ""] = input.fullName.split("/");
  return {
    id: input.id,
    githubRepositoryId: 123456n,
    fullName: input.fullName,
    owner,
    name,
    provider: "github",
    defaultBranch: "main",
    visibility: "private",
    setupStatus: input.setupStatus ?? "configured",
    provisioning: input.provisioningStatus
      ? [
          {
            status: input.provisioningStatus,
            errorMessage: input.errorMessage ?? null,
            installedWorkflowRequirement: null,
          },
        ]
      : [],
    selected: true,
    archived: false,
    stargazersCount: 0,
  };
}

function staleProviderReport(repositoryId: string) {
  return {
    repositoryId,
    status: "provider_report_stale",
    summary: "No recent provider report",
    latestActionHealthReceivedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function healthyReport(repositoryId: string) {
  return {
    repositoryId,
    status: "healthy",
    summary: "Ready",
    latestActionHealthReceivedAt: new Date("2026-01-02T00:00:00Z"),
  };
}

function providerSetupRow(input: {
  readonly repositoryId: string;
  readonly authMode: string;
  readonly providerKind?: string;
  readonly state?: string;
}) {
  return {
    repositoryId: input.repositoryId,
    providerKind: input.providerKind ?? "codex",
    authMode: input.authMode,
    state: input.state ?? "configured",
    updatedAt: new Date("2026-01-02T00:00:00Z"),
  };
}
