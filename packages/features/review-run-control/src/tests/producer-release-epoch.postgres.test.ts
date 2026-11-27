import { createHash, randomUUID } from "node:crypto";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaProducerReleaseRepository } from "../infrastructure/prisma/prisma-producer-release-repository";
import {
  limitsProfile,
  sloProfile,
  releaseFixture,
  registeredAt,
} from "./safety-release-current-scope-fixtures";

const url = process.env.REVIEW_ROUTER_EPOCH_TEST_DATABASE_URL;
(url ? describe : describe.skip)("producer release scope epoch", () => {
  let prisma: PrismaClient;
  const id = `producer-epoch-${randomUUID()}`;
  const digest = createHash("sha256").update(id).digest("hex");
  const limits = {
    ...limitsProfile,
    protocolLimitsProfileId: `${id}-limits`,
    limitsDigest: digest,
  };
  const slo = {
    ...sloProfile,
    operationalSloProfileId: `${id}-slo`,
    sloDigest: digest,
  };
  const release = {
    ...releaseFixture(id),
    protocolLimitsProfileId: limits.protocolLimitsProfileId,
    operationalSloProfileId: slo.operationalSloProfileId,
  };
  beforeAll(async () => {
    if (!url?.includes("/rr_scope_full_test?"))
      throw new Error("disposable_test_database_required");
    prisma = createPrismaClient({ databaseUrl: url, poolMax: 5 });
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.producerRelease.deleteMany({
      where: { producerReleaseId: id },
    });
    await prisma.reviewOperationalSloProfileV2.deleteMany({
      where: { operationalSloProfileId: slo.operationalSloProfileId },
    });
    await prisma.reviewProtocolLimitsV2.deleteMany({
      where: { protocolLimitsProfileId: limits.protocolLimitsProfileId },
    });
    await prisma.$disconnect();
  });
  it("commits the registry writes and revocation with the epoch", async () => {
    const hash = createHash("sha256")
      .update("review-current-scope-v1\0global")
      .digest("hex");
    const epoch = async () =>
      (
        await prisma.$queryRaw<
          Array<{ revision: bigint }>
        >`SELECT revision FROM "CurrentScopeEpoch" WHERE "keyHash" = ${hash}`
      )[0]?.revision ?? 0n;
    const repo = new PrismaProducerReleaseRepository(prisma);
    const before = await epoch();
    expect((await repo.registerProtocolLimitsProfile(limits)).status).toBe(
      "created",
    );
    expect((await repo.registerOperationalSloProfile(slo)).status).toBe(
      "created",
    );
    expect((await repo.registerProducerRelease(release)).status).toBe(
      "created",
    );
    expect(
      (
        await repo.revokeProducerRelease({
          producerReleaseId: id,
          revokedAt: registeredAt,
        })
      ).status,
    ).toBe("revoked");
    expect(await epoch()).toBe(before + 4n);
  });
});
