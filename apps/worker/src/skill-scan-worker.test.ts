import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  loadProfiles: vi.fn(),
  processOutbox: vi.fn(),
  prune: vi.fn(),
}));
vi.mock("@reviewrouter/features-outbox", () => ({
  OutboxHandlerError: class extends Error {},
  PrismaOutboxEventRepository: class {},
  processOutboxBatch: mocks.processOutbox,
}));
vi.mock("@reviewrouter/features-review-skills/composition", () => ({
  readSkillScannerConfig: () => ({}),
  createHttpSkillScanner: () => ({ loadProfiles: mocks.loadProfiles }),
  createPrismaReviewSkillsCatalogWorker: () => ({ prune: mocks.prune }),
}));

import { createSkillScanWorker } from "./skill-scan-worker";

const outbox = {
  recoveredStale: 0,
  claimed: 1,
  processed: 1,
  retried: 0,
  deadLettered: 0,
  staleClaims: 0,
};

describe("skill scan worker batch contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadProfiles.mockResolvedValue([]);
    mocks.processOutbox.mockResolvedValue(outbox);
    mocks.prune.mockResolvedValue(undefined);
  });

  it("wraps its actual completed outbox result in the host loop contract", async () => {
    const worker = await createSkillScanWorker({
      prisma: {} as PrismaClient,
      env: {},
    });
    expect(await worker.processBatch()).toEqual({
      outbox: { status: "completed", value: outbox },
      failures: [],
    });
    expect(mocks.processOutbox).toHaveBeenCalledOnce();
    expect(mocks.prune).toHaveBeenCalledExactlyOnceWith(100);
  });

  it("still rejects before claiming when profile identity is unavailable", async () => {
    mocks.loadProfiles.mockRejectedValueOnce(new Error("profiles_unavailable"));
    const worker = await createSkillScanWorker({
      prisma: {} as PrismaClient,
      env: {},
    });
    await expect(worker.processBatch()).rejects.toThrow("profiles_unavailable");
    expect(mocks.processOutbox).not.toHaveBeenCalled();
  });

  it("does not turn an existing prune failure into a completed pass", async () => {
    mocks.prune.mockRejectedValueOnce(new Error("prune_unavailable"));
    const worker = await createSkillScanWorker({
      prisma: {} as PrismaClient,
      env: {},
    });
    await expect(worker.processBatch()).rejects.toThrow("prune_unavailable");
    expect(mocks.processOutbox).toHaveBeenCalledOnce();
  });
});
