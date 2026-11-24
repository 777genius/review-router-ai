// Validate replay material and authenticated transcripts, preserving legacy and gateway-v4 encodings.
import {
  ContextDependencyKind,
  ContextGatewayV4OperationKind,
  ContextGatewayV4OutcomeKind,
  canonicalContextDependencyOperation,
  canonicalContextDependencyResult,
  isLegacyContextDependencyManifest,
  selectContextGatewayV4ReplayEvents,
  type ContextAttestationManifest,
  type ContextDependencyManifest,
  type ContextGatewayV4Event,
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
  const targetEvents = gatewayV4ReplayOperationStarts(
    manifest.events.filter(
      (event) => event.outcome === ContextGatewayV4OutcomeKind.Succeeded,
    ),
  );
  if (!targetEvents || targetEvents.length !== operations.length) return false;
  return operations.every((operation, index) => {
    const target = targetEvents[index];
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
  const selectedEvents = selectContextGatewayV4ReplayEvents(
    manifest.events,
    selectedReceiptIds,
  );
  if (!selectedEvents) return null;
  const operationStarts = gatewayV4ReplayOperationStarts(selectedEvents);
  if (!operationStarts) return null;
  const entryBySequence = new Map(
    material.entries.map((entry) => [entry.sequence, entry]),
  );
  const operations: Array<{
    operationKind: ContextGatewayV4OperationKind;
    replayInput: Readonly<Record<string, unknown>>;
  }> = [];
  for (const event of operationStarts) {
    const entry = entryBySequence.get(event.sequence);
    if (!entry) return null;
    if (isGatewayV4PagedOperation(event.operationKind)) {
      const { cursor, ...replayInput } = entry.replayInput;
      void cursor;
      operations.push(
        Object.freeze({
          operationKind: event.operationKind,
          replayInput: Object.freeze(replayInput),
        }),
      );
      continue;
    }
    operations.push(
      Object.freeze({
        operationKind: event.operationKind,
        replayInput: entry.replayInput,
      }),
    );
  }
  return Object.freeze(operations);
}

function gatewayV4ReplayOperationStarts(
  events: readonly ContextGatewayV4Event[],
): readonly ContextGatewayV4Event[] | null {
  const starts: ContextGatewayV4Event[] = [];
  let pendingPage: ContextGatewayV4Event | null = null;
  for (const event of events) {
    if (pendingPage !== null) {
      // A v2 replay-plan operation drains a whole page chain. It cannot encode
      // an intervening selected operation without reordering authenticated events.
      if (
        event.operationKind !== pendingPage.operationKind ||
        event.result?.queryDigest !== pendingPage.result?.queryDigest ||
        event.result?.pageOrdinal !==
          Number(pendingPage.result?.pageOrdinal) + 1
      ) {
        return null;
      }
      pendingPage = event.result?.complete === true ? null : event;
      continue;
    }
    if (isGatewayV4PagedOperation(event.operationKind)) {
      if (event.result?.pageOrdinal !== 0) return null;
      pendingPage = event.result.complete === true ? null : event;
    }
    starts.push(event);
  }
  return pendingPage === null ? starts : null;
}

function isGatewayV4PagedOperation(
  kind: ContextGatewayV4OperationKind,
): boolean {
  return (
    kind === ContextGatewayV4OperationKind.DirectoryList ||
    kind === ContextGatewayV4OperationKind.TextSearch ||
    kind === ContextGatewayV4OperationKind.CanonicalInventory
  );
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
