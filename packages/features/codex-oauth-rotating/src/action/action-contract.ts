/** Minimal Action request contracts; imported only as types by composition and env policy. */
export type ActionInputs = {
  readonly mode: string;
  readonly apiUrl: string;
  readonly providerInstanceId: string;
  readonly workflowSchemaVersion: number;
  readonly reviewDrafts: boolean;
  readonly maxChangedLines: number;
  readonly reviewTimeoutMinutes: number;
  readonly providerSecrets: ProviderSecretInputs;
  readonly sessionBindingId?: string | undefined;
  readonly sessionBindingVersion?: number | undefined;
};

export type ProviderSecretInputs = {
  readonly claudeCodeOAuthToken?: string;
  readonly openRouterApiKey?: string;
  readonly mimoTokenPlanApiKey?: string;
};

export type PullRequestEvent = {
  readonly number: number;
  readonly repositoryId?: string | undefined;
  readonly repository: string;
  readonly owner: string;
  readonly repo: string;
  readonly headSha: string;
  readonly baseSha: string;
  readonly changedLines?: number | undefined;
};


export const reviewThreadLifecycleResolveTokenEnvKey =
  "REVIEW_THREAD_LIFECYCLE_RESOLVE_TOKEN";

export const githubRequestTimeoutMs = 30_000;
