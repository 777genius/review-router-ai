import { createHash } from "node:crypto";
import { historyIdentifier } from "../../domain/history-filters.js";
import {
  HistoryValidationError,
  type HistoryFilters,
} from "../../domain/history.js";
export type HistoryPosition = { readonly key: string; readonly id: string };
export type HistoryCursor = {
  readonly v: 1;
  readonly scope: string;
  readonly kind: "prs" | "runs" | "repositories";
  readonly from: string | null;
  readonly until: string | null;
  readonly position: HistoryPosition | null;
};
export const historyScopeHash = (values: readonly unknown[]): string =>
  createHash("sha256").update(JSON.stringify(values)).digest("hex");
export const encodeHistoryCursor = (cursor: HistoryCursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString("base64url");
const iso = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;
export function decodeHistoryCursor(
  value: string,
  kind: HistoryCursor["kind"],
  scope: string,
): HistoryCursor {
  try {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 2048 ||
      !/^[A-Za-z0-9_-]+$/u.test(value)
    )
      throw new Error();
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) throw new Error();
    const decoded: unknown = JSON.parse(bytes.toString("utf8"));
    if (
      !decoded ||
      typeof decoded !== "object" ||
      Array.isArray(decoded) ||
      Object.keys(decoded).sort().join(",") !==
        "from,kind,position,scope,until,v"
    )
      throw new Error();
    const cursor = decoded as HistoryCursor;
    if (
      cursor.v !== 1 ||
      cursor.kind !== kind ||
      cursor.scope !== scope ||
      !(
        (cursor.from === null && cursor.until === null) ||
        (iso(cursor.from) && iso(cursor.until))
      )
    )
      throw new Error();
    const position = cursor.position;
    if (
      position !== null &&
      (!position ||
        typeof position !== "object" ||
        Array.isArray(position) ||
        Object.keys(position).sort().join(",") !== "id,key" ||
        typeof position.key !== "string" ||
        position.key.length > 1024)
    )
      throw new Error();
    if (position !== null) historyIdentifier(position.id);
    if (kind !== "prs" && (cursor.from !== null || cursor.until !== null))
      throw new Error();
    if (kind === "prs" && position !== null && !iso(position.key))
      throw new Error();
    if (
      kind === "runs" &&
      position !== null &&
      !/^[1-9][0-9]{0,18}$/u.test(position.key)
    )
      throw new Error();
    if (
      kind === "runs" &&
      position !== null &&
      BigInt(position.key) > 9_223_372_036_854_775_807n
    )
      throw new Error();
    return cursor;
  } catch {
    throw new HistoryValidationError("history_invalid_cursor");
  }
}
export function historyWindow(
  filters: HistoryFilters,
  scope: string,
  now: Date,
  encoded?: string,
): HistoryCursor {
  const cursor: HistoryCursor =
    encoded === undefined
      ? {
          v: 1,
          kind: "prs",
          scope,
          position: null,
          from:
            filters.days === null
              ? null
              : new Date(
                  Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate() - filters.days + 1,
                  ),
                ).toISOString(),
          until:
            filters.days === null
              ? null
              : new Date(
                  Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate() + 1,
                  ),
                ).toISOString(),
        }
      : decodeHistoryCursor(encoded, "prs", scope);
  if (filters.days === null) {
    if (cursor.from !== null || cursor.until !== null)
      throw new HistoryValidationError("history_invalid_cursor");
  } else if (
    cursor.from === null ||
    cursor.until === null ||
    !cursor.from.endsWith("T00:00:00.000Z") ||
    !cursor.until.endsWith("T00:00:00.000Z") ||
    Date.parse(cursor.until) - Date.parse(cursor.from) !==
      filters.days * 86_400_000
  )
    throw new HistoryValidationError("history_invalid_cursor");
  return cursor;
}
