import { describe, expect, it } from "vitest";
import { PortableSkillImportNormalizer } from "../infrastructure/serialization/portable-skill-import-normalizer.js";
import { parseSkillImport } from "../portable.js";

describe("catalog import serialization", () => {
  it("checks the actual saved fields and exact body, without export name/fallback transformations", async () => {
    const raw =
      '---\nname: "  My skill ☃  "\ndescription: ""\nlicense: MIT\n---\n# Checks\r\n\r\nPreserve café and \\"quoted\\" text.\r\n';
    const normalized = await new PortableSkillImportNormalizer().normalize(raw);
    expect(normalized.omittedFields).toEqual(["license"]);
    expect(normalized.content.name).toBe("My skill ☃");
    expect(normalized.content.description).toBe("");
    expect(normalized.content.instructions).toBe(raw.split("---\n").at(-1));
    expect((await parseSkillImport(normalized.canonicalText)).content).toEqual(
      normalized.content,
    );
    expect(normalized.canonicalText).not.toContain("license");
  });

  it("refuses referenced companion content at the shared parser boundary", async () => {
    await expect(
      new PortableSkillImportNormalizer().normalize(
        "---\nname: test\ndescription: test\n---\nRead [rules](rules.md).",
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});
