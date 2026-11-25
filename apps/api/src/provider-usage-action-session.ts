import { providerUsageConfiguredProvider } from "./provider-usage-provider.js";
import { createHash } from "node:crypto";
import { App } from "@octokit/app";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { ActionSessionUsageGrantPort } from "@reviewrouter/features-action-control-plane";
import { readCanonicalWorkflowDocument } from "@reviewrouter/features-codex-oauth-rotating";
import { canonicalJson } from "@reviewrouter/features-provider-usage";
import type {
  ProviderUsageApi,
  TrustedActionSessionUsagePrincipal,
} from "./provider-usage-routes.js";

type Requester = {
  request(
    route: string,
    parameters: Record<string, unknown>,
  ): Promise<{ data: unknown }>;
};
type InstallationApp = {
  getInstallationOctokit(id: number): Promise<Requester>;
};
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const hash = (v: unknown) =>
  createHash("sha256").update(canonicalJson(v)).digest("hex");
const deny = (): never => {
  throw new Error("usage_action_session_proof_denied");
};

/** Adds report authority to an already admitted session; never re-runs Codex admission. */
export function createProviderUsageActionSessionIssuer(input: {
  prisma: PrismaClient;
  api: Pick<ProviderUsageApi, "issueTrustedActionSessionGrant">;
  app?: InstallationApp;
  appId?: string;
  privateKey?: string;
}): ActionSessionUsageGrantPort {
  const app: InstallationApp =
    input.app ??
    new App({ appId: input.appId!, privateKey: input.privateKey! });
  return {
    async issue(principal) {
      const { claims, repository, session } = principal;
      if (
        claims.repository_id !== repository.githubRepositoryId ||
        claims.repository !== repository.fullName ||
        session.workspaceId !== repository.workspaceId ||
        session.repositoryId !== repository.repositoryId ||
        session.githubRunId !== claims.run_id ||
        session.githubRunAttempt !== claims.run_attempt ||
        !repository.selected ||
        repository.installationStatus !== "active" ||
        principal.expiresAt <= new Date()
      )
        return deny();
      for (const id of [
        claims.run_id,
        claims.run_attempt,
        repository.githubRepositoryId,
        repository.githubInstallationId,
      ])
        if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
          return deny();
      // Only the explicit immutable Secrets profile can attest this producer.
      // Existing mutable legacy workflows keep their execution behavior.
      const job =
        /^777genius\/review-router\/(\.github\/workflows\/reviewrouter-secrets-runtime\.yml)@([a-f0-9]{40})$/.exec(
          claims.job_workflow_ref ?? "",
        );
      if (!job) return deny();
      const jobSha =
        claims.job_workflow_sha ??
        (/^[a-f0-9]{40}$/.test(job[2]!) ? job[2] : undefined);
      if (
        !jobSha ||
        !/^[a-f0-9]{40}$/.test(jobSha) ||
        (/^[a-f0-9]{40}$/.test(job[2]!) && job[2] !== jobSha) ||
        !claims.jti ||
        !claims.workflow_sha
      )
        return deny();
      const approvedJob = await input.prisma.producerRelease.count({
        where: {
          actionCommitSha: jobSha,
          state: "registered",
          revokedAt: null,
        },
      });
      if (!approvedJob) return deny();
      const client = await app.getInstallationOctokit(
        Number(repository.githubInstallationId),
      );
      const [owner, repo] = repository.fullName.split("/");
      const request = (route: string, parameters: Record<string, unknown>) =>
        client.request(route, { ...parameters, request: { timeout: 15000 } });
      const { data: run } = await request(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
        {
          owner,
          repo,
          run_id: Number(claims.run_id),
          attempt_number: Number(claims.run_attempt),
        },
      );
      if (
        !record(run) ||
        !record(run.repository) ||
        String(run.id) !== claims.run_id ||
        String(run.repository.id) !== repository.githubRepositoryId ||
        String(run.run_attempt) !== claims.run_attempt ||
        run.path !== session.workflowPath ||
        run.event !== claims.event_name
      )
        return deny();
      const { data: source } = await request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: "777genius",
          repo: "review-router",
          path: job[1],
          ref: jobSha,
        },
      );
      if (
        !record(source) ||
        source.type !== "file" ||
        source.encoding !== "base64" ||
        typeof source.content !== "string" ||
        source.content.length > 180000
      )
        return deny();
      const document = readCanonicalWorkflowDocument(
        Buffer.from(source.content, "base64").toString("utf8"),
      );
      if (!record(document) || !record(document.jobs)) return deny();
      if (!immutableOidcSelfCheckout(document)) return deny();
      const actionSha = jobSha;
      const releases = await input.prisma.producerRelease.findMany({
        where: {
          actionCommitSha: actionSha,
          state: "registered",
          revokedAt: null,
        },
        select: { runtimeEntrypointDigest: true },
      });
      const digests = new Set(releases.map((r) => r.runtimeEntrypointDigest));
      if (digests.size !== 1 || !/^[a-f0-9]{64}$/.test([...digests][0]!))
        return deny();
      let actorId: string | null = null;
      if (
        record(run.actor) &&
        typeof run.actor.id === "number" &&
        Number.isSafeInteger(run.actor.id) &&
        run.actor.id > 0
      ) {
        const actor = await input.prisma.user.findUnique({
          where: { githubUserId: BigInt(run.actor.id) },
          select: { id: true },
        });
        actorId = actor?.id ?? null;
      }
      const sessionId = hash({
        session,
        issuedAt: principal.issuedAt.toISOString(),
        jti: claims.jti,
      });
      const workflowIdentity = hash({
        workflowRef: claims.workflow_ref,
        workflowSha: claims.workflow_sha,
      });
      const jobIdentity = hash({
        jobWorkflowRef: claims.job_workflow_ref,
        jobWorkflowSha: jobSha,
        actionSha,
        jti: claims.jti,
      });
      const grants = [];
      if (principal.configuration.config.providers.length > 16) return deny();
      for (const [
        index,
        lane,
      ] of principal.configuration.config.providers.entries()) {
        if (
          lane.authMode === "codex_account_gateway" ||
          lane.authMode === "codex_subscription_oauth_hosted_pool"
        )
          continue;
        const { provider, requestedModel } =
          providerUsageConfiguredProvider(lane);
        const trusted: TrustedActionSessionUsagePrincipal = {
          workspaceId: repository.workspaceId,
          repositoryId: repository.githubRepositoryId,
          runId: claims.run_id,
          runAttempt: Number(claims.run_attempt),
          authorizationId: `action-session-${sessionId}`,
          invocationId: `${sessionId}-provider-${index}`,
          actorId,
          bindingId: null,
          producerDigest: [...digests][0]!,
          workflowIdentity,
          jobIdentity,
          provider,
          requestedModel,
          runtimeType: lane.kind === "claude" ? "claude" : "codex",
          purpose: "review",
          deadline: principal.expiresAt,
          githubInstallationId: repository.githubInstallationId,
          repositoryFullName: repository.fullName,
        };
        grants.push(
          await input.api.issueTrustedActionSessionGrant(
            trusted,
            principal.publicKey,
          ),
        );
      }
      return grants;
    },
  };
}

/** Qualifies the registered execution workflow's OIDC-only immutable self checkout.
 * Its full source commit must already exist in the approved producer registry. */
function immutableOidcSelfCheckout(document: Record<string, unknown>): boolean {
  if (
    !record(document.jobs) ||
    Object.keys(document.jobs).length !== 1 ||
    !record(document.jobs.review)
  )
    return false;
  const review = document.jobs.review;
  if (
    !record(review.env) ||
    review.env.REVIEWROUTER_RUNTIME_CONFIG_MODE !== "oidc" ||
    review.env.REVIEWROUTER_STATIC_CONFIG_FALLBACK !== "false" ||
    !Array.isArray(review.steps)
  )
    return false;
  const checkout = review.steps.some(
    (step) =>
      record(step) &&
      typeof step.uses === "string" &&
      /^actions\/checkout@[a-f0-9]{40}$/.test(step.uses) &&
      record(step.with) &&
      step.with.repository === "777genius/review-router" &&
      step.with.ref === "${{ job.workflow_sha }}" &&
      step.with.path === ".reviewrouter-runtime" &&
      step.with["persist-credentials"] === false,
  );
  const reviewStep = review.steps.some(
    (step) =>
      record(step) &&
      step.run === "node .reviewrouter-runtime/dist/index.js" &&
      record(step.env) &&
      step.env.REVIEW_ROUTER_MODE === "review",
  );
  return checkout && reviewStep;
}
