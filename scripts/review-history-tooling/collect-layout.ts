import { collectFeatureLayout } from "../lib/collect-feature-layout.js";

export const sourceRoot = "packages/features/review-history/src";
export const collectHistoryLayout = (root: string) =>
  collectFeatureLayout(root, sourceRoot, "review-history");
