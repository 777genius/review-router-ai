import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  transaction: {} as Record<string, any>,
  upsert: vi.fn(),
  remove: vi.fn(),
  grant: vi.fn(),
  outbox: vi.fn(),
}));
vi.mock("@reviewrouter/platform-db", () => ({
  acquireCurrentScopeGuards: async (_tx: unknown, scopes: unknown) => {
    expect(scopes).toEqual([{ scope: "global", mode: "exclusive" }]);
  },
}));
vi.mock("@reviewrouter/features-outbox", () => ({
  writePrismaOutboxEvent: m.outbox,
}));
vi.mock(
  "../infrastructure/prisma/prisma-github-installation-repository",
  () => ({
    PrismaGitHubInstallationRepository: class {
      upsertInstallationInTransaction = m.upsert;
      markInstallationRemovedInTransaction = m.remove;
    },
  }),
);
vi.mock(
  "../infrastructure/prisma/prisma-installation-workspace-owner-grant",
  () => ({
    PrismaInstallationWorkspaceOwnerGrant: class {
      grantInstallationActorOwnerInTransaction = m.grant;
    },
  }),
);
vi.mock("../infrastructure/prisma/webhook-effect-fence", () => ({
  runWebhookFencedDatabaseEffect: async (
    _prisma: unknown,
    _claim: unknown,
    fn: (tx: unknown) => unknown,
    state: string,
    beforeFence: (tx: unknown) => Promise<void>,
  ) => {
    expect(state).toBe("processed");
    await beforeFence(m.transaction);
    return fn(m.transaction);
  },
}));
import { handleFencedInstallationWebhook } from "../infrastructure/prisma/fenced-installation-webhook";

const claim = {
  deliveryId: "delivery",
  ownerHash: "owner",
  appIdentityHash: "d".repeat(64),
  generation: 1,
  expiresAt: new Date("2099-01-01"),
} as any;
const envelope = {
  deliveryId: "delivery",
  eventName: "installation_repositories",
  payloadHash: "hash",
  payload: {
    action: "added",
    repositories_added: [],
    repositories_removed: [],
    installation: {
      id: 42,
      account: { login: "team", type: "Organization" },
      repository_selection: "selected",
    },
  },
} as any;
const clock = { now: () => new Date("2026-01-01") };

describe("fenced installation prototype", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.transaction = {
      gitHubWebhookDelivery: {
        findUnique: vi.fn().mockResolvedValue({
          eventName: "installation_repositories",
          action: "added",
          installationId: 42n,
          payloadHash: "hash",
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    m.outbox.mockResolvedValue({ created: true });
  });
  it("keeps installation, sync outbox and terminal state in the fenced transaction", async () => {
    await expect(
      handleFencedInstallationWebhook({} as any, envelope, claim, clock),
    ).resolves.toEqual({ processed: true, status: "active" });
    expect(m.upsert).toHaveBeenCalledWith(
      m.transaction,
      expect.objectContaining({ githubInstallationId: "42" }),
    );
    expect(m.outbox).toHaveBeenCalledWith(
      m.transaction,
      expect.objectContaining({
        idempotencyKey: "installation:42:sync:delivery",
      }),
    );
    expect(m.transaction.gitHubWebhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "processed" }),
      }),
    );
  });
  it("fails before effects when persisted payload identity differs", async () => {
    m.transaction.gitHubWebhookDelivery.findUnique.mockResolvedValue({
      eventName: "installation_repositories",
      action: "added",
      installationId: 42n,
      payloadHash: "other",
    });
    await expect(
      handleFencedInstallationWebhook({} as any, envelope, claim, clock),
    ).rejects.toThrow("webhook_fence_identity_mismatch");
    expect(m.upsert).not.toHaveBeenCalled();
    expect(m.outbox).not.toHaveBeenCalled();
  });
  it("propagates a failed outbox write without marking the delivery complete", async () => {
    m.outbox.mockRejectedValue(new Error("outbox failure"));
    await expect(
      handleFencedInstallationWebhook({} as any, envelope, claim, clock),
    ).rejects.toThrow("outbox failure");
    expect(m.transaction.gitHubWebhookDelivery.update).not.toHaveBeenCalled();
  });
});
