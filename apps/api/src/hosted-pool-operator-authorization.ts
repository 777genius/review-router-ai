import {
  HashedReviewConfigurationOperatorAuthorization,
  ReviewConfigurationOperatorOperation,
} from "@reviewrouter/features-review-config";
import type { PrismaClient } from "@reviewrouter/platform-db";

export type HostedPoolOperatorScope = Readonly<{
  operatorId: string;
  workspaceId: string;
  workspaceIds: readonly string[];
  ownerGitHubUserId: string;
}>;

function readAllowlistedWorkspaceIds(raw: string | undefined): string[] {
  const workspaceIds = (raw ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (new Set(workspaceIds).size !== workspaceIds.length) {
    throw new Error("hosted_pool_operator_scope_invalid");
  }
  return workspaceIds;
}

function withResolvedWorkspace(
  scope: HostedPoolOperatorScope,
  workspaceId: string,
): HostedPoolOperatorScope {
  return {
    operatorId: scope.operatorId,
    workspaceId,
    workspaceIds: scope.workspaceIds,
    ownerGitHubUserId: scope.ownerGitHubUserId,
  };
}

/** Trusted deployment configuration only. Request workspace is a constraint, not a grant. */
export function readHostedPoolOperatorScope(
  env: Readonly<Record<string, string | undefined>>,
): HostedPoolOperatorScope | null {
  if (env.REVIEW_ROUTER_HOSTED_POOL_OPERATOR_ENABLED !== "1") return null;
  const operatorId = "reviewrouter-operator";
  const workspaceIds = readAllowlistedWorkspaceIds(
    env.REVIEW_ROUTER_HOSTED_POOL_OPERATOR_WORKSPACE_ID,
  );
  const ownerGitHubUserId =
    env.REVIEW_ROUTER_HOSTED_POOL_OPERATOR_OWNER_GITHUB_USER_ID?.trim();
  if (
    workspaceIds.length === 0 ||
    !ownerGitHubUserId ||
    !/^[1-9]\d*$/.test(ownerGitHubUserId)
  ) {
    throw new Error("hosted_pool_operator_scope_invalid");
  }
  return {
    operatorId,
    workspaceId: workspaceIds[0]!,
    workspaceIds,
    ownerGitHubUserId,
  };
}

export function createHostedPoolOperatorAuthorization(input: {
  readonly scope: HostedPoolOperatorScope;
  readonly credentialSha256: string;
  readonly membership: {
    resolveAdminWorkspace(
      scope: HostedPoolOperatorScope,
      workspace: string,
    ): Promise<string | null>;
  };
}) {
  const authorization = new HashedReviewConfigurationOperatorAuthorization(
    input.scope.operatorId,
    input.credentialSha256,
  );
  return async (
    credential: string,
    workspace: string,
  ): Promise<HostedPoolOperatorScope> => {
    const principal = await authorization.authenticate({
      credential,
      operation: ReviewConfigurationOperatorOperation.Read,
    });
    if (!principal || principal.operatorId !== input.scope.operatorId)
      throw new Error("hosted_pool_operator_unauthorized");
    const resolved = await input.membership.resolveAdminWorkspace(
      input.scope,
      workspace,
    );
    if (!resolved || !input.scope.workspaceIds.includes(resolved))
      throw new Error("hosted_pool_operator_forbidden");
    return withResolvedWorkspace(input.scope, resolved);
  };
}

export function prismaHostedPoolOperatorMembership(prisma: PrismaClient) {
  const resolveAdminWorkspace = async (
    scope: HostedPoolOperatorScope,
    workspace: string,
  ): Promise<string | null> => {
    const requested = workspace.trim();
    if (!requested) return null;
    const membership = await prisma.workspaceMember.findFirst({
      where: {
        workspaceId: { in: [...scope.workspaceIds] },
        workspace: { OR: [{ id: requested }, { slug: requested }] },
        user: { githubUserId: BigInt(scope.ownerGitHubUserId) },
        role: { in: ["owner", "admin"] },
      },
      select: { workspaceId: true },
    });
    return membership?.workspaceId ?? null;
  };
  return {
    resolveAdminWorkspace,
    isCurrentAdmin: async (scope: HostedPoolOperatorScope, workspace: string) =>
      (await resolveAdminWorkspace(scope, workspace)) !== null,
  };
}
