import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GatewayError } from "@agent-teams/account-gateway/http";
import type {
  ConsumerControlPort,
  ExecutionConnector,
} from "@agent-teams/account-gateway/llm";
import type { ConversationSnapshot } from "@reviewrouter/features-conversations";
import { PrismaMemoryAutomaticSourceStore } from "@reviewrouter/features-memory/infrastructure";
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
};
const snapshot = {
  workspaceId: "workspace",
  repositoryId: "repository",
  repositoryStableId: "100",
  repositoryFullName: "test/disposable",
  pullRequestNumber: 1,
  threadId: "thread",
  sourceId: "source",
  sourceCommentId: "comment",
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
      id: "source",
      commentId: "comment",
      actor: { id: "author", login: "maintainer", kind: "human" },
      body: "Opaque identifiers preserve leading zeroes.",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replyTo: null,
      bodyDigest: "source-body-digest",
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
  parentCommentId: "comment",
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
    id: "source",
    revision: "revision",
    body: snapshot.messages[0]!.body,
  },
  maxStatements: 4,
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
          'CREATE TABLE "PreviewAuthority" ("id" INTEGER PRIMARY KEY, "source" BOOLEAN, "account" BOOLEAN)',
        );
      } finally {
        client.release();
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
    });
    beforeEach(async () => {
      await prisma.conversationProcessing.deleteMany();
      await prisma.$executeRaw`DELETE FROM "MemoryAutomaticEntry"`;
      await prisma.$executeRaw`DELETE FROM "MemoryAutomaticSource"`;
      await prisma.$executeRaw`DELETE FROM "MemoryKnowledgeScopeState"`;
      await prisma.$executeRaw`DELETE FROM "PreviewAuthority"`;
      await prisma.$executeRaw`INSERT INTO "PreviewAuthority" VALUES (1, true, true)`;
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
              >`SELECT "account" FROM "PreviewAuthority" WHERE "id"=1`
            )[0]!.account,
        },
        checkSelection: async (transaction) =>
          (
            await transaction.$queryRaw<
              { account: boolean }[]
            >`SELECT "account" FROM "PreviewAuthority" WHERE "id"=1 FOR SHARE`
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
      const preview = () =>
        create().preview(source, { deadlineAt: new Date(Date.now() + 30_000) });
      return {
        preview,
        prepares,
        requests,
        parentId,
        captured,
        closes: () => closes,
      };
    }

    it("routes the selected user account and policy, and concurrent/restarted replay buys no second call", async () => {
      const f = await fixture();
      const results = await Promise.all([f.preview(), f.preview()]);
      expect(results.filter((r) => r.status === "complete")).toHaveLength(1);
      expect(f.prepares).toHaveLength(1);
      expect(f.prepares[0]).toMatchObject({
        accountRefs: [account.gatewayAccountRef],
        subjectRef: account.policySubject,
        policyRevision: 2,
        bindingRevision: 3,
        profileId: account.profileRef,
      });
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0]).toMatchObject({
        model: account.model,
        store: false,
        service_tier: "default",
      });
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
