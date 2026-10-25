import type { ReviewSkillsService } from "@reviewrouter/features-review-skills";
import type {
  RepositorySkillsReadiness,
  ReviewSkillsInput,
  ReviewSkillsMethod,
  ReviewSkillsValue,
} from "../features/review-skills/contracts";
import { readRepositorySkillsReadiness } from "./repository-skills-readiness";

type ServiceValue<K extends ReviewSkillsMethod> = Awaited<
  ReturnType<ReviewSkillsService[K]>
>;

/** Enrich only successful service results: their existing exact-ID management
 * authorization runs before any policy or producer read. */
export async function enrichReviewSkillsResponse<K extends ReviewSkillsMethod>(
  method: K,
  input: ReviewSkillsInput<K>,
  value: ServiceValue<K>,
  readReadiness = readRepositorySkillsReadiness,
): Promise<ReviewSkillsValue<K>> {
  if (method === "listAssignmentChoices") {
    const request = input as ReviewSkillsInput<"listAssignmentChoices">;
    const page = value as ServiceValue<"listAssignmentChoices">;
    return {
      ...page,
      repositoryReadiness: request.cursor
        ? []
        : await readReadiness({
            workspaceId: request.workspaceId,
            repositoryIds: request.repositoryIds,
          }),
    } as ReviewSkillsValue<K>;
  }
  if (method === "loadRepositorySkillSettings") {
    const request = input as ReviewSkillsInput<"loadRepositorySkillSettings">;
    const settings = value as ServiceValue<"loadRepositorySkillSettings">;
    const [readiness] = await readReadiness({
      workspaceId: request.workspaceId,
      repositoryIds: [settings.repositoryId],
    });
    return {
      ...settings,
      readiness:
        readiness ?? unknown(settings.repositoryId, settings.repositoryId),
    } as ReviewSkillsValue<K>;
  }
  if (method === "listSkillRepositoryTargets") {
    const request = input as ReviewSkillsInput<"listSkillRepositoryTargets">;
    const page = value as ServiceValue<"listSkillRepositoryTargets">;
    // Internal target candidates may include denied rows on a sparse page.
    // Only returned, positively authorized item IDs are eligible for enrichment.
    const readiness = new Map(
      (
        await readReadiness({
          workspaceId: request.workspaceId,
          repositoryIds: page.items.map((item) => item.repositoryId),
        })
      ).map((item) => [item.repositoryId, item]),
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...item,
        readiness:
          readiness.get(item.repositoryId) ??
          unknown(item.repositoryId, item.name),
      })),
    } as ReviewSkillsValue<K>;
  }
  return value as ReviewSkillsValue<K>;
}

function unknown(
  repositoryId: string,
  name: string,
): RepositorySkillsReadiness {
  return {
    repositoryId,
    name,
    status: "unknown",
    reason: "runtime_unconfirmed",
  };
}
