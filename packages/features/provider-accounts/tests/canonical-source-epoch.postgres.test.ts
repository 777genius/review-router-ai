import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaPersonalCanonicalOperations } from "../src/infrastructure/prisma/prisma-personal-canonical-operations";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
(url ? describe : describe.skip)("personal canonical source epoch", () => {
  let prisma: PrismaClient;
  const id = `canonical-epoch-${randomUUID()}`,
    actor = `${id}-actor`,
    workspace = `${id}-workspace`;
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
    await prisma.user.create({ data: { id: actor } });
    await prisma.workspace.create({
      data: {
        id: workspace,
        slug: workspace,
        name: workspace,
        personalOwnerUserId: actor,
      },
    });
    await prisma.providerAccountConnection.create({
      data: {
        id,
        ownerUserId: actor,
        gatewayAccountRef: `${id}-gateway`,
        profileRef: `${id}-profile`,
        displayName: "Before",
        state: "active",
        authorizationEpochMirror: 1n,
      },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.providerAccountConnection.updateMany({
      where: { id },
      data: { pendingSourceOperationId: null },
    });
    await prisma.personalAccountOperation.deleteMany({
      where: { sourceId: id },
    });
    await prisma.providerAccountConnection.deleteMany({ where: { id } });
    await prisma.workspace.deleteMany({ where: { id: workspace } });
    await prisma.user.deleteMany({ where: { id: actor } });
    await prisma.$disconnect();
  });
  it("reserves and completes an exact rename with source epoch", async () => {
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
    const repo = new PrismaPersonalCanonicalOperations(prisma);
    const operation = `${id}-operation`;
    const before = await epoch();
    const receipt = await repo.reserve({
      actorUserId: actor,
      clientOperationId: operation,
      personalWorkspaceId: workspace,
      sourceId: id,
      expectedSourceMetadataRevision: 1,
      expectedGatewayRevision: 1,
      expectedAuthorizationEpoch: 1,
      action: "rename",
      displayName: "After",
    });
    expect(await epoch()).toBe(before + 1n);
    await prisma.personalAccountOperation.update({
      where: { id: receipt.id },
      data: { phase: "submitted" },
    });
    const account = {
      accountRef: `${id}-gateway`,
      profileId: `${id}-profile`,
      displayName: "After",
      state: "active",
      metadataRevision: 2,
      authorizationEpoch: 1,
    };
    await expect(
      repo.finalize(actor, operation, {
        ...account,
        profileId: "wrong-profile",
      }),
    ).rejects.toThrow();
    expect(await epoch()).toBe(before + 1n);
    expect((await repo.finalize(actor, operation, account)).phase).toBe(
      "applied",
    );
    expect(await epoch()).toBe(before + 2n);
    expect(
      (
        await prisma.providerAccountConnection.findUniqueOrThrow({
          where: { id },
        })
      ).displayName,
    ).toBe("After");
  });
});
