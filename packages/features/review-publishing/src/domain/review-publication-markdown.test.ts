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
    expect(markdown).toContain("🟠 **1 major finding**");
    expect(markdown).toContain("<summary>Details</summary>");
    expect(markdown).toContain("The query no longer filters by email.");
    expect(markdown).toContain(
      `[src/auth.ts:44](<https://github.com/owner/repo/blob/${headSha}/src/auth.ts#L44>)`,
    );
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
    expect(markdown).toContain("**[major] Second**");
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

    expect(markdown).toContain("🔴 **1 critical замечание**");
    expect(markdown).toContain("<summary>Подробности</summary>");
    expect(markdown).toContain("Фильтр email больше не применяется.");
  });
});

function planWith(
  findings: readonly import("./review-publication").ReviewFinding[],
  provider: "github" | "gitlab" = "github",
) {
  return createReviewPublicationPlan({
    target: {
      provider,
      repositoryExternalId: "123",
      repositoryFullName: "owner/repo",
      changeRequestExternalId: "8",
      headSha,
      baseSha: "b".repeat(40),
    },
    marker: "reviewrouter:review:v1",
    findings,
  });
}
function finding(
  fingerprint: string,
  body = "Visible first paragraph.\n\nFull evidence stays here.",
  severity: "critical" | "major" | "minor" | "info" = "major",
) {
  return {
    fingerprint,
    severity,
    title: fingerprint,
    body,
    location: { filePath: "src/a b#c.ts", newLine: 4 },
  };
}

describe("compact summary contracts", () => {
  it("shows an excerpt only for 1-3 findings and retains full evidence in details", () => {
    const body =
      "A word ".repeat(60) +
      "\n\nEvidence with a fix: \n```ts\nconst secret = '<details>';\n```";
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith([finding("one", body)]),
    });
    const beforeDetails = markdown.split("<details>")[0]!;
    const excerpt = beforeDetails.trim().split("\n\n").at(-1)!.trim();
    expect(Array.from(excerpt).length).toBeLessThanOrEqual(320);
    expect(excerpt).toMatch(/(?:word|A)…$/);
    expect(beforeDetails).not.toContain("Evidence with a fix");
    expect(markdown).toContain("const secret = '<details>';");
    expect(markdown).toContain(`/blob/${headSha}/src/a%20b%23c.ts#L4`);
  });

  it.each([
    "```ts\nconst evidence = 42;\n```",
    "~~~ts\nconst evidence = 42;\n~~~",
    "<div>Detailed evidence</div>",
    "<!-- Detailed evidence -->",
    "## Detailed evidence",
    "> Detailed evidence",
    "- Detailed evidence",
    "1. Detailed evidence",
  ])(
    "keeps an interrupting Markdown block out of the first paragraph preview: %s",
    (block) => {
      const paragraph =
        "The authorization check is missing.\nOther users can read private data.";
      const body = `${paragraph}\n${block}`;
      const markdown = renderReviewSummaryMarkdown({
        plan: planWith([finding("one", body)]),
      });
      const preview = markdown
        .split("<details>")[0]!
        .trim()
        .split(/\n\n/)
        .at(-1)!;
      expect(preview).toBe(
        "The authorization check is missing. Other users can read private data.",
      );
      expect(markdown.split("<details>")[1]).toContain(paragraph);
      expect(markdown.split("<details>")[1]).toContain(
        block.includes("const evidence")
          ? "const evidence = 42;"
          : "Detailed evidence",
      );
    },
  );

  it.each([
    {
      language: "Chinese",
      body: "权限检查缺失导致其他用户能够读取私人数据。".repeat(30),
    },
    {
      language: "Japanese",
      body: "認証チェックが欠落しているため他の利用者の個人情報を読み取れます。".repeat(
        20,
      ),
    },
  ])(
    "truncates unspaced $language prose at a word boundary",
    ({ language, body }) => {
      const markdown = renderReviewSummaryMarkdown({
        plan: { ...planWith([finding("one", body)]), outputLanguage: language },
      });
      const preview = markdown
        .split("<details>")[0]!
        .trim()
        .split(/\n\n/)
        .at(-1)!;
      expect(preview.endsWith("…")).toBe(true);
      expect(Array.from(preview).length).toBeGreaterThan(250);
      expect(Array.from(preview).length).toBeLessThanOrEqual(320);
      const prefix = preview.slice(0, -1);
      expect(body.startsWith(prefix)).toBe(true);
      // Independent ICU segmentation confirms that the preview retains a full word.
      const endings = Array.from(
        new Intl.Segmenter(language === "Chinese" ? "zh" : "ja", {
          granularity: "word",
        }).segment(body),
      )
        .filter((segment) => segment.isWordLike)
        .map((segment) => segment.index + segment.segment.length);
      expect(endings).toContain(prefix.length);
      expect(markdown).toContain(body);
    },
  );

  it.each([
    "unbroken".repeat(60),
    `https://example.test/${"path".repeat(100)}`,
    `https://example.test/${"私人数据".repeat(100)}`,
    `www.example.test/${"認証情報".repeat(100)}`,
  ])("omits an oversized unspaced word or URL", (body) => {
    const markdown = renderReviewSummaryMarkdown({
      plan: { ...planWith([finding("one", body)]), outputLanguage: "Chinese" },
    });
    expect(markdown.split("<details>")[0]!.trim().split(/\n\n/)).toHaveLength(
      2,
    );
    expect(markdown).toContain(body);
  });

  it("retains complete CJK prose before an oversized URL token", () => {
    const body = `权限检查失败。https://example.test/${"私人数据".repeat(100)}`;
    const markdown = renderReviewSummaryMarkdown({
      plan: { ...planWith([finding("one", body)]), outputLanguage: "Chinese" },
    });
    const preview = markdown
      .split("<details>")[0]!
      .trim()
      .split(/\n\n/)
      .at(-1)!;
    expect(preview).toBe("权限检查失败…");
    expect(markdown).toContain(body);
  });

  it.each([
    "```ts\ncode\n```",
    "~~~\ncode\n~~~",
    "<table>html</table>",
    "A | B\n--- | ---\n1 | 2",
    "| A | B |\n| --- | --- |",
    "    indented code",
  ])(
    "does not invent a preview from a non-paragraph first block: %s",
    (body) => {
      const markdown = renderReviewSummaryMarkdown({
        plan: planWith([finding("one", body)]),
      });
      const preview = markdown.split("<details>")[0]!.trim();
      expect(preview.split(/\n\n/)).toHaveLength(2);
    },
  );

  it("uses severity then fingerprint order without losing same-location findings", () => {
    const findings = [
      {
        ...finding("z"),
        title: "z\n\n<injected>",
        location: { filePath: "src/one\r\n\r\n\ttwo.ts", newLine: 4 },
      },
      finding("c", "Critical evidence", "critical"),
      finding("a"),
      finding("b"),
    ];
    const markdown = renderReviewSummaryMarkdown({ plan: planWith(findings) });
    expect(markdown).toContain("**1 critical, 3 major findings**");
    expect(markdown.match(/<details>/g)).toHaveLength(4);
    expect(markdown.match(/<\/details>/g)).toHaveLength(4);
    expect(markdown.match(/<summary>[^\r\n]*<\/summary>/g)).toHaveLength(4);
    expect(markdown).toContain(
      "<summary>[major] z &lt;injected&gt; · src/one two.ts:4</summary>",
    );
    expect(markdown.indexOf("[critical] c")).toBeLessThan(
      markdown.indexOf("[major] a"),
    );
    expect(markdown.indexOf("[major] a")).toBeLessThan(
      markdown.indexOf("[major] b"),
    );
    expect(markdown.split("<details>")[0]).not.toContain("Critical evidence");
  });

  it("binds removed lines to base SHA and GitLab locations to the configured host", () => {
    const removed = {
      ...finding("removed"),
      location: { filePath: "src/old.ts", oldLine: 2 },
    };
    expect(
      renderReviewSummaryMarkdown({ plan: planWith([removed]) }),
    ).toContain(`/blob/${"b".repeat(40)}/src/old.ts#L2`);
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith([finding("one")], "gitlab"),
      sourceBaseUrl: "https://gitlab.example/team-root",
    });
    expect(markdown).toContain(
      `https://gitlab.example/team-root/owner/repo/-/blob/${headSha}/`,
    );
    expect(markdown).not.toContain("github.com");
  });

  it("preserves an incomplete warning while omitting whole oversized Unicode blocks", () => {
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith(
        Array.from({ length: 40 }, (_, i) =>
          finding(String(i), "```\n" + "🙂".repeat(3000)),
        ),
      ),
      reviewState: "incomplete",
    });
    expect(Buffer.byteLength(markdown)).toBeLessThanOrEqual(60_000);
    expect(markdown).toContain("Review incomplete");
    expect(markdown).toContain("omitted from this summary");
    expect(markdown).not.toContain("�");
    expect(markdown.match(/<details>/g)?.length).toBe(
      markdown.match(/<\/details>/g)?.length,
    );
    expect((markdown.match(/^```$/gm)?.length ?? 0) % 2).toBe(0);
  });

  it("escapes hostile titles, paths and invalid code fences without swallowing later findings", () => {
    const malicious = {
      ...finding("one", "```bad`\n</details><img src=x onerror=alert(1)>"),
      title: "</summary><script>alert(1)</script>",
      location: { filePath: "src/<img>.ts", newLine: 4 },
    };
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith([malicious, finding("two")]),
    });
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("<img src=x");
    expect(markdown).toContain("**[major] two**");
    expect(markdown.match(/<details>/g)).toHaveLength(2);
  });

  it.each(["```html", "~~~html"])(
    "escapes dedented HTML after a list-contained fence: %s",
    (opener) => {
      const delimiter = opener.slice(0, 3);
      const body = [
        "- Fix the template:",
        `  ${opener}`,
        "  <safe-code>",
        "",
        "</details>",
        "<img src=x onerror=alert(1)>",
        `  ${delimiter}`,
      ].join("\n");
      const markdown = renderReviewSummaryMarkdown({
        plan: planWith([finding("one", body)]),
      });
      expect(markdown.match(/<details>/g)).toHaveLength(1);
      expect(markdown.match(/<\/details>/g)).toHaveLength(1);
      expect(markdown).not.toContain("<img src=x");
      expect(markdown).toContain(
        "&lt;/details&gt;\n&lt;img src=x onerror=alert(1)&gt;",
      );
      expect(markdown).toContain(
        `  <safe-code>\n\n  ${delimiter}\n&lt;/details&gt;`,
      );
    },
  );

  it.each([
    { list: true, closingIndent: 4 },
    { list: false, closingIndent: 4 },
    { list: true, closingIndent: 0 },
    { list: false, closingIndent: 0 },
  ])(
    "contains HTML and retains prose after a fence closer (list: $list, indent: $closingIndent)",
    ({ list, closingIndent }) => {
      const body = [
        ...(list ? ["- Fix the template:"] : []),
        "  ```html",
        "  <safe-code>",
        `${" ".repeat(closingIndent)}\`\`\``,
        "  `Promise<void>` and `a && b` remain prose.",
        "  <img src=x onerror=alert(1)>",
        "  </details>",
      ].join("\n");
      const markdown = renderReviewSummaryMarkdown({
        plan: planWith([finding("one", body), finding("two")]),
      });
      expect(markdown).not.toContain("<img src=x");
      expect(markdown).toContain(
        "  <safe-code>\n  ```\n  `Promise<void>` and `a && b` remain prose.\n  &lt;img src=x onerror=alert(1)&gt;",
      );
      expect(markdown.match(/<details>/g)).toHaveLength(2);
      expect(markdown.match(/<\/details>/g)).toHaveLength(2);
      expect(markdown).toContain("**[major] two**");
      expect(markdown.match(/^ {0,3}```/gm)).toHaveLength(2);
    },
  );

  it("keeps fence info validation and inline source intact at an indented fence boundary", () => {
    const body = [
      "  ```ts",
      "  const template = '<safe-code>';",
      "`Promise<void>` and `a && b`.",
      "```bad`",
      "</summary><img src=x>",
    ].join("\n");
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith([finding("one", body)]),
    });
    const details = markdown.split("<details>")[1]!;
    expect(details).toContain(
      "  const template = '<safe-code>';\n  ```\n`Promise<void>` and `a && b`.",
    );
    expect(details).toContain("&lt;/summary&gt;&lt;img src=x&gt;");
    expect(details).not.toContain("<img src=x>");
    expect(markdown.match(/<summary>/g)).toHaveLength(1);
  });

  it("preserves matched inline code while escaping unmatched and escaped backticks with hostile HTML", () => {
    const body = [
      "Use `Promise<void>` and `a && b`, or `` `nested<type>` ``.",
      "Unmatched ` <img src=x onerror=alert(1)>",
      "Escaped \\`<script>alert(1)</script>\\` remains prose.",
      "Protected `</details><summary>trap</summary>` stays inert.",
    ].join("\n");
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith([finding("one", body)]),
    });
    const details = markdown.split("<details>")[1]!;
    expect(details).toContain("`Promise<void>` and `a && b`");
    expect(details).toContain("`` `nested<type>` ``");
    expect(details).toContain("Unmatched ` &lt;img src=x onerror=alert(1)&gt;");
    expect(details).toContain("\\`&lt;script&gt;alert(1)&lt;/script&gt;\\`");
    expect(details).toContain(
      "`&lt;/details&gt;&lt;summary&gt;trap&lt;/summary&gt;`",
    );
    expect(markdown.match(/<details>/g)).toHaveLength(1);
    expect(markdown.match(/<\/details>/g)).toHaveLength(1);
  });

  it("preserves literal path characters with a backtick-safe fallback code delimiter", () => {
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith(
        [
          {
            ...finding("one"),
            location: { filePath: "src/`a``<b>&.ts", newLine: 4 },
          },
        ],
        "gitlab",
      ),
    });
    expect(markdown).toContain("``` src/`a``<b>&.ts:4 ```");
    expect(markdown).not.toContain("&#96;");
    expect(markdown).not.toContain("src/`a``&lt;b&gt;&amp;.ts");
  });

  it("keeps clean text neutral when completeness is unknown", () => {
    const markdown = renderReviewSummaryMarkdown({ plan: planWith([]) });
    expect(markdown).toContain("**No findings**");
    expect(markdown).not.toMatch(/all.clear|complete|picture/i);
  });

  it("renders HTTPS auto-theme images with only a width-based compact source", () => {
    const markdown = renderReviewSummaryMarkdown({
      plan: planWith([finding("private-name")]),
      bannerBaseUrl: "https://public.example/",
      reviewState: "complete",
    });
    expect(markdown).toContain("<picture>");
    expect(markdown).toContain(
      '<source media="(max-width: 600px)" srcset="https://public.example/review-banner/v1.svg?state=complete&amp;variant=first&amp;critical=0&amp;major=1&amp;minor=0&amp;info=0&amp;theme=auto&amp;layout=compact">',
    );
    expect(markdown).toContain(
      '<img src="https://public.example/review-banner/v1.svg?',
    );
    expect(markdown.split("<picture>")[1]!.split("</picture>")[0]).not.toMatch(
      /private-name|owner|repo|src%|headSha/,
    );
    expect(markdown).toContain("**1 major finding**");
    expect(markdown).toContain('width="100%"');
    expect(markdown).toContain('alt="Review complete"');
    expect(markdown).toContain("(max-width: 600px)");
    expect(markdown).toContain("layout=compact");
    expect(markdown).toContain("theme=auto&amp;layout=wide");
    expect(markdown.match(/<source /g)).toHaveLength(1);
    expect(markdown).not.toMatch(/prefers-color-scheme|theme=dark|theme=light/);
    expect(markdown).not.toContain('height="110"');
    expect(markdown).not.toContain('alt="ReviewRouter"');
  });

  it.each([
    "http://public.example",
    "https://user:password@public.example",
    "https://public.example/?private=x",
    "https://public.example/#private",
  ])("omits invalid banner bases: %s", (bannerBaseUrl) => {
    expect(
      renderReviewSummaryMarkdown({
        plan: planWith([]),
        bannerBaseUrl,
        reviewState: "complete",
      }),
    ).not.toContain("<picture>");
  });

  it("omits images for unknown completeness, GitLab and excessive counts", () => {
    const bannerBaseUrl = "https://public.example";
    expect(
      renderReviewSummaryMarkdown({ plan: planWith([]), bannerBaseUrl }),
    ).not.toContain("<picture>");
    expect(
      renderReviewSummaryMarkdown({
        plan: planWith([], "gitlab"),
        bannerBaseUrl,
        reviewState: "complete",
      }),
    ).not.toContain("<picture>");
    expect(
      renderReviewSummaryMarkdown({
        plan: planWith(
          Array.from({ length: 10_000 }, (_, i) => finding(String(i))),
        ),
        bannerBaseUrl,
        reviewState: "complete",
      }),
    ).not.toContain("<picture>");
  });
});
