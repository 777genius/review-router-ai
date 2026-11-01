import type { Prisma } from "@prisma/client";
import {
  assertInvocationGrantAuthorityMatches,
  hostedBindingId,
  type LegacyInvocationGrantAuthority,
} from "@reviewrouter/features-hosted-account-pool";
import {
  parseReviewConfigurationStrict,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  canonicalJson,
  parseReviewRunHostedSelection,
  type ReviewRunAuthorization,
  type ReviewRunHostedSelection,
} from "@reviewrouter/features-review-run-control";
import { canonicalHostedPoolProviderInstanceId } from "@reviewrouter/features-workflow-provisioning";
import { authorizeHostedReviewStateScope } from "./hosted-review-state-access";
import {
  assertHostedReviewIdentity,
  hostedGrantAuthorityIdentity,
  parseAttestation,
} from "./prisma-hosted-codex-grant-admission";

export type HostedReviewBindingReader = Pick<
  Prisma.TransactionClient,
  | "hostedCodexInvocationGrant"
  | "hostedCodexRuntimeGate"
  | "reviewRequestedIntent"
>;
type HostedReviewIdentity = Pick<
  ReviewRunAuthorization,
  | "workspaceId"
  | "repositoryConnectionId"
  | "scmRepositoryIdentityId"
  | "pullRequestNumber"
  | "baseSha"
  | "mergeBaseSha"
  | "headSha"
  | "reviewRevisionHash"
  | "sourceRunId"
  | "sourceRunAttempt"
>;
export type CaptureOriginalHostedReviewBindingInput = Readonly<{
  reader: HostedReviewBindingReader;
  identity: HostedReviewIdentity;
  configuration: ReviewConfiguration;
  configurationVersion: number;
  now: Date;
}>;

const originalGrantSelect = {
  id: true,
  authorityKind: true,
  invocationId: true,
  workspaceId: true,
  repositoryConnectionId: true,
  poolId: true,
  repositoryBindingId: true,
  bindingRevision: true,
  reviewRequestId: true,
  providerInvocationKey: true,
  runId: true,
  runAttempt: true,
  model: true,
  policyVersion: true,
  policyFingerprint: true,
  runtimeConfigVersion: true,
  activeAccountId: true,
  authzEpoch: true,
  runtimeAuthzEpoch: true,
  status: true,
  revokedAt: true,
  expiresAt: true,
  account: {
    select: {
      id: true,
      workspaceId: true,
      poolId: true,
      state: true,
      cooldownUntil: true,
      activeGeneration: true,
    },
  },
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
      workflowPath: true,
      workflowActionRef: true,
      workflowSourceCommitSha: true,
      workflowSourceBlobSha: true,
      workflowSourceSha256: true,
      workflowSemanticSha256: true,
      workflowSourceTrust: true,
      pool: { select: { status: true, authzEpoch: true } },
      repository: {
        select: {
          id: true,
          workspaceId: true,
          provider: true,
          githubRepositoryId: true,
          scmRepositoryIdentityId: true,
          selected: true,
          archived: true,
          visibility: true,
          installation: { select: { status: true } },
        },
      },
    },
  },
} as const satisfies Prisma.HostedCodexInvocationGrantSelect;

/** Read an already-issued original grant. Ambiguous or changed authority never
 * creates another grant, chooses another account, or extends its lifetime. */
export async function captureOriginalHostedReviewBinding(
  input: CaptureOriginalHostedReviewBindingInput,
): Promise<ReviewRunHostedSelection | null> {
  return readOriginalHostedReviewBinding(input, "fresh_work");
}

async function readOriginalHostedReviewBinding(
  input: CaptureOriginalHostedReviewBindingInput,
  purpose: "fresh_work" | "completion",
): Promise<ReviewRunHostedSelection | null> {
  try {
    const { identity, reader, now } = input;
    const runAttempt = Number(identity.sourceRunAttempt);
    if (
      !Number.isSafeInteger(runAttempt) ||
      runAttempt < 1 ||
      String(runAttempt) !== identity.sourceRunAttempt ||
      !Number.isFinite(now.getTime())
    )
      return null;
    assertHostedReviewIdentity(identity);
    const config = parseReviewConfigurationStrict(input.configuration);
    const provider = config.providers[0];
    if (
      config.providers.length !== 1 ||
      !provider ||
      provider.kind !== "codex" ||
      provider.authMode !== "codex_subscription_oauth_hosted_pool"
    )
      return null;
    const [grants, runtimeGate] = await Promise.all([
      reader.hostedCodexInvocationGrant.findMany({
        where: {
          workspaceId: identity.workspaceId,
          repositoryConnectionId: identity.repositoryConnectionId,
          runId: identity.sourceRunId,
          runAttempt,
          authorityKind: "v1_comment",
        },
        // There is deliberately no newest/healthy fallback across grants.
        take: 2,
        select: originalGrantSelect,
      }),
      reader.hostedCodexRuntimeGate.findUnique({
        where: { id: "global" },
        select: { status: true, authzEpoch: true },
      }),
    ]);
    if (grants.length !== 1) return null;
    const grant = grants[0]!;
    const reviewIntent = await reader.reviewRequestedIntent.findUnique({
      where: { requestId: grant.reviewRequestId },
      select: {
        requestId: true,
        workspaceId: true,
        repositoryConnectionId: true,
        scmRepositoryIdentityId: true,
        pullRequestNumber: true,
        baseSha: true,
        mergeBaseSha: true,
        headSha: true,
        reviewRevisionHash: true,
        sourceRunId: true,
        sourceRunAttempt: true,
        admissionState: true,
        state: true,
      },
    });
    const { repository } = grant.binding;
    if (
      grant.authorityKind !== "v1_comment" ||
      grant.policyVersion !== "hosted-codex-v1" ||
      !(
        grant.status === "issued" ||
        (purpose === "completion" && grant.status === "exhausted")
      ) ||
      grant.workspaceId !== identity.workspaceId ||
      grant.repositoryConnectionId !== identity.repositoryConnectionId ||
      grant.runId !== identity.sourceRunId ||
      grant.runAttempt !== runAttempt ||
      repository.scmRepositoryIdentityId !== identity.scmRepositoryIdentityId ||
      repository.githubRepositoryId === null ||
      grant.runtimeConfigVersion !== input.configurationVersion ||
      grant.model !== provider.model ||
      grant.account.id !== grant.activeAccountId ||
      grant.account.workspaceId !== identity.workspaceId ||
      grant.account.poolId !== grant.poolId ||
      grant.account.activeGeneration === null ||
      grant.account.activeGeneration < 1n ||
      !(
        grant.account.state === "healthy" ||
        (grant.account.state === "cooldown" &&
          grant.account.cooldownUntil !== null &&
          grant.account.cooldownUntil <= now)
      ) ||
      !reviewIntent ||
      reviewIntent.scmRepositoryIdentityId !==
        identity.scmRepositoryIdentityId ||
      reviewIntent.baseSha !== identity.baseSha ||
      reviewIntent.mergeBaseSha !== identity.mergeBaseSha ||
      reviewIntent.headSha !== identity.headSha ||
      reviewIntent.reviewRevisionHash !== identity.reviewRevisionHash
    )
      return null;
    authorizeHostedReviewStateScope({
      input: {
        leaseId: grant.id,
        providerInstanceId: canonicalHostedPoolProviderInstanceId(
          repository.githubRepositoryId.toString(),
        ),
        pullRequestNumber: identity.pullRequestNumber,
        now,
      },
      grant,
      runtimeGate,
      reviewIntent,
    });
    const attestation = parseAttestation(
      grant.binding,
      repository.githubRepositoryId,
    );
    const authorityIdentity = hostedGrantAuthorityIdentity({
      workspaceId: identity.workspaceId,
      repositoryId: identity.repositoryConnectionId,
      reviewRequestId: grant.reviewRequestId,
      pullRequestNumber: identity.pullRequestNumber,
      reviewHeadSha: identity.headSha,
      reviewRevisionHash: identity.reviewRevisionHash,
      runtimeConfigVersion: input.configurationVersion,
      provider,
      bindingId: grant.repositoryBindingId,
      bindingRevision: attestation.bindingRevision,
      authzEpoch: grant.binding.pool.authzEpoch.toString(),
      runtimeAuthzEpoch: runtimeGate!.authzEpoch.toString(),
      workflowSourceSha256: attestation.workflowSourceSha256,
    });
    const originalAuthority: LegacyInvocationGrantAuthority = {
      repositoryBindingId: hostedBindingId(grant.repositoryBindingId),
      reviewRequestId: grant.reviewRequestId,
      providerInvocationKey: grant.providerInvocationKey,
      runId: grant.runId,
      runAttempt: grant.runAttempt,
      model: grant.model,
      policyFingerprint: grant.policyFingerprint,
      runtimeConfigVersion: grant.runtimeConfigVersion,
      bindingRevision: Number(grant.bindingRevision),
      authzEpoch: grant.authzEpoch,
    };
    assertInvocationGrantAuthorityMatches(originalAuthority, {
      ...originalAuthority,
      ...authorityIdentity,
      model: provider.model,
      runtimeConfigVersion: input.configurationVersion,
      bindingRevision: attestation.bindingRevision,
      authzEpoch: grant.binding.pool.authzEpoch,
    });
    return parseReviewRunHostedSelection({
      grantId: grant.id,
      invocationId: grant.invocationId,
      poolId: grant.poolId,
      repositoryBindingId: grant.repositoryBindingId,
      bindingRevision: attestation.bindingRevision,
      activeAccountId: grant.activeAccountId,
      reviewRequestId: grant.reviewRequestId,
      providerInvocationKey: grant.providerInvocationKey,
      policyFingerprint: grant.policyFingerprint,
      model: grant.model,
      runtimeConfigVersion: grant.runtimeConfigVersion,
      authzEpoch: grant.authzEpoch.toString(),
      runtimeAuthzEpoch: grant.runtimeAuthzEpoch!.toString(),
      expiresAt: grant.expiresAt.toISOString(),
    });
  } catch {
    return null;
  }
}

export async function confirmOriginalHostedReviewBinding(
  input: CaptureOriginalHostedReviewBindingInput &
    Readonly<{ original: ReviewRunHostedSelection }>,
): Promise<boolean> {
  const current = await captureOriginalHostedReviewBinding(input);
  return (
    current !== null && canonicalJson(current) === canonicalJson(input.original)
  );
}

/** Spending the final original request must not prevent publishing its result.
 * This only confirms a previously captured identity; it cannot admit more work. */
export async function confirmOriginalHostedReviewBindingForCompletion(
  input: CaptureOriginalHostedReviewBindingInput &
    Readonly<{ original: ReviewRunHostedSelection }>,
): Promise<boolean> {
  const current = await readOriginalHostedReviewBinding(input, "completion");
  return (
    current !== null && canonicalJson(current) === canonicalJson(input.original)
  );
}
