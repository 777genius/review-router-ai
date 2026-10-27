import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createMemoryBodyHash } from "../../domain/memory-body";
import { memoryCleanupAuthorityMatches } from "../../application/memory-cleanup-policy";
import { memoryActorRef } from "../../domain/memory-actor";
import {
  MemoryKnowledgeError,
  memoryKnowledgeCommandDigest,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  memoryKnowledgeTopicsDigest,
  normalizeMemoryKnowledgeCommand,
  sameMemoryKnowledgeScope,
  type MemoryEntryRef,
  type MemoryKnowledgeCommand,
  type MemoryKnowledgeApproval,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeErrorCode,
  type MemoryKnowledgeOperation,
  type MemoryKnowledgeScope,
} from "../../domain/memory-knowledge";
import type {
  MemoryKnowledgeStore,
  MemoryStoredCommand,
  MemoryVerifiedCleanupReceipt,
  MemoryKnowledgeMaintenanceState,
} from "../../application/ports/memory-knowledge-store-port";
import type { MemoryProviderOperation } from "../../application/ports/memory-knowledge-provider-port";

type Database = PrismaClient | Prisma.TransactionClient;
type CommandRow = {
  id: string;
  generation: string;
  scopeKey: string;
  workspaceId: string;
  entryId: string;
  revision: number;
  commandKind: MemoryKnowledgeCommand["kind"];
  digest: string;
  approval: MemoryKnowledgeApproval;
  envelope: MemoryKnowledgeCommand | null;
  state: MemoryKnowledgeOperation["state"];
  safeReason: MemoryKnowledgeErrorCode | null;
  contentApprovalRevision: string;
  originalStatementAt: string | null;
  deliveryExpiresAt: Date;
  resubmitUntil: Date;
  claimId: string | null;
  claimUntil: Date | null;
  firstDispatchedAt: Date | null;
  deliveryAttempt: number;
  cleanupReceiptId: string | null;
};
type EntryRow = {
  generation: string;
  scopeKey: string;
  workspaceId: string;
  entryId: string;
  lifecycle: string;
  metadata: MemoryKnowledgeEntryMetadata;
  revision: number;
  pendingCommandId: string | null;
  revocationCommandId: string | null;
};
const terminal = new Set(["published", "completed", "failed"]);

/** SQL is intentionally scoped to authority/delivery tables, never provider content. */
export class PrismaMemoryKnowledgeStore implements MemoryKnowledgeStore {
  constructor(private readonly prisma: PrismaClient) {}

  async maintenanceState(
    generation: string,
  ): Promise<MemoryKnowledgeMaintenanceState> {
    return readMemoryMaintenanceState(this.prisma, generation);
  }

  async setMaintenancePaused(
    input: Parameters<MemoryKnowledgeStore["setMaintenancePaused"]>[0],
  ): Promise<MemoryKnowledgeMaintenanceState> {
    if (!input.actor || !/^[0-9]+$/.test(input.expectedEpoch))
      throw new MemoryKnowledgeError("invalid_input");
    return this.boundedTransaction(input.now, input.deadlineAt, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${deliveryFenceKey(input.generation)},0))`,
      );
      const current = await readMemoryMaintenanceState(tx, input.generation);
      if (current.epoch !== input.expectedEpoch)
        throw new MemoryKnowledgeError("conflict");
      if (current.paused === input.paused) return current;
      const epoch = String(BigInt(current.epoch) + 1n);
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO "MemoryKnowledgeMaintenanceFence" ("generation","epoch","paused","actor","updatedAt") VALUES (${input.generation},${BigInt(epoch)},${input.paused},${input.actor},${input.now}) ON CONFLICT ("generation") DO UPDATE SET "epoch"=EXCLUDED."epoch","paused"=EXCLUDED."paused","actor"=EXCLUDED."actor","updatedAt"=EXCLUDED."updatedAt"`,
      );
      if (!input.paused) {
        const pending = await tx.$queryRaw<CommandRow[]>(
          Prisma.sql`SELECT c.* FROM "MemoryKnowledgeCommand" c JOIN "MemoryKnowledgeEntry" e ON e."generation"=c."generation" AND e."scopeKey"=c."scopeKey" AND e."entryId"=c."entryId" AND e."pendingCommandId"=c."id" WHERE c."generation"=${input.generation} AND c."state" NOT IN ('published','completed','failed','cleanup_pending') AND c."envelope" IS NOT NULL AND c."deliveryExpiresAt">${input.now} ORDER BY c."id" LIMIT 1001`,
        );
        if (pending.length > 1000)
          throw new MemoryKnowledgeError("input_required");
        if (pending.length)
          await tx.outboxEvent.createMany({
            data: pending.map((row) => ({
              id: randomUUID(),
              type: "memory.knowledge.command.requested",
              version: 2,
              idempotencyKey: `memory.knowledge.command.resume:${row.id}:${epoch}`,
              workspaceId: row.workspaceId,
              aggregateId: row.entryId,
              payload: {
                commandId: row.id,
                generation: row.generation,
                scope: row.envelope!.ref.scope,
              },
              occurredAt: input.now,
            })),
          });
      }
      return { generation: input.generation, epoch, paused: input.paused };
    });
  }

  async withDeliveryPermit<T>(
    input: Parameters<MemoryKnowledgeStore["withDeliveryPermit"]>[0],
    work: (permit: { readonly revoked: boolean }) => Promise<T>,
  ): Promise<
    | { readonly permitted: false }
    | { readonly permitted: true; readonly value: T }
  > {
    return this.boundedTransaction(input.now, input.deadlineAt, async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${deliveryFenceKey(input.generation)},0))`,
      );
      const row = await this.command(tx, input.commandId);
      if (
        !row ||
        row.generation !== input.generation ||
        row.scopeKey !== memoryKnowledgeScopeKey(input.scope) ||
        row.claimId !== input.claimId ||
        terminal.has(row.state)
      )
        throw new MemoryKnowledgeError("conflict");
      const maintenance = await readMemoryMaintenanceState(
        tx,
        input.generation,
      );
      if (maintenance.paused) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE "MemoryKnowledgeCommand" SET "claimId"=NULL,"claimUntil"=NULL,"state"='unknown',"updatedAt"=${input.now} WHERE "id"=${row.id} AND "claimId"=${input.claimId} AND "state" NOT IN ('published','completed','failed')`,
        );
        return { permitted: false as const };
      }
      const current = await this.entry(
        tx,
        { type: "entry", scope: input.scope, entryId: row.entryId },
        input.generation,
      );
      if (!current || current.pendingCommandId !== row.id)
        throw new MemoryKnowledgeError("conflict");
      // Never call settle/claim recursively from work: this callback owns one
      // borrowed transaction solely for the bounded external transport barrier.
      const value = await work({
        revoked: Boolean(
          current.revocationCommandId && current.revocationCommandId !== row.id,
        ),
      });
      return { permitted: true as const, value };
    });
  }

  private async boundedTransaction<T>(
    now: Date,
    deadlineAt: Date,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const remaining = deadlineAt.getTime() - now.getTime();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 60000)
      throw new MemoryKnowledgeError("deadline_exceeded", true);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT set_config('lock_timeout',${String(Math.ceil(remaining))},true)`,
          );
          await tx.$executeRaw(
            Prisma.sql`SELECT set_config('statement_timeout',${String(Math.ceil(remaining))},true)`,
          );
          return work(tx);
        },
        { maxWait: Math.min(1000, remaining), timeout: remaining + 5000 },
      );
    } catch (error) {
      if (error instanceof MemoryKnowledgeError) throw error;
      throw new MemoryKnowledgeError("unavailable", true);
    }
  }

  async admit(
    input: Parameters<MemoryKnowledgeStore["admit"]>[0],
  ): Promise<MemoryKnowledgeOperation> {
    const command = normalizeMemoryKnowledgeCommand(input.command);
    if (
      memoryKnowledgeCommandDigest(command) !== input.digest ||
      input.deliveryExpiresAt <= input.now ||
      input.resubmitUntil > input.deliveryExpiresAt ||
      input.resubmitUntil < input.now ||
      input.deliveryExpiresAt.getTime() - input.now.getTime() >
        30 * 86_400_000 ||
      JSON.stringify(command).length > 16_000
    )
      throw new MemoryKnowledgeError("invalid_input");
    return this.prisma.$transaction(async (tx) => {
      // Pause and admission use the same order as transport/cleanup: generation
      // barrier first, then scope locks. A pause cannot overtake an admitted write.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${deliveryFenceKey(command.generation)},0))`,
      );
      // Quota, source cursors and admission must agree across scopes/processes.
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`memory-admission:${command.ref.scope.workspaceId}`}, 0))`,
      );
      await tx.$executeRaw(
        Prisma.sql`INSERT INTO "MemoryKnowledgeMaintenanceFence" ("generation","epoch","paused","actor","updatedAt") VALUES (${command.generation},0,false,'initial_admission',${input.now}) ON CONFLICT DO NOTHING`,
      );
      if (
        (command.kind === "save" || command.kind === "topics") &&
        (await readMemoryMaintenanceState(tx, command.generation)).paused
      )
        throw new MemoryKnowledgeError("unavailable", true);
      await this.lockScope(tx, command.ref.scope, command.generation);
      const existingCommand = await this.command(tx, command.commandId);
      if (existingCommand) {
        if (
          existingCommand.digest !== input.digest ||
          existingCommand.generation !== command.generation ||
          existingCommand.scopeKey !==
            memoryKnowledgeScopeKey(command.ref.scope)
        )
          throw new MemoryKnowledgeError("conflict");
        return this.operation(existingCommand, command.ref.scope);
      }
      const current = await this.entry(tx, command.ref, command.generation);
      if (
        !current &&
        (command.kind !== "save" || command.expectedRevision !== null)
      )
        throw new MemoryKnowledgeError("not_found");
      if (current && command.expectedRevision !== String(current.revision))
        throw new MemoryKnowledgeError("conflict");
      if (
        command.kind === "expire" &&
        (!current ||
          current.metadata.lifecycle !== "active" ||
          !current.metadata.applicability.validUntil ||
          Date.parse(current.metadata.applicability.validUntil) >
            input.now.getTime())
      )
        throw new MemoryKnowledgeError("conflict");
      const urgent =
        command.kind === "retire" ||
        command.kind === "expire" ||
        command.kind === "forget";
      if (current) {
        if (
          current.metadata.lifecycle === "forgotten" ||
          current.metadata.lifecycle === "forget_pending" ||
          current.revocationCommandId
        )
          throw new MemoryKnowledgeError("conflict");
        if (
          !urgent &&
          (current.pendingCommandId ||
            current.metadata.lifecycle !== "active" ||
            (current.metadata.applicability.validUntil &&
              Date.parse(current.metadata.applicability.validUntil) <=
                input.now.getTime()))
        )
          throw new MemoryKnowledgeError("conflict");
      }
      const [counts] = await tx.$queryRaw<
        { active: number; pending: number }[]
      >(Prisma.sql`
        SELECT (SELECT count(*)::int FROM "MemoryKnowledgeEntry" WHERE "workspaceId"=${command.ref.scope.workspaceId} AND "lifecycle"='active' AND ("pendingCommandId" IS NOT NULL OR "metadata"->>'contentApprovalRevision' IS NOT NULL)) AS active,
          (SELECT count(*)::int FROM "MemoryKnowledgeCommand" WHERE "workspaceId"=${command.ref.scope.workspaceId} AND "state" NOT IN ('published','completed','failed')) AS pending`);
      if (
        !current &&
        input.activeEntryLimit !== null &&
        (counts?.active ?? 0) >= input.activeEntryLimit
      )
        throw new MemoryKnowledgeError("quota_exceeded");
      if (!urgent && (counts?.pending ?? 0) >= input.pendingCommandLimit)
        throw new MemoryKnowledgeError("quota_exceeded");
      if (command.kind === "save")
        await this.reserveSource(tx, command, input.now);
      const revision = (current?.revision ?? 0) + 1;
      const isSameBody =
        command.kind === "save" &&
        current?.metadata.bodyDigest === createMemoryBodyHash(command.body);
      const originalStatementAt =
        command.kind === "save"
          ? isSameBody
            ? current!.metadata.originalStatementAt
            : command.source.statementAt
          : current!.metadata.originalStatementAt;
      const contentApprovalRevision =
        command.kind === "save"
          ? String(revision)
          : (current!.metadata.contentApprovalRevision ?? String(revision));
      const timestamp = input.now.toISOString();
      let metadata: MemoryKnowledgeEntryMetadata = current?.metadata ?? {
        ref: command.ref,
        generation: command.generation,
        revision: String(revision),
        contentApprovalRevision: null,
        bodyDigest: null,
        topicsDigest: null,
        kind: command.kind === "save" ? command.knowledgeKind : "rule",
        lifecycle: "active",
        approval: null,
        source: null,
        applicability:
          command.kind === "save"
            ? command.applicability
            : {
                validUntil: null,
                observedCommitSha: null,
                exceptionRule: null,
              },
        originalStatementAt: null,
        lastVerifiedAt: null,
        pendingCommandId: null,
        revocationCommandId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      metadata = {
        ...metadata,
        revision: String(revision),
        updatedAt: timestamp,
        pendingCommandId: current?.pendingCommandId ?? command.commandId,
        revocationCommandId: urgent ? command.commandId : null,
        lifecycle:
          command.kind === "forget"
            ? "forget_pending"
            : command.kind === "retire"
              ? "retired"
              : command.kind === "expire"
                ? "expired"
                : metadata.lifecycle,
      };
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "MemoryKnowledgeCommand" ("id","generation","scopeKey","workspaceId","entryId","revision","commandKind","digest","approval","envelope","state","contentApprovalRevision","originalStatementAt","deliveryExpiresAt","resubmitUntil","createdAt","updatedAt")
        VALUES (${command.commandId},${command.generation},${memoryKnowledgeScopeKey(command.ref.scope)},${command.ref.scope.workspaceId},${command.ref.entryId},${revision},${command.kind},${input.digest},${JSON.stringify(command.approval)}::jsonb,${JSON.stringify(command)}::jsonb,'queued',${contentApprovalRevision},${originalStatementAt},${input.deliveryExpiresAt},${input.resubmitUntil},${input.now},${input.now})`);
      await this.writeEntry(tx, metadata, input.now);
      await this.bumpEpoch(
        tx,
        command.ref.scope,
        command.generation,
        input.now,
      );
      await tx.outboxEvent.create({
        data: {
          type: "memory.knowledge.command.requested",
          version: 2,
          idempotencyKey: `memory.knowledge.command:${command.commandId}`,
          workspaceId: command.ref.scope.workspaceId,
          repositoryId:
            command.ref.scope.kind === "repository"
              ? command.ref.scope.repositoryId
              : null,
          aggregateId: command.ref.entryId,
          payload: {
            commandId: command.commandId,
            generation: command.generation,
            scope: command.ref.scope,
          },
          occurredAt: input.now,
        },
      });
      await tx.auditEvent.create({
        data: {
          workspaceId: command.ref.scope.workspaceId,
          actor: memoryActorRef(command.approval.actor),
          action: `memory.knowledge.${command.kind}.admitted`,
          targetType: "memory_entry",
          targetId: command.ref.entryId,
          metadata: {
            commandId: command.commandId,
            digest: input.digest,
            revision,
            generation: command.generation,
          },
        },
      });
      return {
        id: command.commandId,
        ref: command.ref,
        revision: String(revision),
        state: "queued",
      };
    });
  }

  async findEntry(
    ref: MemoryEntryRef,
    generation: string,
  ): Promise<MemoryKnowledgeEntryMetadata | null> {
    return (await this.entry(this.prisma, ref, generation))?.metadata ?? null;
  }
  async findEntries(
    refs: readonly MemoryEntryRef[],
    generation: string,
  ): Promise<readonly MemoryKnowledgeEntryMetadata[]> {
    const rows: MemoryKnowledgeEntryMetadata[] = [];
    for (const ref of refs) {
      const row = await this.findEntry(ref, generation);
      if (row) rows.push(row);
    }
    return rows;
  }
  async listEntries(input: Parameters<MemoryKnowledgeStore["listEntries"]>[0]) {
    const rows = await this.prisma.$queryRaw<
      { metadata: MemoryKnowledgeEntryMetadata }[]
    >(
      Prisma.sql`SELECT "metadata" FROM "MemoryKnowledgeEntry" WHERE "generation"=${input.generation} AND "scopeKey"=${memoryKnowledgeScopeKey(input.scope)} AND "entryId">${input.cursor ?? ""} ORDER BY "entryId" LIMIT ${input.limit + 1}`,
    );
    return {
      entries: rows.slice(0, input.limit).map((row) => row.metadata),
      nextCursor:
        rows.length > input.limit
          ? rows[input.limit - 1]!.metadata.ref.entryId
          : null,
    };
  }
  async scopeEpoch(
    scope: MemoryKnowledgeScope,
    generation: string,
  ): Promise<string> {
    const [row] = await this.prisma.$queryRaw<{ epoch: bigint }[]>(
      Prisma.sql`SELECT "epoch" FROM "MemoryKnowledgeScopeState" WHERE "generation"=${generation} AND "scopeKey"=${memoryKnowledgeScopeKey(scope)}`,
    );
    return String(row?.epoch ?? 0);
  }
  async findCommand(
    input: Parameters<MemoryKnowledgeStore["findCommand"]>[0],
  ): Promise<MemoryStoredCommand | null> {
    const row = await this.command(this.prisma, input.commandId);
    return row &&
      row.scopeKey === memoryKnowledgeScopeKey(input.scope) &&
      row.generation === input.generation
      ? this.stored(row, input.scope)
      : null;
  }

  async claim(input: Parameters<MemoryKnowledgeStore["claim"]>[0]) {
    return this.prisma.$transaction(async (tx) => {
      const [permit] = await tx.$queryRaw<{ granted: boolean }[]>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock_shared(hashtextextended(${deliveryFenceKey(input.generation)},0)) AS granted`,
      );
      if (
        !permit?.granted ||
        (await readMemoryMaintenanceState(tx, input.generation)).paused
      )
        return null;
      await this.lockScope(tx, input.scope, input.generation);
      const row = await this.command(tx, input.commandId);
      if (
        !row ||
        row.scopeKey !== memoryKnowledgeScopeKey(input.scope) ||
        row.generation !== input.generation ||
        terminal.has(row.state) ||
        (row.claimUntil && row.claimUntil > input.now)
      )
        return null;
      const ref: MemoryEntryRef = {
        type: "entry",
        scope: input.scope,
        entryId: row.entryId,
      };
      const current = await this.entry(tx, ref, input.generation);
      if (!current || current.pendingCommandId !== row.id) return null;
      // Unknown execution is observed, never reset to queued by lease expiry.
      const mode = row.firstDispatchedAt
        ? ("observe" as const)
        : ("submit" as const);
      if (!row.envelope || row.deliveryExpiresAt <= input.now) {
        await tx.$executeRaw(
          Prisma.sql`UPDATE "MemoryKnowledgeCommand" SET "envelope"=NULL,"state"='unknown',"safeReason"='input_required',"updatedAt"=${input.now} WHERE "id"=${row.id}`,
        );
        return null;
      }
      await tx.$executeRaw(
        Prisma.sql`UPDATE "MemoryKnowledgeCommand" SET "state"='unknown',"claimId"=${input.claimId},"claimUntil"=${input.claimUntil},"firstDispatchedAt"=COALESCE("firstDispatchedAt",${input.now}),"updatedAt"=${input.now} WHERE "id"=${row.id}`,
      );
      return {
        command: this.stored(row, input.scope),
        claimId: input.claimId,
        mode,
      };
    });
  }

  async settle(
    input: Parameters<MemoryKnowledgeStore["settle"]>[0],
  ): Promise<MemoryKnowledgeOperation> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockScope(tx, input.scope, input.generation);
      const row = await this.command(tx, input.commandId);
      if (
        !row ||
        row.generation !== input.generation ||
        row.scopeKey !== memoryKnowledgeScopeKey(input.scope)
      )
        throw new MemoryKnowledgeError("not_found");
      if (terminal.has(row.state)) return this.operation(row, input.scope);
      if (
        row.claimId !== input.claimId ||
        input.result.commandId !== row.id ||
        !row.envelope
      )
        throw new MemoryKnowledgeError("conflict");
      const command = row.envelope;
      const current = await this.entry(tx, command.ref, input.generation);
      if (!current || current.pendingCommandId !== row.id)
        throw new MemoryKnowledgeError("conflict");
      let state = input.result.state;
      if (
        command.kind === "forget" &&
        (state === "completed" || state === "published" || state === "failed")
      )
        state = "cleanup_pending";
      if (state === "failed" && !input.result.executionSettled)
        state = "unknown";
      if (
        (state === "published" || state === "completed") &&
        !this.verifiedPublication(row, current.metadata, input.result)
      )
        state = command.kind === "forget" ? "cleanup_pending" : "unknown";
      const done = terminal.has(state);
      if (done) {
        let metadata = current.metadata;
        if (state !== "failed")
          metadata = this.applyPublished(metadata, row, input.now);
        // An older acknowledgement cannot remove a newer revocation fence.
        const nextPending =
          current.revocationCommandId && current.revocationCommandId !== row.id
            ? current.revocationCommandId
            : null;
        metadata = {
          ...metadata,
          pendingCommandId: nextPending,
          revocationCommandId:
            current.revocationCommandId === row.id
              ? null
              : current.revocationCommandId,
          updatedAt: input.now.toISOString(),
        };
        await this.writeEntry(tx, metadata, input.now);
        await this.bumpEpoch(tx, input.scope, input.generation, input.now);
        if (nextPending)
          await tx.outboxEvent.create({
            data: {
              type: "memory.knowledge.command.requested",
              version: 2,
              idempotencyKey: `memory.knowledge.command.unblocked:${nextPending}:${row.id}`,
              workspaceId: input.scope.workspaceId,
              aggregateId: row.entryId,
              payload: {
                commandId: nextPending,
                generation: input.generation,
                scope: input.scope,
              },
              occurredAt: input.now,
            },
          });
      }
      const safeReason =
        state === "unknown" && input.result.state !== "unknown"
          ? "incomplete_evidence"
          : (input.result.safeReason ?? null);
      await tx.$executeRaw(
        Prisma.sql`UPDATE "MemoryKnowledgeCommand" SET "state"=${state},"safeReason"=${safeReason},"envelope"=CASE WHEN ${done} THEN NULL ELSE "envelope" END,"claimId"=NULL,"claimUntil"=NULL,"deliveryAttempt"="deliveryAttempt"+1,"updatedAt"=${input.now} WHERE "id"=${row.id}`,
      );
      if (!done && state !== "cleanup_pending")
        await this.enqueueObservation(tx, row, input.scope, input.now);
      return {
        ...this.operation(row, input.scope),
        state,
        ...(safeReason ? { safeReason } : {}),
      };
    });
  }

  async recordFailure(
    input: Parameters<MemoryKnowledgeStore["recordFailure"]>[0],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockScope(tx, input.scope, input.generation);
      const row = await this.command(tx, input.commandId);
      if (
        !row ||
        row.generation !== input.generation ||
        row.scopeKey !== memoryKnowledgeScopeKey(input.scope) ||
        row.claimId !== input.claimId ||
        terminal.has(row.state)
      )
        return;
      await tx.$executeRaw(
        Prisma.sql`UPDATE "MemoryKnowledgeCommand" SET "state"='unknown',"safeReason"=${input.safeReason},"claimId"=NULL,"claimUntil"=NULL,"deliveryAttempt"="deliveryAttempt"+1,"updatedAt"=${input.now} WHERE "id"=${row.id}`,
      );
      await this.enqueueObservation(tx, row, input.scope, input.now);
    });
  }

  async completeCleanup(input: {
    readonly receipt: MemoryVerifiedCleanupReceipt;
    readonly now: Date;
  }): Promise<MemoryKnowledgeOperation> {
    const receipt = input.receipt;
    if (
      receipt.coverage !== "entry_history_and_operations" ||
      !receipt.id ||
      !receipt.verifiedBy ||
      !Number.isFinite(Date.parse(receipt.verifiedAt)) ||
      Date.parse(receipt.verifiedAt) > input.now.getTime() ||
      !/^[0-9a-f]{64}$/.test(receipt.commandDigest)
    )
      throw new MemoryKnowledgeError("invalid_input");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock_shared(hashtextextended(${deliveryFenceKey(receipt.generation)},0))`,
      );
      await this.lockScope(tx, receipt.ref.scope, receipt.generation);
      const row = await this.command(tx, receipt.commandId);
      if (
        !row ||
        row.commandKind !== "forget" ||
        row.generation !== receipt.generation ||
        row.scopeKey !== memoryKnowledgeScopeKey(receipt.ref.scope) ||
        row.entryId !== receipt.ref.entryId ||
        row.digest !== receipt.commandDigest
      )
        throw new MemoryKnowledgeError("conflict");
      const current = await this.entry(tx, receipt.ref, receipt.generation);
      const predecessor =
        current?.pendingCommandId && current.pendingCommandId !== row.id
          ? await this.command(tx, current.pendingCommandId)
          : null;
      if (
        !current ||
        !memoryCleanupAuthorityMatches({
          generation: receipt.generation,
          command: this.stored(row, receipt.ref.scope),
          row,
          entry: current,
          pending: predecessor,
        })
      )
        throw new MemoryKnowledgeError("conflict");
      if (row.state === "completed") {
        if (row.cleanupReceiptId !== receipt.id)
          throw new MemoryKnowledgeError("conflict");
        return this.operation(row, receipt.ref.scope);
      }
      const maintenance = await readMemoryMaintenanceState(
        tx,
        receipt.generation,
      );
      if (!maintenance.paused || maintenance.epoch !== receipt.maintenanceEpoch)
        throw new MemoryKnowledgeError("conflict");
      // Full entry history coverage permits disposal of every older unresolved
      // mutation, even an old Forget or a live claim whose executor was drained.
      // The scope lock serializes late ACKs; terminal settlement never reopens it.
      const superseded = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`UPDATE "MemoryKnowledgeCommand" SET "state"='failed',"safeReason"='conflict',"envelope"=NULL,"claimId"=NULL,"claimUntil"=NULL,"cleanupReceiptId"=${receipt.id},"updatedAt"=${input.now} WHERE "generation"=${row.generation} AND "scopeKey"=${row.scopeKey} AND "entryId"=${row.entryId} AND "revision"<${row.revision} AND "state" NOT IN ('published','completed','failed') RETURNING "id"`,
      );
      const metadata: MemoryKnowledgeEntryMetadata = {
        ...current.metadata,
        lifecycle: "forgotten",
        pendingCommandId: null,
        revocationCommandId: null,
        bodyDigest: null,
        contentApprovalRevision: null,
        topicsDigest: null,
        approval: null,
        source: null,
        originalStatementAt: null,
        lastVerifiedAt: null,
        updatedAt: input.now.toISOString(),
      };
      await this.writeEntry(tx, metadata, input.now);
      await this.bumpEpoch(
        tx,
        receipt.ref.scope,
        receipt.generation,
        input.now,
      );
      await tx.$executeRaw(
        Prisma.sql`UPDATE "MemoryKnowledgeCommand" SET "state"='completed',"safeReason"=NULL,"envelope"=NULL,"claimId"=NULL,"claimUntil"=NULL,"cleanupReceiptId"=${receipt.id},"updatedAt"=${input.now} WHERE "id"=${row.id}`,
      );
      await tx.auditEvent.create({
        data: {
          workspaceId: receipt.ref.scope.workspaceId,
          actor: receipt.verifiedBy,
          action: "memory.knowledge.forget.completed",
          targetType: "memory_entry",
          targetId: receipt.ref.entryId,
          metadata: {
            commandId: row.id,
            cleanupReceiptId: receipt.id,
            commandDigest: row.digest,
            generation: receipt.generation,
            supersededCommandIds: superseded
              .map((command) => command.id)
              .sort(),
          },
        },
      });
      return { ...this.operation(row, receipt.ref.scope), state: "completed" };
    });
  }

  private async enqueueObservation(
    tx: Prisma.TransactionClient,
    row: CommandRow,
    scope: MemoryKnowledgeScope,
    now: Date,
  ): Promise<void> {
    if (!row.envelope || row.deliveryExpiresAt <= now) return;
    await tx.outboxEvent.create({
      data: {
        type: "memory.knowledge.command.requested",
        version: 2,
        idempotencyKey: `memory.knowledge.command.observe:${row.id}:${row.deliveryAttempt + 1}`,
        workspaceId: scope.workspaceId,
        aggregateId: row.entryId,
        payload: { commandId: row.id, generation: row.generation, scope },
        occurredAt: now,
        nextAttemptAt: new Date(now.getTime() + 5_000),
      },
    });
  }

  async expireDeliveryEnvelopes(input: {
    readonly now: Date;
    readonly limit: number;
  }): Promise<number> {
    return this.prisma.$executeRaw(
      Prisma.sql`WITH expired AS (SELECT "id" FROM "MemoryKnowledgeCommand" WHERE "envelope" IS NOT NULL AND "deliveryExpiresAt"<=${input.now} AND ("claimUntil" IS NULL OR "claimUntil"<=${input.now}) ORDER BY "deliveryExpiresAt" LIMIT ${input.limit} FOR UPDATE SKIP LOCKED) UPDATE "MemoryKnowledgeCommand" c SET "envelope"=NULL,"state"='unknown',"safeReason"='input_required',"claimId"=NULL,"claimUntil"=NULL,"updatedAt"=${input.now} FROM expired WHERE c."id"=expired."id"`,
    );
  }

  async listExpiredEntries(
    input: Parameters<MemoryKnowledgeStore["listExpiredEntries"]>[0],
  ): Promise<readonly MemoryKnowledgeEntryMetadata[]> {
    const rows = await this.prisma.$queryRaw<
      { metadata: MemoryKnowledgeEntryMetadata }[]
    >(
      Prisma.sql`SELECT "metadata" FROM "MemoryKnowledgeEntry" WHERE "generation"=${input.generation} AND "lifecycle"='active' AND "metadata"->'applicability'->>'validUntil' IS NOT NULL AND ("metadata"->'applicability'->>'validUntil')::timestamptz<=${input.now.toISOString()}::timestamptz ORDER BY "metadata"->'applicability'->>'validUntil',"scopeKey","entryId" LIMIT ${boundedMaintenanceLimit(input.limit)}`,
    );
    return rows.map((row) => row.metadata);
  }

  async scheduleDueDeliveries(
    input: Parameters<MemoryKnowledgeStore["scheduleDueDeliveries"]>[0],
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      if ((await readMemoryMaintenanceState(tx, input.generation)).paused)
        return 0;
      const rows = await tx.$queryRaw<CommandRow[]>(
        Prisma.sql`SELECT c.* FROM "MemoryKnowledgeCommand" c JOIN "MemoryKnowledgeEntry" e ON e."generation"=c."generation" AND e."scopeKey"=c."scopeKey" AND e."entryId"=c."entryId" AND e."pendingCommandId"=c."id" WHERE c."generation"=${input.generation} AND c."state" NOT IN ('published','completed','failed','cleanup_pending') AND c."envelope" IS NOT NULL AND c."deliveryExpiresAt">${input.now} AND (c."claimUntil" IS NULL OR c."claimUntil"<=${input.now}) AND c."updatedAt"<=${new Date(input.now.getTime() - 5_000)} ORDER BY c."updatedAt",c."id" LIMIT ${boundedMaintenanceLimit(input.limit)} FOR UPDATE OF c SKIP LOCKED`,
      );
      if (!rows.length) return 0;
      const result = await tx.outboxEvent.createMany({
        skipDuplicates: true,
        data: rows.map((row) => ({
          id: randomUUID(),
          type: "memory.knowledge.command.requested",
          version: 2,
          idempotencyKey: `memory.knowledge.command.recover:${row.id}:${row.deliveryAttempt}:${Math.floor(input.now.getTime() / 5_000)}`,
          workspaceId: row.workspaceId,
          aggregateId: row.entryId,
          repositoryId:
            row.envelope!.ref.scope.kind === "repository"
              ? row.envelope!.ref.scope.repositoryId
              : null,
          payload: {
            commandId: row.id,
            generation: row.generation,
            scope: row.envelope!.ref.scope,
          },
          occurredAt: input.now,
        })),
      });
      return result.count;
    });
  }

  private verifiedPublication(
    row: CommandRow,
    metadata: MemoryKnowledgeEntryMetadata,
    result: MemoryProviderOperation,
  ): boolean {
    const command = row.envelope!;
    if (command.kind === "forget") return false;
    if (command.kind === "retire" || command.kind === "expire")
      return result.state === "completed";
    if (command.kind !== "save" && command.kind !== "topics") return false;
    const entry = result.verifiedEntry;
    if (
      result.state !== "published" ||
      !entry ||
      !sameMemoryKnowledgeScope(entry.ref.scope, command.ref.scope) ||
      entry.ref.entryId !== command.ref.entryId ||
      entry.contentApprovalRevision !== row.contentApprovalRevision ||
      entry.statementAt !== row.originalStatementAt
    )
      return false;
    if (
      command.kind === "save" &&
      (entry.bodyDigest !== createMemoryBodyHash(command.body) ||
        createMemoryBodyHash(entry.body) !==
          createMemoryBodyHash(command.body) ||
        entry.kind !== command.knowledgeKind)
    )
      return false;
    if (
      command.kind === "topics" &&
      (entry.bodyDigest !== metadata.bodyDigest ||
        createMemoryBodyHash(entry.body) !== metadata.bodyDigest ||
        entry.kind !== metadata.kind)
    )
      return false;
    return (
      memoryKnowledgeTopicsDigest(entry.topicIds) ===
      memoryKnowledgeTopicsDigest(command.topicIds)
    );
  }

  private applyPublished(
    metadata: MemoryKnowledgeEntryMetadata,
    row: CommandRow,
    now: Date,
  ): MemoryKnowledgeEntryMetadata {
    const command = row.envelope!;
    if (command.kind === "save")
      return {
        ...metadata,
        contentApprovalRevision: row.contentApprovalRevision,
        bodyDigest: createMemoryBodyHash(command.body),
        topicsDigest: memoryKnowledgeTopicsDigest(command.topicIds),
        kind: command.knowledgeKind,
        approval: command.approval,
        source: command.source,
        applicability: command.applicability,
        originalStatementAt: row.originalStatementAt,
        lastVerifiedAt: now.toISOString(),
      };
    if (command.kind === "topics")
      return {
        ...metadata,
        topicsDigest: memoryKnowledgeTopicsDigest(command.topicIds),
      };
    if (command.kind === "forget")
      return {
        ...metadata,
        lifecycle: "forgotten",
        bodyDigest: null,
        contentApprovalRevision: null,
        topicsDigest: null,
        approval: null,
        source: null,
        originalStatementAt: null,
        lastVerifiedAt: null,
      };
    return metadata;
  }

  private async reserveSource(
    tx: Database,
    command: Extract<MemoryKnowledgeCommand, { kind: "save" }>,
    now: Date,
  ): Promise<void> {
    const source = command.source;
    const key = memoryKnowledgeDigest([
      command.generation,
      command.ref.scope.workspaceId,
      source.type,
      source.repositoryId,
      source.sourceId,
    ]);
    const [cursor] = await tx.$queryRaw<{ revision: string; sourceAt: Date }[]>(
      Prisma.sql`SELECT "revision","sourceAt" FROM "MemoryKnowledgeSourceCursor" WHERE "key"=${key} FOR UPDATE`,
    );
    const sourceAt = new Date(source.updatedAt);
    if (
      cursor &&
      (cursor.sourceAt > sourceAt ||
        (cursor.sourceAt.getTime() === sourceAt.getTime() &&
          cursor.revision !== source.revision))
    )
      throw new MemoryKnowledgeError("conflict");
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "MemoryKnowledgeSourceCursor" ("key","generation","workspaceId","revision","sourceAt","updatedAt") VALUES (${key},${command.generation},${command.ref.scope.workspaceId},${source.revision},${sourceAt},${now}) ON CONFLICT ("key") DO UPDATE SET "revision"=EXCLUDED."revision","sourceAt"=EXCLUDED."sourceAt","updatedAt"=EXCLUDED."updatedAt"`,
    );
  }
  private async lockScope(
    tx: Prisma.TransactionClient,
    scope: MemoryKnowledgeScope,
    generation: string,
  ): Promise<void> {
    await lockMemoryKnowledgeScopes(tx, [scope], generation);
  }
  private async bumpEpoch(
    tx: Database,
    scope: MemoryKnowledgeScope,
    generation: string,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`UPDATE "MemoryKnowledgeScopeState" SET "epoch"="epoch"+1,"updatedAt"=${now} WHERE "generation"=${generation} AND "scopeKey"=${memoryKnowledgeScopeKey(scope)}`,
    );
  }
  private async command(
    tx: Database,
    commandId: string,
  ): Promise<CommandRow | null> {
    const [row] = await tx.$queryRaw<CommandRow[]>(
      Prisma.sql`SELECT * FROM "MemoryKnowledgeCommand" WHERE "id"=${commandId}`,
    );
    return row ?? null;
  }
  private async entry(
    tx: Database,
    ref: MemoryEntryRef,
    generation: string,
  ): Promise<EntryRow | null> {
    const [row] = await tx.$queryRaw<EntryRow[]>(
      Prisma.sql`SELECT "generation","scopeKey","workspaceId","entryId","lifecycle","metadata","revision","pendingCommandId","revocationCommandId" FROM "MemoryKnowledgeEntry" WHERE "generation"=${generation} AND "scopeKey"=${memoryKnowledgeScopeKey(ref.scope)} AND "entryId"=${ref.entryId}`,
    );
    return row ?? null;
  }
  private operation(
    row: CommandRow,
    scope: MemoryKnowledgeScope,
  ): MemoryKnowledgeOperation {
    return {
      id: row.id,
      ref: { type: "entry", scope, entryId: row.entryId },
      revision: String(row.revision),
      state: row.state,
      ...(row.safeReason ? { safeReason: row.safeReason } : {}),
    };
  }
  private stored(
    row: CommandRow,
    scope: MemoryKnowledgeScope,
  ): MemoryStoredCommand {
    return {
      operation: this.operation(row, scope),
      digest: row.digest,
      envelope: row.envelope,
      contentApprovalRevision: row.contentApprovalRevision,
      originalStatementAt: row.originalStatementAt,
      deliveryExpiresAt: row.deliveryExpiresAt.toISOString(),
      resubmitUntil: row.resubmitUntil.toISOString(),
      approval: row.approval,
    };
  }
  private async writeEntry(
    tx: Database,
    metadata: MemoryKnowledgeEntryMetadata,
    now: Date,
  ): Promise<void> {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "MemoryKnowledgeEntry" ("generation","scopeKey","entryId","workspaceId","revision","lifecycle","metadata","pendingCommandId","revocationCommandId","createdAt","updatedAt") VALUES (${metadata.generation},${memoryKnowledgeScopeKey(metadata.ref.scope)},${metadata.ref.entryId},${metadata.ref.scope.workspaceId},${Number(metadata.revision)},${metadata.lifecycle},${JSON.stringify(metadata)}::jsonb,${metadata.pendingCommandId},${metadata.revocationCommandId},${new Date(metadata.createdAt)},${now}) ON CONFLICT ("generation","scopeKey","entryId") DO UPDATE SET "revision"=EXCLUDED."revision","lifecycle"=EXCLUDED."lifecycle","metadata"=EXCLUDED."metadata","pendingCommandId"=EXCLUDED."pendingCommandId","revocationCommandId"=EXCLUDED."revocationCommandId","updatedAt"=EXCLUDED."updatedAt"`,
    );
  }
}

function boundedMaintenanceLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new MemoryKnowledgeError("invalid_input");
  return limit;
}

function deliveryFenceKey(generation: string): string {
  return `memory-delivery:${generation}`;
}

async function readMemoryMaintenanceState(
  tx: Database,
  generation: string,
): Promise<MemoryKnowledgeMaintenanceState> {
  const [row] = await tx.$queryRaw<{ epoch: bigint; paused: boolean }[]>(
    Prisma.sql`SELECT "epoch","paused" FROM "MemoryKnowledgeMaintenanceFence" WHERE "generation"=${generation}`,
  );
  return {
    generation,
    epoch: String(row?.epoch ?? 0),
    paused: row?.paused ?? false,
  };
}

/** Shared host integration helper: sorted exact metadata locks, without nested transactions. */
export async function lockMemoryKnowledgeScopes(
  tx: Prisma.TransactionClient,
  scopes: readonly MemoryKnowledgeScope[],
  generation: string,
): Promise<void> {
  assertMemoryInteractiveTransaction(tx);
  const unique = new Map(
    scopes.map((scope) => [memoryKnowledgeScopeKey(scope), scope]),
  );
  for (const [scopeKey, scope] of [...unique].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "MemoryKnowledgeScopeState" ("generation","scopeKey","workspaceId") VALUES (${generation},${scopeKey},${scope.workspaceId}) ON CONFLICT DO NOTHING`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "epoch" FROM "MemoryKnowledgeScopeState" WHERE "generation"=${generation} AND "scopeKey"=${scopeKey} FOR UPDATE`,
    );
  }
}

/** Host lease admission may fail closed while an exclusive pause is pending. */
export async function tryLockMemoryKnowledgeMaintenance(
  tx: Prisma.TransactionClient,
  generation: string,
): Promise<MemoryKnowledgeMaintenanceState | null> {
  assertMemoryInteractiveTransaction(tx);
  const [permit] = await tx.$queryRaw<{ granted: boolean }[]>(
    Prisma.sql`SELECT pg_try_advisory_xact_lock_shared(hashtextextended(${deliveryFenceKey(generation)},0)) AS granted`,
  );
  if (!permit?.granted) return null;
  const [row] = await tx.$queryRaw<{ epoch: bigint; paused: boolean }[]>(
    Prisma.sql`SELECT "epoch","paused" FROM "MemoryKnowledgeMaintenanceFence" WHERE "generation"=${generation} FOR SHARE`,
  );
  // Existing admitted entries bootstrap this row; absence is never freshness
  // evidence from an older Serializable transaction snapshot.
  return row
    ? { generation, epoch: String(row.epoch), paused: row.paused }
    : null;
}

function assertMemoryInteractiveTransaction(
  tx: Prisma.TransactionClient,
): void {
  if (
    !tx ||
    typeof tx !== "object" ||
    Reflect.get(tx, "$connect") !== undefined ||
    Reflect.get(tx, "$disconnect") !== undefined
  )
    throw new MemoryKnowledgeError("invalid_input");
}
