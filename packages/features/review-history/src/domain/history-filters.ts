import { HistoryValidationError, type HistoryFilters } from "./history.js";
export function historyIdentifier(value: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 240 ||
    /\s/u.test(value) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    throw new HistoryValidationError();
  return value;
}
export function historySearch(value: string): {
  q: string;
  number: number | null;
  tokens: readonly string[];
} {
  if (typeof value !== "string" || value.length > 200)
    throw new HistoryValidationError();
  const trimmed = value.trim();
  if (/^#?[1-9][0-9]*$/u.test(trimmed)) {
    const number = Number(trimmed.replace(/^#/u, ""));
    if (!Number.isSafeInteger(number) || number > 2_147_483_647)
      throw new HistoryValidationError();
    return { q: String(number), number, tokens: [] };
  }
  const tokens = trimmed.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (tokens.length > 8) throw new HistoryValidationError();
  return { q: tokens.join(" "), number: null, tokens };
}
export function normalizeHistoryFilters(input: HistoryFilters): HistoryFilters {
  if (
    !input ||
    typeof input !== "object" ||
    !["all", "active", "completed", "attention"].includes(input.status) ||
    ![null, 7, 30, 90].includes(input.days)
  )
    throw new HistoryValidationError();
  return {
    q: historySearch(input.q).q,
    repositoryId:
      input.repositoryId === null
        ? null
        : historyIdentifier(input.repositoryId),
    status: input.status,
    days: input.days,
  };
}
