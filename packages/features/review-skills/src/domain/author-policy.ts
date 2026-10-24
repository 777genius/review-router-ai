import { ReviewSkillsError, ReviewSkillsErrorCode } from "./errors.js";
export const canEditReviewSkill = (
  input: Readonly<{
    actorUserId: string;
    authorUserId: string;
    hasSourceMembership: boolean;
  }>,
): boolean =>
  input.actorUserId === input.authorUserId && input.hasSourceMembership;
export function assertReviewSkillAuthor(
  input: Parameters<typeof canEditReviewSkill>[0],
): void {
  if (!canEditReviewSkill(input))
    throw new ReviewSkillsError(ReviewSkillsErrorCode.Forbidden);
}
