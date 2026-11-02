import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
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
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
} from "../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";

import { composeReviewActionV2ProductionRoutes } from "../../apps/api/src/review-action-v2-production-composition.js";
import { createReviewMemoryInputAdmission } from "../../apps/api/src/review-memory-admission.js";
import {
  ReviewMemoryRuntimeGateway,
  registerReviewMemoryRuntimeRoutes,
} from "../../apps/api/src/review-memory-runtime.js";
import {
  audienceMemoryStatements,
  createApprovedMemoryFixture,
  cleanupApprovedMemoryFixture,
} from "../memory-e2e/support/approved-memory-fixture.js";

const enabled =
  process.env.REVIEW_ROUTER_REVIEW_INVESTIGATION_PAIRED_E2E === "1";
const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const actionSourceDir = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
if (enabled && (!databaseUrl || !actionSourceDir))
  throw new Error("paired_description_database_and_action_source_required");
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

(enabled && databaseUrl && actionSourceDir
  ? it.each([false, true])
  : it.skip.each([false, true]))(
  "pairs the real public description factory/manifest with PG auxiliary authority and App publication (body conflict=%s)",
  async (bodyConflict) => {
    const httpFetch = globalThis.fetch.bind(globalThis);
    const generation = `paired-description-${randomUUID()}`;
    await resetReviewActionV2E2EDatabase(databaseUrl!);
    const fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
      prDescriptionProfile: true,
      // The workspace OpenRouter default below must not be shadowed.
      repositoryProviderSelection: "none",
      // Canonical direct checkout captures the producer's approved Skills witness.
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
    const app = Fastify();
    const originalBody =
      "Author requirements.\n\n  Keep this trailing whitespace.  \n";
    let currentBody = originalBody;
    let bodyWrites = 0;
    let generatedRequests = 0;
    const generatedMarkdown =
      "## Summary\nPreserve invoice ownership when selecting invoices.";
    try {
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
      // OpenRouter is delivered only by the workspace's managed API key.
      await fixture.prisma.providerApiKeyConnection.create({
        data: {
          workspaceId: fixture.workspaceId,
          providerType: "openrouter",
          encryptedApiKey: "paired-e2e-ciphertext",
          keyVersion: 1,
          latestOperationId: `${fixture.prefix}-openrouter-key`,
        },
      });
      const workspaceTarget = {
        scope: "workspace" as const,
        workspaceId: fixture.workspaceId,
      };
      await new PrismaReviewConfigurationRepository(
        fixture.prisma,
        undefined,
        false,
        undefined,
      ).saveNextVersion({
        target: workspaceTarget,
        expectedVersion: 1,
        ...systemPolicyWriteFixture(config, workspaceTarget),
      });
      const source = renderReviewRouterProviderApiCaller({
        runtimeRef: "a".repeat(40),
        controlPlaneUrl: fixture.env.REVIEW_ROUTER_PUBLIC_API_URL!,
      });
      const previousFetch = fixture.fakeGitHub.fetch;
      vi.spyOn(fixture.fakeGitHub, "fetch").mockImplementation(
        async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(String(input), init);
          const url = new URL(request.url);
          if (
            decodeURIComponent(url.pathname).endsWith(
              "/contents/.github/workflows/reviewrouter-review.yml",
            )
          )
            return Response.json({
              type: "file",
              path: ".github/workflows/reviewrouter-review.yml",
              encoding: "base64",
              content: Buffer.from(source).toString("base64"),
            });
          if (
            request.method === "POST" &&
            url.pathname.endsWith("/access_tokens")
          ) {
            const body = JSON.parse((await request.clone().text()) || "{}");
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
          if (url.pathname.endsWith("/pulls/42") && request.method === "GET") {
            const response = await previousFetch(input, init);
            if (
              bodyConflict &&
              fixture.fakeGitHub.comments.length === 1 &&
              fixture.fakeGitHub.checkRuns.length === 1
            )
              currentBody += "\nConcurrent author edit.";
            return Response.json({
              ...(await response.json()),
              body: currentBody,
            });
          }
          if (
            url.pathname.endsWith("/pulls/42") &&
            request.method === "PATCH"
          ) {
            bodyWrites += 1;
            currentBody = JSON.parse(await request.text()).body;
            return Response.json({
              number: 42,
              body: currentBody,
              head: { sha: fixture.fakeGitHub.revision.headSha },
            });
          }
          return previousFetch(input, init);
        },
      );
      const authorized = await fixture.authorize({
        providerApiAuthMode: "openrouter-api",
      });
      await fixture.prisma.repositoryConnection.update({
        where: { id: fixture.repositoryConnectionId },
        data: { visibility: "public" },
      });
      const approvedMemory = await createApprovedMemoryFixture({
        prisma: fixture.prisma,
        workspaceId: fixture.workspaceId,
        repositoryId: fixture.repositoryConnectionId,
        generation,
        statements: audienceMemoryStatements,
      });
      const memoryRoutes = composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: fixture.env,
        prisma: fixture.prisma,
        runtime: {
          readServerTime: async () => new Date(),
          createRequestId: () => randomUUID(),
        },
        memoryInputAdmission: createReviewMemoryInputAdmission(
          approvedMemory.runtime,
        ),
      });
      if (!memoryRoutes.contextTools)
        throw new Error("paired_description_memory_authority_missing");
      const flow = await fixture.createCommittedFlow({
        authorization: authorized,
        prDescription: true,
      });
      await fixture.releaseProviderLease(flow);
      await registerReviewRunCheckoutRoute(
        app,
        fixture.routes.providerApiCheckout!,
      );
      await registerReviewExecutionV2Routes(app, memoryRoutes.execution);
      await registerReviewMemoryRuntimeRoutes(
        app,
        new ReviewMemoryRuntimeGateway({
          prisma: fixture.prisma,
          runtime: approvedMemory.runtime,
          access: memoryRoutes.contextTools,
        }),
      );
      const apiUrl = await app.listen({ host: "127.0.0.1", port: 0 });
      const checkoutResponse = await app.inject({
        method: "POST",
        url: "/api/action/v2/provider-api/checkout",
        headers: { authorization: `Bearer ${authorized.authorizationToken}` },
        payload: {
          providerApiAuthMode: "openrouter-api",
          workflowSchemaVersion: 2,
        },
      });
      expect(checkoutResponse.statusCode, checkoutResponse.body).toBe(200);
      const runtimeEnv = checkoutResponse.json().runtimeConfig.runtimeEnv;
      const load = (relative: string) =>
        import(pathToFileURL(path.join(actionSourceDir!, relative)).href);
      const [
        parentModule,
        manifestModule,
        adapterModule,
        clientModule,
        configModule,
        memoryModule,
      ] = await Promise.all([
        load(
          "src/review-orchestration/infrastructure/pr-description-generation.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/codex-review-invocation-adapter.ts",
        ),
        load(
          "src/review-orchestration/infrastructure/review-action-v2-control-plane-adapter.ts",
        ),
        load("src/control-plane/review-action-v2-client.ts"),
        load("src/config/loader.ts"),
        load("src/control-plane/review-memory-v2.ts"),
      ]);
      const authorization = adapterModule.projectReviewRunAuthorization(
        authorized.result,
      );
      const capturedConfig =
        configModule.ConfigLoader.loadRuntimeEnvironment(runtimeEnv);
      expect(runtimeEnv.UPDATE_PR_DESCRIPTION).not.toBe("false");
      expect(
        JSON.parse(runtimeEnv.REVIEW_ROUTER_PR_DESCRIPTION_CAPABILITY_JSON)
          .extensionId,
      ).toBe("pr-description.v1");
      const slot =
        await fixture.prisma.reviewExecutionWorkSlotV2.findFirstOrThrow({
          where: { executionId: flow.executionId, taskKind: "pr_description" },
        });
      expect(slot).toMatchObject({
        required: false,
        attemptBudget: 1,
        state: "pending",
      });
      const workSlot = {
        workSlotId: slot.workSlotId,
        taskKind: slot.taskKind,
        required: slot.required,
        attemptBudget: slot.attemptBudget,
        providerKind: slot.providerKind,
        providerVoteIdentityHash: slot.providerVoteIdentityHash,
        retryPolicyVersion: slot.retryPolicyVersion,
        shardKey: slot.shardKey,
      };
      const pr = {
        number: 42,
        title: "Preserve invoice selection",
        body: originalBody,
        author: "fixture",
        draft: false,
        labels: [],
        additions: 1,
        deletions: 1,
        baseSha: fixture.fakeGitHub.revision.baseSha,
        headSha: fixture.fakeGitHub.revision.headSha,
        diff: "",
        files: [
          {
            filename: "src/invoice.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            changes: 2,
            patch:
              "-return invoices;\n+return invoices.filter(invoice => invoice.owner === owner);",
          },
        ],
      };
      const session = await memoryModule.ReviewMemorySession.capture({
        apiUrl,
        authorizationToken: authorization.authorizationToken,
        enabled: true,
        task: "pr_description",
        pr,
        fetchImpl: httpFetch,
        binding: {
          authorizationId: authorization.authorizationId,
          repositoryConnectionId: authorization.facts.repositoryConnectionId,
          pullRequestNumber: authorization.facts.pullRequestNumber,
          baseSha: authorization.facts.baseSha,
          headSha: authorization.facts.headSha,
          reviewRevisionHash: authorization.facts.reviewRevisionHash,
        },
      });
      const snapshot = session.current();
      expect(snapshot).not.toBeNull();
      expect(snapshot.bundle.contextPolicy).toEqual({
        audience: "public",
        repositoryId: fixture.repositoryConnectionId,
        allowedTasks: ["pr_description"],
      });
      const receipt =
        await fixture.prisma.memoryKnowledgeBundleReceipt.findUniqueOrThrow({
          where: {
            authorizationId_snapshotHash: {
              authorizationId: authorization.authorizationId,
              snapshotHash: snapshot.hash,
            },
          },
        });
      expect(receipt.receipt).toMatchObject({
        contextPolicy: snapshot.bundle.contextPolicy,
      });
      for (const { body } of audienceMemoryStatements)
        expect(JSON.stringify(receipt.receipt)).not.toContain(body);
      const parent = parentModule.createPrDescriptionGeneration({
        memorySnapshot: snapshot,
        enabled: true,
        capabilityJson: runtimeEnv.REVIEW_ROUTER_PR_DESCRIPTION_CAPABILITY_JSON,
        requestedModel: "openai/gpt-5.3-codex",
        providerKind: "codex",
        reviewRevisionHash: flow.reviewRevisionHash,
        config: capturedConfig,
        pr,
        warn: (message: string) => {
          throw new Error(message);
        },
        transport: {
          generatePrDescription: async ({
            requestBody,
          }: {
            requestBody: Uint8Array;
          }) => {
            generatedRequests += 1;
            expect(hash(requestBody)).toBe(
              invocation.manifestFacts.providerRequestEnvelopeHash,
            );
            const body = JSON.parse(Buffer.from(requestBody).toString("utf8"));
            expect(body).toMatchObject({
              model: "openai/gpt-5.3-codex",
              tools: [],
              store: false,
              stream: true,
              max_output_tokens: 1200,
            });
            expect(body.input[0].content[0].type).toBe("input_text");
            const taskInput = JSON.parse(body.input[0].content[0].text);
            expect(taskInput.authorizedProjectContext).toBe(
              snapshot.renderedPrompt,
            );
            expect(taskInput.authorizedProjectContext).toContain(
              audienceMemoryStatements[2]!.body,
            );
            expect(Buffer.from(requestBody).toString("utf8")).not.toContain(
              audienceMemoryStatements[0]!.body,
            );
            expect(Buffer.from(requestBody).toString("utf8")).not.toContain(
              audienceMemoryStatements[1]!.body,
            );
            return {
              generatedMarkdown,
              actualModel: body.model,
              providerRequestEnvelopeHash: hash(requestBody),
            };
          },
        },
      });
      expect(parent).toBeDefined();
      const invocation = await parent.prepare({ workSlot, attemptOrdinal: 1 });
      const assembler =
        new manifestModule.GeneratedProviderInvocationManifestAssembler(
          authorization,
          capturedConfig,
          hash("description-paired-runtime"),
        );
      const manifest = await assembler.assemble(invocation);
      expect(JSON.parse(manifest.manifestCanonicalJson)).toMatchObject({
        memoryBundleHash: snapshot.hash,
        taskKindSet: ["pr_description"],
        providerPolicyVersion: "pr-description-provider-policy.v1",
        requestedModel: "openai/gpt-5.3-codex",
      });
      const client = new clientModule.ReviewActionV2Client({
        apiUrl,
        allowInsecureLocalhost: true,
        maxAttempts: 1,
        fetchImpl: httpFetch,
      });
      const controlPlane = new adapterModule.ReviewActionV2ControlPlaneAdapter(
        client,
      );
      const acquireInput = {
        authorization,
        execution: { executionId: flow.executionId },
        workSlot,
        manifest,
        idempotencyKey: hash("description-acquire"),
        acquireRequestId: hash("description-acquire-request"),
        ownerIdHash: flow.ownerIdHash,
      };
      const acquired = await controlPlane.acquireInvocationLease(acquireInput);
      expect(acquired.status).toBe("acquired");
      const grantedLease =
        await fixture.prisma.reviewInvocationLeaseV2.findUniqueOrThrow({
          where: { leaseId: acquired.lease.leaseId },
        });
      expect(grantedLease.preparedManifestKey).toBe(manifest.manifestKey);
      expect(
        JSON.parse(grantedLease.preparedManifestCanonicalJson!)
          .memoryBundleHash,
      ).toBe(snapshot.hash);
      // An actual repeated wire acquisition cannot authorize a second parent request.
      expect(
        (
          await controlPlane.acquireInvocationLease({
            ...acquireInput,
            idempotencyKey: hash("description-join"),
          })
        ).status,
      ).toBe("not_runnable");
      const description = await parent.execute({
        invocation,
        manifest,
        lease: acquired.lease,
        signal: new AbortController().signal,
      });
      await controlPlane.releaseInvocationLease({
        lease: acquired.lease,
        idempotencyKey: hash("description-release"),
        releaseRequestId: hash("description-release-request"),
        ownerIdHash: flow.ownerIdHash,
      });
      expect(generatedRequests).toBe(1);
      expect(description.generationProvenance).toMatchObject({
        leaseId: acquired.lease.leaseId,
        providerIndex: 0,
        requestedModel: "openai/gpt-5.3-codex",
        actualModel: "openai/gpt-5.3-codex",
        providerRequestEnvelopeHash:
          invocation.manifestFacts.providerRequestEnvelopeHash,
      });
      expect(
        await fixture.prisma.reviewEvidenceObservation.count({
          where: { producerReleaseId: fixture.producerReleaseId },
        }),
      ).toBe(1);
      expect(
        await fixture.prisma.reviewExecutionObservationRefV2.count({
          where: { executionId: flow.executionId },
        }),
      ).toBe(1);
      const finalized = await fixture.finalize(flow, {
        prDescription: description,
      });
      expect(finalized.result.status).toBe("applied");
      await fixture.processFinalizedOutbox();
      await fixture.runWorkerUntilSettled();
      const attempt =
        await fixture.prisma.reviewPublicationAttemptV2.findFirstOrThrow({
          where: { executionId: flow.executionId },
        });
      expect(attempt.terminalOutcome).toBe("succeeded");
      expect(fixture.fakeGitHub.comments).toHaveLength(1);
      expect(fixture.fakeGitHub.checkRuns).toHaveLength(1);
      if (bodyConflict) {
        expect(currentBody.startsWith(originalBody)).toBe(true);
        expect(currentBody).toContain("Concurrent author edit.");
        expect(currentBody).not.toContain(
          "<!-- review-router-summary:start -->",
        );
      } else {
        expect(currentBody.startsWith(originalBody)).toBe(true);
        expect(currentBody).toContain(
          `<!-- review-router-summary:start -->\n${generatedMarkdown}\n<!-- review-router-summary:end -->`,
        );
      }
      expect(bodyWrites).toBe(bodyConflict ? 0 : 1);
      await fixture.runWorkerUntilSettled();
      expect(bodyWrites).toBe(bodyConflict ? 0 : 1);
    } finally {
      vi.restoreAllMocks();
      await app.close();
      await cleanupApprovedMemoryFixture(
        fixture.prisma,
        generation,
        fixture.workspaceId,
      );
      await fixture.close();
      await resetReviewActionV2E2EDatabase(databaseUrl!);
    }
  },
  60_000,
);
