/**
 * The runtime stamps every summary with `reviewrouter:summary:v2:<revision>`.
 * The revision part changes on every push, so the full marker identifies one
 * reviewed revision, while the marker family identifies the one summary
 * comment a pull request keeps across revisions.
 */
const reviewSummaryMarkerBody = "reviewrouter:summary:v2:[a-f0-9]{64}";
const exactReviewSummaryMarker = new RegExp(`^${reviewSummaryMarkerBody}$`, "u");
const embeddedReviewSummaryMarker = new RegExp(
  `(?<!\\S)${reviewSummaryMarkerBody}(?=$|[ \\t\\r\\n])`,
  "u",
);

export function isReviewSummaryMarker(marker: string): boolean {
  return exactReviewSummaryMarker.test(marker);
}

export function containsReviewSummaryMarker(body: string): boolean {
  return embeddedReviewSummaryMarker.test(body);
}
