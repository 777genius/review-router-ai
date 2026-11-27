import { randomBytes } from "node:crypto";
import type { WebhookRecoveryIdentity } from "../ports/webhook-recovery-identity";

/** The GitHub client must be constructed from trusted App credentials. */
export interface AppWebhookRedeliveryClient {
  readonly appIdentityHash: string;
  redeliver(githubDeliveryId: bigint): Promise<Readonly<{ status: number }>>;
}
/** Trusted composition must verify the App delivery and exact eligible receiver evidence. */
export interface WebhookRedeliveryAuthority {
  authorize(identity: WebhookRecoveryIdentity): Promise<boolean>;
}
export interface WebhookRedeliveryCustody {
  reserve(
    identity: WebhookRecoveryIdentity,
    attemptHash: string,
  ): Promise<boolean>;
  accepted(
    identity: WebhookRecoveryIdentity,
    attemptHash: string,
  ): Promise<boolean>;
}
export type RedeliveryRequestOutcome =
  | "not_authorized"
  | "not_reserved"
  | "accepted_unconfirmed"
  | "unknown";

/**
 * A successful reservation is a one-shot permission for this invocation only.
 * Lost reservation, POST, or accepted-record responses never authorize retry.
 * 202 is only acceptance; receiver completion requires independent readback.
 * Only the explicit operational recovery command requests redelivery.
 */
export async function requestWebhookRedeliveryOnce(
  identity: WebhookRecoveryIdentity,
  dependencies: Readonly<{
    client: AppWebhookRedeliveryClient;
    custody: WebhookRedeliveryCustody;
    authority: WebhookRedeliveryAuthority;
  }>,
): Promise<RedeliveryRequestOutcome> {
  if (
    !/^[a-f0-9]{64}$/.test(identity.appIdentityHash) ||
    dependencies.client.appIdentityHash !== identity.appIdentityHash
  )
    throw new Error("webhook_redelivery_app_identity_mismatch");
  try {
    if (!(await dependencies.authority.authorize(identity)))
      return "not_authorized";
  } catch {
    return "unknown";
  }
  const attemptHash = randomBytes(32).toString("hex");
  let reserved: boolean;
  try {
    reserved = await dependencies.custody.reserve(identity, attemptHash);
  } catch {
    return "unknown";
  }
  if (!reserved) return "not_reserved";
  let response: Readonly<{ status: number }>;
  try {
    response = await dependencies.client.redeliver(identity.githubDeliveryId);
  } catch {
    return "unknown";
  }
  if (response.status !== 202) return "unknown";
  try {
    return (await dependencies.custody.accepted(identity, attemptHash))
      ? "accepted_unconfirmed"
      : "unknown";
  } catch {
    return "unknown";
  }
}
