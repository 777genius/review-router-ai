import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  canonicalJson,
  type ReviewRunCompanionDispatch,
} from "@reviewrouter/features-review-run-control";
import type { ReviewModelDispatchSettlementV2 } from "@reviewrouter/shared";
import { createHostedModelDispatchProofReconciler } from "./review-model-dispatch-hosted-proof";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function fixture() {
  const dispatch: ReviewRunCompanionDispatch = {
    authorizationId: "authorization-1",
    dispatchId: "rr-model-" + "a".repeat(64),
    executionId: "execution-1",
    workSlotId: "discovery",
    attemptOrdinal: 1,
    leaseId: "lease-1",
    fencingToken: 1n,
    preparedManifestKey: "b".repeat(64),
    providerRequestEnvelopeHash: hash("native-request"),
    nativeRequestRef: "rr-companion-original",
    role: "finding_discovery",
    state: "dispatch_may_have_started",
    dispatchVersion: 2,
    requestOrdinal: 1,
    routeIdentityHash: "c".repeat(64),
    requestBytes: 123,
    maxOutputTokens: 4096,
  };
  const snapshot = {
    snapshotVersion: 3,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"d".repeat(64)}`,
    agent: {
      profileRef: "ocr-prepared",
      agentKind: "ocr",
      binarySha256: "e".repeat(64),
      packageVersion: "1.0.0",
      modelTransports: ["provider_api"],
      contextGateway: false,
      cancellation: true,
    },
    agentProfileDigest: "f".repeat(64),
    producer: {
      producerReleaseId: "release-1",
      actionCommitSha: "a".repeat(40),
      runtimeCommitSha: "b".repeat(40),
    },
    configurationCanonicalJson: canonicalJson({
      schemaVersion: 3,
      providers: [
        { authMode: "codex_subscription_oauth_hosted_pool", model: "gpt-5.5" },
      ],
    }),
    // Intentionally expired: paid-effect receipt reconciliation is not fresh admission.
    deadline: "2026-01-01T00:00:00.000Z",
    gateway: null,
    modelDispatchCapability: {
      extensionId: "review-model-dispatch.v2",
      version: 2,
      transport: "hosted_pool",
      wireProtocol: "codex-responses",
      outputTokenLimit: "terminal_acceptance",
      routeIdentityHash: dispatch.routeIdentityHash,
      providerIndex: 0,
      model: "gpt-5.5",
      deadline: "2026-01-01T00:00:00.000Z",
      maxRequests: 32,
      maxConcurrentRequests: 1,
      maxRequestBytes: 65536,
      maxResponseBytes: 32768,
      maxOutputTokens: 4096,
    },
    hosted: {
      grantId: "original-grant",
      invocationId: "invocation-1",
      poolId: "pool-1",
      repositoryBindingId: "binding-1",
      activeAccountId: "original-account",
      reviewRequestId: "request-1",
      providerInvocationKey: "1".repeat(64),
      policyFingerprint: "2".repeat(64),
      model: "gpt-5.5",
      expiresAt: "2026-01-01T00:01:00.000Z",
      bindingRevision: 1,
      runtimeConfigVersion: 1,
      authzEpoch: "1",
      runtimeAuthzEpoch: "1",
    },
  };
  const row = {
    authorityKind: "v1_comment",
    grantId: "original-grant",
    requestHash: dispatch.providerRequestEnvelopeHash,
    requestBytes: dispatch.requestBytes,
    status: "succeeded",
    completedAt: new Date("2026-01-01"),
    responseHash: hash("native-response"),
    responseBytes: 100,
    errorCode: null as string | null,
    upstreamAttempts: [
      {
        authorityKind: "v1_comment",
        grantId: "original-grant",
        accountId: "original-account",
        requestHash: dispatch.providerRequestEnvelopeHash,
        state: "succeeded",
      },
    ],
  };
  const findRequest = vi.fn(async () => row as typeof row | null);
  const settle = vi.fn(async () => undefined);
  const reconcile = createHostedModelDispatchProofReconciler({
    prisma: {
      reviewRunAuthorization: {
        findUnique: async () => ({
          runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
        }),
      },
      hostedCodexRelayRequest: { findUnique: findRequest },
    } as unknown as Parameters<
      typeof createHostedModelDispatchProofReconciler
    >[0]["prisma"],
    admission: { settle },
  });
  const receipt: ReviewModelDispatchSettlementV2 = {
    state: "completed",
    receipt: {
      version: 2,
      routeIdentityHash: dispatch.routeIdentityHash!,
      providerRequestEnvelopeHash: dispatch.providerRequestEnvelopeHash,
      actualModel: "gpt-5.5",
      responseHash: row.responseHash,
      responseBytes: row.responseBytes,
      fullyConsumed: true,
      terminal: "completed",
      usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
    },
  };
  return { dispatch, row, findRequest, settle, reconcile, receipt };
}

it("reconciles the exact original native request after grant expiry without creating or refreshing authority", async () => {
  const f = fixture();
  await expect(f.reconcile(f.dispatch, f.receipt)).resolves.toBe("completed");
  expect(f.findRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        grantId_idempotencyKeyHash: {
          grantId: "original-grant",
          idempotencyKeyHash: hash(f.dispatch.nativeRequestRef),
        },
      },
    }),
  );
  expect(f.settle).toHaveBeenCalledWith(
    "authorization-1",
    f.dispatch.dispatchId,
    "completed",
  );
});

it.each([
  "missing",
  "other_grant",
  "changed_wire",
  "changed_bytes",
  "changed_account",
  "unknown_effect",
  "duplicate_success",
  "oversized_response",
  "changed_response_hash",
])(
  "rejects %s as native completion proof and never invents an unpaid outcome",
  async (change) => {
    const f = fixture();
    if (change === "missing") f.findRequest.mockResolvedValue(null);
    if (change === "other_grant") f.row.grantId = "other-grant";
    if (change === "changed_wire") f.row.requestHash = hash("different-wire");
    if (change === "changed_bytes") f.row.requestBytes = 124;
    if (change === "changed_account")
      f.row.upstreamAttempts[0]!.accountId = "backup-account";
    if (change === "unknown_effect")
      f.row.upstreamAttempts[0]!.state = "terminal_unknown";
    if (change === "duplicate_success")
      f.row.upstreamAttempts.push({ ...f.row.upstreamAttempts[0]! });
    if (change === "oversized_response") f.row.responseBytes = 32769;
    if (change === "changed_response_hash")
      f.row.responseHash = hash("different-response");
    await expect(f.reconcile(f.dispatch, f.receipt)).rejects.toMatchObject({
      code: "model_dispatch_native_proof_required",
    });
    expect(f.settle).not.toHaveBeenCalled();
  },
);

it("accepts no-dispatch only from the exact native ledger's positive no-effect proof", async () => {
  const f = fixture();
  f.row.status = "failed";
  f.row.errorCode = "upstream_dispatch_not_started";
  f.row.upstreamAttempts[0]!.state = "failed_no_effect";
  await expect(f.reconcile(f.dispatch)).resolves.toBe("not_dispatched");
  expect(f.settle).toHaveBeenCalledWith(
    "authorization-1",
    f.dispatch.dispatchId,
    "not_dispatched",
  );
  f.settle.mockClear();
  f.row.upstreamAttempts[0]!.state = "terminal_unknown";
  await expect(f.reconcile(f.dispatch)).resolves.toBeUndefined();
  expect(f.settle).not.toHaveBeenCalled();
});
