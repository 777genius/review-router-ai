import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import { registerReviewExecutionV2Routes } from "../../packages/features/action-control-plane/src/v2/interface/index.js";
import {
  PrismaReviewConfigurationRepository,
  parseReviewConfigurationStrict,
} from "../../packages/features/review-config/src/index.js";
import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
} from "../../packages/features/review-config/src/tests/current-policy-fixture.js";
import { renderReviewRouterProviderApiCaller } from "../../packages/protocol-review-workflow/src/index.js";
import { registerReviewRunCheckoutRoute } from "../../apps/api/src/review-run-gateway-checkout.js";
import { registerReviewRunSkillsRoute } from "../../apps/api/src/review-run-skills.js";
import {
  providerApiAuthModes,
  providerApiDescriptors,
} from "../../packages/shared/src/review-action-companion-contracts.js";
import { reviewSkillsCompanionContract } from "../../packages/shared/src/review-skills-contract.js";
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
const directCases = providerApiAuthModes.map((mode) => ({
  mode,
  ...providerApiDescriptors[mode],
}));

// GitHub validates every reusable job's requested permissions before evaluating
// its `if`. Validate the actual released workflow graph, including disabled jobs.
(actionSourceDir ? it : it.skip).each(directCases)(
  "starts the $mode caller with read-only permissions and every required released-workflow input",
  async ({ mode, secretName }) => {
    type Workflow = {
      permissions?: Record<string, string>;
      on?: {
        workflow_call?: {
          inputs?: Record<string, { required?: boolean; type: string }>;
        };
      };
      jobs: Record<
        string,
        {
          permissions?: Record<string, string>;
          uses?: string;
          with?: Record<string, unknown>;
        }
      >;
    };
    const levels: Record<string, number> = { none: 0, read: 1, write: 2 };
    async function verify(
      source: string,
      inherited: Record<string, string>,
    ): Promise<void> {
      const workflow = parseYaml(source) as Workflow;
      for (const [name, job] of Object.entries(workflow.jobs)) {
        const granted = job.permissions ?? workflow.permissions ?? inherited;
        for (const [scope, level] of Object.entries(granted)) {
          if ((levels[level] ?? 3) > (levels[inherited[scope] ?? "none"] ?? 0))
            throw new Error(`${name} requires ${scope}:${level}`);
        }
        if (!job.uses) continue;
        const reusable = job.uses.startsWith("./")
          ? job.uses.slice(2)
          : /^777genius\/review-router\/(.github\/workflows\/[^@]+)@[a-f0-9]{40}$/.exec(
              job.uses,
            )?.[1];
        expect(reusable).toBeDefined();
        const nestedSource = await readFile(
          path.join(actionSourceDir!, reusable!),
          "utf8",
        );
        const nested = parseYaml(nestedSource) as Workflow;
        for (const input of Object.keys(job.with ?? {}))
          expect(nested.on?.workflow_call?.inputs).toHaveProperty(input);
        for (const [input, definition] of Object.entries(
          nested.on?.workflow_call?.inputs ?? {},
        )) {
          if (definition.required)
            expect(job.with, `${name} requires input ${input}`).toHaveProperty(
              input,
            );
          const value = job.with?.[input];
          if (
            value !== undefined &&
            !(typeof value === "string" && value.includes("${{"))
          )
            expect(typeof value, `${name} input ${input}`).toBe(
              definition.type,
            );
        }
        await verify(nestedSource, granted);
      }
    }
    const caller = renderReviewRouterProviderApiCaller({
      runtimeRef: "a".repeat(40),
      providerApiAuthMode: mode,
    });
    expect(parseYaml(caller).jobs.review.secrets).toEqual({
      [secretName]: `\${{ secrets.${secretName} }}`,
    });
    await verify(caller, {
      contents: "read",
      "pull-requests": "read",
      "id-token": "write",
    });
  },
);

// Contract proof with real public preparation and private handlers. The public
// bootstrap/credential/execution tests qualify those separate runtime boundaries.
(enabled && databaseUrl && actionSourceDir ? it : it.skip).each(directCases)(
  "admits the actual $mode manifest against its frozen private policy with Gateway relay disabled",
  async ({
    mode,
    providerKind,
    authMode,
    runtimePrefix,
    defaultModel,
    secretName,
  }) => {
    const root = await mkdtemp(path.join(tmpdir(), "reviewrouter-or-paired-"));
    const originalCwd = process.cwd();
    const originalEnv = { ...process.env };
    const app = Fastify();
    let modelTransport: { dispose(): Promise<void> } | undefined;
    await resetReviewActionV2E2EDatabase(databaseUrl!);
    const fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
      // The existing helper qualifies one attempt, bounded by accepted allowance.
      protocolMaxAttemptsPerSlot: 1,
      // The workspace OpenRouter default below must not be shadowed.
      repositoryProviderSelection: "none",
      agentProfiles: [
        {
          profileRef: "codex-default",
          agentKind: "codex",
          packageVersion: "0.147.0",
          binarySha256: "c".repeat(64),
          modelTransports: ["provider_api"],
          contextGateway: true,
          cancellation: true,
          reviewSkillsVersion: 1,
        },
      ],
      environmentOverrides: {
        REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED: "0",
      },
    });
    try {
      const source = renderReviewRouterProviderApiCaller({
        runtimeRef: "a".repeat(40),
        controlPlaneUrl: fixture.env.REVIEW_ROUTER_PUBLIC_API_URL!,
        providerApiAuthMode: mode,
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
            kind: providerKind,
            authMode,
            model: defaultModel,
            ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
          },
        ],
      });
      const workspaceTarget = {
        scope: "workspace" as const,
        workspaceId: fixture.workspaceId,
      };
      const policy = systemPolicyWriteFixture(config, workspaceTarget);
      await new PrismaReviewConfigurationRepository(
        fixture.prisma,
        undefined,
        false,
        undefined,
      ).saveNextVersion({
        target: workspaceTarget,
        expectedVersion: 1,
        ...policy,
        profileDrafts: policy.profileDrafts.map((draft) => ({
          ...draft,
          credential: { kind: "user_ci_secret", authMode },
        })),
      });
      expect(
        await fixture.prisma.providerApiKeyConnection.count({
          where: { workspaceId: fixture.workspaceId },
        }),
      ).toBe(0);
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
          providerApiAuthMode: mode,
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
      await registerReviewRunSkillsRoute(app, fixture.routes.reviewSkills!);
      const checkoutResponse = await app.inject({
        method: "POST",
        url: "/api/action/v2/provider-api/checkout",
        headers: { authorization: `Bearer ${receipt.authorizationToken}` },
        payload: {
          providerApiAuthMode: mode,
          workflowSchemaVersion: 2,
        },
      });
      expect(checkoutResponse.statusCode, checkoutResponse.body).toBe(200);
      const checkout = checkoutResponse.json();
      expect(checkout.runtimeConfig.runtimeEnv.REVIEW_PROVIDERS).toBe(
        `${runtimePrefix}/${defaultModel}`,
      );
      if (mode === "kimi-code-api") {
        expect(checkout.runtimeConfig.runtimeEnv).not.toHaveProperty(
          "CODEX_REASONING_EFFORT",
        );
        expect(checkout.runtimeConfig.runtimeEnv.CODEX_FAST_MODE).not.toBe(
          "true",
        );
      }
      const skillsResponse = await app.inject({
        method: "POST",
        url: reviewSkillsCompanionContract.path,
        headers: { authorization: `Bearer ${receipt.authorizationToken}` },
        payload: {},
      });
      expect(skillsResponse.statusCode, skillsResponse.body).toBe(200);
      const load = (relative: string) =>
        import(pathToFileURL(path.join(actionSourceDir!, relative)).href);
      const [
        planModule,
        configModule,
        codexModule,
        contextModule,
        adapterModule,
        clientModule,
        selectionModule,
        transportModule,
        skillsModule,
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
        load("src/codex-oauth/provider-api-selection.ts"),
        load(
          "src/review-orchestration/infrastructure/account-gateway-model-transport.ts",
        ),
        load("src/review-skills/review-skills.ts"),
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
        { modelTransport: true },
      );
      const selection = selectionModule.selectDirectProvider(admitted, mode);
      const providerName = selection.providerName;
      const effort = planModule.resolveProductionInvestigationReasoningEffort({
        providerApi: true,
        providerApiAuthMode: mode,
        accountGateway: false,
        codexModel: defaultModel,
        serverReasoningEffort:
          checkout.runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT,
      });
      if (effort === null) delete process.env.CODEX_REASONING_EFFORT;
      else process.env.CODEX_REASONING_EFFORT = effort;
      const codexHome = path.join(root, "codex-home");
      await mkdir(codexHome, { mode: 0o700 });
      process.env.CODEX_HOME = codexHome;
      const localTransport =
        await transportModule.startDirectProviderApiModelTransport(
          mode,
          () => "disposable-pairing-no-provider-call",
          { requestMs: 10_000, streamFrameBytes: 64 * 1024 },
        );
      // The production bootstrap attaches its fresh home to the transport.
      // This paired proof enters at preparation after that separate boundary.
      const transport = Object.freeze({
        ...localTransport,
        environment: Object.freeze({
          ...localTransport.environment,
          CODEX_HOME: codexHome,
        }),
      });
      modelTransport = transport;
      const provider = new codexModule.CodexProvider(defaultModel, {
        modelProvider: selection.modelProvider,
        providerNamePrefix: runtimePrefix,
        providerApiTransport: transport,
        disableBuiltinTools: true,
        agenticContext: true,
      });
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
      process.env[secretName] = "disposable-pairing-no-provider-call";
      process.chdir(root);
      const prepared = await planModule.prepareSingleT0ReviewPlan({
        admittedAgent: JSON.parse(
          checkout.runtimeConfig.runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_JSON,
        ),
        reviewSkills: skillsModule.createMaterializedReviewSkills(
          skillsResponse.json(),
          [],
        ),
        authorization,
        config: admitted,
        provider,
        contextGateway,
        lifecycleTargets: [],
        liveLifecycleStateHash: hash("empty-lifecycle"),
        runtimeConfigVersion: String(checkout.runtimeConfig.configVersion),
        pr: {
          number: 42,
          title: `Disposable ${mode} contract`,
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
      expect(prepared.invocation.provider).toBe(providerName);
      expect(prepared.invocation.requestedModel).toBe(defaultModel);
      expect(prepared.invocation.manifestFacts.providerKind).toBe("codex");
      const request = prepared.invocation.immutableRequest.request;
      expect(request.argsTemplate.join(" ")).toContain(transport.baseUrl);
      for (const descriptor of Object.values(providerApiDescriptors)) {
        expect(request.environment).not.toHaveProperty(descriptor.secretName);
        expect(JSON.stringify(request)).not.toContain(
          descriptor.fixedResponsesUrl,
        );
      }
      expect(JSON.stringify(request)).not.toContain(
        "disposable-pairing-no-provider-call",
      );
      if (mode === "kimi-code-api") {
        expect(request.argsTemplate.join(" ")).not.toContain(
          "model_reasoning_effort=",
        );
        expect(request.argsTemplate).not.toContain("--output-schema");
      }
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
      await modelTransport?.dispose();
      await fixture.close();
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      await rm(root, { recursive: true, force: true });
    }
  },
  60_000,
);
