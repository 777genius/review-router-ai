import { group } from "@get-modular/assembly";
import { historyModule } from "./review-history.module.js";
export const reviewHistoryGroup = group("review-history", [historyModule]);
