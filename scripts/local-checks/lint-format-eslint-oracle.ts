import assert from "node:assert/strict";
import js from "@eslint/js";

// Independent retained configuration oracle, transcribed from the immutable
// typescript-eslint 8.59.1 source at 52457932e5507b5ca01e720a541f3f8d01e09b9d:
// packages/eslint-plugin/src/configs/flat/recommended.ts and
// packages/eslint-plugin/src/configs/eslint-recommended-raw.ts.
// Those legacy implementations are never imported or executed by this oracle.
const retainedSyntaxRules = [
  "ban-ts-comment",
  "no-array-constructor",
  "no-duplicate-enum-values",
  "no-empty-object-type",
  "no-explicit-any",
  "no-extra-non-null-assertion",
  "no-misused-new",
  "no-namespace",
  "no-non-null-asserted-optional-chain",
  "no-require-imports",
  "no-this-alias",
  "no-unnecessary-type-constraint",
  "no-unsafe-declaration-merging",
  "no-unsafe-function-type",
  "no-unused-expressions",
  "no-unused-vars",
  "no-wrapper-object-types",
  "prefer-as-const",
  "prefer-namespace-keyword",
  "triple-slash-reference",
] as const;

const typedCoreDisabled = [
  "constructor-super",
  "getter-return",
  "no-class-assign",
  "no-const-assign",
  "no-dupe-args",
  "no-dupe-class-members",
  "no-dupe-keys",
  "no-func-assign",
  "no-import-assign",
  "no-new-native-nonconstructor",
  "no-new-symbol",
  "no-obj-calls",
  "no-redeclare",
  "no-setter-return",
  "no-this-before-super",
  "no-undef",
  "no-unreachable",
  "no-unsafe-negation",
  "no-with",
] as const;

const readonlyGlobals = [
  "console",
  "process",
  "Buffer",
  "URL",
  "setTimeout",
  "clearTimeout",
  "document",
  "window",
  "HTMLElement",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, description: string): Record<string, unknown> {
  assert.ok(isRecord(value), description);
  return value;
}

function severity(value: unknown): number {
  const first: unknown = Array.isArray(value) ? value[0] : value;
  if (first === "off" || first === 0) return 0;
  if (first === "warn" || first === 1) return 1;
  assert.ok(first === "error" || first === 2, "Invalid rule severity");
  return 2;
}

/** Checks the retained rule set independently of the candidate's own configs. */
export function assertRetainedEslintConfig(
  value: unknown,
  extension: string,
): void {
  assert.ok(
    ["js", "mjs", "cjs", "ts", "mts", "cts", "tsx"].includes(extension),
  );
  const config = record(value, `${extension}: missing effective ESLint config`);
  const actual = record(config["rules"], `${extension}: missing rule ledger`);
  const expected: Record<string, number> = Object.fromEntries(
    Object.entries(js.configs.recommended.rules).map(([name, setting]) => [
      name,
      severity(setting),
    ]),
  );
  for (const name of retainedSyntaxRules) {
    expected[`@typescript-eslint/${name}`] = 2;
  }
  for (const name of [
    "no-array-constructor",
    "no-unused-expressions",
    "no-unused-vars",
  ]) {
    expected[name] = 0;
  }
  if (["ts", "tsx", "mts", "cts"].includes(extension)) {
    for (const name of typedCoreDisabled) expected[name] = 0;
    for (const name of [
      "no-var",
      "prefer-const",
      "prefer-rest-params",
      "prefer-spread",
    ]) {
      expected[name] = 2;
    }
  }
  if (extension === "ts" || extension === "tsx") {
    expected["no-console"] = 0;
    expected["@typescript-eslint/no-explicit-any"] = 0;
  }
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    `${extension}: retained rule set changed`,
  );
  for (const [name, enabled] of Object.entries(expected)) {
    assert.equal(severity(actual[name]), enabled, `${extension}: ${name}`);
  }

  const language = record(
    config["languageOptions"],
    "Missing language options",
  );
  assert.equal(language["sourceType"], "module");
  const globals = record(language["globals"], "Missing retained globals");
  assert.deepEqual(Object.keys(globals).sort(), [...readonlyGlobals].sort());
  for (const name of readonlyGlobals) {
    assert.ok(
      globals[name] === "readonly" || globals[name] === false,
      `${extension}: ${name} must remain readonly`,
    );
  }
  const parser = record(language["parser"], "Missing qualified native parser");
  const parserMeta = record(parser["meta"], "Missing native parser identity");
  assert.equal(parserMeta["name"], "eslint-parser-oxc");
  assert.equal(parserMeta["version"], "0.1.1");
  const plugins = record(config["plugins"], "Missing retained syntax plugin");
  const plugin = record(
    plugins["@typescript-eslint"],
    "Missing syntax rule namespace",
  );
  const pluginMeta = record(plugin["meta"], "Missing public adapter identity");
  assert.equal(pluginMeta["name"], "stack-toolchain/eslint-syntax");
  assert.deepEqual(
    Object.keys(
      record(plugin["rules"], "Missing retained rule implementations"),
    ).sort(),
    [...retainedSyntaxRules].sort(),
  );
}
