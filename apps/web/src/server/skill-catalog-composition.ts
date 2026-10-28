import type { ReviewSkillScanProfile } from "@reviewrouter/features-review-skills";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode,
} from "@reviewrouter/features-review-skills";
import {
  createPrismaReviewSkillsCatalogService,
  createHttpSkillScanner,
  HttpUapSkillCatalog,
  PortableSkillImportNormalizer,
  readSkillScannerConfig,
} from "@reviewrouter/features-review-skills/composition";
import { writePrismaOutboxEvent } from "@reviewrouter/features-outbox";
import { getPrisma } from "./prisma";
import {
  admitSkillCatalogJob,
  createSkillCatalogAdmission,
} from "./skill-catalog-rate-limits";

let profileCache:
  | {
      url: string;
      token: string;
      expiresAt: number;
      profiles: Promise<readonly ReviewSkillScanProfile[]>;
    }
  | undefined;

async function scannerProfiles(): Promise<readonly ReviewSkillScanProfile[]> {
  const configuration = readSkillScannerConfig(process.env);
  if (!configuration) return [];
  if (
    profileCache &&
    profileCache.url === configuration.url &&
    profileCache.token === configuration.token &&
    profileCache.expiresAt > Date.now()
  )
    return profileCache.profiles;
  const entry: NonNullable<typeof profileCache> = {
    ...configuration,
    expiresAt: Date.now() + 60_000,
    profiles: createHttpSkillScanner(configuration)
      .loadProfiles()
      .catch(() => {
        // Browsing remains available during a scanner outage; do not admit work.
        entry.expiresAt = Date.now() + 5000;
        return [];
      }),
  };
  profileCache = entry;
  return entry.profiles;
}

/** Cached scanner capabilities confer no authority; each operation rechecks it. */
export async function productionSkillCatalog() {
  const prisma = getPrisma();
  let catalog: HttpUapSkillCatalog;
  try {
    catalog = new HttpUapSkillCatalog({
      resolveToken: process.env.REVIEW_ROUTER_SKILLS_CATALOG_TOKEN ?? "",
      ...(process.env.REVIEW_ROUTER_SKILLS_CATALOG_URL
        ? { baseUrl: process.env.REVIEW_ROUTER_SKILLS_CATALOG_URL }
        : {}),
      allowLoopback: process.env.NODE_ENV !== "production",
    });
  } catch {
    throw new ReviewSkillsError(ReviewSkillsErrorCode.Unavailable);
  }
  return createPrismaReviewSkillsCatalogService({
    prisma,
    catalog,
    normalizer: new PortableSkillImportNormalizer(),
    admission: createSkillCatalogAdmission(prisma),
    profiles: await scannerProfiles(),
    transactionHooks: {
      admit: admitSkillCatalogJob,
      async enqueue(tx, input) {
        await writePrismaOutboxEvent(tx, {
          type: "review-skills.scan",
          version: 1,
          idempotencyKey: `review-skills:scan:${input.jobId}`,
          workspaceId: input.workspaceId,
          aggregateId: input.jobId,
          payload: { jobId: input.jobId },
          maxAttempts: 20,
          occurredAt: input.now,
        });
      },
    },
  });
}
