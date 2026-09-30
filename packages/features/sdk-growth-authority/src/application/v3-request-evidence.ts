import { createHash, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AuthorityError } from "../domain/contracts.js";

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const idPattern = /^[a-f0-9]{64}$/;
export const v3RequestStage = "request-validation" as const;

export interface V3AuthenticatedProducer {
  readonly assignmentId: string;
  readonly authenticationId: string;
  readonly efToolArtifactId: string;
  readonly tokenIssuedAtMs: number;
  readonly tokenExpiresAtMs: number;
  readonly assignmentCreatedAt: Date;
  readonly assignmentExpiresAt: Date;
  readonly execution: {
    readonly tenantId: string;
    readonly repositoryId: string;
    readonly pullRequest: number;
    readonly githubRepositoryId: string;
    readonly installationId: string;
    readonly subject: string;
    readonly verifierRevision: string;
    readonly sourceCommit: string;
    readonly sourceTree: string;
    readonly sourceBinding: {
      readonly headRepositoryId: string;
      readonly baseRepositoryId: string;
      readonly baseCommit: string;
      readonly baseTree: string;
      readonly mergeBaseCommit: string;
      readonly mergeBaseTree: string;
    };
  };
}

/** The protected adapter invokes decodeRequest from the assignment-pinned EF
 * archive. It must return the codec's wire and distinct protocol digest. */
export interface TrustedV3RequestDecoderPort {
  decode(input: {
    readonly requestWire: Uint8Array;
    readonly toolArtifactId: string;
  }): Promise<{
    readonly value: unknown;
    readonly wire: Uint8Array;
    readonly wireDigest: string;
    readonly protocolDigest: string;
  }>;
}

export interface V3RequestEvidence {
  readonly evidenceId: string;
  readonly assignmentId: string;
  readonly operation: "check";
  readonly stage: typeof v3RequestStage;
  readonly manifestId: string;
  readonly scopeKey: string;
  readonly approvalEpoch: bigint;
  readonly ownerEvidenceId: string;
  readonly toolArtifactId: string;
  readonly firstJti: string;
  readonly tokenIssuedAtMs: number;
  readonly tokenExpiresAtMs: number;
  readonly requestWire: Uint8Array;
  readonly requestWireSha256: string;
  readonly protocolDigest: string;
  readonly validationEvidenceWire: Uint8Array;
  readonly validationEvidenceSha256: string;
}

function fail(): never {
  throw new AuthorityError("owner-evidence");
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function hash(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
function validDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}
function source(value: unknown, commit: string, tree: string): boolean {
  const row = object(value);
  return row.commit === commit && row.tree === tree;
}

/** Validates an already EF-decoded, exact canonical wire against the current
 * immutable approved manifest and protected assignment. No grant is issued. */
export function bindV3RequestEvidence(input: {
  readonly producer: V3AuthenticatedProducer;
  readonly manifestId: string;
  readonly manifestWire: Uint8Array;
  readonly approvedRequestWire: Uint8Array;
  readonly scopeKey: string;
  readonly approvalEpoch: bigint;
  readonly requestWire: Uint8Array;
  readonly decoded: Awaited<ReturnType<TrustedV3RequestDecoderPort["decode"]>>;
}): V3RequestEvidence {
  const { producer, decoded } = input;
  const execution = producer.execution;
  if (
    !idPattern.test(input.manifestId) ||
    input.requestWire.byteLength < 1 ||
    input.requestWire.byteLength > 1024 * 1024 ||
    !sameBytes(input.requestWire, input.approvedRequestWire) ||
    !(decoded.wire instanceof Uint8Array) ||
    !sameBytes(input.requestWire, decoded.wire) ||
    !validDigest(decoded.wireDigest) ||
    decoded.wireDigest !== hash(input.requestWire) ||
    !validDigest(decoded.protocolDigest)
  )
    fail();
  let manifest: Record<string, unknown>;
  let request: Record<string, unknown>;
  try {
    manifest = object(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(input.manifestWire),
      ),
    );
    request = object(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(input.requestWire),
      ),
    );
  } catch {
    return fail();
  }
  const approvedScope = object(manifest.scope);
  const approval = object(manifest.approval);
  const provenance = object(manifest.provenance);
  const ef = object(manifest.ef);
  const binding = object(ef.binding);
  const invocation = object(binding.invocation);
  const target = object(binding.target);
  const repository = object(target.repository);
  const verifier = object(binding.verifier);
  const tool = object(manifest.tool);
  const sourceBinding = execution.sourceBinding;
  if (
    manifest.schema !== "reviewrouter:g1-approved-v3-manifest:1" ||
    approval.version !== 3 ||
    approval.operation !== "check" ||
    approval.decision !== "approved" ||
    approval.revoked !== false ||
    approvedScope.tenantId !== execution.tenantId ||
    approvedScope.repositoryId !== execution.repositoryId ||
    approvedScope.pullRequest !== execution.pullRequest ||
    approvedScope.githubRepositoryId !== execution.githubRepositoryId ||
    approvedScope.installationId !== execution.installationId ||
    input.scopeKey !==
      JSON.stringify([
        execution.tenantId,
        execution.repositoryId,
        execution.pullRequest,
      ]) ||
    !Array.isArray(provenance.authorizedSubjects) ||
    !provenance.authorizedSubjects.includes(execution.subject) ||
    tool.efToolArtifactId !== producer.efToolArtifactId ||
    sourceBinding.headRepositoryId !== execution.githubRepositoryId ||
    sourceBinding.baseRepositoryId !== execution.githubRepositoryId ||
    repository.repositoryId !== execution.githubRepositoryId ||
    target.pullRequestNumber !== execution.pullRequest ||
    target.evaluationKind !== "head" ||
    invocation.sourceCommit !== execution.sourceCommit ||
    invocation.sourceTree !== execution.sourceTree ||
    !source(target.head, execution.sourceCommit, execution.sourceTree) ||
    !source(target.evaluation, execution.sourceCommit, execution.sourceTree) ||
    !source(target.base, sourceBinding.baseCommit, sourceBinding.baseTree) ||
    !source(
      target.mergeBase,
      sourceBinding.mergeBaseCommit,
      sourceBinding.mergeBaseTree,
    ) ||
    verifier.immutableRevision !== execution.verifierRevision ||
    !isDeepStrictEqual(request, decoded.value) ||
    !isDeepStrictEqual(request.binding, ef.binding) ||
    !isDeepStrictEqual(request.contextSelectors, ef.contextSelectors) ||
    request.operation !== "check" ||
    request.admissionReceiptId !== null ||
    manifest.requestWireSha256 !== decoded.wireDigest ||
    manifest.requestByteLength !== input.requestWire.byteLength ||
    typeof approval.evidenceId !== "string" ||
    !Number.isSafeInteger(approval.expiresAt)
  )
    fail();
  const evidenceId = createHash("sha256")
    .update("reviewrouter:g1-v3-request-slot:1\0")
    .update(JSON.stringify([producer.assignmentId, "check", v3RequestStage]))
    .digest("hex");
  const validationEvidenceWire = new TextEncoder().encode(
    JSON.stringify({
      schema: "reviewrouter:g1-v3-request-validation-evidence:1",
      requestWireSha256: decoded.wireDigest,
      requestByteLength: input.requestWire.byteLength,
      protocolDigest: decoded.protocolDigest,
      toolArtifactId: producer.efToolArtifactId,
      result: "validated",
    }),
  );
  return {
    evidenceId,
    assignmentId: producer.assignmentId,
    operation: "check",
    stage: v3RequestStage,
    manifestId: input.manifestId,
    scopeKey: input.scopeKey,
    approvalEpoch: input.approvalEpoch,
    ownerEvidenceId: approval.evidenceId,
    toolArtifactId: producer.efToolArtifactId,
    firstJti: producer.authenticationId,
    tokenIssuedAtMs: producer.tokenIssuedAtMs,
    tokenExpiresAtMs: producer.tokenExpiresAtMs,
    requestWire: Uint8Array.from(input.requestWire),
    requestWireSha256: decoded.wireDigest,
    protocolDigest: decoded.protocolDigest,
    validationEvidenceWire,
    validationEvidenceSha256: hash(validationEvidenceWire),
  };
}
