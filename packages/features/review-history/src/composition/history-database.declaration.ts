import { declareModule } from "@get-modular/assembly";
import { HistoryDatabase } from "./review-history.contracts.js";
export const historyDatabaseDeclaration = declareModule({
  moduleId: "reviewrouter/history-database",
  implementationId: "reviewrouter/history-database/host",
  owner: { authority: "reviewrouter", path: ["review-history"] },
  provides: [HistoryDatabase.provide()],
  slots: [],
});
