import type { FocusedFindingSource } from "./conversation.js";

/** Exact read-only command. Reject embedded instructions and partial prefixes. */
export function isFixedFindingCommand(body: string): boolean {
  const text = body.trim();
  if (text.includes("\n") || text.includes("\r")) return false;
  return /^(?:\/rr\s+fixed|@(?:reviewrouter(?:-ai)?|review-router-ai(?:\[bot\])?)\s+fixed|исправил[,!.\s]*проверь)$/iu.test(
    text,
  );
}

type Verdict = "fixed" | "still_present" | "cannot_verify";
const tick = String.fromCharCode(96);
const inline = (value: string) => tick + value.replaceAll(tick, "") + tick;
const safeExplanation = (text: string) =>
  text
    .replace(/<[^>]*>/gu, "")
    .replace(/@/gu, "@\u200b")
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? " " : char;
    })
    .join("")
    .trim()
    .slice(0, 550);

/** Model output is only a claim. Positive results require literal current HEAD evidence. */
export function renderFixedFindingAnswer(
  generatedAnswer: string,
  source: FocusedFindingSource | null,
  headSha: string,
): string {
  const unavailable =
    "**Cannot verify** this finding on HEAD " +
    inline(headSha.slice(0, 12)) +
    ". The checked source, model evidence or confidence was insufficient. The finding remains open.";
  if (
    !source ||
    source.headSha !== headSha ||
    !/^[0-9a-f]{40}$/.test(headSha) ||
    !/^[0-9a-f]{40,64}$/.test(source.blobOid)
  )
    return unavailable;
  let raw: unknown;
  try {
    raw = JSON.parse(generatedAnswer);
  } catch {
    return unavailable;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unavailable;
  const result = raw as Record<string, unknown>;
  if (
    Object.keys(result).sort().join(",") !==
      "confidence,evidence,reason,scopeSufficient,verdict" ||
    !["fixed", "still_present", "cannot_verify"].includes(
      String(result.verdict),
    ) ||
    typeof result.confidence !== "number" ||
    !Number.isFinite(result.confidence) ||
    result.confidence < 0 ||
    result.confidence > 1 ||
    typeof result.scopeSufficient !== "boolean" ||
    typeof result.reason !== "string" ||
    result.reason.trim().length < 20 ||
    result.reason.length > 1200 ||
    !Array.isArray(result.evidence) ||
    result.evidence.length > 2
  )
    return unavailable;
  const verdict = result.verdict as Verdict;
  if (verdict === "cannot_verify") return unavailable;
  if (
    result.scopeSufficient !== true ||
    result.confidence < (verdict === "fixed" ? 0.92 : 0.85) ||
    result.evidence.length === 0
  )
    return unavailable;
  const lines = source.content.split("\n");
  const validEvidence = result.evidence.every((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      return false;
    const item = entry as Record<string, unknown>;
    return (
      Object.keys(item).sort().join(",") === "line,quote" &&
      Number.isInteger(item.line) &&
      (item.line as number) >= 1 &&
      (item.line as number) <= lines.length &&
      typeof item.quote === "string" &&
      item.quote.trim().length >= 4 &&
      item.quote.length <= 240 &&
      lines[(item.line as number) - 1]!.includes(item.quote)
    );
  });
  if (!validEvidence) return unavailable;
  const label =
    verdict === "fixed"
      ? "**Fixed (revalidated)**"
      : "**Still present (revalidated)**";
  const first = result.evidence[0] as { line: number; quote: string };
  return [
    label + " on HEAD " + inline(headSha.slice(0, 12)) + ".",
    safeExplanation(result.reason),
    "Current source evidence: " +
      inline(source.path.replace(/[^\w./-]/gu, "") + ":" + first.line) +
      " (blob " +
      inline(source.blobOid.slice(0, 12)) +
      ").",
    "_Read-only check: the GitHub review thread was not resolved and no code was changed._",
  ].join("\n\n");
}
