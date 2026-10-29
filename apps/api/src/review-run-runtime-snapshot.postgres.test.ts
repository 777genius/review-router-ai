import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { createApiApp } from "./app";
import { describe, expect, it } from "vitest";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  accountAdmissionApiGrantStatements,
  activationAuthorityProvisioningSql,
} from "../../../scripts/run-codex-rotating-release-migration.mjs";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import Fastify from "fastify";
import type { AddressInfo } from "node:net";
import type * as Gateway from "@agent-teams/account-gateway/contracts";
import {
  createPrismaClient,
  rotateScmRepositoryIdentityEpoch,
} from "@reviewrouter/platform-db";
import { PrismaGitHubInstallationRepository } from "@reviewrouter/features-github-installations";
import { PrismaProviderAccountRepository } from "@reviewrouter/features-provider-accounts";
import {
  mapConfigToRuntimeEnv,
  parseReviewConfigurationStrict,
  PrismaReviewConfigurationRepository,
  saveReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  ManageReviewRunAuthorizations,
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  parseReviewAgentProfiles,
  parseProducerPrDescriptionProfile,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationDenialReason,
  ReviewTrustDomain,
  ReviewRunAuthorizationUseCaseStatus,
  ReviewMutationLaneKind,
  ReviewMutationMode,
  type ReviewRunAuthorization,
  type VerifiedScmRunIdentity,
  type ReviewRunRuntimeSnapshotPort,
} from "@reviewrouter/features-review-run-control";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
} from "../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";
import {
  composeReviewActionV2ProductionRunControl,
  composeReviewActionV2ProductionRoutes,
} from "./review-action-v2-production-composition";
import {
  createReviewRunGatewayRelay,
  registerReviewRunGatewayRelayRoutes,
  type ReviewRunGatewayRelay,
} from "./review-run-gateway-relay";
import { registerReviewRunGatewayCheckoutRoute } from "./review-run-gateway-checkout";
import { createReviewRunGatewayPreparation } from "./review-run-gateway-preparation";
import { PrismaReviewRunGatewayExecutionBinding } from "./prisma-review-run-gateway-execution-binding";
import {
  ProductionReviewRunRuntimeSnapshot,
  reviewRunGatewayPreparationIdentity,
} from "./review-run-runtime-snapshot";

function snapshotIdentity(
  harness: Awaited<ReturnType<typeof createReviewActionV2E2EHarness>>,
): VerifiedScmRunIdentity {
  return {
    workspaceId: harness.workspaceId,
    repositoryConnectionId: harness.repositoryConnectionId,
    scmRepositoryIdentityId: harness.scmRepositoryIdentityId,
    pullRequestNumber: 1,
    sourceRunId: "signed-transport-test",
    sourceRunAttempt: "1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBaseSha: "b".repeat(40),
    reviewRevisionHash: "d".repeat(64),
    workflowIdentityHash: "c".repeat(64),
    trustDomain: ReviewTrustDomain.TrustedManaged,
  };
}

// Pure loopback HTTP; no PostgreSQL, authority admission or provider traffic.
// RED before the fix: the third incomplete upload reaches preParsing rather
// than receiving relay_saturated, despite two occupied ingestion slots.
it("bounds incomplete Responses bodies and recovers ingress slots", async () => {
  let forbiddenWork = 0;
  const unused = async (): Promise<never> => {
    forbiddenWork++;
    throw new Error("ingress_test_must_not_reach_authority_or_gateway");
  };
  const relay = createReviewRunGatewayRelay({
    policy: {
      profiles: [
        {
          profile: {
            profileId: "fixture-profile",
            protocol: "openai-responses",
            modelIds: ["fixture-model"],
            authKinds: ["api_key"],
          },
          outputTokens: 128,
        },
      ],
      ingressBytes: 2048,
      requestTimeoutMs: 2000,
      waitBudgetMs: 0,
      maxWaits: 0,
      maxSessions: 1,
      maxInFlight: 2,
    },
    runAccess: {
      origin: "http://127.0.0.1:1",
      runControlBearer: "unused",
      timeoutMs: 2000,
    },
    authorizations: {
      resolveReviewRunAuthorizationToken: unused,
      expireOrRevokeReviewRunAuthorization: unused,
    },
    queries: { findReviewRunAuthorizationById: unused },
    checkAuthority: unused,
    confirmAuthority: unused,
    snapshots: { capture: unused, isLive: unused },
    bindings: { read: unused, attach: unused },
  });
  const app = Fastify();
  const parsing = new Map<string, (raw: IncomingMessage) => void>();
  app.addHook("preParsing", async (request, _reply, payload) => {
    parsing.get(request.raw.url!)?.(request.raw);
    return payload;
  });
  await registerReviewRunGatewayRelayRoutes(app, relay);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const clients: ReturnType<typeof httpRequest>[] = [];
  const upload = (name: string, completeBody?: string) => {
    const path = `/api/action/v2/account-gateway/responses?${name}`;
    const parsed = new Promise<IncomingMessage>((resolve) =>
      parsing.set(path, resolve),
    );
    let client!: ReturnType<typeof httpRequest>;
    const response = new Promise<{ status: number; body: string } | undefined>(
      (resolve) => {
        client = httpRequest(
          {
            host: "127.0.0.1",
            port,
            path,
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(completeBody === undefined
                ? {}
                : { "content-length": Buffer.byteLength(completeBody) }),
            },
          },
          (reply) => {
            let body = "";
            reply.setEncoding("utf8");
            reply.on("data", (chunk: string) => {
              body += chunk;
            });
            reply.on("end", () => resolve({ status: reply.statusCode!, body }));
            reply.on("error", () => resolve(undefined));
          },
        );
        client.on("error", () => resolve(undefined));
      },
    );
    clients.push(client);
    if (completeBody === undefined)
      client.write('{"input":"' + "x".repeat(1024));
    else client.end(completeBody);
    return { client, parsed, response };
  };
  const saturated = async (name: string) => {
    const excess = upload(name);
    const result = await Promise.race([
      excess.response,
      excess.parsed.then(() => "entered_parser"),
    ]);
    expect(result).toEqual({
      status: 503,
      body: JSON.stringify({
        error: { code: "relay_saturated", effect: "not_dispatched" },
      }),
    });
    excess.client.destroy();
  };
  try {
    const first = upload("first");
    const second = upload("second");
    const [firstRaw, secondRaw] = await Promise.all([
      first.parsed,
      second.parsed,
    ]);
    const timedOut = once(secondRaw, "aborted");
    await saturated("excess");
    // Ingestion leaves status and cancellation routes outside its budget.
    for (const url of [
      "/api/action/v2/account-gateway/requests/fixture-request",
      "/api/action/v2/account-gateway/close",
    ]) {
      const response = await app.inject({
        method: url.endsWith("close") ? "POST" : "GET",
        url,
        ...(url.endsWith("close")
          ? {
              headers: { "content-type": "application/json" },
              payload: '{"reason":"cancelled"}',
            }
          : {}),
      });
      expect(response.statusCode).toBe(401);
    }
    const disconnected = once(firstRaw, "aborted");
    first.client.destroy();
    await disconnected;
    const replacement = upload("replacement");
    const replacementRaw = await replacement.parsed;
    await saturated("still-full");
    const replacementDisconnected = once(replacementRaw, "aborted");
    replacement.client.destroy();
    await replacementDisconnected;
    expect((await upload("too-large", "x".repeat(2049)).response)?.status).toBe(
      400,
    );
    // The other slot is still occupied: both parser errors and normal handler
    // errors must release, without double-freeing the remaining reservation.
    expect((await upload("normal-error", "{}").response)?.status).toBe(401);
    await timedOut;
    expect(await second.response).toBeUndefined();
    const recovered = upload("after-timeout");
    const recoveredSecond = upload("after-timeout-second");
    await Promise.all([recovered.parsed, recoveredSecond.parsed]);
    await saturated("full-again");
    expect(forbiddenWork).toBe(0);
    // preClose must terminate incomplete bodies without waiting for their timers.
    await app.close();
    expect(await recovered.response).toBeUndefined();
    expect(await recoveredSecond.response).toBeUndefined();
  } finally {
    for (const client of clients) client.destroy();
    await app.close();
  }
});

const enabled = process.env.RR_C2C_PG_TEST === "1";
// Exercise the maintained generator's actual table/column predicates without
// creating an activation permit or changing unrelated runtime principals.
function accountAdmissionCanonicalAclQuery(): string {
  const generated = activationAuthorityProvisioningSql();
  const facts = generated.match(
    /WITH runtime_roles\(role_name, role_kind\) AS \(VALUES[\s\S]+?\n {4}\), sequence_facts AS/u,
  )?.[0];
  const tableGate = generated.match(
    /OR EXISTS \(SELECT 1 FROM table_facts WHERE([\s\S]+?)\)\n {7}OR EXISTS \(\n {9}SELECT 1 FROM column_facts/u,
  )?.[1];
  const columnGate = generated.match(
    /OR EXISTS \(\n {9}SELECT 1 FROM column_facts([\s\S]+?)\n {7}\)\n {7}OR EXISTS \(SELECT 1 FROM sequence_facts/u,
  )?.[1];
  if (!facts || !tableGate || !columnGate)
    throw new Error("canonical_acl_generator_shape_changed");
  const scopedFacts = facts
    .replace(
      /WITH runtime_roles\(role_name, role_kind\) AS \(VALUES[\s\S]+?\n {4}\), tables AS/u,
      "WITH runtime_roles(role_name, role_kind) AS (VALUES ('reviewrouter_api','api')), tables AS",
    )
    .replace(
      "relation.relkind IN ('r','p','v','m','f')",
      "relation.relkind IN ('r','p','v','m','f') AND relation.relname IN ('ProviderAccountConnection','WorkspaceAccountBinding')",
    )
    .replace(
      "AND attribute.attnum>0 AND NOT attribute.attisdropped",
      "AND attribute.attnum>0 AND NOT attribute.attisdropped AND relation.relname IN ('ProviderAccountConnection','WorkspaceAccountBinding')",
    )
    .replace(/, sequence_facts AS$/u, "");
  return `${scopedFacts} SELECT NOT (
    EXISTS (SELECT 1 FROM table_facts WHERE ${tableGate})
    OR EXISTS (SELECT 1 FROM column_facts ${columnGate})
  ) AS canonical`;
}

function disposableDatabase(): string {
  const raw = process.env.RR_C2C_PG_TEST_URL ?? "";
  const url = new URL(raw);
  if (
    process.env.RR_C2C_MIGRATED_DISPOSABLE_DATABASE !== "1" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^rr_gateway_test_c2c_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "c2c_explicit_migrated_disposable_loopback_database_required",
    );
  }
  return raw;
}

// Regressions named before the test: first-admission winner + immutable settings;
// strict stored provider rows cannot be silently deduplicated at admission;
// settings switching to another live binding cannot replace or un-revoke the original;
// settings/binding races fenced at INSERT; original revoke/foreign owner denial;
// a live original-binding read that crosses the original deadline still denies;
// ordinary TTL renewal to version 2 must preserve the version-1 creation event;
// authority reads crossing the token TTL or original maximum must deny;
// negotiation/new-token/new-ID cannot produce another admitted allowance identity.
// Selected-result loss must recover the same intent and attach once, without a bearer in SQL.
// Relay regressions: an ordinary retry could bypass LOCAL-only wait, lost process
// capabilities could automatically reprepare, caller model/duplicate keys could
// override the pin, or the old per-chunk 64KiB bound could reject approved SSE.
// A stream failure must never create another request; cancelled held SSE must
// not become clean EOF when SDK teardown resolves read(done=true).
// Exact close must deny new calls.
// P45: pause during delayed SCM, or epoch advance during a locked binding read,
// must deny before SDK dispatch. Held status/recovery must consume the same slot
// as Responses; excess calls must not reach SCM, run-access or status HTTP.
// Checkout: a read-only issuer result that returns after installation revocation
// must never reach CI, and unknown caller authority fields must not mint.
// This is real RR PostgreSQL + synthetic OIDC/SCM + controlled Gateway HTTP, no inference.
describe.skipIf(!enabled)("C2c actual first-admission runtime pin", () => {
  it("binds runtime capture to signed transport and keeps legacy release profiles closed", async () => {
    const databaseUrl = disposableDatabase();
    await resetReviewActionV2E2EDatabase(databaseUrl);
    const harness = await createReviewActionV2E2EHarness(databaseUrl, {
      modelTransport: "account_gateway",
    });
    try {
      // Real JWKS-signed runtime.yml + rotating policy must fail before any row.
      await expect(harness.authorize()).rejects.toMatchObject({
        statusCode: 412,
        issues: ["admission_facts_changed"],
      });
      const { prisma } = harness;
      expect(await prisma.reviewRunAuthorization.count()).toBe(0);
      const producerRow = await prisma.producerRelease.findUniqueOrThrow({
        where: { producerReleaseId: harness.producerReleaseId },
        select: {
          producerReleaseId: true,
          actionCommitSha: true,
          runtimeCommitSha: true,
          agentProfilesJson: true,
          prDescriptionProfile: true,
        },
      });
      const producer = {
        ...producerRow,
        prDescriptionProfile:
          producerRow.prDescriptionProfile == null
            ? null
            : parseProducerPrDescriptionProfile(
                producerRow.prDescriptionProfile,
              ),
      };
      if (typeof producer.agentProfilesJson !== "string")
        throw new Error("signed_transport_producer_profiles_missing");
      const profiles = parseReviewAgentProfiles(
        JSON.parse(producer.agentProfilesJson),
      );
      const snapshot = new ProductionReviewRunRuntimeSnapshot(prisma);
      const identity = snapshotIdentity(harness);
      const input = {
        identity,
        deadline: new Date(Date.now() + 60_000),
        producerRelease: { ...producer, agentProfiles: profiles },
        modelTransport: "provider_api" as const,
      };
      expect(await snapshot.capture(input)).toMatchObject({ gateway: null });
      // RED: selecting Claude for Gateway used to deny Secrets or audit Claude
      // while the Secret-backed runtime independently installed Codex.
      const claude = {
        ...profiles[0]!,
        profileRef: "approved-claude",
        agentKind: "claude" as const,
        // Keep the correlated profile contract: claude never opts out of the
        // context gateway, so the spread union collapses to the claude variant.
        contextGateway: true as const,
      };
      const claudeGatewaySnapshot = new ProductionReviewRunRuntimeSnapshot(
        prisma,
        undefined,
        undefined,
        false,
        claude.profileRef,
      );
      expect(
        await claudeGatewaySnapshot.capture({
          ...input,
          producerRelease: {
            ...producer,
            agentProfiles: [...profiles, claude],
          },
        }),
      ).toMatchObject({ gateway: null, agent: profiles[0]! });
      expect(
        await snapshot.capture({ ...input, modelTransport: "account_gateway" }),
      ).toBeNull();
      expect(
        await snapshot.capture({
          ...input,
          producerRelease: {
            ...producer,
            agentProfiles: profiles.map((profile) => ({
              ...profile,
              modelTransports: ["account_gateway"],
            })),
          },
        }),
      ).toBeNull();
      expect(
        await snapshot.capture({
          ...input,
          producerRelease: { ...producer, agentProfiles: null },
        }),
      ).toBeNull();
      // Even a dual-transport release cannot authorize a mixed policy.
      const mixedConnection = await prisma.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: harness.workspaceId,
          gatewayAccountRef: `${harness.prefix}-mixed-account`,
          profileRef: "mimo-responses-v1",
          displayName: "Mixed transport",
          state: "active",
        },
      });
      const mixedBinding = await prisma.workspaceAccountBinding.create({
        data: {
          workspaceId: harness.workspaceId,
          connectionId: mixedConnection.id,
          state: "active",
        },
      });
      const mixedPolicy = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        providers: [
          ...workspacePolicyFixture.providers,
          {
            kind: "codex",
            authMode: "codex_account_gateway",
            model: "mimo-v2-pro",
            reasoningEffort: "high",
            fastMode: false,
            agenticContext: true,
            gatewayBindingId: mixedBinding.id,
            gatewayProfileRef: mixedConnection.profileRef,
          },
        ],
        execution: {
          providerLimit: 2,
          providerMaxParallel: 2,
          inlineMinAgreement: 1,
        },
      });
      const mixedTarget = {
        scope: "repository" as const,
        workspaceId: harness.workspaceId,
        repositoryId: harness.repositoryConnectionId,
      };
      await new PrismaReviewConfigurationRepository(
        prisma,
        undefined,
        false,
        undefined,
      ).saveNextVersion({
        target: mixedTarget,
        ...systemPolicyWriteFixture(mixedPolicy, mixedTarget),
      });
      for (const modelTransport of [
        "provider_api",
        "account_gateway",
      ] as const) {
        expect(await snapshot.capture({ ...input, modelTransport })).toBeNull();
      }
      // A retained legacy head is not absence and cannot fall back to defaults.
      await prisma.reviewConfigurationVersion.updateMany({
        where: { workspaceId: harness.workspaceId },
        data: { policyJson: JSON.stringify({ schemaVersion: 2 }) },
      });
      expect(await snapshot.capture(input)).toBeNull();
    } finally {
      await harness.close();
    }
  });
  it("locks checkout repositories for the SELECT-only API without runtime write authority", async () => {
    const harness = await createReviewActionV2E2EHarness(disposableDatabase());
    const { prisma, workspaceId, repositoryConnectionId } = harness;
    const writer = createPrismaClient({
      databaseUrl: disposableDatabase(),
      poolMax: 1,
    });
    const api = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_api");
        return run(tx);
      });
    const lock = (
      tx: Prisma.TransactionClient,
      workspace = workspaceId,
      repository = repositoryConnectionId,
    ) =>
      tx.$queryRaw<
        readonly { id: string }[]
      >`SELECT id FROM public.rr_review_run_checkout_repository_lock(${workspace}, ${repository})`;
    let unlock: (() => void) | undefined;
    let held: Promise<void> | undefined;
    try {
      await prisma.$executeRawUnsafe(`DO $fixture$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='reviewrouter_api') THEN
          CREATE ROLE reviewrouter_api NOLOGIN NOINHERIT;
        END IF;
      END $fixture$`);
      await prisma.$executeRawUnsafe(
        "GRANT USAGE ON SCHEMA public TO reviewrouter_api",
      );
      await prisma.$executeRawUnsafe(
        'REVOKE INSERT, UPDATE, DELETE ON public."RepositoryConnection" FROM reviewrouter_api',
      );
      await prisma.$executeRawUnsafe(
        'GRANT SELECT ON public."RepositoryConnection" TO reviewrouter_api',
      );
      await prisma.$executeRawUnsafe(
        "GRANT EXECUTE ON FUNCTION public.rr_review_run_checkout_repository_lock(text,text) TO reviewrouter_api",
      );
      expect(
        await api(
          (tx) =>
            tx.$queryRaw`SELECT has_any_column_privilege(current_user, 'public."RepositoryConnection"', 'INSERT,UPDATE') AS writable`,
        ),
      ).toEqual([{ writable: false }]);
      // This direct lock is the original production failure under canonical ACLs.
      await expect(
        api(
          (tx) =>
            tx.$queryRaw`SELECT id FROM public."RepositoryConnection" WHERE id=${repositoryConnectionId} FOR SHARE`,
        ),
      ).rejects.toThrow(/permission denied/);
      expect(await api((tx) => lock(tx, `${workspaceId}-wrong`))).toEqual([]);
      expect(
        await api((tx) =>
          lock(tx, workspaceId, `${repositoryConnectionId}-missing`),
        ),
      ).toEqual([]);
      expect(await api((tx) => lock(tx))).toEqual([
        { id: repositoryConnectionId },
      ]);
      await expect(
        api(
          (tx) =>
            tx.$executeRaw`UPDATE public."RepositoryConnection" SET selected=selected WHERE id=${repositoryConnectionId}`,
        ),
      ).rejects.toThrow(/permission denied/);
      let ready!: () => void;
      const acquired = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      held = api(async (tx) => {
        expect(await lock(tx)).toEqual([{ id: repositoryConnectionId }]);
        ready();
        await release;
      });
      await Promise.race([acquired, held]);
      await expect(
        writer.$transaction(async (tx) => {
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'");
          await tx.$executeRaw`UPDATE public."RepositoryConnection" SET selected=selected WHERE id=${repositoryConnectionId}`;
        }),
      ).rejects.toThrow(/lock timeout/);
      unlock?.();
      await held;
      held = undefined;
      // A writer can acquire the same row after the API transaction releases it.
      await expect(
        writer.$transaction(async (tx) => {
          await tx.$executeRaw`UPDATE public."RepositoryConnection" SET selected=selected WHERE id=${repositoryConnectionId}`;
          throw new Error("checkout_writer_rollback");
        }),
      ).rejects.toThrow("checkout_writer_rollback");
    } finally {
      unlock?.();
      await held?.catch(() => undefined);
      await writer.$disconnect();
      await harness.close();
    }
  }, 30_000);

  // SELECT-only reproduces the production failure. The existing table owner
  // projects UPDATE(id) only; immutable guards still deny changed C1 authority.
  it("locks account admission with non-mutating API column privileges", async () => {
    const prisma = createPrismaClient({
      databaseUrl: disposableDatabase(),
      poolMax: 4,
    });
    const observer = createPrismaClient({
      databaseUrl: disposableDatabase(),
      poolMax: 4,
    });
    const prefix = `c2c-account-lock-${randomUUID()}`;
    const workspaceId = `${prefix}-workspace`;
    const aclOwner = `rr_c1_owner_${randomUUID().replaceAll("-", "")}`;
    let workspaceCreated = false;
    let ownerCreated = false;
    let parameterGranted = false;
    let unlock: (() => void) | undefined;
    let held: Promise<void> | undefined;
    const api = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_api");
        return run(tx);
      });
    try {
      await prisma.workspace.create({
        data: {
          id: workspaceId,
          slug: workspaceId,
          name: "Disposable account lock fixture",
        },
      });
      workspaceCreated = true;
      const connection = await prisma.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspaceId,
          gatewayAccountRef: `${prefix}-lock-account`,
          profileRef: "mimo-responses-v1",
          displayName: "Synthetic locking account",
          state: "active",
        },
      });
      const binding = await new PrismaProviderAccountRepository(
        prisma,
      ).compareAndSetBinding({
        workspaceId,
        connectionId: connection.id,
        expectedRevision: 0,
        state: "active",
      });
      await prisma.$executeRawUnsafe(`DO $fixture$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='reviewrouter_api') THEN
          CREATE ROLE reviewrouter_api NOLOGIN NOINHERIT;
        END IF;
      END $fixture$`);
      await prisma.$executeRawUnsafe(
        "GRANT USAGE ON SCHEMA public TO reviewrouter_api",
      );
      await prisma.$executeRawUnsafe(
        'REVOKE ALL ON public."ProviderAccountConnection", public."WorkspaceAccountBinding" FROM reviewrouter_api',
      );
      await prisma.$executeRawUnsafe(
        'REVOKE UPDATE(id) ON public."ProviderAccountConnection", public."WorkspaceAccountBinding" FROM reviewrouter_api',
      );
      await prisma.$executeRawUnsafe(
        'GRANT SELECT ON public."ProviderAccountConnection", public."WorkspaceAccountBinding" TO reviewrouter_api',
      );
      await expect(
        api(
          (tx) =>
            tx.$queryRaw`SELECT id FROM public."ProviderAccountConnection" WHERE id=${connection.id} FOR UPDATE`,
        ),
      ).rejects.toThrow(/permission denied/);

      // Prove maintained convergence clears broad and stale column grants using
      // a nonsuperuser C1 table owner, not a privileged fixture grant shortcut.
      await prisma.$executeRawUnsafe(
        `CREATE ROLE ${aclOwner} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      ownerCreated = true;
      await prisma.$executeRawUnsafe(
        `GRANT USAGE ON SCHEMA public TO ${aclOwner}`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public."ProviderAccountConnection" OWNER TO ${aclOwner}`,
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE public."WorkspaceAccountBinding" OWNER TO ${aclOwner}`,
      );
      await prisma.$executeRawUnsafe(
        'GRANT INSERT, UPDATE, DELETE ON public."ProviderAccountConnection", public."WorkspaceAccountBinding" TO reviewrouter_api',
      );
      await prisma.$executeRawUnsafe(
        'GRANT UPDATE(state), INSERT("profileRef") ON public."ProviderAccountConnection" TO reviewrouter_api',
      );
      await prisma.$executeRawUnsafe(
        'GRANT UPDATE("revision", "fenceAckPolicyRevision") ON public."WorkspaceAccountBinding" TO reviewrouter_api',
      );
      await prisma.$executeRawUnsafe(
        "GRANT SET ON PARAMETER session_replication_role TO reviewrouter_api",
      );
      parameterGranted = true;
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${aclOwner}`);
          await tx.$executeRawUnsafe(accountAdmissionApiGrantStatements());
        }),
      ).rejects.toThrow(/account admission API role is privileged/);
      await prisma.$executeRawUnsafe(
        "REVOKE SET ON PARAMETER session_replication_role FROM reviewrouter_api",
      );
      parameterGranted = false;
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${aclOwner}`);
        const authority = await tx.$queryRaw<
          { superuser: boolean }[]
        >`SELECT rolsuper AS superuser FROM pg_catalog.pg_roles WHERE rolname=current_user`;
        expect(authority).toEqual([{ superuser: false }]);
        await tx.$executeRawUnsafe(accountAdmissionApiGrantStatements());
      });
      const privileges = await prisma.$queryRaw<
        {
          table_name: string;
          column_name: string;
          can_update: boolean;
          can_insert: boolean;
          can_reference: boolean;
        }[]
      >`
        SELECT relation.relname AS table_name, attribute.attname AS column_name,
          has_column_privilege('reviewrouter_api', relation.oid, attribute.attnum, 'UPDATE') AS can_update,
          has_column_privilege('reviewrouter_api', relation.oid, attribute.attnum, 'INSERT') AS can_insert,
          has_column_privilege('reviewrouter_api', relation.oid, attribute.attnum, 'REFERENCES') AS can_reference
        FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid=relation.oid
        WHERE relation.oid IN ('public."ProviderAccountConnection"'::regclass, 'public."WorkspaceAccountBinding"'::regclass)
          AND attribute.attnum>0 AND NOT attribute.attisdropped`;
      expect(privileges.filter((row) => row.can_update)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            table_name: "ProviderAccountConnection",
            column_name: "id",
          }),
          expect.objectContaining({
            table_name: "WorkspaceAccountBinding",
            column_name: "id",
          }),
        ]),
      );
      expect(privileges.filter((row) => row.can_update)).toHaveLength(2);
      expect(
        privileges.every((row) => !row.can_insert && !row.can_reference),
      ).toBe(true);
      const canonicalAcl = accountAdmissionCanonicalAclQuery();
      const canonical = (tx: Prisma.TransactionClient) =>
        tx.$queryRawUnsafe<{ canonical: boolean }[]>(canonicalAcl);
      expect(await canonical(prisma)).toEqual([{ canonical: true }]);
      for (const table of [
        "ProviderAccountConnection",
        "WorkspaceAccountBinding",
      ]) {
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              `GRANT UPDATE(state) ON public."${table}" TO reviewrouter_api`,
            );
            expect(await canonical(tx)).toEqual([{ canonical: false }]);
            // PostgreSQL rolls the grant back even if the assertion above fails.
            throw new Error("rollback_fixture_api_column_grant");
          }),
        ).rejects.toThrow("rollback_fixture_api_column_grant");
        expect(await canonical(prisma)).toEqual([{ canonical: true }]);
      }
      const denied = [
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE public."ProviderAccountConnection" SET id=${`${connection.id}-changed`} WHERE id=${connection.id}`,
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE public."WorkspaceAccountBinding" SET id=${`${binding.id}-changed`} WHERE id=${binding.id}`,
      ];
      await expect(api(denied[0]!)).rejects.toThrow(
        /provider_account_owner_immutable/,
      );
      await expect(api(denied[1]!)).rejects.toThrow(
        /workspace_account_binding_identity_immutable/,
      );
      await expect(
        api(
          (tx) =>
            tx.$executeRaw`UPDATE public."ProviderAccountConnection" SET id=id WHERE id=${connection.id}`,
        ),
      ).rejects.toThrow(/provider_account_revision_conflict/);
      for (const mutation of [
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE public."ProviderAccountConnection" SET state='disabled', "metadataRevision"="metadataRevision"+1 WHERE id=${connection.id}`,
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE public."ProviderAccountConnection" SET "profileRef"='changed', "metadataRevision"="metadataRevision"+1 WHERE id=${connection.id}`,
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE public."WorkspaceAccountBinding" SET state='revoked', revision=revision+1, "policyRevision"="policyRevision"+1 WHERE id=${binding.id}`,
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`UPDATE public."WorkspaceAccountBinding" SET "fenceAckOperationId"='invented', "fenceAckPolicyRevision"=1 WHERE id=${binding.id}`,
        (tx: Prisma.TransactionClient) =>
          tx.$executeRaw`DELETE FROM public."WorkspaceAccountBinding" WHERE id=${binding.id}`,
      ])
        await expect(api(mutation)).rejects.toThrow(/permission denied/);
      const before = await prisma.workspaceAccountBinding.findUniqueOrThrow({
        where: { id: binding.id },
      });
      expect(
        await api(
          (tx) =>
            tx.$executeRaw`UPDATE public."WorkspaceAccountBinding" SET id=id WHERE id=${binding.id}`,
        ),
      ).toBe(1);
      expect(
        await prisma.workspaceAccountBinding.findUniqueOrThrow({
          where: { id: binding.id },
        }),
      ).toEqual(before);

      let ready!: () => void;
      const acquired = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const release = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      held = api(async (tx) => {
        await tx.$queryRaw`SELECT id FROM public."ProviderAccountConnection" WHERE id=${connection.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM public."WorkspaceAccountBinding" WHERE id=${binding.id} AND "workspaceId"=${workspaceId} FOR UPDATE`;
        ready();
        await release;
      });
      await Promise.race([acquired, held]);
      for (const lock of [
        () =>
          observer.$transaction(
            (tx) =>
              tx.$queryRaw`SELECT id FROM public."ProviderAccountConnection" WHERE id=${connection.id} FOR UPDATE NOWAIT`,
          ),
        () =>
          observer.$transaction(
            (tx) =>
              tx.$queryRaw`SELECT id FROM public."WorkspaceAccountBinding" WHERE id=${binding.id} FOR UPDATE NOWAIT`,
          ),
      ])
        await expect(lock()).rejects.toThrow(/could not obtain lock/);
      if (!unlock) throw new Error("account_lock_release_missing");
      unlock();
      await held;
      held = undefined;
      await observer.providerAccountConnection.update({
        where: { id: connection.id },
        data: {
          displayName: "After lock release",
          metadataRevision: { increment: 1 },
        },
      });
      await new PrismaProviderAccountRepository(observer).compareAndSetBinding({
        workspaceId,
        connectionId: connection.id,
        expectedRevision: binding.revision,
        state: "revoked",
      });
    } finally {
      unlock?.();
      await held?.catch(() => undefined);
      if (parameterGranted)
        await prisma.$executeRawUnsafe(
          "REVOKE SET ON PARAMETER session_replication_role FROM reviewrouter_api",
        );
      await observer.$disconnect();
      if (ownerCreated) {
        await prisma.$executeRawUnsafe(
          'ALTER TABLE public."ProviderAccountConnection" OWNER TO CURRENT_USER',
        );
        await prisma.$executeRawUnsafe(
          'ALTER TABLE public."WorkspaceAccountBinding" OWNER TO CURRENT_USER',
        );
        await prisma.$executeRawUnsafe(
          `REVOKE USAGE ON SCHEMA public FROM ${aclOwner}`,
        );
        await prisma.$executeRawUnsafe(`DROP ROLE ${aclOwner}`);
      }
      if (workspaceCreated) {
        await prisma.workspaceAccountBinding.deleteMany({
          where: { workspaceId },
        });
        await prisma.providerAccountConnection.deleteMany({
          where: { ownerWorkspaceId: workspaceId },
        });
        await prisma.workspace.delete({ where: { id: workspaceId } });
      }
      await prisma.$disconnect();
    }
  }, 30_000);

  it("retains one original across competing admissions, settings and revocation", async () => {
    const timezone = "Europe/Berlin";
    const database = new URL(disposableDatabase());
    database.searchParams.set("options", `-c TimeZone=${timezone}`);
    const databaseUrl = database.toString();
    await resetReviewActionV2E2EDatabase(databaseUrl);
    const limits = {
      requests: 2,
      concurrency: 1,
      requestBytes: 4096,
      outputBytes: 196608,
      tokens: 128,
    };
    const networkFetch = globalThis.fetch;
    const gate = () => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { pending, release };
    };
    let holdScm: (() => Promise<void>) | undefined;
    let scmReads = 0;
    const harness = await createReviewActionV2E2EHarness(databaseUrl, {
      beforeFakeGitHubRead: async () => {
        scmReads++;
        const hold = holdScm;
        holdScm = undefined;
        await hold?.();
      },
      modelTransport: "account_gateway",
      repositoryProviderSelection: "none",
      environmentOverrides: {
        REVIEW_ROUTER_REVIEW_V2_MAX_AUTHORIZATION_LIFETIME_MS: "900000",
        REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: JSON.stringify({
          profiles: [{ profileRef: "mimo-responses-v1", limits }],
        }),
      },
    });
    const fresh = createPrismaClient({ databaseUrl, poolMax: 4 });
    let closeGateway: (() => Promise<void>) | undefined;
    let closeRelayApp: (() => Promise<void>) | undefined;
    let recheckRuntimeConfig: (() => Promise<void>) | undefined;
    let restoreGatewayFetch: (() => void) | undefined;
    let relay: ReviewRunGatewayRelay | undefined;
    let startBindingRevocationStream:
      | (() => Promise<() => Promise<void>>)
      | undefined;
    const closes: Gateway.Close[] = [];
    try {
      const { prisma, workspaceId, repositoryConnectionId } = harness;
      expect(
        await prisma.$queryRaw<readonly { timezone: string }[]>`
          SELECT current_setting('TimeZone') AS "timezone"
        `,
      ).toEqual([{ timezone }]);
      const accounts = new PrismaProviderAccountRepository(prisma);
      const connection = await prisma.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspaceId,
          gatewayAccountRef: `${harness.prefix}-account`,
          profileRef: "mimo-responses-v1",
          displayName: "Synthetic account",
          state: "active",
        },
      });
      const binding = await accounts.compareAndSetBinding({
        workspaceId,
        connectionId: connection.id,
        expectedRevision: 0,
        state: "active",
      });
      const configurations = new PrismaReviewConfigurationRepository(
        prisma,
        undefined,
        false,
        undefined,
      );
      const target = {
        scope: "repository" as const,
        workspaceId,
        repositoryId: repositoryConnectionId,
      };
      const config = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        providers: [
          {
            kind: "codex",
            authMode: "codex_account_gateway",
            model: "mimo-v2-pro",
            reasoningEffort: "high",
            fastMode: false,
            agenticContext: true,
            gatewayBindingId: binding.id,
            gatewayProfileRef: connection.profileRef,
          },
        ],
      });
      await saveReviewConfiguration(
        {
          target,
          expectedVersion: null,
          ...systemPolicyWriteFixture(config, target),
        },
        { configurations },
      );
      // Reject malformed current policy before creating any authorization.
      const repositoryHead =
        await prisma.reviewConfigurationVersion.findFirstOrThrow({
          where: {
            workspaceId,
            configuration: { targetKey: `repo:${repositoryConnectionId}` },
          },
          orderBy: { version: "desc" },
        });
      const storedPolicy = JSON.parse(repositoryHead.policyJson!) as {
        readonly providers: readonly unknown[];
      };
      // The same profile selected twice is not a readable document.
      await prisma.reviewConfigurationVersion.update({
        where: { id: repositoryHead.id },
        data: {
          policyJson: canonicalJson({
            ...storedPolicy,
            providers: [...storedPolicy.providers, storedPolicy.providers[0]],
          }),
        },
      });
      await expect(harness.authorize()).rejects.toThrow();
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(0);
      await prisma.reviewConfigurationVersion.update({
        where: { id: repositoryHead.id },
        data: { policyJson: repositoryHead.policyJson },
      });
      const producerRow = await prisma.producerRelease.findUniqueOrThrow({
        where: { producerReleaseId: harness.producerReleaseId },
        select: {
          producerReleaseId: true,
          actionCommitSha: true,
          runtimeCommitSha: true,
          agentProfilesJson: true,
          prDescriptionProfile: true,
        },
      });
      if (typeof producerRow.agentProfilesJson !== "string")
        throw new Error("c2c_producer_profiles_missing");
      const snapshotProducer = {
        ...producerRow,
        prDescriptionProfile:
          producerRow.prDescriptionProfile == null
            ? null
            : parseProducerPrDescriptionProfile(
                producerRow.prDescriptionProfile,
              ),
        agentProfiles: parseReviewAgentProfiles(
          JSON.parse(producerRow.agentProfilesJson),
        ),
      };
      if (typeof connection.profileRef !== "string")
        throw new Error("c2c_gateway_profile_missing");
      const gatewaySnapshot = new ProductionReviewRunRuntimeSnapshot(prisma, {
        profiles: [{ profileRef: connection.profileRef, limits }],
      });
      expect(
        await gatewaySnapshot.capture({
          identity: snapshotIdentity(harness),
          producerRelease: snapshotProducer,
          deadline: new Date(Date.now() + 60_000),
          modelTransport: "provider_api",
        }),
      ).toBeNull();
      const contenders = await Promise.allSettled([
        harness.authorize(),
        harness.authorize(),
      ]);
      const winner = contenders.find((result) => result.status === "fulfilled");
      if (!winner || winner.status !== "fulfilled")
        throw new Error("c2c_first_admission_failed");
      const first = winner.value;
      const row = await fresh.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: first.authorizationId },
      });
      const renewalApp = await createApiApp({
        prisma,
        actionControlPlaneEnabled: false,
        memoryServiceEnabled: false,
        reviewRunControlV2Enabled: true,
        reviewActionV2Env: harness.env,
      });
      try {
        const renewal = await renewalApp.inject({
          method: "POST",
          url: "/api/action/v2/review-runs/renew",
          payload: await harness.createRenewRequest(first),
        });
        expect(renewal.statusCode).toBe(200);
        const response = renewal.json();
        expect(response.result.authorizationId).toBe(first.authorizationId);
        expect(
          Date.parse(response.result.expiresAt) -
            Date.parse(response.serverTime),
        ).toBeGreaterThan(0);
        expect(
          Math.abs(Date.parse(response.serverTime) - Date.now()),
        ).toBeLessThan(5000);
      } finally {
        await renewalApp.close();
      }
      const pin = parseReviewRunRuntimeSnapshot(
        row.runtimeSnapshotCanonicalJson,
      )!;
      if (pin.snapshotVersion !== 3)
        throw new Error("legacy_fixture_snapshot_expected");
      expect(pin.configurationSource).toBe("repository");
      expect(pin.configurationVersion).toBe(1);
      expect(
        parseReviewConfigurationStrict(
          JSON.parse(pin.configurationCanonicalJson),
        ).providers[0]?.model,
      ).toBe("mimo-v2-pro");
      expect(pin.gateway?.permittedAccountRef).toBe(
        connection.gatewayAccountRef,
      );
      expect(pin.gateway?.bindingRevision).toBe(binding.revision);
      expect(pin.gateway?.policyRevision).toBe(binding.policyRevision);
      expect(pin.gateway?.limits).toEqual(limits);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: {
            repositoryConnectionId,
            sourceRunId: row.sourceRunId,
            sourceRunAttempt: row.sourceRunAttempt,
          },
        }),
      ).toBe(1);
      expect(
        await prisma.outboxEvent.count({
          where: {
            aggregateId: first.authorizationId,
            type: "review.run.authorized",
          },
        }),
      ).toBe(1);
      const creationEvent = await fresh.outboxEvent.findFirstOrThrow({
        where: {
          aggregateId: first.authorizationId,
          type: "review.run.authorized",
        },
      });
      const gatewayProduction = composeReviewActionV2ProductionRunControl({
        env: harness.env,
        prisma,
      });
      const gatewayRun =
        await gatewayProduction.repositories.authorizations.findReviewRunAuthorizationById(
          first.authorizationId,
        );
      if (!gatewayRun || !pin.gateway)
        throw new Error("c2c_gateway_original_missing");
      // Snapshot-enabled admission cannot infer transport from mutable policy.
      expect(
        await gatewayProduction.runControl.authorizations.authorizeReviewRun({
          verifiedIdentity: gatewayRun,
          producerReleaseId: gatewayRun.producerReleaseId,
          protocolOfferHash: gatewayRun.protocolOfferHash,
          oidcReplayKeyHash: gatewayRun.oidcReplayKeyHash,
          providerVoteLanes: gatewayRun.providerVoteLanes,
          authorizationTtlMs: 60_000,
          maxAuthorizationLifetimeMs: 3_600_000,
        }),
      ).toEqual({
        status: ReviewRunAuthorizationUseCaseStatus.Denied,
        reason: ReviewRunAuthorizationDenialReason.AdmissionFactsChanged,
      });
      expect(
        await new ProductionReviewRunRuntimeSnapshot(prisma).capture({
          modelTransport: "account_gateway",
          identity: gatewayRun,
          deadline: gatewayRun.maxExpiresAt,
          producerRelease: snapshotProducer,
        }),
      ).toBeNull();
      const attachments = new PrismaReviewRunGatewayExecutionBinding(
        prisma,
        gatewayProduction.runtimeSnapshots,
      );
      const owner = {
        authorizationId: first.authorizationId,
        identity: gatewayRun,
        runtimeSnapshotCanonicalJson: row.runtimeSnapshotCanonicalJson!,
      };
      const intents: Gateway.Prepare[] = [];
      const runControlToken = ["disposable", "control", "token"].join("-");
      const executionBearer = ["disposable", "execution", "token"].join("-");
      const selected = {
        bindingVersion: 1 as const,
        operationId: pin.gateway.operationId,
        executionRef: "c2c-selected-execution",
        accountRef: connection.gatewayAccountRef,
        authorizationEpoch: 55,
        deadline: pin.deadline,
      };
      // Inert C3 storage contract: no production v2 writer/personal use enabled.
      // Clone only this test's existing admitted row inside rolled-back transactions.
      // Direct SQL bypasses the TS parser and proves both independent DB gates.
      const v2Snapshot = canonicalJson({
        ...pin,
        snapshotVersion: 3,
        gateway: { ...pin.gateway, expectedAuthorizationEpoch: 55 },
      });
      async function withPrivateSnapshot(
        canonical: string,
        inspect: (
          tx: Prisma.TransactionClient,
          authorizationId: string,
        ) => Promise<void>,
      ) {
        const rollback = new Error("c3_private_snapshot_fixture_rollback");
        try {
          await prisma.$transaction(async (tx) => {
            const suffix = randomUUID();
            const authorizationId = `c3-snapshot-${suffix}`;
            await tx.reviewRunAuthorization.create({
              data: {
                ...row,
                authorizationId,
                sourceRunId: `${row.sourceRunId}-${suffix}`,
                oidcReplayKeyHash: `c3-replay-${suffix}`,
                providerVoteLanes:
                  row.providerVoteLanes as Prisma.InputJsonValue,
                runtimeSnapshotCanonicalJson: canonical,
                gatewayExecutionCanonicalJson: null,
              },
            });
            await inspect(tx, authorizationId);
            throw rollback;
          });
        } catch (error) {
          if (error !== rollback) throw error;
        }
      }
      const attachPrivate = async (
        canonical: string,
        execution: typeof selected,
      ) =>
        withPrivateSnapshot(canonical, async (tx, authorizationId) => {
          await tx.$executeRaw`UPDATE "ReviewRunAuthorization"
          SET "gatewayExecutionCanonicalJson" = ${canonicalJson(execution)}
          WHERE "authorizationId" = ${authorizationId}`;
          const stored = await tx.reviewRunAuthorization.findUniqueOrThrow({
            where: { authorizationId },
          });
          expect(stored.runtimeSnapshotCanonicalJson).toBe(canonical);
          expect(stored.gatewayExecutionCanonicalJson).toBe(
            canonicalJson(execution),
          );
        });
      await attachPrivate(v2Snapshot, selected);
      // SQL132 preserves nonpersonal v3 pins without an expected epoch. The
      // existing selected execution still binds operation, account and deadline.
      const unpinnedSnapshot = canonicalJson({
        ...pin,
        gateway: { ...pin.gateway, expectedAuthorizationEpoch: undefined },
      });
      await attachPrivate(unpinnedSnapshot, selected);
      for (const epoch of [0, 54, 56]) {
        await expect(
          attachPrivate(v2Snapshot, { ...selected, authorizationEpoch: epoch }),
        ).rejects.toThrow();
      }
      for (const epoch of [
        null,
        "55",
        0,
        -1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        const invalid = canonicalJson({
          ...pin,
          snapshotVersion: 3,
          gateway: { ...pin.gateway, expectedAuthorizationEpoch: epoch },
        });
        await expect(
          withPrivateSnapshot(invalid, async () => {}),
        ).rejects.toThrow();
      }
      // SQL132 checks stored version text; the runtime codec separately requires
      // a numeric version. This SQL test does not claim to be a wire parser.
      for (const snapshotVersion of [0, 4]) {
        await expect(
          withPrivateSnapshot(
            canonicalJson({ ...pin, snapshotVersion }),
            async () => {},
          ),
        ).rejects.toThrow();
      }
      // V2 is still subject to all original operation/account/deadline/cap guards.
      for (const patch of [
        { operationId: "other-operation" },
        { accountRef: "other-account" },
        { deadline: new Date(Date.parse(pin.deadline) - 1000).toISOString() },
      ])
        await expect(
          attachPrivate(v2Snapshot, { ...selected, ...patch }),
        ).rejects.toThrow();
      await expect(
        attachPrivate(
          canonicalJson({
            ...pin,
            snapshotVersion: 3,
            gateway: {
              ...pin.gateway,
              expectedAuthorizationEpoch: 55,
              limits: { ...limits, tokens: 0 },
            },
          }),
          selected,
        ),
      ).rejects.toThrow();
      await withPrivateSnapshot(v2Snapshot, async (tx, authorizationId) => {
        await expect(
          tx.reviewRunAuthorization.update({
            where: { authorizationId },
            data: {
              runtimeSnapshotCanonicalJson: row.runtimeSnapshotCanonicalJson,
            },
          }),
        ).rejects.toThrow();
      });
      const requests: {
        requestRef: string;
        admission: Gateway.Admission;
        payload: Record<string, unknown>;
      }[] = [];
      let responses: (
        | "limited"
        | "stream"
        | "upstream429"
        | "partial"
        | "unknown"
        | "held"
      )[] = [];
      const sse = `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "x".repeat(150000) })}\n\ndata: {"type":"response.completed"}\n\n`;
      let heldResponse: ServerResponse | undefined;
      let holdAccess: (() => Promise<void>) | undefined;
      let holdStatus: (() => Promise<void>) | undefined;
      let statusCalls = 0;
      const server = createServer(async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks).toString();
        if (request.headers.authorization === `Bearer ${executionBearer}`) {
          const requestRef = String(
            request.headers["x-gateway-request-id"] ?? "",
          );
          if (
            request.method === "POST" &&
            request.url === `/v1/executions/${selected.executionRef}/requests`
          ) {
            requests.push({
              requestRef,
              admission: JSON.parse(
                String(request.headers["x-gateway-admission"]),
              ),
              payload: JSON.parse(raw),
            });
            const mode = responses.shift();
            if (mode === "limited" || mode === "upstream429") {
              response
                .writeHead(429, { "content-type": "application/json" })
                .end(
                  JSON.stringify({
                    code:
                      mode === "limited"
                        ? "admission_limited"
                        : "upstream_failure",
                    traceRef: "fixture-trace",
                    requestRef,
                    effect: "not_dispatched",
                    retry: { kind: "after", milliseconds: 1 },
                  }),
                );
            } else if (mode === "unknown") {
              response
                .writeHead(202, { "content-type": "application/json" })
                .end(
                  JSON.stringify({
                    requestRef,
                    effect: "effect_unknown",
                    status: "unknown",
                  }),
                );
            } else if (mode === "held") {
              heldResponse = response;
              response.writeHead(200, {
                "content-type": "text/event-stream",
                "x-gateway-request-ref": requestRef,
              });
              response.write('data: {"type":"response.created"}\n\n');
            } else if (mode === "stream" || mode === "partial") {
              response.writeHead(200, {
                "content-type": "text/event-stream",
                "x-gateway-request-ref": requestRef,
              });
              response.end(
                mode === "stream" ? sse : sse + "x".repeat(limits.outputBytes),
              );
            } else response.writeHead(500).end();
            return;
          }
          if (
            request.method === "GET" &&
            request.url?.startsWith(
              `/v1/executions/${selected.executionRef}/requests/`,
            )
          ) {
            statusCalls++;
            await holdStatus?.();
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                requestRef: request.url.split("/").at(-1),
                effect: "effect_unknown",
                status: "unknown",
              }),
            );
            return;
          }
          if (
            request.method === "POST" &&
            request.url === `/v1/executions/${selected.executionRef}/close`
          ) {
            const close = JSON.parse(raw) as Gateway.Close;
            closes.push(close);
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                operationRef: close.operationId,
                state: "applied",
              }),
            );
            return;
          }
          response.writeHead(403).end();
          return;
        }
        const intent = JSON.parse(raw) as Gateway.Prepare;
        intents.push(intent);
        if (
          request.method !== "POST" ||
          request.url !== "/internal/v1/run-access" ||
          request.headers.authorization !== `Bearer ${runControlToken}`
        ) {
          response.writeHead(403).end();
          return;
        }
        await holdAccess?.();
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            operation: {
              operationRef: intent.operationId,
              state: "applied",
              result: {
                kind: "execution",
                executionRef: selected.executionRef,
                accountRef: selected.accountRef,
                authorizationEpoch: selected.authorizationEpoch,
                deadline: intent.deadline,
                state: "active",
              },
            },
            bearer: executionBearer,
            admission: {
              invocationRef: intent.invocationRef,
              attemptRef: intent.attemptRef,
              accountRef: selected.accountRef,
              authorizationEpoch: selected.authorizationEpoch,
              subjectRef: intent.subjectRef,
              policyRevision: intent.policyRevision,
              bindingRevision: intent.bindingRevision,
              profileId: intent.profileId,
              limits: intent.limits,
              expiresAt: intent.deadline,
            },
          }),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      closeGateway = async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      };
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const githubFetch = globalThis.fetch;
      let holdCheckoutMint: (() => Promise<void>) | undefined;
      let checkoutMints = 0;
      const checkoutExpiry = new Date(Date.now() + 60 * 60_000).toISOString();
      globalThis.fetch = async (request, init) => {
        const value = new Request(request, init);
        const url = new URL(value.url);
        if (url.origin === origin) return networkFetch(request, init);
        if (
          value.method === "POST" &&
          url.hostname === "api.github.com" &&
          url.pathname === "/app/installations/123456/access_tokens"
        ) {
          const rawBody = await value.clone().text();
          const body = (rawBody ? JSON.parse(rawBody) : {}) as {
            repository_ids?: number[];
            permissions?: Record<string, string>;
          };
          if (
            body.permissions?.contents === "read" &&
            body.permissions.pull_requests === "read" &&
            Object.keys(body.permissions).length === 2
          ) {
            expect(body.repository_ids).toEqual([987654321]);
            checkoutMints++;
            const hold = holdCheckoutMint;
            holdCheckoutMint = undefined;
            await hold?.();
            return Response.json(
              {
                token: "fake-checkout-read-token",
                expires_at: checkoutExpiry,
                permissions: { contents: "read", pull_requests: "read" },
                repository_selection: "selected",
              },
              { status: 201 },
            );
          }
        }
        return githubFetch(request, init);
      };
      restoreGatewayFetch = () => {
        globalThis.fetch = githubFetch;
      };
      {
        let loseAttachment = true;
        const preparation = createReviewRunGatewayPreparation({
          authorizationId: first.authorizationId,
          identity: gatewayRun,
          runAccess: {
            origin,
            runControlBearer: runControlToken,
            timeoutMs: 5000,
          },
          authorizations: gatewayProduction.repositories.authorizations,
          snapshots: gatewayProduction.runtimeSnapshots,
          bindings: {
            read: (value) => attachments.read(value),
            attach: async (value, result) => {
              if (loseAttachment) {
                loseAttachment = false;
                throw new Error("synthetic_attachment_loss");
              }
              const outcomes = await Promise.all([
                attachments.attach(value, result),
                attachments.attach(value, result),
              ]);
              expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
                "attached",
                "restored",
              ]);
              return outcomes.find((outcome) => outcome.status === "attached")!;
            },
          },
        });
        await expect(preparation.prepare()).rejects.toThrow(
          "synthetic_attachment_loss",
        );
        expect(intents).toHaveLength(1);
        expect(await preparation.prepare()).toEqual({ status: "denied" });
        expect(intents).toHaveLength(1);
        expect(await preparation.recoverSameOperation()).toEqual({
          status: "prepared",
          binding: selected,
        });
        expect(intents).toHaveLength(2);
        expect(intents[1]).toEqual(intents[0]);
        expect(intents[0]).toMatchObject({
          operationId: pin.gateway.operationId,
          limits,
          deadline: pin.deadline,
          accountRefs: [connection.gatewayAccountRef],
        });
        expect(await preparation.prepare()).toEqual({
          status: "restored",
          binding: selected,
        });
        expect(intents).toHaveLength(2);
        expect(
          await attachments.attach(owner, {
            ...selected,
            executionRef: "other-execution",
          }),
        ).toEqual({ status: "conflict" });
        const saved = await prisma.reviewRunAuthorization.findUniqueOrThrow({
          where: { authorizationId: first.authorizationId },
        });
        expect(saved.gatewayExecutionCanonicalJson).toBe(
          canonicalJson(selected),
        );
        expect(saved.gatewayExecutionCanonicalJson).not.toContain(
          executionBearer,
        );
        expect(JSON.stringify(creationEvent)).not.toContain(executionBearer);
        await expect(
          prisma.$executeRaw`UPDATE "ReviewRunAuthorization" SET "gatewayExecutionCanonicalJson" = NULL WHERE "authorizationId" = ${first.authorizationId}`,
        ).rejects.toThrow("review_run_gateway_execution_immutable");
        await expect(
          prisma.$executeRaw`UPDATE "ReviewRunAuthorization" SET "gatewayExecutionCanonicalJson" = ${canonicalJson({ ...selected, bearer: executionBearer })} WHERE "authorizationId" = ${first.authorizationId}`,
        ).rejects.toThrow();

        // Same nearest boundary: production RR authority + real PG + raw HTTP
        // fixture. No transport/client mocks or alternate authority stores.
        const productionRoutes = composeReviewActionV2ProductionRoutes({
          enabled: true,
          prisma,
          runtime: {
            readServerTime: async () => new Date(),
            createRequestId: () => "relay-fixture",
          },
          env: {
            ...harness.env,
            REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED: "1",
            REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: origin,
            REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER: runControlToken,
            REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: JSON.stringify({
              profiles: [
                {
                  profile: {
                    profileId: connection.profileRef,
                    protocol: "openai-responses",
                    modelIds: ["mimo-v2-pro"],
                    authKinds: ["api_key"],
                  },
                  outputTokens: 256,
                },
              ],
              ingressBytes: 4096,
              requestTimeoutMs: 5000,
              waitBudgetMs: 1000,
              maxWaits: 1,
              maxSessions: 4,
              maxInFlight: 1,
            }),
          },
        });
        relay = productionRoutes.accountGatewayRelay!;
        const app = Fastify();
        const responsesRetirements = new WeakMap<
          IncomingMessage,
          Promise<void>
        >();
        app.addHook("onRoute", (route) => {
          if (route.url !== "/api/action/v2/account-gateway/responses") return;
          const handler = route.handler;
          route.handler = async function (request, reply) {
            let retired!: () => void;
            responsesRetirements.set(
              request.raw,
              new Promise<void>((resolve) => {
                retired = resolve;
              }),
            );
            try {
              return await handler.call(this, request, reply);
            } finally {
              retired();
            }
          };
        });
        closeRelayApp = () => app.close();
        await registerReviewRunGatewayRelayRoutes(app, relay);
        await registerReviewRunGatewayCheckoutRoute(
          app,
          productionRoutes.accountGatewayCheckout!,
        );
        const headers = {
          authorization: `Bearer ${first.authorizationToken}`,
          "content-type": "application/json",
        };
        // Synthetic IDs from the existing disposable PG/fake GitHub fixture only.
        const checkoutSelectors = {
          providerInstanceId: "codex-rotating:987654321",
          workflowSchemaVersion: 2,
        };
        const checkout = (
          payload: string | Buffer = JSON.stringify(checkoutSelectors),
        ) =>
          app.inject({
            method: "POST",
            url: "/api/action/v2/account-gateway/checkout",
            headers,
            payload,
          });
        for (const selectors of [
          {
            ...checkoutSelectors,
            providerInstanceId: "codex-rotating:987654322",
          },
          { ...checkoutSelectors, workflowSchemaVersion: 1 },
          { ...checkoutSelectors, workflowSchemaVersion: 3 },
        ]) {
          const denied = await checkout(JSON.stringify(selectors));
          expect(checkoutMints).toBe(0);
          expect(denied.statusCode).toBe(401);
          expect(denied.json()).toEqual({
            error: { code: "authorization_denied" },
          });
        }
        for (const payload of [
          "{}",
          JSON.stringify({
            providerInstanceId: checkoutSelectors.providerInstanceId,
          }),
          '{"workflowSchemaVersion":2}',
          JSON.stringify({
            ...checkoutSelectors,
            repository: "fake-foreign/repo",
          }),
          JSON.stringify({
            ...checkoutSelectors,
            providerInstanceId: 987654321,
          }),
          JSON.stringify({ ...checkoutSelectors, workflowSchemaVersion: "2" }),
          JSON.stringify(checkoutSelectors).replace(
            '"providerInstanceId":',
            '"providerInstanceId":"codex-rotating:987654321","providerInstanceId":',
          ),
          JSON.stringify(checkoutSelectors).replace(
            '"workflowSchemaVersion":2',
            '"workflowSchemaVersion":1,"workflowSchemaVersion":2',
          ),
          JSON.stringify(checkoutSelectors).replace(
            '"providerInstanceId":',
            '"providerInstance\\u0049d":"codex-rotating:987654321","providerInstanceId":',
          ),
          Buffer.concat([
            Buffer.from('{"providerInstanceId":"codex-rotating:'),
            Buffer.from([0xff]),
            Buffer.from('987654321","workflowSchemaVersion":2}'),
          ]),
          `${" ".repeat(513)}${JSON.stringify(checkoutSelectors)}`,
        ]) {
          expect((await checkout(payload)).statusCode).toBe(400);
          expect(checkoutMints).toBe(0);
        }
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/action/v2/account-gateway/checkout",
              headers: { ...headers, "content-encoding": "gzip" },
              payload: JSON.stringify(checkoutSelectors),
            })
          ).statusCode,
        ).toBe(400);
        expect(checkoutMints).toBe(0);
        const enteredMint = gate();
        const releaseMint = gate();
        holdCheckoutMint = async () => {
          enteredMint.release();
          await releaseMint.pending;
        };
        const heldCheckout = Promise.resolve(checkout());
        const installation = await prisma.gitHubInstallation.findUniqueOrThrow({
          where: { githubInstallationId: 123456n },
        });
        try {
          await Promise.race([
            enteredMint.pending,
            heldCheckout.then((response) => {
              throw new Error(
                `checkout_mint_fixture_not_entered:${response.statusCode}:${response.body}`,
              );
            }),
          ]);
          await prisma.gitHubInstallation.update({
            where: { id: installation.id },
            data: { status: "suspended" },
          });
          releaseMint.release();
          const denied = await heldCheckout;
          expect(denied.statusCode).toBe(401);
          expect(denied.json()).toEqual({
            error: { code: "authorization_denied" },
          });
          expect(denied.body).not.toContain("fake-checkout-read-token");
        } finally {
          releaseMint.release();
          await heldCheckout;
          await prisma.gitHubInstallation.update({
            where: { id: installation.id },
            data: { status: installation.status },
          });
        }
        const readCapability = await checkout();
        expect(readCapability.statusCode).toBe(200);
        expect(readCapability.headers["cache-control"]).toBe("no-store");
        const repository = await prisma.repositoryConnection.findUniqueOrThrow({
          where: { id: repositoryConnectionId },
        });
        expect(readCapability.json()).toEqual({
          protocolVersion: 1,
          repository: repository.fullName,
          headSha: row.headSha,
          token: "fake-checkout-read-token",
          expiresAt: checkoutExpiry,
          permissions: { contents: "read", pullRequests: "read" },
          runtimeConfig: {
            protocolVersion: 1,
            configVersion: 1,
            runtimeEnv: {
              ...mapConfigToRuntimeEnv(config),
              REVIEW_ROUTER_AGENT_PROFILE_JSON: canonicalJson(pin.agent),
              REVIEW_ROUTER_AGENT_PROFILE_DIGEST: pin.agentProfileDigest,
              REVIEW_ROUTER_LIFECYCLE_OBSERVATION_AUTHORS: JSON.stringify([
                "review-router-ai[bot]",
                "github-actions[bot]",
              ]),
            },
          },
        });
        const admittedRuntimeConfig = readCapability.json().runtimeConfig;
        expect(admittedRuntimeConfig.runtimeEnv).toMatchObject({
          REVIEW_AUTH_MODE: "codex-account-gateway",
          REVIEW_PROVIDERS: "codex/mimo-v2-pro",
          CODEX_MODEL: "mimo-v2-pro",
          CODEX_REASONING_EFFORT: "high",
        });
        for (const privateValue of [
          connection.id,
          connection.gatewayAccountRef,
          binding.id,
          executionBearer,
          runControlToken,
        ])
          expect(readCapability.body).not.toContain(privateValue);
        recheckRuntimeConfig = async () => {
          const retained = await checkout();
          expect(retained.statusCode).toBe(200);
          expect(retained.json().runtimeConfig).toEqual(admittedRuntimeConfig);
        };
        expect(requests).toHaveLength(0);
        const call = async (payload = '{"input":"fixture"}') => {
          const response = await app.inject({
            method: "POST",
            url: "/api/action/v2/account-gateway/responses",
            headers,
            payload,
          });
          // Hijacked completion precedes cleanup; match this exact request.
          const retirement = responsesRetirements.get(response.raw.req);
          if (retirement) await retirement;
          else if (response.statusCode !== 503)
            throw new Error("fixture_responses_retirement_not_observed");
          return response;
        };
        for (const invalid of [
          '{"model":"caller-model","input":"fixture"}',
          '{"store":false,"st\\u006fre":true}',
          '{"ＭＯＤＥＬ":"mimo-v2-pro"}',
        ]) {
          expect((await call(invalid)).statusCode).toBe(400);
        }
        expect(requests).toHaveLength(0);
        expect((await call()).json()).toMatchObject({
          error: {
            code: "same_operation_recovery_required",
            effect: "effect_unknown",
          },
        });
        expect(intents).toHaveLength(2); // Restart absence must be a SQL read only.
        // Old recovery bypasses the budget: a second recovery/status reaches
        // authority/HTTP while the first same-operation run-access is held.
        const accessEntered = gate(),
          accessRelease = gate();
        holdAccess = async () => {
          accessEntered.release();
          await accessRelease.pending;
        };
        const recovery = relay.recoverSameOperation(first.authorizationToken);
        await accessEntered.pending;
        const readsBeforeRecoveryOverflow = scmReads;
        try {
          await expect(
            relay.recoverSameOperation(first.authorizationToken),
          ).rejects.toMatchObject({ code: "relay_saturated" });
          await expect(
            relay.status(first.authorizationToken, "held-status"),
          ).rejects.toMatchObject({ code: "relay_saturated" });
          expect((await call()).statusCode).toBe(503);
          expect(scmReads).toBe(readsBeforeRecoveryOverflow);
          expect(intents).toHaveLength(3);
          expect(statusCalls).toBe(0);
        } finally {
          holdAccess = undefined;
          accessRelease.release();
        }
        expect(await recovery).toMatchObject({
          status: "restored",
          binding: selected,
        });
        expect(intents[2]).toEqual(intents[0]);
        // Old status also bypasses the budget, allowing duplicate readback HTTP.
        const statusEntered = gate(),
          statusRelease = gate();
        holdStatus = async () => {
          statusEntered.release();
          await statusRelease.pending;
        };
        const readback = relay.status(first.authorizationToken, "held-status");
        await statusEntered.pending;
        const readsBeforeStatusOverflow = scmReads;
        try {
          await expect(
            relay.status(first.authorizationToken, "excess-status"),
          ).rejects.toMatchObject({ code: "relay_saturated" });
          await expect(
            relay.recoverSameOperation(first.authorizationToken),
          ).rejects.toMatchObject({ code: "relay_saturated" });
          expect((await call()).statusCode).toBe(503);
          expect(scmReads).toBe(readsBeforeStatusOverflow);
          expect(statusCalls).toBe(1);
          expect(intents).toHaveLength(3);
        } finally {
          holdStatus = undefined;
          statusRelease.release();
        }
        expect(await readback).toMatchObject({
          status: "unknown",
          effect: "effect_unknown",
        });

        // Public close has its own authority budget: Responses saturation must
        // not prevent cancellation, but duplicate close SCM work stays bounded.
        const closeEntered = gate(),
          closeRelease = gate();
        holdScm = async () => {
          closeEntered.release();
          await closeRelease.pending;
          throw new Error("fixture_close_scm_aborted");
        };
        const pendingClose = relay
          .close(first.authorizationToken, "cancelled")
          .catch((error: unknown) => error);
        await closeEntered.pending;
        const readsBeforeCloseOverflow = scmReads;
        try {
          await expect(
            relay.close(first.authorizationToken, "cancelled"),
          ).rejects.toMatchObject({ code: "relay_saturated" });
          expect(scmReads).toBe(readsBeforeCloseOverflow);
        } finally {
          holdScm = undefined;
          closeRelease.release();
        }
        expect(await pendingClose).toMatchObject({
          message: "fixture_close_scm_aborted",
        });

        // The old concurrent authority projection survives both delays while
        // the authorization row stays active and unchanged: it dispatches HTTP.
        const authorityKey = {
          scmRepositoryIdentityId: gatewayRun.scmRepositoryIdentityId,
          laneKind: ReviewMutationLaneKind.HostedReviewRouterApp,
        };
        for (const delayAt of ["scm", "binding"] as const) {
          const authority =
            await gatewayProduction.repositories.mutationAuthorities.findReviewMutationAuthority(
              authorityKey,
            );
          if (!authority) throw new Error("fixture_authority_missing");
          const entered = gate(),
            release = gate();
          let lock: Promise<void> | undefined;
          if (delayAt === "scm") {
            holdScm = async () => {
              entered.release();
              await release.pending;
            };
          } else {
            lock = fresh.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT "id" FROM "ProviderAccountConnection" WHERE "id" = ${connection.id} FOR UPDATE`;
              entered.release();
              await release.pending;
            });
            await entered.pending;
          }
          responses = ["unknown"];
          const denied = Promise.resolve(call());
          try {
            if (delayAt === "scm") await entered.pending;
            else
              await expect
                .poll(async () => {
                  const waiting = await fresh.$queryRaw<
                    readonly { count: bigint }[]
                  >`SELECT count(*) FROM pg_stat_activity
                WHERE datname = current_database() AND wait_event_type = 'Lock'
                  AND query LIKE '%ProviderAccountConnection%FOR UPDATE%'`;
                  return Number(waiting[0]?.count);
                })
                .toBe(1);
            expect(
              await gatewayProduction.repositories.mutationAuthorities.compareAndSetReviewMutationAuthority(
                {
                  expectedVersion: authority.version,
                  authority: {
                    ...authority,
                    version: authority.version + 1,
                    mode:
                      delayAt === "scm"
                        ? ReviewMutationMode.Paused
                        : authority.mode,
                    epoch:
                      delayAt === "binding"
                        ? authority.epoch + 1n
                        : authority.epoch,
                  },
                },
              ),
            ).toMatchObject({ status: "updated" });
          } finally {
            holdScm = undefined;
            release.release();
          }
          await lock;
          expect((await denied).json()).toMatchObject({
            error: { code: "authorization_denied" },
          });
          expect(requests).toHaveLength(0);
          expect(intents).toHaveLength(3);
          expect(
            await fresh.reviewRunAuthorization.findUniqueOrThrow({
              where: { authorizationId: first.authorizationId },
            }),
          ).toMatchObject({ state: "active", version: row.version });
          // Restore only this disposable fixture for the remaining original-pin checks.
          await gatewayProduction.repositories.mutationAuthorities.compareAndSetReviewMutationAuthority(
            {
              expectedVersion: authority.version + 1,
              authority: { ...authority, version: authority.version + 2 },
            },
          );
        }
        responses = ["limited", "stream"];
        const delivered = await call(
          '{"input":"fixture","max_output_tokens":256,"tools":[]}',
        );
        expect(delivered.statusCode).toBe(200);
        expect(delivered.body).toBe(sse);
        expect(requests).toHaveLength(2);
        expect(requests[0]!.requestRef).not.toBe(requests[1]!.requestRef);
        expect(requests[1]!.admission).toEqual(requests[0]!.admission);
        const {
          operationId: _operationId,
          accountRefs: _accounts,
          deadline,
          ...originalAdmission
        } = intents[0]!;
        void _operationId;
        void _accounts;
        expect(requests[1]!.admission).toEqual({
          ...originalAdmission,
          accountRef: selected.accountRef,
          authorizationEpoch: 55,
          expiresAt: deadline,
        });
        expect(requests[1]!.payload).toMatchObject({
          model: "mimo-v2-pro",
          max_output_tokens: 128,
          stream: true,
          store: false,
          service_tier: "default",
          tools: [],
        });
        responses = ["limited", "limited"];
        expect((await call()).json()).toMatchObject({
          error: { code: "admission_limited", effect: "not_dispatched" },
        });
        expect(requests).toHaveLength(4); // Finite wait exhausted.
        responses = ["upstream429"];
        await call();
        expect(requests).toHaveLength(5); // Even retry:after cannot make upstream quota LOCAL.
        responses = ["unknown"];
        expect((await call()).json()).toMatchObject({
          status: "unknown",
          effect: "effect_unknown",
        });
        expect(requests).toHaveLength(6);
        expect(
          await relay.status(first.authorizationToken, requests[5]!.requestRef),
        ).toMatchObject({ status: "unknown", effect: "effect_unknown" });
        responses = ["partial"];
        const partial = await relay.responses(
          first.authorizationToken,
          new TextEncoder().encode('{"input":"fixture"}'),
          new AbortController(),
        );
        if (partial.kind !== "stream")
          throw new Error("fixture_stream_missing");
        await expect(new Response(partial.body).text()).rejects.toMatchObject({
          effect: "effect_unknown",
        });
        expect(requests).toHaveLength(7); // No partial-output retry/re-ID.
        responses = ["held"];
        const flowing = await relay.responses(
          first.authorizationToken,
          new TextEncoder().encode('{"input":"fixture"}'),
          new AbortController(),
        );
        if (flowing.kind !== "stream")
          throw new Error("fixture_stream_missing");
        const reader = flowing.body.getReader();
        const remoteEntered = gate(),
          remoteRelease = gate();
        const readsAfterAdmission = scmReads;
        holdScm = async () => {
          remoteEntered.release();
          await remoteRelease.pending;
        };
        try {
          // OLD deterministically enters the deferred remote resolver after
          // admission; NEW delivers while retaining every local authority read.
          const firstChunk = await Promise.race([
            reader.read().then((chunk) => ({ kind: "chunk" as const, chunk })),
            remoteEntered.pending.then(() => ({ kind: "remote" as const })),
          ]);
          expect(firstChunk.kind).toBe("chunk");
          if (firstChunk.kind !== "chunk")
            throw new Error("fixture_remote_chunk_gate");
          expect(new TextDecoder().decode(firstChunk.chunk.value)).toBe(
            'data: {"type":"response.created"}\n\n',
          );
          // Opaque model-turn bytes and EOF never become review finality.
          heldResponse!.end('data: {"type":"response.completed"}\n\n');
          expect(new TextDecoder().decode((await reader.read()).value)).toBe(
            'data: {"type":"response.completed"}\n\n',
          );
          expect(await reader.read()).toMatchObject({ done: true });
          expect(scmReads).toBe(readsAfterAdmission);
        } finally {
          holdScm = undefined;
          remoteRelease.release();
          await reader.cancel().catch(() => {});
        }
        expect(requests).toHaveLength(8);
        harness.setRevision({
          baseSha: row.baseSha,
          mergeBaseSha: row.mergeBaseSha,
          headSha: "9".repeat(40),
        });
        try {
          await expect(
            relay.responses(
              first.authorizationToken,
              new TextEncoder().encode('{"input":"fixture"}'),
              new AbortController(),
            ),
          ).rejects.toMatchObject({ code: "authorization_denied" });
          expect(requests).toHaveLength(8); // New admission still requires remote head.
        } finally {
          harness.setRevision({
            baseSha: row.baseSha,
            mergeBaseSha: row.mergeBaseSha,
            headSha: row.headSha,
          });
        }
        responses = ["held"];
        const cancelled = new AbortController();
        const held = await relay.responses(
          first.authorizationToken,
          new TextEncoder().encode('{"input":"fixture"}'),
          cancelled,
        );
        if (held.kind !== "stream") throw new Error("fixture_stream_missing");
        cancelled.abort();
        await expect(new Response(held.body).text()).rejects.toMatchObject({
          effect: "effect_unknown",
        });
        expect(requests).toHaveLength(9); // Cancel never becomes success or retry.
        startBindingRevocationStream = async () => {
          responses = ["held"];
          const response = await relay!.responses(
            first.authorizationToken,
            new TextEncoder().encode('{"input":"fixture"}'),
            new AbortController(),
          );
          if (response.kind !== "stream")
            throw new Error("fixture_stream_missing");
          const currentReader = response.body.getReader();
          expect((await currentReader.read()).done).toBe(false);
          return async () => {
            heldResponse!.write(
              'data: {"type":"response.output_text.delta"}\n\n',
            );
            await expect(currentReader.read()).rejects.toMatchObject({
              effect: "effect_unknown",
            });
            expect(requests).toHaveLength(10); // Original binding revoke, no new attempt.
          };
        };
      }
      const replay = await harness.authorize(); // New verified OIDC nonce, same owned tuple.
      expect(replay.authorizationId).toBe(first.authorizationId);
      const replacement = await prisma.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspaceId,
          gatewayAccountRef: `${harness.prefix}-replacement-account`,
          profileRef: connection.profileRef,
          displayName: "Synthetic replacement account",
          state: "active",
        },
      });
      const replacementBinding = await accounts.compareAndSetBinding({
        workspaceId,
        connectionId: replacement.id,
        expectedRevision: 0,
        state: "active",
      });
      const changed = parseReviewConfigurationStrict({
        ...config,
        providers: [
          {
            ...config.providers[0]!,
            model: "mimo-v2-flash",
            reasoningEffort: "low",
            gatewayBindingId: replacementBinding.id,
          },
        ],
      });
      await saveReviewConfiguration(
        {
          target,
          expectedVersion: 1,
          ...systemPolicyWriteFixture(changed, target),
        },
        { configurations },
      );
      expect(recheckRuntimeConfig).toBeDefined();
      // Checkout keeps original pro/high/version 1 after repository config switches.
      await recheckRuntimeConfig!();
      expect((await harness.authorize()).authorizationId).toBe(
        first.authorizationId,
      );
      const reread = await fresh.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: first.authorizationId },
      });
      expect(reread.runtimeSnapshotCanonicalJson).toBe(
        row.runtimeSnapshotCanonicalJson,
      );
      expect(reread.version).toBe(row.version);
      // Existing real private use case/repositories; no policy or publication bypass.
      const production = composeReviewActionV2ProductionRunControl({
        env: harness.env,
        prisma,
      });
      const original =
        await production.repositories.authorizations.findReviewRunAuthorizationById(
          first.authorizationId,
        );
      if (!original) throw new Error("c2c_original_missing");
      const input = (authorization: ReviewRunAuthorization) => ({
        modelTransport: "account_gateway" as const,
        verifiedIdentity: authorization,
        producerReleaseId: authorization.producerReleaseId,
        protocolOfferHash: authorization.protocolOfferHash,
        oidcReplayKeyHash: authorization.oidcReplayKeyHash,
        providerVoteLanes: authorization.providerVoteLanes,
        authorizationTtlMs: 60_000,
        maxAuthorizationLifetimeMs: 3_600_000,
      });
      const retained =
        await production.runControl.authorizations.renewReviewRunAuthorization({
          authorizationId: original.authorizationId,
          verifiedIdentity: original,
          renewalReplayKeyHash: "a".repeat(64),
          requestedTtlMs: 1,
        });
      if (!("authorization" in retained)) throw new Error("c2c_renewal_failed");
      expect(retained.status).toBe(
        ReviewRunAuthorizationUseCaseStatus.Restored,
      );
      expect(retained.authorization).toEqual(original);
      // A full gateway run already owns its original fifteen-minute maximum.
      const renewed =
        await production.runControl.authorizations.renewReviewRunAuthorization({
          authorizationId: original.authorizationId,
          verifiedIdentity: original,
          renewalReplayKeyHash: "8".repeat(64),
          requestedTtlMs: 2 * 60 * 60_000,
        });
      if (!("authorization" in renewed)) throw new Error("c2c_renewal_failed");
      expect(renewed.status).toBe(ReviewRunAuthorizationUseCaseStatus.Restored);
      expect(renewed.authorization.runtimeSnapshotCanonicalJson).toBe(
        row.runtimeSnapshotCanonicalJson,
      );
      expect(renewed.authorization.maxExpiresAt).toEqual(original.maxExpiresAt);
      expect(original.expiresAt).toEqual(original.maxExpiresAt);
      expect(original.maxExpiresAt.getTime()).toBe(
        Math.floor((original.createdAt.getTime() + 15 * 60_000) / 1000) * 1000,
      );
      expect(renewed.authorization).toEqual(original);
      for (const oidcReplayKeyHash of [
        original.oidcReplayKeyHash,
        "7".repeat(64),
      ]) {
        const restored =
          await production.runControl.authorizations.authorizeReviewRun({
            ...input(original),
            oidcReplayKeyHash,
          });
        expect(restored.status).toBe(
          ReviewRunAuthorizationUseCaseStatus.Restored,
        );
        if (!("authorization" in restored))
          throw new Error("c2c_renewed_restore_failed");
        expect(restored.authorization).toEqual(renewed.authorization);
      }
      expect(
        (
          await production.runControl.authorizations.resolveReviewRunAuthorizationToken(
            {
              token: first.authorizationToken,
            },
          )
        ).status,
      ).toBe("valid");
      expect((await harness.authorize()).authorizationId).toBe(
        original.authorizationId,
      );
      expect(
        await fresh.outboxEvent.findUniqueOrThrow({
          where: { idempotencyKey: creationEvent.idempotencyKey },
        }),
      ).toEqual(creationEvent);
      expect(creationEvent.payload).toMatchObject({ authorizationVersion: 1 });
      expect(creationEvent.occurredAt).toEqual(original.createdAt);
      expect(
        await fresh.outboxEvent.count({
          where: {
            aggregateId: original.authorizationId,
            type: "review.run.authorized",
          },
        }),
      ).toBe(1);
      expect(
        (
          await production.runControl.authorizations.authorizeReviewRun({
            ...input(original),
            protocolOfferHash: "f".repeat(64),
            oidcReplayKeyHash: "e".repeat(64),
          })
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Conflict);
      expect(
        (
          await production.runControl.authorizations.authorizeReviewRun({
            ...input(original),
            oidcReplayKeyHash: "d".repeat(64),
            verifiedIdentity: { ...original, headSha: "9".repeat(40) },
          })
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Conflict);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
      expect(
        reviewRunGatewayPreparationIdentity({
          ...original,
          sourceRunAttempt: "2",
        }).invocationId,
      ).toBe(pin.gateway?.invocationId);
      expect(
        reviewRunGatewayPreparationIdentity({
          ...original,
          sourceRunAttempt: "2",
        }).attemptId,
      ).not.toBe(pin.gateway?.attemptId);
      // The DB rejects retroactive pinning/replacement, independent of RR call paths.
      await expect(
        prisma.reviewRunAuthorization.update({
          where: { authorizationId: original.authorizationId },
          data: {
            runtimeSnapshotCanonicalJson: canonicalJson({
              ...pin,
              configurationVersion: 99,
            }),
          },
        }),
      ).rejects.toThrow();
      const snapshotSource = new ProductionReviewRunRuntimeSnapshot(prisma, {
        profiles: [{ profileRef: "mimo-responses-v1", limits }],
      });
      const deniedAfterDeadline = await snapshotSource.isLive({
        snapshot: pin,
        identity: original,
        now: new Date(pin.deadline),
      });
      expect(deniedAfterDeadline).toBe(false);
      const foreign = await prisma.workspace.create({
        data: {
          slug: `${harness.prefix}-foreign`,
          name: "Synthetic foreign workspace",
        },
      });
      await expect(
        prisma.providerAccountConnection.update({
          where: { id: connection.id },
          data: { ownerWorkspaceId: foreign.id },
        }),
      ).rejects.toThrow("provider_account_owner_immutable");
      expect(
        await snapshotSource.isLive({
          snapshot: pin,
          identity: { ...original, workspaceId: foreign.id },
          now: production.clock.now(),
        }),
      ).toBe(false);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
      expect(
        (
          await prisma.providerAccountConnection.findUniqueOrThrow({
            where: { id: connection.id },
          })
        ).ownerWorkspaceId,
      ).toBe(workspaceId);

      // Actual read/CAS/INSERT race: mutate the already captured config before the
      // existing atomic repository runs. No test-only production hook is added.
      let observedNow = production.clock.now();
      const verifiedRenewedToken = await production.prerequisites.tokens.verify(
        {
          token: renewed.token.token,
          now: observedNow,
        },
      );
      let crossDuringBindingRead = false;
      const runtimePort: ReviewRunRuntimeSnapshotPort = {
        capture: async (captureInput) => {
          const captured = await snapshotSource.capture(captureInput);
          await saveReviewConfiguration(
            {
              target,
              expectedVersion: 2,
              ...systemPolicyWriteFixture(config, target),
            },
            { configurations },
          );
          return captured;
        },
        isLive: async (liveInput) => {
          const live = await snapshotSource.isLive(liveInput);
          if (crossDuringBindingRead) {
            expect(live).toBe(true); // The original binding was actually read.
            expect(liveInput.now.getTime()).toBeLessThan(
              verifiedRenewedToken.expiresAt.getTime(),
            );
            observedNow = new Date(liveInput.snapshot.deadline);
          }
          return live;
        },
      };
      const control = new ManageReviewRunAuthorizations({
        runtimeSnapshots: runtimePort,
        clock: { now: () => observedNow },
        digest: production.digest,
        identifiers: { nextId: () => `${harness.prefix}-fenced-admission` },
        identities: production.repositories.repositoryIdentities,
        authorities: production.repositories.mutationAuthorities,
        releases: production.repositories.producerReleases,
        limits: production.repositories.producerReleases,
        slos: production.repositories.producerReleases,
        safetyDecisions: production.runControl.safetyResolver,
        authorizationQueries: production.repositories.authorizations,
        authorizationCommands: production.repositories.authorizations,
        tokens: production.prerequisites.tokens,
      });
      expect(
        (
          await control.authorizeReviewRun({
            ...input(original),
            verifiedIdentity: { ...original, sourceRunAttempt: "3" },
            oidcReplayKeyHash: "c".repeat(64),
          })
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Denied);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
      expect(
        (
          await control.resolveReviewRunAuthorizationToken({
            token: renewed.token.token,
          })
        ).status,
      ).toBe("valid");
      // The original gateway capability and pin share the exact deadline.
      crossDuringBindingRead = true;
      expect(
        (
          await control.resolveReviewRunAuthorizationToken({
            token: renewed.token.token,
          })
        ).status,
      ).toBe("expired");
      crossDuringBindingRead = false;
      observedNow = production.clock.now();
      expect(startBindingRevocationStream).toBeDefined();
      const assertStreamRevoked = await startBindingRevocationStream!();
      await accounts.compareAndSetBinding({
        workspaceId,
        connectionId: connection.id,
        expectedRevision: binding.revision,
        state: "revoked",
      });
      await assertStreamRevoked();
      await expect(harness.authorize()).rejects.toThrow();
      await expect(
        harness.authorize({ sourceRunAttempt: "4" }),
      ).rejects.toThrow();
      // Current configuration now points to a different live account, but replay,
      // renewal and token resolution must still honor the original revocation.
      await saveReviewConfiguration(
        {
          target,
          expectedVersion: 3,
          ...systemPolicyWriteFixture(changed, target),
        },
        { configurations },
      );
      const replacedPin = await snapshotSource.capture({
        modelTransport: "account_gateway",
        identity: original,
        deadline: original.maxExpiresAt,
        producerRelease: snapshotProducer,
      });
      if (replacedPin && "captureDenied" in replacedPin)
        throw new Error(`snapshot_capture_denied:${replacedPin.captureDenied}`);
      if (replacedPin && replacedPin.snapshotVersion !== 3)
        throw new Error("legacy_fixture_snapshot_expected");
      expect(replacedPin?.gateway?.bindingId).toBe(replacementBinding.id);
      await expect(harness.authorize()).rejects.toThrow();
      expect(
        (
          await production.runControl.authorizations.resolveReviewRunAuthorizationToken(
            {
              token: renewed.token.token,
            },
          )
        ).status,
      ).toBe("revoked");
      expect(
        (
          await production.runControl.authorizations.renewReviewRunAuthorization(
            {
              authorizationId: first.authorizationId,
              verifiedIdentity: original,
              renewalReplayKeyHash: "b".repeat(64),
              requestedTtlMs: 60_000,
            },
          )
        ).status,
      ).toBe(ReviewRunAuthorizationUseCaseStatus.Denied);
      const unchanged = await fresh.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: first.authorizationId },
      });
      expect(unchanged.runtimeSnapshotCanonicalJson).toBe(
        row.runtimeSnapshotCanonicalJson,
      );
      expect(unchanged.version).toBe(renewed.authorization.version);
      expect(unchanged.expiresAt).toEqual(renewed.authorization.expiresAt);
      expect(unchanged.maxExpiresAt).toEqual(row.maxExpiresAt);
      expect(
        await prisma.reviewRunAuthorization.count({
          where: { repositoryConnectionId },
        }),
      ).toBe(1);
      // A terminal version advance must also validate the original creation,
      // then return the current terminal row rather than recreating admission.
      await production.runControl.authorizations.expireOrRevokeReviewRunAuthorization(
        {
          authorizationId: original.authorizationId,
          state: ReviewRunAuthorizationState.Revoked,
        },
      );
      for (const oidcReplayKeyHash of [
        original.oidcReplayKeyHash,
        "6".repeat(64),
      ]) {
        expect(
          (
            await production.runControl.authorizations.authorizeReviewRun({
              ...input(original),
              oidcReplayKeyHash,
            })
          ).status,
        ).toBe(ReviewRunAuthorizationUseCaseStatus.Revoked);
      }
      const terminal = await fresh.reviewRunAuthorization.findUniqueOrThrow({
        where: { authorizationId: original.authorizationId },
      });
      expect(terminal.version).toBe(renewed.authorization.version + 1);
      expect(terminal.runtimeSnapshotCanonicalJson).toBe(
        row.runtimeSnapshotCanonicalJson,
      );
      expect(terminal.maxExpiresAt).toEqual(row.maxExpiresAt);
      expect(
        await fresh.outboxEvent.findMany({
          where: {
            aggregateId: original.authorizationId,
            type: "review.run.authorized",
          },
        }),
      ).toEqual([creationEvent]);
      expect(
        await relay!.closeRun(original.authorizationId, "completed"),
      ).toMatchObject({ state: "applied" });
      expect(closes).toHaveLength(1);
      expect(closes[0]!.reason).toBe("completed");
      await expect(
        relay!.responses(
          first.authorizationToken,
          new TextEncoder().encode('{"input":"fixture"}'),
          new AbortController(),
        ),
      ).rejects.toMatchObject({ code: "authorization_denied" });
      // Separate ordinary-TTL fixture in this same PG lifecycle case: real
      // configuration capture, admission, renewal, restore and SQL/outbox reads.
      await saveReviewConfiguration(
        {
          target,
          expectedVersion: 4,
          ...systemPolicyWriteFixture(workspacePolicyFixture, target),
        },
        { configurations },
      );
      const ordinaryAdmission =
        await production.runControl.authorizations.authorizeReviewRun({
          ...input(original),
          modelTransport: "provider_api",
          verifiedIdentity: {
            ...original,
            sourceRunId: `${original.sourceRunId}-ordinary`,
          },
          oidcReplayKeyHash: "1".repeat(64),
        });
      if (!("authorization" in ordinaryAdmission))
        throw new Error("c2c_ordinary_admission_failed");
      expect(ordinaryAdmission.status).toBe(
        ReviewRunAuthorizationUseCaseStatus.Authorized,
      );
      const ordinary = ordinaryAdmission.authorization;
      expect(ordinary.expiresAt.getTime()).toBe(
        ordinary.createdAt.getTime() + 60_000,
      );
      expect(ordinary.maxExpiresAt.getTime()).toBe(
        ordinary.createdAt.getTime() + 3_600_000,
      );
      const ordinaryPin = parseReviewRunRuntimeSnapshot(
        ordinary.runtimeSnapshotCanonicalJson,
      )!;
      if (ordinaryPin.snapshotVersion !== 3)
        throw new Error("legacy_fixture_snapshot_expected");
      expect(ordinaryPin.gateway).toBeNull();
      const ordinaryCreation = await fresh.outboxEvent.findFirstOrThrow({
        where: {
          aggregateId: ordinary.authorizationId,
          type: "review.run.authorized",
        },
      });
      const shortToken = await production.prerequisites.tokens.verify({
        token: ordinaryAdmission.token.token,
        now: production.clock.now(),
      });
      observedNow = production.clock.now();
      let crossOrdinaryExpiry = false;
      const ordinaryControl = new ManageReviewRunAuthorizations({
        runtimeSnapshots: {
          capture: (captureInput) => snapshotSource.capture(captureInput),
          isLive: async (liveInput) => {
            const live = await snapshotSource.isLive(liveInput);
            expect(live).toBe(true);
            return live;
          },
        },
        clock: { now: () => observedNow },
        digest: production.digest,
        identifiers: { nextId: () => `${harness.prefix}-ordinary-unused` },
        identities: production.repositories.repositoryIdentities,
        authorities: production.repositories.mutationAuthorities,
        releases: production.repositories.producerReleases,
        limits: production.repositories.producerReleases,
        slos: production.repositories.producerReleases,
        safetyDecisions: production.runControl.safetyResolver,
        authorizationQueries: {
          findReviewRunAuthorizationForAdmission: (admissionInput) =>
            production.repositories.authorizations.findReviewRunAuthorizationForAdmission(
              admissionInput,
            ),
          findReviewRunAuthorizationById: async (authorizationId) => {
            const authorization =
              await production.repositories.authorizations.findReviewRunAuthorizationById(
                authorizationId,
              );
            if (crossOrdinaryExpiry) observedNow = shortToken.expiresAt;
            return authorization;
          },
        },
        authorizationCommands: production.repositories.authorizations,
        tokens: production.prerequisites.tokens,
      });
      expect(
        (
          await ordinaryControl.resolveReviewRunAuthorizationToken({
            token: ordinaryAdmission.token.token,
          })
        ).status,
      ).toBe("valid");
      crossOrdinaryExpiry = true;
      expect(
        (
          await ordinaryControl.resolveReviewRunAuthorizationToken({
            token: ordinaryAdmission.token.token,
          })
        ).status,
      ).toBe("expired");
      crossOrdinaryExpiry = false;
      expect(observedNow).toEqual(shortToken.expiresAt);
      expect(observedNow.getTime()).toBeLessThanOrEqual(
        ordinary.expiresAt.getTime(),
      );
      expect(observedNow.getTime()).toBeLessThan(
        Date.parse(ordinaryPin.deadline),
      );
      observedNow = production.clock.now();
      const ordinaryRenewed =
        await production.runControl.authorizations.renewReviewRunAuthorization({
          authorizationId: ordinary.authorizationId,
          verifiedIdentity: ordinary,
          renewalReplayKeyHash: "2".repeat(64),
          requestedTtlMs: 120_000,
        });
      if (!("authorization" in ordinaryRenewed))
        throw new Error("c2c_ordinary_renewal_failed");
      expect(ordinaryRenewed.status).toBe(
        ReviewRunAuthorizationUseCaseStatus.Renewed,
      );
      expect(ordinaryRenewed.authorization.version).toBe(2);
      expect(ordinaryRenewed.authorization.createdAt).toEqual(
        ordinary.createdAt,
      );
      expect(ordinaryRenewed.authorization.maxExpiresAt).toEqual(
        ordinary.maxExpiresAt,
      );
      expect(ordinaryRenewed.authorization.runtimeSnapshotCanonicalJson).toBe(
        ordinary.runtimeSnapshotCanonicalJson,
      );
      expect(ordinaryRenewed.authorization.expiresAt.getTime()).toBeGreaterThan(
        ordinary.expiresAt.getTime(),
      );
      expect(ordinaryRenewed.authorization.expiresAt.getTime()).toBeLessThan(
        ordinary.maxExpiresAt.getTime(),
      );
      for (const oidcReplayKeyHash of [
        ordinary.oidcReplayKeyHash,
        "3".repeat(64),
      ]) {
        const restored =
          await production.runControl.authorizations.authorizeReviewRun({
            ...input(ordinary),
            modelTransport: "provider_api",
            oidcReplayKeyHash,
          });
        if (!("authorization" in restored))
          throw new Error("c2c_ordinary_restore_failed");
        expect(restored.status).toBe(
          ReviewRunAuthorizationUseCaseStatus.Restored,
        );
        expect(restored.authorization).toEqual(ordinaryRenewed.authorization);
      }
      expect(
        (
          await production.runControl.authorizations.resolveReviewRunAuthorizationToken(
            {
              token: ordinaryAdmission.token.token,
            },
          )
        ).status,
      ).toBe("claim_drift");
      expect(
        await fresh.outboxEvent.findMany({
          where: {
            aggregateId: ordinary.authorizationId,
            type: "review.run.authorized",
          },
        }),
      ).toEqual([ordinaryCreation]);
      expect(ordinaryCreation.payload).toMatchObject({
        authorizationVersion: 1,
      });
      expect(ordinaryCreation.occurredAt).toEqual(ordinary.createdAt);

      // RED: a valid acquired execution at a different epoch was abandoned
      // before retaining its cleanup client. Use the existing real SDK/HTTP
      // server; authority doubles isolate this transport-lifecycle boundary.
      {
        const mismatchCanonical = canonicalJson({
          ...pin,
          snapshotVersion: 3,
          gateway: { ...pin.gateway, expectedAuthorizationEpoch: 54 },
        });
        let mismatchAttachments = 0;
        const beforeMismatchIntents = intents.length;
        const beforeMismatchRequests = requests.length;
        const beforeMismatchCloses = closes.length;
        const cleanupOnly = createReviewRunGatewayPreparation({
          authorizationId: gatewayRun.authorizationId,
          identity: gatewayRun,
          runAccess: {
            origin,
            runControlBearer: runControlToken,
            timeoutMs: 5000,
          },
          authorizations: {
            findReviewRunAuthorizationById: async () => ({
              ...gatewayRun,
              runtimeSnapshotCanonicalJson: mismatchCanonical,
            }),
          },
          snapshots: { capture: async () => null, isLive: async () => true },
          bindings: {
            read: async () => ({ status: "live", binding: null }),
            attach: async () => {
              mismatchAttachments++;
              return { status: "denied" };
            },
          },
        });
        expect(await cleanupOnly.prepare()).toEqual({ status: "denied" });
        expect(intents).toHaveLength(beforeMismatchIntents + 1);
        expect(mismatchAttachments).toBe(0);
        await expect(
          cleanupOnly.request("mismatch-request", new Uint8Array()),
        ).rejects.toThrow();
        expect(requests).toHaveLength(beforeMismatchRequests);
        expect(await cleanupOnly.prepare()).toEqual({ status: "denied" });
        expect(await cleanupOnly.recoverSameOperation()).toEqual({
          status: "denied",
        });
        expect(intents).toHaveLength(beforeMismatchIntents + 1);
        expect(await cleanupOnly.close("cancelled")).toMatchObject({
          state: "applied",
        });
        // The server accepts only its exact selected execution path and bearer.
        expect(closes).toHaveLength(beforeMismatchCloses + 1);
        expect(closes.at(-1)?.reason).toBe("cancelled");
      }

      // A Berlin session must not shift a UTC epoch through either the raw
      // installation clock or the timestamp column's GREATEST assignment.
      const identityBeforeFence =
        await prisma.scmRepositoryIdentity.findUniqueOrThrow({
          where: { scmRepositoryIdentityId: harness.scmRepositoryIdentityId },
        });
      const transactionEpochMs = await prisma.$transaction(async (tx) => {
        const [time] = await tx.$queryRaw<readonly { epochMs: bigint }[]>`
          SELECT round(extract(epoch FROM transaction_timestamp()) * 1000)::bigint AS "epochMs"
        `;
        if (!time) throw new Error("c2c_fence_transaction_time_missing");
        await rotateScmRepositoryIdentityEpoch(tx, {
          scmRepositoryIdentityId: harness.scmRepositoryIdentityId,
          repositoryConnectionId,
          currentWorkspaceId: workspaceId,
          boundAt: new Date(Number(time.epochMs)),
        });
        return Number(time.epochMs);
      });
      const reboundIdentity =
        await prisma.scmRepositoryIdentity.findUniqueOrThrow({
          where: { scmRepositoryIdentityId: harness.scmRepositoryIdentityId },
        });
      expect(reboundIdentity.version).toBe(identityBeforeFence.version + 1);
      expect(reboundIdentity.boundAt?.getTime()).toBe(
        Math.max(identityBeforeFence.boundAt!.getTime(), transactionEpochMs) +
          1,
      );
      const readEpochMs = async () => {
        const [time] = await prisma.$queryRaw<readonly { epochMs: bigint }[]>`
          SELECT round(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "epochMs"
        `;
        if (!time) throw new Error("c2c_fence_database_time_missing");
        return Number(time.epochMs);
      };
      const beforeRemovalEpochMs = await readEpochMs();
      await new PrismaGitHubInstallationRepository(
        prisma,
      ).markInstallationRemoved("123456");
      const afterRemovalEpochMs = await readEpochMs();
      const removedIdentity =
        await prisma.scmRepositoryIdentity.findUniqueOrThrow({
          where: { scmRepositoryIdentityId: harness.scmRepositoryIdentityId },
        });
      expect(removedIdentity.version).toBe(reboundIdentity.version + 1);
      expect(removedIdentity.boundAt?.getTime()).toBeGreaterThanOrEqual(
        Math.max(reboundIdentity.boundAt!.getTime(), beforeRemovalEpochMs) + 1,
      );
      expect(removedIdentity.boundAt?.getTime()).toBeLessThanOrEqual(
        Math.max(reboundIdentity.boundAt!.getTime(), afterRemovalEpochMs) + 1,
      );
    } finally {
      await closeRelayApp?.();
      await closeGateway?.();
      restoreGatewayFetch?.();
      await fresh.$disconnect();
      await harness.close();
    }
  }, 60_000);
});
