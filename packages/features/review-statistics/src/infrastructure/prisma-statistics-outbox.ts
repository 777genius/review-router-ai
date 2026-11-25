import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  StatisticsCollisionError,
  reviewStatisticsSettledEventType,
  type ReviewStatisticsSettledEvent,
} from "../domain/statistics";
import { normalizeStatisticsEvent } from "../domain/statistics-policy";
import { statisticsEventHash } from "./statistics-hash";
/** The completion owner alone calls this before accepting settlements. */
export async function activateReviewStatisticsCapture(
  prisma: PrismaClient,
): Promise<Date> {
  await prisma.$executeRaw`INSERT INTO "ReviewStatisticsCoverage" ("id","activatedAt") VALUES ('capture_v1',clock_timestamp() AT TIME ZONE 'UTC') ON CONFLICT ("id") DO NOTHING`;
  const rows = await prisma.$queryRaw<
    { activatedAt: Date }[]
  >`SELECT "activatedAt" FROM "ReviewStatisticsCoverage" WHERE "id"='capture_v1'`;
  if (!rows[0]) throw new Error("statistics_activation_missing");
  return rows[0].activatedAt;
}
export class PrismaReviewStatisticsOutboxWriter {
  async write(
    tx: Prisma.TransactionClient,
    input: ReviewStatisticsSettledEvent,
  ): Promise<void> {
    const event = normalizeStatisticsEvent(input),
      key = `review-statistics-settled:v1:${event.executionId}`;
    const coverage = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "ReviewStatisticsCoverage" WHERE "id"='capture_v1'`;
    if (!coverage[0]) throw new Error("statistics_capture_not_activated");
    const inserted =
      await tx.$executeRaw`INSERT INTO "OutboxEvent" ("id","type","version","idempotencyKey","workspaceId","repositoryId","aggregateId","payload","status","attempts","maxAttempts","occurredAt","createdAt","updatedAt") VALUES (${randomUUID()},${reviewStatisticsSettledEventType},1,${key},${event.workspaceId},${event.repositoryConnectionId},${event.executionId},${JSON.stringify(event)}::jsonb,'pending',0,5,${new Date(event.settledAt)},now(),now()) ON CONFLICT ("idempotencyKey") DO NOTHING`;
    if (!inserted) {
      const rows = await tx.$queryRaw<
        { payload: unknown; type: string; version: number }[]
      >`SELECT "payload","type","version" FROM "OutboxEvent" WHERE "idempotencyKey"=${key}`;
      if (
        !rows[0] ||
        rows[0].type !== reviewStatisticsSettledEventType ||
        rows[0].version !== 1 ||
        statisticsEventHash(
          normalizeStatisticsEvent(
            rows[0].payload as ReviewStatisticsSettledEvent,
          ),
        ) !== statisticsEventHash(event)
      )
        throw new StatisticsCollisionError();
    }
  }
}
