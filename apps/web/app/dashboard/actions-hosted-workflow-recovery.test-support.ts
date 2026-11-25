import { transformSync } from "esbuild";
import { parseSync } from "oxc-parser";

// This test seam selects real production declarations without importing the
// account, credential or KMS construction code in their containing modules.
export function compileProductionDeclarations(
  source: string,
  names: readonly string[],
): string {
  const parsed = parseSync("production.ts", source, {
    lang: "ts",
    sourceType: "module",
  });
  if (parsed.errors.length > 0) {
    throw new Error(
      "production_declarations_parse_failed: " +
        parsed.errors.map((error) => error.message).join("; "),
    );
  }
  const requested = new Set(names);
  const declarations = parsed.program.body
    .flatMap((statement) => {
      const declaration =
        statement.type === "ExportNamedDeclaration" ||
        statement.type === "ExportDefaultDeclaration"
          ? statement.declaration
          : statement;
      if (
        !declaration ||
        (declaration.type !== "FunctionDeclaration" &&
          declaration.type !== "ClassDeclaration") ||
        !declaration.id ||
        !requested.has(declaration.id.name)
      ) {
        return [];
      }
      // Keep the containing export, if present, so module and strict-mode
      // behavior are retained by the ordinary CommonJS transform.
      return [source.slice(statement.start, statement.end)];
    })
    .join("\n");
  return transformSync(declarations, {
    sourcefile: "production-declarations.ts",
    loader: "ts",
    format: "cjs",
    target: "es2022",
    treeShaking: false,
    tsconfigRaw: {
      compilerOptions: { alwaysStrict: true, useDefineForClassFields: true },
    },
  }).code;
}
