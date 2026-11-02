import type {
  ReviewSkillScanExecutorPort,
  ReviewSkillScanProfile,
} from "./catalog-contracts.js";
import type {
  ReviewSkillScanClaim,
  ReviewSkillsCatalogStore,
} from "./ports/review-skills-catalog-store.js";
import {
  incompleteSkillScanReport,
  normalizeSkillScanReport,
} from "../domain/skill-scan-report.js";

export async function processReviewSkillScan(
  claim: ReviewSkillScanClaim,
  dependencies: {
    readonly store: ReviewSkillsCatalogStore;
    readonly executor: ReviewSkillScanExecutorPort;
    readonly profiles: readonly ReviewSkillScanProfile[];
  },
): Promise<"processed" | "busy"> {
  const start = await dependencies.store.beginScan(
    claim,
    dependencies.profiles,
  );
  if (start.status === "busy") return "busy";
  if (start.status !== "started") return "processed";
  const execution = start.execution;
  let report = incompleteSkillScanReport();
  let confirmedExit = false;
  try {
    const result = await dependencies.executor.scan(execution);
    confirmedExit =
      result.jobId === execution.jobId &&
      result.attemptId === execution.attemptId &&
      result.contentDigest === execution.contentDigest &&
      result.profileFingerprint === execution.profile.fingerprint &&
      result.scannerBuildId === execution.profile.scannerBuildId &&
      result.executionFinished === true;
    if (confirmedExit)
      report = normalizeSkillScanReport(result.report, execution.profile);
  } catch {
    // The service may still be terminating after transport loss. Keep the slot
    // through the fixed execution deadline plus margin; never re-run this attempt.
  }
  await dependencies.store.finishScan({ ...claim, report, confirmedExit });
  return "processed";
}
