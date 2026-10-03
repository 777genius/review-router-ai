import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  defineHostedV4RelayGrant,
  hostedV4LogicalTurnKey,
  hostedV4OneShotApprovalHash,
  hostedV4UnapprovedScopeHash,
  type HostedV4RelayScope,
} from "@reviewrouter/features-hosted-account-pool";
import { HostedV4OneShotCanaryAuthority } from "./hosted-v4-one-shot-canary-composition.js";

const now = new Date("2026-10-03T09:00:00.000Z");
const expires = new Date("2026-10-03T09:01:00.000Z");
const sha = "a".repeat(40),
  digest = "b".repeat(64);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const request = {
  authorizationToken: "v2-token",
  investigationLeaseCapability: "investigation-token",
  invocationLeaseCapability: "invocation-token",
  investigationId: "new-investigation",
  turnId: "new-turn",
  idempotencyKey: "one-request",
};

function fixture() {
  const budget = {
    deadline: expires.toISOString(),
    maxGatewayOperations: 8,
    maxOutputFindings: 8,
    maxOutputProposals: 8,
    maxOutputTokens: 100,
    maxRequestBytes: 1_000,
    maxRequests: 1,
    maxResponseBytes: 2_000,
    version: 1,
  };
  const canonical = JSON.stringify(budget);
  const scope: HostedV4RelayScope = {
    version: 4,
    authorizationId: "new-authorization",
    authorizationState: "active",
    mutationEpoch: 1n,
    trustDomain: "trusted_managed",
    investigationCodexRecordingAllowed: true,
    workspaceId: "test-workspace",
    repositoryConnectionId: "test-repository",
    scmRepositoryIdentityId: "scm",
    githubRepositoryId: "1252762369",
    githubInstallationId: "17",
    pullRequestNumber: 1,
    baseSha: sha,
    mergeBaseSha: sha,
    headSha: sha,
    reviewRevisionHash: digest,
    producerReleaseId: "release",
    producerReleaseRegistered: true,
    actionIdentityHash: digest,
    runtimeIdentityHash: digest,
    gatewayIdentityHash: digest,
    protocolVersion: "2",
    schemaDigest: digest,
    protocolLimitsProfileId: "profile",
    providerInstanceId: "hosted-pool:repository:1252762369",
    repositoryBindingId: "binding",
    bindingRevision: 1,
    bindingActive: true,
    repositorySelected: true,
    poolId: "test-pool",
    poolActive: true,
    poolAuthzEpoch: 1n,
    runtimeGateActive: true,
    runtimeAuthzEpoch: 1n,
    model: "codex",
    policyFingerprint: digest,
    investigationId: request.investigationId,
    investigationVersion: 1n,
    turnId: request.turnId,
    turnBudgetCanonicalJson: canonical,
    turnBudgetHash: hash(canonical),
    turnPurpose: "discovery",
    planningInputDossierDigest: digest,
    dossierDigest: digest,
    investigationManifestHash: digest,
    executionId: "execution",
    workSlotId: "slot",
    providerVoteLaneId: "lane",
    providerStrategyId: "strategy",
    attemptId: "attempt",
    investigationLease: {
      leaseId: "il",
      capabilityId: "ic",
      ownerIdHash: digest,
      fencingToken: 3n,
      purpose: "relay_turn",
      expiresAt: expires,
    },
    invocationLease: {
      leaseId: "vl",
      capabilityId: "vc",
      ownerIdHash: digest,
      fencingToken: 4n,
      purpose: "provider_execution",
      attemptId: "provider-attempt",
      providerInvocationKey: "provider-key",
      expiresAt: expires,
    },
    authorizationExpiresAt: expires,
    turnExpiresAt: expires,
    policyExpiresAt: expires,
  };
  const grantId = `v4-grant-${hostedV4LogicalTurnKey(scope.investigationId, scope.turnId)}`;
  const payload = {
    approvalId: "separately-approved-test-record",
    purpose: "owner_one_shot_uncapped_test" as const,
    githubRepositoryId: "1252762369" as const,
    accountId: "test-account",
    unapprovedScopeHash: hostedV4UnapprovedScopeHash(scope),
    grantId,
    sourceCommit: sha,
    requestHash: hash("approved-body"),
    idempotencyKeyHash: hash(
      JSON.stringify(["hosted-v4-request", grantId, request.idempotencyKey]),
    ),
    expiresAt: expires.toISOString(),
  };
  const approval = {
    ...payload,
    approvalHash: hostedV4OneShotApprovalHash(payload),
  };
  const contract = defineHostedV4RelayGrant({
    scope: { ...scope, ownerOneShotApproval: approval },
    now,
    maxRequests: 1,
    maxRequestBytes: 1_000,
    maxResponseBytes: 2_000,
    maxOutputTokens: 100,
  });
  const facts = {
    contract,
    accountId: "test-account",
    credentialGeneration: 1n,
    runtimeConfigVersion: 1,
    runId: "test-run",
    runAttempt: 1,
  };
  const turns = {
    reserveGrant: vi.fn().mockResolvedValue({ status: "issued", grantId }),
    assertCurrentGrant: vi.fn().mockResolvedValue(undefined),
  };
  const resolveIssue = vi.fn().mockResolvedValue(facts);
  const resolveSaved = vi.fn().mockResolvedValue(facts);
  const config = {
    approval,
    sourceCommit: sha,
    signingKey: Buffer.alloc(32, 7),
    resolveIssue,
    resolveSaved,
    turns,
    now: () => now,
  };
  return {
    ...config,
    facts,
    contract,
    authority: new HostedV4OneShotCanaryAuthority(config),
  };
}

describe("one-shot server issuer boundary", () => {
  // Red if a scope-changing recovery mints a fresh bearer or cap waiver.
  it("restores one deterministic bearer only for the identical approved scope", async () => {
    const f = fixture();
    const first = await f.authority.issue(request);
    f.turns.reserveGrant.mockResolvedValue({
      status: "restored",
      grantId: f.approval.grantId,
    });
    const restarted = new HostedV4OneShotCanaryAuthority(f);
    const restored = await restarted.issue(request);
    expect(first.status).toBe("issued");
    expect(restored.status).toBe("restored");
    expect(restored.grantResponse?.grant).toBe(first.grantResponse?.grant);
    expect(f.turns.reserveGrant.mock.calls[0]![0].capabilityTokenHash).toBe(
      hash(first.grantResponse!.grant),
    );
    expect(f.turns.assertCurrentGrant).toHaveBeenCalledTimes(2);
  });

  // Red if client lease substitution reaches grant reservation.
  it("rejects overlapping capabilities before resolving or reserving", async () => {
    const f = fixture();
    const result = await f.authority.issue({
      ...request,
      invocationLeaseCapability: request.investigationLeaseCapability,
    });
    expect(result.status).toBe("rejected");
    expect(f.resolveIssue).not.toHaveBeenCalled();
    expect(f.turns.reserveGrant).not.toHaveBeenCalled();
  });

  // Red if any changed authority tuple can reuse the test approval.
  it.each(["headSha", "authorizationId", "accountId", "idempotencyKey"])(
    "rejects changed %s without reserving",
    async (field) => {
      const f = fixture();
      if (field === "accountId")
        f.resolveIssue.mockResolvedValue({
          ...f.facts,
          accountId: "other-account",
        });
      else if (field !== "idempotencyKey")
        f.resolveIssue.mockResolvedValue({
          ...f.facts,
          contract: defineHostedV4RelayGrant({
            ...f.contract,
            now,
            scope: {
              ...f.contract.scope,
              [field]:
                field === "headSha" ? "c".repeat(40) : "other-authorization",
            },
          }),
        });
      const result = await f.authority.issue({
        ...request,
        ...(field === "idempotencyKey" ? { idempotencyKey: "different" } : {}),
      });
      expect(result.status).toBe("rejected");
      expect(f.turns.reserveGrant).not.toHaveBeenCalled();
    },
  );

  it("requires the trusted source pin and freezes caller approval input", async () => {
    const f = fixture();
    expect(
      () =>
        new HostedV4OneShotCanaryAuthority({
          ...f,
          sourceCommit: "c".repeat(40),
        }),
    ).toThrow();
    f.approval.accountId = "other-account";
    // Caller mutation cannot redirect an already constructed authority.
    expect(await f.authority.issue(request)).toMatchObject({
      status: "issued",
    });
  });

  // Red if durable recovery or post-reservation revocation returns a usable grant.
  it("returns no grant on recovery or a failed current-fence check", async () => {
    const f = fixture();
    f.turns.reserveGrant.mockResolvedValue({
      status: "recovery_required",
      grantId: f.approval.grantId,
    });
    expect(await f.authority.issue(request)).toMatchObject({
      status: "recovery_required",
      grantResponse: null,
    });
    f.turns.reserveGrant.mockResolvedValue({
      status: "issued",
      grantId: f.approval.grantId,
    });
    f.turns.assertCurrentGrant.mockRejectedValue(new Error("lease_revoked"));
    expect(await f.authority.issue(request)).toMatchObject({
      status: "rejected",
      grantResponse: null,
    });
  });

  it("cannot reserve after approval expiry", async () => {
    const f = fixture();
    const expired = new HostedV4OneShotCanaryAuthority({
      ...f,
      now: () => expires,
    });
    expect(await expired.issue(request)).toMatchObject({
      status: "rejected",
      grantResponse: null,
    });
    expect(f.turns.reserveGrant).not.toHaveBeenCalled();
  });

  // Red if request/body or live lease drift can cross authorization.
  it("rechecks immutable request tuple and live fences before dispatch admission", async () => {
    const f = fixture();
    const issued = await f.authority.issue(request);
    const admission = {
      opaqueGrant: issued.grantResponse!.grant,
      requestOrdinal: 1,
      idempotencyKey: request.idempotencyKey,
      requestHash: f.approval.requestHash,
      requestBytes: 13,
    };
    expect(await f.authority.authorize(admission)).toMatchObject({
      authorityKind: "v4_relay_turn",
      accountId: "test-account",
    });
    const checks = f.turns.assertCurrentGrant.mock.calls.length;
    await expect(
      f.authority.authorize({ ...admission, requestHash: digest }),
    ).rejects.toThrow();
    expect(f.turns.assertCurrentGrant).toHaveBeenCalledTimes(checks);
    f.turns.assertCurrentGrant.mockRejectedValue(
      new Error("owner_fence_changed"),
    );
    await expect(f.authority.authorize(admission)).rejects.toThrow();
    expect(f.resolveSaved).toHaveBeenLastCalledWith(
      hash(admission.opaqueGrant),
    );
  });
});
