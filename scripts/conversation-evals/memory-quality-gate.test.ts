import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCorpus } from "./corpus.js";
import {
  assertLiveTuningPreflight,
  assertObservedTuningReport,
  qualityCorpora,
} from "./memory-quality-gate.js";
import {
  gatewayCandidateMechanism,
  candidateSourceDigestKeys,
} from "./configuration.js";
import { summarizeQualityRuns } from "./memory-quality-reliability.js";

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
    {
      profileId: "synthetic",
      model: "synthetic",
      contextWindowTokens: 32768,
      tokensPerByteUpperBound: 4,
    },
  ]),
});

test("all fixed corpora retain separate immutable inventories and nonleaking protected facts", async () => {
  const expected = {
    "legacy-v1": {
      threads: 48,
      events: 149,
      tuning: 32,
      holdout: 16,
      pairs: 8,
    },
    "full-thread-v2": {
      threads: 16,
      events: 50,
      tuning: 10,
      holdout: 6,
      pairs: 4,
    },
    "multilingual-v1": {
      threads: 10,
      events: 14,
      tuning: 4,
      holdout: 6,
      pairs: 3,
    },
  } as const;
  for (const name of qualityCorpora) {
    const corpus = await loadCorpus(name);
    const profile = expected[name];
    assert.equal(corpus.threads.length, profile.threads);
    assert.equal(
      corpus.threads.reduce((sum, t) => sum + t.events.length, 0),
      profile.events,
    );
    assert.equal(
      corpus.threads.filter((t) => t.split === "tuning").length,
      profile.tuning,
    );
    assert.equal(
      corpus.threads.filter((t) => t.split === "holdout").length,
      profile.holdout,
    );
    assert.equal(
      corpus.threads.filter((t) => t.linked && t.phase === "A").length,
      profile.pairs,
    );
    const threadSplit = new Map(corpus.threads.map((t) => [t.id, t.split]));
    const training = new Set(
      corpus.facts
        .filter((f) => threadSplit.get(f.threadId) === "tuning")
        .map((f) => f.text.toLocaleLowerCase()),
    );
    const protectedFacts = corpus.facts.filter(
      (f) => threadSplit.get(f.threadId) === "holdout",
    );
    for (const fact of protectedFacts)
      assert.equal(training.has(fact.text.toLocaleLowerCase()), false);
  }
  const multilingual = await loadCorpus("multilingual-v1");
  assert(
    multilingual.threads.some(
      (t) => t.split === "tuning" && t.language === "ru",
    ),
  );
  assert(
    multilingual.threads.some(
      (t) => t.split === "holdout" && t.language === "ru+en",
    ),
  );
  assert(
    multilingual.threads.some((t) =>
      t.events.some((e) => e.snapshot?.changes.some((c) => c.body)),
    ),
  );
  assert(
    multilingual.threads.some(
      (t) => t.scenario === "mixed-repo" && t.repositoryKey === "billing",
    ),
  );
  assert(
    multilingual.threads.some(
      (t) => t.scenario === "mixed-repo" && t.repositoryKey === "analytics",
    ),
  );
});

test("live tuning preflight enforces approved main, three independent isolation boundaries and actual configured model", () => {
  const env = qualifiedSyntheticConfiguration();
  assert.doesNotThrow(() => assertLiveTuningPreflight(env, "multilingual-v1"));
  const reject = (
    changes: Record<string, string | undefined>,
    reason: RegExp,
  ) =>
    assert.throws(
      () =>
        assertLiveTuningPreflight({ ...env, ...changes }, "multilingual-v1"),
      reason,
    );
  reject(
    { GITHUB_EVENT_NAME: "pull_request" },
    /eval_operator_approval_required/,
  );
  reject(
    { GITHUB_REF: "refs/heads/feature" },
    /eval_operator_approval_required/,
  );
  reject(
    { CONVERSATION_EVAL_OPERATOR_ACK: "" },
    /eval_operator_approval_required/,
  );
  reject({ CONVERSATION_EVAL_LIVE: "0" }, /eval_live_tuning_only/);
  reject({ CONVERSATION_EVAL_DISPOSABLE: "0" }, /eval_live_tuning_only/);
  reject(
    { CONVERSATION_EVAL_HOLDOUT_CHECKPOINT_ID: "already-consumed" },
    /eval_live_tuning_only/,
  );
  reject(
    { CONVERSATION_EVAL_PRODUCTION_ACTIVATION: "1" },
    /eval_live_tuning_only/,
  );
  reject(
    { REVIEW_ROUTER_MEMORY_PROVIDER: "disabled" },
    /eval_live_tuning_only/,
  );
  reject(
    { REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: "" },
    /eval_live_tuning_only/,
  );
  reject(
    {
      CONVERSATION_EVAL_DATABASE_URL:
        "postgresql://fixture@production.internal/real",
    },
    /eval_isolated_endpoint_required/,
  );
  reject(
    {
      CONVERSATION_EVAL_DATABASE_URL:
        "postgresql://fixture@127.0.0.1:5432/production",
    },
    /eval_isolated_endpoint_required/,
  );
  reject(
    {
      CONVERSATION_EVAL_DATABASE_URL:
        "postgresql://fixture@127.0.0.1:5432/cache_test?host=production.internal&port=6543",
    },
    /eval_isolated_endpoint_required/,
  );
  reject(
    {
      CONVERSATION_EVAL_DATABASE_URL:
        "postgresql://fixture@127.0.0.1:5432/cache_test?host=%2Fvar%2Frun%2Fpostgresql",
    },
    /eval_isolated_endpoint_required/,
  );
  reject(
    {
      CONVERSATION_EVAL_DATABASE_URL:
        "postgresql://fixture@127.0.0.1:5432/cache_test#hidden",
    },
    /eval_isolated_endpoint_required/,
  );
  reject(
    {
      REVIEW_ROUTER_MEMORY_HINDSIGHT_URL:
        "https://hindsight.production.internal",
    },
    /eval_isolated_endpoint_required/,
  );
  reject(
    { REVIEW_ROUTER_MEMORY_NAMESPACE: "production_memory" },
    /eval_requires_dedicated_native_namespace_and_generation/,
  );
  reject(
    { REVIEW_ROUTER_MEMORY_GENERATION: "production" },
    /eval_requires_dedicated_native_namespace_and_generation/,
  );
  reject(
    { REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER: "" },
    /eval_live_configuration_missing/,
  );
  reject(
    { CONVERSATION_EVAL_MODEL_BOUNDS_JSON: "[]" },
    /eval_candidate_model_bounds_invalid/,
  );
  assert.throws(
    () => assertLiveTuningPreflight(env, "unreviewed-corpus"),
    /eval_corpus_unknown/,
  );
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
    ...Object.fromEntries(
      candidateSourceDigestKeys.map((key) => [key, "a".repeat(64)]),
    ),
  },
  variants: [
    {
      variant: "full-product",
      status: "AWAITING_HUMAN_RUBRIC",
      scenarios: [{ scenario: "synthetic" }],
    },
  ],
});

test("a model observation is NEVER a quality PASS without independent human rubric", () => {
  const report = validObservedReport();
  assert.deepEqual(assertObservedTuningReport(report, "multilingual-v1"), {
    runId: "synthetic-run-1",
    revision: "synthetic-revision",
  });
  const bad = (change: Record<string, unknown>) =>
    assert.throws(
      () =>
        assertObservedTuningReport({ ...report, ...change }, "multilingual-v1"),
      /eval_observation_not_qualified/,
    );
  bad({ status: "PASS" });
  bad({ status: "UNAVAILABLE" });
  bad({ split: "holdout" });
  bad({ holdoutCheckpoint: "protected-1" });
  bad({ qualificationEligible: false });
  bad({ diagnosticScenario: "one-easy-case" });
  bad({ corpusName: "legacy-v1" });
  bad({ profile: { extractionMechanism: "historical-native-preview" } });
  bad({
    variants: [
      {
        variant: "full-product",
        status: "AWAITING_HUMAN_RUBRIC",
        scenarios: [],
      },
    ],
  });
  bad({
    variants: [
      {
        variant: "full-product",
        status: "UNAVAILABLE",
        scenarios: [{ scenario: "synthetic" }],
      },
    ],
  });
});

test("the focused workflow never gives PR jobs live credentials or runs protected holdout", async () => {
  const workflow = await readFile(
    ".github/workflows/memory-quality-evals.yml",
    "utf8",
  );
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: memory-quality-eval/);
  assert.match(workflow, /--split tuning --variant full-product/);
  assert.doesNotMatch(workflow, /--split holdout/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(
    workflow,
    /if:.*workflow_dispatch.*live-tuning.*refs\/heads\/main/,
  );
  assert.match(workflow, /EVAL_CORPUS: \$\{\{ inputs\.corpus \}\}/);
  assert.doesNotMatch(workflow, /--corpus "\$\{\{ inputs\.corpus/);
  assert.doesNotMatch(workflow, /preflight "\$\{\{ inputs\.corpus/);
  assert.doesNotMatch(workflow, /inspect "\$\{\{ inputs\.corpus/);
  assert.match(workflow, /MEMORY_EVAL_PRIVATE_RESULTS_DIR/);
  assert.match(
    workflow,
    /Verify operator-owned private evidence storage before paid inference/,
  );
  assert.match(workflow, /install -m 0600/);
  assert.doesNotMatch(workflow, /actions\/upload-artifact@/);
  const liveJob = workflow.split("\n  live-tuning:\n")[1]!;
  const jobSettings = liveJob.split("\n    steps:\n")[0]!;
  const installStep = liveJob
    .split(
      "      - name: Install pinned dependencies and generate existing Prisma client",
    )[1]!
    .split("      - name: Assert private operator authorization")[0]!;
  assert.doesNotMatch(jobSettings, /secrets\.[A-Z]/);
  assert.doesNotMatch(installStep, /secrets\.[A-Z]/);
  assert.match(
    liveJob,
    /CONVERSATION_EVAL_OPERATOR_ACK:.*secrets\.MEMORY_EVAL_OPERATOR_ACK/,
  );
  assert.match(
    liveJob,
    /REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY:.*secrets\.MEMORY_EVAL_HINDSIGHT_API_KEY/,
  );
});

test("three independent human-scored runs expose variation without fabricated semantic reliability", () => {
  const metric = (a: number, b: number) => ({
    numerator: a,
    denominator: b,
    value: a / b,
  });
  const metrics = {
    retainedFactPrecision: metric(19, 20),
    eligibleFactRecall: metric(8, 10),
    harmfulWriteRate: metric(0, 10),
    attributionAccuracy: metric(19, 20),
    supportedAnswerPass: metric(9, 10),
    unnecessaryClarification: metric(0, 10),
    unnecessaryReply: metric(0, 10),
    criticalNonCommandRecall: metric(8, 10),
    criticalSilentRecall: metric(8, 10),
  };
  const provenance = Object.fromEntries(
    candidateSourceDigestKeys.map((key) => [key, "a".repeat(64)]),
  );
  const scored = (id: string) => ({
    version: "conversation-quality-score.v1",
    runId: id,
    corpusRevision: "2026-11-02-multilingual-r1",
    corpusName: "multilingual-v1",
    split: "tuning",
    reviewer: "synthetic-human-rubric-reference",
    extractionMechanism: gatewayCandidateMechanism,
    candidateSourceProfile: { ...provenance },
    candidateModelBoundsDigest: "b".repeat(64),
    observedModels: ["actual-model-id"],
    productionActivated: false,
    qualificationIssued: false,
    results: [
      {
        variant: "full-product",
        status: "PASS",
        metrics: structuredClone(metrics),
        unauthorizedEffects: 0,
        boundViolations: 0,
        missingRequiredEffects: 0,
        linkedWitnesses: [{ passed: true }],
      },
    ],
  });
  const runs = [
    scored("observed-1"),
    scored("observed-2"),
    scored("observed-3"),
  ];
  const summary = summarizeQualityRuns(runs);
  assert.equal(summary.status, "PASS");
  assert.equal(summary.runCount, 3);
  assert.equal(
    (summary.metrics as Record<string, { min: number }>).eligibleFactRecall.min,
    0.8,
  );
  const changed = structuredClone(runs);
  changed[1]!.results[0]!.status = "FAIL";
  changed[1]!.results[0]!.metrics.eligibleFactRecall = metric(7, 10);
  const worse = summarizeQualityRuns(changed);
  assert.equal(worse.status, "FAIL");
  assert(
    Math.abs(
      (worse.metrics as Record<string, { range: number }>).eligibleFactRecall
        .range - 0.1,
    ) < 1e-9,
  );
  assert.throws(
    () => summarizeQualityRuns(runs.slice(0, 2)),
    /eval_reliability_three_runs_required/,
  );
  const duplicated = structuredClone(runs);
  duplicated[2]!.runId = "observed-1";
  assert.throws(
    () => summarizeQualityRuns(duplicated),
    /eval_reliability_incompatible_run/,
  );
  const wrongSource = structuredClone(runs);
  wrongSource[1]!.candidateSourceProfile.commonPromptSourceDigest = "c".repeat(
    64,
  );
  assert.throws(
    () => summarizeQualityRuns(wrongSource),
    /eval_reliability_incompatible_run/,
  );
  const switchedModel = structuredClone(runs);
  switchedModel[1]!.observedModels = ["different-model"];
  assert.throws(
    () => summarizeQualityRuns(switchedModel),
    /eval_reliability_incompatible_run/,
  );
  const holdout = structuredClone(runs);
  holdout[1]!.split = "holdout";
  assert.throws(
    () => summarizeQualityRuns(holdout),
    /eval_reliability_incompatible_run/,
  );
  const missingRubric = structuredClone(runs);
  missingRubric[1]!.reviewer = "";
  assert.throws(
    () => summarizeQualityRuns(missingRubric),
    /eval_reliability_incompatible_run/,
  );
  const hiddenFailure = structuredClone(runs);
  hiddenFailure[1]!.results[0]!.metrics.retainedFactPrecision = {
    numerator: 19,
    denominator: 20,
    value: 1,
  };
  assert.throws(
    () => summarizeQualityRuns(hiddenFailure),
    /eval_reliability_score_invalid/,
  );
  const falsePass = structuredClone(runs);
  falsePass[1]!.results[0]!.metrics.eligibleFactRecall = metric(1, 10);
  assert.throws(
    () => summarizeQualityRuns(falsePass),
    /eval_reliability_claim_inconsistent/,
  );
  const negativeEffects = structuredClone(runs);
  negativeEffects[1]!.results[0]!.unauthorizedEffects = -1;
  assert.throws(
    () => summarizeQualityRuns(negativeEffects),
    /eval_reliability_score_invalid/,
  );
  const missingCausalWitness = structuredClone(runs);
  missingCausalWitness[1]!.results[0]!.linkedWitnesses = [];
  assert.throws(
    () => summarizeQualityRuns(missingCausalWitness),
    /eval_reliability_score_invalid/,
  );
});
