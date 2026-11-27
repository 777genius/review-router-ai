import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  ClaimReviewRunCompanionDispatch,
  ReviewProtocolVersion,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenAudience,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  ReviewRunCompanionDispatchFailure,
  type ReviewRunAuthorization,
  type ReviewRunCompanionDispatchClaim,
  type ReviewRunCompanionDispatch,
} from "@reviewrouter/features-review-run-control";
import { PrismaReviewRunCompanionDispatchRepository } from "@reviewrouter/features-review-run-control/composition";
import {
  reviewModelDispatchContract,
  reviewModelDispatchCapacity128Contract,
  reviewModelDispatchCapacity128DescriptorDigest,
  reviewModelDispatchDescriptorDigest,
  reviewModelDispatchNativeRetryContract,
  reviewModelDispatchNativeRetryDescriptorDigest,
  reviewModelDispatchIdPreimage,
  type ReviewModelDispatchCapability,
  type ReviewModelDispatchProfile,
  type ReviewModelDispatchSettlementV2,
  type ReviewModelTransport,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { createReviewDispatchDatabaseFixture } from "./test-support/review-dispatch-database-fixture";
import { assertReviewModelDispatchEvidence } from "./review-model-dispatch-evidence";
import {
  registerReviewModelDispatchRoutes,
  type ReviewModelDispatchApi,
  type ReviewModelDispatchClaimFailureDiagnostic,
} from "./review-model-dispatch";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Fixture = Awaited<
  ReturnType<typeof createReviewDispatchDatabaseFixture>
> & {
  budget: ReviewModelDispatchCapability;
};

describe("model dispatch claim failure diagnostics", () => {
  for (const throwingSink of [false, true]) {
    it.each([
      {
        name: "malformed JSON before the handler",
        authorized: false,
        authority: true,
        invalidBody: false,
        error: new Error("secret-native-error"),
        status: 500,
        code: "model_dispatch_unavailable",
        phase: "input",
      },
      {
        name: "denied authorization",
        authorized: false,
        authority: true,
        invalidBody: false,
        error: new Error("secret-native-error"),
        status: 401,
        code: "model_dispatch_authorization_denied",
        phase: "authentication",
      },
      {
        name: "changed authority",
        authorized: true,
        authority: false,
        invalidBody: false,
        error: new Error("secret-native-error"),
        status: 409,
        code: "model_dispatch_authority_changed",
        phase: "authority",
      },
      {
        name: "invalid body",
        authorized: true,
        authority: true,
        invalidBody: true,
        error: new Error("secret-native-error"),
        status: 400,
        code: "model_dispatch_request_invalid",
        phase: "body",
      },
      {
        name: "known admission rejection",
        authorized: true,
        authority: true,
        invalidBody: false,
        error: new ReviewRunCompanionDispatchFailure(
          "model_dispatch_profile_mismatch",
        ),
        status: 409,
        code: "model_dispatch_profile_mismatch",
        phase: "admission",
      },
      {
        name: "unknown admission rejection code",
        authorized: true,
        authority: true,
        invalidBody: false,
        error: new ReviewRunCompanionDispatchFailure("secret-native-error"),
        status: 409,
        code: "secret-native-error",
        phase: "admission",
      },
      {
        name: "unexpected admission error",
        authorized: true,
        authority: true,
        invalidBody: false,
        error: Object.assign(new Error("secret-native-error"), {
          code: "model_dispatch_profile_mismatch",
        }),
        status: 500,
        code: "model_dispatch_unavailable",
        phase: "admission",
      },
    ])("$name (throwing sink: " + throwingSink + ")", async (testCase) => {
      const authorization = {
        authorizationId: "server-resolved-authorization",
      } as ReviewRunAuthorization;
      const events: ReviewModelDispatchClaimFailureDiagnostic[] = [];
      const app = Fastify({ logger: false });
      const reject = async (): Promise<never> => {
        throw testCase.error;
      };
      const api: ReviewModelDispatchApi = {
        authorizations: {
          resolveReviewRunAuthorizationToken: async () =>
            testCase.authorized
              ? {
                  status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
                  authorization,
                }
              : { status: ReviewRunAuthorizationTokenResolutionStatus.Expired },
        },
        checkAuthority: async () => testCase.authority,
        admission: {
          claim: reject,
          forward: reject,
          read: reject,
          readReceipt: reject,
          settle: reject,
          settleReceipt: reject,
          recordNativeRejection: reject,
        },
      };
      await registerReviewModelDispatchRoutes(app, api, (event) => {
        events.push(event);
        if (throwingSink) throw new Error("secret-logger-error");
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      try {
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("fixture");
        const response = await fetch(
          `http://127.0.0.1:${address.port}${reviewModelDispatchContract.claimPath}`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer secret-run-token",
              "content-type": "application/json",
              "x-untrusted-authorization-id": "secret-caller-authorization",
            },
            body:
              testCase.phase === "input"
                ? "{secret-request-body"
                : JSON.stringify(
                    testCase.invalidBody
                      ? { secret: "secret-request-body" }
                      : {
                          dispatchVersion: 2,
                          dispatchId: `rr-model-${"a".repeat(64)}`,
                          executionId: "secret-caller-execution",
                          workSlotId: "secret-caller-slot",
                          attemptOrdinal: 1,
                          requestOrdinal: 1,
                          leaseId: "secret-caller-lease",
                          leaseCapability: "secret-lease-capability",
                          fencingToken: "1",
                          preparedManifestKey: "secret-caller-manifest",
                          routeIdentityHash: "b".repeat(64),
                          providerRequestEnvelopeHash: "c".repeat(64),
                          requestBytes: 1024,
                          maxOutputTokens: 1024,
                        },
                  ),
          },
        );
        expect(response.status).toBe(testCase.status);
        expect(await response.json()).toEqual({ code: testCase.code });
        expect(events).toEqual([
          {
            event: "review_model_dispatch_claim_rejected",
            phase: testCase.phase,
            code:
              testCase.code === "secret-native-error"
                ? "model_dispatch_unavailable"
                : testCase.code,
            httpStatus: testCase.status,
            ...(testCase.authorized
              ? { authorizationId: authorization.authorizationId }
              : {}),
          },
        ]);
        expect(JSON.stringify(events)).not.toContain("secret-");
      } finally {
        await app.close();
      }
    });
  }
});

describe("authenticated frozen model dispatch capacity over HTTP", () => {
  it.each([
    { policy: null, maximum: 32, ordinal: 32, status: 409 },
    { policy: null, maximum: 32, ordinal: 33, status: 400 },
    {
      policy: "model-dispatch-policy.capacity128.v1",
      maximum: 128,
      ordinal: 33,
      status: 409,
    },
    {
      policy: "model-dispatch-policy.capacity128.v1",
      maximum: 128,
      ordinal: 128,
      status: 409,
    },
    {
      policy: "model-dispatch-policy.capacity128.v1",
      maximum: 128,
      ordinal: 129,
      status: 400,
    },
    {
      policy: "model-dispatch-policy.capacity128.v1",
      maximum: 16,
      ordinal: 17,
      status: 400,
    },
    { policy: "unapproved-capacity", maximum: 128, ordinal: 33, status: 400 },
  ])(
    "selects ordinal$ordinal from frozen policy=$policy/max$maximum before admission",
    async ({ policy, maximum, ordinal, status }) => {
      const cap = {
        extensionId: "review-model-dispatch.v2",
        version: 2,
        ...(policy ? { capacityPolicy: policy } : {}),
        routeIdentityHash: "b".repeat(64),
        transport: "runner_local_responses",
        wireProtocol: "openai-responses",
        outputTokenLimit: "upstream_request",
        providerIndex: 0,
        model: "qualified-model",
        deadline: "2126-10-21T00:00:00.000Z",
        maxRequests: maximum,
        maxConcurrentRequests: 1,
        maxRequestBytes: 65536,
        maxResponseBytes: 32768,
        maxOutputTokens: 4096,
      };
      const authorization = {
        authorizationId: "server-resolved-authorization",
        runtimeSnapshotCanonicalJson: canonicalJson({
          snapshotVersion: 3,
          configurationSource: "workspace",
          configurationVersion: 1,
          workspaceConfigurationVersion: 1,
          repositoryConfigurationVersion: null,
          effectivePolicyDigest: `sha256:${"d".repeat(64)}`,
          agent: {
            profileRef: "ocr-qualified",
            agentKind: "ocr",
            binarySha256: "e".repeat(64),
            packageVersion: "1.0.0",
            modelTransports: ["provider_api"],
            contextGateway: false,
            cancellation: true,
            reviewSkillsVersion: 1,
          },
          agentProfileDigest: "f".repeat(64),
          producer: {
            producerReleaseId: "release",
            actionCommitSha: "a".repeat(40),
            runtimeCommitSha: "b".repeat(40),
          },
          configurationCanonicalJson: canonicalJson({
            schemaVersion: 3,
            providers: [
              { authMode: "openrouter_api_key", model: "qualified-model" },
            ],
          }),
          deadline: cap.deadline,
          gateway: null,
          modelDispatchCapability: cap,
        }),
      } as ReviewRunAuthorization;
      const admittedOrdinals: number[] = [];
      const unavailable = async (): Promise<never> => {
        throw new Error("unexpected_fixture_call");
      };
      const app = Fastify({ logger: false });
      await registerReviewModelDispatchRoutes(app, {
        authorizations: {
          resolveReviewRunAuthorizationToken: async () => ({
            status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
            authorization,
          }),
        },
        checkAuthority: async () => true,
        admission: {
          claim: async (_authorization, claim) => {
            admittedOrdinals.push(claim.requestOrdinal!);
            throw new ReviewRunCompanionDispatchFailure(
              "model_dispatch_budget_exhausted",
            );
          },
          forward: unavailable,
          read: unavailable,
          readReceipt: unavailable,
          settle: unavailable,
          settleReceipt: unavailable,
          recordNativeRejection: unavailable,
        },
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      try {
        const address = app.server.address();
        if (!address || typeof address === "string") throw new Error("fixture");
        const response = await fetch(
          `http://127.0.0.1:${address.port}${reviewModelDispatchContract.claimPath}`,
          {
            method: "POST",
            headers: {
              authorization: "Bearer synthetic-run-capability",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              dispatchVersion: 2,
              dispatchId: `rr-model-${"a".repeat(64)}`,
              executionId: "execution",
              workSlotId: "discovery",
              attemptOrdinal: 1,
              requestOrdinal: ordinal,
              leaseId: "lease",
              leaseCapability: "synthetic-lease",
              fencingToken: "1",
              preparedManifestKey: "manifest",
              routeIdentityHash: cap.routeIdentityHash,
              providerRequestEnvelopeHash: "c".repeat(64),
              requestBytes: 1024,
              maxOutputTokens: 1024,
            }),
          },
        );
        expect(response.status).toBe(status);
        expect(await response.json()).toEqual({
          code:
            status === 409
              ? "model_dispatch_budget_exhausted"
              : "model_dispatch_request_invalid",
        });
        expect(admittedOrdinals).toEqual(status === 409 ? [ordinal] : []);
      } finally {
        await app.close();
      }
    },
  );
});

it.each([
  { name: "live receipt", hasReceipt: true, custody: "live", expires: false },
  { name: "lost custody", hasReceipt: true, custody: "lost", expires: false },
  {
    name: "run bearer only",
    hasReceipt: false,
    custody: "live",
    expires: false,
  },
  {
    name: "expiry during custody check",
    hasReceipt: true,
    custody: "live",
    expires: true,
  },
  {
    name: "custody unavailable",
    hasReceipt: true,
    custody: "failed",
    expires: false,
  },
] as const)(
  "refreshes receipt readback and gates actionable proof: $name",
  async ({ hasReceipt, custody, expires }) => {
    let row: ReviewRunCompanionDispatch = {
      authorizationId: "original-auth",
      dispatchId: `rr-model-${"a".repeat(64)}`,
      executionId: "original-execution",
      workSlotId: "discovery",
      attemptOrdinal: 1,
      leaseId: "original-lease",
      fencingToken: 1n,
      preparedManifestKey: "manifest",
      providerRequestEnvelopeHash: "b".repeat(64),
      nativeRequestRef: "original-native-request",
      role: "finding_discovery",
      state: "dispatch_may_have_started",
      dispatchVersion: 2,
      requestOrdinal: 1,
      routeIdentityHash: "c".repeat(64),
      requestBytes: 200,
      maxOutputTokens: 1000,
    };
    const now = new Date();
    const authorization: ReviewRunAuthorization = {
      workspaceId: "original-workspace",
      repositoryConnectionId: "original-repository",
      scmRepositoryIdentityId: "original-scm-repository",
      pullRequestNumber: 42,
      baseSha: "a".repeat(40),
      mergeBaseSha: "b".repeat(40),
      headSha: "c".repeat(40),
      reviewRevisionHash: "d".repeat(64),
      authorizationId: row.authorizationId,
      version: 1,
      sourceRunId: "original-source-run",
      sourceRunAttempt: "1",
      workflowIdentityHash: "e".repeat(64),
      trustDomain: ReviewTrustDomain.TrustedManaged,
      producerReleaseId: "original-release",
      selectedProtocolVersion: ReviewProtocolVersion.V2,
      schemaDigest: "f".repeat(64),
      protocolLimitsProfileId: "original-limits",
      operationalSloProfileId: "original-slo",
      mutationEpoch: 1n,
      providerVoteLanes: [],
      reviewInvestigationAuthorizationDescriptorCanonicalJson: null,
      authorizationSafetyDecisionHash: "1".repeat(64),
      protocolOfferHash: "2".repeat(64),
      oidcReplayKeyHash: "3".repeat(64),
      tokenSigningKeyId: "original-signing-key",
      tokenIssuer: "reviewrouter-review-run-control",
      tokenAudience: ReviewRunAuthorizationTokenAudience.ReviewRun,
      state: ReviewRunAuthorizationState.Active,
      expiresAt: new Date(now.getTime() + 120_000),
      maxExpiresAt: new Date(now.getTime() + 120_000),
      createdAt: now,
      renewedAt: null,
    };
    let reads = 0;
    let custodyChecks = 0;
    let monotonicNow = 1_000;
    let wallClockNow = Date.UTC(2126, 0, 1);
    const denied = async (): Promise<never> => {
      throw new Error("unexpected_authority_request");
    };
    const app = Fastify({ logger: false });
    await registerReviewModelDispatchRoutes(app, {
      authorizations: {
        resolveReviewRunAuthorizationToken: async ({ token }) => {
          expect(hasReceipt).toBe(false);
          expect(token).toBe("original-run-token");
          return {
            status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
            authorization,
          };
        },
      },
      checkAuthority: denied,
      canReadNativeRetryProof: async (dispatch) => {
        custodyChecks++;
        expect(dispatch.nativeRetryProof).toEqual({
          kind: "native_rejection_after_forward",
          reason: "admission_storage_conflict",
        });
        if (custody === "failed")
          throw new Error("disposable_custody_unavailable");
        if (custody === "live") {
          const cutoff = dispatch.nativeRetryProofNotAfter!;
          expect(cutoff).toBeGreaterThan(performance.now());
          // Custody spans an await while wall time moves backwards. Only the
          // original monotonic cutoff controls its exact expiry boundary.
          await Promise.resolve();
          monotonicNow = expires ? cutoff : cutoff - 1;
          wallClockNow = Date.UTC(1970, 0, 1);
        }
        return custody === "live";
      },
      reconcileNativeProof: async () => {
        row = {
          ...row,
          state: "not_dispatched",
          nativeRetryProofNotAfter:
            performance.now() + (expires ? 1_000 : 60_000),
          nativeRetryProof: {
            kind: "native_rejection_after_forward",
            reason: "admission_storage_conflict",
          },
        };
        return "not_dispatched";
      },
      admission: {
        claim: denied,
        forward: denied,
        read: async (authorizationId, dispatchId) => {
          expect(hasReceipt).toBe(false);
          expect(authorizationId).toBe(row.authorizationId);
          expect(dispatchId).toBe(row.dispatchId);
          reads++;
          return { ...row };
        },
        settle: denied,
        settleReceipt: denied,
        recordNativeRejection: denied,
        readReceipt: async (dispatchId, token) => {
          expect(hasReceipt).toBe(true);
          expect(dispatchId).toBe(row.dispatchId);
          expect(token).toBe("d".repeat(64));
          reads++;
          return { ...row };
        },
      },
    });
    const monotonic = vi
      .spyOn(performance, "now")
      .mockImplementation(() => monotonicNow);
    const wall = vi.spyOn(Date, "now").mockImplementation(() => wallClockNow);
    try {
      const response = await app.inject({
        method: "GET",
        url: `${reviewModelDispatchContract.basePath}/${row.dispatchId}`,
        headers: hasReceipt
          ? { [reviewModelDispatchContract.receiptHeader]: "d".repeat(64) }
          : { authorization: "Bearer original-run-token" },
      });
      expect(response.statusCode).toBe(200);
      expect(reads).toBe(2);
      expect(response.json().dispatch.state).toBe("not_dispatched");
      expect(custodyChecks).toBe(hasReceipt ? 1 : 0);
      expect(response.json().dispatch).not.toHaveProperty(
        "nativeRetryProofNotAfter",
      );
      if (hasReceipt && custody === "live" && !expires)
        expect(response.json().dispatch.nativeRetryProof).toEqual({
          kind: "native_rejection_after_forward",
          reason: "admission_storage_conflict",
        });
      else
        expect(response.json().dispatch).not.toHaveProperty("nativeRetryProof");
    } finally {
      try {
        await app.close();
      } finally {
        monotonic.mockRestore();
        wall.mockRestore();
      }
    }
  },
);

describeDatabase("durable V2 model dispatch with PostgreSQL", () => {
  const fixtures: Fixture[] = [];
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.dispose();
  });

  async function fixture(
    maxRequests = 4,
    transport: ReviewModelTransport = "runner_local_responses",
    capacity128 = false,
    frozenCapacity128 = capacity128,
    nativeRetry = false,
    gatewayDeadline?: Date,
  ): Promise<Fixture> {
    const prefix = `model-dispatch-test-${randomUUID()}`;
    const deadline = new Date(Date.now() + 600_000).toISOString();
    const originalDeadline = gatewayDeadline?.toISOString() ?? deadline;
    const limits = {
      maxRequests,
      maxConcurrentRequests: 1 as const,
      maxRequestBytes: 65536,
      maxResponseBytes: 32768,
      maxOutputTokens: 4096,
    };
    const budget: ReviewModelDispatchCapability = {
      ...limits,
      ...(nativeRetry
        ? { retryPolicy: reviewModelDispatchNativeRetryContract.retryPolicy }
        : {}),
      ...(frozenCapacity128 || nativeRetry
        ? {
            capacityPolicy:
              reviewModelDispatchCapacity128Contract.capacityPolicy,
          }
        : {}),
      extensionId: reviewModelDispatchContract.extensionId,
      version: 2,
      transport,
      wireProtocol:
        transport === "account_gateway"
          ? "openai-responses"
          : transport === "runner_local_anthropic"
            ? "anthropic-messages"
            : "codex-responses",
      outputTokenLimit:
        transport === "runner_local_anthropic"
          ? "upstream_request"
          : "terminal_acceptance",
      routeIdentityHash: hash(`${prefix}-original-account-model-route`),
      providerIndex: 0,
      model: "gpt-5.5",
      deadline: originalDeadline,
    };
    const profile: ReviewModelDispatchProfile = {
      extensionId: reviewModelDispatchContract.extensionId,
      descriptorDigest: nativeRetry
        ? reviewModelDispatchNativeRetryDescriptorDigest
        : capacity128
          ? reviewModelDispatchCapacity128DescriptorDigest
          : reviewModelDispatchDescriptorDigest,
      policyVersion: nativeRetry
        ? reviewModelDispatchNativeRetryContract.policyVersion
        : capacity128
          ? reviewModelDispatchCapacity128Contract.policyVersion
          : reviewModelDispatchContract.policyVersion,
      transports: [transport],
      wireProtocols: [budget.wireProtocol],
      defaultAgentProfileRefs: { [transport]: "codex-default" },
      limits,
    };
    const gateway = transport === "account_gateway";
    const runtimeSnapshotCanonicalJson = canonicalJson({
      snapshotVersion: 3,
      configurationSource: "repository",
      configurationVersion: 1,
      workspaceConfigurationVersion: 1,
      repositoryConfigurationVersion: 1,
      effectivePolicyDigest: `sha256:${hash("policy")}`,
      agent: {
        profileRef: "codex-default",
        agentKind: "codex",
        binarySha256: hash("binary"),
        packageVersion: "0.147.0",
        modelTransports: [gateway ? "account_gateway" : "provider_api"],
        contextGateway: true,
        cancellation: true,
      },
      agentProfileDigest: hash("profile"),
      producer: {
        producerReleaseId: `${prefix}-release`,
        actionCommitSha: "a".repeat(40),
        runtimeCommitSha: "b".repeat(40),
      },
      configurationCanonicalJson: canonicalJson(
        gateway
          ? {
              ...workspacePolicyFixture,
              providers: [
                {
                  ...workspacePolicyFixture.providers[0],
                  authMode: "codex_account_gateway",
                  gatewayBindingId: "binding-1",
                  gatewayProfileRef: "profile-1",
                },
              ],
            }
          : workspacePolicyFixture,
      ),
      deadline: originalDeadline,
      modelDispatchCapability: budget,
      gateway: gateway
        ? {
            providerIndex: 0,
            bindingId: "binding-1",
            connectionId: "connection-1",
            bindingRevision: 1,
            policySubject: "binding-1",
            policyRevision: 1,
            permittedAccountRef: "original-account",
            profileRef: "profile-1",
            invocationId: "invocation-1",
            attemptId: "attempt-1",
            operationId: "operation-1",
            limits: {
              requests: maxRequests,
              concurrency: 1,
              requestBytes: 65536,
              outputBytes: 32768,
              tokens: 4096,
            },
          }
        : null,
    });
    const result = {
      ...(await createReviewDispatchDatabaseFixture(databaseUrl!, prefix, {
        runtimeSnapshotCanonicalJson,
        modelDispatchProfile: profile,
        skipInitialLease: true,
        ...(nativeRetry ? { deadlineAt: new Date(deadline) } : {}),
        ...(gatewayDeadline
          ? { authorizationDeadlineAt: gatewayDeadline }
          : {}),
      })),
      budget,
    };
    fixtures.push(result);
    if (nativeRetry)
      await result.prisma.reviewRunAuthorization.update({
        where: { authorizationId: `${prefix}-auth` },
        data: {
          gatewayExecutionCanonicalJson: canonicalJson({
            bindingVersion: 1,
            operationId: "operation-1",
            executionRef: "original-gateway-execution",
            accountRef: "original-account",
            authorizationEpoch: 1,
            deadline: originalDeadline,
          }),
        },
      });
    return result;
  }
  function claim(
    base: ReviewRunCompanionDispatchClaim,
    f: Fixture,
    ordinal = 1,
  ): ReviewRunCompanionDispatchClaim {
    return {
      ...base,
      dispatchVersion: 2,
      requestOrdinal: ordinal,
      routeIdentityHash: f.budget.routeIdentityHash,
      requestBytes: 200,
      maxOutputTokens: 1024,
      providerRequestEnvelopeHash:
        base.workSlotId === "discovery"
          ? hash(`wire-${ordinal}`)
          : base.providerRequestEnvelopeHash,
      dispatchId: `rr-model-${hash(reviewModelDispatchIdPreimage({ ...base, requestOrdinal: ordinal }))}`,
    };
  }
  function completed(
    c: ReviewRunCompanionDispatchClaim,
    f: Fixture,
  ): ReviewModelDispatchSettlementV2 {
    return {
      state: "completed",
      receipt: {
        version: 2,
        routeIdentityHash: f.budget.routeIdentityHash,
        providerRequestEnvelopeHash: c.providerRequestEnvelopeHash,
        actualModel: f.budget.model,
        responseHash: hash(`response-${c.requestOrdinal}`),
        responseBytes: 100,
        fullyConsumed: true,
        terminal: "completed",
        usage: { inputTokens: 50, outputTokens: 25, totalTokens: 75 },
      },
    };
  }
  async function finish(f: Fixture, c: ReviewRunCompanionDispatchClaim) {
    const result = await f.repository.claim(c);
    expect(result.status).toBe("claimed");
    await f.repository.settleReceipt(
      c.dispatchId,
      result.receiptToken!,
      completed(c, f),
    );
    return result;
  }
  async function closeSlot(f: Fixture, c: ReviewRunCompanionDispatchClaim) {
    await f.releaseClaim(c);
    await f.prisma.reviewExecutionWorkSlotV2.update({
      where: {
        executionId_workSlotId: {
          executionId: c.executionId,
          workSlotId: c.workSlotId,
        },
      },
      data: { state: "exhausted" },
    });
  }

  it.each([false, true])(
    "serializes duplicate claims, preserves unknown fences and never refunds positively unpaid reservations (capacity128=%s)",
    async (capacity128) => {
      const f = await fixture(4, "runner_local_responses", capacity128);
      const base = await f.acquireClaim(0);
      const first = claim(base, f);
      const pair = await Promise.all([
        f.repository.claim(first),
        f.repository.claim(first),
      ]);
      expect(pair.map((result) => result.status).sort()).toEqual([
        "claimed",
        "restored",
      ]);
      const fresh = pair.find((result) => result.status === "claimed")!;
      expect(fresh.receiptToken).toMatch(/^[a-f0-9]{64}$/);
      expect(
        pair.find((result) => result.status === "restored"),
      ).not.toHaveProperty("receiptToken");
      await expect(
        f.repository.claim({
          ...first,
          providerRequestEnvelopeHash: hash("changed-wire"),
        }),
      ).rejects.toMatchObject({ code: "companion_dispatch_conflict" });
      const second = claim(base, f, 2);
      await expect(f.repository.claim(second)).rejects.toMatchObject({
        code: "model_dispatch_effect_unresolved",
      });
      await f.repository.settleReceipt(first.dispatchId, fresh.receiptToken!, {
        state: "effect_unknown",
      });
      const restarted = new PrismaReviewRunCompanionDispatchRepository(
        f.prisma,
        {
          lockSelection: async () => true,
          validateManifest: () => {},
        },
      );
      await expect(restarted.claim(first)).resolves.toMatchObject({
        status: "restored",
        dispatch: { state: "effect_unknown" },
      });
      await expect(restarted.claim(second)).rejects.toMatchObject({
        code: "model_dispatch_effect_unresolved",
      });
      await f.repository.settleReceipt(first.dispatchId, fresh.receiptToken!, {
        state: "not_dispatched",
        proof: "local_before_forward",
      });
      await finish(f, second);
      expect(
        await f.prisma.reviewRunCompanionDispatchV1.count({
          where: { authorizationId: base.authorizationId },
        }),
      ).toBe(2);
      await expect(
        assertReviewModelDispatchEvidence({
          prisma: f.prisma,
          authorization: {
            authorizationId: base.authorizationId,
            runtimeSnapshotCanonicalJson: f.snapshot,
          },
          executionId: base.executionId,
          workSlotId: base.workSlotId,
          leaseId: base.leaseId,
          fencingToken: base.fencingToken,
          preparedManifestKey: base.preparedManifestKey,
          providerRequestEnvelopeHash: base.providerRequestEnvelopeHash,
          actualModel: f.budget.model,
          role: "finding_discovery",
        }),
      ).resolves.toBeUndefined();
    },
  );

  it.each([false, true])(
    "shares the original allowance across discovery and verifier and rejects the V1 escape path (capacity128=%s)",
    async (capacity128) => {
      const f = await fixture(3, "runner_local_responses", capacity128);
      const discovery = await f.acquireClaim(0);
      await expect(f.repository.claim(discovery)).rejects.toMatchObject({
        code: "model_dispatch_version_required",
      });
      await finish(f, claim(discovery, f, 1));
      await finish(f, claim(discovery, f, 2));
      await closeSlot(f, discovery);
      const verifier = await f.acquireClaim(1);
      await finish(f, claim(verifier, f));
      await closeSlot(f, verifier);
      const nextVerifier = claim(await f.acquireClaim(2), f);
      await expect(f.repository.claim(nextVerifier)).rejects.toMatchObject({
        code: "model_dispatch_budget_exhausted",
      });
      expect(
        await f.prisma.reviewRunCompanionDispatchV1.count({
          where: { authorizationId: discovery.authorizationId },
        }),
      ).toBe(3);
    },
  );

  it.each([
    { capacity128: false, allowance: 32 },
    { capacity128: true, allowance: 128 },
  ])(
    "reserves exactly the explicitly approved $allowance requests and denies the next ordinal",
    async ({ capacity128, allowance }) => {
      const f = await fixture(allowance, "runner_local_responses", capacity128);
      const base = await f.acquireClaim(0);
      for (let ordinal = 1; ordinal <= allowance; ordinal++)
        await finish(f, claim(base, f, ordinal));
      await expect(
        f.repository.claim(claim(base, f, allowance + 1)),
      ).rejects.toMatchObject({ code: "model_dispatch_claim_invalid" });
      expect(
        await f.prisma.reviewRunCompanionDispatchV1.count({
          where: { authorizationId: base.authorizationId },
        }),
      ).toBe(allowance);
    },
    60000,
  );

  it.each([false, true])(
    "denies mixed frozen/release capacity identity even when numeric limits fit both (capacity128=%s)",
    async (capacity128) => {
      const f = await fixture(
        4,
        "runner_local_responses",
        capacity128,
        !capacity128,
      );
      const base = await f.acquireClaim(0);
      await expect(f.repository.claim(claim(base, f))).rejects.toMatchObject({
        code: "model_dispatch_profile_mismatch",
      });
      expect(
        await f.prisma.reviewRunCompanionDispatchV1.count({
          where: { authorizationId: base.authorizationId },
        }),
      ).toBe(0);
    },
  );

  async function reservedNative(
    f: Fixture,
    c: ReviewRunCompanionDispatchClaim,
  ) {
    const reservation = await f.repository.claim(c);
    await f.repository.claim({ ...c, forwardExisting: true });
    return reservation;
  }
  const nativeProof = (requestRef: string) => ({
    kind: "request-retry-proof/v1" as const,
    consumerId: "original-gateway-consumer",
    executionRef: "original-gateway-execution",
    requestRef,
    nonEntryReason: "admission_storage_conflict" as const,
    transportClosed: true as const,
  });
  const nativeSettlement = {
    state: "not_dispatched" as const,
    proof: "native_rejection_after_forward" as const,
  };
  const successor = (
    original: ReviewRunCompanionDispatchClaim,
    f: Fixture,
  ) => ({
    ...claim(original, f, original.requestOrdinal! + 1),
    providerRequestEnvelopeHash: original.providerRequestEnvelopeHash,
    retryOfDispatchId: original.dispatchId,
  });

  it("preserves a prior paid turn and spends exactly one concurrent fresh native successor", async () => {
    const f = await fixture(4, "account_gateway", true, true, true);
    const base = await f.acquireClaim(0);
    const prior = claim(base, f);
    const paid = await reservedNative(f, prior);
    await f.repository.settle(
      prior.authorizationId,
      prior.dispatchId,
      "completed",
    );
    await f.repository.settleReceipt(
      prior.dispatchId,
      paid.receiptToken!,
      completed(prior, f),
    );
    const before =
      await f.prisma.reviewRunCompanionDispatchV1.findUniqueOrThrow({
        where: {
          authorizationId_dispatchId: {
            authorizationId: prior.authorizationId,
            dispatchId: prior.dispatchId,
          },
        },
      });
    const original = claim(base, f, 2);
    const rejected = await reservedNative(f, original);
    const proof = nativeProof(rejected.dispatch.nativeRequestRef);
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      proof,
    );
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      proof,
    );
    await expect(
      f.repository.settleReceipt(original.dispatchId, rejected.receiptToken!, {
        state: "not_dispatched",
        proof: "local_before_forward",
      }),
    ).rejects.toMatchObject({ code: "model_dispatch_native_proof_required" });
    await f.repository.settleReceipt(
      original.dispatchId,
      rejected.receiptToken!,
      nativeSettlement,
    );
    expect(
      await f.repository.readReceipt(
        original.dispatchId,
        rejected.receiptToken!,
      ),
    ).toMatchObject({
      state: "not_dispatched",
      nativeRequestRef: proof.requestRef,
      nativeRetryProof: {
        kind: "native_rejection_after_forward",
        reason: "admission_storage_conflict",
      },
    });
    const next = successor(original, f);
    const results = await Promise.all([
      f.repository.claim(next),
      f.repository.claim(next),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([
      "claimed",
      "restored",
    ]);
    const fresh = results.find((result) => result.status === "claimed")!;
    expect(fresh.dispatch.nativeRequestRef).not.toBe(
      rejected.dispatch.nativeRequestRef,
    );
    expect(fresh.dispatch).toMatchObject({
      retryOfDispatchId: original.dispatchId,
      requestOrdinal: 3,
    });
    expect(
      results.find((result) => result.status === "restored"),
    ).not.toHaveProperty("receiptToken");
    expect(
      await f.repository.readReceipt(
        original.dispatchId,
        rejected.receiptToken!,
      ),
    ).not.toHaveProperty("nativeRetryProof");
    await f.repository.claim({ ...next, forwardExisting: true });
    await f.repository.settle(
      next.authorizationId,
      next.dispatchId,
      "completed",
    );
    await f.repository.settleReceipt(
      next.dispatchId,
      fresh.receiptToken!,
      completed(next, f),
    );
    const after = await f.prisma.reviewRunCompanionDispatchV1.findUniqueOrThrow(
      {
        where: {
          authorizationId_dispatchId: {
            authorizationId: prior.authorizationId,
            dispatchId: prior.dispatchId,
          },
        },
      },
    );
    expect(after).toEqual(before);
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: original.authorizationId },
      }),
    ).toBe(3);
    // Completed turns may continue normally; the rejected turn is never replayed.
    await expect(f.repository.claim(claim(base, f, 4))).resolves.toMatchObject({
      status: "claimed",
    });
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: original.authorizationId },
      }),
    ).toBe(4);
    await expect(f.repository.claim(claim(base, f, 5))).rejects.toMatchObject({
      code: "model_dispatch_claim_invalid",
    });
  });

  it("rejects missing lineage and changes to the exact rejected request and route", async () => {
    const f = await fixture(4, "account_gateway", true, true, true);
    const original = claim(await f.acquireClaim(0), f);
    const rejected = await reservedNative(f, original);
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      nativeProof(rejected.dispatch.nativeRequestRef),
    );
    const next = successor(original, f);
    const unlinked = {
      ...claim(original, f, 2),
      providerRequestEnvelopeHash: original.providerRequestEnvelopeHash,
    };
    for (const altered of [
      unlinked,
      { ...unlinked, providerRequestEnvelopeHash: hash("other-wire") },
      { ...next, providerRequestEnvelopeHash: hash("changed-wire") },
      { ...next, routeIdentityHash: hash("changed-route") },
      { ...next, requestBytes: next.requestBytes! + 1 },
      { ...next, maxOutputTokens: next.maxOutputTokens! + 1 },
      { ...next, leaseId: "foreign-lease" },
      { ...next, fencingToken: next.fencingToken + 1n },
      { ...next, preparedManifestKey: hash("other-manifest") },
      { ...next, executionId: "foreign-execution" },
      {
        ...next,
        retryOfDispatchId: `rr-model-${hash("foreign-predecessor")}`,
      },
    ])
      await expect(f.repository.claim(altered)).rejects.toBeInstanceOf(
        ReviewRunCompanionDispatchFailure,
      );
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: original.authorizationId },
      }),
    ).toBe(1);
    await expect(f.repository.claim(next)).resolves.toMatchObject({
      status: "claimed",
    });
  });

  it("does not refund the original request budget", async () => {
    const f = await fixture(1, "account_gateway", true, true, true);
    const original = claim(await f.acquireClaim(0), f);
    const rejected = await reservedNative(f, original);
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      nativeProof(rejected.dispatch.nativeRequestRef),
    );
    await expect(
      f.repository.claim(successor(original, f)),
    ).rejects.toMatchObject({ code: "model_dispatch_claim_invalid" });
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: original.authorizationId },
      }),
    ).toBe(1);
  });

  it.each(["runner", "native"] as const)(
    "never upgrades a prior %s unknown effect",
    async (source) => {
      const f = await fixture(4, "account_gateway", true, true, true);
      const original = claim(await f.acquireClaim(0), f);
      const rejected = await reservedNative(f, original);
      if (source === "runner")
        await f.repository.settleReceipt(
          original.dispatchId,
          rejected.receiptToken!,
          { state: "effect_unknown" },
        );
      else
        await f.repository.settle(
          original.authorizationId,
          original.dispatchId,
          "effect_unknown",
        );
      await expect(
        f.repository.recordNativeRejection(
          original.authorizationId,
          original.dispatchId,
          nativeProof(rejected.dispatch.nativeRequestRef),
        ),
      ).rejects.toMatchObject({ code: "model_dispatch_retry_denied" });
      await expect(
        f.repository.settleReceipt(
          original.dispatchId,
          rejected.receiptToken!,
          nativeSettlement,
        ),
      ).rejects.toMatchObject({
        code: "model_dispatch_native_proof_required",
      });
      expect(
        await f.repository.readReceipt(
          original.dispatchId,
          rejected.receiptToken!,
        ),
      ).not.toHaveProperty("nativeRetryProof");
      await expect(
        f.repository.claim(successor(original, f)),
      ).rejects.toMatchObject({ code: "model_dispatch_effect_unresolved" });
    },
  );

  it("requires original forwarding and immutable authenticated native scope", async () => {
    const f = await fixture(4, "account_gateway", true, true, true);
    const original = claim(await f.acquireClaim(0), f);
    const rejected = await f.repository.claim(original);
    const proof = nativeProof(rejected.dispatch.nativeRequestRef);
    await expect(
      f.repository.recordNativeRejection(
        original.authorizationId,
        original.dispatchId,
        proof,
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_native_proof_required" });
    await f.repository.claim({ ...original, forwardExisting: true });
    for (const invalid of [
      { ...proof, requestRef: "foreign-request" },
      { ...proof, executionRef: "foreign-execution" },
      { ...proof, consumerId: "invalid/consumer" },
    ])
      await expect(
        f.repository.recordNativeRejection(
          original.authorizationId,
          original.dispatchId,
          invalid,
        ),
      ).rejects.toBeInstanceOf(ReviewRunCompanionDispatchFailure);
    // The HTTP proof discriminator cannot invent a trusted server attestation.
    await expect(
      f.repository.settleReceipt(
        original.dispatchId,
        rejected.receiptToken!,
        nativeSettlement,
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_native_proof_required" });
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      proof,
    );
    await expect(
      f.repository.recordNativeRejection(
        original.authorizationId,
        original.dispatchId,
        { ...proof, consumerId: "other-consumer" },
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_settlement_conflict" });
  });

  it.each(["expires", "released", "revision", "mutation"] as const)(
    "hides retained proof after original authority %s",
    async (change) => {
      const f = await fixture(4, "account_gateway", true, true, true);
      const original = claim(await f.acquireClaim(0), f);
      const rejected = await reservedNative(f, original);
      await f.repository.recordNativeRejection(
        original.authorizationId,
        original.dispatchId,
        nativeProof(rejected.dispatch.nativeRequestRef),
      );
      if (change === "expires")
        await f.prisma.reviewRunAuthorization.update({
          where: { authorizationId: original.authorizationId },
          data: {
            createdAt: new Date(Date.now() - 60_000),
            expiresAt: new Date(Date.now() - 1000),
          },
        });
      if (change === "released") await f.releaseClaim(original);
      if (change === "revision")
        await f.prisma.reviewExecutionStreamV2.updateMany({
          where: { activeExecutionId: original.executionId },
          data: { currentHeadSha: "f".repeat(40) },
        });
      if (change === "mutation")
        await f.prisma.reviewMutationAuthority.updateMany({
          where: { scmRepositoryIdentityId: f.scope.scmRepositoryIdentityId },
          data: { epoch: 2n },
        });
      const readback = await f.repository.readReceipt(
        original.dispatchId,
        rejected.receiptToken!,
      );
      expect(readback).toMatchObject({ state: "not_dispatched" });
      expect(readback).not.toHaveProperty("nativeRetryProof");
      await expect(
        f.repository.claim(successor(original, f)),
      ).rejects.toBeInstanceOf(ReviewRunCompanionDispatchFailure);
    },
  );

  it("bounds the DB-derived proof cutoff by the shorter original Gateway deadline despite host skew", async () => {
    // The immutable original binding shares the authorization deadline; the
    // execution and its lease may outlive that narrower admission authority.
    const bindingDeadline = Date.now() + 30_000;
    const f = await fixture(
      4,
      "account_gateway",
      true,
      true,
      true,
      new Date(bindingDeadline),
    );
    const original = claim(await f.acquireClaim(0), f);
    const [auth, execution, lease] = await Promise.all([
      f.prisma.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: original.authorizationId },
      }),
      f.prisma.reviewExecutionV2.findUniqueOrThrow({
        where: { executionId: original.executionId },
      }),
      f.prisma.reviewInvocationLeaseV2.findUniqueOrThrow({
        where: { leaseId: original.leaseId },
      }),
    ]);
    const rejected = await reservedNative(f, original);
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      nativeProof(rejected.dispatch.nativeRequestRef),
    );
    const notAfter = Math.min(
      auth.expiresAt.getTime(),
      auth.maxExpiresAt.getTime(),
      execution.executionDeadlineAt.getTime(),
      lease.expiresAt.getTime(),
      Date.parse(f.budget.deadline),
      bindingDeadline,
    );
    expect(notAfter).toBe(bindingDeadline);
    expect(bindingDeadline).toBeLessThan(lease.expiresAt.getTime());
    const monotonic = vi.spyOn(performance, "now").mockReturnValue(10_000);
    const wall = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2126, 0, 1));
    try {
      const [before] = await f.prisma.$queryRaw<
        readonly { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
      const row = await f.repository.readReceipt(
        original.dispatchId,
        rejected.receiptToken!,
      );
      const [after] = await f.prisma.$queryRaw<
        readonly { now: Date }[]
      >`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
      expect(row).toMatchObject({
        state: "not_dispatched",
        nativeRetryProof: {
          kind: "native_rejection_after_forward",
          reason: "admission_storage_conflict",
        },
      });
      expect(row?.nativeRetryProofNotAfter).toBeGreaterThan(10_000);
      expect(row?.nativeRetryProofNotAfter).toBeLessThanOrEqual(
        10_000 + notAfter - before!.now.getTime(),
      );
      expect(row?.nativeRetryProofNotAfter).toBeGreaterThanOrEqual(
        10_000 + notAfter - after!.now.getTime(),
      );
    } finally {
      monotonic.mockRestore();
      wall.mockRestore();
    }
  });

  it("hides retry after ownership expiry while retained reporting still accepts late ACK", async () => {
    const f = await fixture(4, "account_gateway", true, true, true);
    const original = claim(await f.acquireClaim(0), f);
    const rejected = await reservedNative(f, original);
    const proof = nativeProof(rejected.dispatch.nativeRequestRef);
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      proof,
    );
    expect(
      await f.repository.readReceipt(
        original.dispatchId,
        rejected.receiptToken!,
      ),
    ).toHaveProperty("nativeRetryProof", {
      kind: "native_rejection_after_forward",
      reason: "admission_storage_conflict",
    });
    const where = {
      authorizationId_dispatchId: {
        authorizationId: original.authorizationId,
        dispatchId: original.dispatchId,
      },
    };
    const before =
      await f.prisma.reviewRunCompanionDispatchV1.findUniqueOrThrow({ where });
    const [clock] = await f.prisma.$queryRaw<readonly { now: Date }[]>`
      SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
    expect(clock).toBeDefined();
    const now = clock!.now;
    // Keep the row active and its original reporting window open: the cutoff
    // must come from DB-clock ownership expiry, not a released-state shortcut.
    const expired = await f.prisma.reviewInvocationLeaseV2.update({
      where: { leaseId: original.leaseId },
      data: {
        acquiredAt: new Date(now.getTime() - 60_000),
        renewedAt: new Date(now.getTime() - 60_000),
        expiresAt: new Date(now.getTime() - 1_000),
      },
    });
    expect(expired.state).toBe("active");
    expect(expired.expiresAt.getTime()).toBeLessThan(now.getTime());
    expect(expired.resultReportUntil.getTime()).toBeGreaterThan(now.getTime());
    for (const row of await Promise.all([
      f.repository.read(original.authorizationId, original.dispatchId),
      f.repository.readReceipt(original.dispatchId, rejected.receiptToken!),
    ])) {
      expect(row).toMatchObject({ state: "not_dispatched" });
      expect(row).not.toHaveProperty("nativeRetryProof");
    }
    const next = successor(original, f);
    await expect(f.repository.claim(next)).rejects.toMatchObject({
      code: "companion_lease_not_active",
    });
    // Receipt retention is cleanup authority only. Late ACK and later unknown
    // delivery cannot erase the native fact or revive a paid allowance.
    for (const settlement of [
      nativeSettlement,
      { state: "effect_unknown" as const },
      nativeSettlement,
    ]) {
      const row = await f.repository.settleReceipt(
        original.dispatchId,
        rejected.receiptToken!,
        settlement,
      );
      expect(row).toMatchObject({ state: "not_dispatched" });
      expect(row).not.toHaveProperty("nativeRetryProof");
    }
    await f.repository.settle(
      original.authorizationId,
      original.dispatchId,
      "effect_unknown",
    );
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.findUniqueOrThrow({ where }),
    ).toEqual(before);
    expect(before).toMatchObject({
      nativeEffectState: "not_dispatched",
      nativeRetryProofJson: proof,
    });
    expect(
      await f.repository.readReceipt(
        original.dispatchId,
        rejected.receiptToken!,
      ),
    ).not.toHaveProperty("nativeRetryProof");
    await expect(f.repository.claim(next)).rejects.toMatchObject({
      code: "companion_lease_not_active",
    });
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: original.authorizationId },
      }),
    ).toBe(1);
  });

  it("cannot chain successors or bypass a failed successor with a fresh root", async () => {
    const f = await fixture(4, "account_gateway", true, true, true);
    const original = claim(await f.acquireClaim(0), f);
    const rejected = await reservedNative(f, original);
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      nativeProof(rejected.dispatch.nativeRequestRef),
    );
    const next = successor(original, f);
    const fresh = await f.repository.claim(next);
    // Even a truly local pre-forward failure cannot turn this successor into a root.
    await f.repository.settleReceipt(next.dispatchId, fresh.receiptToken!, {
      state: "not_dispatched",
      proof: "local_before_forward",
    });
    await expect(
      f.repository.recordNativeRejection(
        next.authorizationId,
        next.dispatchId,
        nativeProof(fresh.dispatch.nativeRequestRef),
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_retry_denied" });
    await expect(f.repository.claim(successor(next, f))).rejects.toMatchObject({
      code: "model_dispatch_retry_denied",
    });
    await expect(
      f.repository.claim(claim(original, f, 3)),
    ).rejects.toMatchObject({ code: "model_dispatch_retry_denied" });
    await expect(
      f.repository.claim({
        ...claim(original, f, 3),
        retryOfDispatchId: original.dispatchId,
      }),
    ).rejects.toMatchObject({ code: "model_dispatch_retry_denied" });
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: original.authorizationId },
      }),
    ).toBe(2);
  });

  it.each([false, true])(
    "keeps legacy/capacity128 retry disabled (capacity128=%s)",
    async (capacity128) => {
      const f = await fixture(4, "account_gateway", capacity128);
      const original = claim(await f.acquireClaim(0), f);
      const rejected = await reservedNative(f, original);
      await expect(
        f.repository.recordNativeRejection(
          original.authorizationId,
          original.dispatchId,
          nativeProof(rejected.dispatch.nativeRequestRef),
        ),
      ).rejects.toMatchObject({ code: "model_dispatch_retry_denied" });
      await expect(
        f.repository.settleReceipt(
          original.dispatchId,
          rejected.receiptToken!,
          nativeSettlement,
        ),
      ).rejects.toMatchObject({
        code: "model_dispatch_native_proof_required",
      });
      await expect(
        f.repository.claim(successor(original, f)),
      ).rejects.toMatchObject({ code: "model_dispatch_claim_invalid" });
      expect(
        await f.repository.readReceipt(
          original.dispatchId,
          rejected.receiptToken!,
        ),
      ).not.toHaveProperty("nativeRetryProof");
    },
  );

  it("denies a successor HTTP claim after retained original Gateway custody is lost", async () => {
    const f = await fixture(4, "account_gateway", true, true, true);
    const original = claim(await f.acquireClaim(0), f);
    const rejected = await reservedNative(f, original);
    await f.repository.recordNativeRejection(
      original.authorizationId,
      original.dispatchId,
      nativeProof(rejected.dispatch.nativeRequestRef),
    );
    const authorization = {
      authorizationId: original.authorizationId,
      runtimeSnapshotCanonicalJson: f.snapshot,
    } as ReviewRunAuthorization;
    const unexpected = async (): Promise<never> => {
      throw new Error("unexpected_claim_after_custody_loss");
    };
    const custodyReads: ReviewRunCompanionDispatch[] = [];
    const app = Fastify({ logger: false });
    await registerReviewModelDispatchRoutes(app, {
      authorizations: {
        resolveReviewRunAuthorizationToken: async () => ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization,
        }),
      },
      checkAuthority: async () => true,
      canReadNativeRetryProof: async (dispatch) => {
        custodyReads.push(dispatch);
        return false;
      },
      admission: {
        claim: unexpected,
        forward: unexpected,
        settle: unexpected,
        settleReceipt: unexpected,
        recordNativeRejection: unexpected,
        readReceipt: unexpected,
        read: (auth, dispatchId) => f.repository.read(auth, dispatchId),
      },
    });
    const next = successor(original, f);
    try {
      const response = await app.inject({
        method: "POST",
        url: reviewModelDispatchContract.claimPath,
        headers: { authorization: "Bearer original-token" },
        payload: {
          dispatchVersion: 2,
          dispatchId: next.dispatchId,
          executionId: next.executionId,
          workSlotId: next.workSlotId,
          attemptOrdinal: 1,
          requestOrdinal: next.requestOrdinal,
          leaseId: next.leaseId,
          leaseCapability: "original-signed-capability",
          fencingToken: next.fencingToken.toString(),
          preparedManifestKey: next.preparedManifestKey,
          routeIdentityHash: next.routeIdentityHash,
          providerRequestEnvelopeHash: next.providerRequestEnvelopeHash,
          requestBytes: next.requestBytes,
          maxOutputTokens: next.maxOutputTokens,
          retryOfDispatchId: original.dispatchId,
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: "model_dispatch_retry_denied",
      });
      expect(custodyReads).toEqual([
        expect.objectContaining({
          authorizationId: original.authorizationId,
          dispatchId: original.dispatchId,
          nativeRequestRef: rejected.dispatch.nativeRequestRef,
          nativeRetryProof: {
            kind: "native_rejection_after_forward",
            reason: "admission_storage_conflict",
          },
        }),
      ]);
      expect(
        await f.prisma.reviewRunCompanionDispatchV1.count({
          where: { authorizationId: original.authorizationId },
        }),
      ).toBe(1);
    } finally {
      await app.close();
    }
  });

  it.each([1, 3])(
    "keeps the auxiliary role in slot %i outside native retry",
    async (index) => {
      const f = await fixture(4, "account_gateway", true, true, true);
      const target = index === 1 ? "lifecycle-1" : "description";
      await f.prisma.reviewExecutionWorkSlotV2.updateMany({
        where: { executionId: f.executionId, workSlotId: { not: target } },
        data: { state: "exhausted" },
      });
      const original = claim(await f.acquireClaim(index), f);
      const reservation = await reservedNative(f, original);
      expect(reservation.dispatch.role).toBe(
        index === 1 ? "lifecycle_verification" : "pr_description",
      );
      await expect(
        f.repository.recordNativeRejection(
          original.authorizationId,
          original.dispatchId,
          nativeProof(reservation.dispatch.nativeRequestRef),
        ),
      ).rejects.toMatchObject({ code: "model_dispatch_retry_denied" });
      await expect(
        f.repository.settleReceipt(
          original.dispatchId,
          reservation.receiptToken!,
          nativeSettlement,
        ),
      ).rejects.toMatchObject({ code: "model_dispatch_native_proof_required" });
      expect(
        await f.repository.readReceipt(
          original.dispatchId,
          reservation.receiptToken!,
        ),
      ).not.toHaveProperty("nativeRetryProof");
    },
  );

  it("fences further paid work when terminal output usage is unknown or exceeds its accepted ceiling", async () => {
    const f = await fixture();
    const base = await f.acquireClaim(0);
    const c = claim(base, f);
    const reservation = await f.repository.claim(c);
    const terminal = completed(c, f);
    if (terminal.state !== "completed") throw new Error("fixture");
    for (const outputTokens of [null, c.maxOutputTokens! + 1]) {
      await expect(
        f.repository.settleReceipt(c.dispatchId, reservation.receiptToken!, {
          ...terminal,
          receipt: {
            ...terminal.receipt,
            usage: { inputTokens: null, outputTokens, totalTokens: null },
          },
        }),
      ).rejects.toMatchObject({ code: "model_dispatch_receipt_mismatch" });
      await expect(f.repository.claim(claim(base, f, 2))).rejects.toMatchObject(
        {
          code: "model_dispatch_effect_unresolved",
        },
      );
    }

    expect(
      (await f.repository.readReceipt(c.dispatchId, reservation.receiptToken!))
        ?.state,
    ).toBe("dispatch_may_have_started");
    // Later exact terminal proof can settle this paid request; it never causes
    // another provider invocation or refunds the existing reservation.
    await f.repository.settleReceipt(
      c.dispatchId,
      reservation.receiptToken!,
      terminal,
    );
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: c.authorizationId },
      }),
    ).toBe(1);
  });

  it.each(["completed", "native-expired", "native-unavailable"] as const)(
    "acknowledges a committed settlement after receipt retention ends: %s",
    async (mode) => {
      const native = mode !== "completed";
      const f = native
        ? await fixture(4, "account_gateway", true, true, true)
        : await fixture();
      const c = claim(await f.acquireClaim(0), f);
      const reservation = native
        ? await reservedNative(f, c)
        : await f.repository.claim(c);
      if (native) {
        await f.repository.recordNativeRejection(
          c.authorizationId,
          c.dispatchId,
          nativeProof(reservation.dispatch.nativeRequestRef),
        );
        const before = await f.repository.readReceipt(
          c.dispatchId,
          reservation.receiptToken!,
        );
        expect(before).toHaveProperty("nativeRetryProof");
        expect(typeof before?.nativeRetryProofNotAfter).toBe("number");
        expect(before?.nativeRetryProofNotAfter).toBeGreaterThan(
          performance.now(),
        );
      }
      const settlement = native ? nativeSettlement : completed(c, f);
      const unexpected = async (): Promise<never> => {
        throw new Error("unexpected_settlement_authority_request");
      };
      let committed = false;
      let reads = 0;
      const app = Fastify({ logger: false });
      await registerReviewModelDispatchRoutes(app, {
        authorizations: { resolveReviewRunAuthorizationToken: unexpected },
        checkAuthority: unexpected,
        canReadNativeRetryProof: unexpected,
        admission: {
          claim: unexpected,
          forward: unexpected,
          read: unexpected,
          settle: unexpected,
          recordNativeRejection: unexpected,
          readReceipt: async (dispatchId, token) => {
            reads++;
            if (committed && mode === "native-unavailable")
              throw new Error("disposable_post_commit_read_failure");
            return f.repository.readReceipt(dispatchId, token);
          },
          settleReceipt: async (dispatchId, token, value) => {
            const row = await f.repository.settleReceipt(
              dispatchId,
              token,
              value,
            );
            committed = true;
            // Expire only after the real transaction committed. This is a
            // deterministic late-ACK boundary, without advancing the HTTP clock.
            await f.prisma.reviewRunCompanionDispatchV1.update({
              where: {
                authorizationId_dispatchId: {
                  authorizationId: c.authorizationId,
                  dispatchId: c.dispatchId,
                },
              },
              data: { retainUntil: new Date(Date.now() - 1000) },
            });
            return row;
          },
        },
      });
      try {
        const response = await app.inject({
          method: "POST",
          url: `${reviewModelDispatchContract.basePath}/${c.dispatchId}/settle`,
          headers: {
            [reviewModelDispatchContract.receiptHeader]:
              reservation.receiptToken!,
          },
          payload: settlement,
        });
        expect(response.statusCode).toBe(200);
        expect(committed).toBe(true);
        expect(reads).toBe(native ? 2 : 1);
        const state = native ? "not_dispatched" : "completed";
        expect(response.json().dispatch).toMatchObject({
          dispatchId: c.dispatchId,
          state,
        });
        expect(response.json().dispatch).not.toHaveProperty("nativeRetryProof");
        const stored =
          await f.prisma.reviewRunCompanionDispatchV1.findUniqueOrThrow({
            where: {
              authorizationId_dispatchId: {
                authorizationId: c.authorizationId,
                dispatchId: c.dispatchId,
              },
            },
          });
        expect(stored.state).toBe(state);
        if (native)
          expect(stored.nativeRetryProofJson).toEqual(
            nativeProof(reservation.dispatch.nativeRequestRef),
          );
        else if (settlement.state === "completed")
          expect(stored.terminalReceiptJson).toEqual(settlement.receipt);
        expect(
          await f.repository.readReceipt(
            c.dispatchId,
            reservation.receiptToken!,
          ),
        ).toBeNull();
      } finally {
        await app.close();
      }
    },
  );

  it("settles after authority expiry without reopening work and rejects changed receipts, wrong rows and expired retention", async () => {
    const f = await fixture();
    const c = claim(await f.acquireClaim(0), f);
    const reservation = await f.repository.claim(c);
    // Model a valid authority whose lifetime already ended. Moving only expiry
    // into the past can put it before creation on fast CI runners and violate
    // the real lifetime constraint instead of testing late receipts.
    const [clock] = await f.prisma.$queryRaw<{ now: Date }[]>`
      SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"
    `;
    if (!clock) throw new Error("fixture_database_clock_missing");
    await f.prisma.reviewRunAuthorization.update({
      where: { authorizationId: c.authorizationId },
      data: {
        state: "expired",
        createdAt: new Date(clock.now.getTime() - 60_000),
        expiresAt: new Date(clock.now.getTime() - 1_000),
      },
    });
    await f.prisma.reviewInvocationLeaseV2.update({
      where: { leaseId: c.leaseId },
      data: { state: "expired" },
    });
    const settlement = completed(c, f);
    await expect(
      f.repository.settleReceipt(
        c.dispatchId,
        reservation.receiptToken!,
        settlement,
      ),
    ).resolves.toMatchObject({ state: "completed" });
    await expect(
      f.repository.settleReceipt(
        c.dispatchId,
        reservation.receiptToken!,
        settlement,
      ),
    ).resolves.toMatchObject({ state: "completed" });
    await expect(f.repository.claim(claim(c, f, 2))).rejects.toMatchObject({
      code: "companion_authorization_denied",
    });
    expect(
      await f.repository.readReceipt(
        `rr-model-${"0".repeat(64)}`,
        reservation.receiptToken!,
      ),
    ).toBeNull();
    expect(
      await f.repository.readReceipt(c.dispatchId, "0".repeat(64)),
    ).toBeNull();
    if (settlement.state !== "completed") throw new Error("fixture");
    await expect(
      f.repository.settleReceipt(c.dispatchId, reservation.receiptToken!, {
        ...settlement,
        receipt: {
          ...settlement.receipt,
          responseHash: hash("changed-response"),
        },
      }),
    ).rejects.toMatchObject({ code: "model_dispatch_settlement_conflict" });
    await f.repository.settleReceipt(c.dispatchId, reservation.receiptToken!, {
      state: "effect_unknown",
    });
    expect(
      (await f.repository.readReceipt(c.dispatchId, reservation.receiptToken!))
        ?.state,
    ).toBe("completed");
    await f.prisma.reviewRunCompanionDispatchV1.update({
      where: {
        authorizationId_dispatchId: {
          authorizationId: c.authorizationId,
          dispatchId: c.dispatchId,
        },
      },
      data: { retainUntil: new Date(Date.now() - 1000) },
    });
    expect(
      await f.repository.readReceipt(c.dispatchId, reservation.receiptToken!),
    ).toBeNull();
    await expect(
      f.repository.settleReceipt(
        c.dispatchId,
        reservation.receiptToken!,
        settlement,
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_receipt_denied" });
    expect(
      await f.prisma.reviewRunCompanionDispatchV1.count({
        where: { authorizationId: c.authorizationId },
      }),
    ).toBe(1);
  });

  it("requires one durable native forwarding transition and complete original receipts for evidence", async () => {
    const f = await fixture(4, "account_gateway");
    const base = await f.acquireClaim(0);
    const c = claim(base, f);
    await expect(
      f.repository.claim({ ...c, forwardExisting: true }),
    ).rejects.toMatchObject({ code: "model_dispatch_reservation_required" });
    const reservation = await f.repository.claim(c);
    await expect(
      f.repository.claim({ ...c, forwardExisting: true }),
    ).resolves.toMatchObject({ status: "claimed" });
    await expect(
      f.repository.claim({ ...c, forwardExisting: true }),
    ).rejects.toMatchObject({ code: "model_dispatch_already_forwarded" });
    await expect(
      f.repository.settleReceipt(
        c.dispatchId,
        reservation.receiptToken!,
        completed(c, f),
      ),
    ).rejects.toMatchObject({ code: "model_dispatch_native_proof_required" });
    await f.repository.settle(c.authorizationId, c.dispatchId, "completed");
    const proof = {
      prisma: f.prisma,
      authorization: {
        authorizationId: c.authorizationId,
        runtimeSnapshotCanonicalJson: f.snapshot,
      },
      executionId: c.executionId,
      workSlotId: c.workSlotId,
      leaseId: c.leaseId,
      fencingToken: c.fencingToken,
      preparedManifestKey: c.preparedManifestKey,
      providerRequestEnvelopeHash: c.providerRequestEnvelopeHash,
      actualModel: f.budget.model,
      role: "finding_discovery" as const,
    };
    await expect(assertReviewModelDispatchEvidence(proof)).rejects.toThrow();
    await f.repository.settleReceipt(
      c.dispatchId,
      reservation.receiptToken!,
      completed(c, f),
    );
    await expect(
      assertReviewModelDispatchEvidence(proof),
    ).resolves.toBeUndefined();
    await expect(
      assertReviewModelDispatchEvidence({
        ...proof,
        leaseId: "different-original-lease",
      }),
    ).rejects.toThrow();
    const second = claim(base, f, 2);
    await f.repository.claim(second);
    await expect(assertReviewModelDispatchEvidence(proof)).rejects.toThrow();
    await f.prisma.reviewRunCompanionDispatchV1.deleteMany({
      where: { authorizationId: c.authorizationId },
    });
    await expect(assertReviewModelDispatchEvidence(proof)).rejects.toThrow();
  });

  it("uses real HTTP receipt authority after expiry, without token reissue or claim authority", async () => {
    const f = await fixture();
    const c = claim(await f.acquireClaim(0), f);
    let active = true;
    const authorization = {
      authorizationId: c.authorizationId,
      runtimeSnapshotCanonicalJson: f.snapshot,
    } as ReviewRunAuthorization;
    const admission = new ClaimReviewRunCompanionDispatch(
      f.repository,
      async (token) => {
        if (token !== "synthetic-lease-capability") throw new Error("invalid");
        return {
          capabilityId: c.leaseCapabilityId,
          authorizationId: c.authorizationId,
          mutationEpoch: c.capabilityMutationEpoch,
          scopeHash: c.capabilityScopeHash,
          executionId: c.executionId,
          workSlotId: c.workSlotId,
          leaseId: c.leaseId,
          ownerIdHash: c.ownerIdHash,
          providerInvocationKey: c.providerInvocationKey,
          purpose: "provider_execution",
          reviewRevisionHash: c.capabilityReviewRevisionHash,
          ownershipExpiresAt: c.ownershipExpiresAt,
        };
      },
    );
    const app = Fastify({ logger: false });
    await registerReviewModelDispatchRoutes(app, {
      admission,
      checkAuthority: async () => active,
      authorizations: {
        resolveReviewRunAuthorizationToken: async ({ token }) =>
          active && token === "synthetic-run-authorization"
            ? {
                status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
                authorization,
              }
            : { status: ReviewRunAuthorizationTokenResolutionStatus.Expired },
      },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const address = app.server.address();
      if (!address || typeof address === "string") throw new Error("fixture");
      const origin = `http://127.0.0.1:${address.port}`;
      const body = {
        dispatchVersion: 2,
        dispatchId: c.dispatchId,
        executionId: c.executionId,
        workSlotId: c.workSlotId,
        attemptOrdinal: 1,
        requestOrdinal: 1,
        leaseId: c.leaseId,
        leaseCapability: "synthetic-lease-capability",
        fencingToken: c.fencingToken.toString(),
        preparedManifestKey: c.preparedManifestKey,
        routeIdentityHash: c.routeIdentityHash,
        providerRequestEnvelopeHash: c.providerRequestEnvelopeHash,
        requestBytes: c.requestBytes,
        maxOutputTokens: c.maxOutputTokens,
      };
      const headers = {
        authorization: "Bearer synthetic-run-authorization",
        "content-type": "application/json",
      };
      const sent = await fetch(
        `${origin}${reviewModelDispatchContract.claimPath}`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      expect(sent.status).toBe(200);
      const first = (await sent.json()) as { receiptToken: string };
      const duplicate = await fetch(
        `${origin}${reviewModelDispatchContract.claimPath}`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      expect(await duplicate.json()).toMatchObject({ status: "restored" });
      const tokenHeaders = {
        "content-type": "application/json",
        [reviewModelDispatchContract.receiptHeader]: first.receiptToken,
      };
      const forbidden = await fetch(
        `${origin}${reviewModelDispatchContract.claimPath}`,
        { method: "POST", headers: tokenHeaders, body: JSON.stringify(body) },
      );
      expect(forbidden.status).toBe(401);
      active = false;
      const denied = await fetch(
        `${origin}${reviewModelDispatchContract.claimPath}`,
        { method: "POST", headers, body: JSON.stringify(body) },
      );
      expect(denied.status).toBe(401);
      const settled = await fetch(
        `${origin}${reviewModelDispatchContract.basePath}/${c.dispatchId}/settle`,
        {
          method: "POST",
          headers: tokenHeaders,
          body: JSON.stringify(completed(c, f)),
        },
      );
      expect(settled.status).toBe(200);
      expect(await settled.json()).toMatchObject({
        dispatch: { state: "completed" },
      });
      const invalid = await fetch(
        `${origin}${reviewModelDispatchContract.basePath}/${c.dispatchId}`,
        {
          headers: {
            [reviewModelDispatchContract.receiptHeader]: `${first.receiptToken},${first.receiptToken}`,
          },
        },
      );
      expect(invalid.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});
