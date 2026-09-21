import { createHash } from "node:crypto";
import type {
  AuthenticatedEfExecution,
  NormalizedFinalizedReportDecision,
  TrustedVerifierCustodyPort,
  TrustedVerifierEvidence,
} from "@reviewrouter/features-sdk-growth-authority";
import type { Completion } from "@reviewrouter/features-sdk-growth-authority";
import { AuthorityError } from "@reviewrouter/features-sdk-growth-authority";

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

/** Read-only production source over verifier-written immutable custody rows. */
export class PrismaSdkGrowthVerifierEvidenceSource implements SdkGrowthVerifierEvidenceSourcePort {
  constructor(private readonly prisma: VerifierEvidencePrisma) {}

  async load(execution: AuthenticatedEfExecution) {
    const [value] = await this.prisma.$queryRaw`
      SELECT * FROM "SdkGrowthVerifierEvidence"
      WHERE "evidenceId" = ${sdkGrowthVerifierExecutionId(execution)}
        AND "tenantId" = ${execution.tenantId}
        AND "repositoryId" = ${execution.repositoryId}
        AND "pullRequest" = ${execution.pullRequest}
        AND "githubRepositoryId" = ${execution.githubRepositoryId}
        AND "installationId" = ${execution.installationId}
        AND "subject" = ${execution.subject}
        AND "runId" = ${execution.runId}
        AND "runAttempt" = ${execution.runAttempt}
        AND "verifierRevision" = ${execution.verifierRevision}
        AND "sourceCommit" = ${execution.sourceCommit}
        AND "sourceTree" = ${execution.sourceTree}`;
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const record: VerifierCustodyRecord = {
      producer: row.producer as VerifierCustodyRecord["producer"],
      candidateWritable: row.candidateWritable as false,
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
      authorityBinding:
        row.authorityBinding as VerifierCustodyRecord["authorityBinding"],
    };
    if (
      sha256(bytes(row.candidateArchive)) !== record.candidateArchiveSha256 ||
      sha512(bytes(row.candidateArchive)) !==
        record.candidateArchiveSha512Sri ||
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

  async loadFinalizedReport(
    execution: AuthenticatedEfExecution,
    reportDigest: string,
  ) {
    const [value] = await this.prisma.$queryRaw`
      SELECT r.*, e."pullRequest" FROM "SdkGrowthFinalizedReportEvidence" r
      JOIN "SdkGrowthVerifierEvidence" e ON e."evidenceId" = r."evidenceId"
      WHERE r."evidenceId" = ${sdkGrowthVerifierExecutionId(execution)}
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
    const report = bytes(row.finalizedReport);
    const coveredScopes = strings(row.coveredScopes);
    const phases = strings(row.phases);
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
      coveredScopes,
      phases,
      finalizedReport: report,
    };
  }
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function sdkGrowthVerifierExecutionId(
  execution: AuthenticatedEfExecution,
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
