// Independent expected cases. Invalid source is text, never imported/executed.
export const nativeRuleCases = {
  "no-debugger": ["console.log(1);", "debugger;"],
  "no-compare-neg-zero": [
    "console.log(Object.is(1, -0));",
    "console.log(1 === -0);",
  ],
  "no-empty-character-class": ["console.log(/[a]/);", "console.log(/[]/);"],
  "no-invalid-regexp": [
    'console.log(new RegExp("[a]"));',
    'console.log(new RegExp("["));',
  ],
  "no-regex-spaces": ["console.log(/a {2}b/);", "console.log(/a  b/);"],
  "no-sparse-arrays": [
    "console.log([1, undefined, 3]);",
    "console.log([1, , 3]);",
  ],
  "use-isnan": ["console.log(Number.isNaN(1));", "console.log(1 === NaN);"],
} as const;

export const fallbackCases = [
  ["js", "no-undef", "missingGlobal();"],
  ["mjs", "@typescript-eslint/no-unused-vars", "const unusedValue = 1;"],
  ["cjs", "no-global-assign", "console = 1;"],
  ["ts", "@typescript-eslint/no-unused-vars", "const unusedValue = 1;"],
  ["mts", "@typescript-eslint/no-explicit-any", "export const value: any = 1;"],
  ["cts", "@typescript-eslint/no-explicit-any", "export const value: any = 1;"],
  ["tsx", "@typescript-eslint/no-empty-object-type", "export type Empty = {};"],
] as const;

export const formatCases = [
  {
    path: "types.ts",
    input: 'export const value:{label:string}={label:"ok"}\n',
    expected: 'export const value: { label: string } = { label: "ok" };\n',
  },
  {
    path: "width.ts",
    input:
      'export const message = buildMessage("alpha beta gamma delta epsilon", "zeta eta theta iota");\n',
    expected:
      'export const message = buildMessage(\n  "alpha beta gamma delta epsilon",\n  "zeta eta theta iota",\n);\n',
  },
  {
    path: "imports.ts",
    input:
      '// z stays first\nimport { z } from "z-package";\n// a stays second\nimport { a } from "a-package";\nexport const value = [z, a];\n',
    expected:
      '// z stays first\nimport { z } from "z-package";\n// a stays second\nimport { a } from "a-package";\nexport const value = [z, a];\n',
  },
  {
    path: "package.json",
    input:
      '{"version":"1.0.0","name":"disposable-test","dependencies":{"z-package":"1.0.0","a-package":"1.0.0"}}\n',
    expected:
      '{\n  "version": "1.0.0",\n  "name": "disposable-test",\n  "dependencies": {\n    "z-package": "1.0.0",\n    "a-package": "1.0.0"\n  }\n}\n',
  },
  {
    path: "tailwind.tsx",
    input: 'export const view=<div className="p-4 flex mt-2">Hi</div>\n',
    expected: 'export const view = <div className="p-4 flex mt-2">Hi</div>;\n',
  },
  {
    path: "comments.js",
    input: '// keep this comment\nconst value={label:"ok"}// trailing\n',
    expected:
      '// keep this comment\nconst value = { label: "ok" }; // trailing\n',
  },
  {
    path: "template.mjs",
    input: "export const value=`hello ${1+2}`\n",
    expected: "export const value = `hello ${1 + 2}`;\n",
  },
  {
    path: "regex.cjs",
    input: 'console.log(/a\\/b/i.test("A/b"))\n',
    expected: 'console.log(/a\\/b/i.test("A/b"));\n',
  },
  {
    path: "types.mts",
    input: 'export const value:{label:string}={label:"ok"}\n',
    expected: 'export const value: { label: string } = { label: "ok" };\n',
  },
  {
    path: "view.tsx",
    input: 'export const view=<section title="ok">Hello</section>\n',
    expected: 'export const view = <section title="ok">Hello</section>;\n',
  },
  {
    path: "value.json",
    input: '{"z":1,"a":[true,null]}\n',
    expected: '{ "z": 1, "a": [true, null] }\n',
  },
  {
    path: "guide.md",
    input: "# Title\n\nSome **bold** text.\n\n- first\n- second\n",
    expected: "# Title\n\nSome **bold** text.\n\n- first\n- second\n",
  },
  {
    path: "style.css",
    input: ".sample{color:red;margin:0 1px}\n",
    expected: ".sample {\n  color: red;\n  margin: 0 1px;\n}\n",
  },
] as const;
