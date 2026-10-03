import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const { compileMeasuredDiscovery, createNewtestSemanticCompiler } =
  await import("./rr-v4-one-shot-NEWTEST-semantic.ts");
const { ReviewActionV2OperationId: Op } =
  await import("../packages/protocol-review-action-v2/src/index.js");
const { canonicalInvestigationTerminalObservation } =
  await import("../packages/features/review-investigations/src/domain/investigation-turn-observation.js");
const { prepareReviewObservationPayload } =
  await import("../packages/features/review-evidence/src/domain/review-observation.js");
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../packages/protocol-review-action-v2/src/generated/fixtures/review-action-v2.golden.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const hash = (body) => createHash("sha256").update(body).digest("hex");
const receiptHash = "a".repeat(64);
const semantic = {
  outputVersion: 2,
  findings: [
    {
      severity: "major",
      title: "NEWTEST actual fixture finding",
      body: "Fixture-only concrete defect",
      path: "src/NEWTEST.ts",
      line: 1,
      evidenceOperationReceiptIds: [receiptHash],
    },
  ],
  obligationProposals: [],
  closureClaims: [],
  operationBackedDiscoveryClaims: [],
  unresolvableClaims: [],
  criticDecision: null,
};
const binding = {
  approval: {
    turnId: "NEWTEST-turn",
    invocationLeaseId: "NEWTEST-invocation",
    investigationLeaseId: "NEWTEST-relay-lease",
  },
  invocationId: "NEWTEST-invocation-id",
  dossierVersion: 7,
  runtimeProfile: "gateway_attested_agent_v1",
  gatewaySessionId: "NEWTEST-session",
};
function response(output = semantic) {
  const completed = {
    id: "NEWTEST-provider-response",
    status: "completed",
    model: "NEWTEST-measured-model",
    usage: {
      input_tokens: 4,
      output_tokens: 2,
      total_tokens: 6,
      input_tokens_details: { cached_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 1 },
    },
    output: [
      {
        id: "NEWTEST-message",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: JSON.stringify(output) }],
      },
    ],
  };
  return {
    bytes: new TextEncoder().encode(JSON.stringify(completed)),
    contentType: "application/json",
    durationMs: 11,
  };
}
function compiler() {
  const base = (op) => structuredClone(fixtures[op].request);
  return createNewtestSemanticCompiler({
    binding,
    seal: {
      ...base(Op.ReviewInvestigationRelayContextGatewaySeal),
      sessionId: binding.gatewaySessionId,
      sourceLeaseId: binding.approval.investigationLeaseId,
      sourceLeaseAuthorityKind: "investigation_relay",
    },
    commitTurn: base(Op.ReviewInvestigationTurnCommit),
    conclude: base(Op.ReviewInvestigationConclude),
    commitEvidence: {
      ...base(Op.ReviewEvidenceCommit),
      sourceLeaseId: binding.approval.invocationLeaseId,
    },
    attach: base(Op.ReviewExecutionObservationAttach),
    publicationRequest: base(Op.ReviewPublicationRequest),
    finalize: () => {
      throw new Error("No fake projection builder in semantic tests");
    },
  });
}
test("real pure decoder and domain parser derive measured provenance, never model-supplied flags", () => {
  const observation = compileMeasuredDiscovery({
    binding,
    response: response(),
  });
  assert.equal(observation.actualModel, "NEWTEST-measured-model");
  assert.deepEqual(observation.usage, {
    inputTokens: 4,
    cachedInputTokens: 1,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    totalTokens: 6,
  });
  assert.equal(observation.durationMs, 11);
  assert.equal(observation.turnId, binding.approval.turnId);
  assert.equal(
    observation.contextAttestationReference,
    binding.gatewaySessionId,
  );
  assert.equal(
    JSON.parse(canonicalInvestigationTerminalObservation(observation))
      .contextAttestationReference,
    null,
  );
});
test("discovery cannot invent critic/metadata or use unbacked findings", () => {
  for (const bad of [
    { ...semantic, criticDecision: "accept" },
    { ...semantic, actualModel: "fake-model" },
    { ...semantic, findings: [] },
    {
      ...semantic,
      findings: [{ ...semantic.findings[0], evidenceOperationReceiptIds: [] }],
    },
    { ...semantic, findings: [{ ...semantic.findings[0], severity: "info" }] },
  ]) {
    assert.throws(() =>
      compileMeasuredDiscovery({ binding, response: response(bad) }),
    );
  }
});
test("actual completion failure cannot become schemaComplete / streamComplete evidence", () => {
  const raw = response();
  const incomplete = JSON.parse(new TextDecoder().decode(raw.bytes));
  incomplete.status = "incomplete";
  assert.throws(() =>
    compileMeasuredDiscovery({
      binding,
      response: {
        ...raw,
        bytes: new TextEncoder().encode(JSON.stringify(incomplete)),
      },
    }),
  );
});
test("seal uses measured terminal hash; commit binds ONLY actual accepted seal ID", () => {
  const compile = compiler(),
    raw = response();
  const seal = compile("seal", {}, raw);
  const observed = compileMeasuredDiscovery({ binding, response: raw });
  assert.equal(seal.actualModel, observed.actualModel);
  assert.equal(
    seal.terminalOutcomeHash,
    hash(canonicalInvestigationTerminalObservation(observed)),
  );
  const turn = compile(
    "commitTurn",
    {
      seal: {
        status: "accepted",
        attestationId: "NEWTEST-real-seal-id",
        attestationHash: "b".repeat(64),
      },
    },
    raw,
  );
  const parsed = JSON.parse(turn.turnObservationCanonicalJson);
  assert.equal(parsed.contextAttestationReference, "NEWTEST-real-seal-id");
  assert.equal(turn.expectedVersion, "7");
  assert.equal(
    turn.turnObservationHash,
    hash(turn.turnObservationCanonicalJson),
  );
});
test("actual AwaitingCritic result stops; ReadyToConclude consumes returned version/dossier", () => {
  const compile = compiler(),
    raw = response();
  compile("seal", {}, raw);
  assert.throws(
    () =>
      compile(
        "conclude",
        { commitTurn: { investigationState: "awaiting_critic" } },
        raw,
      ),
    /not_ready_to_conclude/,
  );
  const conclude = compile(
    "conclude",
    {
      commitTurn: {
        investigationState: "ready_to_conclude",
        investigationVersion: "9",
        dossierDigest: "c".repeat(64),
      },
    },
    raw,
  );
  assert.equal(conclude.expectedVersion, "9");
  assert.equal(conclude.dossierDigest, "c".repeat(64));
});
test("evidence uses actual certificate terminal payload and rejects hash/provenance changes", () => {
  const compile = compiler(),
    raw = response();
  compile("seal", {}, raw);
  const prepared = prepareReviewObservationPayload({
    payloadVersion: 2,
    normalizedFindings: [
      {
        category: "review_investigation",
        normalizedFailureModeHash: "d".repeat(64),
        severity: "major",
        title: "Fixture defect",
        message: "Fixture body",
        evidence: [receiptHash],
        path: "src/NEWTEST.ts",
        startLine: 1,
        endLine: 1,
        placementConfidence: 1,
        suggestion: null,
      },
    ],
    normalizedLifecycleRevalidations: [],
    safeUsage: { inputTokens: null, outputTokens: null, totalTokens: 6 },
  });
  const conclude = {
    investigationConclusion: "findings",
    terminalActualModel: "NEWTEST-measured-model",
    terminalProviderKind: "codex",
    terminalObservationCanonicalJson: new TextDecoder().decode(
      prepared.canonicalBytes,
    ),
    terminalOutcomeHash: hash(prepared.canonicalBytes),
    certificateId: "NEWTEST-certificate",
    certificateHash: "e".repeat(64),
  };
  assert.throws(
    () =>
      compile(
        "commitEvidence",
        { conclude: { ...conclude, terminalOutcomeHash: "f".repeat(64) } },
        raw,
      ),
    /certificate_payload_invalid/,
  );
  assert.throws(
    () =>
      compile(
        "commitEvidence",
        { conclude: { ...conclude, terminalActualModel: "another" } },
        raw,
      ),
    /certificate_provenance_invalid/,
  );
  const evidence = compile("commitEvidence", { conclude }, raw);
  assert.equal(evidence.payloadHash, conclude.terminalOutcomeHash);
  assert.equal(
    evidence.payloadCanonicalJson,
    conclude.terminalObservationCanonicalJson,
  );
  assert.deepEqual(evidence.qualityFlags, ["investigation_findings"]);
  assert.equal(evidence.contextDependencyAttestationId, null);
  const attach = compile(
    "attach",
    { commitEvidence: { observationId: "NEWTEST-actual-observation" } },
    raw,
  );
  assert.equal(attach.observationId, "NEWTEST-actual-observation");
  assert.equal(attach.payloadHash, evidence.payloadHash);
  assert.equal(attach.findingCount, 1);
});
