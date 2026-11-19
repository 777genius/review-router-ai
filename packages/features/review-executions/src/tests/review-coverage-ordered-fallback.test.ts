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
// The captured chain, in order: first, second, third.
const chain = (producerCoverageComplete = true) => ({
  providerQuotaExhaustedVotes: new Set<string>(),
  orderedFallbackVotes: new Set(["first", "second", "third"]),
  producerCoverageComplete,
});

describe("required coverage of an ordered fallback", () => {
  it.each([
    [
      "the first reviewer failed and the second finished",
      [
        slot("a", "first", Exhausted),
        slot("b", "second", Satisfied),
        slot("c", "third", Pending),
      ],
    ],
    [
      "the first reviewer finished and the others were not needed",
      [
        slot("a", "first", Satisfied),
        slot("b", "second", Pending),
        slot("c", "third", Cancelled),
      ],
    ],
  ])("completes when %s", (_case, slots) => {
    expect(deriveCoverageState(slots, chain())).toBe(
      ReviewCoverageState.Completed,
    );
  });

  it.each([
    [
      "every reviewer failed",
      [
        slot("a", "first", Exhausted),
        slot("b", "second", Exhausted),
        slot("c", "third", Exhausted),
      ],
      chain(),
    ],
    [
      "a reviewer finished only part of its required work",
      [
        slot("a1", "first", Satisfied),
        slot("a2", "first", Exhausted),
        slot("b", "second", Pending),
      ],
      chain(),
    ],
    [
      "another reviewer still holds a lease",
      [slot("a", "first", Satisfied), slot("b", "second", Leased)],
      chain(),
    ],
    [
      "the open slot belongs to no reviewer of the chain",
      [slot("a", "first", Satisfied), slot("x", "foreign", Exhausted)],
      chain(),
    ],
    [
      "the finished reviewer had only optional work",
      [slot("a", "first", Satisfied, false), slot("b", "second", Exhausted)],
      chain(),
    ],
    [
      "the producer does not claim complete coverage",
      [slot("a", "first", Exhausted), slot("b", "second", Satisfied)],
      chain(false),
    ],
    [
      "the snapshot was not captured as a fallback",
      [slot("a", "first", Exhausted), slot("b", "second", Satisfied)],
      {
        providerQuotaExhaustedVotes: new Set<string>(),
        producerCoverageComplete: true,
      },
    ],
  ])("stays partial when %s", (_case, slots, exceptions) => {
    expect(deriveCoverageState(slots, exceptions)).toBe(
      ReviewCoverageState.Partial,
    );
  });
});
