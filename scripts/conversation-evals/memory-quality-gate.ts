import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  assertEvaluationNativeScope,
  evaluationMissingKeys,
  gatewayCandidateMechanism,
  readCandidateModels,
  candidateSourceDigestKeys,
} from "./configuration.js";
import type { CorpusName } from "./corpus.js";

export const qualityCorpora = [
  "legacy-v1",
  "full-thread-v2",
  "multilingual-v1",
] as const satisfies readonly CorpusName[];

const loopback = (value: string, suffix: string): void => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("eval_isolated_endpoint_invalid");
  }
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    (suffix !== "" && !url.pathname.endsWith(suffix))
  )
    throw new Error("eval_isolated_endpoint_required");
};

/** Requires trusted main-only workflow execution and an independently isolated native deployment. */
export function assertLiveTuningPreflight(
  env: Readonly<Record<string, string | undefined>>,
  corpus: string,
): asserts corpus is CorpusName {
  if (
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.CONVERSATION_EVAL_OPERATOR_ACK !== "APPROVED_ISOLATED_QUALITY_EVAL"
  )
    throw new Error("eval_operator_approval_required");
  if (!qualityCorpora.some((name) => name === corpus))
    throw new Error("eval_corpus_unknown");
  if (
    env.CONVERSATION_EVAL_LIVE !== "1" ||
    env.CONVERSATION_EVAL_DISPOSABLE !== "1" ||
    env.CONVERSATION_EVAL_HOLDOUT_CHECKPOINT_ID ||
    env.CONVERSATION_EVAL_PRODUCTION_ACTIVATION ||
    env.REVIEW_ROUTER_MEMORY_PROVIDER !== "hindsight" ||
    env.REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE !==
      "hindsight-v1.1.0-chunks-v1"
  )
    throw new Error("eval_live_tuning_only");
  const database = env.CONVERSATION_EVAL_DATABASE_URL;
  const native = env.REVIEW_ROUTER_MEMORY_HINDSIGHT_URL;
  if (!database || !native) throw new Error("eval_isolated_services_required");
  loopback(database, "_test");
  loopback(native, "");
  assertEvaluationNativeScope(env as NodeJS.ProcessEnv);
  if (evaluationMissingKeys("full-product", env as NodeJS.ProcessEnv).length)
    throw new Error("eval_live_configuration_missing");
  // The actual account/model are captured by the existing trusted candidate constructor.
  readCandidateModels(env.CONVERSATION_EVAL_MODEL_BOUNDS_JSON);
}

/** A complete mechanism observation is NOT a model-quality PASS; human rubric is mandatory. */
export function assertObservedTuningReport(
  value: unknown,
  corpus: CorpusName,
): { runId: string; revision: string } {
  if (!value || typeof value !== "object")
    throw new Error("eval_observation_missing");
  const report = value as Record<string, unknown>;
  const variants = report.variants;
  const profile = report.profile as Record<string, unknown> | null;
  if (
    report.status !== "AWAITING_HUMAN_RUBRIC" ||
    report.corpusName !== corpus ||
    report.split !== "tuning" ||
    report.holdoutCheckpoint != null ||
    report.qualificationEligible === false ||
    report.diagnosticScenario !== undefined ||
    typeof report.runId !== "string" ||
    !report.runId ||
    typeof report.corpusRevision !== "string" ||
    !report.corpusRevision ||
    !profile ||
    profile.extractionMechanism !== gatewayCandidateMechanism ||
    !candidateSourceDigestKeys.every(
      (key) => typeof profile[key] === "string" && /^[a-f0-9]{64}$/.test(profile[key] as string),
    ) ||
    !Array.isArray(variants) ||
    variants.length !== 1 ||
    variants[0]?.variant !== "full-product" ||
    variants[0]?.status !== "AWAITING_HUMAN_RUBRIC" ||
    !Array.isArray(variants[0]?.scenarios) ||
    variants[0].scenarios.length === 0
  )
    throw new Error("eval_observation_not_qualified");
  return { runId: report.runId, revision: report.corpusRevision as string };
}

async function main(): Promise<void> {
  const [operation, corpus, path] = process.argv.slice(2);
  if (operation === "preflight") {
    assertLiveTuningPreflight(process.env, corpus ?? "");
    process.stdout.write("memory-quality live tuning: preflight accepted, no inference performed\n");
    return;
  }
  if (operation === "inspect" && path) {
    if (!qualityCorpora.some((name) => name === corpus))
      throw new Error("eval_corpus_unknown");
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    const result = assertObservedTuningReport(raw, corpus as CorpusName);
    process.stdout.write(
      JSON.stringify({ status: "AWAITING_HUMAN_RUBRIC", ...result }) + "\n",
    );
    return;
  }
  throw new Error("usage_memory_quality_gate_preflight_or_inspect");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
