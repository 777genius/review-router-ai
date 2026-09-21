import { createHash } from "node:crypto";
import type {
  AuthenticatedEfExecution,
  AuthorityCustodyAdmission,
  AuthorityCustodyCompletion,
  AuthorityCustodyPort,
  AuthorityCustodyRead,
  EfAuthorityDecisionContext,
  EfAuthorityDecisionTransactionPort,
} from "../../application/ef-authority-service.js";
import { SdkGrowthAuthority } from "../../application/authority.js";
import type {
  AuthorityScope,
  ClockPort,
  PublicationIntentPort,
} from "../../application/ports.js";
import { AuthorityError } from "../../domain/contracts.js";
import { PrismaCurrentAuthoritySnapshot } from "./prisma-current-authority.js";
import { PrismaReceiptRepository } from "./prisma-receipt-repository.js";

interface CustodyTransaction {
  $queryRaw<T = unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
}

export interface AuthorityCustodyPrismaClient {
  $transaction<T>(
    operation: (transaction: CustodyTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" },
  ): Promise<T>;
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]>;
}

interface CustodyRow {
  custodyId: string;
  tenantId: string;
  repositoryId: string;
  pullRequest: bigint;
  githubRepositoryId: string;
  installationId: string;
  subject: string;
  runId: string;
  runAttempt: string;
  verifierRevision: string;
  sourceCommit: string;
  sourceTree: string;
  requestDigest: string;
  requestWire: Uint8Array;
  grantDigest: string;
  grantWire: Uint8Array;
  candidateArchive: Uint8Array;
  candidateArchiveSha256: string;
  candidateArchiveSha512Sri: string;
  releasedArchive: Uint8Array;
  releasedArchiveSha256: string;
  releasedArchiveSha512Sri: string;
  toolArchive: Uint8Array;
  toolArchiveSha256: string;
  toolArchiveSha512Sri: string;
  installedDistributionWire: Uint8Array;
  installedDistributionDigest: string;
  completionDigest: string | null;
  completionWire: Uint8Array | null;
  reportDigest: string | null;
  finalizedReport: Uint8Array | null;
  receiptDigest: string | null;
  receiptWire: Uint8Array | null;
  publicationState: AuthorityCustodyRead["publicationState"] | null;
}

function scopedKey(execution: AuthenticatedEfExecution): string {
  return JSON.stringify([
    execution.tenantId,
    execution.repositoryId,
    execution.pullRequest,
    execution.githubRepositoryId,
    execution.installationId,
    execution.subject,
    execution.runId,
    execution.runAttempt,
    execution.verifierRevision,
  ]);
}

function id(execution: AuthenticatedEfExecution): string {
  return createHash("sha256").update(scopedKey(execution)).digest("hex");
}

function assertScope(
  scope: AuthorityScope,
  execution: AuthenticatedEfExecution,
): void {
  if (
    scope.tenantId !== execution.tenantId ||
    scope.repositoryId !== execution.repositoryId ||
    scope.pullRequest !== execution.pullRequest ||
    !Number.isSafeInteger(scope.pullRequest) ||
    scope.pullRequest < 1
  )
    throw new AuthorityError("wrong-identity");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    Buffer.from(left).equals(Buffer.from(right))
  );
}

function row(value: unknown): CustodyRow {
  if (!value || typeof value !== "object")
    throw new AuthorityError("invalid-contract");
  return value as CustodyRow;
}

function view(value: CustodyRow): AuthorityCustodyRead {
  return {
    requestDigest: value.requestDigest,
    grantDigest: value.grantDigest,
    grantWire: Uint8Array.from(value.grantWire),
    completionDigest: value.completionDigest,
    receiptDigest: value.receiptDigest,
    receiptWire: value.receiptWire ? Uint8Array.from(value.receiptWire) : null,
    publicationState: value.publicationState ?? "absent",
  };
}

function sameExecution(
  row: CustodyRow,
  value: AuthenticatedEfExecution,
): boolean {
  return (
    row.tenantId === value.tenantId &&
    row.repositoryId === value.repositoryId &&
    row.pullRequest === BigInt(value.pullRequest) &&
    row.githubRepositoryId === value.githubRepositoryId &&
    row.installationId === value.installationId &&
    row.subject === value.subject &&
    row.runId === value.runId &&
    row.runAttempt === value.runAttempt &&
    row.verifierRevision === value.verifierRevision &&
    row.sourceCommit === value.sourceCommit &&
    row.sourceTree === value.sourceTree
  );
}

function sameAdmission(
  row: CustodyRow,
  scope: AuthorityScope,
  value: AuthorityCustodyAdmission,
): boolean {
  return (
    row.pullRequest === BigInt(scope.pullRequest) &&
    sameExecution(row, value.execution) &&
    row.requestDigest === value.requestDigest &&
    equalBytes(row.requestWire, value.requestWire) &&
    row.grantDigest === value.grantDigest &&
    equalBytes(row.grantWire, value.grantWire) &&
    equalBytes(row.candidateArchive, value.candidateArchive.bytes) &&
    row.candidateArchiveSha256 === value.candidateArchive.sha256 &&
    row.candidateArchiveSha512Sri === value.candidateArchive.sha512Sri &&
    equalBytes(row.releasedArchive, value.releasedArchive.bytes) &&
    row.releasedArchiveSha256 === value.releasedArchive.sha256 &&
    row.releasedArchiveSha512Sri === value.releasedArchive.sha512Sri &&
    equalBytes(row.toolArchive, value.toolArchive.bytes) &&
    row.toolArchiveSha256 === value.toolArchive.sha256 &&
    row.toolArchiveSha512Sri === value.toolArchive.sha512Sri &&
    equalBytes(
      row.installedDistributionWire,
      value.installedDistributionWire,
    ) &&
    row.installedDistributionDigest === value.installedDistributionDigest
  );
}

function sameCompletion(
  row: CustodyRow,
  value: AuthorityCustodyCompletion,
): boolean {
  return (
    row.requestDigest === value.requestDigest &&
    row.grantDigest === value.grantDigest &&
    row.completionDigest === value.completionDigest &&
    row.completionWire !== null &&
    equalBytes(row.completionWire, value.completionWire) &&
    row.reportDigest === value.reportDigest &&
    row.finalizedReport !== null &&
    equalBytes(row.finalizedReport, value.finalizedReport) &&
    row.receiptDigest === value.receiptDigest &&
    row.receiptWire !== null &&
    equalBytes(row.receiptWire, value.receiptWire)
  );
}

export class PrismaAuthorityCustody implements AuthorityCustodyPort {
  constructor(
    private readonly prisma: AuthorityCustodyPrismaClient | CustodyTransaction,
    private readonly transactionHeld = false,
  ) {}

  async retainAdmission(
    scope: AuthorityScope,
    value: AuthorityCustodyAdmission,
  ): Promise<AuthorityCustodyRead> {
    assertScope(scope, value.execution);
    const custodyId = id(value.execution);
    const executionKey = scopedKey(value.execution);
    const execute = async (
      tx: CustodyTransaction,
    ): Promise<AuthorityCustodyRead> => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${executionKey}, 1))`;
      const [existingValue] = await tx.$queryRaw`
        SELECT c.*, p."state" AS "publicationState"
        FROM "SdkGrowthAuthorityCustody" c
        LEFT JOIN "SdkGrowthPublicationEffect" p ON p."custodyId" = c."custodyId"
        WHERE c."custodyId" = ${custodyId} FOR UPDATE OF c`;
      if (existingValue) {
        const existing = row(existingValue);
        if (!sameAdmission(existing, scope, value))
          throw new AuthorityError("conflict");
        return view(existing);
      }
      const e = value.execution;
      await tx.$executeRaw`
        INSERT INTO "SdkGrowthAuthorityCustody" (
          "custodyId", "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
          "installationId", "subject", "runId", "runAttempt", "verifierRevision",
          "sourceCommit", "sourceTree", "requestDigest", "requestWire",
          "grantDigest", "grantWire", "candidateArchive",
          "candidateArchiveSha256", "candidateArchiveSha512Sri",
          "releasedArchive", "releasedArchiveSha256", "releasedArchiveSha512Sri",
          "toolArchive", "toolArchiveSha256", "toolArchiveSha512Sri",
          "installedDistributionWire", "installedDistributionDigest")
        VALUES (
          ${custodyId}, ${e.tenantId}, ${e.repositoryId}, ${scope.pullRequest}, ${e.githubRepositoryId},
          ${e.installationId}, ${e.subject}, ${e.runId}, ${e.runAttempt},
          ${e.verifierRevision}, ${e.sourceCommit}, ${e.sourceTree},
          ${value.requestDigest}, ${Buffer.from(value.requestWire)},
          ${value.grantDigest}, ${Buffer.from(value.grantWire)},
          ${Buffer.from(value.candidateArchive.bytes)}, ${value.candidateArchive.sha256},
          ${value.candidateArchive.sha512Sri}, ${Buffer.from(value.releasedArchive.bytes)},
          ${value.releasedArchive.sha256}, ${value.releasedArchive.sha512Sri},
          ${Buffer.from(value.toolArchive.bytes)}, ${value.toolArchive.sha256},
          ${value.toolArchive.sha512Sri}, ${Buffer.from(value.installedDistributionWire)},
          ${value.installedDistributionDigest})`;
      return {
        requestDigest: value.requestDigest,
        grantDigest: value.grantDigest,
        grantWire: Uint8Array.from(value.grantWire),
        completionDigest: null,
        receiptDigest: null,
        receiptWire: null,
        publicationState: "absent",
      };
    };
    return this.run(execute);
  }

  async retainCompletion(
    scope: AuthorityScope,
    value: AuthorityCustodyCompletion,
  ): Promise<AuthorityCustodyRead> {
    assertScope(scope, value.execution);
    const custodyId = id(value.execution);
    const executionKey = scopedKey(value.execution);
    const execute = async (
      tx: CustodyTransaction,
    ): Promise<AuthorityCustodyRead> => {
      await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${executionKey}, 1))`;
      const [storedValue] = await tx.$queryRaw`
        SELECT c.*, p."state" AS "publicationState"
        FROM "SdkGrowthAuthorityCustody" c
        LEFT JOIN "SdkGrowthPublicationEffect" p ON p."custodyId" = c."custodyId"
        WHERE c."custodyId" = ${custodyId} FOR UPDATE OF c`;
      if (!storedValue) throw new AuthorityError("not-found");
      const stored = row(storedValue);
      if (
        stored.pullRequest !== BigInt(scope.pullRequest) ||
        !sameExecution(stored, value.execution)
      )
        throw new AuthorityError("wrong-identity");
      if (stored.completionDigest !== null) {
        if (!sameCompletion(stored, value))
          throw new AuthorityError("conflict");
        return view(stored);
      }
      if (
        stored.requestDigest !== value.requestDigest ||
        stored.grantDigest !== value.grantDigest
      )
        throw new AuthorityError("conflict");
      await tx.$executeRaw`
        UPDATE "SdkGrowthAuthorityCustody"
        SET "completionDigest" = ${value.completionDigest},
            "completionWire" = ${Buffer.from(value.completionWire)},
            "reportDigest" = ${value.reportDigest},
            "finalizedReport" = ${Buffer.from(value.finalizedReport)},
            "receiptDigest" = ${value.receiptDigest},
            "receiptWire" = ${Buffer.from(value.receiptWire)},
            "completedAt" = CURRENT_TIMESTAMP
        WHERE "custodyId" = ${custodyId} AND "completionDigest" IS NULL`;
      await tx.$executeRaw`
        INSERT INTO "SdkGrowthPublicationEffect" ("custodyId", "intentId", "state")
        VALUES (${custodyId}, ${value.receiptDigest}, 'pending')`;
      return {
        requestDigest: value.requestDigest,
        grantDigest: value.grantDigest,
        grantWire: Uint8Array.from(stored.grantWire),
        completionDigest: value.completionDigest,
        receiptDigest: value.receiptDigest,
        receiptWire: Uint8Array.from(value.receiptWire),
        publicationState: "pending",
      };
    };
    return this.run(execute);
  }

  async readExecution(
    scope: AuthorityScope,
    execution: AuthenticatedEfExecution,
  ): Promise<AuthorityCustodyRead | null> {
    assertScope(scope, execution);
    const [value] = await this.prisma.$queryRaw`
      SELECT c.*, p."state" AS "publicationState"
      FROM "SdkGrowthAuthorityCustody" c
      LEFT JOIN "SdkGrowthPublicationEffect" p ON p."custodyId" = c."custodyId"
      WHERE c."custodyId" = ${id(execution)}
        AND c."tenantId" = ${execution.tenantId}
        AND c."repositoryId" = ${execution.repositoryId}
        AND c."pullRequest" = ${scope.pullRequest}
        AND c."githubRepositoryId" = ${execution.githubRepositoryId}
        AND c."installationId" = ${execution.installationId}
        AND c."subject" = ${execution.subject}
        AND c."runId" = ${execution.runId}
        AND c."runAttempt" = ${execution.runAttempt}
        AND c."verifierRevision" = ${execution.verifierRevision}`;
    return value ? view(row(value)) : null;
  }

  async readAdmission(
    scope: AuthorityScope,
    execution: AuthenticatedEfExecution,
    requestDigest: string,
  ): Promise<AuthorityCustodyRead | null> {
    assertScope(scope, execution);
    const [value] = await this.prisma.$queryRaw`
      SELECT c.*, p."state" AS "publicationState"
      FROM "SdkGrowthAuthorityCustody" c
      LEFT JOIN "SdkGrowthPublicationEffect" p ON p."custodyId" = c."custodyId"
      WHERE c."custodyId" = ${id(execution)}
        AND c."tenantId" = ${execution.tenantId}
        AND c."repositoryId" = ${execution.repositoryId}
        AND c."pullRequest" = ${scope.pullRequest}
        AND c."githubRepositoryId" = ${execution.githubRepositoryId}
        AND c."installationId" = ${execution.installationId}
        AND c."subject" = ${execution.subject}
        AND c."runId" = ${execution.runId}
        AND c."runAttempt" = ${execution.runAttempt}
        AND c."verifierRevision" = ${execution.verifierRevision}
        AND c."sourceCommit" = ${execution.sourceCommit}
        AND c."sourceTree" = ${execution.sourceTree}
        AND c."requestDigest" = ${requestDigest}`;
    return value ? view(row(value)) : null;
  }

  async readCompletion(
    scope: AuthorityScope,
    execution: AuthenticatedEfExecution,
    requestDigest: string,
    completionDigest: string,
  ): Promise<AuthorityCustodyRead | null> {
    const value = await this.readAdmission(scope, execution, requestDigest);
    return value?.completionDigest === completionDigest ? value : null;
  }

  private run<T>(operation: (tx: CustodyTransaction) => Promise<T>) {
    if (this.transactionHeld)
      return operation(this.prisma as CustodyTransaction);
    return (this.prisma as AuthorityCustodyPrismaClient).$transaction(
      operation,
      { isolationLevel: "ReadCommitted" },
    );
  }
}

/** Prisma unit of work used by the EF boundary. It acquires the same authority
 * advisory fence as provisioning and then the stable execution identity lock.
 * Every nested adapter uses this exact transaction/connection. */
export class PrismaEfAuthorityDecisionTransaction implements EfAuthorityDecisionTransactionPort {
  constructor(
    private readonly prisma: AuthorityCustodyPrismaClient,
    private readonly clock: ClockPort,
    private readonly publication: PublicationIntentPort,
    private readonly ttlMs = 15 * 60 * 1000,
  ) {}

  async transact<T>(
    execution: AuthenticatedEfExecution,
    scope: AuthorityScope,
    operation: (context: EfAuthorityDecisionContext) => Promise<T>,
  ): Promise<T> {
    if (
      scope.tenantId !== execution.tenantId ||
      scope.repositoryId !== execution.repositoryId ||
      scope.pullRequest !== execution.pullRequest
    )
      throw new AuthorityError("wrong-identity");
    const authorityKey = JSON.stringify([
      scope.tenantId,
      scope.repositoryId,
      scope.pullRequest,
    ]);
    const executionKey = scopedKey(execution);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${authorityKey}, 0))`;
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${executionKey}, 1))`;
        const custody = new PrismaAuthorityCustody(tx, true);
        const authority = new SdkGrowthAuthority(
          {
            currentAuthority: new PrismaCurrentAuthoritySnapshot(
              tx,
              () => this.clock.now(),
              true,
            ),
            receipts: new PrismaReceiptRepository(tx, true),
            clock: this.clock,
            publication: this.publication,
          },
          this.ttlMs,
        );
        const result = await operation({ authority, custody });
        // This is deliberately after ledger/custody/effect writes and directly
        // before the outer transaction returns to Prisma for commit.
        await authority.assertPendingDecisionsCurrentAtCommit();
        return result;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
}
