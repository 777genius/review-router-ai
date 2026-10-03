import { createHash } from "node:crypto";
import {
  canonicalizeReviewActionV2Request,
  parseReviewActionV2Request,
  reviewActionV2Operations,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  ReviewActionV2OperationId as Op,
  type ReviewActionV2RequestMap,
} from "../packages/protocol-review-action-v2/src/index.js";

/** Import-only NEWTEST consumer. No env/auth discovery, CLI, retry or fallback. */
export const publicationGap =
  "newtest_exclusive_publication_admission_unimplemented";
export type Approval = Readonly<{
  purpose: "owner_one_shot_uncapped_test";
  repositoryGitHubId: "1252762369";
  testIdentityId: string;
  ownerIdHash: string;
  approvalId: string;
  authorizationId: string;
  investigationId: string;
  turnId: string;
  logicalTurnKey: string;
  grantId: string;
  executionId: string;
  workSlotId: string;
  invocationLeaseId: string;
  investigationLeaseId: string;
  producerReleaseId: string;
  sourceSha: string;
  runtimeHash: string;
  headSha: string;
  reviewRevisionHash: string;
  requestIdempotencyKey: string;
  requestBodySha256: string;
  publicationIntentId: string;
  expiresAt: string;
}>;
type Result = Readonly<Record<string, unknown>>;
export type NewtestResponsesBody = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  durationMs: number;
}>;
export type PublicationBinding = Readonly<{
  publicationAttemptId: string;
  planHash: string;
  operations: readonly Readonly<{
    publicationOperationId: string;
    operationHash: string;
    dependsOnOperationId: string | null;
    required: boolean;
  }>[];
}>;
type Phase =
  | "seal"
  | "commitTurn"
  | "conclude"
  | "commitEvidence"
  | "attach"
  | "finalize"
  | "requestPublication";
const phaseOperations = {
  seal: Op.ReviewInvestigationRelayContextGatewaySeal,
  commitTurn: Op.ReviewInvestigationTurnCommit,
  conclude: Op.ReviewInvestigationConclude,
  commitEvidence: Op.ReviewEvidenceCommit,
  attach: Op.ReviewExecutionObservationAttach,
  finalize: Op.ReviewExecutionFinalize,
  requestPublication: Op.ReviewPublicationRequest,
} as const;

/** Trusted core adapter, NOT an approval flag accepted from a caller's JSON.
 * Qualify support BEFORE provider dispatch, then derive and durably exclude the
 * measured final artifact's exact attempt BEFORE enqueue. No future artifact
 * or attempt hash is fabricated during qualification. */
export interface ExclusivePublicationPort {
  qualify(approval: Approval, approvalHash: string): Promise<void>;
  admit(input: {
    approval: Approval;
    approvalHash: string;
    artifactId: string;
    artifactHash: string;
    publicationPermit: string;
    publicationRequest: ReviewActionV2RequestMap[Op.ReviewPublicationRequest];
  }): Promise<PublicationBinding>;
  executeOnce(input: {
    approval: Approval;
    artifactId: string;
    artifactHash: string;
    publicationPermit: string;
    binding: PublicationBinding;
  }): Promise<{
    outcome: "completed" | "unknown";
    publicationAttemptId: string;
    planHash: string;
    completedRequiredOperationIds: readonly string[];
    canonicalReceiptSetHash?: string;
  }>;
}
export const unavailableExclusivePublication: ExclusivePublicationPort = {
  qualify: async () => {
    throw new Error(publicationGap);
  },
  admit: async () => {
    throw new Error(publicationGap);
  },
  executeOnce: async () => {
    throw new Error(publicationGap);
  },
};

export function approvalHash(approval: Approval): string {
  return sha(
    JSON.stringify(
      Object.fromEntries(
        Object.entries(approval).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );
}
const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function requireThat(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
function string(value: unknown, reason: string): string {
  requireThat(typeof value === "string" && value.length > 0, reason);
  return value;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requiredReceipt(
  receipts: Readonly<Record<string, Result>>,
  phase: string,
): Result {
  const value = receipts[phase];
  requireThat(record(value), "newtest_required_prior_receipt_missing");
  return value;
}
function validateApproval(
  a: Approval,
  expectedHash: string,
  body: string,
  now: number,
) {
  requireThat(
    a.purpose === "owner_one_shot_uncapped_test" &&
      a.repositoryGitHubId === "1252762369",
    "newtest_approval_scope_invalid",
  );
  requireThat(
    Object.values(a).every((v) => typeof v === "string" && v.length > 0),
    "newtest_approval_binding_missing",
  );
  requireThat(
    a.invocationLeaseId !== a.investigationLeaseId,
    "newtest_distinct_leases_required",
  );
  requireThat(
    /^[a-f0-9]{40}$/.test(a.sourceSha) && /^[a-f0-9]{40}$/.test(a.headSha),
    "newtest_source_invalid",
  );
  requireThat(
    [
      a.runtimeHash,
      a.reviewRevisionHash,
      a.requestBodySha256,
      expectedHash,
    ].every((h) => /^[a-f0-9]{64}$/.test(h)),
    "newtest_hash_invalid",
  );
  requireThat(
    approvalHash(a) === expectedHash && sha(body) === a.requestBodySha256,
    "newtest_approval_hash_mismatch",
  );
  requireThat(
    Number.isFinite(Date.parse(a.expiresAt)) && Date.parse(a.expiresAt) > now,
    "newtest_approval_expired",
  );
}

/** One HTTP call per invocation; generated request validation/body hashing is
 * reused rather than duplicating Action-v2 request protocol rules. */
export function createNewtestActionClient(input: {
  apiOrigin: string;
  fetch: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}) {
  const origin = new URL(input.apiOrigin);
  requireThat(
    origin.protocol === "https:" &&
      origin.pathname === "/" &&
      !origin.username &&
      !origin.password &&
      !origin.search &&
      !origin.hash,
    "newtest_origin_invalid",
  );
  const maxBytes = input.maxResponseBytes ?? 2_000_000;
  requireThat(
    Number.isSafeInteger(maxBytes) && maxBytes > 0,
    "newtest_response_limit_invalid",
  );
  async function readBytes(response: Response): Promise<Uint8Array> {
    const reader = response.body?.getReader();
    requireThat(reader, "newtest_response_body_missing");
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        count += value.length;
        requireThat(count <= maxBytes, "newtest_response_too_large");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, count);
  }
  async function action(
    operation: Op,
    supplied: ReviewActionV2RequestMap[Op],
  ): Promise<Result> {
    const descriptor = reviewActionV2Operations.find(
      (d) => d.operationId === operation,
    );
    requireThat(descriptor, "newtest_operation_unknown");
    let request = structuredClone(supplied);
    if ("requestBodyHash" in request) {
      request = { ...request, requestBodyHash: "0".repeat(64) };
      request = {
        ...request,
        requestBodyHash: sha(
          canonicalizeReviewActionV2Request(operation, request),
        ),
      };
    }
    requireThat(
      parseReviewActionV2Request(operation, request).ok,
      "newtest_action_request_invalid",
    );
    try {
      const response = await input.fetch(new URL(descriptor.path, origin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(request),
        redirect: "error",
        signal: AbortSignal.timeout(
          input.timeoutMs ?? descriptor.defaultTimeoutMs,
        ),
      });
      requireThat(
        descriptor.successStatuses.includes(response.status as never),
        "newtest_action_rejected_or_unknown",
      );
      const envelope: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readBytes(response),
        ),
      );
      requireThat(
        record(envelope) &&
          envelope.protocolVersion === reviewActionV2PublishedProtocolVersion &&
          envelope.schemaDigest === reviewActionV2PublishedSchemaDigest &&
          envelope.requestId === request.requestId &&
          record(envelope.result),
        "newtest_action_response_invalid",
      );
      return Object.freeze(envelope.result);
    } catch {
      throw new Error("newtest_action_rejected_or_unknown");
    }
  }
  async function responses(
    grant: string,
    a: Approval,
    body: string,
  ): Promise<NewtestResponsesBody> {
    const startedAt = performance.now();
    try {
      const response = await input.fetch(
        new URL("/api/hosted/v4/codex/responses", origin),
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
          headers: {
            authorization: `Bearer ${grant}`,
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
            "idempotency-key": a.requestIdempotencyKey,
            "x-reviewrouter-request-ordinal": "1",
          },
          body,
        },
      );
      requireThat(
        response.status === 200 &&
          response.headers.get("x-reviewrouter-output-token-policy") ===
            "owner-one-shot-uncapped-test",
        "newtest_provider_rejected_or_unknown",
      );
      const bytes = await readBytes(response);
      return Object.freeze({
        bytes,
        contentType: string(
          response.headers.get("content-type"),
          "newtest_provider_content_type_missing",
        ),
        durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
      });
    } catch {
      throw new Error("newtest_provider_rejected_or_unknown");
    }
  }
  return { action, responses };
}

type Client = ReturnType<typeof createNewtestActionClient>;
export type CanaryInput = {
  approval: Approval;
  authenticatedApprovalHash: string;
  providerBody: string;
  client: Client;
  /** Authorization/leases/turn/session have ALREADY been qualified through
   * existing APIs. This runner does not discover, bootstrap, renew or refresh. */
  issueRequest: ReviewActionV2RequestMap[Op.ReviewInvestigationRelayGrant];
  statusRequest: ReviewActionV2RequestMap[Op.ReviewInvestigationRelayStatus];
  /** Trusted planned compiler builds ordinary generated requests from genuine
   * receipts. Existing server acceptance performs semantic/certificate checks. */
  buildRequest(
    phase: Phase,
    receipts: Readonly<Record<string, Result>>,
    response: NewtestResponsesBody,
  ): ReviewActionV2RequestMap[Op] | Promise<ReviewActionV2RequestMap[Op]>;
  publication?: ExclusivePublicationPort;
  now?: () => number;
};

/** Success means existing API acceptance, not a parsed provider diagnostic.
 * No retries. A caller must NEVER auto-rerun this function on any exception.
 * The server's durable ordinal/effect claim, not local memory, owns replay safety. */
export async function runNewtestOneShotCanary(input: CanaryInput) {
  const a = Object.freeze(structuredClone(input.approval));
  const providerBody = input.providerBody;
  const authenticatedApprovalHash = input.authenticatedApprovalHash;
  const now = input.now ?? Date.now;
  validateApproval(a, authenticatedApprovalHash, providerBody, now());
  const publication = input.publication ?? unavailableExclusivePublication;
  // The unsupported ordinary queue must be detected before even issuing a grant.
  const issue = structuredClone(input.issueRequest);
  const statusRequest = structuredClone(input.statusRequest);
  requireThat(
    issue.authorizationId === a.authorizationId &&
      issue.investigationId === a.investigationId &&
      issue.turnId === a.turnId &&
      issue.investigationLeaseCapability !== issue.invocationLeaseCapability,
    "newtest_issue_binding_mismatch",
  );
  requireThat(
    statusRequest.authorizationId === a.authorizationId &&
      statusRequest.investigationId === a.investigationId &&
      statusRequest.turnId === a.turnId &&
      statusRequest.authorizationToken === issue.authorizationToken,
    "newtest_status_binding_mismatch",
  );
  await publication.qualify(a, authenticatedApprovalHash);
  const receipts: Record<string, Result> = {};
  let binding: PublicationBinding | undefined;
  receipts.issue = await input.client.action(
    Op.ReviewInvestigationRelayGrant,
    issue,
  );
  // Restored/recovery is read-only, NEVER another responses POST.
  requireThat(
    receipts.issue.status === "issued" && record(receipts.issue.grantResponse),
    "newtest_grant_not_new",
  );
  const grant = receipts.issue.grantResponse;
  requireThat(
    grant.protocolVersion === 4 &&
      grant.grantId === a.grantId &&
      grant.relayUrl === "/api/hosted/v4/codex/responses" &&
      typeof grant.grantExpiresAt === "string" &&
      Date.parse(grant.grantExpiresAt) > now() &&
      record(grant.policy) &&
      grant.policy.maxRequests === 1 &&
      grant.policy.maxConcurrentRequests === 1,
    "newtest_grant_invalid",
  );
  requireThat(
    Number.isSafeInteger(grant.policy.maxRequestBytes) &&
      Number(grant.policy.maxRequestBytes) >= Buffer.byteLength(providerBody) &&
      Number.isSafeInteger(grant.policy.maxResponseBytes) &&
      Number(grant.policy.maxResponseBytes) > 0,
    "newtest_grant_byte_budget_invalid",
  );
  requireThat(Date.parse(a.expiresAt) > now(), "newtest_approval_expired");
  const response = await input.client.responses(
    string(grant.grant, "newtest_grant_missing"),
    a,
    providerBody,
  );
  requireThat(
    response.bytes.length <= Number(grant.policy.maxResponseBytes),
    "newtest_response_exceeds_grant_budget",
  );
  receipts.status = await input.client.action(
    Op.ReviewInvestigationRelayStatus,
    statusRequest,
  );
  requireThat(
    receipts.status.status === "succeeded" &&
      receipts.status.logicalTurnKey === a.logicalTurnKey &&
      receipts.status.grantId === a.grantId &&
      receipts.status.ordinal === 1 &&
      receipts.status.requestHash === a.requestBodySha256 &&
      receipts.status.requestId &&
      receipts.status.effectId,
    "newtest_effect_not_succeeded",
  );
  for (const phase of Object.keys(phaseOperations) as Phase[]) {
    const request = structuredClone(
      await input.buildRequest(phase, Object.freeze({ ...receipts }), {
        bytes: response.bytes.slice(),
        contentType: response.contentType,
        durationMs: response.durationMs,
      }),
    );
    requireThat(
      "authorizationToken" in request &&
        request.authorizationToken === issue.authorizationToken,
      "newtest_authorization_changed",
    );
    const fields = request as unknown as Record<string, unknown>;
    for (const key of [
      "authorizationId",
      "investigationId",
      "executionId",
      "workSlotId",
      "turnId",
    ] as const) {
      if (key in fields)
        requireThat(fields[key] === a[key], "newtest_artifact_scope_changed");
    }
    if (phase === "commitTurn")
      requireThat(
        fields.acceptedAttestationId ===
          requiredReceipt(receipts, "seal").attestationId &&
          fields.acceptedAttestationHash ===
            requiredReceipt(receipts, "seal").attestationHash,
        "newtest_attestation_changed",
      );
    if (phase === "seal")
      requireThat(
        fields.providerSucceeded === true &&
          fields.schemaValidated === true &&
          fields.fullyConsumed === true,
        "newtest_provider_terminal_invalid",
      );
    if (phase === "commitEvidence")
      requireThat(
        fields.investigationCertificateId ===
          requiredReceipt(receipts, "conclude").certificateId &&
          fields.investigationCertificateHash ===
            requiredReceipt(receipts, "conclude").certificateHash &&
          fields.contextDependencyAttestationId === null &&
          fields.contextDependencyAttestationHash === null &&
          fields.completionStatus === "success" &&
          fields.schemaValidated === true &&
          fields.fullyConsumed === true &&
          fields.transportAttemptCount === 1,
        "newtest_certificate_evidence_invalid",
      );
    if (phase === "attach")
      requireThat(
        fields.observationId ===
          requiredReceipt(receipts, "commitEvidence").observationId,
        "newtest_observation_changed",
      );
    if (phase === "requestPublication") {
      requireThat(
        fields.publicationPermit ===
          requiredReceipt(receipts, "finalize").publicationPermit,
        "newtest_publication_artifact_changed",
      );
      binding = await publication.admit({
        approval: a,
        approvalHash: authenticatedApprovalHash,
        artifactId: string(
          requiredReceipt(receipts, "finalize").artifactId,
          "newtest_artifact_missing",
        ),
        artifactHash: string(
          requiredReceipt(receipts, "finalize").artifactHash,
          "newtest_artifact_hash_missing",
        ),
        publicationPermit: string(
          requiredReceipt(receipts, "finalize").publicationPermit,
          "newtest_permit_missing",
        ),
        publicationRequest:
          request as ReviewActionV2RequestMap[Op.ReviewPublicationRequest],
      });
      requireThat(
        binding.publicationAttemptId &&
          /^[a-f0-9]{64}$/.test(binding.planHash) &&
          binding.operations.length > 0 &&
          binding.operations.every(
            (op) =>
              op.publicationOperationId &&
              /^[a-f0-9]{64}$/.test(op.operationHash),
          ) &&
          new Set(binding.operations.map((op) => op.publicationOperationId))
            .size === binding.operations.length,
        "newtest_publication_binding_missing",
      );
      const measuredBinding = structuredClone(binding);
      binding = Object.freeze({
        ...measuredBinding,
        operations: Object.freeze(
          measuredBinding.operations.map((op) => Object.freeze(op)),
        ),
      });
    }
    const result = await input.client.action(phaseOperations[phase], request);
    const statuses =
      phase === "seal" || phase === "commitEvidence"
        ? ["accepted", "idempotent"]
        : phase === "requestPublication"
          ? ["accepted", "restored"]
          : ["applied", "restored"];
    requireThat(
      statuses.includes(string(result.status, "newtest_result_status_missing")),
      "newtest_semantic_acceptance_missing",
    );
    if (phase === "seal")
      requireThat(
        result.attestationId && result.attestationHash,
        "newtest_attestation_missing",
      );
    if (phase === "conclude")
      requireThat(
        result.certificateId &&
          result.certificateHash &&
          result.terminalOutcomeHash &&
          result.terminalObservationCanonicalJson &&
          result.investigationConclusion,
        "newtest_terminal_certificate_missing",
      );
    if (phase === "commitEvidence")
      requireThat(
        result.observationId && result.historicalOnly === false,
        "newtest_authoritative_observation_missing",
      );
    if (phase === "finalize")
      requireThat(
        result.artifactId === `rr:artifact:${result.artifactHash}` &&
          /^[a-f0-9]{64}$/.test(String(result.artifactHash)) &&
          result.publicationPermit,
        "newtest_final_artifact_missing",
      );
    if (phase === "requestPublication")
      requireThat(
        result.publicationAttemptId === binding?.publicationAttemptId,
        "newtest_publication_identity_changed",
      );
    receipts[phase] = result;
  }
  requireThat(binding, "newtest_publication_binding_missing");
  const outcome = await publication.executeOnce({
    approval: a,
    artifactId: string(
      requiredReceipt(receipts, "finalize").artifactId,
      "newtest_artifact_missing",
    ),
    artifactHash: string(
      requiredReceipt(receipts, "finalize").artifactHash,
      "newtest_artifact_hash_missing",
    ),
    publicationPermit: string(
      requiredReceipt(receipts, "finalize").publicationPermit,
      "newtest_permit_missing",
    ),
    binding,
  });
  requireThat(
    outcome.publicationAttemptId === binding.publicationAttemptId &&
      outcome.planHash === binding.planHash,
    "newtest_publication_identity_changed",
  );
  requireThat(
    outcome.outcome === "completed" &&
      /^[a-f0-9]{64}$/.test(outcome.canonicalReceiptSetHash ?? "") &&
      JSON.stringify(outcome.completedRequiredOperationIds) ===
        JSON.stringify(
          binding.operations
            .filter((op) => op.required)
            .map((op) => op.publicationOperationId),
        ),
    "newtest_publication_unknown_readonly_reconciliation_required",
  );
  return Object.freeze({
    artifactId: requiredReceipt(receipts, "finalize").artifactId,
    artifactHash: requiredReceipt(receipts, "finalize").artifactHash,
    publicationAttemptId: outcome.publicationAttemptId,
    canonicalReceiptSetHash: outcome.canonicalReceiptSetHash,
  });
}
