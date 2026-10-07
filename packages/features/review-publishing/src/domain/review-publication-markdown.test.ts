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

  it("neutralizes nested details markup so later findings stay visible", () => {
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
            title: "First",
            body: "hello <details><summary>trap</summary> hidden </details> more",
            location: { filePath: "a.ts", newLine: 1 },
          },
          {
            fingerprint: "finding-2",
            severity: "major",
            title: "Second",
            body: "still visible",
            location: { filePath: "b.ts", newLine: 2 },
          },
        ],
      }),
    });

    expect(markdown).toContain(
      "&lt;details&gt;&lt;summary&gt;trap&lt;/summary&gt;",
    );
    expect(markdown).toContain("<summary>major · b.ts:2 · Second</summary>");
    expect(markdown).toContain("still visible");
    expect(markdown.match(/<details>/g)?.length).toBe(
      markdown.match(/<\/details>/g)?.length,
    );
  });

  it("keeps the summary marker from truncating the last details block", () => {
    const findings = Array.from({ length: 40 }, (_, index) => ({
      fingerprint: `finding-${index + 1}`,
      severity: "minor" as const,
      title: `Finding ${index + 1}`,
      body: "x".repeat(2_400),
      location: { filePath: `src/f${index + 1}.ts`, newLine: index + 1 },
    }));
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
        findings,
      }),
    });

    expect(Buffer.byteLength(markdown, "utf8")).toBeLessThanOrEqual(60_000);
    expect(markdown.match(/<details>/g)?.length ?? 0).toBe(
      markdown.match(/<\/details>/g)?.length ?? 0,
    );
    expect(markdown.startsWith("<!-- reviewrouter:review:v1 summary -->")).toBe(
      true,
    );
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
