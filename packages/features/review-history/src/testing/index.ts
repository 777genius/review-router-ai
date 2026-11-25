import type { HistoryReader } from "../application/ports/history-reader.js";
/** Construction-only fake: an unexpected read must fail rather than claim access. */
export const createUnreadHistoryReader = (): HistoryReader => {
  const unexpected = async (): Promise<never> => {
    throw new Error("unexpected_history_read");
  };
  return {
    resolvePullRequests: unexpected,
    listPullRequests: unexpected,
    listRuns: unexpected,
    listRepositories: unexpected,
  };
};
