export enum HistoryStatus {
  Queued = "queued",
  Running = "running",
  Publishing = "publishing",
  Completed = "completed",
  Incomplete = "incomplete",
  Failed = "failed",
  Stopped = "stopped",
  Unconfirmed = "unconfirmed",
}
export type HistoryStatusGroup = "all" | "active" | "completed" | "attention";
export type HistoryFilters = {
  readonly q: string;
  readonly repositoryId: string | null;
  readonly status: HistoryStatusGroup;
  readonly days: null | 7 | 30 | 90;
};
export type HistoryCoverage =
  | { readonly state: "unavailable" }
  | {
      readonly state: "available";
      readonly availableSince: string;
      readonly supportedSource: "github_v2";
    };
export type HistoryScope = {
  readonly actorId: string;
  readonly workspaceId: string;
};
export type HistoryPullRequest = {
  readonly id: string;
  readonly scmRepositoryIdentityId: string;
  readonly repositoryFullName: string;
  readonly pullRequestNumber: number;
  readonly pullRequestTitle: string | null;
  readonly pullRequestUrl: string | null;
  readonly status: HistoryStatus;
  readonly requestedAt: string;
};
export type HistoryPullRequestPage = {
  readonly items: readonly HistoryPullRequest[];
  readonly nextCursor: string | null;
  readonly windowToken: string;
  readonly coverage: HistoryCoverage;
};
export type HistoryListInput = HistoryScope & {
  readonly filters: HistoryFilters;
  /** A continuation cursor or the first page's null-position windowToken. */
  readonly cursor?: string;
};
export type HistoryRun = {
  readonly id: string;
  readonly requestedAt: string;
  readonly status: HistoryStatus;
};
export type HistoryRunPage = {
  readonly items: readonly HistoryRun[];
  readonly nextCursor: string | null;
};
export type HistoryRunsInput = HistoryScope & {
  readonly pullRequestId: string;
  readonly cursor?: string;
};
export type HistoryRepositoryOption = {
  readonly id: string;
  readonly fullName: string;
};
export type HistoryRepositoryPage = {
  readonly items: readonly HistoryRepositoryOption[];
  readonly selected: HistoryRepositoryOption | null;
  readonly nextCursor: string | null;
};
export type HistoryRepositoriesInput = HistoryScope & {
  readonly q?: string;
  readonly cursor?: string;
  readonly selectedRepositoryId?: string;
};
export class HistoryAccessError extends Error {
  readonly code = "history_access_denied";
  constructor() {
    super("history_access_denied");
    this.name = "HistoryAccessError";
  }
}
export class HistoryValidationError extends Error {
  readonly code = "history_invalid_query";
  constructor(message = "history_invalid_query") {
    super(message);
    this.name = "HistoryValidationError";
  }
}
