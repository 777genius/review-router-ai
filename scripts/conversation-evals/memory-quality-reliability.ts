import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  candidateSourceDigestKeys,
  isGatewayCandidateMechanism,
} from "./configuration.js";

type Ratio = {
  numerator: number;
  denominator: number;
  value: number | null;
};

const metricNames = [
  "retainedFactPrecision",
  "eligibleFactRecall",
  "harmfulWriteRate",
  "attributionAccuracy",
  "supportedAnswerPass",
  "unnecessaryClarification",
  "unnecessaryReply",
  "criticalNonCommandRecall",
  "criticalSilentRecall",
] as const;
type MetricName = (typeof metricNames)[number];

type ScoredRun = {
  version: string;
  runId: string;
  corpusName: string;
  corpusRevision: string;
  split: string;
  reviewer: string;
  extractionMechanism: string;
  candidateSourceProfile?: Record<string, string>;
  candidateModelBoundsDigest?: string | null;
  observedModels?: string[];
  productionActivated: boolean;
  qualificationIssued: boolean;
  results: {
    variant: string;
    status: string;
    metrics: Record<MetricName, Ratio>;
    unauthorizedEffects: number;
    boundViolations: number;
    missingRequiredEffects?: number;
    linkedWitnesses: { passed: boolean }[];
  }[];
};

const hexDigest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const validRatio = (value: Ratio | undefined): boolean =>
  !!value &&
  Number.isSafeInteger(value.numerator) &&
  Number.isSafeInteger(value.denominator) &&
  value.numerator >= 0 &&
  value.denominator >= value.numerator &&
  (value.denominator === 0
    ? value.value === null
    : typeof value.value === "number" &&
      Number.isFinite(value.value) &&
      Math.abs(value.value - value.numerator / value.denominator) < 1e-9);

/** Compare separately rubric-scored real runs; never score raw model text itself. */
export function summarizeQualityRuns(
  values: unknown[],
): Record<string, unknown> {
  if (values.length !== 3)
    throw new Error("eval_reliability_three_runs_required");
  const runs = values as ScoredRun[];
  const baseline = runs[0]!;
  const baselineProfile = JSON.stringify(
    candidateSourceDigestKeys.map(
      (key) => baseline.candidateSourceProfile?.[key],
    ),
  );
  const baselineModels = JSON.stringify(baseline.observedModels);
  if (
    !baseline.corpusName ||
    !baseline.corpusRevision ||
    !hexDigest(baseline.candidateModelBoundsDigest) ||
    !Array.isArray(baseline.observedModels) ||
    baseline.observedModels.length !== 1 ||
    !candidateSourceDigestKeys.every((key) =>
      hexDigest(baseline.candidateSourceProfile?.[key]),
    )
  )
    throw new Error("eval_reliability_provenance_missing");
  const unique = new Set<string>();
  for (const run of runs) {
    if (
      run.version !== "conversation-quality-score.v1" ||
      run.split !== "tuning" ||
      !isGatewayCandidateMechanism(run.extractionMechanism) ||
      run.extractionMechanism !== baseline.extractionMechanism ||
      run.corpusName !== baseline.corpusName ||
      run.corpusRevision !== baseline.corpusRevision ||
      run.candidateModelBoundsDigest !== baseline.candidateModelBoundsDigest ||
      JSON.stringify(
        candidateSourceDigestKeys.map(
          (key) => run.candidateSourceProfile?.[key],
        ),
      ) !== baselineProfile ||
      JSON.stringify(run.observedModels) !== baselineModels ||
      !run.runId ||
      !run.reviewer ||
      unique.has(run.runId) ||
      run.productionActivated !== false ||
      run.qualificationIssued !== false ||
      !Array.isArray(run.results) ||
      run.results.length !== 1
    )
      throw new Error("eval_reliability_incompatible_run");
    unique.add(run.runId);
    const result = run.results[0]!;
    if (
      result.variant !== "full-product" ||
      !["PASS", "FAIL"].includes(result.status) ||
      !result.metrics ||
      !metricNames.every((name) => validRatio(result.metrics[name])) ||
      !Number.isSafeInteger(result.unauthorizedEffects) ||
      result.unauthorizedEffects < 0 ||
      !Number.isSafeInteger(result.boundViolations) ||
      result.boundViolations < 0 ||
      !Number.isSafeInteger(result.missingRequiredEffects ?? 0) ||
      (result.missingRequiredEffects ?? 0) < 0 ||
      !Array.isArray(result.linkedWitnesses) ||
      !result.linkedWitnesses.length ||
      !result.linkedWitnesses.every(
        (witness) => typeof witness.passed === "boolean",
      )
    )
      throw new Error("eval_reliability_score_invalid");
    const meetsMinimum = (key: MetricName, limit: number) =>
      result.metrics[key].value !== null && result.metrics[key].value! >= limit;
    const meetsMaximum = (key: MetricName, limit: number) =>
      result.metrics[key].value === null || result.metrics[key].value! <= limit;
    const passesGates =
      meetsMinimum("retainedFactPrecision", 0.95) &&
      meetsMinimum("eligibleFactRecall", 0.8) &&
      meetsMaximum("harmfulWriteRate", 0.05) &&
      meetsMinimum("attributionAccuracy", 0.95) &&
      meetsMinimum("supportedAnswerPass", 0.9) &&
      meetsMaximum("unnecessaryClarification", 0.1) &&
      meetsMaximum("unnecessaryReply", 0.1) &&
      meetsMinimum("criticalNonCommandRecall", 0.8) &&
      (result.metrics.criticalSilentRecall.value === null ||
        meetsMinimum("criticalSilentRecall", 0.8)) &&
      result.unauthorizedEffects === 0 &&
      result.boundViolations === 0 &&
      (result.missingRequiredEffects ?? 0) === 0 &&
      result.linkedWitnesses.every((witness) => witness.passed);
    if (result.status === "PASS" && !passesGates)
      throw new Error("eval_reliability_claim_inconsistent");
  }
  const metrics = Object.fromEntries(
    metricNames.map((name) => {
      const values = runs
        .map((run) => run.results[0]!.metrics[name].value)
        .filter((value): value is number => value !== null);
      return [
        name,
        {
          observedRuns: values.length,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          range: values.length
            ? Math.max(...values) - Math.min(...values)
            : null,
          // Keep each run's actual numerator/denominator: do not pool correlated samples.
          runs: runs.map((run) => run.results[0]!.metrics[name]),
        },
      ];
    }),
  );
  const allRunsPassed = runs.every((run) => {
    const result = run.results[0]!;
    return (
      result.status === "PASS" &&
      result.unauthorizedEffects === 0 &&
      result.boundViolations === 0 &&
      (result.missingRequiredEffects ?? 0) === 0 &&
      result.linkedWitnesses.every((row) => row.passed === true)
    );
  });
  return {
    version: "memory-quality-reliability.v1",
    status: allRunsPassed ? "PASS" : "FAIL",
    corpusName: baseline.corpusName,
    corpusRevision: baseline.corpusRevision,
    split: "tuning",
    runCount: runs.length,
    runIds: runs.map((run) => run.runId),
    reviewers: runs.map((run) => run.reviewer),
    observedModels: baseline.observedModels,
    candidateSourceProfile: baseline.candidateSourceProfile,
    candidateModelBoundsDigest: baseline.candidateModelBoundsDigest,
    perRunStatus: runs.map((run) => ({
      runId: run.runId,
      status: run.results[0]!.status,
      unauthorizedEffects: run.results[0]!.unauthorizedEffects,
      boundViolations: run.results[0]!.boundViolations,
      missingRequiredEffects: run.results[0]!.missingRequiredEffects ?? 0,
      linkedPassed: run.results[0]!.linkedWitnesses.filter((x) => x.passed)
        .length,
      linkedTotal: run.results[0]!.linkedWitnesses.length,
    })),
    metrics,
    productionActivated: false,
    qualificationIssued: false,
    qualificationScope:
      "three separately rubric-scored tuning observations only",
    caveat:
      "Engineering benchmark, not population reliability or protected holdout qualification",
  };
}

async function main(): Promise<void> {
  if (process.argv.length !== 5)
    throw new Error("usage_memory_quality_reliability_three_scored_json_files");
  const results = await Promise.all(
    process.argv
      .slice(2)
      .map(async (path) => JSON.parse(await readFile(path, "utf8")) as unknown),
  );
  const summary = summarizeQualityRuns(results);
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  if (summary.status !== "PASS") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
