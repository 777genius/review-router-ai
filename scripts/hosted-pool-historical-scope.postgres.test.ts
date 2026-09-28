import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../packages/platform/db/src/index";
import { collectAuthenticatedPoolRows } from "./hosted-pool-historical-scope-pool-helper";
import { HostedHistoricalScopeDeniedError, PrismaHostedHistoricalScopeBarrier } from "../packages/features/hosted-account-pool/src/infrastructure/prisma/prisma-hosted-historical-scope-barrier";
import { JoseGitHubActionsOidcTokenVerifier, PrismaActionOidcReplayNonceStore } from "../packages/features/action-control-plane/src/index";
import { canonicalJson } from "../packages/features/review-run-control/src/index";
import { parseReviewConfiguration } from "../packages/features/review-config/src/domain/review-configuration";
import {
  PrismaHostedAccountRepository, PrismaHostedPoolBindingRepository,
  PrismaHostedPoolRepository, PrismaInvocationGrantRepository,
  FetchHostedCodexStreamingRelay, PrismaHostedCodexRelayAuthorization,
  PrismaHostedCodexUpstreamEffectLedger,
  HostedCommentTokenMintProtocol, PrismaHostedCommentTokenMintLedger,
  hostedCommentTokenDelivery,
  type HostedCodexSessionRuntime, type HostedCommentTokenPreparedSecretVaultPort,
} from "../packages/features/hosted-account-pool/src/index";
import {
  hostedPoolWorkflowSchemaVersion, hostedPoolWorkflowSemanticSha256,
  renderCanonicalHostedPoolWorkflowV2, scanCanonicalHostedPoolWorkflowV2,
} from "../packages/features/workflow-provisioning/src/index";
import { createProductionHostedCodexGrantIssuer, HostedCodexGrantIssuer, HmacHostedCodexCapabilityIssuer } from "../apps/api/src/hosted-codex-grant-composition";
import { PrismaHostedCodexGrantAdmission } from "../apps/api/src/prisma-hosted-codex-grant-admission";

const url = process.env.REVIEW_ROUTER_HISTORICAL_SCOPE_PG17_URL;
const raceOrder = process.env.REVIEW_ROUTER_HISTORICAL_SCOPE_RACE_ORDER ?? "marker_first";
if (!["marker_first", "gate_first", "stale_snapshot", "grant_first", "import_first", "stale_activation", "alias_marker", "member_marker"].includes(raceOrder))
  throw new Error("historical_scope_race_order_invalid");
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) ||
      !/^\/reviewrouter_historical_scope_[a-z0-9_]+$/u.test(parsed.pathname) ||
      parsed.search || parsed.hash)
    throw new Error("historical_scope_disposable_loopback_pg17_required");
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
function restrictedUrl(role: "reviewrouter_api" | "reviewrouter_comment_token_custody", explicit?: string): string | undefined {
  if (!url) return undefined;
  const setup = new URL(url);
  if (!explicit && setup.password)
    throw new Error(`historical_scope_${role}_direct_login_url_required`);
  const result = new URL(explicit ?? url);
  if (!explicit) result.username = role;
  if (result.username !== role || result.hostname !== setup.hostname ||
      result.port !== setup.port || result.pathname !== setup.pathname ||
      result.search || result.hash || result.protocol !== setup.protocol)
    throw new Error(`historical_scope_${role}_disposable_direct_login_required`);
  return result.toString();
}
const digestFields = [
  "id", "githubRepositoryId", "pullRequestNumber", "headSha", "providerFamily",
  "sourceWorkspaceId", "sourceRepositoryConnectionId", "sourceScmRepositoryIdentityId",
  "sourceBaseSha", "sourceMergeBaseSha", "sourceReviewRevisionHash",
  "sourceProviderInstanceId", "sourceRunId", "sourceRunAttempt", "sourceWorkflowRef",
  "sourceBindingId", "sourceBindingRevision", "sourceRuntimeAuthzEpoch",
  "sourceDatabaseIncarnation", "sourceRelayId", "sourceAttemptId", "cohort", "receiptDigest",
] as const;
function pgJsonbArray(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pgJsonbArray).join(", ")}]`;
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "string" || typeof value === "number" || value === null) {
    const encoded = JSON.stringify(value);
    if (encoded !== undefined) return encoded;
  }
  throw new Error("unsupported_historical_digest_vector_value");
}
const byteOrder = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const db = createPrismaClient({ databaseUrl: url ?? "postgresql://unused@127.0.0.1:1/unused", poolMax: 5 });
const apiDb = createPrismaClient({ databaseUrl: restrictedUrl("reviewrouter_api",
  process.env.REVIEW_ROUTER_HISTORICAL_SCOPE_API_PG17_URL) ?? "postgresql://unused@127.0.0.1:1/unused", poolMax: 3 });
const custodyDb = createPrismaClient({ databaseUrl: restrictedUrl("reviewrouter_comment_token_custody",
  process.env.REVIEW_ROUTER_HISTORICAL_SCOPE_CUSTODY_PG17_URL) ?? "postgresql://unused@127.0.0.1:1/unused", poolMax: 2 });
async function assertAuthenticatedPool(client: typeof apiDb, role: string, size: number): Promise<void> {
  // Hold all connections simultaneously: a role switch on one setup backend
  // cannot masquerade as directly authenticated pool-wide runtime identity.
  const { rows, arrived } = await collectAuthenticatedPoolRows(size, (arrive) =>
    client.$transaction(async (tx) => {
      const identity = await tx.$queryRaw<Array<{
        sessionUser: string; currentUser: string; databaseName: string; pid: number;
      }>>`SELECT session_user AS "sessionUser", current_user AS "currentUser",
        current_database() AS "databaseName", pg_catalog.pg_backend_pid() AS "pid"`;
      await arrive();
      return identity[0];
    }));
  expect(arrived).toBe(size);
  expect(new Set(rows.map((row) => row?.pid)).size).toBe(size);
  expect(rows.every((row) => row?.sessionUser === role && row.currentUser === role &&
    row.databaseName === new URL(url!).pathname.slice(1))).toBe(true);
}
const resource = "historical-synthetic-resource";
const incarnation = "historical-synthetic-incarnation";
const receipt = sha("synthetic-unaccepted-receipt-fixture");
const archive = sha("synthetic-unaccepted-archive-fixture");
const oldHead = "a".repeat(40);
const newHead = "b".repeat(40);
const now = new Date();
const actionSha = "e".repeat(40);
const workflow = renderCanonicalHostedPoolWorkflowV2({
  actionRef: `777genius/review-router@${actionSha}`,
  apiUrl: "https://api.synthetic.example",
  providerInstanceId: "hosted-pool:repository:700002",
  bindingId: "hs-binding", bindingRevision: 2,
});
const workflowScan = scanCanonicalHostedPoolWorkflowV2(workflow);
if (!workflowScan.valid) throw new Error(`historical_fixture_workflow_invalid:${workflowScan.errors.join(",")}`);
const syntheticConfigurationVersion = {
  version: 1, providerKind: "codex", providerAuthMode: "codex_subscription_oauth_hosted_pool",
  model: "gpt-5.5", reasoningEffort: "high", failOnSeverity: "major",
  inlineMaxComments: 10, targetTokensPerBatch: 50000,
} as const;
// Validate the fixture against the same stock configuration schema used by
// hosted admission before any disposable database setup or barrier assertion.
parseReviewConfiguration({
  schemaVersion: 2,
  providers: [{ kind: syntheticConfigurationVersion.providerKind,
    authMode: syntheticConfigurationVersion.providerAuthMode,
    model: syntheticConfigurationVersion.model,
    reasoningEffort: syntheticConfigurationVersion.reasoningEffort }],
  execution: { providerLimit: 1, providerMaxParallel: 1, inlineMinAgreement: 1 },
  blockingPolicy: { failOnSeverity: syntheticConfigurationVersion.failOnSeverity },
  limits: { inlineMaxComments: syntheticConfigurationVersion.inlineMaxComments,
    targetTokensPerBatch: syntheticConfigurationVersion.targetTokensPerBatch },
});

async function waitForBackendLock(applicationName: string, holderPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<Array<{ waiting: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_stat_activity
        WHERE application_name = ${applicationName} AND wait_event_type = 'Lock'
          AND pg_catalog.array_position(pg_catalog.pg_blocking_pids(pid), ${holderPid}::integer) IS NOT NULL
      ) AS waiting`;
    if (rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`historical_expected_database_lock_wait_missing:${applicationName}`);
}

function awaitTransactionStart<T>(started: Promise<T>, transaction: Promise<unknown>): Promise<T> {
  return Promise.race([started, transaction.then(
    () => { throw new Error("historical_transaction_ended_before_start"); },
    (error: unknown) => { throw error; },
  )]);
}

async function intent(id: string, headSha: string, run: string, repo = "hs-repo", workspace = "hs-workspace", attempt = "2") {
  await db.reviewRequestedIntent.create({ data: {
    requestId: id, workspaceId: workspace, repositoryConnectionId: repo,
    scmRepositoryIdentityId: repo === "other-repo" ? "other-scm" : "hs-scm", pullRequestNumber: 42,
    baseSha: "c".repeat(40), mergeBaseSha: "d".repeat(40), headSha,
    reviewRevisionHash: sha(canonicalJson({ workspaceId: workspace, repositoryConnectionId: repo,
      scmRepositoryIdentityId: repo === "other-repo" ? "other-scm" : "hs-scm",
      pullRequestNumber: 42, baseSha: "c".repeat(40), mergeBaseSha: "d".repeat(40), headSha })),
    triggerKind: "pull_request_synchronized",
    deliveryIdentityHash: sha(`delivery:${id}`), canonicalRequestHash: sha(`canonical:${id}`),
    state: "awaiting_authorization", notBefore: now,
    submissionStartedAt: now, nextResolutionAt: now,
    resolutionDeadlineAt: new Date(now.getTime() + 1_800_000), admissionState: "admitted",
    admissionChangedLines: 0, admissionMaxChangedLines: 100,
    admissionPolicySnapshotId: "synthetic", admissionDecisionHash: sha(`decision:${id}`),
    admissionCheckedAt: now, sourceRunId: run, sourceRunAttempt: attempt,
    createdAt: now, updatedAt: now, retainUntil: new Date(now.getTime() + 86_400_000),
  } });
}

function grant(id: string, reviewRequestId: string, runId: string, runAttempt = 2) {
  return {
    id, invocationId: `invocation-${id}`, workspaceId: "hs-workspace", poolId: "hs-pool",
    repositoryConnectionId: "hs-repo", repositoryBindingId: "hs-binding",
    activeAccountId: "hs-account", primaryAccountId: "hs-account",
    reviewRequestId, providerInvocationKey: sha(`provider:${id}`), runId, runAttempt,
    model: "gpt-5.5", policyVersion: "hosted-codex-v1", policyFingerprint: sha(id),
    runtimeConfigVersion: 7, bindingRevision: 2n, authzEpoch: 1n,
    capabilityTokenHash: sha(`capability:${id}`),
    issuedAt: now, expiresAt: new Date(now.getTime() + 600_000),
    maxRequests: 2, maxConcurrentRequests: 1, maxRequestBytes: 1024,
    maxResponseBytes: 1024, maxOutputTokens: 256,
  };
}

beforeAll(async () => {
  if (!url) return;
  await db.$connect();
  const version = await db.$queryRaw<Array<{ version: string }>>`SELECT current_setting('server_version_num') AS "version"`;
  if (!version[0]?.version.startsWith("17")) throw new Error("historical_scope_pg17_required");
  const gate = await db.hostedCodexRuntimeGate.findUniqueOrThrow({ where: { id: "global" } });
  if (gate.status !== "closed") throw new Error("historical_scope_fresh_closed_database_required");
  if (await db.workspace.count() !== 0) throw new Error("historical_scope_empty_database_required");
  // Match the existing disposable PG fixture bootstrap: migration 000083
  // quarantines the initial closure for 61 minutes. Bypass its trigger only
  // before creating any fixture authority or effect, then test subsequent
  // closure and gate transitions with every database guard active.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = 'replica'`;
    await tx.hostedCodexRuntimeClosure.update({ where: { gateRevision: gate.revision }, data: {
      state: "complete", completedAt: new Date(), legacyBarrier: false,
      legacyUnsafeUntil: new Date(0), revision: { increment: 1 },
    } });
  });
  await db.workspace.create({ data: { id: "hs-workspace", slug: "historical-scope", name: "Historical scope" } });
  await db.gitHubInstallation.create({ data: { id: "hs-install", workspaceId: "hs-workspace", githubInstallationId: 700001n,
    accountLogin: "synthetic", accountType: "Organization", repositorySelection: "selected", status: "active" } });
  await db.scmRepositoryIdentity.create({ data: { scmRepositoryIdentityId: "hs-scm", provider: "github",
    normalizedSourceBaseUrl: "https://github.com", externalRepositoryId: "700002", createdAt: now } });
  await db.repositoryConnection.create({ data: { id: "hs-repo", workspaceId: "hs-workspace", provider: "github",
    externalRepositoryId: "700002", scmRepositoryIdentityId: "hs-scm", installationId: "hs-install",
    githubRepositoryId: 700002n, owner: "synthetic", name: "repo", fullName: "synthetic/repo",
    defaultBranch: "main", visibility: "private", selected: true } });
  await db.hostedCodexPool.create({ data: { id: "hs-pool", workspaceId: "hs-workspace", name: "synthetic", status: "active", isDefault: true } });
  await db.hostedCodexAccount.create({ data: { id: "hs-account", workspaceId: "hs-workspace", poolId: "hs-pool",
    label: "synthetic", accountFingerprint: sha("account"), state: "provisioning_pending" } });
  await db.hostedCodexCredentialVersion.create({ data: { id: "hs-credential", workspaceId: "hs-workspace",
    poolId: "hs-pool", accountId: "hs-account", generation: 1n, databaseIncarnation: incarnation,
    envelopeVersion: 1, encryptionAlgorithm: "synthetic-no-runtime-use", keyId: "synthetic-key",
    aadHash: sha("aad"), generationHash: sha("generation"), ciphertextHash: sha("ciphertext"),
    encryptedCiphertext: "synthetic-nonsecret", envelopeMetadata: { fixture: true },
    createdAt: now } });
  await db.hostedCodexAccount.update({ where: { id: "hs-account" }, data: {
    state: "healthy", activeGeneration: 1n, healthVersion: 1n, lastHealthyAt: now,
  } });
  await db.hostedCodexRepositoryBinding.create({ data: { id: "hs-binding", workspaceId: "hs-workspace",
    poolId: "hs-pool", repositoryConnectionId: "hs-repo", status: "active", revision: 2n,
    stateVersion: 1n, workflowPath: ".github/workflows/reviewrouter-codex.yml",
    workflowActionRef: `777genius/review-router@${actionSha}`,
    workflowSourceCommitSha: oldHead, workflowSourceBlobSha: "f".repeat(40),
    workflowSourceSha256: sha(workflow), workflowSemanticSha256: hostedPoolWorkflowSemanticSha256(workflow),
    workflowSourceTrust: "trusted_default_branch_revision", attestedGithubRepositoryId: 700002n,
    attestedBindingRevision: 2n, activatedAt: now } });
  await intent("old-intent", oldHead, "old-run");
  await intent("new-attempt-intent", oldHead, "new-run");
  await intent("mint-denied-old-head-intent", oldHead, "mint-denied-run");
  await intent("new-head-intent", newHead, "truly-new-run");
  await intent("aliased-new-head-intent", newHead, "old-run", "hs-repo", "hs-workspace", "3");
  await intent("external-old-review-request", newHead, "review-alias-run");
  await db.reviewConfiguration.create({ data: { id: "hs-config", workspaceId: "hs-workspace",
    repositoryId: "hs-repo", targetKey: "repo:hs-repo", versions: { create: {
      ...syntheticConfigurationVersion,
    } } } });
  await db.workspace.create({ data: { id: "other-workspace", slug: "historical-other", name: "Other tenant" } });
  await db.scmRepositoryIdentity.create({ data: { scmRepositoryIdentityId: "other-scm", provider: "github",
    normalizedSourceBaseUrl: "https://github.com", externalRepositoryId: "700003", createdAt: now } });
  await db.repositoryConnection.create({ data: { id: "other-repo", workspaceId: "other-workspace", provider: "github",
    externalRepositoryId: "700003", scmRepositoryIdentityId: "other-scm", githubRepositoryId: 700003n, owner: "other", name: "repo",
    fullName: "other/repo", defaultBranch: "main", visibility: "private", selected: true } });
  await intent("other-tenant-intent", oldHead, "other-run", "other-repo", "other-workspace");
  await intent("other-tenant-new-head", newHead, "other-new-run", "other-repo", "other-workspace");
}, 120_000);
afterAll(async () => { if (url) await Promise.all([db.$disconnect(), apiDb.$disconnect(), custodyDb.$disconnect()]); });

describe.skipIf(!url)("historical-scope barrier on a migrated disposable PG17 database", () => {
  it("serializes exact-set completion and rejects fresh grants for the old trusted head", async () => {
    await assertAuthenticatedPool(apiDb, "reviewrouter_api", 3);
    await assertAuthenticatedPool(custodyDb, "reviewrouter_comment_token_custody", 2);
    const restrictedRoles = await db.$queryRaw<Array<{
      roleName: string; canLogin: boolean; superuser: boolean; createRole: boolean;
      createDb: boolean; replication: boolean; bypassRls: boolean;
      canSetOwner: boolean; canSetSetup: boolean; canSetOtherRuntime: boolean;
      memberOwner: boolean; memberSetup: boolean; memberOtherRuntime: boolean;
    }>>`
      SELECT role.rolname AS "roleName", role.rolcanlogin AS "canLogin",
        role.rolsuper AS "superuser", role.rolcreaterole AS "createRole",
        role.rolcreatedb AS "createDb", role.rolreplication AS "replication",
        role.rolbypassrls AS "bypassRls",
        pg_catalog.pg_has_role(role.oid, 'reviewrouter_release_schema_owner'::pg_catalog.regrole::oid,
          'SET') AS "canSetOwner",
        pg_catalog.pg_has_role(role.oid, 'reviewrouter_release_schema_owner'::pg_catalog.regrole::oid,
          'MEMBER') AS "memberOwner",
        pg_catalog.pg_has_role(role.oid, (SELECT usesysid FROM pg_catalog.pg_user
          WHERE usename = session_user), 'SET') AS "canSetSetup",
        pg_catalog.pg_has_role(role.oid, (SELECT usesysid FROM pg_catalog.pg_user
          WHERE usename = session_user), 'MEMBER') AS "memberSetup",
        pg_catalog.pg_has_role(role.oid,
          CASE WHEN role.rolname = 'reviewrouter_api' THEN 'reviewrouter_comment_token_custody'
            ELSE 'reviewrouter_api' END::pg_catalog.regrole::oid, 'SET') AS "canSetOtherRuntime",
        pg_catalog.pg_has_role(role.oid,
          CASE WHEN role.rolname = 'reviewrouter_api' THEN 'reviewrouter_comment_token_custody'
            ELSE 'reviewrouter_api' END::pg_catalog.regrole::oid, 'MEMBER') AS "memberOtherRuntime"
      FROM pg_catalog.pg_roles role
      WHERE role.rolname IN ('reviewrouter_api', 'reviewrouter_comment_token_custody')
      ORDER BY role.rolname`;
    expect(restrictedRoles).toHaveLength(2);
    expect(restrictedRoles.every((role) => role.canLogin && !role.superuser && !role.createRole &&
      !role.createDb && !role.replication && !role.bypassRls && !role.canSetOwner &&
      !role.canSetSetup && !role.canSetOtherRuntime && !role.memberOwner &&
      !role.memberSetup && !role.memberOtherRuntime)).toBe(true);
    // Red on the old schema: a new run/attempt and binding authority can insert despite the old unknown scope.
    async function transition(status: "active" | "closed", reasonCode: string, offset: number) {
      return db.hostedCodexRuntimeGate.update({ where: { id: "global" }, data: {
        status, authzEpoch: { increment: 1 }, revision: { increment: 1 },
        reasonCode, changedAt: new Date(Date.now() + offset), changedByHash: sha("operator"),
      } });
    }
    await transition("active", "synthetic_source", 1_000);
    const oldGrant = grant("old-grant", "old-intent", "old-run");
    await db.hostedCodexInvocationGrant.create({ data: {
      ...oldGrant, maxConcurrentRequests: 2, runtimeAuthzEpoch: 2n,
      commentRefreshCapability: { create: {
        capabilityTokenHash: sha("old-refresh"), issuedAt: now, expiresAt: oldGrant.expiresAt,
        maxUses: 1, useCount: 0,
      } },
    } });
    await db.hostedCodexRelayRequest.create({ data: {
      id: "old-relay", grantId: "old-grant", ordinal: 1,
      idempotencyKeyHash: sha("old-relay-key"), requestBytes: 10,
    } });
    const capturedBody = Buffer.from('{"input":"synthetic"}');
    const captured = await new PrismaHostedCodexRelayAuthorization(db).authorize({
      opaqueGrant: "capability:old-grant", idempotencyKey: "captured-after-auth",
      requestOrdinal: 2, requestBytes: capturedBody.byteLength,
    });
    await db.hostedCodexRelayRequest.update({ where: { id: "old-relay" }, data: {
      status: "terminal_unknown", errorCode: "synthetic_response_lost", completedAt: new Date(),
    } });
    // Existing row-local guards allow a fresh run/attempt on the same head
    // while the destination projection is disabled. This is the baseline
    // bypass the active destination checkpoint must close.
    await db.hostedCodexInvocationGrant.create({ data: {
      ...grant("prebarrier-same-head", "new-attempt-intent", "new-run"),
      runtimeAuthzEpoch: 2n,
    } });
    expect(await db.hostedCodexInvocationGrant.count({ where: { id: "prebarrier-same-head" } })).toBe(1);
    // Empty policy must still admit an otherwise valid grant as the runtime
    // API identity after function ACL convergence.
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_api");
      const rows = await tx.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT public.hosted_historical_assert_grant(g) AS allowed
        FROM public."HostedCodexInvocationGrant" g WHERE g."id"='prebarrier-same-head'`;
      expect(rows[0]?.allowed).toBe(true);
    });
    let admittedHead = oldHead;
    let admittedRun = "new-run";
    let admittedJti = "historical-new-run-jti";
    const workflowReader = {
      readPullRequestAuthority: async () => ({ number: 42, state: "open" as const,
        baseRepositoryId: "700002", headRepositoryId: "700002", baseSha: "c".repeat(40),
        headSha: admittedHead, mergeCommitSha: null }),
      readMergeBaseSha: async () => "d".repeat(40),
      readWorkflowAtRevision: async (input: { revisionSha: string }) => ({
        commitSha: input.revisionSha, blobSha: "f".repeat(40), contents: workflow,
      }),
    };
    const oidcClaims = () => ({
      iss: "https://token.actions.githubusercontent.com" as const, aud: "reviewrouter",
      sub: "repo:synthetic/repo:pull_request", repository: "synthetic/repo",
      repository_id: "700002", repository_owner: "synthetic", repository_visibility: "private",
      event_name: "pull_request" as const, ref: "refs/pull/42/merge", run_id: admittedRun, run_attempt: "2",
      workflow_ref: "synthetic/repo/.github/workflows/reviewrouter-codex.yml@refs/pull/42/merge",
      workflow_sha: admittedHead,
      job_workflow_ref: `777genius/review-router/.github/workflows/reviewrouter-t0-reusable.yml@${actionSha}`,
      job_workflow_sha: actionSha, actor: "synthetic", jti: admittedJti,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const factoryMint = vi.fn(async () => { throw new Error("factory_comment_token_mint_reached"); });
    const factoryAllowedMint = vi.fn(async () => ({
      token: "synthetic-allowed-comment-token", expiresAt: new Date(Date.now() + 60_000),
      repository: "synthetic/repo", permissions: { contents: "read" as const,
        pullRequests: "write" as const, issues: "write" as const, statuses: "write" as const },
      custody: "acceptable" as const, [hostedCommentTokenDelivery]: async () => {},
    }));
    const factoryEnv = {
      REVIEW_ROUTER_HOSTED_CODEX_DATABASE_RESOURCE_IDENTITY: resource,
      REVIEW_ROUTER_HOSTED_CODEX_DATABASE_INCARNATION: incarnation,
      REVIEW_ROUTER_HOSTED_CODEX_CAPABILITY_HMAC_KEY: Buffer.alloc(32, 19).toString("base64"),
      REVIEW_ROUTER_ACTION_REF: `777genius/review-router@${actionSha}`,
      REVIEW_ROUTER_HOSTED_HISTORICAL_SCOPE_DESTINATION_REQUIRED: "1",
    };
    const issueThroughFactory = async (required: "0" | "1", oidcToken: string, allowMint = false,
      commentTokens?: Pick<HostedCommentTokenMintProtocol, "issueInitial">) => {
      const verify = vi.spyOn(JoseGitHubActionsOidcTokenVerifier.prototype, "verify")
        .mockImplementation(async () => oidcClaims());
      try {
        const issuer = createProductionHostedCodexGrantIssuer({
          prisma: apiDb, env: { ...factoryEnv,
            REVIEW_ROUTER_HOSTED_HISTORICAL_SCOPE_DESTINATION_REQUIRED: required },
          relayUrl: "https://api.synthetic.example/api/action/v1/hosted-codex/responses",
          workflowSources: workflowReader,
          commentTokens: commentTokens ?? { issueInitial: allowMint ? factoryAllowedMint : factoryMint },
        });
        return await issuer.issue({ oidcToken, providerInstanceId: "hosted-pool:repository:700002",
          workflowSchemaVersion: hostedPoolWorkflowSchemaVersion,
          bindingId: "hs-binding", bindingVersion: 2 });
      } finally {
        verify.mockRestore();
      }
    };
    // Red if the production factory omits destination-required enforcement:
    // absent policy otherwise reaches capability generation and token mint.
    const factoryCapabilities = vi.spyOn(HmacHostedCodexCapabilityIssuer.prototype, "issue");
    const beforeMissingPolicy = await db.hostedCodexInvocationGrant.count();
    await expect(issueThroughFactory("1", "factory-missing-policy"))
      .rejects.toThrow("hosted_historical_scope_denied");
    expect(factoryCapabilities).not.toHaveBeenCalled();
    expect(factoryMint).not.toHaveBeenCalled();
    expect(await db.hostedCodexInvocationGrant.count()).toBe(beforeMissingPolicy);
    factoryCapabilities.mockRestore();
    // Red if the restricted API cannot retain the ordinary disabled-policy
    // issuance path through the real repository lock and grant trigger.
    admittedJti = "historical-disabled-policy-positive-jti";
    await expect(issueThroughFactory("0", "factory-disabled-policy-positive", true))
      .resolves.toMatchObject({ protocolVersion: 1 });
    expect(factoryAllowedMint).toHaveBeenCalledOnce();
    expect(await db.hostedCodexInvocationGrant.count()).toBe(beforeMissingPolicy + 1);
    const oldBytes = await db.hostedCodexRelayRequest.findUniqueOrThrow({ where: { id: "old-relay" } });
    // Grant-first order: a valid admission holds the gate's share lock until
    // commit. Closing for import must observably wait, then the later deny
    // projection makes that pre-cutover grant unusable.
    const closedGate = raceOrder === "grant_first" ? await (async () => {
      let signalGrant!: (pid: number) => void;
      let releaseGrant!: () => void;
      const grantStarted = new Promise<number>((resolve) => { signalGrant = resolve; });
      const grantRelease = new Promise<void>((resolve) => { releaseGrant = resolve; });
      const admitting = apiDb.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string; authzEpoch: bigint }>>`
          SELECT "status", "authzEpoch" FROM public.hosted_historical_lock_runtime_gate()`;
        expect(locked).toEqual([{ status: "active", authzEpoch: 2n }]);
        await tx.hostedCodexInvocationGrant.create({ data: {
          ...grant("grant-first-race", "new-attempt-intent", "new-run"), runtimeAuthzEpoch: 2n,
        } });
        const holder = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_catalog.pg_backend_pid() AS pid`;
        signalGrant(holder[0]!.pid);
        await grantRelease;
      }, { timeout: 10_000 });
      const grantPid = await awaitTransactionStart(grantStarted, admitting);
      const closing = db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL application_name = 'historical_close_wait'`;
        return tx.hostedCodexRuntimeGate.update({ where: { id: "global" }, data: {
          status: "closed", authzEpoch: { increment: 1 }, revision: { increment: 1 },
          reasonCode: "synthetic_import_fence", changedAt: new Date(Date.now() + 2_000),
          changedByHash: sha("operator"),
        } });
      }, { timeout: 10_000 });
      try {
        await waitForBackendLock("historical_close_wait", grantPid);
      } finally {
        releaseGrant();
        await Promise.allSettled([admitting, closing]);
      }
      await admitting;
      return closing;
    })() : await transition("closed", "synthetic_import_fence", 2_000);
    await db.hostedCodexRuntimeClosure.create({ data: {
      id: `historical-closure-${closedGate.revision}`, gateRevision: closedGate.revision,
      closedAuthzEpoch: closedGate.authzEpoch, actorHash: sha("operator"),
      reasonHash: sha("synthetic_import_fence"), legacyBarrier: false,
      legacyUnsafeUntil: new Date(0),
    } });
    await db.hostedCodexRuntimeClosure.update({ where: { gateRevision: closedGate.revision }, data: {
      state: "complete", completedAt: new Date(), revision: { increment: 1 },
    } });
    const requiredBarrier = new PrismaHostedHistoricalScopeBarrier(db, {
      required: true, resourceIdentity: resource, incarnation,
    });
    // Red if destination-required admission treats an absent policy as disabled.
    await expect(requiredBarrier.assertAdmissionAllowed({
      workspaceId: "hs-workspace", repositoryConnectionId: "hs-repo",
      reviewRequestId: "new-attempt-intent", grantId: "missing-policy-grant",
      invocationId: "missing-policy-invocation", providerInvocationKey: sha("missing-policy"),
      runId: "new-run",
    })).rejects.toThrow("hosted_historical_scope_denied");
    // Imported attempt 1/binding 1 stays provenance; destination uses attempt 2/binding 2.
    await db.$executeRaw`INSERT INTO public."HostedHistoricalUnknownScope"
      ("id","githubRepositoryId","pullRequestNumber","headSha","providerFamily",
       "sourceWorkspaceId","sourceRepositoryConnectionId","sourceScmRepositoryIdentityId",
       "sourceBaseSha","sourceMergeBaseSha","sourceReviewRevisionHash","sourceProviderInstanceId",
       "sourceRunId","sourceRunAttempt","sourceWorkflowRef","sourceBindingId","sourceBindingRevision",
       "sourceRuntimeAuthzEpoch","sourceDatabaseIncarnation",
       "sourceRelayId","sourceAttemptId","cohort","receiptDigest")
      VALUES ('scope-old',700002,42,${oldHead},'codex_subscription_oauth_hosted_pool',
        'hs-workspace','hs-repo','hs-scm',${"c".repeat(40)},${"d".repeat(40)},
        ${sha(canonicalJson({ workspaceId: "hs-workspace", repositoryConnectionId: "hs-repo",
          scmRepositoryIdentityId: "hs-scm", pullRequestNumber: 42, baseSha: "c".repeat(40),
          mergeBaseSha: "d".repeat(40), headSha: oldHead }))},
        'hosted-pool:repository:700002','old-run','1',
        'synthetic/repo/.github/workflows/reviewrouter-codex.yml@refs/pull/42/merge',
        'hs-binding',1,2,${incarnation},
        'source-old-relay',NULL,'receipt_bound_orphan',${receipt})`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','review_request','old-intent')`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value") VALUES ('scope-old','review_request','external-old-review-request')`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','run','old-run')`;
    // Red if a runtime effect principal can act as the offline importer after
    // accidental INSERT drift. Roll the drift back even if the guard is absent.
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`GRANT USAGE ON SCHEMA public TO reviewrouter_codex_effect_authority`;
      await tx.$executeRaw`GRANT INSERT ON public."HostedHistoricalScopeAlias"
        TO reviewrouter_codex_effect_authority`;
      await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_codex_effect_authority");
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
        VALUES ('scope-old','run','effect-drift-probe')`;
      throw new Error("synthetic_effect_guard_bypass");
    })).rejects.toThrow("hosted_historical_offline_owner_required");
    // Two source relays may share a run. Preserve both membership edges.
    const originalDigest = await db.$queryRaw<Array<{ digest: string }>>`
      SELECT public.hosted_historical_set_digest() AS digest`;
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalUnknownScope"
        SELECT 'Scope-β', "githubRepositoryId", "pullRequestNumber", "headSha",
          "providerFamily", "sourceWorkspaceId", "sourceRepositoryConnectionId",
          "sourceScmRepositoryIdentityId", "sourceBaseSha", "sourceMergeBaseSha",
          "sourceReviewRevisionHash", "sourceProviderInstanceId", "sourceRunId",
          '', "sourceWorkflowRef", "sourceBindingId", "sourceBindingRevision",
          9007199254740993::bigint, NULL, 'source-second-relay',
          'source-second-attempt', 'unknown_attempt', "receiptDigest"
        FROM public."HostedHistoricalUnknownScope" WHERE "id"='scope-old'`;
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
        VALUES ('Scope-β','run','old-run')`;
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
        VALUES ('Scope-β','invocation',${'comma,"slash\\line\n'})`;
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
        VALUES ('Scope-β','workflow_source','')`;
      const edges = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM public."HostedHistoricalScopeAlias"
        WHERE "kind"='run' AND "value"='old-run'`;
      expect(edges[0]?.count).toBe(2n);
      const changed = await tx.$queryRaw<Array<{ digest: string }>>`
        SELECT public.hosted_historical_set_digest() AS digest`;
      expect(changed[0]?.digest).not.toBe(originalDigest[0]?.digest);
      // Independent bytes catch collation, null/empty, escaping, aliases and bigint drift.
      const scopes = await tx.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM public."HostedHistoricalUnknownScope"`;
      const aliases = await tx.$queryRaw<Array<{ scopeId: string; kind: string; value: string }>>`
        SELECT "scopeId", "kind", "value" FROM public."HostedHistoricalScopeAlias"`;
      const vector = scopes.sort((a, b) => byteOrder(String(a.id), String(b.id)))
        .map((scope) => pgJsonbArray([
          ...digestFields.map((field) => scope[field]),
          aliases.filter((alias) => alias.scopeId === scope.id)
            .sort((a, b) => byteOrder(a.kind, b.kind) || byteOrder(a.value, b.value))
            .map((alias) => [alias.kind, alias.value]),
        ])).join("\n");
      expect(changed[0]?.digest).toBe(sha(vector));
      throw new Error("synthetic_shared_alias_rollback");
    })).rejects.toThrow("synthetic_shared_alias_rollback");
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','grant','external-old-grant')`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','invocation','external-old-invocation')`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','provider_invocation',${sha("external-old-provider-invocation")})`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','workflow_source','synthetic/repo/.github/workflows/reviewrouter-codex.yml@refs/pull/42/merge')`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','relay_request','external-old-request')`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','attempt','external-old-attempt')`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','grant_capability',${sha("external-old-capability")})`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','refresh_capability',${sha("external-old-refresh")})`;
    // A second tenant's paired unknown uses different local IDs and its external repository key.
    await db.$executeRaw`INSERT INTO public."HostedHistoricalUnknownScope"
      SELECT 'scope-other', 700003, "pullRequestNumber", "headSha", "providerFamily",
        'source-other-workspace', 'source-other-repository', 'source-other-scm',
        "sourceBaseSha", "sourceMergeBaseSha", ${sha(canonicalJson({
          workspaceId: "source-other-workspace", repositoryConnectionId: "source-other-repository",
          scmRepositoryIdentityId: "source-other-scm", pullRequestNumber: 42,
          baseSha: "c".repeat(40), mergeBaseSha: "d".repeat(40), headSha: oldHead,
        }))}, 'hosted-pool:repository:700003', 'source-other-run', '1',
        'other/repo/.github/workflows/reviewrouter-codex.yml@refs/pull/42/merge',
        'source-other-binding', 1, 2, NULL, 'source-other-relay',
        'source-other-attempt', 'unknown_attempt', "receiptDigest"
      FROM public."HostedHistoricalUnknownScope" WHERE "id"='scope-old'`;
    await db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-other','run','source-other-run')`;
    // Red if matching count/digest certifies members from conflicting receipts.
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalUnknownScope"
        SELECT 'scope-wrong-receipt', "githubRepositoryId", "pullRequestNumber", "headSha",
          "providerFamily", "sourceWorkspaceId", "sourceRepositoryConnectionId",
          "sourceScmRepositoryIdentityId", "sourceBaseSha", "sourceMergeBaseSha",
          "sourceReviewRevisionHash", "sourceProviderInstanceId", "sourceRunId",
          "sourceRunAttempt", "sourceWorkflowRef", "sourceBindingId",
          "sourceBindingRevision", "sourceRuntimeAuthzEpoch", "sourceDatabaseIncarnation",
          'source-wrong-receipt-relay', NULL, 'receipt_bound_orphan', ${sha("other-receipt")}
        FROM public."HostedHistoricalUnknownScope" WHERE "id"='scope-old'`;
      const wrong = await tx.$queryRaw<Array<{ digest: string }>>`
        SELECT public.hosted_historical_set_digest() AS digest`;
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopePolicy"
        ("id","mode","databaseResourceIdentity","databaseIncarnation","receiptDigest","archiveDigest","expectedCount","expectedSetDigest")
        VALUES ('global','destination_required',${resource},${incarnation},${receipt},${archive},3,${wrong[0]!.digest})`;
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeComplete"
        ("id","databaseResourceIdentity","databaseIncarnation","receiptDigest","archiveDigest","memberCount","setDigest")
        VALUES ('global',${resource},${incarnation},${receipt},${archive},3,${wrong[0]!.digest})`;
    })).rejects.toThrow("hosted_historical_marker_incomplete_or_conflicting");
    expect((await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM public."HostedHistoricalUnknownScope"
      WHERE "id"='scope-wrong-receipt'`)[0]?.count).toBe(0n);
    expect((await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM public."HostedHistoricalScopePolicy"`)[0]?.count).toBe(0n);
    const digestRows = await db.$queryRaw<Array<{ digest: string }>>`SELECT public.hosted_historical_set_digest() AS digest`;
    const digest = digestRows[0]!.digest;
    // Red if stale Repeatable Read activation misses a committed incomplete policy.
    let releaseStaleActivation: (() => void) | undefined;
    let staleActivation: Promise<void> | undefined;
    if (raceOrder === "stale_activation") {
      let signalSnapshot!: () => void;
      const snapshotStarted = new Promise<void>((resolve) => { signalSnapshot = resolve; });
      const snapshotRelease = new Promise<void>((resolve) => { releaseStaleActivation = resolve; });
      staleActivation = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT count(*) FROM public."HostedHistoricalScopePolicy"`;
        signalSnapshot();
        await snapshotRelease;
        await tx.hostedCodexRuntimeGate.update({ where: { id: "global" }, data: {
          status: "active", authzEpoch: { increment: 1 }, revision: { increment: 1 },
          reasonCode: "stale_activation", changedAt: new Date(Date.now() + 3_000),
          changedByHash: sha("operator"),
        } });
      }, { isolationLevel: "RepeatableRead", timeout: 10_000 });
      await awaitTransactionStart(snapshotStarted, staleActivation);
    }
    try {
      await db.$executeRaw`INSERT INTO public."HostedHistoricalScopePolicy"
        ("id","mode","databaseResourceIdentity","databaseIncarnation","receiptDigest","archiveDigest","expectedCount","expectedSetDigest")
        VALUES ('global','destination_required',${resource},${incarnation},${receipt},${archive},2,${digest})`;
    } catch (error) {
      releaseStaleActivation?.();
      if (staleActivation) await Promise.allSettled([staleActivation]);
      throw error;
    }
    if (staleActivation) {
      releaseStaleActivation!();
      await expect(staleActivation).rejects.toThrow("hosted_historical_activation_requires_read_committed");
      expect((await db.hostedCodexRuntimeGate.findUniqueOrThrow({ where: { id: "global" } })).status)
        .toBe("closed");
    }
    // Red if composed admission treats a partial projection as an empty deny set.
    await expect(requiredBarrier.assertAdmissionAllowed({
      workspaceId: "hs-workspace", repositoryConnectionId: "hs-repo",
      reviewRequestId: "new-head-intent", grantId: "partial-marker-grant",
      invocationId: "partial-marker-invocation", providerInvocationKey: sha("partial-marker"),
      runId: "truly-new-run",
    })).rejects.toThrow("hosted_historical_scope_denied");
    const activate = () => transition("active", "synthetic_open", 3_000);
    // Red if absent or partial markers can open the destination gate.
    await expect(activate()).rejects.toThrow("hosted_historical_marker_incomplete_or_conflicting");
    await expect(db.$executeRaw`INSERT INTO public."HostedHistoricalScopeComplete"
      ("id","databaseResourceIdentity","databaseIncarnation","receiptDigest","archiveDigest","memberCount","setDigest")
      VALUES ('global',${resource},${incarnation},${receipt},${archive},2,${sha("wrong")})`).rejects.toThrow("hosted_historical_marker_incomplete_or_conflicting");
    await expect(db.$executeRaw`INSERT INTO public."HostedHistoricalScopeComplete"
      ("id","databaseResourceIdentity","databaseIncarnation","receiptDigest","archiveDigest","memberCount","setDigest")
      VALUES ('global',${resource},${incarnation},${receipt},${archive},0,${digest})`).rejects.toThrow("hosted_historical_marker_incomplete_or_conflicting");
    await expect(db.$executeRaw`INSERT INTO public."HostedHistoricalScopeComplete"
      ("id","databaseResourceIdentity","databaseIncarnation","receiptDigest","archiveDigest","memberCount","setDigest")
      VALUES ('global','other-physical-resource',${incarnation},${receipt},${archive},2,${digest})`).rejects.toThrow("hosted_historical_marker_incomplete_or_conflicting");
    const insertMarker = (client: Pick<typeof db, "$executeRaw">) => client.$executeRaw`INSERT INTO public."HostedHistoricalScopeComplete"
      ("id","databaseResourceIdentity","databaseIncarnation","receiptDigest","archiveDigest","memberCount","setDigest")
      VALUES ('global',${resource},${incarnation},${receipt},${archive},2,${digest})`;
    // A stale snapshot importer must fail instead of appending after a marker.
    await expect(db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT count(*) FROM public."HostedHistoricalUnknownScope"`;
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
        VALUES ('scope-old','run','repeatable-read-alias')`;
    }, { isolationLevel: "RepeatableRead" })).rejects.toThrow("hosted_historical_import_requires_read_committed");
    if (raceOrder === "marker_first") {
      // Red if gate activation observes a marker transaction's partial set.
      let signalMarker!: (pid: number) => void;
      let releaseMarker!: () => void;
      const markerStarted = new Promise<number>((resolve) => { signalMarker = resolve; });
      const markerRelease = new Promise<void>((resolve) => { releaseMarker = resolve; });
      const markerTransaction = db.$transaction(async (tx) => {
        await insertMarker(tx);
        const holder = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_catalog.pg_backend_pid() AS pid`;
        signalMarker(holder[0]!.pid);
        await markerRelease;
      }, { timeout: 10_000 });
      const markerPid = await awaitTransactionStart(markerStarted, markerTransaction);
      const opening = db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL application_name = 'historical_gate_open_wait'`;
        await tx.hostedCodexRuntimeGate.update({ where: { id: "global" }, data: {
          status: "active", authzEpoch: { increment: 1 }, revision: { increment: 1 },
          reasonCode: "synthetic_open", changedAt: new Date(Date.now() + 3_000),
          changedByHash: sha("operator"),
        } });
      }, { timeout: 10_000 });
      try {
        await waitForBackendLock("historical_gate_open_wait", markerPid);
      } finally {
        releaseMarker();
        await Promise.allSettled([markerTransaction, opening]);
      }
      await markerTransaction;
      await opening;
    } else if (raceOrder === "alias_marker" || raceOrder === "member_marker") {
      // A queued member/alias writer must see the committed marker and roll back.
      let signalMarker!: (pid: number) => void;
      let releaseMarker!: () => void;
      const markerStarted = new Promise<number>((resolve) => { signalMarker = resolve; });
      const markerRelease = new Promise<void>((resolve) => { releaseMarker = resolve; });
      const marking = db.$transaction(async (tx) => {
        await insertMarker(tx);
        const holder = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_catalog.pg_backend_pid() AS pid`;
        signalMarker(holder[0]!.pid);
        await markerRelease;
      }, { timeout: 10_000 });
      const markerPid = await awaitTransactionStart(markerStarted, marking);
      const importing = db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL application_name = 'historical_member_wait'`;
        if (raceOrder === "alias_marker") {
          await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
            VALUES ('scope-old','run','queued-alias')`;
        } else {
          await tx.$executeRaw`INSERT INTO public."HostedHistoricalUnknownScope"
            SELECT 'queued-member', "githubRepositoryId", "pullRequestNumber", "headSha",
              "providerFamily", "sourceWorkspaceId", "sourceRepositoryConnectionId",
              "sourceScmRepositoryIdentityId", "sourceBaseSha", "sourceMergeBaseSha",
              "sourceReviewRevisionHash", "sourceProviderInstanceId", "sourceRunId",
              "sourceRunAttempt", "sourceWorkflowRef", "sourceBindingId",
              "sourceBindingRevision", "sourceRuntimeAuthzEpoch", "sourceDatabaseIncarnation",
              'queued-relay', NULL, 'receipt_bound_orphan', "receiptDigest"
            FROM public."HostedHistoricalUnknownScope" WHERE "id"='scope-old'`;
        }
      }, { timeout: 10_000 });
      try {
        await waitForBackendLock("historical_member_wait", markerPid);
      } finally {
        releaseMarker();
        await Promise.allSettled([marking, importing]);
      }
      await marking;
      await expect(importing).rejects.toThrow("hosted_historical_set_already_complete");
      expect((await db.$queryRaw<Array<{ digest: string }>>`
        SELECT public.hosted_historical_set_digest() AS digest`)[0]?.digest).toBe(digest);
      await activate();
    } else if (raceOrder === "gate_first") {
      // Red if an opening transaction can commit before the complete marker.
      let signalGate!: (pid: number) => void;
      let releaseGate!: () => void;
      const gateStarted = new Promise<number>((resolve) => { signalGate = resolve; });
      const gateRelease = new Promise<void>((resolve) => { releaseGate = resolve; });
      const gateTransaction = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM public."HostedCodexRuntimeGate" WHERE "id"='global' FOR UPDATE`;
        const holder = await tx.$queryRaw<Array<{ pid: number }>>`
          SELECT pg_catalog.pg_backend_pid() AS pid`;
        signalGate(holder[0]!.pid);
        await gateRelease;
        await tx.hostedCodexRuntimeGate.update({ where: { id: "global" }, data: {
          status: "active", authzEpoch: { increment: 1 }, revision: { increment: 1 },
          reasonCode: "synthetic_open", changedAt: new Date(Date.now() + 3_000), changedByHash: sha("operator"),
        } });
      }, { timeout: 10_000 });
      const gatePid = await awaitTransactionStart(gateStarted, gateTransaction);
      const markerTransaction = db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL application_name = 'historical_marker_wait'`;
        await insertMarker(tx);
      }, { timeout: 10_000 });
      try {
        await waitForBackendLock("historical_marker_wait", gatePid);
      } finally {
        releaseGate();
        await Promise.allSettled([gateTransaction, markerTransaction]);
      }
      await expect(gateTransaction).rejects.toThrow("hosted_historical_marker_incomplete_or_conflicting");
      await markerTransaction;
      await activate();
    } else if (raceOrder === "import_first") {
      // Import-first: the stock grant trigger rejects the committed closed gate.
      let signalMarker!: () => void;
      let releaseMarker!: () => void;
      const markerStarted = new Promise<void>((resolve) => { signalMarker = resolve; });
      const markerRelease = new Promise<void>((resolve) => { releaseMarker = resolve; });
      const marking = db.$transaction(async (tx) => {
        await insertMarker(tx);
        signalMarker();
        await markerRelease;
      }, { timeout: 10_000 });
      await awaitTransactionStart(markerStarted, marking);
      const admitting = db.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL application_name = 'historical_admission_wait'`;
        await tx.hostedCodexInvocationGrant.create({ data: {
          ...grant("import-first-race", "new-head-intent", "truly-new-run"), runtimeAuthzEpoch: 4n,
        } });
      }, { timeout: 10_000 });
      try {
        await expect(admitting).rejects.toThrow("hosted_codex_runtime_gate_authority_mismatch");
      } finally {
        releaseMarker();
        await marking;
      }
      expect(await db.hostedCodexInvocationGrant.count({ where: { id: "import-first-race" } })).toBe(0);
      await activate();
    } else if (raceOrder === "stale_snapshot") {
      // A stale Repeatable Read alias append must fail after completion commits.
      let signalSnapshot!: () => void;
      let releaseSnapshot!: () => void;
      const snapshotStarted = new Promise<void>((resolve) => { signalSnapshot = resolve; });
      const snapshotRelease = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
      const staleImporter = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT count(*) FROM public."HostedHistoricalScopeAlias"`;
        signalSnapshot();
        await snapshotRelease;
        await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
          VALUES ('scope-old','run','late-stale-alias')`;
      }, { isolationLevel: "RepeatableRead", timeout: 10_000 });
      await awaitTransactionStart(snapshotStarted, staleImporter);
      try {
        await insertMarker(db);
      } finally {
        releaseSnapshot();
        await Promise.allSettled([staleImporter]);
      }
      await expect(staleImporter).rejects.toThrow("hosted_historical_import_requires_read_committed");
      await activate();
    } else {
      await insertMarker(db);
      await activate();
    }
    await expect(db.$executeRaw`UPDATE public."HostedHistoricalUnknownScope" SET "headSha" = ${newHead} WHERE "id"='scope-old'`).rejects.toThrow("hosted_historical_projection_immutable");
    await expect(db.$executeRaw`DELETE FROM public."HostedHistoricalScopeComplete" WHERE "id"='global'`).rejects.toThrow("hosted_historical_projection_immutable");
    await expect(db.$executeRaw`TRUNCATE public."HostedHistoricalScopePolicy"`).rejects.toThrow("hosted_historical_projection_immutable");
    await expect(db.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
      VALUES ('scope-old','run','late-after-marker')`).rejects.toThrow("hosted_historical_setup_requires_closed_gate");
    // Red if completing the set remains appendable after a guarded close.
    await expect(db.$transaction(async (tx) => {
      await tx.hostedCodexRuntimeGate.update({ where: { id: "global" }, data: {
        status: "closed", authzEpoch: { increment: 1 }, revision: { increment: 1 },
        reasonCode: "synthetic_immutable_probe", changedAt: new Date(Date.now() + 4_000),
        changedByHash: sha("operator"),
      } });
      await tx.$executeRaw`INSERT INTO public."HostedHistoricalScopeAlias" ("scopeId","kind","value")
        VALUES ('scope-old','run','late-after-marker-closed')`;
    })).rejects.toThrow("hosted_historical_set_already_complete");
    // Red if a runtime role can mutate the deny/marker projection.
    const acl = await db.$queryRaw<Array<{ roleName: string; tableName: string;
      canMutate: boolean; canInsertColumn: boolean; canUpdateColumn: boolean }>>`
      SELECT roles.role_name AS "roleName", tables.table_name AS "tableName",
        pg_catalog.has_table_privilege(roles.role_name,
          pg_catalog.format('public.%I', tables.table_name),
          'INSERT,UPDATE,DELETE,TRUNCATE') AS "canMutate",
        pg_catalog.has_any_column_privilege(roles.role_name,
          pg_catalog.format('public.%I', tables.table_name), 'INSERT') AS "canInsertColumn",
        pg_catalog.has_any_column_privilege(roles.role_name,
          pg_catalog.format('public.%I', tables.table_name), 'UPDATE') AS "canUpdateColumn"
      FROM (VALUES ('reviewrouter_api'),('reviewrouter_web'),('reviewrouter_worker'),
        ('reviewrouter_comment_token_custody'),('reviewrouter_codex_effect_authority')) AS roles(role_name)
      CROSS JOIN (VALUES ('HostedHistoricalScopePolicy'),('HostedHistoricalUnknownScope'),
        ('HostedHistoricalScopeAlias'),('HostedHistoricalScopeComplete')) AS tables(table_name)
    `;
    expect(acl).toHaveLength(20);
    expect(acl.every((row) => !row.canMutate && !row.canInsertColumn && !row.canUpdateColumn)).toBe(true);
    const effectiveAcl = await db.$queryRaw<Array<{
      roleName: string; tableName: string; canSelect: boolean; canInsertColumn: boolean; canUpdateColumn: boolean;
      canReadReady: boolean; canReadGrant: boolean; publicCanRead: boolean;
    }>>`
      SELECT roles.role_name AS "roleName", tables.table_name AS "tableName",
        pg_catalog.has_table_privilege(roles.role_name,
          pg_catalog.format('public.%I', tables.table_name), 'SELECT') AS "canSelect",
        pg_catalog.has_any_column_privilege(roles.role_name,
          pg_catalog.format('public.%I', tables.table_name), 'UPDATE') AS "canUpdateColumn",
        pg_catalog.has_any_column_privilege(roles.role_name,
          pg_catalog.format('public.%I', tables.table_name), 'INSERT') AS "canInsertColumn",
        pg_catalog.has_function_privilege(roles.role_name,
          'public.hosted_historical_assert_ready()', 'EXECUTE') AS "canReadReady",
        pg_catalog.has_function_privilege(roles.role_name,
          'public.hosted_historical_assert_grant(public."HostedCodexInvocationGrant")', 'EXECUTE') AS "canReadGrant",
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_class c,
            pg_catalog.aclexplode(coalesce(c.relacl,
              pg_catalog.acldefault('r', c.relowner))) a
          WHERE c.oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', tables.table_name))
            AND a.grantee = 0 AND a.privilege_type = 'SELECT'
        ) AS "publicCanRead"
      FROM (VALUES ('reviewrouter_api'),('reviewrouter_web'),('reviewrouter_worker'),
        ('reviewrouter_comment_token_custody')) AS roles(role_name)
      CROSS JOIN (VALUES ('HostedHistoricalScopePolicy'),('HostedHistoricalUnknownScope'),
        ('HostedHistoricalScopeAlias'),('HostedHistoricalScopeComplete')) AS tables(table_name)
    `;
    expect(effectiveAcl).toHaveLength(16);
    expect(effectiveAcl.every((row) => row.canSelect && row.canReadReady && row.canReadGrant &&
      !row.canInsertColumn && !row.canUpdateColumn && !row.publicCanRead)).toBe(true);
    // Red if the definer trigger has the wrong owner or direct callers.
    const definer = await db.$queryRaw<Array<{
      ownerName: string; securityDefiner: boolean; searchPath: string[] | null;
      publicExecute: boolean; apiExecute: boolean;
    }>>`
      SELECT owner.rolname AS "ownerName", routine.prosecdef AS "securityDefiner",
        routine.proconfig AS "searchPath",
        EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(routine.proacl,
          pg_catalog.acldefault('f', routine.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS "publicExecute",
        pg_catalog.has_function_privilege('reviewrouter_api', routine.oid, 'EXECUTE') AS "apiExecute"
      FROM pg_catalog.pg_proc routine
      JOIN pg_catalog.pg_roles owner ON owner.oid = routine.proowner
      WHERE routine.oid = pg_catalog.to_regprocedure('public.hosted_historical_grant_guard()')
    `;
    expect(definer).toEqual([{ ownerName: "reviewrouter_release_schema_owner",
      securityDefiner: true, searchPath: ["search_path=pg_catalog, pg_temp"],
      publicExecute: false, apiExecute: false }]);
    // Red if the helper is broadly callable or its owner cannot lock the gate.
    const gateHelper = await db.$queryRaw<Array<{
      ownerName: string; securityDefiner: boolean; searchPath: string[] | null;
      apiExecute: boolean; webExecute: boolean; publicExecute: boolean;
      ownerCanLockGate: boolean; ownerCanReadIntent: boolean; ownerCanReadRepository: boolean;
    }>>`
      SELECT owner.rolname AS "ownerName", routine.prosecdef AS "securityDefiner",
        routine.proconfig AS "searchPath",
        pg_catalog.has_function_privilege('reviewrouter_api', routine.oid, 'EXECUTE') AS "apiExecute",
        pg_catalog.has_function_privilege('reviewrouter_web', routine.oid, 'EXECUTE') AS "webExecute",
        EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(routine.proacl,
          pg_catalog.acldefault('f', routine.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE') AS "publicExecute",
        (pg_catalog.has_table_privilege(owner.oid, 'public."HostedCodexRuntimeGate"'::regclass, 'SELECT')
          AND pg_catalog.has_table_privilege(owner.oid, 'public."HostedCodexRuntimeGate"'::regclass, 'UPDATE')) AS "ownerCanLockGate",
        (pg_catalog.has_table_privilege(owner.oid, 'public."ReviewRequestedIntent"'::regclass, 'SELECT')
          AND pg_catalog.has_table_privilege(owner.oid, 'public."ReviewRequestedIntent"'::regclass, 'UPDATE')) AS "ownerCanReadIntent",
        (pg_catalog.has_table_privilege(owner.oid, 'public."RepositoryConnection"'::regclass, 'SELECT')
          AND pg_catalog.has_table_privilege(owner.oid, 'public."RepositoryConnection"'::regclass, 'UPDATE')) AS "ownerCanReadRepository"
      FROM pg_catalog.pg_proc routine
      JOIN pg_catalog.pg_roles owner ON owner.oid = routine.proowner
      WHERE routine.oid = pg_catalog.to_regprocedure('public.hosted_historical_lock_runtime_gate()')`;
    expect(gateHelper).toEqual([{ ownerName: "reviewrouter_release_schema_owner",
      securityDefiner: true, searchPath: ["search_path=pg_catalog, pg_temp"],
      apiExecute: true, webExecute: false, publicExecute: false,
      ownerCanLockGate: true, ownerCanReadIntent: true, ownerCanReadRepository: true }]);
    // Red if role convergence accidentally restores direct gate mutation or
    // exposes the lock helper to another runtime identity.
    const narrowHelperAcl = await db.$queryRaw<Array<{ apiGateUpdate: boolean; workerExecute: boolean;
      custodyExecute: boolean; effectExecute: boolean }>>`
      SELECT pg_catalog.has_any_column_privilege('reviewrouter_api',
        'public."HostedCodexRuntimeGate"', 'UPDATE') AS "apiGateUpdate",
        pg_catalog.has_function_privilege('reviewrouter_worker',
          'public.hosted_historical_lock_runtime_gate()', 'EXECUTE') AS "workerExecute",
        pg_catalog.has_function_privilege('reviewrouter_comment_token_custody',
          'public.hosted_historical_lock_runtime_gate()', 'EXECUTE') AS "custodyExecute",
        pg_catalog.has_function_privilege('reviewrouter_codex_effect_authority',
          'public.hosted_historical_lock_runtime_gate()', 'EXECUTE') AS "effectExecute"`;
    expect(narrowHelperAcl).toEqual([{ apiGateUpdate: false, workerExecute: false, custodyExecute: false, effectExecute: false }]);
    const lockedGate = await apiDb.$transaction(async (tx) => tx.$queryRaw<Array<{
      status: string; authzEpoch: bigint;
    }>>`SELECT "status", "authzEpoch" FROM public.hosted_historical_lock_runtime_gate()`);
    expect(lockedGate).toEqual([{ status: "active", authzEpoch: 4n }]);
    // Old row IDs and source bytes remain; a fresh run with the same trusted head is denied.
    expect(await db.hostedCodexRelayRequest.findUniqueOrThrow({ where: { id: "old-relay" } })).toEqual(oldBytes);
    expect(await db.hostedCodexUpstreamEffectAttempt.count({ where: { relayRequestId: "old-relay" } })).toBe(0);
    const members = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS "count" FROM public."HostedHistoricalUnknownScope"`;
    expect(members[0]?.count).toBe(2n);
    await expect(db.hostedCodexInvocationGrant.create({ data: {
      ...grant("fresh-old-head", "new-attempt-intent", "new-run"), runtimeAuthzEpoch: 4n,
    } })).rejects.toThrow("hosted_historical_scope_denied");
    expect(await db.hostedCodexInvocationGrant.count({ where: { id: "fresh-old-head" } })).toBe(0);
    // A direct SQL caller cannot supply a false head; the trigger resolves it.
    await expect(db.hostedCodexInvocationGrant.create({ data: {
      ...grant("forged-old-head", "new-attempt-intent", "new-run"), runtimeAuthzEpoch: 4n,
      historicalGithubRepositoryId: 700003n, historicalPullRequestNumber: 99,
      historicalHeadSha: newHead,
    } })).rejects.toThrow("hosted_historical_scope_denied");
    expect(await db.hostedCodexInvocationGrant.count({ where: { id: "forged-old-head" } })).toBe(0);
    // The actual restricted API role reaches the trigger. A valid old-head
    // insert must fail on the historical predicate, not missing privileges.
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_api");
      await tx.hostedCodexInvocationGrant.create({ data: {
        ...grant("api-old-head", "new-attempt-intent", "new-run"), runtimeAuthzEpoch: 4n,
      } });
    })).rejects.toThrow("hosted_historical_scope_denied");
    // Red if an unqualified SQL lookup can be shadowed with empty temp deny
    // tables and then admit the same old head through a direct grant insert.
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`CREATE TEMP TABLE "HostedHistoricalScopePolicy" (LIKE public."HostedHistoricalScopePolicy")`;
      await tx.$executeRaw`CREATE TEMP TABLE "HostedHistoricalUnknownScope" (LIKE public."HostedHistoricalUnknownScope")`;
      await tx.$executeRaw`SET LOCAL search_path = pg_temp, public`;
      await tx.hostedCodexInvocationGrant.create({ data: {
        ...grant("shadowed-old-head", "new-attempt-intent", "new-run"), runtimeAuthzEpoch: 4n,
      } });
    })).rejects.toThrow("hosted_historical_scope_denied");
    expect(await db.hostedCodexInvocationGrant.count({ where: { id: "shadowed-old-head" } })).toBe(0);
    // Red if an imported run or review-request alias clears on a new head.
    await expect(db.hostedCodexInvocationGrant.create({ data: {
      ...grant("aliased-new-head", "aliased-new-head-intent", "old-run", 3), runtimeAuthzEpoch: 4n,
    } })).rejects.toThrow("hosted_historical_scope_denied");
    await expect(db.hostedCodexInvocationGrant.create({ data: { ...grant("aliased-review-request-grant", "external-old-review-request", "review-alias-run"), runtimeAuthzEpoch: 4n } })).rejects.toThrow("hosted_historical_scope_denied");
    await expect(db.hostedCodexInvocationGrant.create({ data: {
      ...grant("aliased-capability", "new-head-intent", "truly-new-run"),
      capabilityTokenHash: sha("external-old-capability"), runtimeAuthzEpoch: 4n,
    } })).rejects.toThrow("hosted_historical_scope_denied");
    // Red if old grant/invocation/provider aliases can be relabelled with a
    // genuinely new head and then presented as fresh authority.
    await expect(db.hostedCodexInvocationGrant.create({ data: {
      ...grant("external-old-grant", "new-head-intent", "truly-new-run"), runtimeAuthzEpoch: 4n,
    } })).rejects.toThrow("hosted_historical_scope_denied");
    await expect(db.hostedCodexInvocationGrant.create({ data: {
      ...grant("aliased-invocation", "new-head-intent", "truly-new-run"),
      invocationId: "external-old-invocation", runtimeAuthzEpoch: 4n,
    } })).rejects.toThrow("hosted_historical_scope_denied");
    await expect(db.hostedCodexInvocationGrant.create({ data: {
      ...grant("aliased-provider", "new-head-intent", "truly-new-run"),
      providerInvocationKey: sha("external-old-provider-invocation"), runtimeAuthzEpoch: 4n,
    } })).rejects.toThrow("hosted_historical_scope_denied");
    // Red if the barrier globally disables new heads in the same repository.
    await db.hostedCodexInvocationGrant.create({ data: {
      ...grant("fresh-new-head", "new-head-intent", "truly-new-run"), runtimeAuthzEpoch: 4n,
      historicalGithubRepositoryId: 700002n, historicalPullRequestNumber: 42,
      historicalHeadSha: oldHead,
    } });
    expect(await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: "fresh-new-head" }, select: { historicalHeadSha: true },
    })).toEqual({ historicalHeadSha: newHead });
    // Red if a caller rewrites the trusted snapshot after SQL resolved it.
    await expect(db.hostedCodexInvocationGrant.update({
      where: { id: "fresh-new-head" }, data: { historicalHeadSha: oldHead },
    })).rejects.toThrow("hosted_historical_grant_scope_immutable");
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_api");
      await tx.hostedCodexInvocationGrant.create({ data: {
        ...grant("api-new-head", "new-head-intent", "truly-new-run"), runtimeAuthzEpoch: 4n,
      } });
    });
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_api");
      const rows = await tx.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT public.hosted_historical_assert_grant(g) AS allowed
        FROM public."HostedCodexInvocationGrant" g WHERE g."id"='fresh-new-head'`;
      expect(rows[0]?.allowed).toBe(true);
    });
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_api");
      await tx.$queryRaw`
        SELECT public.hosted_historical_assert_grant(g)
        FROM public."HostedCodexInvocationGrant" g WHERE g."id"='prebarrier-same-head'`;
    })).rejects.toThrow("hosted_historical_trusted_scope_missing");
    const refreshData = {
      grantId: "fresh-new-head", invocationId: "invocation-fresh-new-head",
      repositoryBindingId: "hs-binding", workspaceId: "hs-workspace", poolId: "hs-pool",
      repositoryConnectionId: "hs-repo",
      issuedAt: now, expiresAt: new Date(now.getTime() + 600_000), maxUses: 1,
    };
    await expect(db.hostedCodexCommentRefreshCapability.create({ data: {
      ...refreshData, capabilityTokenHash: sha("external-old-refresh"),
    } })).rejects.toThrow("hosted_historical_refresh_alias_denied");
    await db.hostedCodexCommentRefreshCapability.create({ data: {
      ...refreshData, capabilityTokenHash: sha("fresh-refresh"),
    } });
    expect(await db.hostedCodexRelayRequest.findUniqueOrThrow({ where: { id: "old-relay" } })).toEqual(oldBytes);
    // Red if imported request/attempt aliases can be reused under a fresh grant.
    await expect(db.hostedCodexRelayRequest.create({ data: {
      id: "external-old-request", grantId: "fresh-new-head", ordinal: 1,
      idempotencyKeyHash: sha("alias-request"), requestBytes: 10,
    } })).rejects.toThrow("hosted_historical_request_alias_denied");
    const allowedRequestHash = sha("allowed-request");
    await db.hostedCodexRelayRequest.create({ data: {
      id: "new-head-request", grantId: "fresh-new-head", ordinal: 1,
      idempotencyKeyHash: sha("new-head-request"), requestHash: allowedRequestHash,
      requestBytes: 10, status: "processing", startedAt: new Date(),
    } });
    await expect(db.hostedCodexUpstreamEffectAttempt.create({ data: {
      id: "external-old-attempt", relayRequestId: "new-head-request", grantId: "fresh-new-head",
      workspaceId: "hs-workspace", poolId: "hs-pool", accountId: "hs-account", credentialGeneration: 1n,
      attemptOrdinal: 1, requestHash: allowedRequestHash, idempotencyKeyHash: sha("alias-attempt"),
      state: "prepared", ownerIdHash: sha("owner"), fenceEpoch: 1n, heartbeatAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 600_000),
    } })).rejects.toThrow("hosted_historical_attempt_alias_denied");
    const barrier = new PrismaHostedHistoricalScopeBarrier(db, { required: true, resourceIdentity: resource, incarnation });
    // Red if pre-cutover fresh grants remain usable after the marker opens.
    await expect(barrier.assertGrantAllowed("prebarrier-same-head"))
      .rejects.toThrow("hosted_historical_scope_denied");
    if (raceOrder === "grant_first") {
      await expect(barrier.assertGrantAllowed("grant-first-race"))
        .rejects.toThrow("hosted_historical_scope_denied");
    }
    // Red if relay authorization charges a request budget before rejecting a
    // captured same-head grant from the disabled generation.
    const prebarrierBudget = await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: "prebarrier-same-head" }, select: { requestCount: true, inFlight: true },
    });
    await expect(new PrismaHostedCodexRelayAuthorization(db, false, barrier).authorize({
      opaqueGrant: "capability:prebarrier-same-head", idempotencyKey: "prebarrier-captured",
      requestOrdinal: 1, requestBytes: 10,
    })).rejects.toThrow("hosted_historical_scope_denied");
    expect(await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: "prebarrier-same-head" }, select: { requestCount: true, inFlight: true },
    })).toEqual(prebarrierBudget);
    // Red if composed admission lets a fresh same-head run generate capability
    // before the SQL grant guard denies the insert; no token may be minted.
    const apiBarrier = new PrismaHostedHistoricalScopeBarrier(apiDb, {
      required: true, resourceIdentity: resource, incarnation,
    });
    const grants = new PrismaInvocationGrantRepository(apiDb);
    const capabilityKey = Buffer.alloc(32, 19);
    const grantCapability = new HmacHostedCodexCapabilityIssuer(capabilityKey, "relay-grant-v1");
    const refreshCapability = new HmacHostedCodexCapabilityIssuer(capabilityKey, "comment-refresh-v1");
    const tokenTransport = vi.fn(async () => ({ token: "should-not-mint", expiresAt: new Date(Date.now() + 60_000),
      repository: "synthetic/repo", permissions: { contents: "read" as const, pullRequests: "write" as const,
        issues: "write" as const, statuses: "write" as const }, custody: "acceptable" as const,
      [hostedCommentTokenDelivery]: async () => {},
    }));
    const issuerDependencies = {
      oidcVerifier: { verify: async () => oidcClaims() },
      replayNonces: new PrismaActionOidcReplayNonceStore(apiDb),
      admissions: new PrismaHostedCodexGrantAdmission(apiDb, workflowReader, hostedPoolWorkflowSchemaVersion),
      pools: new PrismaHostedPoolRepository(apiDb), bindings: new PrismaHostedPoolBindingRepository(apiDb),
      accounts: new PrismaHostedAccountRepository(apiDb), grants, historicalScopes: apiBarrier,
      grantCapabilities: grantCapability,
      refreshCapabilities: {
        issue: (scope: Parameters<HmacHostedCodexCapabilityIssuer["issue"]>[0]) => refreshCapability.issue(scope),
        revoke: (command: Parameters<PrismaInvocationGrantRepository["revoke"]>[0]) => grants.revoke(command),
      },
      commentTokens: { issueInitial: tokenTransport },
      clock: { now: () => new Date() },
      trustedActionRefs: [`777genius/review-router@${actionSha}`],
      relayUrl: "https://api.synthetic.example/api/action/v1/hosted-codex/responses",
      policy: { ttlMs: 900_000, maxRequests: 32, maxConcurrentRequests: 2,
        maxRequestBodyBytes: 2_000_000, maxResponseBytes: 8_000_000, maxOutputTokens: 32_768,
        maxCommentTokenRefreshes: 8 },
    };
    const issuer = new HostedCodexGrantIssuer(issuerDependencies);
    const grantCountBeforeDeniedIssue = await db.hostedCodexInvocationGrant.count();
    const deniedIssueBudget = await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: "prebarrier-same-head" }, select: { requestCount: true, inFlight: true },
    });
    const effectCountBeforeDeniedIssue = await db.hostedCodexUpstreamEffectAttempt.count();
    admittedRun = "mint-denied-run";
    admittedJti = "historical-denied-same-head-fresh-jti";
    const deniedIssueCapability = vi.spyOn(HmacHostedCodexCapabilityIssuer.prototype, "issue");
    await expect(issuer.issue({ oidcToken: "synthetic-oidc-token", providerInstanceId: "hosted-pool:repository:700002",
      workflowSchemaVersion: hostedPoolWorkflowSchemaVersion, bindingId: "hs-binding", bindingVersion: 2 }))
      .rejects.toThrow("hosted_historical_scope_denied");
    expect(deniedIssueCapability).not.toHaveBeenCalled();
    deniedIssueCapability.mockRestore();
    expect(tokenTransport).not.toHaveBeenCalled();
    expect(await db.hostedCodexInvocationGrant.count()).toBe(grantCountBeforeDeniedIssue);
    expect(await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: "prebarrier-same-head" }, select: { requestCount: true, inFlight: true },
    })).toEqual(deniedIssueBudget);
    expect(await db.hostedCodexUpstreamEffectAttempt.count()).toBe(effectCountBeforeDeniedIssue);
    // Red if the old-head deny is accidentally widened to every future head.
    admittedHead = newHead;
    admittedRun = "truly-new-run";
    admittedJti = "historical-truly-new-jti";
    const allowedFactoryGrant = await issueThroughFactory("1", "factory-new-head", true);
    expect(allowedFactoryGrant).toMatchObject({ protocolVersion: 1 });
    expect(factoryAllowedMint).toHaveBeenCalledTimes(2);
    expect(tokenTransport).not.toHaveBeenCalled();
    expect((await db.hostedCodexInvocationGrant.count({ where: { status: "issued" } }))).toBeGreaterThan(0);
    // A fresh OIDC assertion for the same allowed invocation takes the safe
    // response-loss retry path without a second grant or budget reset.
    const beforeAllowedRetry = await db.hostedCodexInvocationGrant.count();
    admittedJti = "historical-truly-new-retry-jti";
    await expect(issueThroughFactory("1", "factory-new-head-retry", true))
      .resolves.toMatchObject({ invocationLeaseId: allowedFactoryGrant.invocationLeaseId });
    expect(factoryAllowedMint).toHaveBeenCalledTimes(3);
    expect(tokenTransport).not.toHaveBeenCalled();
    expect(await db.hostedCodexInvocationGrant.count()).toBe(beforeAllowedRetry);
    // This exact aggregate also passes the independently assembled issuer's
    // ordinary retry path; the following denial therefore cannot be credited
    // to a mismatched policy, missing refresh capability, or stale epoch.
    admittedJti = "historical-truly-new-stock-retry-jti";
    await expect(issuer.issue({ oidcToken: "synthetic-oidc-token-stock-retry",
      providerInstanceId: "hosted-pool:repository:700002", workflowSchemaVersion: hostedPoolWorkflowSchemaVersion,
      bindingId: "hs-binding", bindingVersion: 2 })).resolves.toMatchObject({
        invocationLeaseId: allowedFactoryGrant.invocationLeaseId,
      });
    expect(tokenTransport).toHaveBeenCalledOnce();
    // The current existing-grant response-loss branch needs its own check:
    // a new JTI cannot bypass a denial that arrives after admission lookup.
    const retryCapability = vi.spyOn(HmacHostedCodexCapabilityIssuer.prototype, "issue");
    const beforeDeniedRetryBudget = await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: allowedFactoryGrant.invocationLeaseId },
      select: { requestCount: true, inFlight: true, status: true },
    });
    const beforeDeniedRetryEffects = await db.hostedCodexUpstreamEffectAttempt.count();
    const deniedRetry = new HostedCodexGrantIssuer({
      ...issuerDependencies,
      historicalScopes: {
        assertAdmissionAllowed: async () => {},
        assertGrantAllowed: async () => { throw new HostedHistoricalScopeDeniedError("retry_scope_denied"); },
      },
    });
    admittedJti = "historical-truly-new-denied-retry-jti";
    await expect(deniedRetry.issue({ oidcToken: "synthetic-oidc-token-new-head-denied-retry",
      providerInstanceId: "hosted-pool:repository:700002", workflowSchemaVersion: hostedPoolWorkflowSchemaVersion,
      bindingId: "hs-binding", bindingVersion: 2 })).rejects.toThrow("hosted_historical_scope_denied");
    expect(retryCapability).not.toHaveBeenCalled();
    expect(tokenTransport).toHaveBeenCalledOnce();
    expect(await db.hostedCodexInvocationGrant.count()).toBe(beforeAllowedRetry);
    expect(await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: allowedFactoryGrant.invocationLeaseId },
      select: { requestCount: true, inFlight: true, status: true },
    })).toEqual(beforeDeniedRetryBudget);
    expect(await db.hostedCodexUpstreamEffectAttempt.count()).toBe(beforeDeniedRetryEffects);
    retryCapability.mockRestore();
    // A real valid-grant retry under a non-opted-in generation must deny before
    // capabilities, token transport, budgets, or effects can change.
    const beforeNoOptIn = await db.hostedCodexInvocationGrant.count();
    const noOptInBudget = await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: allowedFactoryGrant.invocationLeaseId }, select: { requestCount: true, inFlight: true, status: true },
    });
    const noOptInEffects = await db.hostedCodexUpstreamEffectAttempt.count();
    const noOptInCapability = vi.spyOn(HmacHostedCodexCapabilityIssuer.prototype, "issue");
    admittedJti = "historical-policy-without-opt-in-jti";
    await expect(issueThroughFactory("0", "factory-no-opt-in"))
      .rejects.toThrow("hosted_historical_scope_denied");
    expect(noOptInCapability).not.toHaveBeenCalled();
    noOptInCapability.mockRestore();
    expect(factoryMint).not.toHaveBeenCalled();
    expect(await db.hostedCodexInvocationGrant.count()).toBe(beforeNoOptIn);
    expect(await db.hostedCodexInvocationGrant.findUniqueOrThrow({ where: { id: allowedFactoryGrant.invocationLeaseId },
      select: { requestCount: true, inFlight: true, status: true } })).toEqual(noOptInBudget);
    expect(await db.hostedCodexUpstreamEffectAttempt.count()).toBe(noOptInEffects);
    expect(await db.hostedCodexRelayRequest.findUniqueOrThrow({ where: { id: "old-relay" } })).toEqual(oldBytes);
    // Red if a captured pre-cutover grant can pass the pre-bootstrap scope lookup.
    await expect(barrier.assertGrantAllowed("old-grant")).rejects.toThrow("hosted_historical_scope_denied");
    // Red if a captured authorization bootstraps a Codex session before the
    // historical check, or if denial relabels an ambiguous request no-effect.
    const sessionBootstrap = vi.fn(async () => { throw new Error("session_bootstrap_reached"); });
    const modelTransport = vi.fn(async () => { throw new Error("model_transport_reached"); });
    const relay = new FetchHostedCodexStreamingRelay(
      { ensureFreshSession: sessionBootstrap } as unknown as HostedCodexSessionRuntime,
      new PrismaInvocationGrantRepository(apiDb), modelTransport as unknown as typeof fetch,
      { failoverEnabled: false, historicalScopes: apiBarrier },
    );
    await expect(relay.open({ authorization: captured, body: Readable.from([capturedBody]),
      contentType: "application/json", accept: "text/event-stream", abortSignal: new AbortController().signal }))
      .rejects.toThrow("hosted_historical_scope_denied");
    expect(sessionBootstrap).not.toHaveBeenCalled();
    expect(modelTransport).not.toHaveBeenCalled();
    expect((await db.hostedCodexRelayRequest.findUniqueOrThrow({ where: { id: captured.requestId } })).status)
      .toBe("processing");
    // This new-head grant has current authority. A real configuration denial
    // in the historical barrier must stop before any session bootstrap; the
    // same request with the matching destination policy reaches bootstrap.
    const currentGrant = allowedFactoryGrant.invocationLeaseId;
    const scopeOnlyBody = Buffer.from('{"input":"synthetic"}');
    const scopeOnlyAuthorization = await new PrismaHostedCodexRelayAuthorization(apiDb, false, apiBarrier)
      .authorize({ opaqueGrant: allowedFactoryGrant.grant, idempotencyKey: "scope-only",
        requestOrdinal: 1, requestBytes: scopeOnlyBody.byteLength });
    await expect(new PrismaHostedCodexUpstreamEffectLedger(apiDb).assertLiveAuthority({
      grantId: currentGrant, accountId: "hs-account",
    })).resolves.toBeUndefined();
    const scopeOnlyDenial = new PrismaHostedHistoricalScopeBarrier(apiDb, {
      required: false, resourceIdentity: resource, incarnation,
    });
    const currentSessionBootstrap = vi.fn(async () => { throw new Error("synthetic_bootstrap_stop"); });
    const currentRuntime = {
      ensureFreshSession: currentSessionBootstrap,
      classifyFailure: () => ({ code: "non_retryable" }),
    } as unknown as HostedCodexSessionRuntime;
    const scopeOnlyRelay = new FetchHostedCodexStreamingRelay(
      currentRuntime, new PrismaInvocationGrantRepository(apiDb), modelTransport as unknown as typeof fetch,
      { failoverEnabled: false, historicalScopes: scopeOnlyDenial },
    );
    const scopeOnlyInput = () => ({ authorization: scopeOnlyAuthorization,
      body: Readable.from([Buffer.from('{"input":"synthetic"}')]), contentType: "application/json",
      accept: "text/event-stream", abortSignal: new AbortController().signal });
    await expect(scopeOnlyRelay.open(scopeOnlyInput())).rejects.toThrow("hosted_historical_scope_denied");
    expect(currentSessionBootstrap).not.toHaveBeenCalled();
    expect((await db.hostedCodexRelayRequest.findUniqueOrThrow({ where: { id: scopeOnlyAuthorization.requestId } })).status)
      .toBe("processing");
    const allowedRelay = new FetchHostedCodexStreamingRelay(
      currentRuntime, new PrismaInvocationGrantRepository(apiDb), modelTransport as unknown as typeof fetch,
      { failoverEnabled: false, historicalScopes: apiBarrier },
    );
    await expect(allowedRelay.open(scopeOnlyInput())).rejects.toThrow("synthetic_bootstrap_stop");
    expect(currentSessionBootstrap).toHaveBeenCalledOnce();
    expect(modelTransport).not.toHaveBeenCalled();
    // Red if an allowed complete v1 grant cannot pass real effect preparation
    // and dispatch. The synthetic session is an explicit transport boundary,
    // not a claim that the placeholder credential has passed custody restore.
    const dispatchAuthorization = await new PrismaHostedCodexRelayAuthorization(apiDb, false, apiBarrier)
      .authorize({ opaqueGrant: allowedFactoryGrant.grant, idempotencyKey: "allowed-dispatch",
        requestOrdinal: 2, requestBytes: scopeOnlyBody.byteLength });
    const dispatchedFetch = vi.fn(async () => { throw new Error("synthetic_model_transport_accepted"); });
    const dispatchRuntime = {
      ensureFreshSession: vi.fn(async () => ({ accessToken: ["synthetic", "transport", "only"].join("-"),
        chatgptAccountId: "synthetic-account", credentialGeneration: 1 })),
      classifyFailure: () => ({ code: "non_retryable" }),
    } as unknown as HostedCodexSessionRuntime;
    const dispatchRelay = new FetchHostedCodexStreamingRelay(
      dispatchRuntime, new PrismaInvocationGrantRepository(apiDb), dispatchedFetch as unknown as typeof fetch,
      { failoverEnabled: false, historicalScopes: apiBarrier },
    );
    await expect(dispatchRelay.open({ ...scopeOnlyInput(), authorization: dispatchAuthorization }))
      .rejects.toThrow("synthetic_model_transport_accepted");
    expect(dispatchRuntime.ensureFreshSession).toHaveBeenCalledOnce();
    expect(dispatchedFetch).toHaveBeenCalledOnce();
    const dispatchedEffect = await db.hostedCodexUpstreamEffectAttempt.findFirstOrThrow({
      where: { relayRequestId: dispatchAuthorization.requestId },
      select: { state: true, credentialGeneration: true, dispatchStartedAt: true },
    });
    expect(dispatchedEffect).toMatchObject({ state: "terminal_unknown", credentialGeneration: 1n });
    expect(dispatchedEffect.dispatchStartedAt).toBeInstanceOf(Date);
    expect((await db.hostedCodexRelayRequest.findUniqueOrThrow({
      where: { id: dispatchAuthorization.requestId }, select: { status: true },
    })).status).toBe("terminal_unknown");
    // Red if a possibly sent model request is relabeled no-effect or leaves
    // the ordinary grant/capability usable after terminalization.
    const poisonedDispatchGrant = await db.hostedCodexInvocationGrant.findUniqueOrThrow({
      where: { id: currentGrant }, select: { status: true, revokedAt: true },
    });
    expect(poisonedDispatchGrant.status).toBe("revoked");
    expect(poisonedDispatchGrant.revokedAt).toBeInstanceOf(Date);
    const poisonedRefresh = await db.hostedCodexCommentRefreshCapability.findFirstOrThrow({
      where: { grantId: currentGrant }, select: { revokedAt: true },
    });
    expect(poisonedRefresh.revokedAt).toBeInstanceOf(Date);
    // Real mint protocol and durable custody-role ledger: a fresh same-head
    // OIDC must stop before provider preflight, while a genuinely new trusted
    // head/run can reach prepare, dispatch confirmation, and injected send.
    // Red if preflight is scoped to the wrong installation/repository or a
    // provider send precedes the durable one-attempt dispatch confirmation.
    const tokenSend = vi.fn(async (sendInput: { remainingBudgetMs: number;
      budgetStartedAtMonotonicMs: number; signal?: AbortSignal }) => {
      expect(sendInput.remainingBudgetMs).toBeGreaterThan(0);
      expect(sendInput.remainingBudgetMs).toBeLessThanOrEqual(15_000);
      expect(Number.isFinite(sendInput.budgetStartedAtMonotonicMs)).toBe(true);
      expect(sendInput.budgetStartedAtMonotonicMs).toBeGreaterThan(0);
      expect(sendInput.signal).toBeInstanceOf(AbortSignal);
      expect(sendInput.signal?.aborted).toBe(false);
      const dispatching = await db.hostedCodexCommentTokenMint.findMany({
        where: { state: "dispatching" },
        select: { state: true, providerAttempt: true, dispatchStartedAt: true,
          dispatchAuthorizedUntil: true, fenceEpoch: true, revision: true,
          githubInstallationId: true, githubRepositoryId: true, repositoryFullName: true },
      });
      expect(dispatching).toHaveLength(1);
      expect(dispatching[0]).toMatchObject({ state: "dispatching", providerAttempt: 1,
        githubInstallationId: 700001n, githubRepositoryId: 700002n,
        repositoryFullName: "synthetic/repo" });
      expect(dispatching[0]?.dispatchStartedAt).toBeInstanceOf(Date);
      expect(dispatching[0]?.dispatchAuthorizedUntil).toBeInstanceOf(Date);
      expect(dispatching[0]?.fenceEpoch).toBeGreaterThan(0n);
      expect(dispatching[0]?.revision).toBeGreaterThan(1n);
      return { token: "synthetic-provider-comment-token",
        expiresAt: new Date(Date.now() + 60_000), repository: "synthetic/repo",
        permissions: { contents: "read" as const, pullRequests: "write" as const,
          issues: "write" as const, statuses: "write" as const }, custody: "acceptable" as const };
    });
    const tokenPreflight = vi.fn(async (input: { githubInstallationId: string;
      githubRepositoryId: string; repositoryFullName: string }) => {
      expect(input).toEqual({ githubInstallationId: "700001", githubRepositoryId: "700002",
        repositoryFullName: "synthetic/repo" });
      return { send: tokenSend };
    });
    const syntheticVault: HostedCommentTokenPreparedSecretVaultPort = {
      prepareSeal: async () => ({ capture: (token) => ({ ciphertext: Buffer.from(token),
        encryptedDataKey: Buffer.from("synthetic-test-only"), iv: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2), keyId: "synthetic-test-only", aadHash: sha("synthetic-aad") }),
        destroy: () => {} }),
      seal: async (input) => ({ ciphertext: Buffer.from(input.token),
        encryptedDataKey: Buffer.from("synthetic-test-only"), iv: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2), keyId: "synthetic-test-only", aadHash: sha("synthetic-aad") }),
      open: async (input) => Buffer.from(input.envelope.ciphertext),
    };
    const directTokenIssue = vi.fn(async () => { throw new Error("synthetic_direct_issue_bypassed_preflight"); });
    const stockMint = new HostedCommentTokenMintProtocol({
      commentTokens: { prepareCommentToken: tokenPreflight, issueCommentToken: directTokenIssue },
      clock: { now: () => new Date() }, mintLedger: new PrismaHostedCommentTokenMintLedger(custodyDb),
      secretVault: syntheticVault,
    });
    admittedHead = oldHead;
    admittedRun = "mint-denied-run";
    admittedJti = "historical-real-mint-denied-jti";
    const beforeRealMintDenial = {
      grants: await db.hostedCodexInvocationGrant.count(),
      mints: await db.hostedCodexCommentTokenMint.count(),
      effects: await db.hostedCodexUpstreamEffectAttempt.count(),
    };
    const deniedMintCapability = vi.spyOn(HmacHostedCodexCapabilityIssuer.prototype, "issue");
    await expect(issueThroughFactory("1", "factory-real-mint-denied", false, stockMint))
      .rejects.toThrow("hosted_historical_scope_denied");
    expect(deniedMintCapability).not.toHaveBeenCalled();
    deniedMintCapability.mockRestore();
    expect(tokenPreflight).not.toHaveBeenCalled();
    expect(tokenSend).not.toHaveBeenCalled();
    expect({ grants: await db.hostedCodexInvocationGrant.count(),
      mints: await db.hostedCodexCommentTokenMint.count(),
      effects: await db.hostedCodexUpstreamEffectAttempt.count() }).toEqual(beforeRealMintDenial);
    await intent("mint-new-head-intent", newHead, "mint-new-run");
    admittedHead = newHead;
    admittedRun = "mint-new-run";
    admittedJti = "historical-real-mint-allowed-jti";
    const mintedGrant = await issueThroughFactory("1", "factory-real-mint-allowed", false, stockMint);
    expect(mintedGrant).toMatchObject({ protocolVersion: 1,
      commentToken: "synthetic-provider-comment-token" });
    expect(tokenPreflight).toHaveBeenCalledOnce();
    expect(tokenSend).toHaveBeenCalledOnce();
    expect(directTokenIssue).not.toHaveBeenCalled();
    const mintRow = await db.hostedCodexCommentTokenMint.findFirstOrThrow({
      where: { grantId: mintedGrant.invocationLeaseId }, select: {
        state: true, tokenHash: true, providerAttempt: true, revision: true, fenceEpoch: true,
        dispatchStartedAt: true, deliveredAt: true, deliveryClaimIdHash: true,
        deliveryClaimExpiresAt: true,
      },
    });
    expect(mintRow).toMatchObject({ state: "issued", tokenHash: sha("synthetic-provider-comment-token"),
      providerAttempt: 1 });
    expect(mintRow.revision).toBeGreaterThan(1n);
    expect(mintRow.fenceEpoch).toBeGreaterThan(0n);
    expect(mintRow.dispatchStartedAt).toBeInstanceOf(Date);
    expect(mintRow.deliveredAt).toBeInstanceOf(Date);
    expect(mintRow.deliveryClaimIdHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(mintRow.deliveryClaimExpiresAt).toBeInstanceOf(Date);
    expect(await db.hostedCodexCommentTokenMint.count({
      where: { grantId: mintedGrant.invocationLeaseId },
    })).toBe(1);
    expect(mintedGrant[hostedCommentTokenDelivery]).toBeTypeOf("function");
    await mintedGrant[hostedCommentTokenDelivery]?.();
    expect((await db.hostedCodexCommentTokenMint.findFirstOrThrow({
      where: { grantId: mintedGrant.invocationLeaseId },
      select: { deliveryClaimIdHash: true, deliveryClaimExpiresAt: true },
    }))).toEqual({ deliveryClaimIdHash: null, deliveryClaimExpiresAt: null });
    // Red if a response-loss retry performs a second provider POST or resets
    // the minted grant. HTTP close released the first delivery claim above.
    const beforeMintRetryGrantCount = await db.hostedCodexInvocationGrant.count();
    admittedJti = "historical-real-mint-retry-jti";
    const replayedMintGrant = await issueThroughFactory("1", "factory-real-mint-retry", false, stockMint);
    expect(replayedMintGrant).toMatchObject({ invocationLeaseId: mintedGrant.invocationLeaseId,
      commentToken: mintedGrant.commentToken });
    expect(tokenPreflight).toHaveBeenCalledOnce();
    expect(tokenSend).toHaveBeenCalledOnce();
    expect(directTokenIssue).not.toHaveBeenCalled();
    expect(await db.hostedCodexInvocationGrant.count()).toBe(beforeMintRetryGrantCount);
    expect(await db.hostedCodexCommentTokenMint.count({
      where: { grantId: mintedGrant.invocationLeaseId },
    })).toBe(1);
    const replayedMintRow = await db.hostedCodexCommentTokenMint.findFirstOrThrow({
      where: { grantId: mintedGrant.invocationLeaseId },
      select: { state: true, providerAttempt: true, tokenHash: true, deliveryClaimIdHash: true },
    });
    expect(replayedMintRow).toMatchObject({ state: "issued", providerAttempt: 1,
      tokenHash: sha("synthetic-provider-comment-token") });
    expect(replayedMintRow.deliveryClaimIdHash).toMatch(/^[a-f0-9]{64}$/u);
    await replayedMintGrant[hostedCommentTokenDelivery]?.();
    expect((await db.hostedCodexCommentTokenMint.findFirstOrThrow({
      where: { grantId: mintedGrant.invocationLeaseId }, select: { deliveryClaimIdHash: true },
    })).deliveryClaimIdHash).toBeNull();
    const apiMintPrivileges = await db.$queryRaw<Array<{ canReadMint: boolean; canRunSnapshot: boolean }>>`
      SELECT pg_catalog.has_table_privilege('reviewrouter_api',
        'public."HostedCodexCommentTokenMint"', 'SELECT') AS "canReadMint",
        pg_catalog.has_function_privilege('reviewrouter_api',
          'public.hosted_codex_comment_token_authority_snapshot(text)', 'EXECUTE') AS "canRunSnapshot"`;
    expect(apiMintPrivileges).toEqual([{ canReadMint: false, canRunSnapshot: false }]);
    await expect(apiDb.$queryRaw`SELECT count(*) FROM public."HostedCodexCommentTokenMint"`)
      .rejects.toThrow(/permission denied|42501/u);
    // Red if effective grants or SET-role reachability let the API bypass
    // custody separation despite the catalog inventory above.
    await expect(apiDb.$queryRaw`
      SELECT public.hosted_codex_comment_token_authority_snapshot(${mintedGrant.invocationLeaseId})`)
      .rejects.toThrow(/permission denied|42501/u);
    await expect(apiDb.$transaction((tx) =>
      tx.$executeRawUnsafe("SET LOCAL ROLE reviewrouter_comment_token_custody")))
      .rejects.toThrow(/permission denied|42501/u);
    await expect(barrier.assertGrantAllowed("fresh-new-head")).resolves.toBeUndefined();
    await expect(barrier.assertAdmissionAllowed({ workspaceId: "hs-workspace", repositoryConnectionId: "hs-repo",
      reviewRequestId: "new-attempt-intent", grantId: "fresh-old-head", invocationId: "new-invocation",
      providerInvocationKey: sha("new-provider"), runId: "new-run" })).rejects.toThrow("hosted_historical_scope_denied");
    // Two tenants have independent denied old heads; the other tenant's new
    // trusted head remains eligible.
    await expect(barrier.assertAdmissionAllowed({ workspaceId: "other-workspace", repositoryConnectionId: "other-repo",
      reviewRequestId: "other-tenant-intent", grantId: "other-grant", invocationId: "other-invocation",
      providerInvocationKey: sha("other-provider"), runId: "other-run" }))
      .rejects.toThrow("hosted_historical_scope_denied");
    await expect(barrier.assertAdmissionAllowed({ workspaceId: "other-workspace", repositoryConnectionId: "other-repo",
      reviewRequestId: "other-tenant-new-head", grantId: "other-new-grant", invocationId: "other-new-invocation",
      providerInvocationKey: sha("other-new-provider"), runId: "other-new-run" })).resolves.toBeUndefined();
    await expect(new PrismaHostedHistoricalScopeBarrier(db, { required: false, resourceIdentity: resource,
      incarnation }).assertGrantAllowed("fresh-new-head")).rejects.toThrow("hosted_historical_scope_denied");
    // Red if moving the destination DB under a different physical identity
    // silently enables the existing marker.
    await expect(new PrismaHostedHistoricalScopeBarrier(db, { required: true,
      resourceIdentity: "other-physical-resource", incarnation }).assertGrantAllowed("fresh-new-head"))
      .rejects.toThrow("hosted_historical_scope_denied");
  }, 120_000);
});
