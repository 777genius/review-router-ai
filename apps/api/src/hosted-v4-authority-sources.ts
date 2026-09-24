import type { PrismaClient } from "@reviewrouter/platform-db";
import type {
  HostedV4AuthoritySources,
  HostedV4Authorization,
} from "@reviewrouter/features-hosted-account-pool";
import {
  ProducerReleaseState,
  ReviewRunAuthorizationTokenResolutionStatus,
  type ProducerReleaseQueryPort,
  type ReviewRunAuthorization,
  type ReviewRunAuthorizationQueryPort,
} from "@reviewrouter/features-review-run-control";
import type { ReviewRunControlComposition } from "@reviewrouter/features-review-run-control/composition";
import { canonicalHostedPoolReusableWorkflowIdentity } from "@reviewrouter/features-workflow-provisioning";
import { parseAttestation } from "./prisma-hosted-codex-grant-admission.js";
import { hasAuthorizedCodexInvestigationRecording } from "./review-action-v2-run-control-composition.js";

const repositoryAuthoritySelect = {
  id: true,
  workspaceId: true,
  provider: true,
  scmRepositoryIdentityId: true,
  githubRepositoryId: true,
  owner: true,
  name: true,
  selected: true,
  archived: true,
  installation: {
    select: { githubInstallationId: true, status: true, workspaceId: true },
  },
  hostedCodexBindings: {
    take: 1,
    select: {
      id: true,
      revision: true,
      status: true,
      attestedGithubRepositoryId: true,
      attestedBindingRevision: true,
      workflowPath: true,
      workflowActionRef: true,
      workflowSourceCommitSha: true,
      workflowSourceBlobSha: true,
      workflowSourceSha256: true,
      workflowSemanticSha256: true,
      workflowSourceTrust: true,
      pool: { select: { status: true } },
    },
  },
} as const;

/** Bind the v4 server contract to the same v2 token and revision authorities. */
export function createHostedV4AuthoritySources(input: {
  readonly prisma: PrismaClient;
  readonly authorizations: Pick<
    ReviewRunControlComposition["authorizations"],
    "resolveReviewRunAuthorizationToken"
  >;
  readonly authorizationQueries: ReviewRunAuthorizationQueryPort;
  readonly releases: ProducerReleaseQueryPort;
  readonly scm: {
    readCanonicalRevision(input: {
      readonly workspaceId: string;
      readonly repositoryConnectionId: string;
      readonly scmRepositoryIdentityId: string;
      readonly githubInstallationId: string;
      readonly githubRepositoryId: string;
      readonly owner: string;
      readonly repo: string;
      readonly pullRequestNumber: number;
    }): Promise<{
      readonly pullRequestNumber: number;
      readonly headSha: string;
      readonly reviewRevisionHash: string;
    } | null>;
  };
  /** Resolve the currently selected exact-head release; never echo the saved ID. */
  readonly currentProducerReleaseId: (
    authorization: HostedV4Authorization,
    actionCommitSha: string,
  ) => Promise<string | null>;
}): HostedV4AuthoritySources {
  return {
    async resolveAuthorizationToken(token) {
      const result =
        await input.authorizations.resolveReviewRunAuthorizationToken({
          token,
        });
      return result.status === ReviewRunAuthorizationTokenResolutionStatus.Valid
        ? toHostedAuthorization(result.authorization)
        : null;
    },
    async findAuthorization(id) {
      const authorization =
        await input.authorizationQueries.findReviewRunAuthorizationById(id);
      return authorization ? toHostedAuthorization(authorization) : null;
    },
    async readLiveAuthority(authorization) {
      const repository = await input.prisma.repositoryConnection.findUnique({
        where: { id: authorization.repositoryConnectionId },
        select: repositoryAuthoritySelect,
      });
      const binding = repository?.hostedCodexBindings[0];
      if (
        !repository ||
        repository.provider !== "github" ||
        !repository.githubRepositoryId ||
        !repository.installation ||
        !binding ||
        repository.archived ||
        repository.installation.workspaceId !== repository.workspaceId ||
        repository.workspaceId !== authorization.workspaceId ||
        repository.scmRepositoryIdentityId !==
          authorization.scmRepositoryIdentityId ||
        binding.attestedGithubRepositoryId !== repository.githubRepositoryId ||
        binding.attestedBindingRevision !== binding.revision ||
        binding.revision < 1n ||
        binding.revision > BigInt(Number.MAX_SAFE_INTEGER)
      )
        return null;
      let workflowJob: ReturnType<
        typeof canonicalHostedPoolReusableWorkflowIdentity
      >;
      try {
        parseAttestation(binding, repository.githubRepositoryId);
        workflowJob = canonicalHostedPoolReusableWorkflowIdentity(
          binding.workflowActionRef!,
        );
      } catch {
        return null;
      }

      const [revision, currentProducerReleaseId] = await Promise.all([
        input.scm.readCanonicalRevision({
          workspaceId: authorization.workspaceId,
          repositoryConnectionId: repository.id,
          scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
          githubInstallationId:
            repository.installation.githubInstallationId.toString(),
          githubRepositoryId: repository.githubRepositoryId.toString(),
          owner: repository.owner,
          repo: repository.name,
          pullRequestNumber: authorization.pullRequestNumber,
        }),
        input.currentProducerReleaseId(authorization, workflowJob.sha),
      ]);
      if (
        !revision ||
        revision.pullRequestNumber !== authorization.pullRequestNumber ||
        !currentProducerReleaseId
      )
        return null;
      const release = await input.releases.findProducerReleaseById(
        currentProducerReleaseId,
      );
      // The canonical revision and release lookups can await external work.
      // Check the mutable repository/binding/installation snapshot again so a
      // deactivation during those awaits cannot mint a capability from it.
      const currentRepository =
        await input.prisma.repositoryConnection.findUnique({
          where: { id: authorization.repositoryConnectionId },
          select: repositoryAuthoritySelect,
        });
      const currentBinding = currentRepository?.hostedCodexBindings[0];
      if (
        !currentRepository ||
        !currentBinding ||
        currentRepository.id !== repository.id ||
        currentRepository.workspaceId !== repository.workspaceId ||
        currentRepository.provider !== repository.provider ||
        currentRepository.scmRepositoryIdentityId !==
          repository.scmRepositoryIdentityId ||
        currentRepository.githubRepositoryId !==
          repository.githubRepositoryId ||
        currentRepository.owner !== repository.owner ||
        currentRepository.name !== repository.name ||
        currentRepository.selected !== repository.selected ||
        currentRepository.archived !== repository.archived ||
        currentRepository.installation?.githubInstallationId !==
          repository.installation.githubInstallationId ||
        currentRepository.installation?.workspaceId !==
          repository.installation.workspaceId ||
        currentRepository.installation?.status !==
          repository.installation.status ||
        currentBinding.id !== binding.id ||
        currentBinding.revision !== binding.revision ||
        currentBinding.status !== binding.status ||
        currentBinding.attestedGithubRepositoryId !==
          binding.attestedGithubRepositoryId ||
        currentBinding.attestedBindingRevision !==
          binding.attestedBindingRevision ||
        currentBinding.workflowPath !== binding.workflowPath ||
        currentBinding.workflowActionRef !== binding.workflowActionRef ||
        currentBinding.workflowSourceCommitSha !==
          binding.workflowSourceCommitSha ||
        currentBinding.workflowSourceBlobSha !==
          binding.workflowSourceBlobSha ||
        currentBinding.workflowSourceSha256 !== binding.workflowSourceSha256 ||
        currentBinding.workflowSemanticSha256 !==
          binding.workflowSemanticSha256 ||
        currentBinding.workflowSourceTrust !== binding.workflowSourceTrust ||
        currentBinding.pool.status !== binding.pool.status
      )
        return null;
      const githubRepositoryId = repository.githubRepositoryId.toString();
      return {
        workspaceId: repository.workspaceId,
        repositoryConnectionId: repository.id,
        scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
        githubRepositoryId,
        githubInstallationId:
          repository.installation.githubInstallationId.toString(),
        owner: repository.owner,
        repo: repository.name,
        providerInstanceId: `hosted-pool:repository:${githubRepositoryId}`,
        bindingId: binding.id,
        bindingVersion: Number(binding.revision),
        bindingActive: binding.status === "active",
        poolActive: binding.pool.status === "active",
        selected: repository.selected,
        installationActive: repository.installation.status === "active",
        pullRequestNumber: revision.pullRequestNumber,
        headSha: revision.headSha,
        reviewRevisionHash: revision.reviewRevisionHash,
        producerReleaseId: currentProducerReleaseId,
        producerReleaseRegistered:
          release?.state === ProducerReleaseState.Registered &&
          release.actionCommitSha === workflowJob.sha,
      };
    },
  };
}

function toHostedAuthorization(
  authorization: ReviewRunAuthorization,
): HostedV4Authorization {
  return {
    authorizationId: authorization.authorizationId,
    workspaceId: authorization.workspaceId,
    repositoryConnectionId: authorization.repositoryConnectionId,
    scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
    pullRequestNumber: authorization.pullRequestNumber,
    headSha: authorization.headSha,
    reviewRevisionHash: authorization.reviewRevisionHash,
    producerReleaseId: authorization.producerReleaseId,
    trustDomain: authorization.trustDomain,
    investigationCodexRecordingAllowed:
      hasAuthorizedCodexInvestigationRecording(authorization),
    state: authorization.state,
    expiresAt: authorization.expiresAt,
  };
}
