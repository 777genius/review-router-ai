import { SkillCatalogClientError } from "../catalog-client-adapter";
import type { ReviewSkillScan } from "../catalog-contracts";

export const isUnknown = (error: unknown) =>
  error instanceof SkillCatalogClientError && error.code === "unknown";
export const isForbidden = (error: unknown) =>
  error instanceof SkillCatalogClientError && error.code === "forbidden";
export const isRunning = (scan: ReviewSkillScan | undefined) =>
  scan?.status === "queued" || scan?.status === "running";

// Only status reads are safe to replay automatically; commands retain their intent.
export const retryScanRead = (failureCount: number, error: unknown) =>
  failureCount < 2 &&
  error instanceof SkillCatalogClientError &&
  (error.code === "unavailable" || error.code === "unknown");
