import { Prisma } from "@prisma/client";

/**
 * Local receipt order only identifies authority this receiver has already seen.
 * Effect callers hold their existing scope and delivery locks until commit;
 * claim and operator checks are repeated at that effect boundary.
 *
 * Authorization revocation has no original grant revision in its receipt, so a
 * retry cannot distinguish that grant from a later reconnect. Reconcile it.
 */
export async function isWebhookReplayEligible(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  deliveryId: string,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ eligible: boolean }>>(Prisma.sql`
    SELECT CASE
      WHEN d."eventName" IN ('pull_request', 'push') THEN TRUE
      WHEN d."eventName" IN ('installation', 'installation_repositories') THEN
        d."installationId" IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM "GitHubWebhookDelivery" newer
          LEFT JOIN "GitHubWebhookFence" nf ON nf."deliveryId" = newer."deliveryId"
          WHERE newer."deliveryId" <> d."deliveryId"
            AND newer."installationId" = d."installationId"
            AND newer."eventName" IN ('installation', 'installation_repositories')
            AND newer."receivedAt" >= d."receivedAt"
            AND (nf."appIdentityHash" = f."appIdentityHash" OR nf."deliveryId" IS NULL)
        )
      WHEN d."eventName" = 'repository' THEN
        d."installationId" IS NOT NULL
        AND jsonb_typeof(d."normalizedEvent" -> 'repositoryId') = 'string'
        AND (d."normalizedEvent" ->> 'repositoryId') ~ '^[1-9][0-9]*$'
        AND NOT EXISTS (
          SELECT 1 FROM "GitHubWebhookDelivery" newer
          LEFT JOIN "GitHubWebhookFence" nf ON nf."deliveryId" = newer."deliveryId"
          WHERE newer."deliveryId" <> d."deliveryId"
            AND newer."receivedAt" >= d."receivedAt"
            AND (nf."appIdentityHash" = f."appIdentityHash" OR nf."deliveryId" IS NULL)
            AND (
              (newer."eventName" = 'repository' AND (
                (newer."normalizedEvent" ->> 'repositoryId') =
                  (d."normalizedEvent" ->> 'repositoryId')
                OR (newer."installationId" = d."installationId" AND NOT COALESCE(
                  jsonb_typeof(newer."normalizedEvent" -> 'repositoryId') = 'string'
                    AND (newer."normalizedEvent" ->> 'repositoryId') ~ '^[1-9][0-9]*$',
                  FALSE
                ))
              ))
              OR (newer."eventName" IN ('installation', 'installation_repositories')
                AND newer."installationId" = d."installationId")
            )
        )
      ELSE FALSE
    END AS eligible
    FROM "GitHubWebhookDelivery" d JOIN "GitHubWebhookFence" f USING ("deliveryId")
    WHERE d."deliveryId" = ${deliveryId}
  `);
  return rows[0]?.eligible === true;
}
