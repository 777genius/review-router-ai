import { AuthorityError } from "./contracts.js";
import type {
  Binding,
  Completion,
  Grant,
  Identity,
  OwnerEvidence,
  Receipt,
  Request,
} from "./contracts.js";

type ObjectValue = Record<string, unknown>;
function record(value: unknown, keys: readonly string[]): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    invalid();
  const result = value as ObjectValue;
  if (
    Object.getPrototypeOf(result) !== Object.prototype &&
    Object.getPrototypeOf(result) !== null
  )
    invalid();
  if (
    Reflect.ownKeys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key))
  )
    invalid();
  return result;
}
function invalid(): never {
  throw new AuthorityError("invalid-contract");
}
function text(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)
  )
    invalid();
}
function integer(value: unknown, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid();
}
function digest(value: unknown): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
    invalid();
}
function commit(value: unknown): void {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) invalid();
}
function version(value: unknown): void {
  if (value !== 1) invalid();
}
function oneOf(value: unknown, values: readonly unknown[]): void {
  if (!values.includes(value)) invalid();
}
function scopes(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1024)
    invalid();
  value.forEach(text);
  // Sorted unique sets have one wire representation; permutations are not new authority.
  if (value.some((item, i) => i > 0 && value[i - 1] >= item)) invalid();
}
export function parseIdentity(value: unknown): Identity {
  const v = record(value, ["tenantId", "repositoryId", "subject"]);
  Object.values(v).forEach(text);
  return structuredClone(v) as unknown as Identity;
}
export function parseRequest(value: unknown): Request {
  const v = record(value, [
    "version",
    "requestId",
    "repositoryId",
    "pullRequest",
  ]);
  version(v.version);
  text(v.requestId);
  text(v.repositoryId);
  integer(v.pullRequest, 1);
  return structuredClone(v) as unknown as Request;
}
export function parseBinding(value: unknown): Binding {
  const v = record(value, [
    "repositoryId",
    "pullRequest",
    "head",
    "base",
    "mergeBase",
    "verifierId",
    "verifierDigest",
    "policyDigest",
    "toolDigest",
    "artifactDigest",
    "lockDigest",
    "historyDigest",
    "scopeDigest",
    "scopes",
  ]);
  text(v.repositoryId);
  integer(v.pullRequest, 1);
  text(v.verifierId);
  for (const key of ["head", "base", "mergeBase"]) commit(v[key]);
  for (const key of [
    "verifierDigest",
    "policyDigest",
    "toolDigest",
    "artifactDigest",
    "lockDigest",
    "historyDigest",
    "scopeDigest",
  ])
    digest(v[key]);
  scopes(v.scopes);
  return structuredClone(v) as unknown as Binding;
}
export function parseOwnerEvidence(value: unknown): OwnerEvidence {
  const v = record(value, [
    "version",
    "evidenceId",
    "tenantId",
    "ownerSubject",
    "binding",
    "scopes",
    "decision",
    "sourceDigest",
    "issuedAt",
    "expiresAt",
    "revoked",
  ]);
  version(v.version);
  text(v.evidenceId);
  text(v.tenantId);
  text(v.ownerSubject);
  parseBinding(v.binding);
  scopes(v.scopes);
  oneOf(v.decision, ["approved", "rejected"]);
  digest(v.sourceDigest);
  integer(v.issuedAt);
  integer(v.expiresAt);
  if ((v.expiresAt as number) <= (v.issuedAt as number)) invalid();
  oneOf(v.revoked, [true, false]);
  return structuredClone(v) as unknown as OwnerEvidence;
}
export function parseCompletion(value: unknown): Completion {
  const v = record(value, [
    "version",
    "grantId",
    "fence",
    "binding",
    "coveredScopes",
    "coverage",
    "outcome",
    "reportDigest",
  ]);
  version(v.version);
  identifier(v.grantId);
  integer(v.fence, 1);
  parseBinding(v.binding);
  // Empty coverage is a valid negative result, never an admission.
  if (!Array.isArray(v.coveredScopes)) invalid();
  if (v.coveredScopes.length > 0) scopes(v.coveredScopes);
  oneOf(v.coverage, ["complete", "partial", "unavailable"]);
  oneOf(v.outcome, ["passed", "failed"]);
  digest(v.reportDigest);
  return structuredClone(v) as unknown as Completion;
}
function identifier(value: unknown): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048)
    invalid();
}
export function parseGrant(value: unknown): Grant {
  const v = record(value, [
    "version",
    "grantId",
    "identity",
    "request",
    "binding",
    "ownerEvidence",
    "fence",
    "issuedAt",
    "expiresAt",
  ]);
  version(v.version);
  identifier(v.grantId);
  parseIdentity(v.identity);
  parseRequest(v.request);
  parseBinding(v.binding);
  parseOwnerEvidence(v.ownerEvidence);
  integer(v.fence, 1);
  integer(v.issuedAt);
  integer(v.expiresAt);
  if ((v.expiresAt as number) <= (v.issuedAt as number)) invalid();
  return structuredClone(v) as unknown as Grant;
}
export function parseReceipt(value: unknown): Receipt {
  const v = record(value, [
    "version",
    "receiptId",
    "grantId",
    "identity",
    "binding",
    "fence",
    "completedAt",
    "reportDigest",
    "admitted",
    "reason",
  ]);
  version(v.version);
  identifier(v.receiptId);
  identifier(v.grantId);
  parseIdentity(v.identity);
  parseBinding(v.binding);
  integer(v.fence, 1);
  integer(v.completedAt);
  digest(v.reportDigest);
  oneOf(v.admitted, [true, false]);
  oneOf(v.reason, ["admitted", "failed", "incomplete"]);
  if (v.admitted !== (v.reason === "admitted")) invalid();
  return structuredClone(v) as unknown as Receipt;
}
/** Stable structural equality; object key order is immaterial, array order is contractual. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}
export function equal(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}
