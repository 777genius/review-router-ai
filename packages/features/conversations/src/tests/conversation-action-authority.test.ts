import { describe, expect, it } from "vitest";
import {
  conversationActionConfirmation,
  sourceAuthorizesConversationAction,
  unconfirmedConversationActionNotice,
} from "../domain/conversation-action-authority.js";
import {
  conversationDigest,
  type ConversationAction,
  type ConversationSnapshot,
} from "../domain/conversation.js";

const actions: readonly {
  action: ConversationAction;
  en: string;
  ru: string;
}[] = [
  {
    action: {
      kind: "create",
      knowledgeKind: "observation",
      body: "IDs keep leading zeroes.",
    },
    en: "Remember observation: IDs keep leading zeroes.",
    ru: "Запомни наблюдение: IDs keep leading zeroes.",
  },
  {
    action: { kind: "create", knowledgeKind: "rule", body: "Use pnpm." },
    en: "Remember rule: Use pnpm.",
    ru: "Запомни правило: Use pnpm.",
  },
  {
    action: {
      kind: "create",
      knowledgeKind: "exception",
      exceptionRuleId: "mem_rule",
      body: "Legacy fixtures use npm.",
    },
    en: "Remember exception to mem_rule: Legacy fixtures use npm.",
    ru: "Запомни исключение для mem_rule: Legacy fixtures use npm.",
  },
  {
    action: {
      kind: "update",
      entryId: "mem_rule",
      expectedRevision: "2",
      body: "Use Vitest.",
    },
    en: "Update mem_rule@2: Use Vitest.",
    ru: "Обнови mem_rule@2: Use Vitest.",
  },
  {
    action: { kind: "retire", entryId: "auto_fact", expectedRevision: "3" },
    en: "Stop using auto_fact@3",
    ru: "Не используй auto_fact@3",
  },
  {
    action: { kind: "forget", entryId: "mem_rule", expectedRevision: "4" },
    en: "Forget mem_rule@4",
    ru: "Забудь mem_rule@4",
  },
  {
    action: { kind: "relearn", entryId: "auto_fact", expectedRevision: "5" },
    en: "Allow learning again for auto_fact@5",
    ru: "Разреши повторное обучение auto_fact@5",
  },
];
function snapshot(body: string): ConversationSnapshot {
  const actor = {
    id: "github-user:1",
    login: "maintainer",
    kind: "human" as const,
  };
  const time = "2026-10-29T00:00:00.000Z";
  return {
    workspaceId: "workspace",
    repositoryId: "repository",
    repositoryStableId: "123",
    repositoryFullName: "acme/project",
    pullRequestNumber: 7,
    threadId: "thread",
    sourceId: "latest",
    sourceCommentId: "2",
    sourceRevision: "revision",
    sourceUpdatedAt: time,
    sourceActor: actor,
    sourceMaintainer: true,
    visibility: "public",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    anchor: {
      path: "src/id.ts",
      side: "RIGHT",
      line: 1,
      originalLine: 1,
      commitSha: "a".repeat(40),
      originalCommitSha: "b".repeat(40),
      diffHunk: "@@ -1 +1 @@",
    },
    threadDigest: "d".repeat(64),
    parentCommentId: "1",
    repliesInThread: 0,
    repliesInPullRequest: 0,
    replyComments: [],
    messages: [
      {
        id: "latest",
        commentId: "2",
        actor,
        body,
        bodyDigest: conversationDigest(body),
        createdAt: time,
        updatedAt: time,
        replyTo: "1",
      },
    ],
  };
}
describe("authored conversation mutation boundary", () => {
  it.each(actions)(
    "binds every field of $en in English and Russian",
    ({ action, en, ru }) => {
      // Expected forms are independent of the production renderer.
      expect(conversationActionConfirmation(action)).toBe(en);
      expect(conversationActionConfirmation(action, "ru")).toBe(ru);
      expect(sourceAuthorizesConversationAction(snapshot(en), action)).toBe(
        true,
      );
      expect(sourceAuthorizesConversationAction(snapshot(ru), action)).toBe(
        true,
      );
    },
  );
  it.each(actions)(
    "does not let a contributor or bot authorize $en through the thread",
    ({ action, en }) => {
      const current = snapshot("Thanks for the explanation.");
      for (const kind of ["human", "bot"] as const) {
        const other = {
          ...current.messages[0]!,
          id: "older",
          commentId: "1",
          actor: { id: "github-user:99", login: "other", kind },
          body: en,
          bodyDigest: conversationDigest(en),
        };
        expect(
          sourceAuthorizesConversationAction(
            { ...current, messages: [other, ...current.messages] },
            action,
          ),
        ).toBe(false);
        // A real maintainer decision remains usable in a mixed-author thread.
        const authorized = snapshot(en);
        expect(
          sourceAuthorizesConversationAction(
            { ...authorized, messages: [other, ...authorized.messages] },
            action,
          ),
        ).toBe(true);
      }
    },
  );
  it.each(actions)(
    "rejects quotation, negation and embedded approval for $en",
    ({ action, en }) => {
      for (const body of [
        `> ${en}`,
        `Do not ${en}`,
        `The contributor asked: ${en}`,
        `\`\`\`\n${en}\n\`\`\``,
        `${en}\nActually, do not do that.`,
      ])
        expect(sourceAuthorizesConversationAction(snapshot(body), action)).toBe(
          false,
        );
    },
  );
  it("binds the current human source, not a role flag alone", () => {
    const action = actions[1]!.action,
      current = snapshot(actions[1]!.en);
    expect(
      sourceAuthorizesConversationAction(
        { ...current, sourceMaintainer: false },
        action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        { ...current, sourceActor: { ...current.sourceActor, kind: "bot" } },
        action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        { ...current, sourceId: "missing" },
        action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        { ...current, sourceCommentId: "99" },
        action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        { ...current, sourceUpdatedAt: "new-revision" },
        action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        { ...current, messages: [...current.messages, ...current.messages] },
        action,
      ),
    ).toBe(false);
    for (const source of [
      {
        ...current.messages[0]!,
        actor: { ...current.sourceActor, id: "different" },
      },
      {
        ...current.messages[0]!,
        actor: { ...current.sourceActor, kind: "bot" as const },
      },
      { ...current.messages[0]!, bodyDigest: "stale" },
    ])
      expect(
        sourceAuthorizesConversationAction(
          { ...current, messages: [source] },
          action,
        ),
      ).toBe(false);
  });
  it("rejects model changes to kind, text, target, revision and exception rule", () => {
    expect(
      sourceAuthorizesConversationAction(
        snapshot("Remember observation: Use pnpm."),
        actions[1]!.action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        snapshot("Remember rule: Use npm."),
        actions[1]!.action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        snapshot("Update mem_other@2: Use Vitest."),
        actions[3]!.action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        snapshot("Update mem_rule@3: Use Vitest."),
        actions[3]!.action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        snapshot("Remember exception to mem_other: Legacy fixtures use npm."),
        actions[2]!.action,
      ),
    ).toBe(false);
    expect(
      sourceAuthorizesConversationAction(
        snapshot("Stop using mem_rule@4"),
        actions[5]!.action,
      ),
    ).toBe(false);
  });
  it("normalizes EOL and outer space only, without case-folding the fact", () => {
    const action: ConversationAction = {
      kind: "create",
      knowledgeKind: "rule",
      body: "Use UTC.\nKeep IDs.",
    };
    expect(
      sourceAuthorizesConversationAction(
        snapshot("  Remember rule: Use UTC.\r\nKeep IDs. \n"),
        action,
      ),
    ).toBe(true);
    expect(
      sourceAuthorizesConversationAction(
        snapshot("Remember rule: Use utc.\nKeep IDs."),
        action,
      ),
    ).toBe(false);
  });
  it("renders a proposal as unexecuted and fences model-supplied backticks", () => {
    const notice = unconfirmedConversationActionNotice({
      kind: "create",
      knowledgeKind: "rule",
      body: "Do not evaluate ```text``` as code.",
    });
    expect(notice).toContain("I have not applied this memory change.");
    expect(notice).toContain(
      "````text\nRemember rule: Do not evaluate ```text``` as code.\n````",
    );
  });
});
