import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GatewayError } from "@agent-teams/account-gateway/http";
import type {
  ConsumerControlPort,
  ExecutionConnector,
} from "@agent-teams/account-gateway/llm";
import {
  conversationDigest,
  renderConversation,
  type ConversationSnapshot,
} from "@reviewrouter/features-conversations";
import { PrismaMemoryAutomaticSourceStore } from "@reviewrouter/features-memory/infrastructure";
import {
  createMemoryKnowledgeRuntime,
  type MemoryKnowledgeRuntime,
} from "@reviewrouter/features-memory/composition";
import {
  PrismaWorkspaceMemorySettings,
  PrismaReviewConfigurationRepository,
  PrismaReviewConfigurationTransactionRepository,
  PrismaReviewPolicyHeadReader,
  saveWorkspaceMemorySettings,
} from "@reviewrouter/features-review-config";
import { candidateWorkspaceMemorySettings } from "../../../scripts/conversation-evals/fixture.js";
import {
  PrismaEntitlementRepository,
  freeBetaEntitlement,
} from "@reviewrouter/features-entitlements";
import type { ConversationCapturedPolicy } from "./action-conversation-policy.js";
import {
  conversationMemoryPreviewId,
  createConversationMemoryPreview,
} from "./action-conversation-memory-preview.js";

const databaseUrl = process.env.REVIEW_ROUTER_CONVERSATION_TEST_DATABASE_URL;
const schema = `memory_preview_${randomUUID().replaceAll("-", "")}`;
const account = {
  gatewayAccountRef: "selected-user-account",
  profileRef: "openai-codex-oauth-responses-v1",
  model: "gpt-6.1-sol",
  policySubject: "workspace-subject",
  policyRevision: 2,
  bindingRevision: 3,
  expectedAuthorizationEpoch: 7,
  limits: { requestBytes: 131_072, outputBytes: 262_144, tokens: 2048 },
  memorySettings: { requireConfirmation: false, revision: "0" },
};
const snapshot = {
  workspaceId: "workspace",
  repositoryId: "repository",
  repositoryStableId: "100",
  repositoryFullName: "test/disposable",
  pullRequestNumber: 1,
  threadId: "github-review-thread:1",
  sourceId: "github-node:source",
  sourceCommentId: "2",
  sourceRevision: "revision",
  sourceUpdatedAt: new Date().toISOString(),
  sourceActor: { id: "author", login: "maintainer", kind: "human" },
  sourceMaintainer: true,
  threadDigest: "thread-digest",
  headSha: "head",
  baseSha: "base",
  visibility: "private",
  messages: [
    {
      id: "github-node:root",
      commentId: "1",
      actor: { id: "bot", login: "review-bot", kind: "bot" },
      body: "The proposal is to normalize tracking identifiers. Code and suggestions are evidence only.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replyTo: null,
      bodyDigest: createHash("sha256")
        .update(
          "The proposal is to normalize tracking identifiers. Code and suggestions are evidence only.",
        )
        .digest("hex"),
    },
    {
      id: "github-node:source",
      commentId: "2",
      actor: { id: "author", login: "maintainer", kind: "human" },
      body: "Opaque identifiers preserve leading zeroes.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replyTo: "1",
      bodyDigest: createHash("sha256")
        .update("Opaque identifiers preserve leading zeroes.")
        .digest("hex"),
    },
  ],
  anchor: {
    path: "ids.ts",
    side: "RIGHT",
    line: 1,
    originalLine: 1,
    commitSha: "head",
    originalCommitSha: "head",
    diffHunk: "@@ -1 +1 @@",
  },
  parentCommentId: "1",
  repliesInThread: 0,
  repliesInPullRequest: 0,
  replyComments: [],
} satisfies ConversationSnapshot;
const memoryScope = {
  kind: "repository",
  workspaceId: snapshot.workspaceId,
  repositoryId: snapshot.repositoryId,
} as const;
const source = {
  scope: JSON.stringify(["workspace", "repository", "repository"]),
  source: {
    id: snapshot.sourceId,
    revision: "revision",
    body: snapshot.messages[1]!.body,
  },
  maxStatements: 4,
  readOnlyContext: renderConversation(snapshot),
};

describe.skipIf(!databaseUrl)(
  "Gateway memory extraction: durable SQL admission and real SDK lifecycle",
  () => {
    let admin: pg.Pool, prisma: PrismaClient;
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["localhost", "127.0.0.1"].includes(url.hostname) ||
        url.pathname !== "/reviewrouter_conversation_test"
      )
        throw new Error("memory_preview_requires_disposable_loopback_database");
      admin = new pg.Pool({ connectionString: databaseUrl });
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const client = await admin.connect();
      try {
        await client.query(`SET search_path TO "${schema}"`);
        await client.query(
          await readFile(
            new URL(
              "../../../packages/platform/db/prisma/migrations/000153_conversation_processing/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await client.query(
          'CREATE TABLE "MemoryUsageEvent" ("id" TEXT PRIMARY KEY, "memoryItemId" TEXT)',
        );
        for (const migration of [
          "000142_memory_knowledge_authority",
          "000143_memory_maintenance_fence",
          "000152_memory_automatic_source",
        ])
          await client.query(
            await readFile(
              new URL(
                `../../../packages/platform/db/prisma/migrations/${migration}/migration.sql`,
                import.meta.url,
              ),
              "utf8",
            ),
          );
        await client.query(
          'CREATE TABLE "PreviewAuthority" ("id" INTEGER PRIMARY KEY, "source" BOOLEAN, "account" BOOLEAN, "settings" BOOLEAN)',
        );
        // Real policy heads, membership and ordinary settings writer, isolated to this schema.
        await client.query(`
          CREATE TABLE "Workspace" ("id" TEXT PRIMARY KEY,"personalOwnerUserId" TEXT,"providerManagementAdminOnly" BOOLEAN NOT NULL DEFAULT false,"deletionState" TEXT NOT NULL DEFAULT 'active');
          CREATE TABLE "WorkspaceMember" ("workspaceId" TEXT,"userId" TEXT,"role" TEXT,PRIMARY KEY("workspaceId","userId"));
          CREATE TABLE "ReviewConfiguration" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"repositoryId" TEXT,"targetKey" TEXT NOT NULL,"active" BOOLEAN NOT NULL DEFAULT true,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("workspaceId","targetKey"));
          CREATE TABLE "ReviewConfigurationVersion" ("id" TEXT PRIMARY KEY,"configurationId" TEXT NOT NULL,"workspaceId" TEXT NOT NULL,"version" INTEGER NOT NULL,"schemaVersion" INTEGER NOT NULL DEFAULT 1,"policyJson" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE("configurationId","version"));
          ALTER TABLE "ReviewConfigurationVersion"
            ADD COLUMN "operationId" TEXT, ADD COLUMN "operationIntentHash" TEXT, ADD COLUMN "operationSnapshotJson" TEXT,
            ADD COLUMN "gatewayBindingId" TEXT, ADD COLUMN "gatewayProfileRef" TEXT,
            ADD COLUMN "agenticContext" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "fastMode" BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN "providerLimit" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "providerMaxParallel" INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN "inlineMinAgreement" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "reviewLanguage" TEXT,
            ADD COLUMN "investigationRecordingEnabled" BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN "investigationShadowEnabled" BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN "investigationContextCriticEnabled" BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN "investigationVerifiedCleanEnabled" BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN "investigationCrossRevisionReplayEnabled" BOOLEAN NOT NULL DEFAULT false,
            ADD COLUMN "investigationProductionEffectsEnabled" BOOLEAN NOT NULL DEFAULT false;
          CREATE TABLE "AuditEvent" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL,"actor" TEXT NOT NULL,"action" TEXT NOT NULL,"targetType" TEXT NOT NULL,"targetId" TEXT NOT NULL,"metadata" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE "WorkspaceEntitlement" ("id" TEXT PRIMARY KEY,"workspaceId" TEXT NOT NULL UNIQUE,"plan" TEXT NOT NULL DEFAULT 'free_beta',"status" TEXT NOT NULL DEFAULT 'active',"limits" JSONB NOT NULL,"flags" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
          CREATE TYPE "OutboxEventStatus" AS ENUM ('pending','processing','retry_wait','processed','dead_letter');
          CREATE TABLE "OutboxEvent" ("id" TEXT PRIMARY KEY,"type" TEXT NOT NULL,"version" INT NOT NULL,"idempotencyKey" TEXT NOT NULL UNIQUE,"workspaceId" TEXT,"repositoryId" TEXT,"aggregateId" TEXT,"payload" JSONB NOT NULL,"status" "OutboxEventStatus" NOT NULL DEFAULT 'pending',"attempts" INT NOT NULL DEFAULT 0,"maxAttempts" INT NOT NULL DEFAULT 5,"nextAttemptAt" TIMESTAMP(3),"claimId" TEXT,"claimVersion" BIGINT,"claimOwnerHash" TEXT,"claimUntil" TIMESTAMP(3),"processedAt" TIMESTAMP(3),"deadLetteredAt" TIMESTAMP(3),"lastErrorCode" TEXT,"safeLastErrorSummary" TEXT,"occurredAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
        `);
      } finally {
        client.release();
      }
      prisma = new PrismaClient({
        adapter: new PrismaPg(
          {
            connectionString: databaseUrl!,
            options: `-c search_path=${schema} -c timezone=UTC`,
            max: 4,
          },
          { schema },
        ),
      });
    });
    beforeEach(async () => {
      await prisma.conversationProcessing.deleteMany();
      await prisma.$executeRaw`DELETE FROM "MemoryAutomaticEntry"`;
      await prisma.$executeRaw`DELETE FROM "MemoryAutomaticSource"`;
      await prisma.$executeRaw`DELETE FROM "MemoryKnowledgeScopeState"`;
      await prisma.$executeRaw`DELETE FROM "MemoryKnowledgeMaintenanceFence"`;
      await prisma.$executeRaw`DELETE FROM "MemoryKnowledgeSourceCursor"`;
      await prisma.$executeRaw`DELETE FROM "PreviewAuthority"`;
      await prisma.$executeRaw`INSERT INTO "PreviewAuthority" VALUES (1, true, true, true)`;
      await prisma.$executeRawUnsafe(
        'TRUNCATE "Workspace","WorkspaceMember","ReviewConfigurationVersion","ReviewConfiguration","AuditEvent","WorkspaceEntitlement","MemoryKnowledgeCommand","MemoryKnowledgeEntry","OutboxEvent"',
      );
    });
    afterAll(async () => {
      await prisma?.$disconnect();
      if (admin) {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      }
    });

    async function fixture(
      afterPrepare?: () => Promise<void>,
      ambiguous = false,
      seedSource = true,
    ) {
      const deadlineAt = new Date(Date.now() + 60_000);
      const parentId = randomUUID();
      if (seedSource)
        await new PrismaMemoryAutomaticSourceStore(prisma).reserve({
          input: {
            processingId: "prior-processing",
            scope: memoryScope,
            source: {
              type: "github_comment",
              sourceId: snapshot.sourceId,
              revision: snapshot.sourceRevision,
              updatedAt: snapshot.sourceUpdatedAt,
              statementAt: snapshot.sourceUpdatedAt,
              repositoryId: snapshot.repositoryId,
              pullRequestNumber: snapshot.pullRequestNumber,
              url: null,
              visibility: "private",
              claimedBodyDigest: createHash("sha256")
                .update(source.source.body)
                .digest("hex"),
              observedCommitSha: snapshot.headSha,
            },
            sourceActor: {
              kind: "github_user",
              id: "author",
              githubUserId: "11",
              login: "maintainer",
            },
            policyRevision: "1:1:qualification",
            threadId: snapshot.threadId,
            threadDigest: snapshot.threadDigest,
            headSha: snapshot.headSha,
            selectableBody: source.source.body,
          },
          generation: "test_generation",
          expectedPriorEpoch: null,
          entryIds: [],
          bodyDigests: [],
          now: new Date(),
        });
      const captured: ConversationCapturedPolicy = {
        policy: {
          revision: "1:1:qualification",
          automaticLearning: true,
          requireConfirmation: false,
          discussionReplies: true,
          contextWindowTokens: 131_072,
          tokensPerByteUpperBound: 4,
          maxInputBytes: 131_072,
          bindingManifest: account,
          inference: {
            generate: async () => {
              throw new Error("conversation inference untouched");
            },
          },
          isCurrent: async () =>
            (
              await prisma.$queryRaw<
                { account: boolean }[]
              >`SELECT ("account" AND "settings") AS "account" FROM "PreviewAuthority" WHERE "id"=1`
            )[0]!.account,
        },
        checkSelection: async (transaction) =>
          (
            await transaction.$queryRaw<
              { account: boolean }[]
            >`SELECT ("account" AND "settings") AS "account" FROM "PreviewAuthority" WHERE "id"=1 FOR SHARE`
          )[0]!.account,
      };
      await prisma.conversationProcessing.create({
        data: {
          id: parentId,
          workspaceId: snapshot.workspaceId,
          repositoryId: snapshot.repositoryId,
          repositoryStableId: snapshot.repositoryStableId,
          repositoryFullName: snapshot.repositoryFullName,
          pullRequestNumber: 1,
          threadId: snapshot.threadId,
          sourceId: snapshot.sourceId,
          sourceCommentId: snapshot.sourceCommentId,
          sourceRevision: snapshot.sourceRevision,
          sourceUpdatedAt: new Date(snapshot.sourceUpdatedAt),
          sourceActorId: "author",
          sourceActorLogin: "maintainer",
          sourceActorKind: "human",
          deadlineAt,
          modelDispatched: true,
          boundManifest: JSON.stringify({
            account,
            threadDigest: snapshot.threadDigest,
            headSha: snapshot.headSha,
            baseSha: snapshot.baseSha,
            sourceRevision: snapshot.sourceRevision,
            policyRevision: captured.policy.revision,
            vector: snapshot.messages.map(
              ({ id, updatedAt, bodyDigest, replyTo }) => [
                id,
                updatedAt,
                bodyDigest,
                replyTo,
              ],
            ),
            sourceAuthority: {
              actorId: snapshot.sourceActor.id,
              maintainer: snapshot.sourceMaintainer,
              visibility: snapshot.visibility,
            },
          }),
          result: {
            processingId: parentId,
            status: "processing",
            learning: { status: "pending", effectIds: [] },
          },
        },
      });
      const prepares: Parameters<ConsumerControlPort["runAccess"]>[0][] = [];
      const requests: unknown[] = [];
      let closes = 0;
      const control: ConsumerControlPort = {
        async runAccess(intent) {
          prepares.push(intent);
          await afterPrepare?.();
          if (ambiguous) throw new GatewayError("transport", "effect_unknown");
          return {
            operation: {
              operationRef: intent.operationId,
              state: "applied",
              result: {
                kind: "execution",
                executionRef: "execution",
                accountRef: intent.accountRefs[0]!,
                authorizationEpoch: 7,
                deadline: intent.deadline,
                state: "active",
              },
            },
            bearer: "test-execution-bearer",
            admission: {
              invocationRef: intent.invocationRef,
              attemptRef: intent.attemptRef,
              accountRef: intent.accountRefs[0]!,
              authorizationEpoch: 7,
              subjectRef: intent.subjectRef,
              policyRevision: intent.policyRevision,
              bindingRevision: intent.bindingRevision,
              profileId: intent.profileId,
              limits: intent.limits,
              expiresAt: intent.deadline,
            },
          };
        },
      };
      const connectExecution: ExecutionConnector = () => ({
        async request(_execution, request) {
          requests.push(JSON.parse(new TextDecoder().decode(request.body)));
          const completed = {
            type: "response.completed",
            response: {
              id: "response",
              model: account.model,
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        statements: [
                          {
                            body: "Opaque identifiers preserve leading zeroes.",
                          },
                        ],
                      }),
                    },
                  ],
                },
              ],
              usage: { input_tokens: 40, output_tokens: 10 },
            },
          };
          return {
            kind: "stream",
            requestRef: request.requestId,
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify(completed)}\n\n`,
                  ),
                );
                controller.close();
              },
            }),
            cancel: async () => {},
          };
        },
        status: async () => {
          throw new GatewayError("transport", "effect_unknown");
        },
        async close(_execution, value) {
          closes++;
          return { operationRef: value.operationId, state: "applied" };
        },
      });
      const create = () =>
        createConversationMemoryPreview({
          prisma,
          parentId,
          snapshot,
          captured,
          control,
          connectExecution,
          isSourceCurrent: async () =>
            (
              await prisma.$queryRaw<
                { source: boolean }[]
              >`SELECT "source" FROM "PreviewAuthority" WHERE "id"=1`
            )[0]!.source,
        });
      const preview = (
        projection = source,
        deadlineAt = new Date(Date.now() + 30_000),
      ) => create().preview(projection, { deadlineAt });
      return {
        preview,
        prepares,
        requests,
        parentId,
        captured,
        closes: () => closes,
      };
    }

    async function candidateRuntime(afterPolicyRead?: () => Promise<void>) {
      const f = await fixture(undefined, false, false);
      const templateWorkspaceId = "selected-template";
      const owner = {
        userId: "settings-owner",
        auditActor: "user:settings-owner",
      };
      for (const workspaceId of [templateWorkspaceId, snapshot.workspaceId]) {
        await prisma.$executeRaw`INSERT INTO "Workspace" ("id") VALUES (${workspaceId})`;
        await prisma.$executeRaw`INSERT INTO "WorkspaceMember" VALUES (${workspaceId},${owner.userId},'owner')`;
      }
      const settings = new PrismaWorkspaceMemorySettings(prisma);
      let captured: ConversationCapturedPolicy | undefined = {
        ...f.captured,
        policy: {
          ...f.captured.policy,
          bindingManifest: {
            ...f.captured.policy.bindingManifest,
            memorySettings: {
              requireConfirmation: false,
              revision: "0",
              templateRevision: "0",
            },
          },
        },
      };
      const runtime: MemoryKnowledgeRuntime =
        await createMemoryKnowledgeRuntime({
          prisma,
          env: {
            REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://127.0.0.1:1",
            REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY: "synthetic-no-native-io",
            REVIEW_ROUTER_MEMORY_NAMESPACE: "eval_candidate_settings",
            REVIEW_ROUTER_MEMORY_GENERATION: "test_generation",
            REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: "hindsight-v1.1.0-chunks-v1",
          },
          workspaceSettings: candidateWorkspaceMemorySettings({
            settings,
            templateWorkspaceId,
            disposableWorkspaceId: snapshot.workspaceId,
            captured: () => captured,
            readPolicy: async (identity) => {
              const policy = await runtime.policy.getPolicy(identity);
              await afterPolicyRead?.();
              return policy;
            },
          }),
        });
      const write = async (
        workspaceId: string,
        requireConfirmation: boolean,
        tx?: Prisma.TransactionClient,
      ) =>
        saveWorkspaceMemorySettings(
          {
            workspaceId,
            actor: owner,
            requireConfirmation,
            expectedVersion: (await settings.read(workspaceId)).version,
          },
          {
            configurations: tx
              ? new PrismaReviewConfigurationTransactionRepository(
                  tx,
                  undefined,
                  false,
                  owner.userId,
                )
              : new PrismaReviewConfigurationRepository(
                  prisma,
                  undefined,
                  false,
                  owner.userId,
                ),
            policyHeads: new PrismaReviewPolicyHeadReader(tx ?? prisma),
          },
        );
      const headSha = "a".repeat(40);
      const reservation: Parameters<
        typeof runtime.automaticSources.reserve
      >[0] = {
        input: {
          processingId: randomUUID(),
          scope: memoryScope,
          source: {
            type: "github_comment",
            sourceId: snapshot.sourceId,
            revision: snapshot.sourceRevision,
            repositoryId: snapshot.repositoryId,
            pullRequestNumber: 1,
            updatedAt: snapshot.sourceUpdatedAt,
            statementAt: snapshot.sourceUpdatedAt,
            visibility: "private",
            url: null,
            observedCommitSha: headSha,
            claimedBodyDigest: snapshot.messages[1]!.bodyDigest,
          },
          sourceActor: {
            kind: "github_user",
            id: "author",
            githubUserId: "11",
            login: "maintainer",
          },
          policyRevision: "1:1:candidate",
          threadId: snapshot.threadId,
          threadDigest: snapshot.threadDigest,
          headSha,
          selectableBody: source.source.body,
          requireConfirmation: false,
          settingsRevision: "0",
        },
        generation: runtime.generation,
        expectedPriorEpoch: null,
        entryIds: [],
        bodyDigests: [],
        now: new Date(),
      };
      return {
        runtime,
        reservation,
        write,
        settings,
        templateWorkspaceId,
        clearCapture: () => {
          captured = undefined;
        },
      };
    }

    it("admits an actual observation command under unchanged template and disposable settings without native delivery", async () => {
      const f = await candidateRuntime();
      const learning = f.runtime.forAutomaticLearning(
        {
          authorize: async () => {},
          sourceApplicable: async () => true,
          verifySource: async ({ source: checked }) => checked,
        },
        { current: async () => true },
        {
          preview: async () => ({
            status: "complete",
            source: {
              id: snapshot.sourceId,
              revision: snapshot.sourceRevision,
            },
            statements: [{ body: source.source.body }],
          }),
        },
      );
      const result = await learning.learn(f.reservation.input, {
        deadlineAt: new Date(Date.now() + 15_000),
      });
      expect(result.state).toBe("queued");
      expect(result.operations).toHaveLength(1);
      expect(await prisma.memoryKnowledgeCommand.count()).toBe(1);
    });

    it("rejects an unconfirmed command when the normal template writer changes settings after preview and mutation preflight", async () => {
      const f = await candidateRuntime();
      let previews = 0,
        verified = 0;
      const learning = f.runtime.forAutomaticLearning(
        {
          authorize: async () => {},
          sourceApplicable: async () => true,
          verifySource: async ({ source: checked }) => {
            verified++;
            // This is after the service's policy preflight and before its owning SQL transaction.
            expect(previews).toBe(1);
            await f.write(f.templateWorkspaceId, true);
            return checked;
          },
        },
        { current: async () => true },
        {
          preview: async () => {
            previews++;
            return {
              status: "complete",
              source: {
                id: snapshot.sourceId,
                revision: snapshot.sourceRevision,
              },
              statements: [{ body: source.source.body }],
            };
          },
        },
      );
      await expect(
        learning.learn(f.reservation.input, {
          deadlineAt: new Date(Date.now() + 15_000),
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(verified).toBe(1);
      expect(await f.settings.read(f.templateWorkspaceId)).toEqual({
        requireConfirmation: true,
        version: 1,
      });
      expect(await prisma.memoryKnowledgeCommand.count()).toBe(0);
      expect(
        await f.runtime.automaticSources.lookup(memoryScope, snapshot.sourceId),
      ).toBeNull();
    });

    it.each(["selected-template", snapshot.workspaceId])(
      "holds the normal settings writer for %s behind the actual runtime mutation transaction",
      async (workspaceId) => {
        let entered!: () => void, release!: () => void;
        const held = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const proceed = new Promise<void>((resolve) => {
          release = resolve;
        });
        let hold = true;
        const f = await candidateRuntime(async () => {
          if (hold) {
            hold = false;
            entered();
            await proceed;
          }
        });
        const mutation = f.runtime.automaticSources.reserve(f.reservation);
        await held;
        let started!: (pid: number) => void;
        const writerStarted = new Promise<number>((resolve) => {
          started = resolve;
        });
        const writer = prisma.$transaction(async (tx) => {
          const [row] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          started(row!.pid);
          return f.write(workspaceId, true, tx);
        });
        try {
          const pid = await writerStarted;
          let blocked = false;
          for (let attempt = 0; attempt < 100; attempt++) {
            const result = await admin.query<{ blocked: boolean }>(
              "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
              [pid],
            );
            if (result.rows[0]!.blocked) {
              blocked = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(blocked).toBe(true);
        } finally {
          release();
        }
        expect((await mutation).state).toBe("active");
        await writer;
        expect((await f.settings.read(workspaceId)).requireConfirmation).toBe(
          true,
        );
      },
    );

    it("rejects a template revision roundtrip at the runtime mutation boundary", async () => {
      const f = await candidateRuntime();
      await f.write(f.templateWorkspaceId, true);
      await f.write(f.templateWorkspaceId, false);
      await expect(
        f.runtime.automaticSources.reserve(f.reservation),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(
        await f.runtime.automaticSources.lookup(memoryScope, snapshot.sourceId),
      ).toBeNull();
    });

    it("requires a frozen candidate capture at the runtime mutation boundary", async () => {
      const f = await candidateRuntime();
      f.clearCapture();
      await expect(
        f.runtime.automaticSources.reserve(f.reservation),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it.each(["selected-template", snapshot.workspaceId])(
      "rechecks current memory enablement for %s under the mutation guards",
      async (workspaceId) => {
        const f = await candidateRuntime();
        const entitlement = freeBetaEntitlement(workspaceId);
        await new PrismaEntitlementRepository(
          prisma,
        ).upsertWorkspaceEntitlement({
          ...entitlement,
          flags: { ...entitlement.flags, balanced_memory: false },
        });
        await expect(
          f.runtime.automaticSources.reserve(f.reservation),
        ).rejects.toMatchObject({ code: "disabled" });
        expect(
          await f.runtime.automaticSources.lookup(
            memoryScope,
            snapshot.sourceId,
          ),
        ).toBeNull();
      },
    );

    it("routes the selected user account and policy, and concurrent/restarted replay buys no second call", async () => {
      const f = await fixture();
      const deadlineAt = new Date(Date.now() + 30_000);
      const results = await Promise.all([
        f.preview(source, deadlineAt),
        f.preview(source, deadlineAt),
      ]);
      expect(results.filter((r) => r.status === "complete")).toHaveLength(1);
      expect(f.prepares).toHaveLength(1);
      expect(f.prepares[0]).toMatchObject({
        accountRefs: [account.gatewayAccountRef],
        subjectRef: account.policySubject,
        policyRevision: 2,
        bindingRevision: 3,
        profileId: account.profileRef,
        // An admitted extraction receives the remaining original budget, not a
        // shorter subdeadline that can interrupt an otherwise valid response.
        deadline: deadlineAt.toISOString(),
      });
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0]).toMatchObject({
        model: account.model,
        store: false,
        service_tier: "default",
      });
      const task = f.requests[0] as {
        instructions: string;
        input: { content: { text: string }[] }[];
        text: { format: { schema: unknown } };
      };
      const text = task.input[0]!.content[0]!.text;
      const projection = JSON.parse(text);
      expect(projection.selectedSource).toEqual({
        ...source.source,
        actor: snapshot.sourceActor,
        authority: "verified_repository_maintainer",
      });
      expect(projection.checkedDiscussion).toEqual(
        JSON.parse(renderConversation(snapshot)),
      );
      expect(projection.checkedDiscussion.messages).toEqual(snapshot.messages);
      expect(projection.checkedDiscussion.selectedSourceId).toBe(
        snapshot.sourceId,
      );
      expect(projection.memorySettings).toEqual(account.memorySettings);
      expect(projection.contextEvidence.messages).toEqual(
        snapshot.messages.map(({ id, updatedAt, bodyDigest, replyTo }) => ({
          id,
          updatedAt,
          bodyDigest,
          replyTo,
        })),
      );
      expect(JSON.stringify(projection.contextEvidence)).not.toContain(
        source.source.body,
      );
      const row = await prisma.conversationProcessing.findUniqueOrThrow({
        where: { id: conversationMemoryPreviewId(f.parentId) },
      });
      expect(JSON.parse(row.boundManifest!).inputDigest).toBe(
        conversationDigest({
          instructions: task.instructions,
          input: text,
          outputSchema: task.text.format.schema,
        }),
      );
      expect(JSON.stringify(f.requests[0])).not.toContain(
        "conversation inference",
      );
      expect((await f.preview()).status).toBe("incomplete");
      expect(f.prepares).toHaveLength(1);
      expect(
        await prisma.conversationProcessing.count({
          where: { purpose: "memory-preview-v1", requestEffect: "completed" },
        }),
      ).toBe(1);
    });
    it("rejects a mismatched discussion projection before any paid admission", async () => {
      const f = await fixture();
      expect(
        (await f.preview({ ...source, readOnlyContext: "another thread" }))
          .status,
      ).toBe("incomplete");
      expect(f.prepares).toHaveLength(0);
      expect(f.requests).toHaveLength(0);
    });
    it.each(["bytes", "context"] as const)(
      "enforces the captured %s bound before preparing the full-thread task",
      async (kind) => {
        const f = await fixture();
        Object.assign(
          f.captured.policy,
          kind === "bytes"
            ? { maxInputBytes: 128 }
            : { contextWindowTokens: 64 },
        );
        expect((await f.preview()).status).toBe("incomplete");
        expect(f.prepares).toHaveLength(0);
        expect(f.requests).toHaveLength(0);
      },
    );
    it("confirmation settings changing while runAccess waits prevent paid dispatch", async () => {
      const f = await fixture(async () => {
        await prisma.$executeRaw`UPDATE "PreviewAuthority" SET "settings"=false WHERE "id"=1`;
      });
      expect((await f.preview()).status).toBe("incomplete");
      expect(f.prepares).toHaveLength(1);
      expect(f.requests).toHaveLength(0);
      expect(f.closes()).toBe(1);
    });
    it("changed parent thread evidence while runAccess waits cannot dispatch the frozen task", async () => {
      const f = await fixture(async () => {
        const parent = await prisma.conversationProcessing.findUniqueOrThrow({
          where: { id: f.parentId },
        });
        const frozen = JSON.parse(parent.boundManifest!);
        frozen.vector[0][2] = "0".repeat(64);
        await prisma.conversationProcessing.update({
          where: { id: f.parentId },
          data: { boundManifest: JSON.stringify(frozen) },
        });
      });
      expect((await f.preview()).status).toBe("incomplete");
      expect(f.prepares).toHaveLength(1);
      expect(f.requests).toHaveLength(0);
      expect(f.closes()).toBe(1);
    });
    it.each(["source", "account"] as const)(
      "revocation of %s while runAccess waits prevents paid inference and still closes grant",
      async (kind) => {
        const f = await fixture(async () => {
          if (kind === "source")
            await prisma.$executeRaw`UPDATE "PreviewAuthority" SET "source"=false WHERE "id"=1`;
          else
            await prisma.$executeRaw`UPDATE "PreviewAuthority" SET "account"=false WHERE "id"=1`;
        });
        expect((await f.preview()).status).toBe("incomplete");
        expect(f.prepares).toHaveLength(1);
        expect(f.requests).toHaveLength(0);
        expect(f.closes()).toBe(1);
        expect((await f.preview()).status).toBe("incomplete");
        expect(f.prepares).toHaveLength(1);
      },
    );
    it.each([
      "suppression",
      "suppression-and-relearn",
      "missing-source-deletion",
    ] as const)(
      "%s while runAccess waits prevents paid extraction under the real source locks",
      async (change) => {
        const sources = new PrismaMemoryAutomaticSourceStore(prisma);
        const f = await fixture(
          async () => {
            await sources.invalidate({
              scope: memoryScope,
              sourceId: snapshot.sourceId,
              cause: "deleted",
              now: new Date(),
            });
            const suppressed = await sources.lookup(
              memoryScope,
              snapshot.sourceId,
            );
            expect(suppressed?.suppressed).toBe(true);
            if (change === "suppression-and-relearn") {
              await sources.clearSuppression({
                scope: memoryScope,
                sourceId: snapshot.sourceId,
                expectedEpoch: suppressed!.binding.epoch,
                expectedSuppressionEpoch: suppressed!.suppressionEpoch,
                now: new Date(),
              });
              expect(
                (await sources.lookup(memoryScope, snapshot.sourceId))
                  ?.suppressed,
              ).toBe(false);
            }
          },
          false,
          change !== "missing-source-deletion",
        );
        expect((await f.preview()).status).toBe("incomplete");
        expect(f.prepares).toHaveLength(1);
        expect(f.requests).toHaveLength(0);
        expect(f.closes()).toBe(1);
        await f.preview();
        expect(f.prepares).toHaveLength(1);
      },
    );

    it("a terminal parent reached while runAccess waits denies the child dispatch", async () => {
      const f = await fixture(async () => {
        await prisma.conversationProcessing.updateMany({
          where: { purpose: "conversation-v1" },
          data: { status: "stale" },
        });
      });
      expect((await f.preview()).status).toBe("incomplete");
      expect(f.prepares).toHaveLength(1);
      expect(f.requests).toHaveLength(0);
      expect(f.closes()).toBe(1);
    });
    it("an ambiguous prepare remains one durable attempt across a new adapter instance", async () => {
      const f = await fixture(undefined, true);
      await f.preview();
      await f.preview();
      expect(f.prepares).toHaveLength(1);
      expect(f.requests).toHaveLength(0);
      expect(
        await prisma.conversationProcessing.findUnique({
          where: { id: conversationMemoryPreviewId(f.parentId) },
        }),
      ).toMatchObject({
        modelDispatched: true,
        requestEffect: "not_dispatched",
        result: { gatewayCleanup: "pending" },
      });
    });
    it("a different frozen parent account denies before preparing any grant", async () => {
      const f = await fixture();
      await prisma.conversationProcessing.update({
        where: { id: f.parentId },
        data: {
          boundManifest: JSON.stringify({
            account: { ...account, gatewayAccountRef: "another-tenant" },
          }),
        },
      });
      expect((await f.preview()).status).toBe("incomplete");
      expect(f.prepares).toHaveLength(0);
      expect(f.requests).toHaveLength(0);
    });
  },
);
