import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AuthorityScope } from "./ports.js";
import { AuthorityError } from "../domain/contracts.js";

const schema = "reviewrouter:g1-approved-v3-manifest:1";
const efSchema = "reviewrouter:sdk-growth-authority:3";
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const maxManifestBytes = 1024 * 1024;
const maxRequestBytes = 1024 * 1024;
const maxValidationBytes = 64 * 1024;

export interface TrustedV3ManifestProposal {
  readonly manifestWire: Uint8Array;
  readonly requestWire: Uint8Array;
}

/** Protected Host source. Candidate and verifier producer have no reference to it. */
export interface TrustedV3ManifestProposalPort {
  load(
    reference: string,
    scope: AuthorityScope,
  ): Promise<TrustedV3ManifestProposal | null>;
}

/** The protected adapter must run EF decodeRequest on these exact bytes. */
export interface TrustedV3RequestValidationPort {
  validate(requestWire: Uint8Array): Promise<{
    readonly decodedRequest: unknown;
    readonly validationEvidenceWire: Uint8Array;
  }>;
}

export interface ValidatedV3Manifest {
  readonly manifestId: string;
  readonly manifestSha256: string;
  readonly manifestWire: Uint8Array;
  readonly requestWire: Uint8Array;
  readonly requestWireSha256: string;
  readonly validationEvidenceWire: Uint8Array;
  readonly validationEvidenceSha256: string;
  readonly scopeKey: string;
  readonly scope: Record<string, unknown>;
  readonly toolArtifactId: string;
  readonly tool: Record<string, unknown>;
  readonly approval: Record<string, unknown>;
  readonly provenance: Record<string, unknown>;
  readonly binding: Record<string, unknown>;
  readonly operation: "check" | "promote-release";
}

function fail(): never {
  throw new AuthorityError("invalid-contract");
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512)
    fail();
  return value;
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !digestPattern.test(value)) fail();
  return value;
}

function commit(value: unknown): string {
  if (typeof value !== "string" || !commitPattern.test(value)) fail();
  return value;
}

function positive(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    fail();
  return value;
}

function bytes(value: unknown, maximum: number): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 1 ||
    value.byteLength > maximum
  )
    fail();
  return Uint8Array.from(value);
}

function sha256(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function json(value: Uint8Array): Record<string, unknown> {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
    const parsed: unknown = JSON.parse(decoded);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.getPrototypeOf(parsed) !== Object.prototype ||
      JSON.stringify(parsed) !== decoded
    )
      fail();
    return parsed as Record<string, unknown>;
  } catch {
    return fail();
  }
}

function sortedNames(value: unknown, allowEmpty = false): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > 128
  )
    fail();
  const names = value.map(text);
  if (names.some((name, i) => i > 0 && name <= names[i - 1]!)) fail();
  return names;
}

function source(value: unknown): void {
  const row = record(value, ["commit", "tree"]);
  commit(row.commit);
  commit(row.tree);
}

function ref(value: unknown): void {
  const row = record(value, ["wireSha256", "byteLength", "source"]);
  digest(row.wireSha256);
  positive(row.byteLength);
  source(row.source);
}

function archive(value: unknown): void {
  const row = record(value, ["sha256", "sha512Sri", "byteLength"]);
  digest(row.sha256);
  if (
    typeof row.sha512Sri !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(row.sha512Sri)
  )
    fail();
  positive(row.byteLength);
}

function packages(value: unknown, governed: string[]): void {
  if (!Array.isArray(value) || value.length !== governed.length) fail();
  for (const [index, entry] of value.entries()) {
    const row = record(entry, ["packageName", "candidate", "baseline"]);
    if (row.packageName !== governed[index]) fail();
    const candidate = record(row.candidate, [
      "version",
      "source",
      "archive",
      "evidence",
      "observationDigest",
    ]);
    text(candidate.version);
    source(candidate.source);
    archive(candidate.archive);
    ref(candidate.evidence);
    digest(candidate.observationDigest);
    const baseline = row.baseline as Record<string, unknown>;
    if (!baseline || typeof baseline !== "object" || Array.isArray(baseline))
      fail();
    if (baseline.kind === "released") {
      const released = record(baseline, [
        "kind",
        "source",
        "archive",
        "releaseEvidence",
      ]);
      source(released.source);
      archive(released.archive);
      ref(released.releaseEvidence);
    } else if (baseline.kind === "initial-unreleased") {
      const unreleased = record(baseline, ["kind", "historyDigest"]);
      digest(unreleased.historyDigest);
    } else fail();
  }
}

/** RR validates only its approval envelope. EF validates the request itself. */
export function validateV3ManifestProposal(
  proposal: TrustedV3ManifestProposal,
  scope: AuthorityScope,
  validated: {
    readonly decodedRequest: unknown;
    readonly validationEvidenceWire: Uint8Array;
  },
): ValidatedV3Manifest {
  const manifestWire = bytes(proposal.manifestWire, maxManifestBytes);
  const requestWire = bytes(proposal.requestWire, maxRequestBytes);
  const validationEvidenceWire = bytes(
    validated.validationEvidenceWire,
    maxValidationBytes,
  );
  const manifest = record(json(manifestWire), [
    "schema",
    "scope",
    "approval",
    "provenance",
    "ef",
    "tool",
    "governedPackages",
    "packages",
    "metadataRootNames",
    "metadataRoots",
    "retainedHistory",
    "requestWireSha256",
    "requestByteLength",
    "validationEvidenceSha256",
    "validationEvidenceByteLength",
  ]);
  if (manifest.schema !== schema) fail();
  const approvedScope = record(manifest.scope, [
    "tenantId",
    "repositoryId",
    "githubRepositoryId",
    "installationId",
    "pullRequest",
  ]);
  if (
    approvedScope.tenantId !== scope.tenantId ||
    approvedScope.repositoryId !== scope.repositoryId ||
    approvedScope.pullRequest !== scope.pullRequest ||
    !/^[1-9][0-9]*$/.test(text(approvedScope.githubRepositoryId)) ||
    !/^[1-9][0-9]*$/.test(text(approvedScope.installationId))
  )
    fail();
  const approval = record(manifest.approval, [
    "version",
    "evidenceId",
    "tenantId",
    "ownerSubject",
    "scopes",
    "decision",
    "sourceDigest",
    "issuedAt",
    "expiresAt",
    "revoked",
    "operation",
  ]);
  if (
    approval.version !== 3 ||
    approval.decision !== "approved" ||
    approval.revoked !== false ||
    approval.tenantId !== scope.tenantId ||
    (approval.operation !== "check" &&
      approval.operation !== "promote-release") ||
    positive(approval.expiresAt) <= positive(approval.issuedAt)
  )
    fail();
  text(approval.evidenceId);
  text(approval.ownerSubject);
  digest(approval.sourceDigest);
  sortedNames(approval.scopes);
  const provenance = record(manifest.provenance, [
    "issuer",
    "subject",
    "authenticationId",
    "installationId",
    "sourceDigest",
    "authorizedSubjects",
  ]);
  text(provenance.issuer);
  text(provenance.subject);
  text(provenance.authenticationId);
  if (
    provenance.installationId !== approvedScope.installationId ||
    provenance.subject !== approval.ownerSubject ||
    provenance.sourceDigest !== approval.sourceDigest
  )
    fail();
  digest(provenance.sourceDigest);
  sortedNames(provenance.authorizedSubjects);
  const ef = record(manifest.ef, [
    "schemaVersion",
    "binding",
    "contextSelectors",
  ]);
  if (ef.schemaVersion !== efSchema) fail();
  const request = record(json(requestWire), [
    "schemaVersion",
    "kind",
    "operation",
    "admissionReceiptId",
    "binding",
    "contextSelectors",
    "decisionDigests",
    "requiredPhases",
  ]);
  if (!isDeepStrictEqual(request, validated.decodedRequest)) fail();
  if (
    request.schemaVersion !== efSchema ||
    request.kind !== "request" ||
    request.operation !== approval.operation ||
    !isDeepStrictEqual(request.binding, ef.binding) ||
    !isDeepStrictEqual(request.contextSelectors, ef.contextSelectors) ||
    !Array.isArray(request.decisionDigests) ||
    !Array.isArray(request.requiredPhases) ||
    (approval.operation === "check" && request.admissionReceiptId !== null) ||
    approval.operation === "promote-release" ||
    manifest.requestWireSha256 !== sha256(requestWire) ||
    manifest.requestByteLength !== requestWire.byteLength ||
    manifest.validationEvidenceSha256 !== sha256(validationEvidenceWire) ||
    manifest.validationEvidenceByteLength !== validationEvidenceWire.byteLength
  )
    fail();
  const binding = record(ef.binding, [
    "invocation",
    "target",
    "verifier",
    "tool",
    "policy",
    "historyDigest",
    "evidenceManifestDigest",
  ]);
  const target = record(binding.target, [
    "repository",
    "pullRequestNumber",
    "head",
    "base",
    "mergeBase",
    "evaluation",
    "evaluationKind",
  ]);
  const repository = record(target.repository, [
    "provider",
    "repositoryId",
    "owner",
    "name",
  ]);
  if (
    repository.provider !== "github" ||
    repository.repositoryId !== approvedScope.githubRepositoryId ||
    target.pullRequestNumber !== scope.pullRequest
  )
    fail();
  source(target.head);
  source(target.base);
  source(target.mergeBase);
  source(target.evaluation);
  const tool = record(manifest.tool, [
    "efToolArtifactId",
    "archiveSha256",
    "archiveSha512Sri",
    "source",
    "installedDistributionDigest",
  ]);
  if (
    typeof tool.efToolArtifactId !== "string" ||
    !/^[a-f0-9]{64}$/.test(tool.efToolArtifactId)
  )
    fail();
  digest(tool.archiveSha256);
  source(tool.source);
  digest(tool.installedDistributionDigest);
  if (
    typeof tool.archiveSha512Sri !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(tool.archiveSha512Sri)
  )
    fail();
  const efTool = record(binding.tool, [
    "packageName",
    "version",
    "archiveDigest",
    "archiveIntegrity",
    "distributionDigest",
    "extractorVersion",
  ]);
  if (
    efTool.packageName !== "@agent-teams/engineering-foundation" ||
    efTool.archiveDigest !== tool.archiveSha256 ||
    efTool.archiveIntegrity !== tool.archiveSha512Sri ||
    efTool.distributionDigest !== tool.installedDistributionDigest
  )
    fail();
  const governed = sortedNames(manifest.governedPackages);
  packages(manifest.packages, governed);
  const selectors = record(ef.contextSelectors, [
    "trustedBasePath",
    "decisionsPath",
    "released",
  ]);
  if (
    !Array.isArray(selectors.released) ||
    selectors.released.length !== governed.length
  )
    fail();
  for (const [index, selected] of selectors.released.entries()) {
    const selectedRow = selected as Record<string, unknown>;
    const packageRow = (manifest.packages as Record<string, unknown>[])[index]!;
    const baseline = packageRow.baseline as Record<string, unknown>;
    if (
      !selectedRow ||
      selectedRow.packageName !== governed[index] ||
      selectedRow.kind !== baseline.kind
    )
      fail();
  }
  const rootNames = sortedNames(manifest.metadataRootNames, true);
  if (rootNames.some((name) => governed.includes(name))) fail();
  if (
    !Array.isArray(manifest.metadataRoots) ||
    manifest.metadataRoots.length !== rootNames.length
  )
    fail();
  for (const [index, value] of manifest.metadataRoots.entries()) {
    const root = record(value, [
      "packageName",
      "base",
      "candidate",
      "historyDigest",
    ]);
    if (root.packageName !== rootNames[index]) fail();
    ref(root.base);
    ref(root.candidate);
    digest(root.historyDigest);
  }
  const history = record(manifest.retainedHistory, [
    "targetSource",
    "receiptDigest",
    "custodyEvidence",
  ]);
  source(history.targetSource);
  digest(history.receiptDigest);
  ref(history.custodyEvidence);
  const validation = record(json(validationEvidenceWire), [
    "schema",
    "requestWireSha256",
    "requestByteLength",
    "toolArtifactId",
    "result",
  ]);
  if (
    validation.schema !== "reviewrouter:g1-v3-request-validation-fixture:1" ||
    validation.requestWireSha256 !== sha256(requestWire) ||
    validation.requestByteLength !== requestWire.byteLength ||
    validation.toolArtifactId !== tool.efToolArtifactId ||
    validation.result !== "validated"
  )
    fail();
  const manifestSha256 = sha256(manifestWire);
  const manifestId = createHash("sha256")
    .update("reviewrouter:g1-approved-v3-manifest:1\0")
    .update(manifestWire)
    .digest("hex");
  return {
    manifestId,
    manifestSha256,
    manifestWire,
    requestWire,
    requestWireSha256: sha256(requestWire),
    validationEvidenceWire,
    validationEvidenceSha256: sha256(validationEvidenceWire),
    scopeKey: JSON.stringify([
      scope.tenantId,
      scope.repositoryId,
      scope.pullRequest,
    ]),
    scope: approvedScope,
    toolArtifactId: tool.efToolArtifactId,
    tool,
    approval,
    provenance,
    binding,
    operation: approval.operation as "check" | "promote-release",
  };
}
