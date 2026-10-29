import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import {
  canonicalCodexRotatingProviderId,
  CodexRotatingT0WorkflowSchemaVersion,
} from "../../packages/features/codex-oauth-rotating/src/index.js";
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
import {
  lifecycleVerificationContract,
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
  type ReviewModelDispatchProfileV2,
} from "../../packages/shared/src/index.js";
import {
  registerReviewExecutionV2Routes,
  registerReviewEvidenceV2Routes,
  registerReviewSnapshotReadV2Routes,
  registerReviewPublicationRequestV2Routes,
  registerReviewRunControlV2Routes,
} from "../../packages/features/action-control-plane/src/v2/interface/index.js";
import { PrismaReviewThreadResolutionHistory } from "../../packages/features/review-publishing/src/v2/infrastructure/prisma/prisma-review-thread-resolution-history.js";
import { activateReviewResolutionHistory } from "../../packages/features/review-publishing/src/v2/application/use-cases/activate-review-resolution-history.js";
import { createPrismaResolutionWriterQualification } from "../../packages/features/review-publishing/src/v2/infrastructure/prisma/prisma-resolution-writer-qualification.js";
import { CanonicalReviewV2ProjectionAdapter } from "../../apps/worker/src/review-v2-publication-payloads.js";
import { PrismaReviewExecutionStore } from "../../packages/features/review-executions/src/composition/index.js";
import { registerReviewRunGatewayRelayRoutes } from "../../apps/api/src/review-run-gateway-relay.js";
import { registerReviewModelDispatchRoutes } from "../../apps/api/src/review-model-dispatch.js";
import { registerReviewRunCheckoutRoute } from "../../apps/api/src/review-run-gateway-checkout.js";
import { registerReviewRunSkillsRoute } from "../../apps/api/src/review-run-skills.js";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
  type ReviewActionV2E2EHarness,
} from "../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";
import {
  productionModelRoute,
  productionRouteNames,
  selectProductionModelRoute,
  type ProductionRouteName,
} from "./support/production-model-routes.js";
import { prepareHostedProductionRoute } from "./support/hosted-production-route.js";
import { createPairedResolutionWriterFixture } from "./support/resolution-writer-fixture.js";
import type { FakeGitHubTransport } from "../review-action-v2-production-e2e/support/fake-github.js";

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
const modelDispatchProfile: ReviewModelDispatchProfileV2 = {
  extensionId: reviewModelDispatchContract.extensionId,
  descriptorDigest: reviewModelDispatchDescriptorDigest,
  policyVersion: reviewModelDispatchContract.policyVersion,
  transports: ["account_gateway"],
  wireProtocols: ["openai-responses"],
  defaultAgentProfileRefs: { account_gateway: "ocr-paired-v2" },
  limits: {
    maxRequests: 32,
    maxConcurrentRequests: 1,
    maxRequestBytes: 98_304,
    maxResponseBytes: 32_768,
    maxOutputTokens: 4_096,
  },
};
type Scenario =
  | "success"
  | "denied"
  | "unknown"
  | "missing_verdict"
  | "invalid_quote"
  | "wrong_packet"
  | "forged_claim"
  | "paid_unknown"
  | "budget_exhausted"
  | "stale_head"
  | "production_runner";

// Real public modules, production signed admission plus lease/evidence HTTP, relay,
// PostgreSQL, worker and GitHub App adapter. The two external boundaries are a
// controlled local Gateway server and synthetic native GitHub observations.
const lifecycleCase = enabled && databaseUrl && actionSourceDir ? it : it.skip;
lifecycleCase.each([
  ...(
    [
      "success",
      "denied",
      "unknown",
      "missing_verdict",
      "invalid_quote",
      "wrong_packet",
      "forged_claim",
    ] as const
  ).flatMap((scenario) =>
    ([1, 2] as const).map((version) => ({ version, scenario })),
  ),
  ...(
    [
      "paid_unknown",
      "budget_exhausted",
      "stale_head",
      "production_runner",
    ] as const
  ).map((scenario) => ({ version: 2 as const, scenario })),
  ...productionRouteNames.map((route) => ({
    version: 2 as const,
    scenario: "production_runner" as const,
    route,
  })),
])(
  "pairs bounded lifecycle verification with immutable publication and honest native receipts ($version / $scenario / $route)",
  async ({
    version,
    scenario,
    route: routeName,
  }: {
    version: 1 | 2;
    scenario: Scenario;
    route?: ProductionRouteName;
  }) => {
    const unified = version === 2;
    const production = scenario === "production_runner";
    const route = productionModelRoute(routeName);
    const model = production ? route.model : "gpt-5-codex";
    const gateway = !production || !routeName;
    const gatewayProfileRef =
      production && gateway
        ? "openrouter-openai-responses-apikey-v1"
        : "paired-responses-v1";
    const ocrBinary = production ? requiredPairedOcrBinary() : undefined;
    let realCheckout:
      | ReturnType<typeof createRealLifecycleCheckout>
      | undefined;
    const engineKind = unified ? "ocr" : "codex";
    await resetReviewActionV2E2EDatabase(databaseUrl!);
    const networkFetch = globalThis.fetch;
    let apiFetch = networkFetch;
    const tls = unified ? loopbackTls() : undefined;
    const upstream = await controlledGateway(scenario, route);
    let fixture: ReviewActionV2E2EHarness | undefined;
    let apiOrigin: string | undefined;
    const apiRejections: Array<{ status: number; code?: string }> = [];
    const app = tls ? Fastify({ https: tls }) : Fastify();
    try {
      if (production) realCheckout = createRealLifecycleCheckout();
      fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
        modelTransport: gateway ? "account_gateway" : "provider_api",
        ...(routeName === "claude-subscription"
          ? { subscriptionAuthMode: "claude-oauth" as const }
          : {}),
        repositoryProviderSelection: "none",
        lifecycleVerificationProfile: true,
        ...(unified
          ? {
              modelDispatchProfile:
                scenario === "budget_exhausted"
                  ? {
                      ...modelDispatchProfile,
                      limits: {
                        ...modelDispatchProfile.limits,
                        maxRequests: 2,
                      },
                    }
                  : production && !gateway
                    ? {
                        ...modelDispatchProfile,
                        transports: [route.transport],
                        wireProtocols: [route.protocol],
                        defaultAgentProfileRefs: {
                          [route.transport]: "ocr-paired-v2",
                        },
                        ...(routeName === "claude-subscription"
                          ? {
                              anthropicModelAliases: {
                                sonnet: model,
                                opus: "claude-opus-4-6",
                                haiku: "claude-haiku-4-5",
                              },
                            }
                          : {}),
                      }
                    : modelDispatchProfile,
              agentProfiles: [
                {
                  profileRef: "ocr-paired-v2",
                  agentKind: "ocr" as const,
                  packageVersion: production ? "1.13.1-rr.6" : "1.0.0",
                  binarySha256: production
                    ? pairedOcrBinarySha256
                    : hash("paired-controlled-ocr-driver"),
                  modelTransports: [
                    gateway
                      ? ("account_gateway" as const)
                      : ("provider_api" as const),
                  ],
                  contextGateway: false,
                  cancellation: true,
                  reviewSkillsVersion: 1 as const,
                },
              ],
            }
          : {}),
        environmentOverrides: {
          ...upstream.writerEnvironment,
          ...(unified
            ? {
                REVIEW_ROUTER_REVIEW_V2_PROVIDER_VOTE_LANES_JSON:
                  JSON.stringify([
                    {
                      providerKind: "ocr",
                      providerVoteIdentityHash: hash("paired-ocr-vote"),
                    },
                  ]),
              }
            : {}),
          REVIEW_ROUTER_REVIEW_V2_PROJECTION_POLICY_VERSION:
            "review-projection-policy.v7-lifecycle-verification",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED: gateway ? "1" : "0",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: upstream.origin,
          REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN: upstream.origin,
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER:
            lifecycleGatewayFixtureControlBearer,
          REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: JSON.stringify({
            profiles: [
              {
                profileRef: gatewayProfileRef,
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
                  profileId: gatewayProfileRef,
                  protocol: "openai-responses",
                  modelIds:
                    production && gateway
                      ? ["enrollment-anchor-only"]
                      : [model],
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
      await upstream.bindResolutionWriterDatabase(owned.prisma);
      let callerFetch: typeof owned.fakeGitHub.fetch | undefined;
      if (gateway)
        await selectSavedGateway(owned, production, gatewayProfileRef);
      else callerFetch = await selectProductionModelRoute(owned, route);
      upstream.setGatewayOwner(owned);
      if (realCheckout) owned.setRevision(realCheckout.revision());
      const githubFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const origin = new URL(
          input instanceof Request ? input.url : String(input),
        ).origin;
        return origin === apiOrigin
          ? apiFetch(input, init)
          : origin === upstream.origin ||
              origin ===
                upstream.writerEnvironment
                  .REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_URL
            ? networkFetch(input, init)
            : githubFetch(input, init);
      };
      const threads = nativeThreads(
        owned.fakeGitHub,
        scenario,
        realCheckout,
        callerFetch,
      );
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
      if (gateway) {
        if (!owned.routes.accountGatewayRelay)
          throw new Error("paired_lifecycle_real_relay_required");
        await registerReviewRunGatewayRelayRoutes(
          app,
          owned.routes.accountGatewayRelay,
        );
      }
      if (production) {
        const checkoutRoutes = gateway
          ? owned.routes.accountGatewayCheckout
          : owned.routes.modelRouteCheckout;
        if (!checkoutRoutes || !owned.routes.reviewSkills)
          throw new Error(
            "paired_production_checkout_and_skills_routes_required",
          );
        await registerReviewRunCheckoutRoute(app, checkoutRoutes);
        await registerReviewRunSkillsRoute(app, owned.routes.reviewSkills);
        await registerReviewRunControlV2Routes(app, owned.routes.runControl);
      }
      const hosted =
        routeName === "hosted-pool"
          ? await prepareHostedProductionRoute(
              owned,
              app,
              networkFetch,
              upstream.origin,
              route.provider,
            )
          : undefined;
      if (unified) {
        if (!owned.routes.modelDispatch)
          throw new Error("paired_lifecycle_model_dispatch_route_required");
        await registerReviewModelDispatchRoutes(
          app,
          owned.routes.modelDispatch,
        );
        apiOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
        apiFetch = loopbackApiFetch(apiOrigin, tls!.cert, (value) =>
          apiRejections.push(value),
        );
        // Native transport intentionally uses agent:false. Supply only this
        // disposable peer's CA while retaining actual HTTPS and hostname checks.
        const nativeRequest = https.request;
        vi.spyOn(https, "request").mockImplementation(((
          url: URL | string,
          options: https.RequestOptions,
          callback: any,
        ) => {
          const target = new URL(url);
          const upstreamEndpoint =
            route.descriptor?.fixedResponsesUrl ??
            "https://chatgpt.com/backend-api/codex/responses";
          if (!gateway && target.href === upstreamEndpoint) {
            return httpRequest(`${upstream.origin}/native`, options, callback);
          }
          return nativeRequest(
            url,
            {
              ...options,
              ...(target.origin === apiOrigin ? { ca: tls!.cert } : {}),
            },
            callback,
          );
        }) as typeof https.request);
        syncBuiltinESMExports();
      }
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
        modelDispatchModule,
        modelTransportModule,
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
        load(
          "src/review-orchestration/infrastructure/prepared-model-dispatch.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/account-gateway-model-transport.ts",
        ),
      ]);
      const client = new clientModule.ReviewActionV2Client({
        apiUrl: apiOrigin ?? "https://paired.example",
        ...(unified ? { allowInsecureLocalhost: true } : {}),
        maxAttempts: 1,
        fetchImpl: unified
          ? apiFetch
          : async (input: RequestInfo | URL, init?: RequestInit) => {
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
            writers: createPrismaResolutionWriterQualification({
              prisma: owned.prisma,
              env: owned.env,
            }),
          },
        ),
      ).toEqual({ status: "guarded" });
      const activation =
        await owned.prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: owned.repositoryConnectionId },
          select: { lifecycleResolutionActivatedAt: true },
        });
      expect(activation.lifecycleResolutionActivatedAt).not.toBeNull();
      if (production) {
        await runProductionRunnerCase();
        return;
      }
      // First ordinary v1 discovery remains valid with the upgraded producer.
      const firstAuth = await owned.authorize({ sourceRunAttempt: "1" });
      const firstNative = adapterModule.projectReviewRunAuthorization(
        firstAuth.result,
      );
      const firstControl = control(firstAuth.result);
      const initialPlan = domainModule.createStableReviewWorkPlan({
        ...planInput(firstNative),
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
        extensionId: `lifecycle-verification.v${version}`,
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
      expect(
        cp.readCapturedResolutionHistory(),
        "captured native history",
      ).toHaveLength(4);
      const planningHistoryStates: string[] = [];
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
              planningHistoryStates.push(prior.state);
              expect(prior.state).toBe("no_prior_since_creation");
              return prior;
            },
          },
          isPathAllowed: () => true,
        },
      );
      expect(
        revalidation.packets,
        JSON.stringify({
          dispositions: revalidation.dispositions,
          planningHistoryStates,
        }),
      ).toHaveLength(1);
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
      const valid = ["success", "denied", "unknown", "stale_head"].includes(
        scenario,
      );
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
      const verificationDispatches = dispatches.filter(
        (item) => item.role === "lifecycle_verification",
      );
      const verifierCalled = !["forged_claim", "budget_exhausted"].includes(
        scenario,
      );
      expect(upstream.requests()).toBe(
        (unified ? 4 : 0) + (verifierCalled ? 1 : 0),
      );
      expect(dispatches).toHaveLength(
        (unified ? 2 : 0) + (verifierCalled ? 1 : 0),
      );
      expect(verificationDispatches).toHaveLength(verifierCalled ? 1 : 0);
      if (verificationDispatches[0])
        expect(verificationDispatches[0]).toMatchObject({
          state: scenario === "paid_unknown" ? "effect_unknown" : "completed",
          role: "lifecycle_verification",
          providerRequestEnvelopeHash: hash(upstream.lastRequest()),
        });
      if (unified) {
        expect(snapshot.agent.agentKind).toBe("ocr");
        expect(capability).toMatchObject({
          routeIdentityHash:
            snapshot.modelDispatchCapability!.routeIdentityHash,
        });
        const discoveries = dispatches
          .filter((item) => item.role === "finding_discovery")
          .sort((left, right) => left.requestOrdinal! - right.requestOrdinal!);
        expect(discoveries.map((item) => item.requestOrdinal)).toEqual([1, 2]);
        for (const receipt of dispatches) {
          if (
            receipt.role === "lifecycle_verification" &&
            scenario === "paid_unknown"
          ) {
            expect(receipt.terminalReceiptJson).toBeNull();
            continue;
          }
          expect(receipt).toMatchObject({
            dispatchVersion: 2,
            state: "completed",
            nativeEffectState: "completed",
            routeIdentityHash:
              snapshot.modelDispatchCapability!.routeIdentityHash,
            terminalReceiptJson: {
              actualModel: model,
              usage: { outputTokens: 100 },
            },
          });
        }
        if (["forged_claim", "budget_exhausted"].includes(scenario))
          expect(apiRejections).toContainEqual({
            status: 409,
            code:
              scenario === "forged_claim"
                ? "companion_lease_mismatch"
                : "model_dispatch_budget_exhausted",
          });
        const paidCalls = upstream.requests();
        const restored = await cp.restoreExecution({
          authorization: native,
          reviewRevisionHash: native.facts.reviewRevisionHash,
        });
        expect(restored).toMatchObject({
          executionId: second.execution.executionId,
          planHash: expanded.plan.planHash,
          persistedPlan: {
            planHash: expanded.plan.planHash,
            acceptedManifests: expect.arrayContaining(
              second.accepted.map(({ workSlotId, observation }) =>
                expect.objectContaining({
                  workSlotId,
                  providerInvocationKey: observation.providerInvocationKey,
                  providerVoteIdentityHash:
                    observation.providerVoteIdentityHash,
                }),
              ),
            ),
          },
        });
        expect(restored?.persistedPlan?.acceptedManifests).toHaveLength(
          second.accepted.length,
        );
        expect(upstream.requests()).toBe(paidCalls);
      }
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
      if (scenario === "stale_head") {
        const paidCalls = upstream.requests();
        const comments = owned.fakeGitHub.comments.length;
        owned.setRevision({
          baseSha: "c".repeat(40),
          mergeBaseSha: "d".repeat(40),
          headSha: "2".repeat(40),
        });
        await owned.processFinalizedOutbox();
        await owned.runWorkerUntilSettled();
        expect(
          await owned.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
            where: { executionId: second.execution.executionId },
            select: { state: true, terminalOutcome: true },
          }),
        ).toEqual({
          state: "terminal",
          terminalOutcome: "superseded_no_effect",
        });
        expect(threads.resolveCalls()).toBe(0);
        expect(threads.closed()).toHaveLength(0);
        expect(owned.fakeGitHub.comments).toHaveLength(comments);
        expect(upstream.requests()).toBe(paidCalls);
        expect(
          await owned.prisma.finalizedReviewProjectionArtifactV2.findFirstOrThrow(
            {
              where: { executionId: second.execution.executionId },
            },
          ),
        ).toMatchObject({
          projectionEnvelopeCanonicalJson: frozen.json,
          projectionHash: frozen.hash,
          artifactHash: frozen.artifactHash,
        });
        return;
      }
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
          await expect(owned.runWorkerUntilSettled(1)).rejects.toThrow(
            "review_v2_e2e_worker_did_not_settle",
          );
          expect(new Set(threads.requestThreads()).size).toBe(
            threads.requestThreads().length,
          );
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

      async function runProductionRunnerCase() {
        if (!realCheckout || !ocrBinary || !apiOrigin)
          throw new Error("paired_production_fixture_required");
        const checkout = realCheckout;
        const [runnerModule, ocrBootstrap, gatewayRuntime] = await Promise.all([
          load(
            "src/review-orchestration/infrastructure/production-t0-review-runner.ts",
          ),
          load("src/codex-oauth/ocr-managed-bootstrap.ts"),
          load("src/codex-oauth/account-gateway-runtime.ts"),
        ]);
        const progress: string[] = [];
        const oidcUrl = "https://paired.actions.githubusercontent.com/token";
        const oidcRequestToken = "paired-actions-oidc-request-token";
        const audience = owned.env.REVIEW_ROUTER_ACTION_OIDC_AUDIENCE;
        vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_URL", oidcUrl);
        vi.stubEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN", oidcRequestToken);
        const providerInstanceId = canonicalCodexRotatingProviderId(
          owned.fakeGitHub.options.repositoryId,
        );
        const workflowSchemaVersion =
          CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2;
        const repository = "reviewrouter-e2e/disposable-review-v2";
        const run = async (
          authorization: Awaited<ReturnType<typeof owned.authorize>>,
        ) => {
          const runner = runnerModule.createProductionT0ReviewRunner({
            // Only the GitHub OIDC boundary is controlled. The resulting JWT is
            // signed by the fixture's real issuer key and renewed through the
            // production HTTP route, authorization service and database.
            fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
              const request = new Request(input, init);
              const url = new URL(request.url);
              if (`${url.origin}${url.pathname}` !== oidcUrl)
                return apiFetch(input, init);
              expect(request.method).toBe("GET");
              expect(url.searchParams.get("audience")).toBe(audience);
              expect(request.headers.get("authorization")).toBe(
                `Bearer ${oidcRequestToken}`,
              );
              return Response.json({
                value: (await owned.createRenewRequest(authorization))
                  .oidcToken,
              });
            },
            progress: {
              report: (event: { type: string }) => progress.push(event.type),
            },
          });
          const plane = new adapterModule.ReviewActionV2ControlPlaneAdapter(
            client,
          );
          await plane.authorize({
            oidcToken: (await owned.createRenewRequest(authorization))
              .oidcToken,
          });
          const native = plane.currentAuthorization();
          const controller = new AbortController();
          const transport = gateway
            ? new modelTransportModule.AccountGatewayModelTransport(
                apiOrigin,
                () => plane.currentAuthorization().authorizationToken,
              )
            : undefined;
          const checkoutValue = gateway
            ? await transport!.checkoutCapability(
                { providerInstanceId, workflowSchemaVersion },
                controller.signal,
              )
            : await (async () => {
                const response = await apiFetch(
                  new URL("/api/action/v2/model-route/checkout", apiOrigin),
                  {
                    method: "POST",
                    headers: {
                      authorization: `Bearer ${native.authorizationToken}`,
                      "content-type": "application/json",
                    },
                    body: JSON.stringify({
                      transport: route.transport,
                      providerIndex: 0,
                      workflowSchemaVersion: 2,
                    }),
                  },
                );
                return {
                  httpStatus: response.status,
                  value: await response.json(),
                };
              })();
          expect(
            checkoutValue.httpStatus,
            JSON.stringify(checkoutValue.value),
          ).toBe(200);
          const capability = gatewayRuntime.validateAccountGatewayCheckout(
            checkoutValue,
            repository,
            native.facts.headSha,
          );
          const runtimeEnv = capability.runtimeConfig.runtimeEnv;
          const dispatchCapability = JSON.parse(
            runtimeEnv[reviewModelDispatchContract.capabilityRuntimeEnvKey],
          );
          expect(dispatchCapability).toMatchObject({
            transport: route.transport,
            model,
            maxRequests: gateway ? 9 : 32,
            wireProtocol: route.protocol,
          });
          const dispatch = new modelDispatchModule.PreparedModelDispatch({
            apiUrl: apiOrigin,
            capability: dispatchCapability,
            authorization: () => plane.currentAuthorization(),
            fetchImpl: apiFetch,
          });
          let bridge: any;
          if (gateway) {
            transport!.setModelDispatch(dispatch);
            bridge = await modelTransportModule.startLocalGatewayModelTransport(
              transport!,
            );
          } else if (route.mode) {
            bridge =
              await modelTransportModule.startDirectProviderApiModelTransport(
                route.mode,
                () => "paired-native-credential",
                {
                  requestMs: 60_000,
                  streamFrameBytes: 64 * 1024,
                  modelDispatch: dispatch,
                },
              );
          } else if (routeName === "codex-subscription") {
            bridge =
              await modelTransportModule.startRunnerLocalCodexSubscriptionModelTransport(
                {
                  credential: {
                    accessToken: "paired-native-credential",
                    accountId: "paired-original-account",
                    credentialValidUntil:
                      Date.parse(dispatchCapability.deadline) + 60_000,
                  },
                  modelDispatch: dispatch,
                  reasoningEffort: runtimeEnv.CODEX_REASONING_EFFORT ?? null,
                  signal: controller.signal,
                },
              );
          } else if (routeName === "claude-subscription") {
            const claude = await load(
              "src/codex-oauth/claude-subscription-bootstrap.ts",
            );
            const credential = claude.prepareClaudeSubscriptionCredential({
              env: {
                CLAUDE_CODE_OAUTH_TOKEN: `sk-ant-oat01-${"a".repeat(80)}`,
              },
              signal: controller.signal,
            });
            bridge = await claude.prepareClaudeSubscriptionModelRoute({
              runtimeConfig: capability.runtimeConfig,
              modelDispatch: dispatch,
              credential,
              signal: controller.signal,
              fetchImpl: async (
                input: RequestInfo | URL,
                init?: RequestInit,
              ) => {
                expect(String(input)).toBe(
                  "https://api.anthropic.com/v1/messages",
                );
                expect(new Headers(init?.headers).get("authorization")).toBe(
                  `Bearer sk-ant-oat01-${"a".repeat(80)}`,
                );
                return networkFetch(`${upstream.origin}/native`, {
                  ...init,
                  headers: {
                    ...Object.fromEntries(new Headers(init?.headers)),
                    authorization: "Bearer paired-native-credential",
                  },
                });
              },
            });
          } else if (hosted) {
            const grant = await hosted.prepareHead(
              authorization.sourceRunAttempt ?? "1",
            );
            bridge =
              await modelTransportModule.startHostedPoolCodexModelTransport({
                apiUrl: apiOrigin,
                authorization: () =>
                  plane.currentAuthorization().authorizationToken,
                readGrant: () => grant.opaque,
                modelDispatch: dispatch,
                reasoningEffort: runtimeEnv.CODEX_REASONING_EFFORT ?? null,
                signal: controller.signal,
              });
          } else throw new Error("paired_hosted_route_preparation_required");
          let ocrRun: any;
          let pending: Promise<void> | undefined;
          try {
            const approvedAgent = ocrBootstrap.readApprovedOcrReviewAgent(
              runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_JSON,
              runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_DIGEST,
            );
            expect(approvedAgent).toMatchObject({
              agentKind: "ocr",
              packageVersion: "1.13.1-rr.6",
              binarySha256: pairedOcrBinarySha256,
            });
            ocrRun = await ocrBootstrap.prepareOcrManagedRun({
              approvedAgent,
              baseUrl: bridge.baseUrl,
              rawCapability: bridge.environment[
                modelTransportModule.LOCAL_MODEL_CAPABILITY_ENV
              ].slice("Bearer ".length),
              model,
              protocol:
                route.protocol === "anthropic-messages"
                  ? "anthropic-messages"
                  : "openai-responses",
              requestTimeoutSec: 60,
              modelReasoningEffort: runtimeEnv.CODEX_REASONING_EFFORT ?? null,
              admittedRuntimeConfig: capability.runtimeConfig,
              language: runtimeEnv.REVIEW_OUTPUT_LANGUAGE ?? null,
              signal: controller.signal,
              env: { ...process.env, REVIEWROUTER_OCR_BINARY: ocrBinary },
            });
            let done = false;
            let result: any;
            let failure: unknown;
            pending = runner
              .run({
                apiUrl: apiOrigin,
                audience,
                providerInstanceId,
                workflowSchemaVersion,
                repository,
                pullRequestNumber: 42,
                headSha: native.facts.headSha,
                workspacePath: checkout.root,
                scmReadToken: capability.token,
                scmReadTokenExpiresAt: capability.expiresAt,
                refreshScmReadToken: async () => ({
                  token: capability.token,
                  expiresAt: capability.expiresAt,
                }),
                ...(gateway
                  ? {
                      accountGateway: {
                        runtimeConfig: capability.runtimeConfig,
                        signal: controller.signal,
                        controlPlane: plane,
                        modelTransport: bridge,
                      },
                    }
                  : {
                      preparedRoute: {
                        runtimeConfig: capability.runtimeConfig,
                        signal: controller.signal,
                        controlPlane: plane,
                        modelTransport: bridge,
                      },
                    }),
                ocr: { run: ocrRun, effectFacts: bridge.failureFact },
              })
              .then(
                (value: unknown) => {
                  result = value;
                  done = true;
                },
                (error: unknown) => {
                  failure = error;
                  done = true;
                },
              );
            const deadline = Date.now() + 90_000;
            while (!done) {
              if (Date.now() >= deadline)
                throw new Error("paired_production_runner_deadline");
              // The real runner polls the publication receipt. Its real worker
              // must consume the finalized outbox while that promise is active.
              await owned.processFinalizedOutbox();
              await owned.runWorkerUntilSettled();
              if (!done)
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            await pending;
            if (failure) throw failure;
            expect(
              result,
              JSON.stringify({
                result,
                progress,
                apiRejections,
                kinds: upstream.nativeKinds(),
                transportFailure: bridge.failureFact?.(),
                hostedDiagnostics: hosted?.diagnostics,
                hostedSessions: hosted?.sessions,
              }),
            ).toMatchObject({ outcome: "completed" });
            expect(result.publicationReceipt).toBeDefined();
            await owned.processFinalizedOutbox();
            await owned.runWorkerUntilSettled();
            const execution =
              await owned.prisma.reviewExecutionV2.findFirstOrThrow({
                where: { authorizationId: authorization.authorizationId },
              });
            const artifact =
              await owned.prisma.finalizedReviewProjectionArtifactV2.findFirstOrThrow(
                { where: { executionId: execution.executionId } },
              );
            const dispatches =
              await owned.prisma.reviewRunCompanionDispatchV1.findMany({
                where: { authorizationId: authorization.authorizationId },
              });
            expect(
              dispatches.every((dispatch) => dispatch.state === "completed"),
            ).toBe(true);
            expect(
              new Set(dispatches.map((dispatch) => dispatch.routeIdentityHash)),
            ).toEqual(new Set([dispatchCapability.routeIdentityHash]));
            expect(dispatches.length).toBeLessThanOrEqual(
              dispatchCapability.maxRequests,
            );
            if (hosted) {
              const grant = await hosted.inspect(
                authorization.sourceRunAttempt ?? "1",
              );
              expect(grant).toMatchObject({
                activeAccountId: "paired-original-account",
                failoverCount: 0,
                requestCount: dispatches.length,
                inFlight: 0,
              });
              expect(grant.relayRequests).toHaveLength(dispatches.length);
              expect(
                grant.relayRequests.every(
                  (request) =>
                    request.status === "succeeded" &&
                    request.upstreamAttempts.length === 1 &&
                    request.upstreamAttempts[0]?.state === "succeeded" &&
                    request.upstreamAttempts[0]?.accountId ===
                      grant.activeAccountId,
                ),
              ).toBe(true);
              expect(
                hosted.sessions.every(
                  (account) => account === grant.activeAccountId,
                ),
              ).toBe(true);
            }
            return {
              result,
              execution,
              artifact,
              dispatches,
              requestBudget: dispatchCapability.maxRequests,
              envelope: JSON.parse(artifact.projectionEnvelopeCanonicalJson),
            };
          } finally {
            controller.abort();
            await pending;
            await bridge.dispose();
            await ocrRun?.cleanup();
          }
        };

        const authorize = (attempt: string) =>
          owned
            .authorize({
              sourceRunAttempt: attempt,
              ...(route.mode ? { providerApiAuthMode: route.mode } : {}),
            })
            .catch((cause: unknown) => {
              const issues =
                cause && typeof cause === "object" && "issues" in cause
                  ? cause.issues
                  : undefined;
              throw new Error(
                `paired_production_admission:${route.name}:${JSON.stringify(issues)}`,
                { cause },
              );
            });
        upstream.setDiscovery(
          oldClaims.map((claim, index) =>
            legacyFinding(claim[0], claim[1], claim[2], String(index + 1)),
          ),
          checkout.currentSource(),
        );
        await hosted?.prepareHead("1");
        const firstAuthorization = await authorize("1");
        const first = await run(firstAuthorization);
        expect(first.envelope.coverage.state).toBe("complete");
        expect(first.envelope.snapshot.lineageHints).toHaveLength(4);
        expect(
          first.dispatches.every(
            (dispatch) => dispatch.role === "finding_discovery",
          ),
        ).toBe(true);
        expect(first.dispatches.length).toBeGreaterThan(0);
        expect(threads.publishedComments()).toHaveLength(4);
        expect(threads.observed()).toHaveLength(4);
        expect(threads.closed()).toHaveLength(0);
        for (const [title] of oldClaims)
          expect(
            threads
              .publishedComments()
              .some((comment) => String(comment.body).includes(title)),
          ).toBe(true);
        const firstCalls = upstream.requests();
        expect(firstCalls).toBe(first.dispatches.length);

        checkout.advance();
        owned.setRevision(checkout.revision());
        const newTitle = "Negative rounding drops a cent";
        upstream.setDiscovery(
          [
            legacyFinding(
              newTitle,
              "Math.round rounds negative half cents toward positive infinity and loses a refund cent.",
              7,
              "8",
              "minor",
            ),
          ],
          checkout.currentSource(),
        );
        await hosted?.prepareHead("2");
        const secondAuthorization = await authorize("2");
        const second = await run(secondAuthorization);
        expect(second.envelope.coverage.state).toBe("complete");
        expect(second.envelope.publishing.summary.body).toContain(
          "2 fixes verified",
        );
        expect(second.envelope.publishing.summary.body).toContain(newTitle);
        expect(
          second.envelope.publishing.lifecycle
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
        expect(
          second.envelope.publishing.lifecycle.filter(
            (entry: { mutationEligible: boolean }) => entry.mutationEligible,
          ),
        ).toHaveLength(2);
        expect(
          second.dispatches.filter(
            (dispatch) => dispatch.role === "lifecycle_verification",
          ),
        ).toHaveLength(1);
        expect(
          second.dispatches.filter(
            (dispatch) => dispatch.role === "finding_discovery",
          ).length,
        ).toBeGreaterThan(0);
        expect(upstream.requests() - firstCalls).toBe(second.dispatches.length);
        expect(
          upstream.nativeKinds().filter((kind) => kind === "verifier"),
        ).toHaveLength(1);
        expect(threads.resolveCalls()).toBe(2);
        expect(threads.closed()).toHaveLength(2);
        expect(
          threads.observed().filter((thread) => !thread.isResolved),
        ).toHaveLength(3);
        expect(threads.publishedComments()).toHaveLength(5);
        expect(
          threads
            .observed()
            .filter((thread) => !thread.isResolved)
            .map((thread) => thread.body)
            .join("\n"),
        ).toContain(oldClaims[2][0]);
        expect(
          threads
            .observed()
            .filter((thread) => !thread.isResolved)
            .map((thread) => thread.body)
            .join("\n"),
        ).toContain(oldClaims[3][0]);
        expect(
          progress.filter((event) => event === "initialized"),
        ).toHaveLength(2);
        expect(progress.filter((event) => event === "accepted")).toHaveLength(
          3,
        );
        expect(progress.filter((event) => event === "publishing")).toHaveLength(
          2,
        );
        expect(
          owned.fakeGitHub.comments.every(
            (comment) => comment.user.login === "reviewrouter-e2e[bot]",
          ),
        ).toBe(true);
        expect(
          threads
            .publishedComments()
            .every(
              (comment) =>
                (comment.user as { login: string }).login ===
                "reviewrouter-e2e[bot]",
            ),
        ).toBe(true);

        const callsBeforeRetry = upstream.requests();
        const reviewsBeforeRetry = threads.publishedComments().length;
        const resolveBeforeRetry = threads.resolveCalls();
        // Ordinary renewable routes restore the same admitted run with its
        // current bearer; the original token may have been renewed during A/B.
        const repeated = await run(await authorize("2"));
        expect(repeated.result.publicationReceipt).toEqual(
          second.result.publicationReceipt,
        );
        expect(repeated.execution.executionId).toBe(
          second.execution.executionId,
        );
        expect(repeated.artifact.artifactHash).toBe(
          second.artifact.artifactHash,
        );
        expect(repeated.dispatches).toHaveLength(second.dispatches.length);
        expect(upstream.requests()).toBe(callsBeforeRetry);
        expect(threads.publishedComments()).toHaveLength(reviewsBeforeRetry);
        expect(threads.resolveCalls()).toBe(resolveBeforeRetry);
        expect(apiRejections).toEqual([]);
        console.info("paired_production_runner_acceptance", {
          route: route.name,
          binarySha256: pairedOcrBinarySha256,
          firstHead: {
            findings: first.envelope.snapshot.lineageHints.length,
            discoveryRequests: first.dispatches.length,
            requestBudget: first.requestBudget,
          },
          secondHead: {
            discoveryRequests: second.dispatches.filter(
              (dispatch) => dispatch.role === "finding_discovery",
            ).length,
            verifierRequests: second.dispatches.filter(
              (dispatch) => dispatch.role === "lifecycle_verification",
            ).length,
            requestBudget: second.requestBudget,
            nativeResolveCalls: threads.resolveCalls(),
            unresolvedThreads: threads
              .observed()
              .filter((thread) => !thread.isResolved).length,
          },
          nativeRequestKinds: upstream.nativeKinds(),
          completedReplay: {
            providerRequestDelta: upstream.requests() - callsBeforeRetry,
            publishedCommentDelta:
              threads.publishedComments().length - reviewsBeforeRetry,
            nativeResolveDelta: threads.resolveCalls() - resolveBeforeRetry,
          },
        });
      }

      function planInput(auth: any) {
        return {
          reviewRevisionHash: auth.facts.reviewRevisionHash,
          compatibilityKey: hash("paired-runtime"),
          providers: [
            {
              providerName: engineKind,
              providerKind: engineKind,
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
        const captured = parseReviewRunRuntimeSnapshot(
          (
            await owned.prisma.reviewRunAuthorization.findUniqueOrThrow({
              where: { authorizationId: auth.authorizationId },
              select: { runtimeSnapshotCanonicalJson: true },
            })
          ).runtimeSnapshotCanonicalJson,
        )!;
        const preparedDispatch = unified
          ? new modelDispatchModule.PreparedModelDispatch({
              apiUrl: apiOrigin,
              capability: captured.modelDispatchCapability,
              authorization: () => ({
                authorizationId: auth.authorizationId,
                authorizationToken: auth.authorizationToken,
              }),
              fetchImpl: apiFetch,
            })
          : undefined;
        const preparedTransport = unified
          ? new modelTransportModule.AccountGatewayModelTransport(
              apiOrigin,
              () => auth.authorizationToken,
            )
          : undefined;
        if (preparedTransport)
          preparedTransport.setModelDispatch(preparedDispatch);
        upstream.setDiscovery(findings);
        const discoveryPort = {
          prepare: async ({ workSlot }: any) => ({
            workSlotId: workSlot.workSlotId,
            attemptOrdinal: 1,
            provider: engineKind,
            requestedModel: model,
            reviewPrompt: "Bounded synthetic discovery",
            investigationContextPrompt: null,
            immutableRequest: Buffer.from("bounded-discovery"),
            manifestFacts: {
              taskKindSet: ["finding_discovery"],
              providerKind: engineKind,
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
          execute: async ({ invocation, signal }: any) => {
            let completedFindings = findings;
            if (preparedTransport) {
              // The engine boundary is a controlled fixture. Both distinct
              // discovery turns still traverse the real public transport,
              // production relay and durable allowance before evidence exists.
              for (const turn of ["context", "findings"]) {
                const request = Buffer.from(
                  JSON.stringify({
                    model,
                    stream: true,
                    reasoning: null,
                    max_output_tokens: 4096,
                    input: [
                      {
                        role: "user",
                        content: [
                          {
                            type: "input_text",
                            text: JSON.stringify({
                              fixture: "paired-discovery",
                              turn,
                              headSha: auth.facts.headSha,
                              path: filePath,
                              source,
                            }),
                          },
                        ],
                      },
                    ],
                  }),
                );
                const response = await preparedTransport.responses(
                  request,
                  signal,
                );
                if (response.httpStatus !== 200) {
                  response.cancel();
                  throw new Error(
                    `paired_discovery_dispatch_denied:${response.httpStatus}`,
                  );
                }
                const chunks: Buffer[] = [];
                for await (const chunk of response.body)
                  chunks.push(Buffer.from(chunk));
                await preparedTransport.drainSettlements();
                const completed = completedResponse(
                  Buffer.concat(chunks).toString("utf8"),
                );
                expect(completed.model).toBe(model);
                completedFindings = JSON.parse(
                  completed.output[0].content[0].text,
                ).findings;
              }
            }
            return normalizerModule.normalizeReviewObservation({
              workSlotId: invocation.workSlotId,
              attemptOrdinal: 1,
              providerName: engineKind,
              requestedModel: model,
              result: {
                content: "",
                actualModel: model,
                findings: completedFindings,
              },
            });
          },
        };
        const invocationPort = verification
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
                  ...bounds
                }: any) => {
                  const context =
                    scenario === "forged_claim"
                      ? { ...dispatch, preparedManifestKey: "0".repeat(64) }
                      : dispatch;
                  if (preparedTransport)
                    return preparedTransport.generateLifecycleVerification({
                      requestBody,
                      dispatch: context,
                      ...bounds,
                    });
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
                  const completed = completedResponse(response.body);
                  return {
                    body: Buffer.from(completed.output[0].content[0].text),
                    actualModel: completed.model,
                    providerRequestEnvelopeHash: hash(requestBody),
                  };
                },
              },
            })
          : discoveryPort;
        const port = preparedTransport
          ? modelDispatchModule.scopedModelInvocations(
              invocationPort,
              preparedTransport,
            )
          : invocationPort;
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
              ["success", "denied", "unknown", "stale_head"].includes(scenario)
            )
              throw error;
            if (scenario === "paid_unknown") {
              expect(String(error)).toMatch(
                /account_gateway_transport_unknown|lifecycle_verification_dispatch_unavailable|aborted|terminated|ECONNRESET/,
              );
              const paidCalls = upstream.requests();
              const resumed = new modelDispatchModule.PreparedModelDispatch({
                apiUrl: apiOrigin,
                capability: captured.modelDispatchCapability,
                authorization: () => ({
                  authorizationId: auth.authorizationId,
                  authorizationToken: auth.authorizationToken,
                }),
                fetchImpl: apiFetch,
              });
              const release = resumed.beginInvocation(() => ({
                executionId,
                workSlotId: workSlot.workSlotId,
                attemptOrdinal: 1,
                leaseId: lease.leaseId,
                leaseCapability: lease.leaseCapability,
                fencingToken: lease.fencingToken,
                preparedManifestKey: manifest.manifestKey,
              }));
              try {
                await expect(
                  resumed.reserve(
                    upstream.lastRequest(),
                    new AbortController().signal,
                  ),
                ).rejects.toThrow("model_dispatch_claim_unavailable");
              } finally {
                release();
              }
              expect(upstream.requests()).toBe(paidCalls);
            } else
              expect(String(error)).toContain(
                ["forged_claim", "budget_exhausted"].includes(scenario)
                  ? unified
                    ? "account_gateway_transport_unknown"
                    : "paired_relay_denied:409:companion_lease_mismatch"
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
      syncBuiltinESMExports();
      vi.unstubAllEnvs();
      await app.close();
      await upstream.close();
      await fixture?.close();
      if (fixture) await resetReviewActionV2E2EDatabase(databaseUrl!);
      realCheckout?.close();
    }
  },
  120_000,
);

const pairedOcrBinarySha256 =
  "9dd5f115747d24100f0767133a3288d268f3bc399675f5b826e7a867d101ee5c";

function requiredPairedOcrBinary(): string {
  const binary = process.env.REVIEW_ROUTER_PAIRED_OCR_BINARY;
  if (!binary || !path.isAbsolute(binary))
    throw new Error("paired_production_pinned_ocr_binary_required");
  if (hash(readFileSync(binary)) !== pairedOcrBinarySha256)
    throw new Error("paired_production_ocr_binary_digest_mismatch");
  return binary;
}

function createRealLifecycleCheckout() {
  const root = mkdtempSync(path.join(tmpdir(), "paired-real-ocr-lifecycle-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        root,
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "user.name=ReviewRouter paired fixture",
        "-c",
        "user.email=paired@test.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    ).trim();
  try {
    git("init", "--quiet");
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, filePath), "oldTax();\n");
    git("add", "--", filePath);
    git("commit", "--quiet", "-m", "base fixture");
    const baseSha = git("rev-parse", "HEAD");
    const initialSource = source
      .replace(
        "if (subtotal === 0) return 0;",
        "if (subtotal === 0) return 1 / subtotal;",
      )
      .replace("rate ?? 0.2", "rate || 0.2")
      .replace("Math.round", "Math.floor");
    writeFileSync(path.join(root, filePath), initialSource);
    git("add", "--", filePath);
    git("commit", "--quiet", "-m", "introduce tax review fixture");
    const firstHead = git("rev-parse", "HEAD");
    writeFileSync(path.join(root, filePath), source);
    git("add", "--", filePath);
    git("commit", "--quiet", "-m", "fix two tax defects and change rounding");
    const secondHead = git("rev-parse", "HEAD");
    git("checkout", "--quiet", "--detach", firstHead);
    const revision = () => ({
      baseSha,
      mergeBaseSha: baseSha,
      headSha: git("rev-parse", "HEAD"),
      headTreeSha: git("rev-parse", "HEAD^{tree}"),
    });
    return {
      root,
      revision,
      currentSource: () => readFileSync(path.join(root, filePath), "utf8"),
      pullRequest() {
        const diff = git(
          "diff",
          "--no-ext-diff",
          "--unified=3",
          baseSha,
          "HEAD",
          "--",
          filePath,
        );
        const lines = diff.split("\n");
        const additions = lines.filter(
          (line) => line.startsWith("+") && !line.startsWith("+++"),
        ).length;
        const deletions = lines.filter(
          (line) => line.startsWith("-") && !line.startsWith("---"),
        ).length;
        return {
          diff,
          additions,
          deletions,
          files: [
            {
              filename: filePath,
              status: "modified",
              additions,
              deletions,
              changes: additions + deletions,
              patch: lines
                .slice(lines.findIndex((line) => line.startsWith("@@")))
                .join("\n"),
            },
          ],
        };
      },
      advance() {
        git("checkout", "--quiet", "--detach", secondHead);
      },
      close() {
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

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

function completedResponse(body: string) {
  const event = body
    .split(/\r?\n/)
    .filter(
      (line) => line.startsWith("data:") && line.slice(5).trim() !== "[DONE]",
    )
    .map((line) => JSON.parse(line.slice(5).trim()))
    .find((value: { type?: string }) => value.type === "response.completed");
  if (!event?.response) throw new Error("paired_completed_response_required");
  return event.response;
}

/** The production transport requires HTTPS. Trust a fresh local certificate,
 * without disabling peer/hostname verification or changing production origin rules. */
function loopbackTls() {
  const root = mkdtempSync(path.join(tmpdir(), "rr-lifecycle-tls-"));
  try {
    const keyPath = path.join(root, "key.pem");
    const certPath = path.join(root, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-sha256",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function loopbackApiFetch(
  origin: string,
  ca: Buffer,
  rejected: (value: { status: number; code?: string }) => void,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).origin !== origin)
      throw new Error("paired_loopback_fetch_origin_mismatch");
    const bytes = request.body
      ? Buffer.from(await request.arrayBuffer())
      : undefined;
    return new Promise<Response>((resolve, reject) => {
      const outgoing = https.request(
        request.url,
        {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          signal: request.signal,
          ca,
        },
        (incoming) => {
          const status = incoming.statusCode;
          if (status === undefined) {
            incoming.resume();
            reject(new Error("paired_loopback_response_status_missing"));
            return;
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(",") : value);
          const response = new Response(
            Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
            {
              status,
              headers,
            },
          );
          if (!response.ok)
            void response
              .clone()
              .json()
              .then((value: { code?: string }) => {
                rejected({
                  status: response.status,
                  ...(value.code === undefined ? {} : { code: value.code }),
                });
                resolve(response);
              }, reject);
          else resolve(response);
        },
      );
      outgoing.once("error", reject);
      outgoing.end(bytes);
    });
  };
}

async function selectSavedGateway(
  fixture: ReviewActionV2E2EHarness,
  production = false,
  profileRef = "paired-responses-v1",
) {
  const connection = await fixture.prisma.providerAccountConnection.create({
    data: {
      ownerWorkspaceId: fixture.workspaceId,
      gatewayAccountRef: `${fixture.prefix}-account`,
      profileRef,
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
          ...(production ? { updatePrDescription: false } : {}),
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
async function controlledGateway(
  scenario: Scenario,
  route = productionModelRoute(),
) {
  const model = route.model;
  let gatewayOwner: { accountRef: string; ownerRef: string } | undefined;
  const gatewayProfile =
    scenario === "production_runner"
      ? "openrouter-openai-responses-apikey-v1"
      : "paired-responses-v1";
  let packet: Packet | undefined;
  let discoveryFindings: readonly unknown[] = [];
  let discoverySource = source;
  let nativeMainTurn = 0;
  const nativeRequestKinds: string[] = [];
  let calls = 0;
  let last = Buffer.alloc(0);
  const admissions = new Map<string, Record<string, unknown>>();
  const uncertainRequests = new Set<string>();
  const writer = await createPairedResolutionWriterFixture();
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
      if (request.url?.startsWith("/v1/accounts/")) {
        expect(request.headers.authorization).toBe(
          `Bearer ${lifecycleGatewayFixtureControlBearer}`,
        );
        if (
          !gatewayOwner ||
          request.url !== `/v1/accounts/${gatewayOwner.accountRef}`
        )
          throw new Error("paired_gateway_account_scope_mismatch");
        json(200, {
          ...gatewayOwner,
          profileId: gatewayProfile,
          displayName: "Synthetic original account",
          state: "active",
          metadataRevision: 1,
          authorizationEpoch: 1,
        });
        return;
      }
      if (request.url === "/v1/account-models/read") {
        expect(request.headers.authorization).toBe(
          `Bearer ${lifecycleGatewayFixtureControlBearer}`,
        );
        expect(body).toMatchObject({
          ...gatewayOwner,
          profileId: gatewayProfile,
          expectedAuthorizationEpoch: 1,
        });
        json(200, {
          status: "snapshot",
          physicalGeneration: "paired-generation",
          principalVersion: "paired-principal",
          source: "openrouter",
          fetchedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          models: [
            {
              modelId: model,
              reasoning: { allowed: ["high"], default: "high" },
              fast: null,
              tools: { allowed: ["function"], default: "function" },
            },
          ],
        });
        return;
      }
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
        const requestRef = request.url.split("/").at(-1)!;
        const uncertain = uncertainRequests.has(requestRef);
        json(200, {
          requestRef,
          effect: uncertain ? "effect_unknown" : "completed",
          status: uncertain ? "pending" : "completed",
        });
        return;
      }
      if (request.url?.endsWith("/close")) {
        json(200, { operationRef: body.operationId, state: "applied" });
        return;
      }
      if (
        request.method === "POST" &&
        (request.url?.endsWith("/requests") || request.url === "/native")
      ) {
        if (request.url !== "/native") {
          expect(request.headers.authorization).toBe("Bearer paired-execution");
          const supplied = JSON.parse(
            String(request.headers["x-gateway-admission"]),
          );
          expect([...admissions.values()]).toContainEqual(supplied);
        } else {
          expect(request.headers.authorization).toBe(
            "Bearer paired-native-credential",
          );
          if (route.protocol === "codex-responses") {
            expect(request.headers["chatgpt-account-id"]).toBe(
              "paired-original-account",
            );
            expect(body).not.toHaveProperty("max_output_tokens");
          }
        }
        calls++;
        last = bytes;
        const respondNative = (output: readonly unknown[]) => {
          if (route.protocol === "anthropic-messages") {
            const content = output.map((entry: any) =>
              entry.type === "function_call"
                ? {
                    type: "tool_use",
                    id: entry.call_id,
                    name: entry.name,
                    input: JSON.parse(entry.arguments),
                  }
                : {
                    type: "text",
                    text: entry.content
                      .map((block: any) => block.text ?? "")
                      .join("\n"),
                  },
            );
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                id: `paired-message-${calls}`,
                type: "message",
                role: "assistant",
                model,
                content,
                stop_reason: content.some(
                  (entry: any) => entry.type === "tool_use",
                )
                  ? "tool_use"
                  : "end_turn",
                usage: { input_tokens: 100, output_tokens: 100 },
              }),
            );
            return;
          }
          response
            .writeHead(200, {
              "content-type": "text/event-stream",
              "x-gateway-request-ref": String(
                request.headers["x-gateway-request-id"],
              ),
            })
            .end(
              `event: response.completed\ndata: ${JSON.stringify({
                type: "response.completed",
                response: {
                  id: `paired-response-${calls}`,
                  object: "response",
                  status: "completed",
                  model,
                  output,
                  usage: {
                    input_tokens: 100,
                    output_tokens: 100,
                    total_tokens: 200,
                  },
                },
              })}\n\n`,
            );
        };
        const respondCompleted = (answer: unknown) =>
          respondNative([
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify(answer) }],
            },
          ]);
        expect(body.model).toBe(model);
        if (route.protocol !== "codex-responses")
          expect(body.max_output_tokens ?? body.max_tokens).toBeLessThanOrEqual(
            4096,
          );
        let sentPacket: Packet & { fixture?: string };
        if (scenario === "production_runner") {
          let candidate: Partial<Packet> | undefined;
          try {
            candidate = JSON.parse(
              body.input?.[0]?.content?.[0]?.text ??
                body.messages?.[0]?.content?.[0]?.text,
            );
          } catch {
            /* Native OCR prompts are text. */
          }
          if (
            candidate?.packetHash &&
            Array.isArray(candidate.targets) &&
            Array.isArray(candidate.sources)
          ) {
            // The real production planner and invocation adapter own this packet.
            // The provider fixture only answers the request it actually receives.
            packet = candidate as Packet;
            sentPacket = packet;
            nativeRequestKinds.push("verifier");
          } else {
            const toolNames = Array.isArray(body.tools)
              ? body.tools.map((tool: { name?: string }) => tool.name ?? "")
              : [];
            const functionCall = (name: string, args: unknown) => ({
              type: "function_call",
              id: `fc_${calls}`,
              call_id: `call_${calls}`,
              name,
              arguments: JSON.stringify(args),
            });
            let output: unknown[];
            if (
              toolNames.includes("task_done") ||
              toolNames.includes("code_comment")
            ) {
              nativeRequestKinds.push("main");
              output =
                ++nativeMainTurn === 1
                  ? [
                      functionCall("code_comment", {
                        comments: discoveryFindings.map((value) => {
                          const finding = value as ReturnType<
                            typeof legacyFinding
                          >;
                          return {
                            path: finding.file,
                            content: `${finding.title}\n\n${finding.message}`,
                            existing_code:
                              discoverySource.split("\n")[finding.line - 1],
                            start_line: finding.line,
                            end_line: finding.line,
                            severity:
                              finding.severity === "major" ? "high" : "medium",
                          };
                        }),
                      }),
                    ]
                  : [functionCall("task_done", {})];
            } else if (
              toolNames.includes("approve_all_comments") ||
              toolNames.includes("report_incorrect_comments")
            ) {
              nativeRequestKinds.push("filter");
              output = [functionCall("approve_all_comments", {})];
            } else {
              nativeRequestKinds.push("text");
              output = [
                {
                  type: "message",
                  id: `msg_${calls}`,
                  status: "completed",
                  role: "assistant",
                  content: [
                    {
                      type: "output_text",
                      text: "Review the tax calculation in src/review-file-000.ts.",
                      annotations: [],
                    },
                  ],
                },
              ];
            }
            respondNative(output);
            return;
          }
        } else {
          sentPacket = JSON.parse(body.input[0].content[0].text) as Packet & {
            fixture?: string;
          };
        }
        if (sentPacket.fixture === "paired-discovery") {
          respondCompleted({ findings: discoveryFindings });
          return;
        }
        expect(packet).toBeDefined();
        expect(sentPacket.packetHash).toBe(packet!.packetHash);
        expect(bytes.length).toBeLessThanOrEqual(96 * 1024);
        if (scenario === "paid_unknown") {
          uncertainRequests.add(
            String(request.headers["x-gateway-request-id"]),
          );
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "x-gateway-request-ref": String(
              request.headers["x-gateway-request-id"],
            ),
          });
          response.write(
            `data: ${JSON.stringify({ type: "response.in_progress", response: { id: "paid-unknown", status: "in_progress", model } })}\n\n`,
          );
          setTimeout(() => response.destroy(), 10);
          return;
        }
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
        respondCompleted(answer);
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
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    setGatewayOwner(fixture: ReviewActionV2E2EHarness) {
      gatewayOwner = {
        accountRef: `${fixture.prefix}-account`,
        ownerRef: `rrw_${hash(`rr-workspace-owner-v1\0${fixture.workspaceId}`)}`,
      };
    },
    writerEnvironment: writer.environment,
    bindResolutionWriterDatabase: writer.bind,
    setPacket(value: Packet) {
      packet = value;
    },
    setDiscovery(findings: readonly unknown[], sourceText = source) {
      discoveryFindings = findings;
      discoverySource = sourceText;
      nativeMainTurn = 0;
    },
    nativeKinds: () => [...nativeRequestKinds],
    requests: () => calls,
    lastRequest: () => last,
    close: async () => {
      await writer.close();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    },
  };
}

function nativeThreads(
  github: FakeGitHubTransport,
  scenario: Scenario,
  checkout?: ReturnType<typeof createRealLifecycleCheckout>,
  fallbackFetch?: typeof github.fetch,
) {
  type Thread = {
    id: string;
    isResolved: boolean;
    path: string;
    line: number;
    parent: Record<string, unknown>;
  };
  const threads: Thread[] = [];
  const reviews: Array<{
    id: number;
    body: string;
    commit_id: string;
    state: "PENDING" | "COMMENTED";
    user: { login: string };
    comments: Array<Record<string, unknown>>;
  }> = [];
  let calls = 0;
  const requestThreads: string[] = [];
  let unknownEffect = false;
  const original = fallbackFetch ?? github.fetch;
  vi.spyOn(github, "fetch").mockImplementation(async (input, init) => {
    const request =
      input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (checkout && url.hostname === "api.github.com") {
      const prefix = `/repos/${github.options.owner}/${github.options.repo}/pulls/${github.options.pullRequestNumber}`;
      if (
        request.method === "POST" &&
        url.pathname.endsWith("/access_tokens")
      ) {
        const tokenBody = await request.clone().text();
        const body = (tokenBody ? JSON.parse(tokenBody) : {}) as {
          permissions?: Record<string, string>;
        };
        if (
          body.permissions?.contents === "read" &&
          body.permissions.pull_requests === "read"
        ) {
          return Response.json(
            {
              token: "paired-scm-read-token",
              expires_at: new Date(Date.now() + 3_600_000).toISOString(),
              permissions: { contents: "read", pull_requests: "read" },
              repository_selection: "selected",
            },
            { status: 201 },
          );
        }
      }
      if (request.method === "GET" && url.pathname === prefix) {
        const pull = checkout.pullRequest();
        if (request.headers.get("accept")?.includes("diff"))
          return new Response(pull.diff, {
            headers: { "content-type": "text/plain" },
          });
        return Response.json({
          number: github.options.pullRequestNumber,
          state: "open",
          title: "Bounded tax revalidation",
          body: "",
          user: { login: "fixture" },
          labels: [],
          draft: false,
          changed_files: 1,
          additions: pull.additions,
          deletions: pull.deletions,
          base: {
            sha: github.revision.baseSha,
            repo: {
              full_name: `${github.options.owner}/${github.options.repo}`,
            },
          },
          head: { sha: github.revision.headSha },
        });
      }
      if (request.method === "GET" && url.pathname === `${prefix}/files`)
        return Response.json(checkout.pullRequest().files);
      if (url.pathname === `${prefix}/reviews`) {
        if (request.method === "GET") return Response.json(reviews);
        if (request.method === "POST") {
          expect(request.headers.get("authorization")).toMatch(
            /^(?:token|Bearer) fake-installation-token$/,
          );
          const body = (await request.json()) as {
            body: string;
            commit_id: string;
            comments: Array<Record<string, unknown>>;
          };
          expect(body.commit_id).toBe(github.revision.headSha);
          expect(body.comments.length).toBeGreaterThan(0);
          for (const comment of body.comments) {
            expect(comment.path).toBe(filePath);
            expect(Number.isSafeInteger(comment.line)).toBe(true);
            expect(Number(comment.line)).toBeGreaterThan(0);
            expect(Number(comment.line)).toBeLessThanOrEqual(
              checkout.currentSource().split("\n").length,
            );
            expect(String(comment.body)).toContain("reviewrouter:finding:v2:");
          }
          const id = 80_000 + reviews.length;
          const review = {
            id,
            body: body.body,
            commit_id: body.commit_id,
            state: "PENDING" as const,
            user: { login: "reviewrouter-e2e[bot]" },
            comments: body.comments.map((comment, index) => ({
              ...comment,
              id: id * 100 + index,
              user: { login: "reviewrouter-e2e[bot]" },
            })),
          };
          reviews.push(review);
          return Response.json(review, { status: 201 });
        }
      }
      const reviewMatch = new RegExp(
        `^${prefix}/reviews/([0-9]+)(?:/(comments|events))?$`,
      ).exec(url.pathname);
      if (reviewMatch) {
        const review = reviews.find(
          (value) => value.id === Number(reviewMatch[1]),
        );
        if (!review)
          return Response.json({ message: "Not Found" }, { status: 404 });
        if (request.method === "GET")
          return Response.json(
            reviewMatch[2] === "comments" ? review.comments : review,
          );
        if (request.method === "POST" && reviewMatch[2] === "events") {
          expect(request.headers.get("authorization")).toMatch(
            /^(?:token|Bearer) fake-installation-token$/,
          );
          const body = (await request.json()) as {
            event: string;
            body: string;
          };
          expect(body.event).toBe("COMMENT");
          expect(review.state).toBe("PENDING");
          review.state = "COMMENTED";
          review.body = body.body;
          const createdAt = new Date().toISOString();
          for (const comment of review.comments) {
            threads.push({
              id: `paired-review-thread-${comment.id}`,
              isResolved: false,
              path: String(comment.path),
              line: Number(comment.line),
              parent: {
                id: `paired-review-parent-${comment.id}`,
                databaseId: comment.id,
                viewerDidAuthor: true,
                author: { login: "reviewrouter-e2e[bot]", __typename: "Bot" },
                body: comment.body,
                createdAt,
                updatedAt: createdAt,
                publishedAt: createdAt,
                lastEditedAt: null,
                path: comment.path,
                line: comment.line,
                originalLine: comment.line,
              },
            });
          }
          return Response.json(review);
        }
      }
    }
    if (url.pathname !== "/graphql") return original(input, init);
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
      requestThreads.push(thread.id);
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
            createdAt: parentCreatedAt,
            updatedAt: parentCreatedAt,
            publishedAt: parentCreatedAt,
            lastEditedAt: null,
            path: filePath,
            line: Number(hint.line ?? 1),
            originalLine: Number(hint.line ?? 1),
          },
        });
      }
    },
    publishedComments: () =>
      reviews
        .filter((review) => review.state === "COMMENTED")
        .flatMap((review) => review.comments),
    observed: () =>
      threads.map((thread) => ({
        id: thread.id,
        isResolved: thread.isResolved,
        body: String(thread.parent.body),
      })),
    resolveCalls: () => calls,
    requestThreads: () => [...requestThreads],
    closed: () =>
      threads.filter((thread) => thread.isResolved).map((thread) => thread.id),
  };
}
