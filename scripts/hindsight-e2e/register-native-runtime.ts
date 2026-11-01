import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Node 24 supplies TypeScript transformation. Resolve only the verified public
// SDK and repository-relative source; no full workspace install or plugin loader.
const sdk = process.env.HINDSIGHT_SDK_ENTRY;
if (!sdk || !existsSync(sdk))
  throw new Error("A verified Hindsight1.1.0 SDK entry is required");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "context-memory")
      return {
        url: new URL(
          "../../packages/context-memory/src/index.ts",
          import.meta.url,
        ).href,
        shortCircuit: true,
      };
    if (specifier === "@vectorize-io/hindsight-client")
      return { url: pathToFileURL(sdk).href, shortCircuit: true };
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const target = new URL(specifier, context.parentURL);
      const path = fileURLToPath(target);
      const source = path.endsWith(".js")
        ? path.slice(0, -3) + ".ts"
        : path.endsWith(".ts")
          ? path
          : path + ".ts";
      if (existsSync(source))
        return { url: pathToFileURL(source).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
