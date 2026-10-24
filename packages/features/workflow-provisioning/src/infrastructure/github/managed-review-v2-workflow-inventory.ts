import {
  mapWithConcurrency,
  reviewRouterApiUrlsMatch,
} from "@reviewrouter/shared";
import { App } from "@octokit/app";
import { request as githubRequest } from "@octokit/request";
import { createHash } from "node:crypto";
import {
  areManagedWorkflowDocumentsAttested,
  codexWorkflowPathForRepository,
  isCodexWorkflowRepositoryIdentityAdmitted,
  isolatedQualityWorkflowPath,
  readCanonicalIsolatedQualityWorkflowSourceMetadata,
} from "@reviewrouter/features-codex-oauth-rotating";
import { isLoopbackHostname } from "@reviewrouter/shared";
import { REVIEW_ROUTER_ACTION_REPOSITORY } from "@reviewrouter/platform-config";
import {
  managedCodexWorkflowPath,
  managedInteractionWorkflowPath,
  reviewRouterWorkflowContract,
} from "@reviewrouter/protocol-review-workflow";
import {
  readManagedReviewRouterCallerSource,
  renderCanonicalCodexRotatingInteractionWorkflowV3,
} from "../../domain/workflow-template";

type InstallationTokenResponse = {
  readonly token?: unknown;
  readonly expiresAt?: unknown;
  readonly permissions?: {
    readonly actions?: unknown;
    readonly contents?: unknown;
    readonly pull_requests?: unknown;
    readonly metadata?: unknown;
    readonly secrets?: unknown;
  };
};

type ContentsResponse = { readonly data?: unknown };
type RepositoryResponse = { readonly data?: unknown };
type PullRequestListResponse = { readonly data?: unknown };
type PullRequestResponse = { readonly data?: unknown };
type BranchResponse = { readonly data?: unknown };

export type ReviewV2RepositoryScopedRequestPort = (
  route: string,
  parameters: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

export type ReviewV2RepositoryScopedReadToken = {
  readonly token: string;
  readonly expiresAt: Date;
};

export type ReviewV2RepositoryScopedReadAccessPort = {
  readonly request: ReviewV2RepositoryScopedRequestPort;
  issueRepositoryReadToken(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
  }): Promise<ReviewV2RepositoryScopedReadToken>;
};

export function createOctokitReviewV2RepositoryScopedReadAccess(options: {
  readonly appId: string;
  readonly privateKey: string;
}): ReviewV2RepositoryScopedReadAccessPort {
  const app = new App(options);
  return {
    request: (route, parameters) =>
      githubRequest(route as never, parameters as never),
    async issueRepositoryReadToken(input) {
      const data = (await app.octokit.auth({
        type: "installation",
        installationId: parsePositiveSafeInteger(
          input.githubInstallationId,
          "codex_rotating_installation_id_invalid",
        ),
        repositoryIds: [
          parsePositiveSafeInteger(
            input.githubRepositoryId,
            "codex_rotating_repository_id_invalid",
          ),
        ],
        permissions: { contents: "read", pull_requests: "read" },
      })) as InstallationTokenResponse;
      if (typeof data.token !== "string" || data.token.length === 0) {
        throw new Error("codex_rotating_installation_token_invalid_response");
      }
      if (typeof data.expiresAt !== "string") {
        throw new Error("codex_rotating_installation_token_invalid_response");
      }
      const expiresAt = new Date(data.expiresAt);
      if (!Number.isFinite(expiresAt.getTime())) {
        throw new Error("codex_rotating_installation_token_invalid_response");
      }
      if (
        data.permissions?.contents !== "read" ||
        data.permissions?.pull_requests !== "read" ||
        typeof data.permissions !== "object" ||
        Object.entries(data.permissions).some(
          ([permission, level]) =>
            !(
              (permission === "contents" && level === "read") ||
              (permission === "pull_requests" && level === "read") ||
              (permission === "metadata" && level === "read")
            ),
        )
      ) {
        throw new Error(
          "codex_rotating_installation_token_permissions_mismatch",
        );
      }
      return { token: data.token, expiresAt };
    },
  };
}

enum ReviewInventoryReferenceKind {
  DefaultBranch = "default_branch",
  ActiveBaseBranch = "active_base_branch",
  PullRequestMerge = "pull_request_merge",
}

enum ReviewInventoryPullRequestMergeState {
  Ready = "ready",
  Conflicted = "conflicted",
  StaleBase = "stale_base",
}

type ReviewInventoryPullRequestSnapshot = {
  readonly number: number;
  readonly draft: boolean;
  readonly baseRef: string;
  readonly baseSha: string;
  readonly headSha: string;
  readonly mergeState: ReviewInventoryPullRequestMergeState;
  readonly mergeCommitSha: string | null;
};

type ReviewInventoryReferenceSnapshot = {
  readonly ref: string;
  readonly headSha: string;
  readonly isDefault: boolean;
  readonly kind: ReviewInventoryReferenceKind;
  readonly pullRequestNumber: number | null;
};

type ReviewInventoryCoverageSnapshot = {
  readonly defaultBranch: string;
  readonly pullRequests: readonly ReviewInventoryPullRequestSnapshot[];
  readonly references: readonly ReviewInventoryReferenceSnapshot[];
};

const REVIEW_INVENTORY_PULLS_PER_PAGE = 100;
const REVIEW_INVENTORY_MAX_PULL_PAGES = 10;
const REVIEW_INVENTORY_MAX_BRANCHES = 64;
const REVIEW_INVENTORY_MAX_REFERENCES = 128;
const REVIEW_INVENTORY_MAX_CONCURRENCY = 4;
const REVIEW_INVENTORY_COVERAGE_POLICY_VERSION = 3;
// GitHub computes pull request mergeability lazily: the first detail read
// returns `mergeable: null` and schedules computation. These delays poll that
// computation inside the same request so an active repository does not need a
// human retry. Exhausted polls still fail closed with the same error.
const REVIEW_INVENTORY_MERGEABILITY_RETRY_DELAYS_MS = [250, 600, 1200] as const;
// A pull request that moves between the list and detail reads makes the
// snapshot inconsistent. Re-read the open pull request set instead of failing;
// the outer two-pass coverage revalidation still fails closed on movement.
const REVIEW_INVENTORY_COVERAGE_MOVED_RETRY_ATTEMPTS = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class ManagedReviewV2WorkflowInventory {
  private readonly expectedApiUrl: string;

  constructor(
    private readonly dependencies: {
      readonly expectedApiUrl: string;
      readonly access: ReviewV2RepositoryScopedReadAccessPort;
    },
  ) {
    this.expectedApiUrl = normalizeWorkflowApiUrl(dependencies.expectedApiUrl);
  }

  async inspectReviewV2ManagedWorkflowInventory(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly owner: string;
  }): Promise<{
    readonly compatible: boolean;
    readonly inventoryHash: string;
    readonly actionCommitSha: string | null;
    readonly runtimeRef: string | null;
    readonly workflowSchemaVersion: number | null;
    readonly defaultBranchHeadSha: string;
  }> {
    const repositoryIdentityAdmitted =
      isCodexWorkflowRepositoryIdentityAdmitted({
        repositoryId: input.githubRepositoryId,
        repositoryFullName: input.repositoryFullName,
      });
    const token = await this.dependencies.access.issueRepositoryReadToken({
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
    });
    const repo = repoNameFromFullName(input.repositoryFullName);
    const previousReviewPath = codexWorkflowPathForRepository({
      repositoryId: input.githubRepositoryId,
      repositoryFullName: input.repositoryFullName,
    });
    const reviewPath =
      previousReviewPath === isolatedQualityWorkflowPath
        ? isolatedQualityWorkflowPath
        : reviewRouterWorkflowContract.callerPath;
    const competingReviewPaths = [
      ".github/workflows/reviewrouter.yml",
      managedCodexWorkflowPath,
    ];
    const coverage = await this.resolveReviewInventoryCoverage({
      token: token.token,
      owner: input.owner,
      repo,
      githubRepositoryId: input.githubRepositoryId,
    });
    // The interaction workflow read is independent from the per-reference
    // inventory reads; start it now so both run concurrently.
    const interactionPath = managedInteractionWorkflowPath;
    const defaultReferenceHeadSha =
      coverage.references.find((reference) => reference.isDefault)?.headSha ??
      null;
    const interactionWorkflowPromise =
      defaultReferenceHeadSha === null
        ? Promise.resolve(null)
        : this.readWorkflowAtRef({
            token: token.token,
            owner: input.owner,
            repo,
            path: interactionPath,
            ref: defaultReferenceHeadSha,
            missingAllowed: true,
          });
    // The await happens only after the per-reference scan; keep the promise
    // handled from now on so a rejection in this window cannot crash the
    // process as an unhandled rejection before the await sees it.
    void interactionWorkflowPromise.catch(() => {});
    const referenceInventories = await mapWithConcurrency(
      coverage.references,
      REVIEW_INVENTORY_MAX_CONCURRENCY,
      async (reference) => {
        const [reviewWorkflow, legacyPresence] = await Promise.all([
          this.readWorkflowAtRef({
            token: token.token,
            owner: input.owner,
            repo,
            path: reviewPath,
            ref: reference.headSha,
            missingAllowed: !reference.isDefault,
          }),
          Promise.all(
            competingReviewPaths.map(async (path) => ({
              path,
              present:
                (await this.readWorkflowAtRef({
                  token: token.token,
                  owner: input.owner,
                  repo,
                  path,
                  ref: reference.headSha,
                  missingAllowed: true,
                })) !== null,
            })),
          ),
        ]);
        let metadata = null;
        let runtimeRef: string | null = null;
        if (reviewWorkflow) {
          try {
            metadata =
              reviewPath === isolatedQualityWorkflowPath
                ? readCanonicalIsolatedQualityWorkflowSourceMetadata(
                    reviewWorkflow,
                  )
                : (() => {
                    const caller =
                      readManagedReviewRouterCallerSource(reviewWorkflow);
                    runtimeRef = caller.runtimeRef;
                    return {
                      actionRef: `${reviewRouterWorkflowContract.runtimeRepository}/${caller.modelTransport === "provider_api" ? ".github/workflows/reviewrouter-execution-reusable.yml" : reviewRouterWorkflowContract.runtimePath}@${caller.runtimeRef}`,
                      apiUrl: caller.controlPlaneUrl,
                      providerInstanceId: "",
                      workflowSchemaVersion: reviewRouterWorkflowContract.major,
                    };
                  })();
          } catch {
            // Managed T0 inventory only trusts the exact admitted source.
          }
        }
        const scan = reviewWorkflow
          ? { valid: metadata !== null, errors: [] }
          : {
              valid: !reference.isDefault,
              errors: reference.isDefault ? ["review_workflow_missing"] : [],
            };
        const scanErrors =
          reviewWorkflow && !metadata
            ? [...scan.errors, "t0_workflow_source_not_canonical"]
            : [...scan.errors];
        const immutableT0 =
          reviewWorkflow === null
            ? !reference.isDefault
            : Boolean(
                metadata &&
                (runtimeRef !== null ||
                  metadata.actionRef.match(/@[a-f0-9]{40}$/)),
              );
        return {
          ref: reference.ref,
          headSha: reference.headSha,
          isDefault: reference.isDefault,
          kind: reference.kind,
          pullRequestNumber: reference.pullRequestNumber,
          reviewWorkflowPresent: reviewWorkflow !== null,
          reviewWorkflowSha256: reviewWorkflow
            ? createHash("sha256").update(reviewWorkflow, "utf8").digest("hex")
            : null,
          runtimeRef,
          actionRef: metadata?.actionRef ?? null,
          apiUrl: metadata?.apiUrl ?? null,
          actionCommitSha:
            metadata?.actionRef.match(/@([a-f0-9]{40})$/)?.[1] ?? null,
          providerInstanceId: metadata?.providerInstanceId ?? null,
          workflowSchemaVersion: metadata?.workflowSchemaVersion ?? null,
          scanErrors: [...new Set(scanErrors)].sort(),
          immutableT0,
          legacyPresence,
        };
      },
    );
    const defaultInventory = referenceInventories.find(
      (reference) => reference.isDefault,
    );
    if (!defaultInventory) {
      throw new Error("codex_rotating_default_branch_inventory_missing");
    }
    const reviewActionCommitSha = defaultInventory.actionCommitSha;
    const defaultBindingCompatible = Boolean(
      (defaultInventory.runtimeRef !== null ||
        defaultInventory.actionRef?.startsWith(
          `${REVIEW_ROUTER_ACTION_REPOSITORY}@`,
        )) &&
      defaultInventory.apiUrl !== null &&
      reviewRouterApiUrlsMatch(defaultInventory.apiUrl, this.expectedApiUrl) &&
      (defaultInventory.runtimeRef !== null ||
        defaultInventory.providerInstanceId ===
          `codex-rotating:${input.githubRepositoryId}`) &&
      defaultInventory.workflowSchemaVersion !== null,
    );
    const interactionWorkflow = await interactionWorkflowPromise;
    const interaction = inspectReviewV2InteractionWorkflow(
      interactionWorkflow,
      defaultInventory.actionRef,
      defaultInventory.apiUrl ?? this.expectedApiUrl,
      defaultInventory.runtimeRef !== null,
    );
    const revalidatedCoverage = await this.resolveReviewInventoryCoverage({
      token: token.token,
      owner: input.owner,
      repo,
      githubRepositoryId: input.githubRepositoryId,
    });
    if (!sameReviewInventoryCoverage(coverage, revalidatedCoverage)) {
      throw new Error("codex_rotating_workflow_inventory_coverage_moved");
    }
    const referencesWithCompatibility = referenceInventories.map(
      (reference) => ({
        ...reference,
        compatible:
          reference.scanErrors.length === 0 &&
          reference.immutableT0 &&
          reference.legacyPresence.every((entry) => !entry.present) &&
          (!reference.reviewWorkflowPresent ||
            (defaultBindingCompatible &&
              reference.actionRef === defaultInventory.actionRef &&
              reference.apiUrl === defaultInventory.apiUrl &&
              reference.providerInstanceId ===
                defaultInventory.providerInstanceId &&
              reference.workflowSchemaVersion ===
                defaultInventory.workflowSchemaVersion)),
      }),
    );
    const inventory = {
      coveragePolicyVersion: REVIEW_INVENTORY_COVERAGE_POLICY_VERSION,
      defaultBranch: {
        ref: defaultInventory.ref,
        headSha: defaultInventory.headSha,
      },
      pullRequests: coverage.pullRequests,
      reviewPath,
      references: referencesWithCompatibility,
      interaction,
    };
    return {
      compatible:
        repositoryIdentityAdmitted &&
        referencesWithCompatibility.every(
          (reference) => reference.compatible,
        ) &&
        interaction.compatible,
      inventoryHash: createHash("sha256")
        .update(JSON.stringify(inventory), "utf8")
        .digest("hex"),
      actionCommitSha: reviewActionCommitSha,
      runtimeRef: defaultInventory.runtimeRef,
      workflowSchemaVersion: defaultInventory.workflowSchemaVersion,
      defaultBranchHeadSha: defaultInventory.headSha,
    };
  }

  private async resolveReviewInventoryCoverage(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly githubRepositoryId: string;
  }): Promise<ReviewInventoryCoverageSnapshot> {
    const repositoryRequest = this.dependencies.access.request(
      "GET /repos/{owner}/{repo}",
      {
        owner: input.owner,
        repo: input.repo,
        headers: { authorization: `Bearer ${input.token}` },
      },
    ) as Promise<RepositoryResponse>;
    const [repositoryResponse, pullRequests] = await Promise.all([
      repositoryRequest,
      this.resolveOpenPullRequests(input),
    ]);
    const defaultBranch = decodeRepositoryDefaultBranch(
      repositoryResponse.data,
      input.githubRepositoryId,
      `${input.owner}/${input.repo}`,
    );
    assertUniquePullRequestNumbers(pullRequests);
    pullRequests.sort((left, right) => left.number - right.number);
    const branchRefs = new Set<string>([
      defaultBranch,
      ...pullRequests.map((pullRequest) => pullRequest.baseRef),
    ]);
    if (branchRefs.size > REVIEW_INVENTORY_MAX_BRANCHES) {
      throw new Error("codex_rotating_workflow_inventory_branch_cap_exceeded");
    }
    const references = await mapWithConcurrency(
      [...branchRefs].sort(),
      REVIEW_INVENTORY_MAX_CONCURRENCY,
      async (ref): Promise<ReviewInventoryReferenceSnapshot> => ({
        ref,
        headSha: await this.readBranchHead({
          token: input.token,
          owner: input.owner,
          repo: input.repo,
          branch: ref,
        }),
        isDefault: ref === defaultBranch,
        kind:
          ref === defaultBranch
            ? ReviewInventoryReferenceKind.DefaultBranch
            : ReviewInventoryReferenceKind.ActiveBaseBranch,
        pullRequestNumber: null,
      }),
    );
    for (let index = 0; index < pullRequests.length; index += 1) {
      const pullRequest = pullRequests[index]!;
      const baseReference = references.find(
        (reference) => reference.ref === pullRequest.baseRef,
      );
      if (!baseReference) {
        throw new Error(
          "codex_rotating_workflow_inventory_base_reference_missing",
        );
      }
      if (baseReference.headSha !== pullRequest.baseSha) {
        pullRequests[index] = {
          ...pullRequest,
          mergeState: ReviewInventoryPullRequestMergeState.StaleBase,
        };
      }
    }
    for (const pullRequest of pullRequests) {
      if (
        pullRequest.mergeState !== ReviewInventoryPullRequestMergeState.Ready
      ) {
        continue;
      }
      if (pullRequest.mergeCommitSha === null) {
        throw new Error(
          "codex_rotating_workflow_inventory_mergeability_invalid",
        );
      }
      references.push({
        ref: `refs/pull/${pullRequest.number}/merge`,
        headSha: pullRequest.mergeCommitSha,
        isDefault: false,
        kind: ReviewInventoryReferenceKind.PullRequestMerge,
        pullRequestNumber: pullRequest.number,
      });
    }
    if (references.length > REVIEW_INVENTORY_MAX_REFERENCES) {
      throw new Error(
        "codex_rotating_workflow_inventory_reference_cap_exceeded",
      );
    }
    references.sort((left, right) => left.ref.localeCompare(right.ref));
    return { defaultBranch, pullRequests, references };
  }

  private async resolveOpenPullRequests(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly githubRepositoryId: string;
  }): Promise<ReviewInventoryPullRequestSnapshot[]> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.resolveOpenPullRequestsOnce(input);
      } catch (error) {
        if (
          attempt >= REVIEW_INVENTORY_COVERAGE_MOVED_RETRY_ATTEMPTS ||
          !(error instanceof Error) ||
          error.message !== "codex_rotating_workflow_inventory_coverage_moved"
        ) {
          throw error;
        }
      }
    }
  }

  private async resolveOpenPullRequestsOnce(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly githubRepositoryId: string;
  }): Promise<ReviewInventoryPullRequestSnapshot[]> {
    const pullRequests: ReviewInventoryPullRequestSnapshot[] = [];
    let paginationComplete = false;
    for (let page = 1; page <= REVIEW_INVENTORY_MAX_PULL_PAGES + 1; page += 1) {
      const response = (await this.dependencies.access.request(
        "GET /repos/{owner}/{repo}/pulls",
        {
          owner: input.owner,
          repo: input.repo,
          state: "open",
          per_page: REVIEW_INVENTORY_PULLS_PER_PAGE,
          page,
          headers: { authorization: `Bearer ${input.token}` },
        },
      )) as PullRequestListResponse;
      const pagePullRequests = decodeOpenPullRequests(
        response.data,
        input.githubRepositoryId,
      );
      if (
        page > REVIEW_INVENTORY_MAX_PULL_PAGES &&
        pagePullRequests.length > 0
      ) {
        throw new Error("codex_rotating_workflow_inventory_pull_cap_exceeded");
      }
      pullRequests.push(
        ...(
          await mapWithConcurrency(
            pagePullRequests,
            REVIEW_INVENTORY_MAX_CONCURRENCY,
            async (pullRequest) =>
              pullRequest.mergeCommitSha === null
                ? this.resolvePullRequestMergeability({
                    token: input.token,
                    owner: input.owner,
                    repo: input.repo,
                    githubRepositoryId: input.githubRepositoryId,
                    pullRequest,
                  })
                : pullRequest,
          )
        ).filter(
          (pullRequest): pullRequest is ReviewInventoryPullRequestSnapshot =>
            pullRequest !== null,
        ),
      );
      if (pagePullRequests.length < REVIEW_INVENTORY_PULLS_PER_PAGE) {
        paginationComplete = true;
        break;
      }
    }
    if (!paginationComplete) {
      throw new Error("codex_rotating_workflow_inventory_pull_cap_exceeded");
    }
    return pullRequests;
  }

  private async resolvePullRequestMergeability(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly githubRepositoryId: string;
    readonly pullRequest: ReviewInventoryPullRequestSnapshot;
  }): Promise<ReviewInventoryPullRequestSnapshot | null> {
    for (let attempt = 0; ; attempt += 1) {
      const response = (await this.dependencies.access.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          owner: input.owner,
          repo: input.repo,
          pull_number: input.pullRequest.number,
          headers: { authorization: `Bearer ${input.token}` },
        },
      )) as PullRequestResponse;
      try {
        return decodePullRequestMergeability(
          response.data,
          input.githubRepositoryId,
          input.pullRequest,
        );
      } catch (error) {
        const mergeabilityStillComputing =
          error instanceof Error &&
          error.message ===
            "codex_rotating_workflow_inventory_mergeability_unavailable" &&
          attempt < REVIEW_INVENTORY_MERGEABILITY_RETRY_DELAYS_MS.length;
        if (!mergeabilityStillComputing) throw error;
        await sleep(REVIEW_INVENTORY_MERGEABILITY_RETRY_DELAYS_MS[attempt]!);
      }
    }
  }

  private async readBranchHead(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
  }): Promise<string> {
    const response = (await this.dependencies.access.request(
      "GET /repos/{owner}/{repo}/branches/{branch}",
      {
        owner: input.owner,
        repo: input.repo,
        branch: input.branch,
        headers: { authorization: `Bearer ${input.token}` },
      },
    )) as BranchResponse;
    return decodeBranchHead(response.data, input.branch);
  }

  private async readWorkflowAtRef(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly path: string;
    readonly ref: string;
    readonly missingAllowed?: boolean;
  }): Promise<string | null> {
    try {
      const response = (await this.dependencies.access.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: input.owner,
          repo: input.repo,
          path: input.path,
          ref: input.ref,
          headers: { authorization: `Bearer ${input.token}` },
        },
      )) as ContentsResponse;
      return decodeWorkflowContent(response.data);
    } catch (error) {
      if (
        input.missingAllowed === true &&
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 404
      ) {
        return null;
      }
      throw error;
    }
  }
}

function decodeRepositoryDefaultBranch(
  data: unknown,
  expectedRepositoryId: string,
  expectedRepositoryFullName: string,
): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_repository_invalid_response");
  }
  const repository = data as {
    readonly id?: unknown;
    readonly full_name?: unknown;
    readonly default_branch?: unknown;
  };
  if (
    typeof repository.id !== "number" ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    String(repository.id ?? "") !== expectedRepositoryId ||
    repository.full_name !== expectedRepositoryFullName ||
    typeof repository.default_branch !== "string" ||
    repository.default_branch.length === 0 ||
    repository.default_branch.trim() !== repository.default_branch
  ) {
    throw new Error("codex_rotating_repository_identity_mismatch");
  }
  return repository.default_branch;
}

function normalizeWorkflowApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("codex_rotating_workflow_api_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    isLoopbackHostname(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    throw new Error("codex_rotating_workflow_api_url_invalid");
  }
  return url.toString().replace(/\/$/, "");
}

function decodeOpenPullRequests(
  data: unknown,
  expectedRepositoryId: string,
): ReviewInventoryPullRequestSnapshot[] {
  if (!Array.isArray(data)) {
    throw new Error("codex_rotating_pull_request_inventory_invalid_response");
  }
  const pullRequests: ReviewInventoryPullRequestSnapshot[] = [];
  for (const value of data) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("codex_rotating_pull_request_inventory_invalid_response");
    }
    const pullRequest = value as {
      readonly number?: unknown;
      readonly draft?: unknown;
      readonly merge_commit_sha?: unknown;
      readonly base?: {
        readonly ref?: unknown;
        readonly sha?: unknown;
        readonly repo?: { readonly id?: unknown } | null;
      };
      readonly head?: { readonly sha?: unknown };
    };
    const number = pullRequest.number;
    const draft = pullRequest.draft;
    const ref = pullRequest.base?.ref;
    const baseSha = pullRequest.base?.sha;
    const headSha = pullRequest.head?.sha;
    const mergeCommitSha = pullRequest.merge_commit_sha;
    if (
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number <= 0 ||
      typeof draft !== "boolean" ||
      String(pullRequest.base?.repo?.id ?? "") !== expectedRepositoryId ||
      typeof ref !== "string" ||
      ref.length === 0 ||
      ref.trim() !== ref ||
      typeof baseSha !== "string" ||
      !isCommitSha(baseSha) ||
      typeof headSha !== "string" ||
      !isCommitSha(headSha) ||
      (mergeCommitSha !== null &&
        (typeof mergeCommitSha !== "string" || !isCommitSha(mergeCommitSha)))
    ) {
      throw new Error("codex_rotating_pull_request_base_identity_mismatch");
    }
    pullRequests.push({
      number,
      draft,
      baseRef: ref,
      baseSha: baseSha.toLowerCase(),
      headSha: headSha.toLowerCase(),
      mergeState:
        mergeCommitSha === null
          ? ReviewInventoryPullRequestMergeState.Conflicted
          : ReviewInventoryPullRequestMergeState.Ready,
      mergeCommitSha:
        typeof mergeCommitSha === "string"
          ? mergeCommitSha.toLowerCase()
          : null,
    });
  }
  return pullRequests;
}

function decodePullRequestMergeability(
  data: unknown,
  expectedRepositoryId: string,
  expected: ReviewInventoryPullRequestSnapshot,
): ReviewInventoryPullRequestSnapshot | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_pull_request_inventory_invalid_response");
  }
  const pullRequest = data as {
    readonly number?: unknown;
    readonly draft?: unknown;
    readonly state?: unknown;
    readonly merged?: unknown;
    readonly mergeable?: unknown;
    readonly merge_commit_sha?: unknown;
    readonly base?: {
      readonly ref?: unknown;
      readonly sha?: unknown;
      readonly repo?: { readonly id?: unknown } | null;
    };
    readonly head?: { readonly sha?: unknown };
  };
  const stableIdentityMatches =
    pullRequest.number === expected.number &&
    String(pullRequest.base?.repo?.id ?? "") === expectedRepositoryId;
  if (pullRequest.merged === true || pullRequest.state === "closed") {
    // A closed response for some other pull request must never drop the
    // expected one from the snapshot.
    if (!stableIdentityMatches) {
      throw new Error("codex_rotating_workflow_inventory_coverage_moved");
    }
    // Merged or closed while the snapshot was being read: the pull request is
    // no longer part of open coverage and GitHub reports `mergeable: null` for
    // it forever. Drop it; the revalidated pass agrees on the settled open set.
    return null;
  }
  if (
    !stableIdentityMatches ||
    pullRequest.draft !== expected.draft ||
    pullRequest.base?.ref !== expected.baseRef ||
    normalizeCommitSha(pullRequest.base?.sha) !== expected.baseSha ||
    normalizeCommitSha(pullRequest.head?.sha) !== expected.headSha
  ) {
    throw new Error("codex_rotating_workflow_inventory_coverage_moved");
  }
  if (pullRequest.mergeable === null) {
    throw new Error(
      "codex_rotating_workflow_inventory_mergeability_unavailable",
    );
  }
  if (pullRequest.mergeable === false) {
    if (pullRequest.merge_commit_sha !== null) {
      throw new Error("codex_rotating_workflow_inventory_mergeability_invalid");
    }
    return {
      ...expected,
      mergeState: ReviewInventoryPullRequestMergeState.Conflicted,
      mergeCommitSha: null,
    };
  }
  const mergeCommitSha = normalizeCommitSha(pullRequest.merge_commit_sha);
  if (pullRequest.mergeable !== true || mergeCommitSha === null) {
    throw new Error("codex_rotating_workflow_inventory_mergeability_invalid");
  }
  return {
    ...expected,
    mergeState: ReviewInventoryPullRequestMergeState.Ready,
    mergeCommitSha,
  };
}

function assertUniquePullRequestNumbers(
  pullRequests: readonly ReviewInventoryPullRequestSnapshot[],
): void {
  if (
    new Set(pullRequests.map((pullRequest) => pullRequest.number)).size !==
    pullRequests.length
  ) {
    throw new Error("codex_rotating_pull_request_inventory_duplicate_response");
  }
}

function sameReviewInventoryCoverage(
  left: ReviewInventoryCoverageSnapshot,
  right: ReviewInventoryCoverageSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeCommitSha(value: unknown): string | null {
  return typeof value === "string" && isCommitSha(value)
    ? value.toLowerCase()
    : null;
}

function isCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

function decodeBranchHead(data: unknown, expectedBranch: string): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_branch_invalid_response");
  }
  const branch = data as {
    readonly name?: unknown;
    readonly commit?: { readonly sha?: unknown };
  };
  const sha = branch.commit?.sha;
  if (
    branch.name !== expectedBranch ||
    typeof sha !== "string" ||
    !isCommitSha(sha)
  ) {
    throw new Error("codex_rotating_branch_identity_mismatch");
  }
  return sha.toLowerCase();
}

function inspectReviewV2InteractionWorkflow(
  workflow: string | null,
  expectedActionRef: string | null,
  expectedApiUrl: string,
  currentCaller: boolean,
) {
  const expectedActionCommitSha =
    expectedActionRef?.match(/@([a-f0-9]{40})$/i)?.[1]?.toLowerCase() ?? null;
  if (workflow === null) {
    return {
      path: managedInteractionWorkflowPath,
      present: false,
      compatible: true,
      actionCommitSha: null,
      errors: [] as string[],
    };
  }

  const expectedWorkflow =
    !currentCaller && expectedActionRef && expectedActionCommitSha
      ? renderCanonicalCodexRotatingInteractionWorkflowV3({
          actionRef: expectedActionRef,
          apiUrl: expectedApiUrl,
          runtimeConfigMode: "oidc",
        })
      : null;
  const errors =
    expectedWorkflow &&
    areManagedWorkflowDocumentsAttested(workflow, expectedWorkflow)
      ? []
      : ["interaction_workflow_source_mismatch"];
  return {
    path: managedInteractionWorkflowPath,
    present: true,
    compatible: errors.length === 0,
    actionCommitSha: expectedActionCommitSha,
    errors: errors.sort(),
  };
}

function parsePositiveSafeInteger(value: string, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(errorCode);
  return parsed;
}

function repoNameFromFullName(fullName: string): string {
  const [, repo] = fullName.split("/");
  if (!repo) throw new Error("codex_rotating_invalid_repository_full_name");
  return repo;
}

function decodeWorkflowContent(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("codex_rotating_workflow_content_invalid_response");
  const record = data as {
    readonly type?: unknown;
    readonly encoding?: unknown;
    readonly content?: unknown;
  };
  if (
    record.type !== "file" ||
    record.encoding !== "base64" ||
    typeof record.content !== "string"
  )
    throw new Error("codex_rotating_workflow_content_invalid_response");
  const compacted = record.content.replace(/\s+/g, "");
  if (compacted.length === 0 || compacted.length > 128 * 1024)
    throw new Error("codex_rotating_workflow_content_too_large");
  return Buffer.from(compacted, "base64").toString("utf8");
}
