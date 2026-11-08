import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { changedPaths, classifyChangedPaths } from "./ci-impact.mjs";

const cases = [
  ["empty diff fails closed", [], "full"],
  ["docs only", ["README.md", "docs/guide.md"], "docs"],
  ["deployment Markdown only", ["ai-docs/deployments/rollout.md"], "docs"],
  [
    "review history decision index must run full architecture checks",
    ["ai-docs/decisions/README.md"],
    "full",
  ],
  [
    "review history scoped decision must run full architecture checks",
    ["ai-docs/decisions/032-review-history-scoped-composition.md"],
    "full",
  ],
  [
    "review history decision mixed with ordinary documentation is full",
    ["README.md", "ai-docs/decisions/README.md"],
    "full",
  ],
  [
    "evidence JSON is not documentation",
    ["ai-docs/evidence/receipt.json"],
    "full",
  ],
  ["scripts in docs are executable", ["docs/example.sh"], "full"],
  ["repo instructions change is not docs-only", ["AGENTS.md"], "full"],
  [
    "Next Server Component is full",
    ["apps/web/app/dashboard/limits.tsx"],
    "full",
  ],
  ["shared visual component", ["packages/ui/src/button/button.tsx"], "ui"],
  [
    "CSS and images",
    ["apps/web/app/theme.css", "apps/web/public/logo.svg"],
    "ui",
  ],
  [
    "visual plus docs",
    ["docs/guide.md", "packages/ui/src/badge/badge.tsx"],
    "ui",
  ],
  ["API route must be full", ["apps/web/app/api/session/route.tsx"], "full"],
  [
    "server rendering implementation must be full",
    ["apps/web/src/server/index.tsx"],
    "full",
  ],
  ["auth implementation must be full", ["apps/web/app/auth/page.tsx"], "full"],
  [
    "client component in account pages is full",
    ["apps/web/app/dashboard/account-limits-line.tsx"],
    "full",
  ],
  ["backend code must be full", ["apps/api/src/index.ts"], "full"],
  [
    "backend plus visual must be full",
    ["apps/api/src/index.ts", "apps/web/app/page.tsx"],
    "full",
  ],
  ["database change must be full", ["prisma/schema.prisma"], "full"],
  ["workflow change must be full", [".github/workflows/ci.yml"], "full"],
  ["shared toolchain change must be full", ["pnpm-lock.yaml"], "full"],
  [
    "test harness change must be full",
    ["scripts/self-hosted-e2e/run.mjs"],
    "full",
  ],
  ["invalid path must be full", ["docs/../unsafe.md"], "full"],
  ["nonstring must be full", [null], "full"],
];

for (const [label, paths, expected] of cases)
  test(label, () => assert.equal(classifyChangedPaths(paths), expected));

test("complete Git diff includes both sides of a cross-tier rename", () => {
  const cwd = mkdtempSync(join(tmpdir(), "ci-impact-"));
  const git = (...args) =>
    execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  const commit = (message) => {
    git("add", "-A");
    git(
      "-c",
      "user.name=CI",
      "-c",
      "user.email=ci@example.invalid",
      "commit",
      "-q",
      "-m",
      message,
    );
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    mkdirSync(join(cwd, "docs"));
    writeFileSync(join(cwd, "docs/guide.md"), "Read me\n");
    const base = commit("documentation");
    mkdirSync(join(cwd, "apps/web/src/server"), { recursive: true });
    rmSync(join(cwd, "docs/guide.md"));
    writeFileSync(join(cwd, "apps/web/src/server/route.tsx"), "export {};\n");
    const head = commit("move code");
    const paths = changedPaths(base, head, cwd);
    assert.deepEqual(
      [...paths].sort(),
      ["docs/guide.md", "apps/web/src/server/route.tsx"].sort(),
    );
    assert.equal(classifyChangedPaths(paths), "full");
    assert.equal(changedPaths("not-a-sha", head, cwd), null);
    assert.equal(changedPaths(base, base, cwd), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
