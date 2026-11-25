import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

// Independent acceptance roster: two readiness viewports, two Memory viewports,
// four provider-usage cases and eight account-limit cases. Do not infer it from
// the report: changing the selection must require review of this contract.
const requiredUiCases = {
  "review-runtime-readiness.spec.ts": [
    "desktop: current, same-transport update, unknown and candidate states stay coherent",
    "mobile: current, same-transport update, unknown and candidate states stay coherent",
  ],
  "memory-settings.spec.ts": [
    "desktop: Memory confirmation settings persist across repository selections",
    "mobile: Memory confirmation settings persist across repository selections",
  ],
  "provider-usage.spec.ts": [
    "provider usage overview keeps complete period totals, charts, models and runs across pages",
    "provider usage isolates workspace navigation and reloads stable known totals",
    "provider usage renders native lag and partial producer coverage truthfully",
    "provider usage operator report permits administrators and denies members and signed-out users",
  ],
  "account-limits.spec.ts": [
    "account limits are present in the first server paint with UTC observation time",
    "account limits preserve observations across reset without automatic reads and allow one explicit cached reread",
    "account limits partial and absent observations never imply free quota on mobile",
    "account limits restrict shared rows before native reads and fence a delayed response on workspace switch",
    "account limits keep two windows compact with keyboard-accessible details",
    "Claude account limits distinguish all-model and model windows on desktop and mobile with keyboard details",
    "Claude account limits preserve unknown and stale observations on mobile without provider reads",
    "Claude account limits follow the personal owner across workspace sharing",
  ],
} as const;

const uiResultSchema = z.object({
  actualRevision: z.string(),
  sourceDeltaSha256: z.literal(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  ),
  outcome: z.literal("done"),
  boot: z.object({ ok: z.literal(true) }),
  databaseMode: z.literal("explicit-test-url"),
  databaseBaseline: z.literal("fresh migrated"),
  externalNetworkAllowed: z.literal(false),
  tests: z.object({
    passed: z.literal(16),
    failed: z.literal(0),
    skipped: z.literal(0),
    failures: z.array(z.unknown()).length(0),
  }),
});
const runtimeSchema = z.object({
  revision: z.string(),
  baselineExpected: z.string(),
  databaseName: z.literal("review_router_accounts_reference_e2e_test"),
  externalNetworkAllowed: z.literal(false),
});
const playwrightSpecSchema = z.object({
  file: z.string(),
  title: z.string(),
  tests: z.tuple([
    z.object({
      expectedStatus: z.literal("passed"),
      status: z.literal("expected"),
      results: z.tuple([
        z.object({ status: z.literal("passed"), retry: z.literal(0) }),
      ]),
    }),
  ]),
});
const playwrightSuiteSchema = z.object({
  specs: z.array(playwrightSpecSchema).default([]),
  suites: z.array(z.unknown()).default([]),
});
const playwrightReportSchema = z.object({
  errors: z.array(z.unknown()).length(0),
  suites: z.array(z.unknown()),
});

function uiCaseKeys(suites: readonly unknown[]): string[] {
  return suites.flatMap((input) => {
    const suite = playwrightSuiteSchema.parse(input);
    return [
      ...suite.specs.map((spec) => `${spec.file}:${spec.title}`),
      ...uiCaseKeys(suite.suites),
    ];
  });
}

export function assertUnifiedOcrUiResults(
  resultInput: unknown,
  runtimeInput: unknown,
  playwrightInput: unknown,
  expectedRevision: string,
): { executed: 16; passed: 16; skipped: 0 } {
  assert.match(expectedRevision, /^[a-f0-9]{40}$/u);
  const result = uiResultSchema.parse(resultInput);
  const runtime = runtimeSchema.parse(runtimeInput);
  const report = playwrightReportSchema.parse(playwrightInput);
  assert.equal(result.actualRevision, expectedRevision);
  assert.equal(runtime.revision, expectedRevision);
  assert.equal(runtime.baselineExpected, expectedRevision);
  assert.deepEqual(
    uiCaseKeys(report.suites).sort(),
    Object.entries(requiredUiCases)
      .flatMap(([file, titles]) => titles.map((title) => `${file}:${title}`))
      .sort(),
  );
  return { executed: 16, passed: 16, skipped: 0 };
}

// Seven scenarios in both protocol versions, five v2-only scenarios and six
// concrete production routes in the existing paired lifecycle fixture.
// Independent acceptance roster, captured from the reviewed lifecycle matrix.
// Keep every protocol scenario and production route; counts alone can hide a
// missing required case replaced by an unrelated passing assertion.
const requiredPairedCases = [
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (1 / 'success' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'success' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (1 / 'denied' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'denied' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (1 / 'unknown' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'unknown' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (1 / 'missing_verdict' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'missing_verdict' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (1 / 'invalid_quote' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'invalid_quote' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (1 / 'wrong_packet' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'wrong_packet' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (1 / 'forged_claim' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'forged_claim' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'report_only' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'paid_unknown' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'budget_exhausted' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'stale_head' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'production_runner' / undefined)",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'production_runner' / 'openrouter-api')",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'production_runner' / 'mimo-token-plan-api')",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'production_runner' / 'kimi-code-api')",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'production_runner' / 'codex-subscription')",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'production_runner' / 'hosted-pool')",
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (2 / 'production_runner' / 'claude-subscription')",
] as const;

const pairedResultSchema = z.object({
  success: z.literal(true),
  numTotalTests: z.literal(25),
  numPassedTests: z.literal(25),
  numFailedTests: z.literal(0),
  numPendingTests: z.literal(0),
  numTodoTests: z.literal(0),
  testResults: z.tuple([
    z.object({
      name: z.string(),
      status: z.literal("passed"),
      assertionResults: z
        .array(
          z.object({
            fullName: z.string().min(1),
            status: z.literal("passed"),
          }),
        )
        .length(25),
    }),
  ]),
});

export function assertUnifiedOcrPairedResults(input: unknown): {
  executed: 25;
  passed: 25;
  skipped: 0;
} {
  const report = pairedResultSchema.parse(input);
  const suite = report.testResults[0];
  assert.equal(
    resolve(suite.name),
    resolve(
      "scripts/review-investigation-paired-e2e/lifecycle-verification-paired.e2e.test.ts",
    ),
  );
  assert.deepEqual(
    suite.assertionResults.map((test) => test.fullName).sort(),
    [...requiredPairedCases].sort(),
  );
  return { executed: 25, passed: 25, skipped: 0 };
}

function readReport(directory: string, file: string): unknown {
  return JSON.parse(readFileSync(join(directory, file), "utf8"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [mode, directory] = process.argv.slice(2);
  if (process.argv.length !== 4 || !directory)
    throw new Error(
      "usage: check-unified-ocr-results.ts <ui|paired> <directory>",
    );
  if (mode === "ui") {
    const revision = process.env.EXPECTED_REVISION;
    if (!revision) throw new Error("unified_ocr_expected_revision_required");
    console.log(
      JSON.stringify(
        assertUnifiedOcrUiResults(
          readReport(directory, "result.json"),
          readReport(directory, "runtime.json"),
          readReport(directory, "playwright-result.json"),
          revision,
        ),
      ),
    );
  } else if (mode === "paired") {
    console.log(
      JSON.stringify(
        assertUnifiedOcrPairedResults(
          readReport(directory, "paired-lifecycle-result.json"),
        ),
      ),
    );
  } else {
    throw new Error(
      "usage: check-unified-ocr-results.ts <ui|paired> <directory>",
    );
  }
}
