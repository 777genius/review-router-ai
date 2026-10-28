import { MemoryAutomaticSourceService } from "../application/use-cases/memory-automatic-source-service";
import { createMemoryPolicyConfig } from "../application/ports/memory-policy-config-port";
import { PrismaMemoryAutomaticSourceStore } from "../infrastructure/prisma/prisma-memory-automatic-source-store";
import type { MemoryAutomaticSourceInput } from "../application/ports/memory-automatic-source-port";
import type { MemoryAutomaticSourceBinding } from "../domain/memory-knowledge";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { createMemoryBodyHash } from "../domain/memory-body";
import {
  memoryKnowledgeBodyVisible,
  memoryKnowledgeCommandDigest,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeCommand,
} from "../domain/memory-knowledge";
import { PrismaMemoryKnowledgeStore } from "../infrastructure/prisma/prisma-memory-knowledge-store";
import { MemoryKnowledgeService } from "../application/use-cases/memory-knowledge-service";
import type { MemoryProviderEntry } from "../application/ports/memory-knowledge-provider-port";
import type { MemoryVerifiedCleanupReceipt } from "../application/ports/memory-knowledge-store-port";

const databaseUrl = process.env.REVIEW_ROUTER_MEMORY_TEST_DATABASE_URL;
const now = new Date("2026-10-23T10:00:00.000Z");
const scope = {
  kind: "repository" as const,
  workspaceId: "knowledge_workspace",
  repositoryId: "knowledge_repository",
};
const generation = "knowledge_test";
const schema = `memory_knowledge_${randomUUID().replaceAll("-", "")}`;

describe.skipIf(!databaseUrl)(
  "complete memory authority on independent real Prisma/PostgreSQL connections",
  () => {
    let admin: pg.Pool;
    let prisma: PrismaClient;
    let other: PrismaClient;
    let store: PrismaMemoryKnowledgeStore;
    let otherStore: PrismaMemoryKnowledgeStore;

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/reviewrouter_memory_test"
      )
        throw new Error(
          "memory_knowledge_test_requires_disposable_loopback_database",
        );
      admin = new pg.Pool({ connectionString: databaseUrl! });
      const version = await admin.query("SHOW server_version_num");
      if (Number(version.rows[0].server_version_num) < 170000)
        throw new Error("memory_knowledge_test_requires_postgresql17");
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const fixture = new pg.Pool({
        connectionString: databaseUrl!,
        options: `-c search_path=${schema}`,
      });
      try {
        await fixture.query(`
        CREATE TYPE "OutboxEventStatus" AS ENUM ('pending','processing','retry_wait','processed','dead_letter');
        CREATE TABLE "MemoryUsageEvent" ("id" TEXT PRIMARY KEY, "memoryItemId" TEXT);
        CREATE TABLE "AuditEvent" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"actor" TEXT NOT NULL,"action" TEXT NOT NULL,"targetType" TEXT NOT NULL,"targetId" TEXT NOT NULL,"metadata" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE "OutboxEvent" ("id" TEXT PRIMARY KEY,"type" TEXT NOT NULL,"version" INT NOT NULL,"idempotencyKey" TEXT NOT NULL UNIQUE,"workspaceId" TEXT,"repositoryId" TEXT,"aggregateId" TEXT,"payload" JSONB NOT NULL,"status" "OutboxEventStatus" NOT NULL DEFAULT 'pending',"attempts" INT NOT NULL DEFAULT 0,"maxAttempts" INT NOT NULL DEFAULT 5,"nextAttemptAt" TIMESTAMP(3),"claimId" TEXT,"claimVersion" BIGINT,"claimOwnerHash" TEXT,"claimUntil" TIMESTAMP(3),"processedAt" TIMESTAMP(3),"deadLetteredAt" TIMESTAMP(3),"lastErrorCode" TEXT,"safeLastErrorSummary" TEXT,"occurredAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
      `);
        await fixture.query(
          await readFile(
            new URL(
              "../../../../platform/db/prisma/migrations/000142_memory_knowledge_authority/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await fixture.query(
          await readFile(
            new URL(
              "../../../../platform/db/prisma/migrations/000143_memory_maintenance_fence/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await fixture.query(
          await readFile(
            new URL(
              "../../../../platform/db/prisma/migrations/202610280002_memory_automatic_source/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
      } finally {
        await fixture.end();
      }
      const client = (name: string) =>
        new PrismaClient({
          adapter: new PrismaPg(
            {
              connectionString: databaseUrl!,
              options: `-c search_path=${schema}`,
              application_name: `${schema}-${name}`,
              max: 4,
            },
            { schema },
          ),
        });
      prisma = client("first");
      other = client("second");
      store = new PrismaMemoryKnowledgeStore(prisma, {
        automaticSourcesEnabled: true,
        providerProfileVersion: "test_profile",
      });
      otherStore = new PrismaMemoryKnowledgeStore(other, {
        automaticSourcesEnabled: true,
        providerProfileVersion: "test_profile",
      });
    });

    beforeEach(async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE "MemoryAutomaticSource","MemoryAutomaticEntry","MemoryKnowledgeCommand","MemoryKnowledgeEntry","MemoryKnowledgeScopeState","MemoryKnowledgeSourceCursor","MemoryKnowledgeBundleReceipt","MemoryKnowledgeMaintenanceFence","OutboxEvent","AuditEvent"',
      );
    });
    afterAll(async () => {
      await Promise.all([prisma?.$disconnect(), other?.$disconnect()]);
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });

    function save(
      overrides: Partial<
        Extract<MemoryKnowledgeCommand, { kind: "save" }>
      > = {},
    ): Extract<MemoryKnowledgeCommand, { kind: "save" }> {
      const id = randomUUID();
      return {
        kind: "save",
        ref: { type: "entry", scope, entryId: `mem_${id.replaceAll("-", "")}` },
        commandId: id,
        expectedRevision: null,
        generation,
        providerProfileVersion: "test_profile",
        approval: {
          actor: {
            kind: "workspace_user",
            id: "trusted_user",
            githubUserId: null,
            login: null,
          },
          approvedAt: now.toISOString(),
          authorityRevision: "membership_1",
        },
        body: "Use bounded approved statements.",
        knowledgeKind: "rule",
        topicIds: ["group"],
        source: {
          type: "manual",
          sourceId: `decision_${id}`,
          revision: "1",
          updatedAt: now.toISOString(),
          statementAt: now.toISOString(),
          repositoryId: null,
          pullRequestNumber: null,
          url: null,
          visibility: "internal",
          claimedBodyDigest: null,
          observedCommitSha: null,
        },
        applicability: {
          validUntil: null,
          observedCommitSha: null,
          exceptionRule: null,
        },
        temporalMode: "preserve_original",
        ...overrides,
      };
    }
    const admit = (
      command: MemoryKnowledgeCommand,
      target = store,
      activeEntryLimit: number | null = null,
      at = now,
    ) =>
      target.admit({
        command,
        digest: memoryKnowledgeCommandDigest(command),
        now: at,
        deliveryExpiresAt: new Date(at.getTime() + 86400000),
        resubmitUntil: new Date(at.getTime() + 3600000),
        activeEntryLimit,
        pendingCommandLimit: 100,
      });
    const claim = (command: MemoryKnowledgeCommand, target = store, at = now) =>
      target.claim({
        commandId: command.commandId,
        scope,
        generation,
        now: at,
        claimId: randomUUID(),
        claimUntil: new Date(at.getTime() + 10000),
      });
    async function publish(
      command: Extract<MemoryKnowledgeCommand, { kind: "save" }>,
    ) {
      const admitted = await admit(command);
      const work = await claim(command);
      const entry: MemoryProviderEntry = {
        ref: command.ref,
        body: command.body,
        bodyDigest: createMemoryBodyHash(command.body),
        contentApprovalRevision: admitted.revision,
        kind: command.knowledgeKind,
        topicIds: command.topicIds,
        statementAt: work!.command.originalStatementAt!,
        sourceFactIds: ["fact"],
      };
      const result = await store.settle({
        commandId: command.commandId,
        scope,
        generation,
        claimId: work!.claimId,
        result: {
          commandId: command.commandId,
          state: "published",
          verifiedEntry: entry,
        },
        now,
      });
      return { result, entry };
    }

    function automaticInput(revision: number): MemoryAutomaticSourceInput {
      const updatedAt = new Date(now.getTime() + revision * 1000).toISOString();
      return {
        processingId: `processing_${revision}`,
        scope,
        policyRevision: "standing-v1",
        threadId: "thread",
        threadDigest: "d".repeat(64),
        headSha: "a".repeat(40),
        selectableBody: "Synthetic raw source never retained",
        readOnlyContext: "Synthetic raw thread never retained",
        sourceActor: {
          kind: "github_user",
          id: "actor",
          githubUserId: "123",
          login: "maintainer",
        },
        source: {
          type: "github_comment",
          sourceId: "github-node:SOURCE",
          revision: `${updatedAt}:digest`,
          updatedAt,
          statementAt: updatedAt,
          repositoryId: scope.repositoryId,
          pullRequestNumber: 1,
          url: null,
          visibility: "private",
          claimedBodyDigest: createMemoryBodyHash(
            "Synthetic raw source never retained",
          ),
          observedCommitSha: "a".repeat(40),
        },
      };
    }
    async function autoReserve(revision: number, count: number) {
      const input = automaticInput(revision);
      const commands = Array.from({ length: count }, (_, index) =>
        save({
          ref: {
            type: "entry",
            scope,
            entryId: `automatic_${revision}_${index}`,
          },
          source: input.source,
          knowledgeKind: "observation",
        }),
      );
      const sources = new PrismaMemoryAutomaticSourceStore(prisma);
      const state = await sources.reserve({
        input,
        generation,
        expectedPriorEpoch:
          (await sources.lookup(scope, input.source.sourceId))?.binding.epoch ??
          null,
        entryIds: commands.map((c) => c.ref.entryId),
        bodyDigests: commands.map((c) => createMemoryBodyHash(c.body)),
        now,
      });
      return { input, commands, sources, state };
    }
    async function publishAuto(
      command: Extract<MemoryKnowledgeCommand, { kind: "save" }>,
      binding: MemoryAutomaticSourceBinding,
    ) {
      await store.admit({
        command,
        automaticSource: binding,
        digest: memoryKnowledgeCommandDigest(command),
        now,
        deliveryExpiresAt: new Date(now.getTime() + 86400000),
        resubmitUntil: now,
        activeEntryLimit: null,
        pendingCommandLimit: 100,
      });
      const work = await claim(command);
      await store.settle({
        commandId: command.commandId,
        scope,
        generation,
        claimId: work!.claimId,
        result: {
          commandId: command.commandId,
          state: "published",
          verifiedEntry: {
            ref: command.ref,
            body: command.body,
            bodyDigest: createMemoryBodyHash(command.body),
            contentApprovalRevision: "1",
            kind: command.knowledgeKind,
            topicIds: command.topicIds,
            statementAt: command.source.statementAt,
            sourceFactIds: ["fact"],
          },
        },
        now,
      });
    }
    it("activates source 2→1→0 cohorts atomically and rejects old/partial children without suppressing future edits", async () => {
      const first = await autoReserve(1, 2);
      await publishAuto(first.commands[0]!, first.state.binding);
      expect(
        await first.sources.applicable(
          first.commands[0]!.ref,
          generation,
          first.state.binding,
        ),
      ).toBe(false);
      await publishAuto(first.commands[1]!, first.state.binding);
      expect(
        await first.sources.applicable(
          first.commands[0]!.ref,
          generation,
          first.state.binding,
        ),
      ).toBe(true);
      const second = await autoReserve(2, 1);
      expect(
        await first.sources.applicable(
          first.commands[0]!.ref,
          generation,
          first.state.binding,
        ),
      ).toBe(false);
      await publishAuto(second.commands[0]!, second.state.binding);
      expect(
        await second.sources.applicable(
          second.commands[0]!.ref,
          generation,
          second.state.binding,
        ),
      ).toBe(true);
      const empty = await autoReserve(3, 0);
      expect(empty.state.state).toBe("active");
      expect(empty.state.entryIds).toEqual([]);
      expect(
        await second.sources.applicable(
          second.commands[0]!.ref,
          generation,
          second.state.binding,
        ),
      ).toBe(false);
      expect((await autoReserve(4, 1)).state.suppressed).toBe(false);
      const rows = await prisma.$queryRaw<{ state: unknown }[]>(
        Prisma.sql`SELECT "state" FROM "MemoryAutomaticSource"`,
      );
      expect(JSON.stringify(rows)).not.toContain(first.input.selectableBody);
      expect(JSON.stringify(rows)).not.toContain(first.input.readOnlyContext);
    });
    it("preserves bodyless lineage suppression across source edits and generation changes while keeping unrequested siblings eligible", async () => {
      const first = await autoReserve(1, 2);
      for (const command of first.commands)
        await publishAuto(command, first.state.binding);
      const original = first.commands[0]!;
      await admit({
        kind: "retire",
        ref: original.ref,
        generation,
        providerProfileVersion: original.providerProfileVersion,
        approval: original.approval,
        commandId: randomUUID(),
        expectedRevision: "1",
      });
      expect(
        (await first.sources.lookup(scope, first.input.source.sourceId))
          ?.suppressed,
      ).toBe(true);
      expect(
        await first.sources.applicable(
          first.commands[1]!.ref,
          generation,
          first.state.binding,
        ),
      ).toBe(true);
      expect((await autoReserve(2, 1)).state.suppressed).toBe(true);
      const changed = automaticInput(3);
      const next = await first.sources.reserve({
        input: changed,
        generation: "next_generation",
        expectedPriorEpoch: first.state.binding.epoch,
        entryIds: [],
        bodyDigests: [],
        now,
      });
      expect(next.suppressed).toBe(true);
    });
    it("detaches an explicitly edited automatic handle inside command reservation and fences internal retirement", async () => {
      const first = await autoReserve(1, 1);
      const original = first.commands[0]!;
      await publishAuto(original, first.state.binding);
      const update = {
        ...original,
        commandId: randomUUID(),
        expectedRevision: "1",
        body: "Maintainer corrected exact text.",
      };
      await admit(update);
      expect(
        (await store.findEntry(original.ref, generation))?.automaticSource,
      ).toBeUndefined();
      expect(
        (await first.sources.lookup(scope, first.input.source.sourceId))
          ?.entryIds,
      ).toEqual([]);
      const retirement = {
        kind: "retire" as const,
        commandId: randomUUID(),
        ref: original.ref,
        expectedRevision: "2",
        generation,
        providerProfileVersion: original.providerProfileVersion,
        approval: original.approval,
      };
      await expect(
        store.admit({
          command: retirement,
          internalRetirement: first.state.binding,
          digest: memoryKnowledgeCommandDigest(retirement),
          now,
          deliveryExpiresAt: new Date(now.getTime() + 86400000),
          resubmitUntil: now,
          activeEntryLimit: null,
          pendingCommandLimit: 100,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("accepts verified same-timestamp source revisions by epoch CAS and rejects stale processing", async () => {
      const first = await autoReserve(1, 1);
      await publishAuto(first.commands[0]!, first.state.binding);
      const input = {
        ...automaticInput(2),
        source: {
          ...automaticInput(2).source,
          updatedAt: first.input.source.updatedAt,
          revision: `${first.input.source.updatedAt}:different_digest`,
        },
      };
      const command = save({
        source: input.source,
        knowledgeKind: "observation",
      });
      const next = await first.sources.reserve({
        input,
        generation,
        expectedPriorEpoch: first.state.binding.epoch,
        entryIds: [command.ref.entryId],
        bodyDigests: [createMemoryBodyHash(command.body)],
        now,
      });
      await publishAuto(command, next.binding);
      expect(
        await first.sources.applicable(command.ref, generation, next.binding),
      ).toBe(true);
      await expect(
        first.sources.reserve({
          input: { ...automaticInput(3) },
          generation,
          expectedPriorEpoch: first.state.binding.epoch,
          entryIds: [],
          bodyDigests: [],
          now,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
    });
    it("recovers superseded pending saves into durable internal retire commands and handles late completion", async () => {
      const first = await autoReserve(1, 1),
        command = first.commands[0]!;
      await store.admit({
        command,
        automaticSource: first.state.binding,
        digest: memoryKnowledgeCommandDigest(command),
        now,
        deliveryExpiresAt: new Date(now.getTime() + 86400000),
        resubmitUntil: now,
        activeEntryLimit: null,
        pendingCommandLimit: 100,
      });
      const work = await claim(command);
      expect(work).not.toBeNull();
      await autoReserve(2, 0);
      await store.scheduleDueDeliveries({
        generation,
        now: new Date(now.getTime() + 6000),
        limit: 10,
      });
      const withdrawn = await store.findEntry(command.ref, generation);
      expect(withdrawn?.lifecycle).toBe("retired");
      expect(withdrawn?.revocationCommandId).not.toBeNull();
      await store.settle({
        commandId: command.commandId,
        scope,
        generation,
        claimId: work!.claimId,
        result: {
          commandId: command.commandId,
          state: "published",
          verifiedEntry: {
            ref: command.ref,
            body: command.body,
            bodyDigest: createMemoryBodyHash(command.body),
            contentApprovalRevision: "1",
            kind: command.knowledgeKind,
            topicIds: command.topicIds,
            statementAt: command.source.statementAt,
            sourceFactIds: ["fact"],
          },
        },
        now: new Date(now.getTime() + 7000),
      });
      const retirement = withdrawn!.revocationCommandId!;
      const claimRetire = await store.claim({
        commandId: retirement,
        scope,
        generation,
        now: new Date(now.getTime() + 8000),
        claimId: randomUUID(),
        claimUntil: new Date(now.getTime() + 18000),
      });
      expect(claimRetire).not.toBeNull();
      await store.settle({
        commandId: retirement,
        scope,
        generation,
        claimId: claimRetire!.claimId,
        result: { commandId: retirement, state: "completed" },
        now: new Date(now.getTime() + 9000),
      });
      expect(
        (await store.findEntry(command.ref, generation))?.pendingCommandId,
      ).toBeNull();
      expect(
        await first.sources.applicable(
          command.ref,
          generation,
          first.state.binding,
        ),
      ).toBe(false);
      expect(
        (await first.sources.lookup(scope, first.input.source.sourceId))
          ?.suppressed,
      ).toBe(false);
    });
    it("clears explicit suppression only with a matching independent suppression CAS", async () => {
      const first = await autoReserve(1, 1),
        original = first.commands[0]!;
      await publishAuto(original, first.state.binding);
      const stop = {
        kind: "retire" as const,
        ref: original.ref,
        generation,
        providerProfileVersion: original.providerProfileVersion,
        approval: original.approval,
        commandId: randomUUID(),
        expectedRevision: "1",
      };
      await admit(stop);
      const suppressed = (await first.sources.lookup(
        scope,
        first.input.source.sourceId,
      ))!;
      await admit({
        ...stop,
        kind: "forget",
        commandId: randomUUID(),
        expectedRevision: "2",
      });
      await expect(
        first.sources.clearSuppression({
          scope,
          sourceId: first.input.source.sourceId,
          expectedEpoch: suppressed.binding.epoch,
          expectedSuppressionEpoch: suppressed.suppressionEpoch,
          now,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      const current = (await first.sources.lookup(
        scope,
        first.input.source.sourceId,
      ))!;
      await first.sources.clearSuppression({
        scope,
        sourceId: first.input.source.sourceId,
        expectedEpoch: current.binding.epoch,
        expectedSuppressionEpoch: current.suppressionEpoch,
        now,
      });
      expect((await autoReserve(2, 1)).state.suppressed).toBe(false);
    });
    it("recovers a transient source failure only after a fresh check of the same complete cohort and keeps old receipts revoked", async () => {
      const first = await autoReserve(1, 1);
      await publishAuto(first.commands[0]!, first.state.binding);
      await first.sources.invalidate({
        scope,
        sourceId: first.input.source.sourceId,
        cause: "unavailable",
        now,
      });
      expect(
        await first.sources.applicable(
          first.commands[0]!.ref,
          generation,
          first.state.binding,
        ),
      ).toBe(false);
      expect(
        await first.sources.recoverAvailability({
          ref: first.commands[0]!.ref,
          generation,
          binding: first.state.binding,
          now,
        }),
      ).toBe(true);
      const refreshed = (await store.findEntry(
        first.commands[0]!.ref,
        generation,
      ))!.automaticSource!;
      expect(refreshed.epoch).not.toBe(first.state.binding.epoch);
      expect(
        await first.sources.applicable(
          first.commands[0]!.ref,
          generation,
          first.state.binding,
        ),
      ).toBe(false);
      expect(
        await first.sources.applicable(
          first.commands[0]!.ref,
          generation,
          refreshed,
        ),
      ).toBe(true);
      await first.sources.invalidate({
        scope,
        sourceId: first.input.source.sourceId,
        cause: "changed",
        now,
      });
      expect(
        await first.sources.recoverAvailability({
          ref: first.commands[0]!.ref,
          generation,
          binding: refreshed,
          now,
        }),
      ).toBe(false);
      expect(
        await first.sources.applicable(
          first.commands[0]!.ref,
          generation,
          refreshed,
        ),
      ).toBe(false);
    });

    it("replaces a quota-full automatic cohort by reserving old retirement before new child saves", async () => {
      const first = await autoReserve(1, 2);
      for (const command of first.commands)
        await publishAuto(command, first.state.binding);
      const knowledge = new MemoryKnowledgeService({
        generation,
        providerProfileVersion: "test_profile",
        store,
        reader: {} as never,
        writer: {} as never,
        observer: {} as never,
        access: {
          authorize: async () => {},
          verifySource: async (input) => input.source,
          sourceApplicable: async () => true,
        },
        policy: { getPolicy: async () => createMemoryPolicyConfig() },
        quota: {
          getWorkspaceQuota: async () => ({
            activeItems: { limit: 2 },
            pendingSuggestions: { limit: 100 },
          }),
        },
        now: () => now,
      });
      const next = automaticInput(2);
      const automatic = new MemoryAutomaticSourceService({
        generation,
        providerProfileVersion: "test_profile",
        knowledge,
        sources: first.sources,
        current: { current: async () => true },
        preview: {
          preview: async (input) => ({
            status: "complete",
            source: input.source,
            statements: [{ body: "A new exact observation." }],
          }),
        },
        now: () => now,
      });
      expect(
        (
          await automatic.learn(next, {
            deadlineAt: new Date(now.getTime() + 10000),
          })
        ).state,
      ).toBe("queued");
      for (const original of first.commands)
        expect(
          (await store.findEntry(original.ref, generation))?.lifecycle,
        ).toBe("retired");
      const [count] = await prisma.$queryRaw<{ count: number }[]>(
        Prisma.sql`SELECT count(*)::int AS count FROM "MemoryKnowledgeEntry" WHERE "generation"=${generation} AND "lifecycle"='active'`,
      );
      expect(count?.count).toBe(1);
    });

    function forgetCommand(
      original: MemoryKnowledgeCommand,
    ): MemoryKnowledgeCommand {
      return {
        kind: "forget",
        ref: original.ref,
        commandId: randomUUID(),
        expectedRevision: "1",
        generation,
        providerProfileVersion: original.providerProfileVersion,
        approval: original.approval,
      };
    }
    function cleanupReceipt(
      command: MemoryKnowledgeCommand,
      at = now,
    ): MemoryVerifiedCleanupReceipt {
      return {
        coverage: "entry_history_and_operations",
        id: `host_receipt_${command.commandId}`,
        commandId: command.commandId,
        commandDigest: memoryKnowledgeCommandDigest(command),
        generation,
        ref: command.ref,
        verifiedAt: at.toISOString(),
        verifiedBy: "operator:stable",
        maintenanceEpoch: "1",
      };
    }
    async function waitForBlockedQuery(fragment: string): Promise<void> {
      await vi.waitFor(
        async () => {
          const waiting = await admin.query(
            `SELECT EXISTS(SELECT 1 FROM pg_stat_activity
           WHERE application_name IN ($1,$2) AND wait_event_type='Lock'
             AND query LIKE $3) AS blocked`,
            [`${schema}-first`, `${schema}-second`, `%${fragment}%`],
          );
          expect(waiting.rows[0].blocked).toBe(true);
        },
        { timeout: 2000, interval: 10 },
      );
    }

    it("atomically admits one competing create and reserves quota across independent processes", async () => {
      const a = save();
      const b = save({ ref: a.ref });
      const results = await Promise.allSettled([
        admit(a),
        admit(b, otherStore),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      await expect(admit(save(), otherStore, 1)).rejects.toMatchObject({
        code: "quota_exceeded",
      });
      expect(await prisma.outboxEvent.count()).toBe(1);
    });

    it("deduplicates one full command and rejects changed topics under its UUID", async () => {
      const command = save();
      await admit(command);
      await admit(command, otherStore);
      await expect(
        admit({ ...command, topicIds: ["other"] }, otherStore),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(await prisma.outboxEvent.count()).toBe(1);
      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE "MemoryKnowledgeCommand" SET "envelope"=\'{}\'::jsonb WHERE "id"=$1',
          command.commandId,
        ),
      ).rejects.toThrow();
    });

    it("rejects stale source cursors even when a late command targets a different entry", async () => {
      const newest = save();
      await admit({
        ...newest,
        source: {
          ...newest.source,
          sourceId: "shared_source",
          revision: "new",
          updatedAt: "2026-10-23T10:00:00.000Z",
        },
      });
      const late = save();
      await expect(
        admit(
          {
            ...late,
            source: {
              ...late.source,
              sourceId: "shared_source",
              revision: "old",
              updatedAt: "2026-10-22T10:00:00.000Z",
            },
          },
          otherStore,
        ),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("keeps a crash between claim and native submit unknown without unqualified resend", async () => {
      const command = save();
      await store.admit({
        command,
        digest: memoryKnowledgeCommandDigest(command),
        now,
        deliveryExpiresAt: new Date(now.getTime() + 86400000),
        resubmitUntil: now,
        activeEntryLimit: null,
        pendingCommandLimit: 100,
      });
      const crashed = await claim(command);
      expect(crashed?.mode).toBe("submit");
      // Simulate process exit before any transport, with no native receipt.
      const recoveredAt = new Date(now.getTime() + 20000);
      const submit = vi.fn();
      const observe = vi.fn(async () => ({
        commandId: command.commandId,
        state: "unknown" as const,
        safeReason: "unknown_write" as const,
      }));
      const service = new MemoryKnowledgeService({
        generation,
        providerProfileVersion: command.providerProfileVersion,
        store: otherStore,
        reader: {} as never,
        writer: { submit },
        observer: { observe },
        access: {} as never,
        policy: {} as never,
        quota: {} as never,
        now: () => recoveredAt,
      });
      await expect(
        service.deliver(
          { scope, commandId: command.commandId },
          { deadlineAt: new Date(recoveredAt.getTime() + 10000) },
        ),
      ).resolves.toMatchObject({
        state: "unknown",
        safeReason: "unknown_write",
      });
      expect(submit).not.toHaveBeenCalled();
      expect(observe).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          command,
          allowResubmit: false,
          resubmitUntil: now.toISOString(),
        }),
        expect.anything(),
      );
      const unresolved = await otherStore.findEntry(command.ref, generation);
      expect(unresolved?.pendingCommandId).toBe(command.commandId);
      expect(
        memoryKnowledgeBodyVisible(unresolved!, "runtime", recoveredAt),
      ).toBe(false);
      expect(
        (
          await otherStore.findCommand({
            commandId: command.commandId,
            scope,
            generation,
          })
        )?.envelope,
      ).toEqual(command);
      const expiredAt = new Date(now.getTime() + 86400001);
      expect(await claim(command, store, expiredAt)).toBeNull();
      const expired = await store.findCommand({
        commandId: command.commandId,
        scope,
        generation,
      });
      expect(expired).toMatchObject({
        envelope: null,
        operation: { state: "unknown", safeReason: "input_required" },
      });
      expect(
        memoryKnowledgeBodyVisible(
          (await store.findEntry(command.ref, generation))!,
          "export",
          expiredAt,
        ),
      ).toBe(false);
    });

    it("preserves urgent revocation through an older unknown write and never advances on lease expiry", async () => {
      const command = save();
      await admit(command);
      const first = await claim(command);
      const edit = save({ ref: command.ref, expectedRevision: "1" });
      await expect(admit(edit, otherStore)).rejects.toMatchObject({
        code: "conflict",
      });
      const retire: MemoryKnowledgeCommand = {
        kind: "retire",
        ref: command.ref,
        commandId: randomUUID(),
        expectedRevision: "1",
        generation,
        providerProfileVersion: command.providerProfileVersion,
        approval: command.approval,
      };
      await admit(retire, otherStore);
      const fenced = await store.findEntry(command.ref, generation);
      expect(memoryKnowledgeBodyVisible(fenced!, "management", now)).toBe(
        false,
      );
      expect(await claim(retire)).toBeNull();
      const afterLease = new Date(now.getTime() + 20000);
      const observer = await claim(command, otherStore, afterLease);
      expect(observer?.mode).toBe("observe");
      await expect(
        store.settle({
          commandId: command.commandId,
          scope,
          generation,
          claimId: first!.claimId,
          result: {
            commandId: command.commandId,
            state: "failed",
            executionSettled: true,
          },
          now: afterLease,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      const entry: MemoryProviderEntry = {
        ref: command.ref,
        body: command.body,
        bodyDigest: createMemoryBodyHash(command.body),
        contentApprovalRevision: "1",
        kind: "rule",
        topicIds: command.topicIds,
        statementAt: now.toISOString(),
        sourceFactIds: ["fact"],
      };
      await otherStore.settle({
        commandId: command.commandId,
        scope,
        generation,
        claimId: observer!.claimId,
        result: {
          commandId: command.commandId,
          state: "published",
          verifiedEntry: entry,
        },
        now: afterLease,
      });
      const stillFenced = await store.findEntry(command.ref, generation);
      expect(stillFenced).toMatchObject({
        revision: "2",
        lifecycle: "retired",
        pendingCommandId: retire.commandId,
        revocationCommandId: retire.commandId,
      });
      const retiring = await claim(retire, store, afterLease);
      await store.settle({
        commandId: retire.commandId,
        scope,
        generation,
        claimId: retiring!.claimId,
        result: { commandId: retire.commandId, state: "completed" },
        now: afterLease,
      });
      expect(
        memoryKnowledgeBodyVisible(
          (await store.findEntry(command.ref, generation))!,
          "export",
          afterLease,
        ),
      ).toBe(true);
      await expect(
        admit(save({ ref: command.ref, expectedRevision: "2" })),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("keeps original native statement time for unchanged text and retains first approval after purge", async () => {
      const first = save();
      await publish(first);
      const second = save({
        ref: first.ref,
        expectedRevision: "1",
        source: {
          ...first.source,
          revision: "2",
          updatedAt: "2026-10-24T10:00:00.000Z",
          statementAt: "2026-10-24T10:00:00.000Z",
        },
      });
      await admit(second);
      const stored = await store.findCommand({
        commandId: second.commandId,
        scope,
        generation,
      });
      expect(stored?.originalStatementAt).toBe(first.source.statementAt);
      const settled = await store.findCommand({
        commandId: first.commandId,
        scope,
        generation,
      });
      expect(settled?.envelope).toBeNull();
      expect(settled?.approval).toEqual(first.approval);
    });

    it("cannot complete physical forget without an exact verified host receipt", async () => {
      const original = save();
      await publish(original);
      const forget: MemoryKnowledgeCommand = {
        kind: "forget",
        ref: original.ref,
        commandId: randomUUID(),
        expectedRevision: "1",
        generation,
        providerProfileVersion: original.providerProfileVersion,
        approval: original.approval,
      };
      await admit(forget);
      const work = await claim(forget);
      expect(
        memoryKnowledgeBodyVisible(
          (await store.findEntry(original.ref, generation))!,
          "export",
          now,
        ),
      ).toBe(false);
      const result = await store.settle({
        commandId: forget.commandId,
        scope,
        generation,
        claimId: work!.claimId,
        result: { commandId: forget.commandId, state: "completed" },
        now,
      });
      expect(result.state).toBe("cleanup_pending");
      const receipt: MemoryVerifiedCleanupReceipt = {
        coverage: "entry_history_and_operations",
        id: "trusted_receipt",
        commandId: forget.commandId,
        commandDigest: memoryKnowledgeCommandDigest(forget),
        generation,
        ref: forget.ref,
        verifiedAt: now.toISOString(),
        verifiedBy: "operator:stable",
        maintenanceEpoch: "1",
      };
      await expect(
        store.completeCleanup({ receipt, now }),
      ).rejects.toMatchObject({ code: "conflict" });
      await store.setMaintenancePaused({
        generation,
        paused: true,
        expectedEpoch: "0",
        actor: "operator:stable",
        now,
        deadlineAt: new Date(now.getTime() + 5000),
      });
      await expect(
        store.completeCleanup({
          receipt: {
            ...receipt,
            coverage: "entry_only",
          } as unknown as MemoryVerifiedCleanupReceipt,
          now,
        }),
      ).rejects.toMatchObject({ code: "invalid_input" });
      await expect(
        store.completeCleanup({
          receipt: { ...receipt, maintenanceEpoch: "0" },
          now,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        store.completeCleanup({
          receipt: { ...receipt, commandDigest: "f".repeat(64) },
          now,
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      await store.completeCleanup({ receipt, now });
      expect(await store.findEntry(original.ref, generation)).toMatchObject({
        lifecycle: "forgotten",
        source: null,
        bodyDigest: null,
        pendingCommandId: null,
      });
      await expect(
        store.completeCleanup({ receipt, now }),
      ).resolves.toMatchObject({ state: "completed" });
      await store.setMaintenancePaused({
        generation,
        paused: false,
        expectedEpoch: "1",
        actor: "operator:stable",
        now,
        deadlineAt: new Date(now.getTime() + 5000),
      });
      await expect(
        admit(save({ ref: original.ref, expectedRevision: "2" })),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it.each(["initial save", "edit", "topics", "retire", "expire"] as const)(
      "settles a queued forget after its unknown %s expires without resurrecting either command",
      async (kind) => {
        const original = save(
          kind === "expire"
            ? {
                applicability: {
                  validUntil: now.toISOString(),
                  observedCommitSha: null,
                  exceptionRule: null,
                },
              }
            : {},
        );
        const pending: MemoryKnowledgeCommand =
          kind === "initial save"
            ? original
            : kind === "edit"
              ? save({
                  ref: original.ref,
                  expectedRevision: "1",
                  body: "A replacement that may have reached the provider.",
                })
              : kind === "topics"
                ? {
                    kind: "topics",
                    ref: original.ref,
                    commandId: randomUUID(),
                    expectedRevision: "1",
                    generation,
                    providerProfileVersion: original.providerProfileVersion,
                    approval: original.approval,
                    topicIds: ["different-topic"],
                  }
                : { ...forgetCommand(original), kind };
        if (kind !== "initial save") await publish(original);
        await admit(pending);
        const abandoned = await claim(pending);
        const later = new Date(now.getTime() + 86400001);
        expect(
          await store.expireDeliveryEnvelopes({ now: later, limit: 100 }),
        ).toBe(1);
        const forget: MemoryKnowledgeCommand = {
          ...forgetCommand(original),
          expectedRevision: kind === "initial save" ? "1" : "2",
        };
        await admit(forget, store, null, later);
        const unrelated = save();
        await admit(unrelated, store, null, later);
        expect(await claim(forget, store, later)).toBeNull();
        await store.setMaintenancePaused({
          generation,
          paused: true,
          expectedEpoch: "0",
          actor: "operator:stable",
          now: later,
          deadlineAt: new Date(later.getTime() + 5000),
        });
        const receipt = cleanupReceipt(forget, later);
        await expect(
          otherStore.completeCleanup({ receipt, now: later }),
        ).resolves.toMatchObject({ state: "completed" });
        expect(await store.findEntry(original.ref, generation)).toMatchObject({
          lifecycle: "forgotten",
          pendingCommandId: null,
          revocationCommandId: null,
          bodyDigest: null,
          source: null,
        });
        expect(
          await store.findCommand({
            commandId: pending.commandId,
            scope,
            generation,
          }),
        ).toMatchObject({
          operation: { state: "failed", safeReason: "conflict" },
          envelope: null,
        });
        const beforeRetry = await prisma.auditEvent.count();
        await expect(
          store.completeCleanup({ receipt, now: later }),
        ).resolves.toMatchObject({ state: "completed" });
        expect(await prisma.auditEvent.count()).toBe(beforeRetry);
        await expect(
          store.completeCleanup({
            receipt: { ...receipt, id: "different_receipt" },
            now: later,
          }),
        ).rejects.toMatchObject({ code: "conflict" });
        await expect(
          store.settle({
            commandId: pending.commandId,
            scope,
            generation,
            claimId: abandoned!.claimId,
            result: { commandId: pending.commandId, state: "published" },
            now: later,
          }),
        ).resolves.toMatchObject({ state: "failed" });
        await store.recordFailure({
          commandId: pending.commandId,
          scope,
          generation,
          claimId: abandoned!.claimId,
          safeReason: "unknown_write",
          now: later,
        });
        await store.setMaintenancePaused({
          generation,
          paused: false,
          expectedEpoch: "1",
          actor: "operator:stable",
          now: later,
          deadlineAt: new Date(later.getTime() + 5000),
        });
        expect(await claim(pending, store, later)).toBeNull();
        expect(await claim(forget, store, later)).toBeNull();
        expect(await claim(unrelated, store, later)).not.toBeNull();
        const resumed = await prisma.outboxEvent.findMany({
          where: {
            idempotencyKey: { startsWith: "memory.knowledge.command.resume:" },
          },
        });
        expect(
          resumed.map(
            (event) => (event.payload as { commandId: string }).commandId,
          ),
        ).toEqual([unrelated.commandId]);
      },
    );

    it.each(["retire", "expire"] as const)(
      "preserves current Forget when an older in-flight %s acknowledges before cleanup",
      async (kind) => {
        const original = save({
          applicability: {
            validUntil: kind === "expire" ? now.toISOString() : null,
            observedCommitSha: null,
            exceptionRule: null,
          },
        });
        await publish(original);
        const stopping: MemoryKnowledgeCommand = {
          ...forgetCommand(original),
          kind,
        };
        await admit(stopping);
        const active = await claim(stopping);
        const forget = {
          ...forgetCommand(original),
          expectedRevision: "2",
        };
        await expect(admit(forget, otherStore)).resolves.toMatchObject({
          id: forget.commandId,
          revision: "3",
          state: "queued",
        });
        await expect(admit(forget)).resolves.toMatchObject({
          id: forget.commandId,
          revision: "3",
        });
        await expect(
          admit({ ...forget, expectedRevision: "1" }),
        ).rejects.toMatchObject({ code: "conflict" });
        await expect(
          admit({ ...forget, commandId: randomUUID(), expectedRevision: "3" }),
        ).rejects.toMatchObject({ code: "conflict" });
        await expect(
          admit(save({ ref: original.ref, expectedRevision: "3" })),
        ).rejects.toMatchObject({ code: "conflict" });
        await expect(
          admit({
            ...stopping,
            commandId: randomUUID(),
            expectedRevision: "3",
          }),
        ).rejects.toMatchObject({ code: "conflict" });
        await store.settle({
          commandId: stopping.commandId,
          scope,
          generation,
          claimId: active!.claimId,
          result: { commandId: stopping.commandId, state: "completed" },
          now,
        });
        const fenced = (await store.findEntry(original.ref, generation))!;
        expect(fenced).toMatchObject({
          revision: "3",
          lifecycle: "forget_pending",
          pendingCommandId: forget.commandId,
          revocationCommandId: forget.commandId,
        });
        for (const consumer of ["runtime", "management", "export"] as const)
          expect(memoryKnowledgeBodyVisible(fenced, consumer, now)).toBe(false);
        await store.setMaintenancePaused({
          generation,
          paused: true,
          expectedEpoch: "0",
          actor: "operator:stable",
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        });
        await expect(
          otherStore.completeCleanup({ receipt: cleanupReceipt(forget), now }),
        ).resolves.toMatchObject({ state: "completed" });
        await expect(
          store.settle({
            commandId: stopping.commandId,
            scope,
            generation,
            claimId: active!.claimId,
            result: { commandId: stopping.commandId, state: "processing" },
            now,
          }),
        ).resolves.toMatchObject({ state: "completed" });
        expect(await store.findEntry(original.ref, generation)).toMatchObject({
          lifecycle: "forgotten",
          pendingCommandId: null,
          revocationCommandId: null,
        });
      },
    );

    it("forgets an unknown save followed by queued retirement without advancing either older command", async () => {
      const original = save();
      await admit(original);
      const active = await claim(original);
      const retire: MemoryKnowledgeCommand = {
        ...forgetCommand(original),
        kind: "retire",
      };
      await admit(retire);
      const forget = { ...forgetCommand(original), expectedRevision: "2" };
      await admit(forget, otherStore);
      expect(await claim(retire)).toBeNull();
      expect(await claim(forget)).toBeNull();
      expect(await store.findEntry(original.ref, generation)).toMatchObject({
        lifecycle: "forget_pending",
        pendingCommandId: original.commandId,
        revocationCommandId: forget.commandId,
      });
      await store.setMaintenancePaused({
        generation,
        paused: true,
        expectedEpoch: "0",
        actor: "operator:stable",
        now,
        deadlineAt: new Date(now.getTime() + 5000),
      });
      const receipt = cleanupReceipt(forget);
      await otherStore.completeCleanup({ receipt, now });
      const superseded = await prisma.memoryKnowledgeCommand.findMany({
        where: { id: { in: [original.commandId, retire.commandId] } },
      });
      expect(superseded).toHaveLength(2);
      for (const command of superseded)
        expect(command).toMatchObject({
          state: "failed",
          safeReason: "conflict",
          envelope: null,
          claimId: null,
          claimUntil: null,
          cleanupReceiptId: receipt.id,
        });
      await expect(
        store.settle({
          commandId: original.commandId,
          scope,
          generation,
          claimId: active!.claimId,
          result: { commandId: original.commandId, state: "published" },
          now,
        }),
      ).resolves.toMatchObject({ state: "failed" });
      expect(await store.findEntry(original.ref, generation)).toMatchObject({
        lifecycle: "forgotten",
        pendingCommandId: null,
        revocationCommandId: null,
      });
    });

    it.each([
      "queued",
      "submitted",
      "processing",
      "unknown",
      "cleanup_pending",
    ] as const)(
      "accepts verified full-history cleanup for current %s Forget with a live claim",
      async (state) => {
        const original = save();
        await publish(original);
        const forget = forgetCommand(original);
        await admit(forget);
        const work = await claim(forget);
        await prisma.memoryKnowledgeCommand.update({
          where: { id: forget.commandId },
          data: { state },
        });
        await store.setMaintenancePaused({
          generation,
          paused: true,
          expectedEpoch: "0",
          actor: "operator:stable",
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        });
        const receipt = cleanupReceipt(forget);
        await expect(
          otherStore.completeCleanup({ receipt, now }),
        ).resolves.toMatchObject({ state: "completed" });
        expect(
          await prisma.memoryKnowledgeCommand.findUnique({
            where: { id: forget.commandId },
          }),
        ).toMatchObject({
          state: "completed",
          claimId: null,
          claimUntil: null,
          envelope: null,
          cleanupReceiptId: receipt.id,
        });
        await expect(
          store.settle({
            commandId: forget.commandId,
            scope,
            generation,
            claimId: work!.claimId,
            result: { commandId: forget.commandId, state: "processing" },
            now,
          }),
        ).resolves.toMatchObject({ state: "completed" });
      },
    );

    it("disposes all older unresolved revisions, including an older Forget, while preserving terminal and unrelated operations", async () => {
      const first = save();
      const history = [first];
      await publish(first);
      for (let revision = 1; revision < 6; revision++) {
        const edit = save({
          ref: first.ref,
          expectedRevision: String(revision),
          body: `Approved revision ${revision + 1}.`,
        });
        history.push(edit);
        await publish(edit);
      }
      const forget = { ...forgetCommand(first), expectedRevision: "6" };
      await admit(forget);
      const unrelated = save();
      await admit(unrelated);
      // Reproduce recovered unresolved history from multiple older native operations.
      // Current admission deliberately prevents creating this state in normal traffic.
      const states = [
        "queued",
        "submitted",
        "processing",
        "unknown",
        "cleanup_pending",
      ];
      for (const [index, command] of history.slice(0, 5).entries()) {
        const row = (await prisma.memoryKnowledgeCommand.findUnique({
          where: { id: command.commandId },
        }))!;
        // Import complete immutable rows, as a recovery/migration would; do not
        // disable or weaken the production immutable-command trigger.
        await prisma.memoryKnowledgeCommand.delete({
          where: { id: command.commandId },
        });
        await prisma.memoryKnowledgeCommand.create({
          data: {
            ...row,
            approval: row.approval as Prisma.InputJsonValue,
            state: states[index]!,
            commandKind: index === 0 ? "forget" : "save",
            envelope: index < 2 ? Prisma.DbNull : command,
            claimId: `old-active-${index}`,
            claimUntil: new Date(now.getTime() + 60000),
          },
        });
      }
      const metadata = (await store.findEntry(first.ref, generation))!;
      await prisma.memoryKnowledgeEntry.update({
        where: {
          generation_scopeKey_entryId: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
            entryId: first.ref.entryId,
          },
        },
        data: {
          pendingCommandId: first.commandId,
          metadata: { ...metadata, pendingCommandId: first.commandId },
        },
      });
      await store.setMaintenancePaused({
        generation,
        paused: true,
        expectedEpoch: "0",
        actor: "operator:stable",
        now,
        deadlineAt: new Date(now.getTime() + 5000),
      });
      const receipt = cleanupReceipt(forget);
      await otherStore.completeCleanup({ receipt, now });
      const rows = await prisma.memoryKnowledgeCommand.findMany({
        where: {
          id: { in: history.slice(0, 5).map((command) => command.commandId) },
        },
      });
      expect(rows).toHaveLength(5);
      for (const row of rows)
        expect(row).toMatchObject({
          state: "failed",
          safeReason: "conflict",
          envelope: null,
          claimId: null,
          claimUntil: null,
          cleanupReceiptId: receipt.id,
        });
      expect(
        await prisma.memoryKnowledgeCommand.findUnique({
          where: { id: history[5]!.commandId },
        }),
      ).toMatchObject({ state: "published", cleanupReceiptId: null });
      expect(
        await prisma.memoryKnowledgeCommand.findUnique({
          where: { id: unrelated.commandId },
        }),
      ).toMatchObject({ state: "queued", cleanupReceiptId: null });
      for (const [index, command] of history.slice(0, 5).entries()) {
        await expect(
          store.settle({
            commandId: command.commandId,
            scope,
            generation,
            claimId: `old-active-${index}`,
            result: { commandId: command.commandId, state: "published" },
            now,
          }),
        ).resolves.toMatchObject({ state: "failed" });
        await otherStore.recordFailure({
          commandId: command.commandId,
          scope,
          generation,
          claimId: `old-active-${index}`,
          safeReason: "unknown_write",
          now,
        });
      }
      expect(await store.findEntry(first.ref, generation)).toMatchObject({
        lifecycle: "forgotten",
        pendingCommandId: null,
        revocationCommandId: null,
      });
    });

    it("rejects stale authority and completed retries when current physical columns or metadata disagree", async () => {
      const original = save();
      await publish(original);
      const forget = forgetCommand(original);
      await admit(forget);
      await store.setMaintenancePaused({
        generation,
        paused: true,
        expectedEpoch: "0",
        actor: "operator:stable",
        now,
        deadlineAt: new Date(now.getTime() + 5000),
      });
      const receipt = cleanupReceipt(forget);
      const where = {
        generation_scopeKey_entryId: {
          generation,
          scopeKey: memoryKnowledgeScopeKey(scope),
          entryId: original.ref.entryId,
        },
      };
      const entry = (await prisma.memoryKnowledgeEntry.findUnique({ where }))!;
      const metadata =
        entry.metadata as unknown as MemoryKnowledgeEntryMetadata;
      for (const data of [
        { revision: 3 },
        { lifecycle: "active" },
        { workspaceId: "another_workspace" },
        { metadata: { ...metadata, revision: "2\n" } },
        { metadata: { ...metadata, revision: "9007199254740992" } },
        { metadata: { ...metadata, generation: "another_generation" } },
        {
          metadata: {
            ...metadata,
            ref: { ...metadata.ref, entryId: "another_entry" },
          },
        },
        { metadata: { ...metadata, lifecycle: "active" } },
        { metadata: { ...metadata, pendingCommandId: "another_command" } },
      ]) {
        await prisma.memoryKnowledgeEntry.update({ where, data });
        await expect(
          store.completeCleanup({ receipt, now }),
        ).rejects.toMatchObject({ code: "conflict" });
        await prisma.memoryKnowledgeEntry.update({
          where,
          data: {
            revision: entry.revision,
            lifecycle: entry.lifecycle,
            workspaceId: entry.workspaceId,
            metadata: { ...metadata },
          },
        });
      }
      await store.completeCleanup({ receipt, now });
      await prisma.memoryKnowledgeEntry.update({
        where,
        data: { revision: 3 },
      });
      await expect(
        store.completeCleanup({ receipt, now }),
      ).rejects.toMatchObject({ code: "conflict" });
      await prisma.memoryKnowledgeEntry.update({
        where,
        data: { revision: entry.revision, pendingCommandId: forget.commandId },
      });
      await expect(
        store.completeCleanup({ receipt, now }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it.each(["predecessor", "forget"] as const)(
      "disposes an active %s claim after the verified global drain",
      async (leased) => {
        const original = save();
        if (leased === "predecessor") {
          await admit(original);
          await claim(original);
        } else await publish(original);
        const forget = forgetCommand(original);
        await admit(forget);
        if (leased === "forget") await claim(forget);
        await store.setMaintenancePaused({
          generation,
          paused: true,
          expectedEpoch: "0",
          actor: "operator:stable",
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        });
        await expect(
          store.completeCleanup({ receipt: cleanupReceipt(forget), now }),
        ).resolves.toMatchObject({ state: "completed" });
        expect(await store.findEntry(original.ref, generation)).toMatchObject({
          lifecycle: "forgotten",
        });
        const afterLease = new Date(now.getTime() + 10001);
        await expect(
          store.completeCleanup({
            receipt: cleanupReceipt(forget, afterLease),
            now: afterLease,
          }),
        ).resolves.toMatchObject({ state: "completed" });
      },
    );

    it.each(["cleanup-first", "permit-first"] as const)(
      "keeps cleanup terminal when a paused transport relinquishes its old claim (%s)",
      async (order) => {
        const original = save();
        await publish(original);
        const forget = forgetCommand(original);
        await admit(forget);
        const work = await claim(forget);
        const later = new Date(now.getTime() + 10001);
        await store.setMaintenancePaused({
          generation,
          paused: true,
          expectedEpoch: "0",
          actor: "operator:stable",
          now: later,
          deadlineAt: new Date(later.getTime() + 5000),
        });
        const blocker = await admin.connect();
        await blocker.query("BEGIN");
        await blocker.query(
          `SELECT 1 FROM "${schema}"."MemoryKnowledgeCommand" WHERE "id"=$1 FOR UPDATE`,
          [forget.commandId],
        );
        const transport = vi.fn(async () => "must-not-run");
        const cleanup = () =>
          store.completeCleanup({
            receipt: cleanupReceipt(forget, later),
            now: later,
          });
        const denied = () =>
          otherStore.withDeliveryPermit(
            {
              commandId: forget.commandId,
              scope,
              generation,
              claimId: work!.claimId,
              now: later,
              deadlineAt: new Date(later.getTime() + 5000),
            },
            transport,
          );
        let completing: ReturnType<typeof cleanup> | undefined;
        let denying: ReturnType<typeof denied> | undefined;
        try {
          if (order === "cleanup-first") {
            completing = cleanup();
            await waitForBlockedQuery('"cleanupReceiptId"=');
            denying = denied();
            await waitForBlockedQuery("\"state\"='unknown'");
          } else {
            denying = denied();
            await waitForBlockedQuery("\"state\"='unknown'");
            completing = cleanup();
            await waitForBlockedQuery('"cleanupReceiptId"=');
          }
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
          await Promise.allSettled([completing, denying]);
        }
        await expect(completing).resolves.toMatchObject({ state: "completed" });
        await expect(denying).resolves.toEqual({ permitted: false });
        expect(transport).not.toHaveBeenCalled();
        expect(
          await store.findCommand({
            commandId: forget.commandId,
            scope,
            generation,
          }),
        ).toMatchObject({
          operation: { state: "completed" },
          envelope: null,
        });
        expect(await store.findEntry(original.ref, generation)).toMatchObject({
          lifecycle: "forgotten",
        });
      },
    );

    it("orders memory pause after a write admission already waiting on its scope lock", async () => {
      await publish(save());
      const blocker = await admin.connect();
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT 1 FROM "${schema}"."MemoryKnowledgeScopeState" FOR UPDATE`,
      );
      const admitting = admit(save());
      let pausing:
        | ReturnType<typeof otherStore.setMaintenancePaused>
        | undefined;
      try {
        await waitForBlockedQuery('"MemoryKnowledgeScopeState"');
        pausing = otherStore.setMaintenancePaused({
          generation,
          paused: true,
          expectedEpoch: "0",
          actor: "operator:stable",
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        });
        await waitForBlockedQuery("pg_advisory_xact_lock(");
        expect(await store.maintenanceState(generation)).toMatchObject({
          paused: false,
        });
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.allSettled([admitting, pausing]);
      }
      await expect(admitting).resolves.toMatchObject({ state: "queued" });
      await expect(pausing).resolves.toMatchObject({ paused: true });
      await expect(admit(save())).rejects.toMatchObject({
        code: "unavailable",
      });
    });

    it("waits for admitted transports before pausing and denies preclaimed work after the pause", async () => {
      const first = save();
      const second = save();
      await admit(first);
      await admit(second);
      const firstClaim = await claim(first);
      const secondClaim = await claim(second);
      let entered!: () => void;
      let leave!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const release = new Promise<void>((resolve) => {
        leave = resolve;
      });
      const transport = store.withDeliveryPermit(
        {
          generation,
          scope,
          commandId: first.commandId,
          claimId: firstClaim!.claimId,
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        },
        async () => {
          entered();
          await release;
          return "native_transport_exited";
        },
      );
      await started;
      const pausing = otherStore.setMaintenancePaused({
        generation,
        paused: true,
        expectedEpoch: "0",
        actor: "operator:stable",
        now,
        deadlineAt: new Date(now.getTime() + 5000),
      });
      const waitUntil = Date.now() + 2000;
      let blocked = false;
      while (Date.now() < waitUntil) {
        const lock = await admin.query(
          "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted) AS blocked",
        );
        if (lock.rows[0].blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(await store.maintenanceState(generation)).toMatchObject({
        epoch: "0",
        paused: false,
      });
      leave();
      expect(await transport).toEqual({
        permitted: true,
        value: "native_transport_exited",
      });
      expect(await pausing).toEqual({ generation, epoch: "1", paused: true });
      let called = false;
      expect(
        await store.withDeliveryPermit(
          {
            generation,
            scope,
            commandId: second.commandId,
            claimId: secondClaim!.claimId,
            now,
            deadlineAt: new Date(now.getTime() + 5000),
          },
          async () => {
            called = true;
            return true;
          },
        ),
      ).toEqual({ permitted: false });
      expect(called).toBe(false);
      expect(await claim(second)).toBeNull();
      await expect(admit(save())).rejects.toMatchObject({
        code: "unavailable",
      });
      await expect(
        otherStore.setMaintenancePaused({
          generation,
          paused: false,
          expectedEpoch: "0",
          actor: "operator:stable",
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        await otherStore.setMaintenancePaused({
          generation,
          paused: false,
          expectedEpoch: "1",
          actor: "operator:stable",
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        }),
      ).toEqual({ generation, epoch: "2", paused: false });
      expect((await claim(second))?.mode).toBe("observe");
      const events = await prisma.outboxEvent.findMany({
        where: {
          idempotencyKey: { startsWith: "memory.knowledge.command.resume:" },
        },
      });
      expect(events).toHaveLength(2);
      expect(
        JSON.stringify(events.map((event) => event.payload)),
      ).not.toContain(first.body);
    });

    it("releases the shared transport barrier on callback failure without forgetting an unknown dispatch", async () => {
      const command = save();
      await admit(command);
      const work = await claim(command);
      await expect(
        store.withDeliveryPermit(
          {
            generation,
            scope,
            commandId: command.commandId,
            claimId: work!.claimId,
            now,
            deadlineAt: new Date(now.getTime() + 5000),
          },
          async () => {
            throw new Error("unsafe provider error must not escape");
          },
        ),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect(
        await otherStore.setMaintenancePaused({
          generation,
          paused: true,
          expectedEpoch: "0",
          actor: "operator:stable",
          now,
          deadlineAt: new Date(now.getTime() + 5000),
        }),
      ).toMatchObject({ paused: true });
      expect(
        await store.findCommand({
          commandId: command.commandId,
          scope,
          generation,
        }),
      ).toMatchObject({ operation: { state: "unknown" } });
    });

    it("purges expired unresolved delivery input while preserving visible fenced operator debt", async () => {
      const command = save();
      await admit(command);
      const later = new Date(now.getTime() + 2 * 86400000);
      expect(
        await store.expireDeliveryEnvelopes({ now: later, limit: 100 }),
      ).toBe(1);
      expect(
        await store.findCommand({
          commandId: command.commandId,
          scope,
          generation,
        }),
      ).toMatchObject({
        envelope: null,
        operation: { state: "unknown", safeReason: "input_required" },
      });
      expect(
        memoryKnowledgeBodyVisible(
          (await store.findEntry(command.ref, generation))!,
          "management",
          later,
        ),
      ).toBe(false);
    });

    it("recovers expired delivery claims through IDs-only outbox work and checks expiry under the current revision lock", async () => {
      const command = save({
        applicability: {
          validUntil: new Date(now.getTime() + 1000).toISOString(),
          observedCommitSha: null,
          exceptionRule: null,
        },
      });
      await publish(command);
      const expiry: MemoryKnowledgeCommand = {
        kind: "expire",
        ref: command.ref,
        commandId: randomUUID(),
        expectedRevision: "1",
        generation,
        providerProfileVersion: command.providerProfileVersion,
        approval: command.approval,
      };
      await expect(admit(expiry)).rejects.toMatchObject({ code: "conflict" });
      const due = new Date(now.getTime() + 2000);
      expect(
        (await store.findEntry(command.ref, generation))?.applicability
          .validUntil,
      ).toBe(command.applicability.validUntil);
      expect(
        await store.listExpiredEntries({ generation, now: due, limit: 10 }),
      ).toHaveLength(1);
      await store.admit({
        command: expiry,
        digest: memoryKnowledgeCommandDigest(expiry),
        now: due,
        deliveryExpiresAt: new Date(due.getTime() + 86400000),
        resubmitUntil: due,
        activeEntryLimit: null,
        pendingCommandLimit: 100,
      });
      expect((await store.findEntry(command.ref, generation))?.lifecycle).toBe(
        "expired",
      );
      expect(
        await store.listExpiredEntries({ generation, now: due, limit: 10 }),
      ).toHaveLength(0);
      const work = await claim(expiry, store, due);
      expect(work).not.toBeNull();
      expect(
        await store.scheduleDueDeliveries({
          generation,
          now: new Date(due.getTime() + 6000),
          limit: 10,
        }),
      ).toBe(0);
      const recoveryAt = new Date(due.getTime() + 11000);
      const results = await Promise.all([
        store.scheduleDueDeliveries({ generation, now: recoveryAt, limit: 10 }),
        otherStore.scheduleDueDeliveries({
          generation,
          now: recoveryAt,
          limit: 10,
        }),
      ]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      const events = await prisma.outboxEvent.findMany({
        where: {
          idempotencyKey: { startsWith: "memory.knowledge.command.recover:" },
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toEqual({
        commandId: expiry.commandId,
        generation,
        scope,
      });
      const observed = await claim(expiry, otherStore, recoveryAt);
      expect(observed?.mode).toBe("observe");
      const stale: MemoryKnowledgeCommand = {
        ...expiry,
        commandId: randomUUID(),
      };
      await expect(admit(stale)).rejects.toMatchObject({ code: "conflict" });
    });

    it("atomically schedules safe outbox observation IDs instead of duplicating approved payloads", async () => {
      const command = save();
      await admit(command);
      const work = await claim(command);
      await store.settle({
        commandId: command.commandId,
        scope,
        generation,
        claimId: work!.claimId,
        result: { commandId: command.commandId, state: "processing" },
        now,
      });
      const events = await prisma.outboxEvent.findMany({
        orderBy: { idempotencyKey: "asc" },
      });
      expect(events).toHaveLength(2);
      expect(
        JSON.stringify(events.map((event) => event.payload)),
      ).not.toContain(command.body);
      expect(
        events.some(
          (event) => event.nextAttemptAt?.getTime() === now.getTime() + 5000,
        ),
      ).toBe(true);
    });
  },
);
