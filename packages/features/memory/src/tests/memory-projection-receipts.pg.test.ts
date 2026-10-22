import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { Prisma } from "@prisma/client";
import { MemoryItem } from "../domain/memory-item";
import { createMemoryBodyHash } from "../domain/memory-body";
import { createDashboardMemorySource } from "../domain/memory-source";
import { PrismaInfinityMemoryProjectionStore } from "../infrastructure/prisma/prisma-infinity-memory-projection-store";
import { PrismaMemoryItemRepository } from "../infrastructure/prisma/prisma-memory-item-repository";
import type { MemoryProjectionRevision } from "../infrastructure/infinity/memory-projection-receipt-store";

import { PrismaMemorySearchIndex } from "../infrastructure/prisma/prisma-memory-search-index";
import { InfinityMemorySearchIndex } from "../infrastructure/infinity/infinity-memory-search-index";
import { InfinityProtocolFixture } from "./infinity-protocol-fixture";
import { buildActionMemoryBundle } from "../application/use-cases/build-action-memory-bundle";
import { StaticMemoryPolicyConfig } from "../application/ports/memory-policy-config-port";
import type { MemorySearchIndexPort } from "../application/ports/memory-search-index-port";

const databaseUrl = process.env.REVIEW_ROUTER_MEMORY_TEST_DATABASE_URL;
const prefix = "memory-receipt-test-";
const workspaceId = `${prefix}workspace`;
const repositoryId = `${prefix}repository`;
const userId = `${prefix}user`;
const indexIdentity = "infinity:receipt-test-generation-1";

describe.skipIf(!databaseUrl)(
  "memory projection receipts on real PostgreSQL",
  () => {
    let prisma: PrismaClient;
    let otherConnection: PrismaClient;
    let receipts: PrismaInfinityMemoryProjectionStore;
    let memoryItems: PrismaMemoryItemRepository;

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/reviewrouter_memory_test"
      ) {
        throw new Error("memory_receipt_test_requires_own_loopback_database");
      }
      prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 5 });
      otherConnection = createPrismaClient({
        databaseUrl: databaseUrl!,
        poolMax: 5,
      });
      receipts = new PrismaInfinityMemoryProjectionStore(prisma);
      memoryItems = new PrismaMemoryItemRepository(prisma);
      const [installed] = await prisma.$queryRaw<
        { constraints: number; version: number }[]
      >(Prisma.sql`
      SELECT (SELECT count(*)::int FROM pg_constraint WHERE conname = 'MemoryProjectionReceipt_state_check') AS constraints,
        current_setting('server_version_num')::int AS version`);
      if (installed?.constraints !== 1 || installed.version < 170_000)
        throw new Error(
          "memory_receipt_test_requires_migration_141_and_postgres_17",
        );
    });

    beforeEach(async () => {
      await prisma.memoryProjectionReceipt.deleteMany({
        where: { workspaceId: { startsWith: prefix } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { startsWith: prefix } },
      });
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.workspace.create({
        data: {
          id: workspaceId,
          slug: workspaceId,
          name: "Memory receipt fixture",
        },
      });
      await prisma.user.create({ data: { id: userId } });
      await prisma.repositoryConnection.create({
        data: {
          id: repositoryId,
          workspaceId,
          externalRepositoryId: "receipt-fixture-repository",
          owner: "fixture",
          name: "memory",
          fullName: "fixture/memory",
          defaultBranch: "main",
          visibility: "private",
        },
      });
    });

    afterAll(async () => {
      if (!prisma) return;
      await prisma.memoryProjectionReceipt.deleteMany({
        where: { workspaceId: { startsWith: prefix } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { startsWith: prefix } },
      });
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await Promise.all([prisma.$disconnect(), otherConnection.$disconnect()]);
    });

    async function seed(
      id: string,
      scope: MemoryProjectionRevision["scope"] = "repository",
    ) {
      const item = MemoryItem.create({
        id: `${prefix}${id}`,
        workspaceId,
        repositoryId: scope === "repository" ? repositoryId : null,
        userId: scope === "user_prefs" ? userId : null,
        scope,
        body: `Approved memory for ${id}.`,
        riskLevel: "low",
        confidence: 1,
        source: createDashboardMemorySource({ actorLogin: "fixture" }),
        policyVersion: 1,
        safetyPolicyVersion: 1,
        actor: {
          kind: "github_user",
          id: userId,
          githubUserId: "99141",
          login: "fixture",
        },
        now: new Date(),
      });
      await memoryItems.save(item);
      const snapshot = item.snapshot();
      const revision: MemoryProjectionRevision = {
        workspaceId,
        memoryItemId: snapshot.id,
        repositoryId: snapshot.repositoryId,
        userId: snapshot.userId,
        scope,
        bodyHash: snapshot.bodyHash,
        bodyVersion: snapshot.bodyVersion,
      };
      return { snapshot, revision };
    }

    async function index(revision: MemoryProjectionRevision) {
      const receipt = await receipts.reserve({ ...revision, indexIdentity });
      if (!receipt) throw new Error("fixture_reservation_missing");
      const key = { indexIdentity, receiptId: receipt.id };
      await receipts.admitSend(key);
      const document = { ...key, remoteDocumentId: `remote-${receipt.id}` };
      await receipts.recordAcknowledgement(document);
      const indexed = await receipts.markIndexed(document);
      await memoryItems.markIndexingSucceeded({
        workspaceId,
        itemId: revision.memoryItemId,
        bodyVersion: revision.bodyVersion,
        bodyHash: revision.bodyHash,
      });
      return indexed;
    }

    it("serializes competing fresh identities across real independent transactions", async () => {
      const { revision } = await seed("identity");
      const alternate = new PrismaInfinityMemoryProjectionStore(
        otherConnection,
      );
      const results = await Promise.allSettled([
        receipts.reserve({ ...revision, indexIdentity }),
        alternate.reserve({
          ...revision,
          indexIdentity: "infinity:other-endpoint",
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        reason: { code: "memory_index_identity_conflict" },
      });
      const rows = await prisma.memoryProjectionReceipt.findMany({
        where: { workspaceId },
      });
      expect(rows).toHaveLength(1);
      const retry = await receipts.reserve({
        ...revision,
        indexIdentity: rows[0]!.indexIdentity,
      });
      expect(retry).toMatchObject({
        id: rows[0]!.id,
        sequenceOrdinal: rows[0]!.sequenceOrdinal,
      });
      expect(retry!.sequenceOrdinal).toBeGreaterThan(0);
    });

    it("cancels a never-sent reservation before admission and never resurrects its key", async () => {
      const { revision } = await seed("cancelled");
      const receipt = (await receipts.reserve({ ...revision, indexIdentity }))!;
      await receipts.requestDeletion({
        indexIdentity,
        workspaceId,
        memoryItemId: revision.memoryItemId,
        target: { kind: "item" },
      });
      expect(
        await receipts.admitSend({ indexIdentity, receiptId: receipt.id }),
      ).toBeNull();
      await expect(
        receipts.reserve({ ...revision, indexIdentity }),
      ).rejects.toMatchObject({ code: "memory_index_generation_retired" });
      await receipts.assertCompatibleIndexIdentity(indexIdentity);
      // Normal deletion of the last item does not retire the entire deployment.
      const next = await seed("next");
      expect(
        await receipts.reserve({ ...next.revision, indexIdentity }),
      ).not.toBeNull();
    });

    it("preserves concurrent deletion through a late acknowledgement", async () => {
      const { revision } = await seed("late-ack");
      const receipt = (await receipts.reserve({ ...revision, indexIdentity }))!;
      const key = { indexIdentity, receiptId: receipt.id };
      await receipts.admitSend(key);
      await receipts.requestDeletion({
        indexIdentity,
        workspaceId,
        memoryItemId: revision.memoryItemId,
        target: { kind: "item" },
      });
      const acknowledged = await receipts.recordAcknowledgement({
        ...key,
        remoteDocumentId: "late-native-id",
      });
      expect(acknowledged).toMatchObject({
        deleteRequested: true,
        state: "accepted",
      });
      expect(
        await receipts.markIndexed({
          ...key,
          remoteDocumentId: "late-native-id",
        }),
      ).toMatchObject({ deleteRequested: true, state: "accepted" });
      await expect(
        receipts.markDeleted({ ...key, remoteDocumentId: "wrong-id" }),
      ).rejects.toMatchObject({ code: "memory_index_conflict" });
      await receipts.markDeleted({
        ...key,
        remoteDocumentId: "late-native-id",
      });
      expect(
        await receipts.listOutstanding({ indexIdentity, limit: 10 }),
      ).toEqual([]);
      expect(
        await receipts.recordAcknowledgement({
          ...key,
          remoteDocumentId: "late-native-id",
        }),
      ).toMatchObject({ state: "deleted", deleteRequested: true });
    });

    it("rejects changed/expired canonical revisions at send admission", async () => {
      const { revision } = await seed("edited-before-send");
      const receipt = (await receipts.reserve({ ...revision, indexIdentity }))!;
      await prisma.memoryItem.update({
        where: { id: revision.memoryItemId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        await receipts.admitSend({ indexIdentity, receiptId: receipt.id }),
      ).toBeNull();
      expect(await receipts.reserve({ ...revision, indexIdentity })).toBeNull();
    });

    it("cleans an old revision without touching the current indexed receipt", async () => {
      const { revision } = await seed("edited");
      const old = await index(revision);
      const body = "A newly approved exact revision.";
      const current = {
        ...revision,
        bodyVersion: 2,
        bodyHash: createMemoryBodyHash(body),
      };
      await prisma.memoryItem.update({
        where: { id: revision.memoryItemId },
        data: {
          body,
          bodyVersion: 2,
          bodyHash: current.bodyHash,
          indexState: "index_pending",
          indexVersion: null,
        },
      });
      const next = await index(current);
      await receipts.requestDeletion({
        indexIdentity,
        workspaceId,
        memoryItemId: revision.memoryItemId,
        target: {
          kind: "revision",
          bodyVersion: revision.bodyVersion,
          bodyHash: revision.bodyHash,
        },
      });
      await receipts.markDeleted({
        indexIdentity,
        receiptId: old.id,
        remoteDocumentId: old.remoteDocumentId!,
      });
      expect(
        await receipts.findByReceiptIds({
          indexIdentity,
          receiptIds: [next.id],
        }),
      ).toMatchObject([
        { state: "indexed", deleteRequested: false, isCurrent: true },
      ]);
      expect(
        await receipts.hasCoverage({
          indexIdentity,
          scope: {
            workspaceId,
            repositoryId,
            userId: null,
            includeUserPrefs: false,
            allowedScopes: ["repository"],
          },
        }),
      ).toBe(true);
    });

    it("requires full exact coverage only for authorized active scopes", async () => {
      const repo = await seed("coverage-repo");
      const workspace = await seed("coverage-workspace", "workspace");
      await seed("coverage-user", "user_prefs");
      const scope = {
        workspaceId,
        repositoryId,
        userId,
        includeUserPrefs: false,
        allowedScopes: ["repository"] as const,
      };
      await memoryItems.markIndexingSucceeded({
        workspaceId,
        itemId: repo.revision.memoryItemId,
        bodyVersion: 1,
        bodyHash: repo.revision.bodyHash,
      });
      expect(await receipts.hasCoverage({ indexIdentity, scope })).toBe(false);
      await index(repo.revision);
      expect(await receipts.hasCoverage({ indexIdentity, scope })).toBe(true);
      expect(
        await receipts.hasCoverage({
          indexIdentity,
          scope: { ...scope, allowedScopes: ["repository", "workspace"] },
        }),
      ).toBe(false);
      await prisma.memoryItem.update({
        where: { id: workspace.revision.memoryItemId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        await receipts.hasCoverage({
          indexIdentity,
          scope: { ...scope, allowedScopes: ["repository", "workspace"] },
        }),
      ).toBe(true);
    });

    it("filters disabled scopes and expiry in SQL before the fallback limit", async () => {
      const repo = await seed("old-allowed");
      for (let n = 0; n < 8; n++)
        await seed(`new-disallowed-${n}`, "workspace");
      const expired = await seed("new-expired");
      await prisma.memoryItem.update({
        where: { id: expired.revision.memoryItemId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const items = await memoryItems.listActiveForBundle({
        workspaceId,
        repositoryId,
        userId: null,
        allowedScopes: ["repository"],
        activeAt: new Date(),
        limit: 1,
      });
      expect(items.map((item) => item.id)).toEqual([
        repo.revision.memoryItemId,
      ]);
    });

    it("retains orphan cleanup after a workspace cascade without an outbox event", async () => {
      const { revision } = await seed("orphan");
      const receipt = await index(revision);
      await prisma.workspace.delete({ where: { id: workspaceId } });
      expect(
        await prisma.memoryItem.count({ where: { id: revision.memoryItemId } }),
      ).toBe(0);
      expect(await prisma.outboxEvent.count({ where: { workspaceId } })).toBe(
        0,
      );
      expect(
        await receipts.listDue({
          indexIdentity,
          limit: 10,
          now: new Date(Date.now() + 1000),
        }),
      ).toMatchObject([{ id: receipt.id, isCurrent: false }]);
      await receipts.requestDeletion({
        indexIdentity,
        workspaceId,
        memoryItemId: revision.memoryItemId,
        target: { kind: "item" },
      });
      await receipts.markDeleted({
        indexIdentity,
        receiptId: receipt.id,
        remoteDocumentId: receipt.remoteDocumentId!,
      });
      expect(
        await receipts.listOutstanding({ indexIdentity, limit: 10 }),
      ).toEqual([]);
    });

    it("keeps unknown sends durable and defers them so later work is not starved", async () => {
      const first = await seed("unknown");
      const unknown = (await receipts.reserve({
        ...first.revision,
        indexIdentity,
      }))!;
      const key = { indexIdentity, receiptId: unknown.id };
      await receipts.admitSend(key);
      await receipts.requestDeletion({
        indexIdentity,
        workspaceId,
        memoryItemId: first.revision.memoryItemId,
        target: { kind: "item" },
      });
      await receipts.defer({
        ...key,
        nextAttemptAt: new Date(Date.now() + 60_000),
        reasonCode: "memory_index_unknown_write",
      });
      const second = await seed("later");
      const later = (await receipts.reserve({
        ...second.revision,
        indexIdentity,
      }))!;
      const restarted = new PrismaInfinityMemoryProjectionStore(
        otherConnection,
      );
      expect(
        await restarted.listDue({
          indexIdentity,
          now: new Date(Date.now() + 1000),
          limit: 1,
        }),
      ).toMatchObject([{ id: later.id }]);
      expect(
        await restarted.findByReceiptIds({
          indexIdentity,
          receiptIds: [unknown.id],
        }),
      ).toMatchObject([{ state: "sent_unknown", deleteRequested: true }]);
      await expect(
        restarted.assertCompatibleIndexIdentity("prisma"),
      ).rejects.toMatchObject({ code: "memory_index_identity_conflict" });
      const persisted = await prisma.memoryProjectionReceipt.findUnique({
        where: { id: unknown.id },
      });
      expect(JSON.stringify(persisted)).not.toContain(first.snapshot.body);
    });

    it("retires an explicitly drained generation and permits a fresh namespace", async () => {
      const { revision } = await seed("retire");
      await receipts.reserve({ ...revision, indexIdentity });
      await expect(
        receipts.retireIndexIdentity(indexIdentity),
      ).rejects.toMatchObject({ code: "memory_index_pending" });
      await receipts.requestDeletion({
        indexIdentity,
        workspaceId,
        memoryItemId: revision.memoryItemId,
        target: { kind: "item" },
      });
      await receipts.retireIndexIdentity(indexIdentity);
      await expect(
        receipts.assertCompatibleIndexIdentity(indexIdentity),
      ).rejects.toMatchObject({ code: "memory_index_generation_retired" });
      await receipts.assertCompatibleIndexIdentity("prisma");
      expect(
        await receipts.reserve({
          ...revision,
          indexIdentity: "infinity:fresh-generation",
        }),
      ).not.toBeNull();
    });

    it.each(["advisory", "canonical-row"] as const)(
      "checks fresh expiry after waiting for the %s lock",
      async (kind) => {
        const { revision } = await seed(`expiry-lock-${kind}`);
        const receipt = (await receipts.reserve({
          ...revision,
          indexIdentity,
        }))!;
        await prisma.$executeRaw(
          Prisma.sql`UPDATE "MemoryItem" SET "expiresAt" = clock_timestamp() + interval '1500 milliseconds' WHERE "id" = ${revision.memoryItemId}`,
        );
        let release = () => undefined as void;
        let acquired = () => undefined as void;
        const releaseLock = new Promise<void>((resolve) => {
          release = resolve;
        });
        const locked = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const blocker = otherConnection.$transaction(
          async (tx) => {
            if (kind === "advisory")
              await tx.$queryRaw`SELECT pg_advisory_xact_lock(1802399085, 1)::text`;
            else
              await tx.$queryRaw(
                Prisma.sql`SELECT "id" FROM "MemoryItem" WHERE "id" = ${revision.memoryItemId} FOR UPDATE`,
              );
            acquired();
            await releaseLock;
          },
          { timeout: 10_000 },
        );
        await locked;
        const admission = receipts.admitSend({
          indexIdentity,
          receiptId: receipt.id,
        });
        try {
          await expect
            .poll(
              async () => {
                const [waiting] = await prisma.$queryRaw<
                  { count: number }[]
                >(Prisma.sql`
            SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
              AND query LIKE ${kind === "advisory" ? "%pg_advisory_xact_lock%" : "%MemoryItem%FOR UPDATE%"}`);
                return waiting?.count ?? 0;
              },
              { interval: 10, timeout: 2_000 },
            )
            .toBeGreaterThan(0);
          await prisma.$queryRaw(
            Prisma.sql`SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ("expiresAt" - clock_timestamp())))::double precision + 0.03)::text FROM "MemoryItem" WHERE "id" = ${revision.memoryItemId}`,
          );
          release();
          await blocker;
          expect(await admission).toBeNull();
          expect(
            await receipts.findByReceiptIds({
              indexIdentity,
              receiptIds: [receipt.id],
            }),
          ).toMatchObject([{ state: "reserved", isCurrent: false }]);
        } finally {
          release();
          await blocker;
          await admission;
        }
      },
    );

    it("recovers indexed receipt readiness without replaying an outbox event or trusting legacy flags", async () => {
      const { snapshot } = await seed("maintenance-ready");
      const peer = await InfinityProtocolFixture.start();
      try {
        peer.autoIndex = false;
        const engine = new InfinityMemorySearchIndex({
          config: peer.config,
          receipts,
        });
        await expect(
          engine.upsertDocument({ ...snapshot, memoryItemId: snapshot.id }),
        ).rejects.toMatchObject({ code: "memory_index_pending" });
        const stored = (await prisma.memoryProjectionReceipt.findFirst({
          where: { memoryItemId: snapshot.id },
        }))!;
        expect(stored.state).toBe("accepted");
        for (const document of peer.documents.values()) document.indexed = true;
        await receipts.defer({
          indexIdentity: peer.config.indexIdentity,
          receiptId: stored.id,
          nextAttemptAt: new Date(0),
          reasonCode: "memory_index_pending",
        });
        const restarted = new InfinityMemorySearchIndex({
          config: peer.config,
          receipts: new PrismaInfinityMemoryProjectionStore(otherConnection),
        });
        expect(await restarted.reconcilePending()).toMatchObject({
          processed: 1,
          pending: 0,
        });
        expect(await prisma.outboxEvent.count({ where: { workspaceId } })).toBe(
          0,
        );
        expect(
          (await memoryItems.findById({ workspaceId, itemId: snapshot.id }))
            ?.indexState,
        ).toBe("index_pending");
        const input = {
          workspaceId,
          repositoryId,
          userId: null,
          safeRetrievalQuery: "Approved memory",
        };
        const dependencies = {
          memoryItems,
          memoryPolicyConfig: new StaticMemoryPolicyConfig(),
          memorySearchIndex: restarted,
        };
        expect(
          await buildActionMemoryBundle(input, dependencies),
        ).toMatchObject({
          degraded: false,
          items: [{ id: snapshot.id, body: snapshot.body }],
        });
        await memoryItems.markIndexingSucceeded({
          workspaceId,
          itemId: snapshot.id,
          bodyHash: snapshot.bodyHash,
          bodyVersion: snapshot.bodyVersion,
        });
        // Model a same-body edit whose earlier snapshot overwrites diagnostic flags.
        await memoryItems.save(MemoryItem.fromSnapshot(snapshot));
        expect(
          await buildActionMemoryBundle(input, dependencies),
        ).toMatchObject({
          degraded: false,
          items: [{ id: snapshot.id, body: snapshot.body }],
        });
      } finally {
        await peer.close();
      }
    });

    describe.each(["prisma", "infinity"] as const)(
      "shared search consumer contract: %s",
      (kind) => {
        async function withEngine(
          work: (engine: MemorySearchIndexPort) => Promise<void>,
        ) {
          if (kind === "prisma")
            return work(new PrismaMemorySearchIndex(prisma));
          const peer = await InfinityProtocolFixture.start();
          try {
            await work(
              new InfinityMemorySearchIndex({ config: peer.config, receipts }),
            );
          } finally {
            await peer.close();
          }
        }

        it("retries the same revision and returns only canonically authorized exact hits", async () => {
          const { snapshot } = await seed("shared-contract");
          await withEngine(async (engine) => {
            const document = { ...snapshot, memoryItemId: snapshot.id };
            expect(await engine.upsertDocument(document)).toEqual({
              status: "indexed",
            });
            expect(await engine.upsertDocument(document)).toEqual({
              status: "indexed",
            });
            await memoryItems.markIndexingSucceeded({
              workspaceId,
              itemId: snapshot.id,
              bodyHash: snapshot.bodyHash,
              bodyVersion: snapshot.bodyVersion,
            });
            const hits = await engine.search({
              workspaceId,
              repositoryId,
              userId: null,
              safeQuery: "Approved memory",
              limit: 12,
              allowedScopes: ["repository"],
              includeUserPrefs: false,
            });
            expect(hits).toMatchObject([
              {
                memoryItemId: snapshot.id,
                bodyHash: snapshot.bodyHash,
                bodyVersion: snapshot.bodyVersion,
                scope: "repository",
              },
            ]);
            const bundle = await buildActionMemoryBundle(
              {
                workspaceId,
                repositoryId,
                userId: null,
                safeRetrievalQuery: "Approved memory",
              },
              {
                memoryItems,
                memoryPolicyConfig: new StaticMemoryPolicyConfig(),
                memorySearchIndex: engine,
              },
            );
            expect(bundle).toMatchObject({
              degraded: false,
              items: [{ id: snapshot.id, body: snapshot.body }],
            });
            expect(
              await engine.search({
                workspaceId: "another-workspace",
                repositoryId,
                userId: null,
                safeQuery: "Approved memory",
                limit: 12,
                allowedScopes: ["repository"],
                includeUserPrefs: false,
              }),
            ).toEqual([]);
          });
        });

        it("returns the changed canonical revision safely and isolates exact cleanup", async () => {
          const { snapshot } = await seed("shared-edited");
          await withEngine(async (engine) => {
            await engine.upsertDocument({
              ...snapshot,
              memoryItemId: snapshot.id,
            });
            const body = "Approved memory after a concurrent canonical edit.";
            const bodyHash = createMemoryBodyHash(body);
            await prisma.memoryItem.update({
              where: { id: snapshot.id },
              data: {
                body,
                bodyHash,
                bodyVersion: 2,
                indexState: "index_pending",
                indexVersion: null,
              },
            });
            const dependencies = {
              memoryItems,
              memoryPolicyConfig: new StaticMemoryPolicyConfig(),
              memorySearchIndex: engine,
            };
            const input = {
              workspaceId,
              repositoryId,
              userId: null,
              safeRetrievalQuery: "Approved memory",
            };
            expect(
              await buildActionMemoryBundle(input, dependencies),
            ).toMatchObject({
              degraded: kind === "infinity",
              items: [{ id: snapshot.id, body }],
            });
            const current = (await memoryItems.findById({
              workspaceId,
              itemId: snapshot.id,
            }))!;
            await engine.upsertDocument({
              ...current,
              memoryItemId: current.id,
            });
            await memoryItems.markIndexingSucceeded({
              workspaceId,
              itemId: current.id,
              bodyHash,
              bodyVersion: 2,
            });
            await engine.deleteDocument({
              workspaceId,
              memoryItemId: snapshot.id,
              target: {
                kind: "revision",
                bodyHash: snapshot.bodyHash,
                bodyVersion: snapshot.bodyVersion,
              },
            });
            expect(
              await buildActionMemoryBundle(input, dependencies),
            ).toMatchObject({
              degraded: false,
              items: [{ id: snapshot.id, body }],
            });
            const deleted = MemoryItem.fromSnapshot(current).delete({
              actor: {
                kind: "github_user",
                id: userId,
                githubUserId: "99141",
                login: "fixture",
              },
              now: new Date(),
            });
            await memoryItems.save(deleted);
            await engine.deleteDocument({
              workspaceId,
              memoryItemId: snapshot.id,
              target: { kind: "item" },
            });
            expect(
              (await buildActionMemoryBundle(input, dependencies)).items,
            ).toEqual([]);
          });
        });
      },
    );
  },
);
