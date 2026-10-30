import { createHash } from "node:crypto";
import {
  normalizeMemoryAutomaticContextEvidence,
  type MemoryAutomaticContextEvidence,
} from "../../domain/memory-knowledge";
import type { MemoryAutomaticSourceCurrentPort } from "../../application/ports/memory-automatic-source-port";
import type { MemoryRequestControls } from "../../application/ports/memory-knowledge-provider-port";
export type MemorySourceGitHubClient = {
  request(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly data: unknown }>;
  graphql?(
    query: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<unknown>;
};

async function contextEvidenceCurrent(
  client: MemorySourceGitHubClient,
  input: {
    readonly owner: string;
    readonly repo: string;
    readonly pullRequestNumber: number;
    readonly sourceId: string;
    readonly evidence: MemoryAutomaticContextEvidence;
  },
  controls: MemoryRequestControls,
): Promise<boolean> {
  const evidence = normalizeMemoryAutomaticContextEvidence(input.evidence);
  if (!evidence.messages.some((message) => message.id === input.sourceId))
    return false;
  const rootId = evidence.threadId.slice("github-review-thread:".length);
  const remaining = new Map(
    evidence.messages.map((message) => [message.id, message]),
  );
  const seen = new Set<number>();
  const expectedPath =
    `/repos/${input.owner}/${input.repo}/pulls/${input.pullRequestNumber}`.toLowerCase();
  for (let page = 1; page <= 100; page++) {
    if (controls.signal?.aborted || Date.now() >= controls.deadlineAt.getTime())
      return false;
    const { data } = await client.request(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
      {
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullRequestNumber,
        per_page: 100,
        page,
        request: {
          timeout: Math.max(
            1,
            Math.min(1500, controls.deadlineAt.getTime() - Date.now()),
          ),
          ...(controls.signal ? { signal: controls.signal } : {}),
        },
      },
    );
    if (!Array.isArray(data) || data.length > 100) return false;
    for (const comment of data as {
      id: number;
      node_id: string;
      body: string;
      updated_at: string;
      in_reply_to_id?: number;
      pull_request_url: string;
    }[]) {
      if (
        !Number.isSafeInteger(comment.id) ||
        comment.id < 1 ||
        seen.has(comment.id)
      )
        return false;
      seen.add(comment.id);
      const message = remaining.get(`github-node:${comment.node_id}`);
      if (!message) continue;
      if (
        typeof comment.body !== "string" ||
        comment.body.length > 131072 ||
        !Number.isFinite(Date.parse(comment.updated_at)) ||
        new Date(comment.updated_at).toISOString() !== message.updatedAt ||
        createHash("sha256").update(comment.body, "utf8").digest("hex") !==
          message.bodyDigest ||
        (comment.in_reply_to_id === undefined
          ? null
          : String(comment.in_reply_to_id)) !== message.replyTo ||
        (message.replyTo === null
          ? String(comment.id) !== rootId
          : message.replyTo !== rootId) ||
        new URL(comment.pull_request_url).pathname.toLowerCase() !==
          expectedPath
      )
        return false;
      remaining.delete(message.id);
    }
    // New replies are not part of the frozen derivation. Read every page so a
    // missing dependency or an incomplete inventory never becomes "current".
    if (data.length < 100) return remaining.size === 0;
  }
  return false;
}

/** One App source reader reused by conversation, every context consumer and management. */
export function createGitHubAutomaticMemorySourceCurrent(input: {
  readonly scope: {
    readonly workspaceId: string;
    readonly repositoryId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
  };
  readonly createClient: () => Promise<MemorySourceGitHubClient>;
  readonly sourceProcessingAllowed: () => Promise<boolean>;
  readonly standingPolicyRevision: () => Promise<string | null>;
}): MemoryAutomaticSourceCurrentPort {
  return {
    async current(value, controls: MemoryRequestControls) {
      try {
        if (
          controls.signal?.aborted ||
          Date.now() >= controls.deadlineAt.getTime() ||
          value.scope.kind !== "repository" ||
          value.scope.workspaceId !== input.scope.workspaceId ||
          value.scope.repositoryId !== input.scope.repositoryId ||
          value.source.repositoryId !== input.scope.repositoryId ||
          !value.source.sourceId.startsWith("github-node:") ||
          value.binding.policyRevision !==
            (await input.standingPolicyRevision()) ||
          !(await input.sourceProcessingAllowed())
        )
          return false;
        const [owner, repo, extra] = input.scope.repositoryFullName.split("/");
        if (!owner || !repo || extra) return false;
        const request = {
          timeout: Math.max(
            1,
            Math.min(1500, controls.deadlineAt.getTime() - Date.now()),
          ),
          ...(controls.signal ? { signal: controls.signal } : {}),
        };
        const client = await input.createClient();
        if (!client.graphql) return false;
        const nodeId = value.source.sourceId.slice("github-node:".length);
        const response = (await client.graphql(
          `query ReviewRouterCurrentAutomaticSource($nodeId: ID!) { node(id: $nodeId) { __typename ... on PullRequestReviewComment { id body updatedAt author { __typename login ... on User { databaseId } } pullRequest { number repository { databaseId nameWithOwner } } } } }`,
          { nodeId, request },
        )) as {
          node: null | {
            __typename: string;
            id: string;
            body: string;
            updatedAt: string;
            author: null | {
              __typename: string;
              login: string;
              databaseId: number;
            };
            pullRequest: {
              number: number;
              repository: { databaseId: number; nameWithOwner: string };
            };
          };
        };
        const node = response.node;
        if (
          !node ||
          node.__typename !== "PullRequestReviewComment" ||
          node.id !== nodeId ||
          typeof node.body !== "string" ||
          node.body.length > 131072 ||
          node.author?.__typename !== "User" ||
          `github-user:${node.author.databaseId}` !==
            value.binding.sourceActorId ||
          String(node.pullRequest.repository.databaseId) !==
            input.scope.githubRepositoryId ||
          node.pullRequest.repository.nameWithOwner.toLowerCase() !==
            input.scope.repositoryFullName.toLowerCase() ||
          !Number.isFinite(Date.parse(node.updatedAt))
        )
          return false;
        const digest = createHash("sha256")
          .update(node.body, "utf8")
          .digest("hex");
        if (
          `${new Date(node.updatedAt).toISOString()}:${digest}` !==
            value.source.revision ||
          digest !== value.source.claimedBodyDigest
        )
          return false;
        const { data } = await client.request(
          "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
          { owner, repo, username: node.author.login, request },
        );
        const permission = data as {
          permission?: unknown;
          role_name?: unknown;
          user?: { id?: unknown };
        };
        if (
          !(
            `github-user:${permission.user?.id}` ===
              value.binding.sourceActorId &&
            [permission.permission, permission.role_name].some(
              (role) => role === "admin" || role === "maintain",
            )
          )
        )
          return false;
        if (value.binding.contextEvidence !== undefined) {
          if (
            !Number.isSafeInteger(node.pullRequest.number) ||
            node.pullRequest.number < 1 ||
            node.pullRequest.number !== value.source.pullRequestNumber ||
            !(await contextEvidenceCurrent(
              client,
              {
                owner,
                repo,
                pullRequestNumber: node.pullRequest.number,
                sourceId: value.source.sourceId,
                evidence: value.binding.contextEvidence,
              },
              controls,
            ))
          )
            return false;
        }
        return (
          !controls.signal?.aborted &&
          Date.now() < controls.deadlineAt.getTime()
        );
      } catch {
        return false;
      }
    },
  };
}
