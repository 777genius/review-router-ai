import { input } from "@get-modular/assembly";
import { historyDatabaseDeclaration } from "./history-database.declaration.js";
import type { HistoryCapabilities } from "./review-history.contracts.js";
export const historyDatabaseInput = input<HistoryCapabilities>()(
  historyDatabaseDeclaration,
);
