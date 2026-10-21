import { executeReviewSkills } from "../../../app/dashboard/review-skills-actions";
import type {
  ReviewSkillsInput,
  ReviewSkillsMethod,
  ReviewSkillsValue,
} from "./contracts";
export class ReviewSkillsClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReviewSkillsClientError";
  }
}
export async function requestReviewSkills<K extends ReviewSkillsMethod>(
  method: K,
  input: ReviewSkillsInput<K>,
): Promise<ReviewSkillsValue<K>> {
  try {
    const response = await executeReviewSkills({ method, input });
    if (response.status !== "ok")
      throw new ReviewSkillsClientError(response.code, response.message);
    return response.value;
  } catch (error) {
    if (error instanceof ReviewSkillsClientError) throw error;
    throw new ReviewSkillsClientError(
      "unknown",
      "The result could not be confirmed. Your selection is preserved. Refresh the current state or retry the exact same operation.",
    );
  }
}
