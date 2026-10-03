import { createHash, createHmac } from "node:crypto";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  assertHostedV4OneShotApproval,
  defineHostedV4RelayGrant,
  FetchHostedV4OneShotRelay,
  hostedV4OneShotApprovalSchema,
  hostedV4RelayCanaryPolicyFingerprint,
  parseHostedV4ScopeCanonical,
  PrismaHostedV4RelayTurn,
  type HostedV4AuthorityBridge,
  type HostedV4OneShotApproval,
  type HostedV4OneShotAuthorizationPort,
  type HostedV4RelayDispatchPort,
  type HostedV4RelayGrantContract,
  type HostedV4RelayGrantIssuerPort,
  type HostedV4RelayTurnPort,
} from "@reviewrouter/features-hosted-account-pool";
import { ReviewRunAuthorizationTokenResolutionStatus } from "@reviewrouter/features-review-run-control";
import type { ReviewActionV2InvestigationHandlerDependencies } from "./review-action-v2-investigation-composition.js";
import {
  isHostedV4RelayAdmissionCurrent,
  PrismaHostedV4RelayAuthorityResolver,
} from "./hosted-v4-relay-authority.js";
import { createProductionHostedCodexSessionRuntime } from "./hosted-codex-relay-composition.js";

type GrantFacts = Readonly<{
  contract: HostedV4RelayGrantContract;
  accountId: string;
  credentialGeneration: bigint;
  runtimeConfigVersion: number;
  runId: string;
  runAttempt: number;
}>;
type IssueInput = Parameters<HostedV4RelayGrantIssuerPort["issue"]>[0];
type Turns = Pick<HostedV4RelayTurnPort, "reserveGrant"> &
  Pick<HostedV4RelayDispatchPort, "assertCurrentGrant">;

/** No record is minted here. Only a separately approved immutable tuple opens
 * this boundary; the ordinary V4 transport remains cap-closed. */
export class HostedV4OneShotCanaryAuthority
  implements HostedV4RelayGrantIssuerPort, HostedV4OneShotAuthorizationPort
{
  private readonly approval: HostedV4OneShotApproval;
  private readonly signingKey: Buffer;
  constructor(
    private readonly d: {
      approval: HostedV4OneShotApproval;
      sourceCommit: string;
      signingKey: Uint8Array;
      resolveIssue(input: IssueInput): Promise<GrantFacts>;
      resolveSaved(capabilityTokenHash: string): Promise<GrantFacts>;
      turns: Turns;
      now?: () => Date;
    },
  ) {
    this.approval = Object.freeze(
      hostedV4OneShotApprovalSchema.parse(d.approval),
    );
    this.signingKey = Buffer.from(d.signingKey);
    if (
      !/^[a-f0-9]{40}$/.test(d.sourceCommit) ||
      this.approval.sourceCommit !== d.sourceCommit ||
      this.signingKey.length < 32 ||
      this.signingKey.length > 64
    )
      throw denied();
  }

  async issue(input: IssueInput) {
    try {
      if (
        !input.investigationLeaseCapability ||
        !input.invocationLeaseCapability ||
        input.investigationLeaseCapability === input.invocationLeaseCapability
      )
        throw denied();
      const facts = await this.d.resolveIssue(input);
      this.checkApproval(
        facts,
        input.idempotencyKey,
        this.approval.requestHash,
      );
      const grant = this.bearer(facts.contract);
      const reservation = await this.d.turns.reserveGrant({
        ...facts,
        capabilityTokenHash: hash(grant),
      });
      if (reservation.grantId !== this.approval.grantId) throw denied();
      if (reservation.status === "recovery_required")
        return {
          status: "recovery_required" as const,
          grantResponse: null,
          blockedPrerequisite: "hosted_v4_one_shot_recovery_required",
        };
      await this.d.turns.assertCurrentGrant(facts.contract, {
        grantId: reservation.grantId,
        accountId: facts.accountId,
        credentialGeneration: facts.credentialGeneration,
      });
      return {
        status: reservation.status,
        blockedPrerequisite: null,
        grantResponse: {
          protocolVersion: 4 as const,
          grant,
          grantId: reservation.grantId,
          relayUrl: "/api/hosted/v4/codex/responses" as const,
          grantExpiresAt: facts.contract.expiresAt.toISOString(),
          policy: {
            maxRequests: facts.contract.maxRequests,
            maxConcurrentRequests: facts.contract.maxConcurrentRequests,
            maxRequestBytes: facts.contract.maxRequestBytes,
            maxResponseBytes: facts.contract.maxResponseBytes,
            maxOutputTokens: facts.contract.maxOutputTokens,
          },
        },
      };
    } catch {
      return {
        status: "rejected" as const,
        grantResponse: null,
        blockedPrerequisite: "hosted_v4_one_shot_authority_denied",
      };
    }
  }

  async authorize(
    input: Parameters<HostedV4OneShotAuthorizationPort["authorize"]>[0],
  ) {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(input.opaqueGrant) ||
      input.requestOrdinal !== 1
    )
      throw denied();
    const facts = await this.d.resolveSaved(hash(input.opaqueGrant));
    if (
      this.bearer(facts.contract) !== input.opaqueGrant ||
      input.requestBytes < 1 ||
      input.requestBytes > facts.contract.maxRequestBytes
    )
      throw denied();
    this.checkApproval(facts, input.idempotencyKey, input.requestHash);
    await this.d.turns.assertCurrentGrant(facts.contract, {
      grantId: this.approval.grantId,
      accountId: facts.accountId,
      credentialGeneration: facts.credentialGeneration,
    });
    return {
      authorityKind: "v4_relay_turn" as const,
      contract: facts.contract,
      grantId: this.approval.grantId,
      accountId: facts.accountId,
      runId: facts.runId,
      runAttempt: facts.runAttempt,
    };
  }

  private checkApproval(
    facts: GrantFacts,
    idempotencyKey: string,
    requestHash: string,
  ) {
    assertHostedV4OneShotApproval({
      contract: facts.contract,
      approval: this.approval,
      accountId: facts.accountId,
      idempotencyKey,
      requestHash,
      now: this.d.now?.() ?? new Date(),
    });
  }
  private bearer(contract: HostedV4RelayGrantContract): string {
    return createHmac("sha256", this.signingKey)
      .update(
        JSON.stringify([
          "hosted-v4-owner-one-shot-grant-v1",
          this.approval.approvalHash,
          contract.logicalTurnKey,
          contract.scopeHash,
        ]),
      )
      .digest("base64url");
  }
}

export type HostedV4OneShotCanaryConfiguration = Readonly<{
  approval: HostedV4OneShotApproval;
  /** Trusted registered producer/runtime source, not a request/environment flag. */
  sourceCommit: string;
  signingKey: Uint8Array;
}>;

export function composeProductionHostedV4OneShotCanary(input: {
  prisma: PrismaClient;
  bridge: HostedV4AuthorityBridge;
  env: Readonly<Record<string, string | undefined>>;
  configuration: HostedV4OneShotCanaryConfiguration;
  authorizations: ReviewActionV2InvestigationHandlerDependencies["authorizations"];
  capabilities: ReviewActionV2InvestigationHandlerDependencies["capabilities"];
  investigationLeaseCapabilities: ReviewActionV2InvestigationHandlerDependencies["investigationLeaseCapabilities"];
  now: () => Date;
}) {
  const { prisma } = input;
  const approval = Object.freeze(
    hostedV4OneShotApprovalSchema.parse(input.configuration.approval),
  );
  const config = Object.freeze({
    ...input.configuration,
    approval,
    signingKey: Buffer.from(input.configuration.signingKey),
  });
  const turns = new PrismaHostedV4RelayTurn(prisma);
  const resolver = new PrismaHostedV4RelayAuthorityResolver(
    prisma,
    input.bridge,
    input.now,
  );
  const authority = new HostedV4OneShotCanaryAuthority({
    ...config,
    approval,
    turns,
    now: input.now,
    async resolveIssue(request) {
      const verified =
        await input.authorizations.resolveReviewRunAuthorizationToken({
          token: request.authorizationToken,
        });
      if (verified.status !== ReviewRunAuthorizationTokenResolutionStatus.Valid)
        throw denied();
      const a = verified.authorization;
      if (
        !input.investigationLeaseCapabilities.verifyRelay ||
        !(await isHostedV4RelayAdmissionCurrent({
          prisma,
          env: input.env,
          authorization: a,
          investigationId: request.investigationId,
          turnId: request.turnId,
          now: input.now(),
        }))
      )
        throw denied();
      const [il, vl, binding] = await Promise.all([
        input.investigationLeaseCapabilities.verifyRelay(
          request.investigationLeaseCapability,
          input.now(),
        ),
        input.capabilities.verifyLease(
          request.invocationLeaseCapability,
          input.now(),
        ),
        prisma.hostedCodexRepositoryBinding.findUnique({
          where: { repositoryConnectionId: a.repositoryConnectionId },
        }),
      ]);
      const scopeHash = hash(
        JSON.stringify({
          pullRequestNumber: a.pullRequestNumber,
          repositoryConnectionId: a.repositoryConnectionId,
          scmRepositoryIdentityId: a.scmRepositoryIdentityId,
          workspaceId: a.workspaceId,
        }),
      );
      if (
        !binding ||
        il.purpose !== "relay_turn" ||
        vl.purpose !== "provider_execution" ||
        il.scopeHash !== scopeHash ||
        vl.scopeHash !== scopeHash ||
        il.leaseId === vl.leaseId ||
        il.capabilityId === vl.capabilityId ||
        il.investigationId !== request.investigationId ||
        il.turnId !== request.turnId
      )
        throw denied();
      for (const lease of [il, vl]) {
        if (
          lease.authorizationId !== a.authorizationId ||
          lease.mutationEpoch !== a.mutationEpoch ||
          lease.reviewRevisionHash !== a.reviewRevisionHash ||
          lease.ownershipExpiresAt <= input.now()
        )
          throw denied();
      }
      if (il.executionId !== vl.executionId || il.workSlotId !== vl.workSlotId)
        throw denied();
      const prelease = await resolver.resolve({
        ...request,
        repositoryConnectionId: a.repositoryConnectionId,
        providerInstanceId: `hosted-pool:repository:${approval.githubRepositoryId}`,
        bindingId: binding.id,
        bindingVersion: Number(binding.revision),
      });
      const [
        investigation,
        turn,
        invocation,
        investigationLease,
        release,
        account,
        repositoryConfig,
        workspaceConfig,
      ] = await Promise.all([
        prisma.reviewInvestigation.findUnique({
          where: { investigationId: request.investigationId },
        }),
        prisma.reviewInvestigationTurn.findUnique({
          where: { turnId: request.turnId },
        }),
        prisma.reviewInvocationLeaseV2.findUnique({
          where: { leaseId: vl.leaseId },
        }),
        prisma.reviewInvestigationLease.findUnique({
          where: { leaseId: il.leaseId },
        }),
        prisma.producerRelease.findUnique({
          where: { producerReleaseId: a.producerReleaseId },
        }),
        prisma.hostedCodexAccount.findUnique({
          where: { id: prelease.accountId },
        }),
        readConfig(prisma, a.workspaceId, `repo:${a.repositoryConnectionId}`),
        readConfig(prisma, a.workspaceId, "workspace:default"),
      ]);
      const runtime =
        repositoryConfig?.versions[0] ?? workspaceConfig?.versions[0];
      if (
        !investigation ||
        !turn ||
        !invocation ||
        !investigationLease ||
        !release ||
        !account ||
        !runtime ||
        release.state !== "registered" ||
        release.runtimeCommitSha !== config.sourceCommit ||
        prelease.accountId !== approval.accountId ||
        !account.activeGeneration ||
        !release.wrapperEntrypointDigest ||
        !release.contextGatewayEntrypointDigest ||
        !turn.turnBudgetCanonicalJson ||
        !turn.turnBudgetHash ||
        !investigation.investigationManifestHash
      )
        throw denied();
      for (const [claims, row] of [
        [il, investigationLease],
        [vl, invocation],
      ] as const) {
        if (
          row.state !== "active" ||
          row.purpose !== claims.purpose ||
          row.leaseCapabilityId !== claims.capabilityId ||
          row.ownerIdHash !== claims.ownerIdHash ||
          row.attemptId !== claims.attemptId ||
          row.authorizationId !== claims.authorizationId ||
          row.executionId !== claims.executionId ||
          row.workSlotId !== claims.workSlotId ||
          row.reviewRevisionHash !== claims.reviewRevisionHash ||
          row.mutationEpoch !== claims.mutationEpoch ||
          row.expiresAt < claims.ownershipExpiresAt ||
          row.expiresAt <= input.now()
        )
          throw denied();
      }
      if (
        investigationLease.fencingToken !== il.fencingToken ||
        invocation.providerInvocationKey !== vl.providerInvocationKey ||
        investigation.version !== BigInt(il.investigationVersion) ||
        investigation.providerVoteLaneId !== il.providerVoteLaneId ||
        investigation.providerStrategyId !== il.providerStrategyId ||
        investigation.investigationManifestHash !== il.investigationManifestHash
      )
        throw denied();
      const budget = JSON.parse(turn.turnBudgetCanonicalJson) as {
        maxRequests: number;
        maxRequestBytes: number;
        maxResponseBytes: number;
        maxOutputTokens: number;
      };
      const contract = defineHostedV4RelayGrant({
        ...budget,
        now: input.now(),
        scope: {
          version: 4,
          authorizationId: a.authorizationId,
          authorizationState: "active",
          mutationEpoch: a.mutationEpoch,
          trustDomain: "trusted_managed",
          investigationCodexRecordingAllowed: true,
          workspaceId: a.workspaceId,
          repositoryConnectionId: a.repositoryConnectionId,
          scmRepositoryIdentityId: a.scmRepositoryIdentityId,
          githubRepositoryId: approval.githubRepositoryId,
          githubInstallationId:
            (
              await prisma.repositoryConnection.findUnique({
                where: { id: a.repositoryConnectionId },
                select: {
                  installation: { select: { githubInstallationId: true } },
                },
              })
            )?.installation?.githubInstallationId.toString() ?? "",
          pullRequestNumber: a.pullRequestNumber,
          baseSha: a.baseSha,
          mergeBaseSha: a.mergeBaseSha,
          headSha: a.headSha,
          reviewRevisionHash: a.reviewRevisionHash,
          producerReleaseId: a.producerReleaseId,
          producerReleaseRegistered: true,
          actionIdentityHash: release.wrapperEntrypointDigest,
          runtimeIdentityHash: release.runtimeEntrypointDigest,
          gatewayIdentityHash: release.contextGatewayEntrypointDigest,
          protocolVersion: a.selectedProtocolVersion,
          schemaDigest: a.schemaDigest,
          protocolLimitsProfileId: a.protocolLimitsProfileId,
          providerInstanceId: `hosted-pool:repository:${approval.githubRepositoryId}`,
          repositoryBindingId: binding.id,
          bindingRevision: Number(binding.revision),
          bindingActive: true,
          repositorySelected: true,
          poolId: prelease.poolId,
          poolActive: true,
          poolAuthzEpoch: prelease.poolAuthzEpoch,
          runtimeGateActive: true,
          runtimeAuthzEpoch: prelease.runtimeAuthzEpoch,
          model: runtime.model,
          policyFingerprint: hostedV4RelayCanaryPolicyFingerprint({
            ...budget,
            accountId: account.id,
            runtimeConfigVersion: runtime.version,
            model: runtime.model,
          }),
          investigationId: investigation.investigationId,
          investigationVersion: investigation.version,
          turnId: turn.turnId,
          turnBudgetCanonicalJson: turn.turnBudgetCanonicalJson,
          turnBudgetHash: turn.turnBudgetHash,
          turnPurpose: il.turnPurpose as "discovery" | "critic",
          planningInputDossierDigest: turn.dossierDigest,
          dossierDigest: investigation.dossierDigest,
          investigationManifestHash: investigation.investigationManifestHash,
          executionId: il.executionId,
          workSlotId: il.workSlotId,
          providerVoteLaneId: il.providerVoteLaneId,
          providerStrategyId: il.providerStrategyId,
          attemptId: il.attemptId,
          investigationLease: {
            leaseId: il.leaseId,
            capabilityId: il.capabilityId,
            ownerIdHash: il.ownerIdHash,
            fencingToken: il.fencingToken,
            purpose: "relay_turn",
            expiresAt: il.ownershipExpiresAt,
          },
          invocationLease: {
            leaseId: vl.leaseId,
            capabilityId: vl.capabilityId,
            ownerIdHash: vl.ownerIdHash,
            fencingToken: invocation.fencingToken,
            purpose: "provider_execution",
            attemptId: vl.attemptId,
            providerInvocationKey: vl.providerInvocationKey,
            expiresAt: vl.ownershipExpiresAt,
          },
          authorizationExpiresAt: a.expiresAt,
          turnExpiresAt: turn.expiresAt,
          policyExpiresAt: new Date(approval.expiresAt),
          ownerOneShotApproval: approval,
        },
      });
      return {
        contract,
        accountId: account.id,
        credentialGeneration: account.activeGeneration,
        runtimeConfigVersion: runtime.version,
        runId: a.sourceRunId,
        runAttempt: Number(a.sourceRunAttempt),
      };
    },
    async resolveSaved(capabilityTokenHash) {
      const grant = await prisma.hostedCodexInvocationGrant.findUnique({
        where: { capabilityTokenHash },
        include: { v4Turn: true },
      });
      if (
        !grant?.v4Turn ||
        grant.authorityKind !== "v4_relay_turn" ||
        grant.status !== "issued" ||
        grant.id !== approval.grantId ||
        grant.expiresAt <= input.now()
      )
        throw denied();
      const scope = parseHostedV4ScopeCanonical(grant.v4Turn.scopeCanonical);
      const contract = defineHostedV4RelayGrant({
        scope,
        now: input.now(),
        maxRequests: grant.maxRequests,
        maxRequestBytes: grant.maxRequestBytes,
        maxResponseBytes: grant.maxResponseBytes,
        maxOutputTokens: grant.maxOutputTokens,
      });
      const live = await input.bridge.resolveSavedRelayAuthority({
        authorizationId: scope.authorizationId,
        repositoryConnectionId: scope.repositoryConnectionId,
        providerInstanceId: scope.providerInstanceId,
        bindingId: scope.repositoryBindingId,
        bindingVersion: scope.bindingRevision,
      });
      const [release, account] = await Promise.all([
        prisma.producerRelease.findUnique({
          where: { producerReleaseId: scope.producerReleaseId },
        }),
        prisma.hostedCodexAccount.findUnique({
          where: { id: grant.activeAccountId },
        }),
      ]);
      if (
        live.authorization.mutationEpoch !== scope.mutationEpoch ||
        live.live.headSha !== scope.headSha ||
        live.live.reviewRevisionHash !== scope.reviewRevisionHash ||
        live.live.producerReleaseId !== scope.producerReleaseId ||
        release?.runtimeCommitSha !== config.sourceCommit ||
        !account?.activeGeneration ||
        contract.scopeHash !== grant.v4ScopeHash ||
        contract.scopeHash !== grant.v4Turn.scopeHash
      )
        throw denied();
      return {
        contract,
        accountId: account.id,
        credentialGeneration: account.activeGeneration,
        runtimeConfigVersion: grant.runtimeConfigVersion,
        runId: grant.runId,
        runAttempt: grant.runAttempt,
      };
    },
  });
  return Object.freeze({
    enabled: true as const,
    authority,
    approval,
    authorization: authority,
    relay: new FetchHostedV4OneShotRelay({
      approval,
      turns,
      now: input.now,
      runtime: createProductionHostedCodexSessionRuntime({
        prisma,
        env: input.env,
      }),
    }),
  });
}

function readConfig(
  prisma: PrismaClient,
  workspaceId: string,
  targetKey: string,
) {
  return prisma.reviewConfiguration.findUnique({
    where: { workspaceId_targetKey: { workspaceId, targetKey } },
    select: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { model: true, version: true },
      },
    },
  });
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
function denied(): Error {
  return new Error("hosted_v4_one_shot_authority_denied");
}
