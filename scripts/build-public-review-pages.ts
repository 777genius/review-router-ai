import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const destination = process.argv[2];
if (!destination) {
  throw new Error(
    "Usage: node scripts/build-public-review-pages.ts OUTPUT_DIRECTORY",
  );
}
const output = path.resolve(destination);
const source = path.join(repo, "apps/web/public/paddle-review");
const pages = ["terms", "privacy", "refund-policy", "pricing"] as const;
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repo,
  encoding: "utf8",
}).trim();

// A fresh artifact directory prevents mixing builds or overwriting a release.
await mkdir(output, { recursive: false });
const files: { path: string; sha256: string }[] = [];
async function include(filename: string, relative: string): Promise<void> {
  const target = path.join(output, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(source, filename), target);
  files.push({
    path: relative,
    sha256: createHash("sha256")
      .update(await readFile(target))
      .digest("hex"),
  });
}
for (const page of pages) {
  await include(`${page}.html`, `${page}/index.html`);
  await include(`${page}.html`, `paddle-review/${page}.html`);
}
await include("styles.css", "paddle-review/styles.css");
files.sort((a, b) => a.path.localeCompare(b.path, "en"));
await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify({ sourceSha, files }, null, 2)}\n`,
);
console.log(JSON.stringify({ sourceSha, output, files: files.length }));
