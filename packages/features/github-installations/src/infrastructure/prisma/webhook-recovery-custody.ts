import { Prisma, type PrismaClient } from "@prisma/client";

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

type RecoveryRow = WebhookRecoveryIdentity & {
  state: "prepared" | "issued_unknown" | "accepted" | "confirmed";
};
function validate(identity: WebhookRecoveryIdentity) {
  if (
    !/^[a-f0-9]{64}$/.test(identity.appIdentityHash) ||
    !/^[a-f0-9]{64}$/.test(identity.payloadHash) ||
    !identity.deliveryGuid ||
    identity.deliveryGuid.length > 200 ||
    !identity.eventName ||
    identity.eventName.length > 100 ||
    identity.githubDeliveryId <= 0n ||
    (identity.installationId !== null && identity.installationId <= 0n)
  )
    throw new Error("webhook_recovery_identity_invalid");
}

/** Immutable custody, no external call; duplicate identity must match exactly. */
export async function prepareWebhookRecovery(
  prisma: PrismaClient,
  identity: WebhookRecoveryIdentity,
): Promise<RecoveryRow> {
  validate(identity);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "GitHubWebhookRecoveryIntent" ("appIdentityHash", "deliveryGuid", "githubDeliveryId", "eventName", "action", "installationId", "payloadHash")
      VALUES (${identity.appIdentityHash}, ${identity.deliveryGuid}, ${identity.githubDeliveryId}, ${identity.eventName}, ${identity.action}, ${identity.installationId}, ${identity.payloadHash})
      ON CONFLICT ("appIdentityHash", "deliveryGuid") DO NOTHING
    `);
    const rows = await tx.$queryRaw<RecoveryRow[]>(Prisma.sql`
      SELECT "appIdentityHash", "deliveryGuid", "githubDeliveryId", "eventName", "action", "installationId", "payloadHash", "state"
      FROM "GitHubWebhookRecoveryIntent" WHERE "appIdentityHash"=${identity.appIdentityHash} AND "deliveryGuid"=${identity.deliveryGuid}
    `);
    const row = rows[0];
    if (
      !row ||
      row.githubDeliveryId !== identity.githubDeliveryId ||
      row.eventName !== identity.eventName ||
      row.action !== identity.action ||
      row.installationId !== identity.installationId ||
      row.payloadHash !== identity.payloadHash
    )
      throw new Error("webhook_recovery_identity_conflict");
    return row;
  });
}

/** Durable one-shot reservation before POST. A crash leaves an unknown outcome. */
export async function reserveWebhookRedeliveryOnce(
  prisma: PrismaClient,
  identity: WebhookRecoveryIdentity,
): Promise<boolean> {
  validate(identity);
  const rows = await prisma.$queryRaw<
    Array<{ deliveryGuid: string }>
  >(Prisma.sql`
    UPDATE "GitHubWebhookRecoveryIntent" SET "state"='issued_unknown', "updatedAt"=clock_timestamp()
    WHERE "appIdentityHash"=${identity.appIdentityHash} AND "deliveryGuid"=${identity.deliveryGuid}
      AND "githubDeliveryId"=${identity.githubDeliveryId} AND "eventName"=${identity.eventName}
      AND "action" IS NOT DISTINCT FROM ${identity.action} AND "installationId" IS NOT DISTINCT FROM ${identity.installationId}
      AND "payloadHash"=${identity.payloadHash} AND "state"='prepared'
    RETURNING "deliveryGuid"
  `);
  return rows.length === 1;
}

/** Only a verified HTTP 202 response authorizes this transition; not completion. */
export async function recordWebhookRedeliveryAccepted(
  prisma: PrismaClient,
  identity: WebhookRecoveryIdentity,
): Promise<boolean> {
  validate(identity);
  const rows = await prisma.$queryRaw<
    Array<{ deliveryGuid: string }>
  >(Prisma.sql`
    UPDATE "GitHubWebhookRecoveryIntent" SET "state"='accepted', "updatedAt"=clock_timestamp()
    WHERE "appIdentityHash"=${identity.appIdentityHash} AND "deliveryGuid"=${identity.deliveryGuid}
      AND "githubDeliveryId"=${identity.githubDeliveryId} AND "eventName"=${identity.eventName}
      AND "action" IS NOT DISTINCT FROM ${identity.action} AND "installationId" IS NOT DISTINCT FROM ${identity.installationId}
      AND "payloadHash"=${identity.payloadHash} AND "state"='issued_unknown'
    RETURNING "deliveryGuid"
  `);
  return rows.length === 1;
}

/** Only an exact receiver terminal record establishes completion; no POST replay. */
export async function confirmWebhookRecovery(
  prisma: PrismaClient,
  identity: WebhookRecoveryIdentity,
): Promise<boolean> {
  validate(identity);
  const rows = await prisma.$queryRaw<
    Array<{ deliveryGuid: string }>
  >(Prisma.sql`
    UPDATE "GitHubWebhookRecoveryIntent" r SET "state"='confirmed', "updatedAt"=clock_timestamp()
    WHERE r."appIdentityHash"=${identity.appIdentityHash} AND r."deliveryGuid"=${identity.deliveryGuid}
      AND r."githubDeliveryId"=${identity.githubDeliveryId} AND r."eventName"=${identity.eventName}
      AND r."action" IS NOT DISTINCT FROM ${identity.action} AND r."installationId" IS NOT DISTINCT FROM ${identity.installationId}
      AND r."payloadHash"=${identity.payloadHash} AND r."state" IN ('prepared','issued_unknown','accepted')
      AND EXISTS (SELECT 1 FROM "GitHubWebhookDelivery" d JOIN "GitHubWebhookFence" f USING ("deliveryId")
        WHERE d."deliveryId"=r."deliveryGuid" AND f."appIdentityHash"=r."appIdentityHash"
          AND d."eventName"=r."eventName" AND d."action" IS NOT DISTINCT FROM r."action"
          AND d."installationId" IS NOT DISTINCT FROM r."installationId" AND d."payloadHash"=r."payloadHash" AND d.status='processed')
    RETURNING r."deliveryGuid"
  `);
  return rows.length === 1;
}
