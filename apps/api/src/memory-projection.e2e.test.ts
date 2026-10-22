import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import {
  defaultActionOidcAudience,
  githubActionsOidcIssuer,
  JoseActionSessionTokenService,
  PrismaActionControlPlaneRepository,
  type GitHubActionsOidcTokenVerifierPort,
} from "@reviewrouter/features-action-control-plane";
import {
  CryptoMemoryIdGenerator,
  PrismaMemoryItemRepository,
  PrismaMemoryPermission,
  PrismaMemorySuggestionRepository,
  PrismaMemoryTransaction,
  PrismaMemoryUsageEventRepository,
} from "@reviewrouter/features-memory/infrastructure";
import {
  editMemoryItem,
  StaticMemoryPolicyConfig,
  type ActionMemoryBundle,
  type MemoryActor,
  type MemoryUseCaseDependencies,
} from "@reviewrouter/features-memory";
import {
  createMemorySearchRuntime,
  type MemorySearchRuntime,
} from "@reviewrouter/features-memory/composition";
import { createMemoryOutboxHandlers } from "@reviewrouter/features-memory/outbox";
import {
  PrismaOutboxEventRepository,
  processOutboxBatch,
  retryDeadLetterOutboxEvent,
} from "@reviewrouter/features-outbox";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { SystemClock } from "@reviewrouter/shared";
import type { FastifyInstance } from "fastify";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { InfinityProtocolFixture } from "../../../packages/features/memory/src/tests/infinity-protocol-fixture";
import { createApiApp } from "./app";

const databaseUrl = isolatedDatabaseUrl(
  process.env.REVIEW_ROUTER_MEMORY_API_TEST_DATABASE_URL,
);
const actor: MemoryActor = {
  kind: "github_user",
  id: "github-login:memory-maintainer",
  githubUserId: null,
  login: "memory-maintainer",
};
const sourceExcerpt = "private-provenance-sentinel";
const clock = new SystemClock();

/**
 * Real PostgreSQL canonical/receipt state, real JWT sessions and outbox claims,
 * and the published Infinity SDK over loopback HTTP. GitHub OIDC verification
 * and the Infinity server are test peers, not live-service quality evidence.
 * Run only against a disposable current schema with migration 141 and the
 * ordinary OutboxEvent claim-version sequence installed by the test bootstrap.
 */
describe
  .skipIf(!databaseUrl)
  .sequential("memory projection API/outbox E2E", () => {
    let prisma: PrismaClient;
    let fixture: InfinityProtocolFixture;
    let app: FastifyInstance | undefined;
    let workspaceId: string;
    let repositoryId: string;
    let runtime: MemorySearchRuntime;
    let memory: MemoryUseCaseDependencies;
    let authorization: string;

    beforeAll(() => {
      prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 6 });
    });

    afterAll(async () => {
      await prisma?.$disconnect();
    });

    beforeEach(async () => {
      fixture = await InfinityProtocolFixture.start();
      workspaceId = "memory-api-" + randomUUID();
      repositoryId = "memory-repo-" + randomUUID();
      await prisma.workspace.create({
        data: {
          id: workspaceId,
          slug: workspaceId,
          name: "Memory projection API test",
          members: {
            create: { githubLogin: actor.login, role: "owner" },
          },
          installations: {
            create: {
              id: workspaceId + "-installation",
              githubInstallationId: 7300001n,
              accountLogin: "memory-example",
              accountType: "Organization",
              repositorySelection: "selected",
            },
          },
        },
      });
      await prisma.repositoryConnection.create({
        data: {
          id: repositoryId,
          workspaceId,
          installationId: workspaceId + "-installation",
          externalRepositoryId: "7300002",
          githubRepositoryId: 7300002n,
          owner: "memory-example",
          name: "review",
          fullName: "memory-example/review",
          defaultBranch: "main",
          visibility: "private",
        },
      });
      memory = {
        memoryItems: new PrismaMemoryItemRepository(prisma),
        memorySuggestions: new PrismaMemorySuggestionRepository(prisma),
        memoryPermissions: new PrismaMemoryPermission(prisma),
        memoryPolicyConfig: new StaticMemoryPolicyConfig(),
        memoryUsageEvents: new PrismaMemoryUsageEventRepository(prisma),
        memoryIds: new CryptoMemoryIdGenerator(),
        memoryTransaction: new PrismaMemoryTransaction(prisma),
        clock,
      };
      runtime = await createMemorySearchRuntime({
        prisma,
        env: fixtureEnvironment(fixture),
      });
      expect(fixture.requests).toHaveLength(0);
      await startApi();
    });

    afterEach(async () => {
      await app?.close();
      app = undefined;
      await fixture?.close();
      if (workspaceId) {
        // Receipts/outbox deliberately survive canonical cascades in production.
        // This dedicated test owns only its generated workspace rows.
        await prisma.memoryProjectionReceipt.deleteMany({
          where: { workspaceId },
        });
        await prisma.outboxEvent.deleteMany({ where: { workspaceId } });
        await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      }
    });

    async function startApi(): Promise<void> {
      const repositories = new PrismaActionControlPlaneRepository(prisma);
      const sessions = new JoseActionSessionTokenService(
        "memory-e2e-session-signing-key-at-least-32-bytes",
      );
      const oidcVerifier: GitHubActionsOidcTokenVerifierPort = {
        async verify({ token, audience }) {
          if (
            token !== "test-oidc-identity" ||
            audience !== defaultActionOidcAudience
          ) {
            throw new Error("invalid_action_token");
          }
          return {
            iss: githubActionsOidcIssuer,
            aud: defaultActionOidcAudience,
            sub: "repo:memory-example/review:issue_comment",
            repository: "memory-example/review",
            repository_id: "7300002",
            repository_owner: "memory-example",
            event_name: "issue_comment",
            run_id: "7300003",
            run_attempt: "1",
            workflow_ref:
              "memory-example/review/.github/workflows/reviewrouter-interaction.yml@refs/heads/main",
            actor: actor.login!,
          };
        },
      };
      app = await createApiApp({
        actionControlPlaneDependencies: {
          repositories,
          sessions,
          oidcVerifier,
          clock,
          oidcAudience: defaultActionOidcAudience,
        },
        actionMemoryDependencies: {
          repositories,
          sessions,
          memory,
          memorySearchIndex: runtime.searchIndex,
          clock,
        },
      });
      const exchange = await app.inject({
        method: "POST",
        url: "/api/action/v1/session/exchange",
        payload: { oidcToken: "test-oidc-identity" },
      });
      expect(exchange.statusCode, exchange.body).toBe(200);
      authorization =
        "Bearer " + exchange.json<{ sessionToken: string }>().sessionToken;
    }

    async function propose(body: string): Promise<string> {
      const response = await app!.inject({
        method: "POST",
        url: "/api/action/v1/memory-candidates",
        headers: { authorization },
        payload: {
          intent: "explicit_natural_language",
          requestedScope: "repository",
          candidateBody: body,
          extractionMethod: "explicit_natural_language",
          source: {
            sourceId: "issue_comment:" + randomUUID(),
            githubCommentId: "7300004",
            githubPullRequestNumber: 17,
            redactedExcerpt: sourceExcerpt,
            sourceVisibility: "private",
          },
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ status: "created" });
      return response.json<{ id: string }>().id;
    }

    async function command(
      value:
        | { kind: "confirm_suggestion"; suggestionId: string }
        | { kind: "forget_memory"; memoryItemId: string },
    ): Promise<{ status: string; id: string }> {
      const response = await app!.inject({
        method: "POST",
        url: "/api/action/v1/memory-commands",
        headers: { authorization },
        payload: { commands: [value] },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<{ results: { status: string; id: string }[] }>()
        .results[0]!;
    }

    async function confirm(body: string): Promise<string> {
      const suggestionId = await propose(body);
      const result = await command({
        kind: "confirm_suggestion",
        suggestionId,
      });
      expect(result.status).toBe("created");
      return result.id;
    }

    async function bundle(query = "migration"): Promise<ActionMemoryBundle> {
      const response = await app!.inject({
        method: "GET",
        url:
          "/api/action/v1/memory?safeRetrievalQuery=" +
          encodeURIComponent(query),
        headers: { authorization },
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json<ActionMemoryBundle>();
    }

    async function processBatch(writer = runtime.searchIndex) {
      return processOutboxBatch(
        {
          limit: 50,
          claimOwnerHash: "a".repeat(64),
          handlers: createMemoryOutboxHandlers({
            memoryItems: memory.memoryItems,
            searchIndex: writer,
          }),
        },
        { outbox: new PrismaOutboxEventRepository(prisma), clock },
      );
    }

    async function assertPrivateMetadata(body: string): Promise<void> {
      const [receipts, outbox, usage, audit] = await Promise.all([
        prisma.memoryProjectionReceipt.findMany({ where: { workspaceId } }),
        prisma.outboxEvent.findMany({
          where: { workspaceId },
          select: {
            payload: true,
            lastErrorCode: true,
            safeLastErrorSummary: true,
          },
        }),
        prisma.memoryUsageEvent.findMany({ where: { workspaceId } }),
        prisma.auditEvent.findMany({ where: { workspaceId } }),
      ]);
      const metadata = JSON.stringify({ receipts, outbox, usage, audit });
      for (const sentinel of [
        body,
        sourceExcerpt,
        fixture.config.apiKey,
        authorization,
      ]) {
        expect(metadata).not.toContain(sentinel);
      }
      const requests = fixture.requests
        .map((request) => request.rawBody)
        .join("\n");
      expect(requests).not.toContain(sourceExcerpt);
      expect(requests).not.toContain(authorization);
      expect(requests).not.toContain(fixture.config.apiKey);
    }

    it("requires authentication and confirmation, falls back before backfill, then serves canonical records through the SDK", async () => {
      const unauthorized = await app!.inject({
        method: "GET",
        url: "/api/action/v1/memory",
      });
      expect(unauthorized.statusCode).toBe(401);
      const body = "Prefer migration tests before schema changes.";
      const suggestionId = await propose(body);
      expect((await bundle()).items).toEqual([]);
      expect(await prisma.memoryItem.count({ where: { workspaceId } })).toBe(0);
      expect(fixture.documents.size).toBe(0);

      const confirmed = await command({
        kind: "confirm_suggestion",
        suggestionId,
      });
      expect(confirmed.status).toBe("created");
      const itemId = confirmed.id;
      // Recreate a deployment's already-indexed canonical rows with no Infinity
      // receipts, using the real existing Prisma writer and durable outbox.
      const prismaRuntime = await createMemorySearchRuntime({
        prisma,
        env: {},
      });
      expect(await processBatch(prismaRuntime.searchIndex)).toMatchObject({
        retried: 0,
        deadLettered: 0,
      });
      const oldCanonical = await prisma.memoryItem.findUniqueOrThrow({
        where: { id: itemId },
      });
      expect(oldCanonical.indexState).toBe("indexed");
      expect(
        await prisma.memoryProjectionReceipt.count({ where: { workspaceId } }),
      ).toBe(0);
      expect(await bundle()).toMatchObject({
        degraded: true,
        reason: "memory_search_index_unavailable",
        items: [{ id: itemId, body }],
      });

      expect(await runtime.backfill({ limit: 1 })).toEqual({
        scanned: 1,
        enqueued: 1,
        nextCursor: null,
        deadLetterEventIds: [],
      });
      expect(await runtime.backfill({ limit: 1 })).toEqual({
        scanned: 1,
        enqueued: 0,
        nextCursor: null,
        deadLetterEventIds: [],
      });
      const backfillEvent = await prisma.outboxEvent.findFirstOrThrow({
        where: {
          workspaceId,
          idempotencyKey: { startsWith: "memory.embedding.backfill:" },
        },
      });
      expect(backfillEvent.payload).toEqual({
        bodyVersion: oldCanonical.bodyVersion,
        bodyHash: oldCanonical.bodyHash,
        targetIndexIdentity: runtime.searchIndex.indexIdentity,
      });
      await prisma.outboxEvent.update({
        where: { id: backfillEvent.id },
        data: { status: "dead_letter", deadLetteredAt: clock.now() },
      });
      expect(await runtime.backfill({ limit: 1 })).toEqual({
        scanned: 1,
        enqueued: 0,
        nextCursor: null,
        deadLetterEventIds: [backfillEvent.id],
      });
      const blocked = await runBackfillOperator(fixture, databaseUrl!);
      expect(blocked.exitCode).toBe(2);
      expect(JSON.parse(blocked.stdout)).toMatchObject({
        command: "backfill",
        enqueued: 0,
        deadLetterEventIds: [backfillEvent.id],
        deadLetterCount: 1,
        code: "memory_projection_backfill_blocked",
      });
      expect(blocked.stderr).toBe("");
      expect(
        await prisma.outboxEvent.findUniqueOrThrow({
          where: { id: backfillEvent.id },
        }),
      ).toMatchObject({ status: "dead_letter" });
      expect(
        await retryDeadLetterOutboxEvent(
          { workspaceId, eventId: backfillEvent.id },
          { outbox: new PrismaOutboxEventRepository(prisma), clock },
        ),
      ).toEqual({ status: "queued" });
      expect(await processBatch()).toMatchObject({
        processed: 1,
        retried: 0,
        deadLettered: 0,
      });
      expect(await bundle()).toMatchObject({
        degraded: false,
        reason: null,
        items: [{ id: itemId, body }],
      });
      const receipt = await prisma.memoryProjectionReceipt.findFirstOrThrow({
        where: { memoryItemId: itemId },
      });
      expect(receipt).toMatchObject({
        state: "indexed",
        bodyVersion: 1,
        bodyHash: oldCanonical.bodyHash,
      });
      const ingest = fixture.requests.find(
        (request) =>
          request.method === "POST" && request.path === "/v1/documents",
      );
      expect(ingest?.body.text).toBe(body);
      expect(ingest?.body.retrieval_projection).toMatchObject({
        tags: [],
        actor_keys: [],
      });

      const beforeUnsafe = fixture.requests.length;
      expect(
        (await bundle("diff --git a/private-sentinel b/private-sentinel"))
          .items,
      ).toHaveLength(1);
      expect(fixture.requests).toHaveLength(beforeUnsafe);
      await assertPrivateMetadata(body);
    }, 20_000);

    it("pages backfill by stable canonical ID and excludes expired or unconfirmed records", async () => {
      const active = [
        await confirm("Prefer migration smoke tests before changes."),
        await confirm("Prefer migration upgrade checks before changes."),
      ].sort();
      const expired = await confirm(
        "Prefer migration rehearsals before changes.",
      );
      await prisma.memoryItem.update({
        where: { id: expired },
        data: { expiresAt: new Date(0) },
      });
      await propose("Prefer migration examples in the documentation.");
      expect(await runtime.backfill({ limit: 1 })).toEqual({
        scanned: 1,
        enqueued: 1,
        nextCursor: active[0],
        deadLetterEventIds: [],
      });
      expect(await runtime.backfill({ limit: 1, afterId: active[0]! })).toEqual(
        {
          scanned: 1,
          enqueued: 1,
          nextCursor: null,
          deadLetterEventIds: [],
        },
      );
      const events = await prisma.outboxEvent.findMany({
        where: {
          workspaceId,
          idempotencyKey: { startsWith: "memory.embedding.backfill:" },
        },
        select: { aggregateId: true, payload: true },
      });
      expect(events.map((event) => event.aggregateId).sort()).toEqual(active);
      expect(fixture.documents.size).toBe(0);
      await expect(runtime.backfill({ limit: 501 })).rejects.toThrow(
        "memory_projection_backfill_invalid",
      );
    });

    it("cleans the exact old revision when an edit wins during ingest, then indexes the new canonical version", async () => {
      const oldBody = "Prefer migration rollback checks before changes.";
      const nextBody = "Prefer migration compatibility checks before changes.";
      const itemId = await confirm(oldBody);
      fixture.beforeIngest = async () => {
        fixture.beforeIngest = undefined;
        expect(
          await editMemoryItem(
            { workspaceId, itemId, body: nextBody, actor },
            memory,
          ),
        ).toMatchObject({ status: "updated", id: itemId });
      };
      expect(await processBatch()).toMatchObject({
        retried: 0,
        deadLettered: 0,
      });
      expect([...fixture.documents.values()]).toEqual([
        expect.objectContaining({ status: "deleted" }),
      ]);
      expect(await processBatch()).toMatchObject({
        retried: 0,
        deadLettered: 0,
      });
      const current = await prisma.memoryItem.findUniqueOrThrow({
        where: { id: itemId },
      });
      expect(current).toMatchObject({
        body: nextBody,
        bodyVersion: 2,
        indexVersion: 2,
        indexState: "indexed",
      });
      const receipts = await prisma.memoryProjectionReceipt.findMany({
        where: { memoryItemId: itemId },
        orderBy: { bodyVersion: "asc" },
      });
      expect(receipts).toEqual([
        expect.objectContaining({ bodyVersion: 1, state: "deleted" }),
        expect.objectContaining({ bodyVersion: 2, state: "indexed" }),
      ]);
      expect(await bundle()).toMatchObject({
        degraded: false,
        items: [{ id: itemId, body: nextBody }],
      });
      await assertPrivateMetadata(oldBody);
      await assertPrivateMetadata(nextBody);
    });

    it("preserves an unknown write across restart and deletes it after an authenticated forget", async () => {
      const body = "Prefer migration dry runs before release.";
      const itemId = await confirm(body);
      fixture.dropNextIngestAcknowledgement = true;
      expect(await processBatch()).toMatchObject({
        retried: 1,
        deadLettered: 0,
      });
      expect(
        await prisma.memoryProjectionReceipt.findFirstOrThrow({
          where: { memoryItemId: itemId },
        }),
      ).toMatchObject({
        state: "sent_unknown",
        remoteDocumentId: null,
      });
      expect([...fixture.documents.values()]).toEqual([
        expect.objectContaining({ status: "active" }),
      ]);
      expect(
        await command({ kind: "forget_memory", memoryItemId: itemId }),
      ).toMatchObject({
        status: "updated",
        id: itemId,
      });
      await app!.close();
      app = undefined;
      runtime = await createMemorySearchRuntime({
        prisma,
        env: fixtureEnvironment(fixture),
      });
      await startApi();
      expect(await processBatch()).toMatchObject({
        retried: 0,
        deadLettered: 0,
      });
      expect(
        await prisma.memoryProjectionReceipt.findFirstOrThrow({
          where: { memoryItemId: itemId },
        }),
      ).toMatchObject({
        state: "deleted",
        deleteRequested: true,
        remoteDocumentId: expect.any(String),
      });
      expect([...fixture.documents.values()]).toEqual([
        expect.objectContaining({ status: "deleted" }),
      ]);
      expect(
        fixture.requests.filter(
          (request) =>
            request.method === "POST" && request.path === "/v1/documents",
        ),
      ).toHaveLength(1);
      expect((await bundle()).items).toEqual([]);
      await assertPrivateMetadata(body);
      expect(await runtime.drain()).toMatchObject({ pending: 0 });
      await expect(
        createMemorySearchRuntime({
          prisma,
          env: fixtureEnvironment(fixture),
        }),
      ).rejects.toThrow("memory_index_generation_retired");
    });
  });

function runBackfillOperator(
  fixture: InfinityProtocolFixture,
  databaseUrl: string,
): Promise<{
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [
        "--import",
        "tsx",
        fileURLToPath(
          new URL(
            "../../worker/src/memory-projection-operator.ts",
            import.meta.url,
          ),
        ),
        "backfill",
        "--limit",
        "1",
      ],
      {
        env: {
          ...process.env,
          ...fixtureEnvironment(fixture),
          DATABASE_URL: databaseUrl,
        },
        timeout: 15_000,
        maxBuffer: 16_384,
      },
      (error, stdout, stderr) => {
        const exitCode = error?.code;
        if (error && typeof exitCode !== "number") {
          reject(error);
          return;
        }
        resolve({
          exitCode: typeof exitCode === "number" ? exitCode : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function fixtureEnvironment(
  fixture: InfinityProtocolFixture,
): Record<string, string> {
  const config = fixture.config;
  return {
    REVIEW_ROUTER_MEMORY_SEARCH_ENGINE: "infinity",
    REVIEW_ROUTER_MEMORY_INFINITY_BASE_URL: config.baseUrl,
    REVIEW_ROUTER_MEMORY_INFINITY_API_KEY: config.apiKey,
    REVIEW_ROUTER_MEMORY_INFINITY_SPACE_ID: config.spaceId,
    REVIEW_ROUTER_MEMORY_INFINITY_MEMORY_SCOPE_ID: config.memoryScopeId,
    REVIEW_ROUTER_MEMORY_INFINITY_PROJECTION_GENERATION:
      config.projectionGeneration,
    REVIEW_ROUTER_MEMORY_INFINITY_PROFILE_ID: config.profileId,
    REVIEW_ROUTER_MEMORY_INFINITY_CAPABILITY_FINGERPRINT:
      config.capabilityFingerprint,
    REVIEW_ROUTER_MEMORY_INFINITY_REQUIRED_PROVIDER_LANES:
      config.requiredProviderLanes.join(","),
  };
}

function isolatedDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const url = new URL(raw);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== "/reviewrouter_memory_api_test" ||
    url.searchParams.has("host")
  ) {
    throw new Error("memory_api_e2e_requires_dedicated_loopback_database");
  }
  return url.toString();
}
