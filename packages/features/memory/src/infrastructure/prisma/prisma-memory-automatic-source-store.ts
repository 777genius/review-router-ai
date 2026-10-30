import { Prisma, type PrismaClient } from "@prisma/client";
import {
  MemoryKnowledgeError,
  automaticMemoryCohortId,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  type MemoryAutomaticSourceBinding,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeScope,
  type MemoryEntryRef,
} from "../../domain/memory-knowledge";
import type {
  MemoryAutomaticSourceStore,
  MemoryAutomaticSourceState,
} from "../../application/ports/memory-automatic-source-port";
import { lockMemoryKnowledgeScopes } from "./prisma-memory-knowledge-store";

type Database = PrismaClient | Prisma.TransactionClient;
export function automaticMemoryLineageKey(
  scope: MemoryKnowledgeScope,
  sourceId: string,
): string {
  if (scope.kind !== "repository") throw new MemoryKnowledgeError("forbidden");
  return memoryKnowledgeDigest([
    scope.workspaceId,
    scope.repositoryId,
    "github_comment",
    sourceId,
  ]);
}
async function sourceLock(tx: Database, lineageKey: string) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`memory-source:${lineageKey}`},0))`,
  );
}
async function bump(
  tx: Database,
  scope: MemoryKnowledgeScope,
  now: Date,
  generation?: string,
) {
  await tx.$executeRaw(
    Prisma.sql`UPDATE "MemoryKnowledgeScopeState" SET "epoch"="epoch"+1,"updatedAt"=${now} WHERE "scopeKey"=${memoryKnowledgeScopeKey(scope)} AND (${generation ?? null}::text IS NULL OR "generation"=${generation ?? null})`,
  );
}
async function read(
  tx: Database,
  key: string,
): Promise<MemoryAutomaticSourceState | null> {
  const [row] = await tx.$queryRaw<{ state: MemoryAutomaticSourceState }[]>(
    Prisma.sql`SELECT "state" FROM "MemoryAutomaticSource" WHERE "lineageKey"=${key}`,
  );
  return row?.state ?? null;
}
async function write(
  tx: Database,
  state: MemoryAutomaticSourceState,
  now: Date,
) {
  await tx.$executeRaw(
    Prisma.sql`INSERT INTO "MemoryAutomaticSource" ("lineageKey","workspaceId","scopeKey","state","updatedAt") VALUES (${state.binding.lineageKey},${state.scope.workspaceId},${memoryKnowledgeScopeKey(state.scope)},${JSON.stringify(state)}::jsonb,${now}) ON CONFLICT ("lineageKey") DO UPDATE SET "state"=EXCLUDED."state","updatedAt"=EXCLUDED."updatedAt"`,
  );
}

export class PrismaMemoryAutomaticSourceStore implements MemoryAutomaticSourceStore {
  constructor(private readonly prisma: PrismaClient) {}
  lookup(scope: MemoryKnowledgeScope, sourceId: string) {
    return read(this.prisma, automaticMemoryLineageKey(scope, sourceId));
  }
  async lookupLineage(
    scope: MemoryKnowledgeScope,
    lineageKey: string,
  ): Promise<MemoryAutomaticSourceState | null> {
    const state = await read(this.prisma, lineageKey);
    return state &&
      memoryKnowledgeScopeKey(state.scope) === memoryKnowledgeScopeKey(scope)
      ? state
      : null;
  }
  async reserve(
    input: Parameters<MemoryAutomaticSourceStore["reserve"]>[0],
  ): Promise<MemoryAutomaticSourceState> {
    return this.prisma.$transaction((tx) =>
      reserveAutomaticMemorySource(tx, input),
    );
  }
  async invalidate(
    input: Parameters<MemoryAutomaticSourceStore["invalidate"]>[0],
  ): Promise<void> {
    const key = automaticMemoryLineageKey(input.scope, input.sourceId);
    await this.prisma.$transaction(async (tx) => {
      // Every generation shares this lineage lock. Scope rows are always acquired first.
      await lockExistingSourceScopes(tx, input.scope);
      await sourceLock(tx, key);
      const prior = await read(tx, key);
      if (!prior) {
        // Trusted deletion is authoritative even while the first preview is in flight.
        if (input.cause !== "deleted" || input.expectedBinding) return;
        if (input.scope.kind !== "repository")
          throw new MemoryKnowledgeError("forbidden");
        await write(
          tx,
          {
            scope: input.scope,
            sourceId: input.sourceId,
            binding: {
              lineageKey: key,
              epoch: "1",
              cohortId: null,
              sourceRevision: null,
            },
            source: null,
            sourceUpdatedAt: null,
            state: "unselected",
            invalidatedBy: "deleted",
            lastCompleteCohort: false,
            suppressed: true,
            suppressionEpoch: "1",
            entryIds: [],
          },
          input.now,
        );
        await bump(tx, input.scope, input.now);
        return;
      }
      if (
        input.expectedBinding &&
        (prior.binding.lineageKey !== input.expectedBinding.lineageKey ||
          prior.binding.cohortId !== input.expectedBinding.cohortId ||
          prior.binding.epoch !== input.expectedBinding.epoch ||
          prior.binding.sourceRevision !== input.expectedBinding.sourceRevision)
      )
        return;
      if (prior.state === "unselected") {
        if (input.cause !== "deleted" || prior.suppressed) return;
        await write(
          tx,
          {
            ...prior,
            suppressed: true,
            suppressionEpoch: String(BigInt(prior.suppressionEpoch) + 1n),
            binding: {
              ...prior.binding,
              epoch: String(BigInt(prior.binding.epoch) + 1n),
            },
          },
          input.now,
        );
        await bump(tx, input.scope, input.now);
        return;
      }
      // Delivery uncertainty is a status of this still-pending cohort, not a source
      // revision change. A stale replay must never withdraw an already active set.
      if (input.cause === "delivery_uncertain" && prior.state !== "pending")
        return;
      if (
        prior.state === "needs_refresh" &&
        prior.invalidatedBy !== "delivery_uncertain" &&
        (input.cause !== "deleted" || prior.suppressed)
      )
        return;
      await write(
        tx,
        {
          ...prior,
          state: "needs_refresh",
          invalidatedBy: input.cause,
          lastCompleteCohort:
            prior.state === "active" || prior.lastCompleteCohort === true,
          suppressed: prior.suppressed || input.cause === "deleted",
          suppressionEpoch:
            input.cause === "deleted"
              ? String(BigInt(prior.suppressionEpoch ?? "0") + 1n)
              : prior.suppressionEpoch,
          binding: {
            ...prior.binding,
            epoch:
              input.cause === "delivery_uncertain"
                ? prior.binding.epoch
                : String(BigInt(prior.binding.epoch) + 1n),
          },
        },
        input.now,
      );
      await bump(tx, input.scope, input.now);
    });
  }
  async recoverAvailability(
    input: Parameters<MemoryAutomaticSourceStore["recoverAvailability"]>[0],
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockMemoryKnowledgeScopes(tx, [input.ref.scope], input.generation);
      await sourceLock(tx, input.binding.lineageKey);
      const state = await read(tx, input.binding.lineageKey);
      if (
        !state ||
        state.state !== "needs_refresh" ||
        state.invalidatedBy !== "unavailable" ||
        !state.lastCompleteCohort ||
        state.binding.cohortId !== input.binding.cohortId ||
        state.binding.sourceRevision !== input.binding.sourceRevision
      )
        return false;
      const entries = await tx.$queryRaw<
        {
          entryId: string;
          metadata: MemoryKnowledgeEntryMetadata;
          bodyDigest: string;
        }[]
      >(
        Prisma.sql`SELECT e."entryId",e."metadata",a."bodyDigest" FROM "MemoryAutomaticEntry" a JOIN "MemoryKnowledgeEntry" e USING ("generation","scopeKey","entryId") WHERE a."generation"=${input.generation} AND a."lineageKey"=${input.binding.lineageKey} AND a."cohortId"=${input.binding.cohortId} AND a."ownership"='automatic'`,
      );
      if (
        entries.length !== state.entryIds.length ||
        entries.some(
          (entry) =>
            !state.entryIds.includes(entry.entryId) ||
            (entry.metadata.lifecycle === "active" &&
              (entry.metadata.pendingCommandId !== null ||
                entry.metadata.revocationCommandId !== null ||
                !entry.metadata.contentApprovalRevision ||
                entry.metadata.bodyDigest !== entry.bodyDigest)),
        )
      )
        return false;
      for (const entry of entries) {
        const metadata = {
          ...entry.metadata,
          automaticSource: {
            ...entry.metadata.automaticSource!,
            epoch: state.binding.epoch,
          },
        };
        await tx.$executeRaw(
          Prisma.sql`UPDATE "MemoryKnowledgeEntry" SET "metadata"=${JSON.stringify(metadata)}::jsonb,"updatedAt"=${input.now} WHERE "generation"=${input.generation} AND "scopeKey"=${memoryKnowledgeScopeKey(input.ref.scope)} AND "entryId"=${entry.entryId}`,
        );
        await tx.$executeRaw(
          Prisma.sql`UPDATE "MemoryAutomaticEntry" SET "epoch"=${state.binding.epoch} WHERE "generation"=${input.generation} AND "scopeKey"=${memoryKnowledgeScopeKey(input.ref.scope)} AND "entryId"=${entry.entryId}`,
        );
      }
      await write(tx, { ...state, state: "active" }, input.now);
      await bump(tx, input.ref.scope, input.now, input.generation);
      return true;
    });
  }
  async clearSuppression(
    input: Parameters<MemoryAutomaticSourceStore["clearSuppression"]>[0],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockExistingSourceScopes(tx, input.scope);
      await sourceLock(
        tx,
        automaticMemoryLineageKey(input.scope, input.sourceId),
      );
      const prior = await read(
        tx,
        automaticMemoryLineageKey(input.scope, input.sourceId),
      );
      if (
        !prior ||
        prior.binding.epoch !== input.expectedEpoch ||
        (prior.suppressionEpoch ?? "0") !== input.expectedSuppressionEpoch
      )
        throw new MemoryKnowledgeError("conflict");
      if (input.entry) {
        const [entry] = await tx.$queryRaw<
          { revision: number; metadata: MemoryKnowledgeEntryMetadata }[]
        >(
          Prisma.sql`SELECT "revision","metadata" FROM "MemoryKnowledgeEntry" WHERE "generation"=${input.entry.generation} AND "scopeKey"=${memoryKnowledgeScopeKey(input.entry.ref.scope)} AND "entryId"=${input.entry.ref.entryId}`,
        );
        if (
          !entry ||
          String(entry.revision) !== input.entry.expectedRevision ||
          entry.metadata.automaticSource?.lineageKey !==
            prior.binding.lineageKey
        )
          throw new MemoryKnowledgeError("conflict");
      }
      await write(
        tx,
        {
          ...prior,
          suppressed: false,
          suppressionEpoch: String(BigInt(prior.suppressionEpoch ?? "0") + 1n),
        },
        input.now,
      );
      await bump(tx, input.scope, input.now);
    });
  }
  applicable(
    ref: MemoryEntryRef,
    generation: string,
    binding: MemoryAutomaticSourceBinding,
  ): Promise<boolean> {
    return automaticMemoryEntryApplicable(
      this.prisma,
      ref,
      generation,
      binding,
    );
  }
}

/** Uses the caller's command transaction; no native or source I/O. */
export async function reserveAutomaticMemorySource(
  tx: Prisma.TransactionClient,
  input: Parameters<MemoryAutomaticSourceStore["reserve"]>[0],
): Promise<MemoryAutomaticSourceState> {
  const { scope, source } = input.input;
  const key = automaticMemoryLineageKey(scope, source.sourceId);
  if (
    input.entryIds.length > 4 ||
    input.entryIds.length !== input.bodyDigests.length ||
    new Set(input.entryIds).size !== input.entryIds.length
  )
    throw new MemoryKnowledgeError("invalid_input");
  await lockMemoryKnowledgeScopes(tx, [scope], input.generation);
  await sourceLock(tx, key);
  const prior = await read(tx, key);
  const cohortId = automaticMemoryCohortId(input.input.processingId);
  if (prior?.suppressed || prior?.binding.cohortId === cohortId) return prior;
  if ((prior?.binding.epoch ?? null) !== input.expectedPriorEpoch)
    throw new MemoryKnowledgeError("conflict");
  const binding: MemoryAutomaticSourceBinding = {
    lineageKey: key,
    cohortId,
    epoch: String(BigInt(prior?.binding.epoch ?? "0") + 1n),
    sourceRevision: source.revision,
    policyRevision: input.input.policyRevision,
    sourceActorId: input.input.sourceActor.id,
    observedCommitSha: input.input.headSha,
  };
  const state: MemoryAutomaticSourceState = {
    binding,
    scope,
    sourceId: source.sourceId,
    sourceUpdatedAt: source.updatedAt,
    source,
    state: input.entryIds.length ? "pending" : "active",
    suppressed: false,
    suppressionEpoch: prior?.suppressionEpoch ?? "0",
    entryIds: input.entryIds,
  };
  await write(tx, state, input.now);
  for (const [i, entryId] of input.entryIds.entries())
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "MemoryAutomaticEntry" ("generation","scopeKey","entryId","lineageKey","cohortId","epoch","bodyDigest","ownership") VALUES (${input.generation},${memoryKnowledgeScopeKey(scope)},${entryId},${key},${cohortId},${binding.epoch},${input.bodyDigests[i]!},'automatic') ON CONFLICT DO NOTHING`,
    );
  await bump(tx, scope, input.now, input.generation);
  return state;
}

/** The host calls under its existing scope locks inside the authoritative grant transaction. No source/native I/O. */
export async function automaticMemoryEntryApplicable(
  tx: Database,
  ref: MemoryEntryRef,
  generation: string,
  binding: MemoryAutomaticSourceBinding,
): Promise<boolean> {
  await sourceLock(tx, binding.lineageKey);
  const source = await read(tx, binding.lineageKey);
  if (
    !source ||
    source.state !== "active" ||
    source.binding.cohortId !== binding.cohortId ||
    source.binding.epoch !== binding.epoch ||
    source.binding.sourceRevision !== binding.sourceRevision ||
    !source.entryIds.includes(ref.entryId)
  )
    return false;
  const [entry] = await tx.$queryRaw<
    { ownership: string; cohortId: string; epoch: string }[]
  >(
    Prisma.sql`SELECT "ownership","cohortId","epoch" FROM "MemoryAutomaticEntry" WHERE "generation"=${generation} AND "scopeKey"=${memoryKnowledgeScopeKey(ref.scope)} AND "entryId"=${ref.entryId} AND "lineageKey"=${binding.lineageKey}`,
  );
  return (
    entry?.ownership === "automatic" &&
    entry.cohortId === binding.cohortId &&
    entry.epoch === binding.epoch
  );
}
/** Must run in the command reservation transaction before overwriting provenance or clearing forgotten metadata. */
export async function transitionAutomaticMemoryOwnership(
  tx: Database,
  input: {
    readonly ref: MemoryEntryRef;
    readonly metadata: MemoryKnowledgeEntryMetadata | null;
    readonly commandKind: string;
    readonly automaticSource?: MemoryAutomaticSourceBinding;
    readonly internalRetirement?: MemoryAutomaticSourceBinding;
    readonly now: Date;
  },
): Promise<void> {
  const metadata = input.metadata;
  if (input.internalRetirement && !metadata?.automaticSource)
    throw new MemoryKnowledgeError("conflict");
  const binding = metadata?.automaticSource ?? input.automaticSource;
  if (!binding) return;
  await sourceLock(tx, binding.lineageKey);
  const state = await read(tx, binding.lineageKey);
  if (!state) throw new MemoryKnowledgeError("conflict");
  if (input.automaticSource) {
    if (
      state.suppressed ||
      state.state !== "pending" ||
      state.binding.cohortId !== binding.cohortId ||
      state.binding.epoch !== binding.epoch ||
      !state.entryIds.includes(input.ref.entryId)
    )
      throw new MemoryKnowledgeError("conflict");
    return;
  }
  if (!metadata) return;
  if (input.internalRetirement) {
    const [entry] = await tx.$queryRaw<
      { ownership: string; cohortId: string }[]
    >(
      Prisma.sql`SELECT "ownership","cohortId" FROM "MemoryAutomaticEntry" WHERE "generation"=${metadata.generation} AND "scopeKey"=${memoryKnowledgeScopeKey(metadata.ref.scope)} AND "entryId"=${metadata.ref.entryId}`,
    );
    if (
      entry?.ownership !== "automatic" ||
      entry.cohortId !== input.internalRetirement.cohortId ||
      binding.cohortId !== input.internalRetirement.cohortId
    )
      throw new MemoryKnowledgeError("conflict");
    return;
  }
  if (input.commandKind === "retire" || input.commandKind === "forget")
    await write(
      tx,
      {
        ...state,
        suppressed: true,
        suppressionEpoch: String(BigInt(state.suppressionEpoch ?? "0") + 1n),
      },
      input.now,
    );
  if (input.commandKind === "save") {
    await tx.$executeRaw(
      Prisma.sql`UPDATE "MemoryAutomaticEntry" SET "ownership"='maintained' WHERE "generation"=${metadata.generation} AND "scopeKey"=${memoryKnowledgeScopeKey(metadata.ref.scope)} AND "entryId"=${metadata.ref.entryId}`,
    );
    await write(
      tx,
      {
        ...state,
        entryIds: state.entryIds.filter((id) => id !== metadata.ref.entryId),
      },
      input.now,
    );
  }
}
/** Only the final complete, verified child may activate the full cohort. Late callbacks cannot reactivate old sets. */
export async function activateAutomaticMemoryCohort(
  tx: Database,
  metadata: MemoryKnowledgeEntryMetadata,
  now: Date,
): Promise<void> {
  const binding = metadata.automaticSource;
  if (!binding) return;
  await sourceLock(tx, binding.lineageKey);
  const state = await read(tx, binding.lineageKey);
  if (
    !state ||
    (state.state !== "pending" &&
      !(
        state.state === "needs_refresh" &&
        state.invalidatedBy === "delivery_uncertain"
      )) ||
    state.suppressed ||
    state.binding.cohortId !== binding.cohortId ||
    state.binding.epoch !== binding.epoch
  )
    return;
  const rows = await tx.$queryRaw<
    {
      entryId: string;
      metadata: MemoryKnowledgeEntryMetadata;
      bodyDigest: string;
    }[]
  >(
    Prisma.sql`SELECT e."entryId",e."metadata",a."bodyDigest" FROM "MemoryAutomaticEntry" a JOIN "MemoryKnowledgeEntry" e USING ("generation","scopeKey","entryId") WHERE a."lineageKey"=${binding.lineageKey} AND a."cohortId"=${binding.cohortId} AND a."epoch"=${binding.epoch} AND a."ownership"='automatic'`,
  );
  if (
    rows.length !== state.entryIds.length ||
    rows.some(
      (r) =>
        !state.entryIds.includes(r.entryId) ||
        r.metadata.pendingCommandId ||
        r.metadata.revocationCommandId ||
        r.metadata.lifecycle !== "active" ||
        !r.metadata.contentApprovalRevision ||
        r.metadata.bodyDigest !== r.bodyDigest,
    )
  )
    return;
  await write(tx, { ...state, state: "active" }, now);
  await bump(tx, state.scope, now, metadata.generation);
}
async function lockExistingSourceScopes(
  tx: Database,
  scope: MemoryKnowledgeScope,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "epoch" FROM "MemoryKnowledgeScopeState" WHERE "scopeKey"=${memoryKnowledgeScopeKey(scope)} ORDER BY "generation" FOR UPDATE`,
  );
}
