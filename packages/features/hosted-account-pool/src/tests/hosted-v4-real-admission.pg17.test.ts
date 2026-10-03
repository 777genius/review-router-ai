import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../../../../platform/db/src/index";
import { canonicalJson } from "../../../review-investigations/src/index";
import { createInvestigationStoreContractSeed } from "../../../review-investigations/src/testing/investigation-store-contract";
import { seedExecution } from "../../../review-investigations/src/testing/prisma-investigation-store-harness";
import { hostedV4DescriptorExtensionIdentities } from "../domain/hosted-v4-relay-descriptor";
import {
  defineHostedV4RelayGrant,
  hostedV4RelayCanaryPolicyFingerprint,
  type HostedV4RelayScope,
} from "../domain/hosted-v4-relay-grant";
import { PrismaHostedV4RelayTurn } from "../infrastructure/prisma/prisma-hosted-v4-relay-turn";

const setupUrl = process.env.REVIEW_ROUTER_V4_PG17_SETUP_DATABASE_URL;
const runtimeUrl = process.env.REVIEW_ROUTER_V4_PG17_RUNTIME_DATABASE_URL;
// An ordinary Vitest run must not connect to operator-owned PostgreSQL.
// Once opted in, missing or unsafe connection details are hard failures.
const runDisposablePg17 = process.env.REVIEW_ROUTER_V4_PG17_RUN === "1";
// The operator supplies a separate disposable database with one deliberately
// misowned relation for the negative qualification. This test never transfers
// ownership or changes the stock schema itself.
const ownershipNegative =
  process.env.REVIEW_ROUTER_V4_PG17_OWNERSHIP_NEGATIVE === "1";
const marker = "rr_v4_444_disposable";
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

// Require canonical ownership for the v4 relations and routines exercised by
// this test, including older trigger routines used for request accounting.
// Stock certified-fork objects have their own dedicated owners.
const protectedRelations = [
  "HostedCodexRuntimeGate",
  "HostedCodexRuntimeClosure",
  "HostedHistoricalScopePolicy",
  "HostedHistoricalUnknownScope",
  "HostedHistoricalScopeAlias",
  "HostedHistoricalScopeComplete",
  "HostedCodexV4RelayTurn",
  "HostedCodexInvocationGrant",
  "HostedCodexRelayRequest",
  "HostedCodexUpstreamEffectAttempt",
] as const;
const protectedRoutines = [
  // Stock 000074/000075 request admission debits the grant, which in turn
  // executes its transition guard. Stock 000080 checks effect inserts/updates.
  "hosted_codex_relay_admission_guard",
  "hosted_codex_invocation_grant_guard",
  "hosted_codex_effect_attempt_monotonic",
  "hosted_historical_lock_runtime_gate",
  "hosted_historical_grant_guard",
  "hosted_historical_assert_ready",
  "hosted_historical_assert_grant",
  "hosted_historical_set_digest",
  "hosted_historical_request_alias_guard",
  "hosted_historical_attempt_alias_guard",
  "hosted_historical_gate_guard",
  "hosted_historical_setup_guard",
  "hosted_codex_v4_turn_guard",
  "hosted_codex_v4_grant_guard",
  "hosted_codex_v4_dispatch_disabled",
  "hosted_codex_v4_unknown_effect_fence",
  "review_investigation_turn_budget_guard",
  "review_investigation_v4_request_fence",
] as const;
type OwnedObject = { kind: string; name: string; owner: string };

function assertReleaseOwnership(objects: OwnedObject[]): void {
  const expected = [
    ...protectedRelations.map((name) => `relation:${name}`),
    ...protectedRoutines.map((name) => `routine:${name}`),
  ];
  const protectedNames = new Set(expected);
  const actual = new Set(objects.map(({ kind, name }) => `${kind}:${name}`));
  expect(expected.filter((name) => !actual.has(name))).toEqual([]);
  const unexpected = objects.filter(
    ({ kind, name, owner }) =>
      protectedNames.has(`${kind}:${name}`) &&
      owner !== "reviewrouter_release_schema_owner",
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Exercised v4 object lacks canonical release ownership: ${unexpected
        .map(({ kind, name, owner }) => `${kind}:${name} owned by ${owner}`)
        .join(", ")}`,
    );
  }
}

function requireDisposableUrls(): { setup: string; runtime: string } {
  if (!setupUrl || !runtimeUrl) {
    throw new Error(
      "Both REVIEW_ROUTER_V4_PG17_SETUP_DATABASE_URL and REVIEW_ROUTER_V4_PG17_RUNTIME_DATABASE_URL are required",
    );
  }
  const setup = new URL(setupUrl);
  const runtime = new URL(runtimeUrl);
  if (
    ![setup, runtime].every(
      (url) =>
        ["postgres:", "postgresql:"].includes(url.protocol) &&
        /^rr_v4_444_disposable(?:_[a-z0-9_-]+)?$/.test(
          decodeURIComponent(url.pathname.slice(1)),
        ),
    ) ||
    setup.hostname !== runtime.hostname ||
    setup.port !== runtime.port ||
    setup.pathname !== runtime.pathname ||
    runtime.username !== "reviewrouter_api" ||
    setup.search !== "" ||
    runtime.search !== "" ||
    setup.hash !== "" ||
    runtime.hash !== ""
  ) {
    throw new Error(
      `URLs must target the same ${marker} database with direct reviewrouter_api runtime login and no connection options`,
    );
  }
  return { setup: setupUrl, runtime: runtimeUrl };
}

// Check the *effective* permissions of each runtime client, including column
// grants and inherited privileges. A switched or privileged setup connection
// would make the positive path meaningless even if its row assertions passed.
async function assertRuntimeAuthority(client: PrismaClient): Promise<void> {
  const [actor] = await client.$queryRaw<
    Array<{
      sessionUser: string;
      currentUser: string;
      canLogin: boolean;
      superuser: boolean;
      createRole: boolean;
      createDb: boolean;
      replication: boolean;
      bypassRls: boolean;
      membershipEdges: bigint;
      schemaCreate: boolean;
    }>
  >(Prisma.sql`
    SELECT session_user AS "sessionUser", current_user AS "currentUser",
      role.rolcanlogin AS "canLogin", role.rolsuper AS superuser,
      role.rolcreaterole AS "createRole", role.rolcreatedb AS "createDb",
      role.rolreplication AS replication, role.rolbypassrls AS "bypassRls",
      (SELECT count(*)::bigint FROM pg_catalog.pg_auth_members edge
       WHERE edge.roleid = role.oid OR edge.member = role.oid
          OR edge.grantor = role.oid) AS "membershipEdges",
      pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate"
    FROM pg_catalog.pg_roles role WHERE role.rolname = current_user
  `);
  expect(actor).toEqual({
    sessionUser: "reviewrouter_api",
    currentUser: "reviewrouter_api",
    canLogin: true,
    superuser: false,
    createRole: false,
    createDb: false,
    replication: false,
    bypassRls: false,
    membershipEdges: 0n,
    schemaCreate: false,
  });

  const ownedObjects = await client.$queryRaw<OwnedObject[]>(Prisma.sql`
    SELECT 'relation' AS kind, relation.relname AS name,
      pg_catalog.pg_get_userbyid(relation.relowner) AS owner
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT 'routine' AS kind, routine.proname AS name,
      pg_catalog.pg_get_userbyid(routine.proowner) AS owner
    FROM pg_catalog.pg_proc routine
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'public'
    UNION ALL
    SELECT 'type' AS kind, type.typname AS name,
      pg_catalog.pg_get_userbyid(type.typowner) AS owner
    FROM pg_catalog.pg_type type
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typtype IN ('d', 'e', 'm', 'r')
  `);
  assertReleaseOwnership(ownedObjects);

  const acl = await client.$queryRaw<
    Array<{
      tableName: string;
      canSelect: boolean;
      columnSelect: boolean;
      tableWrite: boolean;
      columnInsert: boolean;
      columnUpdate: boolean;
    }>
  >(Prisma.sql`
    SELECT protected.table_name AS "tableName",
      pg_catalog.has_table_privilege(current_user,
        pg_catalog.format('public.%I', protected.table_name), 'SELECT') AS "canSelect",
      pg_catalog.has_any_column_privilege(current_user,
        pg_catalog.format('public.%I', protected.table_name), 'SELECT') AS "columnSelect",
      pg_catalog.has_table_privilege(current_user,
        pg_catalog.format('public.%I', protected.table_name),
        'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS "tableWrite",
      pg_catalog.has_any_column_privilege(current_user,
        pg_catalog.format('public.%I', protected.table_name), 'INSERT') AS "columnInsert",
      pg_catalog.has_any_column_privilege(current_user,
        pg_catalog.format('public.%I', protected.table_name), 'UPDATE') AS "columnUpdate"
    FROM (VALUES ('HostedCodexRuntimeGate'), ('HostedCodexRuntimeClosure'),
      ('HostedHistoricalScopePolicy'), ('HostedHistoricalUnknownScope'),
      ('HostedHistoricalScopeAlias'), ('HostedHistoricalScopeComplete'))
      AS protected(table_name)
    ORDER BY protected.table_name
  `);
  expect(
    acl.map(({ tableName, canSelect, columnSelect }) => ({
      tableName,
      canSelect,
      columnSelect,
    })),
  ).toEqual([
    {
      tableName: "HostedCodexRuntimeClosure",
      canSelect: true,
      columnSelect: true,
    },
    {
      tableName: "HostedCodexRuntimeGate",
      canSelect: true,
      columnSelect: true,
    },
    {
      tableName: "HostedHistoricalScopeAlias",
      canSelect: true,
      columnSelect: true,
    },
    {
      tableName: "HostedHistoricalScopeComplete",
      canSelect: true,
      columnSelect: true,
    },
    {
      tableName: "HostedHistoricalScopePolicy",
      canSelect: true,
      columnSelect: true,
    },
    {
      tableName: "HostedHistoricalUnknownScope",
      canSelect: true,
      columnSelect: true,
    },
  ]);
  expect(
    acl.every(
      (row) => !row.tableWrite && !row.columnInsert && !row.columnUpdate,
    ),
  ).toBe(true);

  // A converged runtime grant also lets the API read and fence the current
  // producer release. Without it the request path fails before the debit.
  const [releaseAcl] = await client.$queryRaw<
    Array<{
      canSelect: boolean;
      canUpdate: boolean;
    }>
  >(Prisma.sql`
    SELECT pg_catalog.has_table_privilege(current_user,
        'public."ProducerRelease"', 'SELECT') AS "canSelect",
      pg_catalog.has_table_privilege(current_user,
        'public."ProducerRelease"', 'UPDATE') AS "canUpdate"
  `);
  expect(releaseAcl).toEqual({ canSelect: true, canUpdate: true });

  const [functions] = await client.$queryRaw<
    Array<{
      lockGate: boolean;
      grantGuard: boolean;
      gateGuard: boolean;
      setupGuard: boolean;
    }>
  >(Prisma.sql`
    SELECT pg_catalog.has_function_privilege(current_user,
      'public.hosted_historical_lock_runtime_gate()', 'EXECUTE') AS "lockGate",
      pg_catalog.has_function_privilege(current_user,
      'public.hosted_historical_grant_guard()', 'EXECUTE') AS "grantGuard",
      pg_catalog.has_function_privilege(current_user,
      'public.hosted_historical_gate_guard()', 'EXECUTE') AS "gateGuard",
      pg_catalog.has_function_privilege(current_user,
      'public.hosted_historical_setup_guard()', 'EXECUTE') AS "setupGuard"
  `);
  expect(functions).toEqual({
    lockGate: true,
    grantGuard: false,
    gateGuard: false,
    setupGuard: false,
  });
}

describe.skipIf(!runDisposablePg17 || ownershipNegative)(
  "hosted v4 real PG17 admission",
  () => {
    let setup: PrismaClient;
    let runtime: PrismaClient;
    let runtimeGateEpoch: bigint;
    const suffix = randomUUID();
    const seed = createInvestigationStoreContractSeed(`v4-${suffix}`, {
      trustDomain: "trusted_managed",
    });
    const ids = {
      installation: `installation-${suffix}`,
      pool: `pool-${suffix}`,
      binding: `binding-${suffix}`,
      account: `account-${suffix}`,
      request: `request-${suffix}`,
      config: `config-${suffix}`,
      turn: `turn-${suffix}`,
      investigationLease: `investigation-lease-${suffix}`,
      invocationLease: `invocation-lease-${suffix}`,
    };
    const githubRepositoryId = BigInt(`0x${hash(suffix).slice(0, 15)}`);
    const githubInstallationId = githubRepositoryId + 1n;
    const producerReleaseId = `producer-${seed.investigationId}`;
    const authorizationId = `authorization-${seed.investigationId}`;
    const expires = (minutes: number) =>
      new Date(Date.now() + minutes * 60_000);

    beforeAll(async () => {
      const urls = requireDisposableUrls();
      setup = createPrismaClient({ databaseUrl: urls.setup });
      // Keep the checked authenticated backend for the whole runtime path.
      runtime = createPrismaClient({ databaseUrl: urls.runtime, poolMax: 1 });
      const [server] = await setup.$queryRaw<
        Array<{
          version: number;
          database: string;
        }>
      >(Prisma.sql`
      SELECT current_setting('server_version_num')::integer AS version,
        current_database() AS database
    `);
      expect(server?.version).toBeGreaterThanOrEqual(170000);
      expect(server?.version).toBeLessThan(180000);
      expect(server?.database).toContain(marker);
      await assertRuntimeAuthority(runtime);
      const migrations = await setup.$queryRaw<
        Array<{
          migration_name: string;
          checksum: string;
        }>
      >(Prisma.sql`
      SELECT migration_name, checksum FROM public._prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name
    `);
      const stock = migrations.map((row) => row.migration_name);
      const migrationsDirectory = new URL(
        "../../../../platform/db/prisma/migrations/",
        import.meta.url,
      );
      const localStock = readdirSync(migrationsDirectory)
        .filter((name) => /^\d{6}_/.test(name))
        .sort();
      expect(stock).toEqual(localStock);
      for (const migration of migrations) {
        expect(migration.checksum).toBe(
          hash(
            readFileSync(
              new URL(
                `${migration.migration_name}/migration.sql`,
                migrationsDirectory,
              ),
            ),
          ),
        );
      }
      expect(stock.at(-1)).toBe("000116_hosted_v4_fenced_dispatch");
      const failed = await setup.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count FROM public._prisma_migrations
      WHERE finished_at IS NULL AND rolled_back_at IS NULL
    `);
      expect(failed[0]?.count).toBe(0n);
      const [contents] = await setup.$queryRaw<
        Array<{
          workspaces: bigint;
          grants: bigint;
          intents: bigint;
          historicalPolicies: bigint;
        }>
      >(Prisma.sql`
      SELECT (SELECT count(*) FROM public."Workspace")::bigint AS workspaces,
        (SELECT count(*) FROM public."HostedCodexInvocationGrant")::bigint AS grants,
        (SELECT count(*) FROM public."ReviewRequestedIntent")::bigint AS intents,
        (SELECT count(*) FROM public."HostedHistoricalScopePolicy")::bigint
          AS "historicalPolicies"
    `);
      expect(contents).toEqual({
        workspaces: 0n,
        grants: 0n,
        intents: 0n,
        historicalPolicies: 0n,
      });
      const [gate] = await setup.$queryRaw<
        Array<{ status: string; authzEpoch: bigint }>
      >(Prisma.sql`
      SELECT "status"::text AS status, "authzEpoch"
      FROM public."HostedCodexRuntimeGate" WHERE "id" = 'global'
    `);
      if (gate?.status !== "active" || gate.authzEpoch < 1n) {
        throw new Error(
          "Disposable PG17 requires a legitimately activated hosted runtime gate after the stock closure barrier",
        );
      }
      runtimeGateEpoch = gate.authzEpoch;
      // PR478's stock admission guard predates the separately qualified UTC
      // correction. Isolate that sibling defect in this disposable database;
      // never alter its stock migration or the runtime connection's authority.
      await setup.$executeRawUnsafe(
        "ALTER FUNCTION public.hosted_codex_relay_admission_guard() SET timezone = 'UTC'",
      );
    });

    afterAll(async () => {
      if (runtime) await runtime.$disconnect();
      if (setup) await setup.$disconnect();
    });

    it("admits one grant, debits one hashed request and restores one prepared effect after restart", async () => {
      const now = new Date();
      const investigationLeaseExpiry = expires(8);
      const invocationLeaseExpiry = expires(9);
      const turnExpiry = expires(7);
      const authorizationExpiry = expires(10);
      const policyExpiry = expires(10);
      const turnBudgetCanonicalJson = canonicalJson({
        deadline: turnExpiry.toISOString(),
        maxGatewayOperations: 8,
        maxOutputFindings: 4,
        maxOutputProposals: 4,
        maxOutputTokens: 100,
        maxRequestBytes: 1_000,
        maxRequests: 1,
        maxResponseBytes: 2_000,
        version: 1,
      });
      const turnBudgetHash = hash(turnBudgetCanonicalJson);
      const investigationManifestCanonicalJson = canonicalJson({
        test: suffix,
      });
      const investigationManifestHash = hash(
        investigationManifestCanonicalJson,
      );
      const preparedManifestCanonicalJson = canonicalJson({
        manifestVersion: 1,
      });
      const coverageProfileHash = hash("coverage");
      const policyHash = hash("policy");
      const descriptor = canonicalJson({
        authorizationDescriptorVersion: 3,
        capability: "review_investigation_v1",
        coverageProfileHash,
        extensionCanonicalizerDigest:
          hostedV4DescriptorExtensionIdentities.shadow.canonicalizerDigest,
        extensionId: hostedV4DescriptorExtensionIdentities.shadow.extensionId,
        extensionSchemaDigest:
          hostedV4DescriptorExtensionIdentities.shadow.schemaDigest,
        policyHash,
        providerCapabilities: [
          { providerKind: "codex", capabilities: ["recording"] },
        ],
        hostedRelayExtension: {
          capability: "hosted_relay_turn_v1",
          extensionCanonicalizerDigest:
            hostedV4DescriptorExtensionIdentities.relay.canonicalizerDigest,
          extensionId: hostedV4DescriptorExtensionIdentities.relay.extensionId,
          extensionSchemaDigest:
            hostedV4DescriptorExtensionIdentities.relay.schemaDigest,
        },
      });

      await seedExecution(setup, seed);
      const release = await setup.producerRelease.findUniqueOrThrow({
        where: { producerReleaseId },
      });
      await setup.producerRelease.update({
        where: { producerReleaseId },
        data: {
          contextGatewayPolicyVersion: seed.contract.gatewayPolicyVersion,
          contextGatewayEntrypointDigest: hash("gateway"),
          reviewInvestigationCapability: "review_investigation_v1",
          reviewInvestigationCoverageProfileHash: coverageProfileHash,
          reviewInvestigationPolicyHash: policyHash,
        },
      });
      await setup.reviewRunAuthorization.update({
        where: { authorizationId },
        data: {
          trustDomain: "trusted_managed",
          expiresAt: authorizationExpiry,
          maxExpiresAt: expires(20),
          reviewInvestigationAuthorizationDescriptorCanonicalJson: descriptor,
        },
      });
      await setup.reviewExecutionV2.update({
        where: { executionId: seed.executionId },
        data: {
          createdAt: now,
          updatedAt: now,
          admissionDeadlineAt: expires(5),
          executionDeadlineAt: expires(20),
          retainUntil: expires(60),
        },
      });
      await setup.gitHubInstallation.create({
        data: {
          id: ids.installation,
          workspaceId: seed.scope.workspaceId,
          githubInstallationId,
          accountLogin: "disposable-v4",
          accountType: "Organization",
          repositorySelection: "selected",
          status: "active",
        },
      });
      await setup.repositoryConnection.update({
        where: { id: seed.scope.repositoryConnectionId },
        data: {
          externalRepositoryId: githubRepositoryId.toString(),
          githubRepositoryId,
          installationId: ids.installation,
          selected: true,
        },
      });
      await setup.scmRepositoryIdentity.update({
        where: { scmRepositoryIdentityId: seed.scope.scmRepositoryIdentityId },
        data: { externalRepositoryId: githubRepositoryId.toString() },
      });
      await setup.reviewMutationAuthority.create({
        data: {
          scmRepositoryIdentityId: seed.scope.scmRepositoryIdentityId,
          laneKind: "hosted_reviewrouter_app",
          epoch: 1n,
          mode: "v2_active",
          initializedAt: now,
          activatedAt: now,
        },
      });
      await setup.hostedCodexPool.create({
        data: {
          id: ids.pool,
          workspaceId: seed.scope.workspaceId,
          name: "disposable-v4",
          status: "active",
          authzEpoch: 1n,
        },
      });
      await setup.hostedCodexRepositoryBinding.create({
        data: {
          id: ids.binding,
          workspaceId: seed.scope.workspaceId,
          poolId: ids.pool,
          repositoryConnectionId: seed.scope.repositoryConnectionId,
          status: "active",
          revision: 1n,
          workflowPath: ".github/workflows/reviewrouter-codex.yml",
          workflowActionRef: `reviewrouter/action@${seed.revision.headSha}`,
          workflowSourceCommitSha: seed.revision.headSha,
          workflowSourceBlobSha: seed.revision.headSha,
          workflowSourceSha256: hash("disposable-v4-workflow-source"),
          workflowSemanticSha256: hash("disposable-v4-workflow-semantic"),
          workflowSourceTrust: "trusted_default_branch_revision",
          attestedGithubRepositoryId: githubRepositoryId,
          attestedBindingRevision: 1n,
          activatedAt: now,
        },
      });
      await setup.hostedCodexAccount.create({
        data: {
          id: ids.account,
          workspaceId: seed.scope.workspaceId,
          poolId: ids.pool,
          label: "disposable-v4",
          accountFingerprint: hash(ids.account),
          state: "provisioning_pending",
          priority: 1,
        },
      });
      await setup.hostedCodexCredentialVersion.create({
        data: {
          workspaceId: seed.scope.workspaceId,
          poolId: ids.pool,
          accountId: ids.account,
          generation: 1n,
          databaseIncarnation: `disposable-${suffix}`,
          envelopeVersion: 1,
          encryptionAlgorithm: "test-only-unusable",
          keyId: "test-only",
          aadHash: hash("aad"),
          generationHash: hash("generation"),
          ciphertextHash: hash("ciphertext"),
          encryptedCiphertext: "test-only-unusable",
          envelopeMetadata: {},
          credentialExpiresAt: expires(20),
        },
      });
      await setup.hostedCodexAccount.update({
        where: { id: ids.account },
        data: {
          state: "healthy",
          activeGeneration: 1n,
          healthVersion: 1n,
          lastHealthyAt: now,
        },
      });
      await setup.reviewConfiguration.create({
        data: {
          id: ids.config,
          workspaceId: seed.scope.workspaceId,
          repositoryId: seed.scope.repositoryConnectionId,
          targetKey: `repo:${seed.scope.repositoryConnectionId}`,
          versions: {
            create: {
              version: 1,
              providerKind: "codex",
              providerAuthMode: "codex_subscription_oauth_hosted_pool",
              model: "codex",
              reasoningEffort: "low",
              failOnSeverity: "critical",
              inlineMaxComments: 1,
              targetTokensPerBatch: 4_000,
              providerLimit: 1,
              providerMaxParallel: 1,
              investigationRecordingEnabled: true,
            },
          },
        },
      });
      await setup.reviewRequestedIntent.create({
        data: {
          requestId: ids.request,
          workspaceId: seed.scope.workspaceId,
          repositoryConnectionId: seed.scope.repositoryConnectionId,
          scmRepositoryIdentityId: seed.scope.scmRepositoryIdentityId,
          pullRequestNumber: seed.scope.pullRequestNumber,
          baseSha: seed.revision.baseSha,
          mergeBaseSha: seed.revision.mergeBaseSha,
          headSha: seed.revision.headSha,
          reviewRevisionHash: seed.revision.reviewRevisionHash,
          triggerKind: "manual_command",
          deliveryIdentityHash: hash(`delivery-${suffix}`),
          canonicalRequestHash: hash(`request-${suffix}`),
          state: "dispatched",
          admissionState: "admitted",
          notBefore: now,
          admissionChangedLines: 1,
          admissionMaxChangedLines: 10,
          admissionPolicySnapshotId: `disposable-policy-${suffix}`,
          admissionDecisionHash: hash(`admission-${suffix}`),
          admissionCheckedAt: now,
          sourceRunId: `run-${seed.investigationId}`,
          sourceRunAttempt: "1",
          authorizationId,
          executionId: seed.executionId,
          createdAt: now,
          updatedAt: now,
          retainUntil: expires(60),
        },
      });
      await setup.reviewExecutionWorkSlotV2.update({
        where: {
          executionId_workSlotId: {
            executionId: seed.executionId,
            workSlotId: seed.workSlotId,
          },
        },
        data: { state: "leased", activeLeaseId: ids.invocationLease },
      });
      await setup.reviewInvestigation.create({
        data: {
          investigationId: seed.investigationId,
          naturalIdentityHash: seed.naturalIdentityHash,
          version: 2n,
          workspaceId: seed.scope.workspaceId,
          repositoryConnectionId: seed.scope.repositoryConnectionId,
          scmRepositoryIdentityId: seed.scope.scmRepositoryIdentityId,
          pullRequestNumber: seed.scope.pullRequestNumber,
          trustDomain: "trusted_managed",
          authorizationScopeHash: seed.scope.authorizationScopeHash,
          baseSha: seed.revision.baseSha,
          mergeBaseSha: seed.revision.mergeBaseSha,
          headSha: seed.revision.headSha,
          reviewRevisionHash: seed.revision.reviewRevisionHash,
          executionId: seed.executionId,
          workSlotId: seed.workSlotId,
          stableReviewUnitKey: seed.stableReviewUnitKey,
          providerVoteLaneId: seed.providerVoteLaneId,
          providerStrategyId: seed.providerStrategyId,
          investigationManifestCanonicalJson,
          investigationManifestHash,
          runtimeProfile: "gateway_attested_agent_v1",
          coverageContractVersion: seed.contract.coverageContractVersion,
          expansionRulesVersion: seed.contract.expansionRulesVersion,
          criticPolicyVersion: seed.contract.criticPolicyVersion,
          gatewayPolicyVersion: seed.contract.gatewayPolicyVersion,
          producerReleaseId,
          runtimeProfileVersion: seed.contract.runtimeProfileVersion,
          policy: seed.policy as Prisma.InputJsonValue,
          state: "awaiting_turn",
          findings: [],
          turnProvenance: [],
          dossierDigest: seed.dossierDigest,
          createdAt: now,
          updatedAt: now,
          retainUntil: expires(60),
        },
      });
      await setup.reviewInvestigationTurn.create({
        data: {
          turnId: ids.turn,
          investigationId: seed.investigationId,
          turnOrdinal: 1,
          purpose: "discovery",
          state: "leased",
          leasedAtVersion: 2n,
          dossierDigest: seed.dossierDigest,
          turnBudgetCanonicalJson,
          turnBudgetHash,
          obligationIds: [],
          semanticTurnOrdinal: 1,
          criticCycleOrdinal: 0,
          leasedAt: now,
          expiresAt: turnExpiry,
          retainUntil: expires(60),
        },
      });
      await setup.reviewInvestigation.update({
        where: { investigationId: seed.investigationId },
        data: { state: "turn_leased", activeTurnId: ids.turn },
      });
      const investigationLease = await setup.reviewInvestigationLease.create({
        data: {
          leaseId: ids.investigationLease,
          purpose: "relay_turn",
          workspaceId: seed.scope.workspaceId,
          repositoryConnectionId: seed.scope.repositoryConnectionId,
          scmRepositoryIdentityId: seed.scope.scmRepositoryIdentityId,
          pullRequestNumber: seed.scope.pullRequestNumber,
          authorizationId,
          mutationEpoch: 1n,
          executionId: seed.executionId,
          workSlotId: seed.workSlotId,
          baseSha: seed.revision.baseSha,
          mergeBaseSha: seed.revision.mergeBaseSha,
          headSha: seed.revision.headSha,
          reviewRevisionHash: seed.revision.reviewRevisionHash,
          investigationId: seed.investigationId,
          investigationVersion: 2n,
          turnId: ids.turn,
          turnPurpose: "discovery",
          providerVoteLaneId: seed.providerVoteLaneId,
          providerStrategyId: seed.providerStrategyId,
          investigationManifestCanonicalJson,
          investigationManifestHash,
          attemptId: `attempt-${suffix}`,
          acquireRequestIdHash: hash("investigation-acquire-id"),
          acquireRequestHash: hash("investigation-acquire"),
          ownerIdHash: hash("investigation-owner"),
          leaseCapabilityId: `investigation-capability-${suffix}`,
          capabilitySigningKeyId: "test-only",
          state: "active",
          acquiredAt: now,
          renewedAt: now,
          expiresAt: investigationLeaseExpiry,
          resultReportUntil: expires(20),
          retainUntil: expires(60),
        },
      });
      const invocationLease = await setup.reviewInvocationLeaseV2.create({
        data: {
          leaseId: ids.invocationLease,
          workspaceId: seed.scope.workspaceId,
          repositoryConnectionId: seed.scope.repositoryConnectionId,
          scmRepositoryIdentityId: seed.scope.scmRepositoryIdentityId,
          pullRequestNumber: seed.scope.pullRequestNumber,
          executionId: seed.executionId,
          executionGeneration: 1n,
          providerInvocationKey: `provider-invocation-${suffix}`,
          preparedManifestCanonicalJson,
          preparedManifestKey: hash(preparedManifestCanonicalJson),
          providerVoteIdentityHash: seed.providerVoteLaneId,
          workSlotId: seed.workSlotId,
          purpose: "provider_execution",
          authorizationId,
          producerReleaseId,
          reviewRevisionHash: seed.revision.reviewRevisionHash,
          mutationEpoch: 1n,
          leaseSafetyDecisionHash: hash("lease-safety"),
          attemptId: `invocation-attempt-${suffix}`,
          attemptOrdinal: 1,
          acquireRequestIdHash: hash("invocation-acquire-id"),
          acquireRequestHash: hash("invocation-acquire"),
          ownerIdHash: hash("invocation-owner"),
          leaseCapabilityId: `invocation-capability-${suffix}`,
          capabilitySigningKeyId: "test-only",
          state: "active",
          acquiredAt: now,
          renewedAt: now,
          expiresAt: invocationLeaseExpiry,
          resultReportUntil: expires(20),
          retainUntil: expires(60),
        },
      });

      const scope: HostedV4RelayScope = {
        version: 4,
        authorizationId,
        authorizationState: "active",
        mutationEpoch: 1n,
        trustDomain: "trusted_managed",
        investigationCodexRecordingAllowed: true,
        workspaceId: seed.scope.workspaceId,
        repositoryConnectionId: seed.scope.repositoryConnectionId,
        scmRepositoryIdentityId: seed.scope.scmRepositoryIdentityId,
        githubRepositoryId: githubRepositoryId.toString(),
        githubInstallationId: githubInstallationId.toString(),
        pullRequestNumber: seed.scope.pullRequestNumber,
        baseSha: seed.revision.baseSha,
        mergeBaseSha: seed.revision.mergeBaseSha,
        headSha: seed.revision.headSha,
        reviewRevisionHash: seed.revision.reviewRevisionHash,
        producerReleaseId,
        producerReleaseRegistered: true,
        actionIdentityHash: release.wrapperEntrypointDigest!,
        runtimeIdentityHash: release.runtimeEntrypointDigest,
        gatewayIdentityHash: hash("gateway"),
        protocolVersion: "review_action_v2",
        schemaDigest: release.schemaDigest,
        protocolLimitsProfileId: release.protocolLimitsProfileId,
        providerInstanceId: `hosted-pool:repository:${githubRepositoryId}`,
        repositoryBindingId: ids.binding,
        bindingRevision: 1,
        bindingActive: true,
        repositorySelected: true,
        poolId: ids.pool,
        poolActive: true,
        poolAuthzEpoch: 1n,
        runtimeGateActive: true,
        runtimeAuthzEpoch: runtimeGateEpoch,
        model: "codex",
        policyFingerprint: hostedV4RelayCanaryPolicyFingerprint({
          accountId: ids.account,
          runtimeConfigVersion: 1,
          model: "codex",
          maxRequests: 1,
          maxRequestBytes: 1_000,
          maxResponseBytes: 2_000,
          maxOutputTokens: 100,
        }),
        investigationId: seed.investigationId,
        investigationVersion: 2n,
        turnId: ids.turn,
        turnBudgetCanonicalJson,
        turnBudgetHash,
        turnPurpose: "discovery",
        planningInputDossierDigest: seed.dossierDigest,
        dossierDigest: seed.dossierDigest,
        investigationManifestHash,
        executionId: seed.executionId,
        workSlotId: seed.workSlotId,
        providerVoteLaneId: seed.providerVoteLaneId,
        providerStrategyId: seed.providerStrategyId,
        attemptId: investigationLease.attemptId,
        investigationLease: {
          leaseId: investigationLease.leaseId,
          capabilityId: investigationLease.leaseCapabilityId,
          ownerIdHash: investigationLease.ownerIdHash,
          fencingToken: investigationLease.fencingToken,
          purpose: "relay_turn",
          expiresAt: investigationLeaseExpiry,
        },
        invocationLease: {
          leaseId: invocationLease.leaseId,
          capabilityId: invocationLease.leaseCapabilityId,
          ownerIdHash: invocationLease.ownerIdHash,
          fencingToken: invocationLease.fencingToken,
          purpose: "provider_execution",
          attemptId: invocationLease.attemptId,
          providerInvocationKey: invocationLease.providerInvocationKey,
          expiresAt: invocationLeaseExpiry,
        },
        authorizationExpiresAt: authorizationExpiry,
        turnExpiresAt: turnExpiry,
        policyExpiresAt: policyExpiry,
      };
      const contract = defineHostedV4RelayGrant({
        scope,
        now,
        maxRequests: 1,
        maxRequestBytes: 1_000,
        maxResponseBytes: 2_000,
        maxOutputTokens: 100,
      });
      const grantInput = {
        contract,
        capabilityTokenHash: hash(`bearer-${suffix}`),
        accountId: ids.account,
        credentialGeneration: 1n,
        runtimeConfigVersion: 1,
      };
      const body = new TextEncoder().encode(
        '{"model":"codex","max_output_tokens":100}',
      );
      const requestInput = {
        contract,
        grantId: `v4-grant-${contract.logicalTurnKey}`,
        idempotencyKey: `same-${suffix}`,
        ordinal: 1 as const,
        body,
        accountId: ids.account,
        credentialGeneration: 1n,
        ownerIdHash: hash(`effect-owner-${suffix}`),
      };

      const previousEnabled = process.env.REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED;
      const previousRepository =
        process.env.REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID;
      process.env.REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED = "1";
      process.env.REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID =
        scope.githubRepositoryId;
      try {
        const first = new PrismaHostedV4RelayTurn(runtime);
        const grant = await first.reserveGrant(grantInput);
        expect(grant).toEqual({
          status: "issued",
          grantId: requestInput.grantId,
        });
        expect(await first.reserveGrant(grantInput)).toEqual({
          status: "restored",
          grantId: grant.grantId,
        });
        const expiryFixtures = [
          ["HostedCodexV4RelayTurn", "logicalTurnKey", contract.logicalTurnKey],
          ["ReviewInvestigationTurn", "turnId", ids.turn],
          ["ReviewRunAuthorization", "authorizationId", authorizationId],
          ["ReviewInvestigationLease", "leaseId", ids.investigationLease],
          ["ReviewInvocationLeaseV2", "leaseId", ids.invocationLease],
        ] as const;
        // Only trusted, disposable fixture setup changes immutable expiry
        // facts. Trigger suppression is transaction-local on the setup backend
        // and restored before the authenticated API backend exercises them.
        const setFixtureExpiry = async (
          fixture: (typeof expiryFixtures)[number],
          expired: boolean,
        ) => {
          requireDisposableUrls();
          const [table, key, value] = fixture;
          await setup.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(
              "SET LOCAL session_replication_role = replica",
            );
            const expiry = expired
              ? new Date(Date.now() - 30_000)
              : table === "HostedCodexV4RelayTurn"
                ? contract.expiresAt
                : table === "ReviewInvestigationTurn"
                  ? turnExpiry
                  : table === "ReviewRunAuthorization"
                    ? authorizationExpiry
                    : table === "ReviewInvestigationLease"
                      ? investigationLeaseExpiry
                      : invocationLeaseExpiry;
            const older = new Date(Date.now() - 120_000);
            const dates =
              table === "ReviewRunAuthorization"
                ? Prisma.sql`, "createdAt" = ${older}`
                : table === "ReviewInvestigationLease" ||
                    table === "ReviewInvocationLeaseV2"
                  ? Prisma.sql`, "acquiredAt" = ${older}, "renewedAt" = ${older}`
                  : Prisma.empty;
            expect(
              await tx.$executeRaw(Prisma.sql`
              UPDATE ${Prisma.raw(`public."${table}"`)}
              SET "expiresAt" = ${expiry} ${dates}
              WHERE ${Prisma.raw(`"${key}"`)} = ${value}
            `),
            ).toBe(1);
          });
        };
        const assertNoReservation = async () => {
          expect(
            await setup.hostedCodexInvocationGrant.findUniqueOrThrow({
              where: { id: grant.grantId },
              select: { status: true, requestCount: true, inFlight: true },
            }),
          ).toEqual({ status: "issued", requestCount: 0, inFlight: 0 });
          expect(
            await setup.hostedCodexRelayRequest.count({
              where: { grantId: grant.grantId },
            }),
          ).toBe(0);
          expect(
            await setup.hostedCodexUpstreamEffectAttempt.count({
              where: { grantId: grant.grantId },
            }),
          ).toBe(0);
        };
        for (const zone of ["Europe/Berlin", "America/Los_Angeles"]) {
          for (const fixture of expiryFixtures) {
            await setFixtureExpiry(fixture, true);
            try {
              // Bypass application prevalidation, not DB admission. Both
              // BEFORE INSERT triggers run on the real API connection.
              await expect(
                runtime.$transaction(async (tx) => {
                  await tx.$executeRaw(
                    Prisma.sql`SELECT set_config('TimeZone', ${zone}, true)`,
                  );
                  await tx.hostedCodexRelayRequest.create({
                    data: {
                      id: randomUUID(),
                      authorityKind: "v4_relay_turn",
                      grantId: grant.grantId,
                      ordinal: 1,
                      idempotencyKeyHash: hash(`expired-${fixture[0]}-${zone}`),
                      requestHash: hash(body),
                      requestBytes: body.byteLength,
                      status: "received",
                    },
                  });
                }),
              ).rejects.toThrow(
                fixture[0] === "HostedCodexV4RelayTurn"
                  ? "hosted_v4_relay_grant_turn_denied"
                  : "hosted_v4_relay_request_reservation_denied",
              );
              await assertNoReservation();
            } finally {
              await setFixtureExpiry(fixture, false);
            }
          }
        }
        await runtime.$executeRawUnsafe("SET timezone = 'Europe/Berlin'");
        const prepared = await first.reservePreparedRequest(requestInput);
        expect(prepared).toMatchObject({
          status: "prepared",
          grantId: grant.grantId,
          ordinal: 1,
          requestHash: hash(body),
        });
        expect(prepared.requestId).toBeTruthy();
        expect(prepared.effectId).toBeTruthy();
        expect(
          await runtime.$queryRaw<Array<{ zone: string }>>(
            Prisma.sql`SELECT current_setting('TimeZone') AS zone`,
          ),
        ).toEqual([{ zone: "Europe/Berlin" }]);

        // Reopen a separate Prisma object to prove restoration is durable.
        const restarted = createPrismaClient({
          databaseUrl: requireDisposableUrls().runtime,
          poolMax: 1,
        });
        try {
          await assertRuntimeAuthority(restarted);
          const second = new PrismaHostedV4RelayTurn(restarted);
          expect(await second.reservePreparedRequest(requestInput)).toEqual({
            ...prepared,
            status: "restored",
          });
          await expect(
            second.reservePreparedRequest({
              ...requestInput,
              idempotencyKey: `different-${suffix}`,
            }),
          ).rejects.toThrow("hosted_v4_relay_request_conflict");
          await expect(
            second.reservePreparedRequest({
              ...requestInput,
              body: new TextEncoder().encode(
                '{"model":"codex","max_output_tokens":99}',
              ),
            }),
          ).rejects.toThrow("hosted_v4_relay_request_conflict");
          expect(await second.reserveGrant(grantInput)).toEqual({
            status: "recovery_required",
            grantId: grant.grantId,
          });
        } finally {
          await restarted.$disconnect();
        }

        const [grants, requests, effects] = await Promise.all([
          setup.hostedCodexInvocationGrant.findMany({
            where: { v4TurnKey: contract.logicalTurnKey },
          }),
          setup.hostedCodexRelayRequest.findMany({
            where: { grantId: grant.grantId },
          }),
          setup.hostedCodexUpstreamEffectAttempt.findMany({
            where: { grantId: grant.grantId },
          }),
        ]);
        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({
          id: grant.grantId,
          status: "exhausted",
          requestCount: 1,
          inFlight: 1,
          maxRequests: 1,
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
          id: prepared.requestId,
          grantId: grant.grantId,
          ordinal: 1,
          status: "received",
          requestHash: prepared.requestHash,
          requestBytes: body.byteLength,
        });
        expect(requests[0]?.requestHash).toMatch(/^[a-f0-9]{64}$/);
        expect(effects).toHaveLength(1);
        expect(effects[0]).toMatchObject({
          id: prepared.effectId,
          relayRequestId: prepared.requestId,
          state: "prepared",
          requestHash: prepared.requestHash,
          credentialGeneration: 1n,
        });
        expect(effects[0]?.dispatchStartedAt).toBeNull();
        await expect(
          runtime.hostedCodexUpstreamEffectAttempt.update({
            where: { id: prepared.effectId },
            data: { state: "dispatching", dispatchStartedAt: new Date() },
          }),
        ).rejects.toThrow("hosted_v4_relay_paid_dispatch_unqualified");
        expect(
          (
            await setup.hostedCodexUpstreamEffectAttempt.findUniqueOrThrow({
              where: { id: prepared.effectId },
            })
          ).state,
        ).toBe("prepared");
      } finally {
        if (previousEnabled === undefined)
          delete process.env.REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED;
        else
          process.env.REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED = previousEnabled;
        if (previousRepository === undefined)
          delete process.env.REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID;
        else
          process.env.REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID =
            previousRepository;
      }
    }, 60_000);
  },
);

it("rejects synthetic API ownership of an exercised effect relation before fixture writes", () => {
  const stock = [
    ...protectedRelations.map((name) => ({
      kind: "relation",
      name,
      owner: "reviewrouter_release_schema_owner",
    })),
    ...protectedRoutines.map((name) => ({
      kind: "routine",
      name,
      owner: "reviewrouter_release_schema_owner",
    })),
  ];
  expect(() =>
    assertReleaseOwnership([
      ...stock,
      {
        kind: "relation",
        name: "CertifiedForkReceipt",
        owner: "reviewrouter_certified_fork_owner",
      },
      {
        kind: "routine",
        name: "certified_fork_fact_guard",
        owner: "reviewrouter_certified_fork_fact_owner",
      },
    ]),
  ).not.toThrow();
  const effect = stock.find(
    ({ kind, name }) =>
      kind === "relation" && name === "HostedCodexUpstreamEffectAttempt",
  );
  expect(effect).toBeDefined();
  effect!.owner = "reviewrouter_api";
  expect(() => assertReleaseOwnership(stock)).toThrow(
    "relation:HostedCodexUpstreamEffectAttempt owned by reviewrouter_api",
  );
});

it("rejects API ownership of the routine that debits a relay request", () => {
  const stock: OwnedObject[] = [
    ...protectedRelations.map((name) => ({
      kind: "relation",
      name,
      owner: "reviewrouter_release_schema_owner",
    })),
    ...protectedRoutines
      .filter((name) => name !== "hosted_codex_relay_admission_guard")
      .map((name) => ({
        kind: "routine",
        name,
        owner: "reviewrouter_release_schema_owner",
      })),
  ];
  const debit = {
    kind: "routine",
    name: "hosted_codex_relay_admission_guard",
    owner: "reviewrouter_release_schema_owner",
  };
  expect(() => assertReleaseOwnership([...stock, debit])).not.toThrow();
  debit.owner = "reviewrouter_api";
  expect(() => assertReleaseOwnership([...stock, debit])).toThrow(
    "routine:hosted_codex_relay_admission_guard owned by reviewrouter_api",
  );
});

describe.skipIf(!runDisposablePg17 || !ownershipNegative)(
  "hosted v4 PG17 ownership negative qualification",
  () => {
    it("rejects an API-owned effect table before any fixture write", async () => {
      const urls = requireDisposableUrls();
      const setup = createPrismaClient({ databaseUrl: urls.setup });
      const runtime = createPrismaClient({
        databaseUrl: urls.runtime,
        poolMax: 1,
      });
      try {
        const [server] = await setup.$queryRaw<
          Array<{
            version: number;
            database: string;
            lastMigration: string;
          }>
        >(Prisma.sql`
          SELECT current_setting('server_version_num')::integer AS version,
            current_database() AS database,
            (SELECT max(migration_name) FROM public._prisma_migrations
             WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)
              AS "lastMigration"
        `);
        expect(server?.version).toBeGreaterThanOrEqual(170000);
        expect(server?.version).toBeLessThan(180000);
        expect(server?.database).toContain(marker);
        expect(server?.lastMigration).toBe("000116_hosted_v4_fenced_dispatch");

        const [owner] = await setup.$queryRaw<Array<{ name: string }>>(
          Prisma.sql`
            SELECT pg_catalog.pg_get_userbyid(relation.relowner) AS name
            FROM pg_catalog.pg_class relation
            JOIN pg_catalog.pg_namespace namespace
              ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relname = 'HostedCodexUpstreamEffectAttempt'
          `,
        );
        expect(owner?.name).toBe("reviewrouter_api");

        const countRows = () =>
          setup.$queryRaw<
            Array<{
              workspaces: bigint;
              grants: bigint;
              requests: bigint;
              effects: bigint;
            }>
          >(Prisma.sql`
          SELECT (SELECT count(*) FROM public."Workspace")::bigint AS workspaces,
            (SELECT count(*) FROM public."HostedCodexInvocationGrant")::bigint AS grants,
            (SELECT count(*) FROM public."HostedCodexRelayRequest")::bigint AS requests,
            (SELECT count(*) FROM public."HostedCodexUpstreamEffectAttempt")::bigint AS effects
        `);
        const before = await countRows();
        expect(before).toEqual([
          {
            workspaces: 0n,
            grants: 0n,
            requests: 0n,
            effects: 0n,
          },
        ]);
        await expect(assertRuntimeAuthority(runtime)).rejects.toThrow(
          "relation:HostedCodexUpstreamEffectAttempt owned by reviewrouter_api",
        );
        expect(await countRows()).toEqual(before);
      } finally {
        await runtime.$disconnect();
        await setup.$disconnect();
      }
    });
  },
);
