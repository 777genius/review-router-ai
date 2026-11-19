import type { ReviewExecutionProgressCapturePort } from "@reviewrouter/features-review-executions/composition";
import { captureReviewProgress } from "../infrastructure/prisma/prisma-review-progress-projection";
import type { ReviewProgressSettings } from "./review-progress-settings";

export * from "./review-progress-settings";

export function createPrismaReviewProgressCapture(
  options: Readonly<{ fileCoverageEnabled?: boolean }> = {},
): ReviewExecutionProgressCapturePort {
  return (transaction, execution) =>
    captureReviewProgress(transaction, execution, options);
}

/** The capture port for the given settings, or `undefined` when capture is off. */
export function createConfiguredReviewProgressCapture(
  settings: ReviewProgressSettings,
): ReviewExecutionProgressCapturePort | undefined {
  return settings.projectionCapture
    ? createPrismaReviewProgressCapture({
        fileCoverageEnabled: settings.fileCoverage,
      })
    : undefined;
}
