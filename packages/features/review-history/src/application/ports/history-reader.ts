import type {
  HistoryListInput,
  HistoryPullRequestPage,
  HistoryRepositoriesInput,
  HistoryRepositoryPage,
  HistoryRunPage,
  HistoryRunsInput,
} from "../../domain/history.js";
export type HistoryReader = {
  readonly listPullRequests: (
    input: HistoryListInput,
  ) => Promise<HistoryPullRequestPage>;
  readonly listRuns: (input: HistoryRunsInput) => Promise<HistoryRunPage>;
  readonly listRepositories: (
    input: HistoryRepositoriesInput,
  ) => Promise<HistoryRepositoryPage>;
};
