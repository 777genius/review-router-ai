import type { ReviewSkillsService } from "@reviewrouter/features-review-skills";
export type * from "@reviewrouter/features-review-skills";
export type ReviewSkillsMethod = keyof ReviewSkillsService;
export type ReviewSkillsInput<K extends ReviewSkillsMethod> = Omit<
  Parameters<ReviewSkillsService[K]>[0],
  "actor"
>;
export type ReviewSkillsValue<K extends ReviewSkillsMethod> = Awaited<
  ReturnType<ReviewSkillsService[K]>
>;
export type ReviewSkillsResponse<T> =
  | { readonly status: "ok"; readonly value: T }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
    };
