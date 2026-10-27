import { describe, expect, it } from "vitest";
import {
  hasCompanionFiles,
  parseSkillImport,
  portableSkillName,
  skillContentIssues,
  skillDownload,
} from "./portable-skill";

const content = {
  name: "Readable review guidance",
  description: "Check ownership boundaries.",
  instructions: "\n## Review\n\n  Keep whitespace.  \n\n",
};
const file = (body = content.instructions, header = "") =>
  `---\nname: ${JSON.stringify(content.name)}\ndescription: ${JSON.stringify(content.description)}\n${header}---\n${body}`;

describe("single-file Skills portability", () => {
  it("imports legacy names and blank descriptions without rewriting the draft", async () => {
    const legacy = { ...content, name: "Проверка API 🙂", description: "" };
    const parsed = await parseSkillImport(
      `---\nname: ${JSON.stringify(legacy.name)}\ndescription: ""\n---\n${legacy.instructions}`,
    );
    expect(parsed).toEqual({ content: legacy, omittedFields: [] });
    const download = skillDownload(legacy);
    expect(download.portableName).toBe("api");
    expect(download.usesFallbackDescription).toBe(true);
    expect(download.exportDescription).toBe(
      "Review guidance for Проверка API 🙂.",
    );
    expect((await parseSkillImport(download.text)).content).toEqual({
      ...legacy,
      name: "api",
      description: download.exportDescription,
    });
    expect(legacy.description).toBe("");
  });

  it("reports actual optional fields for an explicit omission acknowledgment", async () => {
    const parsed = await parseSkillImport(
      file(
        undefined,
        "license: MIT\ncompatibility: ReviewRouter\nmetadata:\n  author: example\n",
      ),
    );
    expect(parsed.omittedFields).toEqual([
      "license",
      "compatibility",
      "metadata",
    ]);
    expect(parsed.content).toEqual(content);
    expect(
      await parseSkillImport(file(undefined, 'license: ""\n')),
    ).toMatchObject({
      omittedFields: ["license"],
    });
  });

  it.each([
    "allowed-tools: Bash\n",
    "tools: [Bash]\n",
    "scripts: run.sh\n",
    "dependencies: package\n",
    "custom: value\n",
  ])("refuses unsupported frontmatter %s", async (header) => {
    await expect(parseSkillImport(file(undefined, header))).rejects.toThrow(
      "Unsupported frontmatter",
    );
  });

  it.each([
    "name: &value example\ndescription: *value",
    "name: !!str example\ndescription: text",
    "name: example\ndescription: text\n<<: {license: MIT}",
    "name: example\nname: duplicate\ndescription: text",
    "name: example\ndescription: text\nmetadata: [a, b]",
    "name: example\ndescription: text\nmetadata:\n  nested: {a: b}",
  ])(
    "rejects unsafe or unsupported YAML without returning a draft",
    async (header) => {
      await expect(
        parseSkillImport(`---\n${header}\n---\nReview.`),
      ).rejects.toThrow();
    },
  );

  it("bounds file and app content sizes before import", async () => {
    await expect(parseSkillImport("x".repeat(64 * 1024 + 1))).rejects.toThrow(
      "64 KiB",
    );
    await expect(parseSkillImport(file("x".repeat(32769)))).rejects.toThrow(
      "32768 UTF-8 bytes",
    );
    await expect(parseSkillImport(file("\0"))).rejects.toThrow(
      "null characters",
    );
    await expect(parseSkillImport(file(" \n"))).rejects.toThrow("Add Markdown");
    expect(
      skillContentIssues({ ...content, name: "x".repeat(121) }),
    ).toHaveProperty("name");
    expect(
      skillContentIssues({ ...content, description: "x".repeat(1025) }),
    ).toHaveProperty("description");
  });

  it.each([
    "[Guide](references/guide.md)",
    "[A [nested] label](<references/guide.md>)",
    '![Diagram](assets/diagram.png "Architecture")',
    "[Guide][rules]\n\n[rules]: references/guide.md",
    "[See the [guide] section](https://example.test)\n\n[guide]: references/guide.md",
    "[See [guide] here][remote]\n\n[guide]: references/guide.md\n[remote]: https://example.test",
    "<bad [guide]>\n\n[guide]: references/guide.md",
    '<a title="x > [guide]" href="references/guide.md">Guide</a>',
    '[outer <span title="[guide]\n\n">here</span>](https://example.test)\n\n[guide]: references/guide.md',
    "[Guide][]\n\n[Guide]: references/guide.md",
    "![Diagram]\n\n[Diagram]: assets/diagram.png",
    '<a href="references/guide.md">Guide</a>',
    "<img src='assets/diagram.png'>",
    "<img src=assets/diagram.png>",
    "[Local](file:///tmp/guide.md)",
    "[Windows](C:\\guide.md)",
    "[Root](/guide.md)",
    "- Read this:\n    [Guide](references/guide.md)",
    "A continued paragraph\n    [Guide](references/guide.md)",
    "- Outer\n  - Inner\n      [Guide](references/guide.md)",
    "[Guide](\nreferences/guide.md\n)",
    "[Guide]\n\n[Guide]:\n  references/guide.md",
    "[Guide]\n\n[Guide]:\nreferences/guide.md",
    "> [Guide][rules]\n>\n> [rules]: references/guide.md",
    "> ```md\n> code\n\n[Guide](references/guide.md)",
    "> ```md\n> code\n[Guide](references/guide.md)",
    "> > ```md\n> > code\n> [Guide](references/guide.md)",
    "> ```md\n\n> [Guide](references/guide.md)",
    "- ```md\n  code\n\n[Guide](references/guide.md)",
    "- ```md\n  code\n- [Guide](references/guide.md)",
    "1. ```md\n   code\n2. [Guide](references/guide.md)",
    "- Outer\n  - ```md\n    code\n  [Guide](references/guide.md)",
    "> - ```md\n>   code\n> - [Guide](references/guide.md)",
    "- Outer\n  > ```md\n  > code\n> [Guide](references/guide.md)",
    "Unclosed `example.\n\nRead [Guide](references/guide.md).\n\nAnother `example.",
    "Unclosed `example.\n# Review\nRead [Guide](references/guide.md).\nAnother `example.",
    "- `first item\n- [Guide](references/guide.md)\n- `third item",
    "Literal \\` marker [Guide](references/guide.md) then \\` marker.",
    "Literal \\` marker [Guide](references/guide.md) then ` marker.",
    "Literal \\\\\\` marker [Guide](references/guide.md) then ` marker.",
    "Literal \\``[Guide](references/guide.md)``.",
    "`code\\` [Guide](references/guide.md) then `.",
    "-\t```md\n  [Guide](references/guide.md)",
    "-\t```md\n \t```\n[Guide](references/guide.md)",
    "  -\t```md\n \t```\n[Guide](references/guide.md)",
    "- > ```md\n  > code\n[Guide](references/guide.md)",
    "- > ```md\n  > code\n  > ```\n  > [Guide](references/guide.md)",
    "> - > ```md\n>   > code\n> [Guide](references/guide.md)",
    " > - > ```md\n >   > code\n >   > ```\n[Guide](references/guide.md)",
    "10. > ```md\n    > code\n    > ```\n    > [Guide](references/guide.md)",
    "- outer\n  - > ```md\n    > code\n  [Guide](references/guide.md)",
    "- - ```md\n    code\n  [Guide](references/guide.md)",
    "- > - ```md\n  >   code\n  > - [Guide](references/guide.md)",
    "- >   ```md\n  > code\n  >   ```\n  > [Guide](references/guide.md)",
    "1234567890. ```md\n            [Guide](references/guide.md)",
    "- 1234567890. ```md\n              [Guide](references/guide.md)",
    "Review guidance.\n2. ```md\n   [Guide](references/guide.md)",
    "- Review guidance.\n  2. ```md\n     [Guide](references/guide.md)",
    "> - Review guidance.\n>   2. ```md\n>      [Guide](references/guide.md)",
    "- > Review guidance.\n  > 2. ```md\n  >    [Guide](references/guide.md)",
    "> - > Review guidance.\n>   > 2. ```md\n>   >    [Guide](references/guide.md)",
    "\\\\[Guide](references/guide.md)",
    "\\\\\\\\[Guide](references/guide.md)",
    "\\\\[Guide]\n\n[Guide]: references/guide.md",
    '\\\\<img src="assets/diagram.png">',
    "See the [reference\nguide](references/guide.md)",
    "![architecture\ndiagram](assets/architecture.png)",
    "[reference\nguide][rules]\n\n[rules]: references/guide.md",
    "[guide][review\nrules]\n\n[review rules]: references/guide.md",
    "[review\nrules][]\n\n[review rules]: references/guide.md",
    "[review\nrules]\n\n[review rules]: references/guide.md",
    "[guide][review rules]\n\n[review\nrules]: references/guide.md",
  ])(
    "rejects actual companion references and offers draft-only export: %s",
    async (instructions) => {
      expect(hasCompanionFiles(instructions)).toBe(true);
      await expect(parseSkillImport(file(instructions))).rejects.toThrow(
        "companion files",
      );
      const download = skillDownload({ ...content, instructions });
      expect(download.filename).toBe("SKILL.draft.md");
      expect(download.issue).toContain("companion files");
      expect(download.text.endsWith(instructions)).toBe(true);
    },
  );

  it.each([
    "[Web](https://example.test/guide.md)",
    "![Diagram](//example.test/diagram.png)",
    "[Section](#review)",
    '<a href="https://example.test/guide.md">Web</a><img src="#inline">',
    "[Unused]: references/guide.md\n\nSelf-contained instructions.",
    "[local][remote]\n\n[local]: references/unused.md\n[remote]: https://example.test",
    "[See [guide] here](https://example.test)\n\n[guide]: https://example.test/guide.md",
    "[See [guide] here][remote]\n\n[guide]: https://example.test/guide.md\n[remote]: https://example.test",
    "[See [unknown] here](https://example.test)\n\n[guide]: references/unused.md",
    "[See [unknown] here][remote]\n\n[guide]: references/unused.md\n[remote]: https://example.test",
    '[See <span title="[guide]">here</span>](https://example.test)\n\n[guide]: references/unused.md',
    "[See <span title='[guide]'>here</span>][remote]\n\n[guide]: references/unused.md\n[remote]: https://example.test",
    '[See <span title="x > [guide]">here</span>](https://example.test)\n\n[guide]: references/unused.md',
    "[See <span title='x > [guide]'>here</span>][remote]\n\n[guide]: references/unused.md\n[remote]: https://example.test",
    '[outer <span title="[guide]\n">here</span>](https://example.test)\n\n[guide]: references/unused.md',
    "`[Example](references/guide.md)`",
    "`[Example]\n(references/guide.md)`",
    "- `[Example]\n  (references/guide.md)`",
    "# `[Example](references/guide.md)`\nSelf-contained instructions.",
    "> [Unused]:\n> references/guide.md\n>\n> Self-contained instructions.",
    "``[Example](references/guide.md) `code` ``",
    "```md\n[Example](references/guide.md)\n```",
    "~~~~md\n[Example](references/guide.md)\n~~~\n[Still code](references/guide.md)\n~~~~",
    "    [Example](references/guide.md)\n\t<img src=example.png>",
    "- A list with an indented code example:\n\n      [Example](references/guide.md)",
    "> ```md\n> [Example](references/guide.md)\n> ```",
    "# Example\n    [Guide](references/guide.md)",
    "- ```md\n  [Example](references/guide.md)\n  ```",
    "- ```md\n  code\n\n  [Example](references/guide.md)",
    "> ```md\n>\n> [Example](references/guide.md)",
    "```md\n> ```\n[Example](references/guide.md)",
    "> ```md\n> > ```\n> [Example](references/guide.md)\n> ```",
    "  ```md\n[Example](references/guide.md)",
    "  > ```md\n> [Example](references/guide.md)",
    "- prose\n```md\n[Example](references/guide.md)",
    "- Outer\n  > ```md\n  > [Example](references/guide.md)",
    "\\[Escaped](references/guide.md)",
    "Literal \\\\`[Example](references/guide.md)`.",
    "Literal \\\\\\\\`[Example](references/guide.md)`.",
    "Literal \\``[Example](references/guide.md)`.",
    "Literal \\```[Example](references/guide.md)``.",
    "`[Example](references/guide.md)\\`",
    "-\t```md\n\t[Example](references/guide.md)\n\t```",
    "  -\t```md\n \t[Example](references/guide.md)\n \t```",
    "   -\t```md\n\t\t[Example](references/guide.md)\n\t\t```",
    "- > ```md\n  > [Example](references/guide.md)\n  > ```",
    "> - > ```md\n>   > [Example](references/guide.md)\n>   > ```",
    " > - > ```md\n >   > [Example](references/guide.md)\n >   > ```",
    "10. > ```md\n    > [Example](references/guide.md)\n    > ```",
    "- outer\n  - > ```md\n    > [Example](references/guide.md)\n    > ```",
    "- - ```md\n    [Example](references/guide.md)\n    ```",
    "- > - ```md\n  >   [Example](references/guide.md)\n  >   ```",
    "- >   ```md\n  > [Example](references/guide.md)\n  >   ```",
    "123456789. ```md\n           [Example](references/guide.md)\n           ```",
    "- 123456789. ```md\n             [Example](references/guide.md)\n             ```",
    "Review guidance.\n1. ```md\n   [Example](references/guide.md)",
    "1. Review guidance.\n2. ```md\n   [Example](references/guide.md)",
    "1. Review guidance.\n2) ```md\n   [Example](references/guide.md)",
    "1. Review guidance.\n  2. ```md\n     [Example](references/guide.md)",
    "- Review guidance.\n  1. ```md\n     [Example](references/guide.md)",
    "Review guidance.\n> 2. ```md\n>    [Example](references/guide.md)",
    "> Review guidance.\n2. ```md\n   [Example](references/guide.md)",
    "- > Review guidance.\n  > 1. ```md\n  >    [Example](references/guide.md)",
    "> - > Review guidance.\n>   > 1. ```md\n>   >    [Example](references/guide.md)",
    "\\\\\\[Escaped](references/guide.md)",
    "\\\\\\\\\\[Escaped](references/guide.md)",
    '\\\\\\<img src="assets/diagram.png">',
    "Run scripts/check.sh as a manual example.\nUse references/guide.md as example prose.",
    "[review\nguide](https://example.test)\n\n[review guide]: references/unused.md",
    "[review\nguide][remote]\n\n[review guide]: references/unused.md\n[remote]: https://example.test",
    "Literal [open\n\nclose](references/guide.md)",
    "Literal [open\n \t\nclose](references/guide.md)",
    "[open\n```\nexample\n```\nclose](references/guide.md)",
    "```md\n[reference\nguide](references/guide.md)\n```",
  ])(
    "keeps inert examples and external references importable: %s",
    async (instructions) => {
      expect(hasCompanionFiles(instructions)).toBe(false);
      const imported = await parseSkillImport(file(instructions));
      const download = skillDownload(imported.content);
      expect(download.filename).toBe("SKILL.md");
      expect((await parseSkillImport(download.text)).content.instructions).toBe(
        instructions,
      );
    },
  );

  it.each([999, 1000])(
    "honors the reference label boundary at %s Unicode characters",
    (length) => {
      const label = "🙂".repeat(length);
      for (const use of [
        `[guide][${label}]`,
        `[${label}][]`,
        `[${label}]`,
        `[See [${label}] here](https://example.test)`,
        `[See [${label}] here][remote]`,
      ]) {
        expect(
          hasCompanionFiles(
            `${use}\n\n[${label}]: references/guide.md\n[remote]: https://example.test`,
          ),
        ).toBe(length === 999);
      }
    },
  );

  it("retains local and remote destinations with long link text", () => {
    const label = "guide ".repeat(200);
    for (const destination of ["references/guide.md", "https://example.test"]) {
      expect(hasCompanionFiles(`[${label}](${destination})`)).toBe(
        destination.startsWith("references/"),
      );
      expect(
        hasCompanionFiles(`[${label}][guide]\n\n[guide]: ${destination}`),
      ).toBe(destination.startsWith("references/"));
    }
  });

  it.each([
    {
      part: "inline URL",
      link: `[${"guide ".repeat(200)}](https://example.test/[local])`,
    },
    {
      part: "inline title",
      link: `[${"guide ".repeat(200)}](https://example.test "[local]")`,
    },
    {
      part: "full reference display",
      link: `[${"guide ".repeat(200)} <span title="[local]">guide</span>][remote]`,
    },
  ])(
    "keeps reference-like text in a long external link's $part inert",
    ({ link }) => {
      const definitions =
        "\n\n[remote]: https://example.test\n[local]: references/guide.md";
      expect(hasCompanionFiles(`${link}${definitions}`)).toBe(false);
      expect(hasCompanionFiles(`${link}\n\n[local]${definitions}`)).toBe(true);
    },
  );

  it("preserves a maximum-size unmatched-label draft and still detects a following resource", async () => {
    const instructions = "[\n".repeat(16_384);
    expect(hasCompanionFiles(instructions)).toBe(false);
    expect(
      (await parseSkillImport(file(instructions))).content.instructions,
    ).toBe(instructions);
    const download = skillDownload({ ...content, instructions });
    expect(download.filename).toBe("SKILL.md");
    expect(download.text.split("\n---\n")[1]).toBe(instructions);
    expect(
      hasCompanionFiles(
        `${instructions.slice(0, 32_000)}\n[guide]\n\n[guide]: references/guide.md`,
      ),
    ).toBe(true);
  });

  it("exports the exact visible 32 KiB body with an intentionally portable header", async () => {
    const prefix = "    Indented example.\r\n\n## Review\n";
    const suffix = "  \n\n";
    const instructions =
      prefix + "x".repeat(32768 - Buffer.byteLength(prefix + suffix)) + suffix;
    const maximum = { ...content, instructions };
    const downloaded = skillDownload(maximum);
    expect(downloaded.filename).toBe("SKILL.md");
    expect(downloaded.text.split("\n---\n")[1]).toBe(instructions);
    expect((await parseSkillImport(downloaded.text)).content).toEqual({
      ...maximum,
      name: "readable-review-guidance",
    });
  });

  it("derives bounded names and labels incomplete recovery as a draft", () => {
    for (const name of [
      "---A___B---",
      "éclair",
      "界🙂",
      "a".repeat(63) + "  trailing",
      "a".repeat(200),
    ]) {
      const slug = portableSkillName(name);
      expect(slug.length).toBeLessThanOrEqual(64);
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    }
    expect(portableSkillName("界🙂")).toBe("review-skill");
    const incomplete = {
      name: "",
      description: "",
      instructions: "Unfinished draft.",
    };
    expect(skillDownload(incomplete)).toMatchObject({
      filename: "SKILL.draft.md",
      issue: "Enter a name for this skill.",
      text: '---\nname: ""\ndescription: ""\n---\nUnfinished draft.',
    });
  });
});
