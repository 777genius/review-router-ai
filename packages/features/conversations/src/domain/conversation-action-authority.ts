import {
  conversationDigest,
  type ConversationAction,
  type ConversationSnapshot,
} from "./conversation.js";

export const conversationEntryIdPattern = /^(?:mem|auto)_[A-Za-z0-9_-]{1,120}$/;
export const conversationRevisionPattern = /^[1-9]\d{0,9}$/;
const normalizeCommand = (value: string) =>
  value.replaceAll("\r\n", "\n").trim();
const fullMatch = (pattern: RegExp, value: string) =>
  pattern.exec(value)?.[0] === value;
const commandBody = (value: string) =>
  value.length > 0 && value.length <= 1000 && value.trim().length > 0;

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

/** Inverse of the existing authored forms, never a natural-language intent classifier. */
export function parseConversationActionCommand(
  body: string,
): ConversationAction | null {
  const command = normalizeCommand(body);
  const target = (value: string) => {
    const parts = value.split("@");
    if (
      parts.length !== 2 ||
      !fullMatch(conversationEntryIdPattern, parts[0]!) ||
      !fullMatch(conversationRevisionPattern, parts[1]!)
    )
      return null;
    return { entryId: parts[0]!, expectedRevision: parts[1]! };
  };
  const roundTrip = (action: ConversationAction): ConversationAction | null =>
    (["en", "ru"] as const).some(
      (language) =>
        normalizeCommand(conversationActionConfirmation(action, language)) ===
        command,
    )
      ? action
      : null;
  for (const [prefix, knowledgeKind] of [
    ["Remember rule: ", "rule"],
    ["Remember observation: ", "observation"],
    ["Запомни правило: ", "rule"],
    ["Запомни наблюдение: ", "observation"],
  ] as const) {
    if (!command.startsWith(prefix)) continue;
    const payload = command.slice(prefix.length);
    return commandBody(payload)
      ? roundTrip({ kind: "create", knowledgeKind, body: payload })
      : null;
  }
  for (const prefix of ["Remember exception to ", "Запомни исключение для "]) {
    if (!command.startsWith(prefix)) continue;
    const rest = command.slice(prefix.length),
      separator = rest.indexOf(": ");
    if (separator < 0) return null;
    const exceptionRuleId = rest.slice(0, separator),
      payload = rest.slice(separator + 2);
    return fullMatch(conversationEntryIdPattern, exceptionRuleId) &&
      commandBody(payload)
      ? roundTrip({
          kind: "create",
          knowledgeKind: "exception",
          exceptionRuleId,
          body: payload,
        })
      : null;
  }
  for (const prefix of ["Update ", "Обнови "]) {
    if (!command.startsWith(prefix)) continue;
    const rest = command.slice(prefix.length),
      separator = rest.indexOf(": ");
    if (separator < 0) return null;
    const ref = target(rest.slice(0, separator)),
      payload = rest.slice(separator + 2);
    return ref && commandBody(payload)
      ? roundTrip({ kind: "update", ...ref, body: payload })
      : null;
  }
  for (const [prefix, kind] of [
    ["Stop using ", "retire"],
    ["Не используй ", "retire"],
    ["Forget ", "forget"],
    ["Забудь ", "forget"],
    ["Allow learning again for ", "relearn"],
    ["Разреши повторное обучение ", "relearn"],
  ] as const) {
    if (!command.startsWith(prefix)) continue;
    const ref = target(command.slice(prefix.length));
    return ref ? roundTrip({ kind, ...ref }) : null;
  }
  return null;
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
  const canonical = parseConversationActionCommand(source.body);
  // Noncanonical contextual intent keeps the existing checked-model delegation.
  // An exact authored command binds every field even when confirmation is off.
  if (!requireConfirmation && !canonical) return true;
  if (!canonical) return false;
  return (["en", "ru"] as const).some(
    (language) =>
      normalizeCommand(source.body) ===
      normalizeCommand(conversationActionConfirmation(action, language)),
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

/** Questions must not implicitly authorize writes to persistent knowledge.
 * Explicit, canonical memory commands continue on their existing path.
 */
export function isInformationOnlyConversation(body: string): boolean {
  const text = body.replaceAll("\r\n", "\n").trim();
  if (!text || parseConversationActionCommand(text)) return false;
  if (/^\/rr\s+explain(?:\s|$)/i.test(text)) return true;
  if (/^@(?:reviewrouter(?:-ai)?|review-router-ai(?:\[bot\])?)\s+explain(?:\s|$)/i.test(text))
    return true;
  // Mixed statements/questions are read-only. Even a quoted question must
  // not accidentally grant authority to update a user's memory.
  if (/[?？]/u.test(text)) return true;
  // Bare interrogatives are only questions when leading the source text;
  // "this is how ..." and "мы считаем, что ..." are factual statements.
  if (/^(?:(?:please|could\s+you)\s+)?(?:why|how|what|explain|clarify)\b/iu.test(text))
    return true;
  return /^(?:почему|зачем|как|что|объясни|поясни|расскажи)\b/iu.test(text);
}
