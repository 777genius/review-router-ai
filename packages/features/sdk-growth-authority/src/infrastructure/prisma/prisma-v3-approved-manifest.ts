import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  AuthorityChange,
  AuthorityScope,
} from "../../application/ports.js";
import {
  type TrustedV3ManifestProposalPort,
  type TrustedV3RequestValidationPort,
  validateV3ManifestProposal,
  type ValidatedV3Manifest,
} from "../../application/v3-approved-manifest.js";
import { AuthorityError } from "../../domain/contracts.js";
import {
  G1OperatorCredentialAuthenticator,
  type G1AuthenticatedOperator,
  type G1OperatorCredentialRow,
} from "./prisma-operator-credential.js";
import {
  authorityScopeKey,
  type AuthorityProvisioningPrismaClient,
  type AuthorityWriteTransaction,
} from "./prisma-current-authority.js";
import { storageScope } from "./authority-storage-validation.js";

type EpochRow = { epoch: bigint };
type ClockRow = { nowMs: bigint };
type CurrentRow = {
  binding: unknown;
  evidence: Record<string, unknown>;
  provenance: unknown;
  installationActive: boolean;
  verifierActive: boolean;
  action: string | null;
};

function fail(): never {
  throw new AuthorityError("owner-evidence");
}
function conflict(): never {
  throw new AuthorityError("conflict");
}
function requireEpoch(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value >= 9223372036854775807n)
    throw new AuthorityError("invalid-contract");
}
function ref(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)
  )
    throw new AuthorityError("invalid-contract");
}
function digest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`reviewrouter:g1:${domain}:v3\0`)
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

/** Dormant protected operator command. No API route or production startup composes it. */
export class PrismaG1V3ApprovedManifestCommand {
  constructor(
    private readonly prisma: AuthorityProvisioningPrismaClient,
    private readonly authenticator: G1OperatorCredentialAuthenticator,
    private readonly proposals: TrustedV3ManifestProposalPort,
    private readonly requestValidator: TrustedV3RequestValidationPort,
  ) {}

  async approve(
    credential: unknown,
    authorityScope: AuthorityScope,
    expectedEpoch: bigint,
    proposalReference: string,
    change: "provision" | "binding-replacement" | "owner-replacement",
  ): Promise<bigint> {
    const scope = storageScope(authorityScope);
    requireEpoch(expectedEpoch);
    ref(proposalReference);
    if ((expectedEpoch === 0n) !== (change === "provision"))
      throw new AuthorityError("invalid-contract");
    const actor = await this.authenticator.authenticateWithFence(
      credential,
      scope,
      change,
    );
    const loaded = await this.proposals.load(proposalReference, scope);
    if (!loaded) fail();
    const validated = await this.requestValidator.validate(loaded.requestWire);
    const manifest = validateV3ManifestProposal(loaded, scope, validated);
    return this.transact(
      scope,
      expectedEpoch,
      actor,
      change,
      async (tx, current, epoch, now) => {
        this.checkActorAndManifest(actor, manifest, now);
        if (current) {
          if (
            current.action !== "approve" ||
            current.evidence.revoked !== false ||
            !current.installationActive ||
            !current.verifierActive
          )
            conflict();
          const bindingChanged = !isDeepStrictEqual(
            current.binding,
            manifest.binding,
          );
          if (
            (change === "binding-replacement") !== bindingChanged ||
            (change === "owner-replacement" &&
              isDeepStrictEqual(current.evidence, manifest.approval) &&
              isDeepStrictEqual(current.provenance, manifest.provenance))
          )
            conflict();
        }
        await this.checkTool(tx, manifest);
        const scopeKey = authorityScopeKey(scope);
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding")
        VALUES (${scopeKey}, ${epoch}, ${JSON.stringify(manifest.binding)}::jsonb)`;
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthOwnerVersion" (
          "scopeKey", "epoch", "evidence", "provenance", "installationActive", "verifierActive", "reason"
        ) VALUES (
          ${scopeKey}, ${epoch}, ${JSON.stringify(manifest.approval)}::jsonb,
          ${JSON.stringify(manifest.provenance)}::jsonb, TRUE, TRUE, ${change}
        )`;
        await tx.$executeRaw`
        UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = ${epoch}
        WHERE "scopeKey" = ${scopeKey}`;
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthV3ApprovedManifest" (
          "manifestId", "scopeKey", "epoch", "manifestWire", "manifestByteLength", "manifestSha256",
          "requestWire", "requestByteLength", "requestWireSha256", "validationEvidenceWire",
          "validationEvidenceByteLength", "validationEvidenceSha256", "toolArtifactId"
        ) VALUES (
          ${manifest.manifestId}, ${scopeKey}, ${epoch}, ${manifest.manifestWire},
          ${manifest.manifestWire.byteLength}, ${manifest.manifestSha256},
          ${manifest.requestWire}, ${manifest.requestWire.byteLength}, ${manifest.requestWireSha256},
          ${manifest.validationEvidenceWire}, ${manifest.validationEvidenceWire.byteLength},
          ${manifest.validationEvidenceSha256}, ${manifest.toolArtifactId}
        )`;
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthApprovalFact" (
          "scopeKey", "epoch", "action", "proposalReference", "credentialId", "credentialGeneration",
          "bindingDigest", "decisionDigest", "v3ManifestId"
        ) VALUES (
          ${scopeKey}, ${epoch}, 'approve', ${proposalReference},
          ${actor.fence.credentialId}, ${actor.fence.generation},
          ${digest("binding", manifest.binding)},
          ${digest("decision", [manifest.approval, manifest.provenance])},
          ${manifest.manifestId}
        )`;
        return epoch;
      },
    );
  }

  async revoke(
    credential: unknown,
    authorityScope: AuthorityScope,
    expectedEpoch: bigint,
  ): Promise<bigint> {
    const scope = storageScope(authorityScope);
    requireEpoch(expectedEpoch);
    if (expectedEpoch === 0n) conflict();
    const actor = await this.authenticator.authenticateWithFence(
      credential,
      scope,
      "owner-revocation",
    );
    return this.transact(
      scope,
      expectedEpoch,
      actor,
      "owner-revocation",
      async (tx, current, epoch) => {
        if (
          !current ||
          current.action !== "approve" ||
          !current.evidence ||
          current.evidence.version !== 3 ||
          current.evidence.revoked !== false ||
          !current.installationActive ||
          !current.verifierActive
        )
          conflict();
        const scopeKey = authorityScopeKey(scope);
        const rows = await tx.$queryRaw`
        SELECT "v3ManifestId" FROM "SdkGrowthApprovalFact"
        WHERE "scopeKey" = ${scopeKey} AND "epoch" = ${expectedEpoch}`;
        const manifestId = (rows[0] as { v3ManifestId?: unknown } | undefined)
          ?.v3ManifestId;
        if (typeof manifestId !== "string") conflict();
        const revoked = { ...current.evidence, revoked: true };
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding")
        VALUES (${scopeKey}, ${epoch}, ${JSON.stringify(current.binding)}::jsonb)`;
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthOwnerVersion" (
          "scopeKey", "epoch", "evidence", "provenance", "installationActive", "verifierActive", "reason"
        ) VALUES (
          ${scopeKey}, ${epoch}, ${JSON.stringify(revoked)}::jsonb,
          ${JSON.stringify(current.provenance)}::jsonb, TRUE, TRUE, 'owner-revocation'
        )`;
        await tx.$executeRaw`
        UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = ${epoch}
        WHERE "scopeKey" = ${scopeKey}`;
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthApprovalFact" (
          "scopeKey", "epoch", "action", "approvalEpoch", "credentialId", "credentialGeneration",
          "bindingDigest", "decisionDigest"
        ) VALUES (
          ${scopeKey}, ${epoch}, 'revoke', ${expectedEpoch},
          ${actor.fence.credentialId}, ${actor.fence.generation},
          ${digest("binding", current.binding)},
          ${digest("decision", [current.evidence, current.provenance])}
        )`;
        return epoch;
      },
    );
  }

  private checkActorAndManifest(
    actor: G1AuthenticatedOperator,
    manifest: ValidatedV3Manifest,
    now: bigint,
  ): void {
    const approval = manifest.approval;
    if (
      manifest.provenance.installationId !== actor.principal.installationId ||
      approval.tenantId !== actor.principal.tenantId ||
      manifest.scope.githubRepositoryId !==
        actor.principal.githubRepositoryId ||
      manifest.scope.installationId !== actor.principal.installationId ||
      now < BigInt(approval.issuedAt as number) ||
      now >= BigInt(approval.expiresAt as number)
    )
      fail();
  }

  private async checkTool(
    tx: AuthorityWriteTransaction,
    manifest: ValidatedV3Manifest,
  ): Promise<void> {
    const rows = await tx.$queryRaw`
      SELECT "artifactId", "packageName", "packageVersion", "archiveSha256", "archiveSha512Sri", "sourceCommit",
             "sourceTree", "installedDistributionDigest", "provenanceKind"
      FROM "SdkGrowthV3ToolArtifact" WHERE "artifactId" = ${manifest.toolArtifactId} FOR SHARE`;
    const tool = rows[0] as Record<string, unknown> | undefined;
    const source = manifest.tool.source as Record<string, unknown>;
    const bindingTool = manifest.binding.tool as Record<string, unknown>;
    if (
      !tool ||
      tool.provenanceKind !== "source-built-fixture" ||
      tool.packageName !== bindingTool.packageName ||
      tool.packageVersion !== bindingTool.version ||
      tool.archiveSha256 !== manifest.tool.archiveSha256 ||
      tool.archiveSha512Sri !== manifest.tool.archiveSha512Sri ||
      tool.sourceCommit !== source.commit ||
      tool.sourceTree !== source.tree ||
      tool.installedDistributionDigest !==
        manifest.tool.installedDistributionDigest
    )
      fail();
  }

  private async transact(
    scope: AuthorityScope,
    expectedEpoch: bigint,
    actor: G1AuthenticatedOperator,
    change: AuthorityChange,
    operation: (
      tx: AuthorityWriteTransaction,
      current: CurrentRow | null,
      epoch: bigint,
      now: bigint,
    ) => Promise<bigint>,
  ): Promise<bigint> {
    const scopeKey = authorityScopeKey(scope);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`;
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthCurrentAuthority" ("scopeKey", "epoch")
        VALUES (${scopeKey}, 0) ON CONFLICT DO NOTHING`;
        const pointer = await tx.$queryRaw`
        SELECT "epoch" FROM "SdkGrowthCurrentAuthority"
        WHERE "scopeKey" = ${scopeKey} FOR UPDATE`;
        if ((pointer[0] as EpochRow | undefined)?.epoch !== expectedEpoch)
          conflict();
        const credentials = await tx.$queryRaw`
        SELECT "credentialId", "generation", "verifierSha256", "disabled",
               "expiresAtMs", "tenantId", "repositoryId", "pullRequest",
               "githubRepositoryId", "installationId", "issuer", "subject", "allowedOperations"
        FROM "SdkGrowthOperatorCredential"
        WHERE "credentialId" = ${actor.fence.credentialId} FOR SHARE`;
        const clock = await tx.$queryRaw`
        SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "nowMs"`;
        const now = (clock[0] as ClockRow | undefined)?.nowMs;
        const row = credentials[0] as G1OperatorCredentialRow | undefined;
        if (
          !row ||
          !now ||
          row.generation !== actor.fence.generation ||
          row.disabled ||
          now >= row.expiresAtMs ||
          row.tenantId !== scope.tenantId ||
          row.repositoryId !== scope.repositoryId ||
          row.pullRequest !== BigInt(scope.pullRequest) ||
          row.githubRepositoryId !== actor.principal.githubRepositoryId ||
          row.installationId !== actor.principal.installationId ||
          row.issuer !== actor.principal.issuer ||
          row.subject !== actor.principal.subject ||
          !row.allowedOperations.includes(change)
        )
          fail();
        const currentRows =
          expectedEpoch === 0n
            ? []
            : await tx.$queryRaw`
        SELECT b."binding", o."evidence", o."provenance", o."installationActive",
               o."verifierActive", f."action"
        FROM "SdkGrowthBindingVersion" b
        JOIN "SdkGrowthOwnerVersion" o ON o."scopeKey" = b."scopeKey" AND o."epoch" = b."epoch"
        LEFT JOIN "SdkGrowthApprovalFact" f ON f."scopeKey" = b."scopeKey" AND f."epoch" = b."epoch"
        WHERE b."scopeKey" = ${scopeKey} AND b."epoch" = ${expectedEpoch}`;
        const current = (currentRows[0] as CurrentRow | undefined) ?? null;
        if (expectedEpoch > 0n && !current) conflict();
        return operation(tx, current, expectedEpoch + 1n, now);
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
}
