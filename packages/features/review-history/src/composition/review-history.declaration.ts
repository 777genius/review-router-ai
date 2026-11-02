import { required } from "@get-modular/core";
import { declareModule } from "@get-modular/assembly";
import {
  HistoryDatabase,
  HistoryReads,
  HistoryProjection,
  HistoryCaptures,
  HistoryActivations,
} from "./review-history.contracts.js";
export const historyDeclaration = declareModule({
  moduleId: "reviewrouter/review-history",
  implementationId: "reviewrouter/review-history/default",
  owner: { authority: "reviewrouter", path: ["review-history"] },
  provides: [
    HistoryReads.provide(),
    HistoryProjection.provide(),
    HistoryCaptures.provide(),
    HistoryActivations.provide(),
  ],
  slots: [HistoryDatabase.slot("database", required())],
});
