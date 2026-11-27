import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReviewMutationMode } from "../domain/review-run-control-types";
import { PrismaScmRepositoryIdentityRepository } from "../infrastructure/prisma/prisma-scm-repository-identity-repository";
import { PrismaReviewMutationAuthorityRepository } from "../infrastructure/prisma/prisma-review-mutation-authority-repository";
import {
  authorityFixture,
  identityFixture,
  changedAt,
} from "./scm-mutation-current-scope-fixtures";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
(url ? describe : describe.skip)("SCM identity scoped epoch", () => {
  let prisma: PrismaClient;
  const id = `scm-epoch-${randomUUID()}`;
  const workspace = `${id}-workspace`,
    repository = `${id}-repository`;
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
    await prisma.workspace.create({
      data: { id: workspace, slug: workspace, name: workspace },
    });
    await prisma.repositoryConnection.create({
      data: {
        id: repository,
        workspaceId: workspace,
        externalRepositoryId: id,
        owner: id,
        name: id,
        fullName: `${id}/${id}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.reviewMutationAuthority.deleteMany({
      where: { scmRepositoryIdentityId: id },
    });
    await prisma.scmRepositoryIdentity.deleteMany({
      where: { scmRepositoryIdentityId: id },
    });
    await prisma.workspace.deleteMany({ where: { id: workspace } });
    await prisma.$disconnect();
  });
  it("commits register, bind and paused unbind alongside epoch", async () => {
    const hash = createHash("sha256")
      .update("review-current-scope-v1\0global")
      .digest("hex");
    const epoch = async () =>
      (
        await prisma.$queryRaw<
          Array<{ revision: bigint }>
        >`SELECT revision FROM "CurrentScopeEpoch" WHERE "keyHash" = ${hash}`
      )[0]?.revision ?? 0n;
    const repo = new PrismaScmRepositoryIdentityRepository(prisma);
    const authority = {
      ...authorityFixture(id),
      mode: ReviewMutationMode.Paused,
    };
    const before = await epoch();
    expect(
      (
        await repo.resolveOrRegisterScmRepositoryIdentity({
          identity: identityFixture(id, id),
        })
      ).status,
    ).toBe("created");
    expect(
      (
        await repo.bindScmRepositoryIdentity({
          scmRepositoryIdentityId: id,
          expectedVersion: 1,
          workspaceId: workspace,
          repositoryConnectionId: repository,
          boundAt: changedAt,
        })
      ).status,
    ).toBe("bound");
    await new PrismaReviewMutationAuthorityRepository(
      prisma,
    ).initializeReviewMutationAuthority(authority);
    expect(
      (
        await repo.unbindScmRepositoryIdentity({
          scmRepositoryIdentityId: id,
          expectedVersion: 2,
          unboundAt: changedAt,
          authority: { laneKind: authority.laneKind, expectedVersion: 1 },
        })
      ).status,
    ).toBe("unbound");
    expect(await epoch()).toBe(before + 4n);
    expect(
      (
        await prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: repository },
        })
      ).scmRepositoryIdentityId,
    ).toBeNull();
  });
});
