import {
  assertCertifiedForkReviewBindingMatches,
  JoseGitHubActionsOidcTokenVerifier,
  parseCertifiedForkReviewModelOutput,
  parseCertifiedForkReviewPromptPacket,
  PrismaActionControlPlaneRepository,
  PrismaActionOidcReplayNonceStore,
  serializeCertifiedForkReviewPromptPacket,
  assertCodexRotatingNewWorkAdmitted,
  normalizeApprovedRepositories,
} from "@reviewrouter/features-action-control-plane";
import {
  PrismaHostedAccountRepository,
  PrismaHostedPoolBindingRepository,
  PrismaHostedPoolRepository,
  isHostedAccountHealthy,
  repositoryId,
  workspaceId,
} from "@reviewrouter/features-hosted-account-pool";
import { requestDirectForkReview } from "@reviewrouter/features-codex-oauth-rotating";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { PostgresLeaseLock } from "@reviewrouter/platform-locks";
import { SystemClock } from "@reviewrouter/shared";
import {
  createProductionHostedCodexSessionRuntime,
  readHostedCodexFeatureFlags,
} from "./hosted-codex-relay-composition.js";
import { type CertifiedForkLiveReviewDependencies } from "./certified-fork-live-review-routes.js";
import { OctokitCertifiedForkCommentPublisher } from "./github/octokit-certified-fork-comment-publisher.js";
import { OctokitCertifiedForkReviewGateway } from "./github/octokit-certified-fork-review-gateway.js";
import { OctokitCertifiedForkWorkflowRunResolver } from "./github/octokit-certified-fork-workflow-run-resolver.js";

export function composeProductionCertifiedForkLiveReview(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly githubAppId: string;
  readonly githubAppPrivateKey: string;
  readonly githubAppSlug: string;
}): CertifiedForkLiveReviewDependencies {
  const flags = readHostedCodexFeatureFlags(input.env);
  const enabled =
    flags.custody &&
    input.env.REVIEW_ROUTER_CODEX_ROTATING_NEW_WORK_ADMISSION_ENABLED === "1";
  if (!enabled) {
    return { enabled: false } as CertifiedForkLiveReviewDependencies;
  }
  const bindings = new PrismaHostedPoolBindingRepository(input.prisma);
  const pools = new PrismaHostedPoolRepository(input.prisma);
  const accounts = new PrismaHostedAccountRepository(input.prisma);
  const clock = new SystemClock();
  const lock = new PostgresLeaseLock(input.prisma);
  return {
    enabled: true,
    oidcVerifier: new JoseGitHubActionsOidcTokenVerifier(),
    replayNonces: new PrismaActionOidcReplayNonceStore(input.prisma),
    repositories: new PrismaActionControlPlaneRepository(input.prisma),
    admission: {
      assertAdmitted({ repositoryFullName }) {
        assertCodexRotatingNewWorkAdmitted({
          enabledValue:
            input.env.REVIEW_ROUTER_CODEX_ROTATING_NEW_WORK_ADMISSION_ENABLED,
          approvedRepositories: normalizeApprovedRepositories(
            parseCommaSeparated(
              input.env.REVIEW_ROUTER_CODEX_ROTATING_OAUTH_REPOSITORIES,
            ),
          ),
          repositoryFullName,
        });
      },
    },
    workflowRuns: new OctokitCertifiedForkWorkflowRunResolver({
      appId: input.githubAppId,
      privateKey: input.githubAppPrivateKey,
    }),
    gateway: new OctokitCertifiedForkReviewGateway({
      appId: input.githubAppId,
      privateKey: input.githubAppPrivateKey,
    }),
    reviewLock: lock,
    hostedAccounts: {
      async resolve({
        repositoryId: rawRepositoryId,
        workspaceId: rawWorkspaceId,
        now,
      }) {
        const binding = await bindings.findByRepositoryId(
          repositoryId(rawRepositoryId),
        );
        if (
          !binding ||
          binding.workspaceId !== workspaceId(rawWorkspaceId) ||
          binding.status !== "active"
        ) {
          throw new Error("repository_not_bound_to_hosted_pool");
        }
        const pool = await pools.findById(binding.poolId);
        if (
          !pool ||
          pool.workspaceId !== binding.workspaceId ||
          pool.status !== "active"
        ) {
          throw new Error("hosted_pool_not_active");
        }
        const account = (await accounts.listByPoolId(pool.id)).find(
          (candidate) => isHostedAccountHealthy(candidate, now),
        );
        if (!account) throw new Error("hosted_pool_has_no_healthy_account");
        return account.id;
      },
    },
    sessions: createProductionHostedCodexSessionRuntime({
      prisma: input.prisma,
      env: input.env,
    }),
    model: {
      request(request) {
        return requestDirectForkReview({
          ...request,
          fetchImpl: fetch,
          codec: {
            parsePromptPacket: parseCertifiedForkReviewPromptPacket,
            serializePromptPacket: serializeCertifiedForkReviewPromptPacket,
            assertBindingMatches: assertCertifiedForkReviewBindingMatches,
            parseModelOutput: parseCertifiedForkReviewModelOutput,
          },
        });
      },
    },
    publisher: new OctokitCertifiedForkCommentPublisher({
      appId: input.githubAppId,
      privateKey: input.githubAppPrivateKey,
      appSlug: input.githubAppSlug,
      lock,
    }),
    clock,
  };
}

function parseCommaSeparated(value: string | undefined): readonly string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
