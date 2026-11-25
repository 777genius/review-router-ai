import { parseSync } from "oxc-parser";

export type PublicModuleSurface = {
  names: string[];
  leadingComments: Record<string, string[]>;
};

// The pilot's governed subjects expose named exports. Keep documentation
// attached to each export; source offsets and printer indentation may differ.
export function publicModuleSurface(
  filename: string,
  source: string,
): PublicModuleSurface {
  const parsed = parseSync(filename, source, { sourceType: "module" });
  if (parsed.errors.length > 0) {
    throw new Error(`compiler_surface_parse_failed: ${filename}`);
  }
  const names: string[] = [];
  const leadingComments = new Map<string, string[]>();
  for (const declaration of parsed.module.staticExports) {
    const comments: string[] = [];
    let cursor = declaration.start;
    for (const comment of [...parsed.comments].reverse()) {
      if (comment.end > cursor) continue;
      if (source.slice(comment.end, cursor).trim() !== "") break;
      comments.unshift(
        comment.type +
          ":" +
          comment.value
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .join("\n"),
      );
      cursor = comment.start;
    }
    for (const entry of declaration.entries) {
      const name = entry.exportName.name;
      if (entry.exportName.kind !== "Name" || name === null) {
        throw new Error(`compiler_surface_requires_named_exports: ${filename}`);
      }
      if (leadingComments.has(name)) {
        throw new Error(`compiler_surface_duplicate_export: ${name}`);
      }
      names.push(name);
      leadingComments.set(name, comments);
    }
  }
  return {
    names: names.sort(),
    leadingComments: Object.fromEntries(
      [...leadingComments].sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}
