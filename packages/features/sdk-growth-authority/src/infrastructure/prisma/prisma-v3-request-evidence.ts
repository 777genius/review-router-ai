import { timingSafeEqual } from "node:crypto";
import { AuthorityError } from "../../domain/contracts.js";
import {
  bindV3RequestEvidence,
  type TrustedV3RequestDecoderPort,
  type V3AuthenticatedProducer,
  type V3RequestEvidence,
} from "../../application/v3-request-evidence.js";
import type {
  AuthorityProvisioningPrismaClient,
  AuthorityWriteTransaction,
} from "./prisma-current-authority.js";

type Authenticator = {
  authenticateV3(
    credential: unknown,
    transaction?: AuthorityWriteTransaction,
  ): Promise<V3AuthenticatedProducer>;
};
type ManifestRow = {
  manifestId: string;
  scopeKey: string;
  epoch: bigint;
  manifestWire: Uint8Array;
  requestWire: Uint8Array;
};
type StoredRow = {
  evidenceId: string;
  assignmentId: string;
  operation: string;
  stage: string;
  manifestId: string;
  scopeKey: string;
  approvalEpoch: bigint;
  ownerEvidenceId: string;
  efToolArtifactId: string;
  firstJti: string;
  tokenIssuedAtMs: bigint;
  tokenExpiresAtMs: bigint;
  requestWire: Uint8Array;
  requestWireSha256: string;
  efRequestDigest: string;
  validationEvidenceWire: Uint8Array;
  validationEvidenceSha256: string;
};

function fail(): never {
  throw new AuthorityError("conflict");
}
function scopeKey(producer: V3AuthenticatedProducer): string {
  const e = producer.execution;
  return JSON.stringify([e.tenantId, e.repositoryId, e.pullRequest]);
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
function storedEvidence(row: StoredRow): V3RequestEvidence {
  return {
    evidenceId: row.evidenceId,
    assignmentId: row.assignmentId,
    operation: "check",
    stage: "request-validation",
    manifestId: row.manifestId,
    scopeKey: row.scopeKey,
    approvalEpoch: row.approvalEpoch,
    ownerEvidenceId: row.ownerEvidenceId,
    toolArtifactId: row.efToolArtifactId,
    firstJti: row.firstJti,
    tokenIssuedAtMs: Number(row.tokenIssuedAtMs),
    tokenExpiresAtMs: Number(row.tokenExpiresAtMs),
    requestWire: Uint8Array.from(row.requestWire),
    requestWireSha256: row.requestWireSha256,
    protocolDigest: row.efRequestDigest,
    validationEvidenceWire: Uint8Array.from(row.validationEvidenceWire),
    validationEvidenceSha256: row.validationEvidenceSha256,
  };
}

/** Inactive verifier-only ingress. It is intentionally absent from startup,
 * HTTP routes, candidate credentials, grants and publication. */
export class PrismaG1V3RequestEvidenceCommand {
  constructor(
    private readonly prisma: AuthorityProvisioningPrismaClient,
    private readonly authenticator: Authenticator,
    private readonly decoder: TrustedV3RequestDecoderPort,
  ) {}

  async retain(input: {
    readonly credential: unknown;
    readonly manifestId: string;
    readonly requestWire: Uint8Array;
  }): Promise<V3RequestEvidence> {
    if (
      typeof input.manifestId !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.manifestId) ||
      !(input.requestWire instanceof Uint8Array) ||
      input.requestWire.byteLength < 1 ||
      input.requestWire.byteLength > 1024 * 1024
    )
      fail();
    // Copy before the first await: the producer must not mutate the admitted
    // wire while the trusted decoder or database waits.
    const wire = Uint8Array.from(input.requestWire);
    const preflight = await this.authenticator.authenticateV3(input.credential);
    const decoded = await this.decoder.decode({
      requestWire: Uint8Array.from(wire),
      toolArtifactId: preflight.efToolArtifactId,
    });
    return this.prisma.$transaction(
      async (tx) => {
        // Reauthentication holds the protected assignment row through commit.
        const producer = await this.authenticator.authenticateV3(
          input.credential,
          tx,
        );
        if (
          producer.assignmentId !== preflight.assignmentId ||
          producer.efToolArtifactId !== preflight.efToolArtifactId
        )
          fail();
        const key = scopeKey(producer);
        // The security-definer lock function is granted only to the isolated
        // verifier producer DB role at deployment. A later approval writer
        // cannot replace this current epoch before this transaction commits.
        const current = await tx.$queryRaw`
          SELECT * FROM sdk_growth_v3_request_current_lock(${key})`;
        const authority = current[0] as
          | {
              epoch: bigint;
              evidence: Record<string, unknown>;
              installationActive: boolean;
              verifierActive: boolean;
            }
          | undefined;
        if (
          current.length !== 1 ||
          !authority ||
          authority.installationActive !== true ||
          authority.verifierActive !== true ||
          authority.evidence?.version !== 3 ||
          authority.evidence.revoked !== false
        )
          fail();
        const rows = await tx.$queryRaw`
          SELECT m."manifestId", m."scopeKey", m."epoch", m."manifestWire", m."requestWire"
          FROM "SdkGrowthV3ApprovedManifest" m
          JOIN "SdkGrowthApprovalFact" f ON f."v3ManifestId" = m."manifestId"
            AND f."scopeKey" = m."scopeKey" AND f."epoch" = m."epoch"
          WHERE m."manifestId" = ${input.manifestId} AND m."scopeKey" = ${key}
            AND m."epoch" = ${authority.epoch} AND f."action" = 'approve'`;
        const manifest = rows[0] as ManifestRow | undefined;
        if (rows.length !== 1 || !manifest) fail();
        const evidence = bindV3RequestEvidence({
          producer,
          manifestId: manifest.manifestId,
          manifestWire: manifest.manifestWire,
          approvedRequestWire: manifest.requestWire,
          scopeKey: key,
          approvalEpoch: manifest.epoch,
          requestWire: wire,
          decoded,
        });
        if (authority.evidence.evidenceId !== evidence.ownerEvidenceId) fail();
        // SQL116 also checks DB clock and these same protected relationships
        // at the deferred commit boundary, after every possible lock wait.
        await tx.$executeRaw`
          INSERT INTO "SdkGrowthV3RequestEvidence" (
            "evidenceId", "assignmentId", "operation", "stage", "scopeKey", "approvalEpoch",
            "manifestId", "ownerEvidenceId", "efToolArtifactId", "firstJti", "tokenIssuedAtMs",
            "tokenExpiresAtMs", "requestWire", "requestByteLength", "requestWireSha256",
            "efRequestDigest", "validationEvidenceWire", "validationEvidenceByteLength",
            "validationEvidenceSha256"
          ) VALUES (
            ${evidence.evidenceId}, ${evidence.assignmentId}, ${evidence.operation},
            ${evidence.stage}, ${evidence.scopeKey}, ${evidence.approvalEpoch},
            ${evidence.manifestId}, ${evidence.ownerEvidenceId}, ${evidence.toolArtifactId},
            ${evidence.firstJti}, ${BigInt(evidence.tokenIssuedAtMs)},
            ${BigInt(evidence.tokenExpiresAtMs)}, ${evidence.requestWire},
            ${evidence.requestWire.byteLength}, ${evidence.requestWireSha256},
            ${evidence.protocolDigest}, ${evidence.validationEvidenceWire},
            ${evidence.validationEvidenceWire.byteLength}, ${evidence.validationEvidenceSha256}
          ) ON CONFLICT ("assignmentId", "operation", "stage") DO NOTHING`;
        const accepted = await tx.$queryRaw`
          SELECT * FROM "SdkGrowthV3RequestEvidence"
          WHERE "assignmentId" = ${evidence.assignmentId}
            AND "operation" = ${evidence.operation} AND "stage" = ${evidence.stage}`;
        const stored = accepted[0] as StoredRow | undefined;
        if (
          accepted.length !== 1 ||
          !stored ||
          stored.evidenceId !== evidence.evidenceId ||
          stored.manifestId !== evidence.manifestId ||
          stored.approvalEpoch !== evidence.approvalEpoch ||
          stored.scopeKey !== evidence.scopeKey ||
          stored.ownerEvidenceId !== evidence.ownerEvidenceId ||
          stored.efToolArtifactId !== evidence.toolArtifactId ||
          stored.requestWireSha256 !== evidence.requestWireSha256 ||
          stored.efRequestDigest !== evidence.protocolDigest ||
          !bytesEqual(stored.requestWire, evidence.requestWire) ||
          !bytesEqual(
            stored.validationEvidenceWire,
            evidence.validationEvidenceWire,
          )
        )
          fail();
        // A conflict may wait for another writer and take the DO NOTHING path.
        // That path has no deferred INSERT trigger, so fence it here as well.
        const clock = await tx.$queryRaw`
          SELECT floor(extract(epoch from clock_timestamp()) * 1000)::bigint AS "nowMs"`;
        const nowMs = (clock[0] as { nowMs?: bigint } | undefined)?.nowMs;
        if (
          clock.length !== 1 ||
          typeof nowMs !== "bigint" ||
          nowMs < BigInt(producer.tokenIssuedAtMs) ||
          nowMs >= BigInt(producer.tokenExpiresAtMs) ||
          nowMs < BigInt(producer.assignmentCreatedAt.getTime()) ||
          nowMs >= BigInt(producer.assignmentExpiresAt.getTime()) ||
          typeof authority.evidence.expiresAt !== "number" ||
          nowMs >= BigInt(authority.evidence.expiresAt)
        )
          fail();
        return storedEvidence(stored);
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
}
