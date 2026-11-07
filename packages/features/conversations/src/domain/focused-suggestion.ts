import type { FocusedFindingSource } from "./conversation.js";

/** Literal command grammar; text never carries a path, provider, or shell option. */
export function isSuggestFixCommand(body: string): boolean {
  const text = body.trim();
  if (!text || text.includes("\n") || text.includes("\r")) return false;
  return /^(?:\/rr\s+suggest\s+fix|@(?:reviewrouter(?:-ai)?|review-router-ai(?:\[bot\])?)\s+suggest\s+fix|предложи\s+исправление)$/iu.test(
    text,
  );
}

/** Validate that every requested line belongs to one RIGHT-side hunk. */
function inOneRightHunk(patch: string, start: number, end: number): boolean {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start ||
    start < 1 || end - start >= 50) return false;
  let hunk = 0;
  let line = 0;
  const right = new Map<number, number>();
  const rows = patch.split("\n");
  for (const [index, row] of rows.entries()) {
    if (!row && index === rows.length - 1) break;
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (header) {
      const begin = Number(header[1]);
      if (!Number.isSafeInteger(begin) || begin < 1) return false;
      line = begin;
      hunk += 1;
      continue;
    }
    if (hunk === 0) continue;
    if (row.startsWith("\\ No newline")) continue;
    if (row.startsWith("+")) right.set(line++, hunk);
    else if (row.startsWith(" ")) right.set(line++, hunk);
    else if (row.startsWith("-")) continue;
    else return false;
  }
  const expectedHunk = right.get(start);
  if (!expectedHunk) return false;
  for (let current = start; current <= end; current++) {
    if (right.get(current) !== expectedHunk) return false;
  }
  return true;
}

/** Model-supplied replacement must be fully anchored before GitHub can offer Apply. */
export function renderFocusedSuggestion(
  answer: string,
  source: FocusedFindingSource | null,
  headSha: string,
  anchoredCommitSha: string,
): string {
  const unavailable = "**Cannot suggest a safe fix** on this PR revision. A current RIGHT-side diff hunk, exact original text, and a bounded proposal are required. Nothing was changed.";
  if (
    !source ||
    source.headSha !== headSha ||
    anchoredCommitSha !== headSha ||
    !/^[a-f0-9]{40}$/u.test(headSha) ||
    !source.patch ||
    source.patch.length > 24_000 ||
    !Number.isSafeInteger(source.originalLine) ||
    (source.originalLine ?? 0) < 1
  ) return unavailable;
  let raw: unknown;
  try { raw = JSON.parse(answer); } catch { return unavailable; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unavailable;
  const result = raw as Record<string, unknown>;
  if (
    Object.keys(result).sort().join(",") !== "before,endLine,replacement,startLine" ||
    !Number.isSafeInteger(result.startLine) ||
    !Number.isSafeInteger(result.endLine) ||
    typeof result.before !== "string" ||
    typeof result.replacement !== "string"
  ) return unavailable;
  const start = result.startLine as number, end = result.endLine as number;
  const anchor = source.originalLine!;
  if (
    start < 1 || end < start || end - start >= 50 ||
    anchor < start || anchor > end ||
    !inOneRightHunk(source.patch, start, end)
  ) return unavailable;
  const original = source.content.split("\n").slice(start - 1, end).join("\n");
  const before = result.before as string;
  const replacement = result.replacement as string;
  if (
    before !== original ||
    !before.trim() ||
    !replacement.trim() ||
    replacement.length > 4_000 ||
    replacement.split("\n").length > 50 ||
    /[\r\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(replacement)
  ) return unavailable;
  const tick = String.fromCharCode(96);
  const runs = replacement.match(new RegExp(tick + "+", "gu")) ?? [];
  const fence = tick.repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  const range = start === anchor && end === anchor
    ? "" : ":-" + (anchor - start) + "+" + (end - anchor);
  return [
    "**Suggested fix** for " + tick + source.path.replace(/[^\w./-]/gu, "") +
      ":" + start + (start === end ? "" : "-" + end) + tick +
      " at HEAD " + tick + headSha.slice(0, 12) + tick + ".",
    fence + "suggestion" + range + "\n" + replacement + "\n" + fence,
    "_Apply this suggestion manually in GitHub. No code or review state was changed._",
  ].join("\n\n");
}
