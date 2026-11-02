"use server";

import { revalidatePath } from "next/cache";
import { ReviewSkillsError } from "@reviewrouter/features-review-skills";
import type { ReviewSkillsCatalogService } from "@reviewrouter/features-review-skills";
import {
  RateLimitExceededError,
  rateLimitRetryAfterSeconds,
} from "@reviewrouter/features-rate-limits";
import { getDashboardSignedInActor } from "../../src/server/dashboard-mutations";
import { productionSkillCatalog } from "../../src/server/skill-catalog-composition";
import type {
  SkillCatalogInput,
  SkillCatalogMethod,
  SkillCatalogResponse,
  SkillCatalogValue,
} from "../../src/features/review-skills/catalog-contracts";

const methods = new Set([
  "configuration",
  "search",
  "resolve",
  "loadCandidate",
  "requestScan",
  "loadScan",
  "importCandidate",
]);
const messages: Record<string, string> = {
  forbidden:
    "You no longer have access to add skills in this workspace. Sign in or refresh your access.",
  invalid_input:
    "This selection could not be used. Choose a skill and try again.",
  not_found:
    "This skill or check is no longer available. Choose the skill again.",
  unsupported:
    "This skill cannot be added as text instructions. It may need extra files or features that are not supported here.",
  conflict:
    "This selection changed. Go back and check the current skill before adding it.",
  rate_limited: "Too many requests. Please wait before trying again.",
  unavailable:
    "The catalog or check service is temporarily unavailable. Please try again.",
  incomplete:
    "The check could not be completed. Check the skill again before adding it.",
};

export async function executeSkillCatalog<
  K extends SkillCatalogMethod,
>(request: {
  readonly method: K;
  readonly input: SkillCatalogInput<K>;
}): Promise<SkillCatalogResponse<SkillCatalogValue<K>>> {
  if (
    !request ||
    !methods.has(request.method) ||
    !request.input ||
    typeof request.input !== "object" ||
    Array.isArray(request.input)
  ) {
    return {
      status: "error",
      code: "invalid_input",
      message: messages.invalid_input!,
    };
  }
  try {
    const actor = await getDashboardSignedInActor();
    if (!actor)
      return {
        status: "error",
        code: "forbidden",
        message: "Sign in to find and check skills.",
      };
    const service = await productionSkillCatalog();
    const operation = service[request.method] as unknown as (
      input: object,
    ) => ReturnType<ReviewSkillsCatalogService[K]>;
    const value = await operation.call(service, {
      ...request.input,
      actor: { userId: actor.userId },
    });
    if (request.method === "importCandidate") revalidatePath("/dashboard");
    return { status: "ok", value };
  } catch (error) {
    if (
      error instanceof ReviewSkillsError ||
      error instanceof RateLimitExceededError
    ) {
      const code =
        error instanceof RateLimitExceededError ? "rate_limited" : error.code;
      const retry =
        error instanceof RateLimitExceededError
          ? rateLimitRetryAfterSeconds(error.decision, new Date())
          : error.details.retryAfterSeconds;
      const retryAfterSeconds =
        typeof retry === "number" && Number.isFinite(retry) && retry > 0
          ? Math.ceil(retry)
          : undefined;
      return {
        status: "error",
        code,
        message:
          code === "rate_limited" && retryAfterSeconds
            ? `Too many requests. Try again in ${retryAfterSeconds} seconds.`
            : (messages[code] ?? "This skill action could not be completed."),
        ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
      };
    }
    return {
      status: "error",
      code: "unknown",
      message:
        "The result could not be confirmed. Your selection is saved here. Retry the same action to recover its result.",
    };
  }
}
