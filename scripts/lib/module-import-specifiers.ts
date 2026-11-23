import { parseSync } from "oxc-parser";

export type SyntaxNode = Readonly<{ type: string; [key: string]: unknown }>;
export type ParsedSource = Readonly<{
  root: SyntaxNode;
  errors: readonly string[];
  source: string;
}>;

function syntaxNode(value: unknown): value is SyntaxNode {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/**
 * Parse TypeScript syntax without initializing the removed TS6 compiler API.
 * Effective typechecking stays with the native TypeScript >=7 compiler.
 */
export function parseSourceAst(filename: string, source: string): ParsedSource {
  const result = parseSync(filename, source, { preserveParens: false });
  return {
    root: result.program as unknown as SyntaxNode,
    errors: result.errors.map((error) => error.message),
    source,
  };
}

export function walkSourceAst(
  root: SyntaxNode,
  visitor: (node: SyntaxNode, parent: SyntaxNode | null) => void,
): void {
  const visited = new WeakSet<object>();
  const walk = (node: SyntaxNode, parent: SyntaxNode | null): void => {
    if (visited.has(node)) return;
    visited.add(node);
    visitor(node, parent);
    for (const [key, value] of Object.entries(node)) {
      if (key === "parent" || key === "comments" || key === "tokens") continue;
      if (syntaxNode(value)) {
        walk(value, node);
      } else if (Array.isArray(value)) {
        for (const child of value) if (syntaxNode(child)) walk(child, node);
      }
    }
  };
  walk(root, null);
}

function moduleString(node: unknown): string {
  if (!syntaxNode(node)) return "computed module import";
  if (
    (node.type === "Literal" || node.type === "StringLiteral") &&
    typeof node.value === "string"
  )
    return node.value;
  if (node.type === "TSLiteralType") return moduleString(node.literal);
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) &&
    node.expressions.length === 0 &&
    Array.isArray(node.quasis)
  ) {
    const first: unknown = node.quasis[0];
    if (
      syntaxNode(first) &&
      first.value !== null &&
      typeof first.value === "object"
    ) {
      const cooked = (first.value as { cooked?: unknown }).cooked;
      if (typeof cooked === "string") return cooked;
    }
  }
  return "computed module import";
}

/** Includes type-only, dynamic, and computed references. Unknown targets deny. */
export function collectModuleImportSpecifiers(
  parsed: ParsedSource,
): ReadonlySet<string> {
  const specifiers = new Set<string>();
  if (parsed.errors.length) specifiers.add("computed module import");
  walkSourceAst(parsed.root, (node) => {
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration":
        if (node.source) specifiers.add(moduleString(node.source));
        break;
      case "TSImportType":
        specifiers.add(moduleString(node.argument));
        break;
      case "TSImportEqualsDeclaration":
        if (
          syntaxNode(node.moduleReference) &&
          node.moduleReference.type === "TSExternalModuleReference"
        )
          specifiers.add(moduleString(node.moduleReference.expression));
        break;
      case "ImportExpression":
        specifiers.add(moduleString(node.source));
        break;
      case "CallExpression": {
        const callee = node.callee;
        if (
          syntaxNode(callee) &&
          (callee.type === "Import" ||
            (callee.type === "Identifier" && callee.name === "require"))
        ) {
          const args = Array.isArray(node.arguments) ? node.arguments : [];
          specifiers.add(moduleString(args[0]));
        }
        break;
      }
    }
  });
  return specifiers;
}
