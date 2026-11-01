import { createGitHubAutomaticMemorySourceCurrent } from "@reviewrouter/features-memory/composition";
import type { ActionSessionClaims } from "@reviewrouter/features-action-control-plane";
import {
  ConversationError,
  conversationDigest,
  assertConversationLive,
  type ConversationIdentity,
  type ConversationMessage,
  type ConversationProcessRequest,
  type ConversationProcessResult,
  type ConversationSnapshot,
  type ConversationSourcePort,
  type RequestControls,
} from "@reviewrouter/features-conversations";
import type { MemoryAutomaticSourceCurrentPort } from "@reviewrouter/features-memory";

type GitHubUser = {
  readonly id: number;
  readonly login: string;
  readonly type: string;
};
type ReviewComment = {
  readonly id: number;
  readonly node_id: string;
  readonly user: GitHubUser | null;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly in_reply_to_id?: number;
  readonly pull_request_url: string;
  readonly path: string;
  readonly side?: string | null;
  readonly line?: number | null;
  readonly original_line?: number | null;
  readonly commit_id: string;
  readonly original_commit_id: string;
  readonly diff_hunk: string;
};
type PullRequest = {
  readonly number: number;
  readonly state: string;
  readonly head: {
    readonly sha: string;
    readonly repo: { readonly id: number } | null;
  };
  readonly base: {
    readonly sha: string;
    readonly repo: {
      readonly id: number;
      readonly full_name: string;
      readonly private: boolean;
      readonly visibility?: string;
    };
  };
};
export interface ConversationGitHubClient {
  request<T>(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: T }>;
  graphql?<T>(
    query: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<T>;
}
export type ConversationSourceScope = {
  readonly claims: ActionSessionClaims;
  readonly createClient: () => Promise<ConversationGitHubClient>;
  readonly appSlug: string;
  readonly sourceProcessingAllowed: () => Promise<boolean>;
  readonly standingPolicyRevision?: () => Promise<string | null>;
  readonly revokeSource?: (
    sourceId: string,
    cause: "deleted" | "unavailable" | "changed",
    controls: RequestControls,
  ) => Promise<void>;
  readonly knownSource?: (commentId: string) => Promise<{
    readonly sourceId: string;
    readonly actorId: string;
    readonly pullRequestNumber: number;
  } | null>;
};
function iso(value: string) {
  if (!Number.isFinite(Date.parse(value)))
    throw new ConversationError("context_incomplete");
  return new Date(value).toISOString();
}
function validId(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ConversationError("context_incomplete");
  return String(value);
}
function message(comment: ReviewComment): ConversationMessage {
  if (
    !comment.user ||
    typeof comment.body !== "string" ||
    !comment.node_id ||
    (comment.user.type !== "User" && comment.user.type !== "Bot")
  )
    throw new ConversationError("context_incomplete");
  const createdAt = iso(comment.created_at),
    updatedAt = iso(comment.updated_at);
  if (createdAt > updatedAt || Date.parse(updatedAt) > Date.now())
    throw new ConversationError("context_incomplete");
  return {
    id: `github-node:${comment.node_id}`,
    commentId: validId(comment.id),
    actor: {
      id: `github-user:${validId(comment.user.id)}`,
      login: comment.user.login,
      kind: comment.user.type === "Bot" ? "bot" : "human",
    },
    createdAt,
    updatedAt,
    replyTo: comment.in_reply_to_id ? String(comment.in_reply_to_id) : null,
    body: comment.body,
    bodyDigest: conversationDigest(comment.body),
  };
}

/** App-only source reader. No client body, body hash, pagination claim or actor role is trusted. */
export class GitHubConversationSource
  implements ConversationSourcePort, MemoryAutomaticSourceCurrentPort
{
  constructor(private readonly scope: ConversationSourceScope) {}
  private async client(controls: RequestControls) {
    assertConversationLive(controls);
    if (!(await this.scope.sourceProcessingAllowed()))
      throw new ConversationError("unavailable");
    return this.scope.createClient();
  }
  private parameters(controls: RequestControls) {
    assertConversationLive(controls);
    const [owner, repo, extra] = this.scope.claims.repository.split("/");
    if (!owner || !repo || extra) throw new ConversationError("forbidden");
    const remaining = controls.deadlineAt.getTime() - Date.now();
    return {
      owner,
      repo,
      request: {
        signal: controls.signal
          ? AbortSignal.any([controls.signal, AbortSignal.timeout(remaining)])
          : AbortSignal.timeout(remaining),
        timeout: remaining,
      },
    };
  }
  async identify(
    input: ConversationProcessRequest,
    controls: RequestControls,
  ): Promise<ConversationIdentity> {
    const claims = this.scope.claims;
    if (
      claims.eventName !== "pull_request_review_comment" ||
      !claims.githubActorId ||
      !claims.githubActorLogin
    )
      throw new ConversationError("forbidden");
    try {
      const client = await this.client(controls);
      const { data: comment } = await client.request<ReviewComment>(
        "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}",
        { ...this.parameters(controls), comment_id: input.sourceCommentId },
      );
      const source = message(comment);
      if (
        source.actor.kind !== "human" ||
        source.actor.id !== `github-user:${claims.githubActorId}` ||
        source.actor.login.toLowerCase() !==
          claims.githubActorLogin.toLowerCase() ||
        source.updatedAt !== iso(input.sourceRevision) ||
        !comment.in_reply_to_id ||
        !comment.pull_request_url.endsWith(`/pulls/${input.pullRequestNumber}`)
      )
        throw new ConversationError("forbidden");
      return {
        workspaceId: claims.workspaceId,
        repositoryId: claims.repositoryId,
        repositoryStableId: claims.githubRepositoryId,
        repositoryFullName: claims.repository,
        pullRequestNumber: input.pullRequestNumber,
        threadId: `github-review-thread:${comment.in_reply_to_id}`,
        sourceId: source.id,
        sourceCommentId: source.commentId,
        sourceRevision: `${source.updatedAt}:${source.bodyDigest}`,
        sourceUpdatedAt: source.updatedAt,
        sourceActor: source.actor,
      };
    } catch (error) {
      if (error instanceof ConversationError) throw error;
      throw new ConversationError("context_incomplete");
    }
  }
  private async inventory(
    client: ConversationGitHubClient,
    pullRequestNumber: number,
    controls: RequestControls,
  ): Promise<readonly ReviewComment[]> {
    const comments: ReviewComment[] = [];
    const ids = new Set<number>();
    for (let page = 1; ; page++) {
      // Deadline bounds pagination; reaching a safety bound is explicit incomplete, never last-N.
      if (page > 100) throw new ConversationError("context_incomplete");
      const { data } = await client.request<ReviewComment[]>(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
        {
          ...this.parameters(controls),
          pull_number: pullRequestNumber,
          per_page: 100,
          page,
        },
      );
      if (!Array.isArray(data) || data.length > 100)
        throw new ConversationError("context_incomplete");
      for (const comment of data) {
        if (ids.has(comment.id))
          throw new ConversationError("context_incomplete");
        ids.add(comment.id);
        comments.push(comment);
      }
      if (data.length < 100) return comments;
    }
  }
  async read(
    identity: ConversationIdentity,
    controls: RequestControls,
  ): Promise<ConversationSnapshot> {
    try {
      const client = await this.client(controls);
      const { data: pull } = await client.request<PullRequest>(
        "GET /repos/{owner}/{repo}/pulls/{pull_number}",
        {
          ...this.parameters(controls),
          pull_number: identity.pullRequestNumber,
        },
      );
      if (
        pull.number !== identity.pullRequestNumber ||
        pull.state !== "open" ||
        String(pull.base.repo.id) !== identity.repositoryStableId ||
        pull.base.repo.full_name.toLowerCase() !==
          identity.repositoryFullName.toLowerCase() ||
        !pull.head.repo ||
        pull.head.repo.id !== pull.base.repo.id
      )
        throw new ConversationError("forbidden");
      const comments = await this.inventory(
        client,
        identity.pullRequestNumber,
        controls,
      );
      const rootId = Number(
        identity.threadId.replace("github-review-thread:", ""),
      );
      const root = comments.find((comment) => comment.id === rootId);
      const source = comments.find(
        (comment) => String(comment.id) === identity.sourceCommentId,
      );
      const { data: bot } = await client.request<GitHubUser>(
        "GET /users/{username}",
        {
          username: `${this.scope.appSlug}[bot]`,
          request: this.parameters(controls).request,
        },
      );
      if (
        !root ||
        !source ||
        root.in_reply_to_id ||
        !root.user ||
        bot.type !== "Bot" ||
        root.user.type !== "Bot" ||
        root.user.id !== bot.id ||
        root.user.login.toLowerCase() !== bot.login.toLowerCase() ||
        !this.isFinding(root.body)
      )
        throw new ConversationError("forbidden");
      const selected = message(source);
      if (
        selected.id !== identity.sourceId ||
        `${selected.updatedAt}:${selected.bodyDigest}` !==
          identity.sourceRevision ||
        selected.actor.id !== identity.sourceActor.id
      )
        throw new ConversationError("stale");
      const messages = comments
        .filter(
          (comment) =>
            comment.id === rootId || comment.in_reply_to_id === rootId,
        )
        .map(message)
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        );
      if (
        !messages.some((item) => item.id === identity.sourceId) ||
        messages.length < 2
      )
        throw new ConversationError("context_incomplete");
      const permission = await client.request<{
        readonly permission: string;
        readonly role_name?: string;
        readonly user: { readonly id: number; readonly login: string };
      }>("GET /repos/{owner}/{repo}/collaborators/{username}/permission", {
        ...this.parameters(controls),
        username: identity.sourceActor.login,
      });
      if (
        `github-user:${validId(permission.data.user.id)}` !==
        identity.sourceActor.id
      )
        throw new ConversationError("forbidden");
      const visibility =
        pull.base.repo.visibility ??
        (pull.base.repo.private ? "private" : "public");
      if (!["public", "private", "internal"].includes(visibility))
        throw new ConversationError("context_incomplete");
      if (
        visibility !== "public" &&
        ![permission.data.permission, permission.data.role_name].some((role) =>
          ["read", "triage", "write", "maintain", "admin"].includes(role ?? ""),
        )
      )
        throw new ConversationError("forbidden");
      const anchor = {
        path: root.path,
        side: root.side ?? null,
        line: root.line ?? null,
        originalLine: root.original_line ?? null,
        commitSha: root.commit_id,
        originalCommitSha: root.original_commit_id,
        diffHunk: root.diff_hunk,
      };
      const vector = messages.map((item) => [
        item.id,
        item.updatedAt,
        item.bodyDigest,
        item.replyTo,
      ]);
      const byBot = (comment: ReviewComment) =>
        comment.user?.id === bot.id && comment.user.type === "Bot";
      return {
        ...identity,
        messages,
        visibility: visibility as ConversationSnapshot["visibility"],
        headSha: pull.head.sha,
        baseSha: pull.base.sha,
        anchor,
        threadDigest: conversationDigest({
          vector,
          anchor,
          headSha: pull.head.sha,
          baseSha: pull.base.sha,
        }),
        parentCommentId: String(root.id),
        sourceMaintainer: [
          permission.data.permission,
          permission.data.role_name,
        ].some((role) => role === "admin" || role === "maintain"),
        repliesInThread: comments.filter(
          (comment) => comment.in_reply_to_id === rootId && byBot(comment),
        ).length,
        repliesInPullRequest: comments.filter(
          (comment) => comment.in_reply_to_id && byBot(comment),
        ).length,
        replyComments: comments
          .filter((comment) => comment.in_reply_to_id && byBot(comment))
          .map((comment) => ({
            id: String(comment.id),
            threadId: `github-review-thread:${comment.in_reply_to_id}`,
          })),
      };
    } catch (error) {
      if (error instanceof ConversationError) throw error;
      throw new ConversationError("context_incomplete");
    }
  }
  async isCurrent(snapshot: ConversationSnapshot, controls: RequestControls) {
    try {
      const current = await this.read(snapshot, controls);
      return (
        current.threadDigest === snapshot.threadDigest &&
        current.sourceMaintainer === snapshot.sourceMaintainer &&
        current.visibility === snapshot.visibility
      );
    } catch {
      return false;
    }
  }
  async current(
    input: Parameters<MemoryAutomaticSourceCurrentPort["current"]>[0],
    controls: RequestControls,
  ) {
    return createGitHubAutomaticMemorySourceCurrent({
      scope: {
        workspaceId: this.scope.claims.workspaceId,
        repositoryId: this.scope.claims.repositoryId,
        githubRepositoryId: this.scope.claims.githubRepositoryId,
        repositoryFullName: this.scope.claims.repository,
      },
      createClient: () => this.scope.createClient(),
      sourceProcessingAllowed: this.scope.sourceProcessingAllowed,
      standingPolicyRevision:
        this.scope.standingPolicyRevision ?? (async () => null),
    }).current(input, controls);
  }
  async revokeDeleted(
    input: ConversationProcessRequest,
    controls: RequestControls,
  ) {
    const known = await this.scope.knownSource?.(input.sourceCommentId);
    if (
      !known ||
      !this.scope.revokeSource ||
      known.pullRequestNumber !== input.pullRequestNumber
    )
      throw new ConversationError("forbidden");
    const client = await this.client(controls);
    if (known.actorId !== `github-user:${this.scope.claims.githubActorId}`) {
      if (
        !this.scope.claims.githubActorLogin ||
        !this.scope.claims.githubActorId
      )
        throw new ConversationError("forbidden");
      const { data: permission } = await client.request<{
        readonly permission: string;
        readonly role_name?: string;
        readonly user: { readonly id: number; readonly login: string };
      }>("GET /repos/{owner}/{repo}/collaborators/{username}/permission", {
        ...this.parameters(controls),
        username: this.scope.claims.githubActorLogin,
      });
      if (
        String(permission.user.id) !== this.scope.claims.githubActorId ||
        permission.user.login.toLowerCase() !==
          this.scope.claims.githubActorLogin.toLowerCase() ||
        ![permission.permission, permission.role_name].some(
          (role) => role === "maintain" || role === "admin",
        )
      )
        throw new ConversationError("forbidden");
    }
    // A successful complete authorized inventory establishes absence; an isolated 404 never does.
    const comments = await this.inventory(
      client,
      input.pullRequestNumber,
      controls,
    );
    if (
      comments.some((comment) => String(comment.id) === input.sourceCommentId)
    )
      throw new ConversationError("stale");
    await this.scope.revokeSource(known.sourceId, "deleted", controls);
  }
  async verifyPublished(
    identity: ConversationIdentity,
    commentId: string,
    result: ConversationProcessResult,
    controls: RequestControls,
  ) {
    if (
      !result.reply ||
      identity.repositoryId !== this.scope.claims.repositoryId ||
      identity.workspaceId !== this.scope.claims.workspaceId ||
      !/^[1-9]\d{0,19}$/.test(commentId)
    )
      return false;
    try {
      const client = await this.client(controls);
      const { data: bot } = await client.request<GitHubUser>(
        "GET /users/{username}",
        {
          username: `${this.scope.appSlug}[bot]`,
          request: this.parameters(controls).request,
        },
      );
      const { data: comment } = await client.request<ReviewComment>(
        "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}",
        { ...this.parameters(controls), comment_id: commentId },
      );
      return (
        bot.type === "Bot" &&
        comment.user?.id === bot.id &&
        comment.user.type === "Bot" &&
        comment.user.login.toLowerCase() === bot.login.toLowerCase() &&
        String(comment.id) === commentId &&
        String(comment.in_reply_to_id) === result.reply.parentCommentId &&
        comment.pull_request_url.endsWith(
          `/pulls/${identity.pullRequestNumber}`,
        ) &&
        conversationDigest(comment.body) === result.reply.bodyDigest &&
        comment.body.split(result.reply.marker).length === 2
      );
    } catch {
      return false;
    }
  }
  private isFinding(body: string) {
    const patterns = [
      /<!--\s*review-router-finding:([a-f0-9]{24,64})\s*-->/gi,
      /(?<!\S)reviewrouter:finding:v2:((?:rrl_[a-f0-9]{32}|[a-f0-9]{24,64}))(?=$|[ \t\r\n])/g,
    ];
    const matches = patterns.flatMap((pattern) => [...body.matchAll(pattern)]);
    const markers = new Set(matches.map((match) => match[1]!.toLowerCase()));
    const reserved = /review-router-finding:|reviewrouter:finding:v2:/g;
    const malformed = [...body.matchAll(reserved)].some(
      (occurrence) =>
        !matches.some(
          (match) =>
            occurrence.index! >= match.index! &&
            occurrence.index! < match.index! + match[0].length,
        ),
    );
    return !malformed && markers.size === 1;
  }
}
