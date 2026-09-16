import type {
  AuthorityLedger,
  AuthorityRecord,
  AuthorityScope,
} from "../../application/ports.js";
import { AuthorityError } from "../../domain/contracts.js";
import { assertOwner, makeReceipt } from "../../domain/policy.js";
import {
  equal,
  parseCompletion,
  parseGrant,
  parseIdentity,
  parseReceipt,
  parseRequest,
} from "../../domain/validation.js";

function requireStorage(condition: boolean): asserts condition {
  if (!condition) throw new AuthorityError("invalid-contract");
}
function exact(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  requireStorage(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  requireStorage(
    Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null,
  );
  requireStorage(
    Reflect.ownKeys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)),
  );
}
export function storageScope(value: AuthorityScope): AuthorityScope {
  exact(value, ["tenantId", "repositoryId", "pullRequest"]);
  parseIdentity({
    tenantId: value.tenantId,
    repositoryId: value.repositoryId,
    subject: "storage",
  });
  parseRequest({
    version: 1,
    requestId: "storage",
    repositoryId: value.repositoryId,
    pullRequest: value.pullRequest,
  });
  return structuredClone(value);
}
export function storageRecord(
  value: unknown,
  scope: AuthorityScope,
): AuthorityRecord {
  exact(value, [
    "grant",
    "revoked",
    "completion",
    "receipt",
    "intent",
    "dispatched",
  ]);
  const grant = parseGrant(value.grant);
  requireStorage(
    typeof value.revoked === "boolean" && typeof value.dispatched === "boolean",
  );
  requireStorage(
    grant.identity.tenantId === scope.tenantId &&
      grant.identity.repositoryId === scope.repositoryId &&
      grant.request.repositoryId === scope.repositoryId &&
      grant.request.pullRequest === scope.pullRequest &&
      grant.binding.repositoryId === scope.repositoryId &&
      grant.binding.pullRequest === scope.pullRequest,
  );
  requireStorage(
    grant.grantId ===
      JSON.stringify([
        scope.tenantId,
        scope.repositoryId,
        scope.pullRequest,
        grant.request.requestId,
      ]),
  );
  assertOwner(
    grant.identity,
    grant.binding,
    grant.ownerEvidence,
    grant.issuedAt,
  );
  requireStorage(grant.expiresAt <= grant.ownerEvidence.expiresAt);
  if (value.completion === null) {
    requireStorage(
      value.receipt === null &&
        value.intent === null &&
        value.dispatched === false,
    );
  } else {
    const completion = parseCompletion(value.completion);
    const receipt = parseReceipt(value.receipt);
    requireStorage(
      completion.grantId === grant.grantId &&
        completion.fence === grant.fence &&
        equal(completion.binding, grant.binding),
    );
    requireStorage(
      receipt.completedAt >= grant.issuedAt &&
        receipt.completedAt < grant.expiresAt,
    );
    requireStorage(
      equal(receipt, makeReceipt(grant, completion, receipt.completedAt)),
    );
    exact(value.intent, ["version", "intentId", "receipt"]);
    requireStorage(
      equal(value.intent, { version: 1, intentId: receipt.receiptId, receipt }),
    );
  }
  // Seven scope arrays at most: 7 * 1024 * (256 ASCII bytes + 3 JSON bytes)
  // = 1,856,512 bytes. All remaining bounded metadata fits in 100KB, including
  // escaped identifiers. 2MB admits every valid completion; PostgreSQL's 2MiB
  // jsonb text cap additionally covers its whitespace. Keep both bounds aligned.
  // Parsers reject unknown keys and bound every metadata field; never serialize arbitrary payloads.
  requireStorage(Buffer.byteLength(JSON.stringify(value), "utf8") <= 2_000_000);
  return structuredClone(value) as unknown as AuthorityRecord;
}
export function storageLedger(
  value: AuthorityLedger,
  scope: AuthorityScope,
): AuthorityLedger {
  exact(value, ["fence", "records"]);
  requireStorage(
    Number.isSafeInteger(value.fence) &&
      value.fence >= 0 &&
      Array.isArray(value.records),
  );
  const records = value.records.map((record) => storageRecord(record, scope));
  requireStorage(records.length <= 1);
  records.forEach((record) => {
    requireStorage(record.grant.fence <= value.fence);
  });
  return { fence: value.fence, records };
}
export function storageTransition(
  before: AuthorityLedger,
  after: AuthorityLedger,
): void {
  requireStorage(
    after.fence ===
      before.fence + after.records.length - before.records.length &&
      after.records.length >= before.records.length,
  );
  before.records.forEach((old, index) => {
    const next = after.records[index];
    requireStorage(
      !!next &&
        equal(old.grant, next.grant) &&
        (!old.revoked || next.revoked) &&
        (!old.dispatched || next.dispatched),
    );
    if (old.completion !== null)
      requireStorage(
        equal(old.completion, next.completion) &&
          equal(old.receipt, next.receipt) &&
          equal(old.intent, next.intent),
      );
    if (old.completion === null && next.completion !== null)
      requireStorage(
        !old.revoked &&
          next.grant.fence === before.fence &&
          after.fence === before.fence,
      );
  });
  for (const record of after.records.slice(before.records.length)) {
    requireStorage(
      record.grant.fence === after.fence &&
        !record.revoked &&
        record.completion === null &&
        !record.dispatched,
    );
  }
}
