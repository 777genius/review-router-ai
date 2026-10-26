import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import { parseReviewRunRuntimeSnapshot } from "../../domain/review-run-runtime-snapshot";
import type { ReviewRunSkillsSnapshotPort } from "../ports/review-run-skills-snapshot-port";
import type {
  ReviewRunRuntimeCaptureDenial,
  ReviewRunRuntimeSnapshotPort,
} from "../ports/review-run-runtime-snapshot-port";
import { tokenClaimsMatchAuthorization } from "./token-claims-match-authorization";
import type { ProducerRelease } from "../../domain/producer-release";
import type {
  ReviewProtocolLimitsV2,
  ReviewOperationalSloProfileV2,
} from "../../domain/producer-release";
import type { ReviewMutationAuthority } from "../../domain/review-mutation-authority";
import type { ScmRepositoryIdentity } from "../../domain/scm-repository-identity";
import type { ReviewSafetyPolicySnapshot } from "../../domain/review-safety-policy";
import {
  reviewAgentExecutionProviderKind,
  type ReviewAgentProfile,
} from "../../domain/review-agent-profile";
import type {
  ReviewRunAuthorization,
  ReviewRunRevision,
} from "../../domain/review-run-authorization";
import { bindReviewInvestigationAuthorizationDescriptorToVoteLanes } from "../../domain/review-run-authorization";
import {
  assertPositiveInteger,
  canonicalJson,
} from "../../domain/review-run-control-types";
import {
  ProducerReleaseState,
  ReviewMutationLaneKind,
  ReviewMutationMode,
  ReviewProtocolVersion,
  ReviewProviderKind,
  ReviewRunAuthorizationState,
  ReviewSafetyDecisionKind,
  ReviewTaskKind,
  ReviewTrustDomain,
  type ProviderVoteLane,
  type ReviewRunScope,
} from "../../domain/review-run-control-types";
import type {
  ClockPort,
  IdentifierFactoryPort,
  IssuedReviewRunAuthorizationToken,
  ReviewRunAuthorizationTokenPort,
  Sha256DigestPort,
  VerifiedReviewRunAuthorizationToken,
  VerifiedReviewRunAuthorizationTokenWithMetadata,
} from "../ports/platform-ports";
import type {
  ProducerReleaseQueryPort,
  ReviewOperationalSloProfileQueryPort,
  ReviewProtocolLimitsProfileQueryPort,
} from "../ports/producer-release-ports";
import type { ReviewMutationAuthorityQueryPort } from "../ports/review-mutation-authority-ports";
import {
  ReviewRunAuthorizationCreateStatus,
  ReviewRunAuthorizationRenewStatus,
  ReviewRunAuthorizationTerminateStatus,
  type ReviewRunAuthorizationCommandPort,
  type ReviewRunAuthorizationAdmissionCommandPort,
  type ReviewRunAuthorizationQueryPort,
} from "../ports/review-run-authorization-ports";
import type { ReviewSafetyDecisionResolverPort } from "../ports/review-safety-policy-ports";
import type { ScmRepositoryIdentityQueryPort } from "../ports/scm-repository-identity-ports";

export type VerifiedScmRunIdentity = ReviewRunScope &
  ReviewRunRevision & {
    readonly sourceRunId: string;
    readonly sourceRunAttempt: string;
    readonly workflowIdentityHash: string;
    /** Named metadata from the signed canonical caller; never secret values. */
    readonly contextToolGithubSecrets?: Readonly<Record<string, string>>;
    readonly trustDomain: ReviewTrustDomain;
  };

export enum ReviewRunAuthorizationUseCaseStatus {
  Authorized = "authorized",
  Restored = "restored",
  Renewed = "renewed",
  Denied = "denied",
  Conflict = "conflict",
  Expired = "expired",
  Revoked = "revoked",
  Missing = "missing",
}

export enum ReviewRunAuthorizationDenialReason {
  RepositoryBindingMismatch = "repository_binding_mismatch",
  MutationAuthorityUnavailable = "mutation_authority_unavailable",
  ProducerReleaseUnavailable = "producer_release_unavailable",
  ReleaseProfileUnavailable = "release_profile_unavailable",
  SafetyDecisionDisabled = "safety_decision_disabled",
  VerifiedIdentityDrift = "verified_identity_drift",
  SafetyDecisionChanged = "safety_decision_changed",
  AdmissionFactsChanged = "admission_facts_changed",
  AgentProfileUnavailable = "agent_profile_unavailable",
  AgentProfileIncompatible = "agent_profile_incompatible",
  SkillsUnavailable = "skills_unavailable",
  SkillsEngineUnsupported = "skills_engine_unsupported",
  SkillsLimitsExceeded = "skills_limits_exceeded",
  ContextToolsUnavailable = "context_tools_unavailable",
  ProviderVoteLaneUnavailable = "provider_vote_lane_unavailable",
  ReviewInvestigationIncompatible = "review_investigation_incompatible",
}

/** Explicit result shapes (rather than inferred literal unions) keep the
 * `denied` discriminant exact: no `denied?: never` normalization may leak a
 * payload member into the denial branch of `"denied" in result`.
 */
type ReviewRunAuthorizationEligibilityDenial = Readonly<{
  denied: ReviewRunAuthorizationDenialReason;
}>;

type ReviewRunAuthorizationBaseEligibility = Readonly<{
  repository: ScmRepositoryIdentity;
  authority: ReviewMutationAuthority;
  release: ProducerRelease;
  limits: ReviewProtocolLimitsV2;
  slo: ReviewOperationalSloProfileV2;
}>;

type ReviewRunAuthorizationBaseEligibilityResult =
  | ReviewRunAuthorizationBaseEligibility
  | ReviewRunAuthorizationEligibilityDenial;

type ReviewRunAuthorizationEligibility = Readonly<{
  repository: ScmRepositoryIdentity;
  authority: ReviewMutationAuthority;
  release: ProducerRelease;
  limits: ReviewProtocolLimitsV2;
  slo: ReviewOperationalSloProfileV2;
  safety: ReviewSafetyPolicySnapshot;
}>;

type ReviewRunAuthorizationEligibilityResult =
  | ReviewRunAuthorizationEligibility
  | ReviewRunAuthorizationEligibilityDenial;

export type ReviewRunAuthorizationSuccess = {
  readonly status:
    | ReviewRunAuthorizationUseCaseStatus.Authorized
    | ReviewRunAuthorizationUseCaseStatus.Restored
    | ReviewRunAuthorizationUseCaseStatus.Renewed;
  readonly authorization: ReviewRunAuthorization;
  readonly token: IssuedReviewRunAuthorizationToken;
  readonly protocolLimits: Awaited<
    ReturnType<
      ReviewProtocolLimitsProfileQueryPort["findProtocolLimitsProfileById"]
    >
  >;
};

export type ReviewRunAuthorizationUseCaseResult =
  | ReviewRunAuthorizationSuccess
  | {
      readonly status: ReviewRunAuthorizationUseCaseStatus.Denied;
      readonly reason: ReviewRunAuthorizationDenialReason;
    }
  | {
      readonly status:
        | ReviewRunAuthorizationUseCaseStatus.Conflict
        | ReviewRunAuthorizationUseCaseStatus.Expired
        | ReviewRunAuthorizationUseCaseStatus.Revoked
        | ReviewRunAuthorizationUseCaseStatus.Missing;
    };

export enum ReviewRunAuthorizationTokenResolutionStatus {
  Valid = "valid",
  Invalid = "invalid",
  ClaimDrift = "claim_drift",
  Missing = "missing",
  Expired = "expired",
  Revoked = "revoked",
}

export type ReviewRunAuthorizationTokenResolution =
  | {
      readonly status: ReviewRunAuthorizationTokenResolutionStatus.Valid;
      readonly authorization: ReviewRunAuthorization;
    }
  | {
      readonly status:
        | ReviewRunAuthorizationTokenResolutionStatus.Invalid
        | ReviewRunAuthorizationTokenResolutionStatus.ClaimDrift
        | ReviewRunAuthorizationTokenResolutionStatus.Missing
        | ReviewRunAuthorizationTokenResolutionStatus.Expired
        | ReviewRunAuthorizationTokenResolutionStatus.Revoked;
    };

export class ManageReviewRunAuthorizations {
  constructor(
    private readonly dependencies: {
      readonly runtimeSnapshots?: ReviewRunRuntimeSnapshotPort;
      readonly skillsSnapshots?: ReviewRunSkillsSnapshotPort;
      readonly clock: ClockPort;
      readonly identifiers: IdentifierFactoryPort;
      readonly digest: Sha256DigestPort;
      readonly identities: ScmRepositoryIdentityQueryPort;
      readonly authorities: ReviewMutationAuthorityQueryPort;
      readonly releases: ProducerReleaseQueryPort;
      readonly limits: ReviewProtocolLimitsProfileQueryPort;
      readonly slos: ReviewOperationalSloProfileQueryPort;
      readonly safetyDecisions: ReviewSafetyDecisionResolverPort;
      readonly authorizationQueries: ReviewRunAuthorizationQueryPort;
      readonly authorizationCommands: ReviewRunAuthorizationCommandPort &
        ReviewRunAuthorizationAdmissionCommandPort;
      readonly tokens: ReviewRunAuthorizationTokenPort;
    },
  ) {}

  async authorizeReviewRun(input: {
    readonly verifiedIdentity: VerifiedScmRunIdentity;
    readonly modelTransport?: ReviewAgentProfile["modelTransports"][number];
    readonly providerApiAuthMode?: ProviderApiAuthMode;
    readonly subscriptionAuthMode?: "claude-oauth";
    readonly producerReleaseId: string;
    readonly expectedBaseProducerRelease?: ProducerRelease;
    readonly protocolOfferHash: string;
    readonly oidcReplayKeyHash: string;
    readonly providerVoteLanes: readonly ProviderVoteLane[];
    readonly reviewInvestigationAuthorizationDescriptorCanonicalJson?:
      | string
      | null;
    readonly authorizationTtlMs: number;
    readonly maxAuthorizationLifetimeMs: number;
  }): Promise<ReviewRunAuthorizationUseCaseResult> {
    if (this.dependencies.runtimeSnapshots && !input.modelTransport)
      return denied(ReviewRunAuthorizationDenialReason.AdmissionFactsChanged);
    assertPositiveInteger(input.authorizationTtlMs, "authorization_ttl_ms");
    assertPositiveInteger(
      input.maxAuthorizationLifetimeMs,
      "max_authorization_lifetime_ms",
    );
    const verifiedIdentity = snapshotVerifiedIdentity(input.verifiedIdentity);
    let original = this.dependencies.runtimeSnapshots
      ? await this.dependencies.authorizationQueries.findReviewRunAuthorizationForAdmission?.(
          {
            workspaceId: verifiedIdentity.workspaceId,
            repositoryConnectionId: verifiedIdentity.repositoryConnectionId,
            scmRepositoryIdentityId: verifiedIdentity.scmRepositoryIdentityId,
            sourceRunId: verifiedIdentity.sourceRunId,
            sourceRunAttempt: verifiedIdentity.sourceRunAttempt,
            protocolOfferHash: input.protocolOfferHash,
          },
        )
      : null;
    // §4.1.1 admission order: trusted repository/producer/protocol eligibility
    // first; the captured engine selects the authorized vote lane; provider
    // safety runs against that lane only, after the engine is known.
    const base = await this.loadBaseEligibility(
      verifiedIdentity,
      input.producerReleaseId,
    );
    if ("denied" in base) {
      return denied(base.denied);
    }
    const now = this.dependencies.clock.now();
    let maxExpiresAt = new Date(
      now.getTime() + input.maxAuthorizationLifetimeMs,
    );
    let expiresAt = new Date(
      Math.min(
        now.getTime() + input.authorizationTtlMs,
        maxExpiresAt.getTime(),
      ),
    );
    // Restore before settings/binding selection. A racing winner is restored again
    // by the atomic repository; only its snapshot is checked/returned below.
    let runtimeSnapshotCanonicalJson =
      original?.runtimeSnapshotCanonicalJson ?? null;
    let skillsSnapshotCanonicalJson =
      original?.skillsSnapshotCanonicalJson ?? null;
    let reviewInvestigationDescriptorCanonicalJson =
      input.reviewInvestigationAuthorizationDescriptorCanonicalJson ?? null;
    let providerVoteLanes: readonly ProviderVoteLane[];
    if (original) {
      // An original admission for the same run/attempt keeps its captured
      // snapshot AND lanes; current settings never re-select the engine.
      providerVoteLanes = original.providerVoteLanes;
    } else if (this.dependencies.runtimeSnapshots) {
      // Signed capabilities encode whole seconds. Select the bounded deadline
      // before capture so the frozen intent never promises a later instant.
      const gatewayMaxExpiresAt = new Date(
        Math.floor(maxExpiresAt.getTime() / 1000) * 1000,
      );
      const captured = await this.dependencies.runtimeSnapshots.capture({
        identity: verifiedIdentity,
        modelTransport: input.modelTransport!,
        ...(input.providerApiAuthMode
          ? { providerApiAuthMode: input.providerApiAuthMode }
          : {}),
        ...(input.subscriptionAuthMode
          ? { subscriptionAuthMode: input.subscriptionAuthMode }
          : {}),
        producerRelease: base.release,
        deadline:
          gatewayMaxExpiresAt > now ? gatewayMaxExpiresAt : maxExpiresAt,
      });
      if (captured === null)
        return denied(ReviewRunAuthorizationDenialReason.AdmissionFactsChanged);
      if ("captureDenied" in captured)
        return denied(captureDenialReason(captured));
      runtimeSnapshotCanonicalJson = canonicalJson(captured);
      const snapshot = parseReviewRunRuntimeSnapshot(
        runtimeSnapshotCanonicalJson,
      );
      if (!snapshot)
        return denied(ReviewRunAuthorizationDenialReason.AdmissionFactsChanged);
      // The engine comes ONLY from the captured snapshot. The backend provider
      // row kind never selects it, and a passed Codex safety check never
      // authorizes another engine.
      const executionKind = reviewAgentExecutionProviderKind(snapshot.agent);
      const matched = input.providerVoteLanes.filter(
        (lane) => lane.providerKind === executionKind,
      );
      // The server-owned lanes are an allowlist of identities: exactly one lane
      // of the captured execution kind. Missing/duplicate lanes fail before any
      // inference; never authorize Codex and OCR from one snapshot.
      if (matched.length !== 1)
        return denied(
          ReviewRunAuthorizationDenialReason.ProviderVoteLaneUnavailable,
        );
      providerVoteLanes = matched;
      // §4.1.1 step 5: bind the optional RR investigation descriptor to the
      // SELECTED lane only. The precomputed capability is participation
      // eligibility: for the OCR lane it is ABSENT (stored null) — the leftover
      // Codex capability is dropped, never rejected. Only a descriptor that is
      // not recognizable optional participation eligibility (a mandatory
      // investigation policy demand) is rejected per §4.2 instead of being
      // weakened into a silent success.
      const investigation =
        bindReviewInvestigationAuthorizationDescriptorToVoteLanes(
          input.reviewInvestigationAuthorizationDescriptorCanonicalJson,
          providerVoteLanes,
        );
      if (!investigation.bound)
        return denied(
          ReviewRunAuthorizationDenialReason.ReviewInvestigationIncompatible,
        );
      reviewInvestigationDescriptorCanonicalJson = investigation.canonicalJson;
      if (snapshot.gateway?.limits) {
        if (gatewayMaxExpiresAt <= now)
          return denied(
            ReviewRunAuthorizationDenialReason.AdmissionFactsChanged,
          );
        maxExpiresAt = gatewayMaxExpiresAt;
        if (snapshot.deadline !== maxExpiresAt.toISOString())
          return denied(
            ReviewRunAuthorizationDenialReason.AdmissionFactsChanged,
          );
        // One gateway capability covers the original server-approved run. The
        // signed token and persisted row must agree through that deadline; the
        // ordinary renewable TTL still applies to other admissions. Restores
        // retain the original row and never acquire a later deadline here.
        expiresAt = maxExpiresAt;
      } else {
        // Ordinary TTL admissions retain their original millisecond maximum.
        runtimeSnapshotCanonicalJson = canonicalJson({
          ...captured,
          deadline: maxExpiresAt.toISOString(),
        });
      }
    } else {
      // No captured engine exists on this path. An OCR lane can only become
      // authorized from a captured OCR engine, never from the allowlist alone.
      if (
        input.providerVoteLanes.some(
          (lane) => lane.providerKind === ReviewProviderKind.Ocr,
        )
      )
        return denied(
          ReviewRunAuthorizationDenialReason.ProviderVoteLaneUnavailable,
        );
      providerVoteLanes = input.providerVoteLanes;
    }
    if (!original && this.dependencies.skillsSnapshots) {
      const selectedRuntime = parseReviewRunRuntimeSnapshot(
        runtimeSnapshotCanonicalJson,
      );
      const captured = await this.dependencies.skillsSnapshots.capture({
        identity: verifiedIdentity,
        agent: selectedRuntime?.agent ?? null,
      });
      if ("captureDenied" in captured) {
        // A concurrent winner may have committed after our original lookup.
        // Its immutable input survives a later grant/configuration change.
        const winner =
          await this.dependencies.authorizationQueries.findReviewRunAuthorizationForAdmission?.(
            {
              workspaceId: verifiedIdentity.workspaceId,
              repositoryConnectionId: verifiedIdentity.repositoryConnectionId,
              scmRepositoryIdentityId: verifiedIdentity.scmRepositoryIdentityId,
              sourceRunId: verifiedIdentity.sourceRunId,
              sourceRunAttempt: verifiedIdentity.sourceRunAttempt,
              protocolOfferHash: input.protocolOfferHash,
            },
          );
        if (!winner) {
          const reasons = {
            skills_unavailable:
              ReviewRunAuthorizationDenialReason.SkillsUnavailable,
            skills_engine_unsupported:
              ReviewRunAuthorizationDenialReason.SkillsEngineUnsupported,
            skills_limits_exceeded:
              ReviewRunAuthorizationDenialReason.SkillsLimitsExceeded,
          } as const;
          return denied(reasons[captured.captureDenied]);
        }
        original = winner;
        runtimeSnapshotCanonicalJson =
          winner.runtimeSnapshotCanonicalJson ?? null;
        skillsSnapshotCanonicalJson =
          winner.skillsSnapshotCanonicalJson ?? null;
        providerVoteLanes = winner.providerVoteLanes;
        reviewInvestigationDescriptorCanonicalJson =
          winner.reviewInvestigationAuthorizationDescriptorCanonicalJson;
        maxExpiresAt = winner.maxExpiresAt;
        expiresAt = new Date(
          Math.min(expiresAt.getTime(), maxExpiresAt.getTime()),
        );
      } else {
        skillsSnapshotCanonicalJson = captured.canonicalJson;
      }
    }
    // Provider/task safety checks and the fence target now follow the selected
    // lane (OCR safety target, not a leftover Codex capability).
    const safety = await this.resolveAuthorizationSafety(
      verifiedIdentity,
      providerVoteLanes,
    );
    if (!safety.effectAllowed) {
      return denied(ReviewRunAuthorizationDenialReason.SafetyDecisionDisabled);
    }
    const eligibility = { ...base, safety };
    const tokenProfile = this.dependencies.tokens.profile();
    const write =
      await this.dependencies.authorizationCommands.createOrRestoreReviewRunAuthorizationAtomically(
        {
          candidate: {
            ...verifiedIdentity,
            runtimeSnapshotCanonicalJson,
            skillsSnapshotCanonicalJson,
            authorizationId: this.dependencies.identifiers.nextId(
              "review_run_authorization",
            ),
            producerReleaseId: eligibility.release.producerReleaseId,
            selectedProtocolVersion: ReviewProtocolVersion.V2,
            schemaDigest: eligibility.release.schemaDigest,
            protocolLimitsProfileId:
              eligibility.release.protocolLimitsProfileId,
            operationalSloProfileId:
              eligibility.release.operationalSloProfileId,
            mutationEpoch: eligibility.authority.epoch,
            providerVoteLanes,
            reviewInvestigationAuthorizationDescriptorCanonicalJson:
              reviewInvestigationDescriptorCanonicalJson,
            authorizationSafetyDecisionHash:
              eligibility.safety.safetyDecisionHash,
            protocolOfferHash: input.protocolOfferHash,
            oidcReplayKeyHash: input.oidcReplayKeyHash,
            tokenSigningKeyId: await this.dependencies.tokens.activeKeyId(),
            tokenIssuer: tokenProfile.issuer,
            tokenAudience: tokenProfile.audience,
            expiresAt,
            maxExpiresAt: original?.maxExpiresAt ?? maxExpiresAt,
            createdAt: now,
          },
          fence: {
            repositoryIdentityVersion: eligibility.repository.version,
            mutationAuthorityVersion: eligibility.authority.version,
            producerRelease: eligibility.release,
            ...(input.expectedBaseProducerRelease
              ? {
                  expectedBaseProducerRelease:
                    input.expectedBaseProducerRelease,
                }
              : {}),
            protocolLimitsDigest: eligibility.limits.limitsDigest,
            operationalSloDigest: eligibility.slo.sloDigest,
            safetySnapshot: eligibility.safety,
            safetyTarget: {
              workspaceId: verifiedIdentity.workspaceId,
              repositoryConnectionId: verifiedIdentity.repositoryConnectionId,
              scmRepositoryIdentityId: verifiedIdentity.scmRepositoryIdentityId,
              providerTasks: providerVoteLanes.map((lane) => ({
                providerKind: lane.providerKind,
                taskKind: ReviewTaskKind.CodeReview,
              })),
            },
          },
        },
      );
    if (!write.authorization) {
      if (
        write.status === ReviewRunAuthorizationCreateStatus.EligibilityChanged
      ) {
        return denied(ReviewRunAuthorizationDenialReason.AdmissionFactsChanged);
      }
      return { status: ReviewRunAuthorizationUseCaseStatus.Conflict };
    }
    if (write.authorization.state === ReviewRunAuthorizationState.Expired) {
      return { status: ReviewRunAuthorizationUseCaseStatus.Expired };
    }
    if (write.authorization.state === ReviewRunAuthorizationState.Revoked) {
      return { status: ReviewRunAuthorizationUseCaseStatus.Revoked };
    }
    const issuedAt = this.dependencies.clock.now();
    if (write.authorization.expiresAt <= issuedAt) {
      await this.dependencies.authorizationCommands.terminateReviewRunAuthorization(
        {
          authorizationId: write.authorization.authorizationId,
          expectedVersion: write.authorization.version,
          state: ReviewRunAuthorizationState.Expired,
          at: issuedAt,
        },
      );
      return { status: ReviewRunAuthorizationUseCaseStatus.Expired };
    }
    if (!(await this.runtimeSnapshotIsLive(write.authorization, issuedAt))) {
      return denied(ReviewRunAuthorizationDenialReason.AdmissionFactsChanged);
    }
    return {
      status:
        write.status === ReviewRunAuthorizationCreateStatus.Created
          ? ReviewRunAuthorizationUseCaseStatus.Authorized
          : ReviewRunAuthorizationUseCaseStatus.Restored,
      authorization: write.authorization,
      token: await this.dependencies.tokens.issue(write.authorization),
      protocolLimits: eligibility.limits,
    };
  }

  async renewReviewRunAuthorization(input: {
    readonly authorizationId: string;
    readonly verifiedIdentity: VerifiedScmRunIdentity;
    readonly renewalReplayKeyHash: string;
    readonly requestedTtlMs: number;
  }): Promise<ReviewRunAuthorizationUseCaseResult> {
    assertPositiveInteger(input.requestedTtlMs, "requested_ttl_ms");
    const authorization =
      await this.dependencies.authorizationQueries.findReviewRunAuthorizationById(
        input.authorizationId,
      );
    if (!authorization) {
      return { status: ReviewRunAuthorizationUseCaseStatus.Missing };
    }
    if (authorization.state === ReviewRunAuthorizationState.Revoked) {
      return { status: ReviewRunAuthorizationUseCaseStatus.Revoked };
    }
    const now = this.dependencies.clock.now();
    if (
      authorization.state === ReviewRunAuthorizationState.Expired ||
      now >= authorization.expiresAt
    ) {
      if (authorization.state === ReviewRunAuthorizationState.Active) {
        await this.dependencies.authorizationCommands.terminateReviewRunAuthorization(
          {
            authorizationId: authorization.authorizationId,
            expectedVersion: authorization.version,
            state: ReviewRunAuthorizationState.Expired,
            at: now,
          },
        );
      }
      return { status: ReviewRunAuthorizationUseCaseStatus.Expired };
    }
    if (!verifiedIdentityMatches(authorization, input.verifiedIdentity)) {
      return denied(ReviewRunAuthorizationDenialReason.VerifiedIdentityDrift);
    }
    if (!(await this.runtimeSnapshotIsLive(authorization, now))) {
      return denied(ReviewRunAuthorizationDenialReason.AdmissionFactsChanged);
    }
    let eligibility = await this.loadEligibility(
      input.verifiedIdentity,
      authorization.producerReleaseId,
      authorization.providerVoteLanes,
    );
    if ("denied" in eligibility) {
      return denied(eligibility.denied);
    }
    if (eligibility.authority.epoch !== authorization.mutationEpoch) {
      return denied(ReviewRunAuthorizationDenialReason.SafetyDecisionChanged);
    }
    if (
      eligibility.safety.safetyDecisionHash !==
      authorization.authorizationSafetyDecisionHash
    ) {
      const confirmed = await this.confirmRenewalFence({
        identity: input.verifiedIdentity,
        producerReleaseId: authorization.producerReleaseId,
        providerVoteLanes: authorization.providerVoteLanes,
        expectedMutationEpoch: authorization.mutationEpoch,
        expectedSafetyDecisionHash:
          authorization.authorizationSafetyDecisionHash,
      });
      if ("denied" in confirmed) {
        return denied(confirmed.denied);
      }
      eligibility = confirmed;
    }
    const expiresAt = new Date(
      Math.min(
        now.getTime() + input.requestedTtlMs,
        authorization.maxExpiresAt.getTime(),
      ),
    );
    const renewalProofHash = await this.dependencies.digest.digestUtf8(
      canonicalJson({
        authorizationId: authorization.authorizationId,
        verifiedIdentity: input.verifiedIdentity,
        renewalReplayKeyHash: input.renewalReplayKeyHash,
        requestedTtlMs: input.requestedTtlMs,
      }),
    );
    const write =
      await this.dependencies.authorizationCommands.renewReviewRunAuthorization(
        {
          authorizationId: authorization.authorizationId,
          expectedVersion: authorization.version,
          renewalReplayKeyHash: input.renewalReplayKeyHash,
          renewalProofHash,
          renewedAt: now,
          expiresAt,
        },
      );
    if (!write.authorization) {
      return {
        status:
          write.status === ReviewRunAuthorizationRenewStatus.Missing
            ? ReviewRunAuthorizationUseCaseStatus.Missing
            : ReviewRunAuthorizationUseCaseStatus.Conflict,
      };
    }
    if (
      write.authorization.runtimeSnapshotCanonicalJson &&
      (write.authorization.state !== ReviewRunAuthorizationState.Active ||
        !(await this.runtimeSnapshotIsLive(
          write.authorization,
          this.dependencies.clock.now(),
        )))
    ) {
      return denied(ReviewRunAuthorizationDenialReason.AdmissionFactsChanged);
    }
    return {
      status:
        write.status === ReviewRunAuthorizationRenewStatus.Renewed
          ? ReviewRunAuthorizationUseCaseStatus.Renewed
          : ReviewRunAuthorizationUseCaseStatus.Restored,
      authorization: write.authorization,
      token: await this.dependencies.tokens.issue(write.authorization),
      protocolLimits: eligibility.limits,
    };
  }

  async expireOrRevokeReviewRunAuthorization(input: {
    readonly authorizationId: string;
    readonly state:
      | ReviewRunAuthorizationState.Expired
      | ReviewRunAuthorizationState.Revoked;
  }) {
    const authorization =
      await this.dependencies.authorizationQueries.findReviewRunAuthorizationById(
        input.authorizationId,
      );
    if (!authorization) {
      return {
        status: ReviewRunAuthorizationTerminateStatus.Missing,
      } as const;
    }
    return this.dependencies.authorizationCommands.terminateReviewRunAuthorization(
      {
        authorizationId: authorization.authorizationId,
        expectedVersion: authorization.version,
        state: input.state,
        at: this.dependencies.clock.now(),
      },
    );
  }

  async resolveReviewRunAuthorizationToken(input: {
    readonly token: string;
  }): Promise<ReviewRunAuthorizationTokenResolution> {
    const now = this.dependencies.clock.now();
    let token: VerifiedReviewRunAuthorizationToken;
    try {
      token = await this.dependencies.tokens.verify({
        token: input.token,
        now,
      });
    } catch {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.Invalid };
    }
    return this.resolveVerifiedClaims(token, now);
  }

  private async resolveVerifiedClaims(
    token: VerifiedReviewRunAuthorizationToken,
    now: Date,
  ): Promise<ReviewRunAuthorizationTokenResolution> {
    const authorization =
      await this.dependencies.authorizationQueries.findReviewRunAuthorizationById(
        token.authorizationId,
      );
    if (!authorization) {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.Missing };
    }
    if (authorization.state === ReviewRunAuthorizationState.Revoked) {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.Revoked };
    }
    if (
      authorization.state === ReviewRunAuthorizationState.Expired ||
      now >= authorization.expiresAt
    ) {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.Expired };
    }
    if (!(await this.tokenClaimsMatchAuthorization(token, authorization))) {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.ClaimDrift };
    }
    const live = await this.runtimeSnapshotIsLive(authorization, now);
    const resolvedAt = this.dependencies.clock.now();
    const snapshot = parseReviewRunRuntimeSnapshot(
      authorization.runtimeSnapshotCanonicalJson,
    );
    // The actual binding read can finish after a shorter token/renewal TTL.
    // Use fresh time at every expiry boundary before returning valid.
    if (
      resolvedAt >= token.expiresAt ||
      resolvedAt >= authorization.expiresAt ||
      resolvedAt >= authorization.maxExpiresAt ||
      (snapshot && resolvedAt >= new Date(snapshot.deadline))
    ) {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.Expired };
    }
    if (!live) {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.Revoked };
    }
    return {
      status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
      authorization,
    };
  }

  /** Internal preflight only: the future producer must recheck a locked DB view.
   * Uses the current application clock; does not reverify historical credentials.
   */
  async resolveVerifiedReviewRunAuthorizationToken(input: {
    readonly token: string;
  }): Promise<VerifiedReviewRunAuthorizationTokenResolution> {
    const now = this.dependencies.clock.now();
    let token: VerifiedReviewRunAuthorizationTokenWithMetadata;
    try {
      if (!this.dependencies.tokens.verifyWithMetadata) {
        return { status: ReviewRunAuthorizationTokenResolutionStatus.Invalid };
      }
      token = await this.dependencies.tokens.verifyWithMetadata({
        token: input.token,
        now,
      });
    } catch {
      return { status: ReviewRunAuthorizationTokenResolutionStatus.Invalid };
    }
    const resolution = await this.resolveVerifiedClaims(token, now);
    return resolution.status ===
      ReviewRunAuthorizationTokenResolutionStatus.Valid
      ? { ...resolution, verifiedToken: token }
      : resolution;
  }

  private async runtimeSnapshotIsLive(
    authorization: ReviewRunAuthorization,
    now: Date,
  ): Promise<boolean> {
    const snapshot = parseReviewRunRuntimeSnapshot(
      authorization.runtimeSnapshotCanonicalJson,
    );
    if (!snapshot) return true;
    if (now >= new Date(snapshot.deadline)) return false;
    if (!snapshot.gateway) return true;
    const live =
      (await this.dependencies.runtimeSnapshots?.isLive({
        snapshot,
        identity: authorization,
        now,
      })) ?? false;
    // Binding/config reads can cross the original deadline; never extend it.
    return live && this.dependencies.clock.now() < new Date(snapshot.deadline);
  }

  private async loadEligibility(
    identity: VerifiedScmRunIdentity,
    producerReleaseId: string,
    providerVoteLanes: readonly ProviderVoteLane[],
  ): Promise<ReviewRunAuthorizationEligibilityResult> {
    const base = await this.loadBaseEligibility(identity, producerReleaseId);
    if ("denied" in base) return base;
    const safety = await this.resolveAuthorizationSafety(
      identity,
      providerVoteLanes,
    );
    if (!safety.effectAllowed) {
      return {
        denied: ReviewRunAuthorizationDenialReason.SafetyDecisionDisabled,
      } as const;
    }
    return {
      repository: base.repository,
      authority: base.authority,
      release: base.release,
      limits: base.limits,
      slo: base.slo,
      safety,
    } as const;
  }

  /** Trusted repository/producer/protocol eligibility without provider safety:
   * a passed Codex safety check must never authorize another engine, so the
   * provider/task safety decision is resolved only after engine/lane selection.
   */
  private async loadBaseEligibility(
    identity: VerifiedScmRunIdentity,
    producerReleaseId: string,
  ): Promise<ReviewRunAuthorizationBaseEligibilityResult> {
    const [repository, authority, release] = await Promise.all([
      this.dependencies.identities.findScmRepositoryIdentityById(
        identity.scmRepositoryIdentityId,
      ),
      this.dependencies.authorities.findReviewMutationAuthority({
        scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
        laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
      }),
      this.dependencies.releases.findProducerReleaseById(producerReleaseId),
    ]);
    if (
      !repository ||
      repository.currentWorkspaceId !== identity.workspaceId ||
      repository.currentRepositoryConnectionId !==
        identity.repositoryConnectionId
    ) {
      return {
        denied: ReviewRunAuthorizationDenialReason.RepositoryBindingMismatch,
      } as const;
    }
    if (!authority || authority.mode !== ReviewMutationMode.V2Active) {
      return {
        denied: ReviewRunAuthorizationDenialReason.MutationAuthorityUnavailable,
      } as const;
    }
    if (!release || release.state !== ProducerReleaseState.Registered) {
      return {
        denied: ReviewRunAuthorizationDenialReason.ProducerReleaseUnavailable,
      } as const;
    }
    const [limits, slo] = await Promise.all([
      this.dependencies.limits.findProtocolLimitsProfileById(
        release.protocolLimitsProfileId,
      ),
      this.dependencies.slos.findOperationalSloProfileById(
        release.operationalSloProfileId,
      ),
    ]);
    if (!limits || !slo) {
      return {
        denied: ReviewRunAuthorizationDenialReason.ReleaseProfileUnavailable,
      } as const;
    }
    return { repository, authority, release, limits, slo } as const;
  }

  private async resolveAuthorizationSafety(
    identity: VerifiedScmRunIdentity,
    providerVoteLanes: readonly ProviderVoteLane[],
  ): Promise<ReviewSafetyPolicySnapshot> {
    return this.dependencies.safetyDecisions.resolveReviewSafetyPolicy({
      decisionKind: ReviewSafetyDecisionKind.RunAuthorization,
      target: {
        workspaceId: identity.workspaceId,
        repositoryConnectionId: identity.repositoryConnectionId,
        scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
        providerTasks: providerVoteLanes.map((lane) => ({
          providerKind: lane.providerKind,
          taskKind: ReviewTaskKind.CodeReview,
        })),
      },
    });
  }

  private async confirmRenewalFence(input: {
    readonly identity: VerifiedScmRunIdentity;
    readonly producerReleaseId: string;
    readonly providerVoteLanes: readonly ProviderVoteLane[];
    readonly expectedMutationEpoch: bigint;
    readonly expectedSafetyDecisionHash: string;
  }): Promise<ReviewRunAuthorizationEligibilityResult> {
    for (
      let confirmationRead = 0;
      confirmationRead < 2;
      confirmationRead += 1
    ) {
      const confirmation = await this.loadEligibility(
        input.identity,
        input.producerReleaseId,
        input.providerVoteLanes,
      );
      if ("denied" in confirmation) {
        return confirmation;
      }
      if (
        confirmation.authority.epoch !== input.expectedMutationEpoch ||
        confirmation.safety.safetyDecisionHash !==
          input.expectedSafetyDecisionHash
      ) {
        return {
          denied: ReviewRunAuthorizationDenialReason.SafetyDecisionChanged,
        } as const;
      }
      if (confirmationRead === 1) {
        return confirmation;
      }
    }
    throw new Error("review_run_authorization_fence_confirmation_unreachable");
  }

  private async tokenClaimsMatchAuthorization(
    token: VerifiedReviewRunAuthorizationToken,
    authorization: ReviewRunAuthorization,
  ): Promise<boolean> {
    const scopeHash = await this.dependencies.digest.digestUtf8(
      canonicalJson({
        workspaceId: authorization.workspaceId,
        repositoryConnectionId: authorization.repositoryConnectionId,
        scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
        pullRequestNumber: authorization.pullRequestNumber,
      }),
    );
    return tokenClaimsMatchAuthorization(token, authorization, scopeHash);
  }
}

function verifiedIdentityMatches(
  authorization: ReviewRunAuthorization,
  identity: VerifiedScmRunIdentity,
): boolean {
  return (
    authorization.workspaceId === identity.workspaceId &&
    authorization.repositoryConnectionId === identity.repositoryConnectionId &&
    authorization.scmRepositoryIdentityId ===
      identity.scmRepositoryIdentityId &&
    authorization.pullRequestNumber === identity.pullRequestNumber &&
    authorization.sourceRunId === identity.sourceRunId &&
    authorization.sourceRunAttempt === identity.sourceRunAttempt &&
    authorization.workflowIdentityHash === identity.workflowIdentityHash &&
    authorization.baseSha === identity.baseSha &&
    authorization.mergeBaseSha === identity.mergeBaseSha &&
    authorization.headSha === identity.headSha &&
    authorization.reviewRevisionHash === identity.reviewRevisionHash &&
    authorization.trustDomain === identity.trustDomain
  );
}

function denied(
  reason: ReviewRunAuthorizationDenialReason,
): ReviewRunAuthorizationUseCaseResult {
  return {
    status: ReviewRunAuthorizationUseCaseStatus.Denied,
    reason,
  };
}

/** A refused explicit agent profile is an actionable configuration error at
 * admission; there is never a fallback to another profile.
 */
function captureDenialReason(
  capture: ReviewRunRuntimeCaptureDenial,
): ReviewRunAuthorizationDenialReason {
  switch (capture.captureDenied) {
    case "agent_profile_unavailable":
      return ReviewRunAuthorizationDenialReason.AgentProfileUnavailable;
    case "agent_profile_incompatible":
      return ReviewRunAuthorizationDenialReason.AgentProfileIncompatible;
    case "context_tools_unavailable":
      return ReviewRunAuthorizationDenialReason.ContextToolsUnavailable;
  }
}

export type VerifiedReviewRunAuthorizationTokenResolution =
  | (Extract<
      ReviewRunAuthorizationTokenResolution,
      { status: ReviewRunAuthorizationTokenResolutionStatus.Valid }
    > & {
      readonly verifiedToken: VerifiedReviewRunAuthorizationTokenWithMetadata;
    })
  | Exclude<
      ReviewRunAuthorizationTokenResolution,
      { status: ReviewRunAuthorizationTokenResolutionStatus.Valid }
    >;

export { tokenClaimsMatchAuthorization } from "./token-claims-match-authorization";

function snapshotVerifiedIdentity(
  identity: VerifiedScmRunIdentity,
): VerifiedScmRunIdentity {
  return {
    workspaceId: identity.workspaceId,
    repositoryConnectionId: identity.repositoryConnectionId,
    scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
    pullRequestNumber: identity.pullRequestNumber,
    sourceRunId: identity.sourceRunId,
    sourceRunAttempt: identity.sourceRunAttempt,
    workflowIdentityHash: identity.workflowIdentityHash,
    ...(identity.contextToolGithubSecrets
      ? { contextToolGithubSecrets: { ...identity.contextToolGithubSecrets } }
      : {}),
    trustDomain: identity.trustDomain,
    baseSha: identity.baseSha,
    mergeBaseSha: identity.mergeBaseSha,
    headSha: identity.headSha,
    reviewRevisionHash: identity.reviewRevisionHash,
  };
}
