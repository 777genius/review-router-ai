import { describe, expect, it } from "vitest";
import { webhookFencePostgresConfig } from "./postgres-fixture";
import {
  assertWebhookFencePostgresResults,
  combineWebhookFencePostgresResults,
  webhookFencePostgresSuites,
} from "./results";
function passingReport() {
  return {
    success: true,
    numTotalTests: webhookFencePostgresSuites.length,
    numPassedTests: webhookFencePostgresSuites.length,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: webhookFencePostgresSuites.map((path) => ({
      name: `/checkout/${path}`,
      status: "passed",
      assertionResults: [{ status: "passed" }],
    })),
  };
}
describe("webhook PostgreSQL qualification boundary", () => {
  it("ignores the application's database URL and permits an explicit local fixture", () => {
    expect(
      webhookFencePostgresConfig({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://production/prod",
      }).enabled,
    ).toBe(false);
    expect(
      webhookFencePostgresConfig({
        NODE_ENV: "test",
        REVIEW_ROUTER_WEBHOOK_FENCE_TEST_DATABASE_URL:
          "postgresql://postgres@127.0.0.1:5433/rr_webhook_fence_test?schema=public",
      }).enabled,
    ).toBe(true);
  });
  it.each([
    "postgresql://production/rr_webhook_fence_test",
    "postgresql://127.0.0.1/production",
    "postgresql://127.0.0.1/rr_webhook_fence_test?host=production",
  ])("rejects an unsafe fixture URL %s", (value) => {
    expect(() =>
      webhookFencePostgresConfig({
        NODE_ENV: "test",
        REVIEW_ROUTER_WEBHOOK_FENCE_TEST_DATABASE_URL: value,
      }),
    ).toThrow();
  });
  it("accepts complete, executed passing suites", () => {
    expect(assertWebhookFencePostgresResults(passingReport()).skipped).toBe(0);
  });
  it("requires every suite when combining separate test processes", () => {
    const reports = passingReport().testResults.map((suite) => ({
      ...passingReport(),
      numTotalTests: 1,
      numPassedTests: 1,
      testResults: [suite],
    }));
    expect(combineWebhookFencePostgresResults(reports)).toEqual({
      executed: reports.length,
      passed: reports.length,
      skipped: 0,
    });
    expect(() => combineWebhookFencePostgresResults(reports.slice(1))).toThrow(
      "webhook_fence_postgres_required_suites_missing",
    );
  });
  it.each(["skipped", "pending", "todo", "failed"])(
    "rejects %s even with a successful aggregate",
    (status) => {
      const report = passingReport();
      report.testResults[0]!.assertionResults[0]!.status = status;
      expect(() => assertWebhookFencePostgresResults(report)).toThrow();
    },
  );
  it("rejects a missing suite even if counters are adjusted", () => {
    const report = passingReport();
    report.testResults.pop();
    report.numTotalTests--;
    report.numPassedTests--;
    expect(() => assertWebhookFencePostgresResults(report)).toThrow();
  });
});
