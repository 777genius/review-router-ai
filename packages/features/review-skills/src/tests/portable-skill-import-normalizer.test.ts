import { describe, expect, it } from "vitest";
import { PortableSkillImportNormalizer } from "../infrastructure/serialization/portable-skill-import-normalizer.js";
import { parseSkillImport } from "../portable.js";

const normalizer = new PortableSkillImportNormalizer();

describe("catalog import serialization", () => {
  it("checks the actual saved fields and exact body, without export name/fallback transformations", async () => {
    const raw =
      '---\nname: "  My skill ☃  "\ndescription: ""\nlicense: MIT\n---\n# Checks\r\n\r\nPreserve café and \\"quoted\\" text.\r\n';
    const result = await normalizer.normalize(raw);
    if (result.status !== "supported") throw new Error(result.reason);
    const normalized = result.value;
    expect(normalized.omittedFields).toEqual(["license"]);
    expect(normalized.content.name).toBe("My skill ☃");
    expect(normalized.content.description).toBe("");
    expect(normalized.content.instructions).toBe(raw.split("---\n").at(-1));
    expect((await parseSkillImport(normalized.canonicalText)).content).toEqual(
      normalized.content,
    );
    expect(normalized.canonicalText).not.toContain("license");
  });

  it("accepts agent settings and linked files as plain text instructions", async () => {
    const raw =
      "---\nname: test\ndescription: test\nallowed-tools: Read\n---\nRead [rules](rules.md#a).";
    const result = await normalizer.normalize(raw);
    expect(result).toMatchObject({
      status: "supported",
      value: {
        omittedFields: ["allowed-tools"],
        content: { instructions: "Read [rules](rules.md#a)." },
      },
    });
  });

  it("returns a typed reason instead of throwing for content that cannot be text", async () => {
    await expect(
      normalizer.normalize(
        `---\nname: test\ndescription: test\n---\n${"x".repeat(32 * 1024 + 1)}`,
      ),
    ).resolves.toEqual({ status: "unsupported", reason: "too_large" });
    await expect(normalizer.normalize("# No header")).resolves.toEqual({
      status: "unsupported",
      reason: "invalid_header",
    });
    await expect(
      normalizer.normalize("---\nname: test\ndescription: test\n---\n   "),
    ).resolves.toEqual({ status: "unsupported", reason: "invalid_content" });
  });
});
