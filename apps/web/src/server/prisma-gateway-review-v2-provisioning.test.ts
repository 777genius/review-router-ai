import type { SqlDriverAdapterFactory } from "@prisma/client/runtime/client";
import { PrismaClient } from "@reviewrouter/platform-db";
import { ReviewMutationLaneKind } from "@reviewrouter/features-review-run-control";
import { expect, it, vi } from "vitest";
import { ProvisionGatewayReviewV2Repository } from "@reviewrouter/features-workflow-provisioning";
import {
  provisionGatewayReviewV2Repository,
  readGatewayReviewV2RepositoryReadiness,
} from "./prisma-gateway-review-v2-provisioning";

it("validates the scoped scalar authority lookup with the generated Prisma client", async () => {
  const info = { provider: "postgres" as const, adapterName: "boundary-test" };
  const query = vi.fn(
    async (
      _query: Parameters<
        Awaited<ReturnType<SqlDriverAdapterFactory["connect"]>>["queryRaw"]
      >[0],
    ) => {
      void _query;
      throw new Error("reached_readiness_authority_driver");
    },
  );
  const adapter: SqlDriverAdapterFactory = {
    ...info,
    connect: async () => ({
      ...info,
      queryRaw: query,
      executeRaw: query,
      executeScript: async () => {},
      dispose: async () => {},
      startTransaction: async () => {
        throw new Error("unexpected_readiness_transaction");
      },
    }),
  };
  const prisma = new PrismaClient({ adapter });
  const identityRead = vi
    .spyOn(prisma.scmRepositoryIdentity, "findMany")
    .mockResolvedValue([
      {
        scmRepositoryIdentityId: "identity:current",
        provider: "github",
        normalizedSourceBaseUrl: "https://github.com",
        externalRepositoryId: "123",
        version: 1,
        currentWorkspaceId: "workspace:current",
        currentRepositoryConnectionId: "repository:current",
        createdAt: new Date("2026-10-13T00:00:00Z"),
        boundAt: null,
        unboundAt: null,
      },
    ]);
  vi.spyOn(prisma.repositoryConnection, "findMany").mockResolvedValue([
    { id: "repository:current" },
  ] as never);
  try {
    // Only the preceding identity/eligibility reads are fixtures. The authority
    // delegate remains the real generated client, including argument validation.
    // Reaching the controlled driver is not PostgreSQL/result/locking evidence.
    await expect(
      readGatewayReviewV2RepositoryReadiness({
        prisma,
        workspaceId: "workspace:current",
        repositoryIds: ["repository:current"],
      }),
    ).rejects.toThrow("reached_readiness_authority_driver");
    expect(identityRead).toHaveBeenCalledWith({
      where: {
        provider: "github",
        currentWorkspaceId: "workspace:current",
        currentRepositoryConnectionId: { in: ["repository:current"] },
      },
    });
    expect(query).toHaveBeenCalledOnce();
    const issued = query.mock.calls[0]![0];
    expect(issued.args).toContain("identity:current");
    expect(issued.args).toContain(ReviewMutationLaneKind.HostedReviewRouterApp);
    expect(issued.args).not.toContain("identity:foreign");
  } finally {
    vi.restoreAllMocks();
    await prisma.$disconnect();
  }
});

it.each([
  [
    "codex_rotating_workflow_inventory_coverage_moved",
    "gateway_review_v2_inventory_retry",
  ],
  [
    "codex_rotating_workflow_inventory_mergeability_unavailable",
    "gateway_review_v2_inventory_retry",
  ],
  [
    "codex_rotating_workflow_inventory_mergeability_invalid",
    "gateway_review_v2_provisioning_failed",
  ],
  ["unknown_inventory_failure", "gateway_review_v2_provisioning_failed"],
])(
  "classifies the provisioning boundary failure %s without retrying",
  async (code, issue) => {
    // Exercise composition and its catch, stopping before the operation's I/O.
    const execute = vi
      .spyOn(ProvisionGatewayReviewV2Repository.prototype, "execute")
      .mockRejectedValueOnce(new Error(code));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        provisionGatewayReviewV2Repository({
          prisma: {} as PrismaClient,
          env: {
            REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED: "1",
            GITHUB_APP_ID: "123",
            GITHUB_APP_PRIVATE_KEY: "fixture-key-never-used-for-authentication",
            REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON:
              JSON.stringify([
                {
                  producerReleaseId: "release-fixture",
                  distributionKind: "public_reusable",
                  actionCommitSha: "a".repeat(40),
                  runtimeCommitSha: "b".repeat(40),
                  wrapperEntrypointDigest: null,
                  runtimeEntrypointDigest: "a".repeat(64),
                  schemaDigest: "b".repeat(64),
                  canonicalizerDigest: "c".repeat(64),
                  capabilityProfile: "exact_revision_v2",
                  protocolLimitsProfileId: "limits-fixture",
                  operationalSloProfileId: "slo-fixture",
                },
              ]),
          },
          command: {
            workspaceId: "workspace:test",
            repositoryId: "repository:test",
            installationId: "installation:test",
            actor: "user:test",
            expectedAttempt: null,
            repository: {
              githubRepositoryId: "123",
              githubInstallationId: "456",
              fullName: "test/repo",
              owner: "test",
            },
            expectedGatewaySource: {
              actionCommitSha: "a".repeat(40),
              actionRef: `777genius/review-router@${"a".repeat(40)}`,
              apiUrl: "https://api.reviewrouter.test",
              sourceRevision: "b".repeat(40),
            },
          },
          assertCurrentSetupAndSource: vi.fn(),
        }),
      ).resolves.toEqual({ status: "blocked", issue });
      expect(execute).toHaveBeenCalledOnce();
    } finally {
      vi.restoreAllMocks();
    }
  },
);
