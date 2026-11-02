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
  /** Internal provider-reported counters; never a reservation refund or UI claim. */
  reportedUsage?: ReviewSkillReportedUsage | null;
}>;
export type ReviewSkillReportedUsage = Readonly<{
  callsAttempted: number | null;
  callsSucceeded: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
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
