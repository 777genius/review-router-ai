import { Prisma, type PrismaClient } from "@prisma/client";
import type { WebhookDeliveryRecord } from "../../application/ports/webhook-delivery-repository-port";

/** An unexported building block: no handler or takeover is enabled yet. */
export type FencedDelivery = Readonly<{
  deliveryId: string;
  ownerHash: string;
  generation: bigint;
}>;

/** Create the delivery and its first fence in a single database transaction. */
export async function beginFencedWebhookDelivery(
  prisma: PrismaClient,
  delivery: WebhookDeliveryRecord,
  ownerHash: string,
  leaseMs: number,
): Promise<FencedDelivery> {
  if (
    !delivery.deliveryId ||
    !/^[0-9a-f]{64}$/.test(ownerHash) ||
    !Number.isInteger(leaseMs) ||
    leaseMs < 1 ||
    leaseMs > 60_000
  )
    throw new Error("webhook_fence_invalid");
  return prisma.$transaction(async (transaction) => {
    await transaction.gitHubWebhookDelivery.create({
      data: {
        deliveryId: delivery.deliveryId,
        eventName: delivery.eventName,
        action: delivery.action ?? null,
        installationId: delivery.installationId
          ? BigInt(delivery.installationId)
          : null,
        status: "processing",
        ...(delivery.payloadHash ? { payloadHash: delivery.payloadHash } : {}),
        ...(delivery.normalizedEvent
          ? { normalizedEvent: delivery.normalizedEvent }
          : {}),
      },
    });
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "GitHubWebhookFence" ("deliveryId", "ownerHash", "generation", "leaseUntil")
      VALUES (${delivery.deliveryId}, ${ownerHash}, 1,
        clock_timestamp() + ${leaseMs} * interval '1 millisecond')
    `);
    return { deliveryId: delivery.deliveryId, ownerHash, generation: 1n };
  });
}

/** A live owner may extend only its exact, still-valid generation. */
export async function renewWebhookFence(
  prisma: PrismaClient,
  claim: FencedDelivery,
  leaseMs: number,
): Promise<boolean> {
  if (
    !claim.deliveryId ||
    !/^[0-9a-f]{64}$/.test(claim.ownerHash) ||
    claim.generation < 1n ||
    !Number.isInteger(leaseMs) ||
    leaseMs < 1 ||
    leaseMs > 60_000
  )
    throw new Error("webhook_fence_invalid");
  const rows = await prisma.$queryRaw<Array<{ generation: bigint }>>(Prisma.sql`
    UPDATE "GitHubWebhookFence"
    SET "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond'
    WHERE "deliveryId" = ${claim.deliveryId}
      AND "ownerHash" = ${claim.ownerHash}
      AND "generation" = ${claim.generation}
      AND "leaseUntil" > clock_timestamp()
      AND EXISTS (SELECT 1 FROM "GitHubWebhookDelivery" d
        WHERE d."deliveryId" = "GitHubWebhookFence"."deliveryId" AND d.status = 'processing')
    RETURNING "generation"
  `);
  return rows.length === 1;
}

/**
 * Conditional takeover for the future fenced protocol only. This module is
 * not wired into webhook processing: enabling takeover is unsafe until every
 * old writer and every effect path is covered by the same generation fence.
 * A missing fence (including every legacy row) is never a takeover proof.
 * An uncertain database response must be reconciled by readback, not retried
 * with a newly invented owner or generation.
 */
export async function reclaimWebhookFence(
  prisma: PrismaClient,
  previous: FencedDelivery,
  nextOwnerHash: string,
  leaseMs: number,
): Promise<FencedDelivery | null> {
  if (
    !previous.deliveryId ||
    !/^[0-9a-f]{64}$/.test(previous.ownerHash) ||
    !/^[0-9a-f]{64}$/.test(nextOwnerHash) ||
    previous.ownerHash === nextOwnerHash ||
    previous.generation < 1n ||
    !Number.isInteger(leaseMs) ||
    leaseMs < 1 ||
    leaseMs > 60_000
  )
    throw new Error("webhook_fence_invalid");
  const rows = await prisma.$queryRaw<Array<{ generation: bigint }>>(Prisma.sql`
    UPDATE "GitHubWebhookFence"
    SET "ownerHash" = ${nextOwnerHash},
        "generation" = "generation" + 1,
        "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond'
    WHERE "deliveryId" = ${previous.deliveryId}
      AND "ownerHash" = ${previous.ownerHash}
      AND "generation" = ${previous.generation}
      AND "leaseUntil" <= clock_timestamp()
      AND EXISTS (SELECT 1 FROM "GitHubWebhookDelivery" d
        WHERE d."deliveryId" = "GitHubWebhookFence"."deliveryId" AND d.status = 'processing')
    RETURNING "generation"
  `);
  return rows.length === 1
    ? {
        deliveryId: previous.deliveryId,
        ownerHash: nextOwnerHash,
        generation: rows[0]!.generation,
      }
    : null;
}

/**
 * Only DB effects through the supplied transaction may run in `effect`.
 * External effects require their own durable outbox and fencing protocol.
 * All participating writers must use this guard before takeover is enabled.
 */
export async function runWebhookFencedDatabaseEffect<T>(
  prisma: PrismaClient,
  claim: FencedDelivery,
  effect: (transaction: Prisma.TransactionClient) => Promise<T>,
  expectedFinalStatus: "processing" | "processed" | "failed" = "processing",
): Promise<T> {
  if (
    !claim.deliveryId ||
    !/^[0-9a-f]{64}$/.test(claim.ownerHash) ||
    claim.generation < 1n ||
    !["processing", "processed", "failed"].includes(expectedFinalStatus)
  )
    throw new Error("webhook_fence_invalid");
  return prisma.$transaction(async (transaction) => {
    // The locking query and the DB effect must use the same connection and
    // transaction. Check wall-clock time *after* waiting for the row lock.
    const rows = await transaction.$queryRaw<
      Array<{ deliveryId: string }>
    >(Prisma.sql`
      SELECT "deliveryId" FROM "GitHubWebhookFence"
      WHERE "deliveryId" = ${claim.deliveryId}
      FOR UPDATE
    `);
    if (rows.length !== 1) throw new Error("webhook_fence_missing");
    const valid = await transaction.$queryRaw<
      Array<{ valid: boolean }>
    >(Prisma.sql`
      SELECT (f."ownerHash" = ${claim.ownerHash}
          AND f."generation" = ${claim.generation}
          AND f."leaseUntil" > clock_timestamp()
          AND d.status = 'processing') AS valid
      FROM "GitHubWebhookFence" f JOIN "GitHubWebhookDelivery" d USING ("deliveryId")
      WHERE f."deliveryId" = ${claim.deliveryId}
    `);
    if (valid[0]?.valid !== true) throw new Error("webhook_fence_stale");
    const result = await effect(transaction);
    const stillValid = await transaction.$queryRaw<
      Array<{ valid: boolean }>
    >(Prisma.sql`
      SELECT (f."ownerHash" = ${claim.ownerHash}
          AND f."generation" = ${claim.generation}
          AND f."leaseUntil" > clock_timestamp()
          AND d.status::text = ${expectedFinalStatus}) AS valid
      FROM "GitHubWebhookFence" f JOIN "GitHubWebhookDelivery" d USING ("deliveryId")
      WHERE f."deliveryId" = ${claim.deliveryId}
    `);
    if (stillValid[0]?.valid !== true) throw new Error("webhook_fence_expired");
    return result;
  });
}
