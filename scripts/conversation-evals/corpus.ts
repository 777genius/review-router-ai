import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ConversationSnapshot } from "../../packages/features/conversations/src/domain/conversation.js";
export const corpusSourceId = (namespace: string, messageId: string) =>
  `github-node:${namespace}_${createHash("sha256").update(messageId).digest("hex")}`;
export function evaluationProcessingIdentity(template: {
  workspaceId: string;
  repositoryId: string;
  githubRepositoryId: string;
  fullName: string;
}) {
  if (
    !/^[1-9]\d{0,19}$/u.test(template.githubRepositoryId) ||
    !/^[^/\s]+\/[^/\s]+$/u.test(template.fullName)
  )
    throw new Error("eval_qualified_processing_identity_invalid");
  return {
    workspaceId: template.workspaceId,
    repositoryId: template.repositoryId,
    repositoryStableId: template.githubRepositoryId,
    repositoryFullName: template.fullName,
  };
}
/** Memory has fresh scopes; model processing uses the actual qualified template identity. */
export const projectEvaluationSnapshot = (
  snapshot: ConversationSnapshot,
  scope: { workspaceId: string; repositoryId: string },
): ConversationSnapshot => ({
  ...snapshot,
  workspaceId: scope.workspaceId,
  repositoryId: scope.repositoryId,
});
/** GitHub snapshots use canonical timestamps; immutable corpus text remains unchanged. */
export const canonicalCorpusMessages = (
  messages: CorpusMessage[],
): CorpusMessage[] =>
  messages.map((message) => ({
    ...message,
    createdAt: new Date(message.createdAt).toISOString(),
    updatedAt: new Date(message.updatedAt).toISOString(),
  }));
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
  /** Successor-only authored setting changes; omitted means keep the workspace setting. */
  policy?: { requireConfirmation?: boolean; automaticLearning?: boolean };
  bindTargets?: {
    alias: string;
    sourceMessageId: string;
    index: number;
    revision?: "initial" | "current";
  }[];
  /** An explicit fixture author decision to confirm a real observed native proposal. */
  confirmProposal?: { messageId: string; index: number };
  expectedEffects?: {
    kind: "save" | "retire" | "forget";
    targetAlias?: string;
  }[];
};
export type TargetBinding = {
  entryId: string;
  revision: string;
  sourceMessageId: string;
  index: number;
};
export type EventResolution = {
  targets: Record<string, TargetBinding>;
  confirmation?: { messageId: string; index: number; body: string };
};
/** Only observed IDs/revisions and an explicitly requested actual proposal enter authored input. */
export function resolveCorpusMessages(
  thread: CorpusThread,
  event: CorpusEvent,
  resolution: EventResolution,
  priorBodies: Map<string, string>,
): CorpusMessage[] {
  return corpusEventMessages(thread, event).map((message) => {
    const key = `${message.id}\u0000${message.updatedAt}\u0000${message.body}`;
    let body = priorBodies.get(key);
    if (body === undefined) {
      body = message.body.replace(
        /\{\{(entry|revision):([a-z0-9_-]+)\}\}/gu,
        (_, field: string, alias: string) => {
          const target = resolution.targets[alias];
          if (!target) throw new Error("eval_target_binding_missing");
          return field === "entry" ? target.entryId : target.revision;
        },
      );
      if (message.id === event.messageId && event.confirmProposal) {
        const confirmed = resolution.confirmation;
        if (
          !confirmed ||
          confirmed.messageId !== event.confirmProposal.messageId ||
          confirmed.index !== event.confirmProposal.index
        )
          throw new Error("eval_observed_proposal_missing");
        body = `Remember observation: ${confirmed.body}`;
      }
      priorBodies.set(key, body);
    }
    return { ...message, body };
  });
}
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
  /** Repositories in one scenario share only workspace policy, never repository memory. */
  repositoryKey?: string;
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
export type CorpusName = "legacy-v1" | "full-thread-v2";
export async function loadCorpus(
  name: CorpusName = "legacy-v1",
): Promise<Corpus> {
  if (!["legacy-v1", "full-thread-v2"].includes(name))
    throw new Error("eval_corpus_unknown");
  const corpus = JSON.parse(
    await readFile(
      new URL(
        name === "legacy-v1" ? "./corpus.json" : "./corpus.full-thread-v2.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Corpus;
  const ids = new Set(corpus.threads.map((thread) => thread.id));
  if (
    ids.size !== (name === "legacy-v1" ? 48 : 16) ||
    corpus.threads.filter((t) => t.split === "tuning").length !==
      (name === "legacy-v1" ? 32 : 10) ||
    corpus.threads.filter((t) => t.split === "holdout").length !==
      (name === "legacy-v1" ? 16 : 6)
  )
    throw new Error("corpus_whole_thread_split_invalid");
  const factIds = new Set(corpus.facts.map((fact) => fact.id));
  if (
    factIds.size !== corpus.facts.length ||
    factIds.size < (name === "legacy-v1" ? 80 : 1) ||
    factIds.size > 120
  )
    throw new Error("corpus_fact_inventory_invalid");
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
  if (pairs !== (name === "legacy-v1" ? 8 : 4))
    throw new Error("corpus_linked_inventory_invalid");
  return corpus;
}
