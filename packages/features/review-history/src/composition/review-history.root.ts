import { assemblyFor, type Assembly } from "@get-modular/assembly";
import type { PrismaClient } from "@prisma/client";
import { reviewHistoryGroup } from "./review-history.group.js";
import { historyModule } from "./review-history.module.js";
import { historyDatabaseInput } from "./review-history.inputs.js";
import {
  HistoryDatabase,
  type HistoryCapabilities,
  type ReviewHistoryFeature,
} from "./review-history.contracts.js";
export const reviewHistoryModules = [reviewHistoryGroup] as const;
export const composeReviewHistory = (api: Assembly<HistoryCapabilities>) =>
  api.prepare({
    profileId: "reviewrouter/review-history",
    modules: reviewHistoryModules,
    roots: { history: historyModule },
    inputs: { database: historyDatabaseInput },
  });
/** Passive construction only. Activation and database cleanup remain explicit host actions. */
export async function createReviewHistoryFeature(input: {
  readonly prisma: PrismaClient;
}): Promise<ReviewHistoryFeature> {
  if (!input.prisma || typeof input.prisma.$transaction !== "function")
    throw new Error("history_database_binding_invalid");
  const preparation =
    await composeReviewHistory(assemblyFor<HistoryCapabilities>());
  if (preparation.status !== "prepared")
    throw new Error("history_composition_invalid", { cause: preparation });
  const result = await preparation.prepared.run({
    inputs: { database: { [HistoryDatabase.id]: input.prisma } },
  });
  if (result.status !== "succeeded")
    throw new Error("history_composition_failed");
  return result.roots.history;
}
