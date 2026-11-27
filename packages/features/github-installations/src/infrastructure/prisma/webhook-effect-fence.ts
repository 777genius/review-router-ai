import { requireVerifiedGitHubAppWebhook } from "../crypto/github-app-webhook-verifier";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { WebhookDeliveryRecord } from "../../application/ports/webhook-delivery-repository-port";

/** An unexported building block: no handler or takeover is enabled yet. */
export type FencedDelivery = Readonly<{
  deliveryId: string;
  ownerHash: string;
  appIdentityHash: string;
  generation: bigint;
}>;

/**
 * WIP ingress boundary: only a verifier-issued context may supply App identity.
 * Header integrity and trusted secret-to-App configuration remain deployment
 * prerequisites; no production route calls this function yet.
 */
export async function beginVerifiedFencedWebhookDelivery(
  prisma: PrismaClient,
  context: unknown,
  delivery: WebhookDeliveryRecord,
  ownerHash: string,
  leaseMs: number,
): Promise<FencedDelivery> {
  const verified = requireVerifiedGitHubAppWebhook(context);
  if (!delivery.payloadHash || delivery.payloadHash !== verified.payloadHash)
    throw new Error("webhook_fence_payload_mismatch");
  return beginFencedWebhookDelivery(
    prisma,
    delivery,
    ownerHash,
    leaseMs,
    verified.appIdentityHash,
  );
}

/**
 * WIP: appIdentityHash must come from the trusted App configuration paired
 * with the verified webhook secret, never from request-controlled fields.
 * Route integration is not implemented and this is not activation proof.
 */
export async function beginFencedWebhookDelivery(
  prisma: PrismaClient,
  delivery: WebhookDeliveryRecord,
  ownerHash: string,
  leaseMs: number,
  appIdentityHash: string,
): Promise<FencedDelivery> {
  if (
    !delivery.deliveryId ||
    !/^[0-9a-f]{64}$/.test(ownerHash) ||
    !/^[0-9a-f]{64}$/.test(appIdentityHash) ||
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
      INSERT INTO "GitHubWebhookFence" ("deliveryId", "ownerHash", "appIdentityHash", "generation", "leaseUntil")
      VALUES (${delivery.deliveryId}, ${ownerHash}, ${appIdentityHash}, 1,
        clock_timestamp() + ${leaseMs} * interval '1 millisecond')
    `);
    return {
      deliveryId: delivery.deliveryId,
      ownerHash,
      appIdentityHash,
      generation: 1n,
    };
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
    !/^[0-9a-f]{64}$/.test(claim.appIdentityHash) ||
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
      AND "appIdentityHash" = ${claim.appIdentityHash}
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
    !/^[0-9a-f]{64}$/.test(previous.appIdentityHash) ||
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
      AND "appIdentityHash" = ${previous.appIdentityHash}
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
        appIdentityHash: previous.appIdentityHash,
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
  beforeFence?: (transaction: Prisma.TransactionClient) => Promise<void>,
): Promise<T> {
  return prisma.$transaction(
    async (transaction) => {
      await beforeFence?.(transaction);
      return runWebhookFencedEffectInTransaction(
        transaction,
        claim,
        effect,
        expectedFinalStatus,
      );
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** WIP: caller must provide the same interactive transaction for all effects. */
export async function runWebhookFencedEffectInTransaction<T>(
  transaction: Prisma.TransactionClient,
  claim: FencedDelivery,
  effect: (transaction: Prisma.TransactionClient) => Promise<T>,
  expectedFinalStatus: "processing" | "processed" | "failed" = "processing",
): Promise<T> {
  if (
    !transaction ||
    typeof transaction.$queryRaw !== "function" ||
    Reflect.get(transaction, "$connect") !== undefined ||
    Reflect.get(transaction, "$disconnect") !== undefined ||
    !claim.deliveryId ||
    !/^[0-9a-f]{64}$/.test(claim.ownerHash) ||
    !/^[0-9a-f]{64}$/.test(claim.appIdentityHash) ||
    claim.generation < 1n ||
    !["processing", "processed", "failed"].includes(expectedFinalStatus)
  )
    throw new Error("webhook_fence_invalid");
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
          AND f."appIdentityHash" = ${claim.appIdentityHash}
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
          AND f."appIdentityHash" = ${claim.appIdentityHash}
          AND f."generation" = ${claim.generation}
          AND f."leaseUntil" > clock_timestamp()
          AND d.status::text = ${expectedFinalStatus}) AS valid
      FROM "GitHubWebhookFence" f JOIN "GitHubWebhookDelivery" d USING ("deliveryId")
      WHERE f."deliveryId" = ${claim.deliveryId}
    `);
  if (stillValid[0]?.valid !== true) throw new Error("webhook_fence_expired");
  return result;
}
