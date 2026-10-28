import type { ReviewSkillsCatalogService } from "@reviewrouter/features-review-skills";
export type {
  ReviewSkillsCatalogItem,
  ReviewSkillsCatalogPage,
  ReviewSkillsCatalogResolution,
  ReviewSkillsCatalogSelection,
  ReviewSkillImportCandidate,
  ReviewSkillScan,
  ReviewSkillScanMode,
} from "@reviewrouter/features-review-skills";

export type SkillCatalogMethod = keyof ReviewSkillsCatalogService;
export type SkillCatalogInput<K extends SkillCatalogMethod> = Omit<
  Parameters<ReviewSkillsCatalogService[K]>[0],
  "actor"
>;
export type SkillCatalogValue<K extends SkillCatalogMethod> = Awaited<
  ReturnType<ReviewSkillsCatalogService[K]>
>;
export type SkillCatalogResponse<T> =
  | Readonly<{ status: "ok"; value: T }>
  | Readonly<{
      status: "error";
      code: string;
      message: string;
      retryAfterSeconds?: number;
    }>;
