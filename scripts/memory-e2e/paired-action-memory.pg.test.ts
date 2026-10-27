import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  MemoryKnowledgeService,
  createMemoryBodyHash,
  defaultMemoryPolicyConfig,
  memoryKnowledgeCommandDigest,
  memoryKnowledgeScopeKey,
  memoryKnowledgeTopicsDigest,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeReader,
  type MemoryProviderEntry,
} from "../../packages/features/memory/src/index.js";
import { PrismaMemoryKnowledgeStore } from "../../packages/features/memory/src/infrastructure/index.js";
import type { MemoryKnowledgeRuntime } from "../../packages/features/memory/src/composition/index.js";
import { UnlimitedMemoryQuotaPolicy } from "../../packages/features/memory/src/application/ports/memory-quota-policy-port.js";
import {
  registerReviewExecutionV2Routes,
  registerReviewEvidenceV2Routes,
} from "../../packages/features/action-control-plane/src/v2/interface/index.js";
import { composeReviewActionV2ProductionRoutes } from "../../apps/api/src/review-action-v2-production-composition.js";
import { createReviewMemoryInputAdmission } from "../../apps/api/src/review-memory-admission.js";
import {
  ReviewMemoryRuntimeGateway,
  registerReviewMemoryRuntimeRoutes,
} from "../../apps/api/src/review-memory-runtime.js";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
} from "../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";

const enabled = process.env.REVIEW_ROUTER_MEMORY_PAIRED_E2E === "1";
const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const actionSourceDir = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
if (
  enabled &&
  (!databaseUrl || !actionSourceDir || !path.isAbsolute(actionSourceDir))
)
  throw new Error(
    "paired_memory_requires_disposable_database_and_absolute_action_source",
  );

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/**
 * Real public Action capture/prompt/manifest/client and real Fastify TCP/Prisma
 * admission. Provider-owned text is a declared deterministic reader fixture;
 * inference returns a declared deterministic empty finding set. No Hindsight
 * runtime or selected-model quality qualification is claimed here.
 */
(enabled ? it : it.skip)(
  "pairs actual Action memory with PostgreSQL admission, lost ACK restoration and uncharged stale-input fallback",
  async () => {
    const httpFetch = globalThis.fetch.bind(globalThis);
    await resetReviewActionV2E2EDatabase(databaseUrl!);
    const fixture = await createReviewActionV2E2EHarness(databaseUrl!, {
      protocolMaxAttemptsPerSlot: 2,
    });
    const app = Fastify();
    const generation = `paired-memory-${randomUUID()}`;
    try {
      const load = (relative: string) =>
        import(pathToFileURL(path.join(actionSourceDir!, relative)).href);
      const [memory, action, protocol, planning, prompts, defaults, prepared] =
        await Promise.all([
          load("src/control-plane/review-memory-v2.ts"),
          load(
            "src/review-orchestration/infrastructure/codex-review-invocation-adapter.ts",
          ),
          load(
            "src/review-orchestration/infrastructure/review-action-v2-control-plane-adapter.ts",
          ),
          load(
            "src/review-orchestration/infrastructure/production-t0-review-runner.ts",
          ),
          load("src/analysis/llm/prompt-builder.ts"),
          load("src/config/defaults.ts"),
          load("src/providers/prepared-invocation.ts"),
        ]);
      const clientModule = await load(
        "src/control-plane/review-action-v2-client.ts",
      );
      const receipt = await fixture.authorize();
      const authorization = protocol.projectReviewRunAuthorization(
        receipt.result,
      );
      const scope = {
        kind: "repository" as const,
        workspaceId: fixture.workspaceId,
        repositoryId: fixture.repositoryConnectionId,
      };
      const now = new Date();
      const body =
        "Use UTC for persisted event timestamps. Публичный контракт времени.";
      const ref = {
        type: "entry" as const,
        scope,
        entryId: `mem_${randomUUID().replaceAll("-", "")}`,
      };
      const actor = {
        kind: "workspace_user" as const,
        id: "synthetic-approved-owner",
        githubUserId: null,
        login: null,
      };
      const approval = {
        actor,
        approvedAt: now.toISOString(),
        authorityRevision: "synthetic-owner-approval-v1",
      };
      const metadata: MemoryKnowledgeEntryMetadata = {
        ref,
        generation,
        revision: "1",
        contentApprovalRevision: "1",
        bodyDigest: createMemoryBodyHash(body),
        topicsDigest: memoryKnowledgeTopicsDigest([]),
        kind: "rule",
        lifecycle: "active",
        approval,
        source: {
          type: "manual",
          sourceId: "synthetic-approved-statement",
          revision: "1",
          updatedAt: now.toISOString(),
          statementAt: now.toISOString(),
          repositoryId: fixture.repositoryConnectionId,
          pullRequestNumber: null,
          url: null,
          visibility: "private",
          claimedBodyDigest: null,
          observedCommitSha: null,
        },
        applicability: {
          validUntil: null,
          observedCommitSha: null,
          exceptionRule: null,
        },
        originalStatementAt: now.toISOString(),
        lastVerifiedAt: now.toISOString(),
        pendingCommandId: null,
        revocationCommandId: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      const entry: MemoryProviderEntry = {
        ref,
        body,
        bodyDigest: metadata.bodyDigest!,
        contentApprovalRevision: "1",
        kind: "rule",
        topicIds: [],
        statementAt: now.toISOString(),
        sourceFactIds: ["synthetic-native-fact"],
      };
      const store = new PrismaMemoryKnowledgeStore(fixture.prisma);
      const reader: MemoryKnowledgeReader = {
        read: async (selected) =>
          selected.entryId === ref.entryId &&
          memoryKnowledgeScopeKey(selected.scope) ===
            memoryKnowledgeScopeKey(scope)
            ? entry
            : null,
        list: async () => ({ entries: [entry], nextCursor: null }),
        recall: async (input) =>
          memoryKnowledgeScopeKey(input.scope) ===
          memoryKnowledgeScopeKey(scope)
            ? [{ type: "entry", entry }]
            : [],
      };
      const policy = { getPolicy: async () => defaultMemoryPolicyConfig };
      const unavailable = async (): Promise<never> => {
        throw new Error("paired_reader_fixture_never_delivers_provider_writes");
      };
      const runtime: MemoryKnowledgeRuntime = {
        enabled: true,
        generation,
        providerProfileVersion: "paired-approved-source-v1",
        store,
        policy,
        cleanupProof: null,
        forAccess: (access) =>
          new MemoryKnowledgeService({
            generation,
            providerProfileVersion: "paired-approved-source-v1",
            store,
            reader,
            writer: { submit: unavailable },
            observer: { observe: unavailable },
            access,
            policy,
            quota: new UnlimitedMemoryQuotaPolicy(),
          }),
      };
      // Normal command admission creates this row before any entry is active.
      // This test seeds an already approved entry, so seed its same fence too.
      await fixture.prisma.memoryKnowledgeMaintenanceFence.create({
        data: {
          generation,
          epoch: 0n,
          paused: false,
          actor: "synthetic-approved-fixture",
        },
      });
      for (const selected of [
        { kind: "workspace" as const, workspaceId: fixture.workspaceId },
        scope,
      ])
        await fixture.prisma.memoryKnowledgeScopeState.create({
          data: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(selected),
            workspaceId: fixture.workspaceId,
            epoch: 1n,
          },
        });
      await fixture.prisma.memoryKnowledgeEntry.create({
        data: {
          generation,
          scopeKey: memoryKnowledgeScopeKey(scope),
          workspaceId: fixture.workspaceId,
          entryId: ref.entryId,
          revision: 1,
          lifecycle: "active",
          metadata: metadata as unknown as Prisma.InputJsonValue,
        },
      });

      const routes = composeReviewActionV2ProductionRoutes({
        enabled: true,
        env: fixture.env,
        prisma: fixture.prisma,
        runtime: {
          readServerTime: async () => new Date(),
          createRequestId: () => randomUUID(),
        },
        memoryInputAdmission: createReviewMemoryInputAdmission(runtime),
      });
      if (!routes.contextTools)
        throw new Error("paired_real_authorization_reader_missing");
      await registerReviewExecutionV2Routes(app, routes.execution);
      await registerReviewEvidenceV2Routes(app, routes.evidence);
      await registerReviewMemoryRuntimeRoutes(
        app,
        new ReviewMemoryRuntimeGateway({
          prisma: fixture.prisma,
          runtime,
          access: routes.contextTools,
        }),
      );
      const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
      let bundleReads = 0;
      let discardAcknowledgement = false;
      let discardedAcknowledgements = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        const pathname = new URL(request.url).pathname;
        if (pathname.endsWith("/memory/bundle")) bundleReads += 1;
        const response = await httpFetch(request);
        if (
          discardAcknowledgement &&
          pathname.endsWith("/review-invocation-leases/acquire")
        ) {
          discardAcknowledgement = false;
          discardedAcknowledgements += 1;
          expect(response.ok).toBe(true);
          const committed = await response.json();
          expect(committed.result.status).toBe("acquired");
          throw new TypeError("synthetic_committed_lease_ack_lost");
        }
        return response;
      };
      const binding = {
        authorizationId: authorization.authorizationId,
        repositoryConnectionId: authorization.facts.repositoryConnectionId,
        pullRequestNumber: authorization.facts.pullRequestNumber,
        baseSha: authorization.facts.baseSha,
        headSha: authorization.facts.headSha,
        reviewRevisionHash: authorization.facts.reviewRevisionHash,
      };
      const pr = {
        number: binding.pullRequestNumber,
        title: "Synthetic timestamp change",
        body: "",
        author: "fixture",
        draft: false,
        labels: [],
        files: [
          {
            filename: "timestamps.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            changes: 2,
            patch:
              "@@ -1 +1 @@\n-export const format = 'local';\n+export const format = 'UTC';",
          },
        ],
        diff: "",
        additions: 1,
        deletions: 1,
        baseSha: binding.baseSha,
        headSha: binding.headSha,
      };
      const session = await memory.ReviewMemorySession.capture({
        apiUrl: baseUrl,
        authorizationToken: authorization.authorizationToken,
        binding,
        enabled: true,
        pr,
        fetchImpl,
      });
      const snapshot = session.current();
      expect(snapshot).not.toBeNull();
      expect(snapshot.renderedPrompt).toContain(body);
      expect(await session.isEligible(snapshot.hash)).toBe(true);
      const storedReceipt =
        await fixture.prisma.memoryKnowledgeBundleReceipt.findUniqueOrThrow({
          where: {
            authorizationId_snapshotHash: {
              authorizationId: authorization.authorizationId,
              snapshotHash: snapshot.hash,
            },
          },
        });
      expect(storedReceipt.workspaceId).toBe(fixture.workspaceId);
      expect(JSON.stringify(storedReceipt.receipt)).not.toContain(body);

      const config = {
        ...defaults.DEFAULT_CONFIG,
        providers: ["codex/gpt-paired-memory"],
        synthesisModel: "codex/gpt-paired-memory",
        providerRetries: 2,
        updatePrDescription: false,
        reviewThreadLifecycle: "off",
        codexAgenticContext: false,
        enableTokenAwareBatching: false,
      };
      const planned = planning.planAssignments({
        authorization,
        pr,
        config,
        providerName: "codex/gpt-paired-memory",
        compatibilityKey: hash("paired-memory-config"),
        lifecycleTargets: [],
        liveLifecycleStateHash: hash("empty-lifecycle"),
      });
      const workSlot = planned.plan.assignments[0].workSlot;
      expect(workSlot.attemptBudget).toBe(2);
      const modelPrompts: string[] = [];
      const provider = {
        prepareInvocation: async (prompt: string) =>
          prepared.createPreparedProviderInvocation({
            providerKind: prepared.ProviderKind.CodexCli,
            providerName: "codex/gpt-paired-memory",
            requestedModel: "gpt-paired-memory",
            timeoutMs: 1000,
            request: { prompt, outputSchema: { type: "object" } },
          }),
        describePreparedEnvironmentContract: () => ({}),
        executePreparedInvocation: async (request: {
          readonly request: { readonly prompt: string };
        }) => {
          modelPrompts.push(request.request.prompt);
          return { findings: [], actualModel: "gpt-paired-memory" };
        },
      };
      const invocations = new action.CodexReviewInvocationAdapter(
        provider,
        new prompts.PromptBuilder(config),
        planned.assignments,
        1000,
        false,
        undefined,
        false,
        "xhigh",
        undefined,
        undefined,
        session,
      );
      const assembler = new action.GeneratedProviderInvocationManifestAssembler(
        authorization,
        config,
        hash("paired-memory-config"),
      );
      const invocation = await invocations.prepare({
        workSlot,
        attemptOrdinal: 1,
      });
      const manifest = await assembler.assemble(invocation);
      expect(invocation.reviewPrompt).toContain(body);
      expect(JSON.parse(manifest.manifestCanonicalJson).memoryBundleHash).toBe(
        snapshot.hash,
      );
      const client = new clientModule.ReviewActionV2Client({
        apiUrl: baseUrl,
        allowInsecureLocalhost: true,
        maxAttempts: 1,
        fetchImpl,
      });
      const controlPlane = new protocol.ReviewActionV2ControlPlaneAdapter(
        client,
      );
      const execution = await controlPlane.startExecution({
        authorization,
        idempotencyKey: hash("paired-start"),
        executionId: `paired-memory-${randomUUID()}`,
        reviewRevisionHash: binding.reviewRevisionHash,
        compatibilityKey: hash("paired-memory-config"),
        planHash: planned.plan.planHash,
        workSlotsCanonicalJson: planned.plan.workSlotsCanonicalJson,
        assignmentManifestCanonicalJson:
          planned.plan.assignmentManifestCanonicalJson,
        assignmentManifestHash: planned.plan.assignmentManifestHash,
        workSlots: planned.plan.assignments.map(
          (assignment: { workSlot: unknown }) => assignment.workSlot,
        ),
        sourceRunId: authorization.facts.sourceRunId,
        sourceRunAttempt: authorization.facts.sourceRunAttempt,
      });
      const ownerIdHash = hash("paired-owner");
      const acquire = {
        authorization,
        execution,
        workSlot,
        manifest,
        ownerIdHash,
        acquireRequestId: hash("paired-acquire-1"),
        idempotencyKey: hash("paired-acquire-1"),
      };
      discardAcknowledgement = true;
      await expect(
        controlPlane.acquireInvocationLease(acquire),
      ).rejects.toMatchObject({
        code: "network_failure",
        cause: { message: "synthetic_committed_lease_ack_lost" },
      });
      expect(discardedAcknowledgements).toBe(1);
      const firstLease =
        await fixture.prisma.reviewInvocationLeaseV2.findFirstOrThrow({
          where: { executionId: execution.executionId },
        });
      expect(
        await fixture.prisma.reviewInvocationLeaseV2.count({
          where: { executionId: execution.executionId },
        }),
      ).toBe(1);

      // Real durable retirement intent revokes new admissions immediately; no
      // provider write is needed before the current eligibility fence changes.
      const revokeAt = new Date();
      const retire = {
        kind: "retire" as const,
        ref,
        commandId: randomUUID(),
        expectedRevision: "1",
        generation,
        providerProfileVersion: runtime.providerProfileVersion,
        approval,
      };
      await store.admit({
        command: retire,
        digest: memoryKnowledgeCommandDigest(retire),
        now: revokeAt,
        deliveryExpiresAt: new Date(revokeAt.getTime() + 60_000),
        resubmitUntil: revokeAt,
        activeEntryLimit: null,
        pendingCommandLimit: 100,
      });
      const restored = await controlPlane.acquireInvocationLease(acquire);
      expect(restored.status).toBe("acquired");
      expect(restored.lease.leaseId).toBe(firstLease.leaseId);
      expect(restored.lease.attemptId).toBe(firstLease.attemptId);
      expect(discardedAcknowledgements).toBe(1);
      expect(
        await fixture.prisma.reviewInvocationLeaseV2.count({
          where: { executionId: execution.executionId },
        }),
      ).toBe(1);
      await controlPlane.releaseInvocationLease({
        lease: restored.lease,
        ownerIdHash,
        releaseRequestId: hash("paired-release-1"),
        idempotencyKey: hash("paired-release-1"),
      });
      const slotBeforeRejection =
        await fixture.prisma.reviewExecutionWorkSlotV2.findUniqueOrThrow({
          where: {
            executionId_workSlotId: {
              executionId: execution.executionId,
              workSlotId: workSlot.workSlotId,
            },
          },
        });
      expect(slotBeforeRejection.nextAttemptOrdinal).toBe(2);

      const stale = await controlPlane.acquireInvocationLease({
        ...acquire,
        acquireRequestId: hash("paired-acquire-2-stale"),
        idempotencyKey: hash("paired-acquire-2-stale"),
      });
      expect(stale.status).toBe("input_stale");
      // Prove retirement caused the rejection rather than an expired receipt.
      // Reading the real server clock after the response also proves freshness
      // throughout the preceding admission call, even on a slow runner.
      const [afterRejection] = await fixture.prisma.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS "now"`;
      expect(afterRejection).toBeDefined();
      expect(storedReceipt.expiresAt.getTime()).toBeGreaterThan(
        afterRejection!.now.getTime(),
      );
      const slotAfterRejection =
        await fixture.prisma.reviewExecutionWorkSlotV2.findUniqueOrThrow({
          where: {
            executionId_workSlotId: {
              executionId: execution.executionId,
              workSlotId: workSlot.workSlotId,
            },
          },
        });
      expect(slotAfterRejection.nextAttemptOrdinal).toBe(
        slotBeforeRejection.nextAttemptOrdinal,
      );
      expect(
        await fixture.prisma.reviewInvocationLeaseV2.count({
          where: { executionId: execution.executionId },
        }),
      ).toBe(1);
      session.discard();
      const withoutMemory = await invocations.prepare({
        workSlot,
        attemptOrdinal: 2,
      });
      const currentManifest = await assembler.assemble(withoutMemory);
      expect(withoutMemory.reviewPrompt).not.toContain(body);
      expect(
        JSON.parse(currentManifest.manifestCanonicalJson).memoryBundleHash,
      ).toBeNull();
      expect(currentManifest.providerInvocationKey).not.toBe(
        manifest.providerInvocationKey,
      );
      const current = await controlPlane.acquireInvocationLease({
        ...acquire,
        manifest: currentManifest,
        acquireRequestId: hash("paired-acquire-2-current"),
        idempotencyKey: hash("paired-acquire-2-current"),
      });
      expect(current.status).toBe("acquired");
      expect(current.lease.attemptId).not.toBe(firstLease.attemptId);
      expect(
        await fixture.prisma.reviewInvocationLeaseV2.count({
          where: { executionId: execution.executionId },
        }),
      ).toBe(2);
      expect(bundleReads).toBe(1);
      const observation = await invocations.execute({
        invocation: withoutMemory,
        manifest: currentManifest,
        lease: current.lease,
        sourceExecutionId: execution.executionId,
        sourceReviewRevisionHash: binding.reviewRevisionHash,
        signal: new AbortController().signal,
      });
      expect(modelPrompts).toHaveLength(1);
      expect(modelPrompts[0]).not.toContain(body);
      const committed = await controlPlane.commitEvidence({
        authorization,
        idempotencyKey: hash("paired-memory-evidence"),
        lease: current.lease,
        ownerIdHash,
        observation,
      });
      const persistedObservation =
        await fixture.prisma.reviewEvidenceObservation.findUniqueOrThrow({
          where: { observationId: committed.observationId },
        });
      expect(persistedObservation.payloadHash).toBe(observation.payloadHash);
      await controlPlane.releaseInvocationLease({
        lease: current.lease,
        ownerIdHash,
        releaseRequestId: hash("paired-release-2"),
        idempotencyKey: hash("paired-release-2"),
      });
    } finally {
      await app.close();
      await fixture.prisma.memoryKnowledgeBundleReceipt.deleteMany({
        where: { workspaceId: fixture.workspaceId },
      });
      await fixture.prisma.memoryKnowledgeCommand.deleteMany({
        where: { generation },
      });
      await fixture.prisma.memoryKnowledgeEntry.deleteMany({
        where: { generation },
      });
      await fixture.prisma.memoryKnowledgeScopeState.deleteMany({
        where: { generation },
      });
      await fixture.prisma.memoryKnowledgeMaintenanceFence.deleteMany({
        where: { generation },
      });
      await fixture.close();
      await resetReviewActionV2E2EDatabase(databaseUrl!);
    }
  },
  60_000,
);
