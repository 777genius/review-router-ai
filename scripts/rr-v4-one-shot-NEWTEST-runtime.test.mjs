import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createNewtestExclusivePublication,
  createPreparedNewtestGateway,
  prepareNewtestActionWorkflow,
} from "./rr-v4-one-shot-NEWTEST-runtime.ts";
import { approvalHash } from "./rr-v4-one-shot-NEWTEST-consumer.ts";
import { ReviewActionV2OperationId as Op } from "../packages/protocol-review-action-v2/src/index.js";

// Fake trusted ports only. Tests catch premature enqueue, selected-operation
// success claims, lost admission ACK replay, and restored preparation reuse.
function fixture() {
  const calls = [];
  const approval = {
    purpose: "owner_one_shot_uncapped_test",
    repositoryGitHubId: "1252762369",
    testIdentityId: "NEWTEST-identity",
    publicationIntentId: "NEWTEST-intent",
    approvalId: "NEWTEST-approval",
    ownerIdHash: "1".repeat(64),
    executionId: "NEWTEST-execution",
    authorizationId: "NEWTEST-auth",
    producerReleaseId: "NEWTEST-release",
    headSha: "a".repeat(40),
    reviewRevisionHash: "b".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
  const permit = {
    executionId: approval.executionId,
    authorizationId: approval.authorizationId,
    producerReleaseId: approval.producerReleaseId,
    reviewedHeadSha: approval.headSha,
    reviewRevisionHash: approval.reviewRevisionHash,
    projectionHash: "c".repeat(64),
  };
  const operations = ["summary", "check"].map((id, i) => ({
    publicationOperationId: `NEWTEST-${id}`,
    publicationKind: id === "check" ? "managed_check" : "summary",
    chunkIndex: 0,
    effectStrategy: "mutable_singleton",
    role: "standalone",
    markerHash: "d".repeat(64),
    bodyHash: `${i + 1}`.repeat(64),
    renderPolicyVersion: 1,
    targetCommitId: approval.headSha,
    reviewRevisionHash: approval.reviewRevisionHash,
    required: true,
    dependsOnOperationId: i ? "NEWTEST-summary" : null,
    reconcileUntil: new Date("2099-01-01T00:00:00.000Z"),
  }));
  const artifactHash = "e".repeat(64);
  const actual = {
    approval,
    approvalHash: approvalHash(approval),
    artifactId: `rr:artifact:${artifactHash}`,
    artifactHash,
    publicationPermit: "NEWTEST-only-permit",
    publicationRequest: {
      authorizationToken: "NEWTEST-only-auth",
      publicationPermit: "NEWTEST-only-permit",
      projectionHash: permit.projectionHash,
    },
  };
  const evidence = {
    view: {
      attempt: { publicationAttemptId: "NEWTEST-attempt", permit, operations },
      receipts: operations.map((op) => ({
        publicationOperationId: op.publicationOperationId,
        status: "succeeded",
        receiptHash: "f".repeat(64),
      })),
    },
    canonicalReceiptSetHash: "f".repeat(64),
  };
  const core = {
    qualify: () => calls.push("qualify"),
    store: {
      admitIntent: async (intent) => {
        calls.push("intent");
        assert.equal(intent.executionId, approval.executionId);
      },
      bind: async (binding, plan) => {
        calls.push("bind");
        assert.deepEqual(plan, operations);
        assert.equal(binding.operations.length, 2);
      },
    },
    executeOnce: async (command, binding) => {
      calls.push("execute");
      assert.equal(command.ownerIdHash, approval.ownerIdHash);
      assert.deepEqual(
        binding.operations.map((op) => op.publicationOperationId),
        ["NEWTEST-summary", "NEWTEST-check"],
      );
      return { status: "completed" };
    },
  };
  const preparation = {
    prepareExclusivePublication: async (request, measured) => {
      calls.push("prepare");
      assert.equal(request.publicationPermit, actual.publicationPermit);
      assert.equal(measured.artifactHash, artifactHash);
      return {
        ...measured,
        verifiedPermit: permit,
        command: {
          publicationAttemptId: "NEWTEST-attempt",
          permit,
          operations,
        },
      };
    },
    readPublicationEvidence: async (request) => {
      calls.push("read");
      assert.equal(request.authorizationToken, "NEWTEST-only-auth");
      return evidence;
    },
  };
  return { calls, actual, evidence, core, preparation };
}

test("binds actual complete plan before request and proves every required receipt", async () => {
  const f = fixture();
  const adapter = createNewtestExclusivePublication({
    ...f,
    provider: "github",
  });
  await adapter.qualify(f.actual.approval, f.actual.approvalHash);
  const binding = await adapter.admit(f.actual);
  assert.deepEqual(f.calls, ["qualify", "intent", "prepare", "bind"]);
  const result = await adapter.executeOnce({ ...f.actual, binding });
  assert.equal(result.outcome, "completed");
  assert.deepEqual(result.completedRequiredOperationIds, [
    "NEWTEST-summary",
    "NEWTEST-check",
  ]);
  assert.equal(result.canonicalReceiptSetHash, "f".repeat(64));
  await assert.rejects(
    adapter.executeOnce({ ...f.actual, binding }),
    /not_fresh/,
  );
  assert.equal(f.calls.filter((v) => v === "execute").length, 1);
});

test("core completed enum cannot substitute for a full required receipt set", async () => {
  const f = fixture();
  f.evidence.view.receipts.pop();
  const adapter = createNewtestExclusivePublication({
    ...f,
    provider: "github",
  });
  await adapter.qualify(f.actual.approval, f.actual.approvalHash);
  const binding = await adapter.admit(f.actual);
  assert.equal(
    (await adapter.executeOnce({ ...f.actual, binding })).outcome,
    "unknown",
  );
});

test("wrong actual artifact or accepted signed permit never reaches bind", async () => {
  const f = fixture();
  const adapter = createNewtestExclusivePublication({
    ...f,
    provider: "github",
  });
  await adapter.qualify(f.actual.approval, f.actual.approvalHash);
  await assert.rejects(
    adapter.admit({ ...f.actual, artifactId: "different-artifact" }),
    /measured_artifact/,
  );
  assert(!f.calls.includes("bind"));
  assert(!f.calls.includes("execute"));
});

test("lost bind ACK is sticky locally and does not permit another admission", async () => {
  const f = fixture();
  f.core.store.bind = async () => {
    f.calls.push("bind");
    throw new Error("lost ACK");
  };
  const adapter = createNewtestExclusivePublication({
    ...f,
    provider: "github",
  });
  await adapter.qualify(f.actual.approval, f.actual.approvalHash);
  await assert.rejects(adapter.admit(f.actual), /lost ACK/);
  await assert.rejects(adapter.admit(f.actual), /not_fresh/);
  await assert.rejects(
    adapter.executeOnce({ ...f.actual, binding: {} }),
    /not_fresh/,
  );
  assert.equal(f.calls.filter((v) => v === "bind").length, 1);
});

test("upfront ordinary workflow consumes genuine receipts and stops on restored state", async () => {
  const operations = [
    Op.ReviewRunAuthorize,
    Op.ReviewExecutionStart,
    Op.ReviewInvocationLeaseAcquire,
    Op.ReviewInvestigationOpenV2,
    Op.ReviewInvestigationRelayTurnPlan,
    Op.ReviewInvestigationRelayLeaseAcquire,
    Op.ReviewInvestigationRelayContextGatewayOpen,
  ];
  const statuses = [
    "authorized",
    "admitted",
    "acquired",
    "opened",
    "applied",
    "acquired",
    "opened",
  ];
  const calls = [];
  const input = {
    producer: {
      prepareRequest: async (op, receipts) => {
        const index = operations.indexOf(op);
        assert.equal(Object.keys(receipts).length, index);
        if (op === Op.ReviewRunAuthorize) return { marker: op };
        const planned = receipts[Op.ReviewInvestigationRelayTurnPlan];
        const lease = receipts[Op.ReviewInvestigationRelayLeaseAcquire];
        return {
          marker: op,
          authorizationToken:
            receipts[Op.ReviewRunAuthorize].authorizationToken,
          ...(planned
            ? { turnId: planned.turnId, turnCapability: planned.turnCapability }
            : {}),
          ...(lease
            ? {
                leaseCapability: lease.leaseCapability,
                sourceLeaseId: lease.leaseId,
                attemptId: lease.attemptId,
                fencingToken: lease.fencingToken,
                sourceLeaseAuthorityKind: "investigation_relay",
              }
            : {}),
        };
      },
    },
    client: {
      action: async (op, request) => {
        assert.equal(request.marker, op);
        calls.push(op);
        return {
          status: statuses[operations.indexOf(op)],
          authorizationToken: "NEWTEST-auth",
          authorizationId: "NEWTEST-auth-id",
          turnId: "NEWTEST-turn",
          turnCapability: "NEWTEST-turn-cap",
          attemptId: "NEWTEST-attempt",
          fencingToken: "1",
          leaseId: `NEWTEST-${op}`,
          leaseCapability: `NEWTEST-cap-${op}`,
        };
      },
    },
  };
  const receipts = await prepareNewtestActionWorkflow(input);
  assert.deepEqual(calls, operations);
  assert.equal(Object.keys(receipts).length, 7);
  statuses[1] = "restored";
  calls.length = 0;
  await assert.rejects(prepareNewtestActionWorkflow(input), /not_fresh/);
  assert.deepEqual(calls, operations.slice(0, 2));
});

test("lost intent ACK cannot proceed to artifact admission", async () => {
  const f = fixture();
  f.core.store.admitIntent = async () => {
    throw new Error("lost intent ACK");
  };
  const adapter = createNewtestExclusivePublication({
    ...f,
    provider: "github",
  });
  await assert.rejects(
    adapter.qualify(f.actual.approval, f.actual.approvalHash),
    /lost intent ACK/,
  );
  await assert.rejects(adapter.admit(f.actual), /not_fresh/);
  assert(!f.calls.includes("prepare"));
});

// Regression: a successful OPEN response is not a substitute for its actual
// stored session, or permission to read Git under a different source lease.
test("gateway composition rejects absent or differently leased actual records before Git reads", async () => {
  const scope = {
    repositoryGitHubId: "1252762369",
    workspaceId: "NEWTEST-workspace",
    repositoryConnectionId: "NEWTEST-connection",
    scmRepositoryIdentityId: "NEWTEST-repository",
    pullRequestNumber: 1,
  };
  const revision = {
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBaseSha: "c".repeat(40),
    reviewRevisionHash: "d".repeat(64),
  };
  const prepared = {
    [Op.ReviewRunAuthorize]: {
      status: "authorized",
      authorizationId: "auth",
      producerReleaseId: "release",
    },
    [Op.ReviewExecutionStart]: { status: "admitted", executionId: "execution" },
    [Op.ReviewInvestigationRelayLeaseAcquire]: {
      status: "acquired",
      leaseId: "lease",
      attemptId: "attempt",
      fencingToken: "1",
    },
    [Op.ReviewInvestigationRelayContextGatewayOpen]: {
      status: "opened",
      sessionId: "session",
      eventChainSeedHash: "e".repeat(64),
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  };
  let actualSession = null;
  let gitReads = 0;
  const input = {
    prepared,
    expectedTestScope: scope,
    workSlotId: "slot",
    measuredGatewayEntrypointSha256: "f".repeat(64),
    objects: {
      read: async () => {
        gitReads += 1;
        throw new Error("must not read Git");
      },
    },
    readers: {
      sessions: { findSession: async () => actualSession },
      executions: {
        findExecution: async () => ({
          execution: {
            ...scope,
            revision,
            authorizationId: "auth",
            producerReleaseId: "release",
            executionId: "execution",
            assignmentManifestCanonicalJson: "{}",
          },
        }),
      },
      releases: {
        findProducerReleaseById: async () => ({ producerReleaseId: "release" }),
      },
    },
  };
  await assert.rejects(
    createPreparedNewtestGateway(input),
    /actual_records_missing/,
  );
  actualSession = {
    sessionId: "session",
    producerReleaseId: "release",
    sourceExecutionId: "execution",
    sourceWorkSlotId: "slot",
    sourceLeaseId: "DIFFERENT-lease",
    attemptId: "attempt",
    sourceFencingToken: "1",
    sourceRevision: revision,
    scope,
    eventChainSeedHash:
      prepared[Op.ReviewInvestigationRelayContextGatewayOpen]
        .eventChainSeedHash,
    expiresAtMs: Date.parse("2099-01-01T00:00:00.000Z"),
  };
  await assert.rejects(
    createPreparedNewtestGateway(input),
    /actual_binding_mismatch/,
  );
  assert.equal(gitReads, 0);
});
