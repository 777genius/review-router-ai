import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  AuthenticatedEfExecution,
  Binding,
  CanonicalAuthorityMaterial,
  NormalizedFinalizedReportDecision,
  TrustedVerifierCustodyPort,
  TrustedVerifierEvidence,
  VerifierAuthorityPolicyPort,
} from "@reviewrouter/features-sdk-growth-authority";
import type { Completion } from "@reviewrouter/features-sdk-growth-authority";
import {
  AuthorityError,
  PinnedEfAuthorityCodecV1,
  parseBinding,
  parseGrant,
  parseOwnerEvidence,
} from "@reviewrouter/features-sdk-growth-authority";

export interface VerifierCustodyRecord extends TrustedVerifierEvidence {
  readonly producer: "reviewrouter-verifier";
  readonly candidateWritable: false;
}

export interface FinalizedVerifierReportRecord {
  readonly producer: "reviewrouter-verifier";
  readonly candidateWritable: false;
  readonly repositoryId: string;
  readonly pullRequest: number;
  readonly runId: string;
  readonly runAttempt: string;
  readonly verifierRevision: string;
  readonly reportDigest: string;
  readonly reportLength: number;
  readonly grantId: string;
  readonly outcome: "passed" | "failed";
  readonly coverage: "complete" | "partial" | "unavailable";
  readonly coveredScopes: readonly string[];
  readonly phases: readonly string[];
  readonly finalizedReport: Uint8Array;
}

export interface SdkGrowthVerifierEvidenceSourcePort {
  load(
    execution: AuthenticatedEfExecution,
  ): Promise<VerifierCustodyRecord | null>;
  loadFinalizedReport(
    execution: AuthenticatedEfExecution,
    reportDigest: string,
  ): Promise<FinalizedVerifierReportRecord | null>;
}

export interface AuthenticatedSdkGrowthVerifierProducer {
  readonly producer: "reviewrouter-verifier";
  readonly issuer: string;
  readonly subject: string;
  readonly authenticationId: string;
  readonly execution: AuthenticatedEfExecution;
}

/** Implemented by protected service identity (for example workload mTLS or a
 * dedicated service JWT), never by the candidate GitHub Actions OIDC token. */
export interface SdkGrowthVerifierProducerAuthenticatorPort {
  authenticate(
    credential: unknown,
    transaction?: VerifierEvidencePrisma,
  ): Promise<AuthenticatedSdkGrowthVerifierProducer>;
}

export interface RetainVerifierEvidenceInput {
  readonly expectedAuthorityEpoch: number;
  readonly candidateArchive: Uint8Array;
  readonly releasedArchive: Uint8Array;
  readonly toolArchive: Uint8Array;
  readonly installedDistributionWire: Uint8Array;
}

export interface RetainFinalizedVerifierReportInput {
  readonly expectedAuthorityEpoch: number;
  readonly requestDigest: string;
  readonly grantDigest: string;
  readonly finalizedReport: Uint8Array;
  readonly decision: NormalizedFinalizedReportDecision;
}

interface AuthorityEvidenceLink {
  readonly binding: Binding;
  readonly authorityEpoch: number;
  readonly ownerEvidenceId: string;
  readonly ownerSourceDigest: string;
}

interface CurrentAuthorityRow {
  readonly epoch: number;
  readonly material: CanonicalAuthorityMaterial;
}

function sha256(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** Outer adapter over verifier-owned, read-only evidence custody. The source
 * implementation must resolve archive bytes/manifest evidence independently of
 * the candidate and must not point at a candidate-writable worktree. */
export class SdkGrowthVerifierCustody implements TrustedVerifierCustodyPort {
  constructor(private readonly source: SdkGrowthVerifierEvidenceSourcePort) {}

  async load(
    execution: AuthenticatedEfExecution,
  ): Promise<TrustedVerifierEvidence> {
    const record = await this.source.load(execution);
    if (
      !record ||
      record.producer !== "reviewrouter-verifier" ||
      record.candidateWritable !== false ||
      record.verifierRevision !== execution.verifierRevision ||
      record.sourceCommit !== execution.sourceCommit ||
      record.sourceTree !== execution.sourceTree
    )
      throw new AuthorityError("owner-evidence");
    return structuredClone(record);
  }

  async verifyFinalizedReport(input: {
    readonly execution: AuthenticatedEfExecution;
    readonly report: Uint8Array;
    readonly completion: Completion;
    readonly reportDecision: NormalizedFinalizedReportDecision;
  }): Promise<void> {
    const digest = sha256(input.report);
    if (digest !== input.completion.reportDigest)
      throw new AuthorityError("conflict");
    const record = await this.source.loadFinalizedReport(
      input.execution,
      digest,
    );
    const decision = input.reportDecision;
    if (
      !record ||
      record.producer !== "reviewrouter-verifier" ||
      record.candidateWritable !== false ||
      record.repositoryId !== input.execution.repositoryId ||
      record.pullRequest !== input.execution.pullRequest ||
      record.runId !== input.execution.runId ||
      record.runAttempt !== input.execution.runAttempt ||
      record.verifierRevision !== input.execution.verifierRevision ||
      record.reportDigest !== digest ||
      record.reportLength !== input.report.byteLength ||
      !Buffer.from(record.finalizedReport).equals(Buffer.from(input.report)) ||
      record.grantId !== input.completion.grantId ||
      record.outcome !== decision.outcome ||
      record.coverage !== decision.coverage ||
      !sameStrings(record.coveredScopes, decision.coveredScopes) ||
      !sameStrings(record.phases, decision.phases) ||
      input.completion.outcome !== decision.outcome ||
      input.completion.coverage !== decision.coverage ||
      !sameStrings(input.completion.coveredScopes, decision.coveredScopes) ||
      !validSet(record.coveredScopes, true) ||
      !validSet(record.phases, false)
    )
      throw new AuthorityError("owner-evidence");
  }
}

interface VerifierEvidencePrisma {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]>;
}

function scopeKey(execution: AuthenticatedEfExecution) {
  return JSON.stringify([
    execution.tenantId,
    execution.repositoryId,
    execution.pullRequest,
  ]);
}

function authorityLink(value: unknown): AuthorityEvidenceLink {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 4
  )
    throw new AuthorityError("owner-evidence");
  const row = value as Record<string, unknown>;
  if (
    !Object.hasOwn(row, "binding") ||
    !Object.hasOwn(row, "authorityEpoch") ||
    !Object.hasOwn(row, "ownerEvidenceId") ||
    !Object.hasOwn(row, "ownerSourceDigest") ||
    !Number.isSafeInteger(row.authorityEpoch) ||
    (row.authorityEpoch as number) < 1 ||
    typeof row.ownerEvidenceId !== "string" ||
    row.ownerEvidenceId.length === 0 ||
    row.ownerEvidenceId.length > 2048 ||
    typeof row.ownerSourceDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(row.ownerSourceDigest)
  )
    throw new AuthorityError("owner-evidence");
  return {
    binding: parseBinding(row.binding),
    authorityEpoch: row.authorityEpoch as number,
    ownerEvidenceId: row.ownerEvidenceId,
    ownerSourceDigest: row.ownerSourceDigest,
  };
}

function recordFromRow(row: Record<string, unknown>): VerifierCustodyRecord {
  const link = authorityLink(row.authorityBinding);
  const record: VerifierCustodyRecord = {
    producer: row.producer as VerifierCustodyRecord["producer"],
    candidateWritable: row.candidateWritable as false,
    authorityEpoch: link.authorityEpoch,
    ownerEvidenceId: link.ownerEvidenceId,
    ownerSourceDigest: link.ownerSourceDigest,
    verifierRevision: String(row.verifierRevision),
    sourceCommit: String(row.sourceCommit),
    sourceTree: String(row.sourceTree),
    candidateArchiveSha256: String(row.candidateArchiveSha256),
    candidateArchiveSha512Sri: String(row.candidateArchiveSha512Sri),
    releasedArchiveSha256: String(row.releasedArchiveSha256),
    releasedArchiveSha512Sri: String(row.releasedArchiveSha512Sri),
    toolArchiveSha256: String(row.toolArchiveSha256),
    toolArchiveSha512Sri: String(row.toolArchiveSha512Sri),
    installedDistributionDigest: String(row.installedDistributionDigest),
    authorityBinding: link.binding,
  };
  if (
    sha256(bytes(row.candidateArchive)) !== record.candidateArchiveSha256 ||
    sha512(bytes(row.candidateArchive)) !== record.candidateArchiveSha512Sri ||
    sha256(bytes(row.releasedArchive)) !== record.releasedArchiveSha256 ||
    sha512(bytes(row.releasedArchive)) !== record.releasedArchiveSha512Sri ||
    sha256(bytes(row.toolArchive)) !== record.toolArchiveSha256 ||
    sha512(bytes(row.toolArchive)) !== record.toolArchiveSha512Sri ||
    sha256(bytes(row.installedDistributionWire)) !==
      record.installedDistributionDigest
  )
    throw new AuthorityError("owner-evidence");
  return record;
}

/** Read-only production source over verifier-written immutable custody rows. */
export class PrismaSdkGrowthVerifierEvidenceSource implements SdkGrowthVerifierEvidenceSourcePort {
  constructor(
    private readonly prisma: VerifierEvidencePrisma,
    private readonly authorityPolicy: VerifierAuthorityPolicyPort,
  ) {}

  async load(execution: AuthenticatedEfExecution) {
    const values = await this.prisma.$queryRaw`
      SELECT e.*, c."epoch" AS "currentEpoch", b."binding" AS "currentBinding",
        o."evidence" AS "currentOwnerEvidence", o."provenance" AS "currentProvenance",
        o."installationActive", o."verifierActive"
      FROM "SdkGrowthVerifierEvidence" e
      JOIN "SdkGrowthCurrentAuthority" c ON c."scopeKey" = ${scopeKey(execution)}
      JOIN "SdkGrowthBindingVersion" b ON b."scopeKey" = c."scopeKey" AND b."epoch" = c."epoch"
      JOIN "SdkGrowthOwnerVersion" o ON o."scopeKey" = c."scopeKey" AND o."epoch" = c."epoch"
      WHERE e."tenantId" = ${execution.tenantId}
        AND e."repositoryId" = ${execution.repositoryId}
        AND e."pullRequest" = ${execution.pullRequest}
        AND e."githubRepositoryId" = ${execution.githubRepositoryId}
        AND e."installationId" = ${execution.installationId}
        AND e."subject" = ${execution.subject}
        AND e."runId" = ${execution.runId}
        AND e."runAttempt" = ${execution.runAttempt}
        AND e."verifierRevision" = ${execution.verifierRevision}
        AND e."sourceCommit" = ${execution.sourceCommit}
        AND e."sourceTree" = ${execution.sourceTree}`;
    const matches = values.filter((value) => {
      if (!value || typeof value !== "object") return false;
      const row = value as Record<string, unknown>;
      const link = authorityLink(row.authorityBinding);
      try {
        const authorized = this.authorityPolicy.authorize({
          execution,
          expectedEpoch: link.authorityEpoch,
          current: currentAuthorityRow({
            epoch: row.currentEpoch,
            binding: row.currentBinding,
            evidence: row.currentOwnerEvidence,
            provenance: row.currentProvenance,
            installationActive: row.installationActive,
            verifierActive: row.verifierActive,
          }),
        });
        return (
          isDeepStrictEqual(authorized, link) &&
          row.evidenceId === sdkGrowthVerifierExecutionId(execution, link)
        );
      } catch (error) {
        if (error instanceof AuthorityError) return false;
        throw error;
      }
    });
    if (matches.length === 0) return null;
    if (matches.length !== 1) throw new AuthorityError("owner-evidence");
    return recordFromRow(matches[0] as Record<string, unknown>);
  }

  async loadFinalizedReport(
    execution: AuthenticatedEfExecution,
    reportDigest: string,
  ) {
    const evidence = await this.load(execution);
    if (!evidence) return null;
    const evidenceId = sdkGrowthVerifierExecutionId(execution, evidence);
    const [value] = await this.prisma.$queryRaw`
      SELECT r.*, e."pullRequest" FROM "SdkGrowthFinalizedReportEvidence" r
      JOIN "SdkGrowthVerifierEvidence" e ON e."evidenceId" = r."evidenceId"
      WHERE r."evidenceId" = ${evidenceId}
        AND r."reportDigest" = ${reportDigest}
        AND e."tenantId" = ${execution.tenantId}
        AND e."repositoryId" = ${execution.repositoryId}
        AND e."pullRequest" = ${execution.pullRequest}
        AND e."githubRepositoryId" = ${execution.githubRepositoryId}
        AND e."installationId" = ${execution.installationId}
        AND e."subject" = ${execution.subject}
        AND e."runId" = ${execution.runId}
        AND e."runAttempt" = ${execution.runAttempt}
        AND e."verifierRevision" = ${execution.verifierRevision}
        AND e."sourceCommit" = ${execution.sourceCommit}
        AND e."sourceTree" = ${execution.sourceTree}`;
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const report = reportRecordFromRow(row);
    if (
      row.reportEvidenceId !==
      sdkGrowthFinalizedReportEvidenceId(evidenceId, report.grantId)
    )
      throw new AuthorityError("owner-evidence");
    return report;
  }
}

interface VerifierEvidenceWriteTransaction extends VerifierEvidencePrisma {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
}

interface VerifierEvidenceWritePrisma extends VerifierEvidencePrisma {
  $transaction<T>(
    operation: (transaction: VerifierEvidenceWriteTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" },
  ): Promise<T>;
}

function boundedBytes(value: unknown, maximum: number) {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > maximum
  )
    throw new AuthorityError("invalid-contract");
  return Uint8Array.from(value);
}

function digest(value: unknown) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw new AuthorityError("invalid-contract");
  return value;
}

function authenticatedProducer(value: AuthenticatedSdkGrowthVerifierProducer) {
  if (
    !value ||
    typeof value !== "object" ||
    value.producer !== "reviewrouter-verifier" ||
    !validText(value.issuer) ||
    !validText(value.subject) ||
    !validText(value.authenticationId)
  )
    throw new AuthorityError("wrong-identity");
  const execution = value.execution;
  if (
    !execution ||
    !validText(execution.tenantId) ||
    !validText(execution.repositoryId) ||
    !Number.isSafeInteger(execution.pullRequest) ||
    execution.pullRequest < 1 ||
    !validText(execution.githubRepositoryId) ||
    !validText(execution.installationId) ||
    !validText(execution.subject) ||
    !validText(execution.runId) ||
    !validText(execution.runAttempt) ||
    !/^[a-f0-9]{40}$/.test(execution.verifierRevision) ||
    !/^[a-f0-9]{40}$/.test(execution.sourceCommit) ||
    !/^[a-f0-9]{40}$/.test(execution.sourceTree)
  )
    throw new AuthorityError("wrong-identity");
  return structuredClone(value);
}

function validText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)
  );
}

async function currentAuthorityLink(
  transaction: VerifierEvidencePrisma,
  execution: AuthenticatedEfExecution,
  expectedEpoch: number,
  policy: VerifierAuthorityPolicyPort,
) {
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch < 1)
    throw new AuthorityError("invalid-contract");
  const [value] = await transaction.$queryRaw`
    SELECT * FROM public.sdk_growth_verifier_current_authority_lock(${scopeKey(execution)})`;
  if (!value || typeof value !== "object")
    throw new AuthorityError("owner-evidence");
  return policy.authorize({
    execution,
    expectedEpoch,
    current: currentAuthorityRow(value),
  });
}

function currentAuthorityRow(value: unknown): CurrentAuthorityRow {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("owner-evidence");
  const row = value as Record<string, unknown>;
  if (
    typeof row.epoch !== "bigint" ||
    row.epoch < 1n ||
    row.epoch > BigInt(Number.MAX_SAFE_INTEGER) ||
    typeof row.installationActive !== "boolean" ||
    typeof row.verifierActive !== "boolean"
  )
    throw new AuthorityError("owner-evidence");
  const provenance = authorityProvenance(row.provenance);
  return {
    epoch: Number(row.epoch),
    material: {
      binding: parseBinding(row.binding),
      ownerEvidence: parseOwnerEvidence(row.evidence),
      provenance,
      installationActive: row.installationActive,
      verifierActive: row.verifierActive,
    },
  };
}

function authorityProvenance(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("owner-evidence");
  const row = value as Record<string, unknown>;
  const authorizedSubjects = row.authorizedSubjects;
  if (
    !validText(row.issuer) ||
    !validText(row.subject) ||
    !validText(row.authenticationId) ||
    !validText(row.installationId) ||
    typeof row.sourceDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(row.sourceDigest) ||
    !Array.isArray(authorizedSubjects) ||
    !authorizedSubjects.every(validText)
  )
    throw new AuthorityError("owner-evidence");
  return {
    issuer: row.issuer,
    subject: row.subject,
    authenticationId: row.authenticationId,
    installationId: row.installationId,
    sourceDigest: row.sourceDigest,
    authorizedSubjects,
  };
}

function assertEvidenceIdentity(
  row: Record<string, unknown>,
  execution: AuthenticatedEfExecution,
  evidenceId: string,
) {
  if (
    row.evidenceId !== evidenceId ||
    row.tenantId !== execution.tenantId ||
    row.repositoryId !== execution.repositoryId ||
    Number(row.pullRequest) !== execution.pullRequest ||
    row.githubRepositoryId !== execution.githubRepositoryId ||
    row.installationId !== execution.installationId ||
    row.subject !== execution.subject ||
    row.runId !== execution.runId ||
    row.runAttempt !== execution.runAttempt ||
    row.verifierRevision !== execution.verifierRevision ||
    row.sourceCommit !== execution.sourceCommit ||
    row.sourceTree !== execution.sourceTree ||
    row.producer !== "reviewrouter-verifier" ||
    row.candidateWritable !== false
  )
    throw new AuthorityError("conflict");
}

/** Verifier-only write adapter. It authenticates a protected producer, derives
 * execution identity from that credential, and derives authority identity from
 * the current server-side epoch. Candidate envelopes are not inputs here. */
export class PrismaSdkGrowthVerifierEvidenceCustody {
  constructor(
    private readonly prisma: VerifierEvidenceWritePrisma,
    private readonly authenticator: SdkGrowthVerifierProducerAuthenticatorPort,
    private readonly authorityPolicy: VerifierAuthorityPolicyPort,
  ) {}

  async retainEvidence(
    credential: unknown,
    input: RetainVerifierEvidenceInput,
  ): Promise<VerifierCustodyRecord> {
    const candidate = boundedBytes(input.candidateArchive, 8 * 1024 * 1024);
    const released = boundedBytes(input.releasedArchive, 8 * 1024 * 1024);
    const tool = boundedBytes(input.toolArchive, 16 * 1024 * 1024);
    const distribution = boundedBytes(
      input.installedDistributionWire,
      2 * 1024 * 1024,
    );
    return this.prisma.$transaction(
      async (transaction) => {
        const producer = authenticatedProducer(
          await this.authenticator.authenticate(credential, transaction),
        );
        const execution = producer.execution;
        const link = await currentAuthorityLink(
          transaction,
          execution,
          input.expectedAuthorityEpoch,
          this.authorityPolicy,
        );
        const evidenceId = sdkGrowthVerifierExecutionId(execution, link);
        const candidateSha256 = sha256(candidate);
        const candidateSha512 = sha512(candidate);
        const releasedSha256 = sha256(released);
        const releasedSha512 = sha512(released);
        const toolSha256 = sha256(tool);
        const toolSha512 = sha512(tool);
        const distributionDigest = sha256(distribution);
        await transaction.$executeRaw`
          INSERT INTO "SdkGrowthVerifierEvidence" (
            "evidenceId", "tenantId", "repositoryId", "pullRequest", "githubRepositoryId", "installationId", "subject",
            "runId", "runAttempt", "verifierRevision", "sourceCommit", "sourceTree", "producer", "candidateWritable",
            "authorityBinding", "candidateArchive", "candidateArchiveSha256", "candidateArchiveSha512Sri",
            "releasedArchive", "releasedArchiveSha256", "releasedArchiveSha512Sri",
            "toolArchive", "toolArchiveSha256", "toolArchiveSha512Sri", "installedDistributionWire", "installedDistributionDigest"
          ) VALUES (
            ${evidenceId}, ${execution.tenantId}, ${execution.repositoryId}, ${execution.pullRequest},
            ${execution.githubRepositoryId}, ${execution.installationId}, ${execution.subject}, ${execution.runId},
            ${execution.runAttempt}, ${execution.verifierRevision}, ${execution.sourceCommit}, ${execution.sourceTree},
            'reviewrouter-verifier', FALSE, ${JSON.stringify(link)}::jsonb,
            ${candidate}, ${candidateSha256}, ${candidateSha512}, ${released}, ${releasedSha256}, ${releasedSha512},
            ${tool}, ${toolSha256}, ${toolSha512}, ${distribution}, ${distributionDigest}
          ) ON CONFLICT ("evidenceId") DO NOTHING`;
        const [stored] = await transaction.$queryRaw`
          SELECT * FROM "SdkGrowthVerifierEvidence" WHERE "evidenceId" = ${evidenceId}`;
        if (!stored || typeof stored !== "object")
          throw new AuthorityError("conflict");
        const row = stored as Record<string, unknown>;
        assertEvidenceIdentity(row, execution, evidenceId);
        const record = recordFromRow(row);
        if (
          !isDeepStrictEqual(record.authorityBinding, link.binding) ||
          record.authorityEpoch !== link.authorityEpoch ||
          record.ownerEvidenceId !== link.ownerEvidenceId ||
          record.ownerSourceDigest !== link.ownerSourceDigest ||
          record.candidateArchiveSha256 !== candidateSha256 ||
          record.candidateArchiveSha512Sri !== candidateSha512 ||
          record.releasedArchiveSha256 !== releasedSha256 ||
          record.releasedArchiveSha512Sri !== releasedSha512 ||
          record.toolArchiveSha256 !== toolSha256 ||
          record.toolArchiveSha512Sri !== toolSha512 ||
          record.installedDistributionDigest !== distributionDigest
        )
          throw new AuthorityError("conflict");
        return record;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  async retainFinalizedReport(
    credential: unknown,
    input: RetainFinalizedVerifierReportInput,
  ): Promise<FinalizedVerifierReportRecord> {
    const requestDigest = digest(input.requestDigest);
    const grantDigest = digest(input.grantDigest);
    const report = boundedBytes(input.finalizedReport, 16 * 1024 * 1024);
    if (
      !validSet(input.decision.coveredScopes, true) ||
      !validSet(input.decision.phases, false) ||
      !["passed", "failed"].includes(input.decision.outcome) ||
      !["complete", "partial", "unavailable"].includes(input.decision.coverage)
    )
      throw new AuthorityError("invalid-contract");
    return this.prisma.$transaction(
      async (transaction) => {
        const producer = authenticatedProducer(
          await this.authenticator.authenticate(credential, transaction),
        );
        const execution = producer.execution;
        const link = await currentAuthorityLink(
          transaction,
          execution,
          input.expectedAuthorityEpoch,
          this.authorityPolicy,
        );
        const evidenceId = sdkGrowthVerifierExecutionId(execution, link);
        const [evidence] = await transaction.$queryRaw`
          SELECT * FROM "SdkGrowthVerifierEvidence" WHERE "evidenceId" = ${evidenceId}`;
        if (!evidence || typeof evidence !== "object")
          throw new AuthorityError("owner-evidence");
        assertEvidenceIdentity(
          evidence as Record<string, unknown>,
          execution,
          evidenceId,
        );
        const retainedEvidence = recordFromRow(
          evidence as Record<string, unknown>,
        );
        if (
          retainedEvidence.authorityEpoch !== link.authorityEpoch ||
          retainedEvidence.ownerEvidenceId !== link.ownerEvidenceId ||
          retainedEvidence.ownerSourceDigest !== link.ownerSourceDigest ||
          !isDeepStrictEqual(retainedEvidence.authorityBinding, link.binding)
        )
          throw new AuthorityError("owner-evidence");
        const [admission] = await transaction.$queryRaw`
          SELECT "requestDigest", "grantDigest", "grantWire"
          FROM "SdkGrowthAuthorityCustody"
          WHERE "tenantId" = ${execution.tenantId}
            AND "repositoryId" = ${execution.repositoryId}
            AND "pullRequest" = ${execution.pullRequest}
            AND "githubRepositoryId" = ${execution.githubRepositoryId}
            AND "installationId" = ${execution.installationId}
            AND "subject" = ${execution.subject}
            AND "runId" = ${execution.runId}
            AND "runAttempt" = ${execution.runAttempt}
            AND "verifierRevision" = ${execution.verifierRevision}
            AND "sourceCommit" = ${execution.sourceCommit}
            AND "sourceTree" = ${execution.sourceTree}
            AND "requestDigest" = ${requestDigest}
            AND "grantDigest" = ${grantDigest}`;
        if (!admission || typeof admission !== "object")
          throw new AuthorityError("not-found");
        const grant = decodePinnedGrant(
          bytes((admission as Record<string, unknown>).grantWire),
          requestDigest,
          grantDigest,
        );
        if (
          grant.identity.tenantId !== execution.tenantId ||
          grant.identity.repositoryId !== execution.repositoryId ||
          grant.identity.subject !== execution.subject ||
          grant.request.repositoryId !== execution.repositoryId ||
          grant.request.pullRequest !== execution.pullRequest ||
          grant.authorityEpoch !== link.authorityEpoch ||
          grant.ownerEvidence.evidenceId !== link.ownerEvidenceId ||
          grant.ownerEvidence.sourceDigest !== link.ownerSourceDigest ||
          !isDeepStrictEqual(grant.binding, link.binding)
        )
          throw new AuthorityError("owner-evidence");
        const reportDigest = sha256(report);
        const reportEvidenceId = sdkGrowthFinalizedReportEvidenceId(
          evidenceId,
          grant.grantId,
        );
        await transaction.$executeRaw`
          INSERT INTO "SdkGrowthFinalizedReportEvidence" (
            "reportEvidenceId", "evidenceId", "repositoryId", "runId", "runAttempt", "verifierRevision",
            "producer", "candidateWritable", "reportDigest", "finalizedReport", "grantId", "outcome", "coverage",
            "coveredScopes", "phases"
          ) VALUES (
            ${reportEvidenceId}, ${evidenceId}, ${execution.repositoryId}, ${execution.runId}, ${execution.runAttempt},
            ${execution.verifierRevision}, 'reviewrouter-verifier', FALSE, ${reportDigest}, ${report}, ${grant.grantId},
            ${input.decision.outcome}, ${input.decision.coverage}, ${JSON.stringify(input.decision.coveredScopes)}::jsonb,
            ${JSON.stringify(input.decision.phases)}::jsonb
          ) ON CONFLICT ("reportEvidenceId") DO NOTHING`;
        const [stored] = await transaction.$queryRaw`
          SELECT r.*, e."pullRequest" FROM "SdkGrowthFinalizedReportEvidence" r
          JOIN "SdkGrowthVerifierEvidence" e ON e."evidenceId" = r."evidenceId"
          WHERE r."reportEvidenceId" = ${reportEvidenceId}`;
        if (!stored || typeof stored !== "object")
          throw new AuthorityError("conflict");
        const row = stored as Record<string, unknown>;
        const retainedReport = reportRecordFromRow(row);
        if (
          row.reportEvidenceId !== reportEvidenceId ||
          retainedReport.producer !== "reviewrouter-verifier" ||
          retainedReport.candidateWritable !== false ||
          retainedReport.repositoryId !== execution.repositoryId ||
          retainedReport.pullRequest !== execution.pullRequest ||
          retainedReport.runId !== execution.runId ||
          retainedReport.runAttempt !== execution.runAttempt ||
          retainedReport.verifierRevision !== execution.verifierRevision ||
          retainedReport.grantId !== grant.grantId ||
          retainedReport.reportDigest !== reportDigest ||
          !Buffer.from(retainedReport.finalizedReport).equals(
            Buffer.from(report),
          ) ||
          retainedReport.outcome !== input.decision.outcome ||
          retainedReport.coverage !== input.decision.coverage ||
          !sameStrings(
            retainedReport.coveredScopes,
            input.decision.coveredScopes,
          ) ||
          !sameStrings(retainedReport.phases, input.decision.phases)
        )
          throw new AuthorityError("conflict");
        return retainedReport;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
}

function decodePinnedGrant(
  wire: Uint8Array,
  requestDigest: string,
  expectedDigest: string,
) {
  if (sha256(wire) !== expectedDigest) throw new AuthorityError("conflict");
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(wire).toString("utf8"));
  } catch {
    throw new AuthorityError("owner-evidence");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AuthorityError("owner-evidence");
  const row = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(row).length !== 4 ||
    row.adapterVersion !== 1 ||
    row.kind !== "grant" ||
    row.requestDigest !== requestDigest
  )
    throw new AuthorityError("owner-evidence");
  const grant = parseGrant(row.grant);
  const encoded = new PinnedEfAuthorityCodecV1().encodeGrant({
    requestDigest,
    grant,
  });
  if (!Buffer.from(encoded).equals(Buffer.from(wire)))
    throw new AuthorityError("owner-evidence");
  return grant;
}

export function sdkGrowthFinalizedReportEvidenceId(
  evidenceId: string,
  grantId: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([evidenceId, grantId]))
    .digest("hex");
}

function reportRecordFromRow(
  row: Record<string, unknown>,
): FinalizedVerifierReportRecord {
  const report = bytes(row.finalizedReport);
  return {
    producer: row.producer as "reviewrouter-verifier",
    candidateWritable: row.candidateWritable as false,
    repositoryId: String(row.repositoryId),
    pullRequest: Number(row.pullRequest),
    runId: String(row.runId),
    runAttempt: String(row.runAttempt),
    verifierRevision: String(row.verifierRevision),
    reportDigest: String(row.reportDigest),
    reportLength: report.byteLength,
    grantId: String(row.grantId),
    outcome: row.outcome as FinalizedVerifierReportRecord["outcome"],
    coverage: row.coverage as FinalizedVerifierReportRecord["coverage"],
    coveredScopes: strings(row.coveredScopes),
    phases: strings(row.phases),
    finalizedReport: report,
  };
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function sdkGrowthVerifierExecutionId(
  execution: AuthenticatedEfExecution,
  authority: Pick<
    TrustedVerifierEvidence,
    "authorityEpoch" | "ownerEvidenceId" | "ownerSourceDigest"
  >,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        execution.tenantId,
        execution.repositoryId,
        execution.pullRequest,
        execution.githubRepositoryId,
        execution.installationId,
        execution.subject,
        execution.runId,
        execution.runAttempt,
        execution.verifierRevision,
        authority.authorityEpoch,
        authority.ownerEvidenceId,
        authority.ownerSourceDigest,
      ]),
    )
    .digest("hex");
}

function bytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0)
    throw new AuthorityError("owner-evidence");
  return Uint8Array.from(value);
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new AuthorityError("owner-evidence");
  return value;
}

function sha512(value: Uint8Array): string {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function validSet(value: readonly string[], allowEmpty: boolean) {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.length <= 1024 &&
    value.every(
      (item, index) =>
        typeof item === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(item) &&
        (index === 0 || value[index - 1]! < item),
    )
  );
}
