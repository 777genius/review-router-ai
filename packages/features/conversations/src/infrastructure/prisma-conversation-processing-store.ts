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
/** Scope is captured from a verified Action session; IDs alone never grant row access. */
export class PrismaConversationProcessingStore implements ConversationProcessingStore {
  private readonly scope: {
    readonly workspaceId: string;
    readonly repositoryId: string;
  };
  constructor(
    private readonly prisma: PrismaClient,
    scope: { readonly workspaceId: string; readonly repositoryId: string },
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
    const current = this.owned(row);
    if (
      current.result.status !== "processing" ||
      row.deadlineAt.getTime() > Date.now()
    )
      return current;
    // Crash recovery terminates the accepted identity and purges its normalized
    // pending output. It cannot replay inference or manufacture effect success.
    const result: ConversationProcessResult = {
      ...current.result,
      status: current.modelDispatched ? "output_unavailable" : "unavailable",
    };
    const settled = await this.prisma.conversationProcessing.updateMany({
      where: {
        id: row.id,
        ...this.scope,
        status: "processing",
        deadlineAt: { lte: new Date() },
      },
      data: {
        status: result.status,
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
    if (settled.count === 1) return { ...current, result };
    const after = await this.prisma.conversationProcessing.findFirst({
      where: { id: row.id, ...this.scope },
    });
    if (!after) throw new ConversationError("forbidden");
    return this.owned(after);
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
    if (result.status === "processing") {
      const current = await this.prisma.conversationProcessing.findFirst({
        where: { id, ...this.scope, status: "processing" },
      });
      const pending = (
        current?.result as unknown as {
          readonly pendingOutput?: unknown;
        } | null
      )?.pendingOutput;
      await this.prisma.conversationProcessing.updateMany({
        where: { id, ...this.scope, status: "processing" },
        data: {
          result: {
            ...result,
            ...(pending ? { pendingOutput: pending } : {}),
          } as unknown as Prisma.InputJsonValue,
        },
      });
    } else
      await this.prisma.conversationProcessing.updateMany({
        where: { id, ...this.scope, status: "processing" },
        data: {
          status: result.status,
          result: result as unknown as Prisma.InputJsonValue,
        },
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
      return (
        (
          await tx.conversationProcessing.updateMany({
            where: { id, ...this.scope, status: "processing" },
            data: {
              status: "ready",
              result: result as unknown as Prisma.InputJsonValue,
            },
          })
        ).count === 1
      );
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
