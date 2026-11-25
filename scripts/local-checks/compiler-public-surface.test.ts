import { describe, expect, it } from "vitest";
import { publicModuleSurface } from "./compiler-public-surface.ts";

describe("compiler pilot public module surface", () => {
  const source = `
/** First public contract. */
export type First = string | number;
/** Second public contract. */
export const second = 1;
`;

  it("retains explicit exports and documentation across declaration syntax", () => {
    const expected = {
      names: ["First", "second"],
      leadingComments: {
        First: ["Block:* First public contract."],
        second: ["Block:* Second public contract."],
      },
    };
    const emitted = source.replace("export const", "export declare const");
    expect(publicModuleSurface("source.ts", source)).toEqual(expected);
    expect(publicModuleSurface("source.d.ts", emitted)).toEqual(expected);
  });

  it("detects a dropped export or changed export name", () => {
    const baseline = publicModuleSurface("source.ts", source);
    expect(
      publicModuleSurface(
        "source.d.ts",
        source.replace("export const second", "declare const second"),
      ).names,
    ).not.toEqual(baseline.names);
    expect(
      publicModuleSurface("source.d.ts", source.replace("second", "renamed"))
        .names,
    ).not.toEqual(baseline.names);
  });

  it("detects lost documentation and documentation attached to another export", () => {
    const baseline = publicModuleSurface("source.ts", source);
    expect(
      publicModuleSurface(
        "source.d.ts",
        source.replace("/** First public contract. */", ""),
      ).leadingComments,
    ).not.toEqual(baseline.leadingComments);
    expect(
      publicModuleSurface(
        "source.d.ts",
        source
          .replace("First public", "Second public")
          .replace(
            "Second public contract. */\nexport const",
            "First public contract. */\nexport const",
          ),
      ).leadingComments,
    ).not.toEqual(baseline.leadingComments);
  });

  it("ignores comments in function bodies and preserves leading line comments", () => {
    expect(
      publicModuleSurface(
        "source.ts",
        "// Public\nexport function run() { /* private */ return 1; }",
      ),
    ).toEqual({ names: ["run"], leadingComments: { run: ["Line:Public"] } });
  });

  it("preserves an export whose name is an object prototype property", () => {
    const result = publicModuleSurface(
      "source.ts",
      "// Ordinary name\nexport const __proto__ = 1;",
    );
    expect(result.names).toEqual(["__proto__"]);
    expect(Object.hasOwn(result.leadingComments, "__proto__")).toBe(true);
    expect(result.leadingComments["__proto__"]).toEqual(["Line:Ordinary name"]);
  });

  it.each([
    "export default 1;",
    'export * from "dependency";',
    "export const broken: = 1;",
  ])("rejects unsupported or malformed surface: %s", (input) => {
    expect(() => publicModuleSurface("source.ts", input)).toThrow();
  });
});
