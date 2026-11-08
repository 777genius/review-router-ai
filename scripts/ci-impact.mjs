import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sha = /^[0-9a-f]{40}$/;
const documentation = new Set([
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "LICENSE",
  "NOTICE",
]);

function isDocumentation(path) {
  return (
    documentation.has(path) ||
    ((path.startsWith("docs/") || path.startsWith("ai-docs/")) &&
      /\.(?:md|mdx|rst|txt|svg|png|jpe?g|webp)$/.test(path))
  );
}

function isVisualUI(path) {
  if (!path.startsWith("apps/web/") && !path.startsWith("packages/ui/"))
    return false;
  // Auth, API and server code must never enter the cheaper visual-only lane.
  if (
    path.startsWith("apps/web/app/api/") ||
    path.startsWith("apps/web/src/server/") ||
    path.startsWith("apps/web/app/auth/") ||
    path.startsWith("apps/web/src/auth/") ||
    path.startsWith("apps/web/src/private-")
  )
    return false;
  return /\.(?:tsx|css|scss|sass|svg|png|jpe?g|webp|gif)$/.test(path);
}

/** Unknown or mixed executable changes always require the complete CI matrix. */
export function classifyChangedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return "full";
  let visual = false;
  for (const path of paths) {
    if (
      typeof path !== "string" ||
      !path ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("..") ||
      path.includes("\uFFFD")
    )
      return "full";
    if (isDocumentation(path)) continue;
    if (isVisualUI(path)) {
      visual = true;
      continue;
    }
    return "full";
  }
  return visual ? "ui" : "docs";
}

function git(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.error || result.status !== 0 ? null : result.stdout;
}

/** Use the checked-out merge commit, never an untrusted PR branch or an API file cap. */
export function changedPaths(base, head, cwd = process.cwd()) {
  if (!sha.test(base) || !sha.test(head)) return null;
  const actual = git(["rev-parse", "HEAD"], cwd);
  if (actual === null || actual.toString("utf8").trim() !== head)
    return null;
  if (git(["merge-base", "--is-ancestor", base, head], cwd) === null)
    return null;
  const diff = git(
    ["diff", "--name-only", "--no-renames", "-z", base, head],
    cwd,
  );
  if (diff === null) return null;
  const text = diff.toString("utf8");
  if (text.includes("\uFFFD")) return null;
  const paths = text.split("\0");
  if (paths.at(-1) === "") paths.pop();
  return paths;
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME;
  const paths =
    event === "pull_request"
      ? changedPaths(process.env.CI_BASE_SHA, process.env.GITHUB_SHA)
      : null;
  // Pushes to main and manual release qualification retain full certification.
  const tier = event === "pull_request" && paths !== null
    ? classifyChangedPaths(paths)
    : "full";
  const reason =
    event !== "pull_request"
      ? "main or manual: full release gate"
      : paths === null
        ? "unavailable or untrusted Git range: full fail-closed"
        : "classified from complete Git diff";
  const line = "tier=" + tier + "\n";
  process.stdout.write("CI impact: " + tier + " (" + reason + ")\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "CI impact tier: **" + tier + "** — " + reason + ".\n",
    );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
