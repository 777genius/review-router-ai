import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  JoseActionSessionTokenService,
  type ActionSessionClaims,
} from "@reviewrouter/features-action-control-plane";
import {
  ProcessConversation,
  PrismaConversationProcessingStore,
  conversationDigest,
  type ConversationIdentity,
  type ConversationMemoryPort,
  type ConversationPolicyPort,
} from "@reviewrouter/features-conversations";
import {
  GitHubConversationSource,
  type ConversationGitHubClient,
} from "./action-conversation-source.js";
import { createConversationGatewayInference } from "./action-conversation-inference.js";
import { registerActionConversationRoutes } from "./action-conversation-routes.js";
import { admitConversationDispatch } from "./action-conversation-policy.js";
import {
  claimCheckedConversationPublication,
  createConversationMemoryPort,
  reconcileConversationEffects,
} from "./action-conversation-composition.js";
import {
  MemoryKnowledgeService,
  createMemoryBodyHash,
  createMemoryPolicyConfig,
} from "@reviewrouter/features-memory";
import {
  PrismaMemoryAutomaticSourceStore,
  PrismaMemoryKnowledgeStore,
} from "@reviewrouter/features-memory/infrastructure";
import { runtimeGrantStatements } from "../../../scripts/run-codex-rotating-release-migration.mjs";

const databaseUrl = process.env.REVIEW_ROUTER_CONVERSATION_TEST_DATABASE_URL;
const schema = `conversations_${randomUUID().replaceAll("-", "")}`;
const runtimeSha = "a".repeat(40),
  model = "gpt-6.1-sol";
const time = new Date(Date.now() - 60_000).toISOString();
const controls = () => ({
  deadlineAt: new Date(Date.now() + 15_000),
  signal: AbortSignal.timeout(15_000),
});
const claims: ActionSessionClaims = {
  workspaceId: "conversation_workspace",
  repositoryId: "conversation_repository",
  repository: "acme/project",
  githubRepositoryId: "1234",
  identityBindingEpoch: "1:conversation-fixture",
  githubActorLogin: "maintainer",
  githubActorId: "11",
  githubRunId: "100",
  githubRunAttempt: "1",
  eventName: "pull_request_review_comment",
  workflowPath: ".github/workflows/reviewrouter-interaction.yml",
  jobWorkflowRef: `777genius/review-router/.github/workflows/reviewrouter-interaction-reusable.yml@${runtimeSha}`,
  jobWorkflowSha: runtimeSha,
  protocolVersion: 1,
};
const bot = { id: 99, login: "reviewrouter[bot]", type: "Bot" },
  human = { id: 11, login: "maintainer", type: "User" };
const input = {
  protocolVersion: 2 as const,
  pullRequestNumber: 7,
  sourceCommentId: "105",
  sourceRevision: time,
  eventAction: "created" as const,
};

describe.skipIf(!databaseUrl)(
  "finite conversation: real route/session, checked App source, independent Gateway SDK and PostgreSQL",
  () => {
    let admin: pg.Pool, prisma: PrismaClient;
    const servers: Server[] = [];
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/reviewrouter_conversation_test"
      )
        throw new Error(
          "conversation_test_requires_disposable_loopback_database",
        );
      admin = new pg.Pool({ connectionString: databaseUrl! });
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
          "202610280002_memory_automatic_source",
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
        await fixture.query(
          await readFile(
            new URL(
              "../../../packages/platform/db/prisma/migrations/20261028140000_conversation_processing/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        await fixture.query(
          'CREATE TABLE "ConversationAdmissionFence" ("kind" TEXT PRIMARY KEY, "active" BOOLEAN NOT NULL, "revision" INTEGER NOT NULL)',
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
    });
    beforeEach(async () => {
      await prisma.conversationProcessing.deleteMany();
      await prisma.$executeRawUnsafe(
        'TRUNCATE "MemoryAutomaticSource","MemoryAutomaticEntry","MemoryKnowledgeCommand","MemoryKnowledgeEntry","MemoryKnowledgeScopeState","MemoryKnowledgeSourceCursor","MemoryKnowledgeBundleReceipt","MemoryKnowledgeMaintenanceFence","OutboxEvent","AuditEvent"',
      );
      await prisma.$executeRaw`INSERT INTO "ConversationAdmissionFence" ("kind","active","revision") VALUES ('account',true,2),('memory',true,2),('policy',true,2) ON CONFLICT ("kind") DO UPDATE SET "active"=true,"revision"=2`;
    });
    afterAll(async () => {
      for (const server of servers) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await prisma?.$disconnect();
      if (admin) {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      }
    });
    async function fixture(
      options: {
        replies?: boolean;
        loseOutput?: boolean;
        driftAfterLearning?: boolean;
        modelAction?: unknown;
        revokeBeforeDispatch?: "account" | "memory";
        driftDuringPrepare?: "edit" | "delete";
      } = {},
    ) {
      const comments = Array.from({ length: 105 }, (_, index) => ({
        id: index + 1,
        node_id: `PRRC_${index + 1}`,
        user: index === 0 ? bot : human,
        body:
          index === 0
            ? `Finding. reviewrouter:finding:v2:${"b".repeat(64)}`
            : index === 1
              ? "TRANSCRIPT_CANARY_OLD_TURN: opaque identifiers must preserve leading zeroes."
              : index === 104
                ? "Why do we preserve these identifiers?"
                : `History turn ${index + 1}`,
        created_at: new Date(
          Date.parse(time) - (105 - index) * 1000,
        ).toISOString(),
        updated_at: time,
        ...(index === 0 ? {} : { in_reply_to_id: 1 }),
        pull_request_url: "https://api.github.com/repos/acme/project/pulls/7",
        path: "src/ids.ts",
        side: "RIGHT",
        line: 5,
        original_line: 5,
        commit_id: "c".repeat(40),
        original_commit_id: "c".repeat(40),
        diff_hunk: "@@ -1 +1 @@\n+const id = input;",
      }));
      const sourceCalls: { route: string; page?: number }[] = [];
      const sourceClient: ConversationGitHubClient = {
        async request<T>(
          route: string,
          parameters: Readonly<Record<string, unknown>>,
        ) {
          sourceCalls.push({
            route,
            ...(typeof parameters.page === "number"
              ? { page: parameters.page }
              : {}),
          });
          const data = route.includes("/users/")
            ? bot
            : route.endsWith("/permission")
              ? { permission: "maintain", user: human }
              : route.includes("/pulls/comments/")
                ? comments.find(
                    (comment) =>
                      String(comment.id) === String(parameters.comment_id),
                  )
                : route.endsWith("/comments")
                  ? comments.slice(
                      (Number(parameters.page) - 1) * 100,
                      Number(parameters.page) * 100,
                    )
                  : {
                      number: 7,
                      state: "open",
                      head: { sha: "c".repeat(40), repo: { id: 1234 } },
                      base: {
                        sha: "d".repeat(40),
                        repo: {
                          id: 1234,
                          full_name: "acme/project",
                          private: false,
                        },
                      },
                    };
          return { data: data as T };
        },
      };
      const sources = new GitHubConversationSource({
        claims,
        createClient: async () => sourceClient,
        appSlug: "reviewrouter",
        sourceProcessingAllowed: async () => true,
      });
      const records = new PrismaConversationProcessingStore(prisma, claims, {
        authorizePublication: async (transaction) => {
          const rows = await transaction.$queryRaw<
            { active: boolean; revision: number }[]
          >`SELECT "active","revision" FROM "ConversationAdmissionFence" WHERE "kind" IN ('account','policy') FOR SHARE`;
          return (
            rows.length === 2 &&
            rows.every((row) => row.active && row.revision === 2)
          );
        },
      });
      const calls: { kind: string; body?: Record<string, unknown> }[] = [];
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const text = Buffer.concat(chunks).toString("utf8"),
          body = text
            ? (JSON.parse(text) as Record<string, unknown>)
            : undefined;
        const json = (value: unknown) =>
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(value));
        if (request.url === "/internal/v1/run-access") {
          const intent = body!;
          calls.push({ kind: "prepare", body: intent });
          if (options.driftDuringPrepare === "edit")
            comments[1]!.body += " changed during Prepare";
          if (options.driftDuringPrepare === "delete") comments.splice(1, 1);
          return json({
            operation: {
              operationRef: intent.operationId,
              state: "applied",
              result: {
                kind: "execution",
                executionRef: "conversation-execution",
                accountRef: "selected-account",
                authorizationEpoch: 12,
                deadline: intent.deadline,
                state: "active",
              },
            },
            bearer: "disposable-execution-token",
            admission: {
              invocationRef: intent.invocationRef,
              attemptRef: intent.attemptRef,
              accountRef: "selected-account",
              authorizationEpoch: 12,
              subjectRef: intent.subjectRef,
              policyRevision: intent.policyRevision,
              bindingRevision: intent.bindingRevision,
              profileId: intent.profileId,
              limits: intent.limits,
              expiresAt: intent.deadline,
            },
          });
        }
        if (request.url?.endsWith("/requests")) {
          calls.push({ kind: "request", body: body! });
          response.writeHead(200, {
            "content-type": "text/event-stream",
            "x-gateway-request-ref": String(
              request.headers["x-gateway-request-id"],
            ),
          });
          if (options.loseOutput)
            return response.end(
              ": stream ended before the completed output\n\n",
            );
          const output = [
            {
              id: "message-1",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    kind: "answer",
                    answer:
                      "Opaque identifiers preserve leading zeroes; the earlier explanation supplies that context.",
                    action: options.modelAction ?? null,
                  }),
                },
              ],
            },
          ];
          response.write(
            `data: ${JSON.stringify({ type: "response.output_item.done", item: output[0] })}\r\n\r\n`,
          );
          return response.end(
            `data: ${JSON.stringify({ type: "response.completed", response: { id: "response-1", status: "completed", model, output: [], usage: { input_tokens: 1200, output_tokens: 40 } } })}\r\n\r\n`,
          );
        }
        if (request.method === "GET") {
          calls.push({ kind: "status" });
          return json({
            requestRef: request.url!.split("/").at(-1),
            status: "completed",
            effect: "completed",
          });
        }
        calls.push({ kind: "close" });
        return json({ operationRef: body?.operationId, state: "applied" });
      });
      servers.push(server);
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      let learned = 0,
        actionCalls = 0,
        policyCalls = 0;
      const memory: ConversationMemoryPort = {
        context: async () => ({
          text: "Public repository convention mem_example revision 1: identifiers are opaque.",
          manifest: {
            receipt: "bodyless-receipt",
            captureExpiresAt: new Date(Date.now() + 30_000).toISOString(),
          },
          admit: async () => true,
        }),
        async learn(snapshot) {
          learned++;
          expect(snapshot.messages).toHaveLength(comments.length);
          if (options.driftAfterLearning)
            comments[1]!.body += " edited during preview";
          return { status: "queued", effectIds: ["memory-effect-1"] };
        },
        async action() {
          actionCalls++;
          return {
            notice:
              "The memory operation is queued; publication is not confirmed yet.",
            effectIds: ["explicit-effect-1"],
          };
        },
      };
      const policies: ConversationPolicyPort = {
        async capture(identity, processingId, budget) {
          policyCalls++;
          const limits = {
            requests: 1,
            concurrency: 1,
            requestBytes: 131072,
            outputBytes: 262144,
            tokens: 2048,
          };
          const bindingManifest = {
            selectedAccount: "selected-account",
            model,
            bindingRevision: 2,
          };
          const selectionCurrent = async (
            tx: Pick<PrismaClient, "$queryRaw">,
          ) => {
            const [row] = await tx.$queryRaw<
              { active: boolean; revision: number }[]
            >`SELECT "active","revision" FROM "ConversationAdmissionFence" WHERE "kind"='account' FOR SHARE`;
            return row?.active === true && row.revision === 2;
          };
          return {
            revision: "1:1:qualified-proof",
            automaticLearning: true,
            discussionReplies: options.replies ?? true,
            contextWindowTokens: 250000,
            tokensPerByteUpperBound: 1,
            maxInputBytes: limits.requestBytes,
            bindingManifest,
            isCurrent: async () => true,
            inference: createConversationGatewayInference({
              runAccess: {
                origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
                runControlBearer: "disposable-control-token",
                timeoutMs: 5000,
              },
              prepare: {
                operationId: `conversation-${processingId}`,
                invocationRef: `conversation-${processingId}`,
                attemptRef: `conversation-${processingId}-attempt`,
                accountRefs: ["selected-account"],
                subjectRef: "binding-1",
                policyRevision: 1,
                bindingRevision: 2,
                profileId: "openai-codex-oauth-responses-v1",
                limits,
                deadline: budget.deadlineAt.toISOString(),
              },
              requestId: `conversation-${processingId}-request`,
              model,
              expectedAuthorizationEpoch: 12,
              checkAuthority: () => selectionCurrent(prisma),
              admitDispatch: () =>
                prisma.$transaction(async (transaction) => {
                  if (options.revokeBeforeDispatch)
                    await transaction.$executeRaw`UPDATE "ConversationAdmissionFence" SET "revision"=3 WHERE "kind"=${options.revokeBeforeDispatch}`;
                  return admitConversationDispatch(transaction, {
                    processingId,
                    workspaceId: identity.workspaceId,
                    repositoryId: identity.repositoryId,
                    bindingManifest,
                    checkSelection: selectionCurrent,
                    admitMemory: async (tx) => {
                      const [row] = await tx.$queryRaw<
                        { active: boolean; revision: number }[]
                      >`SELECT "active","revision" FROM "ConversationAdmissionFence" WHERE "kind"='memory' FOR SHARE`;
                      return row?.active === true && row.revision === 2;
                    },
                  });
                }),
            }),
          };
        },
      };
      const processor = new ProcessConversation({
        sources,
        records,
        policies,
        memory,
      });
      const app = Fastify({ logger: false }),
        sessions = new JoseActionSessionTokenService("s".repeat(64));
      const signed = await sessions.sign({
        claims,
        expiresInSeconds: 900,
        issuedAt: new Date(),
      });
      const repository = {
        workspaceId: claims.workspaceId,
        repositoryId: claims.repositoryId,
        githubRepositoryId: claims.githubRepositoryId,
        githubInstallationId: "1",
        fullName: claims.repository,
        owner: "acme",
        identityBindingEpoch: claims.identityBindingEpoch,
        selected: true,
        installationStatus: "active",
      };
      await registerActionConversationRoutes(app, {
        sessions,
        repositories: {
          findSelectedRepositoryByGithubId: async () => repository,
        } as never,
        clock: { now: () => new Date() },
        qualifiedRuntimeSha: runtimeSha,
        task: async () => ({
          records,
          processor,
          reconcile: async (result) => result,
          claimPublication: (id, digest) =>
            claimCheckedConversationPublication(
              { records, sources, now: () => new Date() },
              id,
              digest,
            ),
          verifyPublication: async (id, commentId, result) => {
            const row = await records.read(id);
            return (
              !!row &&
              sources.verifyPublished(
                row.identity,
                commentId,
                result,
                controls(),
              )
            );
          },
        }),
      });
      return {
        app,
        headers: { authorization: `Bearer ${signed.token}` },
        comments,
        calls,
        sources,
        sourceCalls,
        records,
        processor,
        policies,
        memory,
        counts: () => ({ learned, actionCalls, policyCalls }),
      };
    }

    it("reads every page and actor, uses the selected account once, verifies App publication and purges settled output before replay", async () => {
      const f = await fixture();
      try {
        const response = await f.app.inject({
          method: "POST",
          url: "/api/action/v2/conversations/process",
          headers: f.headers,
          payload: input,
        });
        expect(response.statusCode).toBe(200);
        const result = response.json();
        expect(result.status).toBe("ready");
        expect(f.sourceCalls.some((call) => call.page === 2)).toBe(true);
        expect(
          JSON.stringify(f.calls.find((call) => call.kind === "request")!.body),
        ).toContain("TRANSCRIPT_CANARY_OLD_TURN");
        expect(
          f.calls.find((call) => call.kind === "prepare")!.body,
        ).toMatchObject({
          accountRefs: ["selected-account"],
          limits: { requests: 1, concurrency: 1 },
        });
        expect(
          f.calls.find((call) => call.kind === "request")!.body,
        ).toMatchObject({
          model,
          tools: [],
          tool_choice: "none",
          stream: true,
          store: false,
        });
        const row = await prisma.conversationProcessing.findUniqueOrThrow({
          where: { id: result.processingId },
        });
        expect(JSON.stringify(row)).not.toContain("TRANSCRIPT_CANARY_OLD_TURN");
        f.comments.push({
          ...f.comments[104]!,
          id: 106,
          node_id: "PRRC_106",
          user: { ...bot, id: 100, login: "other[bot]" },
          body: result.reply.body,
        });
        const receipt = {
          protocolVersion: 2,
          processingId: result.processingId,
          status: "published",
          commentId: "106",
          bodyDigest: result.reply.bodyDigest,
        };
        expect(
          (
            await f.app.inject({
              method: "POST",
              url: "/api/action/v2/conversations/publication",
              headers: f.headers,
              payload: receipt,
            })
          ).statusCode,
        ).toBe(403);
        f.comments[105]!.user = bot;
        expect(
          (
            await f.app.inject({
              method: "POST",
              url: "/api/action/v2/conversations/publication",
              headers: f.headers,
              payload: receipt,
            })
          ).json().status,
        ).toBe("published");
        f.policies.capture = async () => {
          throw new Error(
            "mutable account lookup must not occur during replay",
          );
        };
        const replay = await f.processor.execute(input, controls());
        expect(replay).toMatchObject({
          status: "published",
          processingId: result.processingId,
          publicationCommentId: "106",
        });
        expect(replay.reply).toBeUndefined();
        expect(f.counts()).toMatchObject({ learned: 1, policyCalls: 1 });
        expect(f.calls.filter((call) => call.kind === "request")).toHaveLength(
          1,
        );
        expect(
          JSON.stringify(
            await prisma.conversationProcessing.findUnique({
              where: { id: result.processingId },
            }),
          ),
        ).not.toContain(result.reply.body);
      } finally {
        await f.app.close();
      }
    });
    it("does not replay paid output from SDK status when terminal output is lost", async () => {
      const f = await fixture({ loseOutput: true });
      try {
        const first = await f.processor.execute(input, controls());
        expect(first.status).toBe("output_unavailable");
        expect(first.reply).toBeUndefined();
        expect(await f.processor.execute(input, controls())).toEqual(first);
        expect(f.calls.filter((call) => call.kind === "request")).toHaveLength(
          1,
        );
        expect(f.calls.filter((call) => call.kind === "status")).toHaveLength(
          1,
        );
      } finally {
        await f.app.close();
      }
    });
    it("keeps learning independent of reply disable and rejects post-preview context drift without another dispatch", async () => {
      const disabled = await fixture({ replies: false });
      try {
        expect(
          (await disabled.processor.execute(input, controls())).status,
        ).toBe("silent");
        expect(disabled.counts().learned).toBe(1);
      } finally {
        await disabled.app.close();
      }
      await prisma.conversationProcessing.deleteMany();
      const drift = await fixture({ driftAfterLearning: true });
      try {
        expect((await drift.processor.execute(input, controls())).status).toBe(
          "stale",
        );
        expect(drift.counts().learned).toBe(1);
        expect(
          drift.calls.filter((call) => call.kind === "request"),
        ).toHaveLength(1);
      } finally {
        await drift.app.close();
      }
    });
    it.each(["edit", "delete"] as const)(
      "rejects %s of older context during SDK Prepare before any native paid request",
      async (drift) => {
        const f = await fixture({ driftDuringPrepare: drift });
        try {
          const result = await f.processor.execute(input, controls());
          expect(result.status).toBe("stale");
          expect(
            f.calls.filter((call) => call.kind === "prepare"),
          ).toHaveLength(1);
          expect(
            f.calls.filter((call) => call.kind === "request"),
          ).toHaveLength(0);
          expect(
            (
              await prisma.conversationProcessing.findUniqueOrThrow({
                where: { id: result.processingId },
              })
            ).requestEffect,
          ).toBeNull();
          expect(await f.processor.execute(input, controls())).toEqual(result);
          expect(
            f.calls.filter((call) => call.kind === "prepare"),
          ).toHaveLength(1);
        } finally {
          await f.app.close();
        }
      },
    );
    it("recovers committed automatic and explicit command associations after lost ACK and expiry without repeating effects", async () => {
      const f = await fixture({
        modelAction: {
          kind: "create",
          knowledgeKind: "rule",
          body: "EXPLICIT_SELECTED_BODY",
        },
      });
      const generation = "conversation_association_test",
        profile = "test_profile";
      const scope = {
        kind: "repository" as const,
        workspaceId: claims.workspaceId,
        repositoryId: claims.repositoryId,
      };
      const actor = {
        kind: "github_user" as const,
        id: "github-user:11",
        githubUserId: "11",
        login: "maintainer",
      };
      const access = {
        authorize: vi.fn(async () => {}),
        verifySource: async (value: {
          source: import("@reviewrouter/features-memory").MemoryKnowledgeSource;
        }) => value.source,
        sourceApplicable: async () => true,
      };
      const store = new PrismaMemoryKnowledgeStore(prisma, {
        automaticSourcesEnabled: true,
        providerProfileVersion: profile,
      });
      const automaticSources = new PrismaMemoryAutomaticSourceStore(prisma);
      const current = { current: async () => true };
      const policy = { getPolicy: async () => createMemoryPolicyConfig() };
      const knowledge = new MemoryKnowledgeService({
        generation,
        providerProfileVersion: profile,
        store,
        access,
        policy,
        reader: {
          read: async () => null,
          recall: async () => [],
          list: async () => ({ entries: [], nextCursor: null }),
        },
        writer: {} as never,
        observer: {} as never,
        quota: {
          getWorkspaceQuota: async () => ({
            activeItems: { limit: 100 },
            pendingSuggestions: { limit: 100 },
          }),
        },
        automaticSources: { store: automaticSources, current },
      });
      const preview = vi.fn(
        async (request: { source: { id: string; revision: string } }) => ({
          status: "complete" as const,
          source: request.source,
          statements: [
            { body: "AUTO_SELECTED_FIRST" },
            { body: "AUTO_SELECTED_SECOND" },
          ],
        }),
      );
      const { MemoryAutomaticSourceService } =
        await import("@reviewrouter/features-memory");
      const runtime = {
        generation,
        providerProfileVersion: profile,
        store,
        policy,
        forAccess: () => knowledge,
        forAutomaticLearning: () =>
          new MemoryAutomaticSourceService({
            generation,
            providerProfileVersion: profile,
            knowledge,
            sources: automaticSources,
            current,
            preview: { preview },
          }),
      } as unknown as import("@reviewrouter/features-memory/composition").MemoryKnowledgeRuntime;
      const productMemory = createConversationMemoryPort({
        runtime,
        scope,
        sources: Object.assign(f.sources, current),
        preview: { preview },
        managed: (snapshot) => ({
          service: knowledge,
          access,
          source: {
            type: "github_comment",
            sourceId: snapshot.sourceId,
            revision: snapshot.sourceRevision,
            updatedAt: snapshot.sourceUpdatedAt,
            statementAt: snapshot.sourceUpdatedAt,
            repositoryId: snapshot.repositoryId,
            pullRequestNumber: snapshot.pullRequestNumber,
            url: null,
            visibility: snapshot.visibility,
            claimedBodyDigest: snapshot.messages.find(
              (message) => message.id === snapshot.sourceId,
            )!.bodyDigest,
            observedCommitSha: null,
          },
        }),
        clock: { now: () => new Date() },
        contextAccess: () => access,
      });
      f.memory.context = async () => ({
        text: "",
        manifest: { memoryGeneration: generation },
        admit: async () => true,
      });
      f.memory.learn = productMemory.learn;
      f.memory.action = productMemory.action;
      const originalBatch = store.admitAutomaticSelection.bind(store);
      const batchFault = vi
        .spyOn(store, "admitAutomaticSelection")
        .mockImplementationOnce(async (admission) => {
          await originalBatch(admission);
          throw new Error("lost_automatic_commit_ack");
        });
      const originalSave = knowledge.save.bind(knowledge);
      const explicitFault = vi
        .spyOn(knowledge, "save")
        .mockImplementationOnce(async (command, budget) => {
          await originalSave(command, budget);
          throw new Error("lost_explicit_commit_ack");
        });
      try {
        const result = await f.processor.execute(input, controls());
        expect(result.status).toBe("output_unavailable");
        expect(result.learning.effectIds).toEqual([]);
        const commands = await prisma.memoryKnowledgeCommand.findMany({
          select: { id: true },
        });
        expect(commands).toHaveLength(3);
        expect(await prisma.outboxEvent.count()).toBe(3);
        await prisma.conversationProcessing.update({
          where: { id: result.processingId },
          data: { deadlineAt: new Date(Date.now() - 1) },
        });
        const replay = await f.processor.execute(input, controls());
        const reconcile = () =>
          reconcileConversationEffects(
            {
              records: f.records,
              service: knowledge,
              generation,
              actor,
              scope,
            },
            replay,
          );
        const recovered = await reconcile();
        expect([...recovered.learning.effectIds].sort()).toEqual(
          commands.map((command) => command.id).sort(),
        );
        expect(recovered.learning.status).toBe("queued");
        expect(recovered.status).toBe("output_unavailable");
        expect(recovered.reply).toBeUndefined();
        expect(JSON.stringify(recovered)).not.toMatch(
          /SELECTED_BODY|AUTO_SELECTED|pendingOutput/,
        );
        expect(
          (await f.records.read(result.processingId))!.result.learning,
        ).toEqual(recovered.learning);
        // A supported child status can require fresh input even before its state becomes unknown.
        const automaticCommand = (await knowledge.automaticOperations(
          {
            actor,
            scope,
            sourceId: (await f.records.read(result.processingId))!.identity
              .sourceId,
            processingId: result.processingId,
          },
          controls(),
        ))!.operations[0]!;
        const pending = await store.claim({
          scope,
          generation,
          commandId: automaticCommand.id,
          now: new Date(),
          claimId: randomUUID(),
          claimUntil: new Date(Date.now() + 10000),
        });
        await store.settle({
          scope,
          generation,
          commandId: automaticCommand.id,
          claimId: pending!.claimId,
          now: new Date(),
          result: {
            commandId: automaticCommand.id,
            state: "submitted",
            safeReason: "input_required",
          },
        });
        expect((await reconcile()).learning.status).toBe("needs_refresh");
        const lineage = (await automaticSources.lookup(
          scope,
          (await f.records.read(result.processingId))!.identity.sourceId,
        ))!;
        expect(lineage).toMatchObject({
          state: "needs_refresh",
          invalidatedBy: "delivery_uncertain",
        });
        // Late verified delivery completes the still-current original cohort and overrides
        // the prior needs_refresh projection without extraction or new commands.
        for (const command of commands) {
          const now = new Date();
          const claim = await store.claim({
            commandId: command.id,
            scope,
            generation,
            now,
            claimId: randomUUID(),
            claimUntil: new Date(now.getTime() + 10_000),
          });
          expect(claim).not.toBeNull();
          const envelope = claim!.command.envelope;
          if (envelope?.kind !== "save")
            throw new Error("expected_original_save_envelope");
          expect(
            await store.settle({
              commandId: command.id,
              scope,
              generation,
              claimId: claim!.claimId,
              now,
              result: {
                commandId: command.id,
                state: "published",
                verifiedEntry: {
                  ref: envelope.ref,
                  body: envelope.body,
                  bodyDigest: createMemoryBodyHash(envelope.body),
                  contentApprovalRevision:
                    claim!.command.contentApprovalRevision,
                  kind: envelope.knowledgeKind,
                  topicIds: envelope.topicIds,
                  statementAt: claim!.command.originalStatementAt!,
                  sourceFactIds: [`fact-${command.id}`],
                },
              },
            }),
          ).toMatchObject({ id: command.id, state: "published" });
        }
        expect((await reconcile()).learning.status).toBe("published");
        const active = (await automaticSources.lookup(
          scope,
          lineage.sourceId,
        ))!;
        expect(active.state).toBe("active");
        if (active.state === "unselected")
          throw new Error("expected_selected_cohort");
        await automaticSources.invalidate({
          scope,
          sourceId: active.sourceId,
          cause: "unavailable",
          expectedBinding: active.binding,
          now: new Date(),
        });
        // Published child history cannot claim that a now-withdrawn cohort remains published.
        expect((await reconcile()).learning.status).toBe("needs_refresh");
        expect(await prisma.memoryKnowledgeCommand.count()).toBe(3);
        expect(
          (
            await prisma.memoryKnowledgeCommand.findMany({
              select: { envelope: true },
            })
          ).every((command) => command.envelope === null),
        ).toBe(true);
        expect(
          await prisma.outboxEvent.count({
            where: {
              idempotencyKey: { startsWith: "memory.knowledge.command:" },
            },
          }),
        ).toBe(3);
        // Existing observation scheduling retains this original child's delivery debt.
        expect(
          await prisma.outboxEvent.findMany({
            where: {
              idempotencyKey: {
                startsWith: "memory.knowledge.command.observe:",
              },
            },
            select: { type: true, idempotencyKey: true, payload: true },
          }),
        ).toEqual([
          {
            type: "memory.knowledge.command.requested",
            idempotencyKey: `memory.knowledge.command.observe:${automaticCommand.id}:1`,
            payload: { commandId: automaticCommand.id, generation, scope },
          },
        ]);
        expect(preview).toHaveBeenCalledTimes(1);
        expect(f.calls.filter((call) => call.kind === "request")).toHaveLength(
          1,
        );
        expect(batchFault).toHaveBeenCalledTimes(1);
        expect(explicitFault).toHaveBeenCalledTimes(1);
        expect(access.authorize).toHaveBeenCalled();
      } finally {
        batchFault.mockRestore();
        explicitFault.mockRestore();
        await f.app.close();
      }
    });
    it.each([5, 20])(
      "releases %i expired unclaimed reservations while retaining claimed unknown effects in the cap",
      async (limit) => {
        const f = await fixture();
        try {
          const original = await f.sources.identify(input, controls());
          const reserve = async (index: number) => {
            const { record } = await f.records.accept(
              {
                ...original,
                sourceId: `cap-source-${index}`,
                sourceRevision: `cap-revision-${index}`,
                threadId:
                  limit === 5
                    ? original.threadId
                    : `cap-thread-${Math.floor(index / 5)}`,
              },
              controls().deadlineAt,
            );
            const marker = `<!-- reviewrouter-conversation:v1 processing_id=${record.id} -->`,
              body = `UNCLAIMED_CAP_BODY\n\n${marker}`;
            const ready = {
              processingId: record.id,
              status: "ready" as const,
              learning: { status: "disabled", effectIds: [] },
              reply: {
                body,
                bodyDigest: conversationDigest(body),
                marker,
                parentCommentId: "1",
              },
            };
            await f.records.bind(record.id, "{}");
            await f.records.markModelDispatched(record.id);
            await f.records.freezeOutput(record.id, {
              kind: "answer",
              answer: "UNCLAIMED_CAP_BODY",
              action: null,
            });
            const allowed = await f.records.reserveReply(record.id, ready, []);
            return { id: record.id, ready, allowed };
          };
          const old = [];
          for (let index = 0; index < limit; index++)
            old.push(await reserve(index));
          expect(old.every((row) => row.allowed)).toBe(true);
          expect(
            await f.records.claimPublication(
              old[0]!.id,
              old[0]!.ready.reply.bodyDigest,
            ),
          ).toBe(true);
          await f.records.publication({
            processingId: old[0]!.id,
            status: "unknown",
            bodyDigest: old[0]!.ready.reply.bodyDigest,
          });
          await prisma.conversationProcessing.updateMany({
            where: { id: { in: old.map((row) => row.id) } },
            data: { deadlineAt: new Date(Date.now() - 1) },
          });
          expect((await reserve(limit)).allowed).toBe(true);
          const expired = await prisma.conversationProcessing.findMany({
            where: { id: { in: old.slice(1).map((row) => row.id) } },
          });
          expect(
            expired.every(
              (row) =>
                row.status === "stale" &&
                !JSON.stringify(row.result).includes("UNCLAIMED_CAP_BODY"),
            ),
          ).toBe(true);
          expect((await f.records.read(old[0]!.id))!.result).toMatchObject({
            status: "unknown",
            reply: old[0]!.ready.reply,
          });
          for (let index = limit + 1; index < limit * 2 - 1; index++)
            expect((await reserve(index)).allowed).toBe(true);
          expect((await reserve(limit * 2 - 1)).allowed).toBe(false);
        } finally {
          await f.app.close();
        }
      },
    );
    it("serializes reply reservations across processes and enforces 5/thread and 20/PR", async () => {
      const f = await fixture();
      try {
        const original = await f.sources.identify(input, controls());
        const identities: ConversationIdentity[] = Array.from(
          { length: 30 },
          (_, index) => ({
            ...original,
            threadId: `thread-${Math.floor(index / 6)}`,
            sourceId: `source-${index}`,
            sourceRevision: `revision-${index}`,
          }),
        );
        const accepted = await Promise.all(
          identities.map((identity) =>
            f.records.accept(identity, controls().deadlineAt),
          ),
        );
        const outcomes = await Promise.all(
          accepted.map(async ({ record }) => {
            await f.records.bind(record.id, "{}");
            const marker = `<!-- reviewrouter-conversation:v1 processing_id=${record.id} -->`,
              body = `Reply\n\n${marker}`;
            return f.records.reserveReply(
              record.id,
              {
                processingId: record.id,
                status: "ready",
                learning: { status: "disabled", effectIds: [] },
                reply: {
                  body,
                  bodyDigest: conversationDigest(body),
                  marker,
                  parentCommentId: "1",
                },
              },
              [],
            );
          }),
        );
        expect(outcomes.filter(Boolean)).toHaveLength(20);
        const rows = await prisma.conversationProcessing.groupBy({
          by: ["threadId"],
          where: { status: "ready" },
          _count: true,
        });
        expect(rows.every((row) => row._count <= 5)).toBe(true);
        const duplicate = await Promise.all([
          f.records.accept(original, controls().deadlineAt),
          f.records.accept(original, controls().deadlineAt),
        ]);
        expect(duplicate.filter((row) => row.created)).toHaveLength(1);
        expect(duplicate[0]!.record.id).toBe(duplicate[1]!.record.id);
      } finally {
        await f.app.close();
      }
    });
    it("terminates an expired crash after frozen output without replaying inference or retaining the pending body", async () => {
      const f = await fixture();
      try {
        const identity = await f.sources.identify(input, controls());
        const accepted = await f.records.accept(
            identity,
            controls().deadlineAt,
          ),
          id = accepted.record.id;
        await f.records.bind(id, "{}");
        await f.records.markModelDispatched(id);
        const answer = "BOUNDED_PENDING_REPLY_CANARY";
        expect(
          await f.records.freezeOutput(id, {
            kind: "answer",
            answer,
            action: null,
          }),
        ).toBe(true);
        await f.records.finish(id, {
          processingId: id,
          status: "processing",
          learning: { status: "queued", effectIds: ["fixed-child-effect"] },
        });
        expect(
          JSON.stringify(
            await prisma.conversationProcessing.findUnique({ where: { id } }),
          ),
        ).toContain(answer);
        await prisma.conversationProcessing.update({
          where: { id },
          data: { deadlineAt: new Date(Date.now() - 1) },
        });
        const replay = await f.processor.execute(input, controls());
        expect(replay).toMatchObject({
          processingId: id,
          status: "output_unavailable",
          learning: { effectIds: ["fixed-child-effect"] },
        });
        expect(
          JSON.stringify(
            await prisma.conversationProcessing.findUnique({ where: { id } }),
          ),
        ).not.toContain(answer);
        expect(f.counts().policyCalls).toBe(0);
        expect(f.calls).toHaveLength(0);
      } finally {
        await f.app.close();
      }
    });
    it.each(["account", "memory"] as const)(
      "denies the actual finite dispatch grant when %s changes after preflight",
      async (fence) => {
        const f = await fixture({ revokeBeforeDispatch: fence });
        try {
          const first = await f.processor.execute(input, controls());
          expect(first.reply).toBeUndefined();
          expect(
            f.calls.filter((call) => call.kind === "prepare"),
          ).toHaveLength(1);
          expect(
            f.calls.filter((call) => call.kind === "request"),
          ).toHaveLength(0);
          const row = await prisma.conversationProcessing.findUniqueOrThrow({
            where: { id: first.processingId },
          });
          expect(row.modelDispatched).toBe(true);
          expect(row.requestEffect).toBeNull();
          expect(await f.processor.execute(input, controls())).toEqual(first);
          expect(
            f.calls.filter((call) => call.kind === "prepare"),
          ).toHaveLength(1);
        } finally {
          await f.app.close();
        }
      },
    );
    it("pairs the actual Action client and App publisher through preclaim read failures, expiry, lost ACK, receipt reconciliation and reply-off learning", async () => {
      const actionDirectory = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
      if (!actionDirectory)
        throw new Error("conversation_paired_action_source_directory_required");
      const clientModule = await import(
        pathToFileURL(
          join(actionDirectory, "src/control-plane/conversations.ts"),
        ).href
      );
      const publisherModule = await import(
        pathToFileURL(join(actionDirectory, "src/github/conversation.ts")).href
      );
      const run = async (
        replyMode: "off" | "suggest",
        loseClaimAck = false,
        preclaimRead: "none" | "retry" | "expiry" = "none",
      ) => {
        const f = await fixture();
        await f.app.listen({ host: "127.0.0.1", port: 0 });
        const address = f.app.server.address() as AddressInfo;
        const transport = globalThis.fetch.bind(globalThis);
        let claimAckLost = false,
          claims = 0;
        const fetchImpl: typeof fetch = async (url, init) => {
          const isClaim =
            String(url).endsWith("/publication") &&
            JSON.parse(String(init?.body)).status === "dispatching";
          if (isClaim) claims++;
          const response = await transport(url, init);
          if (loseClaimAck && !claimAckLost && isClaim) {
            claimAckLost = true;
            await response.body?.cancel();
            throw new Error("synthetic lost publication claim acknowledgement");
          }
          return response;
        };
        const client = new clientModule.ControlPlaneConversationClient(
          {
            status: "applied",
            apiUrl: `http://127.0.0.1:${address.port}`,
            actionVersion: runtimeSha,
            configVersion: 1,
            sessionToken: f.headers.authorization.slice(7),
          },
          fetchImpl,
        );
        let publications = 0,
          inventories = 0;
        const publisher = {
          owner: "acme",
          repo: "project",
          octokit: {
            paginate: async () => {
              inventories++;
              if (preclaimRead !== "none" && inventories === 1)
                throw new Error("synthetic failed preclaim inventory");
              return f.comments;
            },
            rest: {
              pulls: {
                listReviewComments: () => {},
                async createReplyForReviewComment(value: {
                  body: string;
                  comment_id: number;
                }) {
                  publications++;
                  f.comments.push({
                    ...f.comments[104]!,
                    id: 106,
                    node_id: "PRRC_106",
                    user: bot,
                    body: value.body,
                    in_reply_to_id: value.comment_id,
                  });
                  throw new Error(
                    "synthetic lost create acknowledgement after the App effect",
                  );
                },
              },
            },
          },
        };
        const handler = new publisherModule.ManagedConversationHandler(
          publisher,
          client,
          { replyMode },
        );
        const event = {
          action: "created",
          comment: f.comments[104],
          pull_request: { number: 7, head: { repo: { fork: false } } },
        };
        try {
          await handler.execute(event);
          const first = await prisma.conversationProcessing.findFirstOrThrow();
          if (preclaimRead !== "none") {
            expect(first.status).toBe("ready");
            expect(claims).toBe(0);
            expect(publications).toBe(0);
            const ready = (await f.records.read(first.id))!.result;
            expect(
              (
                await f.app.inject({
                  method: "POST",
                  url: "/api/action/v2/conversations/publication",
                  headers: f.headers,
                  payload: {
                    protocolVersion: 2,
                    processingId: first.id,
                    status: "unknown",
                    bodyDigest: ready.reply!.bodyDigest,
                  },
                })
              ).statusCode,
            ).toBe(409);
            expect((await f.records.read(first.id))!.result).toEqual(ready);
            if (preclaimRead === "expiry") {
              const identity = await f.sources.identify(input, controls());
              const reserve = async (index: number) => {
                const accepted = await f.records.accept(
                  {
                    ...identity,
                    sourceId: `inventory-cap-source-${index}`,
                    sourceRevision: `inventory-cap-revision-${index}`,
                  },
                  controls().deadlineAt,
                );
                return {
                  id: accepted.record.id,
                  result: { ...ready, processingId: accepted.record.id },
                };
              };
              for (let index = 0; index < 4; index++) {
                const pending = await reserve(index);
                expect(
                  await f.records.reserveReply(pending.id, pending.result, []),
                ).toBe(true);
              }
              const blocked = await reserve(4);
              expect(
                await f.records.reserveReply(blocked.id, blocked.result, []),
              ).toBe(false);
              await prisma.conversationProcessing.update({
                where: { id: first.id },
                data: { deadlineAt: new Date(Date.now() - 1) },
              });
              await handler.execute(event);
              const expired = await f.records.read(first.id);
              expect(expired!.result.status).toBe("stale");
              expect(expired!.result.reply).toBeUndefined();
              expect(
                JSON.stringify(
                  await prisma.conversationProcessing.findUniqueOrThrow({
                    where: { id: first.id },
                  }),
                ),
              ).not.toContain(ready.reply!.body);
              expect(
                await f.records.reserveReply(blocked.id, blocked.result, []),
              ).toBe(true);
              expect(claims).toBe(0);
              expect(publications).toBe(0);
            } else {
              await handler.execute(event);
              expect((await f.records.read(first.id))!.result.status).toBe(
                "unknown",
              );
              expect(claims).toBe(1);
              expect(publications).toBe(1);
              await handler.execute(event);
              expect((await f.records.read(first.id))!.result.status).toBe(
                "published",
              );
              expect(claims).toBe(1);
              expect(publications).toBe(1);
            }
            expect(f.counts().learned).toBe(1);
            expect(
              f.calls.filter((call) => call.kind === "request"),
            ).toHaveLength(1);
          } else if (replyMode === "off") {
            expect(first.status).toBe("silent");
            expect(publications).toBe(0);
            expect(f.counts().learned).toBe(1);
            expect(JSON.parse(first.boundManifest!).publication.enabled).toBe(
              false,
            );
          } else if (loseClaimAck) {
            expect(first.status).toBe("unknown");
            expect(publications).toBe(0);
            await handler.execute(event);
            expect(publications).toBe(0);
            expect(
              f.calls.filter((call) => call.kind === "request"),
            ).toHaveLength(1);
          } else {
            expect(first.status).toBe("unknown");
            expect(publications).toBe(1);
            await handler.execute(event);
            expect(
              (await prisma.conversationProcessing.findFirstOrThrow()).status,
            ).toBe("published");
            expect(publications).toBe(1);
            expect(
              f.calls.filter((call) => call.kind === "request"),
            ).toHaveLength(1);
            expect(f.counts().learned).toBe(1);
            const settled =
              await prisma.conversationProcessing.findFirstOrThrow();
            expect(JSON.stringify(settled.result)).not.toContain(
              "Opaque identifiers preserve leading zeroes",
            );
            f.comments.pop();
            await handler.execute(event);
            expect(publications).toBe(1);
          }
        } finally {
          await f.app.close();
        }
      };
      await run("suggest");
      await prisma.conversationProcessing.deleteMany();
      await run("off");
      await prisma.conversationProcessing.deleteMany();
      await run("suggest", true);
      await prisma.conversationProcessing.deleteMany();
      await run("suggest", false, "retry");
      await prisma.conversationProcessing.deleteMany();
      await run("suggest", false, "expiry");
    });
    it("projects real runtime roles onto metadata without granting web learning or any conversation access", async () => {
      const roles = ["api", "web", "worker"].map((role) => ({
        role,
        username: `${schema}_${role}`,
      }));
      const sql = runtimeGrantStatements({ roles });
      const projections = sql.match(
        /DO \$conversation_memory_metadata_acl\$[\s\S]*?\$conversation_memory_metadata_acl\$;/g,
      )!;
      expect(projections).toHaveLength(3);
      await admin.query(
        `CREATE TABLE IF NOT EXISTS "${schema}"."MemoryAutomaticSource" (id TEXT); CREATE TABLE IF NOT EXISTS "${schema}"."MemoryAutomaticEntry" (id TEXT)`,
      );
      try {
        for (const [index, role] of roles.entries()) {
          await admin.query(
            `CREATE ROLE ${role.username} NOLOGIN; GRANT USAGE ON SCHEMA "${schema}" TO ${role.username}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${role.username}`,
          );
          await admin.query(
            projections[index]!.replaceAll("public.", `${schema}.`),
          );
          for (const table of [
            "ConversationProcessing",
            "MemoryAutomaticSource",
            "MemoryAutomaticEntry",
          ]) {
            const {
              rows: [row],
            } = await admin.query(
              "SELECT has_table_privilege($1,$2,'SELECT') AS read, has_table_privilege($1,$2,'INSERT') AS insert, has_table_privilege($1,$2,'UPDATE') AS update, has_table_privilege($1,$2,'DELETE') AS delete",
              [role.username, `${schema}."${table}"`],
            );
            const conversation = table === "ConversationProcessing";
            expect(row).toEqual({
              read: conversation ? role.role === "api" : true,
              insert: conversation ? role.role === "api" : role.role !== "web",
              update: conversation ? role.role === "api" : true,
              delete: false,
            });
          }
        }
      } finally {
        for (const role of roles) {
          await admin.query(`DROP OWNED BY ${role.username}`);
          await admin.query(`DROP ROLE ${role.username}`);
        }
      }
    });
    it("claims one completed reply past recall capture expiry within the original deadline, with one winner under concurrency", async () => {
      const f = await fixture();
      try {
        const response = await f.app.inject({
          method: "POST",
          url: "/api/action/v2/conversations/process",
          headers: f.headers,
          payload: input,
        });
        const result = response.json(),
          record = await f.records.read(result.processingId);
        expect(result.status).toBe("ready");
        const later = new Date(Date.now() + 35_000);
        expect(
          Date.parse(
            JSON.parse(record!.boundManifest!).memory.captureExpiresAt,
          ),
        ).toBeLessThan(later.getTime());
        f.policies.capture = async () => {
          throw new Error("publication cannot recapture model/account/recall");
        };
        const claim = () =>
          claimCheckedConversationPublication(
            { records: f.records, sources: f.sources, now: () => later },
            result.processingId,
            result.reply.bodyDigest,
          );
        expect(
          (await Promise.all([claim(), claim()])).filter(Boolean),
        ).toHaveLength(1);
        expect((await f.records.read(result.processingId))!.result.status).toBe(
          "unknown",
        );
        expect(await claim()).toBe(false);
        expect(f.calls.filter((call) => call.kind === "request")).toHaveLength(
          1,
        );
      } finally {
        await f.app.close();
      }
    });
    it.each(["source", "policy"] as const)(
      "withdraws a frozen ready reply on changed %s without inference or publication",
      async (change) => {
        const f = await fixture();
        try {
          const result = await f.processor.execute(input, controls());
          expect(result.status).toBe("ready");
          if (change === "source")
            f.comments[1]!.body += " changed after the accepted reply";
          else
            await prisma.$executeRaw`UPDATE "ConversationAdmissionFence" SET "revision"=3 WHERE "kind"='policy'`;
          f.policies.capture = async () => {
            throw new Error(
              "publication cannot recapture model/account/recall",
            );
          };
          expect(
            await claimCheckedConversationPublication(
              { records: f.records, sources: f.sources, now: () => new Date() },
              result.processingId,
              result.reply!.bodyDigest,
            ),
          ).toBe(false);
          const current = (await f.records.read(result.processingId))!.result;
          expect(current.status).toBe("stale");
          expect(current.reply).toBeUndefined();
          expect(
            f.calls.filter((call) => call.kind === "request"),
          ).toHaveLength(1);
        } finally {
          await f.app.close();
        }
      },
    );
  },
);
