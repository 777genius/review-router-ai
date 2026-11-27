import { describe, expect, it, vi } from "vitest";
import { PrismaWebhookDeliveryRepository } from "../infrastructure/prisma/prisma-webhook-delivery-repository";

describe("PrismaWebhookDeliveryRepository", () => {
  it("reclaims an exact failed delivery without reopening a different payload", async () => {
    const create = vi.fn(async () => {
      throw { code: "P2002" };
    });
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaWebhookDeliveryRepository({
      gitHubWebhookDelivery: { create, updateMany },
    } as never);

    await expect(
      repository.tryStartProcessing({
        deliveryId: "delivery-1",
        eventName: "pull_request",
        action: "synchronize",
        installationId: "123",
        payloadHash: "payload-hash",
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        deliveryId: "delivery-1",
        eventName: "pull_request",
        action: "synchronize",
        installationId: 123n,
        payloadHash: "payload-hash",
        status: "failed",
      },
      data: {
        status: "processing",
        errorSummary: null,
        processedAt: null,
      },
    });
  });

  it.each(["processing", "failed", "received", null] as const)(
    "fails closed for an unconfirmed or mismatched delivery (%s)",
    async (status) => {
      const repository = new PrismaWebhookDeliveryRepository({
        gitHubWebhookDelivery: {
          create: vi.fn(async () => {
            throw { code: "P2002" };
          }),
          updateMany: vi.fn(async () => ({ count: 0 })),
          findFirst: vi.fn(async () => (status === null ? null : { status })),
        },
      } as never);

      await expect(
        repository.tryStartProcessing({
          deliveryId: "delivery-1",
          eventName: "pull_request",
          action: "synchronize",
          payloadHash: "different-payload",
        }),
      ).rejects.toThrow("github_webhook_delivery_unconfirmed");
    },
  );

  it("acknowledges an exact delivery that was already processed", async () => {
    const findFirst = vi.fn(async () => ({ status: "processed" }));
    const repository = new PrismaWebhookDeliveryRepository({
      gitHubWebhookDelivery: {
        create: vi.fn(async () => {
          throw { code: "P2002" };
        }),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findFirst,
      },
    } as never);
    await expect(
      repository.tryStartProcessing({
        deliveryId: "delivery-1",
        eventName: "pull_request",
        payloadHash: "hash",
      }),
    ).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        deliveryId: "delivery-1",
        eventName: "pull_request",
        action: null,
        installationId: null,
        payloadHash: "hash",
      },
      select: { status: true },
    });
  });
});
