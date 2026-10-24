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
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import {
  createMemoryBodyHash,
  MemoryKnowledgeService,
  StaticMemoryPolicyConfig,
  UnlimitedMemoryQuotaPolicy,
  type MemoryKnowledgeCommand,
  type MemoryKnowledgeReader,
  type MemoryKnowledgeWriter,
  type MemoryOperationObserver,
  type MemoryProviderEntry,
} from "@reviewrouter/features-memory";
import { PrismaMemoryKnowledgeStore } from "@reviewrouter/features-memory/infrastructure";
import type { OutboxEvent } from "@reviewrouter/features-outbox";
import { createMemoryKnowledgeWorker } from "./memory-knowledge-worker";
const databaseUrl = process.env.REVIEW_ROUTER_MEMORY_TEST_DATABASE_URL;
const schema = `memory_worker_${randomUUID().replaceAll("-", "")}`;
const generation = "worker_delivery_test";
const now = new Date("2026-10-23T10:00:00.000Z");
const scope = {
  kind: "repository" as const,
  workspaceId: "worker_workspace",
  repositoryId: "worker_repository",
};
describe.skipIf(!databaseUrl)(
  "persisted memory command to actual worker delivery",
  () => {
    let admin: pg.Pool;
    let prisma: PrismaClient;
    let store: PrismaMemoryKnowledgeStore;
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/reviewrouter_memory_test"
      )
        throw new Error(
          "memory_worker_test_requires_disposable_loopback_database",
        );
      admin = new pg.Pool({ connectionString: databaseUrl! });
      const version = await admin.query("SHOW server_version_num");
      if (Number(version.rows[0].server_version_num) < 170000)
        throw new Error("memory_worker_test_requires_postgresql17");
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
        for (const migration of [
          "000142_memory_knowledge_authority",
          "000143_memory_maintenance_fence",
        ])
          await fixture.query(
            await readFile(
              new URL(
                `../../../packages/platform/db/prisma/migrations/${migration}/migration.sql`,
                import.meta.url,
              ),
              "utf8",
            ),
          );
      } finally {
        await fixture.end();
      }
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: databaseUrl!,
            options: `-c search_path=${schema}`,
            max: 4,
          },
          { schema },
        ),
      });
      store = new PrismaMemoryKnowledgeStore(prisma);
    });
    beforeEach(async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE "MemoryKnowledgeCommand","MemoryKnowledgeEntry","MemoryKnowledgeScopeState","MemoryKnowledgeSourceCursor","MemoryKnowledgeBundleReceipt","MemoryKnowledgeMaintenanceFence","OutboxEvent","AuditEvent"',
      );
    });
    afterAll(async () => {
      await prisma?.$disconnect();
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });
    async function fixture() {
      let current: MemoryProviderEntry | null = null;
      const submit = vi.fn<MemoryKnowledgeWriter["submit"]>(async (input) => {
        if (input.command.kind !== "save")
          throw new Error("unexpected test command");
        current = {
          ref: input.command.ref,
          body: input.command.body,
          bodyDigest: createMemoryBodyHash(input.command.body),
          contentApprovalRevision: input.contentApprovalRevision,
          kind: input.command.knowledgeKind,
          topicIds: input.command.topicIds,
          statementAt: input.originalStatementAt!,
          sourceFactIds: ["qualified-test-fact"],
        };
        return {
          commandId: input.command.commandId,
          state: "published",
          verifiedEntry: current,
        };
      });
      const read = vi.fn<MemoryKnowledgeReader["read"]>(async () => current);
      const observe = vi.fn<MemoryOperationObserver["observe"]>(
        async (input) => ({
          commandId: input.command.commandId,
          state: "unknown",
        }),
      );
      const service = new MemoryKnowledgeService({
        generation,
        providerProfileVersion: "test-profile",
        store,
        reader: {
          read,
          list: async () => ({ entries: [], nextCursor: null }),
          recall: async () => [],
        },
        writer: { submit },
        observer: { observe },
        access: {
          authorize: async () => {},
          verifySource: async (input) => input.source,
          sourceApplicable: async () => true,
        },
        policy: new StaticMemoryPolicyConfig(),
        quota: new UnlimitedMemoryQuotaPolicy(),
        now: () => now,
      });
      const command: Extract<MemoryKnowledgeCommand, { kind: "save" }> = {
        kind: "save",
        commandId: randomUUID(),
        ref: { type: "entry", scope, entryId: "mem_worker_entry" },
        expectedRevision: null,
        generation,
        providerProfileVersion: "test-profile",
        approval: {
          actor: {
            kind: "workspace_user",
            id: "manager",
            githubUserId: null,
            login: null,
          },
          approvedAt: now.toISOString(),
          authorityRevision: "membership-1",
        },
        body: "Use bounded approved statements.",
        knowledgeKind: "rule",
        topicIds: ["engineering"],
        source: {
          type: "manual",
          sourceId: "worker-source",
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
      };
      await service.save(command, {
        deadlineAt: new Date(now.getTime() + 20_000),
      });
      const event = await prisma.outboxEvent.findUniqueOrThrow({
        where: {
          idempotencyKey: `memory.knowledge.command:${command.commandId}`,
        },
      });
      const worker = createMemoryKnowledgeWorker({
        generation,
        enabled: true,
        service,
        now: () => now,
        quarantineLegacy: async () => {},
        warn: vi.fn(),
      });
      const handler = worker.handlers.find(
        (candidate) =>
          candidate.type === event.type && candidate.version === event.version,
      )!;
      return { command, event, handler, service, submit, read, observe };
    }
    it("dispatches persisted admission, verifies publication, purges input and deduplicates redelivery", async () => {
      const { command, event, handler, service, submit, read, observe } =
        await fixture();
      await handler.handle(event);
      expect(submit).toHaveBeenCalledTimes(1);
      expect(submit).toHaveBeenCalledWith(
        expect.objectContaining({
          command,
          revision: "1",
          contentApprovalRevision: "1",
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(observe).not.toHaveBeenCalled();
      expect(
        await service.progress(
          {
            actor: command.approval.actor,
            scope,
            commandId: command.commandId,
          },
          { deadlineAt: new Date(now.getTime() + 20_000) },
        ),
      ).toMatchObject({ state: "published", revision: "1" });
      expect(
        (await store.findCommand({
          commandId: command.commandId,
          scope,
          generation,
        }))!.envelope,
      ).toBeNull();
      expect(
        (
          await service.read(
            { actor: command.approval.actor, ref: command.ref },
            { deadlineAt: new Date(now.getTime() + 20_000) },
          )
        ).body,
      ).toBe(command.body);
      expect(read).toHaveBeenCalledTimes(1);
      await handler.handle(event);
      expect(submit).toHaveBeenCalledTimes(1);
    });
    it("rejects raw body and malformed identity before real service dispatch", async () => {
      const { event, handler, submit, observe } = await fixture();
      for (const payload of [
        { ...(event.payload as object), body: "raw unapproved source" },
        { ...(event.payload as object), commandId: "malformed" },
        {
          ...(event.payload as object),
          scope: { ...scope, workspaceId: "another_workspace" },
        },
      ])
        await expect(
          handler.handle({ ...event, payload } as OutboxEvent),
        ).rejects.toMatchObject({
          code: "invalid_memory_knowledge_event",
          retryable: false,
        });
      expect(submit).not.toHaveBeenCalled();
      expect(observe).not.toHaveBeenCalled();
    });
  },
);
