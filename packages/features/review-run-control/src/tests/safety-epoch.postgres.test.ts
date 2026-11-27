import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReviewSafetyPolicyScope } from "../domain/review-run-control-types";
import { PrismaReviewSafetyControlRepository } from "../infrastructure/prisma/prisma-review-safety-control-repository";
import {
  emergencyFixture,
  policyFixture,
} from "./safety-release-current-scope-fixtures";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
const test = url ? describe : describe.skip;
test("safety policy scoped epoch", () => {
  let prisma: PrismaClient;
  const id = `safety-epoch-${randomUUID()}`;
  const scope = {
    scope: ReviewSafetyPolicyScope.Workspace,
    workspaceId: id,
  } as const;
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
    await prisma.workspace.create({ data: { id, name: id, slug: id } });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.reviewSafetyPolicySelector.deleteMany({
      where: { policyId: id },
    });
    await prisma.reviewSafetyPolicy.deleteMany({ where: { policyId: id } });
    await prisma.reviewSafetyEmergencyControl.deleteMany({
      where: { emergencyControlId: id },
    });
    await prisma.workspace.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });
  it("commits policy and emergency control with workspace epoch", async () => {
    const hash = createHash("sha256")
      .update("review-current-scope-v1\0workspace:")
      .update(id)
      .digest("hex");
    const revision = async () =>
      (
        await prisma.$queryRaw<
          Array<{ revision: bigint }>
        >`SELECT revision FROM "CurrentScopeEpoch" WHERE "keyHash" = ${hash}`
      )[0]?.revision ?? 0n;
    const repo = new PrismaReviewSafetyControlRepository(prisma);
    const before = await revision();
    expect(
      (
        await repo.putReviewSafetyPolicy({
          expectedVersion: 0,
          policy: policyFixture(scope, id),
        })
      ).status,
    ).toBe("created");
    expect(await revision()).toBe(before + 1n);
    expect(
      (
        await repo.putReviewSafetyEmergencyControl({
          expectedVersion: 0,
          control: emergencyFixture(scope, id),
        })
      ).status,
    ).toBe("created");
    expect(await revision()).toBe(before + 2n);
    expect((await repo.findReviewSafetyEmergencyControl(scope))?.stopped).toBe(
      true,
    );
  });
});
