import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { createProviderUsageArtifactRecovery } from "./provider-usage-artifact-recovery-store.js";
function fixture(
  options: {
    deleted?: boolean;
    claimed?: boolean;
    fenced?: boolean;
    cleanup?: boolean;
    bootstrap?: boolean;
    actionSession?: boolean;
  } = {},
) {
  const grant = {
    id: "grant",
    workspaceId: "ws",
    repositoryId: "34",
    runId: "12",
    runAttempt: 2,
    invocationId: "inv",
    authorizationId: "auth",
    workflowIdentity: "workflow",
    jobIdentity: "job",
    githubInstallationId: "1",
    repositoryFullName: "owner/repo",
    bootstrapScope: options.bootstrap ? { purpose: "diagnostic" } : null,
    actionSessionScope: options.actionSession ? { purpose: "review" } : null,
  };
  const updateMany = vi.fn<
    (input: Record<string, unknown>) => Promise<{ count: number }>
  >(async () => ({
    count: options.claimed === false ? 0 : 1,
  }));
  const prisma = {
    providerUsageGrant: {
      findMany: vi.fn(async (query: { where: { revokedAt: unknown } }) =>
        options.cleanup
          ? query.where.revokedAt === null
            ? []
            : [grant]
          : query.where.revokedAt === null
            ? [grant]
            : [],
      ),
      updateMany,
      count: vi.fn(async () => (options.fenced === false ? 0 : 1)),
    },
    workspace: {
      findUnique: vi.fn(async () => ({
        deletionState: options.deleted ? "deleted" : "active",
      })),
    },
    reviewRunAuthorization: {
      findUnique: vi.fn(async () => ({
        workspaceId: "ws",
        repositoryConnectionId: "connection",
        sourceRunId: "12",
        sourceRunAttempt: "2",
        workflowIdentityHash: "workflow",
        oidcReplayKeyHash: "job",
      })),
    },
    repositoryConnection: {
      findFirst: vi.fn(async () => ({
        githubRepositoryId: 34n,
        fullName: "owner/repo",
        installation: { githubInstallationId: 1n, status: "active" },
      })),
    },
  };
  const read = vi.fn(async () => ({
    body: { signed: "report" },
    artifactName: "reviewrouter-usage-v1-inv-2",
    artifactId: 56,
  }));
  const recover = vi.fn(async () => ({ accepted: [] }));
  const remove = vi.fn(async () => {});
  const verifyArtifactForDeletion = vi.fn(async () => {});
  const service = createProviderUsageArtifactRecovery({
    prisma: prisma as unknown as PrismaClient,
    reader: { read, remove },
    api: { recover, verifyArtifactForDeletion },
  });
  return { prisma, read, recover, remove, verifyArtifactForDeletion, service };
}
describe("durable recovery claims", () => {
  it("imports a lost runner report using only server registered scope then ACKs the fenced grant", async () => {
    const f = fixture();
    expect(await f.service.runBatch()).toEqual({ examined: 1, recovered: 1 });
    expect(f.recover).toHaveBeenCalledWith(
      { signed: "report" },
      {
        repositoryId: "34",
        runId: "12",
        runAttempt: 2,
        artifactName: "reviewrouter-usage-v1-inv-2",
      },
    );
    expect(
      f.prisma.providerUsageGrant.updateMany.mock.calls[1]?.[0],
    ).toMatchObject({
      where: { id: "grant", recoveryClaimToken: expect.any(String) },
      data: { recoveredAt: expect.any(Date) },
    });
  });
  it("does not use App quota when another replica owns the claim", async () => {
    const f = fixture({ claimed: false });
    await f.service.runBatch();
    expect(f.read).not.toHaveBeenCalled();
    expect(f.recover).not.toHaveBeenCalled();
  });
  it("does not import after losing the lease", async () => {
    const f = fixture({ fenced: false });
    await f.service.runBatch();
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.recover).not.toHaveBeenCalled();
  });
  it("revokes deleted workspace grants before any download", async () => {
    const f = fixture({ deleted: true });
    await f.service.runBatch();
    expect(f.read).not.toHaveBeenCalled();
    expect(
      f.prisma.providerUsageGrant.updateMany.mock.calls[1]?.[0],
    ).toMatchObject({
      where: { workspaceId: "ws", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

it("recovers a bootstrap diagnostic without requiring a later review authorization", async () => {
  const f = fixture({ bootstrap: true });
  await f.service.runBatch();
  expect(f.prisma.reviewRunAuthorization.findUnique).not.toHaveBeenCalled();
  expect(f.recover).toHaveBeenCalledOnce();
});

describe("workspace artifact erasure", () => {
  it("verifies the retained grant signature before deleting the exact App-owned artifact", async () => {
    const f = fixture({ deleted: true, cleanup: true });
    await f.service.runBatch();
    expect(f.verifyArtifactForDeletion).toHaveBeenCalledOnce();
    expect(f.remove).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryId: "34",
        installationId: "1",
        runAttempt: 2,
      }),
      56,
    );
    expect(f.recover).not.toHaveBeenCalled();
    expect(
      f.prisma.providerUsageGrant.updateMany.mock.calls[1]?.[0],
    ).toMatchObject({ data: { artifactDeletedAt: expect.any(Date) } });
  });
  it("retains durable cleanup work when a colliding artifact is forged", async () => {
    const f = fixture({ deleted: true, cleanup: true });
    f.verifyArtifactForDeletion.mockRejectedValue(
      new Error("usage_signature_invalid"),
    );
    await f.service.runBatch();
    expect(f.remove).not.toHaveBeenCalled();
    expect(
      f.prisma.providerUsageGrant.updateMany.mock.calls[1]?.[0],
    ).not.toHaveProperty("data.artifactDeletedAt");
  });
});

it("recovers ActionSession telemetry without a v2 ReviewRunAuthorization", async () => {
  const f = fixture({ actionSession: true });
  await f.service.runBatch();
  expect(f.prisma.reviewRunAuthorization.findUnique).not.toHaveBeenCalled();
  expect(f.recover).toHaveBeenCalledOnce();
});
