import { types as nodeTypes } from "node:util";
import { assertAuthorityTransition } from "../../application/current-authority-transition.js";
import type {
  AuthorityChange,
  AuthorityIoBudget,
  AuthorityScope,
  CanonicalAuthorityMaterial,
  CurrentAuthoritySnapshotPort,
  TrustedAuthorityIngestion,
} from "../../application/ports.js";
import { AuthorityError } from "../../domain/contracts.js";
import type { Identity, Request } from "../../domain/contracts.js";
import { assertOwner } from "../../domain/policy.js";
import {
  equal,
  parseBinding,
  parseIdentity,
  parseOwnerEvidence,
  parseRequest,
} from "../../domain/validation.js";
import { storageScope } from "./authority-storage-validation.js";

export interface AuthorityReadTransaction {
  $queryRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]>;
}
export interface AuthorityWriteTransaction extends AuthorityReadTransaction {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
}
export interface AuthoritySnapshotPrismaClient {
  $transaction<T>(
    operation: (transaction: AuthorityReadTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" },
  ): Promise<T>;
}
export interface AuthorityProvisioningPrismaClient {
  $transaction<T>(
    operation: (transaction: AuthorityWriteTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" },
  ): Promise<T>;
}
function key(scope: AuthorityScope): string {
  const s = storageScope(scope);
  return JSON.stringify([s.tenantId, s.repositoryId, s.pullRequest]);
}
function requireValid(condition: boolean): asserts condition {
  if (!condition) throw new AuthorityError("invalid-contract");
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
    // Proxy reflection can execute caller code and replace an already-inspected
    // branch before structuredClone reads it. Reject proxies without invoking traps.
    if (nodeTypes.isProxy(item)) requireValid(false);
    const array = Array.isArray(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    for (const key of keys) {
      if (typeof key !== "string") requireValid(false);
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, "value")) requireValid(false);
      if (array && key === "length") continue;
      if (!descriptor.enumerable) requireValid(false);
      if (
        array &&
        (!/^(0|[1-9][0-9]*)$/.test(key) ||
          Number(key) >= descriptors.length!.value)
      )
        requireValid(false);
      pending.push(descriptor.value);
    }
    // Holes are not scope entries; Array#forEach would otherwise skip them.
    if (array && keys.length !== descriptors.length!.value + 1)
      requireValid(false);
    const prototype = Object.getPrototypeOf(item);
    if (
      array
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      requireValid(false);
  }
}
function detached<T>(value: T): T {
  // This is the only clone of the caller-owned graph. Inspection and cloning are
  // synchronous; rejecting proxies closes the remaining mutation opportunity.
  try {
    inspectSource(value);
    return structuredClone(value);
  } catch {
    throw new AuthorityError("invalid-contract");
  }
}
function exactObject(
  value: unknown,
  expected: readonly string[],
): Record<string, unknown> {
  requireValid(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  const result = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(result);
  requireValid(
    keys.length === expected.length &&
      keys.every(
        (candidate) =>
          typeof candidate === "string" && expected.includes(candidate),
      ),
  );
  return result;
}
function identityField(value: unknown, scope: AuthorityScope): string {
  requireValid(typeof value === "string");
  parseIdentity({
    tenantId: scope.tenantId,
    repositoryId: scope.repositoryId,
    subject: value,
  });
  return value;
}
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (candidate): candidate is string => typeof candidate === "string",
    )
  );
}
function validateMaterial(
  value: unknown,
  scope: AuthorityScope,
): CanonicalAuthorityMaterial {
  const record = exactObject(value, [
    "binding",
    "ownerEvidence",
    "provenance",
    "installationActive",
    "verifierActive",
  ]);
  const binding = parseBinding(record.binding);
  const ownerEvidence = parseOwnerEvidence(record.ownerEvidence);
  const p = exactObject(record.provenance, [
    "issuer",
    "subject",
    "authenticationId",
    "installationId",
    "sourceDigest",
    "authorizedSubjects",
  ]);
  const issuer = identityField(p.issuer, scope);
  const subject = identityField(p.subject, scope);
  const authenticationId = identityField(p.authenticationId, scope);
  const installationId = identityField(p.installationId, scope);
  requireValid(typeof p.sourceDigest === "string");
  const sourceDigest = p.sourceDigest;
  const authorizedSubjects = p.authorizedSubjects;
  requireValid(
    isStringArray(authorizedSubjects) &&
      authorizedSubjects.length > 0 &&
      authorizedSubjects.length <= 1024,
  );
  for (const subject of authorizedSubjects)
    parseIdentity({
      tenantId: scope.tenantId,
      repositoryId: scope.repositoryId,
      subject,
    });
  requireValid(
    !authorizedSubjects.some(
      (subject, index) =>
        index > 0 && authorizedSubjects[index - 1]! >= subject,
    ),
  );
  requireValid(
    subject === ownerEvidence.ownerSubject &&
      sourceDigest === ownerEvidence.sourceDigest,
  );
  requireValid(
    binding.repositoryId === scope.repositoryId &&
      binding.pullRequest === scope.pullRequest &&
      ownerEvidence.tenantId === scope.tenantId &&
      equal(binding, ownerEvidence.binding) &&
      equal(binding.scopes, ownerEvidence.scopes),
  );
  requireValid(
    typeof record.installationActive === "boolean" &&
      typeof record.verifierActive === "boolean",
  );
  return {
    binding,
    ownerEvidence,
    provenance: {
      issuer,
      subject,
      authenticationId,
      installationId,
      sourceDigest,
      authorizedSubjects,
    },
    installationActive: record.installationActive,
    verifierActive: record.verifierActive,
  };
}
function material(
  value: CanonicalAuthorityMaterial,
  scope: AuthorityScope,
): CanonicalAuthorityMaterial {
  return validateMaterial(detached(value), scope);
}
function storedMaterial(value: unknown, scope: AuthorityScope) {
  const row = exactObject(detached(value), [
    "epoch",
    "binding",
    "evidence",
    "provenance",
    "installationActive",
    "verifierActive",
  ]);
  requireValid(typeof row.epoch === "bigint" && row.epoch > 0n);
  return {
    epoch: row.epoch,
    material: validateMaterial(
      {
        binding: row.binding,
        ownerEvidence: row.evidence,
        provenance: row.provenance,
        installationActive: row.installationActive,
        verifierActive: row.verifierActive,
      },
      scope,
    ),
  };
}
function storedEpoch(value: unknown, allowZero = false): bigint {
  const row = exactObject(detached(value), ["epoch"]);
  requireValid(
    typeof row.epoch === "bigint" &&
      (allowZero ? row.epoch >= 0n : row.epoch > 0n),
  );
  return row.epoch;
}
async function loadStoredMaterial(
  transaction: AuthorityReadTransaction,
  scopeKey: string,
  scope: AuthorityScope,
  epoch: bigint,
): Promise<CanonicalAuthorityMaterial> {
  const [row] = await transaction.$queryRaw`
    SELECT b."epoch", b."binding", o."evidence", o."provenance", o."installationActive", o."verifierActive"
    FROM "SdkGrowthBindingVersion" b
    JOIN "SdkGrowthOwnerVersion" o ON o."scopeKey" = b."scopeKey" AND o."epoch" = b."epoch"
    WHERE b."scopeKey" = ${scopeKey} AND b."epoch" = ${epoch}`;
  requireValid(row !== undefined);
  const stored = storedMaterial(row, scope);
  requireValid(stored.epoch === epoch);
  return stored.material;
}

/** Read-only port: no ingestion capability is exposed to application callers.
 * READ COMMITTED plus a final pointer lock detects changes during resolution.
 * Writers use that same pointer lock; history rows are immutable in PostgreSQL.
 * The fence is a linearization point, not authorization for a future side effect. */
export class PrismaCurrentAuthoritySnapshot implements CurrentAuthoritySnapshotPort {
  constructor(
    private readonly prisma:
      | AuthoritySnapshotPrismaClient
      | AuthorityReadTransaction,
    private readonly now: () => number = Date.now,
    private readonly transactionHeld = false,
  ) {}

  async resolve(
    authenticated: Identity,
    body: Request,
    budget: AuthorityIoBudget,
  ) {
    const active = () => {
      if (budget.signal.aborted) throw new AuthorityError("io-timeout", "none");
      budget.assertActive();
    };
    active();
    const identity = parseIdentity(authenticated);
    const request = parseRequest(body);
    if (identity.repositoryId !== request.repositoryId) return null;
    const scope = {
      tenantId: identity.tenantId,
      repositoryId: identity.repositoryId,
      pullRequest: request.pullRequest,
    };
    const scopeKey = key(scope);
    const read = async (tx: AuthorityReadTransaction) => {
      active();
      const [row] = await tx.$queryRaw`
        SELECT c."epoch", b."binding", o."evidence", o."provenance", o."installationActive", o."verifierActive"
        FROM "SdkGrowthCurrentAuthority" c
        JOIN "SdkGrowthBindingVersion" b ON b."scopeKey" = c."scopeKey" AND b."epoch" = c."epoch"
        JOIN "SdkGrowthOwnerVersion" o ON o."scopeKey" = b."scopeKey" AND o."epoch" = b."epoch"
        WHERE c."scopeKey" = ${scopeKey}`;
      active();
      if (!row) return null;
      const stored = storedMaterial(row, scope);
      requireValid(stored.epoch <= BigInt(Number.MAX_SAFE_INTEGER));
      const result = stored.material;
      if (
        !result.installationActive ||
        !result.verifierActive ||
        !result.provenance.authorizedSubjects.includes(identity.subject)
      )
        return null;
      const [fence] =
        await tx.$queryRaw`SELECT "epoch" FROM "SdkGrowthCurrentAuthority" WHERE "scopeKey" = ${scopeKey} FOR SHARE`;
      active();
      if (!fence || storedEpoch(fence) !== stored.epoch) return null;
      const now = this.now();
      requireValid(Number.isSafeInteger(now) && now >= 0);
      assertOwner(identity, result.binding, result.ownerEvidence, now);
      return {
        epoch: Number(stored.epoch),
        binding: result.binding,
        ownerEvidence: result.ownerEvidence,
      };
    };
    const snapshot = this.transactionHeld
      ? await read(this.prisma as AuthorityReadTransaction)
      : await (this.prisma as AuthoritySnapshotPrismaClient).$transaction(
          read,
          { isolationLevel: "ReadCommitted" },
        );
    active();
    return snapshot;
  }
}

/** Internal provisioning command boundary. There is deliberately no material/body
 * parameter: only the authenticated trusted loader can supply canonical rows.
 * expectedEpoch prevents a slow loader from overwriting a newer invalidation. */
export class PrismaAuthorityProvisioning {
  constructor(
    private readonly prisma: AuthorityProvisioningPrismaClient,
    private readonly ingestion: TrustedAuthorityIngestion,
  ) {}

  async advance(
    credential: unknown,
    authorityScope: AuthorityScope,
    expectedEpoch: bigint,
    change: AuthorityChange,
  ): Promise<bigint> {
    const scope = storageScope(authorityScope);
    const scopeKey = key(scope);
    requireValid(
      typeof expectedEpoch === "bigint" &&
        expectedEpoch >= 0n &&
        expectedEpoch < 9223372036854775807n,
    );
    requireValid(
      [
        "provision",
        "binding-replacement",
        "owner-replacement",
        "owner-revocation",
        "installation-invalidation",
        "verifier-withdrawal",
      ].includes(change),
    );
    const next = material(
      await this.ingestion.authenticateAndLoad(
        credential,
        structuredClone(scope),
        change,
      ),
      scope,
    );
    requireValid(change !== "owner-revocation" || next.ownerEvidence.revoked);
    requireValid(
      change !== "installation-invalidation" || !next.installationActive,
    );
    requireValid(change !== "verifier-withdrawal" || !next.verifierActive);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`;
        await tx.$executeRaw`INSERT INTO "SdkGrowthCurrentAuthority" ("scopeKey", "epoch") VALUES (${scopeKey}, 0) ON CONFLICT DO NOTHING`;
        const [current] =
          await tx.$queryRaw`SELECT "epoch" FROM "SdkGrowthCurrentAuthority" WHERE "scopeKey" = ${scopeKey} FOR UPDATE`;
        if (!current) throw new AuthorityError("conflict");
        const currentEpoch = storedEpoch(current, true);
        if (currentEpoch !== expectedEpoch)
          throw new AuthorityError("conflict");
        const previous =
          currentEpoch === 0n
            ? null
            : await loadStoredMaterial(tx, scopeKey, scope, currentEpoch);
        assertAuthorityTransition(previous, next, change);
        const epoch = currentEpoch + 1n;
        await tx.$executeRaw`INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding") VALUES (${scopeKey}, ${epoch}, ${JSON.stringify(next.binding)}::jsonb)`;
        await tx.$executeRaw`INSERT INTO "SdkGrowthOwnerVersion" ("scopeKey", "epoch", "evidence", "provenance", "installationActive", "verifierActive", "reason") VALUES (${scopeKey}, ${epoch}, ${JSON.stringify(next.ownerEvidence)}::jsonb, ${JSON.stringify(next.provenance)}::jsonb, ${next.installationActive}, ${next.verifierActive}, ${change})`;
        await tx.$executeRaw`UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = ${epoch} WHERE "scopeKey" = ${scopeKey}`;
        return epoch;
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
}
