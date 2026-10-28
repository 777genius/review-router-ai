import type { GeneratedPrDescription } from "@reviewrouter/shared";

/** The marker is shared with the original Action publisher for continuity. */
export const reviewPrDescriptionStartMarker =
  "<!-- review-router-summary:start -->";
export const reviewPrDescriptionEndMarker =
  "<!-- review-router-summary:end -->";

export type ReviewPrDescriptionSource = GeneratedPrDescription;

export function renderReviewPrDescription(markdown: string): string {
  if (
    markdown.trim().length === 0 ||
    /<!--\s*\/?(?:review-router-summary|ai-robot-review-summary)\b/i.test(
      markdown,
    )
  ) {
    throw new Error("publication_pr_description_markdown_invalid");
  }
  return `${reviewPrDescriptionStartMarker}\n${markdown}\n${reviewPrDescriptionEndMarker}`;
}

/** Refuse ambiguous ownership rather than removing author text. */
export function readReviewPrDescriptionBlock(body: string): string | null {
  const start = body.indexOf(reviewPrDescriptionStartMarker);
  const end = body.indexOf(reviewPrDescriptionEndMarker);
  if (start === -1 && end === -1) return null;
  if (
    start === -1 ||
    end < start ||
    body.indexOf(reviewPrDescriptionStartMarker, start + 1) !== -1 ||
    body.indexOf(reviewPrDescriptionEndMarker, end + 1) !== -1
  ) {
    throw new Error("publication_pr_description_marker_conflict");
  }
  return body.slice(start, end + reviewPrDescriptionEndMarker.length);
}

export function mergeReviewPrDescription(body: string, block: string): string {
  if (readReviewPrDescriptionBlock(block) !== block) {
    throw new Error("publication_pr_description_block_invalid");
  }
  const existing = readReviewPrDescriptionBlock(body);
  if (existing === null)
    return `${body}${body.length > 0 ? "\n\n" : ""}${block}`;
  const start = body.indexOf(reviewPrDescriptionStartMarker);
  return body.slice(0, start) + block + body.slice(start + existing.length);
}
