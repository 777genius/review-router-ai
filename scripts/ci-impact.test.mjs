import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
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
  ["architecture decisions", ["ai-docs/decisions/030-standard.md"], "full"],
  ["architecture decision index", ["ai-docs/decisions/README.md"], "full"],
  ["operation contracts", ["ai-docs/operations/08-cutover.md"], "full"],
  ["beta runbook", ["ai-docs/BETA_RUNBOOK.md"], "full"],
  ["agent entry runbook", ["ai-docs/AGENT_START_HERE.md"], "full"],
  ["release ADR", ["docs/adr/ADR-private-pg17-release-authority.md"], "full"],
  ["review evidence markdown", ["docs/release-evidence/proof.md"], "full"],
  [
    "private PG17 runbook",
    ["docs/operations/private-pg17-release-rollout.md"],
    "full",
  ],
  ["ordinary operations prose", ["docs/operations/ci-impact-smoke.md"], "docs"],
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

test("CI impact selector runs outside native Linux runner pool", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url), "utf8",
  );
  const block = workflow.match(/^  impact:\n([\s\S]*?)(?=^  [a-z][\w-]+:\s*$)/m)?.[1];
  assert.ok(block, "CI impact job is missing");
  assert.match(block, /^    runs-on: ubuntu-latest$/m);
  assert.doesNotMatch(block, /CI_LINUX_(?:CHECKS_)?RUNNER/);
  assert.match(block, /git show "\$\{CI_BASE_SHA\}:scripts\/ci-impact\.mjs"/);
  assert.match(workflow, /^  quality-gates:$/m);
});


/**
 * GitHub evaluates paths filters in order: matching later ! patterns negate
 * an earlier include. Test the exact trigger declarations, not an independent
 * manually maintained marketing allowlist.
 */
function workflowPaths(yaml, event) {
  const lines = yaml.split("\n");
  const start = lines.indexOf("  " + event + ":");
  assert.ok(start >= 0, "Missing " + event + " trigger");
  const next = lines.findIndex((line, i) => i > start && /^  [a-z][\w-]*:\s*$/.test(line));
  const block = lines.slice(start + 1, next < 0 ? lines.length : next);
  const pathsIndex = block.indexOf("    paths:");
  assert.ok(pathsIndex >= 0, "Missing path filter on " + event);
  const patterns = [];
  for (const line of block.slice(pathsIndex + 1)) {
    const match = /^      - (.+)$/.exec(line);
    if (!match) break;
    const literal = match[1].trim();
    patterns.push(literal.replace(/^(['"])(.*)\1$/, "$2"));
  }
  return patterns;
}

function matchingPath(patterns, path) {
  let selected = false;
  for (const token of patterns) {
    const excluded = token.startsWith("!");
    if (matchesGlob(path, excluded ? token.slice(1) : token)) selected = !excluded;
  }
  return selected;
}

test("marketing-only E2E filters keep real dashboard and shared contracts", () => {
  const workflows = [
    ["skills-browser.yml", ["pull_request"], "packages/features/review-skills/src/index.ts"],
    ["memory-projections.yml", ["pull_request", "push"], "packages/features/memory/src/index.ts"],
    ["unified-ocr-ui.yml", ["pull_request"], "packages/features/review-run-control/src/index.ts"],
  ];
  const marketing = [
    "apps/web/app/home-hero.tsx",
    "apps/web/app/home-landing.module.css",
    "apps/web/app/page.tsx",
    "apps/web/app/pricing/page.tsx",
    "apps/web/app/privacy/page.tsx",
    "apps/web/app/terms/page.tsx",
    "apps/web/app/security/page.tsx",
    "apps/web/app/robots.ts",
    "apps/web/app/sitemap.ts",
  ];
  const shared = [
    "apps/web/app/layout.tsx",
    "apps/web/app/primary-nav.tsx",
    "apps/web/app/globals.css",
    "apps/web/app/dashboard/review-skills-section.tsx",
    "apps/web/src/server/review-skills-reader.ts",
    "apps/web/app/api/dashboard/skills/route.ts",
  ];
  for (const [workflow, events, ownFeature] of workflows) {
    const source = readFileSync(new URL("../.github/workflows/" + workflow, import.meta.url), "utf8");
    for (const event of events) {
      const patterns = workflowPaths(source, event);
      const include = patterns.indexOf("apps/web/**");
      assert.ok(include >= 0, workflow + ": broad shared-web admission lost");
      const exclusions = patterns.filter((pattern) => pattern.startsWith("!"));
      assert.ok(exclusions.length >= 10, workflow + ": missing narrow marketing exclusions");
      assert.ok(patterns.indexOf(exclusions[0]) > include, workflow + ": exclusions must follow inclusion");
      for (const path of marketing) {
        assert.equal(matchingPath(patterns, path), false, workflow + " " + event + " should omit " + path);
      }
      for (const path of [...shared, ownFeature, ".github/workflows/" + workflow]) {
        assert.equal(matchingPath(patterns, path), true, workflow + " " + event + " must test " + path);
      }
      assert.equal(
        ["apps/web/app/home-hero.tsx", "apps/web/app/layout.tsx"].some((path) => matchingPath(patterns, path)),
        true, workflow + ": mixed marketing and shared change must run",
      );
    }
    assert.match(source, /workflow_dispatch:/);
  }
});
