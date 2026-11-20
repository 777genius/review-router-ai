import { describe, expect, it } from "vitest";
import {
  soleReviewerHasDailyLimit,
  type RosterReviewerModel,
} from "./daily-request-limit";

const free: RosterReviewerModel = {
  provider: "openrouter",
  model: "openai/gpt-oss-120b:free",
};
const paid: RosterReviewerModel = {
  provider: "openrouter",
  model: "openai/gpt-5.3-codex",
};

describe("soleReviewerHasDailyLimit", () => {
  it.each<[string, readonly RosterReviewerModel[], boolean]>([
    ["the only reviewer is an OpenRouter :free model", [free], true],
    ["no reviewer yet", [], false],
    ["the only reviewer is a paid OpenRouter model", [paid], false],
    // A $0 price without the :free variant has no documented daily cap.
    [
      "the only reviewer is a free-priced model without :free",
      [{ provider: "openrouter", model: "openrouter/owl-alpha" }],
      false,
    ],
    [
      "another provider happens to use the :free suffix",
      [{ provider: "nvidia", model: "vendor/model:free" }],
      false,
    ],
    [
      "the account's provider is still loading",
      [{ provider: undefined, model: free.model }],
      false,
    ],
    ["the model is not chosen yet", [{ provider: "openrouter", model: "" }], false],
    ["a second reviewer backs the free model up", [free, paid], false],
    ["both reviewers are free models", [free, free], false],
  ])("%s", (_case, reviewers, expected) => {
    expect(soleReviewerHasDailyLimit(reviewers)).toBe(expected);
  });
});
