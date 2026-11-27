import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repositoryId, workspaceId } from "../domain/identifiers";
import { PrismaRepositoryAuthModeSwitch } from "../infrastructure/prisma/prisma-hosted-account-pool-adapters";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
(url ? describe : describe.skip)("hosted repository switch epoch", () => {
  let prisma: PrismaClient;
  const prefix = `hosted-epoch-${randomUUID()}`;
  const workspace = `${prefix}-w`,
    repository = `${prefix}-r`,
    pool = `${prefix}-p`;
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
    await prisma.workspace.create({
      data: { id: workspace, name: workspace, slug: workspace },
    });
    const install = await prisma.gitHubInstallation.create({
      data: {
        workspaceId: workspace,
        githubInstallationId:
          BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)),
        accountLogin: prefix,
        accountType: "Organization",
        repositorySelection: "all",
      },
    });
    await prisma.repositoryConnection.create({
      data: {
        id: repository,
        workspaceId: workspace,
        installationId: install.id,
        externalRepositoryId: prefix,
        owner: prefix,
        name: prefix,
        fullName: `${prefix}/${prefix}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    await prisma.hostedCodexPool.create({
      data: { id: pool, workspaceId: workspace, name: prefix, isDefault: true },
    });
    await prisma.hostedCodexRepositoryBinding.create({
      data: {
        id: prefix,
        workspaceId: workspace,
        repositoryConnectionId: repository,
        poolId: pool,
        status: "active",
        revision: 2n,
      },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.hostedCodexRepositoryBinding.deleteMany({
      where: { workspaceId: workspace },
    });
    await prisma.hostedCodexPool.deleteMany({
      where: { workspaceId: workspace },
    });
    await prisma.workspace.deleteMany({ where: { id: workspace } });
    await prisma.$disconnect();
  });
  it("commits the switch and repository epoch in one database transaction", async () => {
    const key = `repository:${JSON.stringify([workspace, repository])}`;
    const hash = createHash("sha256")
      .update("review-current-scope-v1\0")
      .update(key)
      .digest("hex");
    const revision = async () =>
      (
        await prisma.$queryRaw<
          Array<{ revision: bigint }>
        >`SELECT revision FROM "CurrentScopeEpoch" WHERE "keyHash" = ${hash}`
      )[0]?.revision ?? 0n;
    const adapter = new PrismaRepositoryAuthModeSwitch(prisma, {
      switchToRepositoryOwnedRotating: async () => true,
    });
    const before = await revision();
    const refused = new PrismaRepositoryAuthModeSwitch(prisma, {
      switchToRepositoryOwnedRotating: async () => false,
    });
    expect(
      await refused.switchToRepositoryOwnedRotating({
        workspaceId: workspaceId(workspace),
        repositoryId: repositoryId(repository),
        expectedBindingRevision: 2,
        nextBindingRevision: 3,
        switchedAt: new Date(),
      }),
    ).toBe(false);
    expect(await revision()).toBe(before);
    expect(
      await adapter.switchToRepositoryOwnedRotating({
        workspaceId: workspaceId(workspace),
        repositoryId: repositoryId(repository),
        expectedBindingRevision: 2,
        nextBindingRevision: 3,
        switchedAt: new Date(),
      }),
    ).toBe(true);
    expect(await revision()).toBe(before + 1n);
    expect(
      (
        await prisma.hostedCodexRepositoryBinding.findUniqueOrThrow({
          where: { id: prefix },
        })
      ).status,
    ).toBe("draining");
  });
});
