import {
  ProducerReleaseAttestationStatus,
  ResolveReviewSafetyPolicy,
  ReviewMutationAuthorityCommandKind,
  ReviewMutationAuthorityPreflightStatus,
  ReviewMutationAuthorityWriteStatus,
  ReviewMutationLaneKind,
  ReviewMutationMode,
  ReviewRunControlDomainError,
  ReviewSafetyCapability,
  ReviewSafetyDecisionKind,
  ReviewSafetyPolicyScope,
  ReviewSafetyRolloutMode,
  ScmProvider,
  ScmRepositoryIdentityBindingStatus,
  createReviewSafetyPolicy,
  reviewMutationAuthorityProofReference,
  type ClockPort,
  type Sha256DigestPort,
  type ManageReviewMutationAuthority,
  type ManageReviewSafetyControls,
  type ManageScmRepositoryIdentities,
  type ProducerReleaseAttestationResult,
  type ReviewMutationAuthority,
  type ReviewMutationAuthorityQueryPort,
  type ReviewSafetyDecisionResolverPort,
  type ReviewSafetyPolicyQueryPort,
  type ReviewSafetyEmergencyControlQueryPort,
  type ReviewSafetyResolutionTarget,
  type ScmRepositoryIdentityQueryPort,
  type TrustedProducerReleaseMaterializerPort,
} from "@reviewrouter/features-review-run-control";
export interface GatewayReviewV2ProducerReleaseAttestationPort {
  attestSelectedAction(
    actionCommitSha: string,
  ): Promise<ProducerReleaseAttestationResult>;
}
export interface ManagedReviewWorkflowInventoryInspectionPort {
  inspectReviewV2ManagedWorkflowInventory(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly owner: string;
  }): Promise<{
    readonly compatible: boolean;
    readonly inventoryHash: string;
    readonly actionCommitSha: string | null;
    readonly runtimeRef: string | null;
    readonly workflowSchemaVersion: number | null;
    readonly defaultBranchHeadSha: string;
  }>;
}
export interface ReviewV2DispatchCapabilityInspectionPort {
  inspectReviewV2DispatchCapability(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
  }): Promise<{ readonly available: boolean }>;
}

export type GatewayReviewV2ProvisioningIssue =
  | "gateway_review_v2_runtime_not_ready"
  | "gateway_review_v2_release_registry_missing"
  | "gateway_review_v2_provisioning_failed"
  | "gateway_review_v2_inventory_retry"
  | "gateway_repository_identity_missing"
  | "gateway_repository_binding_conflict"
  | "gateway_review_v2_workflow_incompatible"
  | "gateway_review_v2_dispatch_unavailable"
  | "gateway_review_v2_release_untrusted"
  | "gateway_review_v2_safety_blocked"
  | "gateway_review_v2_policy_conflict"
  | "gateway_review_v2_proof_blocked"
  | "gateway_review_v2_authority_conflict"
  | "gateway_review_v2_authority_invalid"
  | "mutation_authority_unavailable";

export type GatewayReviewV2ProvisioningResult =
  | {
      readonly status: "ready";
      readonly outcome: "created" | "restored";
      readonly scmRepositoryIdentityId: string;
      readonly authorityVersion: number;
      readonly authorityEpoch: string;
      readonly actionCommitSha: string | null;
    }
  | {
      readonly status: "legacy_migration_required" | "paused";
      readonly authorityVersion: number;
      readonly recoveryReference: string;
    }
  | {
      readonly status: "draining";
      readonly authorityVersion: number;
      readonly drainNotBefore: string;
      readonly recoveryReference: string;
    }
  | {
      readonly status: "blocked" | "conflict";
      readonly issue: GatewayReviewV2ProvisioningIssue;
      readonly blockers?: readonly string[];
    };

export type GatewayReviewV2ProvisioningCommand = {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly installationId: string;
  readonly actor: string;
  readonly expectedAttempt: {
    readonly attemptId: string;
    readonly revision: number;
  } | null;
  readonly repository: {
    readonly githubRepositoryId: string;
    readonly githubInstallationId: string;
    readonly fullName: string;
    readonly owner: string;
  };
  readonly expectedGatewaySource: {
    readonly actionCommitSha: string;
    readonly actionRef: string;
    readonly apiUrl: string;
    readonly sourceRevision: string;
  };
};

export const gatewayReviewV2SafetyDecisions = [
  ReviewSafetyDecisionKind.MutationEpochActivation,
  ReviewSafetyDecisionKind.RunAuthorization,
  ReviewSafetyDecisionKind.ObservationAcceptance,
  ReviewSafetyDecisionKind.ExactRevisionCrossExecutionReuse,
  ReviewSafetyDecisionKind.PublicationMutation,
] as const;

export const gatewayReviewV2SafetyCapabilities = [
  ReviewSafetyCapability.MutationEpochV2,
  ReviewSafetyCapability.RunAuthorizationV2,
  ReviewSafetyCapability.EvidenceWritesV2,
  ReviewSafetyCapability.EvidenceReuseV2,
  ReviewSafetyCapability.PublicationOperationsV2,
] as const;

/** Read-only projection: active authority must retain its actual proof hashes. */
export function gatewayReviewV2AuthorityRecovery(
  authority:
    | (Pick<
        ReviewMutationAuthority,
        | "version"
        | "epoch"
        | "drainNotBefore"
        | "managedWorkflowInventoryHash"
        | "activationSafetyDecisionHash"
      > & { readonly mode: string })
    | null,
): Exclude<
  GatewayReviewV2ProvisioningResult,
  { readonly status: "ready" }
> | null {
  if (!authority)
    return { status: "blocked", issue: "mutation_authority_unavailable" };
  const recoveryReference = "docs/operations/review-action-v2-cutover.md";
  if (authority.mode === ReviewMutationMode.V1Open)
    return {
      status: "legacy_migration_required",
      authorityVersion: authority.version,
      recoveryReference,
    };
  if (authority.mode === ReviewMutationMode.Paused)
    return {
      status: "paused",
      authorityVersion: authority.version,
      recoveryReference,
    };
  if (authority.mode === ReviewMutationMode.V1Draining) {
    if (
      !authority.drainNotBefore ||
      !Number.isFinite(authority.drainNotBefore.getTime())
    )
      return {
        status: "blocked",
        issue: "gateway_review_v2_authority_invalid",
      };
    return {
      status: "draining",
      authorityVersion: authority.version,
      drainNotBefore: authority.drainNotBefore.toISOString(),
      recoveryReference,
    };
  }
  if (
    authority.mode !== ReviewMutationMode.V2Active ||
    authority.epoch <= 0n ||
    !/^[a-f0-9]{64}$/u.test(authority.managedWorkflowInventoryHash ?? "") ||
    !/^[a-f0-9]{64}$/u.test(authority.activationSafetyDecisionHash ?? "")
  )
    return { status: "blocked", issue: "gateway_review_v2_authority_invalid" };
  return null;
}

export async function gatewayReviewV2SafetyAllowed(
  safety: ReviewSafetyDecisionResolverPort,
  target: ReviewSafetyResolutionTarget,
): Promise<boolean> {
  const decisions = await Promise.all(
    gatewayReviewV2SafetyDecisions.map((decisionKind) =>
      safety.resolveReviewSafetyPolicy({ decisionKind, target }),
    ),
  );
  return decisions.every((decision) => decision.effectAllowed);
}

export class ProvisionGatewayReviewV2Repository {
  constructor(
    private readonly dependencies: {
      readonly clock: ClockPort;
      readonly digest: Sha256DigestPort;
      readonly identities: Pick<
        ManageScmRepositoryIdentities,
        "resolveOrRegisterScmRepositoryIdentity" | "bindScmRepositoryIdentity"
      >;
      readonly identityQueries: ScmRepositoryIdentityQueryPort;
      readonly authorityQueries: ReviewMutationAuthorityQueryPort;
      readonly mutationAuthority: Pick<
        ManageReviewMutationAuthority,
        "preflight" | "initializeDirectV2"
      >;
      readonly safetyControls: Pick<
        ManageReviewSafetyControls,
        "updateReviewSafetyPolicy"
      >;
      readonly safetyQueries: ReviewSafetyPolicyQueryPort &
        ReviewSafetyEmergencyControlQueryPort;
      readonly safety: ReviewSafetyDecisionResolverPort;
      readonly attestations: GatewayReviewV2ProducerReleaseAttestationPort;
      readonly materializer: TrustedProducerReleaseMaterializerPort;
      readonly workflowInventory: ManagedReviewWorkflowInventoryInspectionPort;
      readonly dispatchCapability: ReviewV2DispatchCapabilityInspectionPort;
      readonly assertCurrentSetupAndSource: () => Promise<void>;
    },
  ) {}

  async execute(
    command: GatewayReviewV2ProvisioningCommand,
  ): Promise<GatewayReviewV2ProvisioningResult> {
    await this.dependencies.assertCurrentSetupAndSource();
    const { identity } =
      await this.dependencies.identities.resolveOrRegisterScmRepositoryIdentity(
        {
          provider: ScmProvider.GitHub,
          sourceBaseUrl: "https://github.com",
          externalRepositoryId: command.repository.githubRepositoryId,
        },
      );
    if (
      (identity.currentWorkspaceId !== null ||
        identity.currentRepositoryConnectionId !== null) &&
      (identity.currentWorkspaceId !== command.workspaceId ||
        identity.currentRepositoryConnectionId !== command.repositoryId)
    )
      return {
        status: "conflict",
        issue: "gateway_repository_binding_conflict",
      };
    const currentAuthority = await this.findAuthority(
      identity.scmRepositoryIdentityId,
    );
    if (currentAuthority) {
      const recovery = gatewayReviewV2AuthorityRecovery(currentAuthority);
      if (recovery) return recovery;
      if (identity.currentWorkspaceId === null)
        return {
          status: "conflict",
          issue: "gateway_repository_binding_conflict",
        };
    }
    if (identity.currentWorkspaceId === null) {
      await this.dependencies.assertCurrentSetupAndSource();
      const bound =
        await this.dependencies.identities.bindScmRepositoryIdentity({
          scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
          expectedVersion: identity.version,
          workspaceId: command.workspaceId,
          repositoryConnectionId: command.repositoryId,
        });
      if (
        bound.status !== ScmRepositoryIdentityBindingStatus.Bound &&
        bound.status !== ScmRepositoryIdentityBindingStatus.Restored
      )
        return {
          status: "conflict",
          issue: "gateway_repository_binding_conflict",
        };
    }
    const target = {
      workspaceId: command.workspaceId,
      repositoryConnectionId: command.repositoryId,
      scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
    };
    const inventory =
      await this.dependencies.workflowInventory.inspectReviewV2ManagedWorkflowInventory(
        {
          ...command.repository,
          repositoryFullName: command.repository.fullName,
        },
      );
    if (
      !inventory.compatible ||
      (inventory.runtimeRef !== reviewRouterWorkflowContract.channel &&
        inventory.runtimeRef !==
          command.expectedGatewaySource.actionCommitSha) ||
      inventory.defaultBranchHeadSha !==
        command.expectedGatewaySource.sourceRevision ||
      inventory.workflowSchemaVersion !== reviewRouterWorkflowContract.major
    )
      return {
        status: "blocked",
        issue: "gateway_review_v2_workflow_incompatible",
      };
    if (
      !(
        await this.dependencies.dispatchCapability.inspectReviewV2DispatchCapability(
          command.repository,
        )
      ).available
    )
      return {
        status: "blocked",
        issue: "gateway_review_v2_dispatch_unavailable",
      };
    const attested = await this.dependencies.attestations.attestSelectedAction(
      command.expectedGatewaySource.actionCommitSha,
    );
    if (attested.status !== ProducerReleaseAttestationStatus.Attested)
      return {
        status: "blocked",
        issue: "gateway_review_v2_release_untrusted",
      };
    await this.dependencies.materializer.ensureRegistered(attested.release);
    const enrollment = await this.enrollMissingPolicies(command, target);
    if (enrollment) return enrollment;
    await this.dependencies.assertCurrentSetupAndSource();
    if (!(await gatewayReviewV2SafetyAllowed(this.dependencies.safety, target)))
      return { status: "blocked", issue: "gateway_review_v2_safety_blocked" };
    let outcome: "created" | "restored" = "restored";
    if (!currentAuthority) {
      const preflight = await this.dependencies.mutationAuthority.preflight({
        scmRepositoryIdentityId: target.scmRepositoryIdentityId,
        operation: ReviewMutationAuthorityCommandKind.DirectV2Initialize,
      });
      if (
        preflight.status !== ReviewMutationAuthorityPreflightStatus.Ready ||
        !preflight.proof
      ) {
        const concurrent = await this.findAuthority(
          target.scmRepositoryIdentityId,
        );
        const recovery = gatewayReviewV2AuthorityRecovery(concurrent);
        if (concurrent && recovery) return recovery;
        if (!concurrent)
          return {
            status: "blocked",
            issue: "gateway_review_v2_proof_blocked",
            blockers:
              preflight.status ===
              ReviewMutationAuthorityPreflightStatus.Missing
                ? []
                : preflight.blockers,
          };
      } else {
        try {
          const initialized =
            await this.dependencies.mutationAuthority.initializeDirectV2({
              scmRepositoryIdentityId: target.scmRepositoryIdentityId,
              proof: reviewMutationAuthorityProofReference(preflight.proof),
            });
          outcome =
            initialized.status === ReviewMutationAuthorityWriteStatus.Created
              ? "created"
              : "restored";
        } catch (error) {
          if (!(error instanceof ReviewRunControlDomainError)) throw error;
          const concurrent = await this.findAuthority(
            target.scmRepositoryIdentityId,
          );
          const recovery = gatewayReviewV2AuthorityRecovery(concurrent);
          if (concurrent && recovery) return recovery;
          if (!concurrent)
            return {
              status: "blocked",
              issue: "gateway_review_v2_proof_blocked",
            };
        }
      }
    }
    await this.dependencies.assertCurrentSetupAndSource();
    const [boundIdentity, authority] = await Promise.all([
      this.dependencies.identityQueries.findScmRepositoryIdentityById(
        target.scmRepositoryIdentityId,
      ),
      this.findAuthority(target.scmRepositoryIdentityId),
    ]);
    if (
      boundIdentity?.currentWorkspaceId !== command.workspaceId ||
      boundIdentity.currentRepositoryConnectionId !== command.repositoryId
    )
      return {
        status: "conflict",
        issue: "gateway_repository_binding_conflict",
      };
    const recovery = gatewayReviewV2AuthorityRecovery(authority);
    if (recovery) return recovery;
    if (!(await gatewayReviewV2SafetyAllowed(this.dependencies.safety, target)))
      return { status: "blocked", issue: "gateway_review_v2_safety_blocked" };
    await this.dependencies.assertCurrentSetupAndSource();
    return {
      status: "ready",
      outcome,
      scmRepositoryIdentityId: target.scmRepositoryIdentityId,
      authorityVersion: authority!.version,
      authorityEpoch: authority!.epoch.toString(),
      actionCommitSha: attested.release.actionCommitSha,
    };
  }

  private findAuthority(scmRepositoryIdentityId: string) {
    return this.dependencies.authorityQueries.findReviewMutationAuthority({
      scmRepositoryIdentityId,
      laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
    });
  }

  private async enrollMissingPolicies(
    command: GatewayReviewV2ProvisioningCommand,
    target: ReviewSafetyResolutionTarget,
  ): Promise<GatewayReviewV2ProvisioningResult | null> {
    const [policies, controls] = await Promise.all([
      this.dependencies.safetyQueries.findApplicableReviewSafetyPolicies({
        target,
        capabilities: gatewayReviewV2SafetyCapabilities,
      }),
      this.dependencies.safetyQueries.findApplicableReviewSafetyEmergencyControls(
        target,
      ),
    ]);
    const scope = {
      scope: ReviewSafetyPolicyScope.Repository,
      ...target,
    } as const;
    const existing = policies.filter(
      (policy) => policy.scope.scope === ReviewSafetyPolicyScope.Repository,
    );
    if (
      existing.some(
        (policy) => policy.rolloutMode !== ReviewSafetyRolloutMode.Enabled,
      )
    )
      return { status: "blocked", issue: "gateway_review_v2_safety_blocked" };
    const missing = gatewayReviewV2SafetyCapabilities.filter(
      (capability) =>
        !existing.some((policy) => policy.capability === capability),
    );
    // Preview enrollment with the real resolver. Parent restrictions, selectors
    // and emergency stops remain authoritative; no preview state is persisted.
    const previewPolicies = [
      ...policies,
      ...missing.map((capability) =>
        createReviewSafetyPolicy({
          policyId: `gateway-preview:${capability}`,
          scope,
          capability,
          rolloutMode: ReviewSafetyRolloutMode.Enabled,
          updatedBy: command.actor,
          updatedAt: this.dependencies.clock.now(),
        }),
      ),
    ];
    const preview = new ResolveReviewSafetyPolicy({
      clock: this.dependencies.clock,
      digest: this.dependencies.digest,
      policyQueries: {
        findApplicableReviewSafetyPolicies: async () => previewPolicies,
      },
      emergencyQueries: {
        findApplicableReviewSafetyEmergencyControls: async () => controls,
      },
    });
    if (!(await gatewayReviewV2SafetyAllowed(preview, target)))
      return { status: "blocked", issue: "gateway_review_v2_safety_blocked" };
    for (const capability of missing) {
      await this.dependencies.assertCurrentSetupAndSource();
      // An incompatible authority winner must never receive automatic enrollment.
      const authority = await this.findAuthority(
        target.scmRepositoryIdentityId,
      );
      if (authority) {
        const recovery = gatewayReviewV2AuthorityRecovery(authority);
        if (recovery) return recovery;
      }
      await this.dependencies.safetyControls.updateReviewSafetyPolicy({
        expectedVersion: 0,
        scope,
        capability,
        rolloutMode: ReviewSafetyRolloutMode.Enabled,
        updatedBy: command.actor,
      });
    }
    return null;
  }
}
import { reviewRouterWorkflowContract } from "@reviewrouter/protocol-review-workflow";
