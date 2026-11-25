import {
  StatisticsValidationError,
  StatisticsSeverity,
  ReviewStatisticsSettlementState,
  type StatisticsFilter,
  type ReviewStatisticsSettledEvent,
} from "./statistics";
export const statisticsMaximumIssues = 2_000;
const dayMs = 86_400_000;
export function validateStatisticsIdentifier(
  value: unknown,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new StatisticsValidationError("statistics_invalid_identity");
}
export function validateStatisticsSeverity(
  value: unknown,
): asserts value is StatisticsSeverity | "all" {
  if (
    value !== "all" &&
    !Object.values(StatisticsSeverity).includes(value as StatisticsSeverity)
  )
    throw new StatisticsValidationError();
}
export function validateStatisticsFilter(value: StatisticsFilter): void {
  if (!value || ![7, 30, 90].includes(value.days))
    throw new StatisticsValidationError();
  validateStatisticsSeverity(value.severity);
}
export function statisticsDate(value: unknown): Date {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  )
    throw new StatisticsValidationError();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    throw new StatisticsValidationError();
  return date;
}
export function statisticsPeriod(days: 7 | 30 | 90, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new StatisticsValidationError();
  const start =
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
    (days - 1) * dayMs;
  return {
    from: new Date(start).toISOString(),
    to: now.toISOString(),
    previousFrom: new Date(start - days * dayMs).toISOString(),
    previousTo: new Date(now.getTime() - days * dayMs).toISOString(),
    days,
    timezone: "UTC" as const,
    asOf: now.toISOString(),
  };
}
export function validateStatisticsIssuePeriod(from: string, to: string): void {
  const start = statisticsDate(from),
    end = statisticsDate(to),
    elapsed = end.getTime() - start.getTime();
  if (
    elapsed < 0 ||
    elapsed > 90 * dayMs ||
    start.getUTCHours() ||
    start.getUTCMinutes() ||
    start.getUTCSeconds() ||
    start.getUTCMilliseconds()
  )
    throw new StatisticsValidationError();
}
/** Normalize metadata once and reject invalid identity sets rather than lose findings. */
export function normalizeStatisticsEvent(
  event: ReviewStatisticsSettledEvent,
): ReviewStatisticsSettledEvent {
  if (
    !event ||
    event.version !== 1 ||
    !Object.values(ReviewStatisticsSettlementState).includes(event.state)
  )
    throw new StatisticsValidationError("statistics_invalid_event");
  for (const value of [
    event.executionId,
    event.workspaceId,
    event.repositoryConnectionId,
    event.scmRepositoryIdentityId,
    event.finalizedArtifactId,
    event.publicationAttemptId,
  ])
    validateStatisticsIdentifier(value);
  statisticsDate(event.settledAt);
  if (
    !/^[a-f0-9]{64}$/u.test(event.projectionHash) ||
    !Number.isSafeInteger(event.pullRequestNumber) ||
    event.pullRequestNumber <= 0 ||
    !Array.isArray(event.issues) ||
    event.issues.length > statisticsMaximumIssues
  )
    throw new StatisticsValidationError("statistics_invalid_event");
  const identities = new Set<string>();
  const issues = event.issues
    .map((issue) => {
      if (!issue)
        throw new StatisticsValidationError("statistics_invalid_issue");
      validateStatisticsIdentifier(issue.lineageId);
      if (identities.has(issue.lineageId))
        throw new StatisticsValidationError("statistics_duplicate_lineage");
      identities.add(issue.lineageId);
      if (
        !Object.values(StatisticsSeverity).includes(issue.severity) ||
        typeof issue.title !== "string"
      )
        throw new StatisticsValidationError("statistics_invalid_issue");
      const title =
        [
          ...[...issue.title]
            .map((character) => {
              const code = character.charCodeAt(0);
              return code < 32
                ? " "
                : character.length === 1 && code >= 0xd800 && code <= 0xdfff
                  ? "�"
                  : character;
            })
            .join("")
            .trim(),
        ]
          .slice(0, 240)
          .join("") || "Reported issue";
      return { lineageId: issue.lineageId, severity: issue.severity, title };
    })
    .sort((a, b) =>
      a.lineageId < b.lineageId ? -1 : a.lineageId > b.lineageId ? 1 : 0,
    );
  return {
    version: 1,
    executionId: event.executionId,
    workspaceId: event.workspaceId,
    repositoryConnectionId: event.repositoryConnectionId,
    scmRepositoryIdentityId: event.scmRepositoryIdentityId,
    pullRequestNumber: event.pullRequestNumber,
    finalizedArtifactId: event.finalizedArtifactId,
    projectionHash: event.projectionHash,
    publicationAttemptId: event.publicationAttemptId,
    state: event.state,
    settledAt: event.settledAt,
    issues,
  };
}

export function parseReviewStatisticsSettledEvent(
  value: unknown,
): ReviewStatisticsSettledEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new StatisticsValidationError("statistics_invalid_event");
  return normalizeStatisticsEvent(value as ReviewStatisticsSettledEvent);
}
