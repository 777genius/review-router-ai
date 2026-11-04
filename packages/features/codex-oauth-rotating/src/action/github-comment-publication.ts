/** GitHub issue-comment upsert and fenced cleanup of our own progress markers. */
import { githubRequestTimeoutMs } from "./action-contract.js";
import { fetchWithRetry, consumeJsonResponse, consumeResponseBody } from "./http-retry.js";

type FetchLike = typeof fetch;

const fullRuntimeProgressCommentMarker =
  "<!-- review-router-progress-tracker -->";

type GitHubIssueCommentResponse = {
  readonly id: number;
  readonly body?: string | null;
};


export async function postPullRequestComment(input: {
  readonly fetchImpl: FetchLike;
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
  readonly marker: string;
  readonly body: string;
}): Promise<void> {
  const commentsUrl = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issueNumber}/comments`;
  const { response: commentsResponse, body: comments } = await fetchWithRetry({
    fetchImpl: input.fetchImpl,
    label: "github_comment_lookup",
    timeoutMs: githubRequestTimeoutMs,
    url: `${commentsUrl}?per_page=100`,
    init: {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
    consume: consumeJsonResponse,
  });
  if (!commentsResponse.ok) {
    throw new Error("github_comment_lookup_failed");
  }
  if (!Array.isArray(comments)) {
    throw new Error("github_comment_lookup_invalid");
  }
  const existing = comments.find(
    (comment): comment is GitHubIssueCommentResponse =>
      typeof comment === "object" &&
      comment !== null &&
      typeof (comment as GitHubIssueCommentResponse).id === "number" &&
      typeof (comment as GitHubIssueCommentResponse).body === "string" &&
      (comment as GitHubIssueCommentResponse).body!.startsWith(input.marker),
  );
  if (existing) {
    const updateResponse = await fetchWithRetry({
      fetchImpl: input.fetchImpl,
      label: "github_comment_update",
      timeoutMs: githubRequestTimeoutMs,
      url: `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/comments/${existing.id}`,
      init: {
        method: "PATCH",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
        },
        body: JSON.stringify({ body: input.body }),
      },
      consume: consumeResponseBody,
    });
    if (!updateResponse.ok) {
      throw new Error("github_comment_update_failed");
    }
    return;
  }

  const createResponse = await fetchWithRetry({
    fetchImpl: input.fetchImpl,
    label: "github_comment_create",
    timeoutMs: githubRequestTimeoutMs,
    url: commentsUrl,
    init: {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ body: input.body }),
    },
    consume: consumeResponseBody,
  });
  if (!createResponse.ok) {
    throw new Error("github_comment_post_failed");
  }
}

export async function deleteStaleCodexRotatingSummaryComments(input: {
  readonly fetchImpl: FetchLike;
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
}): Promise<void> {
  const commentsUrl = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issueNumber}/comments`;
  const { response: commentsResponse, body: comments } = await fetchWithRetry({
    fetchImpl: input.fetchImpl,
    label: "github_stale_comment_lookup",
    timeoutMs: githubRequestTimeoutMs,
    url: `${commentsUrl}?per_page=100`,
    init: {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
    consume: consumeJsonResponse,
  });
  if (!commentsResponse.ok) {
    throw new Error("github_stale_comment_lookup_failed");
  }
  if (!Array.isArray(comments)) {
    throw new Error("github_stale_comment_lookup_invalid");
  }
  const staleComments = comments.filter(
    (comment): comment is GitHubIssueCommentResponse =>
      typeof comment === "object" &&
      comment !== null &&
      typeof (comment as GitHubIssueCommentResponse).id === "number" &&
      typeof (comment as GitHubIssueCommentResponse).body === "string" &&
      /^<!--\s*reviewrouter:(?:codex-oauth-rotating|hosted-pool)(?:\s|-->)/i.test(
        (comment as GitHubIssueCommentResponse).body!,
      ),
  );
  for (const comment of staleComments) {
    const deleteResponse = await fetchWithRetry({
      fetchImpl: input.fetchImpl,
      label: "github_stale_comment_delete",
      timeoutMs: githubRequestTimeoutMs,
      url: `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/comments/${comment.id}`,
      init: {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${input.token}`,
          "x-github-api-version": "2022-11-28",
        },
      },
      consume: consumeResponseBody,
    });
    if (!deleteResponse.ok) {
      throw new Error("github_stale_comment_delete_failed");
    }
  }
}

class GitHubProgressCommentRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function deleteFullRuntimeProgressCommentsWithTokenRefresh(input: {
  readonly fetchImpl: FetchLike;
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
  readonly refreshToken: () => Promise<string>;
}): Promise<string> {
  try {
    await deleteFullRuntimeProgressComments(input);
    return input.token;
  } catch (error) {
    if (
      !(error instanceof GitHubProgressCommentRequestError) ||
      error.status !== 401
    ) {
      throw error;
    }
    const refreshedToken = await input.refreshToken();
    await deleteFullRuntimeProgressComments({
      ...input,
      token: refreshedToken,
    });
    return refreshedToken;
  }
}

export async function deleteFullRuntimeProgressComments(input: {
  readonly fetchImpl: FetchLike;
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly issueNumber: number;
}): Promise<void> {
  const commentsUrl = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/${input.issueNumber}/comments`;
  const { response: commentsResponse, body: comments } = await fetchWithRetry({
    fetchImpl: input.fetchImpl,
    label: "github_progress_comment_lookup",
    timeoutMs: githubRequestTimeoutMs,
    url: `${commentsUrl}?per_page=100`,
    init: {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.token}`,
        "x-github-api-version": "2022-11-28",
      },
    },
    consume: consumeJsonResponse,
  });
  if (!commentsResponse.ok) {
    throw new GitHubProgressCommentRequestError(
      "github_progress_comment_lookup_failed",
      commentsResponse.status,
    );
  }
  if (!Array.isArray(comments)) {
    throw new Error("github_progress_comment_lookup_invalid");
  }
  const progressComments = comments.filter(
    (comment): comment is GitHubIssueCommentResponse =>
      typeof comment === "object" &&
      comment !== null &&
      typeof (comment as GitHubIssueCommentResponse).id === "number" &&
      typeof (comment as GitHubIssueCommentResponse).body === "string" &&
      (comment as GitHubIssueCommentResponse).body!.includes(
        fullRuntimeProgressCommentMarker,
      ),
  );
  for (const comment of progressComments) {
    const deleteResponse = await fetchWithRetry({
      fetchImpl: input.fetchImpl,
      label: "github_progress_comment_delete",
      timeoutMs: githubRequestTimeoutMs,
      url: `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/issues/comments/${comment.id}`,
      init: {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${input.token}`,
          "x-github-api-version": "2022-11-28",
        },
      },
      consume: consumeResponseBody,
    });
    if (!deleteResponse.ok) {
      throw new GitHubProgressCommentRequestError(
        "github_progress_comment_delete_failed",
        deleteResponse.status,
      );
    }
  }
}

