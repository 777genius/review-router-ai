import type { ReviewSkillsService } from "@reviewrouter/features-review-skills";
export type * from "@reviewrouter/features-review-skills";
export type ReviewSkillsMethod = keyof ReviewSkillsService;
export type ReviewSkillsInput<K extends ReviewSkillsMethod> = Omit<
  Parameters<ReviewSkillsService[K]>[0],
  "actor"
>;
export type ReviewSkillsValue<K extends ReviewSkillsMethod> =
  Awaited<ReturnType<ReviewSkillsService[K]>> extends infer Value
    ? K extends "listAssignmentChoices"
      ? Value & {
          readonly repositoryReadiness: readonly RepositorySkillsReadiness[];
        }
      : K extends "loadRepositorySkillSettings"
        ? Value & { readonly readiness: RepositorySkillsReadiness }
        : K extends "listSkillRepositoryTargets"
          ? Value extends { readonly items: readonly (infer Item)[] }
            ? Omit<Value, "items"> & {
                readonly items: readonly (Item & {
                  readonly readiness: RepositorySkillsReadiness;
                })[];
              }
            : never
          : Value
    : never;
export type RepositorySkillsReadiness = Readonly<{
  repositoryId: string;
  name: string;
  status: "ready" | "blocked" | "unknown";
  reason:
    | "supported"
    | "unsupported_workflow"
    | "engine_unsupported"
    | "engine_unavailable"
    | "configuration_required"
    | "configuration_resave_required"
    | "workflow_update_required"
    | "workflow_unconfirmed"
    | "runtime_unconfirmed";
}>;
export type ReviewSkillsResponse<T> =
  | { readonly status: "ok"; readonly value: T }
  | {
      readonly status: "error";
      readonly code: string;
      readonly message: string;
    };
