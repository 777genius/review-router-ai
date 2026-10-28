import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type {
  UsageSourceRedrivePort,
  UsageSourceRedriveRequest,
  UsageSourceRedriveReceipt,
} from "../application/redrive-usage-source";

/** Resume the SAME checkpoint through normal claim/list/commit maintenance.
 * Cursor, high-water mark, coverage, facts and projections are never changed.
 */
export class PrismaUsageSourceRedrive implements UsageSourceRedrivePort {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorWorkspaceId: string | undefined,
  ) {}
  async redrive(
    q: UsageSourceRedriveRequest,
  ): Promise<UsageSourceRedriveReceipt> {
    if (
      !this.operatorWorkspaceId ||
      q.operatorWorkspaceId !== this.operatorWorkspaceId ||
      !q.actorId
    )
      throw new Error("usage_access_denied");
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const auditId = "usage-source-redrive-" + digest(q.operationId);
    const requestHash = digest(
      JSON.stringify([
        q.operationId,
        q.operatorWorkspaceId,
        q.actorId,
        q.workspaceId,
        q.sourceInstance,
        q.expectedFence.toString(),
        q.expectedDeadLetteredAt.toISOString(),
        q.reason,
      ]),
    );
    return this.prisma.$transaction(
      async (tx) => {
        // Repeat the existing operator owner/admin rule under membership locks.
        const authority = await tx.$queryRaw<
          { id: string }[]
        >`SELECT w."id" FROM "Workspace" w JOIN "WorkspaceMember" m ON m."workspaceId"=w."id" WHERE w."id"=${this.operatorWorkspaceId} AND w."deletionState"='active' AND m."userId"=${q.actorId} AND m."role" IN ('owner','admin') FOR SHARE OF w,m`;
        if (authority.length !== 1) throw new Error("usage_access_denied");
        const target = await tx.$queryRaw<
          { id: string }[]
        >`SELECT "id" FROM "Workspace" WHERE "id"=${q.workspaceId} AND "deletionState"='active' FOR SHARE`;
        if (target.length !== 1)
          throw new Error("usage_redrive_scope_inactive");
        // Serialize identical operation IDs before reading their deterministic receipt.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${auditId},0))`;
        const old = await tx.auditEvent.findUnique({ where: { id: auditId } });
        if (old) {
          const metadata = old.metadata;
          if (
            !metadata ||
            typeof metadata !== "object" ||
            Array.isArray(metadata) ||
            metadata.requestHash !== requestHash ||
            typeof metadata.queuedFence !== "string" ||
            old.action !== "provider_usage.source_redrive_requested" ||
            old.targetId !== q.sourceInstance
          )
            throw new Error("usage_redrive_identity_conflict");
          return {
            status: "already_queued",
            auditId,
            workspaceId: q.workspaceId,
            sourceInstance: q.sourceInstance,
            queuedFence: metadata.queuedFence,
          };
        }
        const rows = await tx.$queryRaw<
          {
            fence: bigint;
            deadLetteredAt: Date | null;
            disabledAt: Date | null;
            leaseActive: boolean;
            failureCount: number;
            lastErrorCode: string | null;
          }[]
        >`SELECT "fence","deadLetteredAt","disabledAt","failureCount","lastErrorCode",COALESCE("leaseUntil">statement_timestamp(),false) AS "leaseActive" FROM "UsageSourceCheckpoint" WHERE "sourceInstance"=${q.sourceInstance} AND "workspaceId"=${q.workspaceId} FOR UPDATE`;
        const row = rows[0];
        if (
          !row ||
          row.disabledAt ||
          !row.deadLetteredAt ||
          row.leaseActive ||
          row.fence !== q.expectedFence ||
          row.deadLetteredAt.getTime() !== q.expectedDeadLetteredAt.getTime()
        )
          throw new Error("usage_redrive_checkpoint_stale");
        const queuedFence = (row.fence + 1n).toString();
        const changed = await tx.usageSourceCheckpoint.updateMany({
          where: {
            sourceInstance: q.sourceInstance,
            workspaceId: q.workspaceId,
            fence: q.expectedFence,
            deadLetteredAt: q.expectedDeadLetteredAt,
            disabledAt: null,
          },
          data: {
            fence: { increment: 1 },
            deadLetteredAt: null,
            nextAttemptAt: null,
            failureCount: 0,
            lastErrorCode: null,
          },
        });
        if (changed.count !== 1)
          throw new Error("usage_redrive_checkpoint_stale");
        // The existing AuditEvent row and queue transition commit or roll back together.
        await tx.auditEvent.create({
          data: {
            id: auditId,
            workspaceId: q.workspaceId,
            actor: q.actorId,
            action: "provider_usage.source_redrive_requested",
            targetType: "UsageSourceCheckpoint",
            targetId: q.sourceInstance,
            metadata: {
              requestHash,
              operationId: q.operationId,
              operatorWorkspaceId: q.operatorWorkspaceId,
              reason: q.reason,
              previousFence: row.fence.toString(),
              queuedFence,
              previousFailureCount: row.failureCount,
              previousLastErrorCode: row.lastErrorCode,
              previousDeadLetteredAt: row.deadLetteredAt.toISOString(),
              cursorAndCoveragePreserved: true,
            },
          },
        });
        return {
          status: "queued",
          auditId,
          workspaceId: q.workspaceId,
          sourceInstance: q.sourceInstance,
          queuedFence,
        };
      },
      { timeout: 5000, maxWait: 3000 },
    );
  }
}
