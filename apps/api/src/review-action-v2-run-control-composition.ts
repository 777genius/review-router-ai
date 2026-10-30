import { attestCompiledReviewActionV2ProducerContract } from "./review-action-v2-producer-contract-attestation.js";
import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import type { RepositoryReleaseSelector } from "./review-action-v2-repository-release-selection";
import {
  buildActionOidcReplayNonceKey,
  validateOidcClaimsAgainstRepository,
  type ActionControlPlaneRepositoryPort,
  type ActionRepositoryContext,
  type GitHubActionsOidcClaims,
  type GitHubActionsOidcTokenVerifierPort,
  type HostedReviewPreleaseGatePort,
} from "@reviewrouter/features-action-control-plane";
import type { Clock, ReviewAgentProfile } from "@reviewrouter/shared";
import { codexWorkflowPathForRepository } from "@reviewrouter/features-codex-oauth-rotating";
import { reviewRouterWorkflowContract } from "@reviewrouter/protocol-review-workflow";
import {
  type RegisterReviewRunControlV2RoutesDependencies,
  ReviewActionV2RouteFailure,
} from "@reviewrouter/features-action-control-plane/v2";
import {
  ReviewRequestAdmissionState,
  ReviewRequestedIntentState,
  type ReviewRequestedIntent,
} from "@reviewrouter/features-review-executions";
import {
  InvestigationRolloutCapability,
  isInvestigationRolloutCapability,
  isInvestigationRolloutCapabilitySetDependencyClosed,
} from "@reviewrouter/features-review-investigation-operations";
import {
  ProducerDistributionKind,
  CanonicalReviewRevisionResolutionStatus,
  ProducerReleaseAttestationStatus,
  ProducerReleaseState,
  ReviewCapabilityProfile,
  ReviewRunAuthorizationDenialReason,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewRunAuthorizationUseCaseStatus,
  ReviewTrustDomain,
  ScmProvider,
  canonicalJson,
  canonicalReviewProtocolLimits,
  type CanonicalReviewRevisionResolverPort,
  type ProducerRelease,
  type ProducerReleaseAttestationPort,
  type ProducerReleaseQueryPort,
  type ProviderVoteLane,
  type ReviewProtocolLimits,
  type ReviewRunAuthorization,
  type ReviewRunAuthorizationUseCaseResult,
  type ScmRepositoryIdentityQueryPort,
  type Sha256DigestPort,
  type VerifiedScmRunIdentity,
} from "@reviewrouter/features-review-run-control";
import type { ReviewRunControlComposition } from "@reviewrouter/features-review-run-control/composition";
import {
  reviewActionV2SchemaSlot,
  reviewActionV2ContractSlot,
  reviewActionV2InvestigationExtensionForSchema,
  type ReviewActionV2ContractDescriptor,
  canonicalizeReviewActionV2RequestForSlot,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  ReviewRunAuthorizationResultStatus,
  type ReviewRunAuthorizeRequest,
  type ReviewRunAuthorizeResult,
  type ReviewRunRenewRequest,
  type ReviewRunRenewResult,
} from "@reviewrouter/protocol-review-action-v2";

export type ReviewActionV2ResolvedRevision = {
  readonly pullRequestNumber: number;
  readonly baseSha: string;
  readonly mergeBaseSha: string;
  readonly headSha: string;
  readonly reviewRevisionHash: string;
  readonly trustDomain: ReviewTrustDomain;
  readonly producerReleaseId: string;
  readonly producerActionCommitSha: string;
  readonly modelTransport: ReviewAgentProfile["modelTransports"][number];
  readonly providerApiAuthMode?: ProviderApiAuthMode;
  readonly subscriptionAuthMode?: "claude-oauth";
  readonly contextToolGithubSecrets?: Readonly<Record<string, string>>;
  readonly providerVoteLanes: readonly ProviderVoteLane[];
};

export type ReviewActionV2ResolvedAdmission = {
  readonly protocolContract: ReviewActionV2ContractDescriptor;
  readonly revision: ReviewActionV2ResolvedRevision;
  readonly producerRelease: ProducerRelease;
};

export type ReviewInvestigationAuthorizationProviderCapabilities = Readonly<{
  readonly providerKind: "codex" | "claude_code";
  readonly capabilities: readonly InvestigationRolloutCapability[];
}>;

export type ReviewInvestigationAuthorizationCapability = Readonly<{
  readonly authorizationDescriptorVersion: 3;
  readonly capability: "review_investigation_v1";
  readonly coverageProfileHash: string;
  readonly extensionCanonicalizerDigest: string;
  readonly extensionId: string;
  readonly extensionSchemaDigest: string;
  readonly policyHash: string;
  readonly providerCapabilities: readonly ReviewInvestigationAuthorizationProviderCapabilities[];
}>;

type LegacyReviewInvestigationAuthorizationCapability = Readonly<{
  readonly authorizationDescriptorVersion: 2;
  readonly capability: "review_investigation_v1";
  readonly coverageProfileHash: string;
  readonly policyHash: string;
  readonly providerCapabilities: readonly ReviewInvestigationAuthorizationProviderCapabilities[];
}>;

type ReviewInvestigationAuthorizationSnapshot =
  | LegacyReviewInvestigationAuthorizationCapability
  | ReviewInvestigationAuthorizationCapability;

export type ReviewInvestigationAuthorizationTarget = Pick<
  ReviewRunAuthorization,
  | "workspaceId"
  | "repositoryConnectionId"
  | "scmRepositoryIdentityId"
  | "trustDomain"
  | "producerReleaseId"
  | "providerVoteLanes"
>;

export interface ReviewInvestigationAuthorizationCapabilityPort {
  resolve(input: {
    readonly protocolContract: ReviewActionV2ContractDescriptor;
    readonly target: ReviewInvestigationAuthorizationTarget;
    readonly producerRelease: ProducerRelease;
  }): Promise<ReviewInvestigationAuthorizationCapability | null>;
}

export interface ReviewActionV2RunAdmissionFactsPort {
  resolve(input: {
    readonly claims: GitHubActionsOidcClaims;
    readonly repository: ActionRepositoryContext;
    readonly scmRepositoryIdentityId: string;
    /** Server-resolved VALID token authorization; never a request field. */
    readonly renewalAuthorization?: ReviewRunAuthorization;
    readonly protocolSchemaDigest?: string;
  }): Promise<ReviewActionV2ResolvedAdmission>;
}

export interface ReviewActionV2RevisionHashPort {
  digest(input: {
    readonly workspaceId: string;
    readonly repositoryConnectionId: string;
    readonly scmRepositoryIdentityId: string;
    readonly pullRequestNumber: number;
    readonly baseSha: string;
    readonly mergeBaseSha: string;
    readonly headSha: string;
  }): Promise<string>;
}

export type ServerOwnedReviewActionV2AdmissionDependencies = {
  readonly providerApiSource?: {
    verifyManagedV2SessionBootstrapSource(input: {
      readonly githubInstallationId: string;
      readonly githubRepositoryId: string;
      readonly repositoryFullName: string;
      readonly owner: string;
      readonly workflowPath: string;
      readonly workflowSha: string;
      readonly expectedProviderApiActionCommitSha?: string;
    }): Promise<{
      readonly compatible: boolean;
      readonly providerApiAuthMode?: ProviderApiAuthMode;
      readonly subscriptionAuthMode?: "claude-oauth";
      readonly mcpSecrets?: Readonly<Record<string, string>>;
    }>;
  };
  readonly revisionResolver: CanonicalReviewRevisionResolverPort;
  readonly releaseAttestations: ProducerReleaseAttestationPort;
  readonly providerVoteLanes: readonly ProviderVoteLane[];
  readonly requestedIntents?: {
    findByRepositorySourceRunIdentity(input: {
      readonly repositoryConnectionId: string;
      readonly sourceRunId: string;
      readonly sourceRunAttempt: string;
    }): Promise<ReviewRequestedIntent | null>;
  };
  readonly requestedIntentRequired?: boolean;
  readonly requestedIntentAdmission?: HostedReviewPreleaseGatePort;
  readonly clock?: Clock;
};

export function createServerOwnedReviewActionV2AdmissionFacts(
  dependencies: ServerOwnedReviewActionV2AdmissionDependencies,
): ReviewActionV2RunAdmissionFactsPort {
  if (
    typeof dependencies.revisionResolver?.resolve !== "function" ||
    typeof dependencies.releaseAttestations?.attest !== "function" ||
    !Array.isArray(dependencies.providerVoteLanes) ||
    dependencies.providerVoteLanes.length === 0 ||
    dependencies.providerVoteLanes.some(
      (lane) => !isSha256(lane.providerVoteIdentityHash),
    ) ||
    (dependencies.requestedIntentRequired === true &&
      (typeof dependencies.requestedIntentAdmission?.evaluate !== "function" ||
        typeof dependencies.clock?.now !== "function" ||
        typeof dependencies.requestedIntents
          ?.findByRepositorySourceRunIdentity !== "function"))
  ) {
    throw new Error("review_action_v2_admission_dependencies_unavailable");
  }
  return {
    async resolve(input) {
      const repositoryName = splitRepositoryFullName(input.repository.fullName);
      let admissionDecisionHash: string | null = null;
      let boundRenewalIntent: ReviewRequestedIntent | null = null;
      if (
        dependencies.requestedIntentRequired === true &&
        input.renewalAuthorization
      ) {
        if (
          input.renewalAuthorization.workspaceId !==
            input.repository.workspaceId ||
          input.renewalAuthorization.repositoryConnectionId !==
            input.repository.repositoryId ||
          input.renewalAuthorization.scmRepositoryIdentityId !==
            input.scmRepositoryIdentityId ||
          input.renewalAuthorization.sourceRunId !== input.claims.run_id ||
          input.renewalAuthorization.sourceRunAttempt !==
            input.claims.run_attempt
        ) {
          throw routeFailure(
            403,
            ReviewActionV2ProtocolErrorCode.Forbidden,
            "review_request_intent_required",
          );
        }
        const intent =
          await dependencies.requestedIntents!.findByRepositorySourceRunIdentity(
            {
              repositoryConnectionId: input.repository.repositoryId,
              sourceRunId: input.claims.run_id,
              sourceRunAttempt: input.claims.run_attempt,
            },
          );
        if (intent?.state === ReviewRequestedIntentState.Dispatched) {
          if (
            !matchesBoundRenewalIntent(
              intent,
              input.renewalAuthorization,
              input,
            )
          ) {
            throw routeFailure(
              403,
              ReviewActionV2ProtocolErrorCode.Forbidden,
              "review_request_intent_required",
            );
          }
          boundRenewalIntent = intent;
          admissionDecisionHash = intent.admission.decisionHash;
        }
      }
      if (
        dependencies.requestedIntentRequired === true &&
        !boundRenewalIntent
      ) {
        if (
          !/^[1-9][0-9]*$/.test(input.claims.run_id) ||
          !/^[1-9][0-9]*$/.test(input.claims.run_attempt) ||
          !Number.isSafeInteger(Number(input.claims.run_attempt))
        ) {
          throw routeFailure(
            403,
            ReviewActionV2ProtocolErrorCode.Forbidden,
            "review_request_intent_required",
          );
        }
        try {
          const decision =
            await dependencies.requestedIntentAdmission!.evaluate({
              repository: input.repository,
              sourceRunId: input.claims.run_id,
              sourceRunAttempt: input.claims.run_attempt,
              intentRequired: true,
              now: dependencies.clock!.now(),
            });
          if (decision.status !== "admitted") {
            throw new Error("review_request_intent_required");
          }
          admissionDecisionHash = decision.decisionHash;
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "review_request_revision_moved"
          ) {
            throw routeFailure(
              412,
              ReviewActionV2ProtocolErrorCode.StalePrecondition,
              "review_request_revision_moved",
            );
          }
          throw routeFailure(
            403,
            ReviewActionV2ProtocolErrorCode.Forbidden,
            "review_request_intent_required",
          );
        }
      }
      const requestedIntent = dependencies.requestedIntents
        ? await dependencies.requestedIntents.findByRepositorySourceRunIdentity(
            {
              repositoryConnectionId: input.repository.repositoryId,
              sourceRunId: input.claims.run_id,
              sourceRunAttempt: input.claims.run_attempt,
            },
          )
        : null;
      if (
        dependencies.requestedIntentRequired === true &&
        (!requestedIntent ||
          (boundRenewalIntent
            ? !matchesBoundRenewalIntent(
                requestedIntent,
                input.renewalAuthorization!,
                input,
              ) ||
              requestedIntent.requestId !== boundRenewalIntent.requestId ||
              requestedIntent.executionId !== boundRenewalIntent.executionId
            : requestedIntent.state !==
              ReviewRequestedIntentState.AwaitingAuthorization) ||
          requestedIntent.admission.state !==
            ReviewRequestAdmissionState.Admitted ||
          requestedIntent.admission.decisionHash !== admissionDecisionHash ||
          requestedIntent.workspaceId !== input.repository.workspaceId ||
          requestedIntent.repositoryConnectionId !==
            input.repository.repositoryId ||
          requestedIntent.scmRepositoryIdentityId !==
            input.scmRepositoryIdentityId ||
          requestedIntent.sourceRunId !== input.claims.run_id ||
          requestedIntent.sourceRunAttempt !== input.claims.run_attempt)
      ) {
        throw routeFailure(
          403,
          ReviewActionV2ProtocolErrorCode.Forbidden,
          "review_request_intent_required",
        );
      }
      const pullRequestNumberHint =
        requestedIntent?.pullRequestNumber ??
        pullRequestNumberHintFromClaims(input.claims);
      const { actionCommitSha: producerActionCommitSha, modelTransport } =
        producerExecutionFromClaims(input.claims);
      let providerApiAuthMode: ProviderApiAuthMode | undefined;
      let subscriptionAuthMode: "claude-oauth" | undefined;
      const canonicalDirectCaller =
        modelTransport === "provider_api" &&
        input.claims.workflow_ref.startsWith(
          `${input.claims.repository}/${reviewRouterWorkflowContract.callerPath}@`,
        );
      let contextToolGithubSecrets:
        | Readonly<Record<string, string>>
        | undefined;
      if (
        modelTransport === "account_gateway" &&
        input.claims.workflow_ref.startsWith(
          `${input.claims.repository}/${reviewRouterWorkflowContract.callerPath}@`,
        ) &&
        input.claims.workflow_sha &&
        isCommitSha(input.claims.workflow_sha)
      ) {
        const source =
          await dependencies.providerApiSource?.verifyManagedV2SessionBootstrapSource(
            {
              githubInstallationId: input.repository.githubInstallationId,
              githubRepositoryId: input.repository.githubRepositoryId,
              repositoryFullName: input.repository.fullName,
              owner: input.repository.owner,
              workflowPath: reviewRouterWorkflowContract.callerPath,
              workflowSha: input.claims.workflow_sha,
            },
          );
        if (source?.compatible && source.mcpSecrets)
          contextToolGithubSecrets = { ...source.mcpSecrets };
      }
      if (canonicalDirectCaller) {
        const source =
          input.claims.workflow_sha && isCommitSha(input.claims.workflow_sha)
            ? await dependencies.providerApiSource?.verifyManagedV2SessionBootstrapSource(
                {
                  githubInstallationId: input.repository.githubInstallationId,
                  githubRepositoryId: input.repository.githubRepositoryId,
                  repositoryFullName: input.repository.fullName,
                  owner: input.repository.owner,
                  workflowPath: reviewRouterWorkflowContract.callerPath,
                  workflowSha: input.claims.workflow_sha,
                  expectedProviderApiActionCommitSha: producerActionCommitSha,
                },
              )
            : undefined;
        if (
          !source?.compatible ||
          (source.providerApiAuthMode !== undefined) ===
            (source.subscriptionAuthMode === "claude-oauth")
        )
          throw routeFailure(
            403,
            ReviewActionV2ProtocolErrorCode.Forbidden,
            "provider_api_workflow_source_not_canonical",
          );
        providerApiAuthMode = source.providerApiAuthMode;
        subscriptionAuthMode = source.subscriptionAuthMode;
      }
      const revision = await dependencies.revisionResolver.resolve({
        workspaceId: input.repository.workspaceId,
        repositoryConnectionId: input.repository.repositoryId,
        scmRepositoryIdentityId: input.scmRepositoryIdentityId,
        githubInstallationId: input.repository.githubInstallationId,
        owner: repositoryName.owner,
        repo: repositoryName.repo,
        sourceRunId: requestedIntent ? null : input.claims.run_id,
        pullRequestNumberHint,
      });
      if (
        revision.status !== CanonicalReviewRevisionResolutionStatus.Resolved
      ) {
        throw revisionResolutionFailure(revision.status);
      }
      if (
        requestedIntent &&
        (requestedIntent.pullRequestNumber !== revision.pullRequestNumber ||
          requestedIntent.revision.reviewRevisionHash !==
            revision.reviewRevisionHash)
      ) {
        throw routeFailure(
          412,
          ReviewActionV2ProtocolErrorCode.StalePrecondition,
          "review_request_revision_moved",
        );
      }
      const attestation = await attestCompiledReviewActionV2ProducerContract(
        dependencies.releaseAttestations,
        producerActionCommitSha,
        input.protocolSchemaDigest ?? reviewActionV2PublishedSchemaDigest,
      );
      if (attestation.status !== ProducerReleaseAttestationStatus.Attested) {
        throw producerReleaseAttestationFailure(attestation.status);
      }
      if (dependencies.requestedIntentRequired === true) {
        const current =
          await dependencies.requestedIntents!.findByRepositorySourceRunIdentity(
            {
              repositoryConnectionId: input.repository.repositoryId,
              sourceRunId: input.claims.run_id,
              sourceRunAttempt: input.claims.run_attempt,
            },
          );
        if (
          !current ||
          current.requestId !== requestedIntent?.requestId ||
          current.admission.state !== ReviewRequestAdmissionState.Admitted ||
          current.admission.decisionHash !== admissionDecisionHash ||
          (boundRenewalIntent
            ? !matchesBoundRenewalIntent(
                current,
                input.renewalAuthorization!,
                input,
              ) || current.executionId !== boundRenewalIntent.executionId
            : current.state !==
                ReviewRequestedIntentState.AwaitingAuthorization ||
              current.authorizationId !== null ||
              current.executionId !== null)
        ) {
          throw routeFailure(
            403,
            ReviewActionV2ProtocolErrorCode.Forbidden,
            "review_request_intent_required",
          );
        }
        if (
          current.pullRequestNumber !== revision.pullRequestNumber ||
          current.revision.baseSha !== revision.baseSha ||
          current.revision.mergeBaseSha !== revision.mergeBaseSha ||
          current.revision.headSha !== revision.headSha ||
          current.revision.reviewRevisionHash !== revision.reviewRevisionHash
        ) {
          throw routeFailure(
            412,
            ReviewActionV2ProtocolErrorCode.StalePrecondition,
            "review_request_revision_moved",
          );
        }
      }
      return {
        revision: {
          pullRequestNumber: revision.pullRequestNumber,
          baseSha: revision.baseSha,
          mergeBaseSha: revision.mergeBaseSha,
          headSha: revision.headSha,
          reviewRevisionHash: revision.reviewRevisionHash,
          trustDomain: ReviewTrustDomain.TrustedManaged,
          producerReleaseId: attestation.release.producerReleaseId,
          producerActionCommitSha,
          modelTransport,
          ...(providerApiAuthMode ? { providerApiAuthMode } : {}),
          ...(subscriptionAuthMode ? { subscriptionAuthMode } : {}),
          ...(contextToolGithubSecrets ? { contextToolGithubSecrets } : {}),
          providerVoteLanes: dependencies.providerVoteLanes.map((lane) => ({
            ...lane,
          })),
        },
        producerRelease: attestation.release,
        protocolContract: attestation.contract,
      };
    },
  };
}

/** Continuation is scoped to the persisted intent linked to this validated authorization. */
function matchesBoundRenewalIntent(
  intent: ReviewRequestedIntent,
  authorization: ReviewRunAuthorization,
  input: Parameters<ReviewActionV2RunAdmissionFactsPort["resolve"]>[0],
): boolean {
  return (
    intent.state === ReviewRequestedIntentState.Dispatched &&
    intent.admission.state === ReviewRequestAdmissionState.Admitted &&
    intent.authorizationId === authorization.authorizationId &&
    intent.executionId !== null &&
    intent.workspaceId === authorization.workspaceId &&
    intent.workspaceId === input.repository.workspaceId &&
    intent.repositoryConnectionId === authorization.repositoryConnectionId &&
    intent.repositoryConnectionId === input.repository.repositoryId &&
    intent.scmRepositoryIdentityId === authorization.scmRepositoryIdentityId &&
    intent.scmRepositoryIdentityId === input.scmRepositoryIdentityId &&
    intent.sourceRunId === authorization.sourceRunId &&
    intent.sourceRunId === input.claims.run_id &&
    intent.sourceRunAttempt === authorization.sourceRunAttempt &&
    intent.sourceRunAttempt === input.claims.run_attempt &&
    intent.pullRequestNumber === authorization.pullRequestNumber &&
    intent.revision.baseSha === authorization.baseSha &&
    intent.revision.mergeBaseSha === authorization.mergeBaseSha &&
    intent.revision.headSha === authorization.headSha &&
    intent.revision.reviewRevisionHash === authorization.reviewRevisionHash
  );
}

function splitRepositoryFullName(fullName: string): {
  readonly owner: string;
  readonly repo: string;
} {
  const segments = fullName.split("/");
  if (
    segments.length !== 2 ||
    !segments[0] ||
    !segments[1] ||
    segments.some((segment) => segment.trim() !== segment)
  ) {
    throw routeFailure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "repository_full_name_invalid",
    );
  }
  return { owner: segments[0], repo: segments[1] };
}

function pullRequestNumberHintFromClaims(
  claims: GitHubActionsOidcClaims,
): number | null {
  const candidates = [claims.ref, claims.workflow_ref]
    .filter((value): value is string => typeof value === "string")
    .map((value) =>
      /(?:^|@)refs\/pull\/([1-9][0-9]*)\/(?:merge|head)$/.exec(value),
    )
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number(match[1]));
  const unique = [...new Set(candidates)];
  if (
    unique.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    unique.length > 1
  ) {
    throw routeFailure(
      409,
      ReviewActionV2ProtocolErrorCode.IdempotencyConflict,
      "pull_request_identity_conflict",
    );
  }
  return unique[0] ?? null;
}

export function producerExecutionFromClaims(claims: GitHubActionsOidcClaims): {
  readonly actionCommitSha: string;
  readonly modelTransport: ReviewAgentProfile["modelTransports"][number];
} {
  const actionCommitSha = claims.job_workflow_sha?.toLowerCase();
  const workflowRef = claims.job_workflow_ref
    ? reviewRouterRuntimeWorkflowRefPattern
        .exec(claims.job_workflow_ref)?.[1]
        ?.toLowerCase()
    : undefined;
  if (actionCommitSha && isCommitSha(actionCommitSha)) {
    if (
      workflowRef &&
      (workflowRef === "refs/tags/workflow-v1" ||
        workflowRef === actionCommitSha)
    ) {
      return { actionCommitSha, modelTransport: "account_gateway" };
    }
    const secretExecution =
      /^777genius\/review-router\/\.github\/workflows\/reviewrouter-execution-reusable\.yml@([a-f0-9]{40})$/i.exec(
        claims.job_workflow_ref ?? "",
      );
    const callerPath = codexWorkflowPathForRepository({
      repositoryId: claims.repository_id,
      repositoryFullName: claims.repository,
    });
    if (
      secretExecution?.[1]?.toLowerCase() === actionCommitSha &&
      claims.workflow_ref.startsWith(
        `${claims.repository}/${reviewRouterWorkflowContract.callerPath}@`,
      )
    ) {
      return {
        actionCommitSha,
        modelTransport: "provider_api",
      };
    }
    if (
      secretExecution?.[1]?.toLowerCase() === actionCommitSha &&
      claims.workflow_ref.startsWith(`${claims.repository}/${callerPath}@`)
    ) {
      return { actionCommitSha, modelTransport: "provider_api" };
    }
  }
  throw routeFailure(
    403,
    ReviewActionV2ProtocolErrorCode.Forbidden,
    "producer_release_workflow_not_immutable",
  );
}

function revisionResolutionFailure(
  status: Exclude<
    CanonicalReviewRevisionResolutionStatus,
    CanonicalReviewRevisionResolutionStatus.Resolved
  >,
): ReviewActionV2RouteFailure {
  switch (status) {
    case CanonicalReviewRevisionResolutionStatus.PullRequestConflict:
    case CanonicalReviewRevisionResolutionStatus.MergeBaseConflict:
      return routeFailure(
        409,
        ReviewActionV2ProtocolErrorCode.IdempotencyConflict,
        status,
      );
    case CanonicalReviewRevisionResolutionStatus.PullRequestUnavailable:
      return routeFailure(
        404,
        ReviewActionV2ProtocolErrorCode.NotFound,
        status,
      );
    case CanonicalReviewRevisionResolutionStatus.MergeBaseUnavailable:
    case CanonicalReviewRevisionResolutionStatus.RevisionMoved:
      return routeFailure(
        412,
        ReviewActionV2ProtocolErrorCode.StalePrecondition,
        status,
      );
  }
}

function producerReleaseAttestationFailure(
  status: Exclude<
    ProducerReleaseAttestationStatus,
    ProducerReleaseAttestationStatus.Attested
  >,
): ReviewActionV2RouteFailure {
  switch (status) {
    case ProducerReleaseAttestationStatus.Unregistered:
      return routeFailure(
        404,
        ReviewActionV2ProtocolErrorCode.NotFound,
        "producer_release_unregistered",
      );
    case ProducerReleaseAttestationStatus.Revoked:
      return routeFailure(
        410,
        ReviewActionV2ProtocolErrorCode.ResourceGone,
        "producer_release_revoked",
      );
    case ProducerReleaseAttestationStatus.Mismatch:
      return routeFailure(
        403,
        ReviewActionV2ProtocolErrorCode.Forbidden,
        "producer_release_attestation_mismatch",
      );
  }
}

type ReviewRunAuthorizationApi = Pick<
  ReviewRunControlComposition["authorizations"],
  | "authorizeReviewRun"
  | "renewReviewRunAuthorization"
  | "resolveReviewRunAuthorizationToken"
>;

export interface TrustedProducerReleaseMaterializerPort {
  ensureRegistered(release: ProducerRelease): Promise<void>;
}

export type ReviewActionV2RunControlHandlerDependencies = {
  readonly repositoryReleaseSelector?: RepositoryReleaseSelector;
  readonly oidcVerifier: GitHubActionsOidcTokenVerifierPort;
  readonly oidcAudience: string;
  readonly actionRepositories: ActionControlPlaneRepositoryPort;
  readonly repositoryIdentities: ScmRepositoryIdentityQueryPort;
  readonly producerReleases: ProducerReleaseQueryPort;
  readonly trustedProducerReleaseMaterializer?:
    | TrustedProducerReleaseMaterializerPort
    | undefined;
  readonly admissionFacts: ReviewActionV2RunAdmissionFactsPort;
  readonly revisionHashes: ReviewActionV2RevisionHashPort;
  readonly authorizations: ReviewRunAuthorizationApi;
  readonly digest: Sha256DigestPort;
  readonly absoluteProtocolMaxima: ReviewProtocolLimits;
  readonly authorizationTtlMs: number;
  readonly maxAuthorizationLifetimeMs: number;
  readonly reviewInvestigationCapability?:
    | ReviewInvestigationAuthorizationCapabilityPort
    | undefined;
};

export function composeReviewActionV2RunControlRoutes(input: {
  readonly enabled: boolean;
  readonly runtime: Pick<
    RegisterReviewRunControlV2RoutesDependencies,
    "readServerTime" | "createRequestId"
  >;
  readonly handlers?: ReviewActionV2RunControlHandlerDependencies | undefined;
}): RegisterReviewRunControlV2RoutesDependencies {
  if (!input.enabled) return input.runtime;
  if (!input.handlers) {
    throw new Error("review_action_v2_run_control_dependencies_unavailable");
  }
  const handlers = createReviewActionV2RunControlHandlers(input.handlers);
  return { ...input.runtime, ...handlers };
}

export function createReviewActionV2RunControlHandlers(
  dependencies: ReviewActionV2RunControlHandlerDependencies,
): Pick<RegisterReviewRunControlV2RoutesDependencies, "authorize" | "renew"> {
  validateCompositionConfiguration(dependencies);
  return {
    authorize: {
      capabilityEnabled: true,
      execute: async (request) => authorizeReviewRun(request, dependencies),
    },
    renew: {
      capabilityEnabled: true,
      execute: async (request) => renewReviewRun(request, dependencies),
    },
  };
}

async function authorizeReviewRun(
  request: ReviewRunAuthorizeRequest,
  dependencies: ReviewActionV2RunControlHandlerDependencies,
): Promise<{
  readonly statusCode: 200 | 201;
  readonly result: ReviewRunAuthorizeResult;
}> {
  assertPublishedOffer(request);
  let resolved = await resolveVerifiedIdentity(
    request.oidcToken,
    dependencies,
    undefined,
    request.schemaDigest,
  );
  if (resolved.producerRelease.schemaDigest !== request.schemaDigest)
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "producer_schema_slot_mismatch",
    );
  const attestedBaseRelease = resolved.producerRelease;
  const selectedRelease = await dependencies.repositoryReleaseSelector?.select({
    ...resolved.identity,
    actionCommitSha: resolved.producerRelease.actionCommitSha,
    baseRelease: resolved.producerRelease,
  });
  if (
    selectedRelease &&
    selectedRelease.producerReleaseId !==
      resolved.producerRelease.producerReleaseId
  ) {
    resolved = {
      ...resolved,
      producerRelease: selectedRelease,
      facts: {
        ...resolved.facts,
        producerReleaseId: selectedRelease.producerReleaseId,
      },
    };
  } else {
    await dependencies.trustedProducerReleaseMaterializer?.ensureRegistered(
      resolved.producerRelease,
    );
  }
  if (resolved.producerRelease.schemaDigest !== request.schemaDigest)
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "producer_schema_slot_mismatch",
    );
  await assertRegisteredRelease(resolved.facts, dependencies);
  const resolvedReviewInvestigation =
    await dependencies.reviewInvestigationCapability?.resolve({
      protocolContract: resolved.protocolContract,
      target: {
        workspaceId: resolved.identity.workspaceId,
        repositoryConnectionId: resolved.identity.repositoryConnectionId,
        scmRepositoryIdentityId: resolved.identity.scmRepositoryIdentityId,
        trustDomain: resolved.identity.trustDomain,
        producerReleaseId: resolved.facts.producerReleaseId,
        providerVoteLanes: resolved.facts.providerVoteLanes,
      },
      producerRelease: resolved.producerRelease,
    });
  const reviewInvestigationSnapshot =
    bindInvestigationCapabilityToAuthorization(
      resolvedReviewInvestigation,
      resolved.facts.providerVoteLanes,
      request.schemaDigest,
      resolved.protocolContract,
    );
  const [protocolOfferHash, oidcReplayKeyHash] = await Promise.all([
    dependencies.digest.digestUtf8(canonicalProtocolOffer(request)),
    dependencies.digest.digestUtf8(
      buildActionOidcReplayNonceKey(resolved.claims),
    ),
  ]);
  const outcome = await dependencies.authorizations.authorizeReviewRun({
    verifiedIdentity: resolved.identity,
    modelTransport: resolved.facts.modelTransport,
    ...(resolved.facts.providerApiAuthMode
      ? { providerApiAuthMode: resolved.facts.providerApiAuthMode }
      : {}),
    ...(resolved.facts.subscriptionAuthMode
      ? { subscriptionAuthMode: resolved.facts.subscriptionAuthMode }
      : {}),
    producerReleaseId: resolved.facts.producerReleaseId,
    ...(selectedRelease &&
    selectedRelease.producerReleaseId !== attestedBaseRelease.producerReleaseId
      ? { expectedBaseProducerRelease: attestedBaseRelease }
      : {}),
    protocolOfferHash,
    oidcReplayKeyHash,
    providerVoteLanes: resolved.facts.providerVoteLanes,
    reviewInvestigationAuthorizationDescriptorCanonicalJson:
      reviewInvestigationSnapshot === null
        ? null
        : canonicalJson(reviewInvestigationSnapshot),
    authorizationTtlMs: dependencies.authorizationTtlMs,
    maxAuthorizationLifetimeMs: dependencies.maxAuthorizationLifetimeMs,
  });
  const success = requireAuthorizationSuccess(
    ReviewActionV2OperationId.ReviewRunAuthorize,
    outcome,
  );
  const protocolLimits = success.protocolLimits;
  if (!protocolLimits) {
    throw routeFailure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "release_profile_unavailable",
    );
  }
  const protocolLimitsCanonicalJson =
    canonicalReviewProtocolLimits(protocolLimits);
  const actualLimitsDigest = await dependencies.digest.digestUtf8(
    protocolLimitsCanonicalJson,
  );
  if (
    actualLimitsDigest !== protocolLimits.limitsDigest ||
    success.authorization.schemaDigest !== request.schemaDigest ||
    success.authorization.protocolLimitsProfileId !==
      protocolLimits.protocolLimitsProfileId
  ) {
    throw routeFailure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "release_profile_digest_mismatch",
    );
  }
  assertProtocolLimitsWithinMaxima(
    protocolLimits,
    dependencies.absoluteProtocolMaxima,
  );
  const reviewInvestigation = restoreInvestigationCapabilitySnapshot(
    success.authorization
      .reviewInvestigationAuthorizationDescriptorCanonicalJson,
    success.authorization.providerVoteLanes,
    success.authorization.schemaDigest,
  );
  return {
    statusCode:
      success.status === ReviewRunAuthorizationUseCaseStatus.Authorized
        ? 201
        : 200,
    result: {
      status: mapSuccessStatus(success.status),
      authorizationId: success.authorization.authorizationId,
      authorizationToken: success.token.token,
      producerReleaseId: success.authorization.producerReleaseId,
      protocolLimitsProfileId: success.authorization.protocolLimitsProfileId,
      operationalSloProfileId: success.authorization.operationalSloProfileId,
      mutationEpoch: success.authorization.mutationEpoch.toString(10),
      expiresAt: success.authorization.expiresAt.toISOString(),
      authorizationFactsCanonicalJson: canonicalJson({
        workspaceId: success.authorization.workspaceId,
        repositoryConnectionId: success.authorization.repositoryConnectionId,
        scmRepositoryIdentityId: success.authorization.scmRepositoryIdentityId,
        pullRequestNumber: success.authorization.pullRequestNumber,
        sourceRunId: success.authorization.sourceRunId,
        sourceRunAttempt: success.authorization.sourceRunAttempt,
        ...(resolved.facts.providerApiAuthMode !== undefined ||
        resolved.facts.subscriptionAuthMode !== undefined
          ? { workflowIdentityHash: success.authorization.workflowIdentityHash }
          : {}),
        baseSha: success.authorization.baseSha,
        mergeBaseSha: success.authorization.mergeBaseSha,
        headSha: success.authorization.headSha,
        reviewRevisionHash: success.authorization.reviewRevisionHash,
        trustDomain: success.authorization.trustDomain,
        producerReleaseId: success.authorization.producerReleaseId,
        selectedProtocolVersion: success.authorization.selectedProtocolVersion,
        schemaDigest: success.authorization.schemaDigest,
        providerVoteLanes: success.authorization.providerVoteLanes,
        ...(reviewInvestigation === undefined || reviewInvestigation === null
          ? {}
          : { reviewInvestigation }),
      }),
      protocolLimitsCanonicalJson,
    },
  };
}

function bindInvestigationCapabilityToAuthorization(
  capability: ReviewInvestigationAuthorizationCapability | null | undefined,
  providerVoteLanes: readonly ProviderVoteLane[],
  schemaDigest: string,
  protocolContract?: ReviewActionV2ContractDescriptor,
): ReviewInvestigationAuthorizationCapability | null {
  const extension = protocolContract
    ? reviewActionV2ContractSlot(
        schemaDigest,
        protocolContract.canonicalizerDigest,
      )?.reviewInvestigationExtensionV1
    : reviewActionV2InvestigationExtensionForSchema(
        schemaDigest,
        capability?.extensionCanonicalizerDigest,
      );
  if (capability === null || capability === undefined) return null;
  if (
    !isRecord(capability) ||
    !hasExactKeys(capability, [
      "authorizationDescriptorVersion",
      "capability",
      "coverageProfileHash",
      "extensionCanonicalizerDigest",
      "extensionId",
      "extensionSchemaDigest",
      "policyHash",
      "providerCapabilities",
    ])
  ) {
    return null;
  }
  if (
    capability.authorizationDescriptorVersion !== 3 ||
    capability.capability !== "review_investigation_v1" ||
    !isSha256(capability.coverageProfileHash) ||
    capability.extensionId !== extension?.extensionId ||
    capability.extensionSchemaDigest !== extension?.schemaDigest ||
    capability.extensionCanonicalizerDigest !==
      extension?.canonicalizerDigest ||
    !isSha256(capability.policyHash)
  ) {
    return null;
  }
  const boundRows = bindInvestigationProviderCapabilities(
    capability.providerCapabilities,
    providerVoteLanes,
  );
  if (boundRows === null) return null;

  // This is participation eligibility only. Independent critic activation
  // still requires its own fenced Review Executions prepared manifest.
  return Object.freeze({
    authorizationDescriptorVersion: 3,
    capability: capability.capability,
    coverageProfileHash: capability.coverageProfileHash,
    extensionCanonicalizerDigest: capability.extensionCanonicalizerDigest,
    extensionId: capability.extensionId,
    extensionSchemaDigest: capability.extensionSchemaDigest,
    policyHash: capability.policyHash,
    providerCapabilities: Object.freeze(boundRows),
  });
}

function bindLegacyInvestigationCapabilitySnapshot(
  capability: LegacyReviewInvestigationAuthorizationCapability,
  providerVoteLanes: readonly ProviderVoteLane[],
): LegacyReviewInvestigationAuthorizationCapability | null {
  if (
    !hasExactKeys(capability, [
      "authorizationDescriptorVersion",
      "capability",
      "coverageProfileHash",
      "policyHash",
      "providerCapabilities",
    ]) ||
    capability.authorizationDescriptorVersion !== 2 ||
    capability.capability !== "review_investigation_v1" ||
    !isSha256(capability.coverageProfileHash) ||
    !isSha256(capability.policyHash)
  ) {
    return null;
  }
  const providerCapabilities = bindInvestigationProviderCapabilities(
    capability.providerCapabilities,
    providerVoteLanes,
  );
  if (providerCapabilities === null) return null;
  return Object.freeze({
    authorizationDescriptorVersion: 2,
    capability: capability.capability,
    coverageProfileHash: capability.coverageProfileHash,
    policyHash: capability.policyHash,
    providerCapabilities,
  });
}

function bindInvestigationProviderCapabilities(
  providerCapabilities: unknown,
  providerVoteLanes: readonly ProviderVoteLane[],
): readonly ReviewInvestigationAuthorizationProviderCapabilities[] | null {
  if (
    !Array.isArray(providerCapabilities) ||
    providerCapabilities.length === 0 ||
    providerCapabilities.length > 2
  ) {
    return null;
  }
  const authorizedProviderKinds = new Set<string>(
    providerVoteLanes.map((lane) => lane.providerKind),
  );
  const providerKinds: ("codex" | "claude_code")[] = [];
  const boundRows: ReviewInvestigationAuthorizationProviderCapabilities[] = [];
  for (const row of providerCapabilities) {
    if (
      !isRecord(row) ||
      !hasExactKeys(row, ["capabilities", "providerKind"]) ||
      (row.providerKind !== "codex" && row.providerKind !== "claude_code") ||
      !authorizedProviderKinds.has(row.providerKind) ||
      !Array.isArray(row.capabilities) ||
      row.capabilities.length === 0 ||
      row.capabilities.length > 6 ||
      row.capabilities.some(
        (rolloutCapability) =>
          !isInvestigationRolloutCapability(rolloutCapability),
      ) ||
      new Set(row.capabilities).size !== row.capabilities.length ||
      !isStrictlyLexicographicallySorted(row.capabilities) ||
      !row.capabilities.includes(InvestigationRolloutCapability.Recording) ||
      !isInvestigationRolloutCapabilitySetDependencyClosed(
        new Set(row.capabilities),
      )
    ) {
      return null;
    }
    providerKinds.push(row.providerKind);
    boundRows.push(
      Object.freeze({
        providerKind: row.providerKind,
        capabilities: Object.freeze([...row.capabilities]),
      }),
    );
  }
  if (
    new Set(providerKinds).size !== providerKinds.length ||
    !isStrictlyLexicographicallySorted(providerKinds)
  ) {
    return null;
  }
  return Object.freeze(boundRows);
}

function restoreInvestigationCapabilitySnapshot(
  canonicalSnapshot: string | null,
  providerVoteLanes: readonly ProviderVoteLane[],
  schemaDigest: string,
): ReviewInvestigationAuthorizationSnapshot | null {
  if (canonicalSnapshot === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(canonicalSnapshot);
  } catch {
    throw routeFailure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "review_investigation_authorization_snapshot_invalid",
    );
  }
  const bound = !isRecord(parsed)
    ? null
    : parsed.authorizationDescriptorVersion === 2
      ? bindLegacyInvestigationCapabilitySnapshot(
          parsed as LegacyReviewInvestigationAuthorizationCapability,
          providerVoteLanes,
        )
      : bindInvestigationCapabilityToAuthorization(
          parsed as ReviewInvestigationAuthorizationCapability,
          providerVoteLanes,
          schemaDigest,
        );
  if (canonicalJson(parsed) !== canonicalSnapshot || bound === null) {
    throw routeFailure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "review_investigation_authorization_snapshot_invalid",
    );
  }
  return bound;
}

/** Reuse the v2 snapshot validator before granting hosted context reads. */
export function hasAuthorizedCodexInvestigationRecording(
  authorization: Pick<
    ReviewRunAuthorization,
    | "reviewInvestigationAuthorizationDescriptorCanonicalJson"
    | "providerVoteLanes"
    | "schemaDigest"
  >,
): boolean {
  try {
    const snapshot = restoreInvestigationCapabilitySnapshot(
      authorization.reviewInvestigationAuthorizationDescriptorCanonicalJson,
      authorization.providerVoteLanes,
      authorization.schemaDigest,
    );
    return (
      snapshot?.providerCapabilities.some(
        (provider) =>
          provider.providerKind === "codex" &&
          provider.capabilities.includes(
            InvestigationRolloutCapability.Recording,
          ),
      ) === true
    );
  } catch {
    return false;
  }
}

async function renewReviewRun(
  request: ReviewRunRenewRequest,
  dependencies: ReviewActionV2RunControlHandlerDependencies,
): Promise<{
  readonly statusCode: 200;
  readonly result: ReviewRunRenewResult;
}> {
  await assertRequestBodyHash(request, dependencies.digest);
  const token =
    await dependencies.authorizations.resolveReviewRunAuthorizationToken({
      token: request.authorizationToken,
    });
  if (token.status !== ReviewRunAuthorizationTokenResolutionStatus.Valid) {
    throw tokenResolutionFailure(token.status);
  }
  if (token.authorization.schemaDigest !== request.schemaDigest)
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "authorization_schema_slot_mismatch",
    );
  if (token.authorization.authorizationId !== request.authorizationId) {
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "authorization_scope_mismatch",
    );
  }
  const resolved = await resolveVerifiedIdentity(
    request.oidcToken,
    dependencies,
    token.authorization,
    request.schemaDigest,
  );
  if (resolved.producerRelease.schemaDigest !== request.schemaDigest)
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "producer_schema_slot_mismatch",
    );
  const renewalReplayKeyHash = await dependencies.digest.digestUtf8(
    canonicalJson({
      authorizationId: request.authorizationId,
      idempotencyKey: request.idempotencyKey,
      renewalRequestId: request.renewalRequestId,
      oidcReplayKey: buildActionOidcReplayNonceKey(resolved.claims),
      requestBodyHash: request.requestBodyHash,
    }),
  );
  const outcome = await dependencies.authorizations.renewReviewRunAuthorization(
    {
      authorizationId: request.authorizationId,
      verifiedIdentity: resolved.identity,
      renewalReplayKeyHash,
      requestedTtlMs: request.requestedTtlMs,
    },
  );
  const success = requireAuthorizationSuccess(
    ReviewActionV2OperationId.ReviewRunRenew,
    outcome,
  );
  return {
    statusCode: 200,
    result: {
      status: mapSuccessStatus(success.status),
      authorizationId: success.authorization.authorizationId,
      authorizationToken: success.token.token,
      mutationEpoch: success.authorization.mutationEpoch.toString(10),
      expiresAt: success.authorization.expiresAt.toISOString(),
    },
  };
}

async function resolveVerifiedIdentity(
  oidcToken: string,
  dependencies: ReviewActionV2RunControlHandlerDependencies,
  renewalAuthorization?: ReviewRunAuthorization,
  protocolSchemaDigest?: string,
): Promise<{
  readonly claims: GitHubActionsOidcClaims;
  readonly identity: VerifiedScmRunIdentity;
  readonly facts: ReviewActionV2ResolvedRevision;
  readonly producerRelease: ProducerRelease;
  readonly protocolContract: ReviewActionV2ContractDescriptor;
}> {
  const claims = await verifyOidc(oidcToken, dependencies);
  const repository =
    await dependencies.actionRepositories.findSelectedRepositoryByGithubId(
      claims.repository_id,
    );
  if (!repository) {
    throw routeFailure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "repository_not_registered",
    );
  }
  try {
    validateOidcClaimsAgainstRepository({ claims, repository });
  } catch {
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "repository_identity_mismatch",
    );
  }
  const scmIdentity =
    await dependencies.repositoryIdentities.findScmRepositoryIdentityByExternalIdentity(
      {
        provider: ScmProvider.GitHub,
        normalizedSourceBaseUrl: "https://github.com",
        externalRepositoryId: claims.repository_id,
      },
    );
  if (
    !scmIdentity ||
    scmIdentity.currentWorkspaceId !== repository.workspaceId ||
    scmIdentity.currentRepositoryConnectionId !== repository.repositoryId
  ) {
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "repository_binding_mismatch",
    );
  }
  const admission = await dependencies.admissionFacts.resolve({
    claims,
    repository,
    ...(protocolSchemaDigest === undefined ? {} : { protocolSchemaDigest }),
    scmRepositoryIdentityId: scmIdentity.scmRepositoryIdentityId,
    ...(renewalAuthorization ? { renewalAuthorization } : {}),
  });
  const facts = admission.revision;
  if (
    !Number.isSafeInteger(facts.pullRequestNumber) ||
    facts.pullRequestNumber <= 0 ||
    !isCommitSha(facts.baseSha) ||
    !isCommitSha(facts.mergeBaseSha) ||
    !isCommitSha(facts.headSha) ||
    !isCommitSha(facts.producerActionCommitSha) ||
    !isSha256(facts.reviewRevisionHash)
  ) {
    throw routeFailure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "review_revision_invalid",
    );
  }
  if (
    admission.protocolContract.schemaDigest !==
      admission.producerRelease.schemaDigest ||
    reviewActionV2ContractSlot(
      admission.protocolContract.schemaDigest,
      admission.protocolContract.canonicalizerDigest,
    ) === null ||
    admission.producerRelease.producerReleaseId !== facts.producerReleaseId ||
    admission.producerRelease.actionCommitSha !==
      facts.producerActionCommitSha.toLowerCase() ||
    admission.producerRelease.state !== ProducerReleaseState.Registered
  ) {
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "producer_release_identity_mismatch",
    );
  }
  if (facts.trustDomain !== ReviewTrustDomain.TrustedManaged) {
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "trust_domain_not_enabled",
    );
  }
  const canonicalRevisionHash = await dependencies.revisionHashes.digest({
    workspaceId: repository.workspaceId,
    repositoryConnectionId: repository.repositoryId,
    scmRepositoryIdentityId: scmIdentity.scmRepositoryIdentityId,
    pullRequestNumber: facts.pullRequestNumber,
    baseSha: facts.baseSha,
    mergeBaseSha: facts.mergeBaseSha,
    headSha: facts.headSha,
  });
  if (canonicalRevisionHash !== facts.reviewRevisionHash) {
    throw routeFailure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "review_revision_hash_mismatch",
    );
  }
  const workflowIdentityHash = await dependencies.digest.digestUtf8(
    canonicalJson({
      jobWorkflowRef: claims.job_workflow_ref ?? null,
      jobWorkflowSha: claims.job_workflow_sha?.toLowerCase() ?? null,
      workflowRef: claims.workflow_ref,
      workflowSha: claims.workflow_sha?.toLowerCase() ?? null,
    }),
  );
  return {
    claims,
    facts,
    producerRelease: admission.producerRelease,
    protocolContract: admission.protocolContract,
    identity: {
      workspaceId: repository.workspaceId,
      repositoryConnectionId: repository.repositoryId,
      scmRepositoryIdentityId: scmIdentity.scmRepositoryIdentityId,
      pullRequestNumber: facts.pullRequestNumber,
      sourceRunId: claims.run_id,
      sourceRunAttempt: claims.run_attempt,
      workflowIdentityHash,
      ...(facts.contextToolGithubSecrets
        ? { contextToolGithubSecrets: { ...facts.contextToolGithubSecrets } }
        : {}),
      baseSha: facts.baseSha.toLowerCase(),
      mergeBaseSha: facts.mergeBaseSha.toLowerCase(),
      headSha: facts.headSha.toLowerCase(),
      reviewRevisionHash: facts.reviewRevisionHash,
      trustDomain: facts.trustDomain,
    },
  };
}

async function verifyOidc(
  token: string,
  dependencies: ReviewActionV2RunControlHandlerDependencies,
): Promise<GitHubActionsOidcClaims> {
  try {
    return await dependencies.oidcVerifier.verify({
      token,
      audience: dependencies.oidcAudience,
    });
  } catch {
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "oidc_verification_failed",
    );
  }
}

async function assertRegisteredRelease(
  facts: ReviewActionV2ResolvedRevision,
  dependencies: ReviewActionV2RunControlHandlerDependencies,
): Promise<void> {
  const release = await dependencies.producerReleases.findProducerReleaseById(
    facts.producerReleaseId,
  );
  if (!release || release.state !== ProducerReleaseState.Registered) {
    throw routeFailure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "producer_release_unavailable",
    );
  }
  if (
    release.distributionKind !== ProducerDistributionKind.PublicReusable ||
    release.capabilityProfile !== ReviewCapabilityProfile.ExactRevisionV2 ||
    release.actionCommitSha !== facts.producerActionCommitSha.toLowerCase() ||
    reviewActionV2SchemaSlot(release.schemaDigest) === null
  ) {
    throw routeFailure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "producer_release_identity_mismatch",
    );
  }
}

function assertPublishedOffer(request: ReviewRunAuthorizeRequest): void {
  const offered = request.supportedProtocols.some(
    (offer) =>
      offer.protocolVersion === reviewActionV2PublishedProtocolVersion &&
      offer.schemaDigest === request.schemaDigest &&
      reviewActionV2SchemaSlot(offer.schemaDigest) !== null,
  );
  if (!offered) {
    throw routeFailure(
      426,
      ReviewActionV2ProtocolErrorCode.UnsupportedProtocol,
      "published_protocol_not_offered",
    );
  }
}

async function assertRequestBodyHash(
  request: ReviewRunRenewRequest,
  digest: Sha256DigestPort,
): Promise<void> {
  const canonical = canonicalizeReviewActionV2RequestForSlot(
    ReviewActionV2OperationId.ReviewRunRenew,
    request,
  );
  if ((await digest.digestUtf8(canonical)) !== request.requestBodyHash) {
    throw routeFailure(
      400,
      ReviewActionV2ProtocolErrorCode.InvalidRequest,
      "request_body_hash_mismatch",
    );
  }
}

function canonicalProtocolOffer(request: ReviewRunAuthorizeRequest): string {
  return canonicalJson({
    supportedProtocols: [...request.supportedProtocols].sort((left, right) =>
      `${left.protocolVersion}:${left.schemaDigest}`.localeCompare(
        `${right.protocolVersion}:${right.schemaDigest}`,
      ),
    ),
  });
}

function requireAuthorizationSuccess(
  operationId:
    | ReviewActionV2OperationId.ReviewRunAuthorize
    | ReviewActionV2OperationId.ReviewRunRenew,
  outcome: ReviewRunAuthorizationUseCaseResult,
) {
  switch (outcome.status) {
    case ReviewRunAuthorizationUseCaseStatus.Authorized:
    case ReviewRunAuthorizationUseCaseStatus.Restored:
    case ReviewRunAuthorizationUseCaseStatus.Renewed:
      return outcome;
    case ReviewRunAuthorizationUseCaseStatus.Denied:
      throw denialFailure(operationId, outcome.reason);
    case ReviewRunAuthorizationUseCaseStatus.Conflict:
      throw routeFailure(
        409,
        ReviewActionV2ProtocolErrorCode.IdempotencyConflict,
        "authorization_conflict",
      );
    case ReviewRunAuthorizationUseCaseStatus.Expired:
    case ReviewRunAuthorizationUseCaseStatus.Revoked:
      throw routeFailure(
        410,
        ReviewActionV2ProtocolErrorCode.ResourceGone,
        `authorization_${outcome.status}`,
      );
    case ReviewRunAuthorizationUseCaseStatus.Missing:
      throw routeFailure(
        404,
        ReviewActionV2ProtocolErrorCode.NotFound,
        "authorization_missing",
      );
  }
}

function denialFailure(
  operationId:
    | ReviewActionV2OperationId.ReviewRunAuthorize
    | ReviewActionV2OperationId.ReviewRunRenew,
  reason: ReviewRunAuthorizationDenialReason,
): ReviewActionV2RouteFailure {
  switch (reason) {
    case ReviewRunAuthorizationDenialReason.ProducerReleaseUnavailable:
    case ReviewRunAuthorizationDenialReason.ReleaseProfileUnavailable:
      return routeFailure(
        404,
        ReviewActionV2ProtocolErrorCode.NotFound,
        reason,
      );
    case ReviewRunAuthorizationDenialReason.VerifiedIdentityDrift:
    case ReviewRunAuthorizationDenialReason.SafetyDecisionChanged:
    case ReviewRunAuthorizationDenialReason.AdmissionFactsChanged:
      return routeFailure(
        412,
        ReviewActionV2ProtocolErrorCode.StalePrecondition,
        reason,
      );
    case ReviewRunAuthorizationDenialReason.RepositoryBindingMismatch:
    case ReviewRunAuthorizationDenialReason.MutationAuthorityUnavailable:
    case ReviewRunAuthorizationDenialReason.SafetyDecisionDisabled:
      return routeFailure(
        403,
        ReviewActionV2ProtocolErrorCode.Forbidden,
        `${operationId}:${reason}`,
      );
    // Engine/agent-profile, vote-lane and investigation mismatches are
    // actionable configuration errors discovered before any inference.
    case ReviewRunAuthorizationDenialReason.AgentProfileUnavailable:
    case ReviewRunAuthorizationDenialReason.AgentProfileIncompatible:
    case ReviewRunAuthorizationDenialReason.ContextToolsUnavailable:
    case ReviewRunAuthorizationDenialReason.ProviderVoteLaneUnavailable:
    case ReviewRunAuthorizationDenialReason.ReviewInvestigationIncompatible:
    case ReviewRunAuthorizationDenialReason.SkillsUnavailable:
    case ReviewRunAuthorizationDenialReason.SkillsEngineUnsupported:
    case ReviewRunAuthorizationDenialReason.SkillsLimitsExceeded:
      return routeFailure(
        422,
        ReviewActionV2ProtocolErrorCode.InvariantViolation,
        `${operationId}:${reason}`,
      );
  }
}

function tokenResolutionFailure(
  status: Exclude<
    ReviewRunAuthorizationTokenResolutionStatus,
    ReviewRunAuthorizationTokenResolutionStatus.Valid
  >,
): ReviewActionV2RouteFailure {
  switch (status) {
    case ReviewRunAuthorizationTokenResolutionStatus.Invalid:
    case ReviewRunAuthorizationTokenResolutionStatus.ClaimDrift:
      return routeFailure(
        401,
        ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
        `authorization_token_${status}`,
      );
    case ReviewRunAuthorizationTokenResolutionStatus.Missing:
      return routeFailure(
        404,
        ReviewActionV2ProtocolErrorCode.NotFound,
        "authorization_missing",
      );
    case ReviewRunAuthorizationTokenResolutionStatus.Expired:
    case ReviewRunAuthorizationTokenResolutionStatus.Revoked:
      return routeFailure(
        410,
        ReviewActionV2ProtocolErrorCode.ResourceGone,
        `authorization_${status}`,
      );
  }
}

function mapSuccessStatus(
  status:
    | ReviewRunAuthorizationUseCaseStatus.Authorized
    | ReviewRunAuthorizationUseCaseStatus.Restored
    | ReviewRunAuthorizationUseCaseStatus.Renewed,
): ReviewRunAuthorizationResultStatus {
  switch (status) {
    case ReviewRunAuthorizationUseCaseStatus.Authorized:
      return ReviewRunAuthorizationResultStatus.Authorized;
    case ReviewRunAuthorizationUseCaseStatus.Restored:
      return ReviewRunAuthorizationResultStatus.Restored;
    case ReviewRunAuthorizationUseCaseStatus.Renewed:
      return ReviewRunAuthorizationResultStatus.Renewed;
  }
}

function routeFailure(
  statusCode: ConstructorParameters<typeof ReviewActionV2RouteFailure>[0],
  errorCode: ReviewActionV2ProtocolErrorCode,
  issue: string,
): ReviewActionV2RouteFailure {
  return new ReviewActionV2RouteFailure(statusCode, errorCode, [issue]);
}

function validateCompositionConfiguration(
  dependencies: ReviewActionV2RunControlHandlerDependencies,
): void {
  if (
    typeof dependencies.oidcVerifier?.verify !== "function" ||
    typeof dependencies.actionRepositories?.findSelectedRepositoryByGithubId !==
      "function" ||
    typeof dependencies.repositoryIdentities
      ?.findScmRepositoryIdentityByExternalIdentity !== "function" ||
    typeof dependencies.producerReleases?.findProducerReleaseById !==
      "function" ||
    typeof dependencies.admissionFacts?.resolve !== "function" ||
    typeof dependencies.revisionHashes?.digest !== "function" ||
    typeof dependencies.authorizations?.authorizeReviewRun !== "function" ||
    typeof dependencies.authorizations?.renewReviewRunAuthorization !==
      "function" ||
    typeof dependencies.authorizations?.resolveReviewRunAuthorizationToken !==
      "function" ||
    typeof dependencies.digest?.digestUtf8 !== "function" ||
    typeof dependencies.oidcAudience !== "string" ||
    dependencies.oidcAudience.length === 0 ||
    !hasValidProtocolLimits(dependencies.absoluteProtocolMaxima) ||
    !Number.isSafeInteger(dependencies.authorizationTtlMs) ||
    dependencies.authorizationTtlMs <= 0 ||
    !Number.isSafeInteger(dependencies.maxAuthorizationLifetimeMs) ||
    dependencies.maxAuthorizationLifetimeMs <= 0
  ) {
    throw new Error("review_action_v2_run_control_configuration_invalid");
  }
}

const protocolLimitKeys = [
  "maxWorkSlots",
  "maxAttemptsPerSlot",
  "maxObservationBytes",
  "maxObservationFindings",
  "maxProjectionBytes",
  "maxProjectionFindings",
  "maxPublicationOperations",
  "maxPublicationChunks",
  "maxPublicationBodyBytes",
  "maxRequestBatchSize",
  "maxLeaseDurationMs",
  "maxResultReportDurationMs",
  "maxReconciliationDurationMs",
] as const satisfies readonly (keyof ReviewProtocolLimits)[];

function assertProtocolLimitsWithinMaxima(
  limits: ReviewProtocolLimits,
  maxima: ReviewProtocolLimits,
): void {
  for (const key of protocolLimitKeys) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] <= 0 ||
      !Number.isSafeInteger(maxima[key]) ||
      maxima[key] <= 0 ||
      limits[key] > maxima[key]
    ) {
      throw routeFailure(
        422,
        ReviewActionV2ProtocolErrorCode.InvariantViolation,
        `protocol_limit_invalid:${toSnakeCase(key)}`,
      );
    }
  }
}

function hasValidProtocolLimits(
  limits: ReviewProtocolLimits | null | undefined,
): limits is ReviewProtocolLimits {
  return (
    limits !== null &&
    limits !== undefined &&
    protocolLimitKeys.every(
      (key) => Number.isSafeInteger(limits[key]) && limits[key] > 0,
    )
  );
}

function isCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function isStrictlyLexicographicallySorted(values: readonly string[]): boolean {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}

function toSnakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
}
import { reviewRouterRuntimeWorkflowRefPattern } from "@reviewrouter/protocol-review-workflow";
