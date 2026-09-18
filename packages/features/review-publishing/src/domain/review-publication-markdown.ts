import type {
  ReviewFinding,
  ReviewPublicationPlan,
} from "./review-publication";
import { renderFindingsSummaryMarkdown } from "./review-publication-summary";

const maxPublicationBodyBytes = 60_000;

export function reviewSummaryMarker(marker: string): string {
  return `<!-- ${marker} summary -->`;
}

export function reviewFindingMarker(input: {
  readonly marker: string;
  readonly fingerprint: string;
}): string {
  return `<!-- ${input.marker} finding=${input.fingerprint} -->`;
}

export function renderReviewSummaryMarkdown(input: {
  readonly plan: ReviewPublicationPlan;
}): string {
  return limitUtf8(
    [
      reviewSummaryMarker(input.plan.marker),
      renderFindingsSummaryMarkdown({
        language: input.plan.outputLanguage,
        findings: input.plan.findings,
      }),
    ].join("\n"),
    maxPublicationBodyBytes,
  );
}

export function renderReviewFindingMarkdown(input: {
  readonly plan: ReviewPublicationPlan;
  readonly finding: ReviewFinding;
}): string {
  return limitUtf8(
    [
      reviewFindingMarker({
        marker: input.plan.marker,
        fingerprint: input.finding.fingerprint,
      }),
      `**[${input.finding.severity}] ${input.finding.title}**`,
      "",
      input.finding.body,
    ].join("\n"),
    maxPublicationBodyBytes,
  );
}

function limitUtf8(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return `${buffer.subarray(0, maxBytes - 20).toString("utf8")}\n\n[truncated]`;
}
