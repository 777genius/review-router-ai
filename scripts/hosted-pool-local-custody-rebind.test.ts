import { createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assessLocalCustodyInventory, assertDisposableDatabaseUrl, assertTrustedAuthorities,
  assertQuiescentAuthority, canonicalJson,
  OPERATION, PINNED_SOURCE_SHA, sha256, validateAdmission,
  verifySignedDocument, type LocalCustodyInventoryRow,
} from "./hosted-pool-local-custody-rebind.js";

function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    document(payload: Record<string, string | number>) {
      return {
        payload,
        signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString("base64"),
      };
    },
  };
}

function keyHash(pem: string) {
  return sha256(createPublicKey(pem).export({ format: "der", type: "spki" }));
}

function fixture() {
  const authority = signer();
  const provisioner = signer();
  const fencer = signer();
  const archive = "a".repeat(64);
  const sourceResourceIdentity = "source-resource-identity-001";
  const sourceIncarnation = "source-incarnation-001";
  const targetResourceIdentity = "target-resource-identity-002";
  const targetIncarnation = "target-incarnation-002";
  const targetPhysicalGeneration = "target-physical-generation-002";
  const targetRecoveryWitnessHash = "b".repeat(64);
  const provisioningEvidence = provisioner.document({
    resourceIdentity: targetResourceIdentity,
    incarnation: targetIncarnation,
    physicalGeneration: targetPhysicalGeneration,
    recoveryWitnessHash: targetRecoveryWitnessHash,
    sourceArchiveHash: archive,
    targetOfflineState: "isolated",
    observedAt: "2026-09-27T00:00:00.000Z",
    expiresAt: "2026-09-29T00:00:00.000Z",
  });
  const writerFenceEvidence = fencer.document({
    sourceResourceIdentity, sourceIncarnation, finalArchiveHash: archive,
    writerFenceState: "fenced", fencedAt: "2026-09-27T00:00:00.000Z",
    validUntil: "2026-09-29T00:00:00.000Z",
  });
  const payload = {
    operation: OPERATION, nonce: "synthetic_nonce_1234567890123456",
    toolSourceSha: PINNED_SOURCE_SHA,
    toolSha256: sha256(readFileSync(new URL("./hosted-pool-local-custody-rebind.ts", import.meta.url))),
    finalArchiveHash: archive,
    sourceResourceIdentity, sourceIncarnation, targetResourceIdentity,
    targetIncarnation, targetPhysicalGeneration, targetRecoveryWitnessHash,
    inventoryHash: "c".repeat(64),
    inventoryCount: 3,
    writerFenceEvidenceHash: sha256(canonicalJson(writerFenceEvidence.payload)),
    expiresAt: "2026-09-28T00:00:00.000Z",
  };
  const input = {
    manifest: authority.document(payload), provisioningEvidence, writerFenceEvidence,
    manifestPublicKeyPem: authority.publicKeyPem,
    provisioningPublicKeyPem: provisioner.publicKeyPem,
    fencePublicKeyPem: fencer.publicKeyPem,
    expectedManifestKeyHash: keyHash(authority.publicKeyPem),
    expectedProvisioningKeyHash: keyHash(provisioner.publicKeyPem),
    expectedFenceKeyHash: keyHash(fencer.publicKeyPem),
    now: new Date("2026-09-27T12:00:00.000Z"),
  };
  return { input, payload, authority, provisioner, fencer };
}

describe("offline custody admission", () => {
  it("accepts independent signed scope and returns a deterministic manifest digest", () => {
    const { input, payload } = fixture();
    expect(validateAdmission(input)).toMatchObject({
      digest: sha256(canonicalJson(payload)), inventoryHash: payload.inventoryHash,
      targetRecoveryWitnessHash: payload.targetRecoveryWitnessHash,
    });
  });

  it.each([
    ["archive", (f: ReturnType<typeof fixture>) => ({ ...f.input, manifest: f.authority.document({ ...f.payload, finalArchiveHash: "d".repeat(64) }) })],
    ["identity", (f: ReturnType<typeof fixture>) => ({ ...f.input, manifest: f.authority.document({ ...f.payload, targetResourceIdentity: "different-target-identity" }) })],
    ["witness", (f: ReturnType<typeof fixture>) => ({ ...f.input, manifest: f.authority.document({ ...f.payload, targetRecoveryWitnessHash: "d".repeat(64) }) })],
    ["offline target", (f: ReturnType<typeof fixture>) => ({ ...f.input, provisioningEvidence: f.provisioner.document({ ...f.input.provisioningEvidence.payload, targetOfflineState: "connected" }) })],
    ["stale provisioning", (f: ReturnType<typeof fixture>) => ({ ...f.input, provisioningEvidence: f.provisioner.document({ ...f.input.provisioningEvidence.payload, expiresAt: "2026-09-27T00:00:00.000Z" }) })],
    ["fence", (f: ReturnType<typeof fixture>) => {
      const writerFenceEvidence = f.fencer.document({ ...f.input.writerFenceEvidence.payload, writerFenceState: "open" });
      return { ...f.input, writerFenceEvidence, manifest: f.authority.document({ ...f.payload,
        writerFenceEvidenceHash: sha256(canonicalJson(writerFenceEvidence.payload)) }) };
    }],
    ["stale fence", (f: ReturnType<typeof fixture>) => {
      const writerFenceEvidence = f.fencer.document({ ...f.input.writerFenceEvidence.payload, validUntil: "2026-09-27T00:00:00.000Z" });
      return { ...f.input, writerFenceEvidence, manifest: f.authority.document({ ...f.payload,
        writerFenceEvidenceHash: sha256(canonicalJson(writerFenceEvidence.payload)) }) };
    }],
    ["expiration", (f: ReturnType<typeof fixture>) => ({ ...f.input, now: new Date("2026-09-28T00:00:00.000Z") })],
    ["tool SHA", (f: ReturnType<typeof fixture>) => ({ ...f.input, manifest: f.authority.document({ ...f.payload, toolSourceSha: "0".repeat(40) }) })],
    ["tool bytes", (f: ReturnType<typeof fixture>) => ({ ...f.input, manifest: f.authority.document({ ...f.payload, toolSha256: "0".repeat(64) }) })],
  ] as const)("rejects a conflicting %s", (_name, mutate) => {
    const f = fixture();
    expect(() => validateAdmission(mutate(f))).toThrow();
  });

  it("rejects an altered signature and a different signing key", () => {
    const f = fixture();
    expect(() => verifySignedDocument({ ...f.input.manifest, payload: { ...f.payload, nonce: "different_nonce_1234567890123456" } }, f.authority.publicKeyPem)).toThrow("custody_signature_invalid");
    expect(() => validateAdmission({ ...f.input, manifestPublicKeyPem: signer().publicKeyPem })).toThrow("custody_authority_trust_anchor_mismatch");
  });

  it("requires distinct manifest, provisioning, and writer-fence authorities", () => {
    const f = fixture();
    expect(() => validateAdmission({ ...f.input, provisioningPublicKeyPem: f.authority.publicKeyPem,
      expectedProvisioningKeyHash: keyHash(f.authority.publicKeyPem) })).toThrow("custody_independent_authorities_required");
  });
});

describe("active generation inventory and authority gates", () => {
  const sourceResourceIdentity = "source-resource-identity-001";
  const sourceIncarnation = "source-incarnation-001";
  function row(accountId: string, state: string): LocalCustodyInventoryRow {
    return {
      workspaceId: "workspace-001", poolId: "pool-001", accountId, state,
      healthVersion: "7", activeGeneration: "2", credentialVersionId: `credential-${accountId}`,
      generation: "2", generationHash: "a".repeat(64), credentialKeyId: "local-kek-001",
      revision: "3", sourceRevision: "2", aadHash: "b".repeat(64),
      ciphertextHash: "c".repeat(64), envelopeMetadataHash: "d".repeat(64),
      custodyMode: "local_test", kmsKeyArn: null,
      kmsContextVersion: 1, envelopeVersion: 1, encryptionAlgorithm: "aes-256-gcm",
      databaseResourceIdentity: sourceResourceIdentity,
      databaseIncarnation: sourceIncarnation,
    };
  }
  const rows = [row("account-001", "healthy"), row("account-002", "healthy"), row("account-003", "restore_quarantined")];
  const expectedHash = sha256(canonicalJson(rows));
  function assess(candidate: readonly LocalCustodyInventoryRow[], hash = expectedHash) {
    return assessLocalCustodyInventory({ rows: candidate, expectedCount: 3,
      sourceResourceIdentity, sourceIncarnation, expectedHash: hash });
  }

  it("binds the two healthy and one quarantined generation", () => {
    expect(assess(rows)).toBe(expectedHash);
  });

  it("rejects omission, changed health, source context, and custody", () => {
    expect(() => assess(rows.slice(0, 2))).toThrow("custody_inventory_membership_invalid");
    expect(() => assess(rows, "d".repeat(64))).toThrow("custody_inventory_hash_mismatch");
    expect(() => assess([{ ...rows[0]!, healthVersion: "8" }, ...rows.slice(1)])).toThrow("custody_inventory_hash_mismatch");
    expect(() => assess([{ ...rows[0]!, databaseIncarnation: "target-incarnation-002" }, ...rows.slice(1)])).toThrow("custody_inventory_row_invalid");
    expect(() => assess([{ ...rows[0]!, custodyMode: "local_env" }, ...rows.slice(1)])).toThrow("custody_inventory_row_invalid");
    expect(() => assess([{ ...rows[0]!, kmsContextVersion: 2 }, ...rows.slice(1)])).toThrow("custody_inventory_row_invalid");
  });

  it("blocks any unresolved authority, including response-started effects", () => {
    const quiet = { unboundLiveAccounts: 0, pendingDeviceLogins: 0, unresolvedRelayRequests: 0,
      unresolvedUpstreamEffects: 0, activeMutationFences: 0,
      unresolvedCommentMints: 0, unreconciledRefreshCapabilities: 0,
      activeGrantInFlight: 0, activeV4Turns: 0, unsafeRuntimeGate: 0 };
    expect(() => assertQuiescentAuthority(quiet)).not.toThrow();
    expect(() => assertQuiescentAuthority({ ...quiet, unresolvedUpstreamEffects: 1 })).toThrow("custody_authority_unresolvedUpstreamEffects_unresolved");
    expect(() => assertQuiescentAuthority({ ...quiet, unsafeRuntimeGate: 1 })).toThrow("custody_authority_unsafeRuntimeGate_unresolved");
    const incomplete = { ...quiet };
    delete (incomplete as Partial<typeof quiet>).unresolvedUpstreamEffects;
    expect(() => assertQuiescentAuthority(incomplete)).toThrow("custody_authority_unresolvedUpstreamEffects_invalid");
  });
});

describe("offline database boundary", () => {
  it("accepts only a named disposable loopback database", () => {
    const url = "postgresql://synthetic:synthetic@127.0.0.1:15432/reviewrouter_custody_rebind_fixture";
    expect(assertDisposableDatabaseUrl(url, "test")).toBe(url);
    expect(assertDisposableDatabaseUrl(`${url}?schema=public`, "test")).toBe(`${url}?schema=public`);
    expect(() => assertDisposableDatabaseUrl(url, "production")).toThrow();
    expect(() => assertDisposableDatabaseUrl("postgresql://synthetic:synthetic@db.example/reviewrouter_custody_rebind_fixture", "test")).toThrow();
    expect(() => assertDisposableDatabaseUrl("postgresql://synthetic:synthetic@127.0.0.1:15432/customer", "test")).toThrow();
    expect(() => assertDisposableDatabaseUrl(`${url}?host=customer-db`, "test")).toThrow();
  });
});

describe("independent trust anchors", () => {
  it("requires pinned Ed25519 key fingerprints before accepting signed files", () => {
    const f = fixture();
    const fingerprint = (pem: string) => {
      const key = createPublicKey(pem);
      return sha256(key.export({ format: "der", type: "spki" }));
    };
    const anchors = {
      manifestPublicKeyPem: f.authority.publicKeyPem,
      provisioningPublicKeyPem: f.provisioner.publicKeyPem,
      fencePublicKeyPem: f.fencer.publicKeyPem,
      expectedManifestKeyHash: fingerprint(f.authority.publicKeyPem),
      expectedProvisioningKeyHash: fingerprint(f.provisioner.publicKeyPem),
      expectedFenceKeyHash: fingerprint(f.fencer.publicKeyPem),
    };
    expect(() => assertTrustedAuthorities(anchors)).not.toThrow();
    expect(() => assertTrustedAuthorities({ ...anchors, expectedFenceKeyHash: "0".repeat(64) })).toThrow("custody_authority_trust_anchor_mismatch");
    expect(() => assertTrustedAuthorities({ ...anchors, expectedManifestKeyHash: undefined })).toThrow("custody_authority_trust_anchor_missing");
  });
});
