import type { SqlDriverAdapterFactory } from "@prisma/client/runtime/client";
import { PrismaClient } from "@reviewrouter/platform-db";
import { ReviewMutationLaneKind } from "@reviewrouter/features-review-run-control";
import { expect, it, vi } from "vitest";
import { readGatewayReviewV2RepositoryReadiness } from "./prisma-gateway-review-v2-provisioning";

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
