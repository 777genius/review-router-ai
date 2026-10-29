import type {
  HistoryListInput,
  HistoryPullRequestPage,
  HistoryPullRequestResolution,
  HistoryPullRequestResolutionInput,
  HistoryRepositoriesInput,
  HistoryRepositoryPage,
  HistoryRunPage,
  HistoryRunsInput,
} from "../../domain/history.js";
export type HistoryReader = {
  readonly resolvePullRequests: (
    input: HistoryPullRequestResolutionInput,
  ) => Promise<HistoryPullRequestResolution>;
  readonly listPullRequests: (
    input: HistoryListInput,
  ) => Promise<HistoryPullRequestPage>;
  readonly listRuns: (input: HistoryRunsInput) => Promise<HistoryRunPage>;
  readonly listRepositories: (
    input: HistoryRepositoriesInput,
  ) => Promise<HistoryRepositoryPage>;
};
