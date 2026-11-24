/**
 * Live review progress is on by default for every repository. These keys only
 * opt out or narrow hosted comment writes; nothing has to be set to turn the
 * feature on. `REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES=0` is the kill
 * switch for the GitHub comment.
 */
export const reviewProgressEnv = Object.freeze({
  projectionCapture: "REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE",
  fileCoverage: "REVIEW_ROUTER_PROGRESS_FILE_COVERAGE",
  hostedCommentWrites: "REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES",
  repositories: "REVIEW_ROUTER_PROGRESS_REPOSITORIES",
} as const);

export type ReviewProgressEnvKey =
  (typeof reviewProgressEnv)[keyof typeof reviewProgressEnv];

export type ReviewProgressSettings = Readonly<{
  projectionCapture: boolean;
  fileCoverage: boolean;
  /**
   * `null` when hosted comment writes are off. Otherwise the optional
   * lower-case `owner/repo` allow-list, where `null` means every repository.
   */
  hostedCommentWrites: Readonly<{
    allowedRepositoryFullNames: ReadonlySet<string> | null;
  }> | null;
  /** Malformed keys. Each one keeps its feature off instead of failing startup. */
  invalidKeys: readonly ReviewProgressEnvKey[];
}>;

export type ReviewProgressSettingsDiagnostics = Readonly<{
  warn(message: string, context: Record<string, unknown>): void;
}>;

// GitHub owner and repository name characters, compared case-insensitively.
const repositoryFullNamePattern = /^[a-z0-9-]+\/[a-z0-9._-]+$/u;

/**
 * The single reader for live progress settings used by every runtime.
 * Unset or empty switches are on, `0` is off, anything else is invalid and
 * stays off. Values are never logged, only the names of malformed keys.
 */
export function readReviewProgressSettings(
  env: Readonly<Record<string, string | undefined>>,
  diagnostics?: ReviewProgressSettingsDiagnostics,
): ReviewProgressSettings {
  const invalidKeys: ReviewProgressEnvKey[] = [];
  const projectionCapture = readSwitch(
    env,
    reviewProgressEnv.projectionCapture,
    invalidKeys,
  );
  const fileCoverage = readSwitch(
    env,
    reviewProgressEnv.fileCoverage,
    invalidKeys,
  );
  const writesEnabled = readSwitch(
    env,
    reviewProgressEnv.hostedCommentWrites,
    invalidKeys,
  );
  const allowList = readRepositoryAllowList(env, invalidKeys);
  if (invalidKeys.length > 0) {
    diagnostics?.warn(
      "Review progress settings are invalid; the affected progress features stay off",
      { invalidKeys: [...invalidKeys] },
    );
  }
  return Object.freeze({
    projectionCapture,
    fileCoverage,
    hostedCommentWrites:
      writesEnabled && allowList !== "invalid"
        ? Object.freeze({ allowedRepositoryFullNames: allowList })
        : null,
    invalidKeys: Object.freeze(invalidKeys),
  });
}

function readSwitch(
  env: Readonly<Record<string, string | undefined>>,
  key: ReviewProgressEnvKey,
  invalidKeys: ReviewProgressEnvKey[],
): boolean {
  const value = env[key]?.trim() ?? "";
  if (value === "" || value === "1") return true;
  if (value === "0") return false;
  invalidKeys.push(key);
  return false;
}

function readRepositoryAllowList(
  env: Readonly<Record<string, string | undefined>>,
  invalidKeys: ReviewProgressEnvKey[],
): ReadonlySet<string> | null | "invalid" {
  const value = env[reviewProgressEnv.repositories]?.trim() ?? "";
  if (value === "") return null;
  const names = value.split(",").map((name) => name.trim().toLowerCase());
  if (!names.every((name) => repositoryFullNamePattern.test(name))) {
    invalidKeys.push(reviewProgressEnv.repositories);
    return "invalid";
  }
  return new Set(names);
}
