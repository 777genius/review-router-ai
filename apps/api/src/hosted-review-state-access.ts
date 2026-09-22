import type {
  CodexRotatingReviewExecutionCheckpointAccessPort,
  CodexRotatingReviewSnapshotAccessPort,
  CodexRotatingReviewSnapshotScope,
} from "@reviewrouter/features-action-control-plane";
import { canonicalHostedPoolProviderInstanceId } from "@reviewrouter/features-workflow-provisioning";
import type { PrismaClient } from "@reviewrouter/platform-db";

type ReviewStateAccessPort = CodexRotatingReviewSnapshotAccessPort &
  CodexRotatingReviewExecutionCheckpointAccessPort;

type ReviewStateAccessInput = Readonly<{
  leaseId: string;
  providerInstanceId: string;
  pullRequestNumber: number;
  now: Date;
}>;

type HostedReviewStateAuthority = Readonly<{
  status: string;
  revokedAt: Date | null;
  expiresAt: Date;
  workspaceId: string;
  poolId: string;
  repositoryConnectionId: string;
  repositoryBindingId: string;
  reviewRequestId: string;
  runId: string;
  runAttempt: number;
  bindingRevision: bigint;
  authzEpoch: bigint;
  runtimeAuthzEpoch: bigint | null;
  binding: Readonly<{
    id: string;
    workspaceId: string;
    poolId: string;
    repositoryConnectionId: string;
    status: string;
    revision: bigint;
    attestedGithubRepositoryId: bigint | null;
    attestedBindingRevision: bigint | null;
    pool: Readonly<{ status: string; authzEpoch: bigint }>;
    repository: Readonly<{
      id: string;
      workspaceId: string;
      provider: string;
      githubRepositoryId: bigint | null;
      selected: boolean;
      archived: boolean;
      visibility: string;
      installation: Readonly<{ status: string }> | null;
    }>;
  }>;
}>;

type HostedReviewIntentAuthority = Readonly<{
  requestId: string;
  workspaceId: string;
  repositoryConnectionId: string;
  pullRequestNumber: number;
  sourceRunId: string | null;
  sourceRunAttempt: string | null;
  admissionState: string;
  state: string;
}>;

type HostedRuntimeGateAuthority = Readonly<{
  status: string;
  authzEpoch: bigint;
}>;

export class CompositeReviewStateAccess implements ReviewStateAccessPort {
  constructor(
    private readonly legacy: ReviewStateAccessPort,
    private readonly hosted: ReviewStateAccessPort,
  ) {}

  withAuthorizedReviewSnapshotAccess<T>(
    input: ReviewStateAccessInput,
    effect: (scope: CodexRotatingReviewSnapshotScope) => Promise<T>,
  ): Promise<T> {
    return this.accessFor(input).withAuthorizedReviewSnapshotAccess(
      input,
      effect,
    );
  }

  withAuthorizedReviewExecutionCheckpointAccess<T>(
    input: ReviewStateAccessInput,
    effect: (scope: CodexRotatingReviewSnapshotScope) => Promise<T>,
  ): Promise<T> {
    return this.accessFor(input).withAuthorizedReviewExecutionCheckpointAccess(
      input,
      effect,
    );
  }

  private accessFor(input: ReviewStateAccessInput): ReviewStateAccessPort {
    return input.providerInstanceId.startsWith("hosted-pool:")
      ? this.hosted
      : this.legacy;
  }
}

export class PrismaHostedReviewStateAccess implements ReviewStateAccessPort {
  constructor(private readonly prisma: PrismaClient) {}

  withAuthorizedReviewSnapshotAccess<T>(
    input: ReviewStateAccessInput,
    effect: (scope: CodexRotatingReviewSnapshotScope) => Promise<T>,
  ): Promise<T> {
    return this.withAuthorizedAccess(input, effect);
  }

  withAuthorizedReviewExecutionCheckpointAccess<T>(
    input: ReviewStateAccessInput,
    effect: (scope: CodexRotatingReviewSnapshotScope) => Promise<T>,
  ): Promise<T> {
    return this.withAuthorizedAccess(input, effect);
  }

  private withAuthorizedAccess<T>(
    input: ReviewStateAccessInput,
    effect: (scope: CodexRotatingReviewSnapshotScope) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (transaction) => {
        const grant = await transaction.hostedCodexInvocationGrant.findUnique({
          where: { id: input.leaseId },
          select: {
            status: true,
            revokedAt: true,
            expiresAt: true,
            workspaceId: true,
            poolId: true,
            repositoryConnectionId: true,
            repositoryBindingId: true,
            reviewRequestId: true,
            runId: true,
            runAttempt: true,
            bindingRevision: true,
            authzEpoch: true,
            runtimeAuthzEpoch: true,
            binding: {
              select: {
                id: true,
                workspaceId: true,
                poolId: true,
                repositoryConnectionId: true,
                status: true,
                revision: true,
                attestedGithubRepositoryId: true,
                attestedBindingRevision: true,
                pool: { select: { status: true, authzEpoch: true } },
                repository: {
                  select: {
                    id: true,
                    workspaceId: true,
                    provider: true,
                    githubRepositoryId: true,
                    selected: true,
                    archived: true,
                    visibility: true,
                    installation: { select: { status: true } },
                  },
                },
              },
            },
          },
        });
        if (!grant) throw new Error("hosted_review_state_grant_invalid");
        const runtimeGate = await transaction.hostedCodexRuntimeGate.findUnique(
          {
            where: { id: "global" },
            select: { status: true, authzEpoch: true },
          },
        );
        const reviewIntent = await transaction.reviewRequestedIntent.findUnique(
          {
            where: { requestId: grant.reviewRequestId },
            select: {
              requestId: true,
              workspaceId: true,
              repositoryConnectionId: true,
              pullRequestNumber: true,
              sourceRunId: true,
              sourceRunAttempt: true,
              admissionState: true,
              state: true,
            },
          },
        );
        return effect(
          authorizeHostedReviewStateScope({
            input,
            grant,
            runtimeGate,
            reviewIntent,
          }),
        );
      },
      { timeout: 30_000 },
    );
  }
}

export function authorizeHostedReviewStateScope(input: {
  readonly input: ReviewStateAccessInput;
  readonly grant: HostedReviewStateAuthority;
  readonly runtimeGate: HostedRuntimeGateAuthority | null;
  readonly reviewIntent: HostedReviewIntentAuthority | null;
}): CodexRotatingReviewSnapshotScope {
  const { grant, reviewIntent, runtimeGate } = input;
  const { binding } = grant;
  const { repository } = binding;
  const expectedProviderInstanceId =
    repository.githubRepositoryId === null
      ? null
      : canonicalHostedPoolProviderInstanceId(
          repository.githubRepositoryId.toString(),
        );
  if (
    !["issued", "exhausted"].includes(grant.status) ||
    grant.revokedAt !== null ||
    grant.expiresAt <= input.input.now ||
    grant.runtimeAuthzEpoch === null ||
    !runtimeGate ||
    runtimeGate.status !== "active" ||
    runtimeGate.authzEpoch !== grant.runtimeAuthzEpoch ||
    binding.id !== grant.repositoryBindingId ||
    binding.workspaceId !== grant.workspaceId ||
    binding.poolId !== grant.poolId ||
    binding.repositoryConnectionId !== grant.repositoryConnectionId ||
    binding.status !== "active" ||
    binding.revision !== grant.bindingRevision ||
    binding.pool.status !== "active" ||
    binding.pool.authzEpoch !== grant.authzEpoch ||
    repository.id !== grant.repositoryConnectionId ||
    repository.workspaceId !== grant.workspaceId ||
    repository.provider !== "github" ||
    repository.githubRepositoryId === null ||
    !repository.selected ||
    repository.archived ||
    repository.installation?.status !== "active" ||
    !["public", "private", "internal"].includes(repository.visibility) ||
    binding.attestedGithubRepositoryId !== repository.githubRepositoryId ||
    binding.attestedBindingRevision !== binding.revision ||
    expectedProviderInstanceId !== input.input.providerInstanceId ||
    !reviewIntent ||
    reviewIntent.requestId !== grant.reviewRequestId ||
    reviewIntent.workspaceId !== grant.workspaceId ||
    reviewIntent.repositoryConnectionId !== grant.repositoryConnectionId ||
    reviewIntent.pullRequestNumber !== input.input.pullRequestNumber ||
    reviewIntent.sourceRunId !== grant.runId ||
    reviewIntent.sourceRunAttempt !== String(grant.runAttempt) ||
    reviewIntent.admissionState !== "admitted" ||
    !["awaiting_authorization", "dispatched"].includes(reviewIntent.state)
  ) {
    throw new Error("hosted_review_state_authority_mismatch");
  }
  return {
    workspaceId: grant.workspaceId,
    repositoryId: grant.repositoryConnectionId,
    sourceRunId: grant.runId,
    sourceRunAttempt: String(grant.runAttempt),
    pullRequestNumber: input.input.pullRequestNumber,
  };
}
