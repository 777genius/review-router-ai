import type { PrismaClient } from "@prisma/client";
import type {
  WebhookDeliveryRecord,
  WebhookDeliveryRepositoryPort,
} from "../../application/ports/webhook-delivery-repository-port";

export class PrismaWebhookDeliveryRepository implements WebhookDeliveryRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async tryStartProcessing(delivery: WebhookDeliveryRecord): Promise<boolean> {
    try {
      await this.prisma.gitHubWebhookDelivery.create({
        data: {
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
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
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
        if (retried.count === 1) return true;

        // A concurrent or abandoned processing attempt is not a successful
        // delivery. Returning false here makes the HTTP route acknowledge it
        // with 200, hiding a delivery that may never have completed. Leave
        // uncertain work untouched and let GitHub retain a failed delivery.
        const existing = await this.prisma.gitHubWebhookDelivery.findFirst({
          where: {
            deliveryId: delivery.deliveryId,
            eventName: delivery.eventName,
            action: delivery.action ?? null,
            installationId: delivery.installationId
              ? BigInt(delivery.installationId)
              : null,
            payloadHash: delivery.payloadHash ?? null,
          },
          select: { status: true },
        });
        if (existing?.status === "processed") return false;
        throw new Error("github_webhook_delivery_unconfirmed");
      }
      throw error;
    }
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "P2002"
  );
}
