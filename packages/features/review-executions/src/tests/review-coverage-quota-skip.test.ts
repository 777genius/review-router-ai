import { describe, expect, it } from "vitest";
import {
  deriveCoverageState,
  ReviewCoverageState,
  ReviewExecutionProviderKind,
  ReviewTaskKind,
  ReviewWorkSlotState,
  type ReviewWorkSlot,
} from "../domain/review-execution";

const slot = (
  workSlotId: string,
  vote: string,
  state: ReviewWorkSlotState,
  required = true,
): ReviewWorkSlot => ({
  workSlotId,
  taskKind: ReviewTaskKind.FindingDiscovery,
  providerKind: ReviewExecutionProviderKind.Codex,
  providerVoteIdentityHash: vote,
  shardKey: workSlotId,
  required,
  attemptBudget: 1,
  retryPolicyVersion: "retry.v1",
  state,
  activeLeaseId: null,
  acceptedObservationRefId: null,
  nextAttemptOrdinal: 2,
});

const { Satisfied, Exhausted, Pending } = ReviewWorkSlotState;
const quotaSkip = [
  slot("or-1", "openrouter", Exhausted),
  slot("or-2", "openrouter", Pending),
  slot("nv-1", "nvidia", Satisfied),
  slot("nv-2", "nvidia", Satisfied),
];

describe("required coverage when the Action skipped a quota-exhausted reviewer", () => {
  it("completes when the projection is complete and another reviewer finished", () => {
    expect(deriveCoverageState(quotaSkip, true)).toBe(
      ReviewCoverageState.Completed,
    );
  });

  it.each([
    ["the projection reports partial coverage", quotaSkip, false],
    [
      "no reviewer finished all of its required slots",
      [
        slot("or-1", "openrouter", Exhausted),
        slot("nv-1", "nvidia", Satisfied),
        slot("nv-2", "nvidia", Exhausted),
      ],
      true,
    ],
    [
      "the only finished reviewer has no required work",
      [
        slot("or-1", "openrouter", Exhausted),
        slot("nv-1", "nvidia", Satisfied, false),
      ],
      true,
    ],
  ])("stays partial when %s", (_case, slots, producerComplete) => {
    expect(deriveCoverageState(slots, producerComplete)).toBe(
      ReviewCoverageState.Partial,
    );
  });
});
