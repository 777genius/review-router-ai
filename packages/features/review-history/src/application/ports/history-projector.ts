import type { HistoryChangedEvent } from "../../domain/history-events";
export type HistoryProjectionResult = "applied" | "duplicate" | "ignored";
export type HistoryProjector = Readonly<{
  project: (event: HistoryChangedEvent) => Promise<HistoryProjectionResult>;
}>;
