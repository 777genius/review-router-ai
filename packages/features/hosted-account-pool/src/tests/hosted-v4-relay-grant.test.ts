import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import {
  assertHostedV4RelayScopeCurrent,
  defineHostedV4RelayGrant,
  type HostedV4RelayScope,
} from "../domain/hosted-v4-relay-grant";
import { PrismaHostedV4RelayTurn } from "../infrastructure/prisma/prisma-hosted-v4-relay-turn";

const now = new Date();
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const digest = "a".repeat(64);
const gitSha = "b".repeat(40);

function scope(): HostedV4RelayScope {
  return {
    version: 4,
    authorizationId: randomUUID(),
    authorizationState: "active",
    mutationEpoch: 1n,
    trustDomain: "trusted_managed",
    investigationCodexRecordingAllowed: true,
    workspaceId: randomUUID(),
    repositoryConnectionId: randomUUID(),
    scmRepositoryIdentityId: randomUUID(),
    githubRepositoryId: "100",
    githubInstallationId: "200",
    pullRequestNumber: 7,
    baseSha: gitSha,
    mergeBaseSha: gitSha,
    headSha: gitSha,
    reviewRevisionHash: digest,
    producerReleaseId: "release",
    producerReleaseRegistered: true,
    actionIdentityHash: digest,
    runtimeIdentityHash: digest,
    gatewayIdentityHash: digest,
    protocolVersion: "2",
    schemaDigest: digest,
    protocolLimitsProfileId: "profile",
    providerInstanceId: "provider",
    repositoryBindingId: "binding",
    bindingRevision: 1,
    bindingActive: true,
    repositorySelected: true,
    poolId: "pool",
    poolActive: true,
    poolAuthzEpoch: 1n,
    runtimeGateActive: true,
    runtimeAuthzEpoch: 1n,
    model: "codex",
    policyFingerprint: digest,
    investigationId: randomUUID(),
    investigationVersion: 1n,
    turnId: randomUUID(),
    turnPurpose: "investigate",
    dossierDigest: digest,
    investigationManifestHash: digest,
    executionId: "execution",
    workSlotId: "slot",
    providerVoteLaneId: "codex",
    providerStrategyId: "strategy",
    attemptId: "attempt",
    investigationLease: {
      leaseId: "investigation-lease",
      capabilityId: "investigation-capability",
      ownerIdHash: digest,
      fencingToken: 11n,
      purpose: "relay_turn",
      expiresAt: later(5),
    },
    invocationLease: {
      leaseId: "invocation-lease",
      capabilityId: "invocation-capability",
      ownerIdHash: digest,
      fencingToken: 12n,
      expiresAt: later(6),
    },
    authorizationExpiresAt: later(10),
    turnExpiresAt: later(8),
    policyExpiresAt: later(9),
  };
}

function contract(current: HostedV4RelayScope) {
  return defineHostedV4RelayGrant({
    scope: current,
    now,
    maxRequests: 8,
    maxRequestBytes: 1_000,
    maxResponseBytes: 2_000,
    maxOutputTokens: 100,
  });
}

describe("hosted v4 relay turn contract", () => {
  // Regression: treating a shadow lease as dispatch authority would admit it.
  it("rejects the existing shadow_turn lease purpose", () => {
    const current = scope();
    expect(() =>
      contract({
        ...current,
        investigationLease: {
          ...current.investigationLease,
          purpose: "shadow_turn",
        },
      } as unknown as HostedV4RelayScope),
    ).toThrow();
  });

  // Regression: replacement lease fences or moved head would retain old authority.
  it("rejects a stale scope or fence and caps expiry at the first deadline", () => {
    const current = scope();
    const saved = contract(current);
    expect(saved.expiresAt).toEqual(later(5));
    expect(saved.maxConcurrentRequests).toBe(1);
    expect(() =>
      assertHostedV4RelayScopeCurrent(
        saved,
        {
          ...current,
          headSha: "c".repeat(40),
        },
        now,
      ),
    ).toThrow("hosted_v4_relay_scope_stale");
    expect(() =>
      assertHostedV4RelayScopeCurrent(
        saved,
        {
          ...current,
          invocationLease: { ...current.invocationLease, fencingToken: 13n },
        },
        now,
      ),
    ).toThrow("hosted_v4_relay_scope_stale");
  });

  // Regression: an unrelated grant identity could reset one logical turn.
  it("keeps the logical turn key across replacement lease attempts", () => {
    const current = scope();
    const original = contract(current);
    const replacement = contract({
      ...current,
      attemptId: "replacement",
      investigationLease: {
        ...current.investigationLease,
        leaseId: "replacement-lease",
        fencingToken: 13n,
      },
    });
    expect(replacement.logicalTurnKey).toBe(original.logicalTurnKey);
    expect(replacement.scopeHash).not.toBe(original.scopeHash);
  });
});

const disposableUrl =
  process.env.REVIEW_ROUTER_V4_RELAY_DISPOSABLE_DATABASE_URL;
const safeDisposableUrl = disposableUrl?.includes("rr_v4_444_disposable")
  ? disposableUrl
  : undefined;

describe.skipIf(!safeDisposableUrl)("hosted v4 relay turn persistence", () => {
  let client: Awaited<ReturnType<typeof openDisposableClient>> | undefined;
  const keys: string[] = [];
  async function openDisposableClient() {
    const { createPrismaClient } =
      await import("../../../../platform/db/src/index");
    return createPrismaClient({ databaseUrl: safeDisposableUrl! });
  }
  afterAll(async () => {
    if (client) {
      await client.hostedCodexV4RelayTurn.deleteMany({
        where: { logicalTurnKey: { in: keys } },
      });
      await client.$disconnect();
    }
  });

  // Regression: terminal_unknown on one grant could be escaped by reissue.
  it("persists terminal_unknown and rejects a replacement lease after restart", async () => {
    client = await openDisposableClient();
    const original = contract(scope());
    keys.push(original.logicalTurnKey);
    const first = new PrismaHostedV4RelayTurn(client);
    await first.reserve(original);
    await first.markTerminalUnknown(original.logicalTurnKey, now);
    await client.$disconnect();
    client = await openDisposableClient();
    const restarted = new PrismaHostedV4RelayTurn(client);
    await expect(restarted.reserve(original)).rejects.toThrow(
      "hosted_v4_relay_turn_terminal_unknown",
    );
    const replacement = contract({
      ...original.scope,
      attemptId: "replacement",
      invocationLease: {
        ...original.scope.invocationLease,
        leaseId: "replacement-lease",
        fencingToken: 99n,
      },
    });
    await expect(restarted.reserve(replacement)).rejects.toThrow(
      "hosted_v4_relay_turn_terminal_unknown",
    );
  });

  // Regression: an idempotent grant recovery could silently replenish its budget.
  it("rejects budget changes for a reserved logical turn", async () => {
    client ??= await openDisposableClient();
    const original = contract(scope());
    keys.push(original.logicalTurnKey);
    const turns = new PrismaHostedV4RelayTurn(client);
    await turns.reserve(original);
    await expect(
      turns.reserve({
        ...original,
        maxRequests: original.maxRequests + 1,
      }),
    ).rejects.toThrow("hosted_v4_relay_turn_scope_conflict");
  });
});
