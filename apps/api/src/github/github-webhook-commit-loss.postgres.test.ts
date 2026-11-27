import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  registerGitHubWebhookRoutes,
  signGitHubWebhookPayload,
} from "@reviewrouter/features-github-installations";
import {
  createPrismaClient,
  runtimeDatabaseExecutionBudget,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { createMigratedTestDatabase } from "../../../../packages/platform/db/src/postgres-test-fixture";
import { startPostgresCommitLossProxy } from "../test-support/postgres-commit-loss-proxy";
import { createDefaultGitHubWebhookDependencies } from "./github-webhook-composition";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;
const secret = "disposable-commit-loss-webhook-secret";

describe.skipIf(!adminUrl)(
  "webhook database COMMIT acknowledgement loss",
  () => {
    let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
    let proxy: Awaited<ReturnType<typeof startPostgresCommitLossProxy>>;
    let writer: PrismaClient;
    let readback: PrismaClient;
    let app: FastifyInstance;
    let origin: string;

    beforeAll(async () => {
      database = await createMigratedTestDatabase(adminUrl!);
      readback = createPrismaClient({
        databaseUrl: database.databaseUrl,
        poolMax: 1,
      });
      proxy = await startPostgresCommitLossProxy(database.databaseUrl);
      writer = createPrismaClient({
        databaseUrl: proxy.databaseUrl,
        poolMax: 2,
        executionBudget: runtimeDatabaseExecutionBudget,
      });
      app = Fastify({ logger: false });
      await registerGitHubWebhookRoutes(
        app,
        createDefaultGitHubWebhookDependencies({
          webhookSecret: secret,
          prisma: writer,
          env: {},
        }),
      );
      origin = await app.listen({ host: "127.0.0.1", port: 0 });
    }, 120_000);

    afterAll(async () => {
      app?.server.closeAllConnections();
      await app?.close();
      await writer?.$disconnect();
      await proxy?.close();
      await readback?.$disconnect();
      await database?.cleanup();
    });

    it("returns opaque uncertainty, reads back the committed receipt, and redelivers without replaying effects", async () => {
      const installationId = 8_675_309;
      const actorId = 8_675_310;
      const accountLogin = "commit-loss-installation";
      const deliveryId = randomUUID();
      const body = JSON.stringify({
        action: "created",
        installation: {
          id: installationId,
          account: { login: accountLogin, type: "User" },
          repository_selection: "selected",
        },
        sender: { id: actorId, login: "commit-loss-owner" },
      });
      const send = async () => {
        const response = await fetch(`${origin}/webhooks/github`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-github-delivery": deliveryId,
            "x-github-event": "installation",
            "x-hub-signature-256": signGitHubWebhookPayload(body, secret),
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        return { status: response.status, body: await response.json() };
      };
      const state = async () => {
        const installation = await readback.gitHubInstallation.findUnique({
          where: { githubInstallationId: BigInt(installationId) },
        });
        const workspace = await readback.workspace.findUnique({
          where: { slug: `gh-user-${accountLogin}` },
        });
        const receipt = await readback.gitHubWebhookDelivery.findUnique({
          where: { deliveryId },
        });
        const outbox = await readback.outboxEvent.findMany({
          where: {
            idempotencyKey: `installation:${installationId}:sync:${deliveryId}`,
          },
          select: { id: true, type: true, payload: true, occurredAt: true },
        });
        const owners = await readback.workspaceMember.findMany({
          where: { workspaceId: workspace?.id ?? "missing", role: "owner" },
          select: { id: true, userId: true },
        });
        return { installation, workspace, receipt, outbox, owners };
      };

      proxy.dropNextCommit();
      expect(await send()).toEqual({
        status: 500,
        body: { error: "github_webhook_processing_failed" },
      });
      expect(proxy.droppedCommits).toBe(1);

      // This separate connection bypasses the proxy. It proves the server really
      // committed; neither a mocked transaction nor an HTTP-only abort suffices.
      const committed = await state();
      expect(committed.installation).toMatchObject({
        githubInstallationId: BigInt(installationId),
        status: "active",
      });
      expect(committed.workspace).toMatchObject({
        slug: `gh-user-${accountLogin}`,
      });
      expect(committed.receipt).toMatchObject({
        deliveryId,
        eventName: "installation",
        status: "processed",
        processedAt: expect.any(Date),
      });
      expect(committed.outbox).toEqual([
        expect.objectContaining({
          type: "installation.sync_requested",
          payload: {
            installationId: String(installationId),
            reason: "installation_access_changed",
          },
        }),
      ]);
      expect(committed.owners).toHaveLength(1);

      // The same API instance and pool must recover their dropped connection.
      expect(await send()).toEqual({ status: 200, body: { processed: false } });
      expect(proxy.droppedCommits).toBe(1);
      expect(proxy.acceptedConnections).toBeGreaterThanOrEqual(2);
      expect(await state()).toEqual(committed);
    });
  },
);
