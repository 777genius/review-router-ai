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

// Clone once at the trust boundary. Nested validators inspect this same detached graph.
function snapshot(value: unknown): unknown {
  try {
    inspectSource(value);
    return structuredClone(value);
  } catch {
    return invalid();
  }
}
// Inspect descriptors only: cloning must never normalize forbidden source shapes.
// Iterative traversal handles shared references and cycles without recursion.
function inspectSource(value: unknown): void {
  const pending = [value];
  const seen = new WeakSet<object>();
  while (pending.length) {
    const item = pending.pop();
    if (item === null || typeof item !== "object") continue;
    if (seen.has(item)) continue;
    seen.add(item);
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      invalid();
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (typeof key !== "string") invalid();
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, "value")) invalid();
      if (array && key === "length") continue;
      if (!descriptor.enumerable) invalid();
      if (
        array &&
        (!/^(0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= descriptors.length!.value)
      )
        invalid();
      pending.push(descriptor.value);
    }
    // Holes are not scope entries; Array#forEach would otherwise skip them.
    if (array && keys.length !== descriptors.length!.value + 1) invalid();
  }
}
export function parseIdentity(value: unknown): Identity {
  return validateIdentity(snapshot(value));
}
export function parseRequest(value: unknown): Request {
  return validateRequest(snapshot(value));
}
export function parseBinding(value: unknown): Binding {
  return validateBinding(snapshot(value));
}
export function parseOwnerEvidence(value: unknown): OwnerEvidence {
  return validateOwnerEvidence(snapshot(value));
}
export function parseCompletion(value: unknown): Completion {
  return validateCompletion(snapshot(value));
}
export function parseGrant(value: unknown): Grant {
  return validateGrant(snapshot(value));
}
export function parseReceipt(value: unknown): Receipt {
  return validateReceipt(snapshot(value));
}

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
function validateIdentity(value: unknown): Identity {
  const v = record(value, ["tenantId", "repositoryId", "subject"]);
  Object.values(v).forEach(text);
  return v as unknown as Identity;
}
function validateRequest(value: unknown): Request {
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
  return v as unknown as Request;
}
function validateBinding(value: unknown): Binding {
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
  return v as unknown as Binding;
}
function validateOwnerEvidence(value: unknown): OwnerEvidence {
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
  validateBinding(v.binding);
  scopes(v.scopes);
  oneOf(v.decision, ["approved", "rejected"]);
  digest(v.sourceDigest);
  integer(v.issuedAt);
  integer(v.expiresAt);
  if ((v.expiresAt as number) <= (v.issuedAt as number)) invalid();
  oneOf(v.revoked, [true, false]);
  return v as unknown as OwnerEvidence;
}
function validateCompletion(value: unknown): Completion {
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
  validateBinding(v.binding);
  // Empty coverage is a valid negative result, never an admission.
  if (!Array.isArray(v.coveredScopes)) invalid();
  if (v.coveredScopes.length > 0) scopes(v.coveredScopes);
  oneOf(v.coverage, ["complete", "partial", "unavailable"]);
  oneOf(v.outcome, ["passed", "failed"]);
  digest(v.reportDigest);
  return v as unknown as Completion;
}
function identifier(value: unknown): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048)
    invalid();
}
function validateGrant(value: unknown): Grant {
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
  validateIdentity(v.identity);
  validateRequest(v.request);
  validateBinding(v.binding);
  validateOwnerEvidence(v.ownerEvidence);
  integer(v.fence, 1);
  integer(v.issuedAt);
  integer(v.expiresAt);
  if ((v.expiresAt as number) <= (v.issuedAt as number)) invalid();
  return v as unknown as Grant;
}
function validateReceipt(value: unknown): Receipt {
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
  validateIdentity(v.identity);
  validateBinding(v.binding);
  integer(v.fence, 1);
  integer(v.completedAt);
  digest(v.reportDigest);
  oneOf(v.admitted, [true, false]);
  oneOf(v.reason, ["admitted", "failed", "incomplete"]);
  if (v.admitted !== (v.reason === "admitted")) invalid();
  return v as unknown as Receipt;
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
