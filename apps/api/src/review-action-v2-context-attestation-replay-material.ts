// Validate replay material and authenticated transcripts, preserving legacy and gateway-v4 encodings.
import {
  ContextDependencyKind,
  ContextGatewayV4OperationKind,
  ContextGatewayV4OutcomeKind,
  canonicalContextDependencyOperation,
  canonicalContextDependencyResult,
  isLegacyContextDependencyManifest,
  type ContextAttestationManifest,
  type ContextDependencyManifest,
  type ContextGatewayV4Manifest,
  type GatewaySession,
} from "@reviewrouter/features-review-context-attestation";
import { stableJson } from "@reviewrouter/features-review-evidence";
import {
  ReviewActionV2ProtocolErrorCode,
  canonicalizeReviewContextGatewayEvent,
  canonicalizeReviewContextReplayChainSeed,
  canonicalizeReviewContextReplayEvent,
  canonicalizeReviewContextReplayHandle,
  canonicalizeReviewContextSearchQuery,
} from "@reviewrouter/protocol-review-action-v2";
import {
  hmacHex,
  sameHex,
  sha256Utf8,
} from "./review-action-v2-context-attestation-crypto.js";
import { failure } from "./review-action-v2-context-attestation-validation.js";

const replayMaterialVersion = 1;
export function targetManifestMatchesGatewayV4Plan(
  manifest: ContextGatewayV4Manifest,
  operations: readonly Readonly<{
    operationKind: ContextGatewayV4OperationKind;
    replayInput: Readonly<Record<string, unknown>>;
  }>[],
): boolean {
  const successful = manifest.events.filter(
    (event) => event.outcome === ContextGatewayV4OutcomeKind.Succeeded,
  );
  const targetOperations: Array<
    Readonly<{
      operationKind: ContextGatewayV4OperationKind;
      operationKey: string;
    }>
  > = [];
  const seenPageGroups = new Set<string>();
  for (const event of successful) {
    if (
      event.operationKind === ContextGatewayV4OperationKind.DirectoryList ||
      event.operationKind === ContextGatewayV4OperationKind.TextSearch ||
      event.operationKind === ContextGatewayV4OperationKind.CanonicalInventory
    ) {
      const group = gatewayV4ReplayGroupKey(event);
      if (seenPageGroups.has(group)) continue;
      seenPageGroups.add(group);
      if (event.result?.pageOrdinal !== 0) return false;
    }
    targetOperations.push(
      Object.freeze({
        operationKind: event.operationKind,
        operationKey: event.operationKey,
      }),
    );
  }
  if (targetOperations.length !== operations.length) return false;
  return operations.every((operation, index) => {
    const target = targetOperations[index];
    return (
      target?.operationKind === operation.operationKind &&
      target.operationKey ===
        gatewayV4OperationKey(operation.operationKind, operation.replayInput)
    );
  });
}

export function selectGatewayV4ReplayOperations(
  manifest: ContextGatewayV4Manifest,
  material: GatewayV4ReplayMaterial,
  selectedReceiptIds: readonly string[],
):
  | readonly Readonly<{
      operationKind: ContextGatewayV4OperationKind;
      replayInput: Readonly<Record<string, unknown>>;
    }>[]
  | null {
  const successful = manifest.events.filter(
    (event) => event.outcome === ContextGatewayV4OutcomeKind.Succeeded,
  );
  const eventByReceipt = new Map(
    successful.map((event) => [event.operationReceiptId!, event]),
  );
  if (selectedReceiptIds.some((receiptId) => !eventByReceipt.has(receiptId))) {
    return null;
  }
  const selectedGroups = new Set(
    selectedReceiptIds.map((receiptId) =>
      gatewayV4ReplayGroupKey(eventByReceipt.get(receiptId)!),
    ),
  );
  const entryBySequence = new Map(
    material.entries.map((entry) => [entry.sequence, entry]),
  );
  const groups = new Map<string, typeof successful>();
  for (const event of successful) {
    const key = gatewayV4ReplayGroupKey(event);
    if (!selectedGroups.has(key)) continue;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const orderedGroups = [...groups.values()].sort(
    (left, right) => left[0]!.sequence - right[0]!.sequence,
  );
  const operations: Array<{
    operationKind: ContextGatewayV4OperationKind;
    replayInput: Readonly<Record<string, unknown>>;
  }> = [];
  for (const events of orderedGroups) {
    const kind = events[0]!.operationKind;
    if (
      kind === ContextGatewayV4OperationKind.DirectoryList ||
      kind === ContextGatewayV4OperationKind.TextSearch ||
      kind === ContextGatewayV4OperationKind.CanonicalInventory
    ) {
      const first = events.find((event) => event.result?.pageOrdinal === 0);
      const entry = first ? entryBySequence.get(first.sequence) : null;
      if (!entry) return null;
      const { cursor, ...replayInput } = entry.replayInput;
      void cursor;
      operations.push(
        Object.freeze({
          operationKind: kind,
          replayInput: Object.freeze(replayInput),
        }),
      );
      continue;
    }
    for (const event of events) {
      const entry = entryBySequence.get(event.sequence);
      if (!entry) return null;
      operations.push(
        Object.freeze({
          operationKind: kind,
          replayInput: entry.replayInput,
        }),
      );
    }
  }
  return Object.freeze(operations);
}

function gatewayV4ReplayGroupKey(
  event: ContextGatewayV4Manifest["events"][number],
): string {
  const result = event.result;
  if (!result) return `failed:${event.sequence}`;
  switch (event.operationKind) {
    case ContextGatewayV4OperationKind.FileRead:
      return stableJson({
        kind: event.operationKind,
        pathHash: result.pathHash,
        revision: result.revision,
      } as never);
    case ContextGatewayV4OperationKind.DirectoryList:
    case ContextGatewayV4OperationKind.TextSearch:
    case ContextGatewayV4OperationKind.CanonicalInventory:
      return stableJson({
        kind: event.operationKind,
        queryDigest: result.queryDigest,
      } as never);
    case ContextGatewayV4OperationKind.GitFact:
      return stableJson({
        kind: event.operationKind,
        fact: result.fact,
      } as never);
    case ContextGatewayV4OperationKind.UnsupportedTool:
      return `unsupported:${event.sequence}`;
  }
}

type LegacyReplayMaterial = Readonly<{
  materialVersion: typeof replayMaterialVersion;
  sourceDependencies: readonly Readonly<{
    sequence: number;
    operationKey: string;
    replayQuery: string | null;
  }>[];
}>;

type GatewayV4ReplayMaterial = Readonly<{
  replayMaterialVersion: 2;
  sessionId: string;
  entries: readonly Readonly<{
    sequence: number;
    operationReceiptId: string;
    operationKey: string;
    operationKind: ContextGatewayV4OperationKind;
    replayInput: Readonly<Record<string, unknown>>;
  }>[];
}>;

type ReplayMaterial = LegacyReplayMaterial | GatewayV4ReplayMaterial;

export function parseReplayMaterial(
  value: string,
  manifest: ContextAttestationManifest,
  session: GatewaySession,
  sessionSecret: Buffer,
): ReplayMaterial & { readonly canonicalJson: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidReplayMaterial();
  }
  if (!isLegacyContextDependencyManifest(manifest)) {
    return parseGatewayV4ReplayMaterial(value, parsed, manifest, session);
  }
  const root = exactRecord(
    parsed,
    ["materialVersion", "sourceDependencies"],
    "context_replay_material_invalid",
  );
  if (
    root.materialVersion !== replayMaterialVersion ||
    !Array.isArray(root.sourceDependencies) ||
    root.sourceDependencies.length !== manifest.dependencies.length
  ) {
    throw invalidReplayMaterial();
  }
  const sourceDependencies = root.sourceDependencies.map((candidate, index) => {
    const row = exactRecord(
      candidate,
      ["sequence", "operationKey", "replayQuery"],
      "context_replay_material_invalid",
    );
    const source = manifest.dependencies[index];
    if (
      !source ||
      row.sequence !== source.sequence ||
      row.operationKey !== source.operationKey
    ) {
      throw invalidReplayMaterial();
    }
    const replayQuery = row.replayQuery;
    if (source.operation.kind === ContextDependencyKind.TextSearch) {
      if (
        typeof replayQuery !== "string" ||
        replayQuery.length === 0 ||
        Buffer.byteLength(replayQuery, "utf8") > 64 * 1024 ||
        hmacHex(
          sessionSecret,
          canonicalizeReviewContextSearchQuery(replayQuery),
        ) !== source.operation.queryDigest ||
        sha256Utf8(
          hmacHex(
            sessionSecret,
            canonicalizeReviewContextReplayHandle({
              sessionId: session.sessionId,
              sequence: source.sequence,
              query: replayQuery,
            }),
          ),
        ) !== source.operation.replayHandleHash
      ) {
        throw invalidReplayMaterial();
      }
    } else if (replayQuery !== null) {
      throw invalidReplayMaterial();
    }
    return Object.freeze({
      sequence: source.sequence,
      operationKey: source.operationKey,
      replayQuery: replayQuery as string | null,
    });
  });
  const normalized: ReplayMaterial = Object.freeze({
    materialVersion: replayMaterialVersion,
    sourceDependencies: Object.freeze(sourceDependencies),
  });
  const canonical = stableJson(normalized as never);
  if (canonical !== value) throw invalidReplayMaterial();
  return Object.freeze({ ...normalized, canonicalJson: canonical });
}

function parseGatewayV4ReplayMaterial(
  value: string,
  parsed: unknown,
  manifest: ContextGatewayV4Manifest,
  session: GatewaySession,
): ReplayMaterial & { readonly canonicalJson: string } {
  if (isRecordWithKeys(parsed, ["materialVersion", "sourceDependencies"])) {
    const legacy = parsed as Record<string, unknown>;
    if (
      legacy.materialVersion !== replayMaterialVersion ||
      !Array.isArray(legacy.sourceDependencies) ||
      legacy.sourceDependencies.length !== 0 ||
      stableJson(legacy as never) !== value
    ) {
      throw invalidReplayMaterial();
    }
    return Object.freeze({
      materialVersion: replayMaterialVersion,
      sourceDependencies: Object.freeze([]),
      canonicalJson: value,
    });
  }
  const root = exactRecord(
    parsed,
    ["entries", "replayMaterialVersion", "sessionId"],
    "context_replay_material_invalid",
  );
  const successful = manifest.events.filter(
    (event) => event.outcome === ContextGatewayV4OutcomeKind.Succeeded,
  );
  if (
    root.replayMaterialVersion !== 2 ||
    root.sessionId !== session.sessionId ||
    !Array.isArray(root.entries) ||
    root.entries.length !== successful.length
  ) {
    throw invalidReplayMaterial();
  }
  const entries = root.entries.map((candidate, index) => {
    const row = exactRecord(
      candidate,
      [
        "operationKey",
        "operationKind",
        "operationReceiptId",
        "replayInput",
        "sequence",
      ],
      "context_replay_material_invalid",
    );
    const event = successful[index];
    if (
      !event ||
      row.sequence !== event.sequence ||
      row.operationReceiptId !== event.operationReceiptId ||
      row.operationKey !== event.operationKey ||
      row.operationKind !== event.operationKind ||
      !Object.values(ContextGatewayV4OperationKind).includes(
        row.operationKind as ContextGatewayV4OperationKind,
      )
    ) {
      throw invalidReplayMaterial();
    }
    const operationKind = row.operationKind as ContextGatewayV4OperationKind;
    const replayInput = normalizeGatewayV4ReplayInput(
      operationKind,
      row.replayInput,
    );
    if (
      gatewayV4OperationKey(operationKind, replayInput) !== event.operationKey
    ) {
      throw invalidReplayMaterial();
    }
    return Object.freeze({
      sequence: event.sequence,
      operationReceiptId: event.operationReceiptId!,
      operationKey: event.operationKey,
      operationKind,
      replayInput,
    });
  });
  const normalized = Object.freeze({
    replayMaterialVersion: 2 as const,
    sessionId: session.sessionId,
    entries: Object.freeze(entries),
  });
  const canonicalJson = stableJson(normalized as never);
  if (canonicalJson !== value) throw invalidReplayMaterial();
  return Object.freeze({ ...normalized, canonicalJson });
}

function normalizeGatewayV4ReplayInput(
  kind: ContextGatewayV4OperationKind,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidReplayMaterial();
  }
  const input = value as Record<string, unknown>;
  const allowed = gatewayV4ReplayInputKeys(kind);
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw invalidReplayMaterial();
  }
  switch (kind) {
    case ContextGatewayV4OperationKind.FileRead:
    case ContextGatewayV4OperationKind.DirectoryList:
      requireReplayString(input.path);
      break;
    case ContextGatewayV4OperationKind.TextSearch:
      requireReplayString(input.query);
      if (
        input.paths !== undefined &&
        !isCanonicalUndefined(input.paths) &&
        (!Array.isArray(input.paths) ||
          input.paths.some((path) => typeof path !== "string"))
      ) {
        throw invalidReplayMaterial();
      }
      break;
    case ContextGatewayV4OperationKind.GitFact:
      if (
        !["merge_base", "changed_paths", "diff_stat"].includes(
          String(input.fact),
        )
      ) {
        throw invalidReplayMaterial();
      }
      break;
    case ContextGatewayV4OperationKind.CanonicalInventory:
      break;
    case ContextGatewayV4OperationKind.UnsupportedTool:
      throw invalidReplayMaterial();
  }
  if (
    input.cursor !== undefined &&
    input.cursor !== null &&
    !isCanonicalUndefined(input.cursor) &&
    typeof input.cursor !== "string"
  ) {
    throw invalidReplayMaterial();
  }
  return Object.freeze({ ...input });
}

function gatewayV4ReplayInputKeys(
  kind: ContextGatewayV4OperationKind,
): readonly string[] {
  switch (kind) {
    case ContextGatewayV4OperationKind.FileRead:
      return ["maxBytes", "path", "revision", "startByte"];
    case ContextGatewayV4OperationKind.DirectoryList:
      return [
        "cursor",
        "includeHidden",
        "maxDepth",
        "pageSize",
        "path",
        "revision",
      ];
    case ContextGatewayV4OperationKind.TextSearch:
      return [
        "caseSensitive",
        "cursor",
        "pageSize",
        "paths",
        "query",
        "revision",
      ];
    case ContextGatewayV4OperationKind.CanonicalInventory:
      return ["cursor", "pageSize"];
    case ContextGatewayV4OperationKind.GitFact:
      return ["fact"];
    case ContextGatewayV4OperationKind.UnsupportedTool:
      return [];
  }
}

function gatewayV4OperationKey(
  kind: ContextGatewayV4OperationKind,
  replayInput: Readonly<Record<string, unknown>>,
): string {
  switch (kind) {
    case ContextGatewayV4OperationKind.FileRead:
      return sha256Utf8(
        stableJson({
          kind,
          inputHash: sha256Utf8(stableJson(replayInput as never)),
        } as never),
      );
    case ContextGatewayV4OperationKind.DirectoryList:
    case ContextGatewayV4OperationKind.CanonicalInventory:
      return gatewayV4HashedInputOperationKey(kind, replayInput, false);
    case ContextGatewayV4OperationKind.TextSearch:
      return gatewayV4HashedInputOperationKey(kind, replayInput, true);
    case ContextGatewayV4OperationKind.GitFact:
      return sha256Utf8(stableJson({ kind, fact: replayInput.fact } as never));
    case ContextGatewayV4OperationKind.UnsupportedTool:
      throw invalidReplayMaterial();
  }
}

function gatewayV4HashedInputOperationKey(
  kind: ContextGatewayV4OperationKind,
  replayInput: Readonly<Record<string, unknown>>,
  redactQuery: boolean,
): string {
  const normalized = {
    ...replayInput,
    ...(redactQuery ? { query: sha256Utf8(String(replayInput.query)) } : {}),
    cursor:
      typeof replayInput.cursor === "string"
        ? sha256Utf8(replayInput.cursor)
        : null,
  };
  return sha256Utf8(
    stableJson({
      kind,
      inputHash: sha256Utf8(stableJson(normalized as never)),
    } as never),
  );
}

function requireReplayString(value: unknown): void {
  if (typeof value !== "string" || value.length === 0) {
    throw invalidReplayMaterial();
  }
}

function isCanonicalUndefined(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as Record<string, unknown>).$undefined === true
  );
}

function isRecordWithKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>)
      .sort()
      .join("\0") === [...keys].sort().join("\0")
  );
}

export function verifyGatewayTranscript(
  session: GatewaySession,
  manifest: ContextAttestationManifest,
  sessionSecret: Buffer,
): void {
  if (!isLegacyContextDependencyManifest(manifest)) {
    verifyGatewayV4Transcript(session, manifest, sessionSecret);
    return;
  }
  let previous = session.eventChainSeedHash;
  for (const dependency of manifest.dependencies) {
    if (dependency.previousEventHash !== previous) {
      throw transcriptChainInvalid();
    }
    const expected = hmacHex(
      sessionSecret,
      canonicalizeReviewContextGatewayEvent({
        sessionId: session.sessionId,
        sequence: dependency.sequence,
        previousEventHash: dependency.previousEventHash,
        operationKey: dependency.operationKey,
        operation: JSON.parse(
          canonicalContextDependencyOperation(dependency.operation),
        ),
        result: JSON.parse(canonicalContextDependencyResult(dependency.result)),
      }),
    );
    if (!sameHex(expected, dependency.eventHash)) {
      throw transcriptChainInvalid();
    }
    previous = dependency.eventHash;
  }
  if (manifest.authenticatedChainHash !== previous) {
    throw transcriptChainInvalid();
  }
}

function verifyGatewayV4Transcript(
  session: GatewaySession,
  manifest: ContextGatewayV4Manifest,
  sessionSecret: Buffer,
): void {
  let previous = session.eventChainSeedHash;
  for (const event of manifest.events) {
    if (event.previousEventHash !== previous) {
      throw transcriptChainInvalid();
    }
    const expected = hmacHex(
      sessionSecret,
      stableJson({
        sessionId: session.sessionId,
        sequence: event.sequence,
        previousEventHash: event.previousEventHash,
        operationKey: event.operationKey,
        outcome: event.outcome,
        failureClass: event.failureClass,
        operation: event.operation,
        result: event.result,
        operationReceiptId: event.operationReceiptId,
        sanitizedReason: event.sanitizedReason,
      } as never),
    );
    if (!sameHex(expected, event.eventHash)) {
      throw transcriptChainInvalid();
    }
    previous = event.eventHash;
  }
  if (manifest.authenticatedChainHash !== previous) {
    throw transcriptChainInvalid();
  }
}

export function verifySyntheticReplayChain(
  manifest: ContextDependencyManifest,
  planHash: string,
  attestationId: string,
  targetReviewRevisionHash: string,
  targetCheckoutTreeOid: string,
): void {
  let previous = sha256Utf8(
    canonicalizeReviewContextReplayChainSeed({
      planHash,
      attestationId,
      targetReviewRevisionHash,
      targetCheckoutTreeOid,
    }),
  );
  for (const dependency of manifest.dependencies) {
    if (dependency.previousEventHash !== previous) {
      throw replayChainInvalid();
    }
    const expected = sha256Utf8(
      canonicalizeReviewContextReplayEvent({
        sequence: dependency.sequence,
        previousEventHash: dependency.previousEventHash,
        operationKey: dependency.operationKey,
        operation: JSON.parse(
          canonicalContextDependencyOperation(dependency.operation),
        ),
        result: JSON.parse(canonicalContextDependencyResult(dependency.result)),
      }),
    );
    if (!sameHex(expected, dependency.eventHash)) {
      throw replayChainInvalid();
    }
    previous = dependency.eventHash;
  }
  if (manifest.authenticatedChainHash !== previous) {
    throw replayChainInvalid();
  }
}

export function verifySyntheticGatewayV4ReplayChain(
  manifest: ContextGatewayV4Manifest,
  planHash: string,
  attestationId: string,
  targetReviewRevisionHash: string,
  targetCheckoutTreeOid: string,
): void {
  let previous = sha256Utf8(
    canonicalizeReviewContextReplayChainSeed({
      planHash,
      attestationId,
      targetReviewRevisionHash,
      targetCheckoutTreeOid,
    }),
  );
  if (manifest.eventChainSeedHash !== previous) throw replayChainInvalid();
  for (const event of manifest.events) {
    if (
      event.outcome !== ContextGatewayV4OutcomeKind.Succeeded ||
      event.previousEventHash !== previous
    ) {
      throw replayChainInvalid();
    }
    const expected = sha256Utf8(
      canonicalizeReviewContextReplayEvent({
        sequence: event.sequence,
        previousEventHash: event.previousEventHash,
        operationKey: event.operationKey,
        operation: event.operation,
        result: event.result,
      }),
    );
    if (!sameHex(expected, event.eventHash)) throw replayChainInvalid();
    previous = event.eventHash;
  }
  if (manifest.authenticatedChainHash !== previous) {
    throw replayChainInvalid();
  }
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  issue: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure(400, ReviewActionV2ProtocolErrorCode.InvalidRequest, issue);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw failure(400, ReviewActionV2ProtocolErrorCode.InvalidRequest, issue);
  }
  return value as Record<string, unknown>;
}

function invalidReplayMaterial() {
  return failure(
    422,
    ReviewActionV2ProtocolErrorCode.InvariantViolation,
    "context_replay_material_invalid",
  );
}

function transcriptChainInvalid() {
  return failure(
    422,
    ReviewActionV2ProtocolErrorCode.InvariantViolation,
    "context_transcript_hmac_chain_invalid",
  );
}

function replayChainInvalid() {
  return failure(
    422,
    ReviewActionV2ProtocolErrorCode.InvariantViolation,
    "context_replay_sha256_chain_invalid",
  );
}
