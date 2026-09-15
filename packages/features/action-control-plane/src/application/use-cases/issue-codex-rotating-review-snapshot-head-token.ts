import type { Clock } from "@reviewrouter/shared";
import { codexRotatingReviewSnapshotAccessTtlMs } from "../../domain/codex-rotating-oauth-posting-window.js";
import type {
  CodexRotatingGitHubCheckoutTokenIssuerPort,
  CodexRotatingOAuthRepositoryPort,
} from "../ports/codex-rotating-oauth-repository-port.js";

export type IssueCodexRotatingReviewSnapshotHeadTokenDependencies = {
  readonly codexRotatingOAuth: CodexRotatingOAuthRepositoryPort;
  readonly codexRotatingCheckoutTokens: CodexRotatingGitHubCheckoutTokenIssuerPort;
  readonly clock: Clock;
};

export async function issueCodexRotatingReviewSnapshotHeadToken(
  input: {
    readonly leaseId: string;
    readonly providerInstanceId: string;
  },
  dependencies: IssueCodexRotatingReviewSnapshotHeadTokenDependencies,
): Promise<{
  readonly protocolVersion: 1;
  readonly token: string;
  readonly expiresAt: string;
  readonly repository: string;
  readonly permissions: {
    readonly contents: "read";
    readonly pullRequests: "read";
  };
}> {
  return dependencies.codexRotatingOAuth.withCompletedLeaseWriteTarget(
    {
      leaseId: input.leaseId,
      providerInstanceId: input.providerInstanceId,
      now: dependencies.clock.now(),
      completedLeaseTtlMs: codexRotatingReviewSnapshotAccessTtlMs,
    },
    async (writeTarget) => {
      const issued =
        await dependencies.codexRotatingCheckoutTokens.issueContentsReadToken(
          writeTarget,
        );
      return {
        protocolVersion: 1 as const,
        token: issued.token,
        expiresAt: issued.expiresAt.toISOString(),
        repository: writeTarget.repositoryFullName,
        permissions: issued.permissions,
      };
    },
  );
}
