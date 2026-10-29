import {
  gatewayProfileAcceptsRequestedModel,
  type GatewayModelQualificationProfile,
} from "./review-run-gateway-model-qualification";
import { providerApiModeForAuthMode } from "@reviewrouter/features-review-providers";
import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
  type LifecycleVerificationCapabilityV1,
} from "@reviewrouter/shared";
import {
  captureContextToolsPlan,
  PrismaContextConnectionStore,
  supportsContextToolsV1,
  type ContextToolsPlan,
} from "@reviewrouter/features-review-context-tools";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import { z } from "zod";
import { PrismaActionControlPlaneRepository } from "@reviewrouter/features-action-control-plane";
import {
  PrismaProviderAccountRepository,
  selectBinding,
  lockProviderAccountBindingUses,
  ProviderAccountError,
  assertOpaqueReference,
} from "@reviewrouter/features-provider-accounts";
import {
  parseReviewConfigurationStrict,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config/review-configuration";
import { assertProviderApiDirectConfigurationSupported } from "@reviewrouter/features-review-config";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  parseProducerPrDescriptionProfile,
  parseProducerLifecycleVerificationProfile,
  reviewAgentExecutionProviderKind,
  parseReviewAgentProfiles,
  parseProducerContextToolsProfile,
  selectReviewRunAgentProfile,
  readImplicitReviewAgentSelection,
  type ReviewRunAuthorizationCandidate,
  type ReviewRunGatewaySelection,
  type ReviewRunGatewayLimits,
  type ReviewRunRuntimeSnapshot,
  type ReviewAgentProfile,
  type ReviewRunRuntimeSnapshotPort,
  type ReviewRunRuntimeCaptureDenial,
  type VerifiedScmRunIdentity,
} from "@reviewrouter/features-review-run-control";

import { reviewRunGatewayMaxResponseBytes } from "./account-gateway-run-access";

type RuntimeReader = Pick<
  PrismaClient,
  "reviewConfiguration" | "workspaceProviderProfile" | "workspaceAccountBinding"
> &
  Partial<Pick<PrismaClient, "reviewContextConnection" | "producerRelease">>;

// Exact profile identity is resolved against the admitted producer, never guessed.
const defaultReviewAgentProfileRef = "ocr-managed-v2";

export function readServerReviewAgentProfileRef(
  raw: string | undefined,
): string {
  return readImplicitReviewAgentSelection(raw).profileRef;
}

/** Backend configuration only. Never sourced from CI/OIDC/request DTOs. */
export type ServerApprovedReviewRunGatewayPolicy = {
  readonly profiles: readonly {
    readonly profileRef: string;
    readonly limits: ReviewRunGatewayLimits;
  }[];
};

/** Trusted backend configuration. Absence never supplies a default allowance. */
export function readServerApprovedReviewRunGatewayPolicy(
  raw: string | undefined,
): ServerApprovedReviewRunGatewayPolicy | undefined {
  if (raw === undefined) return undefined;
  try {
    if (new TextEncoder().encode(raw).byteLength > 32_768) throw new Error();
    return z
      .strictObject({
        profiles: z
          .array(
            z.strictObject({
              profileRef: c.reference,
              limits: c.limits.refine(
                (limits) =>
                  limits.outputBytes <= reviewRunGatewayMaxResponseBytes,
              ),
            }),
          )
          .min(1)
          .max(128),
      })
      .parse(JSON.parse(raw));
  } catch {
    throw new Error("review_run_gateway_policy_invalid");
  }
}

export type ServerReviewRunGatewayRequestCap = Readonly<{
  workspaceId: string;
  repositoryConnectionId: string;
  scmRepositoryIdentityId: string;
  pullRequestNumber: number;
  profileRef: string;
  bindingId: string;
  maxRequests: number;
}>;

/** Server-owned cost ceilings for an exact saved connection and PR. No caller input. */
export function readServerReviewRunGatewayRequestCaps(
  raw: string | undefined,
): readonly ServerReviewRunGatewayRequestCap[] {
  if (raw === undefined) return [];
  try {
    if (new TextEncoder().encode(raw).byteLength > 32768) throw new Error();
    const rules = z
      .array(
        z.strictObject({
          workspaceId: c.reference,
          repositoryConnectionId: c.reference,
          scmRepositoryIdentityId: c.reference,
          pullRequestNumber: z.number().int().min(1).max(2147483647),
          profileRef: c.reference,
          bindingId: c.reference,
          maxRequests: c.limits.shape.requests,
        }),
      )
      .max(128)
      .parse(JSON.parse(raw));
    const identities = rules.map(({ maxRequests: _cap, ...scope }) => {
      void _cap;
      return canonicalJson(scope);
    });
    if (new Set(identities).size !== identities.length) throw new Error();
    return Object.freeze(rules.map((rule) => Object.freeze(rule)));
  } catch {
    throw new Error("review_run_gateway_request_caps_invalid");
  }
}

/** System-owned selection after real OIDC admission policy, without a user actor.
 * No Gateway HTTP call, credential, epoch inference or allowance is created here.
 */
export class ProductionReviewRunRuntimeSnapshot implements ReviewRunRuntimeSnapshotPort {
  private readonly repositories: PrismaActionControlPlaneRepository;
  private readonly accounts: PrismaProviderAccountRepository;
  private readonly approvedLimits: ReadonlyMap<string, ReviewRunGatewayLimits>;
  private readonly requestCaps: readonly ServerReviewRunGatewayRequestCap[];
  constructor(
    private readonly prisma: PrismaClient,
    policy?: ServerApprovedReviewRunGatewayPolicy,
    private readonly operatorWorkspaceId?: string,
    private readonly personalAccountsEnabled = false,
    private readonly agentProfileRef = defaultReviewAgentProfileRef,
    private readonly preferSkillsProfile = false,
    private readonly qualifiedRelayPolicy?: {
      readonly profiles: readonly {
        readonly profile: GatewayModelQualificationProfile;
        readonly outputTokens: number;
      }[];
      readonly ingressBytes: number;
      readonly requestTimeoutMs: number;
      readonly requestCaps?: readonly ServerReviewRunGatewayRequestCap[];
    },
  ) {
    assertOpaqueReference(agentProfileRef);
    if (operatorWorkspaceId !== undefined)
      assertOpaqueReference(operatorWorkspaceId);
    const profiles = new Map<string, ReviewRunGatewayLimits>();
    try {
      if (
        policy &&
        (policy.profiles.length < 1 || policy.profiles.length > 128)
      )
        throw new Error();
      for (const entry of policy?.profiles ?? []) {
        const profileRef = c.reference.parse(entry.profileRef);
        if (profiles.has(profileRef)) throw new Error();
        const limits = c.limits.parse(entry.limits);
        if (limits.outputBytes > reviewRunGatewayMaxResponseBytes)
          throw new Error();
        profiles.set(profileRef, Object.freeze(limits));
      }
    } catch {
      throw new Error("review_run_gateway_policy_invalid");
    }
    this.approvedLimits = profiles;
    this.requestCaps = readServerReviewRunGatewayRequestCaps(
      JSON.stringify(qualifiedRelayPolicy?.requestCaps ?? []),
    );
    this.repositories = new PrismaActionControlPlaneRepository(prisma);
    this.accounts = new PrismaProviderAccountRepository(
      prisma,
      operatorWorkspaceId,
      personalAccountsEnabled,
    );
  }

  private cappedRequests(
    identity: Pick<
      VerifiedScmRunIdentity,
      | "workspaceId"
      | "repositoryConnectionId"
      | "scmRepositoryIdentityId"
      | "pullRequestNumber"
    >,
    profileRef: string,
    bindingId: string,
    approvedRequests: number,
  ): number {
    const rule = this.requestCaps.find(
      (rule) =>
        rule.workspaceId === identity.workspaceId &&
        rule.repositoryConnectionId === identity.repositoryConnectionId &&
        rule.scmRepositoryIdentityId === identity.scmRepositoryIdentityId &&
        rule.pullRequestNumber === identity.pullRequestNumber &&
        rule.profileRef === profileRef &&
        rule.bindingId === bindingId,
    );
    return Math.min(approvedRequests, rule?.maxRequests ?? approvedRequests);
  }

  async capture(
    input: {
      readonly identity: VerifiedScmRunIdentity;
      readonly deadline: Date;
      readonly modelTransport: ReviewAgentProfile["modelTransports"][number];
      readonly providerApiAuthMode?: ProviderApiAuthMode;
      readonly producerRelease: Parameters<
        ReviewRunRuntimeSnapshotPort["capture"]
      >[0]["producerRelease"];
    },
    reader: RuntimeReader = this.prisma,
  ): Promise<ReviewRunRuntimeSnapshot | ReviewRunRuntimeCaptureDenial | null> {
    // Retain primitives across all reads; never retain the caller's nested identity.
    const identity = {
      ...input.identity,
      ...(input.identity.contextToolGithubSecrets
        ? {
            contextToolGithubSecrets: {
              ...input.identity.contextToolGithubSecrets,
            },
          }
        : {}),
    };
    const modelTransport = input.modelTransport;
    const providerApiAuthMode = input.providerApiAuthMode;
    const deadline = new Date(input.deadline).toISOString();
    const producer = {
      producerReleaseId: input.producerRelease.producerReleaseId,
      actionCommitSha: input.producerRelease.actionCommitSha,
      runtimeCommitSha: input.producerRelease.runtimeCommitSha,
    };
    if (!input.producerRelease.agentProfiles) return null;
    const agentProfiles = parseReviewAgentProfiles(
      input.producerRelease.agentProfiles,
    );
    let current: Awaited<
      ReturnType<
        PrismaActionControlPlaneRepository["findRuntimeReviewConfiguration"]
      >
    >;
    try {
      current = await this.repositories.findRuntimeReviewConfiguration(
        {
          workspaceId: identity.workspaceId,
          repositoryId: identity.repositoryConnectionId,
        },
        reader,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "review_policy_resave_required"
      )
        return null;
      throw error;
    }
    if (!current || current.workspaceVersion === null) return null;
    let configuration: ReviewConfiguration;
    try {
      configuration = parseReviewConfigurationStrict(current.config);
    } catch {
      return null;
    }
    // A finite direct selection requires its verified canonical caller. A
    // legacy reusable path or repository key presence is not that proof.
    if (
      modelTransport === "provider_api" &&
      providerApiAuthMode === undefined &&
      providerApiModeForAuthMode(configuration.providers[0]?.authMode ?? "") !==
        undefined
    )
      return null;
    if (providerApiAuthMode !== undefined) {
      if (modelTransport !== "provider_api") return null;
      try {
        if (
          assertProviderApiDirectConfigurationSupported(configuration) !==
          providerApiAuthMode
        )
          return null;
      } catch {
        return null;
      }
    }
    const selectedProviders = configuration.providers
      .map((provider, providerIndex) => ({ provider, providerIndex }))
      .filter(({ provider }) => provider.authMode === "codex_account_gateway");
    // A single execution profile is owned by this admission. Multiple gateway
    // profiles need a qualified shared allowance contract, not fresh invocations.
    if (selectedProviders.length > 1) return null;
    const selected = selectedProviders[0];
    // An explicit agentProfileRef is saved policy for Account Gateway rows only
    // and resolves ONLY against the exact producer's approved profiles. An
    // invalid/disabled/incompatible explicit ref is a configuration error with
    // no fallback to the process default.
    const explicitAgentProfileRef =
      selected?.provider.authMode === "codex_account_gateway"
        ? selected.provider.agentProfileRef
        : undefined;
    // A stale workflow transport is changed admission facts, not a bad engine.
    if (
      configuration.providers.some(
        (provider) =>
          (provider.authMode === "codex_account_gateway"
            ? "account_gateway"
            : "provider_api") !== modelTransport,
      )
    )
      return null;
    let agent: ReviewAgentProfile;
    try {
      agent = selectReviewRunAgentProfile({
        profiles: agentProfiles,
        modelTransport,
        ...(explicitAgentProfileRef !== undefined
          ? { explicitProfileRef: explicitAgentProfileRef }
          : {}),
        suppliedDiffOnly: selected?.provider.agenticContext === false,
        defaultProfileRef: this.agentProfileRef,
        preferSkillsProfile: this.preferSkillsProfile,
        reviewSkillsDelivery: providerApiAuthMode !== undefined,
      });
    } catch {
      return explicitAgentProfileRef !== undefined ||
        modelTransport === "account_gateway"
        ? { captureDenied: "agent_profile_unavailable" }
        : null;
    }
    if (providerApiAuthMode !== undefined && agent.reviewSkillsVersion !== 1)
      return { captureDenied: "agent_profile_unavailable" };
    // The first OCR profile requires agenticContext=true (native context
    // tools); explicit OCR with agenticContext=false is an actionable
    // configuration error before any inference.
    if (
      agent.agentKind === "ocr" &&
      selected?.provider.agenticContext === false
    )
      return { captureDenied: "agent_profile_incompatible" };
    let contextToolsPlan: ContextToolsPlan | undefined;
    try {
      contextToolsPlan = await captureTools(
        configuration,
        identity.workspaceId,
        reader,
      );
      if (contextToolsPlan && agent.agentKind !== "ocr")
        return { captureDenied: "agent_profile_incompatible" };
      if (
        contextToolsPlan &&
        !supportsContextToolsV1(input.producerRelease.contextToolsProfile)
      )
        return { captureDenied: "context_tools_unavailable" };
      if (contextToolsPlan)
        assertContextGithubBindings(
          contextToolsPlan,
          identity.contextToolGithubSecrets,
        );
    } catch {
      return { captureDenied: "context_tools_unavailable" };
    }
    const agentProfileDigest = createHash("sha256")
      .update(canonicalJson(agent))
      .digest("hex");
    let gateway: ReviewRunGatewaySelection | null = null;
    if (selected?.provider.authMode === "codex_account_gateway") {
      const limits = this.approvedLimits.get(
        selected.provider.gatewayProfileRef,
      );
      if (!limits) return null;
      const bindingId = selected.provider.gatewayBindingId;
      const selection = await this.accounts.findBinding(
        { workspaceId: identity.workspaceId, bindingId },
        reader,
      );
      let binding: ReturnType<typeof selectBinding>;
      try {
        binding = selectBinding(
          identity.workspaceId,
          bindingId,
          selection,
          this.operatorWorkspaceId,
        );
      } catch (error) {
        if (error instanceof ProviderAccountError) return null;
        throw error;
      }
      if (binding.profileRef !== selected.provider.gatewayProfileRef)
        return null;
      gateway = {
        providerIndex: selected.providerIndex,
        bindingId: binding.bindingId,
        connectionId: binding.connectionId,
        bindingRevision: binding.bindingRevision,
        policySubject: binding.policySubject,
        policyRevision: binding.policyRevision,
        permittedAccountRef: binding.gatewayAccountRef,
        profileRef: selected.provider.gatewayProfileRef,
        ...(binding.expectedAuthorizationEpoch !== undefined
          ? { expectedAuthorizationEpoch: binding.expectedAuthorizationEpoch }
          : {}),
        ...reviewRunGatewayPreparationIdentity(identity),
        limits: {
          ...limits,
          requests: this.cappedRequests(
            identity,
            selected.provider.gatewayProfileRef,
            bindingId,
            limits.requests,
          ),
        },
      };
    }
    let lifecycleVerificationUnavailableReason: ReviewRunRuntimeSnapshot["lifecycleVerificationUnavailableReason"];
    if (input.producerRelease.lifecycleVerificationProfile != null)
      lifecycleVerificationUnavailableReason = "verification_unavailable";
    let lifecycleVerificationCapability:
      | LifecycleVerificationCapabilityV1
      | undefined;
    if (
      input.producerRelease.lifecycleVerificationProfile != null &&
      gateway &&
      (agent.agentKind === "ocr" || agent.agentKind === "codex")
    ) {
      // Model/account selection stays exclusively in saved policy; qualification
      // supplies a bound for that model, never a fallback route.
      try {
        const profile = parseProducerLifecycleVerificationProfile(
          input.producerRelease.lifecycleVerificationProfile,
        );
        if (profile.descriptorDigest !== lifecycleVerificationDescriptorDigest)
          throw new Error("verification_configuration_invalid");
        const provider = selected!.provider;
        const qualified = (this.qualifiedRelayPolicy?.profiles ?? []).filter(
          (entry) =>
            entry.profile.profileId === gateway!.profileRef &&
            entry.profile.protocol === "openai-responses" &&
            gatewayProfileAcceptsRequestedModel(entry.profile, provider.model),
        );
        if (qualified.length > 1)
          throw new Error("verification_configuration_invalid");
        if (qualified.length === 1) {
          for (const bound of [
            qualified[0]!.outputTokens,
            this.qualifiedRelayPolicy!.ingressBytes,
            this.qualifiedRelayPolicy!.requestTimeoutMs,
          ]) {
            if (!Number.isSafeInteger(bound) || bound < 1)
              throw new Error("verification_configuration_invalid");
          }
          const maxOutputTokens = Math.min(
            lifecycleVerificationContract.maxOutputTokens,
            gateway.limits.tokens,
            qualified[0]!.outputTokens,
          );
          if (
            Number.isSafeInteger(maxOutputTokens) &&
            maxOutputTokens >=
              lifecycleVerificationContract.minOutputTokensPerTarget
          ) {
            lifecycleVerificationUnavailableReason = undefined;
            lifecycleVerificationCapability = {
              ...profile,
              executor: lifecycleVerificationContract.executor,
              modelTransport: "account_gateway",
              providerIndex: gateway.providerIndex,
              providerKind: reviewAgentExecutionProviderKind(agent),
              model: provider.model,
              maxDispatches: 2,
              maxPromptBytes: Math.min(
                lifecycleVerificationContract.maxPromptBytes,
                gateway.limits.requestBytes,
                this.qualifiedRelayPolicy!.ingressBytes,
              ),
              maxResponseBytes: Math.min(
                lifecycleVerificationContract.maxResponseBytes,
                gateway.limits.outputBytes,
              ),
              maxOutputTokens,
              deadlineMs: Math.min(
                lifecycleVerificationContract.deadlineMs,
                this.qualifiedRelayPolicy!.requestTimeoutMs,
              ),
              attemptBudget: 1,
            };
          }
        }
      } catch {
        lifecycleVerificationUnavailableReason =
          "verification_configuration_invalid";
      }
    }
    try {
      return parseReviewRunRuntimeSnapshot(
        canonicalJson({
          ...(input.producerRelease.prDescriptionProfile != null &&
          (gateway !== null ||
            (modelTransport === "provider_api" &&
              configuration.providers.length === 1 &&
              configuration.providers[0]?.authMode === "openrouter_api_key"))
            ? {
                prDescriptionCapability: parseProducerPrDescriptionProfile(
                  input.producerRelease.prDescriptionProfile,
                ),
              }
            : {}),
          ...(lifecycleVerificationCapability
            ? { lifecycleVerificationCapability }
            : {}),
          ...(lifecycleVerificationUnavailableReason
            ? { lifecycleVerificationUnavailableReason }
            : {}),
          snapshotVersion: 3,
          configurationSource: current.source,
          configurationVersion: current.version,
          workspaceConfigurationVersion: current.workspaceVersion,
          repositoryConfigurationVersion: current.repositoryVersion,
          effectivePolicyDigest: current.effectivePolicyDigest,
          producer,
          agent,
          agentProfileDigest,
          configurationCanonicalJson: canonicalJson(configuration),
          ...(contextToolsPlan
            ? { contextToolsPlanCanonicalJson: canonicalJson(contextToolsPlan) }
            : {}),
          deadline,
          gateway,
        }),
      );
    } catch {
      return null;
    }
  }

  async isLive(
    input: {
      readonly snapshot: ReviewRunRuntimeSnapshot;
      readonly identity: VerifiedScmRunIdentity;
      readonly now: Date;
    },
    reader: RuntimeReader = this.prisma,
  ): Promise<boolean> {
    const identity = { ...input.identity };
    const snapshot = parseReviewRunRuntimeSnapshot(
      canonicalJson(input.snapshot),
    );
    if (!snapshot) return false;
    if (
      createHash("sha256")
        .update(canonicalJson(snapshot.agent))
        .digest("hex") !== snapshot.agentProfileDigest
    )
      return false;
    if (
      `sha256:${createHash("sha256").update(snapshot.configurationCanonicalJson).digest("hex")}` !==
      snapshot.effectivePolicyDigest
    )
      return false;
    const configuration = parseReviewConfigurationStrict(
      JSON.parse(snapshot.configurationCanonicalJson),
    );
    if (canonicalJson(configuration) !== snapshot.configurationCanonicalJson)
      return false;
    try {
      const plan = await captureTools(
        configuration,
        identity.workspaceId,
        reader,
      );
      if (
        (plan ? canonicalJson(plan) : undefined) !==
        snapshot.contextToolsPlanCanonicalJson
      )
        return false;
      if (plan) {
        const producer = await reader.producerRelease?.findUnique({
          where: { producerReleaseId: snapshot.producer.producerReleaseId },
          select: {
            state: true,
            actionCommitSha: true,
            runtimeCommitSha: true,
            contextToolsProfile: true,
          },
        });
        if (
          !producer ||
          producer.state !== "registered" ||
          producer.actionCommitSha !== snapshot.producer.actionCommitSha ||
          producer.runtimeCommitSha !== snapshot.producer.runtimeCommitSha ||
          !supportsContextToolsV1(
            parseProducerContextToolsProfile(producer.contextToolsProfile),
          )
        )
          return false;
      }
    } catch {
      return false;
    }
    const gatewayProviders = configuration.providers.filter(
      (provider) => provider.authMode === "codex_account_gateway",
    );
    if (gatewayProviders.length > 1) return false;
    if (input.now >= new Date(snapshot.deadline)) return false;
    const original = snapshot.gateway;
    if (!original) return gatewayProviders.length === 0;
    // A new lower ceiling revokes an over-budget old grant in exactly this scope.
    // Removing/raising a ceiling never enlarges an already captured finite grant.
    if (
      original.limits.requests !==
      this.cappedRequests(
        identity,
        original.profileRef,
        original.bindingId,
        original.limits.requests,
      )
    )
      return false;
    const provider = configuration.providers[original.providerIndex];
    if (
      gatewayProviders.length !== 1 ||
      provider?.authMode !== "codex_account_gateway" ||
      provider.gatewayBindingId !== original.bindingId ||
      provider.gatewayProfileRef !== original.profileRef
    )
      return false;
    // Keep the original binding lifetime and epoch. A fresh BX2/config/epoch
    // never repairs an old run; Gateway also enforces its actual authority.
    try {
      const live = selectBinding(
        identity.workspaceId,
        original.bindingId,
        await this.accounts.findBinding(
          {
            workspaceId: identity.workspaceId,
            bindingId: original.bindingId,
          },
          reader,
        ),
        this.operatorWorkspaceId,
      );
      const stable = reviewRunGatewayPreparationIdentity(identity);
      return (
        live.connectionId === original.connectionId &&
        live.bindingRevision === original.bindingRevision &&
        live.policyRevision === original.policyRevision &&
        live.policySubject === original.policySubject &&
        live.gatewayAccountRef === original.permittedAccountRef &&
        live.profileRef === original.profileRef &&
        live.expectedAuthorizationEpoch ===
          original.expectedAuthorizationEpoch &&
        stable.invocationId === original.invocationId &&
        stable.attemptId === original.attemptId &&
        stable.operationId === original.operationId
      );
    } catch (error) {
      if (error instanceof ProviderAccountError) return false;
      throw error;
    }
  }

  /** Admission and saved-execution reads use the same lock order and private gate. */
  async lockGatewaySelection(
    transaction: Prisma.TransactionClient,
    workspaceId: string,
    snapshot: ReviewRunRuntimeSnapshot,
  ): Promise<void> {
    if (snapshot.gateway)
      await lockProviderAccountBindingUses(
        transaction,
        workspaceId,
        [snapshot.gateway.bindingId],
        this.personalAccountsEnabled,
      );
  }

  /** Called inside the EXISTING serializable row+outbox admission transaction.
   * Parent locks fence inserts even when repository override/default is absent.
   * Connection then binding locks match C1's mutation order and retain pending fences.
   */
  async matchesAdmission(
    transaction: Prisma.TransactionClient,
    candidate: ReviewRunAuthorizationCandidate,
  ): Promise<boolean> {
    const original = parseReviewRunRuntimeSnapshot(
      candidate.runtimeSnapshotCanonicalJson,
    );
    if (!original) return false;
    if (original.producer.producerReleaseId !== candidate.producerReleaseId)
      return false;
    let providerApiAuthMode: ProviderApiAuthMode | undefined;
    // The fence replays the original delivery capability, never a fresh caller
    // flag or configuration-only guess. A non-Gateway Skills profile was
    // admitted only through the verified direct provider-API route.
    if (!original.gateway && original.agent.reviewSkillsVersion === 1) {
      try {
        providerApiAuthMode = assertProviderApiDirectConfigurationSupported(
          parseReviewConfigurationStrict(
            JSON.parse(original.configurationCanonicalJson),
          ),
        );
      } catch {
        return false;
      }
    }
    const producer = await transaction.producerRelease.findUnique({
      where: { producerReleaseId: candidate.producerReleaseId },
      select: {
        producerReleaseId: true,
        actionCommitSha: true,
        runtimeCommitSha: true,
        agentProfilesJson: true,
        contextToolsProfile: true,
        prDescriptionProfile: true,
        lifecycleVerificationProfile: true,
      },
    });
    if (
      !producer ||
      !producer.agentProfilesJson ||
      producer.actionCommitSha !== original.producer.actionCommitSha ||
      producer.runtimeCommitSha !== original.producer.runtimeCommitSha
    )
      return false;
    const workspaceId = candidate.workspaceId;
    const targetKey = `repo:${candidate.repositoryConnectionId}`;
    const owned = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
    if (owned.length !== 1) return false;
    if (original.gateway) {
      await this.lockGatewaySelection(transaction, workspaceId, original);
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "ReviewConfiguration"
      WHERE "workspaceId" = ${workspaceId} AND "targetKey" IN (${targetKey}, 'workspace:default')
      ORDER BY "id" FOR UPDATE`;
    try {
      const current = await this.capture(
        {
          identity: candidate,
          modelTransport: original.gateway ? "account_gateway" : "provider_api",
          ...(providerApiAuthMode ? { providerApiAuthMode } : {}),
          deadline: candidate.maxExpiresAt,
          producerRelease: {
            producerReleaseId: producer.producerReleaseId,
            actionCommitSha: producer.actionCommitSha,
            runtimeCommitSha: producer.runtimeCommitSha,
            ...(producer.contextToolsProfile == null
              ? {}
              : {
                  contextToolsProfile: parseProducerContextToolsProfile(
                    producer.contextToolsProfile,
                  ),
                }),
            ...(producer.lifecycleVerificationProfile == null
              ? {}
              : {
                  lifecycleVerificationProfile:
                    parseProducerLifecycleVerificationProfile(
                      producer.lifecycleVerificationProfile,
                    ),
                }),
            ...(producer.prDescriptionProfile == null
              ? {}
              : {
                  prDescriptionProfile: parseProducerPrDescriptionProfile(
                    producer.prDescriptionProfile,
                  ),
                }),
            agentProfiles: parseReviewAgentProfiles(
              JSON.parse(producer.agentProfilesJson),
            ),
          },
        },
        transaction,
      );
      return canonicalJson(current) === candidate.runtimeSnapshotCanonicalJson;
    } catch (error) {
      if (error instanceof ProviderAccountError) return false;
      throw error;
    }
  }
}

/** One tuple across tokens, authorization IDs, request IDs, offers and settings.
 * The operation ID remains unchanged even if first prepare's outcome is unknown.
 */
export function reviewRunGatewayPreparationIdentity(
  identity: Pick<
    VerifiedScmRunIdentity,
    | "workspaceId"
    | "repositoryConnectionId"
    | "scmRepositoryIdentityId"
    | "sourceRunId"
    | "sourceRunAttempt"
  >,
): Pick<
  ReviewRunGatewaySelection,
  "invocationId" | "attemptId" | "operationId"
> {
  const run = [
    identity.workspaceId,
    identity.repositoryConnectionId,
    identity.scmRepositoryIdentityId,
    identity.sourceRunId,
  ];
  const digest = (purpose: string, tuple: readonly string[]) =>
    `rr-${createHash("sha256")
      .update(canonicalJson(["review-run-gateway-v1", purpose, ...tuple]))
      .digest("hex")}`;
  const attempt = [...run, identity.sourceRunAttempt];
  return {
    invocationId: digest("invocation", run),
    attemptId: digest("attempt", attempt),
    operationId: digest("prepare", attempt),
  };
}

async function captureTools(
  configuration: ReviewConfiguration,
  workspaceId: string,
  reader: RuntimeReader,
): Promise<ContextToolsPlan | undefined> {
  const selected = configuration.contextTools;
  if (!selected || selected.builtinTools.length + selected.mcp.length === 0)
    return undefined;
  if (selected.mcp.length && !reader.reviewContextConnection)
    throw new Error("context_store_unavailable");
  const store = reader.reviewContextConnection
    ? new PrismaContextConnectionStore({
        reviewContextConnection: reader.reviewContextConnection,
      })
    : null;
  const connections = await Promise.all(
    selected.mcp.map(async ({ connection }) => {
      const row = await store!.find(workspaceId, connection);
      if (!row) throw new Error("context_connection_unavailable");
      return row;
    }),
  );
  return captureContextToolsPlan(selected, connections);
}

/** The workflow source, rather than runner input, names every selected GH secret. */
export function assertContextGithubBindings(
  plan: ContextToolsPlan,
  actual: Readonly<Record<string, string>> | undefined,
): void {
  const expected = Object.fromEntries(
    plan.servers.flatMap((server) =>
      Object.entries(server.credentials)
        .filter(([, value]) => value.source === "github-secret")
        .map(([name, value]) => [
          name,
          value.source === "github-secret" ? value.name : "",
        ]),
    ),
  );
  if (canonicalJson(expected) !== canonicalJson(actual ?? {}))
    throw new Error("context_workflow_secret_binding_mismatch");
}
