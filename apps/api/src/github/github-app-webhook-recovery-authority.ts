import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type {
  WebhookRecoveryIdentity,
  WebhookRedeliveryAuthority,
} from "@reviewrouter/features-github-installations";
import type { GitHubAppWebhookRedeliveryClient } from "./github-app-webhook-redelivery-client";

/** Only exact receiver evidence and trusted App delivery metadata qualify. */
export class GitHubAppWebhookRecoveryAuthority implements WebhookRedeliveryAuthority {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly client: GitHubAppWebhookRedeliveryClient,
  ) {}
  async authorize(identity: WebhookRecoveryIdentity): Promise<boolean> {
    if (identity.appIdentityHash !== this.client.appIdentityHash) return false;
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
    if (!signatureHash) return false;
    return this.client.verifyOriginalDelivery(identity, signatureHash);
  }
}
