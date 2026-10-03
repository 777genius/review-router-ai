import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

// Run with node --import tsx --test. Only fake transport, no runtime/auth entry.
const {
  runNewtestOneShotCanary,
  approvalHash,
  createNewtestActionClient,
  publicationGap,
} = await import("./rr-v4-one-shot-NEWTEST-consumer.ts");
const { ReviewActionV2OperationId: Op, canonicalizeReviewActionV2Request } =
  await import("../packages/protocol-review-action-v2/src/index.js");
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../packages/protocol-review-action-v2/src/generated/fixtures/review-action-v2.golden.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const { createHash } = await import("node:crypto");
const hash = (body) => createHash("sha256").update(body).digest("hex");
const body = '{"model":"fixed-test-model","stream":true}';
const a = Object.freeze({
  purpose: "owner_one_shot_uncapped_test",
  repositoryGitHubId: "1252762369",
  testIdentityId: "NEWTEST-identity",
  ownerIdHash: "1".repeat(64),
  approvalId: "NEWTEST-approval",
  authorizationId: "NEWTEST-auth",
  investigationId: "NEWTEST-investigation",
  turnId: "NEWTEST-turn",
  logicalTurnKey: "NEWTEST-logical-turn",
  grantId: "NEWTEST-grant",
  executionId: "NEWTEST-execution",
  workSlotId: "NEWTEST-slot",
  invocationLeaseId: "NEWTEST-invocation",
  investigationLeaseId: "NEWTEST-investigation-lease",
  producerReleaseId: "NEWTEST-release",
  sourceSha: "a".repeat(40),
  runtimeHash: "b".repeat(64),
  headSha: "c".repeat(40),
  reviewRevisionHash: "d".repeat(64),
  requestIdempotencyKey: "NEWTEST-request",
  requestBodySha256: hash(body),
  publicationIntentId: "NEWTEST-intent",
  expiresAt: "2099-01-01T00:00:00.000Z",
});
const artifactHash = "e".repeat(64);
const binding = Object.freeze({
  publicationAttemptId: "NEWTEST-publication",
  planHash: "4".repeat(64),
  operations: [
    {
      publicationOperationId: "NEWTEST-summary",
      operationHash: "5".repeat(64),
      dependsOnOperationId: null,
      required: true,
    },
    {
      publicationOperationId: "NEWTEST-check",
      operationHash: "6".repeat(64),
      dependsOnOperationId: null,
      required: true,
    },
  ],
});
function scenario() {
  const actions = [],
    sends = [],
    publications = [];
  const results = {
    [Op.ReviewInvestigationRelayGrant]: {
      status: "issued",
      grantResponse: {
        protocolVersion: 4,
        grant: "FAKE-NEWTEST-GRANT",
        grantId: a.grantId,
        relayUrl: "/api/hosted/v4/codex/responses",
        grantExpiresAt: a.expiresAt,
        policy: {
          maxRequests: 1,
          maxConcurrentRequests: 1,
          maxRequestBytes: 4096,
          maxResponseBytes: 4096,
        },
      },
    },
    [Op.ReviewInvestigationRelayStatus]: {
      status: "succeeded",
      logicalTurnKey: a.logicalTurnKey,
      grantId: a.grantId,
      ordinal: 1,
      requestHash: a.requestBodySha256,
      requestId: "NEWTEST-request",
      effectId: "NEWTEST-effect",
    },
    [Op.ReviewInvestigationRelayContextGatewaySeal]: {
      status: "accepted",
      attestationId: "NEWTEST-attestation",
      attestationHash: "f".repeat(64),
    },
    [Op.ReviewInvestigationTurnCommit]: { status: "applied" },
    [Op.ReviewInvestigationConclude]: {
      status: "applied",
      certificateId: "NEWTEST-certificate",
      certificateHash: "1".repeat(64),
      terminalOutcomeHash: "2".repeat(64),
      terminalObservationCanonicalJson: "{}",
      investigationConclusion: "findings",
    },
    [Op.ReviewEvidenceCommit]: {
      status: "accepted",
      observationId: "NEWTEST-observation",
      historicalOnly: false,
    },
    [Op.ReviewExecutionObservationAttach]: { status: "applied" },
    [Op.ReviewExecutionFinalize]: {
      status: "applied",
      artifactId: `rr:artifact:${artifactHash}`,
      artifactHash,
      publicationPermit: "FAKE-NEWTEST-PERMIT",
    },
    [Op.ReviewPublicationRequest]: {
      status: "accepted",
      publicationAttemptId: binding.publicationAttemptId,
    },
  };
  const input = {
    approval: a,
    authenticatedApprovalHash: approvalHash(a),
    providerBody: body,
    issueRequest: {
      authorizationToken: "FAKE-NEWTEST-AUTH",
      authorizationId: a.authorizationId,
      investigationId: a.investigationId,
      turnId: a.turnId,
      investigationLeaseCapability: "FAKE-INVESTIGATION",
      invocationLeaseCapability: "FAKE-INVOCATION",
    },
    statusRequest: {
      authorizationToken: "FAKE-NEWTEST-AUTH",
      authorizationId: a.authorizationId,
      investigationId: a.investigationId,
      turnId: a.turnId,
    },
    client: {
      action: async (op, request) => {
        actions.push({ op, request });
        return structuredClone(results[op]);
      },
      responses: async (...args) => {
        sends.push(args);
        return {
          bytes: new TextEncoder().encode("fully-consumed-test-response"),
          contentType: "text/event-stream",
          durationMs: 1,
        };
      },
    },
    // Sandbox fixture of the NOT YET implemented trusted core boundary.
    // This is not an assertion that production has exclusive admission.
    publication: {
      qualify: async (approval) =>
        assert.equal(approval.publicationIntentId, a.publicationIntentId),
      admit: async ({ artifactId, publicationPermit }) => {
        assert.equal(artifactId, `rr:artifact:${artifactHash}`);
        assert.equal(publicationPermit, "FAKE-NEWTEST-PERMIT");
        assert.equal(
          actions.some(({ op }) => op === Op.ReviewPublicationRequest),
          false,
        );
        return binding;
      },
      executeOnce: async (command) => {
        publications.push(command);
        return {
          outcome: "completed",
          ...binding,
          completedRequiredOperationIds: binding.operations.map(
            (op) => op.publicationOperationId,
          ),
          canonicalReceiptSetHash: "3".repeat(64),
        };
      },
    },
    buildRequest: (phase, receipts) => ({
      authorizationToken: "FAKE-NEWTEST-AUTH",
      authorizationId: a.authorizationId,
      investigationId: a.investigationId,
      executionId: a.executionId,
      workSlotId: a.workSlotId,
      turnId: a.turnId,
      ...(phase === "seal"
        ? {
            providerSucceeded: true,
            schemaValidated: true,
            fullyConsumed: true,
          }
        : {}),
      ...(phase === "commitTurn"
        ? {
            acceptedAttestationId: receipts.seal.attestationId,
            acceptedAttestationHash: receipts.seal.attestationHash,
          }
        : {}),
      ...(phase === "commitEvidence"
        ? {
            investigationCertificateId: receipts.conclude.certificateId,
            investigationCertificateHash: receipts.conclude.certificateHash,
            contextDependencyAttestationId: null,
            contextDependencyAttestationHash: null,
            completionStatus: "success",
            schemaValidated: true,
            fullyConsumed: true,
            transportAttemptCount: 1,
          }
        : {}),
      ...(phase === "attach"
        ? { observationId: receipts.commitEvidence.observationId }
        : {}),
      ...(phase === "requestPublication"
        ? { publicationPermit: receipts.finalize.publicationPermit }
        : {}),
    }),
  };
  return { input, actions, sends, publications, results };
}

test("current-facts request preparation is awaited before finalize action", async () => {
  const s = scenario();
  const encode = s.input.buildRequest;
  let freshFactsRead = false;
  s.input.buildRequest = async (phase, receipts, response) => {
    if (phase === "finalize") {
      await Promise.resolve();
      freshFactsRead = true;
    }
    return encode(phase, receipts, response);
  };
  const action = s.input.client.action;
  s.input.client.action = async (op, request) => {
    if (op === Op.ReviewExecutionFinalize) assert(freshFactsRead);
    return action(op, request);
  };
  await runNewtestOneShotCanary(s.input);
  assert.equal(s.sends.length, 1);
  assert.equal(
    s.actions.filter(({ op }) => op === Op.ReviewExecutionFinalize).length,
    1,
  );
});

test("missing real exclusive admission fails BEFORE grant/provider/publication", async () => {
  const s = scenario();
  delete s.input.publication;
  await assert.rejects(runNewtestOneShotCanary(s.input), {
    message: publicationGap,
  });
  assert.deepEqual(
    [s.actions.length, s.sends.length, s.publications.length],
    [0, 0, 0],
  );
});
test("changed approval/body cannot gain authority", async () => {
  for (const change of [
    { approval: { ...a, testIdentityId: "other" } },
    { providerBody: body + " " },
    { approval: { ...a, expiresAt: "2000-01-01T00:00:00.000Z" } },
  ]) {
    const s = scenario();
    Object.assign(s.input, change);
    await assert.rejects(runNewtestOneShotCanary(s.input));
    assert.equal(s.actions.length + s.sends.length + s.publications.length, 0);
  }
});
test("restored/blocked grant never sends even with matching capability", async () => {
  for (const status of ["restored", "recovery_required", "busy", "rejected"]) {
    const s = scenario();
    s.results[Op.ReviewInvestigationRelayGrant].status = status;
    await assert.rejects(
      runNewtestOneShotCanary(s.input),
      /newtest_grant_not_new/,
    );
    assert.equal(s.sends.length + s.publications.length, 0);
  }
});
test("provider ambiguity stops with exactly ONE send and no acceptance", async () => {
  const s = scenario();
  s.input.client.responses = async () => {
    s.sends.push(1);
    throw new Error("timeout-unknown");
  };
  await assert.rejects(runNewtestOneShotCanary(s.input), /timeout-unknown/);
  assert.equal(s.sends.length, 1);
  assert.equal(s.actions.length, 1);
  assert.equal(s.publications.length, 0);
});
test("fully consumed bytes are not acceptance when durable effect is uncertain", async () => {
  const s = scenario();
  s.results[Op.ReviewInvestigationRelayStatus].status = "terminal_unknown";
  await assert.rejects(
    runNewtestOneShotCanary(s.input),
    /newtest_effect_not_succeeded/,
  );
  assert.equal(s.sends.length, 1);
  assert.equal(s.actions.length, 2);
  assert.equal(s.publications.length, 0);
});
test("nonterminal investigation/historical evidence cannot reach finalization", async () => {
  for (const failure of ["critic", "historical"]) {
    const s = scenario();
    if (failure === "critic")
      s.results[Op.ReviewInvestigationConclude] = {
        status: "applied",
        investigationState: "awaiting_critic",
      };
    else s.results[Op.ReviewEvidenceCommit].historicalOnly = true;
    await assert.rejects(runNewtestOneShotCanary(s.input));
    assert.equal(s.sends.length, 1);
    assert.equal(
      s.actions.some(({ op }) => op === Op.ReviewExecutionFinalize),
      false,
    );
    assert.equal(s.publications.length, 0);
  }
});
test("sandbox receipt chain reaches exactly one artifact and planned publication", async () => {
  const s = scenario();
  const result = await runNewtestOneShotCanary(s.input);
  assert.equal(result.artifactId, `rr:artifact:${artifactHash}`);
  assert.equal(s.sends.length, 1);
  assert.equal(s.publications.length, 1);
  assert.equal(
    s.actions.some(({ op }) => op === Op.ReviewExecutionWorkSlotTerminalize),
    false,
  );
  assert.equal(
    s.actions.find(({ op }) => op === Op.ReviewEvidenceCommit).request
      .investigationCertificateId,
    "NEWTEST-certificate",
  );
  assert.equal(
    s.actions.find(({ op }) => op === Op.ReviewExecutionObservationAttach)
      .request.observationId,
    "NEWTEST-observation",
  );
  assert.equal(s.publications[0].artifactId, result.artifactId);
  assert.equal(
    s.publications[0].binding.publicationAttemptId,
    binding.publicationAttemptId,
  );
});
test("unknown publication does not repost or generate another identity", async () => {
  const s = scenario();
  s.input.publication.executeOnce = async (command) => {
    s.publications.push(command);
    return {
      outcome: "unknown",
      ...binding,
    };
  };
  await assert.rejects(
    runNewtestOneShotCanary(s.input),
    /newtest_publication_unknown_readonly/,
  );
  assert.equal(s.publications.length, 1);
  assert.equal(s.sends.length, 1);
  assert.equal(
    s.actions.filter(({ op }) => op === Op.ReviewPublicationRequest).length,
    1,
  );
});
test("post-artifact admission failure prevents any ordinary publication request", async () => {
  const s = scenario();
  s.input.publication.admit = async () => {
    throw new Error("exclusive-admission-denied");
  };
  await assert.rejects(
    runNewtestOneShotCanary(s.input),
    /exclusive-admission-denied/,
  );
  assert.equal(s.sends.length, 1);
  assert.equal(
    s.actions.some(({ op }) => op === Op.ReviewExecutionFinalize),
    true,
  );
  assert.equal(
    s.actions.some(({ op }) => op === Op.ReviewPublicationRequest),
    false,
  );
  assert.equal(s.publications.length, 0);
});
test("selected summary receipt cannot masquerade as the full required publication", async () => {
  const s = scenario();
  s.input.publication.executeOnce = async (command) => {
    s.publications.push(command);
    return {
      outcome: "completed",
      publicationAttemptId: binding.publicationAttemptId,
      planHash: binding.planHash,
      completedRequiredOperationIds: ["NEWTEST-summary"],
      canonicalReceiptSetHash: "3".repeat(64),
    };
  };
  await assert.rejects(
    runNewtestOneShotCanary(s.input),
    /newtest_publication_unknown_readonly/,
  );
  assert.equal(s.publications.length, 1);
  assert.equal(s.sends.length, 1);
});
test("real HTTP client uses generated Action v2 body hash, not relay protocol 4 envelope", async () => {
  const request = structuredClone(
    fixtures[Op.ReviewInvestigationRelayGrant].request,
  );
  const calls = [];
  const client = createNewtestActionClient({
    apiOrigin: "https://newtest.invalid/",
    fetch: async (url, options) => {
      calls.push({ url, options });
      const sent = JSON.parse(options.body);
      return Response.json(
        {
          protocolVersion: sent.protocolVersion,
          schemaDigest: sent.schemaDigest,
          requestId: sent.requestId,
          result: { status: "issued" },
        },
        { status: 201 },
      );
    },
  });
  await client.action(Op.ReviewInvestigationRelayGrant, request);
  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.protocolVersion, "2");
  assert.equal(
    sent.requestBodyHash,
    hash(
      canonicalizeReviewActionV2Request(Op.ReviewInvestigationRelayGrant, sent),
    ),
  );
  assert.equal(
    calls[0].url.pathname,
    "/api/action/v2/review-investigations/relay-grants",
  );
  assert.equal(calls.length, 1);
});
test("real HTTP relay client preserves exact bytes/ordinal and never retries 429", async () => {
  const calls = [];
  const client = createNewtestActionClient({
    apiOrigin: "https://newtest.invalid/",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response("quota", { status: 429 });
    },
  });
  await assert.rejects(
    client.responses("FAKE-NEWTEST-GRANT", a, body),
    /newtest_provider_rejected_or_unknown/,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.body, body);
  assert.equal(calls[0].options.headers["x-reviewrouter-request-ordinal"], "1");
  assert.equal(
    calls[0].options.headers["content-length"],
    String(Buffer.byteLength(body)),
  );
  assert.equal(calls[0].options.redirect, "error");
});
