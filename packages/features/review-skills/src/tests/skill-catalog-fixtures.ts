import { createHash } from "node:crypto";
import type {
  ReviewSkillScanMode,
  ReviewSkillScanProfile,
} from "../application/catalog-contracts.js";
export function scanProfile(
  mode: ReviewSkillScanMode = "static",
): ReviewSkillScanProfile {
  const fields = {
    mode,
    profileId: `${mode}-v1`,
    scannerVersion: "2.13.1",
    scannerBuildId:
      "skillspector@f3b25697d76256998ca9d42c198d256258d4c035:test",
    policyVersion: "skill-import-v1",
    model: mode === "ai" ? "fixture-model" : null,
    maxDurationMs: mode === "ai" ? 180000 : 90000,
    maxCalls: mode === "ai" ? 4 : 0,
    maxInputBytes: mode === "ai" ? 131072 : 65536,
    maxOutputTokens: mode === "ai" ? 2048 : 0,
  };
  const fingerprint = `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    )
    .digest("hex")}`;
  return { ...fields, fingerprint };
}
/** Required v2.13.1 contract fields, independent of application verdict mapping. */
export function nativeReport(mode: ReviewSkillScanMode = "static") {
  return {
    execution_successful: true,
    analysis_completeness: {
      is_complete: true,
      status: "complete",
      execution_successful: true,
      analyzer_statuses: [] as unknown[],
    },
    risk_assessment: {
      score: 0,
      severity: "LOW",
      recommendation: "SAFE",
      max_issue_severity: "NONE",
    },
    metadata: {
      skillspector_version: "2.13.1",
      llm_requested: mode === "ai",
      llm_available: mode === "ai",
      llm_degraded: false,
      llm_calls_attempted: mode === "ai" ? 3 : 0,
      llm_calls_succeeded: mode === "ai" ? 3 : 0,
      inference_usage: [] as unknown[],
    },
    issues: [] as unknown[],
  };
}
