/** The caller authenticates the GitHub App and binds the complete observed identity. */
export type WebhookRecoveryIdentity = Readonly<{
  appIdentityHash: string;
  deliveryGuid: string;
  githubDeliveryId: bigint;
  eventName: string;
  action: string | null;
  installationId: bigint | null;
  payloadHash: string;
}>;
