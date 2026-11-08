import { describe, expect, it } from "vitest";
import {
  isSuggestFixCommand,
  renderFocusedSuggestion,
} from "../domain/focused-suggestion.js";
import type { FocusedFindingSource } from "../domain/conversation.js";

const head = "a".repeat(40);
const source: FocusedFindingSource = {
  headSha: head,
  blobOid: "b".repeat(40),
  path: "src/a.ts",
  originalLine: 1,
  content: "const x = 2;\nconst y = 3;\n",
  patch: "@@ -1,2 +1,2 @@\n-const x = 1;\n+const x = 2;\n const y = 3;",
};
const output = (options: Record<string, unknown> = {}) =>
  JSON.stringify({
    startLine: 1,
    endLine: 1,
    before: "const x = 2;",
    replacement: "const x = 4;",
    ...options,
  });
describe("suggest fix command", () => {
  it.each([
    "/rr suggest fix",
    "@review-router-ai suggest fix",
    "Предложи исправление",
  ])("recognizes only exact requests: %s", (text) =>
    expect(isSuggestFixCommand(text)).toBe(true),
  );
  it.each([
    "Explain this",
    "/rr fix",
    "/rr suggest fix\n/rr review",
    "/rr suggest fix model=other",
    "suggest fix in code",
  ])("ignores ambiguous requests: %s", (text) => {
    expect(isSuggestFixCommand(text)).toBe(false);
  });
});
describe("single-finding safe suggestion", () => {
  it("emits one GitHub suggestion for a current one-line RIGHT-side hunk", () => {
    const result = renderFocusedSuggestion(output(), source, head, head);
    expect(result).toContain("Suggested fix");
    expect(result).toContain("suggestion\nconst x = 4;");
    expect(result).toContain("Apply this suggestion manually");
  });
  it("does not fabricate a multiline GitHub Apply suggestion from a single-line parent anchor", () => {
    const result = renderFocusedSuggestion(
      output({
        endLine: 2,
        before: "const x = 2;\nconst y = 3;",
        replacement: "const x = 4;\nconst y = 5;",
      }),
      source,
      head,
      head,
    );
    expect(result).toContain("Cannot suggest a safe fix");
  });
  it("can replace one anchored line with bounded multi-line content", () => {
    const result = renderFocusedSuggestion(
      output({
        replacement: "if (true) {\n  const x = 4;\n}",
      }),
      source,
      head,
      head,
    );
    expect(result).toContain("suggestion\nif (true)");
  });
  it.each([
    ["no source", output(), null, head, head],
    ["stale PR", output(), source, "c".repeat(40), head],
    ["outdated finding", output(), source, head, "c".repeat(40)],
    ["wrong original", output({ before: "const x = 1;" }), source, head, head],
    [
      "out of range",
      output({ startLine: 20, endLine: 20 }),
      source,
      head,
      head,
    ],
    [
      "cross hunk",
      output({ endLine: 2, before: "const x = 2;\nconst y = 3;" }),
      {
        ...source,
        patch: "@@ -1 +1 @@\n+const x = 2;\n@@ -2 +2 @@\n+const y = 3;",
      },
      head,
      head,
    ],
    ["no diff", output(), { ...source, patch: null }, head, head],
    ["no replacement", output({ replacement: " " }), source, head, head],
    [
      "control character",
      output({ replacement: "const x = 4;\u0000" }),
      source,
      head,
      head,
    ],
    [
      "excessive code",
      output({ replacement: "const x = 4;\n".repeat(51) }),
      source,
      head,
      head,
    ],
    ["unstructured", "Please just change the line.", source, head, head],
  ] as const)(
    "refuses unsupported or unsafe %s",
    (_, payload, current, atHead, anchorHead) => {
      const result = renderFocusedSuggestion(
        payload,
        current,
        atHead,
        anchorHead,
      );
      expect(result).toContain("Cannot suggest a safe fix");
      expect(result).not.toContain("suggestion\n");
    },
  );
});
