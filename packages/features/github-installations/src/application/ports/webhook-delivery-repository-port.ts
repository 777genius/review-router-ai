export type WebhookDeliveryStatus =
  | "received"
  | "processing"
  | "processed"
  | "failed";

export type WebhookDeliveryRecord = {
  readonly deliveryId: string;
  readonly eventName: string;
  readonly action?: string | null;
  readonly installationId?: string | null;
  readonly payloadHash?: string | null;
  readonly normalizedEvent?: unknown;
};

export interface WebhookDeliveryRepositoryPort {
  /** False means the exact delivery is already processed; uncertain claims reject. */
  tryStartProcessing(delivery: WebhookDeliveryRecord): Promise<boolean>;
  markProcessed(deliveryId: string): Promise<void>;
  markFailed(input: {
    readonly deliveryId: string;
    readonly errorSummary: string;
  }): Promise<void>;
}
