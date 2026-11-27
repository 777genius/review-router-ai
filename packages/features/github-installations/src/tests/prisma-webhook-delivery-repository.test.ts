import { describe, expect, it, vi } from "vitest";
import { PrismaWebhookDeliveryRepository } from "../infrastructure/prisma/prisma-webhook-delivery-repository";

const delivery = {
  deliveryId: "delivery-1",
  eventName: "pull_request",
  action: "synchronize",
  installationId: "123",
  payloadHash: "payload-hash",
};
const identity = { ...delivery, installationId: 123n };

describe("PrismaWebhookDeliveryRepository", () => {
  it("starts a new delivery without querying duplicate status", async () => {
    const createMany = vi.fn(async () => ({ count: 1 }));
    const updateMany = vi.fn();
    const findFirst = vi.fn();
    const repository = new PrismaWebhookDeliveryRepository({
      gitHubWebhookDelivery: { createMany, updateMany, findFirst },
    } as never);

    await expect(repository.tryStartProcessing(delivery)).resolves.toBe(true);
    expect(createMany).toHaveBeenCalledWith({
      data: [{ ...identity, status: "processing" }],
      skipDuplicates: true,
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("reclaims an exact failed delivery without reopening a different payload", async () => {
    const createMany = vi.fn(async () => ({ count: 0 }));
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const findFirst = vi.fn();
    const repository = new PrismaWebhookDeliveryRepository({
      gitHubWebhookDelivery: { createMany, updateMany, findFirst },
    } as never);

    await expect(repository.tryStartProcessing(delivery)).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        ...identity,
        status: "failed",
      },
      data: {
        status: "processing",
        errorSummary: null,
        processedAt: null,
      },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { label: "complete identity", delivery, identity },
    {
      label: "absent optional identity fields",
      delivery: { deliveryId: "delivery-1", eventName: "pull_request" },
      identity: {
        deliveryId: "delivery-1",
        eventName: "pull_request",
        action: null,
        installationId: null,
        payloadHash: null,
      },
    },
  ])("acknowledges an exact processed delivery with $label", async (input) => {
    const findFirst = vi.fn(async () => ({ status: "processed" }));
    const repository = new PrismaWebhookDeliveryRepository({
      gitHubWebhookDelivery: {
        createMany: vi.fn(async () => ({ count: 0 })),
        updateMany: vi.fn(async () => ({ count: 0 })),
        findFirst,
      },
    } as never);

    await expect(repository.tryStartProcessing(input.delivery)).resolves.toBe(
      false,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: input.identity,
      select: { status: true },
    });
  });

  it.each(["processing", "received", "failed", null] as const)(
    "refuses to acknowledge an unconfirmed delivery (%s)",
    async (status) => {
      const findFirst = vi.fn(async () =>
        status === null ? null : { status },
      );
      const repository = new PrismaWebhookDeliveryRepository({
        gitHubWebhookDelivery: {
          createMany: vi.fn(async () => ({ count: 0 })),
          updateMany: vi.fn(async () => ({ count: 0 })),
          findFirst,
        },
      } as never);

      await expect(repository.tryStartProcessing(delivery)).rejects.toThrow(
        "github_webhook_delivery_unconfirmed",
      );
      expect(findFirst).toHaveBeenCalledWith({
        where: identity,
        select: { status: true },
      });
    },
  );

  it.each([
    { field: "deliveryId", value: "other-delivery" },
    { field: "eventName", value: "push" },
    { field: "action", value: "closed" },
    { field: "installationId", value: 456n },
    { field: "payloadHash", value: "other-payload" },
  ])(
    "refuses a processed receipt with a different $field",
    async (mismatch) => {
      const stored: Record<string, string | bigint> = {
        ...identity,
        [mismatch.field]: mismatch.value,
      };
      const findFirst = vi.fn(async ({ where }: { where: typeof identity }) =>
        Object.entries(where).every(([key, value]) => stored[key] === value)
          ? { status: "processed" }
          : null,
      );
      const repository = new PrismaWebhookDeliveryRepository({
        gitHubWebhookDelivery: {
          createMany: vi.fn(async () => ({ count: 0 })),
          updateMany: vi.fn(async () => ({ count: 0 })),
          findFirst,
        },
      } as never);

      await expect(repository.tryStartProcessing(delivery)).rejects.toThrow(
        "github_webhook_delivery_unconfirmed",
      );
      expect(findFirst).toHaveBeenCalledWith({
        where: identity,
        select: { status: true },
      });
    },
  );
});
