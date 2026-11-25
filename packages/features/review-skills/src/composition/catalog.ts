import type { PrismaClient } from "@prisma/client";
import { initializeReviewSkillsCatalog } from "./catalog.root.js";
import { processReviewSkillScan } from "../application/process-review-skill-scan.js";
import type {
  ReviewSkillImportNormalizerPort,
  ReviewSkillScanExecutorPort,
  ReviewSkillScanProfile,
  ReviewSkillsCatalogAdmissionPort,
  ReviewSkillsCatalogSourcePort,
} from "../application/catalog-contracts.js";
import type { ReviewSkillScanClaim } from "../application/ports/review-skills-catalog-store.js";
import { PrismaReviewSkillsCatalogStore } from "../infrastructure/prisma/prisma-review-skills-catalog-store.js";
import type { ReviewSkillsCatalogTransactionHooks } from "../infrastructure/prisma/catalog-transaction-hooks.js";
export type { ReviewSkillsCatalogTransactionHooks } from "../infrastructure/prisma/catalog-transaction-hooks.js";
export function createPrismaReviewSkillsCatalogService(input: {
  readonly prisma: PrismaClient;
  readonly catalog: ReviewSkillsCatalogSourcePort;
  readonly normalizer: ReviewSkillImportNormalizerPort;
  readonly admission: ReviewSkillsCatalogAdmissionPort;
  readonly profiles: readonly ReviewSkillScanProfile[];
  readonly transactionHooks: ReviewSkillsCatalogTransactionHooks;
}) {
  return initializeReviewSkillsCatalog({
    ...input,
    store: new PrismaReviewSkillsCatalogStore(
      input.prisma,
      input.transactionHooks,
    ),
  });
}
export function createPrismaReviewSkillsCatalogWorker(input: {
  readonly prisma: PrismaClient;
  readonly executor: ReviewSkillScanExecutorPort;
  readonly profiles: readonly ReviewSkillScanProfile[];
}) {
  const store = new PrismaReviewSkillsCatalogStore(input.prisma);
  return {
    process: (claim: ReviewSkillScanClaim) =>
      processReviewSkillScan(claim, { ...input, store }),
    prune: (limit = 100) => store.pruneExpired({ limit }),
  };
}
export { PrismaReviewSkillsCatalogStore };
export type { ReviewSkillScanClaim };
