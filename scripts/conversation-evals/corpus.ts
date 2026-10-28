import { readFile } from "node:fs/promises";
export type CorpusMessage = {
  id: string;
  actor: string;
  actorKind: "human" | "bot";
  role?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  replyTo: string | null;
};
export type CorpusEvent = {
  id?: string;
  snapshot?: {
    throughMessageId: string;
    changes: {
      messageId: string;
      body?: string;
      updatedAt?: string;
      deleted?: boolean;
    }[];
  };
  messageId: string;
  action: "created" | "edited" | "deleted";
  eligibleFactIds: string[];
  expectedReply: string;
  requiredFactIds: string[];
  forbiddenEffects: string[];
  forbiddenFactIds?: string[];
  criticalSlices: string[];
};
/** Source snapshots contain raw fixture input only; labels never enter product input. */
export function corpusEventId(
  thread: CorpusThread,
  event: CorpusEvent,
): string {
  return `${thread.id}:${event.id ?? event.messageId}`;
}
export function corpusEventMessages(
  thread: CorpusThread,
  event: CorpusEvent,
): CorpusMessage[] {
  const end = thread.messages.findIndex(
    (row) => row.id === (event.snapshot?.throughMessageId ?? event.messageId),
  );
  if (end < 0) throw new Error("corpus_snapshot_source_missing");
  const messages = new Map(
    thread.messages.slice(0, end + 1).map((row) => [row.id, { ...row }]),
  );
  for (const previous of thread.events) {
    for (const change of previous.snapshot?.changes ?? []) {
      const original = messages.get(change.messageId);
      if (!original) throw new Error("corpus_snapshot_change_missing");
      if (change.deleted) messages.delete(change.messageId);
      else
        messages.set(change.messageId, {
          ...original,
          ...(change.body === undefined ? {} : { body: change.body }),
          ...(change.updatedAt === undefined
            ? {}
            : { updatedAt: change.updatedAt }),
        });
    }
    if (previous === event) break;
  }
  if (!messages.has(event.messageId))
    throw new Error("corpus_snapshot_trigger_missing");
  return [...messages.values()];
}
export type CorpusThread = {
  id: string;
  split: "tuning" | "holdout";
  scenario: string;
  phase: "A" | "B" | "standalone";
  linked: boolean;
  language: string;
  policy: {
    automaticLearning: boolean;
    discussionReplies: boolean;
    existingThreadReplies: number;
    existingPrReplies: number;
  };
  headSha: string;
  anchor: { path: string; line: number; side: string; code: string };
  messages: CorpusMessage[];
  events: CorpusEvent[];
  afterMutation?: {
    kind: "retire" | "forget";
    targetFactIds: string[];
    expectedEffect: string;
    repeatQuestion: string;
    expectedReply: string;
    forbiddenFactIds: string[];
  };
};
export type CorpusFact = {
  id: string;
  text: string;
  threadId: string;
  sourceMessageId: string;
  sourceActor: string;
  sourceRevision: string;
  kind: string;
  scope: string;
  audience: string;
  observedCommit: string;
};
export type Corpus = {
  version: string;
  revision: string;
  threads: CorpusThread[];
  facts: CorpusFact[];
  targets: Record<string, number>;
};
export async function loadCorpus(): Promise<Corpus> {
  const corpus = JSON.parse(
    await readFile(new URL("./corpus.json", import.meta.url), "utf8"),
  ) as Corpus;
  const ids = new Set(corpus.threads.map((thread) => thread.id));
  if (
    ids.size !== 48 ||
    corpus.threads.filter((t) => t.split === "tuning").length !== 32 ||
    corpus.threads.filter((t) => t.split === "holdout").length !== 16
  )
    throw new Error("corpus_whole_thread_split_invalid");
  const factIds = new Set(corpus.facts.map((fact) => fact.id));
  if (
    factIds.size !== corpus.facts.length ||
    factIds.size < 80 ||
    factIds.size > 120
  )
    throw new Error("corpus_fact_inventory_invalid");
  const factsById = new Map(corpus.facts.map((fact) => [fact.id, fact]));
  const scenarios = new Map<string, CorpusThread[]>();
  for (const thread of corpus.threads) {
    scenarios.set(thread.scenario, [
      ...(scenarios.get(thread.scenario) ?? []),
      thread,
    ]);
    const messages = new Map(
      thread.messages.map((message) => [message.id, message]),
    );
    if (
      new Set(thread.events.map((event) => corpusEventId(thread, event)))
        .size !== thread.events.length
    )
      throw new Error("corpus_event_identity_invalid");
    for (const event of thread.events) {
      const visible = corpusEventMessages(thread, event);
      if (
        !messages.has(event.messageId) ||
        !event.eligibleFactIds.every((id) => factIds.has(id)) ||
        !event.requiredFactIds.every((id) => factIds.has(id))
      )
        throw new Error("corpus_event_reference_invalid");
      if (new Set(visible.map((message) => message.id)).size !== visible.length)
        throw new Error("corpus_snapshot_identity_invalid");
    }
  }
  let pairs = 0;
  for (const threads of scenarios.values()) {
    if (new Set(threads.map((thread) => thread.split)).size !== 1)
      throw new Error("corpus_split_leakage");
    if (threads[0]!.linked) {
      pairs++;
      if (
        threads.length !== 2 ||
        threads
          .map((t) => t.phase)
          .sort()
          .join() !== "A,B"
      )
        throw new Error("corpus_linked_pair_invalid");
      const b = threads.find((t) => t.phase === "B")!;
      for (const fact of corpus.facts.filter(
        (f) => f.threadId === threads.find((t) => t.phase === "A")!.id,
      ))
        if (JSON.stringify(b.messages).includes(fact.text))
          throw new Error("corpus_recall_answer_leaked_into_B");
    }
  }
  if (pairs !== 8) throw new Error("corpus_linked_inventory_invalid");
  return corpus;
}
