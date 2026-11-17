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

const { Satisfied, Exhausted, Cancelled, Pending, Leased } =
  ReviewWorkSlotState;
const quota = (producerCoverageComplete = true) => ({
  providerQuotaExhaustedVotes: new Set(["openrouter"]),
  producerCoverageComplete,
});
const quotaSkip = [
  slot("or-1", "openrouter", Exhausted),
  slot("or-2", "openrouter", Exhausted),
  slot("nv-1", "nvidia", Satisfied),
  slot("nv-2", "nvidia", Satisfied),
];

describe("required coverage with a server-recorded provider quota skip", () => {
  it("completes when every open slot is an exhausted quota slot and another reviewer finished", () => {
    expect(deriveCoverageState(quotaSkip, quota())).toBe(
      ReviewCoverageState.Completed,
    );
  });

  it.each([
    [
      "the producer claims complete coverage over an open non-quota slot",
      [...quotaSkip, slot("auth-1", "auth", Exhausted)],
      quota(),
    ],
    [
      "the producer claims complete coverage without any recorded quota",
      quotaSkip,
      {
        providerQuotaExhaustedVotes: new Set<string>(),
        producerCoverageComplete: true,
      },
    ],
    ["the projection reports partial coverage", quotaSkip, quota(false)],
    [
      "a quota slot is still pending",
      [...quotaSkip, slot("or-3", "openrouter", Pending)],
      quota(),
    ],
    [
      "a quota slot is still leased",
      [...quotaSkip, slot("or-3", "openrouter", Leased)],
      quota(),
    ],
    [
      "a quota slot was cancelled instead of exhausted",
      [...quotaSkip, slot("or-3", "openrouter", Cancelled)],
      quota(),
    ],
    [
      "no other reviewer finished all of its required slots",
      [
        slot("or-1", "openrouter", Exhausted),
        slot("nv-1", "nvidia", Satisfied),
        slot("nv-2", "nvidia", Exhausted),
      ],
      quota(),
    ],
    [
      "the only finished reviewer has no required work",
      [
        slot("or-1", "openrouter", Exhausted),
        slot("nv-1", "nvidia", Satisfied, false),
      ],
      quota(),
    ],
  ])("stays partial when %s", (_case, slots, exceptions) => {
    expect(deriveCoverageState(slots, exceptions)).toBe(
      ReviewCoverageState.Partial,
    );
  });
});
