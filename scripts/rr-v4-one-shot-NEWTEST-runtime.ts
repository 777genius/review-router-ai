import {
  exclusivePublicationHash,
  exclusivePublicationOperations,
  exclusivePublicationPlanHash,
} from "../packages/features/review-publishing/src/v2/infrastructure/exclusive-test-publication-hash.js";
import {
  type ExclusiveTestPublicationBinding,
  type ExclusiveTestPublicationIntent,
} from "../packages/features/review-publishing/src/v2/domain/exclusive-test-publication.js";
import { hasEveryRequiredCanonicalReceipt } from "../packages/features/review-publishing/src/v2/domain/review-publication-attempt.js";
import type { ProductionReviewV2WorkerRuntime } from "../apps/worker/src/review-v2-production-runtime.js";
import type { TrustedExclusivePublicationPreparation } from "../apps/api/src/review-action-v2-production-composition-snapshot-publication.js";
import {
  ReviewActionV2OperationId as Op,
  type ReviewActionV2RequestMap,
} from "../packages/protocol-review-action-v2/src/index.js";
import {
  approvalHash,
  type Approval,
  type CanaryInput,
  type ExclusivePublicationPort,
} from "./rr-v4-one-shot-NEWTEST-consumer.js";
import {
  createNewtestSemanticCompiler,
  type SemanticCompilerInputs,
} from "./rr-v4-one-shot-NEWTEST-semantic.js";
import {
  createNewtestContextGateway,
  type ImmutableGitObjects,
} from "./rr-v4-one-shot-NEWTEST-gateway.js";
import type { ContextAttestationStorePort } from "../packages/features/review-context-attestation/src/application/ports/context-attestation-ports.js";
import type { ProducerReleaseQueryPort } from "../packages/features/review-run-control/src/application/ports/producer-release-ports.js";
import type { ReviewExecutionQueryPort } from "../packages/features/review-executions/src/application/ports/review-execution-ports.js";
import {
  validateReviewAssignmentManifest,
  type ReviewExecutionScope,
} from "../packages/features/review-executions/src/domain/review-execution.js";

type Core = NonNullable<
  ProductionReviewV2WorkerRuntime["exclusivePublication"]
>;
type Result = Readonly<Record<string, unknown>>;
function assert(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
function requiredReceipt(
  receipts: Readonly<Record<string, Result>>,
  phase: string,
): Result {
  const value = receipts[phase];
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    "newtest_runtime_required_prior_receipt_missing",
  );
  return value;
}

/** Implemented by the API's trusted preparation facade, NOT an Action request
 * override. It reuses signed-permit verification, stored artifact authority,
 * current publication gates and the complete ordinary planner before enqueue. */
export type TrustedPublicationPreparation =
  TrustedExclusivePublicationPreparation;

/** Import-only server adapter. The trusted launcher supplies already constructed
 * production ports; this file neither discovers credentials nor constructs an
 * ambient production runtime. Every method is one call, with no retry wrapper. */
export function createNewtestExclusivePublication(input: {
  core: Core;
  preparation: TrustedPublicationPreparation;
  provider: Parameters<Core["executeOnce"]>[0]["provider"];
}): ExclusivePublicationPort {
  let intent: ExclusiveTestPublicationIntent | undefined;
  let binding: ExclusiveTestPublicationBinding | undefined;
  let authorizationToken: string | undefined;
  let publicationPermit: string | undefined;
  let intentSettled = false;
  let bindingSettled = false;
  let admissionStarted = false;
  let executed = false;
  return {
    async qualify(approval, authenticatedHash) {
      assert(!intent, "newtest_publication_intent_already_admitted");
      assert(
        approvalHash(approval) === authenticatedHash,
        "newtest_publication_approval_changed",
      );
      input.core.qualify();
      intent = Object.freeze({
        publicationIntentId: approval.publicationIntentId,
        approvalHash: authenticatedHash,
        approvalId: approval.approvalId,
        purpose: approval.purpose,
        repositoryGitHubId: approval.repositoryGitHubId,
        testIdentityId: approval.testIdentityId,
        executionId: approval.executionId,
        ownerIdHash: approval.ownerIdHash,
        expiresAt: approval.expiresAt,
      });
      // Set before await. A lost admission ACK never authorizes local re-entry.
      await input.core.store.admitIntent(intent);
      intentSettled = true;
    },
    async admit(actual) {
      assert(
        intent && intentSettled && !binding && !admissionStarted,
        "newtest_publication_binding_not_fresh",
      );
      assert(
        approvalHash(actual.approval) === intent.approvalHash &&
          actual.approvalHash === intent.approvalHash &&
          actual.publicationRequest.publicationPermit ===
            actual.publicationPermit,
        "newtest_publication_approval_changed",
      );
      admissionStarted = true;
      const prepared = await input.preparation.prepareExclusivePublication(
        structuredClone(actual.publicationRequest),
        { artifactId: actual.artifactId, artifactHash: actual.artifactHash },
      );
      const permit = prepared.verifiedPermit;
      assert(
        prepared.artifactId === actual.artifactId &&
          prepared.artifactHash === actual.artifactHash &&
          actual.artifactId === `rr:artifact:${actual.artifactHash}` &&
          permit.executionId === actual.approval.executionId &&
          permit.authorizationId === actual.approval.authorizationId &&
          permit.producerReleaseId === actual.approval.producerReleaseId &&
          permit.reviewedHeadSha === actual.approval.headSha &&
          permit.reviewRevisionHash === actual.approval.reviewRevisionHash &&
          permit.projectionHash === actual.publicationRequest.projectionHash &&
          exclusivePublicationHash(prepared.command.permit) ===
            exclusivePublicationHash(permit),
        "newtest_publication_measured_artifact_mismatch",
      );
      binding = Object.freeze(
        structuredClone({
          intent,
          artifactId: actual.artifactId,
          artifactHash: actual.artifactHash,
          permitHash: exclusivePublicationHash(permit),
          publicationAttemptId: prepared.command.publicationAttemptId,
          planHash: exclusivePublicationPlanHash(prepared.command.operations),
          operations: exclusivePublicationOperations(
            prepared.command.operations,
          ),
        }),
      );
      authorizationToken = actual.publicationRequest.authorizationToken;
      publicationPermit = actual.publicationPermit;
      // The complete measured plan is excluded from ordinary owners BEFORE the
      // consumer sends the existing publication/request Action call.
      await input.core.store.bind(binding, prepared.command.operations);
      bindingSettled = true;
      return structuredClone({
        publicationAttemptId: binding.publicationAttemptId,
        planHash: binding.planHash,
        operations: binding.operations,
      });
    },
    async executeOnce(actual) {
      assert(
        binding && bindingSettled && intent && authorizationToken && !executed,
        "newtest_publication_execution_not_fresh",
      );
      assert(
        approvalHash(actual.approval) === intent.approvalHash &&
          actual.artifactId === binding.artifactId &&
          actual.artifactHash === binding.artifactHash &&
          actual.publicationPermit === publicationPermit &&
          exclusivePublicationHash(actual.binding) ===
            exclusivePublicationHash({
              publicationAttemptId: binding.publicationAttemptId,
              planHash: binding.planHash,
              operations: binding.operations,
            }),
        "newtest_publication_binding_changed",
      );
      executed = true;
      const unknown = () => ({
        outcome: "unknown" as const,
        publicationAttemptId: binding!.publicationAttemptId,
        planHash: binding!.planHash,
        completedRequiredOperationIds: [],
      });
      try {
        const result = await input.core.executeOnce(
          {
            publicationAttemptId: binding.publicationAttemptId,
            ownerIdHash: intent.ownerIdHash,
            provider: input.provider,
          },
          binding,
        );
        if (
          result.status !== "completed" &&
          result.status !== "already_completed"
        )
          return unknown();
        const evidence = await input.preparation.readPublicationEvidence({
          authorizationToken,
          publicationAttemptId: binding.publicationAttemptId,
        });
        const { view } = evidence;
        if (
          view.attempt.publicationAttemptId !== binding.publicationAttemptId ||
          exclusivePublicationHash(view.attempt.permit) !==
            binding.permitHash ||
          exclusivePublicationPlanHash(view.attempt.operations) !==
            binding.planHash ||
          exclusivePublicationHash(
            exclusivePublicationOperations(view.attempt.operations),
          ) !== exclusivePublicationHash(binding.operations) ||
          !hasEveryRequiredCanonicalReceipt({
            operations: view.attempt.operations,
            receipts: view.receipts,
          }) ||
          !/^[a-f0-9]{64}$/.test(evidence.canonicalReceiptSetHash ?? "")
        )
          return unknown();
        return {
          outcome: "completed",
          publicationAttemptId: binding.publicationAttemptId,
          planHash: binding.planHash,
          completedRequiredOperationIds: binding.operations
            .filter((op) => op.required)
            .map((op) => op.publicationOperationId),
          canonicalReceiptSetHash: evidence.canonicalReceiptSetHash!,
        };
      } catch {
        return unknown();
      }
    },
  };
}

const preparationSequence = [
  [Op.ReviewRunAuthorize, "authorized"],
  [Op.ReviewExecutionStart, "admitted"],
  [Op.ReviewInvocationLeaseAcquire, "acquired"],
  [Op.ReviewInvestigationOpenV2, "opened"],
  [Op.ReviewInvestigationRelayTurnPlan, "applied"],
  [Op.ReviewInvestigationRelayLeaseAcquire, "acquired"],
  [Op.ReviewInvestigationRelayContextGatewayOpen, "opened"],
] as const;

/** One server-owned producer preparer replaces user-filled capability templates.
 * Requests must come from registered release/TEST scope, actual checkout and
 * confinement evidence. No fallback to the synthetic E2E harness is supported. */
export interface TrustedNewtestProducerPreparation {
  prepareRequest(
    operation: (typeof preparationSequence)[number][0],
    actualReceipts: Readonly<Partial<Record<Op, Result>>>,
  ): Promise<ReviewActionV2RequestMap[Op]>;
  finalizeFromCurrentFacts(input: {
    approval: Approval;
    certificate: Result;
    acceptedObservation: Result;
    attached: Result;
  }): Promise<ReviewActionV2RequestMap[Op.ReviewExecutionFinalize]>;
}

/** Only the ordinary upfront API chain, no grant or paid/provider invocation.
 * A restored/busy/ambiguous receipt stops; this workflow never refreshes leases.
 * Immutable canary approval must be authenticated from these actual IDs AFTER
 * preparation and injected into the trusted issuer BEFORE grant issuance. */
export async function prepareNewtestActionWorkflow(input: {
  client: CanaryInput["client"];
  producer: TrustedNewtestProducerPreparation;
}) {
  const receipts: Partial<Record<Op, Result>> = {};
  for (const [operation, freshStatus] of preparationSequence) {
    const request = await input.producer.prepareRequest(
      operation,
      Object.freeze(structuredClone(receipts)),
    );
    const authorization = receipts[Op.ReviewRunAuthorize];
    if (authorization) {
      assert(
        "authorizationToken" in request &&
          request.authorizationToken === authorization.authorizationToken,
        "newtest_preparation_authorization_changed",
      );
      if ("authorizationId" in request)
        assert(
          request.authorizationId === authorization.authorizationId,
          "newtest_preparation_authorization_changed",
        );
    }
    const execution = receipts[Op.ReviewExecutionStart];
    if (execution && "executionId" in request)
      assert(
        request.executionId === execution.executionId,
        "newtest_preparation_execution_changed",
      );
    const investigation = receipts[Op.ReviewInvestigationOpenV2];
    if (investigation && "investigationId" in request)
      assert(
        request.investigationId === investigation.investigationId,
        "newtest_preparation_investigation_changed",
      );
    if (operation === Op.ReviewInvestigationRelayLeaseAcquire) {
      const planned = receipts[Op.ReviewInvestigationRelayTurnPlan]!;
      assert(
        "turnId" in request &&
          request.turnId === planned.turnId &&
          "turnCapability" in request &&
          request.turnCapability === planned.turnCapability,
        "newtest_preparation_turn_changed",
      );
    }
    if (operation === Op.ReviewInvestigationRelayContextGatewayOpen) {
      const lease = receipts[Op.ReviewInvestigationRelayLeaseAcquire]!;
      assert(
        "leaseCapability" in request &&
          request.leaseCapability === lease.leaseCapability &&
          "sourceLeaseId" in request &&
          request.sourceLeaseId === lease.leaseId &&
          "attemptId" in request &&
          request.attemptId === lease.attemptId &&
          "fencingToken" in request &&
          request.fencingToken === lease.fencingToken &&
          "sourceLeaseAuthorityKind" in request &&
          request.sourceLeaseAuthorityKind === "investigation_relay",
        "newtest_preparation_lease_changed",
      );
    }
    const result = await input.client.action(operation, request);
    assert(result.status === freshStatus, "newtest_preparation_not_fresh");
    receipts[operation] = Object.freeze(structuredClone(result));
  }
  const invocation = receipts[Op.ReviewInvocationLeaseAcquire]!;
  const investigation = receipts[Op.ReviewInvestigationRelayLeaseAcquire]!;
  assert(
    invocation.leaseId &&
      investigation.leaseId &&
      invocation.leaseId !== investigation.leaseId &&
      invocation.leaseCapability &&
      investigation.leaseCapability &&
      invocation.leaseCapability !== investigation.leaseCapability,
    "newtest_preparation_distinct_leases_required",
  );
  return Object.freeze(receipts);
}

/** Loads the genuine OPEN session and registered release through existing
 * repositories, derives allowed paths from the actual execution assignment,
 * and crossbinds every source lease/session/authorization receipt. No manually
 * assembled GatewaySession, capability, registration or future pin is accepted. */
export async function createPreparedNewtestGateway(input: {
  prepared: Awaited<ReturnType<typeof prepareNewtestActionWorkflow>>;
  expectedTestScope: ReviewExecutionScope & {
    repositoryGitHubId: "1252762369";
  };
  workSlotId: string;
  readers: {
    sessions: Pick<ContextAttestationStorePort, "findSession">;
    executions: Pick<ReviewExecutionQueryPort, "findExecution">;
    releases: ProducerReleaseQueryPort;
  };
  measuredGatewayEntrypointSha256: string;
  objects: ImmutableGitObjects;
  now?: () => number;
}) {
  const auth = input.prepared[Op.ReviewRunAuthorize];
  const start = input.prepared[Op.ReviewExecutionStart];
  const lease = input.prepared[Op.ReviewInvestigationRelayLeaseAcquire];
  const opened = input.prepared[Op.ReviewInvestigationRelayContextGatewayOpen];
  assert(
    auth &&
      start &&
      lease &&
      opened &&
      auth.status === "authorized" &&
      start.status === "admitted" &&
      lease.status === "acquired" &&
      opened.status === "opened" &&
      typeof start.executionId === "string" &&
      typeof opened.sessionId === "string",
    "newtest_gateway_actual_preparation_missing",
  );
  const [session, snapshot] = await Promise.all([
    input.readers.sessions.findSession(opened.sessionId),
    input.readers.executions.findExecution(start.executionId),
  ]);
  assert(
    session && snapshot && snapshot.execution.assignmentManifestCanonicalJson,
    "newtest_gateway_actual_records_missing",
  );
  const execution = snapshot.execution;
  const assignmentCanonicalJson = execution.assignmentManifestCanonicalJson;
  assert(
    typeof assignmentCanonicalJson === "string",
    "newtest_gateway_actual_assignment_missing",
  );
  const release = await input.readers.releases.findProducerReleaseById(
    execution.producerReleaseId,
  );
  assert(
    release &&
      input.expectedTestScope.repositoryGitHubId === "1252762369" &&
      execution.authorizationId === auth.authorizationId &&
      execution.producerReleaseId === auth.producerReleaseId &&
      execution.executionId === start.executionId &&
      session.sessionId === opened.sessionId &&
      session.producerReleaseId === execution.producerReleaseId &&
      session.sourceExecutionId === execution.executionId &&
      session.sourceWorkSlotId === input.workSlotId &&
      session.sourceLeaseId === lease.leaseId &&
      session.attemptId === lease.attemptId &&
      session.sourceFencingToken === lease.fencingToken &&
      session.sourceRevision.headSha === execution.revision.headSha &&
      session.sourceRevision.mergeBaseSha === execution.revision.mergeBaseSha &&
      session.sourceRevision.baseSha === execution.revision.baseSha &&
      session.sourceRevision.reviewRevisionHash ===
        execution.revision.reviewRevisionHash &&
      session.eventChainSeedHash === opened.eventChainSeedHash &&
      typeof opened.expiresAt === "string" &&
      session.expiresAtMs === Date.parse(opened.expiresAt),
    "newtest_gateway_actual_binding_mismatch",
  );
  for (const key of [
    "workspaceId",
    "repositoryConnectionId",
    "scmRepositoryIdentityId",
    "pullRequestNumber",
  ] as const)
    assert(
      execution[key] === input.expectedTestScope[key] &&
        session.scope[key] === execution[key],
      "newtest_gateway_actual_test_scope_mismatch",
    );
  const assignment = validateReviewAssignmentManifest(
    JSON.parse(assignmentCanonicalJson),
    execution.workSlots.map((slot) => slot.workSlotId),
  );
  const paths = assignment.assignments.find(
    (item) => item.workSlotId === input.workSlotId,
  )?.paths;
  assert(
    paths &&
      typeof opened.gatewaySessionSecret === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(opened.gatewaySessionSecret),
    "newtest_gateway_actual_material_missing",
  );
  const secret = Buffer.from(opened.gatewaySessionSecret, "base64url");
  assert(
    secret.toString("base64url") === opened.gatewaySessionSecret,
    "newtest_gateway_actual_secret_invalid",
  );
  try {
    const gateway = await createNewtestContextGateway({
      repositoryGitHubId: "1252762369",
      session,
      gatewaySessionSecret: secret,
      registeredRelease: release,
      measuredGatewayEntrypointSha256: input.measuredGatewayEntrypointSha256,
      allowedPaths: paths,
      objects: input.objects,
      ...(input.now ? { now: input.now } : {}),
    });
    return { gateway, session };
  } finally {
    secret.fill(0);
  }
}

/** Actual ledger/lifecycle/observation/versions may change during acceptance.
 * Read them immediately at finalize, not before provider execution. The normal
 * generated semantic encoder and ordinary server finalize validation still run. */
export function createNewtestRuntimeCompiler(input: {
  semantic: Omit<SemanticCompilerInputs, "finalize">;
  producer: Pick<TrustedNewtestProducerPreparation, "finalizeFromCurrentFacts">;
}): CanaryInput["buildRequest"] {
  const approval = structuredClone(input.semantic.binding.approval);
  let actualFinalization:
    | ReviewActionV2RequestMap[Op.ReviewExecutionFinalize]
    | undefined;
  const encode = createNewtestSemanticCompiler({
    ...input.semantic,
    finalize() {
      assert(actualFinalization, "newtest_actual_finalization_facts_missing");
      return actualFinalization;
    },
  });
  return async (phase, receipts, response) => {
    if (phase === "finalize") {
      assert(!actualFinalization, "newtest_finalize_already_prepared");
      actualFinalization = await input.producer.finalizeFromCurrentFacts({
        approval,
        certificate: requiredReceipt(receipts, "conclude"),
        acceptedObservation: requiredReceipt(receipts, "commitEvidence"),
        attached: requiredReceipt(receipts, "attach"),
      });
    }
    return encode(phase, receipts, response);
  };
}

/** The server launcher composes one consumer only after the ordinary preparation
 * chain and authenticated approval injection. Constructing this value performs
 * no API, database or provider call. A launcher must not retry runCanary on error. */
export function composeNewtestCanaryRuntime(input: {
  canary: Omit<CanaryInput, "buildRequest" | "publication">;
  prepared: Awaited<ReturnType<typeof prepareNewtestActionWorkflow>>;
  semantic: Omit<SemanticCompilerInputs, "finalize">;
  producer: Pick<TrustedNewtestProducerPreparation, "finalizeFromCurrentFacts">;
  publication: Parameters<typeof createNewtestExclusivePublication>[0];
}): CanaryInput {
  const a = input.canary.approval;
  const r = input.prepared;
  assert(
    approvalHash(a) === input.canary.authenticatedApprovalHash &&
      approvalHash(input.semantic.binding.approval) ===
        input.canary.authenticatedApprovalHash &&
      a.authorizationId === r[Op.ReviewRunAuthorize]?.authorizationId &&
      a.producerReleaseId === r[Op.ReviewRunAuthorize]?.producerReleaseId &&
      a.executionId === r[Op.ReviewExecutionStart]?.executionId &&
      a.invocationLeaseId === r[Op.ReviewInvocationLeaseAcquire]?.leaseId &&
      a.investigationLeaseId ===
        r[Op.ReviewInvestigationRelayLeaseAcquire]?.leaseId &&
      a.investigationId === r[Op.ReviewInvestigationOpenV2]?.investigationId &&
      a.turnId === r[Op.ReviewInvestigationRelayTurnPlan]?.turnId &&
      input.semantic.binding.gatewaySessionId ===
        r[Op.ReviewInvestigationRelayContextGatewayOpen]?.sessionId &&
      input.canary.issueRequest.authorizationToken ===
        r[Op.ReviewRunAuthorize]?.authorizationToken,
    "newtest_actual_preparation_approval_mismatch",
  );
  return {
    ...input.canary,
    buildRequest: createNewtestRuntimeCompiler({
      semantic: input.semantic,
      producer: input.producer,
    }),
    publication: createNewtestExclusivePublication(input.publication),
  };
}
