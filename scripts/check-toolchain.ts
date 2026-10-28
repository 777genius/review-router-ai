import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  packageManager: string;
};
const [major, minor] = process.versions.node.split(".").map(Number);
if (!((major === 24 && minor >= 21) || (major === 26 && minor >= 10))) {
  throw new Error(
    "Supported Node versions: >=24.21 <25 or >=26.10 <27 (see .node-version).",
  );
}
const expected = manifest.packageManager.replace(/^pnpm@/, "");
const actual = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
if (actual !== expected)
  throw new Error(`Expected pnpm ${expected}, received ${actual}.`);
console.log(
  `Toolchain qualified: Node ${process.versions.node}, pnpm ${actual}.`,
);
