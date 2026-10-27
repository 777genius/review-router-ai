import type {
  ReviewSkillScanFinding,
  ReviewSkillScanProfile,
  ReviewSkillScanReport,
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
          /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g,
          "",
        )
        .slice(0, limit)
    : null;
export const incompleteSkillScanReport = (): ReviewSkillScanReport => ({
  verdict: "incomplete",
  findings: [],
});

/** Parse the pinned report contract, never the CLI's permissive exit status. */
export function normalizeSkillScanReport(
  value: unknown,
  profile: ReviewSkillScanProfile,
): ReviewSkillScanReport {
  const report = object(value),
    completeness = object(report?.analysis_completeness),
    risk = object(report?.risk_assessment),
    metadata = object(report?.metadata);
  if (
    !report ||
    !completeness ||
    !risk ||
    !metadata ||
    report.execution_successful !== true ||
    completeness.is_complete !== true ||
    completeness.status !== "complete" ||
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
    return incompleteSkillScanReport();
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
    return incompleteSkillScanReport();
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
      return incompleteSkillScanReport();
    const explanation = safeText(issue.explanation, 1200);
    if (!explanation?.trim()) return incompleteSkillScanReport();
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
  return {
    verdict:
      worst >= 3 ||
      Number(risk.score) > 50 ||
      risk.recommendation === "DO_NOT_INSTALL"
        ? "blocked"
        : worst > 0 || findings.length > 0 || risk.recommendation === "CAUTION"
          ? "warnings"
          : "clear",
    findings: findings.slice(0, 30),
  };
}
