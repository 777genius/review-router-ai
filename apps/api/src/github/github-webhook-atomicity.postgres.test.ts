import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  hashGitHubWebhookPayload,
  registerGitHubWebhookRoutes,
  signGitHubWebhookPayload,
  type GitHubWebhookTransaction,
  type RegisterGitHubWebhookRoutesDependencies,
} from "@reviewrouter/features-github-installations";
import {
  acquireCurrentScopeGuards,
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { createMigratedTestDatabase } from "../../../../packages/platform/db/src/postgres-test-fixture";
import { createDefaultGitHubWebhookDependencies } from "./github-webhook-composition";

const adminUrl = process.env.RELIABILITY_TEST_POSTGRES_ADMIN_URL;
const secret = "disposable-webhook-secret";
const apps: FastifyInstance[] = [];
let sequence = 100_000;

type InstallationFixture = ReturnType<typeof installationFixture>;
function installationFixture() {
  const installationId = ++sequence;
  const actorId = ++sequence;
  const account = `atomic-${installationId}`;
  const deliveryId = randomUUID();
  const payload = {
    action: "created",
    installation: {
      id: installationId,
      account: { login: account, type: "User" },
      repository_selection: "selected",
    },
    sender: { id: actorId, login: `actor-${actorId}` },
  };
  const body = JSON.stringify(payload);
  return { installationId, actorId, account, deliveryId, body, payload };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function listen(dependencies: RegisterGitHubWebhookRoutesDependencies) {
  const app = Fastify({ logger: false });
  apps.push(app);
  await registerGitHubWebhookRoutes(app, dependencies);
  return app.listen({ host: "127.0.0.1", port: 0 });
}

async function send(
  origin: string,
  deliveryId: string,
  body: string,
  eventName = "installation",
  signal?: AbortSignal,
) {
  const response = await fetch(`${origin}/webhooks/github`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": eventName,
      "x-hub-signature-256": signGitHubWebhookPayload(body, secret),
    },
    body,
    ...(signal ? { signal } : {}),
  });
  return { status: response.status, body: await response.json() };
}

function transformTransactions(
  dependencies: RegisterGitHubWebhookRoutesDependencies,
  transform: (
    transaction: GitHubWebhookTransaction,
  ) => GitHubWebhookTransaction,
): RegisterGitHubWebhookRoutesDependencies {
  return {
    ...dependencies,
    transactions: {
      run: (eventName, work) =>
        dependencies.transactions.run(eventName, (transaction) =>
          work(transform(transaction)),
        ),
    },
  };
}

function afterInstallationStage(
  transaction: GitHubWebhookTransaction,
  stage: "installation" | "owner" | "outbox" | "receipt",
  effect: () => Promise<void>,
): GitHubWebhookTransaction {
  const { installations, ownerGrants, syncRequests, deliveries } = transaction;
  if (!ownerGrants || !syncRequests)
    throw new Error("production_effects_required");
  return {
    ...transaction,
    installations: {
      async upsertInstallation(input) {
        await installations.upsertInstallation(input);
        if (stage === "installation") await effect();
      },
      markInstallationRemoved: (id) =>
        installations.markInstallationRemoved(id),
    },
    ownerGrants: {
      async grantInstallationActorOwner(input) {
        await ownerGrants.grantInstallationActorOwner(input);
        if (stage === "owner") await effect();
      },
    },
    syncRequests: {
      async requestInstallationSync(input) {
        const result = await syncRequests.requestInstallationSync(input);
        if (stage === "outbox") await effect();
        return result;
      },
    },
    deliveries: {
      tryStartProcessing: (input) => deliveries.tryStartProcessing(input),
      markFailed: (input) => deliveries.markFailed(input),
      async markProcessed(id) {
        await deliveries.markProcessed(id);
        if (stage === "receipt") await effect();
      },
    },
  };
}

describe.skipIf(!adminUrl)("atomic signed webhook HTTP on PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof createMigratedTestDatabase>>;
  let prisma: PrismaClient;
  const dependencies = () =>
    createDefaultGitHubWebhookDependencies({
      webhookSecret: secret,
      prisma,
      env: {},
    });

  beforeAll(async () => {
    database = await createMigratedTestDatabase(adminUrl!);
    prisma = createPrismaClient({
      databaseUrl: database.databaseUrl,
      poolMax: 8,
    });
  }, 120_000);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
      apps.splice(0).map(async (app) => {
        app.server.closeAllConnections();
        await app.close();
      }),
    );
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await database?.cleanup();
  });

  async function state(fixture: InstallationFixture) {
    const installation = await prisma.gitHubInstallation.findUnique({
      where: { githubInstallationId: BigInt(fixture.installationId) },
    });
    const workspace = await prisma.workspace.findUnique({
      where: { slug: `gh-user-${fixture.account}` },
    });
    return {
      installation: installation !== null,
      workspace: workspace !== null,
      actor: await prisma.user.count({
        where: { githubUserId: BigInt(fixture.actorId) },
      }),
      owners: workspace
        ? await prisma.workspaceMember.count({
            where: { workspaceId: workspace.id, role: "owner" },
          })
        : 0,
      receipt:
        (
          await prisma.gitHubWebhookDelivery.findUnique({
            where: { deliveryId: fixture.deliveryId },
          })
        )?.status ?? null,
      outbox: await prisma.outboxEvent.count({
        where: {
          idempotencyKey: `installation:${fixture.installationId}:sync:${fixture.deliveryId}`,
        },
      }),
    };
  }
  const absent = {
    installation: false,
    workspace: false,
    actor: 0,
    owners: 0,
    receipt: null,
    outbox: 0,
  };
  const complete = {
    installation: true,
    workspace: true,
    actor: 1,
    owners: 1,
    receipt: "processed",
    outbox: 1,
  };

  it.each(["installation", "owner", "outbox", "receipt"] as const)(
    "rolls back an interruption after %s and redelivers in the same API process",
    async (stage) => {
      const fixture = installationFixture();
      let fail = true;
      const origin = await listen(
        transformTransactions(dependencies(), (transaction) =>
          afterInstallationStage(transaction, stage, async () => {
            if (fail) {
              fail = false;
              throw new Error("injected_interruption");
            }
          }),
        ),
      );
      expect(await send(origin, fixture.deliveryId, fixture.body)).toEqual({
        status: 500,
        body: { error: "github_webhook_processing_failed" },
      });
      expect(await state(fixture)).toEqual(absent);
      expect(await send(origin, fixture.deliveryId, fixture.body)).toEqual({
        status: 200,
        body: { processed: true, status: "active" },
      });
      expect(await state(fixture)).toEqual(complete);
    },
  );

  async function waitForReceiptLock(includeScopeGuard = true) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await prisma.$queryRaw<readonly { count: bigint }[]>`
        SELECT count(*) AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND (query LIKE '%GitHubWebhookDelivery%' OR (${includeScopeGuard} AND query LIKE '%pg_advisory_xact_lock%'))
      `;
      if (Number(rows[0]?.count) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("concurrent_receipt_did_not_wait_on_database_lock");
  }

  it.each([false, true])(
    "serializes duplicates when the first transaction aborts=%s",
    async (abort) => {
      const fixture = installationFixture();
      const entered = deferred();
      const release = deferred();
      let first = true;
      const origin = await listen(
        transformTransactions(dependencies(), (transaction) =>
          afterInstallationStage(transaction, "installation", async () => {
            if (!first) return;
            first = false;
            entered.resolve();
            await release.promise;
            if (abort) throw new Error("winner_aborted");
          }),
        ),
      );
      const winner = send(origin, fixture.deliveryId, fixture.body);
      await Promise.race([
        entered.promise,
        winner.then(() => {
          throw new Error("request_settled_before_barrier");
        }),
      ]);
      const duplicate = send(origin, fixture.deliveryId, fixture.body);
      try {
        await waitForReceiptLock();
        expect(await state(fixture)).toEqual(absent);
      } finally {
        release.resolve();
      }
      const results = await Promise.all([winner, duplicate]);
      expect(results.map((result) => result.status)).toEqual(
        abort ? [500, 200] : [200, 200],
      );
      expect(results.map((result) => result.body)).toEqual(
        abort
          ? [
              { error: "github_webhook_processing_failed" },
              { processed: true, status: "active" },
            ]
          : [{ processed: true, status: "active" }, { processed: false }],
      );
      expect(await state(fixture)).toEqual(complete);
    },
  );

  it("keeps the committed receipt when the client loses the HTTP response", async () => {
    const fixture = installationFixture();
    const base = dependencies();
    const committed = deferred();
    const releaseResponse = deferred();
    let first = true;
    const origin = await listen({
      ...base,
      transactions: {
        async run(eventName, work) {
          const result = await base.transactions.run(eventName, work);
          if (first) {
            first = false;
            committed.resolve();
            await releaseResponse.promise;
          }
          return result;
        },
      },
    });
    const controller = new AbortController();
    const lost = send(
      origin,
      fixture.deliveryId,
      fixture.body,
      "installation",
      controller.signal,
    ).catch((error: unknown) => error);
    try {
      await Promise.race([
        committed.promise,
        lost.then(() => {
          throw new Error("request_settled_before_commit_barrier");
        }),
      ]);
      expect(await state(fixture)).toEqual(complete);
      controller.abort();
      expect(await lost).toBeInstanceOf(Error);
    } finally {
      releaseResponse.resolve();
    }
    expect(await send(origin, fixture.deliveryId, fixture.body)).toEqual({
      status: 200,
      body: { processed: false },
    });
    expect(await state(fixture)).toEqual(complete);
  });

  it("reclaims an exact historical failed receipt but rejects unconfirmed receipts without mutation", async () => {
    const origin = await listen(dependencies());
    for (const status of ["failed", "received", "processing"] as const) {
      const fixture = installationFixture();
      const existing = await prisma.gitHubWebhookDelivery.create({
        data: {
          deliveryId: fixture.deliveryId,
          eventName: "installation",
          action: "created",
          installationId: BigInt(fixture.installationId),
          payloadHash: hashGitHubWebhookPayload(Buffer.from(fixture.body)),
          status,
          errorSummary: status === "failed" ? "historical_failure" : null,
        },
      });
      const result = await send(origin, fixture.deliveryId, fixture.body);
      if (status === "failed") {
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ processed: true, status: "active" });
        expect(await state(fixture)).toEqual(complete);
        expect(
          await prisma.gitHubWebhookDelivery.findUnique({
            where: { deliveryId: fixture.deliveryId },
          }),
        ).toMatchObject({ id: existing.id, errorSummary: null });
      } else {
        expect(result).toEqual({
          status: 500,
          body: { error: "github_webhook_processing_failed" },
        });
        expect(await state(fixture)).toEqual({
          ...absent,
          receipt: status,
        });
        expect(
          await prisma.gitHubWebhookDelivery.findUnique({
            where: { deliveryId: fixture.deliveryId },
          }),
        ).toEqual(existing);
      }
    }
  });

  it.each([
    ["failed", "eventName"],
    ["failed", "action"],
    ["failed", "installationId"],
    ["failed", "payloadHash"],
    ["processed", "eventName"],
    ["processed", "action"],
    ["processed", "installationId"],
    ["processed", "payloadHash"],
  ] as const)(
    "rejects a %s receipt with a different %s without mutation",
    async (status, field) => {
      const fixture = installationFixture();
      const identity = {
        eventName: "installation",
        action: "created",
        installationId: BigInt(fixture.installationId),
        payloadHash: hashGitHubWebhookPayload(Buffer.from(fixture.body)),
      };
      const mismatches = {
        eventName: "push",
        action: "deleted",
        installationId: 42n,
        payloadHash: "different",
      };
      const original = await prisma.gitHubWebhookDelivery.create({
        data: {
          ...identity,
          [field]: mismatches[field],
          deliveryId: fixture.deliveryId,
          status,
        },
      });
      const origin = await listen(dependencies());
      expect(await send(origin, fixture.deliveryId, fixture.body)).toEqual({
        status: 500,
        body: { error: "github_webhook_processing_failed" },
      });
      expect(await state(fixture)).toEqual({ ...absent, receipt: status });
      expect(
        await prisma.gitHubWebhookDelivery.findUnique({
          where: { deliveryId: fixture.deliveryId },
        }),
      ).toEqual(original);
    },
  );

  it("server lock cancellation rolls back the receipt and allows a later redelivery", async () => {
    const fixture = installationFixture();
    const bounded = createPrismaClient({
      databaseUrl: database.databaseUrl,
      poolMax: 2,
      executionBudget: { statementTimeoutMs: 1000, lockTimeoutMs: 100 },
    });
    const held = deferred();
    const release = deferred();
    const blocker = prisma.$transaction(async (tx) => {
      await acquireCurrentScopeGuards(tx, [
        { scope: "global", mode: "exclusive" },
      ]);
      held.resolve();
      await release.promise;
    });
    try {
      await held.promise;
      const origin = await listen(
        createDefaultGitHubWebhookDependencies({
          webhookSecret: secret,
          prisma: bounded,
          env: {},
        }),
      );
      expect(await send(origin, fixture.deliveryId, fixture.body)).toEqual({
        status: 500,
        body: { error: "github_webhook_processing_failed" },
      });
      expect(await state(fixture)).toEqual(absent);
      release.resolve();
      await blocker;
      expect(await send(origin, fixture.deliveryId, fixture.body)).toEqual({
        status: 200,
        body: { processed: true, status: "active" },
      });
      expect(await state(fixture)).toEqual(complete);
    } finally {
      release.resolve();
      await blocker;
      await bounded.$disconnect();
    }
  });

  it("losing the database backend rolls back local effects and recovers in the same API process", async () => {
    const fixture = installationFixture();
    const entered = deferred();
    const release = deferred();
    let first = true;
    const origin = await listen(
      transformTransactions(dependencies(), (transaction) =>
        afterInstallationStage(transaction, "outbox", async () => {
          if (!first) return;
          first = false;
          entered.resolve();
          await release.promise;
        }),
      ),
    );
    const interrupted = send(origin, fixture.deliveryId, fixture.body);
    try {
      await Promise.race([
        entered.promise,
        interrupted.then(() => {
          throw new Error("request_settled_before_backend_barrier");
        }),
      ]);
      const backends = await prisma.$queryRaw<readonly { pid: number }[]>`
        SELECT pid FROM pg_stat_activity
        WHERE datname = current_database() AND state = 'idle in transaction'
          AND query LIKE '%OutboxEvent%'
      `;
      expect(backends).toHaveLength(1);
      const terminated = await prisma.$queryRaw<
        readonly { terminated: boolean }[]
      >`
        SELECT pg_terminate_backend(${backends[0]!.pid}) AS terminated
      `;
      expect(terminated).toEqual([{ terminated: true }]);
    } finally {
      release.resolve();
    }
    expect(await interrupted).toEqual({
      status: 500,
      body: { error: "github_webhook_processing_failed" },
    });
    expect(await state(fixture)).toEqual(absent);
    expect(await send(origin, fixture.deliveryId, fixture.body)).toEqual({
      status: 200,
      body: { processed: true, status: "active" },
    });
    expect(await state(fixture)).toEqual(complete);
  });

  it("installation removal sees authority created while it waited for the scope guard", async () => {
    const fixture = installationFixture();
    const held = deferred();
    const release = deferred();
    const created = prisma.$transaction(async (tx) => {
      await acquireCurrentScopeGuards(tx, [
        { scope: "global", mode: "exclusive" },
      ]);
      const workspace = await tx.workspace.create({
        data: {
          slug: `gh-user-${fixture.account}`,
          name: fixture.account,
        },
      });
      await tx.gitHubInstallation.create({
        data: {
          workspaceId: workspace.id,
          githubInstallationId: BigInt(fixture.installationId),
          accountLogin: fixture.account,
          accountType: "User",
          repositorySelection: "selected",
        },
      });
      held.resolve();
      await release.promise;
    });
    try {
      await Promise.race([
        held.promise,
        created.then(() => {
          throw new Error("creation_settled_before_scope_barrier");
        }),
      ]);
      const origin = await listen(dependencies());
      const removed = send(
        origin,
        fixture.deliveryId,
        JSON.stringify({ ...fixture.payload, action: "deleted" }),
      );
      try {
        await waitForReceiptLock();
      } finally {
        release.resolve();
      }
      await created;
      expect(await removed).toEqual({
        status: 200,
        body: { processed: true, status: "removed" },
      });
      expect(
        await prisma.gitHubInstallation.findUnique({
          where: { githubInstallationId: BigInt(fixture.installationId) },
        }),
      ).toMatchObject({ status: "removed" });
      expect(
        await prisma.gitHubWebhookDelivery.findUnique({
          where: { deliveryId: fixture.deliveryId },
        }),
      ).toMatchObject({ status: "processed", action: "deleted" });
      expect(
        await prisma.outboxEvent.count({
          where: {
            idempotencyKey: `installation:${fixture.installationId}:sync:${fixture.deliveryId}`,
          },
        }),
      ).toBe(0);
    } finally {
      release.resolve();
      await created;
    }
  });

  async function repositoryFixture() {
    const installation = installationFixture();
    const workspace = await prisma.workspace.create({
      data: {
        slug: `fixture-${installation.installationId}`,
        name: installation.account,
      },
    });
    const linkedInstallation = await prisma.gitHubInstallation.create({
      data: {
        workspaceId: workspace.id,
        githubInstallationId: BigInt(installation.installationId),
        accountLogin: installation.account,
        accountType: "User",
        repositorySelection: "selected",
      },
    });
    const githubRepositoryId = ++sequence;
    const repository = await prisma.repositoryConnection.create({
      data: {
        workspaceId: workspace.id,
        installationId: linkedInstallation.id,
        githubRepositoryId: BigInt(githubRepositoryId),
        externalRepositoryId: String(githubRepositoryId),
        owner: installation.account,
        name: "repo",
        fullName: `${installation.account}/repo`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    const user = await prisma.user.create({
      data: {
        githubUserId: BigInt(installation.actorId),
        githubLogin: installation.payload.sender.login,
      },
    });
    return {
      installation,
      workspace,
      linkedInstallation,
      repository,
      githubRepositoryId,
      user,
    };
  }

  function failFirstReceipt() {
    let fail = true;
    return transformTransactions(dependencies(), (transaction) =>
      afterInstallationStage(transaction, "receipt", async () => {
        if (fail) {
          fail = false;
          throw new Error("receipt_commit_interruption");
        }
      }),
    );
  }

  it("revocation and permission-cache removal commit with the receipt, with no nested client transaction", async () => {
    vi.stubEnv("GITHUB_APP_SLUG", "atomic-webhook-test");
    const fixture = await repositoryFixture();
    const auth = await prisma.gitHubUserAuthorization.create({
      data: {
        userId: fixture.user.id,
        githubUserId: BigInt(fixture.installation.actorId),
        appSlug: "atomic-webhook-test",
        encryptedAccessToken: "fixture-only-ciphertext",
        revision: 7,
        refreshAttemptId: "in-flight-refresh",
      },
    });
    await prisma.repositoryPermissionCache.create({
      data: {
        userId: fixture.user.id,
        repositoryId: fixture.repository.id,
        githubInstallationId: BigInt(fixture.installation.installationId),
        authorizationAppSlug: "atomic-webhook-test",
        authorizationRevision: 7,
        permission: "admin",
        canManage: true,
        checkedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const body = JSON.stringify({
      action: "revoked",
      sender: fixture.installation.payload.sender,
    });
    const deliveryId = randomUUID();
    const origin = await listen(failFirstReceipt());
    expect(
      (await send(origin, deliveryId, body, "github_app_authorization")).status,
    ).toBe(500);
    expect(
      await prisma.gitHubUserAuthorization.findUnique({
        where: { id: auth.id },
      }),
    ).toMatchObject({
      revision: 7,
      revokedAt: null,
      refreshAttemptId: "in-flight-refresh",
    });
    expect(
      await prisma.repositoryPermissionCache.count({
        where: { userId: fixture.user.id },
      }),
    ).toBe(1);
    expect(
      await prisma.gitHubWebhookDelivery.count({ where: { deliveryId } }),
    ).toBe(0);
    expect(
      (await send(origin, deliveryId, body, "github_app_authorization")).status,
    ).toBe(200);
    expect(
      await prisma.gitHubUserAuthorization.findUnique({
        where: { id: auth.id },
      }),
    ).toMatchObject({
      revision: 8,
      revokedAt: expect.any(Date),
      refreshAttemptId: null,
    });
    expect(
      await prisma.repositoryPermissionCache.count({
        where: { userId: fixture.user.id },
      }),
    ).toBe(0);
    expect(
      (await send(origin, deliveryId, body, "github_app_authorization")).body,
    ).toEqual({ processed: false });
    expect(
      await prisma.gitHubUserAuthorization.findUnique({
        where: { id: auth.id },
      }),
    ).toMatchObject({ revision: 8 });
  });

  it("repository deletion rolls back and redelivers with its exact installation scope", async () => {
    const fixture = await repositoryFixture();
    const body = JSON.stringify({
      action: "deleted",
      installation: { id: fixture.installation.installationId },
      repository: {
        id: fixture.githubRepositoryId,
        name: fixture.repository.name,
        full_name: fixture.repository.fullName,
        owner: { login: fixture.repository.owner },
        default_branch: "main",
        private: true,
        archived: false,
      },
    });
    const deliveryId = randomUUID();
    const origin = await listen(failFirstReceipt());
    expect((await send(origin, deliveryId, body, "repository")).status).toBe(
      500,
    );
    expect(
      await prisma.repositoryConnection.findUnique({
        where: { id: fixture.repository.id },
      }),
    ).toMatchObject({ selected: true });
    expect(
      await prisma.gitHubWebhookDelivery.count({ where: { deliveryId } }),
    ).toBe(0);
    expect((await send(origin, deliveryId, body, "repository")).status).toBe(
      200,
    );
    expect(
      await prisma.repositoryConnection.findUnique({
        where: { id: fixture.repository.id },
      }),
    ).toMatchObject({ selected: false });
    expect(
      await prisma.gitHubWebhookDelivery.findUnique({ where: { deliveryId } }),
    ).toMatchObject({ status: "processed" });
  });

  function pullRequestPayload(
    fixture: Awaited<ReturnType<typeof repositoryFixture>>,
    action = "opened",
  ) {
    return {
      action,
      installation: { id: fixture.installation.installationId },
      repository: {
        id: fixture.githubRepositoryId,
        name: fixture.repository.name,
        full_name: fixture.repository.fullName,
      },
      pull_request: {
        number: 42,
        html_url: `https://github.com/${fixture.repository.fullName}/pull/42`,
        state: action === "closed" ? "closed" : "open",
        merged: action === "closed",
        draft: false,
        base: { ref: "main", sha: "a".repeat(40) },
        head: { ref: "reviewrouter/setup", sha: "b".repeat(40) },
      },
    };
  }

  it("a merged setup PR updates workflow state inside the outer receipt transaction", async () => {
    const fixture = await repositoryFixture();
    const provisioning = await prisma.workflowProvisioning.create({
      data: {
        workspaceId: fixture.workspace.id,
        repositoryId: fixture.repository.id,
        installationId: fixture.linkedInstallation.id,
        status: "setup_pr_open",
        branch: "reviewrouter/setup",
        workflowPath: ".github/workflows/reviewrouter-review.yml",
        actionVersion: "fixture-v1",
        pullRequestHeadSha: "b".repeat(40),
        pullRequestUrl: `https://github.com/${fixture.repository.fullName}/pull/42`,
        attemptWorkflowRequirement: "gateway",
        revision: 3,
      },
    });
    const body = JSON.stringify(pullRequestPayload(fixture, "closed"));
    const deliveryId = randomUUID();
    const origin = await listen(failFirstReceipt());
    expect((await send(origin, deliveryId, body, "pull_request")).status).toBe(
      500,
    );
    expect(
      await prisma.workflowProvisioning.findUnique({
        where: { id: provisioning.id },
      }),
    ).toMatchObject({
      status: "setup_pr_open",
      revision: 3,
      installedWorkflowRequirement: null,
    });
    expect(
      await prisma.gitHubWebhookDelivery.count({ where: { deliveryId } }),
    ).toBe(0);
    expect((await send(origin, deliveryId, body, "pull_request")).status).toBe(
      200,
    );
    expect(
      await prisma.workflowProvisioning.findUnique({
        where: { id: provisioning.id },
      }),
    ).toMatchObject({
      status: "configured",
      revision: 4,
      installedWorkflowRequirement: "gateway",
    });
    expect((await send(origin, deliveryId, body, "pull_request")).body).toEqual(
      { processed: false },
    );
    expect(
      await prisma.workflowProvisioning.findUnique({
        where: { id: provisioning.id },
      }),
    ).toMatchObject({ revision: 4 });
  });

  it.each(["push", "pull_request"])(
    "%s fallback outbox work is atomic with its delivery",
    async (eventName) => {
      vi.stubEnv("REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK", "1");
      vi.stubEnv("REVIEW_ROUTER_CONFLICT_REVIEW_FALLBACK_REPOSITORIES", "");
      const fixture = await repositoryFixture();
      const payload =
        eventName === "pull_request"
          ? pullRequestPayload(fixture)
          : {
              installation: { id: fixture.installation.installationId },
              repository: {
                id: fixture.githubRepositoryId,
                name: fixture.repository.name,
                full_name: fixture.repository.fullName,
              },
              ref: "refs/heads/main",
              before: "a".repeat(40),
              after: "b".repeat(40),
              deleted: false,
            };
      const body = JSON.stringify(payload);
      const deliveryId = randomUUID();
      const outboxWhere = {
        idempotencyKey: `conflict-review:detect:delivery:${deliveryId}`,
      };
      const origin = await listen(failFirstReceipt());
      expect((await send(origin, deliveryId, body, eventName)).status).toBe(
        500,
      );
      expect(
        await prisma.gitHubWebhookDelivery.count({ where: { deliveryId } }),
      ).toBe(0);
      expect(await prisma.outboxEvent.count({ where: outboxWhere })).toBe(0);
      expect((await send(origin, deliveryId, body, eventName)).status).toBe(
        200,
      );
      expect(
        await prisma.gitHubWebhookDelivery.findUnique({
          where: { deliveryId },
        }),
      ).toMatchObject({ status: "processed" });
      expect(await prisma.outboxEvent.count({ where: outboxWhere })).toBe(1);
      expect((await send(origin, deliveryId, body, eventName)).body).toEqual({
        processed: false,
      });
      expect(await prisma.outboxEvent.count({ where: outboxWhere })).toBe(1);
    },
  );

  it.each([false, true])(
    "fences duplicate push receipts without a scope guard when the winner aborts=%s",
    async (abort) => {
      vi.stubEnv("REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK", "1");
      vi.stubEnv("REVIEW_ROUTER_CONFLICT_REVIEW_FALLBACK_REPOSITORIES", "");
      const fixture = await repositoryFixture();
      const body = JSON.stringify({
        installation: { id: fixture.installation.installationId },
        repository: {
          id: fixture.githubRepositoryId,
          name: fixture.repository.name,
          full_name: fixture.repository.fullName,
        },
        ref: "refs/heads/main",
        before: "a".repeat(40),
        after: "b".repeat(40),
        deleted: false,
      });
      const deliveryId = randomUUID();
      const outboxWhere = {
        idempotencyKey: `conflict-review:detect:delivery:${deliveryId}`,
      };
      const entered = deferred();
      const release = deferred();
      let first = true;
      const origin = await listen(
        transformTransactions(dependencies(), (transaction) => {
          const pushes = transaction.pushes;
          if (!pushes) throw new Error("production_push_handler_required");
          return {
            ...transaction,
            pushes: {
              async handleGitHubPushWebhook(envelope) {
                const result = await pushes.handleGitHubPushWebhook(envelope);
                if (first) {
                  first = false;
                  entered.resolve();
                  await release.promise;
                  if (abort) throw new Error("push_winner_aborted");
                }
                return result;
              },
            },
          };
        }),
      );
      const winner = send(origin, deliveryId, body, "push");
      await Promise.race([
        entered.promise,
        winner.then(() => {
          throw new Error("push_settled_before_receipt_barrier");
        }),
      ]);
      const duplicate = send(origin, deliveryId, body, "push");
      try {
        // Push has no global writer guard: PostgreSQL's unique receipt row owns
        // this wait, proving the actual ON CONFLICT claim instead of scope locking.
        await waitForReceiptLock(false);
        expect(
          await prisma.gitHubWebhookDelivery.count({ where: { deliveryId } }),
        ).toBe(0);
        expect(await prisma.outboxEvent.count({ where: outboxWhere })).toBe(0);
      } finally {
        release.resolve();
      }
      const results = await Promise.all([winner, duplicate]);
      expect(results.map((result) => result.status)).toEqual(
        abort ? [500, 200] : [200, 200],
      );
      if (!abort) expect(results[1]?.body).toEqual({ processed: false });
      expect(
        await prisma.gitHubWebhookDelivery.findUnique({
          where: { deliveryId },
        }),
      ).toMatchObject({ status: "processed" });
      expect(await prisma.outboxEvent.count({ where: outboxWhere })).toBe(1);
      expect((await send(origin, deliveryId, body, "push")).body).toEqual({
        processed: false,
      });
      expect(await prisma.outboxEvent.count({ where: outboxWhere })).toBe(1);
    },
  );

  it("runs independent PR preadmission before opening any local receipt transaction", async () => {
    const fixture = await repositoryFixture();
    const base = dependencies();
    let starts = 0;
    let failAdmission = true;
    const origin = await listen({
      ...base,
      preAdmissionPullRequests: {
        async handleGitHubPullRequestWebhook() {
          expect(starts).toBe(0);
          if (failAdmission)
            throw new Error("independent_admission_unavailable");
          return { processed: true };
        },
      },
      transactions: {
        run(eventName, work) {
          starts++;
          return base.transactions.run(eventName, work);
        },
      },
    });
    const deliveryId = randomUUID();
    const body = JSON.stringify(pullRequestPayload(fixture));
    expect((await send(origin, deliveryId, body, "pull_request")).status).toBe(
      500,
    );
    expect(starts).toBe(0);
    expect(
      await prisma.gitHubWebhookDelivery.count({ where: { deliveryId } }),
    ).toBe(0);
    failAdmission = false;
    expect((await send(origin, deliveryId, body, "pull_request")).status).toBe(
      200,
    );
    expect(starts).toBe(1);
    expect(
      await prisma.gitHubWebhookDelivery.findUnique({ where: { deliveryId } }),
    ).toMatchObject({ status: "processed" });
  });
});
