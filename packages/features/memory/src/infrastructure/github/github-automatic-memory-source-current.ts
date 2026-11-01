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
  if (
    !client.graphql ||
    !evidence.messages.some((message) => message.id === input.sourceId)
  )
    return false;
  const rootId = evidence.threadId.slice("github-review-thread:".length);
  const repositoryName = (input.owner + "/" + input.repo).toLowerCase();
  // Fetch only the frozen evidence, never all comments of the pull request.
  // GitHub's nodes(ids:) accepts up to 100 IDs per query.
  for (let offset = 0; offset < evidence.messages.length; offset += 100) {
    if (controls.signal?.aborted || Date.now() >= controls.deadlineAt.getTime())
      return false;
    const batch = evidence.messages.slice(offset, offset + 100);
    const response = (await client.graphql(
      "query ReviewRouterCurrentAutomaticThreadEvidence($ids: [ID!]!) { nodes(ids: $ids) { __typename ... on PullRequestReviewComment { id body updatedAt fullDatabaseId replyTo { fullDatabaseId } pullRequest { number repository { nameWithOwner } } } } }",
      {
        ids: batch.map((message) => message.id.slice("github-node:".length)),
        request: {
          timeout: Math.max(
            1,
            Math.min(1500, controls.deadlineAt.getTime() - Date.now()),
          ),
          ...(controls.signal ? { signal: controls.signal } : {}),
        },
      },
    )) as {
      nodes?: readonly (null | {
        __typename: string;
        id: string;
        body: string;
        updatedAt: string;
        fullDatabaseId: string | number | null;
        replyTo: null | { fullDatabaseId: string | number | null };
        pullRequest: {
          number: number;
          repository: { nameWithOwner: string };
        };
      })[];
    };
    if (
      !Array.isArray(response.nodes) ||
      response.nodes.length !== batch.length
    )
      return false;
    for (let index = 0; index < batch.length; index++) {
      const message = batch[index]!;
      const comment = response.nodes[index];
      if (
        !comment ||
        comment.__typename !== "PullRequestReviewComment" ||
        comment.id !== message.id.slice("github-node:".length) ||
        typeof comment.body !== "string" ||
        comment.body.length > 131072 ||
        !Number.isFinite(Date.parse(comment.updatedAt)) ||
        new Date(comment.updatedAt).toISOString() !== message.updatedAt ||
        createHash("sha256").update(comment.body, "utf8").digest("hex") !==
          message.bodyDigest ||
        comment.fullDatabaseId === null ||
        (comment.replyTo === null
          ? null
          : comment.replyTo.fullDatabaseId === null
            ? ""
            : String(comment.replyTo.fullDatabaseId)) !== message.replyTo ||
        (message.replyTo === null
          ? String(comment.fullDatabaseId) !== rootId
          : message.replyTo !== rootId) ||
        comment.pullRequest?.number !== input.pullRequestNumber ||
        comment.pullRequest.repository?.nameWithOwner.toLowerCase() !==
          repositoryName
      )
        return false;
    }
  }
  return (
    !controls.signal?.aborted &&
    Date.now() < controls.deadlineAt.getTime()
  );
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
