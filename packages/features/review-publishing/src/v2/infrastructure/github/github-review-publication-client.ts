import { createHash } from "node:crypto";
import { App } from "@octokit/app";
import {
  ReviewPublicationExternalEffectKind,
  ReviewPublicationReceiptStatus,
  type ReviewPublicationPermitIdentity,
  type ReviewPublicationOperation,
  type ReviewPublicationOperationCapabilityFacts,
} from "../../domain/review-publication-attempt";
import {
  mergeReviewPrDescription,
  readReviewPrDescriptionBlock,
} from "../../domain/review-pr-description";
import { type ReviewPublicationGatewayObject } from "../../application/ports/review-publication-ports";
import {
  ReviewV2ScmMutationError,
  ReviewV2ScmMutationFailureOutcome,
  ReviewV2ScmProvider,
  type ReviewV2ScmLiveRevisionPort,
} from "../../application/ports/review-publication-execution-ports";
import {
  ReviewV2PublicationPayloadKind,
  type ReviewV2PublicationPayload,
  type ReviewV2PublicationPayloadPort,
} from "../../application/ports/review-publication-payload-port";
import {
  type ReviewV2ProviderPublicationClientPort,
  type ReviewV2ProviderPublicationClientSession,
  type ReviewV2ProviderCredentialPort,
} from "../../application/ports/review-publication-provider-ports";
import { canonicalReviewPublicationJson } from "../../domain/canonical-review-publication-json";
import { extractUniqueReviewFindingFingerprint } from "../../domain/review-finding-marker";

export type ReviewV2GitHubRepository = {
  readonly githubInstallationId: string;
  readonly owner: string;
  readonly repo: string;
};

export interface ReviewV2GitHubRepositoryQueryPort {
  resolve(
    permit: ReviewPublicationPermitIdentity,
  ): Promise<ReviewV2GitHubRepository | null>;
}

export type GitHubInstallationClient = {
  request(
    route: string,
    parameters?: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown }>;
  graphql<T>(
    query: string,
    variables: Readonly<Record<string, unknown>>,
  ): Promise<T>;
};

/** GitHub App credentials stay inside this adapter and are never returned. */
export class GitHubAppReviewV2CredentialProvider
  implements ReviewV2ProviderCredentialPort, ReviewV2ScmLiveRevisionPort
{
  readonly provider = ReviewV2ScmProvider.GitHub;
  private readonly app: App;
  private botLogin: string | null = null;

  constructor(
    options: { readonly appId: string; readonly privateKey: string },
    private readonly repositories: ReviewV2GitHubRepositoryQueryPort,
    private readonly payloads: ReviewV2PublicationPayloadPort,
    private readonly assertCheckIdentityAllowed?: (name: string) => void,
  ) {
    this.app = new App(options);
  }

  async acquireClient(
    input: Parameters<ReviewV2ProviderCredentialPort["acquireClient"]>[0],
  ): Promise<ReviewV2ProviderPublicationClientSession> {
    const repository = await this.repositories.resolve(input.permit);
    if (!repository) {
      throw new Error("review_v2_github_repository_unavailable");
    }
    if (!/^[1-9][0-9]*$/u.test(repository.githubInstallationId)) {
      throw new Error("review_v2_github_installation_invalid");
    }
    const [octokit, botLogin] = await Promise.all([
      this.app.getInstallationOctokit(
        Number(repository.githubInstallationId),
      ) as Promise<GitHubInstallationClient>,
      this.resolveBotLogin(),
    ]);
    return {
      client: new GitHubReviewV2PublicationClient({
        octokit,
        repository,
        permit: input.permit,
        capability: input.capability,
        payloads: this.payloads,
        assertCheckIdentityAllowed: this.assertCheckIdentityAllowed,
        botLogin,
      }),
      close: async () => undefined,
    };
  }

  async readLiveRevision(permit: ReviewPublicationPermitIdentity) {
    const repository = await this.repositories.resolve(permit);
    if (
      !repository ||
      !/^[1-9][0-9]*$/u.test(repository.githubInstallationId)
    ) {
      return null;
    }
    const octokit = (await this.app.getInstallationOctokit(
      Number(repository.githubInstallationId),
    )) as GitHubInstallationClient;
    return readGitHubReviewV2LiveRevision(octokit, repository, permit);
  }

  private async resolveBotLogin(): Promise<string> {
    if (this.botLogin) return this.botLogin;
    const response = await this.app.octokit.request("GET /app");
    if (!isRecord(response.data) || typeof response.data.slug !== "string") {
      throw new Error("review_v2_github_app_identity_unavailable");
    }
    this.botLogin = `${response.data.slug.toLowerCase()}[bot]`;
    return this.botLogin;
  }
}

export async function readGitHubReviewV2LiveRevision(
  octokit: GitHubInstallationClient,
  repository: ReviewV2GitHubRepository,
  permit: ReviewPublicationPermitIdentity,
) {
  const loadPointer = async () => {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner: repository.owner,
        repo: repository.repo,
        pull_number: permit.pullRequestNumber,
      },
    );
    const row = requireRecord(response.data, "github_pull_request_invalid");
    const base = requireRecord(row.base, "github_pull_request_base_invalid");
    const head = requireRecord(row.head, "github_pull_request_head_invalid");
    return {
      baseSha: requiredCommitId(base.sha, "github_pull_request_base_invalid"),
      headSha: requiredCommitId(head.sha, "github_pull_request_head_invalid"),
    };
  };
  const before = await loadPointer();
  const comparison = await octokit.request(
    "GET /repos/{owner}/{repo}/compare/{basehead}",
    {
      owner: repository.owner,
      repo: repository.repo,
      basehead: `${before.baseSha}...${before.headSha}`,
    },
  );
  const comparisonRow = requireRecord(
    comparison.data,
    "github_compare_invalid",
  );
  const mergeBase = requireRecord(
    comparisonRow.merge_base_commit,
    "github_merge_base_invalid",
  );
  const mergeBaseSha = requiredCommitId(
    mergeBase.sha,
    "github_merge_base_invalid",
  );
  const after = await loadPointer();
  if (before.baseSha !== after.baseSha || before.headSha !== after.headSha) {
    return null;
  }
  return {
    baseSha: before.baseSha,
    mergeBaseSha,
    headSha: before.headSha,
    reviewRevisionHash: sha256(
      canonicalReviewPublicationJson({
        workspaceId: permit.workspaceId,
        repositoryConnectionId: permit.repositoryConnectionId,
        scmRepositoryIdentityId: permit.scmRepositoryIdentityId,
        pullRequestNumber: permit.pullRequestNumber,
        baseSha: before.baseSha,
        mergeBaseSha,
        headSha: before.headSha,
      }),
    ),
  };
}

export class GitHubReviewV2PublicationClient implements ReviewV2ProviderPublicationClientPort {
  constructor(
    private readonly options: {
      readonly octokit: GitHubInstallationClient;
      readonly repository: ReviewV2GitHubRepository;
      readonly permit: ReviewPublicationPermitIdentity;
      readonly capability: ReviewPublicationOperationCapabilityFacts;
      readonly payloads: ReviewV2PublicationPayloadPort;
      readonly botLogin: string;
      readonly assertCheckIdentityAllowed?:
        | ((name: string) => void)
        | undefined;
    },
  ) {}

  async findAllByMarker(input: {
    readonly operation: ReviewPublicationOperation;
    readonly cursor: string | null;
  }) {
    const payload = await this.requirePayload(input.operation);
    switch (payload.kind) {
      case ReviewV2PublicationPayloadKind.PrDescription:
        return this.findPrDescription(payload);
      case ReviewV2PublicationPayloadKind.Summary:
        return this.findIssueComments(payload, input.cursor);
      case ReviewV2PublicationPayloadKind.ManagedCheck:
        return this.findCheckRuns(payload, input.operation, input.cursor);
      case ReviewV2PublicationPayloadKind.PendingReviewCreate:
      case ReviewV2PublicationPayloadKind.SubmittedReview:
        return this.findReviews(payload, input.cursor);
      case ReviewV2PublicationPayloadKind.PendingReviewSubmit:
        return this.findSubmittedReview(payload, input.operation);
      case ReviewV2PublicationPayloadKind.ThreadLifecycle:
        return this.findLifecycle(payload);
      case ReviewV2PublicationPayloadKind.ThreadReply:
        return this.findThreadReplies(payload, input.cursor);
    }
  }

  async applyOperation(input: {
    readonly operation: ReviewPublicationOperation;
    readonly capability: ReviewPublicationOperationCapabilityFacts;
  }): Promise<ReviewPublicationGatewayObject> {
    const payload = await this.requirePayload(input.operation);
    if (payload.kind === ReviewV2PublicationPayloadKind.ManagedCheck) {
      this.options.assertCheckIdentityAllowed?.(payload.name);
    }
    try {
      switch (payload.kind) {
        case ReviewV2PublicationPayloadKind.PrDescription:
          return await this.updatePrDescription(payload, input.operation);
        case ReviewV2PublicationPayloadKind.Summary:
          return await this.createIssueComment(payload, input.operation);
        case ReviewV2PublicationPayloadKind.ManagedCheck:
          return await this.createCheckRun(payload, input.operation);
        case ReviewV2PublicationPayloadKind.PendingReviewCreate:
        case ReviewV2PublicationPayloadKind.SubmittedReview:
          return await this.createReview(payload, input.operation);
        case ReviewV2PublicationPayloadKind.PendingReviewSubmit:
          return await this.submitReview(
            payload,
            input.operation,
            input.capability,
          );
        case ReviewV2PublicationPayloadKind.ThreadLifecycle:
          return await this.mutateLifecycle(payload, input.operation);
        case ReviewV2PublicationPayloadKind.ThreadReply:
          return await this.createThreadReply(payload, input.operation);
      }
    } catch (error) {
      if (error instanceof ReviewV2ScmMutationError) throw error;
      throw githubMutationError(error);
    }
  }

  async markStaleOrDelete(input: {
    readonly operation: ReviewPublicationOperation;
    readonly canonicalExternalObjectId: string;
    readonly duplicateExternalObjectIds: readonly string[];
    readonly compensateCanonical: boolean;
  }): Promise<ReviewPublicationReceiptStatus> {
    const payload = await this.requirePayload(input.operation);
    const staleObjectIds = [
      ...new Set([
        ...(input.compensateCanonical ? [input.canonicalExternalObjectId] : []),
        ...input.duplicateExternalObjectIds,
      ]),
    ];
    switch (payload.kind) {
      case ReviewV2PublicationPayloadKind.PrDescription:
        // The endpoint has no atomic body CAS. Never compensate by overwriting
        // author edits or remove a description after an uncertain mutation.
        return input.compensateCanonical
          ? ReviewPublicationReceiptStatus.StaleVisible
          : ReviewPublicationReceiptStatus.Succeeded;
      case ReviewV2PublicationPayloadKind.Summary:
        await Promise.all(
          staleObjectIds.map((id) =>
            this.request(
              "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
              {
                comment_id: externalNumericId(id, "issue-comment"),
              },
            ),
          ),
        );
        return input.compensateCanonical
          ? ReviewPublicationReceiptStatus.Compensated
          : ReviewPublicationReceiptStatus.Succeeded;
      case ReviewV2PublicationPayloadKind.ManagedCheck: {
        const targets = await Promise.all(
          staleObjectIds.map(async (id) => {
            const checkRunId = externalNumericId(id, "check-run");
            const target = await this.request(
              "GET /repos/{owner}/{repo}/check-runs/{check_run_id}",
              { check_run_id: checkRunId },
            );
            const row = requireRecord(target.data, "github_check_run_invalid");
            this.options.assertCheckIdentityAllowed?.(
              requiredString(row.name, "github_check_run_name_invalid"),
            );
            return checkRunId;
          }),
        );
        await Promise.all(
          targets.map((checkRunId) =>
            this.request(
              "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
              {
                check_run_id: checkRunId,
                status: "completed",
                conclusion: "neutral",
                output: {
                  title: "Superseded ReviewRouter result",
                  summary: "This duplicate result is not canonical.",
                },
              },
            ),
          ),
        );
        return input.compensateCanonical
          ? ReviewPublicationReceiptStatus.Compensated
          : ReviewPublicationReceiptStatus.Succeeded;
      }
      case ReviewV2PublicationPayloadKind.ThreadLifecycle: {
        if (!input.compensateCanonical) {
          return ReviewPublicationReceiptStatus.Succeeded;
        }
        await this.loadProvenLifecycleThread(payload.threadId);
        const mutation = payload.resolve
          ? "mutation ReviewRouterUndoResolveThread($id: ID!) { unresolveReviewThread(input: {threadId: $id}) { thread { id isResolved } } }"
          : "mutation ReviewRouterUndoUnresolveThread($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id isResolved } } }";
        await this.options.octokit.graphql(mutation, { id: payload.threadId });
        return ReviewPublicationReceiptStatus.Compensated;
      }
      case ReviewV2PublicationPayloadKind.PendingReviewCreate:
        await Promise.all(
          staleObjectIds.map(async (id) => {
            try {
              await this.request(
                "DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
                {
                  pull_number: this.options.permit.pullRequestNumber,
                  review_id: externalNumericId(id, "review"),
                },
              );
            } catch (error) {
              if (!isGitHubNotFound(error)) throw error;
            }
          }),
        );
        return input.compensateCanonical
          ? ReviewPublicationReceiptStatus.Compensated
          : ReviewPublicationReceiptStatus.Succeeded;
      case ReviewV2PublicationPayloadKind.PendingReviewSubmit:
      case ReviewV2PublicationPayloadKind.SubmittedReview:
      case ReviewV2PublicationPayloadKind.ThreadReply:
        // A verified acknowledgement is a historical observation; never delete it
        // merely because an attempt was superseded or an effect became uncertain.
        return ReviewPublicationReceiptStatus.StaleVisible;
    }
  }

  private async requirePayload(
    operation: ReviewPublicationOperation,
  ): Promise<ReviewV2PublicationPayload> {
    const payload = await this.options.payloads.resolve({
      permit: this.options.permit,
      operation,
    });
    if (!payload) throw new Error("review_v2_publication_payload_unavailable");
    return payload;
  }

  private async readPullRequestBody() {
    const response = await this.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      { pull_number: this.options.permit.pullRequestNumber },
    );
    const row = requireRecord(response.data, "github_pull_request_invalid");
    const head = requireRecord(row.head, "github_pull_request_head_invalid");
    return {
      body:
        row.body === null
          ? ""
          : requiredString(row.body, "github_pull_request_body_invalid"),
      headSha: requiredCommitId(head.sha, "github_pull_request_head_invalid"),
    };
  }

  private async findPrDescription(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.PrDescription }
    >,
  ) {
    const current = await this.readPullRequestBody();
    const block = readReviewPrDescriptionBlock(current.body);
    return {
      objects:
        block === null
          ? []
          : [
              gatewayObject(
                `pull-request-body:${this.options.permit.pullRequestNumber}`,
                payload,
                sha256(block),
                prDescriptionVisibleObjectHash(current),
              ),
            ],
      nextCursor: null,
    };
  }

  private async updatePrDescription(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.PrDescription }
    >,
    operation: ReviewPublicationOperation,
  ) {
    let before: { readonly body: string; readonly headSha: string };
    let target: string;
    try {
      before = await this.readPullRequestBody();
      target = mergeReviewPrDescription(before.body, payload.body);
      const fresh = await this.readPullRequestBody();
      if (
        before.headSha !== operation.targetCommitId ||
        fresh.headSha !== operation.targetCommitId
      ) {
        throw new Error("github_pr_description_head_changed");
      }
      if (fresh.body !== before.body) {
        throw new Error("github_pr_description_body_conflict");
      }
      // GitHub pull-request update documents no conditional body mutation. These
      // are optimistic freshness checks, not an atomic compare-and-swap.
      if (Buffer.byteLength(target, "utf8") > 65_536) {
        throw new Error("github_pr_description_body_limit_exceeded");
      }
    } catch (error) {
      throw new ReviewV2ScmMutationError(
        error instanceof Error &&
          error.message.startsWith("github_pr_description_")
          ? error.message
          : "github_pr_description_preimage_unavailable",
        ReviewV2ScmMutationFailureOutcome.DefinitelyNoEffect,
        false,
      );
    }
    if (target !== before.body) {
      await this.request("PATCH /repos/{owner}/{repo}/pulls/{pull_number}", {
        pull_number: this.options.permit.pullRequestNumber,
        body: target,
      });
    }
    try {
      const after = await this.readPullRequestBody();
      if (after.headSha !== operation.targetCommitId || after.body !== target) {
        throw new ReviewV2ScmMutationError(
          "github_pr_description_post_write_conflict",
          ReviewV2ScmMutationFailureOutcome.EffectMayExist,
          false,
        );
      }
      return gatewayObject(
        `pull-request-body:${this.options.permit.pullRequestNumber}`,
        payload,
        sha256(payload.body),
        prDescriptionVisibleObjectHash(after),
      );
    } catch (error) {
      if (error instanceof ReviewV2ScmMutationError) throw error;
      throw githubPostMutationObservationError(error);
    }
  }

  private async findIssueComments(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.Summary }
    >,
    cursor: string | null,
  ) {
    const page = parsePage(cursor);
    const response = await this.request(
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        issue_number: this.options.permit.pullRequestNumber,
        per_page: 100,
        page,
      },
    );
    const rows = requireArray(response.data, "github_issue_comments_invalid");
    const objects = rows.flatMap((row) => {
      if (!isOwnedBody(row, payload.marker, this.options.botLogin)) return [];
      const id = numericId(row);
      const body = requiredString(row.body, "github_comment_body_invalid");
      return [gatewayObject(`issue-comment:${id}`, payload, sha256(body))];
    });
    return pageResult(objects, page, rows.length);
  }

  private async findCheckRuns(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.ManagedCheck }
    >,
    operation: ReviewPublicationOperation,
    cursor: string | null,
  ) {
    const page = parsePage(cursor);
    const response = await this.request(
      "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
      { ref: operation.targetCommitId, per_page: 100, page },
    );
    const data = requireRecord(response.data, "github_check_runs_invalid");
    const rows = requireArray(data.check_runs, "github_check_runs_invalid");
    const objects = rows.flatMap((row) => {
      const app = isRecord(row.app) ? row.app : null;
      const output = isRecord(row.output) ? row.output : null;
      if (
        app?.slug !== this.options.botLogin.replace(/\[bot\]$/u, "") ||
        typeof output?.summary !== "string" ||
        !output.summary.includes(payload.marker)
      ) {
        return [];
      }
      const bodyHash = sha256(
        canonicalReviewPublicationJson({
          name: row.name,
          title: output.title,
          summary: output.summary,
          conclusion: row.conclusion,
        }),
      );
      return [gatewayObject(`check-run:${numericId(row)}`, payload, bodyHash)];
    });
    return pageResult(objects, page, rows.length);
  }

  private async findReviews(
    payload: Extract<
      ReviewV2PublicationPayload,
      {
        readonly kind:
          | ReviewV2PublicationPayloadKind.PendingReviewCreate
          | ReviewV2PublicationPayloadKind.SubmittedReview;
      }
    >,
    cursor: string | null,
  ) {
    const page = parsePage(cursor);
    const response = await this.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        pull_number: this.options.permit.pullRequestNumber,
        per_page: 100,
        page,
      },
    );
    const rows = requireArray(response.data, "github_reviews_invalid");
    const candidates = rows.filter(
      (row) =>
        isReviewStateCompatible(payload.kind, row.state) &&
        isOwnedBody(row, payload.marker, this.options.botLogin),
    );
    const objects = await Promise.all(
      candidates.map((row) => this.reviewObject(row, payload, true)),
    );
    return pageResult(objects, page, rows.length);
  }

  private async findSubmittedReview(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.PendingReviewSubmit }
    >,
    operation: ReviewPublicationOperation,
  ) {
    const target = operation.dependsOnOperationId;
    if (!target) throw new Error("github_review_submit_dependency_missing");
    const targetExternalObjectId =
      this.options.capability.targetExternalObjectId;
    const reviewId = targetExternalObjectId
      ? externalNumericId(targetExternalObjectId, "review")
      : null;
    if (reviewId === null) return { objects: [], nextCursor: null };
    const response = await this.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}",
      {
        pull_number: this.options.permit.pullRequestNumber,
        review_id: reviewId,
      },
    );
    const row = requireRecord(response.data, "github_review_invalid");
    if (
      row.state === "PENDING" ||
      !isOwnedBody(row, payload.marker, this.options.botLogin)
    ) {
      return { objects: [], nextCursor: null };
    }
    const comments = await this.loadReviewComments(reviewId);
    return {
      objects: [
        gatewayObject(
          `review:${reviewId}`,
          payload,
          sha256(
            canonicalReviewPublicationJson({
              body: row.body,
              event: "COMMENT",
            }),
          ),
          reviewObservedObjectHash(row, comments),
        ),
      ],
      nextCursor: null,
    };
  }

  private async findLifecycle(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.ThreadLifecycle }
    >,
  ) {
    const node = await this.loadProvenLifecycleThread(payload.threadId);
    return node.isResolved === payload.resolve
      ? {
          objects: [
            gatewayObject(
              `thread:${payload.threadId}`,
              payload,
              sha256(
                canonicalReviewPublicationJson({
                  threadId: payload.threadId,
                  resolve: payload.resolve,
                }),
              ),
              sha256(canonicalReviewPublicationJson(node)),
            ),
          ],
          nextCursor: null,
        }
      : { objects: [], nextCursor: null };
  }

  private async findThreadReplies(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.ThreadReply }
    >,
    cursor: string | null,
  ) {
    const parentId = await this.loadProvenThreadReplyParent(payload);
    const page = parsePage(cursor);
    const response = await this.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      { pull_number: this.options.permit.pullRequestNumber, per_page: 100, page },
    );
    const rows = requireArray(response.data, "github_review_comments_invalid");
    const objects = rows.flatMap((row) => {
      if (
        row.in_reply_to_id !== parentId ||
        !isOwnedBody(row, payload.marker, this.options.botLogin)
      ) return [];
      const body = requiredString(row.body, "github_comment_body_invalid");
      // A bot message containing our marker but edited away from the canonical
      // acknowledgement is ambiguous. Never create a second reply in that case.
      if (body !== payload.body) throw new Error("github_verified_reply_body_conflict");
      return [gatewayObject(`review-comment:${numericId(row)}`, payload, sha256(body))];
    });
    return pageResult(objects, page, rows.length);
  }

  private async createThreadReply(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.ThreadReply }
    >,
    operation: ReviewPublicationOperation,
  ) {
    const commentId = await this.loadProvenThreadReplyParent(payload);
    const response = await this.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
      {
        pull_number: this.options.permit.pullRequestNumber,
        comment_id: commentId,
        body: payload.body,
      },
    );
    try {
      const row = requireRecord(response.data, "github_review_reply_invalid");
      if (
        row.body !== payload.body ||
        row.in_reply_to_id !== commentId ||
        !isOwnedBody(row, payload.marker, this.options.botLogin)
      ) throw new Error("github_review_reply_ack_mismatch");
      return gatewayObject(`review-comment:${numericId(row)}`, payload, operation.bodyHash);
    } catch (error) {
      throw githubPostMutationObservationError(error);
    }
  }

  /** Verify native thread, original finding and author before targeting a REST reply. */
  private async loadProvenThreadReplyParent(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.ThreadReply }
    >,
  ): Promise<number> {
    await this.loadProvenLifecycleThread(payload.threadId);
    const response = await this.options.octokit.graphql<{
      readonly node?: {
        readonly id?: string;
        readonly comments?: {
          readonly nodes?: readonly {
            readonly id?: string;
            readonly databaseId?: number | null;
            readonly body?: string;
            readonly viewerDidAuthor?: boolean | null;
            readonly author?: {
              readonly login?: string | null;
              readonly __typename?: string | null;
            } | null;
          }[] | null;
        } | null;
      } | null;
    }>(
      "query ReviewRouterVerifiedReplyParent($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { id comments(first: 1) { nodes { id databaseId body viewerDidAuthor author { login __typename } } } } } }",
      { id: payload.threadId },
    );
    const node = response.node;
    const parent = node?.comments?.nodes?.[0];
    const fingerprint = extractUniqueReviewFindingFingerprint(parent?.body ?? "");
    const bot = this.options.botLogin.toLowerCase().replace(/\[bot\]$/u, "");
    const author = parent?.author?.login?.toLowerCase().replace(/\[bot\]$/u, "");
    const owned =
      parent?.viewerDidAuthor === true ||
      (parent?.author?.__typename === "Bot" && author === bot);
    const expectedTargetId =
      parent?.id && fingerprint
        ? `rrt_${sha256(`${payload.threadId}\n${parent.id}\n${fingerprint}`).slice(0, 16)}`
        : null;
    if (
      node?.id !== payload.threadId ||
      !parent ||
      !owned ||
      !Number.isSafeInteger(parent.databaseId) ||
      (parent.databaseId ?? 0) <= 0 ||
      expectedTargetId !== payload.targetId
    ) {
      throw new ReviewV2ScmMutationError(
        "github_review_reply_parent_provenance_mismatch",
        ReviewV2ScmMutationFailureOutcome.DefinitelyNoEffect,
        false,
      );
    }
    return parent.databaseId as number;
  }

  private async createIssueComment(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.Summary }
    >,
    operation: ReviewPublicationOperation,
  ) {
    const response = await this.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        issue_number: this.options.permit.pullRequestNumber,
        body: payload.body,
      },
    );
    return gatewayObject(
      `issue-comment:${numericId(requireRecord(response.data, "github_comment_invalid"))}`,
      payload,
      operation.bodyHash,
    );
  }

  private async createCheckRun(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.ManagedCheck }
    >,
    operation: ReviewPublicationOperation,
  ) {
    const response = await this.request(
      "POST /repos/{owner}/{repo}/check-runs",
      {
        name: payload.name,
        head_sha: operation.targetCommitId,
        status: "completed",
        conclusion: payload.conclusion,
        output: { title: payload.title, summary: payload.summary },
      },
    );
    return gatewayObject(
      `check-run:${numericId(requireRecord(response.data, "github_check_run_invalid"))}`,
      payload,
      operation.bodyHash,
    );
  }

  private async createReview(
    payload: Extract<
      ReviewV2PublicationPayload,
      {
        readonly kind:
          | ReviewV2PublicationPayloadKind.PendingReviewCreate
          | ReviewV2PublicationPayloadKind.SubmittedReview;
      }
    >,
    operation: ReviewPublicationOperation,
  ) {
    const response = await this.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
      {
        pull_number: this.options.permit.pullRequestNumber,
        commit_id: operation.targetCommitId,
        body: payload.body,
        comments: payload.comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          ...(comment.startLine === null
            ? {}
            : { start_line: comment.startLine }),
          side: "RIGHT",
          body: comment.body,
        })),
        ...(payload.kind === ReviewV2PublicationPayloadKind.SubmittedReview
          ? { event: "COMMENT" }
          : {}),
      },
    );
    try {
      return await this.reviewObject(
        requireRecord(response.data, "github_review_invalid"),
        payload,
      );
    } catch (error) {
      throw githubPostMutationObservationError(error);
    }
  }

  private async submitReview(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.PendingReviewSubmit }
    >,
    operation: ReviewPublicationOperation,
    capability: ReviewPublicationOperationCapabilityFacts,
  ) {
    if (!capability.targetExternalObjectId) {
      throw new ReviewV2ScmMutationError(
        "github_review_submit_target_missing",
        ReviewV2ScmMutationFailureOutcome.DefinitelyNoEffect,
        false,
      );
    }
    const reviewId = externalNumericId(
      capability.targetExternalObjectId,
      "review",
    );
    await this.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events",
      {
        pull_number: this.options.permit.pullRequestNumber,
        review_id: reviewId,
        event: "COMMENT",
        body: payload.body,
      },
    );
    return gatewayObject(`review:${reviewId}`, payload, operation.bodyHash);
  }

  private async mutateLifecycle(
    payload: Extract<
      ReviewV2PublicationPayload,
      { readonly kind: ReviewV2PublicationPayloadKind.ThreadLifecycle }
    >,
    operation: ReviewPublicationOperation,
  ) {
    await this.loadProvenLifecycleThread(payload.threadId);
    const mutation = payload.resolve
      ? "mutation ReviewRouterResolveThread($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { id isResolved } } }"
      : "mutation ReviewRouterUnresolveThread($id: ID!) { unresolveReviewThread(input: {threadId: $id}) { thread { id isResolved } } }";
    await this.options.octokit.graphql(mutation, { id: payload.threadId });
    return gatewayObject(
      `thread:${payload.threadId}`,
      payload,
      operation.bodyHash,
    );
  }

  private async reviewObject(
    row: Readonly<Record<string, unknown>>,
    payload: Extract<
      ReviewV2PublicationPayload,
      {
        readonly kind:
          | ReviewV2PublicationPayloadKind.PendingReviewCreate
          | ReviewV2PublicationPayloadKind.SubmittedReview;
      }
    >,
    tolerateStalePendingReview = false,
  ): Promise<ReviewPublicationGatewayObject> {
    if (!isReviewStateCompatible(payload.kind, row.state)) {
      throw new Error("github_review_state_mismatch");
    }
    const reviewId = numericId(row);
    const comments = await this.loadReviewComments(
      reviewId,
      payload.kind === ReviewV2PublicationPayloadKind.PendingReviewCreate
        ? payload.comments
        : undefined,
      tolerateStalePendingReview,
    );
    const commitId = requiredString(
      row.commit_id,
      "github_review_commit_id_invalid",
    ).toLowerCase();
    const bodyHash = sha256(
      canonicalReviewPublicationJson({ body: row.body, commitId, comments }),
    );
    return gatewayObject(
      `review:${reviewId}`,
      payload,
      bodyHash,
      reviewObservedObjectHash(row, comments),
    );
  }

  private async loadReviewComments(
    reviewId: number,
    expectedComments?: readonly ExpectedReviewComment[],
    tolerateStalePendingReview = false,
  ) {
    const comments: Array<{
      readonly path: unknown;
      readonly line: unknown;
      readonly startLine: unknown;
      readonly body: unknown;
    }> = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await this.request(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments",
        {
          pull_number: this.options.permit.pullRequestNumber,
          review_id: reviewId,
          per_page: 100,
          page,
        },
      );
      const rows = requireArray(
        response.data,
        "github_review_comments_invalid",
      );
      comments.push(
        ...rows.map((comment) => ({
          path: comment.path,
          line: comment.line ?? comment.original_line,
          startLine: comment.start_line ?? comment.original_start_line ?? null,
          body: comment.body,
        })),
      );
      if (rows.length < 100) {
        if (!expectedComments) return comments;
        try {
          return normalizePendingReviewComments(comments, expectedComments);
        } catch (error) {
          if (!tolerateStalePendingReview) throw error;
          return normalizeObservedReviewComments(comments);
        }
      }
    }
    throw new Error("github_review_comments_pagination_limit_exceeded");
  }

  private async loadProvenLifecycleThread(threadId: string) {
    const response = await this.options.octokit.graphql<{
      readonly node?: {
        readonly id?: string;
        readonly isResolved?: boolean;
        readonly pullRequest?: {
          readonly number?: number;
          readonly repository?: { readonly nameWithOwner?: string } | null;
        } | null;
      } | null;
    }>(
      "query ReviewRouterPublicationThread($id: ID!) { node(id: $id) { ... on PullRequestReviewThread { id isResolved pullRequest { number repository { nameWithOwner } } } } }",
      { id: threadId },
    );
    const node = response.node;
    const expectedRepository =
      `${this.options.repository.owner}/${this.options.repository.repo}`.toLowerCase();
    if (
      node?.id !== threadId ||
      typeof node.isResolved !== "boolean" ||
      node.pullRequest?.number !== this.options.permit.pullRequestNumber ||
      node.pullRequest.repository?.nameWithOwner?.toLowerCase() !==
        expectedRepository
    ) {
      throw new ReviewV2ScmMutationError(
        "github_review_thread_provenance_mismatch",
        ReviewV2ScmMutationFailureOutcome.DefinitelyNoEffect,
        false,
      );
    }
    return {
      id: node.id,
      isResolved: node.isResolved,
      pullRequestNumber: node.pullRequest.number,
      repository: expectedRepository,
    };
  }

  private request(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ) {
    return this.options.octokit.request(route, {
      owner: this.options.repository.owner,
      repo: this.options.repository.repo,
      ...parameters,
    });
  }
}

type ExpectedReviewComment = Extract<
  ReviewV2PublicationPayload,
  {
    readonly kind:
      | ReviewV2PublicationPayloadKind.PendingReviewCreate
      | ReviewV2PublicationPayloadKind.SubmittedReview;
  }
>["comments"][number];

type ObservedReviewComment = {
  readonly path: unknown;
  readonly line: unknown;
  readonly startLine: unknown;
  readonly body: unknown;
};

/**
 * GitHub omits line coordinates while a review is pending and exposes only a
 * diff position. Bind those unavailable coordinates back to the exact payload
 * only after path and marker-bearing body prove a one-to-one match.
 */
function normalizePendingReviewComments(
  observed: readonly ObservedReviewComment[],
  expected: readonly ExpectedReviewComment[],
) {
  if (observed.length !== expected.length) {
    throw new Error("github_review_comment_count_mismatch");
  }
  const candidateIndexes = expected.map((expectedComment) =>
    observed.flatMap((candidate, index) =>
      candidate.path === expectedComment.path &&
      candidate.body === expectedComment.body &&
      coordinateMatches(candidate.line, expectedComment.line) &&
      coordinateMatches(candidate.startLine, expectedComment.startLine)
        ? [index]
        : [],
    ),
  );
  const expectedByObserved = Array<number>(observed.length).fill(-1);
  const matchExpected = (
    expectedIndex: number,
    visitedObserved: Set<number>,
  ): boolean => {
    for (const observedIndex of candidateIndexes[expectedIndex] ?? []) {
      if (visitedObserved.has(observedIndex)) continue;
      visitedObserved.add(observedIndex);
      const previousExpected = expectedByObserved[observedIndex] ?? -1;
      if (
        previousExpected === -1 ||
        matchExpected(previousExpected, visitedObserved)
      ) {
        expectedByObserved[observedIndex] = expectedIndex;
        return true;
      }
    }
    return false;
  };
  for (const expectedIndex of expected.keys()) {
    if (!matchExpected(expectedIndex, new Set())) {
      throw new Error("github_review_comment_identity_mismatch");
    }
  }
  return expected.map((expectedComment) => ({
    path: expectedComment.path,
    line: expectedComment.line,
    startLine: expectedComment.startLine,
    body: expectedComment.body,
  }));
}

function coordinateMatches(observed: unknown, expected: number | null) {
  return observed === null || observed === undefined || observed === expected;
}

function normalizeObservedReviewComments(
  observed: readonly ObservedReviewComment[],
) {
  return observed.map((comment) => ({
    path: typeof comment.path === "string" ? comment.path : null,
    line: integerOrNull(comment.line),
    startLine: integerOrNull(comment.startLine),
    body: typeof comment.body === "string" ? comment.body : null,
  }));
}

function integerOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function isGitHubNotFound(error: unknown): boolean {
  return isRecord(error) && error.status === 404;
}

function isReviewStateCompatible(
  kind:
    | ReviewV2PublicationPayloadKind.PendingReviewCreate
    | ReviewV2PublicationPayloadKind.SubmittedReview,
  state: unknown,
) {
  return kind === ReviewV2PublicationPayloadKind.PendingReviewCreate
    ? state === "PENDING"
    : typeof state === "string" && state !== "PENDING";
}

function gatewayObject(
  externalObjectId: string,
  payload: ReviewV2PublicationPayload,
  bodyHash: string,
  observedObjectHash = sha256(
    canonicalReviewPublicationJson({
      externalObjectId,
      markerHash: payload.markerHash,
      bodyHash,
    }),
  ),
): ReviewPublicationGatewayObject {
  return {
    externalObjectId,
    effectKind: ReviewPublicationExternalEffectKind.MutationAcknowledged,
    markerHash: payload.markerHash,
    bodyHash,
    observedObjectHash,
    observedAt: new Date(),
  };
}

function reviewObservedObjectHash(
  row: Readonly<Record<string, unknown>>,
  comments: readonly unknown[],
): string {
  const user = isRecord(row.user) ? row.user : null;
  const app = isRecord(row.app) ? row.app : null;
  return sha256(
    canonicalReviewPublicationJson({
      commitId: row.commit_id,
      author: user?.login ?? null,
      app: app?.slug ?? null,
      state: row.state,
      body: row.body,
      comments,
    }),
  );
}

function githubMutationError(error: unknown): ReviewV2ScmMutationError {
  const status =
    isRecord(error) && typeof error.status === "number" ? error.status : null;
  const definitelyNoEffect =
    status !== null &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429;
  const retryable = status === 422 || !definitelyNoEffect;
  return new ReviewV2ScmMutationError(
    status === null
      ? "github_mutation_transport_failure"
      : `github_mutation_http_${status}`,
    definitelyNoEffect
      ? ReviewV2ScmMutationFailureOutcome.DefinitelyNoEffect
      : ReviewV2ScmMutationFailureOutcome.EffectMayExist,
    retryable,
  );
}

function githubPostMutationObservationError(
  error: unknown,
): ReviewV2ScmMutationError {
  const status =
    isRecord(error) && typeof error.status === "number" ? error.status : null;
  return new ReviewV2ScmMutationError(
    status === null
      ? "github_review_post_mutation_observation_failed"
      : `github_review_post_mutation_observation_http_${status}`,
    ReviewV2ScmMutationFailureOutcome.EffectMayExist,
    true,
  );
}

function pageResult(
  objects: readonly ReviewPublicationGatewayObject[],
  page: number,
  rowCount: number,
) {
  return { objects, nextCursor: rowCount === 100 ? String(page + 1) : null };
}

function parsePage(cursor: string | null): number {
  if (cursor === null) return 1;
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value <= 1) {
    throw new Error("github_publication_cursor_invalid");
  }
  return value;
}

function isOwnedBody(
  row: Readonly<Record<string, unknown>>,
  marker: string,
  botLogin: string,
): boolean {
  const user = isRecord(row.user) ? row.user : null;
  return (
    typeof user?.login === "string" &&
    user.login.toLowerCase() === botLogin &&
    typeof row.body === "string" &&
    row.body.includes(marker)
  );
}

function externalNumericId(value: string, prefix: string): number {
  const match = new RegExp(`^${prefix}:([1-9][0-9]*)$`, "u").exec(value);
  if (!match?.[1]) throw new Error("github_external_object_id_invalid");
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id))
    throw new Error("github_external_object_id_invalid");
  return id;
}

function numericId(row: Readonly<Record<string, unknown>>): number {
  if (
    typeof row.id !== "number" ||
    !Number.isSafeInteger(row.id) ||
    row.id <= 0
  ) {
    throw new Error("github_external_object_id_invalid");
  }
  return row.id;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string") throw new Error(code);
  return value;
}

function requiredCommitId(value: unknown, code: string): string {
  const commitId = requiredString(value, code).toLowerCase();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commitId)) {
    throw new Error(code);
  }
  return commitId;
}

function requireArray(
  value: unknown,
  code: string,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error(code);
  return value;
}

function requireRecord(
  value: unknown,
  code: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new Error(code);
  return value;
}

function prDescriptionVisibleObjectHash(current: {
  readonly body: string;
  readonly headSha: string;
}): string {
  return sha256(
    canonicalReviewPublicationJson({
      bodyHash: sha256(current.body),
      headSha: current.headSha,
    }),
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
