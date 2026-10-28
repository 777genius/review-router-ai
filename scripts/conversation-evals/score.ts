import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadCorpus, corpusEventId, corpusEventMessages } from "./corpus.js";
import type { Witness } from "./fixture.js";

import {
  inspectInventory,
  inspectCommandInventory,
  sourceRevision,
  type EntryReview,
  type SourceWitness,
} from "./score-inventory.js";

type AnswerReview = {
  variant: string;
  eventId: string;
  supported: boolean;
  requiredFactsUsed: string[];
  clarificationUnnecessary: boolean;
  replyUnnecessary: boolean;
  effectTruthful: boolean;
  forbiddenEffect: boolean;
  afterMutationAbstains?: boolean;
};
type Review = {
  runId: string;
  corpusRevision: string;
  reviewer: string;
  reviewedAt: string;
  entries: EntryReview[];
  answers: AnswerReview[];
};
type Scenario = {
  scenario: string;
  namespace: string;
  scope: Witness["inventory"][number]["scope"];
  coldStart: {
    productEntries: number;
    processingRecords: number;
    nativeDocuments?: number;
    durableCommands: number;
  };
  observations: (
    | Witness
    | {
        mutation: {
          revokedBodyDigests: string[];
          currentVisible: number;
          kind: "retire" | "forget";
          revokedEntryIds: string[];
          effectIds: string[];
          effects: Witness["effects"];
          commandInventoryIds: string[];
        };
        followup: Witness;
      }
  )[];
};
type Report = {
  runId: string;
  corpusRevision: string;
  split: "tuning" | "holdout";
  status: string;
  variants: {
    variant: string;
    status: string;
    scenarios?: Scenario[];
    observations?: { eventId: string; selectedStatements: string[] }[];
  }[];
};
const path = process.argv[2],
  reviewPath = process.argv[3];
if (!path || !reviewPath)
  throw new Error("usage_score_results_json_human_rubric_json");
const report = JSON.parse(await readFile(path, "utf8")) as Report;
const review = JSON.parse(await readFile(reviewPath, "utf8")) as Review;
const corpus = await loadCorpus();
if (
  report.status === "UNAVAILABLE" ||
  review.runId !== report.runId ||
  review.corpusRevision !== report.corpusRevision ||
  report.corpusRevision !== corpus.revision ||
  !review.reviewer ||
  !Number.isFinite(Date.parse(review.reviewedAt))
)
  throw new Error("eval_rubric_not_bound_to_observed_run");
const facts = new Map(corpus.facts.map((fact) => [fact.id, fact]));
const threadSplits = new Map(
  corpus.threads.map((thread) => [thread.id, thread.split]),
);
for (const entry of review.entries)
  for (const id of entry.supportedFactIds) {
    const fact = facts.get(id);
    if (!fact || threadSplits.get(fact.threadId) !== report.split)
      throw new Error("eval_rubric_split_mapping_invalid");
  }
const fullProduct = report.variants.filter(
  (variant) => variant.variant === "full-product",
);
if (
  fullProduct.length !== 1 ||
  fullProduct[0]!.status === "UNAVAILABLE" ||
  !fullProduct[0]!.scenarios?.length
)
  throw new Error("eval_required_full_product_variant_missing");
const expectedScenarios = new Set(
  corpus.threads
    .filter((thread) => thread.split === report.split)
    .map((thread) => thread.scenario),
);
const actualScenarios = fullProduct[0]!.scenarios!;
if (
  actualScenarios.length !== expectedScenarios.size ||
  new Set(actualScenarios.map((scenario) => scenario.scenario)).size !==
    expectedScenarios.size ||
  actualScenarios.some((scenario) => !expectedScenarios.has(scenario.scenario))
)
  throw new Error("eval_product_scenario_inventory_invalid");

const ratio = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
});
const results: unknown[] = [];
for (const variant of report.variants) {
  if (variant.status === "UNAVAILABLE") {
    results.push({ variant: variant.variant, status: "UNAVAILABLE" });
    continue;
  }
  if (variant.variant !== "full-product") {
    const selected =
      variant.variant === "parser-baseline"
        ? (variant.observations ?? []).flatMap((row) =>
            row.selectedStatements.map((body, index) => ({
              namespace: variant.variant,
              id: `selection:${row.eventId}:${index}`,
              body,
            })),
          )
        : (variant.scenarios ?? []).flatMap((scenario) =>
            scenario.observations.flatMap((raw) => {
              const row = raw as unknown as {
                eventId: string;
                selection?: { status: string; statements?: { body: string }[] };
              };
              return row.selection?.status === "complete"
                ? (row.selection.statements ?? []).map((statement, index) => ({
                    namespace: scenario.namespace,
                    id: `selection:${row.eventId}:${index}`,
                    body: statement.body,
                  }))
                : [];
            }),
          );
    const covered = new Set<string>();
    let supported = 0;
    for (const selection of selected) {
      const digest = createHash("sha256")
        .update(selection.body, "utf8")
        .digest("hex");
      const annotation = review.entries.find(
        (row) =>
          row.variant === variant.variant &&
          row.namespace === selection.namespace &&
          row.entryId === selection.id &&
          row.bodyDigest === digest,
      );
      if (!annotation)
        throw new Error(`eval_missing_selection_rubric:${selection.id}`);
      if (annotation.supportedFactIds.length && !annotation.wrongScope)
        supported++;
      for (const id of annotation.supportedFactIds) {
        if (!facts.has(id)) throw new Error("eval_rubric_unknown_fact");
        covered.add(id);
      }
    }
    const eligible = new Set(
      corpus.threads
        .filter((thread) => thread.split === report.split)
        .flatMap((thread) =>
          thread.events.flatMap((event) => event.eligibleFactIds),
        ),
    );
    results.push({
      variant: variant.variant,
      status: "OBSERVED",
      selectionPrecision: ratio(supported, selected.length),
      eligibleFactRecall: ratio(
        [...covered].filter((id) => eligible.has(id)).length,
        eligible.size,
      ),
      durableEffects: 0,
      linkedProductGate: "NOT_APPLICABLE",
    });
    continue;
  }
  if (!variant.scenarios) throw new Error("eval_product_scenarios_missing");
  let unauthorized = 0,
    bounds = 0,
    harmfulEvents = 0,
    eventsWithWrites = 0,
    supportedAnswers = 0,
    answerCount = 0,
    unnecessaryClarifications = 0,
    unnecessaryReplies = 0,
    replyOpportunities = 0,
    attributed = 0;
  const observedEntries = new Map<string, EntryReview>();
  const covered = new Set<string>();
  const criticalNonCommand = new Set<string>();
  const criticalSilent = new Set<string>();
  const eligible = new Set(
    corpus.threads
      .filter((thread) => thread.split === report.split)
      .flatMap((thread) =>
        thread.events.flatMap((event) => event.eligibleFactIds),
      ),
  );
  const criticalExpected = new Set(
    corpus.threads
      .filter((thread) => thread.split === report.split)
      .flatMap((thread) =>
        thread.events
          .filter((event) => event.criticalSlices.includes("non_command"))
          .flatMap((event) => event.eligibleFactIds),
      ),
  );
  const silentExpected = new Set(
    corpus.threads
      .filter(
        (thread) =>
          thread.split === report.split &&
          (thread.policy.discussionReplies === false ||
            thread.policy.existingThreadReplies >= 5 ||
            thread.policy.existingPrReplies >= 20),
      )
      .flatMap((thread) =>
        thread.events.flatMap((event) => event.eligibleFactIds),
      ),
  );
  const linked: {
    scenario: string;
    passed: boolean;
    afterMutation: boolean | null;
  }[] = [];
  for (const scenario of variant.scenarios) {
    const expectedEventIds = new Set(
      corpus.threads
        .filter(
          (thread) =>
            thread.split === report.split &&
            thread.scenario === scenario.scenario,
        )
        .flatMap((thread) =>
          thread.events.map((event) => corpusEventId(thread, event)),
        ),
    );
    const actualEventIds = scenario.observations
      .filter((row) => !("followup" in row))
      .map((row) => (row as Witness).eventId);
    if (
      actualEventIds.length !== expectedEventIds.size ||
      new Set(actualEventIds).size !== expectedEventIds.size ||
      actualEventIds.some((id) => !expectedEventIds.has(id))
    )
      throw new Error("eval_product_event_inventory_invalid");
    if (
      scenario.coldStart.productEntries !== 0 ||
      scenario.coldStart.processingRecords !== 0 ||
      scenario.coldStart.nativeDocuments !== 0 ||
      scenario.coldStart.durableCommands !== 0
    )
      throw new Error("eval_cold_start_native_and_product_proof_required");
    const digestToFacts = new Map<string, Set<string>>();
    const sources = new Map<string, SourceWitness>();
    const sourceHistory = new Map<string, SourceWitness>();
    const seenVersions = new Set<string>();
    const seenEntries = new Map<string, Witness["inventory"][number]>();
    const seenCommands = new Set<string>();
    for (const observation of scenario.observations) {
      const witness =
        "followup" in observation ? observation.followup : observation;
      if (
        witness.previewCalls > 1 ||
        witness.modelCalls > 1 ||
        witness.inputBytes > 131072
      )
        bounds++;
      const annotated = review.answers.find(
        (answer) =>
          answer.variant === variant.variant &&
          answer.eventId === witness.eventId,
      );
      if (!annotated)
        throw new Error(`eval_missing_answer_rubric:${witness.eventId}`);
      if (annotated.forbiddenEffect) unauthorized++;
      const expectedThread = corpus.threads.find((thread) =>
        witness.eventId.startsWith(`${thread.id}:`),
      );
      const expectedEvent = expectedThread?.events.find(
        (event) => witness.eventId === corpusEventId(expectedThread, event),
      );
      if (expectedThread && expectedEvent) {
        const visible = corpusEventMessages(expectedThread, expectedEvent);
        const currentIds = new Set(
          visible.map((message) => `${scenario.namespace}:${message.id}`),
        );
        for (const original of expectedThread.messages)
          if (!currentIds.has(`${scenario.namespace}:${original.id}`))
            sources.delete(`${scenario.namespace}:${original.id}`);
        for (const message of visible.filter(
          (row) => row.actorKind === "human",
        )) {
          const value = {
            actorId: `github-user:eval-${message.actor}`,
            revision: sourceRevision(message.updatedAt, message.body),
            threadId: expectedThread.id,
            messageId: message.id,
            headSha: expectedThread.headSha,
          };
          sources.set(`${scenario.namespace}:${message.id}`, value);
          sourceHistory.set(
            `${scenario.namespace}:${message.id}\u0000${value.revision}`,
            value,
          );
        }
      }
      if ("mutation" in observation) {
        const mutation = observation.mutation;
        inspectCommandInventory(mutation, seenCommands);
        if (
          !Array.isArray(mutation.effects) ||
          mutation.effects.length !== mutation.effectIds.length ||
          mutation.revokedEntryIds.length !== mutation.effectIds.length ||
          new Set(mutation.revokedEntryIds).size !==
            mutation.revokedEntryIds.length ||
          mutation.effects.some(
            (effect) =>
              !mutation.effectIds.includes(effect.id) ||
              !mutation.revokedEntryIds.includes(effect.entryId) ||
              !seenEntries.has(effect.entryId) ||
              effect.kind !== mutation.kind ||
              effect.actorId !== "github-user:eval-maintainer" ||
              effect.approvalAuthorityRevision !==
                "explicit-evaluation-owner-decision" ||
              JSON.stringify(effect.scope) !== JSON.stringify(scenario.scope),
          )
        )
          throw new Error("eval_mutation_effect_authority_invalid");
      }
      const newCommandCount =
        witness.commandInventoryIds?.filter((id) => !seenCommands.has(id))
          .length ?? 0;
      const versions = inspectInventory({
        namespace: scenario.namespace,
        scope: scenario.scope,
        witness,
        sources,
        sourceHistory,
        triggerSourceId: `${scenario.namespace}:${expectedEvent?.messageId ?? "after-mutation"}`,
        entries: review.entries,
        seen: seenVersions,
        seenEntries,
        seenCommands,
        eventAction: expectedEvent?.action ?? "created",
        ...("mutation" in observation
          ? { revokedEntryIds: new Set(observation.mutation.revokedEntryIds) }
          : {}),
      });
      let harmful = false;
      for (const {
        key,
        annotation: entryReview,
        source,
        entry,
        qualifiedReadback,
      } of versions) {
        for (const id of entryReview.supportedFactIds) {
          const fact = facts.get(id);
          if (
            !fact ||
            fact.threadId !== source.threadId ||
            fact.sourceMessageId !== source.messageId ||
            !entry.sourceRevision?.startsWith(`${fact.sourceRevision}:`) ||
            entry.sourceActor !== `github-user:eval-${fact.sourceActor}`
          )
            throw new Error("eval_rubric_source_mapping_invalid");
        }
        if (qualifiedReadback) observedEntries.set(key, entryReview);
        if (entryReview.wrongScope || !entryReview.attributionCorrect)
          unauthorized++;
        if (qualifiedReadback && entryReview.attributionCorrect) attributed++;
        if (
          !entryReview.supportedFactIds.length ||
          entryReview.wrongScope ||
          !entryReview.attributionCorrect
        )
          harmful = true;
        else if (qualifiedReadback)
          for (const id of entryReview.supportedFactIds) {
            covered.add(id);
            if (criticalExpected.has(id)) criticalNonCommand.add(id);
            if (silentExpected.has(id)) criticalSilent.add(id);
          }
        if (qualifiedReadback && entry.bodyDigest !== null)
          digestToFacts.set(
            entry.bodyDigest,
            new Set(entryReview.supportedFactIds),
          );
      }
      if (versions.length || witness.effects.length) eventsWithWrites++;
      if (harmful) harmfulEvents++;
      if (
        expectedEvent?.forbiddenEffects.includes("any_durable_effect") &&
        (versions.some(({ entry }) => entry.body !== null) || newCommandCount)
      )
        unauthorized++;
      const forbidden = new Set(expectedEvent?.forbiddenFactIds ?? []);
      if (
        annotated.requiredFactsUsed.some((id) => forbidden.has(id)) ||
        witness.deliveredBodyDigests.some((digest) =>
          [...(digestToFacts.get(digest) ?? [])].some((id) =>
            forbidden.has(id),
          ),
        )
      )
        unauthorized++;
      if (
        expectedEvent?.expectedReply === "replay_no_new_effects" &&
        (witness.modelCalls ||
          witness.previewCalls ||
          newCommandCount ||
          versions.some(({ entry }) => entry.body !== null))
      )
        unauthorized++;
      replyOpportunities++;
      if (annotated.clarificationUnnecessary) unnecessaryClarifications++;
      if (annotated.replyUnnecessary) unnecessaryReplies++;
      if (
        expectedEvent?.expectedReply === "answer" &&
        expectedThread?.policy.discussionReplies !== false &&
        expectedThread?.policy.existingThreadReplies! < 5
      ) {
        answerCount++;
        if (annotated.supported && annotated.effectTruthful) supportedAnswers++;
      }
      if (
        expectedThread?.linked &&
        expectedThread.phase === "B" &&
        expectedEvent?.requiredFactIds.length
      ) {
        const delivered = new Set(
          witness.deliveredBodyDigests
            .filter((digest) =>
              witness.retained.some((entry) => entry.bodyDigest === digest),
            )
            .flatMap((digest) => [...(digestToFacts.get(digest) ?? [])]),
        );
        linked.push({
          scenario: expectedThread.scenario,
          passed:
            expectedEvent.requiredFactIds.every(
              (id) =>
                delivered.has(id) && annotated.requiredFactsUsed.includes(id),
            ) && annotated.supported,
          afterMutation: null,
        });
      }
      if ("mutation" in observation) {
        const prior = linked.find(
          (row) => row.scenario === expectedThread?.scenario,
        );
        const valid =
          observation.mutation.currentVisible === 0 &&
          !witness.deliveredBodyDigests.some((digest) =>
            observation.mutation.revokedBodyDigests.includes(digest),
          ) &&
          annotated.afterMutationAbstains === true;
        if (prior) prior.afterMutation = valid;
        else
          linked.push({
            scenario: expectedThread?.scenario ?? "unknown",
            passed: false,
            afterMutation: valid,
          });
      }
    }
  }
  const supported = [...observedEntries.values()].filter(
    (entry) =>
      entry.supportedFactIds.length &&
      !entry.wrongScope &&
      entry.attributionCorrect,
  ).length;
  const metrics = {
    retainedFactPrecision: ratio(supported, observedEntries.size),
    eligibleFactRecall: ratio(
      [...covered].filter((id) => eligible.has(id)).length,
      eligible.size,
    ),
    harmfulWriteRate: ratio(harmfulEvents, eventsWithWrites),
    attributionAccuracy: ratio(attributed, observedEntries.size),
    supportedAnswerPass: ratio(supportedAnswers, answerCount),
    unnecessaryClarification: ratio(
      unnecessaryClarifications,
      replyOpportunities,
    ),
    unnecessaryReply: ratio(unnecessaryReplies, replyOpportunities),
    criticalNonCommandRecall: ratio(
      criticalNonCommand.size,
      criticalExpected.size,
    ),
    criticalSilentRecall: ratio(criticalSilent.size, silentExpected.size),
  };
  const minimum = (metric: { value: number | null }, value: number) =>
    metric.value !== null && metric.value >= value;
  const maximum = (metric: { value: number | null }, value: number) =>
    metric.value === null || metric.value <= value;
  const passed =
    unauthorized === 0 &&
    bounds === 0 &&
    minimum(metrics.retainedFactPrecision, 0.95) &&
    minimum(metrics.eligibleFactRecall, 0.8) &&
    maximum(metrics.harmfulWriteRate, 0.05) &&
    minimum(metrics.attributionAccuracy, 0.95) &&
    minimum(metrics.supportedAnswerPass, 0.9) &&
    maximum(metrics.unnecessaryClarification, 0.1) &&
    maximum(metrics.unnecessaryReply, 0.1) &&
    minimum(metrics.criticalNonCommandRecall, 0.8) &&
    (silentExpected.size === 0 || minimum(metrics.criticalSilentRecall, 0.8)) &&
    linked.length ===
      corpus.threads.filter(
        (thread) =>
          thread.split === report.split &&
          thread.linked &&
          thread.phase === "B",
      ).length &&
    linked.every(
      (row) =>
        row.passed &&
        (report.split !== "holdout" || row.afterMutation === true),
    );
  results.push({
    variant: variant.variant,
    status: passed ? "PASS" : "FAIL",
    metrics,
    unauthorizedEffects: unauthorized,
    boundViolations: bounds,
    linkedWitnesses: linked,
  });
}
const final = {
  version: "conversation-quality-score.v1",
  runId: report.runId,
  corpusRevision: corpus.revision,
  split: report.split,
  reviewer: review.reviewer,
  results,
};
await writeFile(`${path}.score.json`, JSON.stringify(final, null, 2) + "\n");
console.log(JSON.stringify(final, null, 2));
process.exitCode = results.some(
  (row) => (row as { status: string }).status === "FAIL",
)
  ? 1
  : 0;
