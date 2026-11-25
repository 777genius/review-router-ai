import { createHash } from "node:crypto";
export function canonicalHistoryJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalHistoryJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonicalHistoryJson((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export function historyHash(value: unknown): string {
  return createHash("sha256").update(canonicalHistoryJson(value)).digest("hex");
}
