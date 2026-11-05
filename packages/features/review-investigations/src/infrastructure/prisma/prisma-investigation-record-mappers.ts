import {
  ReviewInvestigationConclusionV1 as PrismaConclusion,
  ReviewInvestigationCriticDecisionV1 as PrismaCriticDecision,
  ReviewInvestigationObligationKindV1 as PrismaObligationKind,
  ReviewInvestigationObligationOriginV1 as PrismaObligationOrigin,
  ReviewInvestigationObligationStateV1 as PrismaObligationState,
  ReviewInvestigationReceiptKindV1 as PrismaReceiptKind,
  ReviewInvestigationLeasePurposeV1 as PrismaLeasePurpose,
  ReviewInvestigationLeaseStateV1 as PrismaLeaseState,
  ReviewInvestigationRuntimeProfileV1 as PrismaRuntimeProfile,
  ReviewInvestigationStateV1 as PrismaInvestigationState,
  ReviewInvestigationTurnPurposeV1 as PrismaTurnPurpose,
  type ReviewInvestigationLease as PrismaLeaseRecord,
} from "@prisma/client";
import {
  InvestigationObligationOrigin,
  InvestigationReceiptKind,
} from "../../domain/investigation-obligation";
import {
  assertReviewInvestigationLease,
  ReviewInvestigationLeasePurpose,
  ReviewInvestigationLeaseState,
  type CreateReviewInvestigationLeaseInput,
  type ReviewInvestigationLease,
} from "../../domain/investigation-lease";
import {
  InvestigationLeaseAcquireStatus,
  type InvestigationLeaseAcquireResult,
} from "../../application/ports/investigation-lease-store-port";
import {
  ContextCriticDecision,
  InvestigationObligationKind,
  InvestigationObligationState,
  InvestigationTurnProviderKind,
  ReviewInvestigationConclusion,
  ReviewInvestigationRuntimeProfile,
  ReviewInvestigationState,
  ReviewInvestigationTurnPurpose,
} from "../../domain/review-investigation-types";

/** Canonical Prisma/domain projections shared by investigation persistence. */
export function safeNumber(value: bigint, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`${field}_unsafe`);
  return number;
}

export function investigationLeaseFromRecord(
  record: PrismaLeaseRecord,
): ReviewInvestigationLease {
  const lease: ReviewInvestigationLease = Object.freeze({
    leaseId: record.leaseId,
    purpose: fromPrismaLeasePurpose(record.purpose),
    workspaceId: record.workspaceId,
    repositoryConnectionId: record.repositoryConnectionId,
    scmRepositoryIdentityId: record.scmRepositoryIdentityId,
    pullRequestNumber: record.pullRequestNumber,
    authorizationId: record.authorizationId,
    mutationEpoch: record.mutationEpoch,
    executionId: record.executionId,
    workSlotId: record.workSlotId,
    revision: {
      baseSha: record.baseSha,
      mergeBaseSha: record.mergeBaseSha,
      headSha: record.headSha,
      reviewRevisionHash: record.reviewRevisionHash,
    },
    investigationId: record.investigationId,
    investigationVersion: safeNumber(
      record.investigationVersion,
      "investigation_lease_version",
    ),
    turnId: record.turnId,
    turnPurpose: fromPrismaTurnPurpose(record.turnPurpose),
    providerVoteLaneId: record.providerVoteLaneId,
    providerStrategyId: record.providerStrategyId,
    investigationManifestCanonicalJson:
      record.investigationManifestCanonicalJson,
    investigationManifestHash: record.investigationManifestHash,
    attemptId: record.attemptId,
    acquireRequestIdHash: record.acquireRequestIdHash,
    acquireRequestHash: record.acquireRequestHash,
    lastRenewRequestIdHash: record.lastRenewRequestIdHash,
    lastRenewRequestHash: record.lastRenewRequestHash,
    lastReleaseRequestIdHash: record.lastReleaseRequestIdHash,
    lastReleaseRequestHash: record.lastReleaseRequestHash,
    ownerIdHash: record.ownerIdHash,
    leaseCapabilityId: record.leaseCapabilityId,
    capabilitySigningKeyId: record.capabilitySigningKeyId,
    fencingToken: record.fencingToken,
    state: fromPrismaLeaseState(record.state),
    acquiredAt: record.acquiredAt.toISOString(),
    renewedAt: record.renewedAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    resultReportUntil: record.resultReportUntil.toISOString(),
    retainUntil: record.retainUntil.toISOString(),
  });
  assertReviewInvestigationLease(lease);
  return lease;
}

export function toInvestigationLeaseCreate(
  lease: Omit<CreateReviewInvestigationLeaseInput, "fencingToken">,
) {
  return {
    leaseId: lease.leaseId,
    purpose: PrismaLeasePurpose.shadow_turn,
    workspaceId: lease.workspaceId,
    repositoryConnectionId: lease.repositoryConnectionId,
    scmRepositoryIdentityId: lease.scmRepositoryIdentityId,
    pullRequestNumber: lease.pullRequestNumber,
    authorizationId: lease.authorizationId,
    mutationEpoch: lease.mutationEpoch,
    executionId: lease.executionId,
    workSlotId: lease.workSlotId,
    baseSha: lease.revision.baseSha,
    mergeBaseSha: lease.revision.mergeBaseSha,
    headSha: lease.revision.headSha,
    reviewRevisionHash: lease.revision.reviewRevisionHash,
    investigationId: lease.investigationId,
    investigationVersion: BigInt(lease.investigationVersion),
    turnId: lease.turnId,
    turnPurpose: toPrismaTurnPurpose(lease.turnPurpose),
    providerVoteLaneId: lease.providerVoteLaneId,
    providerStrategyId: lease.providerStrategyId,
    investigationManifestCanonicalJson:
      lease.investigationManifestCanonicalJson,
    investigationManifestHash: lease.investigationManifestHash,
    attemptId: lease.attemptId,
    acquireRequestIdHash: lease.acquireRequestIdHash,
    acquireRequestHash: lease.acquireRequestHash,
    ownerIdHash: lease.ownerIdHash,
    leaseCapabilityId: lease.leaseCapabilityId,
    capabilitySigningKeyId: lease.capabilitySigningKeyId,
    acquiredAt: new Date(lease.acquiredAt),
    renewedAt: new Date(lease.acquiredAt),
    expiresAt: new Date(lease.expiresAt),
    resultReportUntil: new Date(lease.resultReportUntil),
    retainUntil: new Date(lease.retainUntil),
  };
}

export function toInvestigationLeaseTransitionUpdate(
  lease: ReviewInvestigationLease,
) {
  return {
    state: toPrismaLeaseState(lease.state),
    lastRenewRequestIdHash: lease.lastRenewRequestIdHash,
    lastRenewRequestHash: lease.lastRenewRequestHash,
    lastReleaseRequestIdHash: lease.lastReleaseRequestIdHash,
    lastReleaseRequestHash: lease.lastReleaseRequestHash,
    renewedAt: new Date(lease.renewedAt),
    expiresAt: new Date(lease.expiresAt),
  };
}

export function investigationLeaseAcquireResult(
  status: InvestigationLeaseAcquireStatus,
  lease: ReviewInvestigationLease | null,
): InvestigationLeaseAcquireResult {
  return Object.freeze({ status, lease });
}

const runtimeProfileToPrisma: Readonly<
  Record<ReviewInvestigationRuntimeProfile, PrismaRuntimeProfile>
> = {
  [ReviewInvestigationRuntimeProfile.GatewayAttestedAgentV1]:
    PrismaRuntimeProfile.gateway_attested_agent_v1,
  [ReviewInvestigationRuntimeProfile.OrchestratedToolLoopV1]:
    PrismaRuntimeProfile.orchestrated_tool_loop_v1,
  [ReviewInvestigationRuntimeProfile.PreassembledContextV1]:
    PrismaRuntimeProfile.preassembled_context_v1,
  [ReviewInvestigationRuntimeProfile.PromptOnlyV1]:
    PrismaRuntimeProfile.prompt_only_v1,
  [ReviewInvestigationRuntimeProfile.AgenticUnboundedV1]:
    PrismaRuntimeProfile.agentic_unbounded_v1,
};
const investigationStateToPrisma: Readonly<
  Record<ReviewInvestigationState, PrismaInvestigationState>
> = {
  [ReviewInvestigationState.Provisional]: PrismaInvestigationState.provisional,
  [ReviewInvestigationState.AwaitingTurn]:
    PrismaInvestigationState.awaiting_turn,
  [ReviewInvestigationState.TurnLeased]: PrismaInvestigationState.turn_leased,
  [ReviewInvestigationState.AwaitingCritic]:
    PrismaInvestigationState.awaiting_critic,
  [ReviewInvestigationState.ReadyToConclude]:
    PrismaInvestigationState.ready_to_conclude,
  [ReviewInvestigationState.Concluded]: PrismaInvestigationState.concluded,
  [ReviewInvestigationState.Inconclusive]:
    PrismaInvestigationState.inconclusive,
  [ReviewInvestigationState.Superseded]: PrismaInvestigationState.superseded,
  [ReviewInvestigationState.Expired]: PrismaInvestigationState.expired,
};
const obligationStateToPrisma: Readonly<
  Record<InvestigationObligationState, PrismaObligationState>
> = {
  [InvestigationObligationState.Open]: PrismaObligationState.open,
  [InvestigationObligationState.Satisfied]: PrismaObligationState.satisfied,
  [InvestigationObligationState.Unresolvable]:
    PrismaObligationState.unresolvable,
};
const obligationKindToPrisma: Readonly<
  Record<InvestigationObligationKind, PrismaObligationKind>
> = {
  [InvestigationObligationKind.InventoryWitness]:
    PrismaObligationKind.inventory_witness,
  [InvestigationObligationKind.ChangedContent]:
    PrismaObligationKind.changed_content,
  [InvestigationObligationKind.BaseContent]: PrismaObligationKind.base_content,
  [InvestigationObligationKind.RelatedManifest]:
    PrismaObligationKind.related_manifest,
  [InvestigationObligationKind.DirectReferenceSearch]:
    PrismaObligationKind.direct_reference_search,
  [InvestigationObligationKind.DirectCaller]:
    PrismaObligationKind.direct_caller,
  [InvestigationObligationKind.DirectCallee]:
    PrismaObligationKind.direct_callee,
  [InvestigationObligationKind.TestEvidence]:
    PrismaObligationKind.test_evidence,
  [InvestigationObligationKind.SchemaContract]:
    PrismaObligationKind.schema_contract,
  [InvestigationObligationKind.ConfigurationContract]:
    PrismaObligationKind.configuration_contract,
  [InvestigationObligationKind.MigrationContract]:
    PrismaObligationKind.migration_contract,
  [InvestigationObligationKind.GeneratedSource]:
    PrismaObligationKind.generated_source,
  [InvestigationObligationKind.DependencyContract]:
    PrismaObligationKind.dependency_contract,
  [InvestigationObligationKind.SideEffectParity]:
    PrismaObligationKind.side_effect_parity,
  [InvestigationObligationKind.ExternalContract]:
    PrismaObligationKind.external_contract,
  [InvestigationObligationKind.BinaryArtifact]:
    PrismaObligationKind.binary_artifact,
  [InvestigationObligationKind.FindingRevalidation]:
    PrismaObligationKind.finding_revalidation,
  [InvestigationObligationKind.ContextCritic]:
    PrismaObligationKind.context_critic,
};
const obligationOriginToPrisma: Readonly<
  Record<InvestigationObligationOrigin, PrismaObligationOrigin>
> = {
  [InvestigationObligationOrigin.CoverageContract]:
    PrismaObligationOrigin.coverage_contract,
  [InvestigationObligationOrigin.DeterministicExpansion]:
    PrismaObligationOrigin.deterministic_expansion,
  [InvestigationObligationOrigin.AgentProposal]:
    PrismaObligationOrigin.agent_proposal,
  [InvestigationObligationOrigin.CriticProposal]:
    PrismaObligationOrigin.critic_proposal,
};
const receiptKindToPrisma: Readonly<
  Record<InvestigationReceiptKind, PrismaReceiptKind>
> = {
  [InvestigationReceiptKind.Blob]: PrismaReceiptKind.blob,
  [InvestigationReceiptKind.Tree]: PrismaReceiptKind.tree,
  [InvestigationReceiptKind.Search]: PrismaReceiptKind.search,
  [InvestigationReceiptKind.GitFact]: PrismaReceiptKind.git_fact,
  [InvestigationReceiptKind.Relation]: PrismaReceiptKind.relation,
  [InvestigationReceiptKind.Critic]: PrismaReceiptKind.critic,
};
const turnPurposeToPrisma: Readonly<
  Record<ReviewInvestigationTurnPurpose, PrismaTurnPurpose>
> = {
  [ReviewInvestigationTurnPurpose.Discovery]: PrismaTurnPurpose.discovery,
  [ReviewInvestigationTurnPurpose.Critic]: PrismaTurnPurpose.critic,
};
const leasePurposeToPrisma: Readonly<
  Record<ReviewInvestigationLeasePurpose, PrismaLeasePurpose>
> = {
  [ReviewInvestigationLeasePurpose.ShadowTurn]: PrismaLeasePurpose.shadow_turn,
};
const leaseStateToPrisma: Readonly<
  Record<ReviewInvestigationLeaseState, PrismaLeaseState>
> = {
  [ReviewInvestigationLeaseState.Active]: PrismaLeaseState.active,
  [ReviewInvestigationLeaseState.Released]: PrismaLeaseState.released,
  [ReviewInvestigationLeaseState.Expired]: PrismaLeaseState.expired,
  [ReviewInvestigationLeaseState.Revoked]: PrismaLeaseState.revoked,
};
const criticDecisionToPrisma: Readonly<
  Record<ContextCriticDecision, PrismaCriticDecision>
> = {
  [ContextCriticDecision.Accept]: PrismaCriticDecision.accept,
  [ContextCriticDecision.Veto]: PrismaCriticDecision.veto,
  [ContextCriticDecision.Abstain]: PrismaCriticDecision.abstain,
};
const conclusionToPrisma: Readonly<
  Record<ReviewInvestigationConclusion, PrismaConclusion>
> = {
  [ReviewInvestigationConclusion.VerifiedClean]:
    PrismaConclusion.verified_clean,
  [ReviewInvestigationConclusion.Findings]: PrismaConclusion.findings,
  [ReviewInvestigationConclusion.Inconclusive]: PrismaConclusion.inconclusive,
};

const runtimeProfileFromPrisma = invertEnumMap(runtimeProfileToPrisma);
const investigationStateFromPrisma = invertEnumMap(investigationStateToPrisma);
const obligationStateFromPrisma = invertEnumMap(obligationStateToPrisma);
const obligationKindFromPrisma = invertEnumMap(obligationKindToPrisma);
const obligationOriginFromPrisma = invertEnumMap(obligationOriginToPrisma);
const receiptKindFromPrisma = invertEnumMap(receiptKindToPrisma);
const turnPurposeFromPrisma = invertEnumMap(turnPurposeToPrisma);
const leasePurposeFromPrisma = invertEnumMap(leasePurposeToPrisma);
const leaseStateFromPrisma = invertEnumMap(leaseStateToPrisma);
const criticDecisionFromPrisma = invertEnumMap(criticDecisionToPrisma);
const conclusionFromPrisma = invertEnumMap(conclusionToPrisma);

export const toPrismaRuntimeProfile = (value: ReviewInvestigationRuntimeProfile) =>
  runtimeProfileToPrisma[value];
export const fromPrismaRuntimeProfile = (value: PrismaRuntimeProfile) =>
  runtimeProfileFromPrisma[value];
export const toPrismaInvestigationState = (value: ReviewInvestigationState) =>
  investigationStateToPrisma[value];
export const fromPrismaInvestigationState = (value: PrismaInvestigationState) =>
  investigationStateFromPrisma[value];
export const toPrismaObligationState = (value: InvestigationObligationState) =>
  obligationStateToPrisma[value];
export const fromPrismaObligationState = (value: PrismaObligationState) =>
  obligationStateFromPrisma[value];
export const toPrismaObligationKind = (value: InvestigationObligationKind) =>
  obligationKindToPrisma[value];
export const fromPrismaObligationKind = (value: PrismaObligationKind) =>
  obligationKindFromPrisma[value];
export const toPrismaObligationOrigin = (value: InvestigationObligationOrigin) =>
  obligationOriginToPrisma[value];
export const fromPrismaObligationOrigin = (value: PrismaObligationOrigin) =>
  obligationOriginFromPrisma[value];
export const toPrismaReceiptKind = (value: InvestigationReceiptKind) =>
  receiptKindToPrisma[value];
export const fromPrismaReceiptKind = (value: PrismaReceiptKind) =>
  receiptKindFromPrisma[value];
export const toPrismaTurnPurpose = (value: ReviewInvestigationTurnPurpose) =>
  turnPurposeToPrisma[value];
export const fromPrismaTurnPurpose = (value: PrismaTurnPurpose) =>
  turnPurposeFromPrisma[value];
export const toPrismaLeaseState = (value: ReviewInvestigationLeaseState) =>
  leaseStateToPrisma[value];
export const fromPrismaLeaseState = (value: PrismaLeaseState) =>
  leaseStateFromPrisma[value];
export const fromPrismaLeasePurpose = (value: PrismaLeasePurpose) =>
  leasePurposeFromPrisma[value];
export const toPrismaCriticDecision = (value: ContextCriticDecision) =>
  criticDecisionToPrisma[value];
export const fromPrismaCriticDecision = (value: PrismaCriticDecision) =>
  criticDecisionFromPrisma[value];
export const toPrismaConclusion = (value: ReviewInvestigationConclusion) =>
  conclusionToPrisma[value];
export const fromPrismaConclusion = (value: PrismaConclusion) =>
  conclusionFromPrisma[value];

export function parseTerminalProviderKind(
  value: string,
): InvestigationTurnProviderKind {
  if (
    value === InvestigationTurnProviderKind.Codex ||
    value === InvestigationTurnProviderKind.ClaudeCode
  ) {
    return value;
  }
  throw new Error("investigation_terminal_provider_kind_invalid");
}

function invertEnumMap<DomainValue extends string, PrismaValue extends string>(
  mapping: Readonly<Record<DomainValue, PrismaValue>>,
): Readonly<Record<PrismaValue, DomainValue>> {
  const inverse = Object.create(null) as Record<PrismaValue, DomainValue>;
  for (const [domainValue, prismaValue] of Object.entries(mapping) as Array<
    [DomainValue, PrismaValue]
  >) {
    if (inverse[prismaValue] !== undefined) {
      throw new Error("investigation_prisma_enum_mapping_not_bijective");
    }
    inverse[prismaValue] = domainValue;
  }
  return Object.freeze(inverse);
}
