import { describe, expect, it } from "vitest";
import { classifySetupPullRequestHead } from "../domain/setup-pull-request-head.js";

const oldHead = "a".repeat(40);
const newHead = "b".repeat(40);

describe("setup PR head classification (observation only)", () => {
  it.each([
    ["matching merged", oldHead, "merged", true, oldHead, false, true],
    ["changed merged", oldHead, "merged", true, newHead, true, false],
    ["missing stored head", null, "merged", true, oldHead, true, false],
    ["missing attempt", undefined, "merged", true, oldHead, true, false],
    ["not merged with matching head", oldHead, "open", false, oldHead, false, false],
    ["closed with matching head", oldHead, "closed", false, oldHead, false, false],
    ["wrong branch", oldHead, "wrong_base_branch", false, oldHead, false, false],
    ["merged wrong branch with stored head", oldHead, "wrong_base_branch", true, oldHead, false, false],
    ["merged wrong branch without stored head", null, "wrong_base_branch", true, oldHead, true, false],
    ["untrusted merged status", oldHead, "merged", false, oldHead, false, true],
    ["no persisted PR head with open observation", null, "open", false, newHead, false, false],
  ] as const)(
    "%s",
    (_name, persistedHeadSha, status, merged, headSha, historical, matching) => {
      expect(
        classifySetupPullRequestHead({
          persistedHeadSha,
          inspection: { status, merged, headSha },
        }),
      ).toEqual({
        historicalMergedSetupPullRequest: historical,
        setupPullRequestMerged: matching,
      });
    },
  );

  it("does not infer a merged PR without an observation", () => {
    expect(
      classifySetupPullRequestHead({
        persistedHeadSha: oldHead,
        inspection: null,
      }),
    ).toEqual({
      historicalMergedSetupPullRequest: false,
      setupPullRequestMerged: false,
    });
  });
});
