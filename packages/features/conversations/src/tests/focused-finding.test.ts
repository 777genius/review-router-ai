import { describe, expect, it } from "vitest";
import {
  isFixedFindingCommand,
  renderFixedFindingAnswer,
} from "../domain/focused-finding.js";
import type { FocusedFindingSource } from "../domain/conversation.js";

const head = "a".repeat(40);
const source: FocusedFindingSource = {
  headSha: head,
  path: "src/ids.ts",
  blobOid: "b".repeat(40),
  content: "export function validateId(id: string) {\n  return id.length > 0;\n}\n",
  patch: "@@ -1,2 +1,3 @@\n+export function validateId(id: string) {\n+  return id.length > 0;\n+}\n",
  originalLine: 2,
};
const answer = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    verdict: "fixed",
    confidence: 0.98,
    scopeSufficient: true,
    reason: "The new length check now prevents an empty identifier from passing validation.",
    evidence: [{ line: 2, quote: "return id.length > 0;" }],
    ...overrides,
  });

describe("focused finding intent", () => {
  it.each(["/rr fixed", " @review-router-ai fixed ", "@reviewrouter fixed", "Исправил, проверь"])(
    "accepts only an exact inline intent: %s",
    (value) => expect(isFixedFindingCommand(value)).toBe(true),
  );
  it.each([
    "/rr fixed full", "/rr fixed\n/rr skip", "> /rr fixed",
    "This quotes /rr fixed", "not /rr fixed", "/rr fix",
    "исправил логику, проверь", "/rr fixed --path=secrets.txt",
  ])("rejects embedded or unauthorized options: %s", (value) => {
    expect(isFixedFindingCommand(value)).toBe(false);
  });
});
describe("focused finding response (no model authority)", () => {
  it("reports fixed only with accepted current source", () => {
    const result = renderFixedFindingAnswer(answer(), source, head);
    expect(result).toContain("Fixed (revalidated)");
    expect(result).toContain("src/ids.ts:2");
    expect(result).toContain("was not resolved");
  });
  it("reports a still-present finding with strong evidence", () => {
    const result = renderFixedFindingAnswer(answer({
      verdict: "still_present",
      confidence: 0.88,
      reason: "The comparison still accepts invalid identifiers because length is not checked.",
    }), source, head);
    expect(result).toContain("Still present (revalidated)");
  });
  it.each([
    ["missing source", answer(), null, head],
    ["stale head", answer(), source, "c".repeat(40)],
    ["weak confidence", answer({ confidence: 0.5 }), source, head],
    ["no scope", answer({ scopeSufficient: false }), source, head],
    ["wrong citation", answer({ evidence: [{ line: 2, quote: "return true;" }] }), source, head],
    ["bad line", answer({ evidence: [{ line: 200, quote: "return id.length > 0;" }] }), source, head],
    ["no evidence", answer({ evidence: [] }), source, head],
    ["partial result", JSON.stringify({ verdict: "fixed", reason: "yes" }), source, head],
    ["invalid text", "The finding is fixed.", source, head],
    ["model-command payload", answer({ action: { kind: "create" } }), source, head],
    ["absence claim", answer({ verdict: "cannot_verify" }), source, head],
  ] as const)("fails closed on %s", (_, value, checked, atHead) => {
    expect(renderFixedFindingAnswer(value, checked, atHead)).toContain("Cannot verify");
  });
});
