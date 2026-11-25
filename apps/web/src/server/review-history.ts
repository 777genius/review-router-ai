import {
  HistoryAccessError,
  HistoryValidationError,
  type HistoryFilters,
} from "@reviewrouter/features-review-history";
import { createReviewHistoryFeature } from "@reviewrouter/features-review-history/composition";
import { getDashboardSignedInActor } from "./dashboard-mutations";
import { getPrisma } from "./prisma";

class HistorySignInRequiredError extends Error {}
export function historyErrorStatus(error: unknown): number {
  if (error instanceof HistorySignInRequiredError) return 401;
  if (error instanceof HistoryAccessError) return 403;
  if (error instanceof HistoryValidationError) return 400;
  return 500;
}
export async function historyReaderContext() {
  const actor = await getDashboardSignedInActor({ readOnly: true });
  if (!actor?.userId) throw new HistorySignInRequiredError();
  const { reader } = await createReviewHistoryFeature({ prisma: getPrisma() });
  return { actorId: actor.userId, reader };
}
// Reader validates values after its workspace gate. Parsing must not supply an actor.
export function readHistoryFilters(params: URLSearchParams): HistoryFilters {
  const days = params.get("days");
  return {
    q: params.get("q") ?? "",
    repositoryId: params.get("repositoryId") || null,
    status: (params.get("status") ?? "all") as HistoryFilters["status"],
    days: (days === null || days === ""
      ? null
      : ["7", "30", "90"].includes(days)
        ? Number(days)
        : Number.NaN) as HistoryFilters["days"],
  };
}
export async function loadHistoryList(
  workspaceId: string,
  params: URLSearchParams,
) {
  const { actorId, reader } = await historyReaderContext();
  return reader.listPullRequests({
    actorId,
    workspaceId,
    filters: readHistoryFilters(params),
    ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
  });
}
export async function loadHistoryRuns(
  workspaceId: string,
  params: URLSearchParams,
) {
  const { actorId, reader } = await historyReaderContext();
  return reader.listRuns({
    actorId,
    workspaceId,
    pullRequestId: params.get("pullRequestId") ?? "",
    ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
  });
}
export async function loadHistoryRepositories(
  workspaceId: string,
  params: URLSearchParams,
) {
  const { actorId, reader } = await historyReaderContext();
  return reader.listRepositories({
    actorId,
    workspaceId,
    q: params.get("q") ?? "",
    ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
    ...(params.get("selectedRepositoryId")
      ? { selectedRepositoryId: params.get("selectedRepositoryId")! }
      : {}),
  });
}
