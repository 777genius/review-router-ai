import assert from "node:assert/strict";
import { test } from "vitest";
import {
  collectModuleImportSpecifiers,
  parseSourceAst,
} from "./module-import-specifiers.ts";

test.each([
  'import "permitted-contract";',
  'import type { Contract } from "permitted-contract";',
  'export type { Contract } from "permitted-contract";',
  'export * from "permitted-contract";',
  'type Contract = import("permitted-contract").Contract;',
  'type ContractModule = typeof import("permitted-contract");',
  'import Contract = require("permitted-contract");',
  'const load = () => import("permitted-contract");',
  "const load = () => import(`permitted-contract`);",
  'const contract = require("permitted-contract");',
])("native import collector resolves the exact module in %s", (source) => {
  const parsed = parseSourceAst("subject.ts", source);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    [...collectModuleImportSpecifiers(parsed)],
    ["permitted-contract"],
  );
});

test("native import collector preserves the rejection marker for unknown targets", () => {
  const parsed = parseSourceAst(
    "subject.ts",
    "const load = (target: string) => import(target);",
  );
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    [...collectModuleImportSpecifiers(parsed)],
    ["computed module import"],
  );
});

test("native import collector keeps malformed source rejected", () => {
  const parsed = parseSourceAst("subject.ts", 'import { from "broken";');
  assert(parsed.errors.length > 0);
  assert(collectModuleImportSpecifiers(parsed).has("computed module import"));
});

test("native import collector ignores comments, prose and type member names", () => {
  const parsed = parseSourceAst(
    "subject.ts",
    '// import "forbidden";\n' +
      "const text = \"import('forbidden')\";\n" +
      'type Label = { source: "forbidden" };',
  );
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual([...collectModuleImportSpecifiers(parsed)], []);
});
