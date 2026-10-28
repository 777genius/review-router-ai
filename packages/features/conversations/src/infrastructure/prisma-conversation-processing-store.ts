import { randomUUID } from "node:crypto";
import {
  Prisma,
  type PrismaClient,
  type ConversationProcessing,
} from "@prisma/client";
import type {
  ConversationProcessResult,
  ConversationPublicationReceipt,
} from "../domain/conversation.js";
import type { ConversationProcessingStore } from "../application/ports/conversation-ports.js";
import {
  ConversationError,
  conversationDigest,
  type ConversationIdentity,
  type ConversationRecord,
} from "../domain/conversation.js";

function record(row: ConversationProcessing): ConversationRecord {
  const { pendingOutput: _pendingOutput, ...result } =
    row.result as unknown as ConversationProcessResult & {
      readonly pendingOutput?: unknown;
    };
  void _pendingOutput;
  return {
    id: row.id,
    identity: {
      workspaceId: row.workspaceId,
      repositoryId: row.repositoryId,
      repositoryStableId: row.repositoryStableId,
      repositoryFullName: row.repositoryFullName,
      pullRequestNumber: row.pullRequestNumber,
      threadId: row.threadId,
      sourceId: row.sourceId,
      sourceCommentId: row.sourceCommentId,
      sourceRevision: row.sourceRevision,
      sourceUpdatedAt: row.sourceUpdatedAt.toISOString(),
      sourceActor: {
        id: row.sourceActorId,
        login: row.sourceActorLogin,
        kind: row.sourceActorKind as "human" | "bot",
      },
    },
    deadlineAt: row.deadlineAt,
    boundManifest: row.boundManifest,
    modelDispatched: row.modelDispatched,
    result,
  };
}
function mergeEffects(
  current: ConversationProcessResult["learning"],
  next: ConversationProcessResult["learning"],
): ConversationProcessResult["learning"] {
  const effectIds = [...new Set([...current.effectIds, ...next.effectIds])];
  if (effectIds.length > 16) throw new ConversationError("conflict");
  return { status: next.status, effectIds };
}
/** Scope is captured from a verified Action session; IDs alone never grant row access. */
export class PrismaConversationProcessingStore implements ConversationProcessingStore {
  private readonly scope: {
    readonly workspaceId: string;
    readonly repositoryId: string;
  };
  constructor(
    private readonly prisma: PrismaClient,
    scope: { readonly workspaceId: string; readonly repositoryId: string },
    private readonly options: {
      readonly authorizePublication?: (
        transaction: Prisma.TransactionClient,
        record: ConversationRecord,
      ) => Promise<boolean>;
    } = {},
  ) {
    this.scope = {
      workspaceId: scope.workspaceId,
      repositoryId: scope.repositoryId,
    };
  }

  async accept(identity: ConversationIdentity, deadlineAt: Date) {
    if (
      identity.workspaceId !== this.scope.workspaceId ||
      identity.repositoryId !== this.scope.repositoryId
    )
      throw new ConversationError("forbidden");
    const where = {
      repositoryStableId_threadId_sourceId_sourceRevision_purpose: {
        repositoryStableId: identity.repositoryStableId,
        threadId: identity.threadId,
        sourceId: identity.sourceId,
        sourceRevision: identity.sourceRevision,
        purpose: "conversation-v1",
      },
    };
    const saved = await this.prisma.conversationProcessing.findUnique({
      where,
    });
    if (saved)
      return { created: false, record: await this.settleExpired(saved) };
    const id = randomUUID();
    const result: ConversationProcessResult = {
      processingId: id,
      status: "processing",
      learning: { status: "pending", effectIds: [] },
    };
    try {
      const { sourceActor, ...sourceIdentity } = identity;
      const row = await this.prisma.conversationProcessing.create({
        data: {
          id,
          ...sourceIdentity,
          sourceUpdatedAt: new Date(identity.sourceUpdatedAt),
          sourceActorId: sourceActor.id,
          sourceActorLogin: sourceActor.login,
          sourceActorKind: sourceActor.kind,
          deadlineAt,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return { created: true, record: record(row) };
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      const row = await this.prisma.conversationProcessing.findUnique({
        where,
      });
      if (!row) throw new ConversationError("conflict");
      return { created: false, record: await this.settleExpired(row) };
    }
  }
  private owned(row: ConversationProcessing) {
    if (
      row.workspaceId !== this.scope.workspaceId ||
      row.repositoryId !== this.scope.repositoryId
    )
      throw new ConversationError("forbidden");
    return record(row);
  }
  private async settleExpired(
    row: ConversationProcessing,
  ): Promise<ConversationRecord> {
    this.owned(row);
    if (
      !["processing", "ready"].includes(row.status) ||
      row.deadlineAt.getTime() > Date.now()
    )
      return record(row);
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id"=${row.id} AND "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} FOR UPDATE`;
      const fresh = await transaction.conversationProcessing.findFirst({
        where: { id: row.id, ...this.scope },
      });
      if (!fresh) throw new ConversationError("forbidden");
      const current = this.owned(fresh);
      if (
        !["processing", "ready"].includes(fresh.status) ||
        fresh.deadlineAt.getTime() > Date.now()
      )
        return current;
      // Expiration purges bounded output but keeps every association learned before this lock.
      const { reply: _reply, ...metadata } = current.result;
      void _reply;
      const result: ConversationProcessResult = {
        ...metadata,
        status:
          fresh.status === "ready"
            ? "stale"
            : fresh.modelDispatched
              ? "output_unavailable"
              : "unavailable",
      };
      await transaction.conversationProcessing.update({
        where: { id: row.id },
        data: {
          status: result.status,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return { ...current, result };
    });
  }

  async read(id: string) {
    const row = await this.prisma.conversationProcessing.findFirst({
      where: { id, ...this.scope },
    });
    return row ? this.settleExpired(row) : null;
  }
  async bind(id: string, manifest: string) {
    if (Buffer.byteLength(manifest) > 131_072)
      throw new ConversationError("context_incomplete");
    return (
      (
        await this.prisma.conversationProcessing.updateMany({
          where: {
            id,
            ...this.scope,
            boundManifest: null,
            modelDispatched: false,
            status: "processing",
            deadlineAt: { gt: new Date() },
          },
          data: { boundManifest: manifest },
        })
      ).count === 1
    );
  }
  async markModelDispatched(id: string) {
    return (
      (
        await this.prisma.conversationProcessing.updateMany({
          where: {
            id,
            ...this.scope,
            boundManifest: { not: null },
            modelDispatched: false,
            status: "processing",
            deadlineAt: { gt: new Date() },
          },
          data: { modelDispatched: true },
        })
      ).count === 1
    );
  }
  async freezeOutput(
    id: string,
    output: import("../domain/conversation.js").ConversationDecision,
  ) {
    if (Buffer.byteLength(JSON.stringify(output)) > 16_384)
      throw new ConversationError("conflict");
    const current = await this.read(id);
    if (
      !current ||
      !current.modelDispatched ||
      current.result.status !== "processing"
    )
      return false;
    return (
      (
        await this.prisma.conversationProcessing.updateMany({
          where: {
            id,
            ...this.scope,
            status: "processing",
            modelDispatched: true,
          },
          data: {
            requestEffect: "completed",
            result: {
              ...current.result,
              pendingOutput: output,
            } as unknown as Prisma.InputJsonValue,
          },
        })
      ).count === 1
    );
  }
  async finish(id: string, result: ConversationProcessResult) {
    if (
      result.processingId !== id ||
      Buffer.byteLength(JSON.stringify(result)) > 20_480 ||
      result.learning.effectIds.length > 16 ||
      (result.reply &&
        (conversationDigest(result.reply.body) !== result.reply.bodyDigest ||
          Buffer.byteLength(result.reply.body) > 16_384))
    )
      throw new ConversationError("conflict");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id"=${id} AND "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} FOR UPDATE`;
      const current = await transaction.conversationProcessing.findFirst({
        where: { id, ...this.scope, status: "processing" },
      });
      if (!current) return;
      const pending = (
        current.result as unknown as {
          readonly pendingOutput?: unknown;
        } | null
      )?.pendingOutput;
      await transaction.conversationProcessing.updateMany({
        where: { id, ...this.scope, status: "processing" },
        data: {
          status: result.status,
          result: {
            ...result,
            learning: mergeEffects(
              record(current).result.learning,
              result.learning,
            ),
            ...(result.status === "processing" && pending
              ? { pendingOutput: pending }
              : {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
  async associateEffects(
    id: string,
    learning: ConversationProcessResult["learning"],
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id"=${id} AND "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} FOR UPDATE`;
      const current = await transaction.conversationProcessing.findFirst({
        where: { id, ...this.scope },
      });
      if (!current) throw new ConversationError("forbidden");
      const result = {
        ...(current.result as unknown as ConversationProcessResult),
        learning: mergeEffects(record(current).result.learning, learning),
      };
      await transaction.conversationProcessing.update({
        where: { id },
        data: {
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return { ...record(current).result, learning: result.learning };
    });
  }
  async reserveReply(
    id: string,
    result: ConversationProcessResult,
    comments: import("../domain/conversation.js").ConversationSnapshot["replyComments"],
  ) {
    if (
      result.status !== "ready" ||
      !result.reply ||
      result.processingId !== id ||
      Buffer.byteLength(JSON.stringify(result)) > 20_480 ||
      conversationDigest(result.reply.body) !== result.reply.bodyDigest
    )
      throw new ConversationError("conflict");
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.conversationProcessing.findFirst({
        where: { id, ...this.scope },
      });
      if (!current || current.status !== "processing") return false;
      // PR lock also serializes its thread reservations. No GitHub/native I/O occurs here.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`conversation-replies:${current.repositoryStableId}:${current.pullRequestNumber}`}, 0))::text`;
      // An unclaimed expired envelope cannot create a comment. Release it while
      // holding the same reservation lock; genuinely uncertain claims still count.
      await tx.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} AND "pullRequestNumber"=${current.pullRequestNumber} AND "status"='ready' AND "deadlineAt" <= ${new Date()} FOR UPDATE`;
      const expired = await tx.conversationProcessing.findMany({
        where: {
          ...this.scope,
          pullRequestNumber: current.pullRequestNumber,
          status: "ready",
          deadlineAt: { lte: new Date() },
        },
      });
      for (const row of expired) {
        const { reply: _reply, ...metadata } = record(row).result;
        void _reply;
        await tx.conversationProcessing.updateMany({
          where: { id: row.id, ...this.scope, status: "ready" },
          data: {
            status: "stale",
            result: {
              ...metadata,
              status: "stale",
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
      const rows = await tx.conversationProcessing.findMany({
        where: {
          ...this.scope,
          pullRequestNumber: current.pullRequestNumber,
          status: { in: ["ready", "unknown", "published"] },
        },
        select: { id: true, threadId: true, result: true },
      });
      const seen = new Map(
        comments.map((comment) => [`comment:${comment.id}`, comment.threadId]),
      );
      for (const row of rows) {
        const previous = row.result as unknown as ConversationProcessResult;
        seen.set(
          previous.publicationCommentId
            ? `comment:${previous.publicationCommentId}`
            : `processing:${row.id}`,
          row.threadId,
        );
      }
      if (
        seen.size >= 20 ||
        [...seen.values()].filter((thread) => thread === current.threadId)
          .length >= 5
      )
        return false;
      await tx.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id"=${id} AND "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} FOR UPDATE`;
      const latest = await tx.conversationProcessing.findFirst({
        where: { id, ...this.scope },
      });
      if (!latest || latest.status !== "processing") return false;
      return (
        (
          await tx.conversationProcessing.updateMany({
            where: {
              id,
              ...this.scope,
              status: "processing",
              deadlineAt: { gt: new Date() },
            },
            data: {
              status: "ready",
              result: {
                ...result,
                learning: mergeEffects(
                  record(latest).result.learning,
                  result.learning,
                ),
              } as unknown as Prisma.InputJsonValue,
            },
          })
        ).count === 1
      );
    });
  }
  async withdrawPublication(id: string) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id"=${id} AND "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} FOR UPDATE`;
      const current = await transaction.conversationProcessing.findFirst({
        where: { id, ...this.scope, status: "ready" },
      });
      if (!current) return;
      const { reply: _reply, ...metadata } = record(current).result;
      void _reply;
      await transaction.conversationProcessing.update({
        where: { id },
        data: {
          status: "stale",
          result: {
            ...metadata,
            status: "stale",
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
  async claimPublication(id: string, bodyDigest: string) {
    if (
      !this.options.authorizePublication ||
      !/^[a-f0-9]{64}$/.test(bodyDigest)
    )
      return false;
    return this.prisma.$transaction(async (transaction) => {
      const saved = await transaction.conversationProcessing.findFirst({
        where: {
          id,
          ...this.scope,
          status: "ready",
          requestEffect: "completed",
          deadlineAt: { gt: new Date() },
        },
      });
      if (!saved) return false;
      const current = record(saved);
      if (current.result.reply?.bodyDigest !== bodyDigest) return false;
      if (!(await this.options.authorizePublication!(transaction, current))) {
        await transaction.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id"=${id} AND "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} FOR UPDATE`;
        const rejected = await transaction.conversationProcessing.findFirst({
          where: { id, ...this.scope, status: "ready" },
        });
        if (!rejected) return false;
        const { reply: _reply, ...metadata } = record(rejected).result;
        void _reply;
        const result: ConversationProcessResult = {
          ...metadata,
          status: "stale",
        };
        await transaction.conversationProcessing.updateMany({
          where: { id, ...this.scope, status: "ready" },
          data: {
            status: "stale",
            result: result as unknown as Prisma.InputJsonValue,
          },
        });
        return false;
      }
      await transaction.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id"=${id} AND "workspaceId"=${this.scope.workspaceId} AND "repositoryId"=${this.scope.repositoryId} FOR UPDATE`;
      const live = await transaction.conversationProcessing.findFirst({
        where: {
          id,
          ...this.scope,
          status: "ready",
          requestEffect: "completed",
          deadlineAt: { gt: new Date() },
        },
      });
      if (
        !live ||
        record(live).result.reply?.bodyDigest !== bodyDigest ||
        live.boundManifest !== saved.boundManifest
      )
        return false;
      const result: ConversationProcessResult = {
        ...record(live).result,
        status: "unknown",
      };
      await transaction.conversationProcessing.update({
        where: { id },
        data: {
          status: "unknown",
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return true;
    });
  }
  async publication(receipt: ConversationPublicationReceipt) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ConversationProcessing" WHERE "id" = ${receipt.processingId} AND "workspaceId" = ${this.scope.workspaceId} AND "repositoryId" = ${this.scope.repositoryId} FOR UPDATE`;
      const row = await tx.conversationProcessing.findFirst({
        where: { id: receipt.processingId, ...this.scope },
      });
      if (!row) throw new ConversationError("forbidden");
      const previous = record(row).result;
      if (previous.status === "published") {
        if (
          receipt.status === "published" &&
          receipt.commentId !== previous.publicationCommentId
        )
          throw new ConversationError("conflict");
        return previous;
      }
      if (
        !previous.reply ||
        (receipt.bodyDigest !== undefined &&
          receipt.bodyDigest !== previous.reply.bodyDigest)
      )
        throw new ConversationError("conflict");
      // Only claimPublication may consume the one-create permission. A receipt
      // cannot turn an unclaimed read failure into an uncertain external effect.
      if (receipt.status === "unknown" && previous.status !== "unknown")
        throw new ConversationError("conflict");
      if (
        receipt.status === "published" &&
        (!receipt.commentId ||
          !/^[1-9]\d{0,19}$/.test(receipt.commentId) ||
          receipt.bodyDigest !== previous.reply.bodyDigest)
      )
        throw new ConversationError("conflict");
      const { reply: _reply, ...settled } = previous;
      void _reply;
      const result: ConversationProcessResult =
        receipt.status === "unknown"
          ? { ...previous, status: "unknown" }
          : {
              ...settled,
              status:
                receipt.status === "published" ? "published" : "unavailable",
              ...(receipt.commentId
                ? { publicationCommentId: receipt.commentId }
                : {}),
            };
      await tx.conversationProcessing.update({
        where: { id: row.id },
        data: {
          status: result.status,
          result: result as unknown as Prisma.InputJsonValue,
        },
      });
      return result;
    });
  }
}
