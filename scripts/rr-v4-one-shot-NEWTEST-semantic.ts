import { createHash } from "node:crypto";
import {
  canonicalizeReviewActionV2Request,
  parseReviewActionV2Request,
  ReviewActionV2OperationId as Op,
  type ReviewActionV2RequestMap,
} from "../packages/protocol-review-action-v2/src/index.js";
import {
  parseInvestigationTurnObservation,
  canonicalInvestigationTurnObservation,
  canonicalInvestigationTerminalObservation,
  type InvestigationTurnObservation,
} from "../packages/features/review-investigations/src/domain/investigation-turn-observation.js";
import { canonicalJson } from "../packages/features/review-investigations/src/domain/canonicalization.js";
import { prepareInvestigationShadowTerminalPayload } from "../packages/features/review-evidence/src/domain/investigation-shadow-evidence.js";
import { reviewReuseEligibilityPolicyVersion } from "../packages/features/review-evidence/src/domain/review-reuse-eligibility.js";
import { ReviewObservationQualityFlag } from "../packages/features/review-evidence/src/domain/review-evidence-primitives.js";
import { decodeDirectForkResponses } from "../packages/features/codex-oauth-rotating/src/action/direct-fork-responses.js";
import type {
  Approval,
  CanaryInput,
  NewtestResponsesBody,
} from "./rr-v4-one-shot-NEWTEST-consumer.js";

type Result = Readonly<Record<string, unknown>>;
type Usage = InvestigationTurnObservation["usage"];
/** Implement with the supported PURE strict Responses decoder, not a transport
 * callback or caller-owned 'fullyConsumed' boolean. The default is the existing
 * supported pure strict decoder, never a network/auth wrapper. */
export type MeasuredResponsesDecoder = (input: {
  body: Uint8Array;
  contentType: string | null;
}) => {
  responseId: string;
  model: string;
  usage: Usage;
  outputText: string;
  responseBytes: number;
};
type Binding = {
  approval: Approval;
  invocationId: string;
  dossierVersion: number;
  runtimeProfile: InvestigationTurnObservation["runtimeProfile"];
  gatewaySessionId: string;
};
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function assert(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
function text(value: unknown): string {
  assert(
    typeof value === "string" && value.length > 0,
    "newtest_semantic_receipt_missing",
  );
  return value;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requiredReceipt(
  receipts: Readonly<Record<string, Result>>,
  phase: string,
): Result {
  const value = receipts[phase];
  assert(object(value), "newtest_semantic_required_prior_receipt_missing");
  return value;
}
function request<T extends Op>(
  op: T,
  value: ReviewActionV2RequestMap[T],
): ReviewActionV2RequestMap[T] {
  const zero = { ...value, requestBodyHash: "0".repeat(64) };
  const result = {
    ...zero,
    requestBodyHash: hash(canonicalizeReviewActionV2Request(op, zero)),
  };
  assert(
    parseReviewActionV2Request(op, result).ok,
    "newtest_semantic_request_invalid",
  );
  return result;
}

/** The model emits semantic fields only. All provenance, usage, duration and
 * completion facts come from bound inputs / the real strict decoder. Discovery
 * findings must be genuine and operation-backed; server closure/evidence policy
 * still decides whether they and the actual required obligations are accepted. */
export function compileMeasuredDiscovery(input: {
  binding: Binding;
  response: NewtestResponsesBody;
  decode?: MeasuredResponsesDecoder;
}): InvestigationTurnObservation {
  const measured = (input.decode ?? decodeDirectForkResponses)({
    body: input.response.bytes,
    contentType: input.response.contentType,
  });
  assert(
    measured.responseBytes === input.response.bytes.length &&
      measured.responseId &&
      measured.model,
    "newtest_measured_response_invalid",
  );
  assert(
    Number.isSafeInteger(input.response.durationMs) &&
      input.response.durationMs > 0,
    "newtest_measured_duration_invalid",
  );
  const semantic: unknown = JSON.parse(measured.outputText);
  assert(object(semantic), "newtest_semantic_output_invalid");
  const keys = [
    "outputVersion",
    "findings",
    "obligationProposals",
    "closureClaims",
    "operationBackedDiscoveryClaims",
    "unresolvableClaims",
    "criticDecision",
  ].sort();
  assert(
    JSON.stringify(Object.keys(semantic).sort()) === JSON.stringify(keys),
    "newtest_semantic_output_shape_invalid",
  );
  // This bounded consumer never turns discovery output into a fabricated critic.
  assert(
    semantic.criticDecision === null,
    "newtest_discovery_cannot_claim_critic",
  );
  const observation = parseInvestigationTurnObservation({
    ...semantic,
    observationVersion: 2,
    invocationId: input.binding.invocationId,
    turnId: input.binding.approval.turnId,
    dossierVersion: input.binding.dossierVersion,
    purpose: "discovery",
    actualProviderKind: "codex",
    actualModel: measured.model,
    runtimeProfile: input.binding.runtimeProfile,
    usage: measured.usage,
    durationMs: input.response.durationMs,
    schemaComplete: true,
    streamComplete: true,
    // Not an accepted attestation claim. Terminal encoding deliberately replaces
    // it with null. The genuine accepted ID is inserted only after successful seal.
    contextAttestationReference: input.binding.gatewaySessionId,
  });
  assert(
    observation.findings.length > 0 &&
      observation.findings.every(
        (f) => f.evidenceOperationReceiptIds.length > 0,
      ),
    "newtest_operation_backed_finding_required",
  );
  return observation;
}

export type SemanticCompilerInputs = {
  binding: Binding;
  decode?: MeasuredResponsesDecoder;
  /** Genuine current capabilities/session and captured transcript/replay material;
   * no synthetic context receipts. Other identity fields remain caller-bound. */
  seal: ReviewActionV2RequestMap[Op.ReviewInvestigationRelayContextGatewaySeal];
  commitTurn: ReviewActionV2RequestMap[Op.ReviewInvestigationTurnCommit];
  conclude: ReviewActionV2RequestMap[Op.ReviewInvestigationConclude];
  commitEvidence: ReviewActionV2RequestMap[Op.ReviewEvidenceCommit];
  attach: ReviewActionV2RequestMap[Op.ReviewExecutionObservationAttach];
  publicationRequest: ReviewActionV2RequestMap[Op.ReviewPublicationRequest];
  /** Existing trusted projection builder from actual authoritative observation.
   * Its result is still checked by ordinary server finalization. No new projector. */
  finalize(input: {
    certificate: Result;
    acceptedObservation: Result;
    attached: Result;
  }): ReviewActionV2RequestMap[Op.ReviewExecutionFinalize];
};

export function createNewtestSemanticCompiler(
  supplied: SemanticCompilerInputs,
): CanaryInput["buildRequest"] {
  const bindings = {
    ...supplied,
    binding: structuredClone(supplied.binding),
    seal: structuredClone(supplied.seal),
    commitTurn: structuredClone(supplied.commitTurn),
    conclude: structuredClone(supplied.conclude),
    commitEvidence: structuredClone(supplied.commitEvidence),
    attach: structuredClone(supplied.attach),
    publicationRequest: structuredClone(supplied.publicationRequest),
  };
  let measured: InvestigationTurnObservation | undefined;
  let terminal:
    | ReturnType<typeof prepareInvestigationShadowTerminalPayload>
    | undefined;
  let finalRequest:
    | ReviewActionV2RequestMap[Op.ReviewExecutionFinalize]
    | undefined;
  return (phase, receipts, response) => {
    if (phase === "seal") {
      measured = compileMeasuredDiscovery({
        binding: bindings.binding,
        response,
        ...(bindings.decode ? { decode: bindings.decode } : {}),
      });
      assert(
        bindings.seal.sessionId === bindings.binding.gatewaySessionId &&
          bindings.seal.sourceLeaseId ===
            bindings.binding.approval.investigationLeaseId &&
          bindings.seal.sourceLeaseAuthorityKind === "investigation_relay",
        "newtest_gateway_binding_mismatch",
      );
      return request(Op.ReviewInvestigationRelayContextGatewaySeal, {
        ...bindings.seal,
        actualModel: measured.actualModel,
        providerSucceeded: true,
        schemaValidated: true,
        fullyConsumed: true,
        terminalOutcomeHash: hash(
          canonicalInvestigationTerminalObservation(measured),
        ),
      });
    }
    assert(measured, "newtest_measured_discovery_missing");
    if (phase === "commitTurn") {
      assert(
        requiredReceipt(receipts, "seal").status === "accepted" ||
          requiredReceipt(receipts, "seal").status === "idempotent",
        "newtest_actual_seal_missing",
      );
      const observation = parseInvestigationTurnObservation({
        ...measured,
        contextAttestationReference: text(
          requiredReceipt(receipts, "seal").attestationId,
        ),
      });
      const canonical = canonicalInvestigationTurnObservation(observation);
      return request(Op.ReviewInvestigationTurnCommit, {
        ...bindings.commitTurn,
        expectedVersion: String(observation.dossierVersion),
        acceptedAttestationId: text(
          requiredReceipt(receipts, "seal").attestationId,
        ),
        acceptedAttestationHash: text(
          requiredReceipt(receipts, "seal").attestationHash,
        ),
        turnObservationCanonicalJson: canonical,
        turnObservationHash: hash(canonical),
      });
    }
    if (phase === "conclude") {
      assert(
        requiredReceipt(receipts, "commitTurn").investigationState ===
          "ready_to_conclude",
        "newtest_actual_investigation_not_ready_to_conclude",
      );
      return request(Op.ReviewInvestigationConclude, {
        ...bindings.conclude,
        expectedVersion: text(
          requiredReceipt(receipts, "commitTurn").investigationVersion,
        ),
        dossierDigest: text(
          requiredReceipt(receipts, "commitTurn").dossierDigest,
        ),
      });
    }
    if (phase === "commitEvidence") {
      assert(
        requiredReceipt(receipts, "conclude").investigationConclusion ===
          "findings" &&
          requiredReceipt(receipts, "conclude").terminalActualModel ===
            measured.actualModel &&
          requiredReceipt(receipts, "conclude").terminalProviderKind ===
            "codex",
        "newtest_actual_certificate_provenance_invalid",
      );
      terminal = prepareInvestigationShadowTerminalPayload(
        text(
          requiredReceipt(receipts, "conclude")
            .terminalObservationCanonicalJson,
        ),
      );
      assert(
        terminal.findingCount > 0 &&
          hash(terminal.canonicalBytes) ===
            requiredReceipt(receipts, "conclude").terminalOutcomeHash,
        "newtest_actual_certificate_payload_invalid",
      );
      assert(
        bindings.commitEvidence.sourceLeaseId ===
          bindings.binding.approval.invocationLeaseId,
        "newtest_invocation_evidence_binding_mismatch",
      );
      return request(Op.ReviewEvidenceCommit, {
        ...bindings.commitEvidence,
        completionStatus: "success",
        schemaValidated: true,
        fullyConsumed: true,
        actualModel: measured.actualModel,
        contextDependencyAttestationId: null,
        contextDependencyAttestationHash: null,
        investigationCertificateId: text(
          requiredReceipt(receipts, "conclude").certificateId,
        ),
        investigationCertificateHash: text(
          requiredReceipt(receipts, "conclude").certificateHash,
        ),
        payloadCanonicalJson: terminal.canonicalJson,
        payloadHash: hash(terminal.canonicalBytes),
        qualityFlags: [ReviewObservationQualityFlag.InvestigationFindings],
        transportAttemptCount: 1,
      });
    }
    assert(terminal, "newtest_actual_terminal_payload_missing");
    if (phase === "attach")
      return request(Op.ReviewExecutionObservationAttach, {
        ...bindings.attach,
        observationId: text(
          requiredReceipt(receipts, "commitEvidence").observationId,
        ),
        payloadHash: hash(terminal.canonicalBytes),
        byteCount: terminal.byteCount,
        findingCount: terminal.findingCount,
        eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      });
    if (phase === "finalize") {
      finalRequest = bindings.finalize({
        certificate: requiredReceipt(receipts, "conclude"),
        acceptedObservation: requiredReceipt(receipts, "commitEvidence"),
        attached: requiredReceipt(receipts, "attach"),
      });
      return request(Op.ReviewExecutionFinalize, finalRequest);
    }
    assert(
      finalRequest && phase === "requestPublication",
      "newtest_actual_finalization_missing",
    );
    const envelope: unknown = JSON.parse(
      finalRequest.projectionEnvelopeCanonicalJson,
    );
    assert(
      object(envelope) && object(envelope.publishing),
      "newtest_actual_publishing_projection_missing",
    );
    return request(Op.ReviewPublicationRequest, {
      ...bindings.publicationRequest,
      publicationPermit: text(
        requiredReceipt(receipts, "finalize").publicationPermit,
      ),
      projectionHash: finalRequest.projectionHash,
      operationsCanonicalJson: canonicalJson(envelope.publishing),
    });
  };
}
