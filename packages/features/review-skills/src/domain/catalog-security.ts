export type ReviewSkillScanMode = "static" | "ai";
export type ReviewSkillScanVerdict =
  | "clear"
  | "warnings"
  | "blocked"
  | "incomplete";
export type ReviewSkillScanFinding = Readonly<{
  severity: "low" | "medium" | "high" | "critical";
  explanation: string;
  remediation: string | null;
  line: number | null;
}>;
export type ReviewSkillScanReport = Readonly<{
  verdict: ReviewSkillScanVerdict;
  findings: readonly ReviewSkillScanFinding[];
}>;
/** Server configuration only; every execution bound participates in cache identity. */
export type ReviewSkillScanProfile = Readonly<{
  mode: ReviewSkillScanMode;
  profileId: string;
  fingerprint: string;
  scannerVersion: string;
  scannerBuildId: string;
  policyVersion: string;
  model: string | null;
  maxDurationMs: number;
  maxCalls: number;
  maxInputBytes: number;
  maxOutputTokens: number;
}>;
