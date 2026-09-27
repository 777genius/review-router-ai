import { createPublicKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "../packages/platform/db/src/index.js";
import {
  CredentialEnvelopeVault, EnvCredentialKeyring,
} from "../packages/features/hosted-account-pool/src/infrastructure/crypto/credential-envelope-vault.js";
import {
  PrismaHostedCredentialEnrollment, PrismaHostedPoolRepository,
} from "../packages/features/hosted-account-pool/src/infrastructure/prisma/prisma-hosted-account-pool-adapters.js";
import { PrismaHostedCodexSessionPersistence } from "../packages/features/hosted-account-pool/src/infrastructure/prisma/prisma-hosted-codex-session-persistence.js";
import {
  consumeCommentTokenRefreshCapabilityInTransaction, PrismaInvocationGrantRepository,
} from "../packages/features/hosted-account-pool/src/infrastructure/prisma/prisma-invocation-grant-repository.js";
import {
  createDefaultHostedAccountPool, hostedAccountId, hostedPoolId, invocationGrantId,
  invocationId, workspaceId,
} from "../packages/features/hosted-account-pool/src/index.js";
import {
  applyLocalCustodyRebind, assertDisposableDatabaseUrl, assertQuiescentAuthority,
  canonicalJson, loadLocalRebindSnapshot,
  OPERATION, PINNED_SOURCE_SHA, readCommittedRebindReceipt, sha256,
  validateAdmission, type ValidatedAdmission,
} from "./hosted-pool-local-custody-rebind.js";

const databaseUrl = process.env.REVIEW_ROUTER_LOCAL_CUSTODY_REBIND_PG17_URL;
const enabled = !!databaseUrl;
if (databaseUrl) {
  assertDisposableDatabaseUrl(databaseUrl, "test");
}
const prisma = databaseUrl ? createPrismaClient({ databaseUrl, poolMax: 4 }) : null;
const sourceIdentity = "synthetic-source-resource-identity";
const sourceIncarnation = "synthetic-source-incarnation";
const targetIdentity = "synthetic-target-resource-identity";
const targetIncarnation = "synthetic-target-incarnation";
const keyId = "synthetic-local-kek";
const targetRecoveryWitness = Buffer.alloc(32, 41).toString("base64url");
const targetRecoveryWitnessHash = sha256(targetRecoveryWitness);
let targetPhysicalGeneration: string;
const keyringJson = JSON.stringify({ [keyId]: Buffer.alloc(32, 23).toString("base64") });
const pepper = Buffer.alloc(32, 31);
const env = {
  REVIEW_ROUTER_CUSTODY_OFFLINE_TARGET: "1",
  REVIEW_ROUTER_HOSTED_CODEX_DATABASE_RESOURCE_IDENTITY: targetIdentity,
  REVIEW_ROUTER_HOSTED_CODEX_DATABASE_INCARNATION: targetIncarnation,
  REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS: targetRecoveryWitness,
  REVIEW_ROUTER_HOSTED_CODEX_KEK_KEYRING_JSON: keyringJson,
  REVIEW_ROUTER_HOSTED_CODEX_FINGERPRINT_PEPPER: pepper.toString("base64"),
};
const prefix = randomUUID().slice(0, 12);
const workspace = workspaceId(`custody-${prefix}`);
const pool = hostedPoolId(`custody-pool-${prefix}`);
const accountIds = [
  hostedAccountId(`custody-account-a-${prefix}`),
  hostedAccountId(`custody-account-b-${prefix}`),
  hostedAccountId(`custody-account-c-${prefix}`),
] as const;
const installationId = `custody-installation-${prefix}`;
const repositoryId = `custody-repository-${prefix}`;
const bindingId = `custody-binding-${prefix}`;
const grantId = `custody-grant-${prefix}`;
const oldInvocationId = invocationId(`custody-invocation-${prefix}`);
let admission: ValidatedAdmission;
let expectedInventoryHash: string;
let network: ReturnType<typeof vi.spyOn> | undefined;

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    document(payload: Record<string, string | number>) {
      return { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64") };
    },
  };
}
const manifestSigner = signer();
const provisioningSigner = signer();
const fenceSigner = signer();

function syntheticAdmission(overrides: { inventoryHash?: string; inventoryCount?: number; physicalGeneration?: string } = {}) {
  const finalArchiveHash = "c".repeat(64);
  const provisioningEvidence = provisioningSigner.document({
    resourceIdentity: targetIdentity, incarnation: targetIncarnation,
    physicalGeneration: overrides.physicalGeneration ?? targetPhysicalGeneration,
    recoveryWitnessHash: targetRecoveryWitnessHash, sourceArchiveHash: finalArchiveHash,
    targetOfflineState: "isolated",
    observedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  });
  const writerFenceEvidence = fenceSigner.document({
    sourceResourceIdentity: sourceIdentity, sourceIncarnation,
    finalArchiveHash, writerFenceState: "fenced",
    fencedAt: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
  });
  const manifest = manifestSigner.document({
    operation: OPERATION, nonce: "synthetic_nonce_1234567890123456",
    toolSourceSha: PINNED_SOURCE_SHA, toolCommitSha: "d".repeat(40), finalArchiveHash,
    toolSha256: sha256(readFileSync(new URL("./hosted-pool-local-custody-rebind.ts", import.meta.url))),
    sourceResourceIdentity: sourceIdentity, sourceIncarnation,
    targetResourceIdentity: targetIdentity, targetIncarnation,
    targetPhysicalGeneration: overrides.physicalGeneration ?? targetPhysicalGeneration,
    targetRecoveryWitnessHash,
    inventoryHash: overrides.inventoryHash ?? expectedInventoryHash,
    inventoryCount: overrides.inventoryCount ?? 3,
    writerFenceEvidenceHash: sha256(canonicalJson(writerFenceEvidence.payload)),
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  return validateAdmission({ manifest, provisioningEvidence, writerFenceEvidence,
    manifestPublicKeyPem: manifestSigner.publicKeyPem,
    provisioningPublicKeyPem: provisioningSigner.publicKeyPem,
    fencePublicKeyPem: fenceSigner.publicKeyPem,
    expectedManifestKeyHash: sha256(createPublicKey(manifestSigner.publicKeyPem).export({ format: "der", type: "spki" })),
    expectedProvisioningKeyHash: sha256(createPublicKey(provisioningSigner.publicKeyPem).export({ format: "der", type: "spki" })),
    expectedFenceKeyHash: sha256(createPublicKey(fenceSigner.publicKeyPem).export({ format: "der", type: "spki" })) });
}

function authJson(subject: string) {
  const claims = Buffer.from(JSON.stringify({
    iss: "https://auth.openai.com", sub: subject,
    "https://api.openai.com/auth": { chatgpt_account_id: `synthetic-${subject}` },
  })).toString("base64url");
  return Buffer.from(JSON.stringify({ auth_mode: "chatgpt", tokens: {
    access_token: `synthetic-access-${subject}`,
    refresh_token: `synthetic-refresh-${subject}`,
    id_token: `e30.${claims}.signature`,
  }, last_refresh: new Date().toISOString() }));
}

beforeAll(async () => {
  if (!prisma) return;
  network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("network_provider_call_forbidden");
  });
  await prisma.$connect();
  const version = await prisma.$queryRawUnsafe<{ version: string }[]>(
    "SELECT current_setting('server_version_num') AS version");
  if (!version[0] || Number(version[0].version) < 170000 || Number(version[0].version) >= 180000)
    throw new Error("custody_test_pg17_required");
  const system = await prisma.$queryRawUnsafe<{ system_identifier: string }[]>(
    "SELECT system_identifier::text AS system_identifier FROM pg_catalog.pg_control_system()");
  targetPhysicalGeneration = system[0]!.system_identifier;
  await setGenerationBinding({ version: 1, systemIdentifier: targetPhysicalGeneration,
    recoveryWitnessSha256: targetRecoveryWitnessHash });
  if (await prisma.hostedCodexAccount.count() !== 0)
    throw new Error("custody_test_database_not_empty");
  if (!await prisma.hostedCodexRuntimeGate.findUnique({ where: { id: "global" } })) {
    await prisma.hostedCodexRuntimeGate.create({ data: {
      id: "global", status: "closed", authzEpoch: 1n, revision: 1n,
      reasonCode: "synthetic_fixture_closed", changedAt: new Date(),
      changedByHash: sha256("synthetic-fixture"),
    } });
  }
  await prisma.workspace.create({ data: { id: workspace, slug: `custody-${prefix}`, name: "Synthetic custody fixture" } });
  await new PrismaHostedPoolRepository(prisma).insertDefault(
    createDefaultHostedAccountPool({ id: pool, workspaceId: workspace, now: new Date() }));
  const vault = new CredentialEnvelopeVault(new EnvCredentialKeyring({
    REVIEW_ROUTER_HOSTED_CODEX_KEK_CURRENT_ID: keyId,
    REVIEW_ROUTER_HOSTED_CODEX_KEK_KEYRING_JSON: keyringJson,
  }));
  const enrollment = new PrismaHostedCredentialEnrollment(prisma, vault,
    sourceIncarnation, sourceIdentity, pepper);
  for (let i = 0; i < accountIds.length; i += 1) {
    await enrollment.importCodexAuth({
      workspaceId: workspace, poolId: pool, accountId: accountIds[i]!,
      label: `Synthetic ${i}`, priority: i, expectedPoolRevision: i + 1,
      authJsonBytes: authJson(`subject-${i}`), now: new Date(),
    });
  }
  await prisma.hostedCodexAccount.update({ where: { id: accountIds[2] },
    data: { state: "restore_quarantined", healthVersion: { increment: 1 } } });
  const currentGate = await prisma.hostedCodexRuntimeGate.findUniqueOrThrow({ where: { id: "global" } });
  if (currentGate.status === "closed") {
    const closure = await prisma.hostedCodexRuntimeClosure.upsert({
      where: { gateRevision: currentGate.revision },
      create: { id: `custody-closure-${prefix}`, gateRevision: currentGate.revision,
        closedAuthzEpoch: currentGate.authzEpoch,
        actorHash: sha256("synthetic-custody-closure"),
        reasonHash: sha256("synthetic-custody-activation"),
        legacyBarrier: true, legacyUnsafeUntil: new Date(0) },
      update: {},
    });
    // Disposable fixture bootstrap follows the existing hosted PG17 E2E
    // setup; no application or migration code bypass is introduced.
    if (closure.state !== "complete") {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
        await tx.hostedCodexRuntimeClosure.update({
          where: { gateRevision: currentGate.revision },
          data: { state: "complete", completedAt: new Date(),
            legacyBarrier: false, legacyUnsafeUntil: new Date(0),
            revision: { increment: 1 } },
        });
      });
    }
    await prisma.hostedCodexRuntimeGate.update({ where: { id: "global" },
      data: { status: "active", authzEpoch: { increment: 1 },
        revision: { increment: 1 }, reasonCode: `synthetic_custody_activation_${prefix}`,
        changedByHash: sha256("synthetic-custody-activation"),
        changedAt: new Date(Math.max(Date.now(), currentGate.changedAt.getTime() + 1)) } });
  }
  const gate = await prisma.hostedCodexRuntimeGate.findUniqueOrThrow({ where: { id: "global" } });
  await prisma.gitHubInstallation.create({ data: {
    id: installationId, workspaceId: workspace, githubInstallationId: 990001n,
    accountLogin: `synthetic-${prefix}`, accountType: "Organization",
    repositorySelection: "selected", status: "active",
  } });
  await prisma.repositoryConnection.create({ data: {
    id: repositoryId, workspaceId: workspace, provider: "github",
    externalRepositoryId: "990002", installationId,
    githubRepositoryId: 990002n, owner: `synthetic-${prefix}`,
    name: "disposable-fixture", fullName: `synthetic-${prefix}/disposable-fixture`,
    defaultBranch: "main", visibility: "private", selected: true, archived: false,
  } });
  await prisma.hostedCodexRepositoryBinding.create({ data: {
    id: bindingId, workspaceId: workspace, poolId: pool,
    repositoryConnectionId: repositoryId, status: "active",
    revision: 1n, stateVersion: 1n,
    workflowPath: ".github/workflows/reviewrouter-codex.yml",
    workflowActionRef: `reviewrouter/action@${"a".repeat(40)}`,
    workflowSourceCommitSha: "b".repeat(40), workflowSourceBlobSha: "c".repeat(40),
    workflowSourceSha256: "d".repeat(64), workflowSemanticSha256: "e".repeat(64),
    workflowSourceTrust: "trusted_default_branch_revision",
    attestedGithubRepositoryId: 990002n, attestedBindingRevision: 1n,
    activatedAt: new Date(),
  } });
  const expiresAt = new Date(Date.now() + 60 * 60_000);
  await prisma.hostedCodexInvocationGrant.create({ data: {
    id: grantId, invocationId: oldInvocationId, workspaceId: workspace,
    poolId: pool, repositoryConnectionId: repositoryId,
    repositoryBindingId: bindingId, activeAccountId: accountIds[0],
    primaryAccountId: accountIds[0], backupAccountId: accountIds[1],
    reviewRequestId: `synthetic-review-${prefix}`,
    providerInvocationKey: `synthetic-provider-${prefix}`,
    runId: `synthetic-run-${prefix}`, runAttempt: 1, model: "gpt-5.5",
    policyVersion: "hosted-codex-v1", policyFingerprint: sha256(`policy-${prefix}`),
    runtimeConfigVersion: 1, bindingRevision: 1n, authzEpoch: 1n,
    runtimeAuthzEpoch: gate.authzEpoch,
    capabilityTokenHash: sha256(`grant-capability-${prefix}`),
    expiresAt, maxRequests: 1, maxConcurrentRequests: 1, maxRequestBytes: 1024,
  } });
  await prisma.hostedCodexCommentRefreshCapability.create({ data: {
    grantId, invocationId: oldInvocationId,
    repositoryBindingId: bindingId, workspaceId: workspace, poolId: pool,
    repositoryConnectionId: repositoryId,
    capabilityTokenHash: sha256(`refresh-capability-${prefix}`),
    expiresAt, maxUses: 1,
  } });
  const snapshot = await loadLocalRebindSnapshot(prisma);
  const rows = [...snapshot.rows].sort((a, b) => a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0);
  expectedInventoryHash = sha256(canonicalJson(rows));
  admission = syntheticAdmission();
}, 120_000);

async function setGenerationBinding(binding: unknown): Promise<void> {
  const ddl = await prisma!.$queryRawUnsafe<{ sql: string }[]>(
    "SELECT pg_catalog.format('COMMENT ON DATABASE %I IS %L', current_database(), $1::text) AS sql",
    binding === null ? null : JSON.stringify(binding));
  await prisma!.$executeRawUnsafe(ddl[0]!.sql);
}

afterAll(async () => {
  network?.mockRestore();
  await prisma?.$disconnect();
}, 120_000);

describe.runIf(enabled)("offline local_test custody rebind on disposable PG17", () => {
  it("rejects a different physical cluster or invalid connected generation binding", async () => {
    const before = await prisma!.hostedCodexCredentialEnvelopeRevision.count();
    const other = targetPhysicalGeneration === "12345678901234567890"
      ? "12345678901234567891" : "12345678901234567890";
    const wrong = syntheticAdmission({ physicalGeneration: other });
    await expect(readCommittedRebindReceipt(prisma!, wrong))
      .rejects.toThrow("custody_target_generation_mismatch");
    await expect(applyLocalCustodyRebind({ prisma: prisma!, admission: wrong, env }))
      .rejects.toThrow("custody_target_generation_mismatch");
    await setGenerationBinding(null);
    try {
      await expect(readCommittedRebindReceipt(prisma!, admission))
        .rejects.toThrow("custody_target_generation_binding_invalid");
    } finally {
      await setGenerationBinding({ version: 1, systemIdentifier: targetPhysicalGeneration,
        recoveryWitnessSha256: targetRecoveryWitnessHash });
    }
    await setGenerationBinding({ version: 1, systemIdentifier: targetPhysicalGeneration,
      recoveryWitnessSha256: "0".repeat(64) });
    await expect(readCommittedRebindReceipt(prisma!, admission))
      .rejects.toThrow("custody_target_generation_mismatch");
    await setGenerationBinding({ version: 1, systemIdentifier: other,
      recoveryWitnessSha256: targetRecoveryWitnessHash });
    await expect(readCommittedRebindReceipt(prisma!, admission))
      .rejects.toThrow("custody_target_generation_mismatch");
    await setGenerationBinding({ version: 1, systemIdentifier: targetPhysicalGeneration,
      recoveryWitnessSha256: targetRecoveryWitnessHash });
    expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(before);
  }, 120_000);
  it("refuses an open target runtime gate before any key or revision write", async () => {
    const snapshot = await loadLocalRebindSnapshot(prisma!);
    expect(snapshot.authority.unsafeRuntimeGate).toBe(1);
    await expect(applyLocalCustodyRebind({ prisma: prisma!, admission, env }))
      .rejects.toThrow("custody_authority_unsafeRuntimeGate_unresolved");
    expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(3);
    await prisma!.hostedCodexRuntimeGate.update({ where: { id: "global" },
      data: { status: "closed", authzEpoch: { increment: 1 },
        revision: { increment: 1 }, reasonCode: `synthetic_offline_target_${prefix}`,
        changedByHash: sha256("synthetic-offline-target"), changedAt: new Date() } });
  }, 120_000);

  it("keeps preflight read-only with an issued grant and a quarantined account", async () => {
    const beforeRevisions = await prisma!.hostedCodexCredentialEnvelopeRevision.count();
    const beforeGrant = await prisma!.hostedCodexInvocationGrant.findUniqueOrThrow({ where: { id: grantId } });
    const beforeQuarantined = await prisma!.hostedCodexAccount.findUniqueOrThrow({ where: { id: accountIds[2] } });
    const snapshot = await loadLocalRebindSnapshot(prisma!);
    expect(() => assertQuiescentAuthority(snapshot.authority)).not.toThrow();
    expect(snapshot.rows).toHaveLength(3);
    expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(beforeRevisions);
    expect(await prisma!.hostedCodexInvocationGrant.findUniqueOrThrow({ where: { id: grantId } }))
      .toMatchObject({ status: beforeGrant.status, revision: beforeGrant.revision });
    expect(await prisma!.hostedCodexAccount.findUniqueOrThrow({ where: { id: accountIds[2] } }))
      .toMatchObject({ state: beforeQuarantined.state, healthVersion: beforeQuarantined.healthVersion });
  }, 120_000);

  it("blocks an owned mutation fence until its existing release contract reconciles it", async () => {
    await prisma!.hostedCodexMutationFence.create({ data: {
      accountId: accountIds[0], workspaceId: workspace, poolId: pool,
      fenceEpoch: 1n, ownerIdHash: sha256("synthetic-fence-owner"),
      expectedGeneration: 1n, expiresAt: new Date(Date.now() - 60_000),
    } });
    try {
      const snapshot = await loadLocalRebindSnapshot(prisma!);
      expect(snapshot.authority.activeMutationFences).toBe(1);
      expect(() => assertQuiescentAuthority(snapshot.authority))
        .toThrow("custody_authority_activeMutationFences_unresolved");
      await expect(applyLocalCustodyRebind({ prisma: prisma!, admission, env }))
        .rejects.toThrow("custody_authority_activeMutationFences_unresolved");
      expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(3);
    } finally {
      await prisma!.hostedCodexMutationFence.update({ where: { accountId: accountIds[0] },
        data: { ownerIdHash: null, expectedGeneration: null, expiresAt: null,
          releasedAt: new Date(), releaseReason: "synthetic_reconciled" } });
    }
  }, 120_000);

  it("rolls back a wrong local KEK before any revision or authority write", async () => {
    const before = await prisma!.hostedCodexCredentialEnvelopeRevision.count();
    await expect(applyLocalCustodyRebind({ prisma: prisma!, admission,
      env: { ...env, REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS: Buffer.alloc(32, 42).toString("base64url") } }))
      .rejects.toThrow("custody_target_runtime_witness_mismatch");
    await expect(applyLocalCustodyRebind({ prisma: prisma!, admission,
      env: { ...env, REVIEW_ROUTER_HOSTED_CODEX_DATABASE_RESOURCE_IDENTITY: sourceIdentity } }))
      .rejects.toThrow("custody_target_runtime_witness_mismatch");
    await expect(applyLocalCustodyRebind({ prisma: prisma!, admission,
      env: { ...env, REVIEW_ROUTER_CUSTODY_OFFLINE_TARGET: "0" } }))
      .rejects.toThrow("custody_offline_target_confirmation_required");
    const wrong = { ...env,
      REVIEW_ROUTER_HOSTED_CODEX_KEK_KEYRING_JSON: JSON.stringify({ [keyId]: Buffer.alloc(32, 77).toString("base64") }) };
    await expect(applyLocalCustodyRebind({ prisma: prisma!, admission, env: wrong })).rejects.toThrow();
    expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(before);
    expect(await readCommittedRebindReceipt(prisma!, admission)).toBeNull();
  }, 120_000);

  it("rejects a changed or omitted active generation without writes", async () => {
    const before = await prisma!.hostedCodexCredentialEnvelopeRevision.count();
    await expect(applyLocalCustodyRebind({ prisma: prisma!,
      admission: syntheticAdmission({ inventoryHash: "0".repeat(64) }), env }))
      .rejects.toThrow("custody_inventory_hash_mismatch");
    await expect(applyLocalCustodyRebind({ prisma: prisma!,
      admission: syntheticAdmission({ inventoryCount: 2 }), env }))
      .rejects.toThrow("custody_readback_inventory_membership_mismatch");
    expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(before);
    expect(await prisma!.hostedCodexInvocationGrant.findUniqueOrThrow({ where: { id: grantId } }))
      .toMatchObject({ status: "issued" });
  }, 120_000);

  it("rolls back the first appended revision when a later insert aborts", async () => {
    await prisma!.$executeRawUnsafe(`
      CREATE FUNCTION public.custody_rebind_abort_fixture() RETURNS trigger
      LANGUAGE plpgsql AS $fixture$
      BEGIN
        IF NEW."reason" = 'restore_reconciliation' AND
           (SELECT count(*) FROM public."HostedCodexCredentialEnvelopeRevision"
            WHERE "reason" = 'restore_reconciliation') >= 1 THEN
          RAISE EXCEPTION 'synthetic_crash_before_commit';
        END IF;
        RETURN NEW;
      END
      $fixture$`);
    await prisma!.$executeRawUnsafe(`
      CREATE TRIGGER custody_rebind_abort_fixture
      BEFORE INSERT ON public."HostedCodexCredentialEnvelopeRevision"
      FOR EACH ROW EXECUTE FUNCTION public.custody_rebind_abort_fixture()`);
    try {
      await expect(applyLocalCustodyRebind({ prisma: prisma!, admission, env }))
        .rejects.toThrow();
    } finally {
      await prisma!.$executeRawUnsafe(`DROP TRIGGER custody_rebind_abort_fixture ON public."HostedCodexCredentialEnvelopeRevision"`);
      await prisma!.$executeRawUnsafe(`DROP FUNCTION public.custody_rebind_abort_fixture()`);
    }
    expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(3);
    expect(await prisma!.hostedCodexInvocationGrant.findUniqueOrThrow({ where: { id: grantId } }))
      .toMatchObject({ status: "issued" });
    expect(await readCommittedRebindReceipt(prisma!, admission)).toBeNull();
  }, 120_000);

  it("commits once under concurrency, supports lost-response readback, and preserves serving state", async () => {
    const originalVersions = await prisma!.hostedCodexCredentialVersion.findMany({
      orderBy: { id: "asc" },
      select: { id: true, accountId: true, generation: true, generationHash: true, keyId: true },
    });
    const attempts = await Promise.allSettled([
      applyLocalCustodyRebind({ prisma: prisma!, admission, env }),
      applyLocalCustodyRebind({ prisma: prisma!, admission, env }),
    ]);
    expect(attempts.every((result) => result.status === "fulfilled")).toBe(true);
    expect(attempts.filter((result) => result.status === "fulfilled" && result.value.status === "applied")).toHaveLength(1);
    const receipt = await readCommittedRebindReceipt(prisma!, admission);
    expect(receipt).toMatchObject({ status: "already_applied", revisionCount: 3 });
    await setGenerationBinding({ version: 1, systemIdentifier: targetPhysicalGeneration,
      recoveryWitnessSha256: "0".repeat(64) });
    await expect(readCommittedRebindReceipt(prisma!, admission))
      .rejects.toThrow("custody_target_generation_mismatch");
    await setGenerationBinding({ version: 1, systemIdentifier: targetPhysicalGeneration,
      recoveryWitnessSha256: targetRecoveryWitnessHash });
    await expect(applyLocalCustodyRebind({ prisma: prisma!, admission,
      env: { ...env, REVIEW_ROUTER_HOSTED_CODEX_KEK_KEYRING_JSON: undefined,
        REVIEW_ROUTER_HOSTED_CODEX_FINGERPRINT_PEPPER: undefined } }))
      .resolves.toMatchObject({ status: "already_applied", receiptHash: receipt?.receiptHash });
    await expect(applyLocalCustodyRebind({ prisma: prisma!,
      admission: syntheticAdmission({ inventoryHash: "0".repeat(64) }), env }))
      .rejects.toThrow("custody_readback_receipt_conflict");
    expect(await prisma!.hostedCodexCredentialEnvelopeRevision.count()).toBe(6);
    expect(await prisma!.hostedCodexCredentialVersion.findMany({
      orderBy: { id: "asc" },
      select: { id: true, accountId: true, generation: true, generationHash: true, keyId: true },
    })).toEqual(originalVersions);
    const targetVault = new CredentialEnvelopeVault(new EnvCredentialKeyring({
      REVIEW_ROUTER_HOSTED_CODEX_KEK_CURRENT_ID: keyId,
      REVIEW_ROUTER_HOSTED_CODEX_KEK_KEYRING_JSON: keyringJson,
    }));
    const sessions = new PrismaHostedCodexSessionPersistence(prisma!, targetVault,
      targetIncarnation, targetIdentity, pepper);
    for (const accountId of accountIds.slice(0, 2)) {
      const read = await sessions.read(accountId);
      expect(read?.authJsonBytes.byteLength).toBeGreaterThan(0);
      read?.authJsonBytes.fill(0);
    }
    const first = await prisma!.hostedCodexCredentialVersion.findFirstOrThrow({
      where: { accountId: accountIds[0], generation: 1n },
      include: { envelopeRevisions: { orderBy: { revision: "desc" }, take: 1 } },
    });
    const latest = first.envelopeRevisions[0]!;
    const metadata = latest.envelopeMetadata as unknown as {
      nonce: string; authenticationTag: string;
      wrappedDataEncryptionKey: {
        keyId: string; nonce: string; ciphertext: string; authenticationTag: string;
      };
    };
    await expect(targetVault.decrypt({
      schemaVersion: 1, encryptionAlgorithm: "aes-256-gcm", keyId,
      nonce: metadata.nonce, authenticationTag: metadata.authenticationTag,
      wrappedDataEncryptionKey: metadata.wrappedDataEncryptionKey,
      ciphertext: latest.encryptedCiphertext, associatedDataHash: latest.aadHash,
      ciphertextHash: latest.ciphertextHash,
    }, { workspaceId: workspace, poolId: pool, accountId: accountIds[0],
      generation: 1, databaseIncarnation: sourceIncarnation,
      databaseResourceIdentity: sourceIdentity }))
      .rejects.toThrow("credential_envelope_context_mismatch");
    await expect(sessions.read(accountIds[2])).rejects.toThrow("hosted_codex_account_not_servable");
    const states = await prisma!.hostedCodexAccount.findMany({
      where: { id: { in: [...accountIds] } }, select: { id: true, state: true, healthVersion: true },
    });
    expect(states.find((row) => row.id === accountIds[2])?.state).toBe("restore_quarantined");
    expect(states.find((row) => row.id === accountIds[2])?.healthVersion).toBe(2n);
    const versions = await prisma!.hostedCodexCredentialVersion.findMany({
      where: { accountId: { in: [...accountIds] } }, select: { keyId: true },
    });
    expect(versions.every((version) => version.keyId === keyId)).toBe(true);
    const oldGrant = await prisma!.hostedCodexInvocationGrant.findUniqueOrThrow({ where: { id: grantId } });
    const oldRefresh = await prisma!.hostedCodexCommentRefreshCapability.findUniqueOrThrow({ where: { grantId } });
    expect(oldGrant.status).toBe("revoked");
    expect(oldRefresh.revokedAt).not.toBeNull();
    await expect(new PrismaInvocationGrantRepository(prisma!).findByInvocationId(oldInvocationId))
      .rejects.toThrow("hosted_codex_runtime_gate_authority_mismatch");
    await expect(prisma!.$transaction((tx) => consumeCommentTokenRefreshCapabilityInTransaction(
      tx, { grantId: invocationGrantId(grantId),
        presentedTokenHash: sha256(`refresh-capability-${prefix}`),
        requestIdHash: sha256(`replay-${prefix}`), now: new Date(),
        transition: () => { throw new Error("old_refresh_capability_accepted"); } },
      `synthetic-mint-${prefix}`,
    ))).rejects.toThrow("hosted_codex_runtime_gate_authority_mismatch");
    expect(network).toHaveBeenCalledTimes(0);
  }, 120_000);
});
