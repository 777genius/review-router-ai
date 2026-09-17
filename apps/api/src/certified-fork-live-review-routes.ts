import type { FastifyInstance, FastifyReply } from "fastify";
import {
  assertCertifiedForkReviewBindingMatches,
  defaultActionOidcAudience,
  parseCertifiedForkReviewBinding,
  parseCertifiedForkReviewPromptPacket,
  prepareCurrentCertifiedForkReview,
  readExactRecord,
  type ActionControlPlaneRepositoryPort,
  type ActionOidcReplayNonceStorePort,
  type CertifiedForkReviewBinding,
  type CertifiedForkReviewGatewayPort,
  type CertifiedForkReviewModelOutput,
  type GitHubActionsOidcTokenVerifierPort,
} from "@reviewrouter/features-action-control-plane";
import { codexRotatingOidcClaimsSchema } from "@reviewrouter/features-codex-oauth-rotating";
import type { Clock } from "@reviewrouter/shared";
import type { OctokitCertifiedForkCommentPublisher } from "./github/octokit-certified-fork-comment-publisher.js";

export const certifiedForkLiveReviewPath =
  "/api/action/v1/certified-fork/review";
export const certifiedForkWorkflowPath =
  ".github/workflows/reviewrouter-fork.yml";

const heartbeatIntervalMs = 2_000;
const maxCommentBytes = 60_000;

export interface CertifiedForkLiveReviewDependencies {
  readonly enabled: boolean;
  readonly oidcVerifier: GitHubActionsOidcTokenVerifierPort;
  readonly replayNonces: ActionOidcReplayNonceStorePort;
  readonly repositories: Pick<
    ActionControlPlaneRepositoryPort,
    "findSelectedRepositoryByGithubId"
  >;
  readonly admission: {
    assertAdmitted(input: { readonly repositoryFullName: string }): void;
  };
  readonly workflowRuns: {
    resolveWorkflowRunPullRequest(input: {
      readonly repository: {
        readonly githubInstallationId: string;
        readonly githubRepositoryId: string;
        readonly fullName: string;
        readonly owner: string;
      };
      readonly githubRunId: string;
      readonly githubRunAttempt: string;
      readonly eventName: "pull_request_target";
      readonly expectedPullRequestNumber: number;
    }): Promise<number>;
  };
  readonly gateway: CertifiedForkReviewGatewayPort;
  readonly hostedAccounts: {
    resolve(input: {
      readonly repositoryId: string;
      readonly workspaceId: string;
      readonly now: Date;
    }): Promise<string>;
  };
  readonly sessions: {
    ensureFreshSession(input: {
      readonly accountId: string;
      readonly runId: string;
      readonly attempt: number;
      readonly abortSignal: AbortSignal;
    }): Promise<{
      readonly accessToken: string;
      readonly chatgptAccountId: string;
      readonly credentialGeneration: number;
    }>;
  };
  readonly model: {
    request(input: {
      readonly accessToken: string;
      readonly chatgptAccountId: string;
      readonly promptPacket: unknown;
      readonly signal: AbortSignal;
    }): Promise<CertifiedForkReviewModelOutput>;
  };
  readonly publisher: Pick<OctokitCertifiedForkCommentPublisher, "upsert">;
  readonly clock: Clock;
}

export type CertifiedForkLiveReviewResult = Readonly<{
  status: "published";
  commentId: string;
  contextHash: string;
  binding: CertifiedForkReviewBinding;
}>;

export async function executeCertifiedForkLiveReview(
  input: unknown,
  dependencies: CertifiedForkLiveReviewDependencies,
  abortSignal: AbortSignal,
): Promise<CertifiedForkLiveReviewResult> {
  if (!dependencies.enabled) {
    throw new Error("certified_fork_live_review_disabled");
  }
  const request = readExactRecord(
    input,
    ["oidcToken", "binding"],
    "certified_fork_live_review_input_invalid",
  );
  if (
    typeof request.oidcToken !== "string" ||
    request.oidcToken.length < 1 ||
    request.oidcToken.length > 16_384
  ) {
    throw new Error("certified_fork_live_review_token_invalid");
  }
  const binding = parseCertifiedForkReviewBinding(request.binding);
  const claims = codexRotatingOidcClaimsSchema.parse(
    await dependencies.oidcVerifier.verify({
      token: request.oidcToken,
      audience: defaultActionOidcAudience,
    }),
  );
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (!audiences.includes(defaultActionOidcAudience)) {
    throw new Error("oidc_audience_mismatch");
  }
  if (
    claims.event_name !== "pull_request_target" ||
    claims.repository_visibility !== "public"
  ) {
    throw new Error("certified_fork_event_invalid");
  }
  if (
    claims.repository !== binding.baseRepository ||
    claims.repository_id !== binding.baseRepositoryId
  ) {
    throw new Error("certified_fork_oidc_repository_mismatch");
  }
  if (
    !/^[1-9][0-9]*$/u.test(claims.run_id) ||
    !/^[1-9][0-9]*$/u.test(claims.run_attempt)
  ) {
    throw new Error("certified_fork_run_invalid");
  }
  const expectedWorkflowPrefix = `${binding.baseRepository}/${certifiedForkWorkflowPath}@refs/heads/`;
  if (
    !claims.workflow_ref.startsWith(expectedWorkflowPrefix) ||
    !claims.ref?.startsWith("refs/heads/")
  ) {
    throw new Error("certified_fork_workflow_mismatch");
  }

  const repositoryValue =
    await dependencies.repositories.findSelectedRepositoryByGithubId(
      claims.repository_id,
    );
  if (
    !repositoryValue ||
    !repositoryValue.selected ||
    repositoryValue.installationStatus !== "active"
  ) {
    throw new Error("repository_not_selected");
  }
  const repository = Object.freeze({ ...repositoryValue });
  if (
    repository.githubRepositoryId !== claims.repository_id ||
    repository.fullName !== claims.repository ||
    !/^[1-9][0-9]*$/u.test(repository.githubInstallationId)
  ) {
    throw new Error("certified_fork_repository_mismatch");
  }
  const admissionResult: unknown = dependencies.admission.assertAdmitted({
    repositoryFullName: repository.fullName,
  });
  if (admissionResult !== undefined) {
    void Promise.resolve(admissionResult).catch(() => {});
    throw new Error("certified_fork_admission_guard_invalid");
  }
  const pullRequestNumber =
    await dependencies.workflowRuns.resolveWorkflowRunPullRequest({
      repository,
      githubRunId: claims.run_id,
      githubRunAttempt: claims.run_attempt,
      eventName: "pull_request_target",
      expectedPullRequestNumber: binding.pullRequestNumber,
    });
  if (pullRequestNumber !== binding.pullRequestNumber) {
    throw new Error("certified_fork_run_pull_request_mismatch");
  }

  const currentInput = Object.freeze({
    githubInstallationId: repository.githubInstallationId,
    binding,
  });
  await dependencies.gateway.assertBindingCurrent(currentInput);
  const prepared = await prepareCurrentCertifiedForkReview(currentInput, {
    gateway: dependencies.gateway,
  });
  const currentContext = readExactRecord(
    await dependencies.gateway.assertContextCurrent({
      ...currentInput,
      expectedContextHash: prepared.contextHash,
    }),
    ["promptPacket"],
    "certified_fork_review_context_invalid",
  );
  const packet = parseCertifiedForkReviewPromptPacket(
    currentContext.promptPacket,
  );
  assertCertifiedForkReviewBindingMatches(prepared.binding, packet.binding);
  if (prepared.contextHash !== packet.contextHash) {
    throw new Error("certified_fork_review_context_hash_mismatch");
  }

  const now = dependencies.clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("certified_fork_clock_invalid");
  }
  if (
    claims.iat > now.getTime() / 1000 ||
    claims.nbf > now.getTime() / 1000 ||
    claims.exp <= now.getTime() / 1000
  ) {
    throw new Error("certified_fork_oidc_time_invalid");
  }
  const accountId = await dependencies.hostedAccounts.resolve({
    repositoryId: repository.repositoryId,
    workspaceId: repository.workspaceId,
    now,
  });
  if (
    !(await dependencies.replayNonces.tryConsumeNonce({
      key: `${claims.iss}:${claims.jti}`,
      expiresAt: new Date(claims.exp * 1000),
      now,
    }))
  ) {
    throw new Error("oidc_replay_detected");
  }

  const session = await dependencies.sessions.ensureFreshSession({
    accountId,
    runId: claims.run_id,
    attempt: Number(claims.run_attempt),
    abortSignal,
  });
  const output = await dependencies.model.request({
    accessToken: session.accessToken,
    chatgptAccountId: session.chatgptAccountId,
    promptPacket: packet,
    signal: abortSignal,
  });

  // A model call can outlive the head that produced its packet.
  await dependencies.gateway.assertContextCurrent({
    ...currentInput,
    expectedContextHash: packet.contextHash,
  });
  const marker = certifiedForkCommentMarker(binding, packet.contextHash);
  const publication = await dependencies.publisher.upsert({
    githubInstallationId: repository.githubInstallationId,
    repositoryFullName: repository.fullName,
    baseRepositoryId: binding.baseRepositoryId,
    sourceRepositoryId: binding.sourceRepositoryId,
    pullRequestNumber: binding.pullRequestNumber,
    baseSha: binding.baseSha,
    reviewHeadSha: binding.reviewHeadSha,
    marker,
    body: certifiedForkCommentBody(marker, output),
  });
  return Object.freeze({
    status: "published",
    commentId: publication.commentId,
    contextHash: packet.contextHash,
    binding,
  });
}

export async function registerCertifiedForkLiveReviewRoutes(
  app: FastifyInstance,
  dependencies: CertifiedForkLiveReviewDependencies,
): Promise<void> {
  if (!dependencies.enabled) return;
  app.post(certifiedForkLiveReviewPath, async (request, reply) => {
    const controller = new AbortController();
    const abort = () =>
      controller.abort(new Error("certified_fork_client_disconnected"));
    request.raw.once("aborted", abort);
    reply.raw.once("close", abort);
    startEventStream(reply);
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": heartbeat\n\n");
    }, heartbeatIntervalMs);
    heartbeat.unref();
    try {
      const result = await executeCertifiedForkLiveReview(
        request.body,
        dependencies,
        controller.signal,
      );
      writeEvent(reply, "result", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const code = /^[a-z0-9_:-]{1,160}$/u.test(message)
        ? message
        : "unclassified";
      console.log(`certified_fork_live_review_rejected code=${code}`);
      writeEvent(reply, "error", {
        error: "certified_fork_live_review_rejected",
      });
    } finally {
      clearInterval(heartbeat);
      request.raw.off("aborted", abort);
      reply.raw.off("close", abort);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
    return reply;
  });
}

export function certifiedForkCommentMarker(
  binding: CertifiedForkReviewBinding,
  contextHash: string,
): string {
  if (!/^[a-f0-9]{64}$/u.test(contextHash)) {
    throw new Error("certified_fork_comment_context_hash_invalid");
  }
  return `<!-- reviewrouter:certified-fork:v1 repository_id=${binding.baseRepositoryId} pr=${binding.pullRequestNumber} head_sha=${binding.reviewHeadSha} context_hash=${contextHash} -->`;
}

export function certifiedForkCommentBody(
  marker: string,
  output: CertifiedForkReviewModelOutput,
): string {
  const findings =
    output.findings.length === 0
      ? "\n\nNo concrete findings."
      : `\n\n## Findings\n${output.findings
          .map((finding) => {
            const location = finding.path
              ? ` — \`${finding.path}${finding.startLine ? `:${finding.startLine}` : ""}\``
              : "";
            return `\n### ${finding.severity.toUpperCase()}: ${finding.title}${location}\n${finding.body}`;
          })
          .join("\n")}`;
  return truncateUtf8(
    `${marker}\n${output.summaryMarkdown}${findings}`,
    maxCommentBytes,
  );
}

function startEventStream(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader("content-type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("cache-control", "no-store");
  reply.raw.setHeader("x-content-type-options", "nosniff");
  reply.raw.write(": accepted\n\n");
}

function writeEvent(
  reply: FastifyReply,
  event: "result" | "error",
  value: unknown,
): void {
  if (reply.raw.writableEnded) return;
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const suffix = "\n\n_Review truncated to fit the GitHub comment limit._";
  const budget = maxBytes - Buffer.byteLength(suffix, "utf8");
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > budget) break;
    result += character;
    bytes += size;
  }
  return `${result}${suffix}`;
}
