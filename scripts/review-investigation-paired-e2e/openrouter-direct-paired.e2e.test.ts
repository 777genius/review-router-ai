import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { registerReviewExecutionV2Routes } from "../../packages/features/action-control-plane/src/v2/interface/index.js";
import {
  PrismaReviewConfigurationRepository,
  parseReviewConfigurationStrict,
} from "../../packages/features/review-config/src/index.js";
import { workspacePolicyFixture } from "../../packages/features/review-config/src/tests/current-policy-fixture.js";
import { renderReviewRouterProviderApiCaller } from "../../packages/protocol-review-workflow/src/index.js";
import { registerReviewRunCheckoutRoute } from "../../apps/api/src/review-run-gateway-checkout.js";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
} from "../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";

const enabled =
  process.env.REVIEW_ROUTER_REVIEW_INVESTIGATION_PAIRED_E2E === "1";
const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const actionSourceDir = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
if (enabled && (!databaseUrl || !actionSourceDir))
  throw new Error("paired_openrouter_database_and_action_source_required");
const execFileAsync = promisify(execFile);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// Contract proof with real public preparation and private handlers. The public
// bootstrap/credential/execution tests qualify those separate runtime boundaries.
(enabled && databaseUrl && actionSourceDir ? it : it.skip)(
  "admits the actual direct OpenRouter manifest against its frozen private policy with Gateway relay disabled",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "reviewrouter-or-paired-"));
    const originalCwd = process.cwd();
    const originalEnv = { ...process.env };
    const app = Fastify();
    await resetReviewActionV2E2EDatabase(databaseUrl!);
    const fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
      // The existing helper qualifies one attempt, bounded by accepted allowance.
      protocolMaxAttemptsPerSlot: 1,
      environmentOverrides: {
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED: "0",
      },
    });
    try {
      const source = renderReviewRouterProviderApiCaller({
        runtimeRef: "a".repeat(40),
        controlPlaneUrl: fixture.env.REVIEW_ROUTER_PUBLIC_API_URL!,
      });
      await mkdir(path.join(root, ".github/workflows"), { recursive: true });
      await writeFile(
        path.join(root, ".github/workflows/reviewrouter-review.yml"),
        source,
      );
      await writeFile(
        path.join(root, "tax.js"),
        "export const total = price;\n",
      );
      const git = async (...args: string[]) =>
        (await execFileAsync("git", ["-C", root, ...args])).stdout.trim();
      await git("init", "-b", "main");
      await git("add", ".");
      const commit = () =>
        git(
          "-c",
          "user.name=fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "-m",
          "disposable fixture",
        );
      await commit();
      const baseSha = await git("rev-parse", "HEAD");
      await writeFile(
        path.join(root, "tax.js"),
        "export const total = price + taxRatePercent;\n",
      );
      await git("add", "tax.js");
      await commit();
      const headSha = await git("rev-parse", "HEAD");
      const patch = await git("diff", baseSha, headSha, "--", "tax.js");
      fixture.setRevision({ baseSha, mergeBaseSha: baseSha, headSha });
      const config = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        providers: [
          {
            kind: "openrouter",
            authMode: "openrouter_api_key",
            model: "openai/gpt-5.3-codex",
            reasoningEffort: "high",
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
          },
        ],
      });
      await new PrismaReviewConfigurationRepository(
        fixture.prisma,
      ).saveNextVersion({
        target: { scope: "workspace", workspaceId: fixture.workspaceId },
        policy: config,
        expectedVersion: 1,
      });
      const previousFetch = fixture.fakeGitHub.fetch;
      vi.spyOn(fixture.fakeGitHub, "fetch").mockImplementation(
        async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(String(input), init);
          const url = new URL(request.url);
          if (
            url.hostname === "api.github.com" &&
            decodeURIComponent(url.pathname).endsWith(
              "/contents/.github/workflows/reviewrouter-review.yml",
            )
          ) {
            expect(url.searchParams.get("ref")).toBe(headSha);
            return Response.json({
              type: "file",
              path: ".github/workflows/reviewrouter-review.yml",
              encoding: "base64",
              content: Buffer.from(source).toString("base64"),
            });
          }
          if (
            url.hostname === "api.github.com" &&
            request.method === "POST" &&
            url.pathname.endsWith("/access_tokens")
          ) {
            const rawBody = await request.clone().text();
            const body = rawBody ? JSON.parse(rawBody) : {};
            if (
              body.permissions?.contents === "read" &&
              !body.permissions?.checks &&
              !body.permissions?.issues
            )
              return Response.json(
                {
                  token: "paired-read-only-token",
                  expires_at: new Date(Date.now() + 600_000).toISOString(),
                  permissions: body.permissions,
                  repository_selection: "selected",
                },
                { status: 201 },
              );
          }
          return previousFetch(input, init);
        },
      );
      const receipt = await fixture
        .authorize({
          providerApiAuthMode: "openrouter-api",
        })
        .catch((cause: unknown) => {
          throw new Error(
            `paired_direct_authorization_failed:${JSON.stringify(fixture.fakeGitHub.calls.slice(-8))}`,
            { cause },
          );
        });
      expect(fixture.routes.accountGatewayRelay).toBeUndefined();
      expect(fixture.routes.accountGatewayCheckout).toBeUndefined();
      expect(fixture.routes.providerApiCheckout).toBeDefined();
      await registerReviewRunCheckoutRoute(
        app,
        fixture.routes.providerApiCheckout!,
      );
      await registerReviewExecutionV2Routes(app, fixture.routes.execution);
      const checkoutResponse = await app.inject({
        method: "POST",
        url: "/api/action/v2/provider-api/checkout",
        headers: { authorization: `Bearer ${receipt.authorizationToken}` },
        payload: {
          providerApiAuthMode: "openrouter-api",
          workflowSchemaVersion: 2,
        },
      });
      expect(checkoutResponse.statusCode, checkoutResponse.body).toBe(200);
      const checkout = checkoutResponse.json();
      expect(checkout.runtimeConfig.runtimeEnv.REVIEW_PROVIDERS).toBe(
        "openrouter/openai/gpt-5.3-codex",
      );
      const load = (relative: string) =>
        import(pathToFileURL(path.join(actionSourceDir!, relative)).href);
      const [
        planModule,
        configModule,
        codexModule,
        contextModule,
        adapterModule,
        clientModule,
      ] = await Promise.all([
        load(
          "src/review-orchestration/infrastructure/production-t0-review-runner.ts",
        ),
        load("src/config/loader.ts"),
        load("src/providers/codex.ts"),
        load(
          "src/review-orchestration/infrastructure/context-gateway-invocation-session.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/review-action-v2-control-plane-adapter.ts",
        ),
        load("src/control-plane/review-action-v2-client.ts"),
      ]);
      const authorization = adapterModule.projectReviewRunAuthorization(
        receipt.result,
      );
      expect(authorization.facts.providerVoteLanes).toHaveLength(1);
      expect(authorization.facts.providerVoteLanes[0].providerKind).toBe(
        "codex",
      );
      const admitted = configModule.ConfigLoader.loadRuntimeEnvironment(
        checkout.runtimeConfig.runtimeEnv,
      );
      const providerName = planModule.selectDirectOpenRouterProvider(admitted);
      process.env.CODEX_REASONING_EFFORT =
        planModule.resolveProductionInvestigationReasoningEffort({
          providerApi: true,
          accountGateway: false,
          codexModel: providerName.slice("openrouter/".length),
          serverReasoningEffort:
            checkout.runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT,
        });
      const provider = new codexModule.CodexProvider(
        providerName.slice("openrouter/".length),
        {
          modelProvider: "openrouter",
          providerNamePrefix: "openrouter",
          disableBuiltinTools: true,
          agenticContext: true,
        },
      );
      const neverExecute = async () => {
        throw new Error("paired_contract_must_not_execute_provider");
      };
      const contextGateway =
        new contextModule.ContextGatewayInvocationSessionFactory(
          { openGatewaySession: neverExecute },
          {
            checkoutRoot: root,
            gatewayBundlePath: path.join(
              actionSourceDir!,
              "dist/context-gateway.js",
            ),
          },
          { capture: neverExecute },
        );
      process.env.REVIEWROUTER_CODEX_BINARY = process.execPath;
      process.env.OPENROUTER_API_KEY = "disposable-pairing-no-provider-call";
      process.chdir(root);
      const prepared = await planModule.prepareSingleT0ReviewPlan({
        authorization,
        config: admitted,
        provider,
        contextGateway,
        lifecycleTargets: [],
        liveLifecycleStateHash: hash("empty-lifecycle"),
        runtimeConfigVersion: String(checkout.runtimeConfig.configVersion),
        pr: {
          number: 42,
          title: "Disposable OR contract",
          body: "",
          author: "fixture",
          draft: false,
          labels: [],
          files: [
            {
              filename: "tax.js",
              status: "modified",
              additions: 1,
              deletions: 1,
              changes: 2,
              patch,
            },
          ],
          diff: patch,
          additions: 1,
          deletions: 1,
          baseSha,
          headSha,
        },
      });
      expect(prepared.invocation.provider).toBe(
        "openrouter/openai/gpt-5.3-codex",
      );
      expect(prepared.invocation.requestedModel).toBe("openai/gpt-5.3-codex");
      expect(prepared.invocation.manifestFacts.providerKind).toBe("codex");
      const request = prepared.invocation.immutableRequest.request;
      expect(request.argsTemplate).toContain(
        'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"',
      );
      expect(request.environment).not.toHaveProperty("OPENROUTER_API_KEY");
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
      const controlPlane = new adapterModule.ReviewActionV2ControlPlaneAdapter(
        client,
      );
      const handoff = prepared.handoff;
      const execution = await controlPlane.startExecution({
        authorization,
        idempotencyKey: hash("paired-or-start"),
        executionId: handoff.executionId,
        reviewRevisionHash: authorization.facts.reviewRevisionHash,
        compatibilityKey: prepared.compatibilityKey,
        planHash: prepared.planned.plan.planHash,
        workSlotsCanonicalJson: prepared.planned.plan.workSlotsCanonicalJson,
        assignmentManifestCanonicalJson:
          prepared.planned.plan.assignmentManifestCanonicalJson,
        assignmentManifestHash: prepared.planned.plan.assignmentManifestHash,
        workSlots: [handoff.workSlot],
        sourceRunId: authorization.facts.sourceRunId,
        sourceRunAttempt: authorization.facts.sourceRunAttempt,
      });
      const lease = await controlPlane.acquireInvocationLease({
        authorization,
        idempotencyKey: hash("paired-or-lease"),
        execution,
        workSlot: handoff.workSlot,
        manifest: prepared.invocationManifest,
        acquireRequestId: hash("paired-or-acquire"),
        ownerIdHash: hash("paired-or-owner"),
      });
      expect(lease.status).toBe("acquired");
      expect(
        await fixture.prisma.reviewInvocationLeaseV2.count({
          where: { executionId: execution.executionId },
        }),
      ).toBe(1);
    } finally {
      process.chdir(originalCwd);
      process.env = originalEnv;
      vi.restoreAllMocks();
      await app.close();
      await fixture.close();
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
