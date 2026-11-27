/** WIP only: caller must authenticate GitHub App and bind all observed identity. */
export type WebhookRecoveryIdentity = Readonly<{
  appIdentityHash: string;
  deliveryGuid: string;
  githubDeliveryId: bigint;
  eventName: string;
  action: string | null;
  installationId: bigint | null;
  payloadHash: string;
}>;
