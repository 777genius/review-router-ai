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
import { createMemoryBodyHash } from "../domain/memory-body";
import {
  memoryKnowledgeBodyVisible,
  memoryKnowledgeCommandDigest,
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
      store = new PrismaMemoryKnowledgeStore(prisma);
      otherStore = new PrismaMemoryKnowledgeStore(other);
    });

    beforeEach(async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE "MemoryKnowledgeCommand","MemoryKnowledgeEntry","MemoryKnowledgeScopeState","MemoryKnowledgeSourceCursor","MemoryKnowledgeBundleReceipt","MemoryKnowledgeMaintenanceFence","OutboxEvent","AuditEvent"',
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
      const receipt = {
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

    it.each(["initial save", "edit", "topics"] as const)(
      "settles a queued forget after its unknown %s expires without resurrecting either command",
      async (kind) => {
        const original = save();
        const pending: MemoryKnowledgeCommand =
          kind === "initial save"
            ? original
            : kind === "edit"
              ? save({
                  ref: original.ref,
                  expectedRevision: "1",
                  body: "A replacement that may have reached the provider.",
                })
              : {
                  kind: "topics",
                  ref: original.ref,
                  commandId: randomUUID(),
                  expectedRevision: "1",
                  generation,
                  providerProfileVersion: original.providerProfileVersion,
                  approval: original.approval,
                  topicIds: ["different-topic"],
                };
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

    it.each(["predecessor", "forget"] as const)(
      "preserves an active %s lease even with a verified cleanup receipt",
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
        ).rejects.toMatchObject({ code: "conflict" });
        expect(await store.findEntry(original.ref, generation)).toMatchObject({
          lifecycle: "forget_pending",
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
