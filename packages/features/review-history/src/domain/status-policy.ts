import { HistoryStatus } from "./history";
import {
  HistoryCollisionError,
  type HistoryChangedEvent,
  type HistorySourceSnapshot,
} from "./history-events";
export type HistorySourceCursor = Readonly<{
  snapshot: HistorySourceSnapshot;
  hash: string;
}>;
export type HistoryProjectionState = Readonly<{
  selectedDispatchAttempt: number;
  intentCursor: HistorySourceCursor | null;
  executionCursor: HistorySourceCursor | null;
  completionCursor: HistorySourceCursor | null;
}>;
export function applyHistorySnapshot(
  current: HistoryProjectionState,
  snapshot: HistorySourceSnapshot,
  hash: string,
  binding: Readonly<{
    boundExecutionId: string | null;
    boundDispatchAttempt: number | null;
  }>,
): HistoryProjectionState {
  if (snapshot.attempt < current.selectedDispatchAttempt) return current;
  if (
    snapshot.kind !== "intent" &&
    (binding.boundExecutionId !== snapshot.sourceId ||
      binding.boundDispatchAttempt !== snapshot.attempt)
  )
    return current;
  const state =
    snapshot.attempt > current.selectedDispatchAttempt
      ? {
          selectedDispatchAttempt: snapshot.attempt,
          intentCursor: null,
          executionCursor: null,
          completionCursor: null,
        }
      : current;
  const key =
    snapshot.kind === "intent"
      ? "intentCursor"
      : snapshot.kind === "execution"
        ? "executionCursor"
        : "completionCursor";
  const previous = state[key];
  if (previous) {
    if (previous.snapshot.sourceId !== snapshot.sourceId)
      throw new HistoryCollisionError();
    const order =
      BigInt(snapshot.sourceVersion) - BigInt(previous.snapshot.sourceVersion);
    if (order < 0n) return state;
    if (order === 0n) {
      if (previous.hash !== hash) throw new HistoryCollisionError();
      return state;
    }
  }
  return { ...state, [key]: { snapshot, hash } };
}
export function historyStatus(state: HistoryProjectionState): HistoryStatus {
  const c = state.completionCursor?.snapshot;
  if (c?.kind === "completion") {
    switch (c.facts.state) {
      case "completed":
      case "completed_superseded":
        return HistoryStatus.Completed;
      case "partial_completed":
      case "publication_stale_visible":
        return HistoryStatus.Incomplete;
      case "publication_stale_compensated":
        return HistoryStatus.Stopped;
      case "blocked_publication_unknown":
        return HistoryStatus.Unconfirmed;
      case "publication_not_applied":
        return c.facts.safeReason === "publication_superseded_no_effect"
          ? HistoryStatus.Stopped
          : c.facts.safeReason === "publication_failed_no_effect"
            ? HistoryStatus.Failed
            : HistoryStatus.Unconfirmed;
      case "awaiting_publication":
      case "publication_in_progress":
      case "awaiting_snapshot":
        return HistoryStatus.Publishing;
      default:
        return HistoryStatus.Unconfirmed;
    }
  }
  const e = state.executionCursor?.snapshot;
  if (e?.kind === "execution") {
    switch (e.facts.state) {
      case "running":
        return HistoryStatus.Running;
      case "completed":
      case "partial":
        return HistoryStatus.Publishing;
      case "failed":
        return HistoryStatus.Failed;
      case "superseded":
        return HistoryStatus.Stopped;
      default:
        return HistoryStatus.Queued;
    }
  }
  const i = state.intentCursor?.snapshot;
  if (i?.kind === "intent") {
    if (i.facts.state === "superseded") return HistoryStatus.Stopped;
    if (i.facts.state === "terminal")
      return i.facts.terminalReason === "dispatch_outcome_unknown"
        ? HistoryStatus.Unconfirmed
        : HistoryStatus.Failed;
  }
  return HistoryStatus.Queued;
}
export function eventSnapshots(
  event: HistoryChangedEvent,
): readonly HistorySourceSnapshot[] {
  return [
    event.snapshot,
    ...(event.executionSeed ? [event.executionSeed] : []),
    ...(event.completionSeed ? [event.completionSeed] : []),
  ];
}
