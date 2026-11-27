import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaProviderAccountSynchronization } from "../src/infrastructure/prisma/prisma-provider-account-synchronization";
import { PrismaProviderAccountRepository } from "../src/infrastructure/prisma/prisma-provider-account-repository";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
(url ? describe : describe.skip)("provider source epoch", () => {
  let prisma: PrismaClient;
  const id = `source-epoch-${randomUUID()}`,
    workspace = `${id}-w`;
  const metadata = {
    gatewayOperationRef: `${id}-operation`,
    profileRef: `${id}-profile`,
    displayName: "Synthetic",
    state: "active" as const,
    authorizationEpoch: 1,
  };
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
    await prisma.workspace.create({
      data: { id: workspace, name: workspace, slug: workspace },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.workspaceAccountBinding.deleteMany({
      where: { connectionId: id },
    });
    await prisma.providerAccountConnection.deleteMany({ where: { id } });
    await prisma.workspace.deleteMany({ where: { id: workspace } });
    await prisma.$disconnect();
  });
  it("commits source creation and sync with the epoch, rolling it back on stale revision", async () => {
    const hash = createHash("sha256")
      .update("review-current-scope-v1\0account-source:")
      .update(id)
      .digest("hex");
    const epoch = async () =>
      (
        await prisma.$queryRaw<
          Array<{ revision: bigint }>
        >`SELECT revision FROM "CurrentScopeEpoch" WHERE "keyHash" = ${hash}`
      )[0]?.revision ?? 0n;
    const sync = new PrismaProviderAccountSynchronization(prisma);
    const before = await epoch();
    await sync.recordWorkspaceConnection({
      id,
      workspaceId: workspace,
      gatewayAccountRef: `${id}-gateway`,
      ...metadata,
    });
    expect(await epoch()).toBe(before + 1n);
    const request = {
      workspaceId: workspace,
      connectionId: id,
      expectedRevision: 1,
      ...metadata,
      state: "suspended" as const,
    };
    await sync.synchronizeMetadata(request);
    expect(await epoch()).toBe(before + 2n);
    await expect(sync.synchronizeMetadata(request)).rejects.toThrow(
      "revision_conflict",
    );
    expect(await epoch()).toBe(before + 2n);
    expect(
      (
        await prisma.providerAccountConnection.findUniqueOrThrow({
          where: { id },
        })
      ).state,
    ).toBe("suspended");
    await sync.synchronizeMetadata({
      ...request,
      expectedRevision: 2,
      state: "active",
    });
    const bindings = new PrismaProviderAccountRepository(prisma);
    await bindings.compareAndSetBinding({
      workspaceId: workspace,
      connectionId: id,
      expectedRevision: 0,
      state: "active",
    });
    expect(await epoch()).toBe(before + 4n);
    await expect(
      bindings.compareAndSetBinding({
        workspaceId: workspace,
        connectionId: id,
        expectedRevision: 0,
        state: "revoked",
      }),
    ).rejects.toThrow();
    expect(await epoch()).toBe(before + 4n);
    await bindings.compareAndSetBinding({
      workspaceId: workspace,
      connectionId: id,
      expectedRevision: 1,
      state: "revoked",
    });
    expect(await epoch()).toBe(before + 5n);
  });
});
