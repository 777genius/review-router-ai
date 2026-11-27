import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freeBetaEntitlement } from "../domain/entitlement";
import { PrismaEntitlementRepository } from "../infrastructure/prisma/prisma-entitlement-repository";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
const databaseTests = url ? describe : describe.skip;
databaseTests("entitlement scoped epoch", () => {
  let prisma: PrismaClient;
  const id = `entitlement-epoch-${randomUUID()}`;
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
    await prisma.workspace.create({ data: { id, slug: id, name: id } });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.workspaceEntitlement.deleteMany({
      where: { workspaceId: id },
    });
    await prisma.workspace.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });
  it("commits the entitlement and its scope epoch on create and update", async () => {
    const hash = createHash("sha256")
      .update("review-current-scope-v1\0workspace:")
      .update(id)
      .digest("hex");
    const epoch = async () =>
      (
        await prisma.$queryRaw<
          Array<{ revision: bigint }>
        >`SELECT revision FROM "CurrentScopeEpoch" WHERE "keyHash" = ${hash}`
      )[0]?.revision ?? 0n;
    const repo = new PrismaEntitlementRepository(prisma);
    const entitlement = freeBetaEntitlement(id);
    const before = await epoch();
    await repo.upsertWorkspaceEntitlement(entitlement);
    expect(await epoch()).toBe(before + 1n);
    await repo.upsertWorkspaceEntitlement({ ...entitlement, status: "paused" });
    expect(await epoch()).toBe(before + 2n);
    expect((await repo.findWorkspaceEntitlement(id))?.status).toBe("paused");
  });
});
