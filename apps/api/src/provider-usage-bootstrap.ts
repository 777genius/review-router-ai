import { createHash } from "node:crypto";
import { App } from "@octokit/app";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { BootstrapUsageGrantPort } from "@reviewrouter/features-action-control-plane";
import { canonicalJson } from "@reviewrouter/features-provider-usage";
import type {
  ProviderUsageApi,
  TrustedBootstrapUsagePrincipal,
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
const digest = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const denied = (): never => {
  throw new Error("usage_bootstrap_scope_denied");
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Server composition adapter; its principal is never accepted from an HTTP body. */
export function createProviderUsageBootstrapIssuer(input: {
  prisma: PrismaClient;
  api: Pick<ProviderUsageApi, "issueTrustedBootstrapGrant">;
  app?: InstallationApp;
  appId?: string;
  privateKey?: string;
}): BootstrapUsageGrantPort {
  const app: InstallationApp =
    input.app ??
    new App({ appId: input.appId!, privateKey: input.privateKey! });
  return {
    async issue(principal) {
      const { claims, repository } = principal;
      const match = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@([a-f0-9]{40})$/.exec(
        principal.actionRef,
      );
      if (
        !match ||
        claims.repository_id !== repository.githubRepositoryId ||
        claims.repository !== repository.fullName ||
        !repository.selected ||
        repository.installationStatus !== "active" ||
        !claims.workflow_ref.includes(`/${principal.workflowPath}@`)
      )
        return denied();
      for (const value of [
        claims.run_id,
        claims.run_attempt,
        repository.githubRepositoryId,
        repository.githubInstallationId,
      ])
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
          return denied();
      const now = new Date();
      if (principal.leaseExpiresAt <= now || claims.exp * 1000 <= now.getTime())
        return denied();
      const lease = await input.prisma.codexOAuthLease.findUnique({
        where: { id: principal.leaseId },
      });
      if (
        !lease ||
        lease.workspaceId !== repository.workspaceId ||
        lease.repositoryId !== repository.repositoryId ||
        lease.githubRunId !== claims.run_id ||
        lease.githubRunAttempt !== claims.run_attempt ||
        lease.status !== "preleased" ||
        lease.expiresAt <= now
      )
        return denied();
      const releases = await input.prisma.producerRelease.findMany({
        where: {
          actionCommitSha: match[1]!,
          state: "registered",
          revokedAt: null,
        },
        select: { wrapperEntrypointDigest: true },
      });
      const digests = new Set(
        releases
          .map((release) => release.wrapperEntrypointDigest)
          .filter(
            (value): value is string =>
              typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
          ),
      );
      // The wrapper performs this inference: a runtime digest cannot attest its bytes.
      if (digests.size !== 1) return denied();
      const client = await app.getInstallationOctokit(
        Number(repository.githubInstallationId),
      );
      const [owner, repo] = repository.fullName.split("/");
      const { data: run } = await client.request(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
        {
          owner,
          repo,
          run_id: Number(claims.run_id),
          attempt_number: Number(claims.run_attempt),
          request: { timeout: 15000 },
        },
      );
      if (
        !record(run) ||
        !record(run.repository) ||
        String(run.id) !== claims.run_id ||
        String(run.repository.id) !== repository.githubRepositoryId ||
        String(run.run_attempt) !== claims.run_attempt ||
        run.path !== principal.workflowPath ||
        run.event !== claims.event_name
      )
        return denied();
      const actor = record(run.actor) ? run.actor : null;
      let actorId: string | null = null;
      if (
        actor &&
        typeof actor.id === "number" &&
        Number.isSafeInteger(actor.id) &&
        actor.id > 0
      ) {
        const user = await input.prisma.user.findUnique({
          where: { githubUserId: BigInt(actor.id) },
          select: { id: true },
        });
        actorId = user?.id ?? null;
      }
      const trusted: TrustedBootstrapUsagePrincipal = {
        workspaceId: repository.workspaceId,
        repositoryId: repository.githubRepositoryId,
        runId: claims.run_id,
        runAttempt: Number(claims.run_attempt),
        authorizationId: `bootstrap-${lease.id}`,
        invocationId: `${lease.id}-bootstrap`,
        actorId,
        bindingId: null,
        producerDigest: [...digests][0]!,
        workflowIdentity: digest({
          workflowRef: claims.workflow_ref,
          workflowSha: claims.workflow_sha,
          actionRef: principal.actionRef,
        }),
        jobIdentity: digest({
          jobWorkflowRef: claims.job_workflow_ref ?? null,
          jobWorkflowSha: claims.job_workflow_sha ?? null,
          subject: claims.sub ?? null,
          jti: claims.jti,
        }),
        provider: "codex",
        requestedModel: null,
        runtimeType: "codex-refresh-bootstrap",
        purpose: "diagnostic",
        deadline: new Date(
          Math.min(
            lease.expiresAt.getTime(),
            principal.leaseExpiresAt.getTime(),
          ),
        ),
        githubInstallationId: repository.githubInstallationId,
        repositoryFullName: repository.fullName,
        bootstrapLeaseId: lease.id,
      };
      return input.api.issueTrustedBootstrapGrant(trusted, principal.publicKey);
    },
  };
}
