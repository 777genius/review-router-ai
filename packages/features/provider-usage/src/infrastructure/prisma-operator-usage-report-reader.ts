import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  UsageOperatorReportQuery,
  UsageOperatorReportReader,
} from "../application/operator-report";
import { validateReportQuery } from "../application/ports";
import { readPrismaUsagePeriodReport } from "./prisma-usage-report";

export class PrismaOperatorUsageReportReader implements UsageOperatorReportReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorWorkspaceId: string | undefined,
  ) {}
  async report(q: UsageOperatorReportQuery) {
    if (
      !this.operatorWorkspaceId ||
      q.operatorWorkspaceId !== this.operatorWorkspaceId ||
      !q.actorId
    )
      throw new Error("usage_access_denied");
    const period = {
      ...q,
      workspaceId: this.operatorWorkspaceId,
      access: "admin" as const,
    };
    validateReportQuery(period);
    return this.prisma.$transaction(
      async (tx) => {
        // Repeat the established operator owner/admin membership rule at the data boundary.
        // Share locks keep a concurrent membership revoke/deletion from racing this read.
        const authority = await tx.$queryRaw<
          { id: string }[]
        >`SELECT w."id" FROM "Workspace" w JOIN "WorkspaceMember" m ON m."workspaceId"=w."id" WHERE w."id"=${this.operatorWorkspaceId} AND w."deletionState"='active' AND m."userId"=${q.actorId} AND m."role" IN ('owner','admin') FOR SHARE OF w,m`;
        if (!authority.length) throw new Error("usage_access_denied");
        const report = await readPrismaUsagePeriodReport(tx, period, true);
        const checkpoints = await tx.$queryRaw<
          { sourceInstance: string; coveredFrom: Date; asOf: Date | null }[]
        >`SELECT s."sourceInstance",s."coveredFrom",s."asOf" FROM "UsageSourceCheckpoint" s JOIN "Workspace" w ON w."id"=s."workspaceId" WHERE w."deletionState"='active' AND s."disabledAt" IS NULL`;
        return {
          ...report,
          sources: checkpoints.map((s) => ({
            sourceInstance: s.sourceInstance,
            coveredFrom: s.coveredFrom.toISOString(),
            asOf: s.asOf?.toISOString() ?? null,
            lagMs: s.asOf ? Math.max(0, Date.now() - s.asOf.getTime()) : null,
          })),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
