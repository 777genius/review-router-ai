import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

// These exact suites qualify the relocated setup persistence against PostgreSQL.
// A successful Vitest process with skipped or missing cases is not this proof.
const requiredSuites = [
  {
    path: "apps/web/src/server/codex-runtime-migration.postgres.test.ts",
    tests: 3,
  },
  { path: "scripts/locked-provider.pg17.real.test.ts", tests: 5 },
] as const;
const count = z.number().int().nonnegative();
const reportSchema = z.object({
  success: z.literal(true),
  numTotalTests: count,
  numPassedTests: count,
  numFailedTests: z.literal(0),
  numPendingTests: z.literal(0),
  numTodoTests: z.literal(0),
  testResults: z.array(
    z.object({
      name: z.string(),
      status: z.literal("passed"),
      assertionResults: z.array(z.object({ status: z.literal("passed") })),
    }),
  ),
});

export function assertProviderSetupPostgresResults(input: unknown): {
  executed: number;
  passed: number;
  skipped: 0;
} {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("provider_setup_postgres_results_not_passed");
  }
  const report = parsed.data;
  if (report.testResults.length !== requiredSuites.length) {
    throw new Error("provider_setup_postgres_required_suites_missing");
  }
  for (const required of requiredSuites) {
    const matches = report.testResults.filter((suite) => {
      const path = suite.name.replaceAll("\\", "/");
      return path === required.path || path.endsWith(`/${required.path}`);
    });
    if (
      matches.length !== 1 ||
      matches[0]!.assertionResults.length !== required.tests
    ) {
      throw new Error("provider_setup_postgres_required_cases_missing");
    }
  }
  const expectedTests = requiredSuites.reduce(
    (total, suite) => total + suite.tests,
    0,
  );
  if (
    report.numTotalTests !== expectedTests ||
    report.numPassedTests !== expectedTests
  ) {
    throw new Error("provider_setup_postgres_result_counts_inconsistent");
  }
  return { executed: expectedTests, passed: expectedTests, skipped: 0 };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv.length !== 3 || !process.argv[2]) {
    throw new Error("usage: check-provider-setup-postgres-results.ts <report>");
  }
  const report: unknown = JSON.parse(readFileSync(process.argv[2], "utf8"));
  console.log(JSON.stringify(assertProviderSetupPostgresResults(report)));
}
