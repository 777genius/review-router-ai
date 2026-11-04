import { describe, expect, it } from "vitest";
import { assertProviderSetupPostgresResults } from "./check-provider-setup-postgres-results.js";

function passingReport() {
  return {
    success: true,
    numTotalTests: 8,
    numPassedTests: 8,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: "/checkout/apps/web/src/server/codex-runtime-migration.postgres.test.ts",
        status: "passed",
        assertionResults: Array.from({ length: 3 }, () => ({
          status: "passed",
        })),
      },
      {
        name: "/checkout/scripts/locked-provider.pg17.real.test.ts",
        status: "passed",
        assertionResults: Array.from({ length: 5 }, () => ({
          status: "passed",
        })),
      },
    ],
  };
}

describe("provider setup PostgreSQL result gate", () => {
  it("accepts both complete suites with eight executed passing assertions", () => {
    expect(assertProviderSetupPostgresResults(passingReport())).toEqual({
      executed: 8,
      passed: 8,
      skipped: 0,
    });
  });

  it.each(["skipped", "pending", "todo", "failed"])(
    "rejects a %s assertion even if the aggregate still claims success",
    (status) => {
      const report = passingReport();
      report.testResults[1]!.assertionResults[0]!.status = status;
      expect(() => assertProviderSetupPostgresResults(report)).toThrow();
    },
  );

  it.each(["numPendingTests", "numTodoTests", "numFailedTests"] as const)(
    "rejects a nonzero %s aggregate",
    (field) => {
      const report = passingReport();
      report[field] = 1;
      expect(() => assertProviderSetupPostgresResults(report)).toThrow();
    },
  );

  it("rejects an omitted suite and a replacement with a duplicate suite", () => {
    const report = passingReport();
    report.testResults.pop();
    expect(() => assertProviderSetupPostgresResults(report)).toThrow();
    report.testResults.push(structuredClone(report.testResults[0]!));
    expect(() => assertProviderSetupPostgresResults(report)).toThrow();
  });

  it("rejects a missing required case even when totals are reduced to match", () => {
    const report = passingReport();
    report.testResults[1]!.assertionResults.pop();
    report.numTotalTests--;
    report.numPassedTests--;
    expect(() => assertProviderSetupPostgresResults(report)).toThrow();
  });

  it("rejects inconsistent totals and malformed or unsuccessful reports", () => {
    const report = passingReport();
    report.numPassedTests = 7;
    expect(() => assertProviderSetupPostgresResults(report)).toThrow();
    expect(() => assertProviderSetupPostgresResults(null)).toThrow();
    expect(() =>
      assertProviderSetupPostgresResults({
        ...passingReport(),
        success: false,
      }),
    ).toThrow();
  });
});
