import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  WebhookRecoveryIdentity,
  WebhookRedeliveryAuthority,
} from "@reviewrouter/features-github-installations";
import { isWebhookReplayEligible } from "@reviewrouter/features-github-installations";
import type { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client";

/** Only exact receiver evidence and trusted App delivery metadata qualify. */
export class GitHubAppWebhookRecoveryAuthority implements WebhookRedeliveryAuthority {
  constructor(
    private readonly prisma: Pick<PrismaClient, "$queryRaw">,
    private readonly client: GitHubAppWebhookRedeliveryClient,
  ) {}
  async authorize(identity: WebhookRecoveryIdentity): Promise<boolean> {
    const signatureHash = await this.readEligibleSignatureHash(identity);
    return signatureHash !== null
      ? this.client.verifyOriginalDelivery(identity, signatureHash)
      : false;
  }

  /** Refresh local evidence after external IO without repeating that IO. */
  async isReceiverEligible(
    identity: WebhookRecoveryIdentity,
  ): Promise<boolean> {
    return (await this.readEligibleSignatureHash(identity)) !== null;
  }

  private async readEligibleSignatureHash(
    identity: WebhookRecoveryIdentity,
  ): Promise<string | null> {
    if (identity.appIdentityHash !== this.client.appIdentityHash) return null;
    const rows = await this.prisma.$queryRaw<
      Array<{ signatureHash: string | null }>
    >(Prisma.sql`
      SELECT f."signatureHash" FROM "GitHubWebhookDelivery" d JOIN "GitHubWebhookFence" f USING ("deliveryId")
        WHERE d."deliveryId"=${identity.deliveryGuid} AND f."appIdentityHash"=${identity.appIdentityHash}
          AND d."eventName"=${identity.eventName} AND d."action" IS NOT DISTINCT FROM ${identity.action}
          AND d."installationId" IS NOT DISTINCT FROM ${identity.installationId}
          AND d."payloadHash"=${identity.payloadHash}
          AND (d.status='failed' OR (d.status='processing' AND f."leaseUntil" <= clock_timestamp()))
    `);
    const signatureHash = rows[0]?.signatureHash;
    if (!signatureHash) return null;
    if (!(await isWebhookReplayEligible(this.prisma, identity.deliveryGuid)))
      return null;
    return signatureHash;
  }
}
