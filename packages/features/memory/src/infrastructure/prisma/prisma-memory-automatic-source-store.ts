import { Prisma, type PrismaClient } from "@prisma/client";
import {
  MemoryKnowledgeError,
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
async function bump(tx: Database, scope: MemoryKnowledgeScope, now: Date) {
  await tx.$executeRaw(
    Prisma.sql`UPDATE "MemoryKnowledgeScopeState" SET "epoch"="epoch"+1,"updatedAt"=${now} WHERE "scopeKey"=${memoryKnowledgeScopeKey(scope)}`,
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
  async reserve(
    input: Parameters<MemoryAutomaticSourceStore["reserve"]>[0],
  ): Promise<MemoryAutomaticSourceState> {
    const { scope, source } = input.input;
    const key = automaticMemoryLineageKey(scope, source.sourceId);
    if (
      input.entryIds.length > 4 ||
      input.entryIds.length !== input.bodyDigests.length
    )
      throw new MemoryKnowledgeError("invalid_input");
    return this.prisma.$transaction(async (tx) => {
      await lockMemoryKnowledgeScopes(tx, [scope], input.generation);
      await sourceLock(tx, key);
      const prior = await read(tx, key);
      const cohortId = memoryKnowledgeDigest([
        "automatic-cohort",
        input.input.processingId,
      ]);
      if (prior?.suppressed || prior?.binding.cohortId === cohortId)
        return prior;
      if (
        prior &&
        Date.parse(prior.sourceUpdatedAt) > Date.parse(source.updatedAt)
      )
        throw new MemoryKnowledgeError("conflict");
      if (
        prior &&
        prior.sourceUpdatedAt === source.updatedAt &&
        prior.source.revision !== source.revision
      )
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
        entryIds: input.entryIds,
      };
      await write(tx, state, input.now);
      for (const [i, entryId] of input.entryIds.entries())
        await tx.$executeRaw(
          Prisma.sql`INSERT INTO "MemoryAutomaticEntry" ("generation","scopeKey","entryId","lineageKey","cohortId","epoch","bodyDigest","ownership") VALUES (${input.generation},${memoryKnowledgeScopeKey(scope)},${entryId},${key},${cohortId},${binding.epoch},${input.bodyDigests[i]!},'automatic') ON CONFLICT DO NOTHING`,
        );
      await bump(tx, scope, input.now);
      return state;
    });
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
      if (!prior) return;
      if (
        prior.state === "needs_refresh" &&
        (input.cause !== "deleted" || prior.suppressed)
      )
        return;
      await write(
        tx,
        {
          ...prior,
          state: "needs_refresh",
          suppressed: prior.suppressed || input.cause === "deleted",
          binding: {
            ...prior.binding,
            epoch: String(BigInt(prior.binding.epoch) + 1n),
          },
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

/** The host calls under its existing scope locks inside the authoritative grant transaction. No source/native I/O. */
export async function automaticMemoryEntryApplicable(
  tx: Database,
  ref: MemoryEntryRef,
  generation: string,
  binding: MemoryAutomaticSourceBinding,
): Promise<boolean> {
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
    await write(tx, { ...state, suppressed: true }, input.now);
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
    state.state !== "pending" ||
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
  await bump(tx, state.scope, now);
}
async function lockExistingSourceScopes(
  tx: Database,
  scope: MemoryKnowledgeScope,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT "epoch" FROM "MemoryKnowledgeScopeState" WHERE "scopeKey"=${memoryKnowledgeScopeKey(scope)} ORDER BY "generation" FOR UPDATE`,
  );
}
