/** Offline custody rebind admission. This module deliberately imports no provider client. */
import {
  createHash,
  createPublicKey,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma, PrismaClient } from "@prisma/client";

export const PINNED_SOURCE_SHA = "4b62618a1301bacf7ac4bc4c0a986c5a05881afe";
export const OPERATION = "reviewrouter-local-test-custody-rebind-v1";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("custody_document_invalid");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertDisposableDatabaseUrl(
  value: string | undefined,
  nodeEnv: string | undefined,
): string {
  if (!value || nodeEnv === "production")
    throw new Error("custody_disposable_database_required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("custody_disposable_database_required");
  }
  const parameters = [...url.searchParams.entries()];
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    parameters.length > 1 ||
    parameters.some(
      ([key, parameter]) => key !== "schema" || parameter !== "public",
    ) ||
    url.hash !== "" ||
    !/^\/reviewrouter_custody_rebind_[A-Za-z0-9_]+$/u.test(url.pathname)
  )
    throw new Error("custody_disposable_database_required");
  return value;
}

export function assertPinnedCheckout(expectedCommitSha: string): void {
  if (!/^[a-f0-9]{40}$/u.test(expectedCommitSha))
    throw new Error("custody_tool_commit_invalid");
  const cwd = resolve(fileURLToPath(import.meta.url), "..", "..");
  let head: string;
  let dirty: string;
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    dirty = execFileSync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", PINNED_SOURCE_SHA, "HEAD"],
      {
        cwd,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
  } catch {
    throw new Error("custody_pinned_checkout_unverifiable");
  }
  if (head !== expectedCommitSha || dirty)
    throw new Error("custody_pinned_checkout_mismatch");
}

type SignedDocument = {
  readonly payload: Record<string, Json>;
  readonly signature: string;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("custody_document_invalid");
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0"))
    throw new Error("custody_document_fields_invalid");
}

function string(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value))
    throw new Error(`custody_${name}_invalid`);
  return value;
}

const opaque = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,254}$/u;
const hex = /^[a-f0-9]{64}$/u;
const noncePattern = /^[A-Za-z0-9_-]{24,128}$/u;

/** Operator provisioned trust anchors must be independent of signed files. */
export function assertTrustedAuthorities(input: {
  readonly manifestPublicKeyPem: string;
  readonly provisioningPublicKeyPem: string;
  readonly fencePublicKeyPem: string;
  readonly expectedManifestKeyHash: string | undefined;
  readonly expectedProvisioningKeyHash: string | undefined;
  readonly expectedFenceKeyHash: string | undefined;
}): void {
  const pairs = [
    [input.manifestPublicKeyPem, input.expectedManifestKeyHash],
    [input.provisioningPublicKeyPem, input.expectedProvisioningKeyHash],
    [input.fencePublicKeyPem, input.expectedFenceKeyHash],
  ] as const;
  for (const [pem, expected] of pairs) {
    if (!expected || !hex.test(expected))
      throw new Error("custody_authority_trust_anchor_missing");
    let actual: string;
    try {
      const key = createPublicKey(pem);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("key_type");
      actual = sha256(key.export({ format: "der", type: "spki" }));
    } catch {
      throw new Error("custody_authority_key_invalid");
    }
    if (actual !== expected)
      throw new Error("custody_authority_trust_anchor_mismatch");
  }
}

/** The document's signature covers exactly its canonical payload. */
export function verifySignedDocument(
  raw: unknown,
  publicKeyPem: string,
): SignedDocument {
  const doc = object(raw);
  exactKeys(doc, ["payload", "signature"]);
  const payload = object(doc.payload) as Record<string, Json>;
  const signature = string(
    doc.signature,
    "signature",
    /^[A-Za-z0-9+/]+={0,2}$/u,
  );
  const bytes = Buffer.from(signature, "base64");
  if (bytes.toString("base64") !== signature || bytes.length !== 64)
    throw new Error("custody_signature_invalid");
  let valid: boolean;
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error("key_type");
    valid = verify(null, Buffer.from(canonicalJson(payload)), key, bytes);
  } catch {
    throw new Error("custody_signature_invalid");
  } finally {
    bytes.fill(0);
  }
  if (!valid) throw new Error("custody_signature_invalid");
  return { payload, signature };
}

export type ValidatedAdmission = {
  readonly digest: string;
  readonly inventoryHash: string;
  readonly inventoryCount: number;
  readonly sourceResourceIdentity: string;
  readonly sourceIncarnation: string;
  readonly targetResourceIdentity: string;
  readonly targetIncarnation: string;
  readonly targetPhysicalGeneration: string;
  readonly targetDatabaseName: string;
  readonly targetDatabaseOid: string;
  readonly toolCommitSha: string;
  readonly targetRecoveryWitnessHash: string;
  readonly finalArchiveHash: string;
  readonly nonce: string;
  readonly expiresAt: string;
};

const admittedManifests = new WeakSet<object>();

function assertValidatedAdmission(admission: ValidatedAdmission): void {
  if (!admittedManifests.has(admission))
    throw new Error("custody_signed_admission_required");
}

function assertTargetRuntime(
  admission: ValidatedAdmission,
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (env.REVIEW_ROUTER_CUSTODY_OFFLINE_TARGET !== "1")
    throw new Error("custody_offline_target_confirmation_required");
  const witness = env.REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS?.trim();
  if (
    !witness ||
    !/^[A-Za-z0-9_-]{43,256}$/u.test(witness) ||
    /replace-with|placeholder/iu.test(witness)
  )
    throw new Error("custody_target_runtime_witness_missing");
  if (
    env.REVIEW_ROUTER_HOSTED_CODEX_DATABASE_RESOURCE_IDENTITY?.trim() !==
      admission.targetResourceIdentity ||
    env.REVIEW_ROUTER_HOSTED_CODEX_DATABASE_INCARNATION?.trim() !==
      admission.targetIncarnation ||
    sha256(witness) !== admission.targetRecoveryWitnessHash
  )
    throw new Error("custody_target_runtime_witness_mismatch");
}

/** Bind the signed target to the connected cluster, not just caller-supplied env. */
export async function assertConnectedTargetGeneration(
  tx: Prisma.TransactionClient,
  admission: ValidatedAdmission,
): Promise<void> {
  assertValidatedAdmission(admission);
  let rows: {
    system_identifier: string;
    database_name: string;
    database_oid: string;
    binding: string | null;
    server_version_num: string;
  }[];
  try {
    rows = await tx.$queryRawUnsafe(`
      SELECT system.system_identifier::text AS system_identifier,
             db.datname AS database_name, db.oid::text AS database_oid,
             pg_catalog.shobj_description(db.oid, 'pg_database') AS binding,
             current_setting('server_version_num') AS server_version_num
      FROM pg_catalog.pg_control_system() AS system
      JOIN pg_catalog.pg_database AS db ON db.datname = current_database()`);
  } catch {
    throw new Error("custody_target_generation_unverifiable");
  }
  if (
    rows.length !== 1 ||
    Number(rows[0]?.server_version_num) < 170000 ||
    Number(rows[0]?.server_version_num) >= 180000
  )
    throw new Error("custody_target_generation_unverifiable");
  let binding: Record<string, unknown>;
  try {
    binding = object(JSON.parse(rows[0]!.binding ?? "null"));
    exactKeys(binding, [
      "version",
      "systemIdentifier",
      "recoveryWitnessSha256",
    ]);
  } catch {
    throw new Error("custody_target_generation_binding_invalid");
  }
  if (
    binding.version !== 1 ||
    binding.systemIdentifier !== rows[0]!.system_identifier ||
    rows[0]!.system_identifier !== admission.targetPhysicalGeneration ||
    rows[0]!.database_name !== admission.targetDatabaseName ||
    rows[0]!.database_oid !== admission.targetDatabaseOid ||
    binding.recoveryWitnessSha256 !== admission.targetRecoveryWitnessHash
  )
    throw new Error("custody_target_generation_mismatch");
}

export type LocalCustodyInventoryRow = {
  readonly workspaceId: string;
  readonly poolId: string;
  readonly accountId: string;
  readonly state: string;
  readonly healthVersion: string;
  readonly activeGeneration: string;
  readonly credentialVersionId: string;
  readonly generation: string;
  readonly generationHash: string;
  readonly credentialKeyId: string;
  readonly revision: string;
  readonly sourceRevision: string | null;
  readonly aadHash: string;
  readonly ciphertextHash: string;
  readonly envelopeMetadataHash: string;
  readonly custodyMode: string;
  readonly kmsKeyArn: string | null;
  readonly kmsContextVersion: number;
  readonly envelopeVersion: number;
  readonly encryptionAlgorithm: string;
  readonly databaseResourceIdentity: string | null;
  readonly databaseIncarnation: string;
};

/** Hash the entire active generation set, including quarantined accounts. */
export function assessLocalCustodyInventory(input: {
  readonly rows: readonly LocalCustodyInventoryRow[];
  readonly expectedCount: number;
  readonly sourceResourceIdentity: string;
  readonly sourceIncarnation: string;
  readonly expectedHash: string;
}): string {
  const rows = [...input.rows].sort((a, b) =>
    [a.workspaceId, a.poolId, a.accountId].join("\0") <
    [b.workspaceId, b.poolId, b.accountId].join("\0")
      ? -1
      : [a.workspaceId, a.poolId, a.accountId].join("\0") >
          [b.workspaceId, b.poolId, b.accountId].join("\0")
        ? 1
        : 0,
  );
  if (
    !Number.isSafeInteger(input.expectedCount) ||
    input.expectedCount < 1 ||
    rows.length !== input.expectedCount ||
    new Set(rows.map((row) => row.accountId)).size !== rows.length
  )
    throw new Error("custody_inventory_membership_invalid");
  for (const row of rows) {
    if (
      row.activeGeneration !== row.generation ||
      row.state === "tombstoned" ||
      row.state === "provisioning_pending" ||
      !/^[1-9]\d*$/u.test(row.generation) ||
      BigInt(row.generation) > BigInt(Number.MAX_SAFE_INTEGER) ||
      !/^[1-9]\d*$/u.test(row.revision) ||
      !hex.test(row.generationHash) ||
      !hex.test(row.aadHash) ||
      !hex.test(row.ciphertextHash) ||
      !hex.test(row.envelopeMetadataHash) ||
      row.custodyMode !== "local_test" ||
      row.kmsKeyArn !== null ||
      row.kmsContextVersion !== 1 ||
      row.envelopeVersion !== 1 ||
      row.encryptionAlgorithm !== "aes-256-gcm" ||
      !row.credentialKeyId ||
      row.databaseResourceIdentity !== input.sourceResourceIdentity ||
      row.databaseIncarnation !== input.sourceIncarnation
    )
      throw new Error("custody_inventory_row_invalid");
  }
  const actual = sha256(canonicalJson(rows as unknown as Json));
  if (actual !== input.expectedHash)
    throw new Error("custody_inventory_hash_mismatch");
  return actual;
}

export type CustodyAuthoritySnapshot = {
  readonly unboundLiveAccounts: number;
  readonly pendingDeviceLogins: number;
  readonly unresolvedRelayRequests: number;
  readonly unresolvedUpstreamEffects: number;
  readonly activeMutationFences: number;
  readonly unresolvedCommentMints: number;
  readonly unreconciledRefreshCapabilities: number;
  readonly activeGrantInFlight: number;
  readonly activeV4Turns: number;
  readonly unsafeRuntimeGate: number;
};

/** External evidence needed before retrying a blocked, read-only preflight. */
export const EXTERNAL_RECONCILIATION_INPUT = {
  unboundLiveAccounts:
    "Resolve each live account without an active generation through the existing enrollment or tombstone contract.",
  pendingDeviceLogins:
    "Record a terminal device-login outcome through the existing device-login contract.",
  unresolvedRelayRequests:
    "Obtain archive-bound terminal/no-effect evidence for every unresolved relay; terminal_unknown and response_started need external reconciliation, not lease expiry.",
  unresolvedUpstreamEffects:
    "Obtain provider-side terminal/no-effect evidence for every unresolved upstream attempt; terminal_unknown and response_started need external reconciliation, not lease expiry.",
  activeMutationFences:
    "Obtain writer release/fence-owner evidence and release each fence through the existing mutation-fence contract.",
  unresolvedCommentMints:
    "Obtain custody revocation proof and finalize it through the existing SECURITY DEFINER revocation protocol.",
  unreconciledRefreshCapabilities:
    "Reconcile and revoke every orphan refresh capability through the existing grant/capability contract.",
  activeGrantInFlight:
    "Obtain terminal request/effect evidence and drain all in-flight grant requests.",
  activeV4Turns:
    "Close or externally reconcile every open/unknown V4 turn through its existing authority contract.",
  unsafeRuntimeGate:
    "Close the imported runtime gate and prove no target writer can reopen it before apply.",
} as const;

/** The caller must source these counts from a single database snapshot. */
export function assertQuiescentAuthority(
  snapshot: CustodyAuthoritySnapshot,
): void {
  for (const gate of Object.keys(EXTERNAL_RECONCILIATION_INPUT) as Array<
    keyof CustodyAuthoritySnapshot
  >) {
    const count = snapshot[gate];
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error(`custody_authority_${gate}_invalid`);
    if (count !== 0) throw new Error(`custody_authority_${gate}_unresolved`);
  }
}

/** A repeatable read, explicitly read-only DB snapshot; no restore readiness call. */
export async function loadLocalRebindSnapshot(prisma: PrismaClient): Promise<{
  readonly rows: LocalCustodyInventoryRow[];
  readonly authority: CustodyAuthoritySnapshot;
}> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return loadSnapshotWithinTransaction(tx);
    },
    { isolationLevel: "RepeatableRead", maxWait: 15_000, timeout: 30_000 },
  );
}

async function loadSnapshotWithinTransaction(
  tx: Prisma.TransactionClient,
): Promise<{
  readonly rows: LocalCustodyInventoryRow[];
  readonly authority: CustodyAuthoritySnapshot;
}> {
  const accounts = await tx.hostedCodexAccount.findMany({
    // Tombstoned accounts retain historical activeGeneration pointers, but
    // cannot be reactivated. Keep their envelopes byte-for-byte as evidence.
    where: {
      activeGeneration: { not: null },
      state: { not: "tombstoned" },
    },
    include: {
      credentialVersions: {
        include: {
          envelopeRevisions: { orderBy: { revision: "desc" }, take: 1 },
        },
      },
    },
  });
  const rows = accounts.map((account) => {
    const credential = account.credentialVersions.find(
      (candidate) => candidate.generation === account.activeGeneration,
    );
    const revision = credential?.envelopeRevisions[0];
    if (!credential || !revision)
      throw new Error("custody_active_generation_envelope_missing");
    assertStoredCiphertextHash(
      revision.encryptedCiphertext,
      revision.ciphertextHash,
    );
    return {
      workspaceId: account.workspaceId,
      poolId: account.poolId,
      accountId: account.id,
      state: account.state,
      healthVersion: account.healthVersion.toString(),
      activeGeneration: account.activeGeneration!.toString(),
      credentialVersionId: credential.id,
      generation: credential.generation.toString(),
      generationHash: credential.generationHash,
      credentialKeyId: credential.keyId,
      revision: revision.revision.toString(),
      sourceRevision: revision.sourceRevision?.toString() ?? null,
      aadHash: revision.aadHash,
      ciphertextHash: revision.ciphertextHash,
      envelopeMetadataHash: sha256(
        canonicalJson(revision.envelopeMetadata as Json),
      ),
      custodyMode: revision.custodyMode,
      kmsKeyArn: revision.kmsKeyArn,
      kmsContextVersion: revision.kmsContextVersion,
      envelopeVersion: revision.envelopeVersion,
      encryptionAlgorithm: revision.encryptionAlgorithm,
      databaseResourceIdentity: revision.databaseResourceIdentity,
      databaseIncarnation: revision.databaseIncarnation,
    };
  });
  const [
    unboundLiveAccounts,
    pendingDeviceLogins,
    unresolvedRelayRequests,
    unresolvedUpstreamEffects,
    activeMutationFences,
    unresolvedCommentMints,
    unreconciledRefreshCapabilities,
    activeGrantInFlight,
    activeV4Turns,
    runtimeGate,
  ] = await Promise.all([
    tx.hostedCodexAccount.count({
      where: { activeGeneration: null, state: { not: "tombstoned" } },
    }),
    tx.hostedCodexDeviceLogin.count({ where: { status: "pending" } }),
    tx.hostedCodexRelayRequest.count({
      where: { status: { notIn: ["succeeded", "failed"] } },
    }),
    tx.hostedCodexUpstreamEffectAttempt.count({
      where: { state: { notIn: ["succeeded", "failed_no_effect"] } },
    }),
    tx.hostedCodexMutationFence.count({
      where: { ownerIdHash: { not: null } },
    }),
    tx.hostedCodexCommentTokenMint.count({
      where: { state: { notIn: ["failed_no_token", "revoked"] } },
    }),
    // Active grants and their refresh capabilities are revoked atomically by
    // apply. An unrevoked capability on any other grant needs reconciliation.
    tx.hostedCodexCommentRefreshCapability.count({
      where: {
        revokedAt: null,
        grant: { status: { notIn: ["issued", "exhausted"] } },
      },
    }),
    tx.hostedCodexInvocationGrant.count({ where: { inFlight: { gt: 0 } } }),
    tx.hostedCodexV4RelayTurn.count({
      where: { state: { in: ["open", "unknown"] } },
    }),
    tx.hostedCodexRuntimeGate.findUnique({
      where: { id: "global" },
      select: { status: true },
    }),
  ]);
  return {
    rows,
    authority: {
      unboundLiveAccounts,
      pendingDeviceLogins,
      unresolvedRelayRequests,
      unresolvedUpstreamEffects,
      activeMutationFences,
      unresolvedCommentMints,
      unreconciledRefreshCapabilities,
      activeGrantInFlight,
      activeV4Turns,
      unsafeRuntimeGate:
        !runtimeGate || runtimeGate.status !== "closed" ? 1 : 0,
    },
  };
}

/** Verify all three independent attestations before opening a keyring or transaction. */
export function validateAdmission(input: {
  readonly manifest: unknown;
  readonly provisioningEvidence: unknown;
  readonly writerFenceEvidence: unknown;
  readonly manifestPublicKeyPem: string;
  readonly provisioningPublicKeyPem: string;
  readonly fencePublicKeyPem: string;
  readonly expectedManifestKeyHash: string | undefined;
  readonly expectedProvisioningKeyHash: string | undefined;
  readonly expectedFenceKeyHash: string | undefined;
  readonly now?: Date;
}): ValidatedAdmission {
  assertTrustedAuthorities(input);
  const authorities = [
    input.manifestPublicKeyPem,
    input.provisioningPublicKeyPem,
    input.fencePublicKeyPem,
  ].map((pem) => {
    try {
      return createPublicKey(pem)
        .export({ format: "der", type: "spki" })
        .toString("hex");
    } catch {
      throw new Error("custody_authority_key_invalid");
    }
  });
  if (new Set(authorities).size !== authorities.length)
    throw new Error("custody_independent_authorities_required");
  const manifest = verifySignedDocument(
    input.manifest,
    input.manifestPublicKeyPem,
  ).payload;
  const provision = verifySignedDocument(
    input.provisioningEvidence,
    input.provisioningPublicKeyPem,
  ).payload;
  const fence = verifySignedDocument(
    input.writerFenceEvidence,
    input.fencePublicKeyPem,
  ).payload;
  exactKeys(manifest, [
    "operation",
    "nonce",
    "toolSourceSha",
    "toolCommitSha",
    "toolSha256",
    "finalArchiveHash",
    "sourceResourceIdentity",
    "sourceIncarnation",
    "targetResourceIdentity",
    "targetIncarnation",
    "targetPhysicalGeneration",
    "targetDatabaseName",
    "targetDatabaseOid",
    "targetRecoveryWitnessHash",
    "inventoryHash",
    "inventoryCount",
    "writerFenceEvidenceHash",
    "expiresAt",
  ]);
  exactKeys(provision, [
    "resourceIdentity",
    "incarnation",
    "physicalGeneration",
    "databaseName",
    "databaseOid",
    "recoveryWitnessHash",
    "sourceArchiveHash",
    "targetOfflineState",
    "observedAt",
    "expiresAt",
  ]);
  exactKeys(fence, [
    "sourceResourceIdentity",
    "sourceIncarnation",
    "finalArchiveHash",
    "writerFenceState",
    "fencedAt",
    "validUntil",
  ]);
  if (
    manifest.operation !== OPERATION ||
    manifest.toolSourceSha !== PINNED_SOURCE_SHA
  )
    throw new Error("custody_operation_or_source_mismatch");
  const toolSha256 = string(manifest.toolSha256, "tool_sha256", hex);
  const toolCommitSha = string(
    manifest.toolCommitSha,
    "tool_commit",
    /^[a-f0-9]{40}$/u,
  );
  if (toolSha256 !== sha256(readFileSync(fileURLToPath(import.meta.url))))
    throw new Error("custody_tool_sha256_mismatch");
  const nonce = string(manifest.nonce, "nonce", noncePattern);
  const finalArchiveHash = string(
    manifest.finalArchiveHash,
    "archive_hash",
    hex,
  );
  const sourceResourceIdentity = string(
    manifest.sourceResourceIdentity,
    "source_identity",
    opaque,
  );
  const sourceIncarnation = string(
    manifest.sourceIncarnation,
    "source_incarnation",
    opaque,
  );
  const targetResourceIdentity = string(
    manifest.targetResourceIdentity,
    "target_identity",
    opaque,
  );
  const targetIncarnation = string(
    manifest.targetIncarnation,
    "target_incarnation",
    opaque,
  );
  const targetPhysicalGeneration = string(
    manifest.targetPhysicalGeneration,
    "physical_generation",
    /^[1-9][0-9]{15,24}$/u,
  );
  const targetDatabaseName = string(
    manifest.targetDatabaseName,
    "database_name",
    /^[A-Za-z_][A-Za-z0-9_]{0,62}$/u,
  );
  const targetDatabaseOid = string(
    manifest.targetDatabaseOid,
    "database_oid",
    /^[1-9][0-9]{0,9}$/u,
  );
  const targetRecoveryWitnessHash = string(
    manifest.targetRecoveryWitnessHash,
    "recovery_witness_hash",
    hex,
  );
  const inventoryHash = string(manifest.inventoryHash, "inventory_hash", hex);
  if (
    !Number.isSafeInteger(manifest.inventoryCount) ||
    (manifest.inventoryCount as number) < 1
  )
    throw new Error("custody_inventory_count_invalid");
  const inventoryCount = manifest.inventoryCount as number;
  const writerFenceEvidenceHash = string(
    manifest.writerFenceEvidenceHash,
    "fence_hash",
    hex,
  );
  const expiresAt = string(
    manifest.expiresAt,
    "expiration",
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u,
  );
  if (
    !Number.isFinite(Date.parse(expiresAt)) ||
    new Date(expiresAt).toISOString() !== expiresAt
  )
    throw new Error("custody_expiration_invalid");
  if (Date.parse(expiresAt) <= (input.now ?? new Date()).getTime())
    throw new Error("custody_manifest_expired");
  const provisionObservedAt = string(
    provision.observedAt,
    "provision_observed_at",
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u,
  );
  const provisionExpiresAt = string(
    provision.expiresAt,
    "provision_expires_at",
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u,
  );
  if (
    !Number.isFinite(Date.parse(provisionObservedAt)) ||
    new Date(provisionObservedAt).toISOString() !== provisionObservedAt ||
    !Number.isFinite(Date.parse(provisionExpiresAt)) ||
    new Date(provisionExpiresAt).toISOString() !== provisionExpiresAt ||
    Date.parse(provisionObservedAt) > (input.now ?? new Date()).getTime() ||
    Date.parse(provisionExpiresAt) <= (input.now ?? new Date()).getTime() ||
    Date.parse(provisionExpiresAt) < Date.parse(expiresAt)
  )
    throw new Error("custody_provisioning_evidence_expired_or_invalid");
  if (
    sourceResourceIdentity === targetResourceIdentity ||
    sourceIncarnation === targetIncarnation
  )
    throw new Error("custody_source_target_not_distinct");
  if (
    provision.resourceIdentity !== targetResourceIdentity ||
    provision.incarnation !== targetIncarnation ||
    provision.physicalGeneration !== targetPhysicalGeneration ||
    provision.recoveryWitnessHash !== targetRecoveryWitnessHash ||
    provision.databaseName !== targetDatabaseName ||
    provision.databaseOid !== targetDatabaseOid ||
    provision.sourceArchiveHash !== finalArchiveHash ||
    provision.targetOfflineState !== "isolated"
  )
    throw new Error("custody_independent_provisioning_mismatch");
  if (
    fence.sourceResourceIdentity !== sourceResourceIdentity ||
    fence.sourceIncarnation !== sourceIncarnation ||
    fence.finalArchiveHash !== finalArchiveHash ||
    fence.writerFenceState !== "fenced" ||
    typeof fence.fencedAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(fence.fencedAt) ||
    !Number.isFinite(Date.parse(fence.fencedAt)) ||
    new Date(fence.fencedAt).toISOString() !== fence.fencedAt ||
    Date.parse(fence.fencedAt) > (input.now ?? new Date()).getTime() ||
    typeof fence.validUntil !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(fence.validUntil) ||
    !Number.isFinite(Date.parse(fence.validUntil)) ||
    new Date(fence.validUntil).toISOString() !== fence.validUntil ||
    Date.parse(fence.validUntil) < Date.parse(expiresAt)
  )
    throw new Error("custody_writer_fence_invalid");
  if (
    sha256(canonicalJson(fence as Record<string, Json>)) !==
    writerFenceEvidenceHash
  )
    throw new Error("custody_writer_fence_mismatch");
  const admitted: ValidatedAdmission = {
    digest: sha256(canonicalJson(manifest)),
    inventoryHash,
    inventoryCount,
    sourceResourceIdentity,
    sourceIncarnation,
    targetResourceIdentity,
    targetIncarnation,
    targetPhysicalGeneration,
    targetDatabaseName,
    targetDatabaseOid,
    toolCommitSha,
    targetRecoveryWitnessHash,
    finalArchiveHash,
    nonce,
    expiresAt,
  };
  admittedManifests.add(admitted);
  return admitted;
}

type RebindEvidence = {
  readonly credentialVersionId: string;
  readonly sourceRevision: string;
  readonly targetRevision: string;
  readonly sourceHash: string;
  readonly targetHash: string;
};

function revisionEvidenceHash(input: {
  readonly revision: string;
  readonly aadHash: string;
  readonly ciphertextHash: string;
  readonly envelopeMetadataHash: string;
  readonly databaseResourceIdentity: string;
  readonly databaseIncarnation: string;
  readonly keyId: string;
}): string {
  return sha256(canonicalJson(input));
}

function assertStoredCiphertextHash(
  ciphertext: string,
  expected: string,
): void {
  if (ciphertext.length > 64 * 1024)
    throw new Error("custody_stored_ciphertext_too_large");
  const bytes = Buffer.from(ciphertext, "base64");
  try {
    if (
      !ciphertext ||
      bytes.toString("base64") !== ciphertext ||
      sha256(bytes) !== expected
    )
      throw new Error("custody_stored_ciphertext_hash_mismatch");
  } finally {
    bytes.fill(0);
  }
}

export function receiptHash(
  manifestDigest: string,
  entries: readonly RebindEvidence[],
): string {
  return sha256(
    canonicalJson({
      manifestDigest,
      entries: [...entries].sort((a, b) =>
        a.credentialVersionId < b.credentialVersionId
          ? -1
          : a.credentialVersionId > b.credentialVersionId
            ? 1
            : 0,
      ) as unknown as Json,
    }),
  );
}

/** One serializable commit writes every new revision and invalidates old authority. */
export async function applyLocalCustodyRebind(input: {
  readonly prisma: PrismaClient;
  readonly admission: ValidatedAdmission;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<{
  readonly status: "applied" | "already_applied";
  readonly receiptHash: string;
  readonly revisionCount: number;
}> {
  assertValidatedAdmission(input.admission);
  if (Date.parse(input.admission.expiresAt) <= Date.now())
    throw new Error("custody_manifest_expired");
  assertTargetRuntime(input.admission, input.env);
  const existing = await readCommittedRebindReceipt(
    input.prisma,
    input.admission,
  );
  if (existing) return existing;
  const { CredentialEnvelopeVault, EnvCredentialKeyring } =
    await import("../packages/features/hosted-account-pool/src/infrastructure/crypto/credential-envelope-vault.js");
  const { fingerprintCodexAuthJson } =
    await import("../packages/features/hosted-account-pool/src/infrastructure/security/codex-account-identity.js");
  const serializedKeyring =
    input.env.REVIEW_ROUTER_HOSTED_CODEX_KEK_KEYRING_JSON;
  const pepper = Buffer.from(
    input.env.REVIEW_ROUTER_HOSTED_CODEX_FINGERPRINT_PEPPER ?? "",
    "base64",
  );
  if (!serializedKeyring || pepper.length < 32) {
    pepper.fill(0);
    throw new Error("custody_local_key_material_missing");
  }
  const keyrings = new Map<string, InstanceType<typeof EnvCredentialKeyring>>();
  try {
    return await input.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe<{ locked: boolean }[]>(
          "SELECT pg_advisory_xact_lock(1381126735, 1195529550) IS NULL AS locked",
        );
        await assertConnectedTargetGeneration(tx, input.admission);
        await tx.$queryRawUnsafe<{ locked: boolean }[]>(
          "SELECT pg_advisory_xact_lock(440, 17017) IS NULL AS locked",
        );
        const snapshot = await loadSnapshotWithinTransaction(tx);
        assessLocalCustodyInventory({
          rows: snapshot.rows,
          expectedCount: input.admission.inventoryCount,
          sourceResourceIdentity: input.admission.sourceResourceIdentity,
          sourceIncarnation: input.admission.sourceIncarnation,
          expectedHash: input.admission.inventoryHash,
        });
        assertQuiescentAuthority(snapshot.authority);
        if (Date.parse(input.admission.expiresAt) <= Date.now())
          throw new Error("custody_manifest_expired");
        const prepared: {
          row: LocalCustodyInventoryRow;
          envelope: Awaited<
            ReturnType<InstanceType<typeof CredentialEnvelopeVault>["encrypt"]>
          >;
          sourceHash: string;
          targetHash: string;
          targetRevision: bigint;
        }[] = [];
        for (const row of snapshot.rows) {
          const credential =
            await tx.hostedCodexCredentialVersion.findUniqueOrThrow({
              where: { id: row.credentialVersionId },
              include: {
                envelopeRevisions: { orderBy: { revision: "desc" }, take: 1 },
              },
            });
          const revision = credential.envelopeRevisions[0];
          if (
            !revision ||
            revision.revision.toString() !== row.revision ||
            revision.aadHash !== row.aadHash ||
            revision.ciphertextHash !== row.ciphertextHash ||
            revision.databaseResourceIdentity !==
              input.admission.sourceResourceIdentity ||
            revision.databaseIncarnation !==
              input.admission.sourceIncarnation ||
            revision.custodyMode !== "local_test" ||
            revision.kmsKeyArn !== null ||
            revision.kmsContextVersion !== 1 ||
            revision.envelopeVersion !== 1 ||
            revision.encryptionAlgorithm !== "aes-256-gcm" ||
            credential.keyId !== row.credentialKeyId
          )
            throw new Error("custody_inventory_changed_inside_transaction");
          let keyring = keyrings.get(row.credentialKeyId);
          if (!keyring) {
            keyring = new EnvCredentialKeyring({
              REVIEW_ROUTER_HOSTED_CODEX_KEK_CURRENT_ID: row.credentialKeyId,
              REVIEW_ROUTER_HOSTED_CODEX_KEK_KEYRING_JSON: serializedKeyring,
            });
            keyrings.set(row.credentialKeyId, keyring);
          }
          const vault = new CredentialEnvelopeVault(keyring, "relay");
          const metadata = object(revision.envelopeMetadata);
          const wrapped = object(metadata.wrappedDataEncryptionKey);
          if (
            wrapped.keyId !== row.credentialKeyId ||
            typeof metadata.nonce !== "string" ||
            typeof metadata.authenticationTag !== "string" ||
            revision.envelopeVersion !== 1 ||
            revision.encryptionAlgorithm !== "aes-256-gcm"
          )
            throw new Error("custody_source_envelope_invalid");
          const sourceContext = {
            workspaceId: row.workspaceId,
            poolId: row.poolId,
            accountId: row.accountId,
            generation: Number(row.generation),
            databaseResourceIdentity: input.admission.sourceResourceIdentity,
            databaseIncarnation: input.admission.sourceIncarnation,
          };
          const targetContext = {
            ...sourceContext,
            databaseResourceIdentity: input.admission.targetResourceIdentity,
            databaseIncarnation: input.admission.targetIncarnation,
          };
          let plaintext: Uint8Array | undefined;
          let verified: Uint8Array | undefined;
          try {
            plaintext = await vault.decrypt(
              {
                schemaVersion: 1,
                encryptionAlgorithm: "aes-256-gcm",
                keyId: row.credentialKeyId,
                nonce: metadata.nonce,
                authenticationTag: metadata.authenticationTag,
                wrappedDataEncryptionKey: wrapped as unknown as {
                  keyId: string;
                  nonce: string;
                  ciphertext: string;
                  authenticationTag: string;
                },
                ciphertext: revision.encryptedCiphertext,
                associatedDataHash: revision.aadHash,
                ciphertextHash: revision.ciphertextHash,
              },
              sourceContext,
            );
            if (
              fingerprintCodexAuthJson(plaintext, pepper) !==
                (
                  await tx.hostedCodexAccount.findUniqueOrThrow({
                    where: { id: row.accountId },
                    select: { accountFingerprint: true },
                  })
                ).accountFingerprint ||
              sha256(plaintext) !== credential.generationHash
            )
              throw new Error(
                "custody_credential_identity_or_generation_mismatch",
              );
            const envelope = await vault.encrypt(plaintext, targetContext);
            if (envelope.keyId !== row.credentialKeyId)
              throw new Error("custody_local_key_id_changed");
            verified = await vault.decrypt(envelope, targetContext);
            if (
              verified.length !== plaintext.length ||
              !timingSafeEqual(verified, plaintext)
            )
              throw new Error("custody_target_plaintext_mismatch");
            verified.fill(0);
            verified = undefined;
            let sourceAccepted = false;
            try {
              verified = await vault.decrypt(envelope, sourceContext);
              sourceAccepted = true;
            } catch (error) {
              if (
                !(error instanceof Error) ||
                error.message !== "credential_envelope_context_mismatch"
              )
                throw error;
            }
            if (sourceAccepted)
              throw new Error("custody_source_context_accepted");
            const targetRevision = revision.revision + 1n;
            const sourceHash = revisionEvidenceHash({
              revision: row.revision,
              aadHash: row.aadHash,
              ciphertextHash: row.ciphertextHash,
              envelopeMetadataHash: row.envelopeMetadataHash,
              databaseResourceIdentity: input.admission.sourceResourceIdentity,
              databaseIncarnation: input.admission.sourceIncarnation,
              keyId: row.credentialKeyId,
            });
            const targetHash = revisionEvidenceHash({
              revision: targetRevision.toString(),
              aadHash: envelope.associatedDataHash,
              ciphertextHash: envelope.ciphertextHash,
              envelopeMetadataHash: sha256(
                canonicalJson({
                  nonce: envelope.nonce,
                  authenticationTag: envelope.authenticationTag,
                  wrappedDataEncryptionKey: envelope.wrappedDataEncryptionKey,
                }),
              ),
              databaseResourceIdentity: input.admission.targetResourceIdentity,
              databaseIncarnation: input.admission.targetIncarnation,
              keyId: row.credentialKeyId,
            });
            prepared.push({
              row,
              envelope,
              sourceHash,
              targetHash,
              targetRevision,
            });
          } finally {
            verified?.fill(0);
            plaintext?.fill(0);
          }
        }
        const evidence = prepared.map((item) => ({
          credentialVersionId: item.row.credentialVersionId,
          sourceRevision: item.row.revision,
          targetRevision: item.targetRevision.toString(),
          sourceHash: item.sourceHash,
          targetHash: item.targetHash,
        }));
        const committedReceiptHash = receiptHash(
          input.admission.digest,
          evidence,
        );
        const actorIdHash = sha256(
          `offline-local-rebind\0${input.admission.digest}`,
        );
        if (Date.parse(input.admission.expiresAt) <= Date.now())
          throw new Error("custody_manifest_expired");
        for (const item of prepared) {
          const envelope = item.envelope;
          await tx.hostedCodexCredentialEnvelopeRevision.create({
            data: {
              id: randomUUID(),
              credentialVersionId: item.row.credentialVersionId,
              accountId: item.row.accountId,
              workspaceId: item.row.workspaceId,
              poolId: item.row.poolId,
              generation: BigInt(item.row.generation),
              revision: item.targetRevision,
              sourceRevision: BigInt(item.row.revision),
              custodyMode: "local_test",
              kmsKeyArn: null,
              kmsContextVersion: 1,
              databaseResourceIdentity: input.admission.targetResourceIdentity,
              databaseIncarnation: input.admission.targetIncarnation,
              reason: "restore_reconciliation",
              envelopeVersion: 1,
              encryptionAlgorithm: "aes-256-gcm",
              aadHash: envelope.associatedDataHash,
              ciphertextHash: envelope.ciphertextHash,
              encryptedCiphertext: envelope.ciphertext,
              envelopeMetadata: {
                nonce: envelope.nonce,
                authenticationTag: envelope.authenticationTag,
                wrappedDataEncryptionKey: envelope.wrappedDataEncryptionKey,
                custodyRebind: {
                  manifestDigest: input.admission.digest,
                  inventoryHash: input.admission.inventoryHash,
                  finalArchiveHash: input.admission.finalArchiveHash,
                  receiptHash: committedReceiptHash,
                  sourceHash: item.sourceHash,
                  targetHash: item.targetHash,
                  sourceHealthVersion: item.row.healthVersion,
                  sourceAccountState: item.row.state,
                },
              },
              fenceOwnerIdHash: null,
              fenceEpoch: null,
              actorIdHash,
              idempotencyKeyHash: sha256(
                `local-rebind\0${input.admission.digest}\0${item.row.credentialVersionId}`,
              ),
            },
          });
        }
        const now = new Date();
        await tx.hostedCodexInvocationGrant.updateMany({
          where: { status: { in: ["issued", "exhausted"] } },
          data: {
            status: "revoked",
            revokedAt: now,
            revision: { increment: 1 },
          },
        });
        await tx.hostedCodexCommentRefreshCapability.updateMany({
          where: { revokedAt: null, grant: { status: "revoked" } },
          data: { revokedAt: now, revision: { increment: 1 } },
        });
        if (
          await tx.hostedCodexCommentRefreshCapability.count({
            where: { revokedAt: null },
          })
        )
          throw new Error("custody_refresh_capability_revocation_incomplete");
        await tx.hostedCodexMutationFence.updateMany({
          where: {
            accountId: { in: snapshot.rows.map((row) => row.accountId) },
          },
          data: {
            fenceEpoch: { increment: 1 },
            ownerIdHash: null,
            expectedGeneration: null,
            expiresAt: null,
            releasedAt: now,
            releaseReason: "offline_local_custody_rebind",
          },
        });
        await tx.hostedCodexPool.updateMany({
          where: {
            id: { in: [...new Set(snapshot.rows.map((row) => row.poolId))] },
          },
          data: { authzEpoch: { increment: 1 }, revision: { increment: 1 } },
        });
        const gate = await tx.hostedCodexRuntimeGate.updateMany({
          where: { id: "global" },
          data: {
            status: "closed",
            authzEpoch: { increment: 1 },
            revision: { increment: 1 },
            reasonCode: `offline_rebind_${input.admission.digest.slice(0, 24)}`,
            changedAt: now,
            changedByHash: actorIdHash,
          },
        });
        if (gate.count !== 1) throw new Error("custody_runtime_gate_missing");
        return {
          status: "applied" as const,
          receiptHash: committedReceiptHash,
          revisionCount: prepared.length,
        };
      },
      { isolationLevel: "Serializable", maxWait: 15_000, timeout: 120_000 },
    );
  } catch (error) {
    const committed = await readCommittedRebindReceipt(
      input.prisma,
      input.admission,
    );
    if (committed) return committed;
    throw error;
  } finally {
    pepper.fill(0);
    for (const keyring of keyrings.values()) keyring.destroy();
  }
}

/** Resolve a lost commit response from immutable revisions without key access. */
export async function readCommittedRebindReceipt(
  prisma: PrismaClient,
  admission: ValidatedAdmission,
): Promise<{
  readonly status: "already_applied";
  readonly receiptHash: string;
  readonly revisionCount: number;
} | null> {
  assertValidatedAdmission(admission);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await assertConnectedTargetGeneration(tx, admission);
      const accounts = await tx.hostedCodexAccount.findMany({
        where: {
          activeGeneration: { not: null },
          state: { not: "tombstoned" },
        },
        include: {
          credentialVersions: { include: { envelopeRevisions: true } },
        },
      });
      if (accounts.length !== admission.inventoryCount)
        throw new Error("custody_readback_inventory_membership_mismatch");
      const evidence: RebindEvidence[] = [];
      const sourceRows: LocalCustodyInventoryRow[] = [];
      let auditCount = 0;
      let committedReceiptHash: string | undefined;
      for (const account of accounts) {
        const credential = account.credentialVersions.find(
          (item) => item.generation === account.activeGeneration,
        );
        if (!credential)
          throw new Error("custody_readback_active_generation_missing");
        const latest = credential.envelopeRevisions.reduce<
          (typeof credential.envelopeRevisions)[number] | undefined
        >(
          (current, item) =>
            !current || item.revision > current.revision ? item : current,
          undefined,
        );
        if (!latest)
          throw new Error("custody_readback_latest_revision_missing");
        const metadata = object(latest.envelopeMetadata);
        const audit = metadata.custodyRebind;
        if (audit === undefined) continue;
        exactKeys(metadata, [
          "nonce",
          "authenticationTag",
          "wrappedDataEncryptionKey",
          "custodyRebind",
        ]);
        auditCount += 1;
        const record = object(audit);
        exactKeys(record, [
          "manifestDigest",
          "inventoryHash",
          "finalArchiveHash",
          "receiptHash",
          "sourceHash",
          "targetHash",
          "sourceHealthVersion",
          "sourceAccountState",
        ]);
        const wrapped = object(metadata.wrappedDataEncryptionKey);
        exactKeys(wrapped, [
          "keyId",
          "nonce",
          "ciphertext",
          "authenticationTag",
        ]);
        if (
          latest.reason !== "restore_reconciliation" ||
          latest.custodyMode !== "local_test" ||
          latest.envelopeVersion !== 1 ||
          latest.encryptionAlgorithm !== "aes-256-gcm" ||
          latest.kmsContextVersion !== 1 ||
          latest.kmsKeyArn !== null ||
          latest.databaseResourceIdentity !==
            admission.targetResourceIdentity ||
          latest.databaseIncarnation !== admission.targetIncarnation ||
          latest.sourceRevision === null ||
          record.manifestDigest !== admission.digest ||
          record.inventoryHash !== admission.inventoryHash ||
          record.finalArchiveHash !== admission.finalArchiveHash ||
          record.sourceHealthVersion !== account.healthVersion.toString() ||
          record.sourceAccountState !== account.state ||
          typeof record.receiptHash !== "string" ||
          !hex.test(record.receiptHash)
        )
          throw new Error("custody_readback_receipt_conflict");
        if (committedReceiptHash && committedReceiptHash !== record.receiptHash)
          throw new Error("custody_readback_receipt_conflict");
        committedReceiptHash = record.receiptHash;
        const old = credential.envelopeRevisions.find(
          (item) => item.revision === latest.sourceRevision,
        );
        if (
          !old ||
          old.custodyMode !== "local_test" ||
          old.kmsKeyArn !== null ||
          old.databaseResourceIdentity !== admission.sourceResourceIdentity ||
          old.databaseIncarnation !== admission.sourceIncarnation ||
          latest.revision !== old.revision + 1n ||
          credential.keyId !== wrapped.keyId
        )
          throw new Error("custody_readback_source_conflict");
        assertStoredCiphertextHash(old.encryptedCiphertext, old.ciphertextHash);
        assertStoredCiphertextHash(
          latest.encryptedCiphertext,
          latest.ciphertextHash,
        );
        if (
          latest.idempotencyKeyHash !==
          sha256(`local-rebind\0${admission.digest}\0${credential.id}`)
        )
          throw new Error("custody_readback_idempotency_conflict");
        sourceRows.push({
          workspaceId: account.workspaceId,
          poolId: account.poolId,
          accountId: account.id,
          state: account.state,
          healthVersion: account.healthVersion.toString(),
          activeGeneration: account.activeGeneration!.toString(),
          credentialVersionId: credential.id,
          generation: credential.generation.toString(),
          generationHash: credential.generationHash,
          credentialKeyId: credential.keyId,
          revision: old.revision.toString(),
          sourceRevision: old.sourceRevision?.toString() ?? null,
          aadHash: old.aadHash,
          ciphertextHash: old.ciphertextHash,
          envelopeMetadataHash: sha256(
            canonicalJson(old.envelopeMetadata as Json),
          ),
          custodyMode: old.custodyMode,
          kmsKeyArn: old.kmsKeyArn,
          kmsContextVersion: old.kmsContextVersion,
          envelopeVersion: old.envelopeVersion,
          encryptionAlgorithm: old.encryptionAlgorithm,
          databaseResourceIdentity: old.databaseResourceIdentity,
          databaseIncarnation: old.databaseIncarnation,
        });
        const sourceHash = revisionEvidenceHash({
          revision: old.revision.toString(),
          aadHash: old.aadHash,
          ciphertextHash: old.ciphertextHash,
          envelopeMetadataHash: sha256(
            canonicalJson(old.envelopeMetadata as Json),
          ),
          databaseResourceIdentity: admission.sourceResourceIdentity,
          databaseIncarnation: admission.sourceIncarnation,
          keyId: credential.keyId,
        });
        const targetHash = revisionEvidenceHash({
          revision: latest.revision.toString(),
          aadHash: latest.aadHash,
          ciphertextHash: latest.ciphertextHash,
          envelopeMetadataHash: sha256(
            canonicalJson({
              nonce: metadata.nonce as string,
              authenticationTag: metadata.authenticationTag as string,
              wrappedDataEncryptionKey:
                metadata.wrappedDataEncryptionKey as Json,
            }),
          ),
          databaseResourceIdentity: admission.targetResourceIdentity,
          databaseIncarnation: admission.targetIncarnation,
          keyId: credential.keyId,
        });
        if (
          record.sourceHash !== sourceHash ||
          record.targetHash !== targetHash
        )
          throw new Error("custody_readback_revision_hash_mismatch");
        evidence.push({
          credentialVersionId: credential.id,
          sourceRevision: old.revision.toString(),
          targetRevision: latest.revision.toString(),
          sourceHash,
          targetHash,
        });
      }
      if (auditCount === 0) return null;
      if (
        auditCount !== admission.inventoryCount ||
        receiptHash(admission.digest, evidence) !== committedReceiptHash
      )
        throw new Error("custody_readback_partial_or_conflicting");
      assessLocalCustodyInventory({
        rows: sourceRows,
        expectedCount: admission.inventoryCount,
        sourceResourceIdentity: admission.sourceResourceIdentity,
        sourceIncarnation: admission.sourceIncarnation,
        expectedHash: admission.inventoryHash,
      });
      const [
        unboundLiveAccounts,
        activeGrants,
        activeCapabilities,
        activeFences,
        gate,
      ] = await Promise.all([
        tx.hostedCodexAccount.count({
          where: { activeGeneration: null, state: { not: "tombstoned" } },
        }),
        tx.hostedCodexInvocationGrant.count({
          where: { status: { in: ["issued", "exhausted"] } },
        }),
        tx.hostedCodexCommentRefreshCapability.count({
          where: { revokedAt: null },
        }),
        tx.hostedCodexMutationFence.count({
          where: {
            accountId: { in: accounts.map((account) => account.id) },
            OR: [
              { ownerIdHash: { not: null } },
              { releaseReason: { not: "offline_local_custody_rebind" } },
            ],
          },
        }),
        tx.hostedCodexRuntimeGate.findUnique({ where: { id: "global" } }),
      ]);
      if (
        unboundLiveAccounts ||
        activeGrants ||
        activeCapabilities ||
        activeFences ||
        !gate ||
        gate.status !== "closed" ||
        gate.reasonCode !== `offline_rebind_${admission.digest.slice(0, 24)}`
      )
        throw new Error("custody_readback_authority_conflict");
      return {
        status: "already_applied" as const,
        receiptHash: committedReceiptHash!,
        revisionCount: admission.inventoryCount,
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 15_000, timeout: 30_000 },
  );
}

async function main() {
  if (["help", "--help"].includes(process.argv[2] ?? "")) {
    process.stdout.write(
      `${JSON.stringify({
        operation: OPERATION,
        trustAnchors: [
          "REVIEW_ROUTER_CUSTODY_MANIFEST_AUTHORITY_SHA256",
          "REVIEW_ROUTER_CUSTODY_PROVISIONING_AUTHORITY_SHA256",
          "REVIEW_ROUTER_CUSTODY_FENCE_AUTHORITY_SHA256",
        ],
        targetRuntime: [
          "REVIEW_ROUTER_CUSTODY_OFFLINE_TARGET",
          "REVIEW_ROUTER_HOSTED_CODEX_DATABASE_RESOURCE_IDENTITY",
          "REVIEW_ROUTER_HOSTED_CODEX_DATABASE_INCARNATION",
          "REVIEW_ROUTER_DATABASE_RECOVERY_WITNESS",
        ],
        externalReconciliationInput: EXTERNAL_RECONCILIATION_INPUT,
      })}\n`,
    );
    return;
  }
  const [
    mode,
    manifestPath,
    provisionPath,
    fencePath,
    manifestKeyPath,
    provisionKeyPath,
    fenceKeyPath,
    archivePath,
  ] = process.argv.slice(2);
  if (
    !["preflight", "apply"].includes(mode ?? "") ||
    !manifestPath ||
    !provisionPath ||
    !fencePath ||
    !manifestKeyPath ||
    !provisionKeyPath ||
    !fenceKeyPath ||
    !archivePath
  )
    throw new Error(
      "usage: hosted-pool:local-custody-rebind <preflight|apply> <manifest.json> <provisioning-evidence.json> <writer-fence.json> <manifest-public.pem> <provisioning-public.pem> <fence-public.pem> <final-archive>",
    );
  const [
    manifest,
    provisioningEvidence,
    writerFenceEvidence,
    manifestPublicKeyPem,
    provisioningPublicKeyPem,
    fencePublicKeyPem,
  ] = await Promise.all([
    readFile(resolve(manifestPath), "utf8").then(JSON.parse),
    readFile(resolve(provisionPath), "utf8").then(JSON.parse),
    readFile(resolve(fencePath), "utf8").then(JSON.parse),
    readFile(resolve(manifestKeyPath), "utf8"),
    readFile(resolve(provisionKeyPath), "utf8"),
    readFile(resolve(fenceKeyPath), "utf8"),
  ]);
  const admitted = validateAdmission({
    manifest,
    provisioningEvidence,
    writerFenceEvidence,
    manifestPublicKeyPem,
    provisioningPublicKeyPem,
    fencePublicKeyPem,
    expectedManifestKeyHash:
      process.env.REVIEW_ROUTER_CUSTODY_MANIFEST_AUTHORITY_SHA256,
    expectedProvisioningKeyHash:
      process.env.REVIEW_ROUTER_CUSTODY_PROVISIONING_AUTHORITY_SHA256,
    expectedFenceKeyHash:
      process.env.REVIEW_ROUTER_CUSTODY_FENCE_AUTHORITY_SHA256,
  });
  assertPinnedCheckout(admitted.toolCommitSha);
  if ((await hashFile(resolve(archivePath))) !== admitted.finalArchiveHash)
    throw new Error("custody_final_archive_hash_mismatch");
  assertTargetRuntime(admitted, process.env);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("custody_database_url_missing");
  const targetUrl = new URL(databaseUrl);
  const targetParameters = [...targetUrl.searchParams.entries()];
  if (
    !["postgres:", "postgresql:"].includes(targetUrl.protocol) ||
    targetUrl.hash ||
    !/^\/[^/]+$/u.test(targetUrl.pathname) ||
    targetParameters.length > 1 ||
    targetParameters.some(
      ([key, value]) => key !== "schema" || value !== "public",
    )
  )
    throw new Error("custody_database_url_invalid");
  const { createPrismaClient } =
    await import("../packages/platform/db/src/index.js");
  const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
  try {
    const version = await prisma.$queryRawUnsafe<
      { server_version_num: string }[]
    >("SELECT current_setting('server_version_num') AS server_version_num");
    if (
      !version[0] ||
      Number(version[0].server_version_num) < 170000 ||
      Number(version[0].server_version_num) >= 180000
    )
      throw new Error("custody_pg17_required");
    const committed = await readCommittedRebindReceipt(prisma, admitted);
    if (committed) {
      process.stdout.write(`${JSON.stringify(committed)}\n`);
      return;
    }
    const snapshot = await loadLocalRebindSnapshot(prisma);
    assessLocalCustodyInventory({
      rows: snapshot.rows,
      expectedCount: admitted.inventoryCount,
      sourceResourceIdentity: admitted.sourceResourceIdentity,
      sourceIncarnation: admitted.sourceIncarnation,
      expectedHash: admitted.inventoryHash,
    });
    assertQuiescentAuthority(snapshot.authority);
    if (mode === "preflight") {
      if (Date.parse(admitted.expiresAt) <= Date.now())
        throw new Error("custody_manifest_expired");
      process.stdout.write(
        `${JSON.stringify({ status: "ready", manifestDigest: admitted.digest, inventoryHash: admitted.inventoryHash, inventoryCount: admitted.inventoryCount })}\n`,
      );
      return;
    }
    try {
      const result = await applyLocalCustodyRebind({
        prisma,
        admission: admitted,
        env: process.env,
      });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      const replay = await readCommittedRebindReceipt(prisma, admitted);
      if (!replay) throw error;
      process.stdout.write(`${JSON.stringify(replay)}\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

if (process.argv[1]?.endsWith("hosted-pool-local-custody-rebind.ts")) {
  main().catch((error) => {
    const code =
      error instanceof Error &&
      (/^custody_[A-Za-z0-9_]+$/u.test(error.message) ||
        error.message.startsWith("usage: hosted-pool:local-custody-rebind "))
        ? error.message
        : "custody_rebind_failed";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
