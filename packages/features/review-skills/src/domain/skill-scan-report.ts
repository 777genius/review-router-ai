import type {
  ReviewSkillScanFinding,
  ReviewSkillScanProfile,
  ReviewSkillScanReport,
  ReviewSkillReportedUsage,
} from "./catalog-security.js";

const ranks = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 } as const;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const safeText = (value: unknown, limit: number): string | null =>
  typeof value === "string"
    ? value
        .replace(
          // eslint-disable-next-line no-control-regex -- Strip unsafe ASCII control characters from untrusted findings.
          /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,
          "",
        )
        .slice(0, limit)
    : null;
const emptyOrAbsent = (value: unknown) =>
  value === undefined || (Array.isArray(value) && value.length === 0);
/** Only SKILL.md text is imported, and the user acknowledges each linked file
 * that is left out. SkillSpector reports such a link as a non-fatal missing
 * reference; that one expected gap must not fail the check. Any other gap,
 * exclusion or limitation keeps the report incomplete. */
function onlyMissingLinkedFiles(completeness: Record<string, unknown>) {
  const exceptions = completeness.ledger_exceptions;
  return (
    completeness.is_complete === false &&
    completeness.status === "partial" &&
    completeness.partially_inspected_files === 0 &&
    completeness.entirely_uninspected_files === 0 &&
    emptyOrAbsent(completeness.scope_exclusions) &&
    emptyOrAbsent(completeness.limitations) &&
    Array.isArray(exceptions) &&
    exceptions.length > 0 &&
    exceptions.every((entry) => {
      const exception = object(entry);
      return (
        exception?.outcome === "partial" &&
        exception.phase === "reference_resolution" &&
        exception.reason_code === "reference_missing" &&
        exception.fatal === false
      );
    })
  );
}
export const incompleteSkillScanReport = (
  reportedUsage: ReviewSkillReportedUsage | null = null,
): ReviewSkillScanReport => ({
  verdict: "incomplete",
  findings: [],
  reportedUsage,
});

function reportedModelUsage(
  metadata: Record<string, unknown> | null,
  profile: ReviewSkillScanProfile,
): ReviewSkillReportedUsage | null {
  if (profile.mode !== "ai" || !metadata) return null;
  const count = (value: unknown, maximum: number): number | null =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
      ? value
      : null;
  const callsAttempted = count(metadata.llm_calls_attempted, profile.maxCalls);
  const callsSucceeded = count(
    metadata.llm_calls_succeeded,
    callsAttempted ?? profile.maxCalls,
  );
  const usage =
    Array.isArray(metadata.inference_usage) &&
    metadata.inference_usage.length > 0 &&
    metadata.inference_usage.length <= 64
      ? metadata.inference_usage
      : null;
  const sum = (field: string): number | null => {
    if (!usage) return null;
    let total = 0;
    for (const entry of usage) {
      const value = count(object(entry)?.[field], Number.MAX_SAFE_INTEGER);
      if (value === null || !Number.isSafeInteger(total + value)) return null;
      total += value;
    }
    return total;
  };
  return {
    callsAttempted,
    callsSucceeded,
    inputTokens: sum("prompt_tokens"),
    outputTokens: sum("completion_tokens"),
    totalTokens: sum("total_tokens"),
  };
}

/** Parse the pinned report contract, never the CLI's permissive exit status. */
export function normalizeSkillScanReport(
  value: unknown,
  profile: ReviewSkillScanProfile,
): ReviewSkillScanReport {
  const report = object(value),
    completeness = object(report?.analysis_completeness),
    risk = object(report?.risk_assessment),
    metadata = object(report?.metadata);
  const reportedUsage = reportedModelUsage(metadata, profile);
  const linkedFilesOnly = completeness
    ? onlyMissingLinkedFiles(completeness)
    : false;
  if (
    !report ||
    !completeness ||
    !risk ||
    !metadata ||
    report.execution_successful !== true ||
    (!linkedFilesOnly &&
      (completeness.is_complete !== true ||
        completeness.status !== "complete")) ||
    completeness.execution_successful !== true ||
    metadata.skillspector_version !== profile.scannerVersion ||
    metadata.llm_requested !== (profile.mode === "ai") ||
    !Array.isArray(metadata.inference_usage) ||
    !Array.isArray(report.issues) ||
    report.issues.length > 200 ||
    !Number.isInteger(risk.score) ||
    Number(risk.score) < 0 ||
    Number(risk.score) > 100 ||
    !["SAFE", "CAUTION", "DO_NOT_INSTALL"].includes(
      String(risk.recommendation),
    ) ||
    !Object.hasOwn(ranks, String(risk.max_issue_severity))
  )
    return incompleteSkillScanReport(reportedUsage);
  if (
    profile.mode === "ai" &&
    (metadata.llm_available !== true ||
      (metadata.llm_degraded !== undefined &&
        metadata.llm_degraded !== false) ||
      !Number.isInteger(metadata.llm_calls_attempted) ||
      Number(metadata.llm_calls_attempted) < 1 ||
      Number(metadata.llm_calls_attempted) > profile.maxCalls ||
      metadata.llm_calls_succeeded !== metadata.llm_calls_attempted)
  )
    return incompleteSkillScanReport(reportedUsage);
  const findings: ReviewSkillScanFinding[] = [];
  let worst = ranks[risk.max_issue_severity as keyof typeof ranks];
  for (const entry of report.issues) {
    const issue = object(entry),
      location = object(issue?.location);
    if (
      !issue ||
      typeof issue.severity !== "string" ||
      !["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(issue.severity)
    )
      return incompleteSkillScanReport(reportedUsage);
    const explanation = safeText(issue.explanation, 1200);
    if (!explanation?.trim()) return incompleteSkillScanReport(reportedUsage);
    worst = Math.max(
      worst,
      ranks[issue.severity as keyof typeof ranks],
    ) as typeof worst;
    findings.push({
      severity:
        issue.severity.toLowerCase() as ReviewSkillScanFinding["severity"],
      explanation,
      remediation: safeText(issue.remediation, 800),
      line:
        Number.isInteger(location?.start_line) &&
        Number(location?.start_line) > 0 &&
        Number(location?.start_line) < 100000
          ? Number(location?.start_line)
          : null,
    });
  }
  // A partial analysis alone makes SkillSpector say CAUTION. When the only gap
  // is the acknowledged linked files, that CAUTION carries no finding.
  const caution =
    risk.recommendation === "CAUTION" &&
    !(linkedFilesOnly && worst === 0 && findings.length === 0);
  return {
    verdict:
      worst >= 3 ||
      Number(risk.score) > 50 ||
      risk.recommendation === "DO_NOT_INSTALL"
        ? "blocked"
        : worst > 0 || findings.length > 0 || caution
          ? "warnings"
          : "clear",
    findings: findings.slice(0, 30),
    reportedUsage,
  };
}
