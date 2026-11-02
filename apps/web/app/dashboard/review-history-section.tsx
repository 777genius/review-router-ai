import { randomUUID } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import type {
  HistoryPullRequestPage,
  HistoryRepositoryPage,
} from "@reviewrouter/features-review-history";
import {
  historyReaderContext,
  historyErrorStatus,
} from "../../src/server/review-history";
import { historyFiltersFromUrl } from "../../src/features/review-history/application/history-presentation";
import { HistoryView } from "../../src/features/review-history/interface/history-view";
import { HistoryRetry } from "../../src/features/review-history/interface/history-retry";

export async function ReviewHistorySection({
  workspaceId,
  params,
}: {
  workspaceId: string;
  params: Record<string, string | string[] | undefined>;
}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) search.set(key, first);
  }
  const filters = historyFiltersFromUrl(search);
  let actorId: string | null = null;
  let page: HistoryPullRequestPage | null = null;
  let repositories: HistoryRepositoryPage | null = null;
  let errorStatus: number | undefined;
  try {
    const context = await historyReaderContext();
    actorId = context.actorId;
    // The first scoped read establishes membership even for a malformed URL.
    repositories = await context.reader.listRepositories({
      actorId,
      workspaceId,
      ...(filters.repositoryId
        ? { selectedRepositoryId: filters.repositoryId }
        : {}),
    });
    page = await context.reader.listPullRequests({
      actorId,
      workspaceId,
      filters,
    });
  } catch (error) {
    unstable_rethrow(error);
    errorStatus = historyErrorStatus(error);
    if (errorStatus === 500)
      console.error("review_history_load_failed", { workspaceId });
  }
  if (!actorId || errorStatus === 401 || errorStatus === 403)
    return (
      <section id="dashboard-section-content" aria-label="Review history">
        <h1 className="text-2xl font-semibold">Reviews</h1>
        <p role="alert" className="my-6 text-sm leading-7 text-slate-400">
          {errorStatus === 401
            ? "Sign in to view review history."
            : errorStatus === 403
              ? "You do not have access to review history in this workspace."
              : "Reviews could not be loaded."}
        </p>
        {errorStatus !== 401 ? <HistoryRetry /> : null}
      </section>
    );
  return (
    <HistoryView
      actorId={actorId}
      workspaceId={workspaceId}
      seedId={randomUUID()}
      initialFilters={filters}
      initialPage={page}
      initialRepositories={repositories}
      {...(errorStatus ? { initialError: errorStatus } : {})}
    />
  );
}
