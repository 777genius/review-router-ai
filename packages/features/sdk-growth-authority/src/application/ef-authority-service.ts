import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  AuthorityError,
  type Binding,
  type Completion,
  type Grant,
  type Identity,
  type Receipt,
} from "../domain/contracts.js";
import { canonical, equal } from "../domain/validation.js";
import type { SdkGrowthAuthority } from "./authority.js";
import type { AuthorityScope } from "./ports.js";

export const efAuthorityAdapterVersion = 1 as const;
export const efSuccessorCompatibilityTodo = Object.freeze([
  "freeze successor schema/version and canonical digest vectors",
  "freeze packed archive observation and installed-distribution fields",
  "freeze completion uncertainty/readback result shape",
  "freeze promotion admission-receipt and prepared-plan linkage",
  "freeze exact request/response byte limits and replay retention",
] as const);

export interface AuthenticatedEfExecution {
  readonly tenantId: string;
  readonly repositoryId: string;
  readonly githubRepositoryId: string;
  readonly installationId: string;
  readonly subject: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly verifierRevision: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
}

export interface EfBindingAssertions {
  readonly repositoryId: string;
  readonly installationId: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly verifierRevision: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
}

export interface ArchiveCustody {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly sha512Sri: string;
}

export interface DecodedEfAdmission {
  readonly adapterVersion: typeof efAuthorityAdapterVersion;
  readonly requestWire: Uint8Array;
  readonly requestDigest: string;
  readonly request: {
    readonly version: 1;
    readonly repositoryId: string;
    readonly pullRequest: number;
  };
  readonly assertions: EfBindingAssertions;
  /** Exact pinned normalization of every owner-governed EF field. */
  readonly authorityBinding: Binding;
  readonly candidateArchive: ArchiveCustody;
  readonly releasedArchive: ArchiveCustody;
  readonly toolArchive: ArchiveCustody;
  readonly installedDistributionWire: Uint8Array;
  readonly installedDistributionDigest: string;
}

export interface DecodedEfCompletion {
  readonly adapterVersion: typeof efAuthorityAdapterVersion;
  readonly requestDigest: string;
  readonly grantDigest: string;
  readonly completionDigest: string;
  readonly completionWire: Uint8Array;
  readonly completion: Completion;
  readonly assertions: EfBindingAssertions;
  readonly finalizedReport: Uint8Array;
  readonly reportDigest: string;
  readonly reportDecision: NormalizedFinalizedReportDecision;
}

/** EF successor compatibility is deliberately isolated here. The final EF
 * successor schema, canonical digest vectors, promotion linkage and uncertainty
 * result are not frozen at this base. Implementations must be version-pinned;
 * this package never imports EF runtime or guesses its final JSON contract. */
export interface EfAuthorityCodecPort {
  decodeAdmission(input: unknown): DecodedEfAdmission;
  decodeCompletion(input: unknown): DecodedEfCompletion;
  encodeGrant(input: {
    readonly requestDigest: string;
    readonly grant: Grant;
  }): Uint8Array;
  encodeReceipt(input: {
    readonly requestDigest: string;
    readonly grantDigest: string;
    readonly completionDigest: string;
    readonly receipt: Receipt;
  }): Uint8Array;
}

export interface TrustedVerifierEvidence {
  readonly verifierRevision: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly candidateArchiveSha256: string;
  readonly candidateArchiveSha512Sri: string;
  readonly releasedArchiveSha256: string;
  readonly releasedArchiveSha512Sri: string;
  readonly toolArchiveSha256: string;
  readonly toolArchiveSha512Sri: string;
  readonly installedDistributionDigest: string;
  readonly authorityBinding: Binding;
}

export interface NormalizedFinalizedReportDecision {
  readonly outcome: Completion["outcome"];
  readonly coverage: Completion["coverage"];
  readonly coveredScopes: readonly string[];
  readonly phases: readonly string[];
}

export interface TrustedVerifierCustodyPort {
  load(execution: AuthenticatedEfExecution): Promise<TrustedVerifierEvidence>;
  verifyFinalizedReport(input: {
    readonly execution: AuthenticatedEfExecution;
    readonly report: Uint8Array;
    readonly completion: Completion;
    readonly reportDecision: NormalizedFinalizedReportDecision;
  }): Promise<void>;
}

export interface AuthorityCustodyAdmission {
  readonly execution: AuthenticatedEfExecution;
  readonly requestDigest: string;
  readonly requestWire: Uint8Array;
  readonly grantDigest: string;
  readonly grantWire: Uint8Array;
  readonly candidateArchive: ArchiveCustody;
  readonly releasedArchive: ArchiveCustody;
  readonly toolArchive: ArchiveCustody;
  readonly installedDistributionWire: Uint8Array;
  readonly installedDistributionDigest: string;
}

export interface AuthorityCustodyCompletion {
  readonly execution: AuthenticatedEfExecution;
  readonly requestDigest: string;
  readonly grantDigest: string;
  readonly completionDigest: string;
  readonly completionWire: Uint8Array;
  readonly reportDigest: string;
  readonly finalizedReport: Uint8Array;
  readonly receiptDigest: string;
  readonly receiptWire: Uint8Array;
}

export interface AuthorityCustodyRead {
  readonly requestDigest: string;
  readonly grantDigest: string;
  readonly grantWire: Uint8Array;
  readonly completionDigest: string | null;
  readonly receiptDigest: string | null;
  readonly receiptWire: Uint8Array | null;
  readonly publicationState:
    | "absent"
    | "pending"
    | "queued"
    | "sending"
    | "reconcile-required"
    | "superseded"
    | "not-applied"
    | "applied";
}

export interface AuthorityCustodyPort {
  retainAdmission(
    scope: AuthorityScope,
    value: AuthorityCustodyAdmission,
  ): Promise<AuthorityCustodyRead>;
  retainCompletion(
    scope: AuthorityScope,
    value: AuthorityCustodyCompletion,
  ): Promise<AuthorityCustodyRead>;
  readExecution(
    scope: AuthorityScope,
    execution: AuthenticatedEfExecution,
  ): Promise<AuthorityCustodyRead | null>;
  readAdmission(
    scope: AuthorityScope,
    execution: AuthenticatedEfExecution,
    requestDigest: string,
  ): Promise<AuthorityCustodyRead | null>;
  readCompletion(
    scope: AuthorityScope,
    execution: AuthenticatedEfExecution,
    requestDigest: string,
    completionDigest: string,
  ): Promise<AuthorityCustodyRead | null>;
}

export interface EfAuthorityDecisionContext {
  readonly authority: SdkGrowthAuthority;
  readonly custody: AuthorityCustodyPort;
}

/** One database transaction owns the authority-scope fence, execution-identity
 * serialization, ledger decision, exact wire custody, and completion effect. */
export interface EfAuthorityDecisionTransactionPort {
  transact<T>(
    execution: AuthenticatedEfExecution,
    scope: AuthorityScope,
    operation: (context: EfAuthorityDecisionContext) => Promise<T>,
  ): Promise<T>;
}

const limits = {
  wire: 1024 * 1024,
  distribution: 2 * 1024 * 1024,
  archive: 8 * 1024 * 1024,
  tool: 16 * 1024 * 1024,
  report: 16 * 1024 * 1024,
} as const;

function bytes(value: Uint8Array, maximum: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  )
    throw new AuthorityError("invalid-contract");
  return Uint8Array.from(value);
}

function sha256(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha512Sri(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function exactDigest(value: Uint8Array, expected: string): void {
  if (sha256(value) !== expected) throw new AuthorityError("conflict");
}

function archive(value: ArchiveCustody, maximum: number): ArchiveCustody {
  const retained = bytes(value.bytes, maximum);
  if (
    sha256(retained) !== value.sha256 ||
    sha512Sri(retained) !== value.sha512Sri
  )
    throw new AuthorityError("conflict");
  return { bytes: retained, sha256: value.sha256, sha512Sri: value.sha512Sri };
}

function identity(execution: AuthenticatedEfExecution): Identity {
  return {
    tenantId: execution.tenantId,
    repositoryId: execution.repositoryId,
    subject: execution.subject,
  };
}

/** The compact ledger key is scoped by authority scope, then binds the exact
 * authenticated execution to the canonical EF request digest. The retained EF
 * digest remains independently addressable for historical readback. */
function authorityRequestId(
  execution: AuthenticatedEfExecution,
  requestDigest: string,
): string {
  return sha256(
    Buffer.from(
      canonical([
        execution.tenantId,
        execution.repositoryId,
        execution.githubRepositoryId,
        execution.installationId,
        execution.subject,
        execution.runId,
        execution.runAttempt,
        execution.verifierRevision,
        execution.sourceCommit,
        execution.sourceTree,
        requestDigest,
      ]),
      "utf8",
    ),
  );
}

function assertExecution(
  execution: AuthenticatedEfExecution,
  assertions: EfBindingAssertions,
): void {
  const expected: EfBindingAssertions = {
    repositoryId: execution.githubRepositoryId,
    installationId: execution.installationId,
    runId: execution.runId,
    runAttempt: execution.runAttempt,
    verifierRevision: execution.verifierRevision,
    sourceCommit: execution.sourceCommit,
    sourceTree: execution.sourceTree,
  };
  if (!equal(expected, assertions)) throw new AuthorityError("wrong-identity");
}

function digestWire(
  value: Uint8Array,
  maximum = limits.wire,
): {
  readonly wire: Uint8Array;
  readonly digest: string;
} {
  const wire = bytes(value, maximum);
  return { wire, digest: sha256(wire) };
}

export class EfAuthorityService {
  constructor(
    private readonly transactions: EfAuthorityDecisionTransactionPort,
    private readonly codec: EfAuthorityCodecPort,
    private readonly verifierCustody: TrustedVerifierCustodyPort,
  ) {}

  async admit(
    execution: AuthenticatedEfExecution,
    repositoryId: string,
    pullRequest: number,
    input: unknown,
  ): Promise<Uint8Array> {
    const decoded = this.codec.decodeAdmission(input);
    if (decoded.adapterVersion !== efAuthorityAdapterVersion)
      throw new AuthorityError("invalid-contract");
    assertExecution(execution, decoded.assertions);
    if (
      decoded.request.repositoryId !== repositoryId ||
      decoded.request.repositoryId !== execution.repositoryId ||
      decoded.request.pullRequest !== pullRequest
    )
      throw new AuthorityError("wrong-identity");
    const request = digestWire(decoded.requestWire);
    if (request.digest !== decoded.requestDigest)
      throw new AuthorityError("conflict");
    const requestId = authorityRequestId(execution, request.digest);
    const trusted = await this.verifierCustody.load(execution);
    if (
      trusted.verifierRevision !== execution.verifierRevision ||
      trusted.sourceCommit !== execution.sourceCommit ||
      trusted.sourceTree !== execution.sourceTree ||
      trusted.candidateArchiveSha256 !== decoded.candidateArchive.sha256 ||
      trusted.candidateArchiveSha512Sri !==
        decoded.candidateArchive.sha512Sri ||
      trusted.releasedArchiveSha256 !== decoded.releasedArchive.sha256 ||
      trusted.releasedArchiveSha512Sri !== decoded.releasedArchive.sha512Sri ||
      trusted.toolArchiveSha256 !== decoded.toolArchive.sha256 ||
      trusted.toolArchiveSha512Sri !== decoded.toolArchive.sha512Sri ||
      trusted.installedDistributionDigest !==
        decoded.installedDistributionDigest ||
      !equal(trusted.authorityBinding, decoded.authorityBinding)
    )
      throw new AuthorityError("binding-changed");
    const candidateArchive = archive(decoded.candidateArchive, limits.archive);
    const releasedArchive = archive(decoded.releasedArchive, limits.archive);
    const toolArchive = archive(decoded.toolArchive, limits.tool);
    const distribution = digestWire(
      decoded.installedDistributionWire,
      limits.distribution,
    );
    if (distribution.digest !== decoded.installedDistributionDigest)
      throw new AuthorityError("conflict");
    return this.transactions.transact(
      execution,
      { tenantId: execution.tenantId, repositoryId, pullRequest },
      async ({ authority, custody }) => {
        const scope = {
          tenantId: execution.tenantId,
          repositoryId,
          pullRequest,
        };
        // The execution lock is already held. Conflicts are rejected before a
        // scope fence can advance, so a losing request cannot fence the winner.
        const existing = await custody.readExecution(scope, execution);
        if (existing && existing.requestDigest !== request.digest)
          throw new AuthorityError("conflict");
        const grant = await authority.request(identity(execution), {
          version: 1,
          requestId,
          repositoryId,
          pullRequest,
        });
        if (
          grant.binding.repositoryId !== repositoryId ||
          grant.binding.pullRequest !== pullRequest ||
          grant.binding.head !== execution.sourceCommit ||
          !equal(grant.binding, trusted.authorityBinding)
        )
          throw new AuthorityError("binding-changed");
        const grantWire = bytes(
          this.codec.encodeGrant({
            requestDigest: decoded.requestDigest,
            grant,
          }),
          limits.wire,
        );
        const grantDigest = sha256(grantWire);
        const retained = await custody.retainAdmission(scope, {
          execution,
          requestDigest: request.digest,
          requestWire: request.wire,
          grantDigest,
          grantWire,
          candidateArchive,
          releasedArchive,
          toolArchive,
          installedDistributionWire: distribution.wire,
          installedDistributionDigest: distribution.digest,
        });
        if (
          retained.requestDigest !== request.digest ||
          retained.grantDigest !== grantDigest
        )
          throw new AuthorityError("conflict");
        return Uint8Array.from(retained.grantWire);
      },
    );
  }

  async complete(
    execution: AuthenticatedEfExecution,
    repositoryId: string,
    pullRequest: number,
    input: unknown,
  ): Promise<Uint8Array> {
    const decoded = this.codec.decodeCompletion(input);
    if (decoded.adapterVersion !== efAuthorityAdapterVersion)
      throw new AuthorityError("invalid-contract");
    assertExecution(execution, decoded.assertions);
    if (
      decoded.completion.binding.repositoryId !== repositoryId ||
      repositoryId !== execution.repositoryId ||
      decoded.completion.binding.pullRequest !== pullRequest
    )
      throw new AuthorityError("wrong-identity");
    const completion = digestWire(decoded.completionWire);
    if (completion.digest !== decoded.completionDigest)
      throw new AuthorityError("conflict");
    const report = bytes(decoded.finalizedReport, limits.report);
    exactDigest(report, decoded.reportDigest);
    if (decoded.completion.reportDigest !== decoded.reportDigest)
      throw new AuthorityError("conflict");
    await this.verifierCustody.verifyFinalizedReport({
      execution,
      report,
      completion: decoded.completion,
      reportDecision: decoded.reportDecision,
    });
    return this.transactions.transact(
      execution,
      { tenantId: execution.tenantId, repositoryId, pullRequest },
      async ({ authority, custody }) => {
        const scope = {
          tenantId: execution.tenantId,
          repositoryId,
          pullRequest,
        };
        const admission = await custody.readAdmission(
          scope,
          execution,
          decoded.requestDigest,
        );
        if (!admission) throw new AuthorityError("not-found");
        if (admission.grantDigest !== decoded.grantDigest)
          throw new AuthorityError("conflict");
        const receipt = await authority.complete(
          identity(execution),
          decoded.completion,
        );
        const receiptWire = bytes(
          this.codec.encodeReceipt({
            requestDigest: decoded.requestDigest,
            grantDigest: decoded.grantDigest,
            completionDigest: decoded.completionDigest,
            receipt,
          }),
          limits.wire,
        );
        const receiptDigest = sha256(receiptWire);
        const retained = await custody.retainCompletion(scope, {
          execution,
          requestDigest: decoded.requestDigest,
          grantDigest: decoded.grantDigest,
          completionDigest: completion.digest,
          completionWire: completion.wire,
          reportDigest: decoded.reportDigest,
          finalizedReport: report,
          receiptDigest,
          receiptWire,
        });
        if (
          retained.completionDigest !== completion.digest ||
          retained.receiptDigest !== receiptDigest ||
          !retained.receiptWire
        )
          throw new AuthorityError("conflict");
        return Uint8Array.from(retained.receiptWire);
      },
    );
  }

  async admissionReadback(
    execution: AuthenticatedEfExecution,
    repositoryId: string,
    pullRequest: number,
    requestDigest: string,
  ): Promise<Uint8Array | null> {
    const retained = await this.transactions.transact(
      execution,
      { tenantId: execution.tenantId, repositoryId, pullRequest },
      ({ custody }) =>
        custody.readAdmission(
          { tenantId: execution.tenantId, repositoryId, pullRequest },
          execution,
          requestDigest,
        ),
    );
    return retained ? Uint8Array.from(retained.grantWire) : null;
  }

  async completionReadback(
    execution: AuthenticatedEfExecution,
    repositoryId: string,
    pullRequest: number,
    requestDigest: string,
    completionDigest: string,
  ): Promise<Uint8Array | null> {
    const retained = await this.transactions.transact(
      execution,
      { tenantId: execution.tenantId, repositoryId, pullRequest },
      ({ custody }) =>
        custody.readCompletion(
          { tenantId: execution.tenantId, repositoryId, pullRequest },
          execution,
          requestDigest,
          completionDigest,
        ),
    );
    return retained?.receiptWire ? Uint8Array.from(retained.receiptWire) : null;
  }

  async status(
    execution: AuthenticatedEfExecution,
    repositoryId: string,
    pullRequest: number,
    requestDigest: string,
  ): Promise<
    | (AuthorityCustodyRead & {
        readonly authorityState: "current" | "stale";
      })
    | null
  > {
    return this.transactions.transact(
      execution,
      { tenantId: execution.tenantId, repositoryId, pullRequest },
      async ({ authority, custody }) => {
        const retained = await custody.readAdmission(
          { tenantId: execution.tenantId, repositoryId, pullRequest },
          execution,
          requestDigest,
        );
        if (!retained) return null;
        let authorityState: "current" | "stale" = "stale";
        try {
          await authority.currentGrant(identity(execution), {
            version: 1,
            requestId: authorityRequestId(execution, requestDigest),
            repositoryId,
            pullRequest,
          });
          authorityState = "current";
        } catch (error) {
          // Only authority outcomes that prove the grant is no longer live are
          // represented as stale. Storage and infrastructure failures must
          // escape so the route can return a retryable 503.
          if (!isStaleAuthority(error)) throw error;
        }
        return { ...retained, authorityState };
      },
    );
  }
}

function isStaleAuthority(error: unknown): boolean {
  return (
    error instanceof AuthorityError &&
    [
      "not-found",
      "expired",
      "revoked",
      "fenced",
      "binding-changed",
      "owner-evidence",
    ].includes(error.code)
  );
}
