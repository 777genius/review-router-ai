import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { PrismaProviderAccountRepository } from "../../packages/features/provider-accounts/src/index.js";
import {
  PrismaReviewConfigurationRepository,
  parseReviewConfigurationStrict,
  saveReviewConfiguration,
} from "../../packages/features/review-config/src/index.js";
import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
} from "../../packages/features/review-config/src/tests/current-policy-fixture.js";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
} from "../../packages/features/review-run-control/src/index.js";
import { lifecycleVerificationContract } from "../../packages/shared/src/index.js";
import {
  registerReviewExecutionV2Routes,
  registerReviewEvidenceV2Routes,
  registerReviewSnapshotReadV2Routes,
  registerReviewPublicationRequestV2Routes,
} from "../../packages/features/action-control-plane/src/v2/interface/index.js";
import { PrismaReviewThreadResolutionHistory } from "../../packages/features/review-publishing/src/v2/infrastructure/prisma/prisma-review-thread-resolution-history.js";
import { activateReviewResolutionHistory } from "../../packages/features/review-publishing/src/v2/application/use-cases/activate-review-resolution-history.js";
import { CanonicalReviewV2ProjectionAdapter } from "../../apps/worker/src/review-v2-publication-payloads.js";
import { PrismaReviewExecutionStore } from "../../packages/features/review-executions/src/composition/index.js";
import { registerReviewRunGatewayRelayRoutes } from "../../apps/api/src/review-run-gateway-relay.js";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
  type ReviewActionV2E2EHarness,
} from "../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";
import type { FakeGitHubTransport } from "../review-action-v2-production-e2e/support/fake-github.js";
import { publishedReviewCommentTimestamps } from "./support/review-comment-fixture.js";

const enabled =
  process.env.REVIEW_ROUTER_REVIEW_INVESTIGATION_PAIRED_E2E === "1";
const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const actionSourceDir = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
if (
  enabled &&
  (!databaseUrl || !actionSourceDir || !path.isAbsolute(actionSourceDir))
)
  throw new Error(
    "paired_lifecycle_disposable_database_and_absolute_action_source_required",
  );
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const filePath = "src/review-file-000.ts";
const model = "gpt-5-codex";
// The real relay requires a 16–1024 character run-control bearer.
const lifecycleGatewayFixtureControlBearer = "paired-control-token";
const source = [
  "export function tax(subtotal, rate, exempt, regionalRule) {",
  "  if (subtotal === 0) return 0;",
  "  const safeRate = rate ?? 0.2;",
  "  if (safeRate === 0) return 0;",
  "  if (exempt) return subtotal * safeRate;",
  "  const adjusted = regionalRule(subtotal);",
  "  return Math.round(adjusted * safeRate * 100) / 100;",
  "}",
].join("\n");
const blobOid = createHash("sha1")
  .update(`blob ${Buffer.byteLength(source)}\0`)
  .update(source)
  .digest("hex");
const oldClaims = [
  [
    "Zero subtotal produces division by zero",
    "Dividing by the subtotal yields Infinity for a valid zero subtotal.",
    2,
  ],
  [
    "Zero rate is replaced by the default rate",
    "The zero percent rate is a valid value but an OR fallback charges twenty percent.",
    4,
  ],
  [
    "Exemption still charges tax",
    "The exempt branch multiplies the subtotal by the rate instead of returning zero.",
    5,
  ],
  [
    "Regional caller contract is unavailable",
    "The regionalRule callback contract may reject negative subtotals in a separate caller.",
    6,
  ],
] as const;
type Scenario =
  | "success"
  | "denied"
  | "unknown"
  | "missing_verdict"
  | "invalid_quote"
  | "wrong_packet"
  | "forged_claim";

// Real public modules, signed admission/lease/evidence HTTP, production relay,
// PostgreSQL, worker and GitHub App adapter. The two external boundaries are a
// controlled local Gateway server and synthetic native GitHub observations.
const lifecycleCase = enabled && databaseUrl && actionSourceDir ? it : it.skip;
lifecycleCase.each([
  "success",
  "denied",
  "unknown",
  "missing_verdict",
  "invalid_quote",
  "wrong_packet",
  "forged_claim",
] as const)(
  "pairs bounded lifecycle verification with immutable publication and honest native receipts (%s)",
  async (scenario: Scenario) => {
    await resetReviewActionV2E2EDatabase(databaseUrl!);
    const networkFetch = globalThis.fetch;
    const upstream = await controlledGateway(scenario);
    let fixture: ReviewActionV2E2EHarness | undefined;
    const app = Fastify();
    try {
      fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
        modelTransport: "account_gateway",
        repositoryProviderSelection: "none",
        lifecycleVerificationProfile: true,
        environmentOverrides: {
          REVIEW_ROUTER_REVIEW_V2_PROJECTION_POLICY_VERSION:
            "review-projection-policy.v7-lifecycle-verification",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED: "1",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: upstream.origin,
          REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN: upstream.origin,
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER:
            lifecycleGatewayFixtureControlBearer,
          REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: JSON.stringify({
            profiles: [
              {
                profileRef: "paired-responses-v1",
                limits: {
                  requests: 9,
                  concurrency: 1,
                  requestBytes: 98304,
                  outputBytes: 32768,
                  tokens: 4096,
                },
              },
            ],
          }),
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: JSON.stringify({
            profiles: [
              {
                profile: {
                  profileId: "paired-responses-v1",
                  protocol: "openai-responses",
                  modelIds: [model],
                  authKinds: ["api_key"],
                },
                outputTokens: 4096,
              },
            ],
            ingressBytes: 98304,
            requestTimeoutMs: 60000,
            waitBudgetMs: 0,
            maxWaits: 0,
            maxSessions: 4,
            maxInFlight: 4,
          }),
        },
      });
      const owned = fixture;
      await selectSavedGateway(owned);
      const githubFetch = globalThis.fetch;
      globalThis.fetch = (input, init) =>
        new URL(input instanceof Request ? input.url : String(input)).origin ===
        upstream.origin
          ? networkFetch(input, init)
          : githubFetch(input, init);
      const threads = nativeThreads(owned.fakeGitHub, scenario);
      vi.stubEnv(
        "REVIEW_THREAD_LIFECYCLE_TRUSTED_AUTHORS",
        "reviewrouter-e2e[bot]",
      );
      // Keep failure evidence before the disposable database is reset. This
      // decorator rethrows the original error and never records request data.
      const originalStart = owned.routes.execution.start;
      if (!originalStart) throw new Error("paired_lifecycle_start_required");
      let startOrdinal = 0;
      await registerReviewExecutionV2Routes(app, {
        ...owned.routes.execution,
        recordProtocolRejection: (diagnostic) => {
          console.error("paired_lifecycle_protocol_rejection", {
            operationId: diagnostic.operationId,
            protocolErrorCode: diagnostic.protocolErrorCode,
            statusCode: diagnostic.statusCode,
            internalFailureClass: diagnostic.internalFailureClass,
            internalFailureCode: diagnostic.internalFailureCode,
            internalFailureCauseCode: diagnostic.internalFailureCauseCode,
            internalFailureStage: diagnostic.internalFailureStage,
          });
        },
        start: {
          ...originalStart,
          execute: async (request) => {
            const ordinal = ++startOrdinal;
            try {
              return await originalStart.execute(request);
            } catch (error) {
              let executionPersisted: boolean | "query_failed" = "query_failed";
              try {
                executionPersisted =
                  (await owned.prisma.reviewExecutionV2.findUnique({
                    where: { executionId: request.executionId },
                    select: { executionId: true },
                  })) !== null;
              } catch {
                // Preserve the original failure even if diagnostics cannot read.
              }
              const sourceFrame =
                error instanceof Error
                  ? error.stack
                      ?.split("\n")
                      .filter((line) => /^\s+at /.test(line))
                      .map((line) =>
                        line.match(
                          /((?:apps\/api|packages\/features\/review-executions)\/src\/[A-Za-z0-9_./-]+\.ts):([0-9]+):[0-9]+/,
                        ),
                      )
                      .find((match) => match !== null)
                  : undefined;
              const safeFailureCode =
                error instanceof Error &&
                new Set([
                  "restore_artifact_scope_mismatch",
                  "review_execution_work_slot_count_out_of_bounds",
                  "review_execution_attempt_budget_out_of_bounds",
                  "review_execution_duplicate_work_slot_id",
                  "review_execution_duplicate_work_slot_semantics",
                  "review_execution_invalid_task_kind",
                  "review_execution_invalid_shard_key",
                  "review_execution_invalid_retry_policy_version",
                ]).has(error.message)
                  ? error.message
                  : undefined;
              console.error("paired_lifecycle_start_failure", {
                startOrdinal: ordinal,
                executionPersisted,
                ...(safeFailureCode ? { failureCode: safeFailureCode } : {}),
                ...(sourceFrame
                  ? { sourcePath: sourceFrame[1], sourceLine: sourceFrame[2] }
                  : {}),
              });
              throw error;
            }
          },
        },
      });
      await registerReviewEvidenceV2Routes(app, owned.routes.evidence);
      await registerReviewSnapshotReadV2Routes(app, owned.routes.snapshot);
      await registerReviewPublicationRequestV2Routes(
        app,
        owned.routes.publication,
      );
      if (!owned.routes.accountGatewayRelay)
        throw new Error("paired_lifecycle_real_relay_required");
      await registerReviewRunGatewayRelayRoutes(
        app,
        owned.routes.accountGatewayRelay,
      );
      const load = (relative: string) =>
        import(pathToFileURL(path.join(actionSourceDir!, relative)).href);
      const [
        projectionModule,
        adapterModule,
        clientModule,
        defaultsModule,
        domainModule,
        invocationModule,
        manifestModule,
        normalizerModule,
        verifierModule,
        githubModule,
        inventoryModule,
        ledgerModule,
        planningModule,
      ] = await Promise.all([
        load(
          "src/review-orchestration/infrastructure/production-review-projection.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/review-action-v2-control-plane-adapter.ts",
        ),
        load("src/control-plane/review-action-v2-client.ts"),
        load("src/config/defaults.ts"),
        load("src/review-orchestration/domain/index.ts"),
        load(
          "src/review-orchestration/infrastructure/lifecycle-verification-invocation.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/codex-review-invocation-adapter.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/review-observation-normalizer.ts",
        ),
        load("src/finding-revalidation/index.ts"),
        load("src/github/client.ts"),
        load(
          "src/review-orchestration/infrastructure/github-review-state-adapter.ts",
        ),
        load("src/github/ledger.ts"),
        load(
          "src/review-orchestration/infrastructure/lifecycle-verification-planning.ts",
        ),
      ]);
      const client = new clientModule.ReviewActionV2Client({
        apiUrl: "https://paired.example",
        maxAttempts: 1,
        fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          const response = await app.inject({
            method: request.method as "POST",
            url: new URL(request.url).pathname,
            headers: Object.fromEntries(request.headers),
            payload: await request.text(),
          });
          return new Response(response.body, {
            status: response.statusCode,
            headers: { "content-type": "application/json" },
          });
        },
      });
      const gitHubClient = new githubModule.GitHubClient("paired-read-token", {
        repository: "reviewrouter-e2e/disposable-review-v2",
      });
      const lifecycleInventory =
        new inventoryModule.FreshGitHubLifecycleInventory(
          gitHubClient,
          new ledgerModule.ReviewLedger(gitHubClient, undefined),
        );
      const config = {
        ...defaultsModule.DEFAULT_CONFIG,
        updatePrDescription: false,
        reviewThreadLifecycle: "resolve",
        failOnSeverity: "major",
        inlineMinSeverity: "critical",
        inlineMinAgreement: 1,
      };
      const pr = () => ({
        number: 42,
        title: "Bounded tax revalidation",
        body: "",
        author: "fixture",
        draft: false,
        labels: [],
        files: [
          {
            filename: filePath,
            status: "modified",
            additions: 8,
            deletions: 1,
            changes: 9,
            patch: `@@ -1 +1,8 @@\n-oldTax();\n${source
              .split("\n")
              .map((line) => `+${line}`)
              .join("\n")}`,
          },
        ],
        diff: `diff --git a/${filePath} b/${filePath}\n@@ -1 +1,8 @@\n-oldTax();\n${source
          .split("\n")
          .map((line) => `+${line}`)
          .join("\n")}`,
        additions: 8,
        deletions: 1,
        baseSha: owned.fakeGitHub.revision.baseSha,
        headSha: owned.fakeGitHub.revision.headSha,
      });
      const control = (receipt: unknown) =>
        adapterModule.ReviewActionV2ControlPlaneAdapter.fromFreshAuthorizationReceipt(
          client,
          receipt,
        );
      // No legacy handler was entered in this isolated fixture. Use the actual
      // activation transaction, not hand-written guarded connection fields.
      const history = new PrismaReviewThreadResolutionHistory(owned.prisma);
      expect(
        await activateReviewResolutionHistory(
          {
            workspaceId: owned.workspaceId,
            repositoryConnectionId: owned.repositoryConnectionId,
            scmRepositoryIdentityId: owned.scmRepositoryIdentityId,
            pullRequestNumber: 42,
          },
          {
            activation: history,
            writers: {
              qualify: async () => ({
                status: "qualified",
                proof: {
                  writerDigest: hash("paired-owned-handler-settled"),
                  qualificationSource: "managed_executor_handler_settlement.v1",
                  executors: [
                    {
                      executorId: "paired-owned-app-adapter",
                      binaryDigest: hash("paired-test-executor"),
                      acceptsNewRequests: false,
                      handlerSettlement: "terminal_or_exact_durable_pending",
                    },
                  ],
                },
              }),
            },
          },
        ),
      ).toEqual({ status: "guarded" });
      const activation =
        await owned.prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: owned.repositoryConnectionId },
          select: { lifecycleResolutionActivatedAt: true },
        });
      expect(activation.lifecycleResolutionActivatedAt).not.toBeNull();
      // First ordinary v1 discovery remains valid with the upgraded producer.
      const firstAuth = await owned.authorize({ sourceRunAttempt: "1" });
      const firstNative = adapterModule.projectReviewRunAuthorization(
        firstAuth.result,
      );
      const firstControl = control(firstAuth.result);
      const initialPlan = domainModule.createStableReviewWorkPlan({
        reviewRevisionHash: firstAuth.reviewRevisionHash,
        compatibilityKey: hash("paired-runtime"),
        providers: [
          {
            providerName: "codex",
            providerKind: "codex",
            providerVoteIdentityHash:
              firstNative.facts.providerVoteLanes[0].providerVoteIdentityHash,
            required: true,
            attemptBudget: 1,
            retryPolicyVersion: "paired-once.v1",
          },
        ],
        batches: [
          {
            batchId: "discovery",
            taskKind: "finding_discovery",
            required: true,
            paths: [filePath],
            schedulingOrdinal: 0,
          },
        ],
        eligiblePaths: [filePath],
        uncoveredPaths: [],
        excludedPaths: [],
        maxWorkSlots: 8,
        maxAttemptsPerSlot: 1,
      });
      expect(
        JSON.parse(initialPlan.assignmentManifestCanonicalJson).manifestVersion,
      ).toBe(1);
      const initial = await executePlan(
        firstNative,
        firstControl,
        initialPlan,
        oldClaims.map((claim, index) =>
          legacyFinding(claim[0], claim[1], claim[2], String(index + 1)),
        ),
        undefined,
      );
      const initialProjection = await buildProjection(
        firstNative,
        initialPlan,
        initial.accepted,
        null,
      );
      const initialEnvelope = JSON.parse(
        initialProjection.projectionEnvelopeCanonicalJson,
      );
      expect(initialEnvelope.snapshot.lineageHints).toHaveLength(4);
      await finalizeAndPublish(
        firstNative,
        firstControl,
        initial.execution,
        initialProjection,
        true,
      );
      const initialHints = initialEnvelope.snapshot.lineageHints as Array<
        Record<string, unknown>
      >;
      const [seedObservation] = await owned.prisma.$queryRaw<
        { createdAt: Date }[]
      >`
        SELECT clock_timestamp() AS "createdAt"
      `;
      if (!seedObservation || !activation.lifecycleResolutionActivatedAt)
        throw new Error("paired_lifecycle_activation_clock_missing");
      expect(seedObservation.createdAt.getTime()).toBeGreaterThanOrEqual(
        activation.lifecycleResolutionActivatedAt.getTime(),
      );
      // A native comment observed after activation has a canonical timestamp;
      // both public inventory and private history binding see these same bytes.
      threads.seed(initialHints, seedObservation.createdAt.toISOString());
      owned.setRevision({
        baseSha: "c".repeat(40),
        mergeBaseSha: "d".repeat(40),
        headSha: "f".repeat(40),
      });
      const authorized = await owned.authorize({ sourceRunAttempt: "2" });
      const native = adapterModule.projectReviewRunAuthorization(
        authorized.result,
      );
      const cp = control(authorized.result);
      const storedAuth =
        await owned.prisma.reviewRunAuthorization.findUniqueOrThrow({
          where: { authorizationId: authorized.authorizationId },
        });
      const snapshot = parseReviewRunRuntimeSnapshot(
        storedAuth.runtimeSnapshotCanonicalJson,
      )!;
      const capability = snapshot.lifecycleVerificationCapability;
      expect(capability).toMatchObject({
        extensionId: "lifecycle-verification.v1",
        model,
        modelTransport: "account_gateway",
        maxOutputTokens: 4096,
      });
      if (!capability) throw new Error("paired_lifecycle_capture_missing");
      const baseline = await cp.restoreComparisonBaseline({
        authorization: native,
        reviewRevisionHash: authorized.reviewRevisionHash,
      });
      expect(baseline.priorLineageHints).toHaveLength(4);
      const prompt = await lifecycleInventory.loadForPrompt(
        42,
        native.facts.headSha,
      );
      expect(prompt.revalidationTargets).toHaveLength(4);
      expect(
        prompt.revalidationTargets.map(
          (target: { parentEdited: boolean }) => target.parentEdited,
        ),
      ).toEqual([false, false, false, false]);
      // Seed the canonical App comment format, then verify the actual public
      // native inventory recovered the known severities and unchanged claim IDs.
      expect(
        prompt.revalidationTargets.map(
          (target: { severity: string }) => target.severity,
        ),
      ).toEqual(["major", "major", "major", "major"]);
      expect(
        prompt.revalidationTargets
          .map((target: { title: string }) => target.title)
          .sort(),
      ).toEqual(oldClaims.map((claim) => claim[0]).sort());
      const revalidation = await verifierModule.planFindingRevalidation(
        {
          scope: {
            workspaceId: owned.workspaceId,
            repositoryConnectionId: owned.repositoryConnectionId,
            repository: "reviewrouter-e2e/disposable-review-v2",
            pullRequestNumber: 42,
            baseSha: native.facts.baseSha,
            mergeBaseSha: native.facts.mergeBaseSha,
            headSha: native.facts.headSha,
            reviewRevisionHash: native.facts.reviewRevisionHash,
          },
          participant: {
            model,
            capabilityDigest: invocationModule.lifecycleHash(capability),
            voteIdentityHash:
              native.facts.providerVoteLanes[0].providerVoteIdentityHash,
          },
          inventoryComplete: true,
          targets: prompt.revalidationTargets,
          limits: {
            gatewayOutputTokens: 4096,
            modelOutputTokens: 4096,
            remainingWorkSlots: 2,
          },
          policyDigest: hash("paired-lifecycle-policy"),
        },
        {
          sourceReader: {
            read: async ({
              headSha,
              path: sourcePath,
            }: {
              headSha: string;
              path: string;
            }) => ({
              kind: "file",
              headSha,
              path: sourcePath,
              blobOid,
              bytes: Buffer.from(source),
            }),
          },
          priorResolutionHistory: {
            read: async (target: unknown) => {
              const prior = planningModule.priorResolutionFact(
                target,
                cp.readCapturedResolutionHistory() ?? [],
              );
              expect(prior.state).toBe("no_prior_since_creation");
              return prior;
            },
          },
          isPathAllowed: () => true,
        },
      );
      expect(revalidation.packets).toHaveLength(1);
      upstream.setPacket(revalidation.packets[0]);
      const discovery = domainModule.createStableReviewWorkPlan({
        ...planInput(native),
        batches: [
          {
            batchId: "discovery",
            taskKind: "finding_discovery",
            required: true,
            paths: [filePath],
            schedulingOrdinal: 0,
          },
        ],
      });
      const expanded = invocationModule.appendLifecycleWorkPlan({
        plan: discovery,
        revalidation,
        capability,
        reviewRevisionHash: native.facts.reviewRevisionHash,
        compatibilityKey: hash("paired-runtime"),
        maxWorkSlots: 8,
        maxAttemptsPerSlot: 1,
        policyDigest: hash("paired-lifecycle-policy"),
        liveLifecycleStateHash: hash(
          canonicalJson({
            inventory: prompt.inventory.lifecycleStateHash,
            ledger: prompt.inventory.commandLedgerWatermark,
          }),
        ),
      });
      expanded.lifecycleVerification.mode = "resolve";
      expect(
        JSON.parse(expanded.plan.assignmentManifestCanonicalJson)
          .manifestVersion,
      ).toBe(2);
      const current = [
        legacyFinding(
          "Negative rounding drops a cent",
          "Math.round rounds negative half cents toward positive infinity and loses a refund cent.",
          7,
          "8",
          "minor",
        ),
      ];
      const second = await executePlan(native, cp, expanded.plan, current, {
        ...expanded,
        capability,
        outputCap: revalidation.outputCap,
      });
      const projection = await buildProjection(
        native,
        expanded.plan,
        second.accepted,
        scenario === "denied" ? null : baseline,
        expanded.lifecycleVerification,
        second.exhausted,
      );
      const envelope = JSON.parse(projection.projectionEnvelopeCanonicalJson);
      const valid = ["success", "denied", "unknown"].includes(scenario);
      expect(envelope.coverage.state).toBe("complete");
      expect(envelope.publishing.summary.allClear).toBe(false);
      expect(envelope.publishing.summary.occurrenceCounts.resolved).toBe(0);
      expect(
        envelope.publishing.lifecycle.filter(
          (entry: { mutationEligible: boolean }) => entry.mutationEligible,
        ),
      ).toHaveLength(valid ? 2 : 0);
      expect(envelope.publishing.summary.body).toContain(
        valid ? "2 fixes verified" : "0 fixes verified",
      );
      if (valid) {
        expect(
          envelope.publishing.lifecycle
            .map(
              (entry: { verification: { confirmationState: string } }) =>
                entry.verification.confirmationState,
            )
            .sort(),
        ).toEqual([
          "confirmed_open",
          "fix_confirmed_thread_open",
          "fix_confirmed_thread_open",
          "unverified",
        ]);
        const noBaseline = await buildProjection(
          native,
          expanded.plan,
          second.accepted,
          null,
          expanded.lifecycleVerification,
          second.exhausted,
        );
        const noBaselineEnvelope = JSON.parse(
          noBaseline.projectionEnvelopeCanonicalJson,
        );
        expect(noBaselineEnvelope.occurrences).toHaveLength(1);
        // Only an accepted, known-severity confirmation may block without a
        // lineage baseline; unknown/unverified history must remain non-blocking.
        const noBaselineConfirmedOpen =
          noBaselineEnvelope.publishing.lifecycle.filter(
            (entry: { verification: { confirmationState: string } }) =>
              entry.verification.confirmationState === "confirmed_open",
          );
        expect(noBaselineConfirmedOpen).toHaveLength(1);
        expect(noBaselineConfirmedOpen[0].verification.severity).toBe("major");
        expect(noBaselineEnvelope.mergeGate.conclusion).toBe("fail");
        expect(noBaselineEnvelope.mergeGate.blockingLineageIds).toEqual([]);
        expect(
          noBaselineEnvelope.mergeGate.blockingConfirmedLifecycleTargetIds,
        ).toHaveLength(1);
      }
      const dispatches =
        await owned.prisma.reviewRunCompanionDispatchV1.findMany({
          where: { authorizationId: authorized.authorizationId },
        });
      expect(upstream.requests()).toBe(scenario === "forged_claim" ? 0 : 1);
      expect(dispatches).toHaveLength(scenario === "forged_claim" ? 0 : 1);
      if (dispatches[0])
        expect(dispatches[0]).toMatchObject({
          state: "completed",
          role: "lifecycle_verification",
          providerRequestEnvelopeHash: hash(upstream.lastRequest()),
        });
      await finalizeAndPublish(native, cp, second.execution, projection, false);
      const artifact =
        await owned.prisma.finalizedReviewProjectionArtifactV2.findFirstOrThrow(
          { where: { executionId: second.execution.executionId } },
        );
      const frozen = {
        json: artifact.projectionEnvelopeCanonicalJson,
        hash: artifact.projectionHash,
        artifactHash: artifact.artifactHash,
      };
      const dbArtifact = (
        await new PrismaReviewExecutionStore(owned.prisma).findExecution(
          second.execution.executionId,
        )
      )?.artifact;
      if (!dbArtifact)
        throw new Error("paired_lifecycle_finalized_artifact_missing");
      const storedLimits =
        await owned.prisma.reviewProtocolLimitsV2.findUniqueOrThrow({
          where: { protocolLimitsProfileId: owned.protocolLimitsProfileId },
          select: { limitsDigest: true },
        });
      const mapper = new CanonicalReviewV2ProjectionAdapter({
        findArtifact: async () => ({
          artifact: dbArtifact,
          protocolLimitsProfileId: owned.protocolLimitsProfileId,
          limitsDigest: storedLimits.limitsDigest,
        }),
      });
      const catalogBefore = await mapper.publicationEnvelope(dbArtifact);
      const snapshotBefore = await owned.prisma.reviewSnapshot.findFirstOrThrow(
        {
          where: {
            workspaceId: owned.workspaceId,
            repositoryId: owned.repositoryConnectionId,
            pullRequestNumber: 42,
          },
        },
      );
      await owned.processFinalizedOutbox();
      let deniedMaintenanceStartedAt: Date | undefined;
      if (scenario === "unknown") {
        try {
          await owned.runWorkerUntilSettled(1);
        } catch (error) {
          expect(String(error)).toContain(
            "review_v2_e2e_worker_did_not_settle",
          );
        }
      } else if (scenario === "denied") {
        deniedMaintenanceStartedAt = new Date();
        // The summary/check already have real effects: a per-thread denial
        // cannot turn the whole publication into a no-effect success.
        await expect(owned.runWorkerUntilSettled(1)).rejects.toThrow(
          "review_v2_e2e_worker_did_not_settle",
        );
      } else await owned.runWorkerUntilSettled();
      const after =
        await owned.prisma.finalizedReviewProjectionArtifactV2.findFirstOrThrow(
          { where: { executionId: second.execution.executionId } },
        );
      expect({
        json: after.projectionEnvelopeCanonicalJson,
        hash: after.projectionHash,
        artifactHash: after.artifactHash,
      }).toEqual(frozen);
      expect(await mapper.publicationEnvelope(dbArtifact)).toEqual(
        catalogBefore,
      );
      const operations =
        await owned.prisma.reviewPublicationOperationV2.findMany({
          where: {
            publicationAttemptId: (
              await owned.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
                where: { executionId: second.execution.executionId },
              })
            ).publicationAttemptId,
            publicationKind: "thread_lifecycle",
          },
        });
      const receipts = await owned.prisma.reviewPublicationReceiptV2.findMany({
        where: {
          publicationOperationId: {
            in: operations.map((item) => item.publicationOperationId),
          },
        },
      });
      if (scenario === "success") expect(threads.resolveCalls()).toBe(2);
      else if (!valid) expect(threads.resolveCalls()).toBe(0);
      else {
        expect(threads.resolveCalls()).toBeGreaterThanOrEqual(1);
        expect(threads.resolveCalls()).toBeLessThanOrEqual(2);
      }
      expect(receipts).toHaveLength(scenario === "success" ? 2 : 0);
      if (scenario === "denied") {
        expect(threads.resolveCalls()).toBe(2);
        const publicationAttemptId = operations[0]!.publicationAttemptId;
        const deniedIds = operations.map(
          (operation) => operation.publicationOperationId,
        );
        const readDeniedProofs = () =>
          owned.prisma.reviewPublicationOperationAttemptV2.findMany({
            where: { publicationOperationId: { in: deniedIds } },
            orderBy: { publicationOperationId: "asc" },
          });
        const proofs = await readDeniedProofs();
        expect(proofs).toHaveLength(2);
        for (const proof of proofs)
          expect(proof).toMatchObject({
            state: "no_effect_proven",
            noEffectProofId: expect.any(String),
            noEffectProofHash: expect.stringMatching(/^[a-f0-9]{64}$/),
            noEffectReason: "definitely_no_effect:github_mutation_http_403",
            noEffectProvenAt: expect.any(Date),
          });
        expect(
          await owned.prisma.reviewPublicationExternalEffectV2.count({
            where: { publicationOperationId: { in: deniedIds } },
          }),
        ).toBe(0);
        expect(
          await owned.prisma.reviewPublicationReceiptV2.count({
            where: {
              publicationAttemptId,
              publicationOperationId: { notIn: deniedIds },
              status: "succeeded",
            },
          }),
        ).toBeGreaterThan(0);
        expect(
          await owned.prisma.reviewPublicationAttemptV2.findUniqueOrThrow({
            where: { publicationAttemptId },
            select: { state: true, terminalOutcome: true },
          }),
        ).toEqual({ state: "publishing", terminalOutcome: null });
        expect(
          await owned.prisma.reviewCompletionProcess.findUniqueOrThrow({
            where: { executionId: second.execution.executionId },
            select: { state: true, lastSafeReason: true },
          }),
        ).toEqual({
          state: "pending_publication",
          lastSafeReason: "publication_pending",
        });
        for (const operation of operations)
          expect(operation).toMatchObject({
            state: "in_flight",
            lastErrorCode: "github_mutation_http_403",
            retryCount: expect.any(Number),
          });
        expect(
          operations.every(
            (operation) =>
              operation.retryCount > 0 &&
              operation.nextEligibleAt > deniedMaintenanceStartedAt! &&
              operation.reconcileUntil > new Date(),
          ),
        ).toBe(true);
        const deniedThreadIds = envelope.publishing.lifecycle
          .filter(
            (entry: { mutationEligible: boolean }) => entry.mutationEligible,
          )
          .map((entry: { threadId: string }) => entry.threadId);
        const deniedHistory = await history.read(
          {
            workspaceId: owned.workspaceId,
            repositoryConnectionId: owned.repositoryConnectionId,
            scmRepositoryIdentityId: owned.scmRepositoryIdentityId,
            pullRequestNumber: 42,
          },
          deniedThreadIds,
        );
        expect(deniedHistory).toHaveLength(2);
        expect(
          deniedHistory.every(
            (fact) => fact.pending.length === 0 && fact.confirmed === null,
          ),
        ).toBe(true);
        const nativeCalls = threads.resolveCalls();
        // A second ordinary maintenance pass preserves the original denial proof
        // and never requests a new resolve operation. No deadlines are rewritten.
        await expect(owned.runWorkerUntilSettled(1)).rejects.toThrow(
          "review_v2_e2e_worker_did_not_settle",
        );
        expect(await readDeniedProofs()).toEqual(proofs);
        expect(threads.resolveCalls()).toBe(nativeCalls);
        expect(threads.closed()).toHaveLength(0);
      }

      const snapshotAfter = await owned.prisma.reviewSnapshot.findFirstOrThrow({
        where: {
          workspaceId: owned.workspaceId,
          repositoryId: owned.repositoryConnectionId,
          pullRequestNumber: 42,
        },
      });
      if (scenario === "success") {
        expect(threads.closed()).toHaveLength(2);
        const effects =
          await owned.prisma.reviewPublicationExternalEffectV2.findMany({
            where: {
              effectId: {
                in: receipts.map((receipt) => receipt.canonicalEffectId),
              },
            },
          });
        expect(effects.map((effect) => effect.externalObjectId).sort()).toEqual(
          threads
            .closed()
            .map((threadId) => `thread:${threadId}`)
            .sort(),
        );
        const confirmed = await history.read(
          {
            workspaceId: owned.workspaceId,
            repositoryConnectionId: owned.repositoryConnectionId,
            scmRepositoryIdentityId: owned.scmRepositoryIdentityId,
            pullRequestNumber: 42,
          },
          threads.closed(),
        );
        expect(
          confirmed.every(
            (fact) =>
              fact.confirmed &&
              receipts.some(
                (receipt) =>
                  receipt.canonicalEffectId === fact.confirmed!.effectId,
              ),
          ),
        ).toBe(true);
        expect(snapshotAfter.sourceArtifactHash).toBe(artifact.artifactHash);
        expect(canonicalJson(snapshotAfter.payload)).not.toContain(
          '"state":"resolved"',
        );
        const mapped = await mapper.snapshotProjection(dbArtifact);
        expect(
          mapped.occurrences.filter((item) => item.state === "resolved"),
        ).toHaveLength(0);
        // The next ordinary projection is allowed to consume confirmed receipts
        // and fresh native closed state; no re-render of this artifact occurs.
        owned.setRevision({
          baseSha: "c".repeat(40),
          mergeBaseSha: "d".repeat(40),
          headSha: "1".repeat(40),
        });
        const laterAuth = await owned.authorize({ sourceRunAttempt: "3" });
        const laterNative = adapterModule.projectReviewRunAuthorization(
          laterAuth.result,
        );
        const laterCp = control(laterAuth.result);
        const laterBaseline = await laterCp.restoreComparisonBaseline({
          authorization: laterNative,
          reviewRevisionHash: laterAuth.reviewRevisionHash,
        });
        expect(laterBaseline.appliedResolutions).toHaveLength(2);
        const laterPlan = domainModule.createStableReviewWorkPlan({
          ...planInput(laterNative),
          batches: [
            {
              batchId: "discovery",
              taskKind: "finding_discovery",
              required: true,
              paths: [filePath],
              schedulingOrdinal: 0,
            },
          ],
        });
        const later = await executePlan(
          laterNative,
          laterCp,
          laterPlan,
          [],
          undefined,
        );
        const laterProjection = await buildProjection(
          laterNative,
          laterPlan,
          later.accepted,
          laterBaseline,
        );
        expect(
          JSON.parse(laterProjection.projectionEnvelopeCanonicalJson).publishing
            .summary.occurrenceCounts.resolved,
        ).toBe(2);
      } else if (scenario === "denied" || scenario === "unknown") {
        if (snapshotAfter.sourceArtifactHash === artifact.artifactHash) {
          expect(canonicalJson(snapshotAfter.payload)).not.toContain(
            '"state":"resolved"',
          );
        } else {
          expect(snapshotAfter.sourceArtifactHash).toBe(
            snapshotBefore.sourceArtifactHash,
          );
          expect(snapshotAfter.payloadHash).toBe(snapshotBefore.payloadHash);
        }
        if (scenario === "unknown") {
          const uncertainHistory = await history.read(
            {
              workspaceId: owned.workspaceId,
              repositoryConnectionId: owned.repositoryConnectionId,
              scmRepositoryIdentityId: owned.scmRepositoryIdentityId,
              pullRequestNumber: 42,
            },
            threads.closed(),
          );
          expect(
            uncertainHistory.some(
              (fact) => fact.pending.length > 0 && fact.confirmed === null,
            ),
          ).toBe(true);
        }
        expect(threads.closed()).toHaveLength(
          scenario === "unknown" ? threads.resolveCalls() : 0,
        );
      }
      expect(
        owned.fakeGitHub.comments.every(
          (comment) => comment.user.login === "reviewrouter-e2e[bot]",
        ),
      ).toBe(true);

      function planInput(auth: any) {
        return {
          reviewRevisionHash: auth.facts.reviewRevisionHash,
          compatibilityKey: hash("paired-runtime"),
          providers: [
            {
              providerName: "codex",
              providerKind: "codex",
              providerVoteIdentityHash:
                auth.facts.providerVoteLanes[0].providerVoteIdentityHash,
              required: true,
              attemptBudget: 1,
              retryPolicyVersion: "paired-once.v1",
            },
          ],
          eligiblePaths: [filePath],
          uncoveredPaths: [],
          excludedPaths: [],
          maxWorkSlots: 8,
          maxAttemptsPerSlot: 1,
        };
      }
      async function executePlan(
        auth: any,
        plane: any,
        plan: any,
        findings: readonly unknown[],
        verification: any,
      ) {
        const executionId = `${owned.prefix}-${randomUUID()}`;
        const ownerIdHash = hash(executionId);
        const slots = plan.assignments.map((item: any) => item.workSlot);
        const execution = await plane.startExecution({
          authorization: auth,
          idempotencyKey: randomUUID(),
          executionId,
          reviewRevisionHash: auth.facts.reviewRevisionHash,
          compatibilityKey: hash("paired-runtime"),
          planHash: plan.planHash,
          workSlotsCanonicalJson: plan.workSlotsCanonicalJson,
          assignmentManifestCanonicalJson: plan.assignmentManifestCanonicalJson,
          assignmentManifestHash: plan.assignmentManifestHash,
          workSlots: slots,
          sourceRunId: "700001",
          sourceRunAttempt: owned.fakeGitHub.sourceRunAttempt,
        });
        const assembler =
          new manifestModule.GeneratedProviderInvocationManifestAssembler(
            auth,
            config,
            hash("paired-runtime"),
          );
        const accepted: any[] = [];
        const exhausted: string[] = [];
        const discoveryPort = {
          prepare: async ({ workSlot }: any) => ({
            workSlotId: workSlot.workSlotId,
            attemptOrdinal: 1,
            provider: "codex",
            requestedModel: model,
            reviewPrompt: "Bounded synthetic discovery",
            investigationContextPrompt: null,
            immutableRequest: Buffer.from("bounded-discovery"),
            manifestFacts: {
              taskKindSet: ["finding_discovery"],
              providerKind: "codex",
              providerCapabilityHash: hash("discovery-capability"),
              providerRequestEnvelopeHash: hash("bounded-discovery"),
              outputSchemaHash: hash("discovery-output"),
              filePatchManifestHash: hash(source),
              contextManifestHash: hash(source),
              lifecycleTargetSetHash: null,
              liveLifecycleStateHash: null,
              toolPolicyHash: hash("no-tools"),
              executionProfile: "prompt_only_envelope_v1",
              baseTreeHash: null,
              environmentContractHash: hash("paired-environment"),
            },
            coverageManifest: domainModule.createReviewPromptCoverageManifest({
              workSlotId: workSlot.workSlotId,
              reviewRevisionHash: auth.facts.reviewRevisionHash,
              assignedPaths: [filePath],
              pathCoverage: [
                {
                  path: filePath,
                  kind: "full_patch",
                  contentHash: hash(source),
                },
              ],
            }),
            investigationProbePlan: null,
          }),
          execute: async ({ invocation }: any) =>
            normalizerModule.normalizeReviewObservation({
              workSlotId: invocation.workSlotId,
              attemptOrdinal: 1,
              providerName: "codex",
              requestedModel: model,
              result: { content: "", actualModel: model, findings },
            }),
        };
        const port = verification
          ? invocationModule.compositeLifecycleInvocations({
              discovery: discoveryPort,
              packetsByWorkSlotId: verification.packetsByWorkSlotId,
              capability: verification.capability,
              outputCap: verification.outputCap,
              reviewRevisionHash: auth.facts.reviewRevisionHash,
              liveLifecycleStateHash: hash(
                canonicalJson({
                  inventory: prompt.inventory.lifecycleStateHash,
                  ledger: prompt.inventory.commandLedgerWatermark,
                }),
              ),
              transport: {
                generateLifecycleVerification: async ({
                  requestBody,
                  dispatch,
                }: any) => {
                  const context =
                    scenario === "forged_claim"
                      ? { ...dispatch, preparedManifestKey: "0".repeat(64) }
                      : dispatch;
                  const headers: Record<string, string> = {
                    authorization: `Bearer ${auth.authorizationToken}`,
                    "content-type": "application/json",
                  };
                  for (const [key, header] of Object.entries(
                    lifecycleVerificationContract.dispatchHeaders,
                  ))
                    headers[header] = String(context[key]);
                  const response = await app.inject({
                    method: "POST",
                    url: "/api/action/v2/account-gateway/responses",
                    headers,
                    payload: Buffer.from(requestBody),
                  });
                  if (response.statusCode !== 200)
                    throw new Error(
                      `paired_relay_denied:${response.statusCode}:${response.json().error?.code}`,
                    );
                  const completed = response.body
                    .split(/\r?\n/)
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => JSON.parse(line.slice(5).trim()))
                    .find((event: any) => event.type === "response.completed");
                  return {
                    body: Buffer.from(
                      completed.response.output[0].content[0].text,
                    ),
                    actualModel: completed.response.model,
                    providerRequestEnvelopeHash: hash(requestBody),
                  };
                },
              },
            })
          : discoveryPort;
        for (const workSlot of slots) {
          const invocation = await port.prepare({
            workSlot,
            attemptOrdinal: 1,
          });
          const manifest = await assembler.assemble(invocation);
          const acquired = await plane.acquireInvocationLease({
            authorization: auth,
            execution,
            workSlot,
            manifest,
            idempotencyKey: randomUUID(),
            acquireRequestId: randomUUID(),
            ownerIdHash,
          });
          expect(acquired.status).toBe("acquired");
          const lease = acquired.lease;
          try {
            const observationPayload = await port.execute({
              invocation,
              manifest,
              lease,
              sourceExecutionId: executionId,
              sourceReviewRevisionHash: auth.facts.reviewRevisionHash,
              signal: new AbortController().signal,
            });
            const committed = await plane.commitEvidence({
              authorization: auth,
              idempotencyKey: randomUUID(),
              lease,
              ownerIdHash,
              observation: observationPayload,
            });
            const observation = {
              ...observationPayload,
              ...committed,
              providerKind: workSlot.providerKind,
              providerInvocationKey: manifest.providerInvocationKey,
              providerVoteIdentityHash: manifest.providerVoteIdentityHash,
            };
            await plane.attachObservation({
              authorization: auth,
              idempotencyKey: randomUUID(),
              execution,
              workSlot,
              observation,
              attachmentCapability: lease.leaseCapability,
            });
            accepted.push({
              workSlotId: workSlot.workSlotId,
              coverageManifest: invocation.coverageManifest,
              observation,
            });
          } catch (error) {
            if (
              workSlot.taskKind !== "lifecycle_revalidation" ||
              ["success", "denied", "unknown"].includes(scenario)
            )
              throw error;
            expect(String(error)).toContain(
              scenario === "forged_claim"
                ? "paired_relay_denied:409:companion_lease_mismatch"
                : "lifecycle_verification_response_invalid",
            );
            exhausted.push(workSlot.workSlotId);
          } finally {
            await plane.releaseInvocationLease({
              lease,
              idempotencyKey: randomUUID(),
              releaseRequestId: randomUUID(),
              ownerIdHash,
            });
          }
        }
        return { execution, accepted, exhausted };
      }
      async function buildProjection(
        auth: any,
        plan: any,
        accepted: any[],
        baseline: any,
        verification?: any,
        exhausted: string[] = [],
      ) {
        return projectionModule
          .createProductionReviewProjectionBuilder({
            authorizationFacts: auth.facts,
            pr: pr(),
            config,
            protocolLimits: auth.limits,
            assignments: plan.assignments.map((item: any) => ({
              workSlotId: item.workSlot.workSlotId,
              taskKind: item.workSlot.taskKind,
              providerKind: item.workSlot.providerKind,
              required: item.workSlot.required,
              filePaths: JSON.parse(
                plan.assignmentManifestCanonicalJson,
              ).assignments.find(
                (row: any) => row.workSlotId === item.workSlot.workSlotId,
              ).paths,
            })),
            uncoveredPaths: [],
            uncoveredLifecycleTargetIds: [],
            lifecycleInventory,
            ...(verification ? { lifecycleVerification: verification } : {}),
          })
          .build({
            comparisonBaseline: baseline,
            acceptedEvidence: accepted,
            exhaustedWorkSlotIds: exhausted,
            reviewRevisionHash: auth.facts.reviewRevisionHash,
          });
      }
      async function finalizeAndPublish(
        auth: any,
        plane: any,
        execution: any,
        projection: any,
        settle: boolean,
      ) {
        const row = await owned.prisma.reviewExecutionV2.findUniqueOrThrow({
          where: { executionId: execution.executionId },
        });
        const stream =
          await owned.prisma.reviewExecutionStreamV2.findFirstOrThrow({
            where: { activeExecutionId: execution.executionId },
          });
        const finalized = await plane.finalizeExecution({
          authorization: auth,
          idempotencyKey: randomUUID(),
          execution: {
            ...execution,
            streamVersion: String(stream.version),
            executionVersion: String(row.version),
          },
          projection,
          allowPartial: false,
        });
        await plane.requestPublication({
          authorization: auth,
          idempotencyKey: randomUUID(),
          execution,
          projection,
          publicationPermit: finalized.publicationPermit,
        });
        if (settle) {
          await owned.processFinalizedOutbox();
          await owned.runWorkerUntilSettled();
        }
      }
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await app.close();
      await fixture?.close();
      await upstream.close();
      if (fixture) await resetReviewActionV2E2EDatabase(databaseUrl!);
    }
  },
  120_000,
);

function legacyFinding(
  title: string,
  message: string,
  line: number,
  seed: string,
  severity = "major",
) {
  return {
    file: filePath,
    line,
    severity,
    title,
    message,
    provider: "codex",
    confidence: 0.99,
    category: "correctness",
    normalizedFailureModeHash: seed.repeat(64),
  };
}

async function selectSavedGateway(fixture: ReviewActionV2E2EHarness) {
  const connection = await fixture.prisma.providerAccountConnection.create({
    data: {
      ownerWorkspaceId: fixture.workspaceId,
      gatewayAccountRef: `${fixture.prefix}-account`,
      profileRef: "paired-responses-v1",
      displayName: "Disposable lifecycle paired",
      state: "active",
    },
  });
  const binding = await new PrismaProviderAccountRepository(
    fixture.prisma,
  ).compareAndSetBinding({
    workspaceId: fixture.workspaceId,
    connectionId: connection.id,
    expectedRevision: 0,
    state: "active",
  });
  const target = {
    scope: "repository" as const,
    workspaceId: fixture.workspaceId,
    repositoryId: fixture.repositoryConnectionId,
  };
  await saveReviewConfiguration(
    {
      target,
      expectedVersion: null,
      ...systemPolicyWriteFixture(
        parseReviewConfigurationStrict({
          ...workspacePolicyFixture,
          providers: [
            {
              kind: "codex",
              authMode: "codex_account_gateway",
              model,
              reasoningEffort: "high",
              fastMode: false,
              agenticContext: true,
              gatewayBindingId: binding.id,
              gatewayProfileRef: connection.profileRef,
            },
          ],
        }),
        target,
      ),
    },
    {
      configurations: new PrismaReviewConfigurationRepository(
        fixture.prisma,
        undefined,
        false,
        undefined,
      ),
    },
  );
}

type Packet = {
  packetHash: string;
  targets: Array<{
    witness: { targetId: string; fingerprint: string };
    claim: { title: string; message: string };
  }>;
  sources: Array<{ path: string; blobOid: string; content: string }>;
};
async function controlledGateway(scenario: Scenario) {
  let packet: Packet | undefined;
  let calls = 0;
  let last = Buffer.alloc(0);
  const admissions = new Map<string, Record<string, unknown>>();
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      const body = bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
      const json = (status: number, value: unknown) =>
        response
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify(value));
      if (request.url === "/internal/v1/run-access") {
        expect(request.headers.authorization).toBe(
          `Bearer ${lifecycleGatewayFixtureControlBearer}`,
        );
        const intent = body;
        const executionRef = `paired-native-${randomUUID()}`;
        const admission = {
          invocationRef: intent.invocationRef,
          attemptRef: intent.attemptRef,
          accountRef: intent.accountRefs[0],
          authorizationEpoch: 1,
          subjectRef: intent.subjectRef,
          policyRevision: intent.policyRevision,
          bindingRevision: intent.bindingRevision,
          profileId: intent.profileId,
          limits: intent.limits,
          expiresAt: intent.deadline,
        };
        admissions.set(executionRef, admission);
        json(200, {
          operation: {
            operationRef: intent.operationId,
            state: "applied",
            result: {
              kind: "execution",
              executionRef,
              accountRef: admission.accountRef,
              authorizationEpoch: 1,
              deadline: intent.deadline,
              state: "active",
            },
          },
          bearer: "paired-execution",
          admission,
        });
        return;
      }
      if (request.method === "GET" && request.url?.includes("/requests/")) {
        json(200, {
          requestRef: request.url.split("/").at(-1),
          effect: "completed",
          status: "completed",
        });
        return;
      }
      if (request.url?.endsWith("/close")) {
        json(200, { operationRef: body.operationId, state: "applied" });
        return;
      }
      if (request.method === "POST" && request.url?.endsWith("/requests")) {
        expect(request.headers.authorization).toBe("Bearer paired-execution");
        expect(packet).toBeDefined();
        const supplied = JSON.parse(
          String(request.headers["x-gateway-admission"]),
        );
        expect([...admissions.values()]).toContainEqual(supplied);
        calls++;
        last = bytes;
        const sentPacket = JSON.parse(body.input[0].content[0].text) as Packet;
        expect(sentPacket.packetHash).toBe(packet!.packetHash);
        expect(bytes.length).toBeLessThanOrEqual(96 * 1024);
        const results = packet!.targets.map((target) => {
          const index = oldClaims.findIndex(
            (claim) => claim[0] === target.claim.title,
          );
          if (index < 0) throw new Error("paired_unknown_tax_claim");
          const uncertain = index === 3;
          const quote =
            source.split("\n")[index === 0 ? 1 : index === 1 ? 3 : 4]!;
          return {
            targetId: target.witness.targetId,
            fingerprint: target.witness.fingerprint,
            verdict: uncertain
              ? "uncertain"
              : index === 2
                ? "still_valid"
                : "resolved",
            confidence: 0.99,
            scopeSufficient: !uncertain,
            failureCondition: target.claim.message,
            fixExplanation: uncertain
              ? "The separate regional caller dependency is absent from the packet."
              : index === 0
                ? "The zero subtotal guard returns before division."
                : index === 1
                  ? "Nullish fallback preserves the zero rate, and the zero rate guard returns zero."
                  : "The exempt branch still multiplies the subtotal by the rate.",
            evidence: uncertain
              ? []
              : [
                  {
                    path: filePath,
                    blobOid,
                    startLine: index === 0 ? 2 : index === 1 ? 4 : 5,
                    endLine: index === 0 ? 2 : index === 1 ? 4 : 5,
                    quote:
                      scenario === "invalid_quote"
                        ? "fabricated source"
                        : quote,
                    reason:
                      "Current literal source shows the failure condition or its removal.",
                  },
                ],
          };
        });
        const answer = {
          version: 1,
          packetHash:
            scenario === "wrong_packet" ? "0".repeat(64) : packet!.packetHash,
          results: scenario === "missing_verdict" ? results.slice(1) : results,
        };
        response
          .writeHead(200, {
            "content-type": "text/event-stream",
            "x-gateway-request-ref": String(
              request.headers["x-gateway-request-id"],
            ),
          })
          .end(
            `data: ${JSON.stringify({ type: "response.completed", response: { id: "paired-response", status: "completed", model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(answer) }] }], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } } })}\n\n`,
          );
        return;
      }
      json(404, { error: "paired_unknown_native_route" });
    })().catch((error) => {
      if (response.headersSent) response.destroy(error as Error);
      else
        response.writeHead(500).end(JSON.stringify({ error: String(error) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    setPacket(value: Packet) {
      packet = value;
    },
    requests: () => calls,
    lastRequest: () => last,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

function nativeThreads(github: FakeGitHubTransport, scenario: Scenario) {
  type Thread = {
    id: string;
    isResolved: boolean;
    path: string;
    line: number;
    parent: Record<string, unknown>;
  };
  const threads: Thread[] = [];
  let calls = 0;
  let unknownEffect = false;
  const original = github.fetch;
  vi.spyOn(github, "fetch").mockImplementation(async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname !== "/graphql")
      return original(input, init);
    const body = (await request.clone().json()) as {
      query: string;
      variables: Record<string, unknown>;
    };
    const query = body.query;
    if (query.includes("ReviewRouterResolveThread")) {
      expect(request.headers.get("authorization")).toMatch(
        /^(?:token|Bearer) fake-installation-token$/,
      );
      const thread = threads.find((item) => item.id === body.variables.id);
      if (!thread) throw new Error("paired_lifecycle_thread_missing");
      calls++;
      if (scenario === "denied")
        return Response.json(
          { message: "Resource not accessible by integration" },
          { status: 403 },
        );
      thread.isResolved = true;
      if (scenario === "unknown") {
        unknownEffect = true;
        throw new TypeError("paired_network_lost_after_native_effect");
      }
      return Response.json({
        data: {
          resolveReviewThread: { thread: { id: thread.id, isResolved: true } },
        },
      });
    }
    if (query.includes("ReviewRouterPublicationThread")) {
      if (unknownEffect)
        return Response.json(
          { message: "paired readback unavailable" },
          { status: 503 },
        );
      const thread = threads.find((item) => item.id === body.variables.id);
      return Response.json({
        data: {
          node: thread
            ? {
                id: thread.id,
                isResolved: thread.isResolved,
                pullRequest: {
                  number: 42,
                  repository: {
                    nameWithOwner: "reviewrouter-e2e/disposable-review-v2",
                  },
                },
              }
            : null,
        },
      });
    }
    if (
      query.includes("ReviewRouterThreadInventory") ||
      query.includes("ReviewRouterPublicationLifecycle")
    ) {
      if (unknownEffect && query.includes("ReviewRouterPublicationLifecycle"))
        return Response.json(
          { message: "paired readback unavailable" },
          { status: 503 },
        );
      return Response.json({
        data: {
          repository: {
            pullRequest: {
              headRefOid: github.revision.headSha,
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: threads.map((thread) => ({
                  id: thread.id,
                  isResolved: thread.isResolved,
                  isOutdated: false,
                  viewerCanResolve: true,
                  path: thread.path,
                  line: thread.line,
                  originalLine: thread.line,
                  comments: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [thread.parent],
                  },
                })),
              },
            },
          },
        },
      });
    }
    return original(input, init);
  });
  return {
    seed(hints: Array<Record<string, unknown>>, parentCreatedAt: string) {
      for (const [index, hint] of hints.entries()) {
        threads.push({
          id: `paired-thread-${index}`,
          isResolved: false,
          path: filePath,
          line: Number(hint.line ?? 1),
          parent: {
            id: `paired-parent-${index}`,
            databaseId: 800 + index,
            viewerDidAuthor: true,
            author: { login: "reviewrouter-e2e[bot]", __typename: "Bot" },
            // Synthesis emits this compact severity header; canonical App
            // publishing preserves it and appends the hidden finding marker.
            body: `_🟡 Major_\n\n**${hint.title}**\n\n${hint.message}\n\n<!-- reviewrouter:finding:v2:${hint.lineageId} -->`,
            ...publishedReviewCommentTimestamps(parentCreatedAt),
            path: filePath,
            line: Number(hint.line ?? 1),
            originalLine: Number(hint.line ?? 1),
          },
        });
      }
    },
    resolveCalls: () => calls,
    closed: () =>
      threads.filter((thread) => thread.isResolved).map((thread) => thread.id),
  };
}
