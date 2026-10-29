import { Prisma } from "@prisma/client";
import {
  HistoryAccessError,
  type HistoryFilters,
} from "../../domain/history.js";
import { historySearch } from "../../domain/history-filters.js";
export async function authorizeHistory(
  tx: Prisma.TransactionClient,
  actorId: string,
  workspaceId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<
    { allowed: boolean }[]
  >`SELECT (w."deletionState"='active' AND CASE WHEN w."personalOwnerUserId" IS NOT NULL THEN w."personalOwnerUserId"=${actorId} ELSE EXISTS (SELECT 1 FROM "WorkspaceMember" m WHERE m."workspaceId"=w."id" AND m."userId"=${actorId}) END) AS allowed FROM "Workspace" w WHERE w."id"=${workspaceId}`;
  if (!rows[0]?.allowed) throw new HistoryAccessError();
}
export function historyFilterSql(filters: HistoryFilters): Prisma.Sql {
  const search = historySearch(filters.q),
    parts: Prisma.Sql[] = [];
  if (filters.repositoryId !== null)
    parts.push(Prisma.sql`p."scmRepositoryIdentityId"=${filters.repositoryId}`);
  if (filters.status === "active")
    parts.push(
      Prisma.sql`p."latestStatus" IN ('queued','running','publishing')`,
    );
  if (filters.status === "completed")
    parts.push(Prisma.sql`p."latestStatus"='completed'`);
  if (filters.status === "attention")
    parts.push(
      Prisma.sql`p."latestStatus" IN ('incomplete','failed','stopped','unconfirmed')`,
    );
  if (search.number !== null)
    parts.push(Prisma.sql`p."pullRequestNumber"=${search.number}`);
  else if (search.tokens.length)
    parts.push(
      Prisma.sql`p."searchDocument" @@ to_tsquery('simple',${search.tokens.map((token) => `${token}:*`).join(" & ")})`,
    );
  return parts.length
    ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}`
    : Prisma.empty;
}
export function historyPullRequestUrl(
  sourceBaseUrl: string | null,
  fullName: string,
  number: number,
): string | null {
  try {
    const origin = new URL(sourceBaseUrl ?? "https://github.com"),
      parts = fullName.split("/");
    if (
      origin.origin !== "https://github.com" ||
      origin.pathname !== "/" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      parts.length !== 2 ||
      parts.some((part) => !part || part === "." || part === "..") ||
      number < 1
    )
      return null;
    return `${origin.toString().replace(/\/+$/u, "")}/${parts.map(encodeURIComponent).join("/")}/pull/${number}`;
  } catch {
    return null;
  }
}
