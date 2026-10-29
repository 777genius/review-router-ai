import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { ReviewRunCompanionDispatchClaim } from "@reviewrouter/features-review-run-control";
import { PrismaReviewRunCompanionDispatchRepository } from "@reviewrouter/features-review-run-control/composition";
import { createReviewDispatchDatabaseFixture } from "./test-support/review-dispatch-database-fixture";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
describeDatabase("PostgreSQL companion dispatch reservation", () => {
  const prefix = `companion-dispatch-test-${randomUUID()}`;
  let fixture: Awaited<ReturnType<typeof createReviewDispatchDatabaseFixture>>;
  let prisma: PrismaClient;
  let repository: PrismaReviewRunCompanionDispatchRepository;
  let claims: ReviewRunCompanionDispatchClaim[];
  let executionId: string;
  let acquireClaim: (index: number) => Promise<ReviewRunCompanionDispatchClaim>;
  beforeAll(async () => {
    fixture = await createReviewDispatchDatabaseFixture(databaseUrl!, prefix);
    ({ prisma, repository, claims, executionId, acquireClaim } = fixture);
  });
  const releaseClaim = (claim: ReviewRunCompanionDispatchClaim) =>
    fixture.releaseClaim(claim);
  afterAll(async () => {
    await fixture?.dispose();
  });
  it("rejects nonterminal discovery and forged lease/hash before claiming", async () => {
    await expect(repository.claim(claims[0]!)).rejects.toMatchObject({
      code: "phase_not_ready",
    });
    await prisma.reviewExecutionWorkSlotV2.update({
      where: {
        executionId_workSlotId: { executionId, workSlotId: "discovery" },
      },
      data: { state: "exhausted" },
    });
    await expect(
      repository.claim({
        ...claims[0]!,
        fencingToken: claims[0]!.fencingToken + 1n,
      }),
    ).rejects.toMatchObject({ code: "companion_lease_mismatch" });
    await expect(
      repository.claim({
        ...claims[0]!,
        providerRequestEnvelopeHash: digest("forged"),
      }),
    ).rejects.toMatchObject({ code: "companion_envelope_mismatch" });
    expect(
      await prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: claims[0]!.authorizationId },
      }),
    ).toBe(0);
  });

  it("serializes concurrent duplicates, survives a new repository, and never refunds unpaid attempts", async () => {
    await prisma.reviewExecutionWorkSlotV2.update({
      where: {
        executionId_workSlotId: { executionId, workSlotId: "discovery" },
      },
      data: { state: "exhausted" },
    });
    const pair = await Promise.all([
      repository.claim(claims[0]!),
      repository.claim(claims[0]!),
    ]);
    expect(pair.map((row) => row.status).sort()).toEqual([
      "claimed",
      "restored",
    ]);
    expect(pair[0]!.dispatch.nativeRequestRef).toBe(
      pair[1]!.dispatch.nativeRequestRef,
    );
    await expect(
      repository.claim({ ...claims[0]!, dispatchId: `${prefix}-new-id` }),
    ).rejects.toMatchObject({ code: "companion_slot_already_claimed" });
    await repository.settle(
      claims[0]!.authorizationId,
      claims[0]!.dispatchId,
      "not_dispatched",
    );
    const restored = new PrismaReviewRunCompanionDispatchRepository(prisma, {
      lockSelection: async () => true,
      validateManifest: () => {},
    });
    await expect(restored.claim(claims[0]!)).resolves.toMatchObject({
      status: "restored",
      dispatch: { state: "not_dispatched" },
    });
    await releaseClaim(claims[0]!);
    claims[1] = await acquireClaim(2);
    await repository.claim(claims[1]!);
    await releaseClaim(claims[1]!);
    claims[2] = await acquireClaim(3);
    await expect(repository.claim(claims[2]!)).rejects.toMatchObject({
      code: "companion_dispatch_limit",
    });
    await repository.settle(
      claims[1]!.authorizationId,
      claims[1]!.dispatchId,
      "completed",
    );
    await repository.settle(
      claims[1]!.authorizationId,
      claims[1]!.dispatchId,
      "effect_unknown",
    );
    expect(
      (await restored.read(claims[1]!.authorizationId, claims[1]!.dispatchId))
        ?.state,
    ).toBe("completed");
  });
});
