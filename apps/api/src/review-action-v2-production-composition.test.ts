import { createHash } from "node:crypto";
import * as executionComposition from "./review-action-v2-execution-evidence-composition.js";
import { PrismaProducerReleaseRepository } from "@reviewrouter/features-review-run-control/composition";
import {
  canonicalJson,
  ResolveReviewSafetyPolicy,
  ReviewRunAuthorizationState,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  renderCanonicalReviewPublication,
  resolveReviewPublicationRenderPolicyVersion,
  ReviewPublicationProjectionCoverage,
} from "@reviewrouter/features-review-publishing/v2";
import { Buffer } from "node:buffer";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  reviewActionV2LegacySlot,
  reviewActionV2SupportedContracts,
  reviewActionV2ContractSlot,
  reviewActionV2CanonicalizerDigest,
  reviewActionV2PublishedSchemaDigest,
} from "@reviewrouter/protocol-review-action-v2";
import { ProducerReleaseState } from "@reviewrouter/features-review-run-control";
import { describe, expect, it, vi } from "vitest";
import { createApiApp } from "./app.js";
import {
  reviewActionV2ContextReplayActiveKeyIdEnv,
  reviewActionV2ContextReplayKeysEnv,
  reviewActionV2ContextSessionSecretEnv,
} from "./review-action-v2-context-attestation-composition.js";
import {
  assertReviewIntentRolloutConfiguration,
  composeReviewActionV2ProductionRoutes,
  createTrustedProducerReleaseMaterializer,
  ProductionReviewInvestigationAuthorizationCapability,
  readInvestigationRolloutPolicy,
  reviewActionV2CapabilityActiveKeyIdEnv,
  reviewActionV2CapabilityKeysEnv,
  reviewActionV2ProjectionPolicyVersionEnv,
  reviewActionV2ProviderVoteLanesEnv,
  hostedV4ReadEnabledEnv,
  hostedV4ReadSigningKeyEnv,
  reviewInvestigationContextCriticEnabledEnv,
  reviewInvestigationEmergencyDisabledEnv,
  reviewInvestigationPrivateMaterialActiveKeyIdEnv,
  reviewInvestigationPrivateMaterialKeysEnv,
  reviewInvestigationPrivateMaterialTtlEnv,
  reviewInvestigationMaintenanceEnabledEnv,
  reviewInvestigationLeaseCapabilityActiveKeyIdEnv,
  reviewInvestigationLeaseCapabilityKeysEnv,
  reviewInvestigationProductionEffectsEnabledEnv,
  reviewInvestigationRecordingEnabledEnv,
  reviewInvestigationShadowEnabledEnv,
  reviewInvestigationVerifiedCleanEnabledEnv,
} from "./review-action-v2-production-composition.js";
import {
  InvestigationRolloutCapability,
  InvestigationRolloutDecision,
  InvestigationRolloutProvider,
  evaluateInvestigationRollout,
} from "@reviewrouter/features-review-investigation-operations";
import { investigationRolloutSelectorsEnv } from "@reviewrouter/features-review-investigation-operations/composition";
import { ReviewInvestigationOperationsDiagnosticCode } from "./review-investigation-operations-composition.js";
import { reviewActionV2ProjectionPolicyVersion } from "./review-action-v2-projection-policy.js";
import * as runControlComposition from "./review-action-v2-run-control-composition.js";
import {
  createReviewRequestedIntent,
  decideReviewRequestedAdmission,
  ReviewRequestedIntentState,
  ReviewRequestedTriggerKind,
  ReviewRequestedTransitionStatus,
  ReviewRequestedTransitionDecisionStatus,
  type ReviewRequestedIntent,
} from "@reviewrouter/features-review-executions";
import { PrismaReviewRequestedIntentStore } from "@reviewrouter/features-review-executions/composition";
import { OctokitCodexRotatingGitHubSecretGateway } from "./github/octokit-codex-rotating-github-secret-gateway.js";
import type { GitHubActionsOidcClaims } from "@reviewrouter/features-action-control-plane";

const runtime = {
  readServerTime: async () => new Date("2026-07-23T00:00:00.000Z"),
  createRequestId: () => "request-1",
};

describe("Review Action v2 production composition", () => {
  it("wires the trusted App PR facts and configured cap into real intent admission", async () => {
    const now = new Date();
    let intent: ReviewRequestedIntent = {
      ...createReviewRequestedIntent({
        workspaceId: "workspace_1",
        repositoryConnectionId: "repository_1",
        scmRepositoryIdentityId: "scm_1",
        pullRequestNumber: 42,
        requestId: "request-1",
        revision: {
          baseSha: "b".repeat(40),
          mergeBaseSha: "c".repeat(40),
          headSha: "d".repeat(40),
          reviewRevisionHash: "e".repeat(64),
        },
        triggerKind: ReviewRequestedTriggerKind.ManualCommand,
        deliveryIdentityHash: "f".repeat(64),
        canonicalRequestHash: "1".repeat(64),
        notBefore: now,
        createdAt: now,
        retainUntil: new Date(now.getTime() + 86_400_000),
      }),
      state: ReviewRequestedIntentState.AwaitingAuthorization,
      sourceRunId: "1001",
      sourceRunAttempt: "1",
      resolutionDeadlineAt: new Date(now.getTime() + 300_000),
    };
    const lookup = vi
      .spyOn(
        PrismaReviewRequestedIntentStore.prototype,
        "findByRepositorySourceRunIdentity",
      )
      .mockImplementation(async () => intent);
    const record = vi
      .spyOn(
        PrismaReviewRequestedIntentStore.prototype,
        "recordAdmissionDecision",
      )
      .mockImplementation(async (command) => {
        const decision = decideReviewRequestedAdmission({ intent, ...command });
        if (
          decision.status !== ReviewRequestedTransitionDecisionStatus.Applied &&
          decision.status !== ReviewRequestedTransitionDecisionStatus.Restored
        ) {
          return { status: ReviewRequestedTransitionStatus.Conflict };
        }
        intent = decision.intent;
        return { status: ReviewRequestedTransitionStatus.Applied, intent };
      });
    const pullRequests = vi
      .spyOn(OctokitCodexRotatingGitHubSecretGateway.prototype, "resolve")
      .mockResolvedValue({
        pullRequestNumber: 42,
        headSha: intent.revision.headSha,
        additions: 2,
        deletions: 0,
      });
    const compose = vi.spyOn(
      runControlComposition,
      "composeReviewActionV2RunControlRoutes",
    );
    try {
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        runtime,
        prisma: inertPrisma(),
        env: {
          ...productionEnv(),
          REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED: "1",
          REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "1",
          REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY: "1",
          REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED: "1",
          REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
          REVIEW_ROUTER_HOSTED_MAX_CHANGED_LINES: "1",
        },
      });
      const admissionFacts =
        compose.mock.calls[0]?.[0].handlers?.admissionFacts;
      if (!admissionFacts) throw new Error("test_admission_facts_missing");
      await expect(
        admissionFacts.resolve({
          claims: {
            run_id: "1001",
            run_attempt: "1",
          } as GitHubActionsOidcClaims,
          repository: {
            workspaceId: "workspace_1",
            repositoryId: "repository_1",
            githubRepositoryId: "123",
            githubInstallationId: "456",
            fullName: "777genius/example",
            owner: "777genius",
            selected: true,
            installationStatus: "active",
          },
          scmRepositoryIdentityId: "scm_1",
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        issues: ["review_request_intent_required"],
      });
      expect(pullRequests).toHaveBeenCalledOnce();
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          changedLines: 2,
          maxChangedLines: 1,
          verdict: "rejected",
        }),
      );
      expect(intent.state).toBe(ReviewRequestedIntentState.Terminal);
    } finally {
      lookup.mockRestore();
      record.mockRestore();
      pullRequests.mockRestore();
      compose.mockRestore();
    }
  });
  it("keeps disabled boot inert without Prisma or v2 secrets", async () => {
    expect(
      composeReviewActionV2ProductionRoutes({
        enabled: false,
        env: { REVIEW_ROUTER_REVIEW_V2_MAX_AUTHORIZATION_LIFETIME_MS: "NaN" },
        runtime,
      }),
    ).toEqual({
      hostedV4: { enabled: false },
      hostedV4Relay: { enabled: false },
      runControl: runtime,
      execution: runtime,
      investigation: runtime,
      contextAttestation: runtime,
      evidence: runtime,
      snapshot: runtime,
      publication: runtime,
    });

    const app = await createApiApp({
      reviewRunControlV2Enabled: false,
      reviewActionV2Env: {},
    });
    await app.ready();
    await app.close();
  });

  it.each([
    [undefined, 21600000],
    ["3600000", 3600000],
    ["1", 1],
  ] as const)(
    "wires trusted authorization maximum %s into the real server handler",
    (value, maximum) => {
      const compose = vi.spyOn(
        runControlComposition,
        "composeReviewActionV2RunControlRoutes",
      );
      try {
        const env = {
          ...productionEnv(),
          REVIEW_ROUTER_REVIEW_V2_MAX_AUTHORIZATION_LIFETIME_MS: value,
        };
        const routes = composeReviewActionV2ProductionRoutes({
          enabled: true,
          env,
          runtime,
          prisma: inertPrisma(),
        });
        expect(routes.runControl.authorize?.capabilityEnabled).toBe(true);
        expect(compose.mock.calls[0]?.[0].handlers).toMatchObject({
          maxAuthorizationLifetimeMs: maximum,
          authorizationTtlMs: 3600000,
        });
      } finally {
        compose.mockRestore();
      }
    },
  );

  it.each(["", " ", "NaN", "0", "-1", "1.5", "21600001", "0x10", "1e3"])(
    "rejects invalid trusted authorization maximum %j with a finite error",
    (value) => {
      const env = {
        ...productionEnv(),
        REVIEW_ROUTER_REVIEW_V2_MAX_AUTHORIZATION_LIFETIME_MS: value,
      };
      expect(() =>
        composeReviewActionV2ProductionRoutes({
          enabled: true,
          env,
          runtime,
          prisma: inertPrisma(),
        }),
      ).toThrowError(
        new Error("review_action_v2_max_authorization_lifetime_invalid"),
      );
    },
  );

  it("fails enabled boot before constructing adapters without Prisma", () => {
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: productionEnv(),
        runtime,
      }),
    ).toThrow("review_action_v2_prisma_unavailable");
  });

  it.each([
    "GITHUB_APP_ID",
    "GITHUB_APP_PRIVATE_KEY",
    "REVIEW_ROUTER_PUBLIC_API_URL",
    "REVIEW_ROUTER_ACTION_OIDC_AUDIENCE",
    "REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_ACTIVE_KEY_ID",
    "REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_KEYS_JSON",
    "REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON",
    reviewActionV2ProviderVoteLanesEnv,
    reviewActionV2ProjectionPolicyVersionEnv,
    reviewActionV2CapabilityActiveKeyIdEnv,
    reviewActionV2CapabilityKeysEnv,
    reviewActionV2ContextSessionSecretEnv,
    reviewActionV2ContextReplayActiveKeyIdEnv,
    reviewActionV2ContextReplayKeysEnv,
  ])("fails enabled composition when %s is absent", (name) => {
    const env = { ...productionEnv(), [name]: undefined };
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env,
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow();
  });

  it("rejects malformed repository release bindings at enabled boot", () => {
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: {
          ...productionEnv(),
          REVIEW_ROUTER_REVIEW_V2_REPOSITORY_RELEASE_BINDINGS: "{}",
        },
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow();
  });

  // An enabled v4 route without its own signing key could reuse unrelated credentials.
  it("requires a dedicated key before enabling hosted v4 reads", () => {
    const env = { ...productionEnv(), [hostedV4ReadEnabledEnv]: "1" };
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env,
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow("hosted_v4_read_signing_key_invalid");
    const routes = composeReviewActionV2ProductionRoutes({
      enabled: true,
      env: {
        ...env,
        [hostedV4ReadSigningKeyEnv]: Buffer.alloc(32, 8).toString("base64url"),
      },
      runtime,
      prisma: inertPrisma(),
    });
    expect(routes.hostedV4.enabled).toBe(true);
    // Regression: the v4 read flag must not imply relay grant admission.
    expect(routes.hostedV4Relay.enabled).toBe(false);
    expect(routes.hostedV4Relay.resolver).toBeDefined();
  });

  it("constructs Prisma-backed enabled handlers only with complete production config", () => {
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: {
          ...productionEnv(),
          [reviewInvestigationRecordingEnabledEnv]: "1",
          [reviewInvestigationPrivateMaterialActiveKeyIdEnv]: "private-v1",
          [reviewInvestigationPrivateMaterialKeysEnv]: JSON.stringify({
            "private-v1": Buffer.alloc(32, 7).toString("base64url"),
          }),
        },
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow("investigation_retention_maintenance_required");

    const routes = composeReviewActionV2ProductionRoutes({
      enabled: true,
      env: productionEnv(),
      runtime,
      prisma: inertPrisma(),
    });

    expect(routes.runControl.authorize?.capabilityEnabled).toBe(true);
    expect(routes.hostedV4.enabled).toBe(false);
    expect(routes.hostedV4Relay).toEqual({ enabled: false });
    expect(routes.runControl.renew?.capabilityEnabled).toBe(true);
    expect(routes.execution.start?.capabilityEnabled).toBe(true);
    expect(routes.execution.acquireLease?.capabilityEnabled).toBe(true);
    expect(routes.execution.adoptObservation?.capabilityEnabled).toBe(true);
    expect(routes.execution.finalize?.capabilityEnabled).toBe(true);
    expect(routes.contextAttestation.openGateway?.capabilityEnabled).toBe(true);
    expect(routes.contextAttestation.sealGateway?.capabilityEnabled).toBe(true);
    expect(routes.contextAttestation.commitReplay?.capabilityEnabled).toBe(
      true,
    );
    expect(routes.evidence.lookup?.capabilityEnabled).toBe(true);
    expect(routes.evidence.commit?.capabilityEnabled).toBe(true);
    expect(routes.snapshot.restore?.capabilityEnabled).toBe(true);
    expect(routes.publication.request?.capabilityEnabled).toBe(true);
    expect(routes.publication.status?.capabilityEnabled).toBe(true);
    expect(routes.runControl.readServerTime).toBe(runtime.readServerTime);
  });

  it("requires private-material keys only while investigation recording is enabled", () => {
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: {
          ...productionEnv(),
          [reviewInvestigationPrivateMaterialActiveKeyIdEnv]: "unused-key",
        },
        runtime,
        prisma: inertPrisma(),
      }),
    ).not.toThrow();

    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: {
          ...productionEnv(),
          [reviewInvestigationRecordingEnabledEnv]: "1",
        },
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow("investigation_private_material_configuration_required");

    const routes = composeReviewActionV2ProductionRoutes({
      enabled: true,
      env: {
        ...productionEnv(),
        [reviewInvestigationRecordingEnabledEnv]: "1",
        [reviewInvestigationPrivateMaterialActiveKeyIdEnv]: "private-v1",
        [reviewInvestigationPrivateMaterialKeysEnv]: JSON.stringify({
          "private-v1": Buffer.alloc(32, 7).toString("base64url"),
        }),
        [reviewInvestigationPrivateMaterialTtlEnv]: "300000",
        [reviewInvestigationMaintenanceEnabledEnv]: "1",
      },
      runtime,
      prisma: inertPrisma(),
    });
    expect(routes.investigation.open?.capabilityEnabled).toBe(true);
  });

  it.each([
    reviewInvestigationLeaseCapabilityActiveKeyIdEnv,
    reviewInvestigationLeaseCapabilityKeysEnv,
  ])("requires %s only while investigation recording is enabled", (name) => {
    const dormantEnv = { ...productionEnv(), [name]: undefined };
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: dormantEnv,
        runtime,
        prisma: inertPrisma(),
      }),
    ).not.toThrow();

    const activeEnv = {
      ...productionEnv(),
      [name]: undefined,
      [reviewInvestigationRecordingEnabledEnv]: "1",
      [reviewInvestigationPrivateMaterialActiveKeyIdEnv]: "private-v1",
      [reviewInvestigationPrivateMaterialKeysEnv]: JSON.stringify({
        "private-v1": Buffer.alloc(32, 7).toString("base64url"),
      }),
      [reviewInvestigationPrivateMaterialTtlEnv]: "300000",
      [reviewInvestigationMaintenanceEnabledEnv]: "1",
    };
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: activeEnv,
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow();
  });

  it("rejects a projection policy version that the producer cannot emit", () => {
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: {
          ...productionEnv(),
          [reviewActionV2ProjectionPolicyVersionEnv]: "1",
        },
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow("review_action_v2_projection_policy_version_unsupported");
  });

  it("accepts a supported prior projection policy during a rolling deploy", () => {
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: {
          ...productionEnv(),
          [reviewActionV2ProjectionPolicyVersionEnv]:
            "review-projection-policy.v4-t0",
        },
        runtime,
        prisma: inertPrisma(),
      }),
    ).not.toThrow();
  });

  it("finalizes and renders compatible producer policies while the configured server policy remains v5", async () => {
    const compose = vi.spyOn(
      executionComposition,
      "composeReviewActionV2ExecutionRoutes",
    );
    const release = vi
      .spyOn(
        PrismaProducerReleaseRepository.prototype,
        "findProducerReleaseById",
      )
      .mockResolvedValue({
        producerReleaseId: "release",
        state: ProducerReleaseState.Registered,
      } as never);
    const safety = vi
      .spyOn(ResolveReviewSafetyPolicy.prototype, "resolveReviewSafetyPolicy")
      .mockResolvedValue({
        effectAllowed: true,
        safetyDecisionHash: "a".repeat(64),
      } as never);
    const sha = (text: string) =>
      createHash("sha256").update(text).digest("hex");
    try {
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: {
          ...productionEnv(),
          [reviewActionV2ProjectionPolicyVersionEnv]:
            "review-projection-policy.v5-t0",
        },
        runtime,
        prisma: inertPrisma(),
      });
      const facts = compose.mock.calls[0]![0].handlers!.finalizationFacts;
      const now = new Date("2026-10-22T12:00:00.000Z");
      for (const [schemaDigest, projectionPolicyVersion] of [
        [
          reviewActionV2LegacySlot.reviewActionV2PublishedSchemaDigest,
          "review-projection-policy.v5-t0",
        ],
        [
          reviewActionV2PublishedSchemaDigest,
          "review-projection-policy.v6-comparison",
        ],
        [
          reviewActionV2PublishedSchemaDigest,
          "review-projection-policy.v7-lifecycle-verification",
        ],
      ]) {
        const authorization = {
          authorizationId: "authorization",
          workspaceId: "workspace",
          repositoryConnectionId: "repository",
          scmRepositoryIdentityId: "scm",
          pullRequestNumber: 1,
          producerReleaseId: "release",
          state: ReviewRunAuthorizationState.Active,
          expiresAt: new Date(now.getTime() + 60_000),
          baseSha: "b".repeat(40),
          mergeBaseSha: "c".repeat(40),
          headSha: "d".repeat(40),
          reviewRevisionHash: "e".repeat(64),
          schemaDigest,
        } as ReviewRunAuthorization;
        const revision = {
          baseSha: authorization.baseSha,
          mergeBaseSha: authorization.mergeBaseSha,
          headSha: authorization.headSha,
          reviewRevisionHash: authorization.reviewRevisionHash,
        };
        const publishing = {
          summary: {
            allClear: true,
            body: "No findings",
            marker: "summary",
            occurrenceCounts: {
              new: 0,
              reconfirmed: 0,
              changed: 0,
              carried_unverified: 0,
              resolved: 0,
              uncertain: 0,
              suppressed_by_human: 0,
            },
          },
          check: {
            marker: "check",
            conclusion: "success" as const,
            name: "ReviewRouter",
            title: "Review complete",
            summary: "No findings",
          },
          inlineReviewChunks: [],
          lifecycle: [],
        };
        const projection = {
          envelopeVersion: "review_projection.v1",
          projectionPolicyVersion,
          scope: {
            scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
            pullRequestNumber: 1,
            baseSha: authorization.baseSha,
            reviewedHeadSha: authorization.headSha,
            reviewRevisionHash: authorization.reviewRevisionHash,
          },
          coverage: { state: "complete" },
          lifecycleStateHash: "f".repeat(64),
          commandLedgerWatermark: "0",
          authoritativeObservationIds: [],
          occurrences: [],
          mergeGate: {},
          publishing,
          snapshot: { lineageHints: [] },
        };
        const projectionCanonicalJson = canonicalJson(projection);
        const projectionHash = sha(projectionCanonicalJson);
        const expectedArtifactHash = sha(
          `rr.review-artifact.v1\0${canonicalJson({ operationsCanonicalJson: canonicalJson(publishing), projectionHash })}`,
        );
        const finalization = {
          authorization,
          execution: {
            ...authorization,
            revision,
            workSlots: [],
            retainUntil: new Date(now.getTime() + 120_000),
          } as never,
          observationRefs: [],
          artifactId: `rr:artifact:${expectedArtifactHash}`,
          projectionEnvelopeVersion: 1,
          projectionEnvelope: projection,
          projectionCanonicalJson,
          projectionHash,
          lifecycleStateHash: projection.lifecycleStateHash,
          commandLedgerWatermark: 0n,
          allowPartial: false,
          limits: {
            maxProjectionBytes: 2_000_000,
            maxFindingCount: 2000,
          } as never,
          maxReconciliationDurationMs: 30_000,
          now,
        };
        const resolved = await facts.resolve(finalization);
        if (
          projectionPolicyVersion ===
          "review-projection-policy.v7-lifecycle-verification"
        ) {
          const forged = {
            ...projection,
            mergeGate: {
              blockingConfirmedLifecycleTargetIds: ["unconfirmed-target"],
            },
          };
          await expect(
            facts.resolve({
              ...finalization,
              projectionEnvelope: forged,
              projectionCanonicalJson: canonicalJson(forged),
            }),
          ).rejects.toMatchObject({
            issues: ["projection_verification_blocking_targets_invalid"],
          });
        }
        expect(resolved.projectionPolicyVersion).toBe(projectionPolicyVersion);
        expect(resolved.expectedArtifactHash).toBe(expectedArtifactHash);
        expect(
          renderCanonicalReviewPublication(
            {
              coverage: ReviewPublicationProjectionCoverage.Completed,
              renderPolicyVersion: resolveReviewPublicationRenderPolicyVersion(
                resolved.projectionPolicyVersion,
              ),
              targetCommitId: authorization.headSha,
              occurrenceStates: [],
              source: publishing,
            },
            {
              digestUtf8: sha,
              utf8ByteLength: (value) => Buffer.byteLength(value),
            },
          ).summary.body,
        ).toContain("No findings");
      }
    } finally {
      compose.mockRestore();
      release.mockRestore();
      safety.mockRestore();
    }
  });

  it("rejects malformed capability rotation config without exposing it", () => {
    const env = {
      ...productionEnv(),
      [reviewActionV2CapabilityKeysEnv]: JSON.stringify([
        { keyId: "v2", secretBase64: "short", verifyUntil: null },
      ]),
    };
    expect(() =>
      composeReviewActionV2ProductionRoutes({
        enabled: true,
        env,
        runtime,
        prisma: inertPrisma(),
      }),
    ).toThrow("review_action_v2_capability_key_invalid");
  });

  it("fails closed when intent admission is enabled before ingress dispatch is ready", () => {
    expect(() =>
      assertReviewIntentRolloutConfiguration({
        REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED: "1",
      }),
    ).toThrow("review_action_v2_intent_admission_without_ingress");
    expect(() =>
      assertReviewIntentRolloutConfiguration({
        REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "1",
      }),
    ).toThrow("review_action_v2_intent_ingress_dependencies_unavailable");
    expect(() =>
      assertReviewIntentRolloutConfiguration({
        REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "1",
        REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY: "1",
        REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED: "1",
        REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
      }),
    ).not.toThrow();
  });

  it("validates investigation flag dependencies and emergency rollback", () => {
    expect(() =>
      readInvestigationRolloutPolicy({
        [reviewInvestigationVerifiedCleanEnabledEnv]: "1",
      }),
    ).toThrow("rollout_dependency_missing:verified_clean:context_critic");
    const policy = readInvestigationRolloutPolicy({
      [reviewInvestigationRecordingEnabledEnv]: "1",
      [reviewInvestigationShadowEnabledEnv]: "1",
      [reviewInvestigationContextCriticEnabledEnv]: "1",
      [reviewInvestigationProductionEffectsEnabledEnv]: "1",
      [reviewInvestigationVerifiedCleanEnabledEnv]: "1",
      [reviewInvestigationEmergencyDisabledEnv]: "1",
      [investigationRolloutSelectorsEnv]: JSON.stringify({
        [InvestigationRolloutCapability.ProductionEffects]: [
          { repositoryConnectionIds: ["repository-1"] },
        ],
        [InvestigationRolloutCapability.VerifiedClean]: [
          { repositoryConnectionIds: ["repository-1"] },
        ],
      }),
    });
    expect(
      evaluateInvestigationRollout(
        policy,
        InvestigationRolloutCapability.ProductionEffects,
        {
          workspaceId: "workspace-1",
          repositoryConnectionId: "repository-1",
          scmRepositoryIdentityId: "scm-repository-1",
          provider: InvestigationRolloutProvider.Codex,
          trustDomain: "trusted",
          producerReleaseId: "release-1",
        },
      ),
    ).toBe(InvestigationRolloutDecision.EmergencyDisabled);

    const scoped = readInvestigationRolloutPolicy({
      [reviewInvestigationRecordingEnabledEnv]: "1",
      [reviewInvestigationShadowEnabledEnv]: "1",
      [reviewInvestigationContextCriticEnabledEnv]: "1",
      [reviewInvestigationProductionEffectsEnabledEnv]: "1",
      [investigationRolloutSelectorsEnv]: JSON.stringify({
        [InvestigationRolloutCapability.ProductionEffects]: [
          { repositoryConnectionIds: ["repository-allowed"] },
        ],
      }),
    });
    expect(
      evaluateInvestigationRollout(
        scoped,
        InvestigationRolloutCapability.ProductionEffects,
        {
          workspaceId: "workspace-1",
          repositoryConnectionId: "repository-denied",
          scmRepositoryIdentityId: "scm-repository-1",
          provider: InvestigationRolloutProvider.Codex,
          trustDomain: "trusted",
          producerReleaseId: "release-1",
        },
      ),
    ).toBe(InvestigationRolloutDecision.OutsideCohort);
  });

  it.each(reviewActionV2SupportedContracts())(
    "advertises the exact attested extension for $canonicalizerDigest",
    async (contract) => {
      const extension = reviewActionV2ContractSlot(
        contract.schemaDigest,
        contract.canonicalizerDigest,
      )!.reviewInvestigationExtensionV1;
      const diagnostics = vi.fn();
      const resolveAllowedCapabilitiesForTargets = vi
        .fn()
        .mockResolvedValue([[InvestigationRolloutCapability.Recording]]);
      const capability =
        new ProductionReviewInvestigationAuthorizationCapability(
          {
            resolveAllowedCapabilitiesForTargets,
          },
          { record: diagnostics },
        );

      await expect(
        capability.resolve({
          target: {
            workspaceId: "workspace-1",
            repositoryConnectionId: "repository-1",
            scmRepositoryIdentityId: "scm-repository-1",
            trustDomain: "trusted",
            producerReleaseId: "release-1",
            providerVoteLanes: [{ providerKind: "codex" }],
          } as never,
          protocolContract: contract,
          producerRelease: {
            schemaDigest: contract.schemaDigest,
            reviewInvestigationProfile: {
              capability: "review_investigation_v1",
              coverageProfileHash: "a".repeat(64),
              policyHash: "b".repeat(64),
            },
          } as never,
        }),
      ).resolves.toEqual({
        authorizationDescriptorVersion: 3,
        capability: "review_investigation_v1",
        coverageProfileHash: "a".repeat(64),
        extensionCanonicalizerDigest: extension.canonicalizerDigest,
        extensionId: extension.extensionId,
        extensionSchemaDigest: extension.schemaDigest,
        policyHash: "b".repeat(64),
        providerCapabilities: [
          {
            providerKind: "codex",
            capabilities: [InvestigationRolloutCapability.Recording],
          },
        ],
      });
      expect(resolveAllowedCapabilitiesForTargets).toHaveBeenCalledOnce();
      expect(diagnostics).not.toHaveBeenCalled();
      expect(resolveAllowedCapabilitiesForTargets).toHaveBeenCalledWith({
        targets: [
          expect.objectContaining({
            provider: InvestigationRolloutProvider.Codex,
          }),
        ],
      });
    },
  );

  it.each([
    {
      name: "missing release profile",
      profile: null,
      providerVoteLanes: [{ providerKind: "codex" }],
      rolloutResult: [[InvestigationRolloutCapability.Recording]],
      expected:
        ReviewInvestigationOperationsDiagnosticCode.AuthorizationReleaseProfileMissing,
    },
    {
      name: "unsupported provider",
      profile: {
        capability: "review_investigation_v1",
        coverageProfileHash: "a".repeat(64),
        policyHash: "b".repeat(64),
      },
      providerVoteLanes: [{ providerKind: "openrouter" }],
      rolloutResult: [[InvestigationRolloutCapability.Recording]],
      expected:
        ReviewInvestigationOperationsDiagnosticCode.AuthorizationProviderUnsupported,
    },
    {
      name: "recording not granted",
      profile: {
        capability: "review_investigation_v1",
        coverageProfileHash: "a".repeat(64),
        policyHash: "b".repeat(64),
      },
      providerVoteLanes: [{ providerKind: "codex" }],
      rolloutResult: [[]],
      expected:
        ReviewInvestigationOperationsDiagnosticCode.AuthorizationRecordingNotGranted,
    },
  ])("emits one bounded diagnostic for $name denial", async (testCase) => {
    const diagnostics = vi.fn();
    const resolveAllowedCapabilitiesForTargets = vi
      .fn()
      .mockResolvedValue(testCase.rolloutResult);
    const capability = new ProductionReviewInvestigationAuthorizationCapability(
      { resolveAllowedCapabilitiesForTargets },
      { record: diagnostics },
    );

    await expect(
      capability.resolve({
        target: {
          workspaceId: "workspace-secret",
          repositoryConnectionId: "repository-secret",
          scmRepositoryIdentityId: "scm-secret",
          trustDomain: "trusted",
          producerReleaseId: "release-secret",
          providerVoteLanes: testCase.providerVoteLanes,
        } as never,
        protocolContract: reviewActionV2SupportedContracts()[0]!,
        producerRelease: {
          schemaDigest: reviewActionV2PublishedSchemaDigest,
          reviewInvestigationProfile: testCase.profile,
        } as never,
      }),
    ).resolves.toBeNull();
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith(testCase.expected);
  });

  it("emits one bounded diagnostic when rollout resolution is unavailable", async () => {
    const diagnostics = vi.fn();
    const capability = new ProductionReviewInvestigationAuthorizationCapability(
      {
        resolveAllowedCapabilitiesForTargets: vi
          .fn()
          .mockRejectedValue(new Error("selector with secret identifiers")),
      },
      { record: diagnostics },
    );

    await expect(
      capability.resolve({
        target: {
          workspaceId: "workspace-secret",
          repositoryConnectionId: "repository-secret",
          scmRepositoryIdentityId: "scm-secret",
          trustDomain: "trusted",
          producerReleaseId: "release-secret",
          providerVoteLanes: [{ providerKind: "codex" }],
        } as never,
        protocolContract: reviewActionV2SupportedContracts()[0]!,
        producerRelease: {
          schemaDigest: reviewActionV2PublishedSchemaDigest,
          reviewInvestigationProfile: {
            capability: "review_investigation_v1",
            coverageProfileHash: "a".repeat(64),
            policyHash: "b".repeat(64),
          },
        } as never,
      }),
    ).resolves.toBeNull();
    expect(diagnostics).toHaveBeenCalledOnce();
    expect(diagnostics).toHaveBeenCalledWith(
      ReviewInvestigationOperationsDiagnosticCode.AuthorizationRolloutUnavailable,
    );
  });

  it("does not block authorization when diagnostics never settle", async () => {
    const diagnostics = vi.fn(() => new Promise<void>(() => undefined));
    const capability = new ProductionReviewInvestigationAuthorizationCapability(
      {
        resolveAllowedCapabilitiesForTargets: vi.fn(),
      },
      { record: diagnostics },
    );
    const settled = vi.fn();

    void capability
      .resolve({
        target: {
          workspaceId: "workspace-secret",
          repositoryConnectionId: "repository-secret",
          scmRepositoryIdentityId: "scm-secret",
          trustDomain: "trusted",
          producerReleaseId: "release-secret",
          providerVoteLanes: [{ providerKind: "codex" }],
        } as never,
        protocolContract: reviewActionV2SupportedContracts()[0]!,
        producerRelease: {
          schemaDigest: reviewActionV2PublishedSchemaDigest,
          reviewInvestigationProfile: null,
        } as never,
      })
      .then(settled);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toHaveBeenCalledOnce();
    expect(settled).toHaveBeenCalledWith(null);
    expect(diagnostics).toHaveBeenCalledWith(
      ReviewInvestigationOperationsDiagnosticCode.AuthorizationReleaseProfileMissing,
    );
  });

  it("preserves the investigation profile while materializing a trusted release", async () => {
    const registerProducerRelease = vi.fn().mockResolvedValue({
      status: "created",
      value: {},
    });
    const reviewInvestigationProfile = {
      capability: "review_investigation_v1",
      coverageProfileHash: "a".repeat(64),
      policyHash: "b".repeat(64),
    } as const;
    const agentProfiles = [
      {
        agentKind: "codex",
        binarySha256:
          "cb0a15567e9a60a5820d54b0f6ae86d504dc3805c1eab21a47f70e3eb7b73a40",
        cancellation: true,
        contextGateway: true,
        modelTransports: ["account_gateway"],
        packageVersion: "0.147.0",
        profileRef: "codex-default",
      },
    ] as const;
    const materializer = createTrustedProducerReleaseMaterializer({
      digest: {} as never,
      producerReleases: {
        registerProducerRelease,
      } as never,
      releaseQueries: {
        findProducerReleaseById: vi.fn().mockResolvedValue(null),
      } as never,
      protocolLimitsQueries: {
        findProtocolLimitsProfileById: vi
          .fn()
          .mockResolvedValue({ limitsDigest: "c".repeat(64) }),
      } as never,
      operationalSloQueries: {
        findOperationalSloProfileById: vi
          .fn()
          .mockResolvedValue({ sloDigest: "d".repeat(64) }),
      } as never,
    });

    await materializer.ensureRegistered({
      producerReleaseId: "release-1",
      state: ProducerReleaseState.Registered,
      distributionKind: "public_reusable",
      actionCommitSha: "1".repeat(40),
      runtimeCommitSha: "2".repeat(40),
      wrapperEntrypointDigest: null,
      runtimeEntrypointDigest: "e".repeat(64),
      contextGatewayPolicyVersion: "context-gateway-v4",
      contextGatewayEntrypointDigest: "f".repeat(64),
      schemaDigest: reviewActionV2PublishedSchemaDigest,
      capabilityProfile: "exact_revision_v2",
      protocolLimitsProfileId: "limits-v2",
      operationalSloProfileId: "slo-v2",
      reviewInvestigationProfile,
      agentProfiles,
    } as never);

    expect(registerProducerRelease).toHaveBeenCalledWith({
      candidate: expect.objectContaining({
        reviewInvestigationProfile,
        agentProfiles,
      }),
      expectedProtocolLimitsDigest: "c".repeat(64),
      expectedOperationalSloDigest: "d".repeat(64),
    });
  });

  it("emits sorted provider-specific capability rows and omits denied providers", async () => {
    const resolveAllowedCapabilitiesForTargets = vi.fn(
      async ({
        targets,
      }: {
        targets: readonly { provider: InvestigationRolloutProvider }[];
      }) =>
        targets.map((target) =>
          target.provider === InvestigationRolloutProvider.Codex
            ? [
                InvestigationRolloutCapability.ContextCritic,
                InvestigationRolloutCapability.Recording,
                InvestigationRolloutCapability.Shadow,
              ]
            : [],
        ),
    );
    const capability = new ProductionReviewInvestigationAuthorizationCapability(
      { resolveAllowedCapabilitiesForTargets },
    );

    await expect(
      capability.resolve({
        target: {
          workspaceId: "workspace-1",
          repositoryConnectionId: "repository-1",
          scmRepositoryIdentityId: "scm-repository-1",
          trustDomain: "trusted",
          producerReleaseId: "release-1",
          providerVoteLanes: [
            { providerKind: "codex" },
            { providerKind: "claude_code" },
          ],
        } as never,
        protocolContract: reviewActionV2SupportedContracts()[0]!,
        producerRelease: {
          schemaDigest: reviewActionV2PublishedSchemaDigest,
          reviewInvestigationProfile: {
            capability: "review_investigation_v1",
            coverageProfileHash: "a".repeat(64),
            policyHash: "b".repeat(64),
          },
        } as never,
      }),
    ).resolves.toMatchObject({
      providerCapabilities: [
        {
          providerKind: "codex",
          capabilities: [
            InvestigationRolloutCapability.ContextCritic,
            InvestigationRolloutCapability.Recording,
            InvestigationRolloutCapability.Shadow,
          ],
        },
      ],
    });
    expect(resolveAllowedCapabilitiesForTargets).toHaveBeenCalledOnce();
    expect(resolveAllowedCapabilitiesForTargets).toHaveBeenCalledWith({
      targets: [
        expect.objectContaining({
          provider: InvestigationRolloutProvider.Claude,
        }),
        expect.objectContaining({
          provider: InvestigationRolloutProvider.Codex,
        }),
      ],
    });
  });
});

function productionEnv(): Record<string, string> {
  const actionCommitSha = "a".repeat(40);
  const signingKeys = JSON.stringify([
    {
      keyId: "active-v2",
      secretBase64: Buffer.from("s".repeat(32)).toString("base64"),
      verifyUntil: null,
    },
  ]);
  return {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY:
      "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
    REVIEW_ROUTER_PUBLIC_API_URL: "https://api.reviewrouter.dev",
    REVIEW_ROUTER_ACTION_OIDC_AUDIENCE: "https://api.reviewrouter.dev",
    REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_ACTIVE_KEY_ID: "active-v2",
    REVIEW_ROUTER_REVIEW_RUN_AUTHORIZATION_KEYS_JSON: signingKeys,
    REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON: JSON.stringify([
      {
        producerReleaseId: "public-action-v2",
        distributionKind: "public_reusable",
        actionCommitSha,
        runtimeCommitSha: "b".repeat(40),
        wrapperEntrypointDigest: null,
        runtimeEntrypointDigest: "c".repeat(64),
        contextGatewayPolicyVersion: "review-context-gateway.v1",
        contextGatewayEntrypointDigest: "9".repeat(64),
        schemaDigest: reviewActionV2PublishedSchemaDigest,
        canonicalizerDigest: reviewActionV2CanonicalizerDigest,
        capabilityProfile: "exact_revision_v2",
        protocolLimitsProfileId: "limits-v2",
        operationalSloProfileId: "slo-v2",
      },
    ]),
    [reviewActionV2ProviderVoteLanesEnv]: JSON.stringify([
      {
        providerKind: "codex",
        providerVoteIdentityHash: "d".repeat(64),
      },
    ]),
    [reviewActionV2ProjectionPolicyVersionEnv]:
      reviewActionV2ProjectionPolicyVersion,
    [reviewActionV2CapabilityActiveKeyIdEnv]: "active-v2",
    [reviewActionV2CapabilityKeysEnv]: signingKeys,
    [reviewInvestigationLeaseCapabilityActiveKeyIdEnv]: "shadow-v1",
    [reviewInvestigationLeaseCapabilityKeysEnv]: JSON.stringify([
      {
        keyId: "shadow-v1",
        secretBase64: Buffer.from("i".repeat(32)).toString("base64"),
        verifyUntil: null,
      },
    ]),
    [reviewActionV2ContextSessionSecretEnv]: Buffer.from(
      "h".repeat(32),
    ).toString("base64"),
    [reviewActionV2ContextReplayActiveKeyIdEnv]: "context-v1",
    [reviewActionV2ContextReplayKeysEnv]: JSON.stringify([
      {
        keyId: "context-v1",
        secretBase64: Buffer.from("r".repeat(32)).toString("base64"),
      },
    ]),
  };
}

function inertPrisma(): PrismaClient {
  return {} as PrismaClient;
}
