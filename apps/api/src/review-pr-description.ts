import { ReviewActionV2RouteFailure } from "@reviewrouter/features-action-control-plane/v2";
import {
  parseReviewConfigurationStrict,
  type ReviewProviderConfiguration,
} from "@reviewrouter/features-review-config";
import {
  ProviderExecutionProfile,
  ReviewTaskKind as EvidenceTaskKind,
  normalizeProviderInvocationManifest,
  type ProviderInvocationManifest,
} from "@reviewrouter/features-review-evidence";
import {
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewTaskKind,
  type ReviewExecution,
  type ReviewExecutionQueryPort,
  type ReviewWorkSlotPlan,
} from "@reviewrouter/features-review-executions";
import {
  parseReviewRunRuntimeSnapshot,
  reviewAgentExecutionProviderKind,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  prDescriptionExtensionV1,
  ReviewActionV2ProtocolErrorCode,
} from "@reviewrouter/protocol-review-action-v2";
import {
  prDescriptionContract,
  type GeneratedPrDescription,
} from "@reviewrouter/shared";

function requireFact(value: unknown, issue: string): asserts value {
  if (!value) {
    throw new ReviewActionV2RouteFailure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      [issue],
    );
  }
}

type DescriptionAuthorization = Pick<
  ReviewRunAuthorization,
  "runtimeSnapshotCanonicalJson" | "providerVoteLanes"
>;

function primary(authorization: DescriptionAuthorization): {
  provider: ReviewProviderConfiguration;
  providerKind: string;
} {
  const snapshot = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  requireFact(snapshot, "pr_description_capture_required");
  requireFact(
    snapshot.prDescriptionCapability?.extensionId ===
      prDescriptionExtensionV1.extensionId &&
      snapshot.prDescriptionCapability.canonicalizerDigest ===
        prDescriptionExtensionV1.canonicalizerDigest,
    "pr_description_producer_unavailable",
  );
  const config = parseReviewConfigurationStrict(
    JSON.parse(snapshot.configurationCanonicalJson),
  );
  const provider = config.providers[0];
  requireFact(
    config.updatePrDescription !== false &&
      config.providers.length === 1 &&
      provider &&
      (provider.authMode === "codex_account_gateway" ||
        provider.authMode === "openrouter_api_key"),
    "pr_description_connection_unavailable",
  );
  return {
    provider,
    providerKind: reviewAgentExecutionProviderKind(snapshot.agent),
  };
}

/** Reserve one non-voting auxiliary invocation in the original admitted plan. */
export function assertPrDescriptionWorkSlots(
  authorization: DescriptionAuthorization,
  slots: readonly ReviewWorkSlotPlan[],
): void {
  const descriptions = slots.filter(
    (slot) => slot.taskKind === ReviewTaskKind.PrDescription,
  );
  if (descriptions.length === 0) return;
  requireFact(descriptions.length === 1, "pr_description_slot_count_invalid");
  const selected = primary(authorization);
  const slot = descriptions[0]!;
  requireFact(
    !slot.required &&
      slot.attemptBudget === prDescriptionContract.attemptBudget &&
      slot.providerKind === selected.providerKind &&
      authorization.providerVoteLanes.some(
        (lane) =>
          lane.providerKind === selected.providerKind &&
          lane.providerVoteIdentityHash === slot.providerVoteIdentityHash,
      ),
    "pr_description_slot_authority_invalid",
  );
}

export function assertPrDescriptionManifest(
  authorization: DescriptionAuthorization,
  slot: ReviewWorkSlotPlan,
  manifest: ProviderInvocationManifest,
): void {
  if (slot.taskKind !== ReviewTaskKind.PrDescription) return;
  assertPrDescriptionWorkSlots(authorization, [slot]);
  const selected = primary(authorization);
  requireFact(
    manifest.taskKindSet.length === 1 &&
      manifest.taskKindSet[0] === EvidenceTaskKind.PrDescription &&
      manifest.requestedModel === selected.provider.model &&
      manifest.providerPolicyVersion === "pr-description-provider-policy.v1" &&
      manifest.executionProfile ===
        ProviderExecutionProfile.PromptOnlyEnvelopeV1,
    "pr_description_manifest_invalid",
  );
}

export function assertNotPrDescriptionEvidence(
  execution: ReviewExecution,
  workSlotId: string,
): void {
  requireFact(
    execution.workSlots.find((slot) => slot.workSlotId === workSlotId)
      ?.taskKind !== ReviewTaskKind.PrDescription,
    "pr_description_is_not_review_evidence",
  );
}

/** No coercion/defaults: this payload is part of the finalized canonical hash. */
export function parseGeneratedPrDescription(
  value: unknown,
): GeneratedPrDescription {
  requireFact(isRecord(value), "pr_description_invalid");
  exactKeys(value, ["generatedMarkdown", "generationProvenance"]);
  const markdown = value.generatedMarkdown;
  requireFact(
    typeof markdown === "string" &&
      markdown.trim().length > 0 &&
      new TextEncoder().encode(markdown).byteLength <=
        prDescriptionContract.maxGeneratedMarkdownBytes &&
      !/<!--\s*\/?(?:review-router-summary|ai-robot-review-summary)\b/i.test(
        markdown,
      ),
    "pr_description_markdown_invalid",
  );
  const provenance = value.generationProvenance;
  requireFact(isRecord(provenance), "pr_description_provenance_invalid");
  exactKeys(provenance, [
    "leaseId",
    "providerIndex",
    "requestedModel",
    "actualModel",
    "providerRequestEnvelopeHash",
  ]);
  requireFact(
    typeof provenance.leaseId === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(provenance.leaseId) &&
      provenance.providerIndex === 0 &&
      typeof provenance.requestedModel === "string" &&
      provenance.requestedModel.length > 0 &&
      provenance.requestedModel.length <= 1024 &&
      typeof provenance.actualModel === "string" &&
      provenance.actualModel === provenance.requestedModel &&
      typeof provenance.providerRequestEnvelopeHash === "string" &&
      /^[a-f0-9]{64}$/.test(provenance.providerRequestEnvelopeHash),
    "pr_description_provenance_invalid",
  );
  return {
    generatedMarkdown: markdown,
    generationProvenance: {
      leaseId: provenance.leaseId,
      providerIndex: 0,
      requestedModel: provenance.requestedModel,
      actualModel: provenance.actualModel,
      providerRequestEnvelopeHash: provenance.providerRequestEnvelopeHash,
    },
  };
}

/** Bind optional prose to its real, released auxiliary lease before finalizing. */
export async function assertPrDescriptionArtifact(input: {
  authorization: ReviewRunAuthorization;
  execution: ReviewExecution;
  leases: Partial<Pick<ReviewExecutionQueryPort, "findLease">>;
  projection: unknown;
}): Promise<void> {
  if (
    !isRecord(input.projection) ||
    !isRecord(input.projection.publishing) ||
    input.projection.publishing.prDescription === undefined
  )
    return;
  const description = parseGeneratedPrDescription(
    input.projection.publishing.prDescription,
  );
  requireFact(input.leases.findLease, "pr_description_lease_query_unavailable");
  assertPrDescriptionWorkSlots(input.authorization, input.execution.workSlots);
  const selected = primary(input.authorization);
  const provenance = description.generationProvenance;
  const lease = await input.leases.findLease(provenance.leaseId);
  requireFact(lease, "pr_description_lease_missing");
  const slot = input.execution.workSlots.find(
    (row) => row.workSlotId === lease.workSlotId,
  );
  requireFact(
    slot?.taskKind === ReviewTaskKind.PrDescription &&
      lease.executionId === input.execution.executionId &&
      lease.authorizationId === input.authorization.authorizationId &&
      lease.producerReleaseId === input.authorization.producerReleaseId &&
      lease.reviewRevisionHash === input.authorization.reviewRevisionHash &&
      lease.providerVoteIdentityHash === slot.providerVoteIdentityHash &&
      lease.purpose === ReviewInvocationLeasePurpose.ProviderExecution &&
      lease.state === ReviewInvocationLeaseState.Released &&
      lease.attemptOrdinal === 1 &&
      lease.sourceObservationId === null &&
      lease.preparedManifestCanonicalJson !== null &&
      provenance.requestedModel === selected.provider.model,
    "pr_description_lease_authority_invalid",
  );
  const manifest = normalizeProviderInvocationManifest(
    JSON.parse(lease.preparedManifestCanonicalJson),
  );
  assertPrDescriptionManifest(input.authorization, slot, manifest);
  requireFact(
    manifest.providerRequestEnvelopeHash ===
      provenance.providerRequestEnvelopeHash,
    "pr_description_envelope_mismatch",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  requireFact(
    Object.keys(value).sort().join(",") === [...expected].sort().join(","),
    "pr_description_shape_invalid",
  );
}
