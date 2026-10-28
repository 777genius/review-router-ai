import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  ProducerReleaseAttestationStatus,
  ProducerReleaseState,
  ReviewMutationLaneKind,
  ReviewMutationExecutionAuthorityMode,
  ReviewMutationMode,
  ReviewSafetyDecisionKind,
  producerReleaseImmutableKey,
  type ProducerReleaseAttestationPort,
  type ProducerReleaseQueryPort,
  type ReviewMutationAuthorityProofFactsQueryPorts,
  type ReviewMutationAuthorityQueryPort,
  type ReviewSafetyDecisionResolverPort,
  type ScmRepositoryIdentityQueryPort,
} from "@reviewrouter/features-review-run-control";
import {
  reviewActionV2CanonicalizerDigest,
  reviewActionV2PublishedSchemaDigest,
} from "@reviewrouter/protocol-review-action-v2";

const factsVersion = "review-mutation-authority-production-facts-v3";

export interface SelectedReviewV2RepositoryQueryPort {
  findSelectedRepositoryByGithubId(githubRepositoryId: string): Promise<{
    readonly workspaceId: string;
    readonly repositoryId: string;
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly fullName: string;
    readonly owner: string;
    readonly selected: boolean;
    readonly installationStatus: string;
  } | null>;
}

import type {
  GatewayReviewV2ProducerReleaseAttestationPort,
  ManagedReviewWorkflowInventoryInspectionPort,
  ReviewV2DispatchCapabilityInspectionPort,
} from "../application/provision-gateway-review-v2-repository";
export type {
  ManagedReviewWorkflowInventoryInspectionPort,
  ReviewV2DispatchCapabilityInspectionPort,
} from "../application/provision-gateway-review-v2-repository";

/** Canonical transport digests are captured by the outer adapter, never the use case. */
export function createGatewayReviewV2ProducerReleaseAttestations(
  attestations: ProducerReleaseAttestationPort,
): GatewayReviewV2ProducerReleaseAttestationPort {
  return {
    attestSelectedAction(actionCommitSha) {
      return attestations.attest({
        actionCommitSha,
        expectedSchemaDigest: reviewActionV2PublishedSchemaDigest,
        expectedCanonicalizerDigest: reviewActionV2CanonicalizerDigest,
      });
    },
  };
}

function executionAuthorityMode(
  dispatchAvailable: boolean,
): ReviewMutationExecutionAuthorityMode | null {
  return dispatchAvailable
    ? ReviewMutationExecutionAuthorityMode.ManagedDispatch
    : null;
}

export class ProductionReviewMutationAuthorityProofFacts implements ReviewMutationAuthorityProofFactsQueryPorts {
  constructor(
    private readonly dependencies: {
      readonly prisma: PrismaClient;
      readonly identities: ScmRepositoryIdentityQueryPort;
      readonly authorities: ReviewMutationAuthorityQueryPort;
      readonly actionRepositories: SelectedReviewV2RepositoryQueryPort;
      readonly releaseAttestations: ProducerReleaseAttestationPort;
      readonly producerReleases: ProducerReleaseQueryPort;
      readonly selectedProducerActionCommitSha: () => string | null;
      readonly safety: ReviewSafetyDecisionResolverPort;
      readonly workflowInventory: ManagedReviewWorkflowInventoryInspectionPort;
      readonly dispatchCapability: ReviewV2DispatchCapabilityInspectionPort;
      readonly completionWorkerConfigured: boolean;
      readonly directV2InitializationEnabled: boolean;
      readonly now: () => Date;
    },
  ) {}

  async inspectActivationFacts(input: {
    readonly scmRepositoryIdentityId: string;
    readonly laneKind: ReviewMutationLaneKind;
  }) {
    const target = await this.resolveTarget(input.scmRepositoryIdentityId);
    const [authority, inventory, dispatchCapability, safety] =
      await Promise.all([
        this.dependencies.authorities.findReviewMutationAuthority(input),
        this.dependencies.workflowInventory.inspectReviewV2ManagedWorkflowInventory(
          {
            githubInstallationId: target.repository.githubInstallationId,
            githubRepositoryId: target.repository.githubRepositoryId,
            repositoryFullName: target.repository.fullName,
            owner: target.repository.owner,
          },
        ),
        this.dependencies.dispatchCapability.inspectReviewV2DispatchCapability({
          githubInstallationId: target.repository.githubInstallationId,
          githubRepositoryId: target.repository.githubRepositoryId,
        }),
        this.dependencies.safety.resolveReviewSafetyPolicy({
          decisionKind: ReviewSafetyDecisionKind.MutationEpochActivation,
          target: target.safetyTarget,
        }),
      ]);
    const now = this.dependencies.now();
    const registeredReleaseSelected =
      await this.isExactRegisteredReleaseSelected(
        this.dependencies.selectedProducerActionCommitSha(),
      );
    const noTrackedLegacyActivity = Boolean(
      authority?.mode === ReviewMutationMode.V1Draining &&
      authority.v1AdmissionClosedAt &&
      authority.drainNotBefore &&
      authority.v1AdmissionClosedAt <= authority.drainNotBefore &&
      authority.drainNotBefore <= now,
    );
    return {
      factsVersion,
      facts: {
        noTrackedLegacyActivity,
        workflowInventoryCompatible: inventory.compatible,
        registeredReleaseSelected,
        completionWorkerConfigured:
          this.dependencies.completionWorkerConfigured,
        dispatchCapabilityAvailable:
          executionAuthorityMode(dispatchCapability.available) !== null,
        managedWorkflowInventoryHash: inventory.inventoryHash,
        safetyDecisionEnabled: safety.effectAllowed,
        activationSafetyDecisionHash: safety.safetyDecisionHash,
      },
    } as const;
  }

  async inspectAbortDrainFacts(input: {
    readonly scmRepositoryIdentityId: string;
  }) {
    const authorizationCount =
      await this.dependencies.prisma.reviewRunAuthorization.count({
        where: { scmRepositoryIdentityId: input.scmRepositoryIdentityId },
      });
    return {
      factsVersion,
      facts: { noV2AuthorizationOrMutationExists: authorizationCount === 0 },
    } as const;
  }

  async inspectDirectV2InitializationFacts(input: {
    readonly scmRepositoryIdentityId: string;
  }) {
    const target = await this.resolveTarget(input.scmRepositoryIdentityId);
    const [
      authority,
      inventory,
      dispatchCapability,
      safety,
      authorizationCount,
    ] = await Promise.all([
      this.dependencies.authorities.findReviewMutationAuthority({
        scmRepositoryIdentityId: input.scmRepositoryIdentityId,
        laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
      }),
      this.dependencies.workflowInventory.inspectReviewV2ManagedWorkflowInventory(
        {
          githubInstallationId: target.repository.githubInstallationId,
          githubRepositoryId: target.repository.githubRepositoryId,
          repositoryFullName: target.repository.fullName,
          owner: target.repository.owner,
        },
      ),
      this.dependencies.dispatchCapability.inspectReviewV2DispatchCapability({
        githubInstallationId: target.repository.githubInstallationId,
        githubRepositoryId: target.repository.githubRepositoryId,
      }),
      this.dependencies.safety.resolveReviewSafetyPolicy({
        decisionKind: ReviewSafetyDecisionKind.MutationEpochActivation,
        target: target.safetyTarget,
      }),
      this.dependencies.prisma.reviewRunAuthorization.count({
        where: { scmRepositoryIdentityId: input.scmRepositoryIdentityId },
      }),
    ]);
    const registeredReleaseSelected =
      await this.isExactRegisteredReleaseSelected(
        this.dependencies.selectedProducerActionCommitSha(),
      );
    const selectedExecutionAuthorityMode = executionAuthorityMode(
      dispatchCapability.available,
    );
    const freshV2OnlyProvisioningProven =
      this.dependencies.directV2InitializationEnabled &&
      authority === null &&
      authorizationCount === 0;
    return {
      factsVersion: "review-mutation-authority-production-facts-v4",
      facts: {
        freshV2OnlyProvisioningProven,
        noLegacyCapabilityEverIssued: authority === null,
        workflowInventoryCompatible: inventory.compatible,
        registeredReleaseSelected,
        completionWorkerConfigured:
          this.dependencies.completionWorkerConfigured,
        executionAuthorityMode: selectedExecutionAuthorityMode,
        managedWorkflowInventoryHash: inventory.inventoryHash,
        safetyDecisionEnabled: safety.effectAllowed,
        activationSafetyDecisionHash: safety.safetyDecisionHash,
      },
    } as const;
  }

  async inspectResumeFacts(input: {
    readonly scmRepositoryIdentityId: string;
  }) {
    const target = await this.resolveTarget(input.scmRepositoryIdentityId);
    const [
      unsafeOutcomeCount,
      registeredReleaseCount,
      dispatchCapability,
      safety,
    ] = await Promise.all([
      this.dependencies.prisma.reviewPublicationAttemptV2.count({
        where: {
          scmRepositoryIdentityId: input.scmRepositoryIdentityId,
          terminalOutcome: { in: ["stale_visible", "terminal_unknown"] },
        },
      }),
      this.dependencies.prisma.producerRelease.count({
        where: { state: "registered" },
      }),
      this.dependencies.dispatchCapability.inspectReviewV2DispatchCapability({
        githubInstallationId: target.repository.githubInstallationId,
        githubRepositoryId: target.repository.githubRepositoryId,
      }),
      this.dependencies.safety.resolveReviewSafetyPolicy({
        decisionKind: ReviewSafetyDecisionKind.MutationEpochActivation,
        target: target.safetyTarget,
      }),
    ]);
    return {
      factsVersion,
      facts: {
        unknownEffectsReconciled: unsafeOutcomeCount === 0,
        repositoryBound: true,
        registeredReleaseSelected: registeredReleaseCount > 0,
        dispatchCapabilityAvailable: dispatchCapability.available,
        safetyDecisionEnabled: safety.effectAllowed,
        activationSafetyDecisionHash: safety.safetyDecisionHash,
      },
    } as const;
  }

  private async isExactRegisteredReleaseSelected(
    actionCommitSha: string | null,
  ): Promise<boolean> {
    if (actionCommitSha === null) return false;
    const attestation = await createGatewayReviewV2ProducerReleaseAttestations(
      this.dependencies.releaseAttestations,
    ).attestSelectedAction(actionCommitSha);
    if (attestation.status !== ProducerReleaseAttestationStatus.Attested) {
      return false;
    }
    const persisted =
      await this.dependencies.producerReleases.findProducerReleaseById(
        attestation.release.producerReleaseId,
      );
    return (
      persisted !== null &&
      persisted.state === ProducerReleaseState.Registered &&
      producerReleaseImmutableKey(persisted) ===
        producerReleaseImmutableKey(attestation.release)
    );
  }

  private async resolveTarget(scmRepositoryIdentityId: string) {
    const identity =
      await this.dependencies.identities.findScmRepositoryIdentityById(
        scmRepositoryIdentityId,
      );
    if (
      !identity ||
      !identity.currentWorkspaceId ||
      !identity.currentRepositoryConnectionId
    ) {
      throw new Error("review_mutation_proof_repository_unbound");
    }
    const repository =
      await this.dependencies.actionRepositories.findSelectedRepositoryByGithubId(
        identity.externalRepositoryId,
      );
    if (
      !repository ||
      repository.workspaceId !== identity.currentWorkspaceId ||
      repository.repositoryId !== identity.currentRepositoryConnectionId
    ) {
      throw new Error("review_mutation_proof_repository_mismatch");
    }
    return {
      repository,
      safetyTarget: {
        workspaceId: identity.currentWorkspaceId,
        repositoryConnectionId: identity.currentRepositoryConnectionId,
        scmRepositoryIdentityId,
      },
    } as const;
  }
}
