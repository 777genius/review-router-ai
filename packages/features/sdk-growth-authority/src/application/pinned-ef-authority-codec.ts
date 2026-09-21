import { Buffer } from "node:buffer";
import { AuthorityError } from "../domain/contracts.js";
import {
  canonical,
  parseBinding,
  parseCompletion,
  parseGrant,
  parseReceipt,
} from "../domain/validation.js";
import type {
  ArchiveCustody,
  DecodedEfAdmission,
  DecodedEfCompletion,
  EfAuthorityCodecPort,
  EfBindingAssertions,
  NormalizedFinalizedReportDecision,
} from "./ef-authority-service.js";

/** Concrete codec for the currently deployed RR bridge envelope (adapter v1).
 * It is intentionally not declared compatible with EF's successor schema.
 * `efSuccessorCompatibilityTodo` remains the freeze list for that replacement. */
export class PinnedEfAuthorityCodecV1 implements EfAuthorityCodecPort {
  decodeAdmission(input: unknown): DecodedEfAdmission {
    const value = object(input, [
      "adapterVersion",
      "kind",
      "requestWire",
      "requestDigest",
      "request",
      "assertions",
      "authorityBinding",
      "candidateArchive",
      "releasedArchive",
      "toolArchive",
      "installedDistributionWire",
      "installedDistributionDigest",
    ]);
    if (value.adapterVersion !== 1 || value.kind !== "request") invalid();
    const request = object(value.request, [
      "version",
      "repositoryId",
      "pullRequest",
    ]);
    if (
      request.version !== 1 ||
      !text(request.repositoryId) ||
      !Number.isSafeInteger(request.pullRequest) ||
      (request.pullRequest as number) < 1
    )
      invalid();
    const decodedRequest = {
      version: 1 as const,
      repositoryId: request.repositoryId as string,
      pullRequest: request.pullRequest as number,
    };
    const decodedAssertions = assertions(value.assertions);
    const authorityBinding = parseBinding(value.authorityBinding);
    const candidateArchive = archive(value.candidateArchive);
    const releasedArchive = archive(value.releasedArchive);
    const toolArchive = archive(value.toolArchive);
    const installedDistributionDigest = digest(
      value.installedDistributionDigest,
    );
    const requestWire = binary(value.requestWire);
    // The request digest is the stable admission identity. Bind it to the
    // authenticated execution assertions and every authoritative artifact
    // identity, not merely repository/PR. Otherwise a later run on the same PR
    // can collide with an earlier grant and be rejected as a stale replay.
    exactCanonicalWire(requestWire, {
      ...decodedRequest,
      assertions: decodedAssertions,
      authorityBinding,
      candidateArchive: archiveIdentity(candidateArchive),
      releasedArchive: archiveIdentity(releasedArchive),
      toolArchive: archiveIdentity(toolArchive),
      installedDistributionDigest,
    });
    return {
      adapterVersion: 1,
      requestWire,
      requestDigest: digest(value.requestDigest),
      request: decodedRequest,
      assertions: decodedAssertions,
      authorityBinding,
      candidateArchive,
      releasedArchive,
      toolArchive,
      installedDistributionWire: binary(value.installedDistributionWire),
      installedDistributionDigest,
    };
  }

  decodeCompletion(input: unknown): DecodedEfCompletion {
    const value = object(input, [
      "adapterVersion",
      "kind",
      "requestDigest",
      "grantDigest",
      "completionDigest",
      "completionWire",
      "completion",
      "assertions",
      "finalizedReport",
      "reportDigest",
      "reportDecision",
    ]);
    if (value.adapterVersion !== 1 || value.kind !== "completion") invalid();
    const completion = parseCompletion(value.completion);
    const completionWire = binary(value.completionWire);
    exactCanonicalWire(completionWire, completion);
    return {
      adapterVersion: 1,
      requestDigest: digest(value.requestDigest),
      grantDigest: digest(value.grantDigest),
      completionDigest: digest(value.completionDigest),
      completionWire,
      completion,
      assertions: assertions(value.assertions),
      finalizedReport: binary(value.finalizedReport),
      reportDigest: digest(value.reportDigest),
      reportDecision: decision(value.reportDecision),
    };
  }

  encodeGrant(input: Parameters<EfAuthorityCodecPort["encodeGrant"]>[0]) {
    return wire({
      adapterVersion: 1,
      kind: "grant",
      requestDigest: digest(input.requestDigest),
      grant: parseGrant(input.grant),
    });
  }

  encodeReceipt(input: Parameters<EfAuthorityCodecPort["encodeReceipt"]>[0]) {
    return wire({
      adapterVersion: 1,
      kind: "receipt",
      requestDigest: digest(input.requestDigest),
      grantDigest: digest(input.grantDigest),
      completionDigest: digest(input.completionDigest),
      receipt: parseReceipt(input.receipt),
    });
  }
}

function object(
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
    invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)
  );
}

function digest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    invalid();
  return value;
}

function binary(value: unknown): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 48 * 1024 * 1024 ||
    value.length % 4 !== 0
  )
    invalid();
  // Validate in a bounded loop; a regex over multi-megabyte input can overflow
  // the JavaScript regexp engine stack on supported archive sizes.
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const end = value.length - padding;
  for (let index = 0; index < end; index++) {
    const code = value.charCodeAt(index);
    if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47)) invalid();
  }
  for (let index = end; index < value.length; index++)
    if (value.charCodeAt(index) !== 61) invalid();
  if (padding === 2 && end < 2) invalid();
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength === 0 || decoded.toString("base64") !== value)
    invalid();
  return Uint8Array.from(decoded);
}

function assertions(value: unknown): EfBindingAssertions {
  const row = object(value, [
    "repositoryId",
    "installationId",
    "runId",
    "runAttempt",
    "verifierRevision",
    "sourceCommit",
    "sourceTree",
  ]);
  if (!Object.values(row).every(text)) invalid();
  if (
    !/^[a-f0-9]{40}$/.test(row.sourceCommit as string) ||
    !/^[a-f0-9]{40}$/.test(row.sourceTree as string) ||
    !/^[a-f0-9]{40}$/.test(row.verifierRevision as string)
  )
    invalid();
  return row as unknown as EfBindingAssertions;
}

function archive(value: unknown): ArchiveCustody {
  const row = object(value, ["bytes", "sha256", "sha512Sri"]);
  if (
    typeof row.sha512Sri !== "string" ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(row.sha512Sri)
  )
    invalid();
  return {
    bytes: binary(row.bytes),
    sha256: digest(row.sha256),
    sha512Sri: row.sha512Sri,
  };
}

function archiveIdentity(value: ArchiveCustody) {
  return { sha256: value.sha256, sha512Sri: value.sha512Sri };
}

function stringSet(value: unknown, allowEmpty: boolean): readonly string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > 1024 ||
    !value.every(
      (item, index) =>
        text(item) && (index === 0 || (value[index - 1] as string) < item),
    )
  )
    invalid();
  return value as string[];
}

function decision(value: unknown): NormalizedFinalizedReportDecision {
  const row = object(value, ["outcome", "coverage", "coveredScopes", "phases"]);
  if (
    !["passed", "failed"].includes(String(row.outcome)) ||
    !["complete", "partial", "unavailable"].includes(String(row.coverage))
  )
    invalid();
  return {
    outcome: row.outcome as NormalizedFinalizedReportDecision["outcome"],
    coverage: row.coverage as NormalizedFinalizedReportDecision["coverage"],
    coveredScopes: stringSet(row.coveredScopes, true),
    phases: stringSet(row.phases, false),
  };
}

function wire(value: unknown): Uint8Array {
  return Buffer.from(canonical(value), "utf8");
}

/** Bridge-v1 carries a decoded projection beside the retained wire only for
 * transport convenience. The projection is authoritative only when it is the
 * exact canonical decoding of those bytes; otherwise a caller could retain one
 * digest while asking the ledger to decide different fields. */
function exactCanonicalWire(value: Uint8Array, decoded: unknown): void {
  if (!Buffer.from(value).equals(Buffer.from(canonical(decoded), "utf8")))
    invalid();
}

function invalid(): never {
  throw new AuthorityError("invalid-contract");
}
