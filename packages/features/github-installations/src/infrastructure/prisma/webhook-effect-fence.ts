import { requireVerifiedGitHubAppWebhook } from "../crypto/github-app-webhook-verifier";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  acquireCurrentScopeGuards,
  PostgresTransactionClock,
} from "@reviewrouter/platform-db";
import type { WebhookDeliveryRecord } from "../../application/ports/webhook-delivery-repository-port";
import { isWebhookReplayEligible } from "./webhook-replay-eligibility";

type WebhookClaimTransaction = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "$executeRaw" | "gitHubWebhookDelivery"
>;

/** A delivery owner may commit only through the guarded database transaction. */
export type FencedDelivery = Readonly<{
  deliveryId: string;
  ownerHash: string;
  appIdentityHash: string;
  generation: bigint;
}>;

export type FencedWebhookClaim =
  | Readonly<{ kind: "claimed"; claim: FencedDelivery }>
  | Readonly<{ kind: "processed" }>;

/** Exact authenticated claims never convert an unfenced legacy delivery. */
export async function claimVerifiedFencedWebhookDelivery(
  prisma: PrismaClient,
  context: unknown,
  delivery: WebhookDeliveryRecord,
  ownerHash: string,
  leaseMs: number,
): Promise<FencedWebhookClaim> {
  return prisma.$transaction(
    (transaction) =>
      claimVerifiedFencedWebhookDeliveryInTransaction(
        transaction,
        context,
        delivery,
        ownerHash,
        leaseMs,
      ),
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** Allows initial durable PR ingress and its delivery claim to commit together. */
export async function claimVerifiedFencedWebhookDeliveryInTransaction(
  transaction: WebhookClaimTransaction,
  context: unknown,
  delivery: WebhookDeliveryRecord,
  ownerHash: string,
  leaseMs: number,
): Promise<FencedWebhookClaim> {
  assertTransaction(transaction);
  const verified = requireVerifiedGitHubAppWebhook(context);
  if (!delivery.payloadHash || delivery.payloadHash !== verified.payloadHash)
    throw new Error("webhook_fence_payload_mismatch");
  validateClaim({
    deliveryId: delivery.deliveryId,
    ownerHash,
    appIdentityHash: verified.appIdentityHash,
    generation: 1n,
  });
  validateLease(leaseMs);
  // Replay checks include unprocessed receipts. Serialize their admission with
  // lifecycle/repository effects before taking any delivery or fence row lock.
  let receivedAt: Date | undefined;
  if (
    delivery.eventName === "installation" ||
    delivery.eventName === "installation_repositories" ||
    delivery.eventName === "repository"
  ) {
    await acquireCurrentScopeGuards(transaction, [
      { scope: "global", mode: "exclusive" },
    ]);
    // The column default uses transaction start, before any admission wait.
    receivedAt = await new PostgresTransactionClock().now(transaction);
    const normalized = delivery.normalizedEvent;
    const repositoryId =
      delivery.eventName === "repository" &&
      normalized !== null &&
      typeof normalized === "object" &&
      "repositoryId" in normalized &&
      typeof normalized.repositoryId === "string" &&
      /^[1-9][0-9]*$/.test(normalized.repositoryId)
        ? normalized.repositoryId
        : null;
    // A later lifecycle event can supersede earlier repository work, so its
    // floor includes repository receipts even though its own retry predicate
    // only checks lifecycle receipts. A transfer keeps the canonical repo floor.
    // Each ordered branch filters App/legacy identity before taking its newest row.
    const prior = await transaction.$queryRaw<
      Array<{ receivedAt: Date | null }>
    >(Prisma.sql`
      SELECT GREATEST(
        (
          SELECT d."receivedAt"
          FROM "GitHubWebhookDelivery" d
          LEFT JOIN "GitHubWebhookFence" f USING ("deliveryId")
          WHERE d."eventName" IN ('installation', 'installation_repositories', 'repository')
            AND (f."appIdentityHash" = ${verified.appIdentityHash} OR f."deliveryId" IS NULL)
            AND d."installationId" = ${delivery.installationId ? BigInt(delivery.installationId) : null}
          ORDER BY d."receivedAt" DESC LIMIT 1
        ),
        (
          SELECT d."receivedAt"
          FROM "GitHubWebhookDelivery" d
          LEFT JOIN "GitHubWebhookFence" f USING ("deliveryId")
          WHERE d."eventName" = 'repository'
            AND (f."appIdentityHash" = ${verified.appIdentityHash} OR f."deliveryId" IS NULL)
            AND d."normalizedEvent" ->> 'repositoryId' = ${repositoryId}
          ORDER BY d."receivedAt" DESC LIMIT 1
        )
      ) AS "receivedAt"
    `);
    const previousTime = prior[0]?.receivedAt;
    // Preserve order after wall-clock rollback and across legacy session-local
    // timestamps without rewriting their history. Leases still use wall time.
    if (previousTime && previousTime >= receivedAt)
      receivedAt = new Date(previousTime.getTime() + 1);
  }
  const inserted = await transaction.gitHubWebhookDelivery.createMany({
    data: [
      {
        ...deliveryData(delivery),
        ...(receivedAt === undefined ? {} : { receivedAt }),
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 1) {
    await insertFence(
      transaction,
      delivery.deliveryId,
      ownerHash,
      verified.appIdentityHash,
      leaseMs,
      verified.signatureHash,
    );
    return {
      kind: "claimed",
      claim: {
        deliveryId: delivery.deliveryId,
        ownerHash,
        appIdentityHash: verified.appIdentityHash,
        generation: 1n,
      },
    };
  }
  await lockDeliveryAndFence(transaction, delivery.deliveryId);
  const rows = await transaction.$queryRaw<
    Array<{
      eventName: string;
      action: string | null;
      installationId: bigint | null;
      payloadHash: string | null;
      status: string;
      ownerHash: string;
      appIdentityHash: string;
      generation: bigint;
      expired: boolean;
    }>
  >(Prisma.sql`
    SELECT d."eventName", d."action", d."installationId", d."payloadHash", d.status,
      f."ownerHash", f."appIdentityHash", f."generation",
      f."leaseUntil" <= clock_timestamp() AS expired
    FROM "GitHubWebhookDelivery" d JOIN "GitHubWebhookFence" f USING ("deliveryId")
    WHERE d."deliveryId" = ${delivery.deliveryId}
  `);
  const row = rows[0];
  if (!row) throw new Error("webhook_fence_legacy_delivery");
  if (
    row.eventName !== delivery.eventName ||
    row.action !== (delivery.action ?? null) ||
    row.installationId !==
      (delivery.installationId ? BigInt(delivery.installationId) : null) ||
    row.payloadHash !== delivery.payloadHash ||
    row.appIdentityHash !== verified.appIdentityHash
  )
    throw new Error("webhook_fence_identity_mismatch");
  if (row.status === "processed") return { kind: "processed" };
  const previous: FencedDelivery = {
    deliveryId: delivery.deliveryId,
    ownerHash: row.ownerHash,
    appIdentityHash: row.appIdentityHash,
    generation: BigInt(row.generation),
  };
  // A caller that lost its own claim response may reconcile that same claim.
  if (
    row.status === "processing" &&
    !row.expired &&
    row.ownerHash === ownerHash
  )
    return { kind: "claimed", claim: previous };
  if (
    row.ownerHash === ownerHash ||
    !(row.status === "failed" || (row.status === "processing" && row.expired))
  )
    throw new Error("webhook_fence_delivery_unconfirmed");
  if (!(await isWebhookReplayEligible(transaction, delivery.deliveryId)))
    throw new Error("webhook_fence_reconciliation_required");
  const claim = await replaceOwner(transaction, previous, ownerHash, leaseMs);
  if (row.status === "failed") {
    await transaction.gitHubWebhookDelivery.update({
      where: { deliveryId: delivery.deliveryId },
      data: { status: "processing", errorSummary: null, processedAt: null },
    });
  }
  return { kind: "claimed", claim };
}

function deliveryData(delivery: WebhookDeliveryRecord) {
  return {
    deliveryId: delivery.deliveryId,
    eventName: delivery.eventName,
    action: delivery.action ?? null,
    installationId: delivery.installationId
      ? BigInt(delivery.installationId)
      : null,
    status: "processing" as const,
    ...(delivery.payloadHash ? { payloadHash: delivery.payloadHash } : {}),
    ...(delivery.normalizedEvent
      ? { normalizedEvent: delivery.normalizedEvent }
      : {}),
  };
}

async function insertFence(
  transaction: WebhookClaimTransaction,
  deliveryId: string,
  ownerHash: string,
  appIdentityHash: string,
  leaseMs: number,
  signatureHash: string | null = null,
) {
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "GitHubWebhookFence" ("deliveryId", "ownerHash", "appIdentityHash", "generation", "leaseUntil", "signatureHash")
    VALUES (${deliveryId}, ${ownerHash}, ${appIdentityHash}, 1,
      clock_timestamp() + ${leaseMs} * interval '1 millisecond', ${signatureHash})
  `);
}

function validateClaim(claim: FencedDelivery) {
  if (
    !claim.deliveryId ||
    !/^[0-9a-f]{64}$/.test(claim.ownerHash) ||
    !/^[0-9a-f]{64}$/.test(claim.appIdentityHash) ||
    typeof claim.generation !== "bigint" ||
    claim.generation < 1n
  )
    throw new Error("webhook_fence_invalid");
}
function validateLease(leaseMs: number) {
  if (!Number.isInteger(leaseMs) || leaseMs < 1 || leaseMs > 60_000)
    throw new Error("webhook_fence_invalid");
}
function assertTransaction(transaction: WebhookClaimTransaction) {
  if (
    !transaction ||
    typeof transaction.$queryRaw !== "function" ||
    Reflect.get(transaction, "$connect") !== undefined ||
    Reflect.get(transaction, "$disconnect") !== undefined
  )
    throw new Error("webhook_fence_transaction_required");
}

/** All participants take delivery before fence, including status triggers. */
async function lockDeliveryAndFence(
  transaction: WebhookClaimTransaction,
  deliveryId: string,
) {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "deliveryId" FROM "GitHubWebhookDelivery" WHERE "deliveryId" = ${deliveryId} FOR UPDATE
  `);
  return transaction.$queryRaw<Array<{ deliveryId: string }>>(Prisma.sql`
    SELECT "deliveryId" FROM "GitHubWebhookFence" WHERE "deliveryId" = ${deliveryId} FOR UPDATE
  `);
}

async function replaceOwner(
  transaction: WebhookClaimTransaction,
  previous: FencedDelivery,
  ownerHash: string,
  leaseMs: number,
): Promise<FencedDelivery> {
  const rows = await transaction.$queryRaw<
    Array<{ generation: bigint }>
  >(Prisma.sql`
    UPDATE "GitHubWebhookFence"
    SET "ownerHash" = ${ownerHash}, "generation" = "generation" + 1,
      "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond',
      "effectTransactionId" = txid_current()
    WHERE "deliveryId" = ${previous.deliveryId} AND "ownerHash" = ${previous.ownerHash}
      AND "appIdentityHash" = ${previous.appIdentityHash} AND "generation" = ${previous.generation}
    RETURNING "generation"
  `);
  if (rows.length !== 1) throw new Error("webhook_fence_stale");
  return { ...previous, ownerHash, generation: BigInt(rows[0]!.generation) };
}

/** Strict first-insert helper used by isolated protocol fixtures. */
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
    verified.signatureHash,
  );
}

/** Internal fixture primitive; live ingress uses the verified claim function. */
export async function beginFencedWebhookDelivery(
  prisma: PrismaClient,
  delivery: WebhookDeliveryRecord,
  ownerHash: string,
  leaseMs: number,
  appIdentityHash: string,
  signatureHash: string | null = null,
): Promise<FencedDelivery> {
  validateClaim({
    deliveryId: delivery.deliveryId,
    ownerHash,
    appIdentityHash,
    generation: 1n,
  });
  validateLease(leaseMs);
  if (signatureHash !== null && !/^[0-9a-f]{64}$/.test(signatureHash))
    throw new Error("webhook_fence_signature_invalid");
  return prisma.$transaction(async (transaction) => {
    await transaction.gitHubWebhookDelivery.create({
      data: deliveryData(delivery),
    });
    await insertFence(
      transaction,
      delivery.deliveryId,
      ownerHash,
      appIdentityHash,
      leaseMs,
      signatureHash,
    );
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
  validateClaim(claim);
  validateLease(leaseMs);
  return prisma.$transaction(
    async (transaction) => {
      // A terminal writer may hold these rows. Read its committed status in a
      // fresh statement after the wait, rather than the UPDATE's earlier snapshot.
      await lockDeliveryAndFence(transaction, claim.deliveryId);
      const rows = await transaction.$queryRaw<
        Array<{ generation: bigint }>
      >(Prisma.sql`
      UPDATE "GitHubWebhookFence"
      SET "leaseUntil" = clock_timestamp() + ${leaseMs} * interval '1 millisecond'
      WHERE "deliveryId" = ${claim.deliveryId} AND "ownerHash" = ${claim.ownerHash}
        AND "appIdentityHash" = ${claim.appIdentityHash} AND "generation" = ${claim.generation}
        AND "leaseUntil" > clock_timestamp()
        AND EXISTS (SELECT 1 FROM "GitHubWebhookDelivery" d
          WHERE d."deliveryId" = "GitHubWebhookFence"."deliveryId" AND d.status = 'processing')
      RETURNING "generation"
    `);
      return rows.length === 1;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** Internal takeover primitive; live claims also verify the complete event identity. */
export async function reclaimWebhookFence(
  prisma: PrismaClient,
  previous: FencedDelivery,
  nextOwnerHash: string,
  leaseMs: number,
): Promise<FencedDelivery | null> {
  validateClaim(previous);
  validateLease(leaseMs);
  if (
    !/^[0-9a-f]{64}$/.test(nextOwnerHash) ||
    previous.ownerHash === nextOwnerHash
  )
    throw new Error("webhook_fence_invalid");
  return prisma.$transaction(
    async (transaction) => {
      await lockDeliveryAndFence(transaction, previous.deliveryId);
      const rows = await transaction.$queryRaw<
        Array<{ valid: boolean }>
      >(Prisma.sql`
      SELECT (f."ownerHash" = ${previous.ownerHash} AND f."appIdentityHash" = ${previous.appIdentityHash}
        AND f."generation" = ${previous.generation} AND f."leaseUntil" <= clock_timestamp()
        AND d.status = 'processing') AS valid
      FROM "GitHubWebhookFence" f JOIN "GitHubWebhookDelivery" d USING ("deliveryId")
      WHERE f."deliveryId" = ${previous.deliveryId}
    `);
      if (
        rows[0]?.valid !== true ||
        !(await isWebhookReplayEligible(transaction, previous.deliveryId))
      )
        return null;
      return replaceOwner(transaction, previous, nextOwnerHash, leaseMs);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** Record failure only after the effect transaction has rolled back. */
export async function failWebhookFencedDelivery(
  prisma: PrismaClient,
  claim: FencedDelivery,
  errorSummary: string,
): Promise<boolean> {
  validateClaim(claim);
  return prisma.$transaction(
    async (transaction) => {
      await lockDeliveryAndFence(transaction, claim.deliveryId);
      const authorized = await transaction.$executeRaw(Prisma.sql`
      UPDATE "GitHubWebhookFence" f SET "effectTransactionId" = txid_current()
      WHERE f."deliveryId" = ${claim.deliveryId} AND f."ownerHash" = ${claim.ownerHash}
        AND f."appIdentityHash" = ${claim.appIdentityHash} AND f."generation" = ${claim.generation}
        AND EXISTS (SELECT 1 FROM "GitHubWebhookDelivery" d WHERE d."deliveryId" = f."deliveryId" AND d.status = 'processing')
    `);
      if (authorized !== 1) return false;
      await transaction.gitHubWebhookDelivery.update({
        where: { deliveryId: claim.deliveryId },
        data: {
          status: "failed",
          processedAt: null,
          errorSummary: errorSummary.slice(0, 500),
        },
      });
      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** DB-only effects: complete scope locks precede the delivery/fence row locks. */
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
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}

/** Every effect and terminal transition must use this same interactive transaction. */
export async function runWebhookFencedEffectInTransaction<T>(
  transaction: Prisma.TransactionClient,
  claim: FencedDelivery,
  effect: (transaction: Prisma.TransactionClient) => Promise<T>,
  expectedFinalStatus: "processing" | "processed" | "failed" = "processing",
): Promise<T> {
  assertTransaction(transaction);
  validateClaim(claim);
  if (!["processing", "processed", "failed"].includes(expectedFinalStatus))
    throw new Error("webhook_fence_invalid");
  const rows = await lockDeliveryAndFence(transaction, claim.deliveryId);
  if (rows.length !== 1) throw new Error("webhook_fence_missing");
  const valid = await transaction.$queryRaw<
    Array<{ valid: boolean; eventName: string }>
  >(Prisma.sql`
    SELECT d."eventName", (f."ownerHash" = ${claim.ownerHash} AND f."appIdentityHash" = ${claim.appIdentityHash}
      AND f."generation" = ${claim.generation} AND f."leaseUntil" > clock_timestamp()
      AND d.status = 'processing') AS valid
    FROM "GitHubWebhookFence" f JOIN "GitHubWebhookDelivery" d USING ("deliveryId")
    WHERE f."deliveryId" = ${claim.deliveryId}
  `);
  const delivery = valid[0];
  if (delivery?.valid !== true) throw new Error("webhook_fence_stale");
  // Claim and effect commit separately; a first owner can also be superseded.
  if (
    (claim.generation > 1n ||
      delivery.eventName === "installation" ||
      delivery.eventName === "installation_repositories" ||
      delivery.eventName === "repository") &&
    !(await isWebhookReplayEligible(transaction, claim.deliveryId))
  )
    throw new Error("webhook_fence_reconciliation_required");
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "GitHubWebhookFence" SET "effectTransactionId" = txid_current()
    WHERE "deliveryId" = ${claim.deliveryId}
  `);
  const result = await effect(transaction);
  const stillValid = await transaction.$queryRaw<
    Array<{ valid: boolean }>
  >(Prisma.sql`
    SELECT (f."ownerHash" = ${claim.ownerHash} AND f."appIdentityHash" = ${claim.appIdentityHash}
      AND f."generation" = ${claim.generation} AND f."leaseUntil" > clock_timestamp()
      AND d.status::text = ${expectedFinalStatus}) AS valid
    FROM "GitHubWebhookFence" f JOIN "GitHubWebhookDelivery" d USING ("deliveryId")
    WHERE f."deliveryId" = ${claim.deliveryId}
  `);
  if (stillValid[0]?.valid !== true) throw new Error("webhook_fence_expired");
  return result;
}
