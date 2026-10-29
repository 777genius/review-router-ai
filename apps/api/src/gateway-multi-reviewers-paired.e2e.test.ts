import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import * as gateway from "@agent-teams/account-gateway/contracts";
import {
  registerReviewActionV2ProtocolInfoRoute,
  registerReviewEvidenceV2Routes,
  registerReviewExecutionV2Routes,
  registerReviewPublicationRequestV2Routes,
  registerReviewRunControlV2Routes,
  registerReviewSnapshotReadV2Routes,
} from "@reviewrouter/features-action-control-plane/v2";
import {
  PrismaProviderAccountRepository,
  type WorkspaceAccountBinding,
} from "@reviewrouter/features-provider-accounts";
import {
  parseReviewConfigurationStrict,
  PrismaReviewConfigurationRepository,
} from "@reviewrouter/features-review-config";
import { parseReviewRunRuntimeSnapshot } from "@reviewrouter/features-review-run-control";
import {
  reviewerPlanDescriptorDigest,
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
  type ReviewAgentProfile,
  type ReviewModelDispatchProfileV2,
} from "@reviewrouter/shared";
import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { registerReviewRunGatewayCheckoutRoute } from "./review-run-gateway-checkout";
import { registerReviewRunGatewayRelayRoutes } from "./review-run-gateway-relay";
import { registerReviewRunSkillsRoute } from "./review-run-skills";
import { reviewActionV2ProviderVoteLanesEnv } from "./review-action-v2-production-composition";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
} from "../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";

const exec = promisify(execFile);
const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const actionSourceDir = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
const enabled =
  process.env.REVIEW_ROUTER_REVIEW_INVESTIGATION_PAIRED_E2E === "1";
if (enabled && (!databaseUrl || !actionSourceDir))
  throw new Error("paired_gateway_database_and_action_source_required");
const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const redact = (value: string) =>
  value.replace(/^::add-mask::.*$/gm, "::add-mask::[redacted]");
const models = ["openai/gpt-5.4-mini", "openai/gpt-5.4-nano"];
const profileId = "openrouter-openai-responses-apikey-v1";

// Real compiled Action, signed OIDC, production API handlers, PostgreSQL and
// Gateway HTTP. Only external GitHub/provider effects and the approved binary
// are synthetic. This qualifies integration, not a live provider release.
(enabled ? it : it.skip).each([
  "shared",
  "independent",
  "unavailable-primary",
  "mixed-engines",
] as const)(
  "runs the compiled entrypoint through real API/SQL with %s Gateway allocations",
  async (scenario) => {
    const mixed = scenario === "mixed-engines";
    const sharedAllocation = scenario === "shared" || mixed;
    const root = await mkdtemp(path.join(tmpdir(), "rr-multi-paired-"));
    const native = await nativeGateway();
    let fixture:
      | Awaited<ReturnType<typeof createReviewActionV2E2EHarness>>
      | undefined;
    const app = Fastify({ logger: false });
    let workerTimer: ReturnType<typeof setInterval> | undefined;
    let workerPass = Promise.resolve();
    let workerRunning = false;
    let workerError: unknown;
    try {
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      const repository = await makeRepository(root);
      const artifact = path.join(actionSourceDir!, "dist/index.js");
      const artifactDigest = sha256(await readFile(artifact));
      const profiles = JSON.parse(
        await readFile(
          path.join(
            actionSourceDir!,
            "src/control-plane/review-agent-profiles.json",
          ),
          "utf8",
        ),
      ) as ReviewAgentProfile[];
      const approved = profiles.find(
        (profile) => profile.profileRef === "codex-default",
      )!;
      const approvedOcr = profiles.find(
        (profile) => profile.profileRef === "ocr-managed-v5",
      )!;
      const bin = path.join(root, "bin");
      await mkdir(bin);
      const childLog = path.join(root, "children.jsonl");
      const codex = path.join(bin, "synthetic-codex");
      await writeFile(
        codex,
        syntheticCodex(childLog, approved.packageVersion),
        { mode: 0o700 },
      );
      const binaryDigest = sha256(await readFile(codex));
      const ocr = path.join(bin, "synthetic-ocr");
      await writeFile(ocr, syntheticOcr(childLog, approvedOcr.packageVersion), {
        mode: 0o700,
      });
      const ocrDigest = sha256(await readFile(ocr));
      await writeFile(
        path.join(bin, "npm"),
        syntheticNpm(codex, approved.packageVersion),
        { mode: 0o700 },
      );
      await writeFile(path.join(bin, "git"), localGit(repository.directory), {
        mode: 0o700,
      });
      const limits = {
        requests: 8,
        concurrency: mixed ? 2 : 1,
        requestBytes: 1048576,
        outputBytes: 1048576,
        tokens: 16384,
      };
      const modelDispatchProfile: ReviewModelDispatchProfileV2 = {
        extensionId: reviewModelDispatchContract.extensionId,
        descriptorDigest: reviewModelDispatchDescriptorDigest,
        policyVersion: reviewModelDispatchContract.policyVersion,
        transports: ["account_gateway"],
        wireProtocols: ["openai-responses"],
        defaultAgentProfileRefs: { account_gateway: approvedOcr.profileRef },
        limits: {
          maxRequests: limits.requests,
          maxConcurrentRequests: 1,
          maxRequestBytes: limits.requestBytes,
          maxResponseBytes: limits.outputBytes,
          maxOutputTokens: limits.tokens,
        },
      };
      fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
        modelTransport: "account_gateway",
        repositoryProviderSelection: "none",
        agentProfiles: [
          { ...approved, binarySha256: binaryDigest },
          ...(mixed ? [{ ...approvedOcr, binarySha256: ocrDigest }] : []),
        ],
        reviewerPlanProfile: {
          planVersion: 1,
          descriptorDigest: reviewerPlanDescriptorDigest,
        },
        ...(mixed ? { modelDispatchProfile } : {}),
        gatewayFixtureOrigin: native.origin,
        environmentOverrides: {
          [reviewActionV2ProviderVoteLanesEnv]: JSON.stringify([
            {
              providerKind: "codex",
              providerVoteIdentityHash: sha256("paired-codex"),
            },
            ...(mixed
              ? [
                  {
                    providerKind: "ocr",
                    providerVoteIdentityHash: sha256("paired-ocr"),
                  },
                ]
              : []),
          ]),
          REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: JSON.stringify({
            profiles: [{ profileRef: profileId, limits }],
          }),
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED: "1",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: native.origin,
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER:
            "disposable-multi-control",
          REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: JSON.stringify({
            profiles: [
              {
                profile: {
                  profileId,
                  protocol: "openai-responses",
                  modelIds: models,
                  authKinds: ["api_key"],
                },
                outputTokens: limits.tokens,
              },
            ],
            ingressBytes: 1048576,
            requestTimeoutMs: 15000,
            waitBudgetMs: 0,
            maxWaits: 0,
            maxSessions: 4,
            maxInFlight: 4,
          }),
        },
      });
      const { prisma, workspaceId } = fixture;
      fixture.fakeGitHub.revision = repository;
      const accounts = new PrismaProviderAccountRepository(prisma);
      const bindings: WorkspaceAccountBinding[] = [];
      for (let index = 0; index < (sharedAllocation ? 1 : 2); index++) {
        const accountRef = `multi-account-${index}`;
        const connection = await prisma.providerAccountConnection.create({
          data: {
            ownerWorkspaceId: workspaceId,
            gatewayAccountRef: accountRef,
            profileRef: profileId,
            displayName: `Disposable reviewer ${index}`,
            state: "active",
          },
        });
        const binding = await accounts.compareAndSetBinding({
          workspaceId,
          connectionId: connection.id,
          expectedRevision: 0,
          state: "active",
        });
        bindings.push(binding);
        native.accounts.set(accountRef, {
          accountRef,
          ownerRef: `rrw_${sha256(`rr-workspace-owner-v1\0${workspaceId}`)}`,
          profileId,
          displayName: "Synthetic provider",
          metadataRevision: 1,
          authorizationEpoch: 7,
          state:
            scenario === "unavailable-primary" && index === 0
              ? "disabled"
              : "active",
        });
      }
      const config = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        providers: models.map((model, index) => ({
          kind: "codex",
          authMode: "codex_account_gateway",
          model,
          reasoningEffort: index === 0 ? "high" : "medium",
          agenticContext: mixed && index === 1,
          fastMode: false,
          requiredHealthy: true,
          ...(mixed && index === 0
            ? { agentProfileRef: approved.profileRef }
            : {}),
          gatewayBindingId: bindings[sharedAllocation ? 0 : index]!.id,
          gatewayProfileRef: profileId,
        })),
        execution: {
          providerLimit: 2,
          providerMaxParallel: 2,
          inlineMinAgreement: 2,
        },
      });
      const target = { scope: "workspace" as const, workspaceId };
      await new PrismaReviewConfigurationRepository(
        prisma,
        undefined,
        false,
        undefined,
      ).saveNextVersion({
        target,
        expectedVersion: 1,
        ...systemPolicyWriteFixture(config, target),
      });
      const previousFetch = fixture.fakeGitHub.fetch;
      const issuedAppTokens = new Set<string>();
      let appMutations = 0;
      vi.spyOn(fixture.fakeGitHub, "fetch").mockImplementation(
        async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(String(input), init);
          const url = new URL(request.url);
          const graphqlBody =
            request.method === "POST" && url.pathname === "/graphql"
              ? ((await request.clone().json()) as { query?: string })
              : undefined;
          const mutation =
            ["POST", "PATCH", "PUT", "DELETE"].includes(request.method) &&
            !url.pathname.endsWith("/access_tokens") &&
            (url.pathname !== "/graphql" ||
              /\bmutation\b/u.test(graphqlBody?.query ?? ""));
          if (mutation) {
            const token = request.headers
              .get("authorization")
              ?.match(/^(?:Bearer|token) (.+)$/iu)?.[1];
            if (!token || !issuedAppTokens.has(token))
              return Response.json(
                { message: "fixture_app_installation_token_required" },
                { status: 403 },
              );
            appMutations++;
          }
          if (request.method === "POST" && url.pathname === "/graphql") {
            if (graphqlBody?.query?.includes("ReviewRouterThreadInventory"))
              return Response.json({
                data: {
                  repository: {
                    pullRequest: {
                      headRefOid: repository.headSha,
                      reviewThreads: {
                        pageInfo: { hasNextPage: false, endCursor: null },
                        nodes: [],
                      },
                    },
                  },
                },
              });
          }
          if (
            request.method === "POST" &&
            url.pathname.endsWith("/access_tokens")
          ) {
            const rawBody = await request.clone().text();
            const body = (rawBody ? JSON.parse(rawBody) : {}) as {
              permissions?: Record<string, string>;
            };
            if (
              body.permissions?.contents === "read" &&
              !body.permissions?.checks &&
              !body.permissions?.issues
            )
              return Response.json(
                {
                  token: "disposable-checkout-read",
                  expires_at: new Date(Date.now() + 600000).toISOString(),
                  permissions: body.permissions,
                  repository_selection: "selected",
                },
                { status: 201 },
              );
            const response = await previousFetch(input, init);
            const issued = (await response.clone().json()) as {
              token?: string;
            };
            if (response.ok && issued.token) issuedAppTokens.add(issued.token);
            return response;
          }
          if (
            request.method === "GET" &&
            url.pathname.endsWith("/pulls/42/files")
          )
            return Response.json([
              {
                filename: "tax.js",
                status: "modified",
                additions: 1,
                deletions: 1,
                changes: 2,
                patch: repository.patch,
              },
            ]);
          if (request.method === "GET" && url.pathname.endsWith("/pulls/42")) {
            const response = await previousFetch(input, init);
            const body = (await response.json()) as Record<string, unknown>;
            return Response.json({
              ...body,
              title: "Review a small tax change",
              body: "Fix the total",
              html_url:
                "https://github.com/reviewrouter-e2e/disposable-review-v2/pull/42",
              user: { login: "fixture-owner" },
            });
          }
          return previousFetch(input, init);
        },
      );
      registerReviewActionV2ProtocolInfoRoute(app);
      const errors: unknown[] = [];
      const routes: string[] = [];
      app.addHook("onRequest", async (request) => {
        routes.push(`${request.method} ${request.url}`);
      });
      const authorize = fixture.routes.runControl.authorize!;
      await registerReviewRunControlV2Routes(app, {
        ...fixture.routes.runControl,
        authorize: {
          ...authorize,
          execute: async (request) => {
            try {
              return await authorize.execute(request);
            } catch (error) {
              errors.push({
                authorizationFailure:
                  error instanceof Error ? error.stack : String(error),
                issues:
                  error instanceof Error
                    ? Reflect.get(error, "issues")
                    : undefined,
              });
              throw error;
            }
          },
        },
      });
      await registerReviewRunSkillsRoute(app, fixture.routes.reviewSkills!);
      await registerReviewExecutionV2Routes(app, fixture.routes.execution);
      await registerReviewEvidenceV2Routes(app, fixture.routes.evidence);
      await registerReviewSnapshotReadV2Routes(app, fixture.routes.snapshot);
      await registerReviewPublicationRequestV2Routes(
        app,
        fixture.routes.publication,
      );
      await registerReviewRunGatewayCheckoutRoute(
        app,
        fixture.routes.accountGatewayCheckout!,
      );
      await registerReviewRunGatewayRelayRoutes(
        app,
        fixture.routes.accountGatewayRelay!,
      );
      app.get("/__oidc", async () => ({
        value: await fixture!.createOidcToken(),
      }));
      app.all("/__github/*", async (request, reply) => {
        const url = `https://api.github.com/${request.url.slice("/__github/".length)}`;
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers))
          if (value !== undefined)
            headers.set(name, Array.isArray(value) ? value.join(",") : value);
        const response = await fixture!.fakeGitHub.fetch(url, {
          method: request.method,
          headers,
          ...(request.body === undefined
            ? {}
            : { body: JSON.stringify(request.body) }),
        });
        return reply
          .status(response.status)
          .type("application/json")
          .send(await response.text());
      });
      app.addHook("onSend", async (request, reply, payload) => {
        if (reply.statusCode >= 400)
          errors.push({
            path: request.url,
            status: reply.statusCode,
            body: typeof payload === "string" ? payload : null,
          });
      });
      await app.listen({ host: "127.0.0.1", port: 0 });
      const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      const preload = path.join(root, "preload.cjs");
      await writeFile(
        preload,
        preloadSource({
          artifact,
          artifactDigest,
          origin,
          binaries: [
            { from: approved.binarySha256, to: binaryDigest },
            ...(mixed
              ? [{ from: approvedOcr.binarySha256, to: ocrDigest }]
              : []),
          ],
        }),
      );
      const event = path.join(root, "event.json");
      await writeFile(
        event,
        JSON.stringify({
          action: "opened",
          number: 42,
          repository: {
            id: 987654321,
            name: "disposable-review-v2",
            full_name: "reviewrouter-e2e/disposable-review-v2",
            owner: { login: "reviewrouter-e2e" },
          },
          pull_request: {
            number: 42,
            head: {
              sha: repository.headSha,
              repo: { full_name: "reviewrouter-e2e/disposable-review-v2" },
            },
            base: {
              sha: repository.baseSha,
              repo: { full_name: "reviewrouter-e2e/disposable-review-v2" },
            },
          },
        }),
      );
      const home = path.join(root, "home"),
        runnerTemp = path.join(root, "runner");
      await mkdir(home);
      await mkdir(runnerTemp);
      // The public Action waits for the App publication receipt. Run the real
      // worker concurrently, as the deployed API/worker topology does.
      workerTimer = setInterval(() => {
        if (workerRunning) return;
        workerRunning = true;
        workerPass = fixture!
          .runWorkerUntilSettled()
          .catch((error: unknown) => {
            workerError ??= error;
          })
          .finally(() => {
            workerRunning = false;
          });
      }, 200);
      let output: { stdout: string; stderr: string };
      try {
        const result = await exec(process.execPath, [artifact], {
          cwd: repository.directory,
          timeout: 90000,
          maxBuffer: 4 * 1024 * 1024,
          env: {
            PATH: `${bin}:/usr/bin:/bin`,
            HOME: home,
            NODE_OPTIONS: `--require=${preload}`,
            ...(mixed ? { REVIEWROUTER_OCR_BINARY: ocr } : {}),
            CI: "true",
            GITHUB_ACTIONS: "true",
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_EVENT_PATH: event,
            GITHUB_REPOSITORY: "reviewrouter-e2e/disposable-review-v2",
            GITHUB_WORKSPACE: repository.directory,
            GITHUB_OUTPUT: path.join(root, "output"),
            RUNNER_TEMP: runnerTemp,
            REVIEWROUTER_ACTION_V2_MODE: "t0",
            REVIEWROUTER_ACTION_VERSION: "a".repeat(40),
            REVIEW_ROUTER_MODE: "account-gateway",
            INPUT_MODE: "account-gateway",
            INPUT_API_URL: "https://multi-paired.reviewrouter.invalid",
            INPUT_CONTROL_PLANE_URL:
              "https://multi-paired.reviewrouter.invalid",
            REVIEWROUTER_API_URL: "https://multi-paired.reviewrouter.invalid",
            REVIEWROUTER_CONTROL_PLANE_URL:
              "https://multi-paired.reviewrouter.invalid",
            REVIEWROUTER_OIDC_AUDIENCE:
              fixture.env.REVIEW_ROUTER_ACTION_OIDC_AUDIENCE!,
            INPUT_OIDC_AUDIENCE:
              fixture.env.REVIEW_ROUTER_ACTION_OIDC_AUDIENCE!,
            INPUT_PROVIDER_INSTANCE_ID: "codex-rotating:987654321",
            INPUT_WORKFLOW_SCHEMA_VERSION: "2",
            ACTIONS_ID_TOKEN_REQUEST_URL:
              "https://token.actions.githubusercontent.com/token",
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: "disposable-request-token",
          },
        });
        output = {
          stdout: redact(result.stdout),
          stderr: redact(result.stderr),
        };
      } catch (error) {
        const processError = error as Error & {
          code?: number;
          stdout?: string;
          stderr?: string;
        };
        // Preserve the real subprocess cause, but strip its captured Actions
        // masking lines before Vitest can serialize that cause on a failure.
        processError.message = redact(processError.message);
        if (processError.stack) processError.stack = redact(processError.stack);
        if (processError.stdout)
          processError.stdout = redact(processError.stdout);
        if (processError.stderr)
          processError.stderr = redact(processError.stderr);
        if (
          scenario === "unavailable-primary" &&
          processError.code === 1 &&
          processError.stdout?.includes("::error::required_admission_limited")
        ) {
          output = {
            stdout: redact(processError.stdout),
            stderr: redact(processError.stderr ?? ""),
          };
        } else {
          const executionStates = await prisma.reviewExecutionV2.findMany({
            where: { workspaceId },
            select: { state: true },
          });
          const children = await readFile(childLog, "utf8").catch(() => "");
          throw new Error(
            `compiled_multi_review_failed:${JSON.stringify({ message: redact(processError.message), stdout: redact(processError.stdout ?? ""), stderr: redact(processError.stderr ?? ""), errors, routes: [...new Set(routes)], executionStates, native: native.calls, children })}`,
            { cause: error },
          );
        }
      }
      const authorizations = await prisma.reviewRunAuthorization.findMany({
        where: { workspaceId },
      });
      expect(authorizations).toHaveLength(1);
      const snapshot = parseReviewRunRuntimeSnapshot(
        authorizations[0]!.runtimeSnapshotCanonicalJson,
      );
      expect(snapshot?.snapshotVersion).toBe(4);
      if (snapshot?.snapshotVersion !== 4)
        throw new Error("captured_reviewer_snapshot_required");
      expect(snapshot).not.toHaveProperty("modelDispatchCapability");
      if (mixed)
        expect(snapshot.reviewers).toMatchObject([
          {
            providerIndex: 0,
            agenticContext: false,
            agentProfile: {
              agentKind: "codex",
              profileRef: approved.profileRef,
            },
          },
          {
            providerIndex: 1,
            agenticContext: true,
            agentProfile: {
              agentKind: "ocr",
              profileRef: approvedOcr.profileRef,
            },
          },
        ]);
      const executions = await prisma.reviewExecutionV2.findMany({
        where: { workspaceId },
      });
      expect(executions, output.stdout).toHaveLength(1);
      const failed = scenario === "unavailable-primary";
      expect(executions[0]?.state, output.stdout).toBe(
        failed ? "partial" : "completed",
      );
      expect(executions[0]?.finalizedArtifactId).not.toBeNull();
      const slots = await prisma.reviewExecutionWorkSlotV2.findMany({
        where: {
          executionId: executions[0]!.executionId,
          taskKind: "finding_discovery",
        },
      });
      expect(slots).toHaveLength(2);
      expect(
        new Set(slots.map((slot) => slot.providerVoteIdentityHash)).size,
      ).toBe(2);
      if (mixed)
        expect(
          [...new Set(slots.map((slot) => slot.providerKind))].sort(),
        ).toEqual(["codex", "ocr"]);
      expect(
        slots.filter((slot) => slot.acceptedObservationRefId !== null),
      ).toHaveLength(failed ? 1 : 2);
      expect(native.requestModels.sort()).toEqual(
        failed ? [models[1]] : [...models].sort(),
      );
      expect(
        native.requestSettings.sort((a, b) => a.model.localeCompare(b.model)),
      ).toEqual(
        models.flatMap((model, index) =>
          failed && index === 0
            ? []
            : [{ model, effort: index === 0 ? "high" : "medium" }],
        ),
      );
      expect(native.preparations).toHaveLength(
        scenario === "independent" ? 2 : 1,
      );
      expect(native.maxActive).toBe(
        scenario === "independent" || mixed ? 2 : 1,
      );
      expect(new Set(native.closes).size).toBe(native.preparations.length);
      expect(native.closes).toHaveLength(native.preparations.length);
      for (const request of native.requests.values()) {
        const reviewer = snapshot.reviewers.find(
          (row) => row.requestedModel === request.model,
        );
        expect(reviewer).toBeDefined();
        const allocation = snapshot.allocations.find(
          (row) => row.allocationId === reviewer?.transport.allocationId,
        );
        expect(allocation).toBeDefined();
        expect(
          native.executions.get(request.executionRef)?.intent.operationId,
        ).toBe(allocation?.operationId);
        expect(request.admission).toMatchObject({
          accountRef: allocation?.permittedAccountRef,
          invocationRef: allocation?.invocationId,
          attemptRef: allocation?.attemptId,
        });
        expect(request.requestRef).toMatch(
          new RegExp(
            `^rr-request-${sha256(reviewer!.reviewerId).slice(0, 24)}-`,
          ),
        );
      }
      expect(native.requests.size).toBe(failed ? 1 : 2);
      const children = (await readFile(childLog, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .filter((child) => child.event === "completed");
      expect(new Set(children.map((child) => child.home)).size).toBe(
        failed ? 1 : 2,
      );
      expect(new Set(children.map((child) => child.capabilityHash)).size).toBe(
        failed ? 1 : 2,
      );
      await fixture.runWorkerUntilSettled();
      expect(fixture.fakeGitHub.comments).toHaveLength(1);
      expect(issuedAppTokens.size).toBeGreaterThan(0);
      expect(appMutations).toBeGreaterThan(0);
      expect(fixture.fakeGitHub.comments[0]?.user.login).toBe(
        "reviewrouter-e2e[bot]",
      );
      expect(errors).toEqual([]);
      expect(workerError).toBeUndefined();
      await mkdir(path.resolve("tmp/multi-reviewer-e2e"), { recursive: true });
      await writeFile(
        path.resolve(`tmp/multi-reviewer-e2e/${scenario}.json`),
        JSON.stringify(
          {
            artifactDigest,
            scenario,
            executions: executions.length,
            reviewers: slots.length,
            accepted: slots.filter((slot) => slot.acceptedObservationRefId)
              .length,
            preparations: native.preparations.length,
            maxActive: native.maxActive,
            publications: fixture.fakeGitHub.comments.length,
          },
          null,
          2,
        ),
      );
    } finally {
      clearInterval(workerTimer);
      await workerPass;
      await app.close();
      await fixture?.close();
      await native.close();
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  },
  120000,
);

async function makeRepository(root: string) {
  const directory = path.join(root, "repository");
  await mkdir(directory);
  const git = async (...args: string[]) =>
    (await exec("/usr/bin/git", ["-C", directory, ...args])).stdout.trim();
  await git("init", "-b", "main");
  await writeFile(
    path.join(directory, "tax.js"),
    "export const total = price;\n",
  );
  const commit = async () => {
    await git("add", ".");
    await git(
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "disposable fixture",
    );
  };
  await commit();
  const baseSha = await git("rev-parse", "HEAD");
  await writeFile(
    path.join(directory, "tax.js"),
    "export const total = price + taxRatePercent;\n",
  );
  await commit();
  const headSha = await git("rev-parse", "HEAD");
  return {
    directory,
    baseSha,
    mergeBaseSha: baseSha,
    headSha,
    headTreeSha: await git("rev-parse", "HEAD^{tree}"),
    patch: await git("diff", baseSha, headSha, "--", "tax.js"),
  };
}

async function nativeGateway() {
  const accounts = new Map<string, gateway.Account>();
  const operations = new Map<string, gateway.Operation>();
  const executions = new Map<
    string,
    {
      intent: gateway.Prepare;
      admission: gateway.Admission;
      bearer: string;
      closed: boolean;
      active: number;
      dispatched: number;
    }
  >();
  const requests = new Map<
    string,
    {
      executionRef: string;
      requestRef: string;
      model: string;
      admission: gateway.Admission;
      completed: boolean;
    }
  >();
  const preparations: gateway.Prepare[] = [],
    requestModels: string[] = [],
    closes: string[] = [],
    calls: string[] = [];
  const requestSettings: { model: string; effort: string | undefined }[] = [];
  let active = 0,
    maxActive = 0;
  const server = createServer(async (request, response) => {
    try {
      calls.push(`${request.method} ${request.url}`);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : undefined;
      const json = (status: number, value: unknown) =>
        response
          .writeHead(status, { "content-type": "application/json" })
          .end(JSON.stringify(value));
      const deny = (status: number, code: string) =>
        json(status, {
          code,
          traceRef: "synthetic-gateway-denial",
          effect: "not_dispatched",
          retry: { kind: "never" },
        });
      const control =
        request.headers.authorization === "Bearer disposable-multi-control";
      const account = /^\/v1\/accounts\/([^/]+)$/.exec(request.url ?? "");
      if (account) {
        if (!control) return deny(401, "unauthenticated");
        json(200, accounts.get(decodeURIComponent(account[1]!)));
        return;
      }
      if (request.url === "/v1/account-models/read") {
        if (!control) return deny(401, "unauthenticated");
        const account = accounts.get(body?.accountRef);
        if (
          !account ||
          account.state !== "active" ||
          body.ownerRef !== account.ownerRef ||
          body.profileId !== account.profileId ||
          body.expectedAuthorizationEpoch !== account.authorizationEpoch
        )
          return deny(403, "forbidden");
        json(200, {
          status: "snapshot",
          physicalGeneration: "multi-paired-generation",
          principalVersion: "multi-paired-principal",
          source: "openrouter",
          fetchedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          models: models.map((modelId) => ({
            modelId,
            reasoning: { allowed: ["high", "medium"], default: "high" },
            fast: null,
            tools: { allowed: ["function"], default: "function" },
          })),
        });
        return;
      }
      const operation = /^\/v1\/operations\/([^/]+)$/.exec(request.url ?? "");
      if (operation) {
        if (!control) return deny(401, "unauthenticated");
        const result = operations.get(decodeURIComponent(operation[1]!));
        json(
          result ? 200 : 404,
          result ?? {
            code: "not_found",
            traceRef: "synthetic-absent-operation",
            effect: "not_dispatched",
            retry: { kind: "never" },
          },
        );
        return;
      }
      if (request.url === "/internal/v1/run-access") {
        if (!control) return deny(401, "unauthenticated");
        const intent = gateway.prepare.parse(body);
        if (
          intent.accountRefs.length !== 1 ||
          accounts.get(intent.accountRefs[0]!)?.state !== "active"
        )
          return deny(403, "forbidden");
        let prepared = operations.get(intent.operationId);
        if (!prepared) {
          preparations.push(intent);
          prepared = {
            operationRef: intent.operationId,
            state: "applied",
            result: {
              kind: "execution",
              executionRef: `multi-execution-${preparations.length}`,
              accountRef: intent.accountRefs[0]!,
              authorizationEpoch: 7,
              deadline: intent.deadline,
              state: "active",
            },
          };
          operations.set(intent.operationId, prepared);
        }
        if (
          prepared.state !== "applied" ||
          prepared.result?.kind !== "execution"
        )
          throw new Error("synthetic_preparation_result_invalid");
        const executionRef = prepared.result.executionRef;
        const admission = gateway.admission.parse({
          invocationRef: intent.invocationRef,
          attemptRef: intent.attemptRef,
          accountRef: intent.accountRefs[0],
          authorizationEpoch: 7,
          subjectRef: intent.subjectRef,
          policyRevision: intent.policyRevision,
          bindingRevision: intent.bindingRevision,
          profileId: intent.profileId,
          limits: intent.limits,
          expiresAt: intent.deadline,
        });
        const existing = executions.get(executionRef);
        if (existing && !isDeepStrictEqual(existing.intent, intent))
          return deny(409, "conflict");
        const selected = existing ?? {
          intent,
          admission,
          bearer: `synthetic-execution-capability-${preparations.length}`,
          closed: false,
          active: 0,
          dispatched: 0,
        };
        executions.set(executionRef, selected);
        json(200, {
          operation: prepared,
          bearer: selected.bearer,
          admission: selected.admission,
        });
        return;
      }
      const execution = /^\/v1\/executions\/([^/]+)\/(requests|close)$/.exec(
        request.url ?? "",
      );
      const selected = execution ? executions.get(execution[1]!) : undefined;
      if (execution && !selected) return deny(404, "not_found");
      if (
        selected &&
        request.headers.authorization !== `Bearer ${selected.bearer}`
      )
        return deny(401, "unauthenticated");
      if (execution?.[2] === "close") {
        selected!.closed = true;
        closes.push(execution[1]!);
        json(200, { operationRef: body.operationId, state: "applied" });
        return;
      }
      if (execution?.[2] === "requests") {
        const admission = gateway.admission.parse(
          JSON.parse(String(request.headers["x-gateway-admission"])),
        );
        if (
          selected!.closed ||
          !isDeepStrictEqual(admission, selected!.admission)
        )
          return deny(403, "forbidden");
        if (
          selected!.active >= selected!.intent.limits.concurrency ||
          selected!.dispatched >= selected!.intent.limits.requests
        )
          return deny(429, "admission_limited");
        const requestRef = gateway.reference.parse(
          request.headers["x-gateway-request-id"],
        );
        if (requests.has(requestRef)) return deny(409, "conflict");
        const observed = {
          executionRef: execution[1]!,
          requestRef,
          model: String(body.model),
          admission,
          completed: false,
        };
        requests.set(requestRef, observed);
        selected!.active++;
        selected!.dispatched++;
        requestModels.push(body.model);
        requestSettings.push({
          model: body.model,
          effort: body.reasoning?.effort,
        });
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        active--;
        selected!.active--;
        observed.completed = true;
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "x-gateway-request-ref": String(
            request.headers["x-gateway-request-id"],
          ),
        });
        response.end(
          `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: `response-${requestModels.length}`, status: "completed", model: body.model, output: [], usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } } })}\n\n`,
        );
        return;
      }
      const status = /^\/v1\/executions\/([^/]+)\/requests\/([^/]+)$/.exec(
        request.url ?? "",
      );
      if (request.method === "GET" && status) {
        const execution = executions.get(status[1]!);
        if (!execution) return deny(404, "not_found");
        if (request.headers.authorization !== `Bearer ${execution.bearer}`)
          return deny(401, "unauthenticated");
        const observed = requests.get(status[2]!);
        if (!observed || observed.executionRef !== status[1])
          return deny(404, "not_found");
        json(200, {
          requestRef: observed.requestRef,
          status: observed.completed ? "completed" : "pending",
          effect: observed.completed ? "completed" : "dispatch_started",
        });
        return;
      }
      json(404, { error: "synthetic_route_missing" });
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    accounts,
    executions,
    requests,
    preparations,
    requestModels,
    requestSettings,
    closes,
    calls,
    get maxActive() {
      return maxActive;
    },
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function syntheticCodex(log: string, version: string) {
  return `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli ${version}'); process.exit(0); }
(async () => {
 const config = fs.readFileSync(require('node:path').join(process.env.CODEX_HOME, 'config.toml'), 'utf8') + '\\n' + args.join('\\n');
 const base = config.match(/base_url\\s*=\\s*"([^"]+)"/)[1];
 const modelIndex = args.includes('--model') ? args.indexOf('--model') : args.indexOf('-m');
 const model = modelIndex < 0 ? undefined : args[modelIndex + 1];
 if (!model) throw new Error('synthetic_model_missing');
 const effort=config.match(/model_reasoning_effort\\s*=\\s*"([^"]+)"/)?.[1];
 const capabilityHash=require('node:crypto').createHash('sha256').update(process.env.REVIEWROUTER_LOCAL_MODEL_TOKEN).digest('hex');
 fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({event:'started',model,home:process.env.HOME,codexHome:process.env.CODEX_HOME})+'\\n');
 const response = await fetch(base.replace(/\\/$/, '') + '/responses', {method:'POST', headers:{'content-type':'application/json', authorization:process.env.REVIEWROUTER_LOCAL_MODEL_TOKEN}, body:JSON.stringify({model,input:'Review the supplied change',stream:true,...(effort?{reasoning:{effort}}:{})})});
 const text = await response.text();
 if (!response.ok || !text.includes('response.completed')) throw new Error('synthetic_native_response_failed:'+response.status+':'+text);
 fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({event:'completed',model,effort,capabilityHash,home:process.env.HOME,codexHome:process.env.CODEX_HOME})+'\\n');
 const output = args[args.indexOf('--output-last-message')+1];
 if (!output) throw new Error('synthetic_output_path_missing');
 fs.writeFileSync(output, JSON.stringify({findings:[],revalidations:[]}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:11,output_tokens:7}}));
})().catch(error=>{fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event:'failed',message:error.message})+'\\n');console.error(error.message);process.exitCode=1;});
`;
}
function syntheticNpm(codex: string, version: string) {
  return `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
const prefix=args[args.indexOf('--prefix')+1];
if(!prefix || args.at(-1)!==${JSON.stringify(`@openai/codex@${version}`)}) process.exit(96);
const target=path.join(prefix,'node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/bin/codex');
fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(${JSON.stringify(codex)},target);fs.chmodSync(target,0o700);
`;
}
function syntheticOcr(log: string, version: string) {
  return `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
if(args.includes('--version')) { console.log('opencodereview ${version} linux/amd64'); process.exit(0); }
const arg=(name)=>args[args.indexOf(name)+1];
(async()=>{
 const output=arg('--output');
 if(args.includes('--preview')) {
  fs.writeFileSync(output,JSON.stringify({files:[{path:'tax.js',status:'modified',will_review:true}]})); return;
 }
 const provider=JSON.parse(fs.readFileSync(path.join(process.env.HOME,'.opencodereview/config.json'),'utf8')).custom_providers.reviewrouter;
 const model=arg('--model');
 const capabilityHash=require('node:crypto').createHash('sha256').update('Bearer '+provider.api_key).digest('hex');
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event:'started',model,home:process.env.HOME,engine:'ocr'})+'\\n');
 const response=await fetch(provider.url+'/responses',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+provider.api_key},body:JSON.stringify({...provider.extra_body,model,input:'Review the supplied change',stream:true})});
 const text=await response.text();
 if(!response.ok || !text.includes('response.completed'))throw Error('synthetic_native_response_failed:'+response.status+':'+text);
 fs.writeFileSync(output,JSON.stringify({
  status:'complete',llm:{provider:'reviewrouter',model},summary:{input_tokens:11,output_tokens:7,total_tokens:18},comments:[],
  manifest:{schema_version:'ocr.run-manifest/v1',operation:'review',terminal_state:'complete',input:{mode:'range',resolved_base:arg('--from'),resolved_head:arg('--to')}},
  reviewrouter_outcome:{schema_version:'reviewrouter.ocr-outcome/v1',run_stop_cause:null,grouping:{state:'completed',reason:null},groups:[{
   paths:['tax.js'],main_completed:true,stop_cause:null,rounds:{configured:2,started:1,completed:1},
   phases:{plan:{state:'not_applicable',reason:'threshold'},compression:{state:'not_applicable',reason:'no_zone'},relocation:{state:'not_applicable',reason:'no_candidates'},filter:{state:'not_applicable',reason:'no_candidates'}},filter_decision_valid:null,
  }]},
 }));
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event:'completed',model,capabilityHash,home:process.env.HOME,engine:'ocr'})+'\\n');
})().catch(error=>{fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({event:'failed',message:error.message})+'\\n');console.error(error.message);process.exitCode=1;});
`;
}
function localGit(repository: string) {
  return `#!${process.execPath}
const cp=require('node:child_process'),args=process.argv.slice(2);
// Substitute only the external SCM transport; all Git object/checkout validation stays real.
let actual=args;
if(args.includes('fetch')) { const i=args.indexOf('fetch'); actual=['-c','protocol.file.allow=always',...args.slice(i).map(value=>value==='origin'?${JSON.stringify(repository)}:value)]; }
const result=cp.spawnSync('/usr/bin/git',actual,{stdio:'inherit',env:process.env});process.exit(result.status??1);
`;
}
function preloadSource(input: {
  artifact: string;
  artifactDigest: string;
  origin: string;
  binaries: readonly { from: string; to: string }[];
}) {
  return `
const fs=require('node:fs'),crypto=require('node:crypto'),Module=require('node:module');
const artifact=${JSON.stringify(input.artifact)},original=Module.prototype._compile;
if(crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex')!==${JSON.stringify(input.artifactDigest)})throw Error('artifact_changed');
Module.prototype._compile=function(source,filename){if(fs.realpathSync(filename)===fs.realpathSync(artifact)){for(const binary of ${JSON.stringify(input.binaries)}){if(!source.includes(binary.from))throw Error('approved_profile_missing');source=source.replaceAll(binary.from,binary.to);}}return original.call(this,source,filename);};
const networkFetch=globalThis.fetch;
function pairedTarget(url){
 if(url.origin==='https://multi-paired.reviewrouter.invalid')return ${JSON.stringify(input.origin)}+url.pathname+url.search;
 if(url.hostname==='token.actions.githubusercontent.com'&&url.pathname==='/token')return ${JSON.stringify(input.origin + "/__oidc")};
 if(url.hostname==='api.github.com')return ${JSON.stringify(input.origin + "/__github")}+url.pathname+url.search;
 if(url.hostname==='127.0.0.1')return url.href;
 throw Error('paired_external_network_forbidden:'+url.origin);
}
// The Gateway adapter deliberately uses bounded Node HTTP streams instead of
// fetch. Replace only this fixture's external hostname at the socket boundary.
require('node:https').request=(resource,options,callback)=>require('node:http').request(pairedTarget(new URL(resource)),options,callback);
globalThis.fetch=async(resource,init)=>{
 const request=resource instanceof Request?resource:new Request(String(resource),init),url=new URL(request.url);
 const target=pairedTarget(url);
 return networkFetch(target,{method:request.method,headers:request.headers,...(['GET','HEAD'].includes(request.method)?{}:{body:await request.text()}),signal:request.signal});
};
`;
}
