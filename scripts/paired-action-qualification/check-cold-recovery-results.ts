import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const fullName =
  "runs the compiled entrypoint through real API/SQL with accepted-result-recovery Gateway allocations";
const assertionSchema = z.object({
  fullName: z.string().max(4096),
  status: z.string().max(32),
});
const suiteSchema = z.object({
  name: z.string().max(4096),
  status: z.string().max(32),
  assertionResults: z.array(assertionSchema).max(10_000),
});
const reportSchema = z.object({
  success: z.literal(true),
  numFailedTests: z.literal(0),
  testResults: z.array(suiteSchema).max(1024),
});
const receiptSchema = z.object({
  scenario: z.literal("accepted-result-recovery"),
  nodeVersion: z.string().max(64),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

function readJson(file: string): unknown {
  const bytes = readFileSync(file);
  if (bytes.byteLength > 16 * 1024 * 1024)
    throw new Error("paired_cold_result_too_large");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("paired_cold_result_json_invalid");
  }
}

const [reportPath, receiptPath] = process.argv.slice(2);
if (process.argv.length !== 4 || !reportPath || !receiptPath)
  throw new Error("paired_cold_result_paths_required");
const parsed = reportSchema.safeParse(readJson(reportPath));
if (!parsed.success) throw new Error("paired_cold_report_not_passed");
const suites = parsed.data.testResults.filter(
  (suite) =>
    resolve(suite.name) ===
    resolve("apps/api/src/gateway-multi-reviewers-paired.e2e.test.ts"),
);
const [suite] = suites;
if (suites.length !== 1 || !suite || suite.status !== "passed")
  throw new Error("paired_cold_suite_not_passed");
const selected = suite.assertionResults.filter(
  (result) => result.fullName === fullName,
);
if (selected.length !== 1 || selected[0]?.status !== "passed")
  throw new Error("paired_cold_selected_case_not_passed");
const receipt = receiptSchema.safeParse(readJson(receiptPath));
if (!receipt.success || receipt.data.nodeVersion !== process.version)
  throw new Error("paired_cold_receipt_invalid");
console.log(
  JSON.stringify({
    acceptedSourceCold: "passed",
    selectedPassed: 1,
    selectedSkipped: 0,
    nodeVersion: receipt.data.nodeVersion,
    saasSha: process.env.GITHUB_SHA,
    actionSha: process.env.REVIEW_ROUTER_PAIRED_ACTION_REF,
    artifactDigest: receipt.data.artifactDigest,
  }),
);
