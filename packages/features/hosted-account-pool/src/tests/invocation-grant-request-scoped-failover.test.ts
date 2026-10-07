import { describe, expect, it } from "vitest";
import { enrollHostedPoolAccount } from "../domain/account-pool";
import {
  hostedAccountId,
  hostedBindingId,
  hostedPoolId,
  invocationGrantId,
  invocationId,
  relayRequestId,
  repositoryId,
  workspaceId,
} from "../domain/identifiers";
import {
  admitRelayRequest,
  failoverCurrentRelayRequest,
  issueInvocationGrant,
  recordSuccessfulProviderResponse,
} from "../domain/invocation-grant";

const now = new Date("2026-09-22T10:00:00.000Z");
const poolId = hostedPoolId("pool-request-scoped-failover");

describe("request-scoped hosted account failover", () => {
  it("switches a later rate-limited request after an earlier request succeeded", () => {
    const primary = account("primary", 0);
    const backup = account("backup", 1);
    const grantId = invocationGrantId("grant-request-scoped-failover");
    const bindingId = hostedBindingId("binding-request-scoped-failover");
    let grant = issueInvocationGrant({
      id: grantId,
      invocationId: invocationId("invocation-request-scoped-failover"),
      repositoryId: repositoryId("repository-request-scoped-failover"),
      workspaceId: workspaceId("workspace-request-scoped-failover"),
      poolId,
      accounts: [primary, backup],
      authority: {
        repositoryBindingId: bindingId,
        reviewRequestId: "review-request-scoped-failover",
        providerInvocationKey: "provider-request-scoped-failover",
        runId: "run-request-scoped-failover",
        runAttempt: 1,
        model: "gpt-5.6-sol",
        policyFingerprint: "sha256:request-scoped-failover",
        runtimeConfigVersion: 1,
        bindingRevision: 1,
        authzEpoch: 1n,
      },
      runtimeAuthzEpoch: 1n,
      capabilityTokenHash: "sha256:request-scoped-capability",
      commentTokenRefreshCapability: {
        tokenHash: "sha256:request-scoped-comment-capability",
        grantId,
        invocationId: invocationId("invocation-request-scoped-failover"),
        repositoryBindingId: bindingId,
        expiresAt: new Date("2026-09-22T11:00:00.000Z"),
        maxUses: 1,
        useCount: 0,
        revokedAt: null,
      },
      budget: {
        expiresAt: new Date("2026-09-22T11:00:00.000Z"),
        maxRequests: 2,
        maxConcurrentRequests: 1,
        maxRequestBytes: 1024,
        maxResponseBytes: 4096,
        maxOutputTokens: 1024,
      },
      now,
    });

    const completedRequestId = relayRequestId("completed-request");
    grant = admitRelayRequest({
      grant,
      requestId: completedRequestId,
      authority: grant.authority,
      requestBytes: 128,
      now,
    }).grant;
    grant = recordSuccessfulProviderResponse({
      grant,
      requestId: completedRequestId,
    });

    const currentRequestId = relayRequestId("current-request");
    grant = admitRelayRequest({
      grant,
      requestId: currentRequestId,
      authority: grant.authority,
      requestBytes: 128,
      now,
    }).grant;
    const result = failoverCurrentRelayRequest({
      grant,
      requestId: currentRequestId,
      failedAccount: primary,
      backupAccount: backup,
      currentRequestSuccessfulResponseStarted: false,
      failure: "rate_limited",
      effectFence: "classified_response_before_success",
      cooldownUntil: new Date("2026-09-22T10:15:00.000Z"),
      now,
    });

    expect(result.status).toBe("switched");
    expect(result.grant.activeAccountId).toBe(backup.id);
    expect(result.grant.inFlightRequestIds).toContain(currentRequestId);
    expect(result.failedAccount.availability).toEqual({
      status: "cooldown",
      reason: "rate_limited",
      until: new Date("2026-09-22T10:15:00.000Z"),
    });
  });
});

function account(id: string, priority: number) {
  return enrollHostedPoolAccount({
    id: hostedAccountId(id),
    poolId,
    label: id,
    priority,
    credential: {
      credentialRef: `credential:${id}`,
      subjectFingerprint: `subject:${id}`,
      authGeneration: 1,
      validatedAt: now,
      expiresAt: null,
    },
    now,
  });
}
