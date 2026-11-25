import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  assertUnifiedOcrPairedResults,
  assertUnifiedOcrUiResults,
} from "./check-unified-ocr-results.ts";

const revision = "a".repeat(40);

function uiFixture() {
  // Independent captured selection, not imported from the validator's roster.
  const cases = [
    [
      "review-runtime-readiness.spec.ts",
      "desktop: current, same-transport update, unknown and candidate states stay coherent",
    ],
    [
      "review-runtime-readiness.spec.ts",
      "mobile: current, same-transport update, unknown and candidate states stay coherent",
    ],
    [
      "memory-settings.spec.ts",
      "desktop: Memory confirmation settings persist across repository selections",
    ],
    [
      "memory-settings.spec.ts",
      "mobile: Memory confirmation settings persist across repository selections",
    ],
    [
      "provider-usage.spec.ts",
      "provider usage overview keeps complete period totals, charts, models and runs across pages",
    ],
    [
      "provider-usage.spec.ts",
      "provider usage isolates workspace navigation and reloads stable known totals",
    ],
    [
      "provider-usage.spec.ts",
      "provider usage renders native lag and partial producer coverage truthfully",
    ],
    [
      "provider-usage.spec.ts",
      "provider usage operator report permits administrators and denies members and signed-out users",
    ],
    [
      "account-limits.spec.ts",
      "account limits are present in the first server paint with UTC observation time",
    ],
    [
      "account-limits.spec.ts",
      "account limits preserve observations across reset without automatic reads and allow one explicit cached reread",
    ],
    [
      "account-limits.spec.ts",
      "account limits partial and absent observations never imply free quota on mobile",
    ],
    [
      "account-limits.spec.ts",
      "account limits restrict shared rows before native reads and fence a delayed response on workspace switch",
    ],
    [
      "account-limits.spec.ts",
      "account limits keep two windows compact with keyboard-accessible details",
    ],
    [
      "account-limits.spec.ts",
      "Claude account limits distinguish all-model and model windows on desktop and mobile with keyboard details",
    ],
    [
      "account-limits.spec.ts",
      "Claude account limits preserve unknown and stale observations on mobile without provider reads",
    ],
    [
      "account-limits.spec.ts",
      "Claude account limits follow the personal owner across workspace sharing",
    ],
  ] as const;
  return {
    result: {
      actualRevision: revision,
      sourceDeltaSha256:
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      outcome: "done",
      boot: { ok: true },
      databaseMode: "explicit-test-url",
      databaseBaseline: "fresh migrated",
      externalNetworkAllowed: false,
      tests: { passed: 16, failed: 0, skipped: 0, failures: [] },
    },
    runtime: {
      revision,
      baselineExpected: revision,
      databaseName: "review_router_accounts_reference_e2e_test",
      externalNetworkAllowed: false,
    },
    report: {
      errors: [],
      suites: [
        {
          suites: [
            {
              specs: cases.map(([file, title]) => ({
                file: String(file),
                title: String(title),
                tests: [
                  {
                    expectedStatus: "passed",
                    status: "expected",
                    results: [{ status: "passed", retry: 0 }],
                  },
                ],
              })),
            },
          ],
        },
      ],
    },
  };
}
type UiFixture = ReturnType<typeof uiFixture>;
const firstUiCase = (fixture: UiFixture) =>
  fixture.report.suites[0]!.suites[0]!.specs[0]!;
const checkUi = (fixture: UiFixture) =>
  assertUnifiedOcrUiResults(
    fixture.result,
    fixture.runtime,
    fixture.report,
    revision,
  );

it("accepts all sixteen exact UI cases with fresh source and database receipts", () => {
  expect(checkUi(uiFixture())).toEqual({
    executed: 16,
    passed: 16,
    skipped: 0,
  });
});

it.each([
  [
    "a partial skipped UI run",
    (f: UiFixture) => {
      f.result.tests.passed = 15;
      f.result.tests.skipped = 1;
    },
  ],
  [
    "a raw skipped result hidden behind passing summary counts",
    (f: UiFixture) => {
      firstUiCase(f).tests[0]!.results[0]!.status = "skipped";
    },
  ],
  [
    "a different passing scenario replacing a required case",
    (f: UiFixture) => {
      firstUiCase(f).title = "unrelated passing test";
    },
  ],
  [
    "a stale source revision",
    (f: UiFixture) => {
      f.result.actualRevision = "b".repeat(40);
    },
  ],
  [
    "a dirty source receipt",
    (f: UiFixture) => {
      f.result.sourceDeltaSha256 = "b".repeat(64);
    },
  ],
  [
    "a restored database instead of fresh migrations",
    (f: UiFixture) => {
      f.result.databaseBaseline = "restored fixture";
    },
  ],
  [
    "a successful retry replacing the original attempt",
    (f: UiFixture) => {
      firstUiCase(f).tests[0]!.results.push({ status: "passed", retry: 1 });
    },
  ],
] as const)("rejects %s", (_name, mutate) => {
  const fixture = uiFixture();
  mutate(fixture);
  expect(() => checkUi(fixture)).toThrow();
});

function pairedFixture() {
  return {
    success: true,
    numTotalTests: 25,
    numPassedTests: 25,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: resolve(
          "scripts/review-investigation-paired-e2e/lifecycle-verification-paired.e2e.test.ts",
        ),
        status: "passed",
        assertionResults: Array.from({ length: 25 }, (_, index) => ({
          fullName: `reviewed paired case ${index}`,
          status: "passed",
        })),
      },
    ],
  };
}
type PairedFixture = ReturnType<typeof pairedFixture>;

it("accepts all twenty-five executed paired lifecycle cases", () => {
  expect(assertUnifiedOcrPairedResults(pairedFixture())).toEqual({
    executed: 25,
    passed: 25,
    skipped: 0,
  });
});

it.each([
  [
    "a skipped paired summary",
    (f: PairedFixture) => {
      f.numPassedTests = 24;
      f.numPendingTests = 1;
    },
  ],
  [
    "a raw pending paired case hidden behind passing counts",
    (f: PairedFixture) => {
      f.testResults[0]!.assertionResults[0]!.status = "pending";
    },
  ],
  [
    "a missing paired case",
    (f: PairedFixture) => {
      f.testResults[0]!.assertionResults.pop();
    },
  ],
  [
    "a duplicate paired case",
    (f: PairedFixture) => {
      f.testResults[0]!.assertionResults[1]!.fullName =
        "reviewed paired case 0";
    },
  ],
  [
    "results from another paired suite",
    (f: PairedFixture) => {
      f.testResults[0]!.name = "another-file.ts";
    },
  ],
] as const)("rejects %s", (_name, mutate) => {
  const fixture = pairedFixture();
  mutate(fixture);
  expect(() => assertUnifiedOcrPairedResults(fixture)).toThrow();
});

it("validates unknown UI JSON at each receipt and nested suite boundary", () => {
  const f = uiFixture();
  for (const input of [null, [], true, "receipt", {}]) {
    expect(() =>
      assertUnifiedOcrUiResults(input, f.runtime, f.report, revision),
    ).toThrow();
    expect(() =>
      assertUnifiedOcrUiResults(f.result, input, f.report, revision),
    ).toThrow();
    expect(() =>
      assertUnifiedOcrUiResults(f.result, f.runtime, input, revision),
    ).toThrow();
  }
  expect(() =>
    assertUnifiedOcrUiResults(
      f.result,
      f.runtime,
      { errors: [], suites: [null] },
      revision,
    ),
  ).toThrow();
});

it("validates unknown paired JSON before reading nested assertions", () => {
  for (const input of [
    null,
    [],
    true,
    "receipt",
    {},
    { ...pairedFixture(), testResults: [null] },
  ])
    expect(() => assertUnifiedOcrPairedResults(input)).toThrow();
});
