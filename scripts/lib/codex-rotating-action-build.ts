import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { parse } from "acorn";
import { build, type OnResolveArgs } from "esbuild";

const thirdPartyNotices = await readFile(
  new URL("../codex-rotating-action-third-party-licenses.txt", import.meta.url),
  "utf8",
);

export async function buildCodexRotatingAction({
  root = process.cwd(),
  outfile = join(root, "action-dist/index.cjs"),
}: { root?: string; outfile?: string } = {}): Promise<void> {
  await build({
    absWorkingDir: root,
    entryPoints: [
      "packages/features/codex-oauth-rotating/src/action/github-action.ts",
    ],
    outfile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    // Keep YAML's CJS wrapper paths logical without changing identifier names
    // or symlink resolution for the rest of the dependency graph.
    plugins: [
      {
        name: "logical-yaml-paths",
        setup(actionBuild) {
          let yamlRoot = "";
          const resolveYaml = async (args: OnResolveArgs) => {
            if (args.pluginData === "physical-yaml-resolution") return;
            const resolved = await actionBuild.resolve(args.path, {
              resolveDir: args.resolveDir,
              kind: args.kind,
              pluginData: "physical-yaml-resolution",
            });
            if (resolved.errors.length > 0 || resolved.external) {
              return resolved;
            }
            if (args.namespace === "file") {
              // The locked YAML Node export is dist/index.js. Keep one physical
              // package identity; never merge distinct installations silently.
              const packageRoot = dirname(dirname(resolved.path));
              if (yamlRoot && yamlRoot !== packageRoot) {
                throw new Error(
                  "Action YAML imports resolved to distinct packages",
                );
              }
              yamlRoot = packageRoot;
            }
            const logicalPath = relative(yamlRoot, resolved.path);
            if (
              logicalPath === ".." ||
              logicalPath.startsWith(`..${sep}`) ||
              isAbsolute(logicalPath)
            ) {
              return resolved;
            }
            return {
              ...resolved,
              path: logicalPath.split(sep).join("/"),
              namespace: "yaml",
              pluginData: resolved.path,
            };
          };
          actionBuild.onResolve(
            { filter: /^yaml$/, namespace: "file" },
            resolveYaml,
          );
          actionBuild.onResolve(
            { filter: /.*/, namespace: "yaml" },
            resolveYaml,
          );
          actionBuild.onLoad(
            { filter: /.*/, namespace: "yaml" },
            async (args) => {
              const physicalPath: unknown = args.pluginData;
              if (typeof physicalPath !== "string")
                throw new Error("Action YAML physical path is missing");
              return {
                contents: await readFile(physicalPath, "utf8"),
                loader: "js",
                resolveDir: dirname(physicalPath),
              };
            },
          );
        },
      },
      {
        // Retain the pinned package identity (including peer/version suffix),
        // while excluding machine-specific pnpm install paths from CJS labels.
        name: "logical-pinned-dependency-paths",
        setup(actionBuild) {
          const resolveDependency = async (args: OnResolveArgs) => {
            if (args.pluginData === "physical-pinned-resolution") return;
            const resolved = await actionBuild.resolve(args.path, {
              resolveDir: args.resolveDir,
              kind: args.kind,
              pluginData: "physical-pinned-resolution",
            });
            if (resolved.errors.length || resolved.external) return resolved;
            const marker = "/node_modules/.pnpm/";
            const offset = resolved.path.lastIndexOf(marker);
            if (offset < 0) return resolved;
            return {
              ...resolved,
              path: resolved.path.slice(offset + marker.length),
              namespace: "pinned-dependency",
              pluginData: resolved.path,
            };
          };
          actionBuild.onResolve(
            { filter: /.*/, namespace: "file" },
            resolveDependency,
          );
          actionBuild.onResolve(
            { filter: /.*/, namespace: "pinned-dependency" },
            resolveDependency,
          );
          actionBuild.onLoad(
            { filter: /.*/, namespace: "pinned-dependency" },
            async (args) => {
              const physicalPath: unknown = args.pluginData;
              if (typeof physicalPath !== "string")
                throw new Error("Action dependency physical path is missing");
              return {
                contents: await readFile(physicalPath, "utf8"),
                loader: physicalPath.endsWith(".json") ? "json" : "js",
                resolveDir: dirname(physicalPath),
              };
            },
          );
        },
      },
    ],
    legalComments: "none",
    banner: {
      js: `/*! ReviewRouter Action third-party notices\n${thirdPartyNotices.trimEnd()}\n*/`,
    },
  });
  const bundle = await readFile(outfile, "utf8");
  const reproducibleBundle = normalizeDependencyWrapperLabels(
    bundle.replace(/^\/\/ (?:.*\/)?node_modules\/[^\r\n]*(?:\r?\n|$)/gmu, ""),
  );
  if (reproducibleBundle !== bundle) {
    await writeFile(outfile, reproducibleBundle);
  }
}

export function normalizeDependencyWrapperLabels(bundle: string): string {
  const source = parse(bundle, {
    ecmaVersion: "latest",
    sourceType: "script",
    allowHashBang: true,
  });
  const edits: { start: number; end: number; label: string }[] = [];
  // Only top-level esbuild wrapper descriptors contain diagnostic keys.
  // Physical module resolution and source string values remain untouched.
  for (const statement of source.body) {
    if (statement.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declarations) {
      const initializer = declaration.init;
      if (
        !initializer ||
        initializer.type !== "CallExpression" ||
        initializer.callee.type !== "Identifier" ||
        !/^__(?:commonJS|esm)$/.test(initializer.callee.name)
      )
        continue;
      const descriptor = initializer.arguments[0];
      if (!descriptor || descriptor.type !== "ObjectExpression") continue;
      for (const property of descriptor.properties) {
        if (
          property.type !== "Property" ||
          !property.method ||
          property.computed ||
          property.key.type !== "Literal" ||
          typeof property.key.value !== "string"
        )
          continue;
        const label = property.key.value;
        if (!/^(?:node_modules\/|pinned-dependency:)/.test(label)) continue;
        const offset = label.lastIndexOf("node_modules/");
        if (offset <= 0) continue;
        edits.push({
          start: property.key.start,
          end: property.key.end,
          label: label.slice(offset),
        });
      }
    }
  }
  for (const edit of edits.reverse()) {
    bundle =
      bundle.slice(0, edit.start) +
      JSON.stringify(edit.label) +
      bundle.slice(edit.end);
  }
  return bundle;
}
