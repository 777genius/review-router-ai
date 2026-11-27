import type { PrismaClient } from "@prisma/client";
import type {
  WebhookDeliveryRecord,
  WebhookDeliveryRepositoryPort,
} from "../../application/ports/webhook-delivery-repository-port";

export class PrismaWebhookDeliveryRepository implements WebhookDeliveryRepositoryPort {
  constructor(
    private readonly prisma: Pick<PrismaClient, "gitHubWebhookDelivery">,
  ) {}

  async tryStartProcessing(delivery: WebhookDeliveryRecord): Promise<boolean> {
    // ON CONFLICT keeps a duplicate receipt from aborting the enclosing unit of
    // work. Catching a unique violation would leave PostgreSQL unable to proceed.
    const inserted = await this.prisma.gitHubWebhookDelivery.createMany({
      data: [
        {
          deliveryId: delivery.deliveryId,
          eventName: delivery.eventName,
          action: delivery.action ?? null,
          installationId: delivery.installationId
            ? BigInt(delivery.installationId)
            : null,
          status: "processing",
          ...(delivery.payloadHash
            ? { payloadHash: delivery.payloadHash }
            : {}),
          ...(delivery.normalizedEvent
            ? { normalizedEvent: delivery.normalizedEvent }
            : {}),
        },
      ],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return true;
    const retried = await this.prisma.gitHubWebhookDelivery.updateMany({
      where: {
        deliveryId: delivery.deliveryId,
        eventName: delivery.eventName,
        action: delivery.action ?? null,
        installationId: delivery.installationId
          ? BigInt(delivery.installationId)
          : null,
        payloadHash: delivery.payloadHash ?? null,
        status: "failed",
      },
      data: {
        status: "processing",
        errorSummary: null,
        processedAt: null,
      },
    });
    return retried.count === 1;
  }

  async markProcessed(deliveryId: string): Promise<void> {
    await this.prisma.gitHubWebhookDelivery.update({
      where: { deliveryId },
      data: { status: "processed", processedAt: new Date() },
    });
  }

  async markFailed(input: {
    readonly deliveryId: string;
    readonly errorSummary: string;
  }): Promise<void> {
    await this.prisma.gitHubWebhookDelivery.update({
      where: { deliveryId: input.deliveryId },
      data: {
        status: "failed",
        errorSummary: input.errorSummary.slice(0, 500),
      },
    });
  }
}
