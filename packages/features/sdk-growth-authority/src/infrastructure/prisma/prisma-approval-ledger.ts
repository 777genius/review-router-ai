import { createHash } from "node:crypto";
import type { TrustedG1ApprovalProposalPort } from "../../application/approval-ledger.js";
import { assertAuthorityTransition } from "../../application/current-authority-transition.js";
import type {
  AuthorityChange,
  AuthorityScope,
  CanonicalAuthorityMaterial,
  TrustedAuthorityRecord,
  TrustedAuthoritySourcePort,
} from "../../application/ports.js";
import { validateTrustedAuthorityRecord } from "../../application/trusted-authority-ingestion.js";
import { AuthorityError } from "../../domain/contracts.js";
import { equal } from "../../domain/validation.js";
import {
  G1OperatorCredentialAuthenticator,
  type G1AuthenticatedOperator,
  type G1OperatorCredentialRow,
} from "./prisma-operator-credential.js";
import {
  authorityScopeKey,
  type AuthorityProvisioningPrismaClient,
  type AuthorityReadTransaction,
  type AuthorityWriteTransaction,
  loadStoredMaterial,
  validateMaterial,
} from "./prisma-current-authority.js";
import { storageScope } from "./authority-storage-validation.js";

type EpochRow = { epoch: bigint };
type ClockRow = { nowMs: bigint };
type FactRow = {
  epoch: bigint;
  action: "approve" | "revoke";
  approvalEpoch: bigint | null;
  record: unknown;
};

function denied(): never {
  throw new AuthorityError("owner-evidence");
}
function conflict(): never {
  throw new AuthorityError("conflict");
}
function digest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`reviewrouter:g1:${domain}:v1\0`)
    .update(JSON.stringify(value))
    .digest("hex")}`;
}
function approvalMaterial(
  record: TrustedAuthorityRecord,
): CanonicalAuthorityMaterial {
  return {
    binding: record.binding,
    ownerEvidence: { ...record.approval, binding: record.binding },
    provenance: record.approvalProvenance,
    installationActive: record.installationActive,
    verifierActive: record.verifierActive,
  };
}
function recordFromMaterial(
  material: CanonicalAuthorityMaterial,
  identity: G1AuthenticatedOperator["principal"],
): TrustedAuthorityRecord {
  const { binding: _binding, ...approval } = material.ownerEvidence;
  return {
    tenantId: identity.tenantId,
    repositoryId: identity.repositoryId,
    pullRequest: material.binding.pullRequest,
    githubRepositoryId: identity.githubRepositoryId,
    installationId: identity.installationId,
    binding: material.binding,
    approval,
    approvalProvenance: material.provenance,
    installationActive: material.installationActive,
    verifierActive: material.verifierActive,
  };
}
function requireProposalReference(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)
  )
    throw new AuthorityError("invalid-contract");
}
function requireEpoch(value: bigint): void {
  if (typeof value !== "bigint" || value < 0n || value >= 9223372036854775807n)
    throw new AuthorityError("invalid-contract");
}
function requireFact(row: FactRow | undefined, epoch: bigint): FactRow {
  if (!row || row.epoch !== epoch) conflict();
  return row;
}

/** No route or production composition creates this writer. The proposal is
 * resolved by a protected server port; only its opaque reference crosses the
 * command boundary. A later P2 proposal builder owns source/package display. */
export class PrismaG1ApprovalLedgerCommand {
  constructor(
    private readonly prisma: AuthorityProvisioningPrismaClient,
    private readonly authenticator: G1OperatorCredentialAuthenticator,
    private readonly proposals: TrustedG1ApprovalProposalPort,
  ) {}

  async approve(
    credential: unknown,
    authorityScope: AuthorityScope,
    expectedEpoch: bigint,
    proposalReference: string,
  ): Promise<bigint> {
    const scope = storageScope(authorityScope);
    requireEpoch(expectedEpoch);
    requireProposalReference(proposalReference);
    const change: AuthorityChange =
      expectedEpoch === 0n ? "provision" : "owner-replacement";
    const actor = await this.authenticator.authenticateWithFence(
      credential,
      scope,
      change,
    );
    const loaded = await this.proposals.load(proposalReference, scope);
    if (!loaded) denied();
    // Validate exact existing trusted-source contract before any database write.
    const proposal = validateTrustedAuthorityRecord(
      structuredClone(loaded),
      scope,
    );
    if (
      proposal.githubRepositoryId !== actor.principal.githubRepositoryId ||
      proposal.installationId !== actor.principal.installationId ||
      !/^[1-9][0-9]*$/.test(proposal.githubRepositoryId) ||
      !/^[1-9][0-9]*$/.test(proposal.installationId)
    )
      denied();
    const next = validateMaterial(approvalMaterial(proposal), scope);
    if (
      next.ownerEvidence.decision !== "approved" ||
      next.ownerEvidence.revoked ||
      !next.installationActive ||
      !next.verifierActive
    )
      denied();
    return this.transact(
      scope,
      expectedEpoch,
      actor,
      change,
      async (tx, previous, epoch, now) => {
        if (
          next.ownerEvidence.issuedAt > now ||
          next.ownerEvidence.expiresAt <= now
        )
          denied();
        if (previous) {
          if (previous.ownerEvidence.revoked) conflict();
          const prior = await this.currentFact(
            tx,
            authorityScopeKey(scope),
            expectedEpoch,
          );
          if (prior.action !== "approve") conflict();
          this.assertFactMatches(prior, scope, previous);
        }
        assertAuthorityTransition(previous, next, change);
        const record = recordFromMaterial(next, actor.principal);
        await this.writeAuthority(
          tx,
          authorityScopeKey(scope),
          epoch,
          next,
          change,
        );
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthApprovalFact" (
          "scopeKey", "epoch", "action", "proposalReference", "credentialId",
          "credentialGeneration", "bindingDigest", "decisionDigest", "record"
        ) VALUES (
          ${authorityScopeKey(scope)}, ${epoch}, 'approve', ${proposalReference},
          ${actor.fence.credentialId}, ${actor.fence.generation},
          ${digest("binding", record.binding)},
          ${digest("decision", [record.approval, record.approvalProvenance])},
          ${JSON.stringify(record)}::jsonb
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
    const change = "owner-revocation" as const;
    const actor = await this.authenticator.authenticateWithFence(
      credential,
      scope,
      change,
    );
    return this.transact(
      scope,
      expectedEpoch,
      actor,
      change,
      async (tx, previous, epoch) => {
        if (!previous || previous.ownerEvidence.revoked) conflict();
        const scopeKey = authorityScopeKey(scope);
        const prior = await this.currentFact(tx, scopeKey, expectedEpoch);
        if (prior.action !== "approve") conflict();
        this.assertFactMatches(prior, scope, previous);
        const next = validateMaterial(
          {
            ...previous,
            ownerEvidence: { ...previous.ownerEvidence, revoked: true },
          },
          scope,
        );
        assertAuthorityTransition(previous, next, change);
        await this.writeAuthority(tx, scopeKey, epoch, next, change);
        const original = validateTrustedAuthorityRecord(prior.record, scope);
        await tx.$executeRaw`
        INSERT INTO "SdkGrowthApprovalFact" (
          "scopeKey", "epoch", "action", "approvalEpoch", "credentialId",
          "credentialGeneration", "bindingDigest", "decisionDigest"
        ) VALUES (
          ${scopeKey}, ${epoch}, 'revoke', ${prior.epoch},
          ${actor.fence.credentialId}, ${actor.fence.generation},
          ${digest("binding", original.binding)},
          ${digest("decision", [original.approval, original.approvalProvenance])}
        )`;
        return epoch;
      },
    );
  }

  private async transact(
    scope: AuthorityScope,
    expectedEpoch: bigint,
    actor: G1AuthenticatedOperator,
    change: AuthorityChange,
    operation: (
      tx: AuthorityWriteTransaction,
      previous: CanonicalAuthorityMaterial | null,
      epoch: bigint,
      now: number,
    ) => Promise<bigint>,
  ): Promise<bigint> {
    const scopeKey = authorityScopeKey(scope);
    return this.prisma.$transaction(
      async (tx) => {
        // All G1 writers use this order. FOR SHARE blocks policy-column rotation;
        // FOR KEY SHARE would not protect disabled/generation/expiry changes.
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`;
        await tx.$executeRaw`INSERT INTO "SdkGrowthCurrentAuthority" ("scopeKey", "epoch") VALUES (${scopeKey}, 0) ON CONFLICT DO NOTHING`;
        const current = await tx.$queryRaw`
        SELECT "epoch" FROM "SdkGrowthCurrentAuthority"
        WHERE "scopeKey" = ${scopeKey} FOR UPDATE`;
        if ((current[0] as EpochRow | undefined)?.epoch !== expectedEpoch)
          conflict();
        const credential = await tx.$queryRaw`
        SELECT "credentialId", "generation", "verifierSha256", "disabled",
               "expiresAtMs", "tenantId", "repositoryId", "pullRequest",
               "githubRepositoryId", "installationId", "issuer", "subject",
               "allowedOperations"
        FROM "SdkGrowthOperatorCredential"
        WHERE "credentialId" = ${actor.fence.credentialId} FOR SHARE`;
        const clock = await tx.$queryRaw`
        SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "nowMs"`;
        const now = (clock[0] as ClockRow | undefined)?.nowMs;
        const row = credential[0] as G1OperatorCredentialRow | undefined;
        if (
          !row ||
          row.generation !== actor.fence.generation ||
          row.disabled ||
          typeof now !== "bigint" ||
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
          denied();
        if (now > BigInt(Number.MAX_SAFE_INTEGER)) denied();
        const previous =
          expectedEpoch === 0n
            ? null
            : await loadStoredMaterial(tx, scopeKey, scope, expectedEpoch);
        return operation(tx, previous, expectedEpoch + 1n, Number(now));
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  private async currentFact(
    tx: AuthorityReadTransaction,
    scopeKey: string,
    epoch: bigint,
  ): Promise<FactRow> {
    const rows = await tx.$queryRaw`
      SELECT "epoch", "action", "approvalEpoch", "record"
      FROM "SdkGrowthApprovalFact"
      WHERE "scopeKey" = ${scopeKey} AND "epoch" = ${epoch}`;
    return requireFact(rows[0] as FactRow | undefined, epoch);
  }

  private assertFactMatches(
    fact: FactRow,
    scope: AuthorityScope,
    current: CanonicalAuthorityMaterial,
  ): void {
    const record = validateTrustedAuthorityRecord(fact.record, scope);
    if (!equal(approvalMaterial(record), current)) conflict();
  }

  private async writeAuthority(
    tx: AuthorityWriteTransaction,
    scopeKey: string,
    epoch: bigint,
    next: CanonicalAuthorityMaterial,
    reason: AuthorityChange,
  ): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding")
      VALUES (${scopeKey}, ${epoch}, ${JSON.stringify(next.binding)}::jsonb)`;
    await tx.$executeRaw`
      INSERT INTO "SdkGrowthOwnerVersion" (
        "scopeKey", "epoch", "evidence", "provenance", "installationActive",
        "verifierActive", "reason"
      ) VALUES (
        ${scopeKey}, ${epoch}, ${JSON.stringify(next.ownerEvidence)}::jsonb,
        ${JSON.stringify(next.provenance)}::jsonb, ${next.installationActive},
        ${next.verifierActive}, ${reason}
      )`;
    await tx.$executeRaw`
      UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = ${epoch}
      WHERE "scopeKey" = ${scopeKey}`;
  }
}

/** Current-epoch source for the existing trusted-ingestion port. It reads only
 * committed ledger facts; a non-ledger authority transition yields no source. */
export class PrismaG1ApprovalLedgerSource implements TrustedAuthoritySourcePort {
  constructor(private readonly prisma: AuthorityReadTransaction) {}

  async load(
    input: Parameters<TrustedAuthoritySourcePort["load"]>[0],
  ): Promise<TrustedAuthorityRecord | null> {
    const scope = storageScope(input.scope);
    const rows = await this.prisma.$queryRaw`
      SELECT f."action", COALESCE(f."record", original."record") AS "record"
      FROM "SdkGrowthCurrentAuthority" current
      JOIN "SdkGrowthApprovalFact" f
        ON f."scopeKey" = current."scopeKey" AND f."epoch" = current."epoch"
      LEFT JOIN "SdkGrowthApprovalFact" original
        ON original."scopeKey" = f."scopeKey" AND original."epoch" = f."approvalEpoch"
      WHERE current."scopeKey" = ${authorityScopeKey(scope)}`;
    const row = rows[0] as
      | {
          action: "approve" | "revoke";
          record: unknown;
        }
      | undefined;
    if (!row) return null;
    const original = validateTrustedAuthorityRecord(row.record, scope);
    if (
      input.principal.tenantId !== scope.tenantId ||
      input.principal.repositoryId !== scope.repositoryId ||
      original.githubRepositoryId !== input.principal.githubRepositoryId ||
      original.installationId !== input.principal.installationId
    )
      return null;
    return row.action === "revoke"
      ? { ...original, approval: { ...original.approval, revoked: true } }
      : original;
  }
}
