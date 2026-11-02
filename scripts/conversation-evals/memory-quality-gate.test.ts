import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCorpus } from "./corpus.js";
import {
  assertLiveTuningPreflight,
  assertObservedTuningReport,
  qualityCorpora,
} from "./memory-quality-gate.js";
import { gatewayCandidateMechanism, candidateSourceDigestKeys } from "./configuration.js";

const qualifiedSyntheticConfiguration = () => ({
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  CONVERSATION_EVAL_OPERATOR_ACK: "APPROVED_ISOLATED_QUALITY_EVAL",
  CONVERSATION_EVAL_LIVE: "1",
  CONVERSATION_EVAL_DISPOSABLE: "1",
  CONVERSATION_EVAL_DATABASE_URL:
    "postgresql://fixture@127.0.0.1:5432/reviewrouter_memory_quality_test",
  REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://127.0.0.1:9100",
  REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY: "SYNTHETIC_DO_NOT_USE",
  REVIEW_ROUTER_MEMORY_NAMESPACE: "eval_memory_quality",
  REVIEW_ROUTER_MEMORY_GENERATION: "eval_memory_quality_generation",
  REVIEW_ROUTER_MEMORY_PROVIDER: "hindsight",
  REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: "hindsight-v1.1.0-chunks-v1",
  CONVERSATION_EVAL_TEMPLATE_WORKSPACE_ID: "synthetic_workspace",
  CONVERSATION_EVAL_TEMPLATE_REPOSITORY_ID: "synthetic_repository",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: "https://gateway.invalid",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER: "SYNTHETIC_DO_NOT_USE",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: "SYNTHETIC_DO_NOT_USE",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: "SYNTHETIC_DO_NOT_USE",
  CONVERSATION_EVAL_MODEL_BOUNDS_JSON: JSON.stringify([
    { profileId: "synthetic", model: "synthetic", contextWindowTokens: 32768, tokensPerByteUpperBound: 4 },
  ]),
});

test("all fixed corpora retain separate immutable inventories and nonleaking protected facts", async () => {
  const expected = {
    "legacy-v1": { threads: 48, events: 149, tuning: 32, holdout: 16, pairs: 8 },
    "full-thread-v2": { threads: 16, events: 50, tuning: 10, holdout: 6, pairs: 4 },
    "multilingual-v1": { threads: 10, events: 14, tuning: 4, holdout: 6, pairs: 3 },
  } as const;
  for (const name of qualityCorpora) {
    const corpus = await loadCorpus(name);
    const profile = expected[name];
    assert.equal(corpus.threads.length, profile.threads);
    assert.equal(corpus.threads.reduce((sum, t) => sum + t.events.length, 0), profile.events);
    assert.equal(corpus.threads.filter((t) => t.split === "tuning").length, profile.tuning);
    assert.equal(corpus.threads.filter((t) => t.split === "holdout").length, profile.holdout);
    assert.equal(corpus.threads.filter((t) => t.linked && t.phase === "A").length, profile.pairs);
    const threadSplit = new Map(corpus.threads.map((t) => [t.id, t.split]));
    const training = new Set(corpus.facts.filter((f) => threadSplit.get(f.threadId) === "tuning").map((f) => f.text.toLocaleLowerCase()));
    const protectedFacts = corpus.facts.filter((f) => threadSplit.get(f.threadId) === "holdout");
    for (const fact of protectedFacts) assert.equal(training.has(fact.text.toLocaleLowerCase()), false);
  }
  const multilingual = await loadCorpus("multilingual-v1");
  assert(multilingual.threads.some((t) => t.split === "tuning" && t.language === "ru"));
  assert(multilingual.threads.some((t) => t.split === "holdout" && t.language === "ru+en"));
  assert(multilingual.threads.some((t) => t.events.some((e) => e.snapshot?.changes.some((c) => c.body))));
  assert(multilingual.threads.some((t) => t.scenario === "mixed-repo" && t.repositoryKey === "billing"));
  assert(multilingual.threads.some((t) => t.scenario === "mixed-repo" && t.repositoryKey === "analytics"));
});

test("live tuning preflight enforces approved main, three independent isolation boundaries and actual configured model", () => {
  const env = qualifiedSyntheticConfiguration();
  assert.doesNotThrow(() => assertLiveTuningPreflight(env, "multilingual-v1"));
  const reject = (changes: Record<string, string | undefined>, reason: RegExp) =>
    assert.throws(
      () => assertLiveTuningPreflight({ ...env, ...changes }, "multilingual-v1"),
      reason,
    );
  reject({ GITHUB_EVENT_NAME: "pull_request" }, /eval_operator_approval_required/);
  reject({ GITHUB_REF: "refs/heads/feature" }, /eval_operator_approval_required/);
  reject({ CONVERSATION_EVAL_OPERATOR_ACK: "" }, /eval_operator_approval_required/);
  reject({ CONVERSATION_EVAL_LIVE: "0" }, /eval_live_tuning_only/);
  reject({ CONVERSATION_EVAL_DISPOSABLE: "0" }, /eval_live_tuning_only/);
  reject({ CONVERSATION_EVAL_HOLDOUT_CHECKPOINT_ID: "already-consumed" }, /eval_live_tuning_only/);
  reject({ CONVERSATION_EVAL_PRODUCTION_ACTIVATION: "1" }, /eval_live_tuning_only/);
  reject({ REVIEW_ROUTER_MEMORY_PROVIDER: "disabled" }, /eval_live_tuning_only/);
  reject({ REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: "" }, /eval_live_tuning_only/);
  reject({ CONVERSATION_EVAL_DATABASE_URL: "postgresql://fixture@production.internal/real" }, /eval_isolated_endpoint_required/);
  reject({ CONVERSATION_EVAL_DATABASE_URL: "postgresql://fixture@127.0.0.1:5432/production" }, /eval_isolated_endpoint_required/);
  reject({ REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "https://hindsight.production.internal" }, /eval_isolated_endpoint_required/);
  reject({ REVIEW_ROUTER_MEMORY_NAMESPACE: "production_memory" }, /eval_requires_dedicated_native_namespace_and_generation/);
  reject({ REVIEW_ROUTER_MEMORY_GENERATION: "production" }, /eval_requires_dedicated_native_namespace_and_generation/);
  reject({ REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER: "" }, /eval_live_configuration_missing/);
  reject({ CONVERSATION_EVAL_MODEL_BOUNDS_JSON: "[]" }, /eval_candidate_model_bounds_invalid/);
  assert.throws(() => assertLiveTuningPreflight(env, "unreviewed-corpus"), /eval_corpus_unknown/);
});

const validObservedReport = () => ({
  status: "AWAITING_HUMAN_RUBRIC",
  runId: "synthetic-run-1",
  corpusRevision: "synthetic-revision",
  corpusName: "multilingual-v1",
  split: "tuning",
  holdoutCheckpoint: null,
  profile: {
    extractionMechanism: gatewayCandidateMechanism,
    ...Object.fromEntries(candidateSourceDigestKeys.map((key) => [key, "a".repeat(64)])),
  },
  variants: [{ variant: "full-product", status: "AWAITING_HUMAN_RUBRIC", scenarios: [{ scenario: "synthetic" }] }],
});

test("a model observation is NEVER a quality PASS without independent human rubric", () => {
  const report = validObservedReport();
  assert.deepEqual(assertObservedTuningReport(report, "multilingual-v1"), {
    runId: "synthetic-run-1",
    revision: "synthetic-revision",
  });
  const bad = (change: Record<string, unknown>) =>
    assert.throws(() => assertObservedTuningReport({ ...report, ...change }, "multilingual-v1"), /eval_observation_not_qualified/);
  bad({ status: "PASS" });
  bad({ status: "UNAVAILABLE" });
  bad({ split: "holdout" });
  bad({ holdoutCheckpoint: "protected-1" });
  bad({ qualificationEligible: false });
  bad({ diagnosticScenario: "one-easy-case" });
  bad({ corpusName: "legacy-v1" });
  bad({ profile: { extractionMechanism: "historical-native-preview" } });
  bad({ variants: [{ variant: "full-product", status: "AWAITING_HUMAN_RUBRIC", scenarios: [] }] });
  bad({ variants: [{ variant: "full-product", status: "UNAVAILABLE", scenarios: [{ scenario: "synthetic" }] }] });
});

test("the focused workflow never gives PR jobs live credentials or runs protected holdout", async () => {
  const workflow = await readFile(".github/workflows/memory-quality-evals.yml", "utf8");
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: memory-quality-eval/);
  assert.match(workflow, /--split tuning --variant full-product/);
  assert.doesNotMatch(workflow, /--split holdout/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /if:.*workflow_dispatch.*live-tuning.*refs\/heads\/main/);
});
