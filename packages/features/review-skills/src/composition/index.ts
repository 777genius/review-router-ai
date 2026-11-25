import type { PrismaClient } from "@prisma/client";
import { PrismaReviewSkillsStore } from "../infrastructure/prisma/prisma-review-skills-store.js";
import { initializeReviewSkills } from "./review-skills.root.js";
import type { ReviewSkillsRepositoryAccessPort } from "../application/contracts.js";
export * from "./catalog.js";
export { PortableSkillImportNormalizer } from "../infrastructure/serialization/portable-skill-import-normalizer.js";
export { HttpUapSkillCatalog } from "../infrastructure/http/uap-skill-catalog.js";
export {
  readSkillScannerConfig,
  createHttpSkillScanner,
  type SkillScannerConfig,
} from "../infrastructure/http/skill-scanner-client.js";
export { createPrismaReviewSkillsAdmission } from "../infrastructure/prisma/prisma-review-skills-store.js";
export { composeReviewSkills } from "./review-skills.root.js";
export function createPrismaReviewSkillsService(input: {
  prisma: PrismaClient;
  repositoryAccess: ReviewSkillsRepositoryAccessPort;
}) {
  return initializeReviewSkills(
    new PrismaReviewSkillsStore(input.prisma),
    input.repositoryAccess,
  );
}
