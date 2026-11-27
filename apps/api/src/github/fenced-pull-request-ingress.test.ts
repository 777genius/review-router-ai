import type { PrismaClient } from "@reviewrouter/platform-db";
import { describe, expect, it, vi } from "vitest";
import { writeFencedPullRequestIngress } from "./fenced-pull-request-ingress";

describe("fenced pull request ingress", () => {
  it("enqueues the current ingress through the guarded transaction and refuses mismatches", async () => {
    const createMany = vi.fn(async (_input: { data: { type: string }[] }) => ({
      count: 1,
    }));
    const findUnique = vi.fn().mockResolvedValue({
      eventName: "pull_request",
      action: "synchronize",
      installationId: 123n,
      payloadHash: "hash",
    });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi
        .fn()
        .mockImplementation(async (sql: { text: string }) =>
          sql.text.includes("FOR UPDATE")
            ? [{ deliveryId: "delivery-1" }]
            : [{ valid: true }],
        ),
      gitHubWebhookDelivery: { findUnique },
      outboxEvent: { createMany },
      gitHubInstallation: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ workspace: { reviewDraftPullRequests: false } }),
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn) => fn(transaction)),
    } as unknown as PrismaClient;
    const envelope = {
      deliveryId: "delivery-1",
      eventName: "pull_request" as const,
      payloadHash: "hash",
      payload: {
        action: "synchronize",
        installation: { id: 123 },
        repository: { id: 456, name: "example", full_name: "example/example" },
        pull_request: {
          number: 7,
          html_url: "https://github.com/example/example/pull/7",
          state: "open",
          merged: false,
          draft: false,
          base: { ref: "main", sha: "a".repeat(40) },
          head: {
            ref: "feature",
            sha: "b".repeat(40),
            repo: { full_name: "example/example" },
          },
        },
      },
    } as const;
    const claim = {
      deliveryId: "delivery-1",
      ownerHash: "a".repeat(64),
      appIdentityHash: "d".repeat(64),
      generation: 1n,
    };
    const result = await writeFencedPullRequestIngress(prisma, envelope, claim);
    expect(result.reviewV2Intent).toBe("queued");
    expect(createMany).toHaveBeenCalledOnce();
    expect(createMany.mock.calls[0]![0].data[0].type).toBe(
      "github.pull_request.review_request_ingress",
    );
    findUnique.mockResolvedValueOnce({
      eventName: "pull_request",
      action: "synchronize",
      installationId: 123n,
      payloadHash: "other",
    });
    await expect(
      writeFencedPullRequestIngress(prisma, envelope, claim),
    ).rejects.toThrow("webhook_fence_identity_mismatch");
    expect(createMany).toHaveBeenCalledOnce();
  });
});
