import { App } from "@octokit/app";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { readGitHubAppPrivateKey } from "@reviewrouter/platform-config";
import type { ActionSessionClaims } from "@reviewrouter/features-action-control-plane";
import {
  MemoryKnowledgeError,
  type MemoryActor,
  type MemoryKnowledgeSource,
  type MemoryRequestControls,
} from "@reviewrouter/features-memory";
import {
  createPrismaMemoryRepositoryMaintainers,
  type MemoryRepositoryPermissionClient,
} from "@reviewrouter/features-memory/infrastructure";

export const githubMemorySourceSchema = z
  .object({
    type: z.enum(["github_issue_comment", "github_review_comment"]),
    sourceId: z.string().min(1).max(200),
    nodeId: z.string().regex(/^[A-Za-z0-9_=-]{1,200}$/),
    revision: z.string().min(1).max(80),
    updatedAt: z.iso.datetime({ offset: true }),
    statementAt: z.iso.datetime({ offset: true }),
    claimedBodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
    githubRepositoryId: z.string().regex(/^\d+$/),
    pullRequestNumber: z.number().int().positive().max(2_147_483_647),
    headSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    baseSha: z.string().regex(/^[a-f0-9]{40,64}$/),
    visibility: z.enum(["private", "internal", "public"]),
    url: z.string().url().max(2_000).nullable().optional(),
  })
  .strict();
export type GitHubMemorySourceClaim = z.infer<typeof githubMemorySourceSchema>;

// Deliberately no body, bodyText, diffHunk, path, thread or code field.
export const memorySourceMetadataQuery = `query ReviewRouterMemorySourceMetadata($nodeId: ID!) {
  node(id: $nodeId) {
    __typename
    ... on IssueComment {
      id updatedAt createdAt url
      author { __typename login ... on User { databaseId } }
      pullRequest { number headRefOid baseRefOid repository { databaseId nameWithOwner visibility } }
    }
    ... on PullRequestReviewComment {
      id updatedAt createdAt url
      author { __typename login ... on User { databaseId } }
      pullRequest { number headRefOid baseRefOid repository { databaseId nameWithOwner visibility } }
    }
  }
}`;

type SourceMetadata = {
  readonly __typename: "IssueComment" | "PullRequestReviewComment";
  readonly id: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly url: string;
  readonly author: {
    readonly __typename: string;
    readonly login: string;
    readonly databaseId?: number | null;
  } | null;
  readonly pullRequest: {
    readonly number: number;
    readonly headRefOid: string;
    readonly baseRefOid: string;
    readonly repository: {
      readonly databaseId: number;
      readonly nameWithOwner: string;
      readonly visibility: string;
    };
  } | null;
};
type MetadataClient = MemoryRepositoryPermissionClient & {
  graphql<T>(
    query: string,
    parameters: {
      readonly nodeId: string;
      readonly request: {
        readonly signal: AbortSignal;
        readonly timeout: number;
      };
    },
  ): Promise<T>;
};

/** Converts untrusted Action claims into checked product source/actor metadata. */
export class GitHubMemorySourceVerifier {
  private readonly app: App | null;
  constructor(
    private readonly dependencies: {
      readonly prisma: PrismaClient;
      readonly env: Readonly<Record<string, string | undefined>>;
      readonly createClient?: (
        installationId: string,
      ) => Promise<MetadataClient>;
    },
  ) {
    const appId = dependencies.env.GITHUB_APP_ID;
    const privateKey = readGitHubAppPrivateKey(dependencies.env);
    this.app = appId && privateKey ? new App({ appId, privateKey }) : null;
  }

  async createClient(installationId: string): Promise<MetadataClient> {
    if (this.dependencies.createClient)
      return this.dependencies.createClient(installationId);
    if (
      !this.app ||
      !/^\d+$/.test(installationId) ||
      !Number.isSafeInteger(Number(installationId))
    )
      throw new MemoryKnowledgeError("unavailable", true);
    return (await this.app.getInstallationOctokit(
      Number(installationId),
    )) as MetadataClient;
  }

  repositoryMaintainers() {
    return createPrismaMemoryRepositoryMaintainers({
      prisma: this.dependencies.prisma,
      createClient: (installationId) => this.createClient(installationId),
    });
  }

  async verify(
    session: ActionSessionClaims,
    claim: GitHubMemorySourceClaim,
    controls: MemoryRequestControls,
  ): Promise<{
    readonly actor: MemoryActor;
    readonly source: MemoryKnowledgeSource;
  }> {
    if (
      !session.githubActorLogin ||
      !session.githubActorId ||
      !/^[1-9]\d{0,19}$/.test(session.githubActorId) ||
      claim.githubRepositoryId !== session.githubRepositoryId ||
      (session.eventName !== "issue_comment" &&
        session.eventName !== "pull_request_review_comment") ||
      (session.eventName === "issue_comment") !==
        (claim.type === "github_issue_comment") ||
      (session.pullRequestNumber !== undefined &&
        session.pullRequestNumber !== claim.pullRequestNumber) ||
      (session.headSha !== undefined && session.headSha !== claim.headSha) ||
      (session.baseSha !== undefined && session.baseSha !== claim.baseSha)
    )
      throw new MemoryKnowledgeError("forbidden");
    const repository =
      await this.dependencies.prisma.repositoryConnection.findFirst({
        where: {
          id: session.repositoryId,
          workspaceId: session.workspaceId,
          selected: true,
          archived: false,
          provider: "github",
        },
        select: {
          githubRepositoryId: true,
          fullName: true,
          visibility: true,
          installation: {
            select: { githubInstallationId: true, status: true },
          },
        },
      });
    if (
      !repository?.installation ||
      repository.installation.status !== "active" ||
      String(repository.githubRepositoryId) !== session.githubRepositoryId ||
      repository.fullName.toLowerCase() !== session.repository.toLowerCase()
    )
      throw new MemoryKnowledgeError("forbidden");
    const remaining = controls.deadlineAt.getTime() - Date.now();
    if (remaining <= 0 || controls.signal?.aborted)
      throw new MemoryKnowledgeError("deadline_exceeded", true);
    const signal = controls.signal
      ? AbortSignal.any([controls.signal, AbortSignal.timeout(remaining)])
      : AbortSignal.timeout(remaining);
    let metadata: SourceMetadata | null | undefined;
    try {
      const client = await this.createClient(
        String(repository.installation.githubInstallationId),
      );
      metadata = (
        await client.graphql<{ readonly node?: SourceMetadata | null }>(
          memorySourceMetadataQuery,
          { nodeId: claim.nodeId, request: { signal, timeout: remaining } },
        )
      ).node;
    } catch {
      throw new MemoryKnowledgeError("unavailable", true);
    }
    const pull = metadata?.pullRequest;
    const author = metadata?.author;
    if (
      !metadata ||
      !pull ||
      !author ||
      author.__typename !== "User" ||
      !Number.isSafeInteger(author.databaseId) ||
      !author.databaseId ||
      author.databaseId < 1 ||
      String(author.databaseId) !== session.githubActorId ||
      metadata.id !== claim.nodeId ||
      metadata.__typename !==
        (claim.type === "github_issue_comment"
          ? "IssueComment"
          : "PullRequestReviewComment") ||
      author.login.toLowerCase() !== session.githubActorLogin.toLowerCase() ||
      String(pull.repository.databaseId) !== session.githubRepositoryId ||
      pull.repository.nameWithOwner.toLowerCase() !==
        session.repository.toLowerCase() ||
      pull.number !== claim.pullRequestNumber ||
      pull.headRefOid !== claim.headSha ||
      pull.baseRefOid !== claim.baseSha ||
      Date.parse(metadata.updatedAt) !== Date.parse(claim.revision) ||
      Date.parse(metadata.updatedAt) !== Date.parse(claim.updatedAt) ||
      Date.parse(metadata.updatedAt) !== Date.parse(claim.statementAt) ||
      !Number.isFinite(Date.parse(metadata.createdAt)) ||
      Date.parse(metadata.createdAt) > Date.parse(metadata.updatedAt) ||
      Date.parse(metadata.updatedAt) > Date.now()
    )
      throw new MemoryKnowledgeError("conflict");
    const url = new URL(metadata.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.username ||
      url.password ||
      url.search ||
      !(
        url.pathname.toLowerCase() ===
          `/${session.repository.toLowerCase()}/pull/${pull.number}` ||
        url.pathname
          .toLowerCase()
          .startsWith(
            `/${session.repository.toLowerCase()}/pull/${pull.number}/`,
          )
      )
    )
      throw new MemoryKnowledgeError("forbidden");
    const visibility = pull.repository.visibility.toLowerCase();
    if (
      visibility !== "public" &&
      visibility !== "private" &&
      visibility !== "internal"
    )
      throw new MemoryKnowledgeError("unavailable", true);
    const updatedAt = new Date(metadata.updatedAt).toISOString();
    return {
      actor: {
        kind: "github_user",
        id: `github-user:${author.databaseId}`,
        githubUserId: String(author.databaseId),
        login: author.login,
      },
      source: {
        type: "github_comment",
        sourceId: `github-node:${metadata.id}`,
        revision: updatedAt,
        updatedAt,
        statementAt: updatedAt,
        repositoryId: session.repositoryId,
        pullRequestNumber: pull.number,
        url: metadata.url,
        visibility,
        claimedBodyDigest: claim.claimedBodyDigest,
        observedCommitSha: null,
      },
    };
  }
}
