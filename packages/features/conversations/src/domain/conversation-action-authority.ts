import {
  conversationDigest,
  type ConversationAction,
  type ConversationSnapshot,
} from "./conversation.js";

/** An exact authored decision, not a classifier of natural language or semantic evidence. */
export function conversationActionConfirmation(
  action: ConversationAction,
  language: "en" | "ru" = "en",
): string {
  if (action.kind === "create") {
    if (action.knowledgeKind === "exception")
      return language === "ru"
        ? `Запомни исключение для ${action.exceptionRuleId}: ${action.body}`
        : `Remember exception to ${action.exceptionRuleId}: ${action.body}`;
    const kind = action.knowledgeKind === "rule" ? "правило" : "наблюдение";
    return language === "ru"
      ? `Запомни ${kind}: ${action.body}`
      : `Remember ${action.knowledgeKind}: ${action.body}`;
  }
  const target = `${action.entryId}@${action.expectedRevision}`;
  switch (action.kind) {
    case "update":
      return language === "ru"
        ? `Обнови ${target}: ${action.body}`
        : `Update ${target}: ${action.body}`;
    case "retire":
      return language === "ru"
        ? `Не используй ${target}`
        : `Stop using ${target}`;
    case "forget":
      return language === "ru" ? `Забудь ${target}` : `Forget ${target}`;
    case "relearn":
      return language === "ru"
        ? `Разреши повторное обучение ${target}`
        : `Allow learning again for ${target}`;
  }
}

/** Verifies the current human actor and, when requested, their exact authored command. */
export function sourceAuthorizesConversationAction(
  snapshot: ConversationSnapshot,
  action: ConversationAction,
  requireConfirmation = true,
): boolean {
  const selected = snapshot.messages.filter(
    (message) => message.id === snapshot.sourceId,
  );
  if (!snapshot.sourceMaintainer || snapshot.sourceActor.kind !== "human")
    return false;
  const source = selected.length === 1 ? selected[0] : undefined;
  if (
    !source ||
    source.actor.kind !== "human" ||
    source.actor.id !== snapshot.sourceActor.id ||
    source.commentId !== snapshot.sourceCommentId ||
    source.updatedAt !== snapshot.sourceUpdatedAt ||
    conversationDigest(source.body) !== source.bodyDigest
  )
    return false;
  // Automatic mode delegates intent recognition to the checked conversation model.
  // Server-verified author/source identity above remains mandatory in both modes.
  if (!requireConfirmation) return true;
  // EOL/outer-space normalization does not rewrite text, target, revision or kind.
  const normalize = (value: string) => value.replaceAll("\r\n", "\n").trim();
  return (["en", "ru"] as const).some(
    (language) =>
      normalize(source.body) ===
      normalize(conversationActionConfirmation(action, language)),
  );
}

export function unconfirmedConversationActionNotice(
  action: ConversationAction,
): string {
  const instruction = conversationActionConfirmation(action);
  // A model-proposed body cannot close the surrounding Markdown code fence.
  const longest = Math.max(
    0,
    ...(instruction.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `I have not applied this memory change. A repository maintainer can confirm the exact text, kind and target by posting this as a standalone reply in this thread:\n\n${fence}text\n${instruction}\n${fence}\n\nOther messages cannot authorize a change on your behalf.`;
}

export function unconfirmedConversationObservationsNotice(
  statements: readonly string[],
): string {
  const confirmations = statements.map((body) => {
    const instruction = conversationActionConfirmation({
      kind: "create",
      knowledgeKind: "observation",
      body,
    });
    const longest = Math.max(
      0,
      ...(instruction.match(/`+/g) ?? []).map((run) => run.length),
    );
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `${fence}text\n${instruction}\n${fence}`;
  });
  return `These observations have not been saved. A repository maintainer can save an observation by posting its exact confirmation as a separate reply in this thread:\n\n${confirmations.join("\n\n")}`;
}
