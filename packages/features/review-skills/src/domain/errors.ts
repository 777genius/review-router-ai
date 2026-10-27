export enum ReviewSkillsErrorCode {
  InvalidInput = "invalid_input",
  Forbidden = "forbidden",
  NotFound = "not_found",
  Conflict = "conflict",
  Unavailable = "unavailable",
  LimitExceeded = "limit_exceeded",
  DependencyExists = "dependency_exists",
  StaleGrant = "stale_grant",
  Unsupported = "unsupported",
  Incomplete = "incomplete",
  RateLimited = "rate_limited",
}
export class ReviewSkillsError extends Error {
  constructor(
    readonly code: ReviewSkillsErrorCode,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(`review_skills_${code}`);
    this.name = "ReviewSkillsError";
  }
}
