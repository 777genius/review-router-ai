import { createHash } from "node:crypto";
import type { ReviewStatisticsSettledEvent } from "../domain/statistics";
export function statisticsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function statisticsEventHash(
  event: ReviewStatisticsSettledEvent,
): string {
  return statisticsHash(event);
}
export function statisticsIssueId(
  event: ReviewStatisticsSettledEvent,
  lineageId: string,
): string {
  return statisticsHash([
    event.workspaceId,
    event.scmRepositoryIdentityId,
    event.pullRequestNumber,
    lineageId,
  ]);
}
