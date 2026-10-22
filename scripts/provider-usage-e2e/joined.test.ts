import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "../../packages/platform/db/src/index";
import { canonicalJson } from "../../packages/features/provider-usage/src/index";
import { PrismaUsageReportReader } from "../../packages/features/provider-usage/src/infrastructure/prisma-usage-store";
import {
  createProviderUsageApi,
  registerProviderUsageRoutes,
} from "../../apps/api/src/provider-usage-routes";
import { PrismaOperatorUsageReportReader } from "../../packages/features/provider-usage/src/infrastructure/prisma-operator-usage-report-reader";
import {
  createGatewayUsageSource,
  gatewayUsageCallId,
} from "../../apps/api/src/provider-usage-gateway-source";
import {
  PrismaUsageStore,
  PrismaUsageAttributionReader,
} from "../../packages/features/provider-usage/src/infrastructure/prisma-usage-store";
import { PrismaUsageReconciliation } from "../../packages/features/provider-usage/src/infrastructure/prisma-usage-reconciliation";
import { fact } from "../../packages/features/provider-usage/src/tests/fixture";
import { createGatewayUsageRecorder } from "../../apps/api/src/provider-usage-gateway-recorder";
import { workspacePolicyFixture } from "../../packages/features/review-config/src/tests/current-policy-fixture";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";

const adminUrl = process.env.USAGE_E2E_POSTGRES_ADMIN_URL;
const actionRoot = process.env.USAGE_E2E_ACTION_ROOT;
/** Real Action relay + network + production API + full migrated PostgreSQL.
 * The upstream and execution-authorization boundary are explicitly test fixtures.
 * This does not certify real providers, GitHub OIDC, or native Go Gateway coverage. */
describe.skipIf(!adminUrl || !actionRoot)(
  "joined usage transport/API/PostgreSQL",
  () => {
    const name = "TEST_usage_e2e_" + randomUUID().replaceAll("-", "");
    let scratch = "";
    const psql = (url: string, ...args: string[]) =>
      execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], {
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 12 * 1024 * 1024,
      });
    const roles = () =>
      psql(
        adminUrl!,
        "-Atc",
        "SELECT rolname FROM pg_roles WHERE rolname LIKE 'reviewrouter_%'",
      )
        .trim()
        .split("\n")
        .filter(Boolean);
    let initialRoles: string[] = [];
    let created = false;
    let prisma: PrismaClient;
    const app = Fastify();
    let upstream: Server;
    let requests = 0;
    let mode: "success" | "failure" | "unknown" = "success";
    let apiOrigin: string;
    let upstreamOrigin: string;
    let replay: { url: string; init: RequestInit } | undefined;
    let grantRegistration: { url: string; init: RequestInit } | undefined;
    let loseAck = true;
    let authorization: ReviewRunAuthorization;
    beforeAll(async () => {
      const designation = new URL(adminUrl!);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(designation.hostname))
        throw new Error("usage_e2e_loopback_admin_required");
      if (
        !/^17\d{4}$/.test(
          psql(adminUrl!, "-Atc", "SHOW server_version_num").trim(),
        )
      )
        throw new Error("usage_e2e_pg17_required");
      initialRoles = roles();
      scratch = mkdtempSync("tmp/usage-e2e-");
      psql(adminUrl!, "-c", `CREATE DATABASE "${name}"`);
      created = true;
      psql(
        adminUrl!,
        "-c",
        `ALTER DATABASE "${name}" SET timezone='Europe/Kyiv'`,
      );
      const url = new URL(adminUrl!);
      url.pathname = "/" + name;
      const migrations = "packages/platform/db/prisma/migrations";
      const sql = readdirSync(migrations)
        .sort()
        .filter((x) => x !== "migration_lock.toml")
        .map((x) => readFileSync(join(migrations, x, "migration.sql"), "utf8"))
        .join("\n");
      const file = join(scratch, "migrations.sql");
      writeFileSync(file, sql);
      psql(url.href, "-f", file);
      prisma = createPrismaClient({ databaseUrl: url.href });
      expect(await prisma.$queryRawUnsafe("SHOW timezone")).toEqual([
        { TimeZone: "UTC" },
      ]);
      await prisma.workspace.createMany({
        data: [
          { id: "usage-e2e", slug: "usage-e2e", name: "Disposable usage E2E" },
          { id: "usage-other", slug: "usage-other", name: "Other tenant" },
        ],
      });
      const now = new Date(),
        deadline = new Date(Date.now() + 3600000);
      const snapshot = canonicalJson({
        snapshotVersion: 3,
        configurationSource: "workspace",
        configurationVersion: 1,
        workspaceConfigurationVersion: 1,
        repositoryConfigurationVersion: null,
        effectivePolicyDigest: "sha256:" + "a".repeat(64),
        agent: {
          profileRef: "codex-default",
          agentKind: "codex",
          binarySha256: "a".repeat(64),
          packageVersion: "0.147.0",
          modelTransports: ["provider_api"],
          contextGateway: true,
          cancellation: true,
        },
        agentProfileDigest: "b".repeat(64),
        producer: {
          producerReleaseId: "usage-release",
          actionCommitSha: "c".repeat(40),
          runtimeCommitSha: "d".repeat(40),
        },
        configurationCanonicalJson: canonicalJson(workspacePolicyFixture),
        deadline: deadline.toISOString(),
        gateway: null,
      });
      await prisma.$transaction(async (seed) => {
        await seed.$executeRawUnsafe(
          "SET LOCAL session_replication_role = 'replica'",
        );
        await seed.producerRelease.create({
          data: {
            producerReleaseId: "usage-release",
            distributionKind: "public_reusable",
            actionCommitSha: "c".repeat(40),
            runtimeCommitSha: "d".repeat(40),
            runtimeEntrypointDigest: "e".repeat(64),
            schemaDigest: "f".repeat(64),
            capabilityProfile: "exact_revision_v2",
            protocolLimitsProfileId: "usage-limits",
            operationalSloProfileId: "usage-slo",
            registeredAt: now,
          },
        });
        authorization = (await seed.reviewRunAuthorization.create({
          data: {
            authorizationId: "usage-auth",
            workspaceId: "usage-e2e",
            repositoryConnectionId: "usage-repo",
            scmRepositoryIdentityId: "usage-scm",
            pullRequestNumber: 1,
            sourceRunId: "456",
            sourceRunAttempt: "1",
            workflowIdentityHash: "w".repeat(64),
            baseSha: "a".repeat(40),
            mergeBaseSha: "a".repeat(40),
            headSha: "b".repeat(40),
            reviewRevisionHash: "c".repeat(64),
            trustDomain: "trusted_managed",
            producerReleaseId: "usage-release",
            selectedProtocolVersion: "2",
            schemaDigest: "f".repeat(64),
            protocolLimitsProfileId: "usage-limits",
            operationalSloProfileId: "usage-slo",
            mutationEpoch: 1n,
            providerVoteLanes: [],
            runtimeSnapshotCanonicalJson: snapshot,
            authorizationSafetyDecisionHash: "d".repeat(64),
            protocolOfferHash: "e".repeat(64),
            oidcReplayKeyHash: "j".repeat(64),
            tokenSigningKeyId: "usage-key",
            tokenIssuer: "usage-fixture",
            tokenAudience: "usage-fixture",
            expiresAt: deadline,
            maxExpiresAt: deadline,
            createdAt: now,
          },
        })) as unknown as ReviewRunAuthorization;
      });
      const api = createProviderUsageApi({
        prisma,
        priceSnapshots: { read: async () => null },
        authorizations: {
          resolveReviewRunAuthorizationToken: async ({
            token,
          }: {
            token: string;
          }) =>
            token === "fixture-execution"
              ? { status: "valid", authorization }
              : { status: "denied", reason: "fixture" },
        } as never,
        resolveRepository: async () => ({
          githubRepositoryId: "123",
          githubInstallationId: "789",
          repositoryFullName: "fixture/disposable",
        }),
        confirmAuthority: async () => true,
        resolveActor: async () => "usage-member",
      });
      await registerProviderUsageRoutes(app, api);
      apiOrigin = await app.listen({ host: "127.0.0.1", port: 0 });
      upstream = createServer(async (req, res) => {
        for await (const chunk of req) {
          void chunk;
        }
        requests++;
        if (mode === "failure") {
          res
            .writeHead(503, { "content-type": "application/json" })
            .end('{"error":{"code":"fixture_unavailable"}}');
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const usage =
          mode === "unknown"
            ? {}
            : {
                usage: {
                  input_tokens: 10,
                  output_tokens: 3,
                  total_tokens: 13,
                  input_tokens_details: { cached_tokens: 2 },
                  output_tokens_details: { reasoning_tokens: 1 },
                },
              };
        res.end(
          "data: " +
            JSON.stringify({
              type: "response.completed",
              response: { id: "response-fixture", model: "gpt-5.5", ...usage },
            }) +
            "\n\ndata: [DONE]\n\n",
        );
      });
      upstream.listen(0, "127.0.0.1");
      await once(upstream, "listening");
      upstreamOrigin =
        "http://127.0.0.1:" + (upstream.address() as { port: number }).port;
    }, 60000);
    afterAll(async () => {
      await app.close();
      if (upstream)
        await new Promise<void>((resolve, reject) =>
          upstream.close((e) => (e ? reject(e) : resolve())),
        );
      await prisma?.$disconnect();
      if (created) {
        psql(adminUrl!, "-c", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        for (const role of roles().filter((r) => !initialRoles.includes(r))) {
          if (!/^reviewrouter_[a-z_]+$/.test(role))
            throw Error("invalid test role");
          psql(adminUrl!, "-c", `DROP ROLE "${role}"`);
        }
      }
      if (scratch) rmSync(scratch, { recursive: true, force: true });
    });
    it("reuses canonical diagnostic identity across concurrent identical nonce issuance", async () => {
      const input = {
        workspaceId: "usage-e2e",
        actorId: "usage-member",
        bindingId: "diagnostic-binding",
        invocationId: "diagnostic-invocation",
        attemptId: "diagnostic-attempt",
        executionRef: "diagnostic-execution",
        requestRef: "diagnostic-request",
        model: "gpt-5.5",
        deadline: new Date(Date.now() + 60000),
      };
      const recorder = createGatewayUsageRecorder(prisma);
      await Promise.all([
        recorder.diagnostic(input),
        recorder.diagnostic(input),
      ]);
      expect(
        await prisma.usageCall.count({ where: { purpose: "diagnostic" } }),
      ).toBe(1);
      expect(await prisma.usageIngestionConflict.count()).toBe(0);
    });
    it.skipIf(!process.env.USAGE_E2E_NATIVE_CAPTURE)(
      "imports actual native HTTP capture through reconciliation into tenant report",
      async () => {
        const page = JSON.parse(
          readFileSync(process.env.USAGE_E2E_NATIVE_CAPTURE!, "utf8"),
        );
        const store = new PrismaUsageStore(prisma),
          sourceInstance = "e2e/native-capture";
        const unique = new Map(
          page.observations.map((o: any) => [
            gatewayUsageCallId(o.executionRef, o.requestRef),
            o,
          ]),
        );
        for (const [callId, observation] of unique) {
          const o = observation as any;
          const sample = fact();
          await store.ingest(
            {
              ...sample,
              sourceInstance: "e2e/lifecycle",
              eventId: callId as string,
              authority: "lifecycle",
              identity: {
                ...sample.identity,
                workspaceId: "usage-e2e",
                callId: callId as string,
                invocationId: o.invocationRef,
                attemptId: o.attemptRef,
                actorId: "usage-member",
                occurredAt: o.occurredAt,
                requestedModel: o.model,
              },
              tokens: {
                inputTotal: null,
                outputTotal: null,
                total: null,
                cacheRead: null,
                cacheWrite: null,
                reasoning: null,
              },
              cost: null,
              completeness: "unknown",
              state: "prepared",
              dispatchEffect: "not_dispatched",
            },
            {
              workspaceId: "usage-e2e",
              invocationId: o.invocationRef,
              source: "native",
              now: new Date(),
              replayUntil: new Date(Date.now() + 60000),
            },
          );
        }
        const source = createGatewayUsageSource({
          workspaceId: "usage-e2e",
          sourceInstance,
          attribution: new PrismaUsageAttributionReader(prisma),
          client: { listUsage: async () => page },
          quarantine: async () => {
            throw Error("unexpected quarantine");
          },
        });
        const reconciliation = new PrismaUsageReconciliation(prisma);
        const lease = await reconciliation.claim({
          sourceInstance,
          workspaceId: "usage-e2e",
          owner: "e2e",
          now: new Date(),
          leaseMs: 60000,
          coveredFrom: new Date(),
        });
        expect(lease).not.toBeNull();
        const imported = await source.listUsage({
          afterCursor: null,
          limit: 100,
          highWaterMark: null,
        });
        await reconciliation.commitPage(lease!, imported, {
          workspaceId: "usage-e2e",
          invocationId: "source",
          source: "native",
          now: new Date(),
          replayUntil: new Date(Date.now() + 60000),
        });
        const report = await new PrismaUsageReportReader(prisma).report({
          workspaceId: "usage-e2e",
          actorId: "usage-member",
          access: "member",
          route: "gateway",
          purpose: "review",
          // Captured native events retain their actual source timestamps.
          // Replaying a retained fixture must not exclude it as wall time advances.
          from: new Date(
            Math.min(
              ...page.observations.map((o: { occurredAt: string }) =>
                Date.parse(o.occurredAt),
              ),
            ) - 1,
          ),
          to: new Date(
            Math.max(
              ...page.observations.map((o: { occurredAt: string }) =>
                Date.parse(o.occurredAt),
              ),
            ) + 1,
          ),
        });
        expect(report.totals.providerAttempts).toBe(3);
        expect(report.totals.tokens.total).toBe(10);
        expect(report.totals.partialCount).toBe(1);
      },
    );
    it("captures real sends, survives lost ACK and filters durable tenant/member totals", async () => {
      const { UsageDelivery } = await import(
        /* @vite-ignore */ join(actionRoot!, "src/provider-usage/delivery.ts")
      );
      const { startCodexUsageRelay } = await import(
        /* @vite-ignore */ join(
          actionRoot!,
          "src/provider-usage/codex-relay.ts",
        )
      );
      const dbAuth = await prisma.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: "usage-auth" },
      });
      expect(dbAuth.version).toBe(authorization.version);
      expect(dbAuth.state).toBe("active");
      expect(dbAuth.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(
        await prisma.$queryRaw`SELECT "authorizationId" FROM "ReviewRunAuthorization" WHERE "authorizationId"=${authorization.authorizationId} AND "version"=${authorization.version} AND "state"='active' AND "expiresAt">(statement_timestamp() AT TIME ZONE 'UTC') AND "maxExpiresAt">(statement_timestamp() AT TIME ZONE 'UTC')`,
      ).toHaveLength(1);
      const delivery = await UsageDelivery.create({
        apiUrl: "https://fixture.invalid",
        executionToken: "fixture-execution",
        invocationId: "usage-auth-provider-api",
        temporaryDirectory: scratch,
        uploadArtifact: async () => {
          throw Error("unexpected pending artifact");
        },
        fetchImpl: async (target: URL | string, init: RequestInit) => {
          const path = new URL(String(target)).pathname;
          const actual = apiOrigin + path;
          if (path.endsWith("/grants"))
            grantRegistration = { url: actual, init };
          if (path.endsWith("/reports")) replay = { url: actual, init };
          const result = await fetch(actual, init);
          if (!result.ok)
            console.error(
              "usage_e2e_api_refusal",
              result.status,
              await result.clone().json(),
            );
          if (path.endsWith("/reports") && loseAck && result.ok) {
            loseAck = false;
            throw Error("fixture_lost_ack_after_commit");
          }
          return result;
        },
      });
      const originalRecord = delivery.record.bind(delivery);
      delivery.record = (fact: unknown) => {
        const accepted = originalRecord(fact);
        if (!accepted) console.error("usage_e2e_record_refused");
        return accepted;
      };
      const relay = await startCodexUsageRelay({
        upstreamBaseUrl: "https://upstream.invalid",
        model: "gpt-5.5",
        provider: "codex",
        delivery,
        fetchUpstream: async (target: string, init: RequestInit) =>
          fetch(upstreamOrigin + new URL(target).pathname, init),
      });
      try {
        for (const current of ["success", "failure", "unknown"] as const) {
          mode = current;
          const r = await fetch(relay.baseUrl + "/responses", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "gpt-5.5",
              input: "bounded synthetic fixture",
            }),
          });
          expect(r.status).toBe(current === "failure" ? 503 : 200);
          await r.text();
        }
      } finally {
        await relay.close();
      }
      await delivery.flush(); // Simulate first delivery committing server-side but losing its ACK.
      await prisma.reviewRunAuthorization.update({
        where: { authorizationId: "usage-auth" },
        data: { state: "revoked", revokedAt: new Date() },
      });
      await delivery.cleanup(); // The report-only grant still retries after execution revocation.
      expect(grantRegistration).toBeDefined();
      expect(
        (await fetch(grantRegistration!.url, grantRegistration!.init)).status,
      ).toBe(403);
      // A lost ACK is retained as explicit historical partial coverage even after durable retry.
      expect(delivery.coverage).toBe("partial");
      const acknowledgedSpool = JSON.parse(
        readFileSync(delivery.artifactPath, "utf8"),
      );
      expect(acknowledgedSpool.facts).toEqual([]);
      expect(acknowledgedSpool.producerCoverage).toMatchObject({
        state: "partial",
        reason: "delivery_failed",
        droppedEvents: 0,
      });
      expect(requests).toBe(3);
      const count = await prisma.usageSourceFact.count();
      expect(replay).toBeDefined();
      const duplicate = await fetch(replay!.url, replay!.init);
      expect(duplicate.status).toBe(200);
      expect(await prisma.usageSourceFact.count()).toBe(count);
      const reader = new PrismaUsageReportReader(prisma);
      const query = {
        workspaceId: "usage-e2e",
        purpose: "review" as const,
        route: "direct" as const,
        actorId: "usage-member",
        access: "member" as const,
        from: new Date(Date.now() - 60000),
        to: new Date(Date.now() + 60000),
        limit: 1,
      };
      const report = await reader.report(query);
      expect(report.rows).toHaveLength(1);
      expect(report.totals.providerAttempts).toBe(3);
      expect(report.totals.tokens.total).toBe(13);
      expect(
        report.totals.unknownCount + report.totals.partialCount,
      ).toBeGreaterThan(0);
      expect(report.totals.unknownCostCount).toBe(3);
      expect(
        (await reader.report({ ...query, actorId: "other-member" })).rows,
      ).toEqual([]);
      expect(
        (
          await reader.report({
            ...query,
            workspaceId: "usage-other",
            access: "admin",
          })
        ).rows,
      ).toEqual([]);
      expect(
        (await reader.report({ ...query, access: "admin" })).totals
          .providerAttempts,
      ).toBe(3);
      await prisma.workspace.create({
        data: {
          id: "usage-operator",
          slug: "usage-operator",
          name: "Disposable operator",
        },
      });
      await prisma.user.createMany({
        data: [{ id: "usage-operator-user" }, { id: "usage-foreign-admin" }],
      });
      await prisma.workspaceMember.createMany({
        data: [
          {
            workspaceId: "usage-operator",
            userId: "usage-operator-user",
            role: "admin",
          },
          {
            workspaceId: "usage-other",
            userId: "usage-foreign-admin",
            role: "admin",
          },
        ],
      });
      const operator = new PrismaOperatorUsageReportReader(
        prisma,
        "usage-operator",
      );
      const operatorQuery = {
        operatorWorkspaceId: "usage-operator",
        actorId: "usage-operator-user",
        purpose: "review" as const,
        route: "direct" as const,
        from: query.from,
        to: query.to,
        limit: 1,
      };
      expect(
        (await operator.report(operatorQuery)).totals.providerAttempts,
      ).toBe(3);
      expect((await operator.report(operatorQuery)).totals.tokens.total).toBe(
        13,
      );
      await expect(
        operator.report({ ...operatorQuery, actorId: "usage-foreign-admin" }),
      ).rejects.toThrow("usage_access_denied");
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: "usage-operator", userId: "usage-operator-user" },
      });
      await expect(operator.report(operatorQuery)).rejects.toThrow(
        "usage_access_denied",
      );
      const artifact = readFileSync(delivery.artifactPath, "utf8");
      expect(artifact).not.toContain("fixture-execution");
      expect(artifact).not.toContain("bounded synthetic fixture");
    }, 30000);
  },
);
