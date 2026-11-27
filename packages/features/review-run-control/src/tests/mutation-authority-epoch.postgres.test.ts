import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaReviewMutationAuthorityRepository } from "../infrastructure/prisma/prisma-review-mutation-authority-repository";
import { authorityFixture } from "./scm-mutation-current-scope-fixtures";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
(url ? describe : describe.skip)("mutation authority scoped epoch", () => {
  let prisma: PrismaClient;
  const id = `mutation-epoch-${randomUUID()}`;
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.reviewMutationAuthority.deleteMany({
      where: { scmRepositoryIdentityId: id },
    });
    await prisma.$disconnect();
  });
  it("commits initialization and compare-and-set with global scope epoch", async () => {
    const hash = createHash("sha256")
      .update("review-current-scope-v1\0global")
      .digest("hex");
    const revision = async () =>
      (
        await prisma.$queryRaw<
          Array<{ revision: bigint }>
        >`SELECT revision FROM "CurrentScopeEpoch" WHERE "keyHash" = ${hash}`
      )[0]?.revision ?? 0n;
    const repo = new PrismaReviewMutationAuthorityRepository(prisma);
    const initial = authorityFixture(id);
    const before = await revision();
    expect((await repo.initializeReviewMutationAuthority(initial)).status).toBe(
      "created",
    );
    expect(await revision()).toBe(before + 1n);
    expect(
      (
        await repo.compareAndSetReviewMutationAuthority({
          expectedVersion: 1,
          authority: { ...initial, version: 2, epoch: 2n },
        })
      ).status,
    ).toBe("updated");
    expect(await revision()).toBe(before + 2n);
    expect((await repo.findReviewMutationAuthority(initial))?.epoch).toBe(2n);
  });
});
