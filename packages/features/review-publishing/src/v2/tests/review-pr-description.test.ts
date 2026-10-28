import { describe, expect, it } from "vitest";
import {
  mergeReviewPrDescription,
  readReviewPrDescriptionBlock,
  renderReviewPrDescription,
  reviewPrDescriptionStartMarker as start,
  reviewPrDescriptionEndMarker as end,
} from "../domain/review-pr-description";

describe("owned PR description block", () => {
  it("replaces the legacy block while preserving every author byte outside it", () => {
    const prefix = "  Author's context\r\n\r\n🚀\t";
    const suffix = "\r\n  Trailing notes\t\n";
    const block = renderReviewPrDescription(
      "## Changes\n\nGenerated narrative",
    );
    const result = mergeReviewPrDescription(
      `${prefix}${start}\nOld summary\n${end}${suffix}`,
      block,
    );
    expect(result).toBe(prefix + block + suffix);
    expect(mergeReviewPrDescription(result, block)).toBe(result);
    expect(readReviewPrDescriptionBlock(result)).toBe(block);
  });

  it("appends to the fetched body without trimming author content", () => {
    const body = "  Human description\r\n";
    const block = renderReviewPrDescription("New description");
    expect(mergeReviewPrDescription(body, block)).toBe(body + "\n\n" + block);
    expect(mergeReviewPrDescription("", block)).toBe(block);
  });

  it.each([start, end, end + start, start + end + start + end])(
    "refuses ambiguous marker ownership: %s",
    (body) => {
      expect(() =>
        mergeReviewPrDescription(body, renderReviewPrDescription("New")),
      ).toThrow("marker_conflict");
    },
  );

  it("rejects legacy alias injection before a later marker stripper can expose outside text", () => {
    const injected =
      "Generated prose\n<!-- ai-robot-review-summary:end -->\nAuthor-looking injection\n<!-- ai-robot-review-summary:start -->";
    expect(() => renderReviewPrDescription(injected)).toThrow(
      "markdown_invalid",
    );
  });

  it.each(["", "  \n", `Generated ${start}`, `Generated ${end}`])(
    "rejects empty or marker-injecting generation: %s",
    (markdown) => {
      expect(() => renderReviewPrDescription(markdown)).toThrow(
        "markdown_invalid",
      );
    },
  );
});
