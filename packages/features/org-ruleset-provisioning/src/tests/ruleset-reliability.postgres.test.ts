import { randomUUID } from "node:crypto";
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
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { PostgresLeaseLock } from "@reviewrouter/platform-locks";
import {
  PrismaOutboxEventRepository,
  processOutboxBatch,
} from "@reviewrouter/features-outbox";
import { PrismaOrgRulesetProvisioningRepository } from "../infrastructure/prisma/prisma-org-ruleset-provisioning-repository";
import { OctokitOrgRulesetSetupGateway } from "../infrastructure/github/octokit-org-ruleset-setup-gateway";
import { provisionOrgRulesetRequiredWorkflow } from "../application/use-cases/provision-org-ruleset-required-workflow";
import { createOrgRulesetProvisioningRequestedHandler } from "../infrastructure/outbox/org-ruleset-provisioning-requested-handler";
import {
  createOrgRulesetProvisioningRequest,
  defaultOrgRulesetName,
} from "../domain/org-ruleset-provisioning";
import { rulesetHttpFixture } from "./ruleset-http.fixture";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const withDatabase = databaseUrl ? describe : describe.skip;

withDatabase(
  "ruleset desired state, remote effects and outbox on PostgreSQL",
  () => {
    let prisma: PrismaClient;
    const prefix = `ruleset-${randomUUID()}`;
    const remotes: Awaited<ReturnType<typeof rulesetHttpFixture>>[] = [];
    const workspaceIds: string[] = [];

    beforeAll(() => {
      if (!databaseUrl) throw new Error("ruleset_test_database_required");
      const url = new URL(databaseUrl);
      if (
        !/test|e2e/.test(url.pathname) ||
        !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
      ) {
        throw new Error("ruleset_test_database_must_be_disposable");
      }
      prisma = createPrismaClient({ databaseUrl, poolMax: 6 });
    });

    afterEach(async () => {
      await Promise.all(remotes.splice(0).map((remote) => remote.close()));
      await prisma.outboxEvent.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: workspaceIds.splice(0) } },
      });
      await prisma.distributedLock.deleteMany({
        where: { key: { contains: prefix } },
      });
    });
    afterAll(async () => {
      await prisma?.$disconnect();
    });

    async function fixture() {
      const workspaceId = `${prefix}-${randomUUID()}`;
      workspaceIds.push(workspaceId);
      const githubId = BigInt(
        `0x${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      );
      await prisma.workspace.create({
        data: { id: workspaceId, slug: workspaceId, name: workspaceId },
      });
      const installation = await prisma.gitHubInstallation.create({
        data: {
          workspaceId,
          githubInstallationId: githubId,
          accountLogin: workspaceId,
          accountType: "Organization",
          repositorySelection: "all",
        },
      });
      const request = createOrgRulesetProvisioningRequest({
        workspaceId,
        installationId: installation.id,
        githubInstallationId: githubId.toString(),
        organizationLogin: workspaceId,
        sourceGithubRepositoryId: "123",
        sourceRepositoryFullName: `${workspaceId}/workflows`,
        sourceWorkflowPath: ".github/workflows/reviewrouter-required.yml",
        sourceWorkflowRef: "refs/heads/main",
        scope: "selected_repositories",
        enforcement: "evaluate",
        targetRepositoryIds: ["124"],
        requestedBy: "fixture",
        requestedAt: new Date("2026-11-25T12:00:00Z"),
      });
      const store = new PrismaOrgRulesetProvisioningRepository(prisma);
      const record = await store.requestAndEnqueue(request);
      const remote = await rulesetHttpFixture();
      remotes.push(remote);
      const gateway = () => new OctokitOrgRulesetSetupGateway(remote.requester);
      const run = (
        provisioning = new PrismaOrgRulesetProvisioningRepository(prisma),
      ) =>
        provisionOrgRulesetRequiredWorkflow(
          {
            provisioningId: record.id,
            actionRef: "777genius/review-router@main",
            apiUrl: "https://api.reviewrouter.test",
            runtimeConfigMode: "oidc",
            attemptedAt: new Date(),
          },
          {
            provisioning,
            lock: new PostgresLeaseLock(prisma),
            setupGateway: gateway(),
          },
        );
      return { request, record, store, remote, gateway, run, workspaceId };
    }

    it("commits distinct revisions and events even for same-millisecond concurrent requests", async () => {
      const f = await fixture();
      await Promise.all([
        f.store.requestAndEnqueue({ ...f.request, enforcement: "active" }),
        f.store.requestAndEnqueue(f.request),
      ]);
      expect((await f.store.findById(f.record.id))?.revision).toBe(3);
      const events = await prisma.outboxEvent.findMany({
        where: { workspaceId: f.workspaceId },
      });
      expect(events).toHaveLength(3);
      expect(new Set(events.map((event) => event.idempotencyKey)).size).toBe(3);
    });

    it("rolls back desired changes when the atomic outbox write fails", async () => {
      const f = await fixture();
      await prisma.outboxEvent.create({
        data: {
          type: "different",
          version: 1,
          idempotencyKey: `org-ruleset:${f.record.id}:revision:2`,
          workspaceId: f.workspaceId,
          payload: {},
          occurredAt: new Date(),
        },
      });
      await expect(
        f.store.requestAndEnqueue({ ...f.request, enforcement: "active" }),
      ).rejects.toThrow("outbox_idempotency_conflict");
      expect(await f.store.findById(f.record.id)).toMatchObject({
        revision: 1,
        enforcement: "evaluate",
        status: "requested",
      });
    });

    it("fences both success and failure from an older desired revision", async () => {
      const f = await fixture();
      const current = await f.store.requestAndEnqueue({
        ...f.request,
        enforcement: "active",
      });
      expect(
        await f.store.markConfigured({
          id: f.record.id,
          revision: 1,
          rulesetId: "77",
          rulesetUrl: null,
          sourceWorkflowSha: "old",
          configuredAt: new Date(),
        }),
      ).toBe(false);
      expect(
        await f.store.markFailed({
          id: f.record.id,
          revision: 1,
          safeErrorCode: "old",
          safeErrorSummary: "old",
        }),
      ).toBe(false);
      expect(await f.store.findById(f.record.id)).toEqual(current);
    });

    it("retains a lost create response as unknown until operator reconciliation, without another POST", async () => {
      const f = await fixture();
      f.remote.failNextCreate("apply_then_disconnect");
      await expect(f.run()).rejects.toThrow();
      expect(await f.store.findById(f.record.id)).toMatchObject({
        status: "failed",
        pendingRulesetCreateOrganization: f.workspaceId,
      });
      await expect(f.run()).rejects.toThrow(
        "org_ruleset_remote_outcome_unknown",
      );
      expect(f.remote.ruleset?.enforcement).toBe("evaluate");
      // Explicit operator action after the old process/remote call is settled and
      // the unique existing ruleset is inspected; a timer/readback never does this.
      await prisma.orgRulesetProvisioning.update({
        where: { id: f.record.id },
        data: { pendingRemoteAttemptId: null },
      });
      await f.run();
      expect(f.remote.createCount).toBe(1);
      expect(await f.store.findById(f.record.id)).toMatchObject({
        status: "configured",
        rulesetId: "77",
        pendingRulesetCreateOrganization: null,
      });
    });

    it("retains unknown create across a new request and refuses blind recreation or organization changes", async () => {
      const f = await fixture();
      f.remote.failNextCreate("disconnect");
      await expect(f.run()).rejects.toThrow();
      await f.store.requestAndEnqueue({ ...f.request, enforcement: "active" });
      await expect(f.run()).rejects.toThrow(
        "org_ruleset_remote_outcome_unknown",
      );
      expect(f.remote.createCount).toBe(1);
      expect(await f.store.findById(f.record.id)).toMatchObject({
        revision: 2,
        status: "failed",
        pendingRulesetCreateOrganization: f.workspaceId,
      });
      await expect(
        f.store.requestAndEnqueue({
          ...f.request,
          organizationLogin: "different-org",
        }),
      ).rejects.toThrow(
        "org_ruleset_create_outcome_unknown_for_previous_organization",
      );
    });

    it("clears a definitively rejected POST and permits a later successful request", async () => {
      const f = await fixture();
      f.remote.failNextCreate("reject");
      await expect(f.run()).rejects.toThrow();
      expect(
        (await f.store.findById(f.record.id))?.pendingRulesetCreateOrganization,
      ).toBeNull();
      await f.run();
      expect(f.remote.createCount).toBe(2);
      expect((await f.store.findById(f.record.id))?.status).toBe("configured");
    });

    it("recovers a crash after known HTTP completion and before configured settlement", async () => {
      const f = await fixture();
      vi.spyOn(f.store, "markConfigured").mockRejectedValueOnce(
        new Error("fixture_crash_before_configured"),
      );
      await expect(f.run(f.store)).rejects.toThrow(
        "fixture_crash_before_configured",
      );
      expect(
        (await f.store.findById(f.record.id))?.pendingRemoteAttemptId,
      ).toBeNull();
      await f.run();
      expect(f.remote.createCount).toBe(1);
      expect((await f.store.findById(f.record.id))?.status).toBe("configured");
    });

    it("clears the original rejected-create marker when desired revision changed in flight", async () => {
      const f = await fixture();
      f.remote.failNextCreate("reject");
      const gate = f.remote.holdNextCreate();
      const older = expect(f.run()).rejects.toThrow();
      await gate.entered;
      await f.store.requestAndEnqueue({ ...f.request, enforcement: "active" });
      gate.release();
      await older;
      expect(await f.store.findById(f.record.id)).toMatchObject({
        revision: 2,
        pendingRemoteAttemptId: null,
        pendingRulesetCreateOrganization: null,
      });
      await f.run();
      expect(f.remote.createCount).toBe(2);
      expect(await f.store.findById(f.record.id)).toMatchObject({
        status: "configured",
        enforcement: "active",
      });
    });

    it("retains the effect token when atomic repair enqueue fails", async () => {
      const f = await fixture();
      const attemptId = randomUUID();
      expect(
        await f.store.beginRemoteAttempt({
          id: f.record.id,
          revision: 1,
          attemptId,
        }),
      ).toBe(true);
      await f.store.requestAndEnqueue({ ...f.request, enforcement: "active" });
      const idempotencyKey = `org-ruleset:${f.record.id}:revision:2:repair:${attemptId}`;
      await prisma.outboxEvent.create({
        data: {
          type: "conflict",
          version: 1,
          idempotencyKey,
          workspaceId: f.workspaceId,
          payload: {},
          occurredAt: new Date(),
        },
      });
      await expect(
        f.store.settleRemoteAttempt({
          id: f.record.id,
          attemptId,
          observedRevision: 1,
          reconcile: true,
          occurredAt: new Date(),
        }),
      ).rejects.toThrow("outbox_idempotency_conflict");
      expect(
        (await f.store.findById(f.record.id))?.pendingRemoteAttemptId,
      ).toBe(attemptId);
      expect(
        await f.store.markConfigured({
          id: f.record.id,
          revision: 2,
          rulesetId: "77",
          rulesetUrl: null,
          sourceWorkflowSha: "sha",
          configuredAt: new Date(),
        }),
      ).toBe(false);
      await prisma.outboxEvent.delete({ where: { idempotencyKey } });
      await f.store.settleRemoteAttempt({
        id: f.record.id,
        attemptId,
        observedRevision: 1,
        reconcile: true,
        occurredAt: new Date(),
      });
      expect(await f.store.findById(f.record.id)).toMatchObject({
        pendingRemoteAttemptId: null,
        safeErrorCode: "org_ruleset_reconciliation_required",
      });
      // Replaying an old settlement cannot erase a different subsequent attempt.
      expect(
        await f.store.beginRemoteAttempt({
          id: f.record.id,
          revision: 2,
          attemptId: "new-attempt",
        }),
      ).toBe(true);
      await f.store.settleRemoteAttempt({
        id: f.record.id,
        attemptId,
        observedRevision: 1,
        reconcile: true,
        occurredAt: new Date(),
      });
      expect(
        (await f.store.findById(f.record.id))?.pendingRemoteAttemptId,
      ).toBe("new-attempt");
    });

    it("keeps an observed late write unresolved when recording its settlement fails", async () => {
      const f = await fixture();
      await f.run();
      await f.store.requestAndEnqueue({ ...f.request, enforcement: "active" });
      const gate = f.remote.holdNextUpdate();
      const older = expect(f.run(f.store)).rejects.toThrow(
        "fixture_database_outage",
      );
      await gate.entered;
      await f.store.requestAndEnqueue(f.request);
      vi.spyOn(f.store, "settleRemoteAttempt").mockRejectedValueOnce(
        new Error("fixture_database_outage"),
      );
      gate.release();
      await older;
      expect(f.remote.ruleset?.enforcement).toBe("active");
      await expect(f.run()).rejects.toThrow(
        "org_ruleset_remote_outcome_unknown",
      );
      const current = await f.store.findById(f.record.id);
      expect(current).toMatchObject({
        revision: 3,
        status: "failed",
        safeErrorCode: "org_ruleset_remote_outcome_unknown",
      });
      expect(current?.pendingRemoteAttemptId).toEqual(expect.any(String));
      expect(
        await f.store.markConfigured({
          id: f.record.id,
          revision: 3,
          rulesetId: "77",
          rulesetUrl: null,
          sourceWorkflowSha: "sha",
          configuredAt: new Date(),
        }),
      ).toBe(false);
    });

    it("blocks both matching readback and mutation across workspaces sharing the unresolved organization", async () => {
      const first = await fixture();
      await first.run();
      const second = await fixture();
      await second.store.requestAndEnqueue({
        ...second.request,
        organizationLogin: first.request.organizationLogin.toUpperCase(),
        sourceRepositoryFullName: `${first.workspaceId}/workflows`,
      });
      await first.store.requestAndEnqueue({
        ...first.request,
        enforcement: "active",
      });
      const gate = first.remote.holdNextUpdate();
      const older = expect(first.run(first.store)).rejects.toThrow(
        "fixture_database_outage",
      );
      await gate.entered;
      const key = `org-ruleset:remote:${first.workspaceId}:${defaultOrgRulesetName.toLowerCase()}`;
      await prisma.distributedLock.update({
        where: { key },
        data: { expiresAt: new Date(0) },
      });
      const secondRun = () =>
        provisionOrgRulesetRequiredWorkflow(
          {
            provisioningId: second.record.id,
            actionRef: "777genius/review-router@main",
            apiUrl: "https://api.reviewrouter.test",
            runtimeConfigMode: "oidc",
            attemptedAt: new Date(),
          },
          {
            provisioning: second.store,
            lock: new PostgresLeaseLock(prisma),
            setupGateway: first.gateway(),
          },
        );
      // The existing remote payload already matches B, but A still has a write in flight.
      await expect(secondRun()).rejects.toThrow(
        "org_ruleset_remote_outcome_unknown",
      );
      expect((await second.store.findById(second.record.id))?.status).toBe(
        "failed",
      );
      vi.spyOn(first.store, "settleRemoteAttempt").mockRejectedValueOnce(
        new Error("fixture_database_outage"),
      );
      gate.release();
      await older;
      expect(first.remote.ruleset?.enforcement).toBe("active");
      // A's marker also prevents B from PUTing after the stale write becomes visible.
      await expect(secondRun()).rejects.toThrow(
        "org_ruleset_remote_outcome_unknown",
      );
      expect(first.remote.updateCount).toBe(1);
      expect(
        (await first.store.findById(first.record.id))?.pendingRemoteAttemptId,
      ).toEqual(expect.any(String));
      expect(await second.store.findById(second.record.id)).toMatchObject({
        status: "failed",
        pendingRemoteAttemptId: null,
      });
    });

    it("repairs a superseded write observed after lease loss and settles the real outbox", async () => {
      const f = await fixture();
      await f.run();
      await f.store.requestAndEnqueue({ ...f.request, enforcement: "active" });
      const gate = f.remote.holdNextUpdate();
      const older = f.run();
      const olderResult = expect(older).rejects.toThrow(
        "distributed_lock_ownership_lost",
      );
      await gate.entered;
      const key = `org-ruleset:remote:${f.workspaceId}:${defaultOrgRulesetName.toLowerCase()}`;
      await expect(f.run()).rejects.toThrow("distributed_lock_not_acquired");
      await prisma.distributedLock.update({
        where: { key },
        data: { expiresAt: new Date(0) },
      });
      await f.store.requestAndEnqueue(f.request);
      await expect(f.run()).rejects.toThrow(
        "org_ruleset_remote_outcome_unknown",
      );
      expect((await f.store.findById(f.record.id))?.status).toBe("failed");
      gate.release();
      await olderResult;
      expect(f.remote.ruleset?.enforcement).toBe("active");
      expect((await f.store.findById(f.record.id))?.safeErrorCode).toBe(
        "org_ruleset_reconciliation_required",
      );
      expect(
        await prisma.outboxEvent.count({
          where: {
            workspaceId: f.workspaceId,
            idempotencyKey: { contains: ":repair:" },
          },
        }),
      ).toBe(1);

      const clock = { now: () => new Date() };
      const handler = createOrgRulesetProvisioningRequestedHandler({
        provisioning: new PrismaOrgRulesetProvisioningRepository(prisma),
        lock: new PostgresLeaseLock(prisma),
        createSetupGateway: async () => f.gateway(),
        clock,
        actionRef: "777genius/review-router@main",
        apiUrl: "https://api.reviewrouter.test",
        runtimeConfigMode: "oidc",
      });
      const batch = await processOutboxBatch(
        { limit: 10, handlers: [handler], claimOwnerHash: prefix },
        { outbox: new PrismaOutboxEventRepository(prisma), clock },
      );
      expect(batch).toMatchObject({
        claimed: 4,
        processed: 4,
        retried: 0,
        deadLettered: 0,
      });
      expect(f.remote.ruleset?.enforcement).toBe("evaluate");
      expect(await f.store.findById(f.record.id)).toMatchObject({
        revision: 3,
        status: "configured",
      });
      expect(f.remote.createCount).toBe(1);
    });
  },
);
