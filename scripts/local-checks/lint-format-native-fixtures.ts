// Independent expected formatting. Syntax fixtures remain text, not executable
// source; they exercise the real parser, printer and embedded-language boundary.
export const nativeFormatCases = [
  {
    path: "union-layout.ts",
    input:
      'export type RuntimeProviderPrefix = "codex" | "codex-mimo" | "claude" | "openrouter" | "kimi";\n',
    expected:
      'export type RuntimeProviderPrefix =\n  | "codex"\n  | "codex-mimo"\n  | "claude"\n  | "openrouter"\n  | "kimi";\n',
  },
  {
    path: "common.cts",
    input: "export const value:number=1\n",
    expected: "export const value: number = 1;\n",
  },
  {
    path: "ambient.d.ts",
    input:
      'declare module "sample"{export interface Entry{readonly name:string}}\n',
    expected:
      'declare module "sample" {\n  export interface Entry {\n    readonly name: string;\n  }\n}\n',
  },
  {
    path: "ambient.d.mts",
    input: "export declare const name:string\n",
    expected: "export declare const name: string;\n",
  },
  {
    path: "ambient.d.cts",
    input: "declare const value:{id:number};export = value\n",
    expected: "declare const value: { id: number };\nexport = value;\n",
  },
  {
    path: "generic.tsx",
    input: "export const view=<T,>(value:T)=><span>{value}</span>\n",
    expected: "export const view = <T,>(value: T) => <span>{value}</span>;\n",
  },
  {
    path: "numeric-keys.ts",
    input: 'export const value={"1":"one",2:"two"} as const\n',
    expected: 'export const value = { "1": "one", 2: "two" } as const;\n',
  },
  {
    path: "class-keys.ts",
    input: 'declare class Entry{"name":string}\n',
    expected: 'declare class Entry {\n  "name": string;\n}\n',
  },
  {
    path: "template.ts",
    input: "export function greet(name:string){return `hello ${name}`}\n",
    expected:
      "export function greet(name: string) {\n  return `hello ${name}`;\n}\n",
  },
  {
    path: "embedded-css.ts",
    input: "const styles = css`a{color:red}`;\n",
    expected: "const styles = css`\n  a {\n    color: red;\n  }\n`;\n",
  },
  {
    path: "embedded-html.ts",
    input:
      'const template = html`<script type="application/x-typescript">const x:number=1</script>`;\n',
    // The unchanged Prettier 3.8.3 Babel printer confirms this outer layout.
    expected:
      'const template = html`<script type="application/x-typescript">\n  const x: number = 1;\n</script>`;\n',
  },
  {
    path: "fenced-ts.md",
    input: "# Example\n\n```ts\nexport const value:number=1\n```\n",
    expected: "# Example\n\n```ts\nexport const value: number = 1;\n```\n",
  },
  {
    path: "fenced-typescript.md",
    input: "```typescript\nexport const value:number=1\n```\n",
    expected: "```typescript\nexport const value: number = 1;\n```\n",
  },
  {
    path: "fenced-tsx.md",
    input: "```tsx\nconst view=<T,>(value:T)=><span>{value}</span>\n```\n",
    expected:
      "```tsx\nconst view = <T,>(value: T) => <span>{value}</span>;\n```\n",
  },
  {
    path: "script-language.html",
    input: '<script lang="ts">export const value:number=1</script>\n',
    expected:
      '<script lang="ts">\n  export const value: number = 1;\n</script>\n',
  },
  {
    path: "script-mime.html",
    input:
      '<script type="application/x-typescript">export const value:number=1</script>\n',
    expected:
      '<script type="application/x-typescript">\n  export const value: number = 1;\n</script>\n',
  },
  {
    path: "workflow.yaml",
    input: "services:\n  web: {image: app, ports: [3000]}\n",
    expected: "services:\n  web: { image: app, ports: [3000] }\n",
  },
  {
    path: "babel-flow.js",
    input: "// @flow\nexport type Exact={|count:number|}\n",
    expected: "// @flow\nexport type Exact = {| count: number |};\n",
  },
] as const;
