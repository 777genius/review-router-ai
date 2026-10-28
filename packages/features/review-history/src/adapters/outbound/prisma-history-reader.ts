import { Prisma, type PrismaClient } from "@prisma/client";
import type { HistoryReader } from "../../application/ports/history-reader.js";
import {
  HistoryStatus,
  HistoryValidationError,
  type HistoryRepositoryOption,
} from "../../domain/history.js";
import {
  historyIdentifier,
  historySearch,
  normalizeHistoryFilters,
} from "../../domain/history-filters.js";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  historyScopeHash,
  historyWindow,
  type HistoryCursor,
} from "./history-cursor.js";
import {
  authorizeHistory,
  historyFilterSql,
  historyPullRequestUrl,
} from "./history-read-sql.js";

type PrRow = {
  id: string;
  scmRepositoryIdentityId: string;
  repositoryFullName: string | null;
  pullRequestNumber: number;
  pullRequestTitle: string | null;
  sourceBaseUrl: string | null;
  latestStatus: string;
  latestRequestedAt: Date;
};
type RunRow = {
  rootRequestId: string;
  requestedAt: Date;
  status: string;
  runSequence: bigint;
};
const isolation = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
} as const;
function status(value: string): HistoryStatus {
  if (!Object.values(HistoryStatus).includes(value as HistoryStatus))
    throw new Error("history_projection_status_invalid");
  return value as HistoryStatus;
}
const repositorySources = (
  workspaceId: string,
) => Prisma.sql`WITH repositories AS (
  SELECT DISTINCT ON ("scmRepositoryIdentityId") "scmRepositoryIdentityId" AS id,
    COALESCE("repositoryFullName",'Repository') AS "fullName"
  FROM "ReviewHistoryPullRequest"
  WHERE "workspaceId"=${workspaceId} AND "latestRootRequestId" IS NOT NULL AND "projectedAt" IS NOT NULL
  ORDER BY "scmRepositoryIdentityId" DESC,"latestRequestedAt" DESC,"id" DESC
)`;
/** Passive construction: the host owns the database; every invocation authorizes afresh. */
export function createPrismaHistoryReader(
  prisma: PrismaClient,
  options: { readonly now?: () => Date } = {},
): HistoryReader {
  const now = options.now ?? (() => new Date());
  return {
    listPullRequests: (input) =>
      prisma.$transaction(async (tx) => {
        await authorizeHistory(tx, input.actorId, input.workspaceId);
        const filters = normalizeHistoryFilters(input.filters);
        const scope = historyScopeHash([
          "prs",
          input.actorId,
          input.workspaceId,
          filters,
        ]);
        const cursor = historyWindow(filters, scope, now(), input.cursor);
        const windowToken = encodeHistoryCursor({ ...cursor, position: null });
        const coverageRows = await tx.$queryRaw<
          { coverageSince: Date }[]
        >`SELECT "coverageSince" FROM "ReviewHistoryCoverage" WHERE id='capture_v1'`;
        const availableSince = coverageRows[0]?.coverageSince.toISOString();
        if (!availableSince)
          return {
            items: [],
            nextCursor: null,
            windowToken,
            coverage: { state: "unavailable" as const },
          };
        if (filters.repositoryId !== null) {
          const repository = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "ReviewHistoryPullRequest" WHERE "workspaceId"=${input.workspaceId} AND "scmRepositoryIdentityId"=${filters.repositoryId} AND "latestRootRequestId" IS NOT NULL AND "projectedAt" IS NOT NULL LIMIT 1`;
          if (!repository[0])
            throw new HistoryValidationError("history_invalid_repository");
        }
        const period =
          cursor.from === null
            ? Prisma.empty
            : Prisma.sql`AND p."latestRequestedAt">=${new Date(cursor.from)} AND p."latestRequestedAt"<${new Date(cursor.until!)}`;
        const continuation =
          cursor.position === null
            ? Prisma.empty
            : Prisma.sql`AND (p."latestRequestedAt",p.id)<(${new Date(cursor.position.key)},${cursor.position.id})`;
        const rows = await tx.$queryRaw<PrRow[]>(
          Prisma.sql`SELECT p.id,p."scmRepositoryIdentityId",p."repositoryFullName",p."pullRequestNumber",p."pullRequestTitle",p."sourceBaseUrl",p."latestStatus",p."latestRequestedAt" FROM "ReviewHistoryPullRequest" p WHERE p."workspaceId"=${input.workspaceId} AND p."latestRootRequestId" IS NOT NULL AND p."projectedAt" IS NOT NULL AND p."latestStatus" IS NOT NULL AND p."latestRequestedAt" IS NOT NULL ${historyFilterSql(filters)} ${period} ${continuation} ORDER BY p."latestRequestedAt" DESC,p.id DESC LIMIT 26`,
        );
        const page = rows.slice(0, 25),
          last = page.at(-1);
        return {
          items: page.map((row) => ({
            id: row.id,
            scmRepositoryIdentityId: row.scmRepositoryIdentityId,
            repositoryFullName: row.repositoryFullName ?? "Repository",
            pullRequestNumber: row.pullRequestNumber,
            pullRequestTitle: row.pullRequestTitle,
            pullRequestUrl: historyPullRequestUrl(
              row.sourceBaseUrl,
              row.repositoryFullName ?? "",
              row.pullRequestNumber,
            ),
            status: status(row.latestStatus),
            requestedAt: row.latestRequestedAt.toISOString(),
          })),
          nextCursor:
            rows.length > 25 && last
              ? encodeHistoryCursor({
                  ...cursor,
                  position: {
                    key: last.latestRequestedAt.toISOString(),
                    id: last.id,
                  },
                })
              : null,
          windowToken,
          coverage: {
            state: "available" as const,
            availableSince,
            supportedSource: "github_v2" as const,
          },
        };
      }, isolation),
    listRuns: (input) =>
      prisma.$transaction(async (tx) => {
        await authorizeHistory(tx, input.actorId, input.workspaceId);
        historyIdentifier(input.pullRequestId);
        const scope = historyScopeHash([
          "runs",
          input.actorId,
          input.workspaceId,
          input.pullRequestId,
        ]);
        const cursor: HistoryCursor =
          input.cursor === undefined
            ? {
                v: 1,
                kind: "runs",
                scope,
                from: null,
                until: null,
                position: null,
              }
            : decodeHistoryCursor(input.cursor, "runs", scope);
        const continuation =
          cursor.position === null
            ? Prisma.empty
            : Prisma.sql`AND ("runSequence","rootRequestId")<(${BigInt(cursor.position.key)},${cursor.position.id})`;
        const rows = await tx.$queryRaw<RunRow[]>(
          Prisma.sql`SELECT "rootRequestId","requestedAt",status,"runSequence" FROM "ReviewHistoryRun" WHERE "workspaceId"=${input.workspaceId} AND "pullRequestId"=${input.pullRequestId} AND "projectedAt" IS NOT NULL AND status IS NOT NULL ${continuation} ORDER BY "runSequence" DESC,"rootRequestId" DESC LIMIT 6`,
        );
        const page = rows.slice(0, 5),
          last = page.at(-1);
        return {
          items: page.map((row) => ({
            id: row.rootRequestId,
            requestedAt: row.requestedAt.toISOString(),
            status: status(row.status),
          })),
          nextCursor:
            rows.length > 5 && last
              ? encodeHistoryCursor({
                  ...cursor,
                  position: {
                    key: String(last.runSequence),
                    id: last.rootRequestId,
                  },
                })
              : null,
        };
      }, isolation),
    listRepositories: (input) =>
      prisma.$transaction(async (tx) => {
        await authorizeHistory(tx, input.actorId, input.workspaceId);
        const raw = historySearch(input.q ?? "");
        // Repository options search their labels, including wholly numeric names.
        const tokens = raw.number === null ? raw.tokens : [String(raw.number)];
        if (input.selectedRepositoryId !== undefined)
          historyIdentifier(input.selectedRepositoryId);
        const scope = historyScopeHash([
          "repositories",
          input.actorId,
          input.workspaceId,
          raw.q,
          input.selectedRepositoryId ?? null,
        ]);
        const cursor: HistoryCursor =
          input.cursor === undefined
            ? {
                v: 1,
                kind: "repositories",
                scope,
                from: null,
                until: null,
                position: null,
              }
            : decodeHistoryCursor(input.cursor, "repositories", scope);
        const search = tokens.length
          ? Prisma.sql`AND to_tsvector('simple',"fullName") @@ to_tsquery('simple',${tokens.map((token) => `${token}:*`).join(" & ")})`
          : Prisma.empty;
        const continuation =
          cursor.position === null
            ? Prisma.empty
            : Prisma.sql`AND (lower("fullName"),id)>(${cursor.position.key},${cursor.position.id})`;
        const rows = await tx.$queryRaw<
          (HistoryRepositoryOption & { sortKey: string })[]
        >(
          Prisma.sql`${repositorySources(input.workspaceId)} SELECT id,"fullName",lower("fullName") AS "sortKey" FROM repositories WHERE true ${search} ${continuation} ORDER BY lower("fullName"),id LIMIT 26`,
        );
        const selected =
          input.selectedRepositoryId === undefined
            ? []
            : await tx.$queryRaw<HistoryRepositoryOption[]>(
                Prisma.sql`${repositorySources(input.workspaceId)} SELECT id,"fullName" FROM repositories WHERE id=${input.selectedRepositoryId}`,
              );
        const page = rows.slice(0, 25),
          last = page.at(-1);
        return {
          items: page.map(({ id, fullName }) => ({ id, fullName })),
          selected: selected[0] ?? null,
          nextCursor:
            rows.length > 25 && last
              ? encodeHistoryCursor({
                  ...cursor,
                  position: { key: last.sortKey, id: last.id },
                })
              : null,
        };
      }, isolation),
  };
}
