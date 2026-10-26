import type { ReviewSkillContent } from "./contracts";

export type SkillContentIssues = Partial<
  Record<keyof ReviewSkillContent, string>
>;
export type SkillImport = Readonly<{
  content: ReviewSkillContent;
  omittedFields: readonly ("license" | "compatibility" | "metadata")[];
}>;

const textEncoder = new TextEncoder();
export const skillImportByteLimit = 64 * 1024;
export const companionFilesMessage =
  "This file references companion files that the text editor cannot include. Keep the instructions self-contained, or use Git skills for supported Markdown links to .md references. Git skills do not run scripts or load arbitrary assets or HTML resources.";

function validText(value: string): boolean {
  return (
    !value.includes("\0") &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  );
}

/** App limits also accept old ReviewRouter exports with a blank description. */
export function skillContentIssues(
  content: ReviewSkillContent,
): SkillContentIssues {
  const issues: SkillContentIssues = {};
  if (!content.name.trim()) issues.name = "Enter a name for this skill.";
  else if (Array.from(content.name).length > 120)
    issues.name = "Use 120 characters or fewer for the name.";
  if (Array.from(content.description).length > 1024)
    issues.description = "Use 1024 characters or fewer for the description.";
  if (!content.instructions.trim())
    issues.instructions = "Add Markdown instructions for the review.";
  else if (textEncoder.encode(content.instructions).byteLength > 32768)
    issues.instructions =
      "Keep instructions within 32768 UTF-8 bytes (32 KiB).";
  for (const key of ["name", "description", "instructions"] as const)
    if (!validText(content[key]))
      issues[key] = "Remove null characters or invalid Unicode text.";
  return issues;
}

/** Ignore ordinary fenced, indented and inline code examples, without rendering
 * Markdown or interpreting prose/shell snippets as dependencies. */
function withoutCodeExamples(markdown: string): string {
  let fence: { character: string; length: number } | undefined;
  const listIndents: number[] = [];
  let paragraphOpen = false;
  let indentedCode = false;
  const blocks = markdown
    .split(/\r?\n/u)
    .map((originalLine) => {
      const line = originalLine.replace(/^ {0,3}(?:>[ \t]?)+/u, "");
      const indent = /^[ \t]*/u.exec(line)![0].replaceAll("\t", "    ").length;
      const baseIndent = listIndents.at(-1) ?? 0;
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(
        indent >= baseIndent ? line.slice(baseIndent) : line,
      );
      if (fence) {
        if (
          marker &&
          marker[1]![0] === fence.character &&
          marker[1]!.length >= fence.length &&
          !marker[2]!.trim()
        )
          fence = undefined;
        return "";
      }
      if (marker && !(marker[1]![0] === "`" && marker[2]!.includes("`"))) {
        fence = { character: marker[1]![0]!, length: marker[1]!.length };
        return "";
      }
      if (!line.trim()) {
        paragraphOpen = false;
        return "";
      }
      // Four spaces inside a list or a continued paragraph are not necessarily
      // code. Only an actual indented code block may hide resource references.
      while (
        listIndents.length &&
        indent < listIndents.at(-1)! &&
        !paragraphOpen
      )
        listIndents.pop();
      if (
        indent >= (listIndents.at(-1) ?? 0) + 4 &&
        (!paragraphOpen || indentedCode)
      ) {
        indentedCode = true;
        return "";
      }
      indentedCode = false;
      const list = /^( *)(?:[-+*]|\d+[.)])[ \t]+/u.exec(line);
      if (list) {
        while (listIndents.length && list[1]!.length < listIndents.at(-1)!)
          listIndents.pop();
        listIndents.push(list[0].length);
        const listFence = /^(`{3,}|~{3,})(.*)$/u.exec(
          line.slice(list[0].length),
        );
        if (
          listFence &&
          !(listFence[1]![0] === "`" && listFence[2]!.includes("`"))
        ) {
          fence = {
            character: listFence[1]![0]!,
            length: listFence[1]!.length,
          };
          paragraphOpen = false;
          return "";
        }
      }
      const prose = list ? line.slice(list[0].length) : line;
      paragraphOpen =
        !/^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-*_]\s*){3,}$|(?:=+|-+)\s*$)/u.test(
          prose,
        );
      // Inline code cannot cross a heading, thematic break or list item even
      // when the Markdown has no blank line between those blocks.
      return !paragraphOpen ? `\n${prose}\n` : list ? `\n${prose}` : prose;
    })
    .join("\n");
  const runs = [...blocks.matchAll(/`+/gu)];
  let result = "";
  let offset = 0;
  for (let index = 0; index < runs.length; index++) {
    const open = runs[index]!;
    const paragraphEnd = blocks.indexOf("\n\n", open.index);
    const closeIndex = runs.findIndex(
      (run, candidate) =>
        candidate > index &&
        run[0].length === open[0].length &&
        (paragraphEnd === -1 || run.index < paragraphEnd),
    );
    if (closeIndex === -1) continue;
    result += blocks.slice(offset, open.index);
    const close = runs[closeIndex]!;
    offset = close.index + close[0].length;
    index = closeIndex;
  }
  return (result + blocks.slice(offset)).replace(/\\[[\]<>!]/gu, " ");
}

function localDestination(raw: string): boolean {
  const value = raw.trim();
  const destination = value.startsWith("<")
    ? value.slice(1).split(">", 1)[0]!
    : value.split(/\s/u, 1)[0]!;
  if (!destination || destination.startsWith("#")) return false;
  if (destination.startsWith("//")) return false;
  if (/^(?:file:|[a-z]:[\\/])/iu.test(destination)) return true;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(destination);
}

/** Finite single-file eligibility check: inline links/images, used full,
 * collapsed or shortcut reference definitions, and HTML href/src attributes.
 * Bare prose paths and unused definitions are inert. This is not a resolver for
 * arbitrary Markdown extensions or dependencies mentioned in instructions. */
export function hasCompanionFiles(markdown: string): boolean {
  const text = withoutCodeExamples(markdown);
  const definitions = new Map<string, string>();
  // Reference IDs may wrap within a paragraph and contain at most 999 Unicode
  // characters. Link display text has no such limit and is scanned below.
  const labelCharacter = String.raw`(?:[^\[\]\n]|\n(?!\n))`;
  const normalize = (id: string) =>
    id.trim().replace(/\s+/gu, " ").toLowerCase();
  const uses = text.replace(
    new RegExp(
      String.raw`^ {0,3}\[(${labelCharacter}{1,999})\]:[ \t]*(?:\n[ \t]*)?(.+)$`,
      "gmu",
    ),
    (_match, id: string, destination: string) => {
      const key = normalize(id);
      if (key && !definitions.has(key)) definitions.set(key, destination);
      return "";
    },
  );
  const referenceLabel = new RegExp(
    String.raw`\[(${labelCharacter}{0,999})\]`,
    "uy",
  );
  const brackets: number[] = [];
  const masked: { start: number; end: number }[] = [];
  let noClosingParenthesis = false;
  // Visit closing brackets once, allowing long and nested display text. Skip
  // complete inline destinations so their URLs/titles cannot become shortcuts.
  for (let index = 0; index < uses.length; index++) {
    if (uses[index] === "\n" && uses[index - 1] === "\n") brackets.length = 0;
    if (uses[index] === "[") brackets.push(index);
    if (uses[index] !== "]") continue;
    const open = brackets.pop();
    if (open === undefined) continue;
    let end: number;
    if (uses[index + 1] === "(" && !noClosingParenthesis) {
      const close = uses.indexOf(")", index + 2);
      if (close === -1) {
        // Later candidates share this missing terminator; do not rescan it.
        noClosingParenthesis = true;
        continue;
      }
      if (localDestination(uses.slice(index + 2, close))) return true;
      end = close + 1;
    } else if (uses[index + 1] === "[") {
      referenceLabel.lastIndex = index + 1;
      const reference = referenceLabel.exec(uses);
      if (!reference) continue;
      end = referenceLabel.lastIndex;
      let id = reference[1]!;
      if (!id) {
        referenceLabel.lastIndex = open;
        const collapsed = referenceLabel.exec(uses);
        if (collapsed && referenceLabel.lastIndex === index + 1)
          id = collapsed[1]!;
      }
      const target = definitions.get(normalize(id));
      if (target && localDestination(target)) return true;
    } else continue;
    let start = uses[open - 1] === "!" ? open - 1 : open;
    // Nested spans end in scan order. Merge them without revisiting their text.
    while (masked.length && masked.at(-1)!.end >= start)
      start = Math.min(start, masked.pop()!.start);
    masked.push({ start, end });
    index = end - 1;
  }
  const referenceParts: string[] = [];
  let offset = 0;
  for (const span of masked) {
    referenceParts.push(uses.slice(offset, span.start), " ");
    offset = span.end;
  }
  referenceParts.push(uses.slice(offset));
  const referenceUses = referenceParts.join("");
  for (const match of referenceUses.matchAll(
    new RegExp(String.raw`\[(${labelCharacter}{1,999})\]`, "gu"),
  )) {
    const target = definitions.get(normalize(match[1]!));
    if (target && localDestination(target)) return true;
  }
  for (const tag of uses.matchAll(/<[a-z][^>]*>/giu)) {
    for (const attribute of tag[0].matchAll(
      /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu,
    ))
      if (localDestination(attribute[1] ?? attribute[2] ?? attribute[3] ?? ""))
        return true;
  }
  return false;
}

export async function parseSkillImport(text: string): Promise<SkillImport> {
  if (textEncoder.encode(text).byteLength > skillImportByteLimit)
    throw new Error(
      "SKILL.md must be 64 KiB or smaller; instructions are limited to 32 KiB.",
    );
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(text);
  if (!match)
    throw new Error(
      "Use SKILL.md with YAML name and description, followed by Markdown instructions.",
    );
  const { parseDocument, isAlias, isMap, isScalar, isSeq } =
    await import("yaml");
  const yaml = parseDocument(match[1]!, {
    schema: "failsafe",
    uniqueKeys: true,
  });
  const inspect = (node: unknown, depth = 0): void => {
    if (depth > 16) throw new Error("Keep the YAML header simple and shallow.");
    if (
      isAlias(node) ||
      (node && typeof node === "object" && "tag" in node && node.tag)
    )
      throw new Error("YAML aliases and explicit tags are unsupported.");
    if (isMap(node))
      for (const item of node.items) {
        if (!isScalar(item.key) || typeof item.key.value !== "string")
          throw new Error("YAML field names must be plain text.");
        if (item.key.value === "<<")
          throw new Error("YAML merge keys are unsupported.");
        inspect(item.key, depth + 1);
        inspect(item.value, depth + 1);
      }
    if (isSeq(node)) for (const item of node.items) inspect(item, depth + 1);
  };
  inspect(yaml.contents);
  if (!isMap(yaml.contents) || yaml.errors.length || yaml.warnings.length)
    throw new Error("The YAML header could not be imported safely.");
  const fields = yaml.toJS({ maxAliasCount: 0 }) as Record<string, unknown>;
  const optional = ["license", "compatibility", "metadata"] as const;
  if (
    Object.keys(fields).some(
      (key) => !["name", "description", ...optional].includes(key),
    )
  )
    throw new Error(
      "Unsupported frontmatter fields. This editor imports name, description and text instructions; tools, scripts and dependencies are not supported.",
    );
  if (typeof fields.name !== "string" || typeof fields.description !== "string")
    throw new Error("The YAML header needs text name and description fields.");
  for (const key of ["license", "compatibility"] as const)
    if (fields[key] !== undefined && typeof fields[key] !== "string")
      throw new Error(`The optional ${key} field must be text.`);
  if (
    fields.metadata !== undefined &&
    (!fields.metadata ||
      typeof fields.metadata !== "object" ||
      Array.isArray(fields.metadata) ||
      Object.values(fields.metadata).some((value) => typeof value !== "string"))
  )
    throw new Error(
      "Optional metadata must contain text keys and text values.",
    );
  const content = {
    name: fields.name,
    description: fields.description,
    instructions: match[2]!,
  };
  const issue = Object.values(skillContentIssues(content))[0];
  if (issue) throw new Error(issue);
  if (hasCompanionFiles(content.instructions))
    throw new Error(companionFilesMessage);
  return {
    content,
    omittedFields: optional.filter((field) => Object.hasOwn(fields, field)),
  };
}

export function portableSkillName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .slice(0, 64)
      .replace(/^-+|-+$/gu, "") || "review-skill"
  );
}

export function skillDownload(content: ReviewSkillContent): Readonly<{
  filename: "SKILL.md" | "SKILL.draft.md";
  text: string;
  portableName: string;
  exportDescription: string;
  usesFallbackDescription: boolean;
  issue?: string;
}> {
  const issue =
    Object.values(skillContentIssues(content))[0] ??
    (hasCompanionFiles(content.instructions)
      ? companionFilesMessage
      : undefined);
  const portableName = portableSkillName(content.name);
  const usesFallbackDescription = !content.description.trim();
  const exportDescription = usesFallbackDescription
    ? `Review guidance for ${content.name.trim() || "this skill"}.`
    : content.description;
  return {
    filename: issue ? "SKILL.draft.md" : "SKILL.md",
    text: `---\nname: ${JSON.stringify(issue ? content.name : portableName)}\ndescription: ${JSON.stringify(issue ? content.description : exportDescription)}\n---\n${content.instructions}`,
    portableName,
    exportDescription,
    usesFallbackDescription,
    ...(issue ? { issue } : {}),
  };
}
