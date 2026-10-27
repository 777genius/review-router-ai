import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import {
  canonicalHindsightCleanup,
  type HindsightCleanupBinding,
} from "../../packages/features/memory/src/infrastructure/hindsight/hindsight-cleanup-receipt.ts";

export interface CleanupSourceInventory {
  readonly schema: "hindsight-cleanup-inventory/v1";
  readonly binding: HindsightCleanupBinding;
  readonly documentId: string;
  readonly capturedAt: string;
  readonly sourceFactIds: readonly string[];
  readonly observationIds: readonly string[];
  readonly operationIds: readonly string[];
}
interface SignedInventory {
  readonly keyId: string;
  readonly inventory: CleanupSourceInventory;
  readonly signature: string;
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const validIds = (value: unknown, limit: number): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= limit &&
  value.every(uuid) &&
  new Set(value).size === value.length;
export function signCleanupInventory(
  inventory: CleanupSourceInventory,
  keyId: string,
  privatePem: string,
): SignedInventory {
  const key = createPrivateKey(privatePem);
  assert.equal(key.asymmetricKeyType, "ed25519");
  return {
    keyId,
    inventory,
    signature: sign(
      null,
      Buffer.from(canonicalHindsightCleanup(inventory)),
      key,
    ).toString("base64url"),
  };
}
export function verifyCleanupInventory(
  input: unknown,
  binding: HindsightCleanupBinding,
  keyId: string,
  publicPem: string,
): CleanupSourceInventory {
  assert(input && typeof input === "object");
  const signed = input as SignedInventory;
  const inventory = signed.inventory;
  assert(
    signed.keyId === keyId &&
      typeof signed.signature === "string" &&
      /^[A-Za-z0-9_-]{86}$/.test(signed.signature),
  );
  const key = createPublicKey(publicPem);
  assert.equal(key.asymmetricKeyType, "ed25519");
  assert(
    inventory &&
      inventory.schema === "hindsight-cleanup-inventory/v1" &&
      canonicalHindsightCleanup(inventory.binding) ===
        canonicalHindsightCleanup(binding),
  );
  assert(
    inventory.documentId === `entry-${binding.entryId}` &&
      Number.isFinite(Date.parse(inventory.capturedAt)),
  );
  assert(
    validIds(inventory.sourceFactIds, 10_000) &&
      inventory.sourceFactIds.length > 0 &&
      validIds(inventory.observationIds, 10_000) &&
      validIds(inventory.operationIds, 1024),
  );
  const encoded = canonicalHindsightCleanup(inventory);
  assert(encoded.length <= 1_000_000);
  assert(
    verify(
      null,
      Buffer.from(encoded),
      key,
      Buffer.from(signed.signature, "base64url"),
    ),
    "Cleanup retry inventory authentication failed",
  );
  return inventory;
}
/** Must finish and fsync before any destructive native request. Never replace prior evidence. */
export async function persistCleanupInventory(
  path: string,
  signed: SignedInventory,
): Promise<void> {
  assert(isAbsolute(path));
  const directory = await stat(dirname(path));
  assert(
    directory.isDirectory() &&
      directory.uid === process.getuid?.() &&
      (directory.mode & 0o022) === 0,
  );
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(signed) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directoryHandle = await open(dirname(path), "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}
export async function readCleanupInventory(
  path: string,
  binding: HindsightCleanupBinding,
  keyId: string,
  publicPem: string,
): Promise<CleanupSourceInventory | undefined> {
  let information;
  try {
    information = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  assert(
    information.isFile() &&
      information.size <= 1_000_000 &&
      information.uid === process.getuid?.() &&
      (information.mode & 0o077) === 0,
  );
  return verifyCleanupInventory(
    JSON.parse(await readFile(path, "utf8")),
    binding,
    keyId,
    publicPem,
  );
}

export interface CleanupOperation {
  operation_id: string;
  operation_type?: string;
  status: string;
  task_payload?: unknown;
  result_metadata?: {
    parent_operation_id?: string;
    readonly [key: string]: unknown;
  };
  child_operations?: CleanupOperation[];
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
function documentIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(documentIds);
  if (!object(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    key === "document_id" && typeof item === "string"
      ? [item]
      : documentIds(item),
  );
}
function consolidationEvent(value: unknown, document: string): boolean {
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "document_id",
          "kind",
          "created_at",
          "operation_id",
          "fact_id",
          "facts_added",
          "facts_removed",
          "observations_created",
          "observations_updated",
          "observations_removed",
        ].includes(key),
    )
  )
    return false;
  if (
    typeof value.document_id !== "string" ||
    !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value.document_id) ||
    (value.kind !== "consolidation" &&
      !(value.kind === "retag" && value.document_id === document)) ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at)) ||
    value.operation_id != null ||
    value.fact_id != null ||
    value.facts_added !== 0 ||
    value.facts_removed !== 0
  )
    return false;
  return [
    "observations_created",
    "observations_updated",
    "observations_removed",
  ].every((key) => {
    const sample = value[key];
    return (
      object(sample) &&
      Object.keys(sample).length === 2 &&
      Object.keys(sample).every(
        (field) => field === "count" || field === "ids",
      ) &&
      Number.isSafeInteger(sample.count) &&
      Number(sample.count) >= 0 &&
      validIds(sample.ids, 100) &&
      Number(sample.count) >= sample.ids.length
    );
  });
}
/**
 * Retain payloads must name this document alone. Pinned native consolidation
 * history has one ID/count-only event per source of a shared observation; those
 * events are deletion evidence, not another document's executable retain batch.
 */
export function assertCleanupOperationSources(
  operation: CleanupOperation | undefined,
  document: string,
  bank: string,
): void {
  if (documentIds(operation).every((value) => value === document)) return;
  assert(
    operation?.operation_type === "consolidation",
    "Mixed-source native retain batch is unsupported by the first cleanup profile",
  );
  const payload = operation.task_payload;
  assert(
    object(payload) &&
      payload.type === "consolidation" &&
      payload.operation_id === operation.operation_id &&
      payload.bank_id === bank &&
      Object.keys(payload).every((key) =>
        [
          "type",
          "operation_id",
          "bank_id",
          "_tenant_id",
          "_api_key_id",
          "observation_scopes",
          "pending_refresh_tags",
          "caller_requested",
        ].includes(key),
      ),
    "Unreviewed consolidation task payload cannot use the shared-history exception",
  );
  const metadata = operation.result_metadata;
  assert(
    object(metadata) &&
      Array.isArray(metadata.document_events) &&
      metadata.document_events.length <= 10_000 &&
      metadata.document_events.every((event) =>
        consolidationEvent(event, document),
      ),
    "Shared consolidation history must contain only pinned native ID/count events",
  );
  const remaining = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => key !== "document_events"),
  );
  assert(
    documentIds({ ...operation, result_metadata: remaining }).every(
      (value) => value === document,
    ),
    "Foreign document outside consolidation ID/count history",
  );
}

/** Fixed point includes ancestors, descendants and reverse parent references. */
export function operationClosure(
  operations: ReadonlyMap<string, CleanupOperation>,
  seeds: Iterable<string>,
): Set<string> {
  const related = new Set(seeds);
  let changed = true;
  while (changed) {
    assert(related.size <= 1024, "Cleanup exceeds bounded operation inventory");
    changed = false;
    const add = (id: string) => {
      assert(uuid(id));
      if (!related.has(id)) {
        related.add(id);
        changed = true;
      }
    };
    for (const operation of operations.values()) {
      const parent = operation.result_metadata?.parent_operation_id;
      if (related.has(operation.operation_id)) {
        if (parent) add(parent);
        for (const child of operation.child_operations ?? [])
          add(child.operation_id);
      } else if (
        (parent && related.has(parent)) ||
        operation.child_operations?.some((child) =>
          related.has(child.operation_id),
        )
      )
        add(operation.operation_id);
    }
  }
  assert(related.size <= 1024);
  return related;
}

/** Children are removed before parents, including multi-generation task trees. */
export function leafFirstOperations(
  operations: ReadonlyMap<string, CleanupOperation>,
  related: ReadonlySet<string>,
): string[] {
  const result: string[] = [];
  const visiting = new Set<string>();
  const finished = new Set<string>();
  const visit = (id: string) => {
    if (finished.has(id)) return;
    assert(!visiting.has(id), "Native operation graph contains a cycle");
    visiting.add(id);
    for (const candidate of operations.values())
      if (
        related.has(candidate.operation_id) &&
        candidate.result_metadata?.parent_operation_id === id
      )
        visit(candidate.operation_id);
    for (const child of operations.get(id)?.child_operations ?? [])
      if (related.has(child.operation_id)) visit(child.operation_id);
    visiting.delete(id);
    finished.add(id);
    result.push(id);
  };
  for (const id of related) visit(id);
  return result;
}
