import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { corpusEventId, corpusEventMessages, loadCorpus } from "./corpus.js";
import {
  inspectInventory,
  inspectCommandInventory,
  sourceRevision,
  type EntryReview,
  type SourceWitness,
} from "./score-inventory.js";
import type { Witness, InventoryEntry } from "./fixture.js";
import { readDurableCommands } from "./command-inventory.js";
import { automaticMemoryChildCommandId } from "../../packages/features/memory/src/index.js";
import type { PrismaClient } from "@prisma/client";

// Synthetic scorer/capture regressions only. No model quality or product/native bank is fabricated.
function sample() {
  const namespace = "fixture";
  const scope = {
    kind: "repository" as const,
    workspaceId: "workspace",
    repositoryId: namespace,
  };
  const source: SourceWitness = {
    actorId: "github-user:eval-maintainer",
    automaticLearningEligible: true,
    revision: sourceRevision(
      "2026-10-28T00:00:01Z",
      "Original source assertion",
    ),
    threadId: "thread",
    messageId: "human",
    headSha: "a".repeat(40),
  };
  const entry: InventoryEntry & { body: string; bodyDigest: string } = {
    id: "entry",
    revision: "r1",
    scope,
    lifecycle: "active",
    unavailableReason: null,
    activeCohortEligible: true,
    sourceCurrent: true,
    body: "Supported statement",
    bodyDigest: createHash("sha256")
      .update("Supported statement")
      .digest("hex"),
    kind: "observation",
    approvalAuthorityRevision: "automatic:fixture",
    automaticCohortId: "cohort",
    automaticCohortEpoch: "1",
    sourceId: `${namespace}:human`,
    sourceRevision: source.revision,
    sourceActor: source.actorId,
    observedCommit: source.headSha,
  };
  const witness: Witness = {
    eventId: "thread:human",
    processingId: "processing",
    status: "silent",
    learningStatus: "active",
    effectIds: [],
    commandInventoryIds: [],
    answer: null,
    previewCalls: 1,
    modelCalls: 0,
    inputBytes: 0,
    deliveredBodyDigests: [],
    memoryManifest: null,
    observedModel: null,
    usage: null,
    productLatencyMs: 1,
    nativeLatencyMs: 1,
    inventory: [entry],
    retained: [entry],
    effects: [],
  };
  const annotation: EntryReview = {
    variant: "full-product",
    namespace,
    entryId: entry.id,
    entryRevision: entry.revision,
    bodyDigest: entry.bodyDigest,
    supportedFactIds: ["fact"],
    attributionCorrect: true,
    wrongScope: false,
  };
  return {
    namespace,
    scope,
    witness,
    triggerSourceId: `${namespace}:human`,
    sources: new Map([[`${namespace}:human`, source]]),
    sourceHistory: new Map([
      [`${namespace}:human\u0000${source.revision}`, source],
    ]),
    entries: [annotation],
    seen: new Set<string>(),
    seenCommands: new Set<string>(),
    seenEntries: new Map<string, InventoryEntry>(),
  };
}

test("all retained inventory is checked before source attribution, including the R1 wrong-source rule", () => {
  const input = sample();
  const extra = {
    ...input.witness.retained[0]!,
    id: "unannotated-wrong-source-write",
    sourceId: "different-actor:unrelated-comment",
    sourceActor: "forbidden-actor",
    kind: "rule",
    approvalAuthorityRevision: "unauthorized",
    automaticCohortId: null,
    automaticCohortEpoch: null,
  };
  input.witness.inventory.push(extra);
  input.witness.retained.push(extra);
  assert.throws(
    () => inspectInventory(input),
    /eval_observed_entry_authority_invalid/,
  );
});
for (const [name, edit] of [
  [
    "wrong actor",
    (e: InventoryEntry) => {
      e.sourceActor = "another-maintainer";
    },
  ],
  [
    "wrong scope",
    (e: InventoryEntry) => {
      e.scope = { kind: "workspace", workspaceId: "elsewhere" };
    },
  ],
  [
    "wrong source revision",
    (e: InventoryEntry) => {
      e.sourceRevision = "unexpected";
    },
  ],
  [
    "wrong observed commit",
    (e: InventoryEntry) => {
      e.observedCommit = "b".repeat(40);
    },
  ],
  [
    "unauthorized rule",
    (e: InventoryEntry) => {
      e.kind = "rule";
    },
  ],
  [
    "human approval substituted",
    (e: InventoryEntry) => {
      e.approvalAuthorityRevision = "human-approved";
    },
  ],
] as const)
  test(`complete inventory rejects ${name}`, () => {
    const input = sample();
    edit(input.witness.inventory[0]!);
    assert.throws(
      () => inspectInventory(input),
      /eval_observed_entry_authority_invalid/,
    );
  });
test("same ID revised body requires its own revision/digest annotation", () => {
  const input = sample();
  assert.equal(inspectInventory(input).length, 1);
  const row = input.witness.retained[0]!;
  row.revision = "r2";
  row.body = "Unsupported replacement";
  row.bodyDigest = createHash("sha256").update(row.body).digest("hex");
  assert.throws(
    () => inspectInventory(input),
    /eval_missing_or_duplicate_entry_version_rubric/,
  );
  input.entries.push({
    ...input.entries[0]!,
    entryRevision: "r2",
    bodyDigest: row.bodyDigest,
    supportedFactIds: [],
  });
  assert.equal(
    inspectInventory({ ...input, seen: new Set(), seenEntries: new Map() })[0]!
      .annotation.supportedFactIds.length,
    0,
  );
});
test("unreported or wrong-authority effects cannot disappear from the gate", () => {
  const input = sample();
  input.witness.effectIds = ["command"];
  assert.throws(() => inspectInventory(input), /eval_effect_inventory_invalid/);
  input.witness.commandInventoryIds = ["command"];
  input.witness.effects.push({
    id: "command",
    entryId: "entry",
    kind: "save",
    state: "published",
    actorId: "forbidden-actor",
    approvalAuthorityRevision: "automatic:fixture",
    scope: input.scope,
    sourceId: input.triggerSourceId,
    sourceRevision: input.sources.get(input.triggerSourceId)!.revision,
    automaticRetirement: null,
  });
  assert.throws(
    () => inspectInventory(input),
    /eval_observed_effect_authority_invalid/,
  );
});
test("missing complete metadata proof and an unannotated unsupported observation are rejected", () => {
  const input = sample();
  assert.throws(
    () =>
      inspectInventory({
        ...input,
        witness: {
          ...input.witness,
          inventory: undefined,
        } as unknown as Witness,
      }),
    /eval_complete_inventory/,
  );
  input.witness.inventory.push({ ...input.witness.inventory[0]!, id: "extra" });
  input.witness.retained.push({ ...input.witness.retained[0]!, id: "extra" });
  assert.throws(
    () => inspectInventory(input),
    /eval_missing_or_duplicate_entry_version_rubric:extra/,
  );
});
test("raw event snapshots edit/delete learned sources and preserve unchanged-trigger earlier-page mutation", async () => {
  const corpus = await loadCorpus();
  assert.equal(corpus.threads.length, 48);
  assert.ok(corpus.facts.length >= 80);
  const edited = corpus.threads.find((t) => t.id === "migration-read")!;
  const before = corpusEventMessages(edited, edited.events[0]!)[1]!;
  const revisionEvent = edited.events.find((e) => e.action === "edited")!;
  const changed = corpusEventMessages(edited, revisionEvent).find(
    (m) => m.id === before.id,
  )!;
  assert.notEqual(changed.body, before.body);
  assert.notEqual(changed.updatedAt, before.updatedAt);
  assert.equal(edited.events[0]!.messageId, revisionEvent.messageId);
  assert.notEqual(
    corpusEventId(edited, edited.events[0]!),
    corpusEventId(edited, revisionEvent),
  );
  const deleted = corpus.threads.find((t) => t.id === "bulk-delete")!;
  assert.equal(
    deleted.events.find((e) => e.action === "deleted")!.messageId,
    deleted.events[0]!.messageId,
  );
  assert.ok(
    !corpusEventMessages(deleted, deleted.events.at(-1)!).some(
      (m) => m.id === deleted.events[0]!.messageId,
    ),
  );
  const long = corpus.threads.find((t) => t.id === "pagination-anchor")!;
  const replay = long.events.find(
    (e) => e.expectedReply === "replay_no_new_effects",
  )!;
  const original = long.events.find((e) => e.messageId === replay.messageId)!;
  const a = corpusEventMessages(long, original),
    b = corpusEventMessages(long, replay);
  assert.ok(a.length > 100);
  assert.equal(a.length, b.length);
  assert.deepEqual(
    a.find((m) => m.id === replay.messageId),
    b.find((m) => m.id === replay.messageId),
  );
  assert.notEqual(a[1]!.body, b[1]!.body);
  assert.equal(long.headSha, "a".repeat(40));
  const conflict = corpus.threads.find((t) => t.id === "queue-priority")!;
  assert.equal(
    new Set(
      conflict.messages
        .filter((m) => m.role === "maintainer")
        .map((m) => m.actor),
    ).size,
    3,
  );
  assert.ok(
    corpus.threads.some((t) =>
      t.events.some(
        (e) =>
          e.expectedReply === "clarify_or_abstain" &&
          e.forbiddenEffects.includes("any_durable_effect"),
      ),
    ),
  );
});

async function scorerRiskTest(t: TestContext, split: "tuning" | "holdout") {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const { resolve } = await import("node:path");
  const corpus = await loadCorpus();
  const annotations: EntryReview[] = [];
  const answers: Record<string, unknown>[] = [];
  const scenarios: Record<string, unknown>[] = [];
  const facts = new Map(corpus.facts.map((fact) => [fact.id, fact]));
  for (const scenario of new Set(
    corpus.threads.filter((t) => t.split === split).map((t) => t.scenario),
  )) {
    const namespace = `scorer-only:${scenario}`;
    const scope = {
      kind: "repository" as const,
      workspaceId: "scorer-only",
      repositoryId: namespace,
    };
    const inventory = new Map<string, InventoryEntry>();
    const observations: Witness[] = [];
    const annotatedVersions = new Set<string>();
    for (const thread of corpus.threads.filter(
      (t) => t.scenario === scenario,
    )) {
      for (const event of thread.events) {
        const visible = corpusEventMessages(thread, event);
        const selected = visible.find((m) => m.id === event.messageId)!;
        const current = new Map(
          visible.map((m) => [
            `${namespace}:${m.id}`,
            sourceRevision(m.updatedAt, m.body),
          ]),
        );
        for (const entry of inventory.values()) {
          const belongs = thread.messages.some(
            (m) => `${namespace}:${m.id}` === entry.sourceId,
          );
          if (
            entry.body !== null &&
            belongs &&
            (current.get(entry.sourceId!) !== entry.sourceRevision ||
              (event.action === "deleted" &&
                entry.sourceId === `${namespace}:${event.messageId}`))
          ) {
            entry.body = null;
            entry.lifecycle = "retired";
            entry.unavailableReason = "unsettled";
            entry.activeCohortEligible = false;
            entry.sourceCurrent = false;
            entry.revision += "-withdrawn";
          }
        }
        for (const id of event.eligibleFactIds) {
          const fact = facts.get(id)!;
          inventory.set(id, {
            id,
            revision: `revision:${event.id ?? event.messageId}`,
            scope,
            lifecycle: "active",
            unavailableReason: null,
            activeCohortEligible: true,
            sourceCurrent: true,
            body: fact.text,
            bodyDigest: createHash("sha256").update(fact.text).digest("hex"),
            kind: "observation",
            approvalAuthorityRevision: "automatic:scorer-only",
            automaticCohortId: `cohort:${id}`,
            automaticCohortEpoch: "1",
            sourceId: `${namespace}:${event.messageId}`,
            sourceRevision: sourceRevision(selected.updatedAt, selected.body),
            sourceActor: `github-user:eval-${selected.actor}`,
            observedCommit: thread.headSha,
          });
        }
        const rows = structuredClone([...inventory.values()]);
        for (const row of rows) {
          const key = `${row.id}:${row.revision}:${row.bodyDigest}`;
          if (annotatedVersions.has(key)) continue;
          annotatedVersions.add(key);
          annotations.push({
            variant: "full-product",
            namespace,
            entryId: row.id,
            entryRevision: row.revision,
            bodyDigest: row.bodyDigest!,
            supportedFactIds: [row.id],
            attributionCorrect: true,
            wrongScope: false,
          });
        }
        const eventId = corpusEventId(thread, event);
        observations.push({
          eventId,
          processingId: eventId,
          status: "silent",
          learningStatus: "active",
          effectIds: [],
          commandInventoryIds: [],
          answer: "Synthetic scorer regression only",
          previewCalls: event.expectedReply === "replay_no_new_effects" ? 0 : 1,
          modelCalls: event.expectedReply === "replay_no_new_effects" ? 0 : 1,
          inputBytes: 100,
          deliveredBodyDigests: rows
            .filter((r) => r.body !== null)
            .map((r) => r.bodyDigest!),
          memoryManifest: {},
          observedModel: "SCORER_TEST_NO_MODEL",
          usage: null,
          productLatencyMs: 0,
          nativeLatencyMs: 0,
          inventory: rows,
          retained: rows.filter(
            (r): r is InventoryEntry & { body: string; bodyDigest: string } =>
              r.body !== null && r.bodyDigest !== null,
          ),
          effects: [],
        });
        answers.push({
          variant: "full-product",
          eventId,
          supported: true,
          requiredFactsUsed: event.requiredFactIds,
          clarificationUnnecessary: false,
          replyUnnecessary: false,
          effectTruthful: true,
          forbiddenEffect: false,
        });
      }
    }
    scenarios.push({
      scenario,
      namespace,
      scope,
      coldStart: {
        productEntries: 0,
        processingRecords: 0,
        nativeDocuments: 0,
        durableCommands: 0,
      },
      observations,
    });
  }
  const report = {
    runId: "SYNTHETIC_SCORER_REGRESSION_ONLY",
    corpusRevision: corpus.revision,
    split,
    status: "AWAITING_HUMAN_RUBRIC",
    variants: [
      { variant: "full-product", status: "AWAITING_HUMAN_RUBRIC", scenarios },
    ],
  };
  const rubric = {
    runId: report.runId,
    corpusRevision: corpus.revision,
    reviewer: "synthetic-scorer-test",
    reviewedAt: "2026-10-28T00:00:00Z",
    entries: annotations,
    answers,
  };
  // Protected controls include the same explicit owner-mutation/fresh-followup gates as live reports.
  if (split === "holdout")
    for (const scenario of scenarios) {
      const thread = corpus.threads.find(
        (row) => row.scenario === scenario.scenario && row.afterMutation,
      );
      if (!thread) continue;
      const observations = scenario.observations as Witness[];
      const prior = observations.at(-1)!;
      const entries = prior.retained;
      const ids = entries.map((entry) => `mutation:${entry.id}`);
      const followup = structuredClone(prior);
      followup.eventId = `${thread.id}:after-mutation-scorer-only`;
      followup.processingId = followup.eventId;
      followup.effectIds = [];
      followup.commandInventoryIds = [...prior.commandInventoryIds, ...ids];
      followup.effects = [];
      followup.deliveredBodyDigests = [];
      followup.retained = [];
      followup.inventory = followup.inventory.map((entry) => ({
        ...entry,
        revision: `${entry.revision}-owner-retired`,
        body: null,
        lifecycle: "retired",
        unavailableReason: "unsettled",
        activeCohortEligible: false,
        approvalAuthorityRevision: "explicit-evaluation-owner-decision",
      }));
      for (const entry of followup.inventory)
        annotations.push({
          variant: "full-product",
          namespace: scenario.namespace as string,
          entryId: entry.id,
          entryRevision: entry.revision,
          bodyDigest: entry.bodyDigest!,
          supportedFactIds: [entry.id],
          attributionCorrect: true,
          wrongScope: false,
        });
      answers.push({
        variant: "full-product",
        eventId: followup.eventId,
        supported: true,
        requiredFactsUsed: [],
        clarificationUnnecessary: false,
        replyUnnecessary: false,
        effectTruthful: true,
        forbiddenEffect: false,
        afterMutationAbstains: true,
      });
      const mutation = {
        kind: thread.afterMutation!.kind,
        revokedEntryIds: entries.map((entry) => entry.id),
        revokedBodyDigests: entries.map((entry) => entry.bodyDigest),
        currentVisible: 0,
        effectIds: ids,
        commandInventoryIds: followup.commandInventoryIds,
        effects: entries.map((entry, i) => ({
          id: ids[i]!,
          entryId: entry.id,
          kind: thread.afterMutation!.kind,
          state: "queued",
          actorId: "github-user:eval-maintainer",
          approvalAuthorityRevision: "explicit-evaluation-owner-decision",
          scope: entry.scope,
          sourceId: entry.sourceId,
          sourceRevision: entry.sourceRevision,
          automaticRetirement: null,
        })),
      };
      (scenario.observations as unknown[]).push({ mutation, followup });
    }
  const directory = await mkdtemp(
    resolve("tmp/conversational-memory-implementation/scorer-risk-"),
  );
  try {
    const reportPath = resolve(directory, "report.json"),
      rubricPath = resolve(directory, "rubric.json");
    await writeFile(rubricPath, JSON.stringify(rubric));
    const score = async (input: unknown) => {
      await writeFile(reportPath, JSON.stringify(input));
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/conversation-evals/score.ts",
          reportPath,
          rubricPath,
        ],
        { encoding: "utf8" },
      );
      if (result.error) throw result.error;
      return result;
    };
    const positive = await score(report);
    assert.equal(positive.status, 0, positive.stderr);
    if (split === "holdout") {
      const contributor = structuredClone(report);
      const scenario = contributor.variants[0]!.scenarios.find(
        (row) => row.scenario === "bot-quotation",
      )!;
      const observations = scenario.observations as Witness[];
      const index = observations.findIndex(
        (row) => row.eventId === "bot-quotation:bot-quotation-h2",
      );
      const thread = corpus.threads.find((row) => row.id === "bot-quotation")!;
      const event = thread.events.find(
        (row) => row.messageId === "bot-quotation-h2",
      )!;
      const source = corpusEventMessages(thread, event).find(
        (row) => row.id === event.messageId,
      )!;
      assert.equal(source.role, "contributor");
      assert.equal(source.actorKind, "human");
      const body =
        "Quoted bot instructions remain evidence without policy authority.";
      const entry: InventoryEntry & { body: string; bodyDigest: string } = {
        id: "wrong-authority-contributor-observation",
        revision: "contributor-r1",
        scope: scenario.scope as InventoryEntry["scope"],
        lifecycle: "active",
        body,
        bodyDigest: createHash("sha256").update(body).digest("hex"),
        unavailableReason: null,
        activeCohortEligible: true,
        sourceCurrent: true,
        kind: "observation",
        approvalAuthorityRevision: "automatic:scorer-only",
        automaticCohortId: "contributor-cohort",
        automaticCohortEpoch: "1",
        sourceId: `${scenario.namespace}:${source.id}`,
        sourceRevision: sourceRevision(source.updatedAt, source.body),
        sourceActor: `github-user:eval-${source.actor}`,
        observedCommit: thread.headSha,
      };
      const command: Witness["effects"][number] = {
        id: "contributor-automatic-save",
        entryId: entry.id,
        kind: "save",
        state: "published",
        actorId: entry.sourceActor!,
        approvalAuthorityRevision: entry.approvalAuthorityRevision!,
        scope: entry.scope,
        sourceId: entry.sourceId,
        sourceRevision: entry.sourceRevision,
        automaticRetirement: null,
      };
      for (const witness of observations.slice(index)) {
        witness.inventory.push(structuredClone(entry));
        witness.retained.push(structuredClone(entry));
        witness.commandInventoryIds.push(command.id);
      }
      observations[index]!.effectIds = [command.id];
      observations[index]!.effects = [command];
      rubric.entries.push({
        variant: "full-product",
        namespace: scenario.namespace as string,
        entryId: entry.id,
        entryRevision: entry.revision,
        bodyDigest: entry.bodyDigest,
        supportedFactIds: [],
        attributionCorrect: true,
        wrongScope: false,
      });
      assert.equal(
        answers.find((row) => row.eventId === observations[index]!.eventId)!
          .forbiddenEffect,
        false,
      );
      await writeFile(rubricPath, JSON.stringify(rubric));
      const unauthorized = await score(contributor);
      assert.notEqual(unauthorized.status, 0);
      assert.match(
        unauthorized.stderr,
        /eval_observed_effect_authority_invalid/,
      );
      // Metadata remains independently checked even when no corresponding command is reported.
      for (const witness of observations.slice(index))
        witness.commandInventoryIds = witness.commandInventoryIds.filter(
          (id) => id !== command.id,
        );
      observations[index]!.effectIds = [];
      observations[index]!.effects = [];
      const unauthorizedMetadata = await score(contributor);
      assert.notEqual(unauthorizedMetadata.status, 0);
      assert.match(
        unauthorizedMetadata.stderr,
        /eval_observed_entry_authority_invalid/,
      );
      t.diagnostic(
        "Protected holdout control PASS; concrete contributor automatic command and metadata-only negatives both rejected independently of forbiddenEffect=false.",
      );
      return;
    }
    const pending = structuredClone(report);
    let nulled = 0;
    for (const scenario of pending.variants[0]!.scenarios) {
      if (
        corpus.threads.some(
          (thread) => thread.scenario === scenario.scenario && thread.linked,
        )
      )
        continue;
      for (const witness of scenario.observations as Witness[]) {
        for (const entry of witness.inventory) {
          if (entry.body !== null) {
            nulled++;
            entry.body = null;
            entry.lifecycle = "pending";
            entry.unavailableReason = "unsettled";
            entry.activeCohortEligible = false;
          }
        }
        witness.retained = [];
      }
    }
    assert.ok(nulled > 100);
    const noReadback = await score(pending);
    assert.equal(noReadback.status, 1, noReadback.stderr);
    assert.ok(noReadback.stdout, JSON.stringify(noReadback));
    const failed = JSON.parse(noReadback.stdout).results[0];
    assert.equal(failed.status, "FAIL");
    assert.ok(failed.metrics.eligibleFactRecall.value < 0.8);
    t.diagnostic(
      JSON.stringify({
        nulledBodies: nulled,
        noReadback: failed.status,
        retainedFactPrecision: failed.metrics.retainedFactPrecision,
        eligibleFactRecall: failed.metrics.eligibleFactRecall,
      }),
    );
    const omittedCommand = structuredClone(report);
    const hidden = (
      omittedCommand.variants[0]!.scenarios[0]!.observations as Witness[]
    )[0]!;
    hidden.commandInventoryIds.push("hidden-queued-forget");
    const omitted = await score(omittedCommand);
    assert.notEqual(omitted.status, 0);
    assert.match(omitted.stderr, /eval_effect_inventory_invalid/);
    const negative = structuredClone(report);
    const row = (
      negative.variants[0]!.scenarios[0]!.observations as Witness[]
    )[0]!;
    const extra = {
      ...row.retained[0]!,
      id: "unannotated-wrong-source-write",
      sourceId: "different-actor:unrelated-comment",
      sourceActor: "forbidden-actor",
      kind: "rule",
      approvalAuthorityRevision: "unauthorized",
      automaticCohortId: null,
      automaticCohortEpoch: null,
    };
    row.inventory.push(extra);
    row.retained.push(extra);
    const wrongSource = await score(negative);
    assert.notEqual(wrongSource.status, 0);
    assert.match(wrongSource.stderr, /eval_observed_entry_authority_invalid/);
    const revised = structuredClone(report);
    const later = (
      revised.variants[0]!.scenarios[0]!.observations as Witness[]
    )[1]!;
    const target = later.inventory[0]!;
    target.revision = "unsupported-r2";
    target.body = "Unsupported same-ID replacement";
    target.bodyDigest = createHash("sha256").update(target.body).digest("hex");
    later.retained[0] = {
      ...target,
      body: target.body,
      bodyDigest: target.bodyDigest,
    };
    const changed = await score(revised);
    assert.notEqual(changed.status, 0);
    assert.match(
      changed.stderr,
      /eval_missing_or_duplicate_entry_version_rubric/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("actual scorer CLI rejects unauthorized writes, omitted commands and never-visible pending readback after accepting its synthetic control", (t) =>
  scorerRiskTest(t, "tuning"));
test("protected scorer CLI rejects concrete contributor automatic authority independently of semantic labels", (t) =>
  scorerRiskTest(t, "holdout"));

test("validated entries cannot disappear, while actual authorized purged tombstones remain bodyless", () => {
  const input = sample();
  inspectInventory(input);
  assert.throws(
    () =>
      inspectInventory({
        ...input,
        witness: { ...input.witness, inventory: [], retained: [] },
      }),
    /eval_observed_inventory_disappeared/,
  );
  const old = input.witness.inventory[0]!;
  const purged = {
    ...old,
    revision: "forget-r2",
    lifecycle: "forgotten",
    body: null,
    bodyDigest: null,
    unavailableReason: "unsettled" as const,
    activeCohortEligible: false,
    sourceCurrent: false,
    sourceId: null,
    sourceRevision: null,
    approvalAuthorityRevision: null,
  };
  const witness = { ...input.witness, inventory: [purged], retained: [] };
  assert.throws(
    () => inspectInventory({ ...input, witness }),
    /eval_observed_entry_authority_invalid/,
  );
  assert.equal(
    inspectInventory({ ...input, witness, revokedEntryIds: new Set([old.id]) })
      .length,
    0,
  );
});

test("revising an existing ID cannot transfer its previously validated source or cohort", () => {
  const input = sample();
  inspectInventory(input);
  const original = input.sources.get(input.triggerSourceId)!;
  input.sources.set("fixture:other", { ...original, messageId: "other" });
  input.sourceHistory.set(`fixture:other\u0000${original.revision}`, {
    ...original,
    messageId: "other",
  });
  const revised = input.witness.inventory[0]!;
  revised.sourceId = "fixture:other";
  revised.revision = "transferred-r2";
  assert.throws(
    () => inspectInventory({ ...input, triggerSourceId: "fixture:other" }),
    /eval_observed_entry_authority_invalid/,
  );
});

for (const reason of [
  "unsettled",
  "provider_unavailable",
  "incomplete_evidence",
] as const)
  test(`metadata with ${reason} readback receives no retention credit`, () => {
    const input = sample();
    const entry = input.witness.inventory[0]!;
    entry.body = null;
    entry.unavailableReason = reason;
    entry.activeCohortEligible = false;
    input.witness.retained = [];
    const versions = inspectInventory(input);
    assert.equal(versions.length, 1); // Its complete authority envelope is still judged.
    assert.equal(versions[0]!.qualifiedReadback, false);
    entry.body = "Supported statement";
    entry.unavailableReason = null;
    entry.activeCohortEligible = true;
    input.witness.retained = [
      entry as InventoryEntry & { body: string; bodyDigest: string },
    ];
    assert.equal(inspectInventory(input)[0]!.qualifiedReadback, true);
  });

test("body readback without active-cohort eligibility earns no retention credit", () => {
  const input = sample();
  input.witness.inventory[0]!.activeCohortEligible = false;
  input.witness.retained = [];
  assert.equal(inspectInventory(input)[0]!.qualifiedReadback, false);
});

test("a previously published version keeps its qualified witness after later authorized retirement", () => {
  const input = sample();
  const published = inspectInventory(input)[0]!;
  const entry = input.witness.inventory[0]!;
  entry.revision = "retired-r2";
  entry.lifecycle = "retired";
  entry.body = null;
  entry.unavailableReason = "unsettled";
  entry.activeCohortEligible = false;
  input.witness.retained = [];
  input.entries.push({ ...input.entries[0]!, entryRevision: entry.revision });
  assert.equal(inspectInventory(input)[0]!.qualifiedReadback, false);
  assert.equal(published.qualifiedReadback, true);
  assert.ok(input.seen.has(published.key));
});

test("independent command inventory includes omitted queued commands and refuses missing or destructive proofs", () => {
  const input = sample();
  inspectInventory(input);
  input.witness.commandInventoryIds = ["omitted-queued-forget"];
  assert.throws(() => inspectInventory(input), /eval_effect_inventory_invalid/);
  input.witness.effects = [
    {
      id: "omitted-queued-forget",
      entryId: "entry",
      kind: "forget",
      state: "queued",
      actorId: input.witness.inventory[0]!.sourceActor!,
      approvalAuthorityRevision: "automatic:fixture",
      scope: input.scope,
      sourceId: input.triggerSourceId,
      sourceRevision: input.witness.inventory[0]!.sourceRevision,
      automaticRetirement: null,
    },
  ];
  assert.throws(
    () => inspectInventory(input),
    /eval_observed_effect_authority_invalid/,
  );
});

test("omitted internal replacement retirement requires actual automatic ownership and a known old source", () => {
  const input = sample();
  inspectInventory(input);
  const id = automaticMemoryChildCommandId(input.witness.processingId, "entry");
  input.witness.commandInventoryIds = [id];
  input.witness.effects = [
    {
      id,
      entryId: "entry",
      kind: "retire",
      state: "queued",
      actorId: input.witness.inventory[0]!.sourceActor!,
      approvalAuthorityRevision: "automatic:fixture",
      scope: input.scope,
      sourceId: input.triggerSourceId,
      sourceRevision: input.witness.inventory[0]!.sourceRevision,
      automaticRetirement: {
        generation: "fixture-generation",
        cohortId: "cohort",
        epoch: "1",
        ownership: "automatic",
        currentCohortId: "replacement-cohort",
        currentEpoch: "2",
        currentState: "pending",
        invalidatedBy: null,
        suppressed: false,
      },
    },
  ];
  const initialCommands = new Set<string>();
  const valid = inspectInventory({ ...input, seenCommands: initialCommands });
  assert.equal(valid.length, 0);
  input.witness.effects[0]!.automaticRetirement!.ownership = "maintained";
  assert.throws(
    () => inspectInventory({ ...input, seenCommands: new Set() }),
    /eval_observed_effect_authority_invalid/,
  );
  input.witness.effects[0]!.automaticRetirement!.ownership = "automatic";
  assert.throws(
    () =>
      inspectInventory({
        ...input,
        seenCommands: new Set(),
        seenEntries: new Map(),
      }),
    /eval_observed_effect_authority_invalid/,
  );
});

test("durable capture queries fresh workspace/source/entry identities independently of returned IDs and bounds the result", async () => {
  const input = sample();
  const rows = [
    {
      id: "hidden-queued-retire",
      workspaceId: input.scope.workspaceId,
      scopeKey: JSON.stringify([
        input.scope.workspaceId,
        "repository",
        input.scope.repositoryId,
      ]),
      generation: "fixture-generation",
      entryId: "entry",
    },
  ];
  let query: unknown;
  const prisma = {
    memoryKnowledgeCommand: {
      findMany: async (value: unknown) => {
        query = value;
        return rows;
      },
    },
  } as unknown as Pick<PrismaClient, "memoryKnowledgeCommand">;
  const capture = {
    prisma,
    namespace: input.namespace,
    scope: input.scope,
    generation: "fixture-generation",
    knownEntryIds: ["entry"],
    processingIds: ["processing"],
    returnedIds: [],
  };
  const actual = await readDurableCommands(capture);
  assert.equal(actual[0]!.id, "hidden-queued-retire");
  const requested = query as { where: { OR: unknown[] }; take: number };
  assert.equal(requested.take, 257);
  assert.deepEqual(requested.where.OR[0], {
    workspaceId: input.scope.workspaceId,
  });
  assert.deepEqual(requested.where.OR[1], { entryId: { in: ["entry"] } });
  assert.deepEqual(requested.where.OR[3], {
    envelope: { path: ["source", "sourceId"], string_starts_with: "fixture:" },
  });
  assert.deepEqual(requested.where.OR[4], {
    id: {
      in: [0, 1, 2, 3, "entry"].map((child) =>
        automaticMemoryChildCommandId("processing", child),
      ),
    },
  });
  assert.throws(
    () =>
      inspectCommandInventory(
        { commandInventoryIds: [actual[0]!.id], effectIds: [], effects: [] },
        new Set(),
      ),
    /eval_effect_inventory_invalid/,
  );
  rows[0]!.workspaceId = "wrong-workspace";
  await assert.rejects(
    readDurableCommands(capture),
    /eval_durable_command_scope_invalid/,
  );
  while (rows.length < 257) rows.push({ ...rows[0]!, id: String(rows.length) });
  await assert.rejects(
    readDurableCommands(capture),
    /eval_command_inventory_exceeds_bounded_fixture/,
  );
});

test("ineligible automatic source is denied for both visible and bodyless new metadata despite supportive semantic labels", () => {
  for (const pending of [false, true]) {
    const input = sample();
    input.sourceHistory.get(
      `${input.triggerSourceId}\u0000${input.witness.inventory[0]!.sourceRevision}`,
    )!.automaticLearningEligible = false;
    if (pending) {
      input.witness.inventory[0]!.body = null;
      input.witness.inventory[0]!.lifecycle = "pending";
      input.witness.inventory[0]!.unavailableReason = "unsettled";
      input.witness.inventory[0]!.activeCohortEligible = false;
      input.witness.retained = [];
    }
    assert.deepEqual(input.entries[0]!.supportedFactIds, ["fact"]);
    assert.throws(
      () => inspectInventory(input),
      /eval_observed_entry_authority_invalid/,
    );
  }
});

test("current source eligibility independently gates an automatic save proof", () => {
  const input = sample();
  const known = input.sources.get(input.triggerSourceId)!;
  input.sources.set(input.triggerSourceId, {
    ...known,
    automaticLearningEligible: false,
  });
  input.witness.effectIds = ["command"];
  input.witness.commandInventoryIds = ["command"];
  input.witness.effects = [
    {
      id: "command",
      entryId: "entry",
      kind: "save",
      state: "published",
      actorId: known.actorId,
      approvalAuthorityRevision: "automatic:fixture",
      scope: input.scope,
      sourceId: input.triggerSourceId,
      sourceRevision: known.revision,
      automaticRetirement: null,
    },
  ];
  assert.throws(
    () => inspectInventory(input),
    /eval_observed_effect_authority_invalid/,
  );
});
