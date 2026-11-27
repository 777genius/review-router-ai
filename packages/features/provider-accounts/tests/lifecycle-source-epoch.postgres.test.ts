import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaAccountLifecycleOperations } from "../src/infrastructure/prisma/prisma-account-lifecycle-operations";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
(url ? describe : describe.skip)("account lifecycle source epoch", () => {
  let prisma: PrismaClient;
  const id = `lifecycle-epoch-${randomUUID()}`,
    owner = `${id}-owner`,
    other = `${id}-other`,
    actor = `${id}-actor`;
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
    await prisma.workspace.createMany({
      data: [owner, other].map((id) => ({ id, name: id, slug: id })),
    });
    await prisma.user.create({ data: { id: actor } });
    await prisma.workspaceMember.create({
      data: { workspaceId: owner, userId: actor, role: "owner" },
    });
    await prisma.providerAccountConnection.create({
      data: {
        id,
        ownerWorkspaceId: owner,
        gatewayAccountRef: `${id}-gateway`,
        profileRef: `${id}-profile`,
        displayName: "Synthetic",
        state: "active",
        authorizationEpochMirror: 1n,
      },
    });
    await prisma.workspaceAccountBinding.createMany({
      data: [owner, other].map((workspaceId, i) => ({
        id: `${id}-binding-${i}`,
        workspaceId,
        connectionId: id,
        state: "active" as const,
      })),
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
    await prisma.workspaceAccountBinding.deleteMany({
      where: { connectionId: id },
    });
    await prisma.providerAccountConnection.deleteMany({ where: { id } });
    await prisma.workspace.deleteMany({
      where: { id: { in: [owner, other] } },
    });
    await prisma.user.deleteMany({ where: { id: actor } });
    await prisma.$disconnect();
  });
  it("reserves source and fences bindings across workspaces with one source epoch", async () => {
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
    const before = await epoch();
    const store = new PrismaAccountLifecycleOperations(prisma);
    const receipt = await store.reserve({
      actorUserId: actor,
      clientOperationId: `${id}-operation`,
      sourceId: id,
      personalWorkspaceId: null,
      owningWorkspaceId: owner,
      expectedSourceMetadataRevision: 1,
      expectedGatewayRevision: 1,
      expectedAuthorizationEpoch: 1,
      action: "suspend",
    });
    expect(await epoch()).toBe(before + 1n);
    expect(
      (
        await prisma.providerAccountConnection.findUniqueOrThrow({
          where: { id },
        })
      ).state,
    ).toBe("pending");
    expect(
      (
        await prisma.workspaceAccountBinding.findMany({
          where: { connectionId: id },
        })
      ).map((b) => b.policyRevision),
    ).toEqual([2, 2]);
    // Only this disposable fixture simulates the already-submitted gateway phase.
    await prisma.personalAccountOperation.update({
      where: { id: receipt.id },
      data: { phase: "submitted" },
    });
    const result = {
      accountRef: `${id}-gateway`,
      profileId: `${id}-profile`,
      displayName: "Synthetic",
      state: "suspended",
      metadataRevision: 2,
      authorizationEpoch: 2,
    };
    await expect(
      store.finalize(
        actor,
        receipt.id,
        { ...result, metadataRevision: 1 },
        null,
        null,
      ),
    ).rejects.toThrow();
    expect(await epoch()).toBe(before + 1n);
    expect(
      (await store.finalize(actor, receipt.id, result, null, null)).phase,
    ).toBe("applied");
    expect(await epoch()).toBe(before + 2n);
    expect(
      (
        await prisma.providerAccountConnection.findUniqueOrThrow({
          where: { id },
        })
      ).state,
    ).toBe("suspended");
    const resume = await store.reserve({
      actorUserId: actor,
      clientOperationId: `${id}-resume`,
      sourceId: id,
      personalWorkspaceId: null,
      owningWorkspaceId: owner,
      expectedSourceMetadataRevision: 3,
      expectedGatewayRevision: 2,
      expectedAuthorizationEpoch: 2,
      action: "resume",
    });
    await prisma.personalAccountOperation.update({
      where: { id: resume.id },
      data: { phase: "submitted" },
    });
    expect(
      (await store.reject(actor, resume.id, result, `${id}-no-effect-proof`))
        .phase,
    ).toBe("rejected");
    expect(await epoch()).toBe(before + 4n);
    expect(
      (
        await prisma.providerAccountConnection.findUniqueOrThrow({
          where: { id },
        })
      ).state,
    ).toBe("suspended");
  });
});
