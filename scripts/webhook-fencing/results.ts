import { z } from "zod";
export const webhookFencePostgresSuites = [
  "packages/features/github-installations/src/tests/webhook-effect-fence.postgres.test.ts",
  "packages/features/github-installations/src/tests/webhook-recovery-custody.postgres.test.ts",
  "packages/features/github-installations/src/tests/fenced-installation-webhook.postgres.test.ts",
  "apps/api/src/github/fenced-app-authorization.postgres.test.ts",
  "apps/api/src/github/fenced-pull-request-composite.postgres.test.ts",
  "apps/api/src/github/fenced-push-webhook.postgres.test.ts",
  "apps/api/src/github/fenced-repository-webhook.postgres.test.ts",
  "apps/api/src/github/fenced-setup-pull-request.postgres.test.ts",
  "apps/api/src/github/github-app-webhook-recovery-authority.postgres.test.ts",
  "scripts/webhook-fencing/migrations.postgres.test.ts",
  "apps/api/src/github/github-webhook-production.postgres.test.ts",
] as const;
const reportSchema = z.object({
  success: z.literal(true), numTotalTests: z.number().int().positive(), numPassedTests: z.number().int().positive(),
  numFailedTests: z.literal(0), numPendingTests: z.literal(0), numTodoTests: z.literal(0),
  testResults: z.array(z.object({name: z.string(), status: z.literal("passed"), assertionResults: z.array(z.object({status: z.literal("passed")})).min(1)})),
});
export function assertWebhookFencePostgresResults(input: unknown) {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) throw new Error("webhook_fence_postgres_results_not_passed");
  const report = parsed.data;
  if (report.testResults.length !== webhookFencePostgresSuites.length || webhookFencePostgresSuites.some((path) => report.testResults.filter((suite) => suite.name.replaceAll("\\", "/").endsWith(`/${path}`)).length !== 1))
    throw new Error("webhook_fence_postgres_required_suites_missing");
  const executed = report.testResults.reduce((total, suite) => total + suite.assertionResults.length, 0);
  if (report.numTotalTests !== executed || report.numPassedTests !== executed) throw new Error("webhook_fence_postgres_result_counts_inconsistent");
  return {executed, passed: executed, skipped: 0 as const};
}

export function combineWebhookFencePostgresResults(reports: unknown[]) {
  const parsed = reports.map((report) => reportSchema.parse(report));
  return assertWebhookFencePostgresResults({
    success: parsed.every((report) => report.success),
    numTotalTests: parsed.reduce((total, report) => total + report.numTotalTests, 0),
    numPassedTests: parsed.reduce((total, report) => total + report.numPassedTests, 0),
    numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    testResults: parsed.flatMap((report) => report.testResults),
  });
}
