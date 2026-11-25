import { parsers } from "@prettier/plugin-oxc";
import { format as prettierFormat, type Options, type Plugin } from "prettier";
import { printers } from "prettier/plugins/estree";

const nativeTypeScriptParser = parsers["oxc-ts"];
if (nativeTypeScriptParser.astFormat !== "estree-oxc") {
  throw new Error("Unexpected native Prettier AST format");
}

// Pair the native ESTree AST with the already pinned Prettier printer. A distinct
// public AST-format key keeps this registration scoped away from Babel/JavaScript.
const nativeAstFormat = "native-typescript-estree";
const nativeTypeScriptPlugin = {
  parsers: {
    typescript: { ...nativeTypeScriptParser, astFormat: nativeAstFormat },
  },
  printers: { [nativeAstFormat]: printers.estree },
} satisfies Plugin<unknown>;

export default nativeTypeScriptPlugin;

// Programmatic Prettier calls do not read the root configuration automatically.
export function format(source: string, options: Options): Promise<string> {
  return prettierFormat(source, {
    ...options,
    plugins: [...(options.plugins ?? []), nativeTypeScriptPlugin],
  });
}
