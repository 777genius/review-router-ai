import { describe, expect, it, vi } from "vitest";
import type { HostedV4AuthorityBridge } from "@reviewrouter/features-hosted-account-pool";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  composeHostedV4RelayAuthority,
  hostedV4RelayLeaseRequirements,
} from "./hosted-v4-relay-authority";

const now = new Date("2026-09-24T12:00:00.000Z");
const hints = {
  authorizationToken: "verified-v2-token",
  repositoryConnectionId: "repository-1",
  providerInstanceId: "hosted-pool:repository:123",
  bindingId: "binding-1",
  bindingVersion: 2,
  investigationId: "investigation-1",
  turnId: "turn-1",
};
const authority = {
  authorization: {
    authorizationId: "authorization-1",
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "scm-1",
    pullRequestNumber: 7,
    baseSha: "b".repeat(40),
    mergeBaseSha: "c".repeat(40),
    headSha: "a".repeat(40),
    reviewRevisionHash: "revision-1",
    mutationEpoch: 5n,
    producerReleaseId: "release-1",
    trustDomain: "trusted_managed",
    investigationCodexRecordingAllowed: true,
    state: "active",
    expiresAt: new Date("2026-09-24T12:15:00.000Z"),
  },
  live: {
    bindingId: "binding-1",
    bindingVersion: 2,
    bindingActive: true,
    poolActive: true,
    headSha: "a".repeat(40),
    reviewRevisionHash: "revision-1",
    producerReleaseId: "release-1",
  },
};

function fixture(nowFn: () => Date = () => now) {
  const bridge = {
    resolveRelayAuthority: vi.fn().mockResolvedValue(authority),
  };
  const investigation = {
    investigationId: "investigation-1",
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "scm-1",
    pullRequestNumber: 7,
    trustDomain: "trusted_managed",
    baseSha: "b".repeat(40),
    mergeBaseSha: "c".repeat(40),
    headSha: "a".repeat(40),
    reviewRevisionHash: "revision-1",
    producerReleaseId: "release-1",
    state: "turn_leased",
    activeTurnId: "turn-1",
    version: 3n,
    dossierDigest: "d".repeat(64),
  };
  const turn = {
    turnId: "turn-1",
    investigationId: "investigation-1",
    state: "leased",
    leasedAtVersion: 3n,
    dossierDigest: "d".repeat(64),
    expiresAt: new Date("2026-09-24T12:05:00.000Z"),
  };
  const binding = {
    id: "binding-1",
    revision: 2n,
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    poolId: "pool-1",
    status: "active",
    pool: {
      workspaceId: "workspace-1",
      status: "active",
      authzEpoch: 9n,
      accounts: [
        {
          id: "account-1",
          workspaceId: "workspace-1",
          poolId: "pool-1",
          state: "healthy",
          activeGeneration: 1n,
          credentialVersions: [{ generation: 1n, credentialExpiresAt: null }],
        },
      ],
    },
  };
  const runtimeGate = { status: "active", authzEpoch: 4n };
  const prisma = {
    reviewInvestigation: {
      findUnique: vi.fn().mockImplementation(async () => investigation),
    },
    reviewInvestigationTurn: {
      findUnique: vi.fn().mockImplementation(async () => turn),
    },
    hostedCodexRepositoryBinding: {
      findUnique: vi.fn().mockImplementation(async () => binding),
    },
    hostedCodexRuntimeGate: {
      findUnique: vi.fn().mockImplementation(async () => runtimeGate),
    },
  };
  const composed = composeHostedV4RelayAuthority({
    prisma: prisma as unknown as PrismaClient,
    bridge: bridge as unknown as HostedV4AuthorityBridge,
    now: nowFn,
  });
  return {
    bridge,
    investigation,
    turn,
    binding,
    runtimeGate,
    prisma,
    composed,
  };
}

describe("private v4 relay prelease authority", () => {
  // Regression: trusting a caller ID or v1 token would reach DB reads.
  it("requires bridge verification before any lookup and stays default off", async () => {
    const f = fixture();
    f.bridge.resolveRelayAuthority.mockRejectedValueOnce(
      new Error("hosted_v4_authority_denied"),
    );
    await expect(
      f.composed.resolver.resolve({
        ...hints,
        authorizationToken: "v1-comment-token",
      }),
    ).rejects.toThrow("hosted_v4_authority_denied");
    expect(f.prisma.reviewInvestigation.findUnique).not.toHaveBeenCalled();
    expect(f.composed.enabled).toBe(false);
    expect(Object.keys(f.composed)).toEqual(["enabled", "resolver"]);
    expect(hostedV4RelayLeaseRequirements).toMatchObject({
      purpose: "relay_turn",
      acceptsShadowTurn: false,
      requiresVerifiedInvestigationLease: true,
      requiresVerifiedInvocationLease: true,
    });
  });

  // Regression: trusting a saved investigation would admit a moved head or release.
  it.each([
    [
      "head",
      (f: ReturnType<typeof fixture>) => {
        f.investigation.headSha = "e".repeat(40);
      },
    ],
    [
      "release",
      (f: ReturnType<typeof fixture>) => {
        f.investigation.producerReleaseId = "old-release";
      },
    ],
    [
      "turn",
      (f: ReturnType<typeof fixture>) => {
        f.turn.state = "committed";
      },
    ],
    [
      "pool",
      (f: ReturnType<typeof fixture>) => {
        f.binding.pool.status = "paused";
      },
    ],
    [
      "account",
      (f: ReturnType<typeof fixture>) => {
        f.binding.pool.accounts[0]!.state = "paused";
      },
    ],
    [
      "runtime",
      (f: ReturnType<typeof fixture>) => {
        f.runtimeGate.status = "closed";
      },
    ],
  ])(
    "rejects stale %s authority before any issuance",
    async (_kind, change) => {
      const f = fixture();
      change(f);
      await expect(f.composed.resolver.resolve(hints)).rejects.toThrow(
        "hosted_v4_relay_authority_denied",
      );
      expect(f.bridge.resolveRelayAuthority).toHaveBeenCalledTimes(1);
    },
  );

  // Regression: a single authority read would miss a concurrent change.
  it("rejects authority changed during lookup", async () => {
    const f = fixture();
    f.bridge.resolveRelayAuthority
      .mockResolvedValueOnce(authority)
      .mockResolvedValueOnce({
        ...authority,
        live: { ...authority.live, headSha: "e".repeat(40) },
      });
    await expect(f.composed.resolver.resolve(hints)).rejects.toThrow(
      "hosted_v4_relay_authority_denied",
    );
  });

  // Regression: a single turn read would leave a stale prelease snapshot.
  it("rejects a turn closed during the authority recheck", async () => {
    const f = fixture();
    f.bridge.resolveRelayAuthority
      .mockResolvedValueOnce(authority)
      .mockImplementationOnce(async () => {
        f.turn.state = "committed";
        return authority;
      });
    await expect(f.composed.resolver.resolve(hints)).rejects.toThrow(
      "hosted_v4_relay_authority_denied",
    );
  });

  // Regression: the final DB awaits can outlive an otherwise valid v2 token.
  it("rejects authorization that expires during the final DB reads", async () => {
    let clock = now;
    const f = fixture(() => clock);
    const expiresAt = new Date("2026-09-24T12:00:01.000Z");
    const shortAuthority = {
      ...authority,
      authorization: { ...authority.authorization, expiresAt },
    };
    f.bridge.resolveRelayAuthority.mockResolvedValue(shortAuthority);
    let gateReads = 0;
    f.prisma.hostedCodexRuntimeGate.findUnique.mockImplementation(async () => {
      if (++gateReads === 2) clock = new Date("2026-09-24T12:00:02.000Z");
      return f.runtimeGate;
    });
    await expect(f.composed.resolver.resolve(hints)).rejects.toThrow(
      "hosted_v4_relay_authority_denied",
    );
  });

  // Regression: echoing caller facts or comment credentials would fail this shape.
  it("returns only checked prelease facts, with no token or refresh capability", async () => {
    const f = fixture();
    const resolved = await f.composed.resolver.resolve(hints);
    expect(resolved).toMatchObject({
      authorizationId: "authorization-1",
      investigationId: "investigation-1",
      turnId: "turn-1",
      accountId: "account-1",
      poolAuthzEpoch: 9n,
      runtimeAuthzEpoch: 4n,
      expiresAt: f.turn.expiresAt,
    });
    expect(Object.keys(resolved)).not.toEqual(
      expect.arrayContaining([
        "commentToken",
        "commentTokenRefreshCapability",
        "capability",
        "grant",
      ]),
    );
  });
});
