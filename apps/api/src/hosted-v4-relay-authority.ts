import type { PrismaClient } from "@reviewrouter/platform-db";
import type { HostedV4AuthorityBridge } from "@reviewrouter/features-hosted-account-pool";

/** A checked snapshot for a future relay lease admission, never a grant. */
export type HostedV4RelayPreleaseAuthority = Readonly<{
  authorizationId: string;
  investigationId: string;
  turnId: string;
  mutationEpoch: bigint;
  bindingId: string;
  bindingVersion: number;
  poolId: string;
  poolAuthzEpoch: bigint;
  runtimeAuthzEpoch: bigint;
  accountId: string;
  headSha: string;
  reviewRevisionHash: string;
  producerReleaseId: string;
  expiresAt: Date;
}>;

export type HostedV4RelayAuthorityHints = Readonly<{
  authorizationToken: string;
  repositoryConnectionId: string;
  providerInstanceId: string;
  bindingId: string;
  bindingVersion: number;
  investigationId: string;
  turnId: string;
}>;

/** All IDs are lookup hints. The v2 token verifier and server records decide. */
export class PrismaHostedV4RelayAuthorityResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly bridge: HostedV4AuthorityBridge,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(
    hints: HostedV4RelayAuthorityHints,
  ): Promise<HostedV4RelayPreleaseAuthority> {
    if (!hints.investigationId || !hints.turnId) throw denied();
    const first = await this.bridge.resolveRelayAuthority(hints);
    const [investigation, turn, binding, runtimeGate] = await Promise.all([
      this.prisma.reviewInvestigation.findUnique({
        where: { investigationId: hints.investigationId },
      }),
      this.prisma.reviewInvestigationTurn.findUnique({
        where: { turnId: hints.turnId },
      }),
      this.prisma.hostedCodexRepositoryBinding.findUnique({
        where: { id: first.live.bindingId },
        include: {
          pool: {
            include: { accounts: { include: { credentialVersions: true } } },
          },
        },
      }),
      this.prisma.hostedCodexRuntimeGate.findUnique({
        where: { id: "global" },
      }),
    ]);
    const { authorization, live } = first;
    const now = this.now();
    if (
      !investigation ||
      !turn ||
      !binding ||
      !runtimeGate ||
      investigation.investigationId !== hints.investigationId ||
      investigation.workspaceId !== authorization.workspaceId ||
      investigation.repositoryConnectionId !==
        authorization.repositoryConnectionId ||
      investigation.scmRepositoryIdentityId !==
        authorization.scmRepositoryIdentityId ||
      investigation.pullRequestNumber !== authorization.pullRequestNumber ||
      investigation.trustDomain !== authorization.trustDomain ||
      investigation.baseSha !== authorization.baseSha ||
      investigation.mergeBaseSha !== authorization.mergeBaseSha ||
      investigation.headSha !== authorization.headSha ||
      investigation.reviewRevisionHash !== authorization.reviewRevisionHash ||
      investigation.producerReleaseId !== authorization.producerReleaseId ||
      investigation.state !== "turn_leased" ||
      investigation.activeTurnId !== turn.turnId ||
      turn.investigationId !== investigation.investigationId ||
      turn.state !== "leased" ||
      turn.leasedAtVersion !== investigation.version ||
      turn.dossierDigest !== investigation.dossierDigest ||
      turn.expiresAt <= now ||
      binding.id !== live.bindingId ||
      binding.revision !== BigInt(live.bindingVersion) ||
      binding.workspaceId !== authorization.workspaceId ||
      binding.repositoryConnectionId !== authorization.repositoryConnectionId ||
      binding.status !== "active" ||
      binding.pool.workspaceId !== authorization.workspaceId ||
      binding.pool.status !== "active" ||
      runtimeGate.status !== "active"
    )
      throw denied();

    const account = binding.pool.accounts.find(
      (candidate) =>
        candidate.workspaceId === authorization.workspaceId &&
        candidate.poolId === binding.poolId &&
        candidate.state === "healthy" &&
        candidate.activeGeneration !== null &&
        candidate.credentialVersions.some(
          (credential) =>
            credential.generation === candidate.activeGeneration &&
            (credential.credentialExpiresAt === null ||
              credential.credentialExpiresAt > now),
        ),
    );
    if (!account) throw denied();

    // Recheck the mutable authorization, SCM and binding after DB reads. This
    // remains a prelease snapshot; grant issuance needs a transactional fence.
    const second = await this.bridge.resolveRelayAuthority(hints);
    const [
      currentInvestigation,
      currentTurn,
      currentBinding,
      currentRuntimeGate,
    ] = await Promise.all([
      this.prisma.reviewInvestigation.findUnique({
        where: { investigationId: hints.investigationId },
      }),
      this.prisma.reviewInvestigationTurn.findUnique({
        where: { turnId: hints.turnId },
      }),
      this.prisma.hostedCodexRepositoryBinding.findUnique({
        where: { id: live.bindingId },
        include: {
          pool: {
            include: { accounts: { include: { credentialVersions: true } } },
          },
        },
      }),
      this.prisma.hostedCodexRuntimeGate.findUnique({
        where: { id: "global" },
      }),
    ]);
    const finalNow = this.now();
    if (
      second.authorization.authorizationId !== authorization.authorizationId ||
      second.authorization.mutationEpoch !== authorization.mutationEpoch ||
      second.authorization.expiresAt.getTime() !==
        authorization.expiresAt.getTime() ||
      second.live.headSha !== live.headSha ||
      second.live.reviewRevisionHash !== live.reviewRevisionHash ||
      second.live.producerReleaseId !== live.producerReleaseId ||
      second.live.bindingVersion !== live.bindingVersion ||
      second.live.poolActive !== live.poolActive ||
      second.live.bindingActive !== live.bindingActive ||
      !currentInvestigation ||
      currentInvestigation.version !== investigation.version ||
      currentInvestigation.workspaceId !== investigation.workspaceId ||
      currentInvestigation.repositoryConnectionId !==
        investigation.repositoryConnectionId ||
      currentInvestigation.scmRepositoryIdentityId !==
        investigation.scmRepositoryIdentityId ||
      currentInvestigation.pullRequestNumber !==
        investigation.pullRequestNumber ||
      currentInvestigation.baseSha !== investigation.baseSha ||
      currentInvestigation.mergeBaseSha !== investigation.mergeBaseSha ||
      currentInvestigation.headSha !== investigation.headSha ||
      currentInvestigation.reviewRevisionHash !==
        investigation.reviewRevisionHash ||
      currentInvestigation.producerReleaseId !==
        investigation.producerReleaseId ||
      currentInvestigation.state !== "turn_leased" ||
      currentInvestigation.activeTurnId !== turn.turnId ||
      currentInvestigation.dossierDigest !== investigation.dossierDigest ||
      !currentTurn ||
      currentTurn.investigationId !== investigation.investigationId ||
      currentTurn.state !== "leased" ||
      currentTurn.leasedAtVersion !== turn.leasedAtVersion ||
      currentTurn.dossierDigest !== turn.dossierDigest ||
      currentTurn.expiresAt.getTime() !== turn.expiresAt.getTime() ||
      !currentBinding ||
      currentBinding.id !== binding.id ||
      currentBinding.workspaceId !== binding.workspaceId ||
      currentBinding.repositoryConnectionId !==
        binding.repositoryConnectionId ||
      currentBinding.poolId !== binding.poolId ||
      currentBinding.revision !== binding.revision ||
      currentBinding.status !== "active" ||
      currentBinding.pool.authzEpoch !== binding.pool.authzEpoch ||
      currentBinding.pool.workspaceId !== binding.pool.workspaceId ||
      currentBinding.pool.status !== "active" ||
      !currentBinding.pool.accounts.some(
        (candidate) =>
          candidate.id === account.id &&
          candidate.workspaceId === authorization.workspaceId &&
          candidate.poolId === binding.poolId &&
          candidate.state === "healthy" &&
          candidate.activeGeneration === account.activeGeneration &&
          candidate.credentialVersions.some(
            (credential) =>
              credential.generation === candidate.activeGeneration &&
              (credential.credentialExpiresAt === null ||
                credential.credentialExpiresAt > finalNow),
          ),
      ) ||
      !currentRuntimeGate ||
      currentRuntimeGate.status !== "active" ||
      currentRuntimeGate.authzEpoch !== runtimeGate.authzEpoch ||
      authorization.expiresAt <= finalNow ||
      turn.expiresAt <= finalNow
    )
      throw denied();
    return {
      authorizationId: authorization.authorizationId,
      investigationId: investigation.investigationId,
      turnId: turn.turnId,
      mutationEpoch: authorization.mutationEpoch,
      bindingId: binding.id,
      bindingVersion: live.bindingVersion,
      poolId: binding.poolId,
      poolAuthzEpoch: binding.pool.authzEpoch,
      runtimeAuthzEpoch: runtimeGate.authzEpoch,
      accountId: account.id,
      headSha: live.headSha,
      reviewRevisionHash: live.reviewRevisionHash,
      producerReleaseId: live.producerReleaseId,
      expiresAt: new Date(
        Math.min(authorization.expiresAt.getTime(), turn.expiresAt.getTime()),
      ),
    };
  }
}

/** The existing investigation lease domain is shadow_turn only. */
export const hostedV4RelayLeaseRequirements = Object.freeze({
  purpose: "relay_turn" as const,
  acceptsShadowTurn: false as const,
  requiresVerifiedInvestigationLease: true as const,
  requiresVerifiedInvocationLease: true as const,
});

/** Explicit default-off boundary; no grant, token or provider adapter is exposed. */
export function composeHostedV4RelayAuthority(input: {
  prisma: PrismaClient;
  bridge: HostedV4AuthorityBridge;
  now?: () => Date;
}): Readonly<{
  enabled: false;
  resolver: PrismaHostedV4RelayAuthorityResolver;
}> {
  return {
    enabled: false,
    resolver: new PrismaHostedV4RelayAuthorityResolver(
      input.prisma,
      input.bridge,
      input.now,
    ),
  };
}

function denied(): Error {
  return new Error("hosted_v4_relay_authority_denied");
}
