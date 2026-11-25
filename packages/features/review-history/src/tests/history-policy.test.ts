import { describe, it, expect } from "vitest";
import { HistoryStatus } from "../domain/history";
import {
  HistoryCollisionError,
  type HistorySourceSnapshot,
} from "../domain/history-events";
import {
  applyHistorySnapshot,
  historyStatus,
  type HistoryProjectionState,
} from "../domain/status-policy";
import { historyHash } from "../adapters/outbound/history-hash";
const empty: HistoryProjectionState = {
  selectedDispatchAttempt: 0,
  intentCursor: null,
  executionCursor: null,
  completionCursor: null,
};
const binding = { boundExecutionId: "winner", boundDispatchAttempt: 2 };
const apply = (
  state: HistoryProjectionState,
  snapshot: HistorySourceSnapshot,
) => applyHistorySnapshot(state, snapshot, historyHash(snapshot), binding);
function intent(
  attempt: number,
  version: string,
  id = `request-${attempt}`,
): HistorySourceSnapshot {
  return {
    kind: "intent",
    sourceId: id,
    attempt,
    sourceVersion: version,
    facts: {
      state: "pending_dispatch",
      terminalReason: null,
      admissionState: "not_evaluated",
      executionId: null,
    },
  };
}
function completion(
  state: string,
  reason = "publication_succeeded",
): HistorySourceSnapshot {
  return {
    kind: "completion",
    sourceId: "winner",
    attempt: 2,
    sourceVersion: "4",
    facts: {
      state,
      safeReason: reason,
      publicationAttemptId: "publication",
      snapshotCommitReceiptId: null,
    },
  };
}
describe("review history projection policy", () => {
  it("accepts recovery version one after predecessor seven and rejects stale attempt", () => {
    const before = apply(empty, intent(1, "7"));
    const next = apply(before, intent(2, "1"));
    expect(next.selectedDispatchAttempt).toBe(2);
    expect(next.intentCursor?.snapshot.sourceVersion).toBe("1");
    expect(apply(next, intent(1, "8"))).toBe(next);
  });
  it("keeps source ids as identity and detects equal-version conflict", () => {
    const before = apply(empty, intent(2, "7"));
    expect(apply(before, intent(2, "7"))).toBe(before);
    expect(() => apply(before, intent(2, "7", "other"))).toThrow(
      HistoryCollisionError,
    );
    expect(() =>
      apply(before, {
        ...intent(2, "7"),
        facts: {
          state: "superseded",
          terminalReason: null,
          admissionState: "not_evaluated",
          executionId: null,
        },
      } as HistorySourceSnapshot),
    ).toThrow(HistoryCollisionError);
  });
  it("ignores higher-generation unbound candidate and prevents late binding seed regression", () => {
    const winner: HistorySourceSnapshot = {
      kind: "execution",
      sourceId: "winner",
      attempt: 2,
      sourceVersion: "8",
      facts: {
        state: "completed",
        generation: "3",
        finalizedArtifactId: "artifact",
      },
    };
    const current = apply(empty, winner);
    expect(historyStatus(current)).toBe(HistoryStatus.Publishing);
    expect(
      apply(current, {
        ...winner,
        sourceId: "loser",
        facts: {
          state: "superseded",
          generation: "99",
          finalizedArtifactId: null,
        },
      }),
    ).toBe(current);
    expect(
      apply(current, {
        ...winner,
        sourceVersion: "2",
        facts: { state: "running", generation: "3", finalizedArtifactId: null },
      }),
    ).toBe(current);
  });
  it.each([
    ["completed", "snapshot_committed", HistoryStatus.Completed],
    ["completed_superseded", "snapshot_superseded", HistoryStatus.Completed],
    [
      "partial_completed",
      "partial_coverage_published",
      HistoryStatus.Incomplete,
    ],
    [
      "publication_not_applied",
      "publication_superseded_no_effect",
      HistoryStatus.Stopped,
    ],
    [
      "publication_not_applied",
      "publication_failed_no_effect",
      HistoryStatus.Failed,
    ],
    [
      "publication_stale_compensated",
      "publication_stale_compensated",
      HistoryStatus.Stopped,
    ],
    [
      "publication_stale_visible",
      "publication_stale_visible",
      HistoryStatus.Incomplete,
    ],
    [
      "blocked_publication_unknown",
      "publication_terminal_unknown",
      HistoryStatus.Unconfirmed,
    ],
    ["awaiting_snapshot", "publication_succeeded", HistoryStatus.Publishing],
  ])("maps %s safely", (state, reason, status) =>
    expect(historyStatus(apply(empty, completion(state, reason)))).toBe(status),
  );
  it("completion survives late intent phase and independent source version", () => {
    let state = apply(empty, completion("completed"));
    state = apply(state, intent(2, "100"));
    expect(historyStatus(state)).toBe(HistoryStatus.Completed);
  });
});
