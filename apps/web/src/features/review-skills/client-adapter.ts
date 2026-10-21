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
  const response = await executeReviewSkills({ method, input });
  if (response.status !== "ok")
    throw new ReviewSkillsClientError(response.code, response.message);
  return response.value;
}
