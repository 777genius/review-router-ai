import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GitHubReviewV2PublicationClient,
  type GitHubInstallationClient,
} from "../infrastructure/github/github-review-publication-client";
import {
  ReviewV2PublicationPayloadKind,
  type ReviewV2PublicationPayload,
} from "../application/ports/review-publication-payload-port";
import { ReviewV2ScmMutationFailureOutcome } from "../application/ports/review-publication-execution-ports";
import {
  ReviewPublicationEffectStrategy,
  ReviewPublicationKind,
  ReviewPublicationOperationRole,
  ReviewPublicationOperationState,
  ReviewPublicationReceiptStatus,
} from "../domain/review-publication-attempt";
import {
  containsReviewSummaryMarker,
  isReviewSummaryMarker,
} from "../domain/review-summary-marker";

const bot = "review-router[bot]";

describe("sticky review summary comment", () => {
  it("posts the first summary, then rewrites that same comment for every new revision", async () => {
    const github = new FakeIssueComments();
    github.add("someone-else", "LGTM");

    const first = await publish(github, summaryPayload("1", "first"));
    const second = await publish(github, summaryPayload("2", "second"));

    expect(second.externalObjectId).toBe(first.externalObjectId);
    expect(github.botSummaries()).toHaveLength(1);
    expect(github.botSummaries()[0]!.body).toContain(revisionMarker("2"));
    expect(github.calls.filter((call) => call.startsWith("POST"))).toHaveLength(
      1,
    );
  });

  it("adopts only the newest legacy per-run summary and leaves older ones untouched", async () => {
    const github = new FakeIssueComments();
    const oldest = github.add(bot, body("1", "oldest"));
    const newest = github.add(bot, body("2", "newest"));
    github.add(bot, "<!-- reviewrouter:progress:v1 --> progress");
    github.add("someone-else", body("3", "a pasted summary"));

    const applied = await publish(github, summaryPayload("4", "current"));

    expect(applied.externalObjectId).toBe(`issue-comment:${newest}`);
    expect(github.byId(oldest).body).toBe(body("1", "oldest"));
    expect(github.byId(newest).body).toBe(body("4", "current"));
    expect(github.comments).toHaveLength(4);
  });

  it("finds the summary beyond the first 100 comments", async () => {
    const github = new FakeIssueComments();
    for (let index = 0; index < 230; index += 1) {
      github.add("someone-else", `comment ${index}`);
    }
    const legacy = github.add(bot, body("1", "legacy"));
    for (let index = 0; index < 20; index += 1) {
      github.add("someone-else", `later ${index}`);
    }

    const applied = await publish(github, summaryPayload("2", "current"));

    expect(applied.externalObjectId).toBe(`issue-comment:${legacy}`);
    expect(github.calls.filter((call) => call.startsWith("GET"))).toEqual([
      "GET page=1",
      "GET page=2",
      "GET page=3",
    ]);
    expect(github.comments).toHaveLength(251);
  });

  it("keeps a single comment when two revisions publish at the same time", async () => {
    const github = new FakeIssueComments();
    await publish(github, summaryPayload("1", "first"));

    await Promise.all([
      publish(github, summaryPayload("2", "second")),
      publish(github, summaryPayload("3", "third")),
    ]);

    expect(github.botSummaries()).toHaveLength(1);
  });

  it("posts a new comment when the summary disappears between lookup and update", async () => {
    const github = new FakeIssueComments();
    const legacy = github.add(bot, body("1", "legacy"));
    github.deleteBeforeNextPatch = legacy;

    const applied = await publish(github, summaryPayload("2", "current"));

    expect(applied.externalObjectId).not.toBe(`issue-comment:${legacy}`);
    expect(github.botSummaries()).toHaveLength(1);
  });

  it("reports a failed lookup as a clean retry because nothing was written", async () => {
    const github = new FakeIssueComments();
    github.failListing = true;

    await expect(
      publish(github, summaryPayload("1", "current")),
    ).rejects.toMatchObject({
      safeCode: "github_summary_comment_lookup_failed",
      outcome: ReviewV2ScmMutationFailureOutcome.DefinitelyNoEffect,
      retryable: true,
    });
    expect(github.calls.some((call) => !call.startsWith("GET"))).toBe(false);
  });

  it("lets a stale run delete the shared comment only while it still shows that run", async () => {
    const github = new FakeIssueComments();
    const stale = summaryPayload("1", "stale");
    const applied = await publish(github, stale);
    await publish(github, summaryPayload("2", "newer"));

    await expect(
      client(github, stale).markStaleOrDelete({
        operation: operation(stale),
        canonicalExternalObjectId: applied.externalObjectId,
        duplicateExternalObjectIds: [],
        compensateCanonical: true,
      }),
    ).resolves.toBe(ReviewPublicationReceiptStatus.Compensated);
    expect(github.botSummaries()).toHaveLength(1);
    expect(github.calls.some((call) => call.startsWith("DELETE"))).toBe(false);

    const current = summaryPayload("3", "current");
    const own = await publish(github, current);
    await client(github, current).markStaleOrDelete({
      operation: operation(current),
      canonicalExternalObjectId: own.externalObjectId,
      duplicateExternalObjectIds: [],
      compensateCanonical: true,
    });
    expect(github.comments).toHaveLength(0);
  });

  it("recognizes only the runtime summary marker family", () => {
    expect(isReviewSummaryMarker(revisionMarker("1"))).toBe(true);
    expect(isReviewSummaryMarker(`<!-- ${revisionMarker("1")} -->`)).toBe(
      false,
    );
    expect(isReviewSummaryMarker("reviewrouter:summary:v2:abc")).toBe(false);
    expect(containsReviewSummaryMarker(body("1", "text"))).toBe(true);
    expect(
      containsReviewSummaryMarker(`x${revisionMarker("1")} reviewrouter`),
    ).toBe(false);
    expect(containsReviewSummaryMarker("<!-- reviewrouter:check:v2 -->")).toBe(
      false,
    );
  });
});

type StoredComment = { id: number; body: string; user: { login: string } };

class FakeIssueComments implements GitHubInstallationClient {
  readonly comments: StoredComment[] = [];
  readonly calls: string[] = [];
  failListing = false;
  deleteBeforeNextPatch: number | null = null;
  private nextId = 1000;

  add(login: string, text: string): number {
    const id = this.nextId++;
    this.comments.push({ id, body: text, user: { login } });
    return id;
  }

  byId(id: number): StoredComment {
    return this.comments.find((comment) => comment.id === id)!;
  }

  botSummaries(): StoredComment[] {
    return this.comments.filter(
      (comment) =>
        comment.user.login === bot && containsReviewSummaryMarker(comment.body),
    );
  }

  async request(
    route: string,
    parameters: Readonly<Record<string, unknown>> = {},
  ): Promise<{ readonly data: unknown }> {
    // Yield so concurrent publications interleave like real HTTP calls.
    await Promise.resolve();
    const commentId = parameters.comment_id as number | undefined;
    switch (route) {
      case "GET /repos/{owner}/{repo}/issues/{issue_number}/comments": {
        const page = parameters.page as number;
        this.calls.push(`GET page=${page}`);
        if (this.failListing) throw { status: 502 };
        const start = (page - 1) * (parameters.per_page as number);
        return {
          data: structuredClone(this.comments.slice(start, start + 100)),
        };
      }
      case "POST /repos/{owner}/{repo}/issues/{issue_number}/comments": {
        this.calls.push("POST");
        const id = this.add(bot, parameters.body as string);
        return { data: structuredClone(this.byId(id)) };
      }
      case "GET /repos/{owner}/{repo}/issues/comments/{comment_id}": {
        this.calls.push(`GET comment=${commentId}`);
        const comment = this.comments.find(({ id }) => id === commentId);
        if (!comment) throw { status: 404 };
        return { data: structuredClone(comment) };
      }
      case "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}": {
        this.calls.push(`PATCH comment=${commentId}`);
        if (this.deleteBeforeNextPatch === commentId) {
          this.remove(commentId);
          this.deleteBeforeNextPatch = null;
        }
        const comment = this.comments.find(({ id }) => id === commentId);
        if (!comment) throw { status: 404 };
        comment.body = parameters.body as string;
        return { data: structuredClone(comment) };
      }
      case "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}": {
        this.calls.push(`DELETE comment=${commentId}`);
        this.remove(commentId!);
        return { data: null };
      }
      default:
        throw new Error(`unexpected_route:${route}`);
    }
  }

  async graphql<T>(): Promise<T> {
    throw new Error("unexpected_graphql_call");
  }

  private remove(id: number) {
    const index = this.comments.findIndex((comment) => comment.id === id);
    if (index >= 0) this.comments.splice(index, 1);
  }
}

type SummaryPayload = Extract<
  ReviewV2PublicationPayload,
  { readonly kind: ReviewV2PublicationPayloadKind.Summary }
>;

function publish(github: FakeIssueComments, payload: SummaryPayload) {
  return client(github, payload).applyOperation({
    operation: operation(payload),
    capability: capability(payload),
  });
}

function client(github: FakeIssueComments, payload: SummaryPayload) {
  return new GitHubReviewV2PublicationClient({
    octokit: github,
    repository: { githubInstallationId: "1", owner: "acme", repo: "app" },
    permit: permit(),
    capability: capability(payload),
    payloads: {
      async resolve() {
        return payload;
      },
    },
    botLogin: bot,
  });
}

function summaryPayload(revision: string, text: string): SummaryPayload {
  const marker = revisionMarker(revision);
  const rendered = body(revision, text);
  return {
    kind: ReviewV2PublicationPayloadKind.Summary,
    marker,
    markerHash: sha256(marker),
    body: rendered,
    bodyHash: sha256(rendered),
    bodyByteCount: Buffer.byteLength(rendered, "utf8"),
  };
}

function revisionMarker(revision: string): string {
  return `reviewrouter:summary:v2:${sha256(revision)}`;
}

function body(revision: string, text: string): string {
  return `${text}\n\n<!-- ${revisionMarker(revision)} -->`;
}

function permit() {
  return {
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "identity-1",
    pullRequestNumber: 42,
    executionId: "execution-1",
    generation: 1n,
    authorizationId: "authorization-1",
    producerReleaseId: "release-1",
    reviewedHeadSha: "a".repeat(64),
    reviewRevisionHash: "b".repeat(64),
    projectionHash: "c".repeat(64),
    lifecycleStateHash: "d".repeat(64),
    commandLedgerWatermark: 2n,
    permitEpoch: 3n,
    publicationSafetyDecisionHash: "e".repeat(64),
    publicationNotAfter: new Date("2026-07-23T12:05:00.000Z"),
  };
}

function operation(payload: SummaryPayload) {
  return {
    publicationAttemptId: "publication-1",
    publicationOperationId: "operation-1",
    publicationKind: ReviewPublicationKind.Summary,
    chunkIndex: 0,
    effectStrategy: ReviewPublicationEffectStrategy.MutableSingleton,
    role: ReviewPublicationOperationRole.Standalone,
    markerHash: payload.markerHash,
    bodyHash: payload.bodyHash,
    renderPolicyVersion: 1,
    targetCommitId: "a".repeat(64),
    reviewRevisionHash: "b".repeat(64),
    required: true,
    dependsOnOperationId: null,
    reconcileUntil: new Date("2026-07-23T12:30:00.000Z"),
    state: ReviewPublicationOperationState.InFlight,
  };
}

function capability(payload: SummaryPayload) {
  return {
    capabilityId: "operation-capability-1",
    capabilitySigningKeyId: "key-1",
    publicationAttemptId: "publication-1",
    publicationOperationId: "operation-1",
    operationAttemptId: "operation-attempt-1",
    effectReportId: "effect-report-1",
    claimId: "claim-1",
    claimFencingToken: 1n,
    reviewRevisionHash: "b".repeat(64),
    mutationEpoch: 3n,
    publicationSafetyDecisionHash: "e".repeat(64),
    bodyHash: payload.bodyHash,
    targetCommitId: "a".repeat(64),
    targetExternalObjectId: null,
    effectReportUntil: new Date("2026-07-23T12:30:00.000Z"),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
