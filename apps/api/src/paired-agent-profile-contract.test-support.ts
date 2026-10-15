import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const pairedCommit = "9428b431a4b6a3bb6dcdd789cde0cd67ed59dacb";
const metadataPath = "src/control-plane/review-agent-profiles.json";
const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

export function assertActualPairedActionSource(exactActionRoot: string): void {
  if (git(exactActionRoot, "rev-parse", "HEAD").trim() !== pairedCommit)
    throw new Error("paired_agent_action_commit_mismatch");
  if (
    !/^100644 blob [a-f0-9]{40}\t/.test(
      git(exactActionRoot, "ls-tree", pairedCommit, "--", metadataPath),
    )
  )
    throw new Error("paired_agent_metadata_not_regular_committed_file");
  if (!git(exactActionRoot, "show", `${pairedCommit}:${metadataPath}`).trim())
    throw new Error("paired_agent_metadata_empty");
}

/** Execute only the exact committed Action parser; no provider/SDK/runtime entry. */
export async function parseActualPairedRuntimeConfig(
  runtimeConfig: unknown,
  exactActionRoot: string,
) {
  const root = realpathSync(exactActionRoot);
  assertActualPairedActionSource(root);
  const bundled = await build({
    absWorkingDir: root,
    entryPoints: ["src/control-plane/runtime-config.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    write: false,
    plugins: [
      {
        name: "committed-paired-action-source",
        setup(builder) {
          builder.onLoad({ filter: /\.(?:ts|js|json)$/ }, ({ path }) => {
            const file = relative(root, path).split(sep).join("/");
            if (file.startsWith("../") || file === "..")
              throw new Error("paired_agent_source_outside_root");
            if (
              !/^100644 blob [a-f0-9]{40}\t/.test(
                git(root, "ls-tree", pairedCommit, "--", file),
              )
            )
              throw new Error("paired_agent_source_not_regular_committed_file");
            return {
              contents: git(root, "show", `${pairedCommit}:${file}`),
              loader: file.endsWith(".json") ? "json" : "ts",
              resolveDir: resolve(path, ".."),
            };
          });
        },
      },
    ],
  });
  assertActualPairedActionSource(root);
  if (bundled.outputFiles?.length !== 1)
    throw new Error("paired_agent_parser_bundle_invalid");
  const loaded = {
    exports: {} as {
      parseAdmittedRuntimeConfig?: (value: unknown) => {
        protocolVersion: 1;
        configVersion: number;
        runtimeEnv: Readonly<Record<string, string>>;
      };
    },
  };
  runInNewContext(bundled.outputFiles[0]!.text, {
    module: loaded,
    exports: loaded.exports,
    require: createRequire(import.meta.url),
    Buffer,
    process,
    console,
  });
  if (typeof loaded.exports.parseAdmittedRuntimeConfig !== "function")
    throw new Error("paired_agent_parser_export_missing");
  return loaded.exports.parseAdmittedRuntimeConfig(runtimeConfig);
}
