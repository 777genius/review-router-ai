import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  ClaimReviewRunCompanionDispatch,
  ReviewRunAuthorizationTokenResolutionStatus,
  type ReviewRunAuthorization,
  type ReviewRunCompanionDispatchClaim,
} from "@reviewrouter/features-review-run-control";
import { PrismaReviewRunCompanionDispatchRepository } from "@reviewrouter/features-review-run-control/composition";
import {
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
  reviewModelDispatchIdPreimage,
  type ReviewModelDispatchCapabilityV2,
  type ReviewModelDispatchProfileV2,
  type ReviewModelDispatchSettlementV2,
  type ReviewModelTransport,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { createReviewDispatchDatabaseFixture } from "./test-support/review-dispatch-database-fixture";
import { assertReviewModelDispatchEvidence } from "./review-model-dispatch-evidence";
import { registerReviewModelDispatchRoutes } from "./review-model-dispatch";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type Fixture = Awaited<
  ReturnType<typeof createReviewDispatchDatabaseFixture>
> & {
  budget: ReviewModelDispatchCapabilityV2;
};

describeDatabase("durable V2 model dispatch with PostgreSQL", () => {
  const fixtures: Fixture[] = [];
  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) await fixture.dispose();
  });

  async function fixture(
    maxRequests = 4,
    transport: ReviewModelTransport = "runner_local_responses",
  ): Promise<Fixture> {
    const prefix = `model-dispatch-test-${randomUUID()}`;
    const deadline = new Date(Date.now() + 600_000).toISOString();
    const limits = {
      maxRequests,
      maxConcurrentRequests: 1 as const,
      maxRequestBytes: 65536,
      maxResponseBytes: 32768,
      maxOutputTokens: 4096,
    };
    const budget: ReviewModelDispatchCapabilityV2 = {
      ...limits,
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
      deadline,
    };
    const profile: ReviewModelDispatchProfileV2 = {
      extensionId: reviewModelDispatchContract.extensionId,
      descriptorDigest: reviewModelDispatchDescriptorDigest,
      policyVersion: reviewModelDispatchContract.policyVersion,
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
      deadline,
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
      })),
      budget,
    };
    fixtures.push(result);
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

  it("serializes duplicate claims, preserves unknown fences and never refunds positively unpaid reservations", async () => {
    const f = await fixture();
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
    const restarted = new PrismaReviewRunCompanionDispatchRepository(f.prisma, {
      lockSelection: async () => true,
      validateManifest: () => {},
    });
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
  });

  it("shares the original allowance across discovery and verifier and rejects the V1 escape path", async () => {
    const f = await fixture(3);
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
  });

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

  it("settles after authority expiry without reopening work and rejects changed receipts, wrong rows and expired retention", async () => {
    const f = await fixture();
    const c = claim(await f.acquireClaim(0), f);
    const reservation = await f.repository.claim(c);
    await f.prisma.reviewRunAuthorization.update({
      where: { authorizationId: c.authorizationId },
      data: { state: "expired", expiresAt: new Date(Date.now() - 1000) },
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
