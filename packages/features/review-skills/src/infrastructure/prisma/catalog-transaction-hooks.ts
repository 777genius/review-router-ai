import type { Prisma } from "@prisma/client";
import type {
  ReviewSkillsCatalogActor,
  ReviewSkillScanProfile,
} from "../../application/catalog-contracts.js";

/** Host composition supplies adapters scoped to this exact database transaction. */
export type ReviewSkillsCatalogTransactionHooks = Readonly<{
  admit: (
    tx: Prisma.TransactionClient,
    input: ReviewSkillsCatalogActor &
      Readonly<{ profile: ReviewSkillScanProfile; now: Date }>,
  ) => Promise<void>;
  enqueue: (
    tx: Prisma.TransactionClient,
    input: Readonly<{ jobId: string; workspaceId: string; now: Date }>,
  ) => Promise<void>;
}>;
