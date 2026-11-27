import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import {
  encryptServerToken,
  saveGitHubUserAuthorizationFromAccount,
} from "@reviewrouter/features-auth";
import {
  claimVerifiedFencedWebhookDelivery,
  createGitHubAppWebhookVerifier,
  failWebhookFencedDelivery,
  registerGitHubWebhookRoutes,
  renewWebhookFence,
} from "@reviewrouter/features-github-installations";
import Fastify, { type FastifyInstance } from "fastify";
import { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from "vitest";
import {
  assertWebhookFenceTestDatabase,
  webhookFencePostgres,
} from "../../../../scripts/webhook-fencing/postgres-fixture";
import { createDefaultGitHubWebhookDependencies } from "./github-webhook-composition";

const test = webhookFencePostgres.enabled ? describe : describe.skip;
const webhookSecret = "synthetic-production-webhook-secret";
const appSlug = "synthetic-webhook-app";
const headSha = "b".repeat(40);
const baseEnvironment = {
  GITHUB_APP_ID: "42",
  GITHUB_APP_SLUG: appSlug,
  GITHUB_API_BASE_URL: "https://api.github.com",
  REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY: "synthetic-http-auth-encryption-key-1027",
  REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK: "1",
  REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "1",
  REVIEW_ROUTER_REVIEW_V2_WORKFLOW_DISPATCH_READY: "1",
  REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED: "1",
  REVIEW_ROUTER_OUTBOX_FENCED_TAKEOVER_ENABLED: "1",
} as const;

test("production signed GitHub HTTP with the complete migrated schema", () => {
  // The qualification runner supplies a dedicated local disposable database.
  // No model, foreign key, migration trigger, parser, claim or effect is replaced.
  const applicationName = "webhook_http_" + randomBytes(6).toString("hex");
  const pool = new Pool({
    ...webhookFencePostgres.connection,
    max: 8,
    // Prisma timestamps carry UTC values even when the DB session is not UTC.
    options: "-c search_path=public -c timezone=Asia/Tokyo",
    application_name: applicationName,
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool, { schema: "public" }),
    // This fixture must hold the expiry race across a real ten-second threshold;
    // production transaction timeouts and the five-minute refresh skew stay intact.
    transactionOptions: { timeout: 15_000 },
  });
  const servers: FastifyInstance[] = [];
  type TokenProbe = {
    status: number;
    body: unknown;
    requests: number;
    disconnect?: boolean;
    beforeResponse?: () => Promise<void>;
  };
  const tokenProbes = new Map<string, TokenProbe>();
  const processingErrors = new Map<string, unknown>();
  const responseGates = new Map<string, () => Promise<void>>();
  let githubOrigin = "";
  let address: string;
  let otherAppAddress: string;
  let ingressDisabledAddress: string;
  let fallbackDisabledAddress: string;
  let malformedFallbackAddress: string;

  async function startServer(
    overrides: Readonly<Record<string, string>> = {},
    receiverPrisma: PrismaClient = prisma,
  ): Promise<string> {
    const app = Fastify({ logger: false });
    servers.push(app);
    const dependencies = createDefaultGitHubWebhookDependencies({
      prisma: receiverPrisma,
      webhookSecret,
      env: { ...baseEnvironment, ...overrides },
      githubUserAuthorizationFetch: async (resource, options) => {
        expect(String(resource)).toBe("https://api.github.com/user");
        expect(options?.method).toBe("GET");
        return fetch(githubOrigin + "/user", options);
      },
    });
    if (!dependencies.processor)
      throw new Error("production_webhook_processor_required");
    const processor = dependencies.processor;
    await registerGitHubWebhookRoutes(app, {
      ...dependencies,
      processor: {
        ...processor,
        async process(envelope, verification) {
          try {
            const result = await processor.process(envelope, verification);
            await responseGates.get(envelope.deliveryId)?.();
            return result;
          } catch (error) {
            // Observe the real cause before the HTTP adapter makes it opaque.
            processingErrors.set(envelope.deliveryId, error);
            throw error;
          }
        },
      },
    });
    return app.listen({ host: "127.0.0.1", port: 0 });
  }

  beforeAll(async () => {
    await assertWebhookFenceTestDatabase(pool);
    expect((await pool.query("SHOW timezone")).rows[0]?.TimeZone).toBe(
      "Asia/Tokyo",
    );
    const directory = new URL(
      "../../../../packages/platform/db/prisma/migrations/",
      import.meta.url,
    );
    const expected = readdirSync(directory)
      .filter((name) => /^\d{6}_/u.test(name))
      .sort()
      .map((name) => ({
        name,
        checksum: createHash("sha256")
          .update(readFileSync(new URL(name + "/migration.sql", directory)))
          .digest("hex"),
      }));
    expect(expected.length).toBeGreaterThanOrEqual(172);
    expect(expected.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "000165_webhook_effect_fence",
        "000167_webhook_recovery_intent",
      ]),
    );
    const applied = await pool.query(
      'SELECT migration_name AS name, checksum FROM "_prisma_migrations" ' +
        "WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
    );
    expect(applied.rows).toEqual(expected);
    const github = Fastify({ logger: false });
    servers.push(github);
    github.get("/user", async (request, reply) => {
      const probe = tokenProbes.get(request.headers.authorization ?? "");
      if (!probe) throw new Error("unexpected_synthetic_user_token");
      probe.requests++;
      await probe.beforeResponse?.();
      if (probe.disconnect) {
        reply.hijack();
        reply.raw.destroy();
        return reply;
      }
      return reply.code(probe.status).send(probe.body);
    });
    githubOrigin = await github.listen({ host: "127.0.0.1", port: 0 });
    address = await startServer();
    otherAppAddress = await startServer({ GITHUB_APP_ID: "43" });
    ingressDisabledAddress = await startServer({
      REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "0",
    });
    fallbackDisabledAddress = await startServer({
      REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK: "0",
    });
    malformedFallbackAddress = await startServer({
      REVIEW_ROUTER_CONFLICT_REVIEW_FALLBACK_REPOSITORIES: "not-a-repository",
    });
  }, 30_000);

  afterAll(async () => {
    const serversClosed = await Promise.allSettled(
      servers.map((server) => server.close()),
    );
    const databaseClosed = await Promise.allSettled([
      prisma.$disconnect(),
      pool.end(),
    ]);
    const errors = [...serversClosed, ...databaseClosed].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(errors, "production webhook teardown failed");
    // Fenced receipts are intentionally retained. The disposable database owner
    // removes the database after qualification, never bypassing its delete guard.
  });

  async function fixture() {
    const suffix = randomBytes(6).toString("hex");
    const githubInstallationId = Number.parseInt(suffix, 16) + 1;
    const githubRepositoryId =
      Number.parseInt(randomBytes(6).toString("hex"), 16) + 1;
    const account = "fence-" + suffix;
    const workspace = await prisma.workspace.create({
      data: { slug: "http-" + suffix, name: account },
    });
    const installation = await prisma.gitHubInstallation.create({
      data: {
        workspaceId: workspace.id,
        githubInstallationId: BigInt(githubInstallationId),
        accountLogin: account,
        accountType: "Organization",
        repositorySelection: "selected",
        status: "active",
      },
    });
    const repository = await prisma.repositoryConnection.create({
      data: {
        workspaceId: workspace.id,
        installationId: installation.id,
        externalRepositoryId: String(githubRepositoryId),
        githubRepositoryId: BigInt(githubRepositoryId),
        owner: account,
        name: "widget",
        fullName: account + "/widget",
        defaultBranch: "main",
        visibility: "public",
      },
    });
    return {
      workspace,
      installation,
      repository,
      githubInstallationId,
      githubRepositoryId,
      account,
    };
  }

  type Fixture = Awaited<ReturnType<typeof fixture>>;

  async function seedPermissionCache(
    value: Fixture,
    userId: string,
    revision: number,
    authorizationAppSlug: string = appSlug,
  ) {
    return prisma.repositoryPermissionCache.create({
      data: {
        userId,
        repositoryId: value.repository.id,
        githubInstallationId: BigInt(value.githubInstallationId),
        authorizationAppSlug,
        authorizationRevision: revision,
        canManage: true,
        checkedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  }

  async function authorizationFixture(expiresIn: number | null = 3_600) {
    const value = await fixture();
    const githubUserId = BigInt(
      Number.parseInt(randomBytes(6).toString("hex"), 16) + 1,
    );
    const user = await prisma.user.create({ data: { githubUserId } });
    const token = "synthetic-current-token-" + randomUUID();
    const principal = {
      userId: user.id,
      provider: "github" as const,
      externalUserId: String(githubUserId),
      login: "synthetic-user",
      githubUserId: String(githubUserId),
    };
    expect(
      await saveGitHubUserAuthorizationFromAccount({
        prisma,
        principal,
        env: baseEnvironment,
        account: {
          access_token: token,
          ...(expiresIn === null
            ? {}
            : expiresIn < 0
              ? { expires_at: Math.floor(Date.now() / 1_000) + expiresIn }
              : { expires_in: expiresIn }),
        },
      }),
    ).toBe("saved");
    const authorization =
      await prisma.gitHubUserAuthorization.findUniqueOrThrow({
        where: { userId_appSlug: { userId: user.id, appSlug } },
      });
    const cache = await seedPermissionCache(
      value,
      user.id,
      authorization.revision,
    );
    const probe: TokenProbe = {
      status: 401,
      body: { id: Number(githubUserId) },
      requests: 0,
    };
    tokenProbes.set("Bearer " + token, probe);
    const payload = {
      action: "revoked",
      sender: { id: Number(githubUserId), login: principal.login },
    };
    return {
      value,
      user,
      authorization,
      cache,
      token,
      probe,
      payload,
      principal,
    };
  }

  function repositoryPayload(value: Fixture) {
    return {
      id: value.githubRepositoryId,
      name: value.repository.name,
      full_name: value.repository.fullName,
    };
  }

  function installationPayload(value: Fixture, action: string) {
    return {
      action,
      installation: {
        id: value.githubInstallationId,
        account: { login: value.account, type: "Organization" },
        repository_selection: "selected",
      },
    };
  }

  function pushPayload(value: Fixture) {
    return {
      installation: { id: value.githubInstallationId },
      repository: repositoryPayload(value),
      ref: "refs/heads/main",
      deleted: false,
    };
  }

  function pullRequestPayload(value: Fixture, merged = false) {
    return {
      installation: { id: value.githubInstallationId },
      repository: repositoryPayload(value),
      action: merged ? "closed" : "opened",
      pull_request: {
        number: 7,
        html_url: "https://github.com/" + value.repository.fullName + "/pull/7",
        state: merged ? "closed" : "open",
        merged,
        draft: false,
        user: { type: "User" },
        base: { ref: "main", sha: "c".repeat(40) },
        head: {
          ref: "reviewrouter/setup",
          sha: headSha,
          repo: { full_name: value.repository.fullName },
        },
      },
    };
  }

  function signature(body: string) {
    return (
      "sha256=" + createHmac("sha256", webhookSecret).update(body).digest("hex")
    );
  }

  async function post(
    eventName: string,
    deliveryId: string,
    payload: unknown,
    options: Readonly<{
      address?: string;
      signature?: string;
      signal?: AbortSignal;
    }> = {},
  ): Promise<{ status: number; body: unknown }> {
    const body = JSON.stringify(payload);
    const response = await fetch(
      (options.address ?? address) + "/webhooks/github",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": eventName,
          "x-github-delivery": deliveryId,
          "x-hub-signature-256": options.signature ?? signature(body),
        },
        body,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      },
    );
    return { status: response.status, body: await response.json() };
  }

  function receipt(deliveryId: string) {
    return prisma.gitHubWebhookDelivery.findUnique({ where: { deliveryId } });
  }

  function conflictKey(deliveryId: string) {
    return "conflict-review:detect:delivery:" + deliveryId;
  }

  function ingressKey(deliveryId: string) {
    const digest = createHash("sha256")
      .update(
        "rr.github-review-request-ingress-source.v1\0github-webhook:" +
          deliveryId,
      )
      .digest("hex");
    return "github-review-request-ingress:v1:" + digest;
  }

  function outbox(idempotencyKey: string) {
    return prisma.outboxEvent.findUnique({ where: { idempotencyKey } });
  }

  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  async function waitForBlockedQuery(
    pattern: string,
    advisoryKey?: number,
  ): Promise<number> {
    for (let attempt = 0; attempt < 150; attempt++) {
      const result = await pool.query<{ pid: number }>(
        "SELECT DISTINCT a.pid FROM pg_stat_activity a " +
          "JOIN pg_locks l ON l.pid = a.pid " +
          "WHERE a.datname = current_database() " +
          "AND a.application_name = $1 AND a.wait_event_type = 'Lock' " +
          "AND NOT l.granted AND a.query LIKE $2 " +
          "AND ($3::bigint IS NULL OR (l.locktype = 'advisory' " +
          "AND l.classid = 0 AND l.objid = $3::oid AND l.objsubid = 1))",
        [applicationName, pattern, advisoryKey ?? null],
      );
      if (result.rows.length === 1) return result.rows[0]!.pid;
      if (result.rows.length > 1)
        throw new Error("webhook_fixture_multiple_waiters");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("webhook_fixture_lock_wait_missing");
  }

  async function rejectTerminal(deliveryId: string) {
    // Both identifiers are generated here; the constraint affects only this
    // receipt. All real schema constraints and triggers remain in place.
    const constraint =
      "webhook_http_terminal_" + randomBytes(6).toString("hex");
    await pool.query(
      'ALTER TABLE "GitHubWebhookDelivery" ADD CONSTRAINT "' +
        constraint +
        '" CHECK ("deliveryId" <> ' +
        "'" +
        deliveryId +
        "'" +
        " OR status <> 'processed')",
    );
    const restore = async () => {
      await pool.query(
        'ALTER TABLE "GitHubWebhookDelivery" DROP CONSTRAINT IF EXISTS "' +
          constraint +
          '"',
      );
    };
    // Vitest records cleanup errors alongside an existing body failure.
    onTestFinished(restore);
    return { constraint, restore };
  }

  it("rejects required ingress admission at startup even when run control is disabled", () => {
    const env = {
      ...baseEnvironment,
      REVIEW_ROUTER_REVIEW_V2_RUN_CONTROL_ENABLED: "0",
      REVIEW_ROUTER_REVIEW_V2_INTENT_INGRESS_ENABLED: "0",
      REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED: "1",
    };
    expect(() =>
      createDefaultGitHubWebhookDependencies({ prisma, webhookSecret, env }),
    ).toThrow("review_action_v2_intent_admission_without_ingress");
    expect(
      createDefaultGitHubWebhookDependencies({
        prisma,
        webhookSecret,
        env: { ...env, REVIEW_ROUTER_REVIEW_V2_INTENT_ADMISSION_REQUIRED: "0" },
      }).processor,
    ).toBeDefined();
  });

  it("routes installation creation through owner membership and the sync outbox", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const senderId = Number.parseInt(randomBytes(6).toString("hex"), 16) + 1;
    const payload = {
      action: "created",
      installation: {
        id: value.githubInstallationId,
        account: { login: value.account, type: "Organization" },
        repository_selection: "selected",
      },
      sender: { id: senderId, login: "owner-" + senderId },
    };
    expect((await post("installation", deliveryId, payload)).status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({
      where: { githubUserId: BigInt(senderId) },
    });
    expect(
      await prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: value.workspace.id,
            userId: user.id,
          },
        },
      }),
    ).toMatchObject({ role: "owner" });
    expect(
      await outbox(
        "installation:" + value.githubInstallationId + ":sync:" + deliveryId,
      ),
    ).toMatchObject({ type: "installation.sync_requested", status: "pending" });
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      eventName: "installation",
    });
  });

  it("routes installation repository changes through the existing sync command", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    expect(
      (
        await post("installation_repositories", deliveryId, {
          action: "added",
          installation: {
            id: value.githubInstallationId,
            account: { login: value.account, type: "Organization" },
            repository_selection: "selected",
          },
          repository_selection: "all",
          repositories_added: [repositoryPayload(value)],
        })
      ).status,
    ).toBe(200);
    expect(
      await prisma.gitHubInstallation.findUniqueOrThrow({
        where: { id: value.installation.id },
      }),
    ).toMatchObject({ status: "active", repositorySelection: "all" });
    expect(
      await outbox(
        "installation:" + value.githubInstallationId + ":sync:" + deliveryId,
      ),
    ).toMatchObject({ type: "installation.sync_requested" });
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      eventName: "installation_repositories",
    });
  });

  it.each([
    { eventName: "installation", action: "created", status: "active" },
    { eventName: "installation", action: "deleted", status: "removed" },
    {
      eventName: "installation",
      action: "new_permissions_accepted",
      status: "active",
    },
    { eventName: "installation", action: "suspend", status: "suspended" },
    { eventName: "installation", action: "unsuspend", status: "active" },
    {
      eventName: "installation_repositories",
      action: "added",
      status: "active",
    },
    {
      eventName: "installation_repositories",
      action: "removed",
      status: "active",
    },
  ] as const)(
    "binds signed $eventName.$action to its event family before claiming",
    async ({ eventName, action, status }) => {
      const value = await fixture();
      const before = await prisma.gitHubInstallation.update({
        where: { id: value.installation.id },
        data: { status: "suspended" },
      });
      const payload = installationPayload(value, action);
      const forgedDeliveryId = randomUUID();
      const forgedEventName =
        eventName === "installation"
          ? "installation_repositories"
          : "installation";
      // The body and its valid HMAC are unchanged; only the unsigned event
      // header attempts to route it through a different lifecycle handler.
      expect(await post(forgedEventName, forgedDeliveryId, payload)).toEqual({
        status: 400,
        body: { error: "invalid_webhook_payload" },
      });
      expect(await receipt(forgedDeliveryId)).toBeNull();
      expect(
        await prisma.gitHubWebhookFence.findUnique({
          where: { deliveryId: forgedDeliveryId },
        }),
      ).toBeNull();
      expect(
        await prisma.gitHubInstallation.findUniqueOrThrow({
          where: { id: value.installation.id },
        }),
      ).toEqual(before);
      expect(
        await prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: value.repository.id },
        }),
      ).toEqual(value.repository);
      expect(
        await outbox(
          "installation:" +
            value.githubInstallationId +
            ":sync:" +
            forgedDeliveryId,
        ),
      ).toBeNull();

      const deliveryId = randomUUID();
      expect((await post(eventName, deliveryId, payload)).status).toBe(200);
      expect(await receipt(deliveryId)).toMatchObject({
        status: "processed",
        eventName,
        action,
      });
      expect(
        await prisma.gitHubInstallation.findUniqueOrThrow({
          where: { id: value.installation.id },
        }),
      ).toMatchObject({ status });
      const sync = await outbox(
        "installation:" + value.githubInstallationId + ":sync:" + deliveryId,
      );
      if (status === "active")
        expect(sync).toMatchObject({ type: "installation.sync_requested" });
      else expect(sync).toBeNull();
    },
  );

  it.each(["installation", "installation_repositories"] as const)(
    "refuses unknown signed %s actions before claiming",
    async (eventName) => {
      const value = await fixture();
      const deliveryId = randomUUID();
      expect(
        await post(
          eventName,
          deliveryId,
          installationPayload(value, "unexpected"),
        ),
      ).toEqual({ status: 400, body: { error: "invalid_webhook_payload" } });
      expect(await receipt(deliveryId)).toBeNull();
      expect(
        await prisma.gitHubInstallation.findUniqueOrThrow({
          where: { id: value.installation.id },
        }),
      ).toEqual(value.installation);
      expect(
        await outbox(
          "installation:" + value.githubInstallationId + ":sync:" + deliveryId,
        ),
      ).toBeNull();
    },
  );

  it("routes repository metadata changes through the current repository binding", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    expect(
      (
        await post("repository", deliveryId, {
          action: "renamed",
          installation: { id: value.githubInstallationId },
          repository: {
            ...repositoryPayload(value),
            name: "renamed",
            full_name: value.account + "/renamed",
            owner: { login: value.account },
            default_branch: "main",
            private: true,
            archived: false,
            updated_at: "2026-11-27T00:00:00Z",
          },
          changes: { repository: { name: { from: "widget" } } },
        })
      ).status,
    ).toBe(200);
    expect(
      await prisma.repositoryConnection.findUniqueOrThrow({
        where: { id: value.repository.id },
      }),
    ).toMatchObject({
      fullName: value.account + "/renamed",
      visibility: "private",
    });
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      eventName: "repository",
    });
  });

  it.each(["default", "malformed_allowlist"] as const)(
    "persists PR ingress and completes the matched setup with %s fallback configuration",
    async (configuration) => {
      const value = await fixture();
      const deliveryId = randomUUID();
      const payload = pullRequestPayload(value, true);
      await prisma.workflowProvisioning.create({
        data: {
          workspaceId: value.workspace.id,
          repositoryId: value.repository.id,
          installationId: value.installation.id,
          status: "setup_pr_open",
          branch: payload.pull_request.head.ref,
          workflowPath: ".github/workflows/reviewrouter-review.yml",
          workflowStyle: "reusable",
          actionVersion: "workflow-v1",
          pullRequestHeadSha: headSha,
          pullRequestUrl: payload.pull_request.html_url,
          attemptWorkflowRequirement: "ci_secrets",
        },
      });
      expect(
        (
          await post("pull_request", deliveryId, payload, {
            address:
              configuration === "default" ? address : malformedFallbackAddress,
          })
        ).status,
      ).toBe(200);
      expect(await outbox(ingressKey(deliveryId))).toMatchObject({
        status: "pending",
        payload: { commandKind: "cancel" },
      });
      expect(
        await prisma.workflowProvisioning.findUniqueOrThrow({
          where: { repositoryId: value.repository.id },
        }),
      ).toMatchObject({
        status: "configured",
        revision: 1,
        installedWorkflowRequirement: "ci_secrets",
      });
      expect(await receipt(deliveryId)).toMatchObject({
        status: "processed",
        eventName: "pull_request",
      });
    },
  );

  it("evaluates the fallback allowlist when an open PR requests conflict work", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    expect(
      await post("pull_request", deliveryId, pullRequestPayload(value), {
        address: malformedFallbackAddress,
      }),
    ).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
    expect(await outbox(ingressKey(deliveryId))).toMatchObject({
      payload: { commandKind: "request" },
    });
    expect(await outbox(conflictKey(deliveryId))).toBeNull();
  });

  it("routes push to exactly one existing conflict outbox command", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    expect(await post("push", deliveryId, pushPayload(value))).toMatchObject({
      status: 200,
      body: { processed: true, queued: true },
    });
    expect(await outbox(conflictKey(deliveryId))).toMatchObject({
      status: "pending",
      payload: { source: "base_push", deliveryId, baseRef: "main" },
    });
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      eventName: "push",
    });
  });

  it("revokes only the configured App authorization and removes its permission cache", async () => {
    const f = await authorizationFixture();
    const deliveryId = randomUUID();
    const unrelated = await prisma.gitHubUserAuthorization.create({
      data: {
        userId: f.user.id,
        githubUserId: f.authorization.githubUserId,
        appSlug: "other-app",
        encryptedAccessToken: encryptServerToken(
          "synthetic-other-token",
          baseEnvironment,
        ),
      },
    });
    const unrelatedCache = await seedPermissionCache(
      await fixture(),
      f.user.id,
      unrelated.revision,
      "other-app",
    );
    expect(
      (await post("github_app_authorization", deliveryId, f.payload)).status,
    ).toBe(200);
    expect(
      await prisma.gitHubUserAuthorization.findUniqueOrThrow({
        where: { id: f.authorization.id },
      }),
    ).toMatchObject({ revokedAt: expect.any(Date), revision: 1 });
    expect(
      await prisma.gitHubUserAuthorization.findUniqueOrThrow({
        where: { id: unrelated.id },
      }),
    ).toMatchObject({ revokedAt: null, revision: 0 });
    expect(
      await prisma.repositoryPermissionCache.count({
        where: { userId: f.user.id, authorizationAppSlug: appSlug },
      }),
    ).toBe(0);
    expect(
      await prisma.repositoryPermissionCache.findUniqueOrThrow({
        where: { id: unrelatedCache.id },
      }),
    ).toEqual(unrelatedCache);
    expect(f.probe.requests).toBe(1);
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      eventName: "github_app_authorization",
    });
  });

  it("preserves a reconnected authorization when a captured signed body arrives with a fresh GUID", async () => {
    const f = await authorizationFixture();
    expect(
      (await post("github_app_authorization", randomUUID(), f.payload)).status,
    ).toBe(200);
    const freshToken = "synthetic-reconnected-" + randomUUID();
    expect(
      await saveGitHubUserAuthorizationFromAccount({
        prisma,
        principal: f.principal,
        env: baseEnvironment,
        account: { access_token: freshToken, expires_in: 3_600 },
      }),
    ).toBe("saved");
    const current = await prisma.gitHubUserAuthorization.findUniqueOrThrow({
      where: { id: f.authorization.id },
    });
    expect(current).toMatchObject({ revokedAt: null, revision: 2 });
    const cache = await seedPermissionCache(
      f.value,
      f.user.id,
      current.revision,
    );
    const probe: TokenProbe = {
      status: 200,
      body: { id: Number(current.githubUserId) },
      requests: 0,
    };
    tokenProbes.set("Bearer " + freshToken, probe);
    const deliveryId = randomUUID();
    expect(
      await post("github_app_authorization", deliveryId, f.payload),
    ).toMatchObject({
      status: 200,
      body: { ignored: true, reason: "authorization_still_valid" },
    });
    expect(
      await prisma.gitHubUserAuthorization.findUniqueOrThrow({
        where: { id: current.id },
      }),
    ).toEqual(current);
    expect(
      await prisma.repositoryPermissionCache.findUniqueOrThrow({
        where: { id: cache.id },
      }),
    ).toEqual(cache);
    expect(probe.requests).toBe(1);
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId },
      }),
    ).toMatchObject({ generation: 1n });
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
  });

  it.each(["reconnect", "refresh_admission"] as const)(
    "refuses a delayed token rejection after %s advances current authority",
    async (change) => {
      const f = await authorizationFixture();
      const deliveryId = randomUUID();
      let observed!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      f.probe.beforeResponse = async () => {
        observed();
        await gate;
      };
      const pending = post("github_app_authorization", deliveryId, f.payload);
      void pending.catch(() => undefined);
      onTestFinished(async () => {
        release();
        await pending;
      });
      let current: typeof f.authorization;
      let cache: typeof f.cache;
      try {
        await Promise.race([
          entered,
          pending.then(() => {
            throw new Error("synthetic_probe_not_observed");
          }),
        ]);
        if (change === "reconnect") {
          expect(
            await saveGitHubUserAuthorizationFromAccount({
              prisma,
              principal: f.principal,
              env: baseEnvironment,
              account: {
                access_token: "synthetic-reconnected-" + randomUUID(),
                expires_in: 3_600,
              },
            }),
          ).toBe("saved");
        } else {
          // The existing refresh owner advances revision before its external POST.
          await prisma.gitHubUserAuthorization.update({
            where: { id: f.authorization.id },
            data: {
              revision: { increment: 1 },
              refreshAttemptId: randomUUID(),
              lastErrorCode: "github_user_token_refresh_in_progress",
            },
          });
        }
        current = await prisma.gitHubUserAuthorization.findUniqueOrThrow({
          where: { id: f.authorization.id },
        });
        cache = await prisma.repositoryPermissionCache.update({
          where: { id: f.cache.id },
          data: {
            authorizationRevision: current.revision,
            checkedAt: new Date(),
          },
        });
      } finally {
        release();
      }
      const result = await pending;
      expect(result).toEqual({
        status: 500,
        body: { error: "github_webhook_processing_failed" },
      });
      expect(
        await prisma.gitHubUserAuthorization.findUniqueOrThrow({
          where: { id: current.id },
        }),
      ).toEqual(current);
      expect(
        await prisma.repositoryPermissionCache.findUniqueOrThrow({
          where: { id: cache.id },
        }),
      ).toEqual(cache);
      expect(f.probe.requests).toBe(1);
      expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
    },
  );

  it("rechecks database expiry after waiting for the authorization row lock", async () => {
    const f = await authorizationFixture(310);
    const expiresAt = f.authorization.accessTokenExpiresAt?.toISOString();
    if (!expiresAt) throw new Error("synthetic_authorization_expiry_missing");
    const deliveryId = randomUUID();
    let locked!: (pid: number) => void;
    let release!: () => void;
    const ready = new Promise<number>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = prisma.$transaction(
      async (transaction) => {
        const rows = await transaction.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_backend_pid() AS pid FROM "GitHubUserAuthorization"
          WHERE id = ${f.authorization.id} FOR UPDATE`;
        if (!rows[0]) throw new Error("authorization_blocker_missing");
        locked(rows[0].pid);
        await gate;
      },
      { isolationLevel: "ReadCommitted", timeout: 15_000 },
    );
    void blocker.catch(() => undefined);
    const startedTasks: Promise<unknown>[] = [blocker];
    onTestFinished(async () => {
      release();
      const settled = await Promise.allSettled(startedTasks);
      const errors = settled.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "authorization expiry cleanup failed");
    });
    const blockerPid = await Promise.race([
      ready,
      blocker.then(() => {
        throw new Error("authorization_lock_not_observed");
      }),
    ]);
    const pending = post("github_app_authorization", deliveryId, f.payload);
    void pending.catch(() => undefined);
    startedTasks.push(pending);
    const effectIsBlocked = async () => {
      const result = await pool.query<{ blocked: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))) AS blocked",
        [blockerPid],
      );
      return result.rows[0]?.blocked === true;
    };
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 80 && !blocked; attempt++) {
        blocked = await effectIsBlocked();
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      const beforeExpiry = await pool.query<{ eligible: boolean }>(
        "SELECT $1::timestamp > (clock_timestamp() AT TIME ZONE 'UTC') + interval '5 minutes' AS eligible",
        [expiresAt],
      );
      expect(beforeExpiry.rows[0]?.eligible).toBe(true);
      // Cross the real database's refresh threshold without changing any row.
      await pool.query(
        "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM ($1::timestamp - interval '5 minutes' - (clock_timestamp() AT TIME ZONE 'UTC')))) + 0.05)",
        [expiresAt],
      );
      expect(await effectIsBlocked()).toBe(true);
    } finally {
      release();
    }
    await blocker;
    const result = await pending;
    expect(result).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(processingErrors.get(deliveryId)).toMatchObject({
      message: "github_app_authorization_reconciliation_required",
    });
    expect(f.probe.requests).toBe(1);
    expect(
      await prisma.gitHubUserAuthorization.findUniqueOrThrow({
        where: { id: f.authorization.id },
      }),
    ).toEqual(f.authorization);
    expect(
      await prisma.repositoryPermissionCache.findUniqueOrThrow({
        where: { id: f.cache.id },
      }),
    ).toEqual(f.cache);
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
  }, 20_000);

  it.each([
    { name: "forbidden", status: 403, body: {} },
    { name: "server error", status: 500, body: {} },
    { name: "malformed user", status: 200, body: "invalid-json" },
    { name: "another user", status: 200, body: { id: 1 } },
    { name: "transport failure", status: 200, body: {}, disconnect: true },
  ])("preserves the current grant and cache on $name", async (response) => {
    const f = await authorizationFixture();
    Object.assign(f.probe, response);
    if (response.name === "another user")
      f.probe.body = { id: Number(f.authorization.githubUserId) + 1 };
    const deliveryId = randomUUID();
    expect(
      await post("github_app_authorization", deliveryId, f.payload),
    ).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(f.probe.requests).toBeGreaterThan(0);
    expect(
      await prisma.gitHubUserAuthorization.findUniqueOrThrow({
        where: { id: f.authorization.id },
      }),
    ).toEqual(f.authorization);
    expect(
      await prisma.repositoryPermissionCache.findUniqueOrThrow({
        where: { id: f.cache.id },
      }),
    ).toEqual(f.cache);
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
  });

  it.each([
    { name: "unknown expiry", expiresIn: null },
    { name: "near expiry", expiresIn: 299 },
    { name: "expired token", expiresIn: -60 },
  ])("requires reconciliation without probing $name", async ({ expiresIn }) => {
    const f = await authorizationFixture(expiresIn);
    const deliveryId = randomUUID();
    expect(
      await post("github_app_authorization", deliveryId, f.payload),
    ).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(f.probe.requests).toBe(0);
    expect(
      await prisma.gitHubUserAuthorization.findUniqueOrThrow({
        where: { id: f.authorization.id },
      }),
    ).toEqual(f.authorization);
    expect(
      await prisma.repositoryPermissionCache.findUniqueOrThrow({
        where: { id: f.cache.id },
      }),
    ).toEqual(f.cache);
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
  });

  it("rejects invalid signatures and signed invalid payloads before creating a receipt", async () => {
    const value = await fixture();
    const invalidSignatureId = randomUUID();
    expect(
      await post("push", invalidSignatureId, pushPayload(value), {
        signature: "sha256=" + "0".repeat(64),
      }),
    ).toEqual({ status: 401, body: { error: "invalid_signature" } });
    expect(await receipt(invalidSignatureId)).toBeNull();
    const invalidPayloadId = randomUUID();
    expect(
      await post("push", invalidPayloadId, { ...pushPayload(value), ref: "" }),
    ).toEqual({ status: 400, body: { error: "invalid_webhook_payload" } });
    expect(await receipt(invalidPayloadId)).toBeNull();
  });

  it("acknowledges an exact processed duplicate but rejects changed body or configured App", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pushPayload(value);
    expect((await post("push", deliveryId, payload)).status).toBe(200);
    const before = await receipt(deliveryId);
    expect(await post("push", deliveryId, payload)).toEqual({
      status: 200,
      body: { processed: false },
    });
    expect(
      await post("push", deliveryId, { ...payload, ref: "refs/heads/changed" }),
    ).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(
      await post("push", deliveryId, payload, { address: otherAppAddress }),
    ).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(await receipt(deliveryId)).toEqual(before);
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: conflictKey(deliveryId) },
      }),
    ).toBe(1);
  });

  it.each(["processing", "failed"] as const)(
    "never adopts a legacy %s receipt",
    async (status) => {
      const value = await fixture();
      const deliveryId = randomUUID();
      const payload = pushPayload(value);
      await prisma.gitHubWebhookDelivery.create({
        data: {
          deliveryId,
          eventName: "push",
          action: "push",
          status,
          installationId: BigInt(value.githubInstallationId),
          payloadHash: createHash("sha256")
            .update(JSON.stringify(payload))
            .digest("hex"),
        },
      });
      expect(await post("push", deliveryId, payload)).toEqual({
        status: 500,
        body: { error: "github_webhook_processing_failed" },
      });
      expect(await receipt(deliveryId)).toMatchObject({ status });
      expect(
        await prisma.gitHubWebhookFence.findUnique({ where: { deliveryId } }),
      ).toBeNull();
      expect(await outbox(conflictKey(deliveryId))).toBeNull();
    },
  );

  it("returns a transient failure for a live concurrent duplicate and commits one effect", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pullRequestPayload(value);
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = prisma.$transaction(
      async (transaction) => {
        await acquireCurrentScopeGuards(transaction, [
          { scope: "global", mode: "exclusive" },
        ]);
        entered();
        await gate;
      },
      { isolationLevel: "ReadCommitted", timeout: 10_000 },
    );
    void writer.catch(() => undefined);
    const startedTasks: Promise<unknown>[] = [writer];
    onTestFinished(async () => {
      release();
      const settled = await Promise.allSettled(startedTasks);
      const errors = settled.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "concurrent delivery cleanup failed");
    });
    await Promise.race([
      ready,
      writer.then(() => {
        throw new Error("concurrent_delivery_writer_did_not_reach_gate");
      }),
    ]);
    const first = post("pull_request", deliveryId, payload, {
      address: ingressDisabledAddress,
    });
    void first.catch(() => undefined);
    startedTasks.push(first);
    try {
      let claimed = false;
      for (let attempt = 0; attempt < 150 && !claimed; attempt++) {
        claimed = (await receipt(deliveryId))?.status === "processing";
        if (!claimed) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(claimed).toBe(true);
      expect(await outbox(conflictKey(deliveryId))).toBeNull();
      expect(
        await post("pull_request", deliveryId, payload, {
          address: ingressDisabledAddress,
        }),
      ).toEqual({
        status: 500,
        body: { error: "github_webhook_processing_failed" },
      });
    } finally {
      release();
    }
    await writer;
    const firstResult = await first;
    expect(firstResult?.status).toBe(200);
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: conflictKey(deliveryId) },
      }),
    ).toBe(1);
    expect(await outbox(ingressKey(deliveryId))).toBeNull();
  }, 15_000);

  it("preserves one committed effect when the client loses the HTTP response", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pushPayload(value);
    const committed = deferred();
    const releaseResponse = deferred();
    const controller = new AbortController();
    responseGates.set(deliveryId, async () => {
      committed.resolve();
      await releaseResponse.promise;
    });
    const lost = post("push", deliveryId, payload, {
      signal: controller.signal,
    }).catch((error: unknown) => error);
    onTestFinished(async () => {
      controller.abort();
      releaseResponse.resolve();
      responseGates.delete(deliveryId);
      await lost;
    });

    await Promise.race([
      committed.promise,
      lost.then(() => {
        throw new Error("webhook_response_settled_before_commit_barrier");
      }),
    ]);
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: conflictKey(deliveryId) },
      }),
    ).toBe(1);
    controller.abort();
    expect(await lost).toBeInstanceOf(Error);
    releaseResponse.resolve();
    responseGates.delete(deliveryId);

    expect(await post("push", deliveryId, payload)).toEqual({
      status: 200,
      body: { processed: false },
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId },
      }),
    ).toMatchObject({ generation: 1n });
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: conflictKey(deliveryId) },
      }),
    ).toBe(1);
  });

  it("recovers after PostgreSQL cancels an initial claim waiting for the scope guard", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = installationPayload(value, "suspend");
    const boundedPool = new Pool({
      ...webhookFencePostgres.connection,
      max: 2,
      options:
        "-c search_path=public -c timezone=Asia/Tokyo " +
        "-c statement_timeout=1000 -c lock_timeout=100",
    });
    const bounded = new PrismaClient({
      adapter: new PrismaPg(boundedPool, { schema: "public" }),
    });
    const held = deferred();
    const release = deferred();
    const writer = prisma.$transaction(
      async (transaction) => {
        await acquireCurrentScopeGuards(transaction, [
          { scope: "global", mode: "exclusive" },
        ]);
        held.resolve();
        await release.promise;
      },
      { isolationLevel: "ReadCommitted", timeout: 10_000 },
    );
    void writer.catch(() => undefined);
    let request: ReturnType<typeof post> | undefined;
    onTestFinished(async () => {
      release.resolve();
      const settled = await Promise.allSettled([
        writer,
        ...(request ? [request] : []),
      ]);
      const closed = await Promise.allSettled([
        bounded.$disconnect(),
        boundedPool.end(),
      ]);
      const errors = [...settled, ...closed].flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(errors, "webhook_lock_timeout_cleanup_failed");
    });
    await Promise.race([
      held.promise,
      writer.then(() => {
        throw new Error("webhook_lock_writer_settled_before_barrier");
      }),
    ]);
    const boundedAddress = await startServer({}, bounded);
    request = post("installation", deliveryId, payload, {
      address: boundedAddress,
    });
    expect(await request).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(String(processingErrors.get(deliveryId))).toContain("lock timeout");
    expect(await receipt(deliveryId)).toBeNull();
    expect(
      await prisma.gitHubWebhookFence.findUnique({ where: { deliveryId } }),
    ).toBeNull();
    expect(
      await prisma.gitHubInstallation.findUniqueOrThrow({
        where: { id: value.installation.id },
      }),
    ).toMatchObject({ status: "active" });

    release.resolve();
    await writer;
    request = post("installation", deliveryId, payload, {
      address: boundedAddress,
    });
    expect(await request).toEqual({
      status: 200,
      body: { processed: true, status: "suspended" },
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
    expect(
      await prisma.gitHubInstallation.findUniqueOrThrow({
        where: { id: value.installation.id },
      }),
    ).toMatchObject({ status: "suspended" });
  });

  it("rolls back a new installation after backend termination and retries in the same receiver", async () => {
    const suffix = randomBytes(6).toString("hex");
    const githubInstallationId = Number.parseInt(suffix, 16) + 1;
    const actorId = Number.parseInt(randomBytes(6).toString("hex"), 16) + 1;
    const account = "terminated-" + suffix;
    const actorLogin = "actor-" + suffix;
    const deliveryId = randomUUID();
    const payload = {
      action: "created",
      installation: {
        id: githubInstallationId,
        account: { login: account, type: "User" },
        repository_selection: "selected",
      },
      sender: { id: actorId, login: actorLogin },
    };
    const syncKey =
      "installation:" + githubInstallationId + ":sync:" + deliveryId;
    const localState = async () => ({
      workspaces: await prisma.workspace.count({
        where: { slug: "gh-user-" + account },
      }),
      installations: await prisma.gitHubInstallation.count({
        where: { githubInstallationId: BigInt(githubInstallationId) },
      }),
      actors: await prisma.user.count({
        where: { githubUserId: BigInt(actorId) },
      }),
      owners: await prisma.workspaceMember.count({
        where: { githubLogin: actorLogin, role: "owner" },
      }),
      outbox: await prisma.outboxEvent.count({
        where: { idempotencyKey: syncKey },
      }),
    });
    const gateName = "webhook_backend_gate_" + randomBytes(6).toString("hex");
    const advisoryKey = Number.parseInt(randomBytes(3).toString("hex"), 16) + 1;
    const blocker = await pool.connect();
    let request: ReturnType<typeof post> | undefined = undefined;
    let restored: Promise<void> | undefined;
    const restore = () =>
      (restored ??= (async () => {
        const errors: unknown[] = [];
        await blocker
          .query("SELECT pg_advisory_unlock($1::bigint)", [advisoryKey])
          .catch((error: unknown) => errors.push(error));
        if (request)
          await request.catch((error: unknown) => errors.push(error));
        await pool
          .query(
            'DROP TRIGGER IF EXISTS "' +
              gateName +
              '" ON "GitHubWebhookDelivery"',
          )
          .catch((error: unknown) => errors.push(error));
        await pool
          .query('DROP FUNCTION IF EXISTS "' + gateName + '"()')
          .catch((error: unknown) => errors.push(error));
        blocker.release();
        if (errors.length)
          throw new AggregateError(
            errors,
            "webhook_backend_gate_cleanup_failed",
          );
      })());
    onTestFinished(restore);

    // Only the synthetic receipt blocks, after all real local effects and
    // before its terminal write. Existing guards, constraints and triggers stay.
    await pool.query(
      'CREATE FUNCTION "' +
        gateName +
        '"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ' +
        'IF NEW."deliveryId" = \'' +
        deliveryId +
        "' AND NEW.status = 'processed' THEN " +
        "PERFORM pg_advisory_xact_lock(" +
        advisoryKey +
        "::bigint); END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER "' +
        gateName +
        '" BEFORE UPDATE ON "GitHubWebhookDelivery" ' +
        'FOR EACH ROW EXECUTE FUNCTION "' +
        gateName +
        '"()',
    );
    await blocker.query("SELECT pg_advisory_lock($1::bigint)", [advisoryKey]);
    request = post("installation", deliveryId, payload);
    void request.catch(() => undefined);
    const pid = await waitForBlockedQuery(
      "%GitHubWebhookDelivery%",
      advisoryKey,
    );
    expect(await localState()).toEqual({
      workspaces: 0,
      installations: 0,
      actors: 0,
      owners: 0,
      outbox: 0,
    });
    expect(
      (await pool.query("SELECT pg_terminate_backend($1) AS terminated", [pid]))
        .rows,
    ).toEqual([{ terminated: true }]);
    expect(await request).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
    expect(await localState()).toEqual({
      workspaces: 0,
      installations: 0,
      actors: 0,
      owners: 0,
      outbox: 0,
    });
    await restore();

    expect(await post("installation", deliveryId, payload)).toEqual({
      status: 200,
      body: { processed: true, status: "active" },
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId },
      }),
    ).toMatchObject({ generation: 2n });
    expect(await localState()).toEqual({
      workspaces: 1,
      installations: 1,
      actors: 1,
      owners: 1,
      outbox: 1,
    });
    expect(await post("installation", deliveryId, payload)).toEqual({
      status: 200,
      body: { processed: false },
    });
    expect(
      await prisma.outboxEvent.count({ where: { idempotencyKey: syncKey } }),
    ).toBe(1);
  });

  it("deletes an installation created while its signed delivery waits for the scope guard", async () => {
    const suffix = randomBytes(6).toString("hex");
    const githubInstallationId = Number.parseInt(suffix, 16) + 1;
    const account = "created-under-lock-" + suffix;
    const deliveryId = randomUUID();
    const held = deferred();
    const release = deferred();
    const writer = prisma.$transaction(
      async (transaction) => {
        await acquireCurrentScopeGuards(transaction, [
          { scope: "global", mode: "exclusive" },
        ]);
        const workspace = await transaction.workspace.create({
          data: { slug: "gh-user-" + account, name: account },
        });
        await transaction.gitHubInstallation.create({
          data: {
            workspaceId: workspace.id,
            githubInstallationId: BigInt(githubInstallationId),
            accountLogin: account,
            accountType: "User",
            repositorySelection: "selected",
          },
        });
        held.resolve();
        await release.promise;
      },
      { isolationLevel: "ReadCommitted", timeout: 10_000 },
    );
    void writer.catch(() => undefined);
    let request: ReturnType<typeof post> | undefined = undefined;
    onTestFinished(async () => {
      release.resolve();
      const settled = await Promise.allSettled([
        writer,
        ...(request ? [request] : []),
      ]);
      const errors = settled.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      );
      if (errors.length)
        throw new AggregateError(
          errors,
          "webhook_creation_race_cleanup_failed",
        );
    });
    await Promise.race([
      held.promise,
      writer.then(() => {
        throw new Error("webhook_creation_settled_before_scope_barrier");
      }),
    ]);
    request = post("installation", deliveryId, {
      action: "deleted",
      installation: {
        id: githubInstallationId,
        account: { login: account, type: "User" },
        repository_selection: "selected",
      },
    });
    void request.catch(() => undefined);
    await waitForBlockedQuery("%pg_advisory_xact_lock%");
    expect(
      await prisma.gitHubInstallation.findUnique({
        where: { githubInstallationId: BigInt(githubInstallationId) },
      }),
    ).toBeNull();
    release.resolve();
    await writer;
    expect(await request).toEqual({
      status: 200,
      body: { processed: true, status: "removed" },
    });
    expect(
      await prisma.gitHubInstallation.findUniqueOrThrow({
        where: { githubInstallationId: BigInt(githubInstallationId) },
      }),
    ).toMatchObject({ status: "removed" });
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      action: "deleted",
    });
    expect(
      await outbox(
        "installation:" + githubInstallationId + ":sync:" + deliveryId,
      ),
    ).toBeNull();
  });

  it("does not apply an initial installation creation after a newer signed deletion completes", async () => {
    const suffix = randomBytes(6).toString("hex");
    const githubInstallationId = Number.parseInt(suffix, 16) + 1;
    const actorId = Number.parseInt(randomBytes(6).toString("hex"), 16) + 1;
    const account = "superseded-" + suffix;
    const actorLogin = "actor-" + suffix;
    const createdId = randomUUID();
    const deletedId = randomUUID();
    const payload = {
      action: "created",
      installation: {
        id: githubInstallationId,
        account: { login: account, type: "User" },
        repository_selection: "selected",
      },
      sender: { id: actorId, login: actorLogin },
    };
    const localState = async () => ({
      workspaces: await prisma.workspace.count({
        where: { slug: "gh-user-" + account },
      }),
      installations: await prisma.gitHubInstallation.count({
        where: { githubInstallationId: BigInt(githubInstallationId) },
      }),
      actors: await prisma.user.count({
        where: { githubUserId: BigInt(actorId) },
      }),
      owners: await prisma.workspaceMember.count({
        where: { githubLogin: actorLogin, role: "owner" },
      }),
      outbox: await prisma.outboxEvent.count({
        where: {
          idempotencyKey: {
            in: [createdId, deletedId].map(
              (id) => "installation:" + githubInstallationId + ":sync:" + id,
            ),
          },
        },
      }),
    });
    const emptyState = {
      workspaces: 0,
      installations: 0,
      actors: 0,
      owners: 0,
      outbox: 0,
    };
    const claimed = deferred();
    const resume = deferred();
    let completedTransactions = 0;
    // Delegate the real transaction and COMMIT, then pause only its return.
    // The other receiver uses the original client and all production handlers.
    const transaction = new Proxy(prisma.$transaction, {
      async apply(target, _receiver, args) {
        const result: unknown = await Reflect.apply(target, prisma, args);
        if (++completedTransactions === 1) {
          claimed.resolve();
          await resume.promise;
        }
        return result;
      },
    });
    const paused = new Proxy(prisma, {
      get(target, key, receiver) {
        return key === "$transaction"
          ? transaction
          : Reflect.get(target, key, receiver);
      },
    });
    const pausedAddress = await startServer({}, paused);
    const earlier = post("installation", createdId, payload, {
      address: pausedAddress,
    });
    void earlier.catch(() => undefined);
    onTestFinished(async () => {
      resume.resolve();
      await earlier;
    });
    await Promise.race([
      claimed.promise,
      earlier.then(() => {
        throw new Error("webhook_creation_settled_before_claim_barrier");
      }),
    ]);
    const initialReceipt = await prisma.gitHubWebhookDelivery.findUniqueOrThrow(
      {
        where: { deliveryId: createdId },
      },
    );
    expect(initialReceipt).toMatchObject({
      status: "processing",
      action: "created",
    });
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId: createdId },
      }),
    ).toMatchObject({ generation: 1n });
    expect(await localState()).toEqual(emptyState);

    expect(
      await post("installation", deletedId, { ...payload, action: "deleted" }),
    ).toEqual({
      status: 200,
      body: { processed: true, status: "removed" },
    });
    const newerReceipt = await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
      where: { deliveryId: deletedId },
    });
    expect(newerReceipt).toMatchObject({
      status: "processed",
      action: "deleted",
    });
    expect(newerReceipt.receivedAt.getTime()).toBeGreaterThan(
      initialReceipt.receivedAt.getTime(),
    );
    expect(await localState()).toEqual(emptyState);

    resume.resolve();
    expect(await earlier).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(String(processingErrors.get(createdId))).toContain(
      "webhook_fence_reconciliation_required",
    );
    expect(await receipt(createdId)).toMatchObject({ status: "failed" });
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId: createdId },
      }),
    ).toMatchObject({ generation: 1n });
    expect(await receipt(deletedId)).toMatchObject({ status: "processed" });
    expect(await localState()).toEqual(emptyState);
  }, 15_000);

  it("takes over an expired authenticated push claim and rejects its stale failure and renewal", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pushPayload(value);
    const body = JSON.stringify(payload);
    const verified = createGitHubAppWebhookVerifier({
      appId: baseEnvironment.GITHUB_APP_ID,
      apiBaseUrl: baseEnvironment.GITHUB_API_BASE_URL,
      webhookSecret,
    })({ rawPayload: Buffer.from(body), signatureHeader: signature(body) });
    const acquired = await claimVerifiedFencedWebhookDelivery(
      prisma,
      verified,
      {
        deliveryId,
        eventName: "push",
        action: "push",
        installationId: String(value.githubInstallationId),
        payloadHash: createHash("sha256").update(body).digest("hex"),
        normalizedEvent: {
          type: "github.push",
          version: 1,
          installationId: String(value.githubInstallationId),
          repositoryId: String(value.githubRepositoryId),
          repositoryFullName: value.repository.fullName,
          ref: payload.ref,
          deleted: payload.deleted,
        },
      },
      "a".repeat(64),
      30_000,
    );
    if (acquired.kind !== "claimed") throw new Error("synthetic_claim_missing");
    // Models process death after the durable claim and before its first effect.
    await pool.query(
      'UPDATE "GitHubWebhookFence" SET "leaseUntil"=clock_timestamp()-interval ' +
        "'1 second' WHERE " +
        '"deliveryId"=$1',
      [deliveryId],
    );
    expect((await post("push", deliveryId, payload)).status).toBe(200);
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId },
      }),
    ).toMatchObject({ generation: 2n });
    expect(
      await failWebhookFencedDelivery(
        prisma,
        acquired.claim,
        "synthetic_stale_failure",
      ),
    ).toBe(false);
    expect(await renewWebhookFence(prisma, acquired.claim, 30_000)).toBe(false);
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      errorSummary: null,
    });
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: conflictKey(deliveryId) },
      }),
    ).toBe(1);
  });

  it("rolls back a push outbox when terminal commit fails and retries it once", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pushPayload(value);
    const { constraint, restore } = await rejectTerminal(deliveryId);
    expect(await post("push", deliveryId, payload)).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(processingErrors.get(deliveryId)).toMatchObject({
      message: expect.stringContaining(constraint),
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
    expect(await outbox(conflictKey(deliveryId))).toBeNull();
    await restore();
    expect((await post("push", deliveryId, payload)).status).toBe(200);
    expect(await receipt(deliveryId)).toMatchObject({
      status: "processed",
      errorSummary: null,
    });
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId },
      }),
    ).toMatchObject({ generation: 2n });
    expect(
      await prisma.outboxEvent.count({
        where: { idempotencyKey: conflictKey(deliveryId) },
      }),
    ).toBe(1);
  });

  it("rolls back the initial PR claim when durable ingress cannot be admitted", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pullRequestPayload(value);
    const withoutHeadRevision = {
      ...payload,
      pull_request: {
        ...payload.pull_request,
        head: {
          ref: payload.pull_request.head.ref,
          repo: payload.pull_request.head.repo,
        },
      },
    };
    expect(
      (await post("pull_request", deliveryId, withoutHeadRevision)).status,
    ).toBe(500);
    expect(await receipt(deliveryId)).toBeNull();
    expect(
      await prisma.gitHubWebhookFence.findUnique({ where: { deliveryId } }),
    ).toBeNull();
    expect(await outbox(ingressKey(deliveryId))).toBeNull();
    expect(await outbox(conflictKey(deliveryId))).toBeNull();
  });

  it("retains initial PR ingress when generic effects roll back", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pullRequestPayload(value);
    const { constraint, restore } = await rejectTerminal(deliveryId);
    expect((await post("pull_request", deliveryId, payload)).status).toBe(500);
    expect(processingErrors.get(deliveryId)).toMatchObject({
      message: expect.stringContaining(constraint),
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
    const ingress = await outbox(ingressKey(deliveryId));
    expect(ingress).toMatchObject({
      status: "pending",
      payload: { commandKind: "request" },
    });
    const initialIngressId = ingress?.id;
    expect(await outbox(conflictKey(deliveryId))).toBeNull();
    await restore();
    expect((await post("pull_request", deliveryId, payload)).status).toBe(200);
    expect((await outbox(ingressKey(deliveryId)))?.id).toBe(initialIngressId);
    expect(await outbox(conflictKey(deliveryId))).not.toBeNull();
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
  });

  it("does not create historical PR ingress on retry after the ingress flag is enabled", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    const payload = pullRequestPayload(value);
    const { constraint, restore } = await rejectTerminal(deliveryId);
    expect(
      (
        await post("pull_request", deliveryId, payload, {
          address: ingressDisabledAddress,
        })
      ).status,
    ).toBe(500);
    expect(processingErrors.get(deliveryId)).toMatchObject({
      message: expect.stringContaining(constraint),
    });
    expect(await receipt(deliveryId)).toMatchObject({ status: "failed" });
    expect(await outbox(ingressKey(deliveryId))).toBeNull();
    await restore();
    expect((await post("pull_request", deliveryId, payload)).status).toBe(200);
    expect(
      await prisma.gitHubWebhookFence.findUniqueOrThrow({
        where: { deliveryId },
      }),
    ).toMatchObject({ generation: 2n });
    expect(await outbox(ingressKey(deliveryId))).toBeNull();
    expect(await outbox(conflictKey(deliveryId))).not.toBeNull();
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
  });

  it("completes a disabled push fallback without enqueueing conflict work", async () => {
    const value = await fixture();
    const deliveryId = randomUUID();
    expect(
      await post("push", deliveryId, pushPayload(value), {
        address: fallbackDisabledAddress,
      }),
    ).toMatchObject({ status: 200, body: { ignored: true } });
    expect(await receipt(deliveryId)).toMatchObject({ status: "processed" });
    expect(await outbox(conflictKey(deliveryId))).toBeNull();
  });
});
