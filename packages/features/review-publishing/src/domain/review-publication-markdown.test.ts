import { describe, expect, it } from "vitest";
import { createReviewPublicationPlan } from "./review-publication";
import { renderReviewSummaryMarkdown } from "./review-publication-markdown";

const headSha = "a".repeat(40);

describe("review summary markdown", () => {
  it("puts each finding in an expandable block with the full body", () => {
    const markdown = renderReviewSummaryMarkdown({
      plan: createReviewPublicationPlan({
        target: {
          provider: "github",
          repositoryExternalId: "123",
          repositoryFullName: "owner/repo",
          changeRequestExternalId: "8",
          headSha,
        },
        marker: "reviewrouter:review:v1",
        findings: [
          {
            fingerprint: "finding-1",
            severity: "major",
            title: "Auth bypass",
            body: "The query no longer filters by email.",
            location: { filePath: "src/auth.ts", newLine: 44 },
          },
        ],
      }),
    });

    expect(markdown).toContain("<!-- reviewrouter:review:v1 summary -->");
    expect(markdown).toContain("## 1 finding (1 major)");
    expect(markdown).toContain(
      "<summary>major · src/auth.ts:44 · Auth bypass</summary>",
    );
    expect(markdown).toContain("The query no longer filters by email.");
    expect(markdown).toContain("**Location:** `src/auth.ts:44`");
    expect(markdown).not.toContain("# ReviewRouter");
  });

  it("uses the configured review language for summary chrome", () => {
    const markdown = renderReviewSummaryMarkdown({
      plan: createReviewPublicationPlan({
        target: {
          provider: "gitlab",
          repositoryExternalId: "123",
          repositoryFullName: "group/project",
          changeRequestExternalId: "7",
          headSha,
          baseSha: "b".repeat(40),
          startSha: "c".repeat(40),
        },
        marker: "reviewrouter:review:v1",
        outputLanguage: "Russian",
        findings: [
          {
            fingerprint: "finding-1",
            severity: "critical",
            title: "Обход аутентификации",
            body: "Фильтр email больше не применяется.",
            location: { filePath: "src/auth.ts", newLine: 44 },
          },
        ],
      }),
    });

    expect(markdown).toContain("## 1 замечание (1 critical)");
    expect(markdown).toContain("**Место:**");
    expect(markdown).toContain("Фильтр email больше не применяется.");
  });
});
