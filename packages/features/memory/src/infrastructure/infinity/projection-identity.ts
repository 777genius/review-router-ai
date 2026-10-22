import { createHash } from "node:crypto";
import type { MemorySearchIndexInput } from "../../application/ports/memory-search-index-port";
import { MemoryIndexOperationError } from "../../application/ports/memory-search-index-port";
import type {
  MemoryProjectionReceipt,
  MemoryProjectionRevision,
} from "../projection/memory-projection-receipt-store";

const receiptIdPattern = /^[A-Za-z0-9_-]{1,80}$/u;

/** These identifiers contain no memory text, query text or credential material. */
export function projectionIdentity(receipt: MemoryProjectionReceipt): {
  readonly locator: string;
  readonly sourceExternalId: string;
  readonly idempotencyKey: string;
  readonly sourceKey: string;
} {
  if (!receiptIdPattern.test(receipt.id)) {
    throw new MemoryIndexOperationError("memory_index_identity_invalid");
  }
  const locator = `rrmem:v1:${hash(receipt.indexIdentity)}:${receipt.id}`;
  return {
    locator,
    sourceExternalId: locator,
    idempotencyKey: `rrmem:v1:${hash(locator)}`,
    sourceKey: projectionSourceKey(receipt.indexIdentity, receipt),
  };
}

export function receiptIdFromLocator(
  indexIdentity: string,
  locator: string,
): string | null {
  const prefix = `rrmem:v1:${hash(indexIdentity)}:`;
  if (!locator.startsWith(prefix)) return null;
  const receiptId = locator.slice(prefix.length);
  return receiptIdPattern.test(receiptId) ? receiptId : null;
}

export function projectionSourceKey(
  indexIdentity: string,
  scope: Pick<
    MemoryProjectionRevision,
    "workspaceId" | "repositoryId" | "userId" | "scope"
  >,
): string {
  const collection = [
    indexIdentity,
    scope.workspaceId,
    scope.scope,
    scope.scope === "repository" ? scope.repositoryId : null,
    scope.scope === "user_prefs" ? scope.userId : null,
  ];
  return `rrmem:collection:v1:${hash(JSON.stringify(collection))}`;
}

export function authorizedSourceKeys(
  indexIdentity: string,
  input: MemorySearchIndexInput,
): readonly string[] {
  const keys: string[] = [];
  for (const scope of new Set(input.allowedScopes)) {
    if (scope === "user_prefs" && (!input.includeUserPrefs || !input.userId)) {
      continue;
    }
    keys.push(
      projectionSourceKey(indexIdentity, {
        workspaceId: input.workspaceId,
        repositoryId: scope === "repository" ? input.repositoryId : null,
        userId: scope === "user_prefs" ? input.userId : null,
        scope,
      }),
    );
  }
  return keys.sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
}

export function receiptIsAuthorized(
  receipt: MemoryProjectionReceipt,
  input: MemorySearchIndexInput,
): boolean {
  if (
    receipt.workspaceId !== input.workspaceId ||
    !input.allowedScopes.includes(receipt.scope)
  ) {
    return false;
  }
  if (receipt.scope === "repository") {
    return receipt.repositoryId === input.repositoryId;
  }
  if (receipt.repositoryId !== null) return false;
  if (receipt.scope === "user_prefs") {
    return (
      input.includeUserPrefs &&
      input.userId !== null &&
      receipt.userId === input.userId
    );
  }
  return receipt.scope === "workspace";
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
