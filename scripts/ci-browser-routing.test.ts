import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { test } from "vitest";

test("explicit hosted fallback retains every Linux job's original default and fork route", () => {
  const fallback =
    "${{ github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'ci:github-hosted') && 'ubuntu-latest' || ";
  const fork =
    "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository && ";
  for (const [file, job, original] of [
    [
      "ci.yml",
      "release-authority-pg17-contract",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "ci.yml",
      "hosted-runtime-image",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_BUILD_RUNNER || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "ci.yml",
      "managed-migration-pg17",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "ci.yml",
      "quality",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_BUILD_RUNNER || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "ci.yml",
      "quality-db-contracts",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "ci.yml",
      "quality-source-certification",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "skills-browser.yml",
      "skills-browser",
      fork +
        "'ubuntu-24.04' || vars.CI_LINUX_BUILD_RUNNER || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-24.04'",
    ],
    [
      "skills-browser.yml",
      "catalog-browser",
      fork +
        "'ubuntu-24.04' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-24.04'",
    ],
    [
      "account-gateway-long-run.yml",
      "qualify",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "account-gateway-operator-grants.yml",
      "qualify",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "provider-accounts-c1.yml",
      "qualify",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "hindsight-memory-qualification.yml",
      "native",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "memory-projections.yml",
      "browser-ui",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    [
      "memory-projections.yml",
      "postgres-contracts",
      fork +
        "'ubuntu-latest' || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-latest'",
    ],
    ["memory-quality-evals.yml", "contracts", "'ubuntu-24.04'"],
    ["unified-ocr-ui.yml", "actual-next-readiness", "'ubuntu-24.04'"],
    [
      "native-accounts-browser.yml",
      "browser",
      fork +
        "'ubuntu-24.04' || vars.CI_LINUX_BUILD_RUNNER || vars.CI_LINUX_CHECKS_RUNNER || vars.CI_LINUX_RUNNER || 'ubuntu-24.04'",
    ],
  ] as const) {
    const source = readFileSync(
      new URL("../.github/workflows/" + file, import.meta.url),
      "utf8",
    );
    const block = source
      .split("\n  " + job + ":\n")[1]
      ?.split(/\n {2}[a-z][\w-]*:\n/)[0];
    assert.ok(block, file + ": missing " + job);
    assert.equal(
      block.match(/^ {4}runs-on: (.+)$/m)?.[1],
      fallback + original + " }}",
      file +
        ": explicit label must precede the unchanged fork and variable routes for " +
        job,
    );
  }
  const quality = readFileSync(
    new URL("../.github/workflows/memory-quality-evals.yml", import.meta.url),
    "utf8",
  );
  const live = quality.split("\n  live-tuning:\n")[1];
  assert.ok(live, "Privileged manual tuning job is missing");
  assert.equal(
    live.match(/^ {4}runs-on: (.+)$/m)?.[1],
    "${{ vars.MEMORY_QUALITY_EVAL_RUNNER }}",
  );
  assert.match(
    live,
    /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.mode == 'live-tuning' && github\.ref == 'refs\/heads\/main' \}\}/,
  );
});

test("Catalog provisions and verifies exact Python before its hash-locked scanner", () => {
  const source = readFileSync(
    new URL("../.github/workflows/skills-browser.yml", import.meta.url),
    "utf8",
  );
  const catalog = source.split("\n  catalog-browser:\n")[1];
  assert.ok(catalog, "Catalog browser job is missing");
  assert.match(
    catalog,
    /uses: actions\/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1\n {8}with:\n {10}python-version: "3\.12\.16"\n {10}architecture: x64/,
  );
  assert.match(
    catalog,
    /python3\.12 -c 'import sys; assert sys\.version_info\[:3\] == \(3, 12, 16\), sys\.version;/,
  );
  assert.ok(
    catalog.indexOf("uses: actions/setup-python@") <
      catalog.indexOf("python3.12 -m venv"),
  );
  assert.ok(
    catalog.indexOf("assert sys.version_info") <
      catalog.indexOf("python3.12 -m venv"),
  );
  assert.doesNotMatch(catalog, /apt-get[^\n]*python3\.12-venv/);
  assert.match(
    catalog,
    /--require-hashes -r services\/skill-scanner\/build-requirements\.lock/,
  );
  assert.match(
    catalog,
    /--no-build-isolation --require-hashes -r services\/skill-scanner\/requirements\.lock/,
  );
  assert.match(
    catalog,
    /tiktoken\.get_encoding\("cl100k_base"\); tiktoken\.get_encoding\("o200k_base"\)/,
  );
});

/**
 * GitHub evaluates paths filters in order: matching later ! patterns negate
 * an earlier include. Test the exact trigger declarations, not an independent
 * manually maintained marketing allowlist.
 */
function workflowPaths(yaml: string, event: string): string[] {
  const lines = yaml.split("\n");
  const start = lines.indexOf("  " + event + ":");
  assert.ok(start >= 0, "Missing " + event + " trigger");
  const next = lines.findIndex(
    (line, i) => i > start && /^ {2}[a-z][\w-]*:\s*$/.test(line),
  );
  const block = lines.slice(start + 1, next < 0 ? lines.length : next);
  const pathsIndex = block.indexOf("    paths:");
  assert.ok(pathsIndex >= 0, "Missing path filter on " + event);
  const patterns = [];
  for (const line of block.slice(pathsIndex + 1)) {
    if (/^\s*#/.test(line)) continue;
    const match = /^ {6}- (.+)$/.exec(line);
    if (!match) break;
    const value = match[1];
    assert.ok(value !== undefined);
    const literal = value.trim();
    patterns.push(literal.replace(/^(['"])(.*)\1$/, "$2"));
  }
  return patterns;
}

function matchingPath(patterns: readonly string[], path: string): boolean {
  let selected = false;
  for (const token of patterns) {
    const excluded = token.startsWith("!");
    if (matchesGlob(path, excluded ? token.slice(1) : token))
      selected = !excluded;
  }
  return selected;
}

test("browser receipt, cleanup and compiler changes select their owning acceptance workflows", () => {
  for (const [workflow, paths] of [
    [
      "unified-ocr-ui.yml",
      [
        "scripts/check-unified-ocr-results.ts",
        "scripts/check-unified-ocr-results.test.ts",
        "scripts/lib/next-browser-test-compiler.ts",
        "scripts/lib/next-browser-test-compiler.test.ts",
      ],
    ],
    [
      "skills-browser.yml",
      [
        "scripts/lib/next-generated-env.ts",
        "scripts/lib/next-generated-env.test.ts",
        "scripts/lib/next-browser-test-compiler.ts",
        "scripts/lib/next-browser-test-compiler.test.ts",
      ],
    ],
    [
      "statistics-followthrough-browser.yml",
      [
        "scripts/lib/next-generated-env.ts",
        "scripts/lib/next-generated-env.test.ts",
        "scripts/lib/next-browser-test-compiler.ts",
        "scripts/lib/next-browser-test-compiler.test.ts",
      ],
    ],
  ] as const) {
    const source = readFileSync(
      new URL("../.github/workflows/" + workflow, import.meta.url),
      "utf8",
    );
    const patterns = workflowPaths(source, "pull_request");
    for (const path of paths)
      assert.equal(
        matchingPath(patterns, path),
        true,
        workflow + ": must qualify " + path,
      );
    for (const path of [
      "scripts/lib/unrelated.ts",
      "scripts/check-unrelated-results.test.ts",
      "docs/unrelated.md",
    ])
      assert.equal(
        matchingPath(patterns, path),
        false,
        workflow + ": ownership widened to " + path,
      );
  }
});
