import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isSyntaxNode,
  parseSourceAst,
  walkSourceAst,
  type ParsedSource,
  type SyntaxNode,
} from "../lib/module-import-specifiers.ts";
import { collectAllSourceFiles } from "./sources.ts";
import type { ArchitectureViolation } from "./types.ts";

export async function checkPrismaTransactionQuerySerialization(
  root: string,
  violations: ArchitectureViolation[],
): Promise<void> {
  const sourceRoots = [join(root, "apps"), join(root, "packages")].filter(
    (directory) => existsSync(directory),
  );
  const sourceFiles = (
    await Promise.all(
      sourceRoots.map((directory) => collectAllSourceFiles(directory)),
    )
  ).flat();
  for (const file of sourceFiles) {
    const repositoryPath = relative(root, file).replaceAll("\\", "/");
    if (
      repositoryPath.includes("/tests/") ||
      repositoryPath.endsWith(".test.ts") ||
      repositoryPath.endsWith(".test.tsx")
    ) {
      continue;
    }
    const source = readFileSync(file, "utf8");
    const sourceFile = parseSourceAst(file, source);
    const aliases = concurrentPrismaTransactionAliases(sourceFile);
    if (aliases.length > 0) {
      violations.push({
        file,
        imported: `Promise.all(${aliases.join("|")}.*)`,
        reason:
          "Prisma interactive transaction clients use one database connection; issue their queries sequentially",
      });
    }
  }
}

function concurrentPrismaTransactionAliases(parsed: ParsedSource): string[] {
  const transactionCallbackNames = new Set<string>();
  walkSourceAst(parsed.root, (node) => {
    if (!isPrismaTransactionCall(node)) return;
    const callback = firstArgument(node);
    if (callback?.type === "Identifier" && typeof callback.name === "string")
      transactionCallbackNames.add(callback.name);
  });

  const unsafeAliases = new Set<string>();
  walkSourceAst(parsed.root, (node, parent) => {
    if (!isFunctionNode(node) || !isSyntaxNode(node.body)) return;
    const aliases = transactionAliasesForFunction(
      node,
      parent,
      parsed.source,
      transactionCallbackNames,
    );
    if (aliases.size === 0) return;
    collectDirectAliases(node.body, aliases);
    const bindings = variableInitializers(node.body);
    walkSourceAst(node.body, (candidate) => {
      if (!isPromiseAllCall(candidate)) return;
      const input = firstArgument(candidate);
      for (const alias of aliases) {
        if (
          input &&
          nodeOrBoundInitializerReferencesIdentifier(
            input,
            alias,
            bindings,
            new Set(),
          )
        )
          unsafeAliases.add(alias);
      }
    });
  });
  return [...unsafeAliases].sort();
}

function isFunctionNode(node: SyntaxNode): boolean {
  return [
    "FunctionDeclaration",
    "FunctionExpression",
    "ArrowFunctionExpression",
  ].includes(node.type);
}

function transactionAliasesForFunction(
  node: SyntaxNode,
  parent: SyntaxNode | null,
  source: string,
  transactionCallbackNames: ReadonlySet<string>,
): Set<string> {
  const aliases = new Set<string>();
  const bindingName = functionBindingName(node, parent);
  const namedCallback =
    bindingName !== null && transactionCallbackNames.has(bindingName);
  const inlineCallback =
    parent?.type === "CallExpression" &&
    firstArgument(parent) === node &&
    isPrismaTransactionCall(parent);
  const parameters: unknown[] = Array.isArray(node.params) ? node.params : [];
  for (const [index, originalParameter] of parameters.entries()) {
    if (!isSyntaxNode(originalParameter)) continue;
    let parameter = originalParameter;
    let annotation = parameterAnnotation(parameter);
    // Oxc represents defaults, rest parameters and constructor properties as
    // wrappers. Preserve the former compiler's identifier-parameter coverage.
    while (
      parameter.type === "AssignmentPattern" ||
      parameter.type === "RestElement" ||
      parameter.type === "TSParameterProperty"
    ) {
      const unwrapped =
        parameter.type === "AssignmentPattern"
          ? parameter.left
          : parameter.type === "RestElement"
            ? parameter.argument
            : parameter.parameter;
      if (!isSyntaxNode(unwrapped)) break;
      parameter = unwrapped;
      annotation ??= parameterAnnotation(parameter);
    }
    if (parameter.type !== "Identifier" || typeof parameter.name !== "string")
      continue;
    const type =
      annotation &&
      typeof annotation.start === "number" &&
      typeof annotation.end === "number"
        ? source.slice(annotation.start, annotation.end)
        : "";
    if (
      parameter.name === "transaction" ||
      /(?:^|\.)TransactionClient\b/u.test(type) ||
      (index === 0 && (inlineCallback || namedCallback))
    )
      aliases.add(parameter.name);
  }
  return aliases;
}

function parameterAnnotation(parameter: SyntaxNode): SyntaxNode | null {
  const wrapper = parameter.typeAnnotation;
  return isSyntaxNode(wrapper) && isSyntaxNode(wrapper.typeAnnotation)
    ? wrapper.typeAnnotation
    : null;
}

function functionBindingName(
  node: SyntaxNode,
  parent: SyntaxNode | null,
): string | null {
  if (
    isSyntaxNode(node.id) &&
    node.id.type === "Identifier" &&
    typeof node.id.name === "string"
  )
    return node.id.name;
  const method =
    (parent?.type === "MethodDefinition" && parent.kind !== "constructor") ||
    (parent?.type === "Property" &&
      (parent.method || parent.kind === "get" || parent.kind === "set"));
  if (
    method &&
    parent &&
    parent.value === node &&
    !parent.computed &&
    isSyntaxNode(parent.key) &&
    parent.key.type === "Identifier" &&
    typeof parent.key.name === "string"
  )
    return parent.key.name;
  if (
    parent?.type === "VariableDeclarator" &&
    parent.init === node &&
    isSyntaxNode(parent.id) &&
    parent.id.type === "Identifier" &&
    typeof parent.id.name === "string"
  )
    return parent.id.name;
  return null;
}

function collectDirectAliases(node: SyntaxNode, aliases: Set<string>): void {
  let changed = true;
  while (changed) {
    changed = false;
    walkSourceAst(node, (candidate) => {
      if (
        candidate.type !== "VariableDeclarator" ||
        !isSyntaxNode(candidate.id) ||
        candidate.id.type !== "Identifier" ||
        typeof candidate.id.name !== "string" ||
        !isSyntaxNode(candidate.init) ||
        candidate.init.type !== "Identifier" ||
        typeof candidate.init.name !== "string" ||
        !aliases.has(candidate.init.name) ||
        aliases.has(candidate.id.name)
      )
        return;
      aliases.add(candidate.id.name);
      changed = true;
    });
  }
}

function firstArgument(node: SyntaxNode): SyntaxNode | null {
  const args: unknown[] = Array.isArray(node.arguments) ? node.arguments : [];
  return isSyntaxNode(args[0]) ? args[0] : null;
}

function calleeMember(node: SyntaxNode): SyntaxNode | null {
  if (node.type !== "CallExpression" || !isSyntaxNode(node.callee)) return null;
  const callee =
    node.callee.type === "ChainExpression"
      ? node.callee.expression
      : node.callee;
  return isSyntaxNode(callee) ? callee : null;
}

function isPrismaTransactionCall(node: SyntaxNode): boolean {
  const callee = calleeMember(node);
  return (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    isSyntaxNode(callee.property) &&
    callee.property.type === "Identifier" &&
    callee.property.name === "$transaction"
  );
}

function isPromiseAllCall(node: SyntaxNode): boolean {
  const callee = calleeMember(node);
  return (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    isSyntaxNode(callee.object) &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Promise" &&
    isSyntaxNode(callee.property) &&
    callee.property.type === "Identifier" &&
    callee.property.name === "all" &&
    Array.isArray(node.arguments) &&
    node.arguments.length > 0
  );
}

function variableInitializers(node: SyntaxNode): Map<string, SyntaxNode> {
  const bindings = new Map<string, SyntaxNode>();
  walkSourceAst(node, (candidate) => {
    if (
      candidate.type === "VariableDeclarator" &&
      isSyntaxNode(candidate.id) &&
      candidate.id.type === "Identifier" &&
      typeof candidate.id.name === "string" &&
      isSyntaxNode(candidate.init)
    )
      bindings.set(candidate.id.name, candidate.init);
  });
  return bindings;
}

function nodeOrBoundInitializerReferencesIdentifier(
  node: SyntaxNode,
  identifier: string,
  bindings: ReadonlyMap<string, SyntaxNode>,
  visitedBindings: Set<string>,
): boolean {
  if (nodeReferencesIdentifier(node, identifier)) return true;
  if (
    node.type !== "Identifier" ||
    typeof node.name !== "string" ||
    visitedBindings.has(node.name)
  )
    return false;
  const initializer = bindings.get(node.name);
  if (!initializer) return false;
  visitedBindings.add(node.name);
  return nodeOrBoundInitializerReferencesIdentifier(
    initializer,
    identifier,
    bindings,
    visitedBindings,
  );
}

function nodeReferencesIdentifier(
  node: SyntaxNode,
  identifier: string,
): boolean {
  let found = false;
  walkSourceAst(node, (candidate) => {
    if (candidate.type === "Identifier" && candidate.name === identifier)
      found = true;
  });
  return found;
}
