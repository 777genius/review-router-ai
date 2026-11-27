import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  tx: {} as Record<string, any>,
  ingress: vi.fn(),
  conflict: vi.fn(),
  setup: vi.fn(),
}));
vi.mock("@reviewrouter/features-outbox", () => ({
  writePrismaOutboxEvent: vi.fn(),
}));
vi.mock("@reviewrouter/features-conflict-review", () => ({
  ConflictReviewPullRequestWebhookHandler: class {
    handleGitHubPullRequestWebhook = m.conflict;
  },
}));
vi.mock("@reviewrouter/platform-db", () => ({
  runScopeEpochSerializableTransaction: async (
    _db: unknown,
    scopes: unknown,
    fn: (tx: unknown) => unknown,
  ) => {
    expect(scopes).toEqual([{ scope: "global", mode: "exclusive" }]);
    return fn(m.tx);
  },
}));
vi.mock("@reviewrouter/features-github-installations", () => ({
  runWebhookFencedEffectInTransaction: async (
    tx: unknown,
    _claim: unknown,
    fn: (tx: unknown) => unknown,
  ) => fn(tx),
}));
vi.mock("./fenced-pull-request-ingress.js", () => ({
  writePullRequestIngressInTransaction: m.ingress,
}));
vi.mock("./prisma-setup-pull-request-merge-handler.js", () => ({
  PrismaSetupPullRequestMergeHandler: class {
    handlePullRequestInTransaction = m.setup;
  },
}));
import { handleFencedPullRequestComposite } from "./fenced-pull-request-composite";
const claim = { deliveryId: "d", generation: 1n, ownerHash: "a".repeat(64) };
const envelope = {
  deliveryId: "d",
  eventName: "pull_request",
  payloadHash: "hash",
  payload: { action: "closed", installation: { id: 42 } },
} as any;
describe("fenced pull request composite prototype", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.tx = {
      gitHubWebhookDelivery: {
        findUnique: vi.fn().mockResolvedValue({
          eventName: "pull_request",
          action: "closed",
          installationId: 42n,
          payloadHash: "hash",
        }),
      },
    };
    m.ingress.mockResolvedValue({ queued: true });
    m.setup.mockResolvedValue({ configured: true });
  });
  it("runs both effects in the same guarded transaction", async () => {
    await expect(
      handleFencedPullRequestComposite({} as any, envelope, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: false,
      }),
    ).resolves.toEqual({
      ingress: { queued: true },
      setup: { configured: true },
      conflict: null,
    });
    expect(m.ingress).toHaveBeenCalledWith(m.tx, envelope);
    expect(m.setup).toHaveBeenCalledWith(m.tx, envelope);
  });
  it("rejects missing conflict rollout policy before any effect", async () => {
    await expect(
      handleFencedPullRequestComposite({} as any, envelope, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: true,
      }),
    ).rejects.toThrow("webhook_fence_conflict_policy_missing");
    expect(m.ingress).not.toHaveBeenCalled();
    expect(m.setup).not.toHaveBeenCalled();
  });
  it("rejects mismatched delivery identity before any effect", async () => {
    m.tx.gitHubWebhookDelivery.findUnique.mockResolvedValue({
      eventName: "pull_request",
      action: "closed",
      installationId: 42n,
      payloadHash: "other",
    });
    await expect(
      handleFencedPullRequestComposite({} as any, envelope, claim, {
        reviewIngressEnabled: true,
        conflictFallbackEnabled: false,
      }),
    ).rejects.toThrow("webhook_fence_identity_mismatch");
    expect(m.ingress).not.toHaveBeenCalled();
    expect(m.setup).not.toHaveBeenCalled();
  });
});
