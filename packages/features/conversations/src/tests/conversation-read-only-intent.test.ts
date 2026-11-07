import { describe, expect, it } from "vitest";
import { isInformationOnlyConversation, parseConversationActionCommand } from "../domain/conversation-action-authority.js";

describe("read-only explanations", () => {
  it.each([
    "/rr explain",
    "/rr explain this finding",
    "@review-router-ai explain",
    "@reviewrouter explain",
    "Why does the reviewer think this is unsafe?",
    "Our service verifies users. Почему это ошибка?",
    "Объясни этот риск",
    "Почему это проблема",
    "Как это исправить",
    "Что здесь сломано",
    "Explain the change",
    "Why is this wrong without punctuation",
    "Why？",
    "Our tests cover this. How is it unsafe?",
  ])("does not authorize memory changes for %s", (body) => {
    expect(isInformationOnlyConversation(body)).toBe(true);
  });

  it.each([
    "Identifiers are opaque strings.",
    "The interface prefers short labels.",
    "Мы считаем, что ID непрозрачны.",
    "Это как мы сохраняем данные.",
    "This is how identifiers are handled.",
    "I think that is what users expect.",
    "Thanks for the update.",
    "Remember observation: The build verifies IDs.",
    "Запомни правило: Use pnpm.",
    "Forget mem_example@2",
  ])("preserves normal source processing for %s", (body) => {
    expect(isInformationOnlyConversation(body)).toBe(false);
  });

  it("preserves an explicit memory command even when its content is a question", () => {
    const body = "Remember observation: Why do we retain leading zeroes?";
    expect(parseConversationActionCommand(body)).not.toBeNull();
    expect(isInformationOnlyConversation(body)).toBe(false);
  });
});
