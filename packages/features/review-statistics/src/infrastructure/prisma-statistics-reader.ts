import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReviewStatisticsReader } from "../application/ports";
import {
  StatisticsAccessError,
  StatisticsValidationError,
  StatisticsSeverity,
  StatisticsDayCoverage,
  StatisticsUncoveredSource,
  type StatisticsReport,
  type StatisticsReportInput,
  type StatisticsIssuePage,
  type StatisticsIssuesInput,
  type StatisticsTotals,
} from "../domain/statistics";
import {
  statisticsDate,
  statisticsPeriod,
  validateStatisticsFilter,
  validateStatisticsIdentifier,
  validateStatisticsIssuePeriod,
  validateStatisticsSeverity,
} from "../domain/statistics-policy";
import { statisticsHash } from "./statistics-hash";
const dayMs = 86_400_000;
type Tx = Prisma.TransactionClient;
type Count = bigint | number;
type RepositoryMetadata = {
  provider: string;
  sourceBaseUrl: string;
  fullName: string;
};
type IssueRow = RepositoryMetadata & {
  id: string;
  title: string;
  severity: StatisticsSeverity;
  repositoryConnectionId: string;
  scmRepositoryIdentityId: string;
  pullRequestNumber: number;
  caughtAt: Date;
};
function count(value: Count): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("statistics_count_out_of_range");
  return result;
}
function repositoryUrl(
  row: RepositoryMetadata,
  pullRequestNumber?: number,
): string | null {
  try {
    const base = new URL(row.sourceBaseUrl);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !base.hostname
    )
      return null;
    if (row.provider !== "github" && row.provider !== "gitlab") return null;
    const segments = row.fullName.split("/");
    if (
      segments.length < 2 ||
      (row.provider === "github" && segments.length !== 2) ||
      segments.some((x) => !x || x === "." || x === "..")
    )
      return null;
    const path = segments.map(encodeURIComponent).join("/");
    base.pathname = base.pathname.replace(/\/+$/u, "");
    return `${base.toString().replace(/\/$/u, "")}/${path}${pullRequestNumber === undefined ? "" : row.provider === "github" ? `/pull/${pullRequestNumber}` : `/-/merge_requests/${pullRequestNumber}`}`;
  } catch {
    return null;
  }
}
async function authorize(
  tx: Tx,
  actorId: string,
  workspaceId: string,
): Promise<Date> {
  const rows = await tx.$queryRaw<
    { createdAt: Date; allowed: boolean }[]
  >`SELECT w."createdAt", (w."deletionState"='active' AND CASE WHEN w."personalOwnerUserId" IS NOT NULL THEN w."personalOwnerUserId"=${actorId} ELSE EXISTS (SELECT 1 FROM "WorkspaceMember" m WHERE m."workspaceId"=w."id" AND m."userId"=${actorId}) END) AS "allowed" FROM "Workspace" w WHERE w."id"=${workspaceId}`;
  if (!rows[0]?.allowed) throw new StatisticsAccessError();
  return rows[0].createdAt;
}
function validateScope(actorId: string, workspaceId: string): void {
  validateStatisticsIdentifier(actorId);
  validateStatisticsIdentifier(workspaceId);
}
type CoverageRow = {
  activatedAt: Date | null;
  sourceActivatedAt: Date | null;
  gitlab: boolean;
  hosted: boolean;
  unqualified: boolean;
};
async function coverage(tx: Tx, workspaceId: string, createdAt: Date) {
  const rows = await tx.$queryRaw<CoverageRow[]>`SELECT
    (SELECT "activatedAt" FROM "ReviewStatisticsCoverage" WHERE "id"='capture_v1') AS "activatedAt",
    MAX(a."activatedAt") AS "sourceActivatedAt",
    COALESCE(BOOL_OR(r."provider"::text='gitlab'),false) AS "gitlab",
    COALESCE(BOOL_OR(b."id" IS NOT NULL),false) AS "hosted",
    COALESCE(BOOL_OR(r."provider"::text='github' AND
      (r."sourceBaseUrl" <> 'https://github.com' OR r."scmRepositoryIdentityId" IS NULL OR
       i."currentWorkspaceId" IS DISTINCT FROM r."workspaceId" OR i."currentRepositoryConnectionId" IS DISTINCT FROM r."id" OR
       a."mode" IS DISTINCT FROM 'v2_active'::"ReviewMutationModeV2" OR a."activatedAt" IS NULL OR
       p."status" IS DISTINCT FROM 'configured'::"WorkflowProvisioningStatus" OR
       p."workflowPath" NOT IN ('.github/workflows/reviewrouter-review.yml','.github/workflows/reviewrouter-codex.yml'))),false) AS "unqualified"
    FROM "RepositoryConnection" r
    LEFT JOIN "ScmRepositoryIdentity" i ON i."scmRepositoryIdentityId"=r."scmRepositoryIdentityId"
    LEFT JOIN "ReviewMutationAuthority" a ON a."scmRepositoryIdentityId"=r."scmRepositoryIdentityId" AND a."laneKind"='hosted_reviewrouter_app'
    LEFT JOIN "HostedCodexRepositoryBinding" b ON b."repositoryConnectionId"=r."id" AND b."workspaceId"=r."workspaceId"
    LEFT JOIN "WorkflowProvisioning" p ON p."repositoryId"=r."id" AND p."workspaceId"=r."workspaceId"
    WHERE r."workspaceId"=${workspaceId}`;
  const row = rows[0]!;
  const availableSince = row.activatedAt
    ? new Date(Math.max(row.activatedAt.getTime(), createdAt.getTime()))
    : null;
  const uncoveredSources: StatisticsUncoveredSource[] = [];
  if (row.gitlab) uncoveredSources.push(StatisticsUncoveredSource.GitlabDirect);
  if (row.hosted)
    uncoveredSources.push(StatisticsUncoveredSource.HostedCertifiedFork);
  if (row.unqualified)
    uncoveredSources.push(StatisticsUncoveredSource.UnqualifiedRepository);
  const completeSince = availableSince
    ? new Date(
        Math.max(
          availableSince.getTime(),
          row.sourceActivatedAt?.getTime() ?? 0,
        ),
      )
    : null;
  return { availableSince, completeSince, uncoveredSources };
}
async function totals(
  tx: Tx,
  workspaceId: string,
  from: Date,
  to: Date,
): Promise<StatisticsTotals> {
  const rows = await tx.$queryRaw<
    { reviews: Count; prs: Count; issues: Count; repos: Count }[]
  >`SELECT
    (SELECT COUNT(*) FROM "ReviewStatisticsReviewFact" WHERE "workspaceId"=${workspaceId} AND "settledAt">=${from} AND "settledAt"<${to}) AS "reviews",
    (SELECT COUNT(DISTINCT ("scmRepositoryIdentityId","pullRequestNumber")) FROM "ReviewStatisticsReviewFact" WHERE "workspaceId"=${workspaceId} AND "settledAt">=${from} AND "settledAt"<${to}) AS "prs",
    (SELECT COUNT(*) FROM "ReviewStatisticsIssueFact" WHERE "workspaceId"=${workspaceId} AND "caughtAt">=${from} AND "caughtAt"<${to}) AS "issues",
    (SELECT COUNT(DISTINCT "scmRepositoryIdentityId") FROM "ReviewStatisticsIssueFact" WHERE "workspaceId"=${workspaceId} AND "caughtAt">=${from} AND "caughtAt"<${to}) AS "repos"`;
  const row = rows[0]!;
  return {
    reviews: count(row.reviews),
    pullRequestsReviewed: count(row.prs),
    issuesCaught: count(row.issues),
    repositoriesWithIssues: count(row.repos),
  };
}
function severityClause(severity: StatisticsSeverity | "all"): Prisma.Sql {
  return severity === "all"
    ? Prisma.empty
    : Prisma.sql`AND f."severity"=${severity}`;
}
export class PrismaReviewStatisticsReader implements ReviewStatisticsReader {
  private readonly now: () => Date;
  constructor(
    private readonly prisma: PrismaClient,
    options: { readonly now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }
  async readReport(input: StatisticsReportInput): Promise<StatisticsReport> {
    validateScope(input.actorId, input.workspaceId);
    validateStatisticsFilter(input.filter);
    const period = statisticsPeriod(input.filter.days, this.now()),
      from = new Date(period.from),
      to = new Date(period.to);
    return this.prisma.$transaction(
      async (tx) => {
        const createdAt = await authorize(tx, input.actorId, input.workspaceId),
          scope = await coverage(tx, input.workspaceId, createdAt);
        const complete = (start: string) =>
          scope.availableSince !== null &&
          scope.completeSince!.getTime() <= Date.parse(start) &&
          scope.uncoveredSources.length === 0;
        const currentComplete = complete(period.from),
          previousComplete = complete(period.previousFrom);
        const current = await totals(tx, input.workspaceId, from, to);
        const previousTotals =
          currentComplete && previousComplete
            ? await totals(
                tx,
                input.workspaceId,
                new Date(period.previousFrom),
                new Date(period.previousTo),
              )
            : null;
        const reviews = await tx.$queryRaw<
          { day: Date; reviews: Count; prs: Count }[]
        >`SELECT date_trunc('day',"settledAt") AS "day",COUNT(*) AS "reviews",COUNT(DISTINCT ("scmRepositoryIdentityId","pullRequestNumber")) AS "prs" FROM "ReviewStatisticsReviewFact" WHERE "workspaceId"=${input.workspaceId} AND "settledAt">=${from} AND "settledAt"<${to} GROUP BY 1 ORDER BY 1`;
        const issues = await tx.$queryRaw<
          { day: Date; severity: StatisticsSeverity; issues: Count }[]
        >`SELECT date_trunc('day',"caughtAt") AS "day","severity",COUNT(*) AS "issues" FROM "ReviewStatisticsIssueFact" WHERE "workspaceId"=${input.workspaceId} AND "caughtAt">=${from} AND "caughtAt"<${to} GROUP BY 1,2 ORDER BY 1,2`;
        const reviewMap = new Map(
          reviews.map((r) => [r.day.toISOString().slice(0, 10), r]),
        );
        const issueMap = new Map<string, Record<StatisticsSeverity, number>>();
        for (const row of issues) {
          const key = row.day.toISOString().slice(0, 10),
            values = issueMap.get(key) ?? {
              critical: 0,
              major: 0,
              minor: 0,
              unknown: 0,
            };
          values[row.severity] = count(row.issues);
          issueMap.set(key, values);
        }
        const daily = Array.from({ length: input.filter.days }, (_, index) => {
          const start = from.getTime() + index * dayMs,
            end = Math.min(start + dayMs, to.getTime()),
            day = new Date(start).toISOString().slice(0, 10),
            review = reviewMap.get(day);
          const dayCoverage =
            !scope.availableSince || end <= scope.availableSince.getTime()
              ? StatisticsDayCoverage.Unavailable
              : start < scope.completeSince!.getTime() ||
                  scope.uncoveredSources.length
                ? StatisticsDayCoverage.Partial
                : StatisticsDayCoverage.Complete;
          return {
            day,
            coverage: dayCoverage,
            pullRequestsReviewed: count(review?.prs ?? 0),
            reviews: count(review?.reviews ?? 0),
            issues: issueMap.get(day) ?? {
              critical: 0,
              major: 0,
              minor: 0,
              unknown: 0,
            },
          };
        });
        const rankedReviews = await tx.$queryRaw<
          (RepositoryMetadata & { repositoryId: string; count: Count })[]
        >`SELECT r."id" AS "repositoryId",r."fullName",r."provider",r."sourceBaseUrl",COUNT(*) AS "count" FROM "ReviewStatisticsReviewFact" f JOIN "RepositoryConnection" r ON r."id"=f."repositoryConnectionId" AND r."workspaceId"=f."workspaceId" WHERE f."workspaceId"=${input.workspaceId} AND f."settledAt">=${from} AND f."settledAt"<${to} GROUP BY r."id",r."fullName",r."provider",r."sourceBaseUrl" ORDER BY "count" DESC,r."fullName",r."id" LIMIT 5`;
        const rankedIssues = await tx.$queryRaw<
          (RepositoryMetadata & { repositoryId: string; count: Count })[]
        >(
          Prisma.sql`SELECT r."id" AS "repositoryId",r."fullName",r."provider",r."sourceBaseUrl",COUNT(*) AS "count" FROM "ReviewStatisticsIssueFact" f JOIN "RepositoryConnection" r ON r."id"=f."repositoryConnectionId" AND r."workspaceId"=f."workspaceId" WHERE f."workspaceId"=${input.workspaceId} AND f."caughtAt">=${from} AND f."caughtAt"<${to} ${severityClause(input.filter.severity)} GROUP BY r."id",r."fullName",r."provider",r."sourceBaseUrl" ORDER BY "count" DESC,r."fullName",r."id" LIMIT 5`,
        );
        const rank = (rows: typeof rankedReviews) =>
          rows.map((r) => ({
            repositoryId: r.repositoryId,
            fullName: r.fullName,
            url: repositoryUrl(r),
            count: count(r.count),
          }));
        return {
          period,
          filter: input.filter,
          coverage: {
            availableSince: scope.availableSince?.toISOString() ?? null,
            currentComplete,
            previousComplete,
            uncoveredSources: scope.uncoveredSources,
          },
          totals: current,
          previousTotals,
          daily,
          topRepositoriesByReviews: rank(rankedReviews),
          topRepositoriesByIssues: rank(rankedIssues),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
  async readIssues(input: StatisticsIssuesInput): Promise<StatisticsIssuePage> {
    validateScope(input.actorId, input.workspaceId);
    validateStatisticsIssuePeriod(input.from, input.to);
    validateStatisticsSeverity(input.severity);
    if (statisticsDate(input.to).getTime() > this.now().getTime())
      throw new StatisticsValidationError();
    if (input.repositoryId !== undefined)
      validateStatisticsIdentifier(input.repositoryId);
    const scope = statisticsHash([
      input.actorId,
      input.workspaceId,
      input.from,
      input.to,
      input.severity,
      input.repositoryId ?? null,
    ]);
    const cursor =
      input.cursor === undefined ? null : decodeCursor(input.cursor, scope);
    return this.prisma.$transaction(
      async (tx) => {
        await authorize(tx, input.actorId, input.workspaceId);
        if (input.repositoryId !== undefined) {
          const repository = await tx.$queryRaw<
            { id: string }[]
          >`SELECT "id" FROM "RepositoryConnection" WHERE "id"=${input.repositoryId} AND "workspaceId"=${input.workspaceId}`;
          if (!repository[0])
            throw new StatisticsValidationError(
              "statistics_invalid_repository",
            );
        }
        const repositoryFilter =
          input.repositoryId === undefined
            ? Prisma.empty
            : Prisma.sql`AND f."repositoryConnectionId"=${input.repositoryId}`;
        const continuation =
          cursor === null
            ? Prisma.empty
            : Prisma.sql`AND (f."caughtAt",f."id")<(${new Date(cursor.at)},${cursor.id})`;
        const rows = await tx.$queryRaw<IssueRow[]>(
          Prisma.sql`SELECT f."id",f."title",f."severity",f."repositoryConnectionId",f."scmRepositoryIdentityId",f."pullRequestNumber",f."caughtAt",r."fullName",r."provider",r."sourceBaseUrl" FROM "ReviewStatisticsIssueFact" f JOIN "RepositoryConnection" r ON r."id"=f."repositoryConnectionId" AND r."workspaceId"=f."workspaceId" WHERE f."workspaceId"=${input.workspaceId} AND f."caughtAt">=${new Date(input.from)} AND f."caughtAt"<${new Date(input.to)} ${severityClause(input.severity)} ${repositoryFilter} ${continuation} ORDER BY f."caughtAt" DESC,f."id" DESC LIMIT 26`,
        );
        const page = rows.slice(0, 25),
          last = page.at(-1);
        return {
          items: page.map((r) => ({
            id: r.id,
            title: r.title,
            severity: r.severity,
            repositoryId: r.repositoryConnectionId,
            repositoryFullName: r.fullName,
            scmRepositoryIdentityId: r.scmRepositoryIdentityId,
            pullRequestNumber: r.pullRequestNumber,
            pullRequestUrl: repositoryUrl(r, r.pullRequestNumber),
            caughtAt: r.caughtAt.toISOString(),
          })),
          nextCursor:
            rows.length > 25 && last ? encodeCursor(scope, last) : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
type Cursor = { v: 1; scope: string; at: string; id: string };
function encodeCursor(scope: string, last: IssueRow): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      scope,
      at: last.caughtAt.toISOString(),
      id: last.id,
    }),
  ).toString("base64url");
}
function decodeCursor(value: string, scope: string): Cursor {
  try {
    if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(value))
      throw new StatisticsValidationError();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value)
      throw new StatisticsValidationError();
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !== "at,id,scope,v"
    )
      throw new StatisticsValidationError();
    const cursor = parsed as Cursor;
    if (
      cursor.v !== 1 ||
      cursor.scope !== scope ||
      typeof cursor.id !== "string"
    )
      throw new StatisticsValidationError();
    validateStatisticsIdentifier(cursor.id);
    statisticsDate(cursor.at);
    return cursor;
  } catch {
    throw new StatisticsValidationError("statistics_invalid_cursor");
  }
}
