import type {
  AuthorityValidity,
  DeliveryClaim,
  EffectChange,
  EffectView,
  PublicationEffectStore,
  PublicationHandoffStore,
  PublicationSeed,
} from "../../application/publication-ports.js";
import {
  validateEffectChange,
  validateEffectView,
  validatePublicationSeed,
} from "../../application/publication.js";

interface PublicationTransaction {
  $queryRaw<T = unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
}

export interface PublicationPrismaClient extends PublicationTransaction {
  $transaction<T>(
    operation: (transaction: PublicationTransaction) => Promise<T>,
    options: {
      isolationLevel: "ReadCommitted";
      timeout?: number;
    },
  ): Promise<T>;
}

interface EffectRow {
  custodyId: string;
  intentId: string;
  envelopeDigest: string;
  intent: unknown;
  state: EffectView["state"];
  claimId: string | null;
  claimVersion: bigint;
  attemptId: string | null;
  attemptStartedAt: Date | null;
  reconciliationCount: number;
  lastEvidence: EffectView["lastObservation"];
  outboxEventId: string | null;
}

interface ClaimRow {
  id: string;
  type: string;
  version: number;
  idempotencyKey: string;
  payload: unknown;
  status: string;
  claimId: string | null;
  claimVersion: bigint | null;
  claimOwnerHash: string | null;
}

/** PostgreSQL adapter for both the completion handoff and the publication
 * state machine. Every decision validates the live Outbox claim and current
 * authority on the same connection that locks and changes the effect. */
export class PrismaSdkGrowthPublicationEffect
  implements PublicationHandoffStore, PublicationEffectStore
{
  constructor(private readonly prisma: PublicationPrismaClient) {}

  async load(intentId: string): Promise<PublicationSeed | null> {
    const [value] = await this.prisma.$queryRaw<EffectRow[]>`
      SELECT * FROM "SdkGrowthPublicationEffect" WHERE "intentId" = ${intentId}`;
    return value ? seed(value) : null;
  }

  async listUnqueued(limit: number): Promise<readonly PublicationSeed[]> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000)
      throw new Error("sdk_growth_recovery_limit_invalid");
    const rows = await this.prisma.$queryRaw<EffectRow[]>`
      SELECT * FROM "SdkGrowthPublicationEffect"
      WHERE "outboxEventId" IS NULL
      ORDER BY "createdAt", "intentId" LIMIT ${limit}`;
    return rows.map(seed);
  }

  async link(intentId: string, envelopeDigest: string, eventId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const [effect] = await tx.$queryRaw<EffectRow[]>`
          SELECT * FROM "SdkGrowthPublicationEffect"
          WHERE "intentId" = ${intentId} FOR UPDATE`;
        if (!effect || effect.envelopeDigest !== envelopeDigest)
          return "conflict" as const;
        const [event] = await tx.$queryRaw<ClaimRow[]>`
          SELECT * FROM "OutboxEvent" WHERE "id" = ${eventId} FOR SHARE`;
        if (!event || !eventMatches(event, effect)) return "conflict" as const;
        if (effect.outboxEventId === eventId) return "already-linked" as const;
        if (effect.outboxEventId !== null) return "conflict" as const;
        await tx.$executeRaw`
          UPDATE "SdkGrowthPublicationEffect" SET "outboxEventId" = ${eventId},
            "updatedAt" = statement_timestamp() WHERE "intentId" = ${intentId}`;
        return "linked" as const;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  async withClaim<T>(
    intentId: string,
    claim: DeliveryClaim,
    decide: (
      effect: EffectView,
      authority: AuthorityValidity,
      databaseNow: number,
    ) => Readonly<{ change: EffectChange | null; value: T }>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await lockClaimed(tx, intentId, claim);
        if (locked.kind !== "locked") return locked;
        const authority = await currentAuthority(tx, locked.effect);
        const view = effectView(locked.effect);
        const decision = decide(view, authority, locked.now);
        if (decision.change) {
          validateEffectChange(view, decision.change);
          await applyChange(tx, intentId, claim, decision.change);
        }
        return { kind: "committed" as const, value: decision.value };
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  async withMutationPermit<T>(
    intentId: string,
    claim: DeliveryClaim,
    attemptId: string,
    mutate: () => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await lockClaimed(tx, intentId, claim);
        if (locked.kind !== "locked") return locked;
        const authority = await currentAuthority(tx, locked.effect);
        if (
          authority.kind !== "current" ||
          locked.effect.state !== "sending" ||
          locked.effect.attemptId !== attemptId
        )
          return { kind: "not-current" as const };
        // The authority pointer SHARE lock and authority-scope advisory lock
        // remain held until the one-shot provider call settles.
        return { kind: "committed" as const, value: await mutate() };
      },
      { isolationLevel: "ReadCommitted", timeout: 30_000 },
    );
  }
}

async function lockClaimed(
  tx: PublicationTransaction,
  intentId: string,
  claim: DeliveryClaim,
): Promise<
  | Readonly<{ kind: "missing" | "stale-claim" }>
  | Readonly<{ kind: "locked"; effect: EffectRow; now: number }>
> {
  const [unlocked] = await tx.$queryRaw<EffectRow[]>`
    SELECT * FROM "SdkGrowthPublicationEffect" WHERE "intentId" = ${intentId}`;
  if (!unlocked) return { kind: "missing" };
  const publication = seed(unlocked);
  const authorityKey = JSON.stringify([
    publication.authority.tenantId,
    publication.authority.repositoryId,
    publication.authority.pullRequest,
  ]);
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${authorityKey}, 0))`;
  const [effect] = await tx.$queryRaw<EffectRow[]>`
    SELECT * FROM "SdkGrowthPublicationEffect" WHERE "intentId" = ${intentId} FOR UPDATE`;
  if (!effect) return { kind: "missing" };
  const [event] = await tx.$queryRaw<ClaimRow[]>`
    SELECT * FROM "OutboxEvent" WHERE "id" = ${claim.eventId} FOR SHARE`;
  if (
    !event ||
    effect.outboxEventId !== claim.eventId ||
    !eventMatches(event, effect) ||
    event.status !== "processing" ||
    event.claimId !== claim.claimId ||
    event.claimVersion !== claim.claimVersion ||
    event.claimOwnerHash !== claim.claimOwnerHash
  )
    return { kind: "stale-claim" };
  const [clock] = await tx.$queryRaw<Array<{ now: bigint }>>`
    SELECT floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint AS "now"`;
  if (!clock || clock.now > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("sdk_growth_database_clock_invalid");
  return { kind: "locked", effect, now: Number(clock.now) };
}

async function currentAuthority(
  tx: PublicationTransaction,
  effect: EffectRow,
): Promise<AuthorityValidity> {
  const publication = seed(effect);
  const scopeKey = JSON.stringify([
    publication.authority.tenantId,
    publication.authority.repositoryId,
    publication.authority.pullRequest,
  ]);
  const [row] = await tx.$queryRaw<
    Array<{
      epoch: bigint;
      bindingMatches: boolean;
      ownerMatches: boolean;
      installationActive: boolean;
      verifierActive: boolean;
      revoked: boolean;
      expiresAt: bigint;
      scopeFence: bigint;
      receiptDigest: string;
      databaseNow: bigint;
    }>
  >`
    SELECT current."epoch",
      binding."binding" = record."metadata"->'grant'->'binding' AS "bindingMatches",
      owner."evidence" = record."metadata"->'grant'->'ownerEvidence' AS "ownerMatches",
      owner."installationActive", owner."verifierActive",
      (record."metadata"->>'revoked')::boolean AS "revoked",
      (record."metadata"->'grant'->>'expiresAt')::bigint AS "expiresAt",
      scope."fence" AS "scopeFence", custody."receiptDigest",
      floor(extract(epoch FROM statement_timestamp()) * 1000)::bigint AS "databaseNow"
    FROM "SdkGrowthCurrentAuthority" current
    JOIN "SdkGrowthBindingVersion" binding
      ON binding."scopeKey" = current."scopeKey" AND binding."epoch" = current."epoch"
    JOIN "SdkGrowthOwnerVersion" owner
      ON owner."scopeKey" = binding."scopeKey" AND owner."epoch" = binding."epoch"
    JOIN "SdkGrowthAuthorityScope" scope
      ON scope."tenantId" = ${publication.authority.tenantId}
      AND scope."repositoryId" = ${publication.authority.repositoryId}
      AND scope."pullRequest" = ${BigInt(publication.authority.pullRequest)}
    JOIN "SdkGrowthAuthorityRecord" record
      ON record."tenantId" = scope."tenantId" AND record."repositoryId" = scope."repositoryId"
      AND record."pullRequest" = scope."pullRequest"
      AND record."fence" = ${publication.authority.receiptFence}
    JOIN "SdkGrowthAuthorityCustody" custody ON custody."custodyId" = ${effect.custodyId}
    WHERE current."scopeKey" = ${scopeKey}
    FOR SHARE OF current`;
  if (!row) {
    const [basic] = await tx.$queryRaw<Array<{ epoch: bigint }>>`
      SELECT "epoch" FROM "SdkGrowthCurrentAuthority" WHERE "scopeKey" = ${scopeKey} FOR SHARE`;
    return {
      kind: "stale",
      reason:
        basic && basic.epoch !== publication.authority.authorityEpoch
          ? "epoch-changed"
          : "fenced",
    };
  }
  if (row.epoch !== publication.authority.authorityEpoch)
    return { kind: "stale", reason: "epoch-changed" };
  if (row.scopeFence !== publication.authority.receiptFence)
    return { kind: "stale", reason: "fenced" };
  if (row.receiptDigest !== `sha256:${publication.authority.receiptDigest}`)
    return { kind: "stale", reason: "binding-changed" };
  if (!row.bindingMatches) return { kind: "stale", reason: "binding-changed" };
  if (!row.ownerMatches || row.revoked)
    return { kind: "stale", reason: "revoked" };
  if (!row.installationActive)
    return { kind: "stale", reason: "installation-inactive" };
  if (!row.verifierActive)
    return { kind: "stale", reason: "verifier-withdrawn" };
  if (row.expiresAt <= row.databaseNow)
    return { kind: "stale", reason: "expired" };
  return { kind: "current" };
}

function seed(row: EffectRow): PublicationSeed {
  if (
    !row.intent ||
    typeof row.intent !== "object" ||
    Array.isArray(row.intent)
  )
    throw new Error("sdk_growth_publication_intent_invalid");
  const stored = row.intent as Record<string, unknown>;
  const authority = stored.authority as Record<string, unknown>;
  return validatePublicationSeed({
    ...(stored as unknown as PublicationSeed),
    authority: {
      ...(authority as unknown as PublicationSeed["authority"]),
      receiptFence: BigInt(authority.receiptFence as string),
      authorityEpoch: BigInt(authority.authorityEpoch as string),
    },
  });
}

function effectView(row: EffectRow): EffectView {
  return validateEffectView({
    seed: seed(row),
    state: row.state,
    attempt: row.attemptId
      ? {
          id: row.attemptId,
          startedAt: row.attemptStartedAt!.getTime(),
          reconciliationCount: row.reconciliationCount,
        }
      : null,
    lastObservation: row.lastEvidence,
  });
}

function eventMatches(event: ClaimRow, effect: EffectRow): boolean {
  const payload = event.payload as Record<string, unknown> | null;
  return (
    event.type === "sdk_growth.publication_requested" &&
    event.version === 1 &&
    event.idempotencyKey === effect.intentId &&
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Reflect.ownKeys(payload).length === 2 &&
    payload.intentId === effect.intentId &&
    payload.envelopeDigest === effect.envelopeDigest
  );
}

async function applyChange(
  tx: PublicationTransaction,
  intentId: string,
  claim: DeliveryClaim,
  change: EffectChange,
): Promise<void> {
  if (change.kind === "start") {
    await tx.$executeRaw`
      UPDATE "SdkGrowthPublicationEffect" SET "state" = 'sending',
        "attemptId" = ${change.attemptId}, "attemptStartedAt" = statement_timestamp(),
        "claimId" = ${claim.claimId}, "claimVersion" = ${claim.claimVersion},
        "updatedAt" = statement_timestamp() WHERE "intentId" = ${intentId}`;
    return;
  }
  if (change.kind === "reconcile") {
    await tx.$executeRaw`
      UPDATE "SdkGrowthPublicationEffect" SET "state" = 'reconcile-required',
        "reconciliationCount" = ${change.reconciliationCount},
        "lastEvidence" = ${JSON.stringify(change.observation)}::jsonb,
        "claimId" = ${claim.claimId}, "claimVersion" = ${claim.claimVersion},
        "updatedAt" = statement_timestamp() WHERE "intentId" = ${intentId}`;
    return;
  }
  await tx.$executeRaw`
    UPDATE "SdkGrowthPublicationEffect" SET "state" = ${change.outcome},
      "reconciliationCount" = ${change.reconciliationCount},
      "lastEvidence" = ${JSON.stringify(change.evidence)}::jsonb,
      "claimId" = ${claim.claimId}, "claimVersion" = ${claim.claimVersion},
      "completedAt" = statement_timestamp(), "updatedAt" = statement_timestamp()
    WHERE "intentId" = ${intentId}`;
}
